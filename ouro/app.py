"""Ouro — Main Textual Application.

Wires together the game engine and UI into a playable TUI game.
"""

from __future__ import annotations

from collections import deque
import random
import time
from pathlib import Path

from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical
from textual.widgets import Header, Footer, Static
from textual.timer import Timer

from ouro.data.balance import BALANCE
from ouro.data.archetypes import ALL_ARCHETYPES
from ouro.data.curses import roll_curse
from ouro.engine.game_state import GameState
from ouro.engine.economy import compute_derived, handle_press, tick_idle, purchase_upgrade, can_afford_upgrade
from ouro.engine.rhythm import attempt_bite, tick_mouth, tick_auto_bite, tick_venom_rush, tick_combo_decay, get_beat_progress, get_current_bpm, tick_post_frenzy_bpm
from ouro.engine.prestige import can_shed, perform_shed, can_ascend, perform_ascension
from ouro.engine.events import EventManager
from ouro.engine.procedural import refresh_offerings
from ouro.engine.meta import MetaState, load_meta, save_meta, apply_run_results
from ouro.engine.save import save_run, load_run, delete_run

from ouro.ui.snake_display import SnakeDisplay
from ouro.ui.hud import HUD
from ouro.ui.upgrade_panel import UpgradePanel
from ouro.ui.event_overlay import EventOverlay
from ouro.ui.prestige_screen import PrestigeInfo
from ouro.ui.collections import CollectionsScreen
from ouro.ui.ascension_screen import AscensionScreen
from ouro.ui.rhythm_indicator import RhythmIndicator


CSS_PATH = Path(__file__).parent / "ui" / "styles.tcss"


class OuroApp(App):
    """The Ouro TUI game application."""

    TITLE = "Ouro — The Eternal Serpent"
    SUB_TITLE = "Feed. Grow. Devour. Ascend."
    CSS_PATH = CSS_PATH

    BINDINGS = [
        Binding("space", "feed", "Feed", show=True, priority=True),
        Binding("enter", "feed", "Feed", show=False),
        Binding("s", "shed_skin", "Shed Skin", show=True),
        Binding("a", "ascend", "Ascend", show=True),
        Binding("g", "catch_golden", "Catch Golden", show=False),
        Binding("b", "accept_bargain", "Accept Bargain", show=False),
        Binding("e", "accept_echo", "Accept Echo", show=False),
        Binding("1", "buy_upgrade_1", "Buy #1", show=False),
        Binding("2", "buy_upgrade_2", "Buy #2", show=False),
        Binding("3", "buy_upgrade_3", "Buy #3", show=False),
        Binding("c", "show_collections", "Collections", show=True),
        Binding("q", "quit_game", "Quit", show=True),
    ]

    # Auto-save every N seconds
    _AUTO_SAVE_INTERVAL: float = 30.0

    def __init__(self) -> None:
        super().__init__()
        self._meta: MetaState = load_meta()
        # Try to resume a saved run, otherwise start fresh
        saved = load_run()
        self._state: GameState = saved if saved is not None else self._new_run_state()
        self._events: EventManager = EventManager()
        self._last_tick: float = time.time()
        self._last_autosave: float = time.time()
        self._press_timestamps: deque[float] = deque(maxlen=10)
        self._last_synced_bite_feedback: str = ""
        self._tick_timer: Timer | None = None

    def _new_run_state(self) -> GameState:
        """Create a fresh run state with meta bonuses, random archetype and curse."""
        # Pick a random archetype
        archetype = random.choice(list(ALL_ARCHETYPES.values()))
        # Roll a random curse id (empty string = no curse)
        curse_id = roll_curse()

        state = GameState(
            snake_length=self._meta.get_starting_length(),
            archetype_id=archetype.id,
            curse_id=curse_id,
        )

        # Apply archetype starting upgrades
        for uid, level in archetype.starting_upgrades.items():
            state.upgrade_levels[uid] = level

        # Apply permanent ascension bonuses from meta
        self._meta.apply_ascension_starting_bonuses(state)

        compute_derived(state)
        return state

    def compose(self) -> ComposeResult:
        yield Header()

        # Event overlay (conditionally visible)
        yield EventOverlay(id="event-overlay")

        with Horizontal(id="game-container"):
            # Left: HUD
            yield HUD(id="hud-panel")

            # Center: Snake display
            with Vertical(id="snake-panel"):
                yield SnakeDisplay(id="snake-display")
                yield RhythmIndicator(id="rhythm-indicator")
                yield PrestigeInfo(id="prestige-info")

            # Right: Upgrades
            yield UpgradePanel(id="upgrade-panel")

        yield Footer()

    def on_mount(self) -> None:
        """Start the game loop timer."""
        interval = 1.0 / BALANCE.tick_rate_hz
        self._tick_timer = self.set_interval(interval, self._game_tick)
        self._last_tick = time.time()

        # Generate initial offerings
        refresh_offerings(self._state, self._meta.get_unlocked_upgrade_set())

        # Initial UI sync
        self._sync_ui()

    def _game_tick(self) -> None:
        """Main game loop — called BALANCE.tick_rate_hz times per second."""
        now = time.time()
        dt = now - self._last_tick
        self._last_tick = now

        # Idle income
        tick_idle(self._state, dt)

        # Idle escalation: track seconds since last manual press
        self._state.idle_seconds += dt

        # Mouth cooldown (reopen jaw after bite)
        tick_mouth(self._state)

        # Venom Rush expiry
        tick_venom_rush(self._state)

        # Auto-bite (Serpent Instinct upgrade)
        auto_result = tick_auto_bite(self._state)
        if auto_result is not None:
            handle_press(self._state)
            compute_derived(self._state)
            rhythm = self.query_one("#rhythm-indicator", RhythmIndicator)
            rhythm.set_feedback(auto_result)

        # Combo decay
        tick_combo_decay(self._state)

        # Post-frenzy BPM step-down
        tick_post_frenzy_bpm(self._state)

        # Recompute derived (combo may have changed)
        compute_derived(self._state)

        # Events
        notifications = self._events.tick(self._state)
        for notif in notifications:
            if notif == "golden_spawn":
                self.notify("✦ A Golden Ouroboros appears! Press [G]!", severity="warning", timeout=3)
            elif notif == "golden_missed":
                self.notify("The Golden Ouroboros fades away...", severity="information", timeout=2)
            elif notif.startswith("frenzy_end:"):
                parts = notif.split(":")
                presses, reward = parts[1], parts[2]
                self.notify(
                    f"🐍 Frenzy over! {presses} bites → +{reward} Essence!",
                    severity="warning", timeout=4,
                )
            elif notif.startswith("challenge_start:"):
                desc = notif.split(":", 1)[1]
                self.notify(f"⚡ Challenge: {desc}", severity="warning", timeout=3)
            elif notif.startswith("challenge_complete:"):
                reward = notif.split(":", 1)[1]
                self.notify(f"✓ Challenge complete! +{reward} Essence", severity="information", timeout=2)
            elif notif == "challenge_failed":
                self.notify("✗ Challenge failed!", severity="error", timeout=2)
            elif notif == "bargain_spawn":
                self.notify(
                    "🐍 Serpent's Bargain! Sacrifice 30% of your essence for a free upgrade. [B] Accept  — expires in 12s",
                    severity="warning", timeout=5,
                )
            elif notif == "bargain_expired":
                self.notify("The Serpent's Bargain fades...", severity="information", timeout=2)
            elif notif.startswith("echo_spawn:"):
                uid = notif.split(":", 1)[1]
                self.notify(
                    f"✦ Ancient Echo: upgrade [{uid}] available for free! [E] Accept  — expires in 15s",
                    severity="warning", timeout=5,
                )
            elif notif == "echo_expired":
                self.notify("The Ancient Echo fades...", severity="information", timeout=2)

        # Refresh offerings if empty
        if not self._state.current_offerings:
            refresh_offerings(self._state, self._meta.get_unlocked_upgrade_set())

        # Periodic auto-save
        if now - self._last_autosave >= self._AUTO_SAVE_INTERVAL:
            save_run(self._state)
            self._last_autosave = now

        # Sync UI
        self._sync_ui()

    def _sync_ui(self) -> None:
        """Push game state to all UI widgets."""
        hud = self.query_one("#hud-panel", HUD)
        hud.update_from_state(self._state, self._compute_avg_press_bpm())

        snake = self.query_one("#snake-display", SnakeDisplay)
        snake.update_from_state(self._state, self._meta.active_skin)

        # Pulse snake on beat
        beat = get_beat_progress(self._state)
        snake.pulse = beat < 0.15  # bright flash at start of each beat

        upgrades = self.query_one("#upgrade-panel", UpgradePanel)
        upgrades.update_from_state(self._state)

        overlay = self.query_one("#event-overlay", EventOverlay)
        overlay.update_from_state(self._state)

        prestige = self.query_one("#prestige-info", PrestigeInfo)
        prestige.update_from_state(self._state)

        rhythm = self.query_one("#rhythm-indicator", RhythmIndicator)
        rhythm.beat_progress = get_beat_progress(self._state)
        rhythm.bpm = get_current_bpm(self._state)
        rhythm.combo_mult = self._state.combo_multiplier
        rhythm.combo_hits = self._state.combo_hits
        rhythm.mouth_open = self._state.mouth_open
        rhythm.frenzy_active = self._state.frenzy_active
        rhythm.venom_rush_active = self._state.venom_rush_active
        if self._state.last_bite_result != self._last_synced_bite_feedback:
            if self._state.last_bite_result:
                rhythm.set_feedback(self._state.last_bite_result)
            self._last_synced_bite_feedback = self._state.last_bite_result

    def _compute_avg_press_bpm(self) -> float | None:
        """Average manual press BPM over the last up to 10 feed keypresses."""
        if len(self._press_timestamps) < 2:
            return None

        intervals = [
            curr - prev
            for prev, curr in zip(self._press_timestamps, list(self._press_timestamps)[1:])
            if curr > prev
        ]
        if not intervals:
            return None

        avg_interval = sum(intervals) / len(intervals)
        if avg_interval <= 0:
            return None
        return 60.0 / avg_interval

    # ── Actions ──────────────────────────────────────

    def action_feed(self) -> None:
        """Handle a feed keypress (bite attempt)."""
        self._press_timestamps.append(time.time())

        # Reset idle escalation on any manual press
        self._state.idle_seconds = 0.0
        was_venom = self._state.venom_rush_active

        result = attempt_bite(self._state)

        # None means mouth was locked (held key / cooldown) — ignore totally
        if result is None:
            return

        # Venom Rush just triggered — fire notification
        if self._state.venom_rush_active and not was_venom:
            self.notify(
                "🐍 VENOM RUSH! Perfect streak — bonus Essence for 3 beats!",
                severity="warning", timeout=3,
            )

        compute_derived(self._state)
        handle_press(self._state)

        rhythm = self.query_one("#rhythm-indicator", RhythmIndicator)
        rhythm.set_feedback(result)

    def action_shed_skin(self) -> None:
        """Attempt to shed skin — advance to next growth stage."""
        if can_shed(self._state):
            scales = perform_shed(self._state)
            compute_derived(self._state)
            refresh_offerings(self._state, self._meta.get_unlocked_upgrade_set())
            save_run(self._state)
            from ouro.data.balance import BALANCE as _B
            stage_name = _B.prestige.growth_stages[self._state.current_stage_index][1]
            self.notify(
                f"🐍 Shed Skin → {stage_name}!  +{scales:.0f} Scales",
                severity="warning", timeout=3,
            )
        else:
            self.notify("Not ready to shed — grow more!", severity="error", timeout=1)

    def action_ascend(self) -> None:
        """Open the Ascension screen (upgrade tree + full meta-reset)."""
        if can_ascend(self._state):
            self.push_screen(
                AscensionScreen(self._state, self._meta),
                self._on_ascension_confirmed,
            )
        else:
            self.notify("Reach Cosmic Scale first to Ascend.", severity="error", timeout=2)

    def _on_ascension_confirmed(self, confirmed: bool | None) -> None:
        """Called when the AscensionScreen is dismissed."""
        if not confirmed:
            return
        perform_ascension(self._state)
        self._meta.ascension_count += 1
        save_meta(self._meta)
        self._state = self._new_run_state()
        self._events = EventManager()
        self._last_synced_bite_feedback = ""
        refresh_offerings(self._state, self._meta.get_unlocked_upgrade_set())
        delete_run()
        self._sync_ui()
        self.notify(
            f"✦ ASCENSION {self._meta.ascension_count}! The eternal cycle begins anew. ✔",
            severity="warning", timeout=6,
        )

    def action_catch_golden(self) -> None:
        """Attempt to catch the golden ouroboros (starts Feeding Frenzy)."""
        result = self._events.catch_golden(self._state)
        if result == -1.0:
            compute_derived(self._state)
            self.notify("🐍 FEEDING FRENZY! MASH SPACE!", severity="warning", timeout=3)

    def _buy_upgrade(self, index: int) -> None:
        """Purchase upgrade at offering index (0-based)."""
        offerings = self._state.current_offerings
        if index >= len(offerings):
            return

        uid = offerings[index]
        if purchase_upgrade(self._state, uid):
            self.notify(f"Upgraded {uid}!", severity="information", timeout=1)
            # Refresh offerings after purchase
            refresh_offerings(self._state, self._meta.get_unlocked_upgrade_set())
        else:
            self.notify("Can't afford that upgrade.", severity="error", timeout=1)

    def action_buy_upgrade_1(self) -> None:
        self._buy_upgrade(0)

    def action_buy_upgrade_2(self) -> None:
        self._buy_upgrade(1)

    def action_buy_upgrade_3(self) -> None:
        self._buy_upgrade(2)

    def action_accept_bargain(self) -> None:
        """Accept the Serpent's Bargain event."""
        if self._events.bargain_active:
            self._events.accept_bargain(self._state)
            compute_derived(self._state)
            refresh_offerings(self._state, self._meta.get_unlocked_upgrade_set())
            self.notify("Bargain accepted — essence sacrificed, upgrade granted!", severity="information", timeout=2)
        else:
            self.notify("No active Serpent's Bargain.", severity="error", timeout=1)

    def action_accept_echo(self) -> None:
        """Accept the Ancient Echo free upgrade."""
        if self._events.echo_active:
            uid = self._events.echo_upgrade_id
            self._events.accept_echo(self._state)
            compute_derived(self._state)
            refresh_offerings(self._state, self._meta.get_unlocked_upgrade_set())
            self.notify(f"Ancient Echo accepted — {uid} upgraded for free!", severity="information", timeout=2)
        else:
            self.notify("No active Ancient Echo.", severity="error", timeout=1)

    def action_show_collections(self) -> None:
        """Show the collections screen."""
        self.push_screen(CollectionsScreen(self._meta))

    def action_quit_game(self) -> None:
        """End run, apply meta results, save, and quit."""
        # Persist the run so it can be resumed next launch
        save_run(self._state)
        knowledge = apply_run_results(self._meta, self._state.stats)
        save_meta(self._meta)
        self.notify(f"Run saved! +{knowledge} Serpent Knowledge", severity="information", timeout=3)
        self.exit()
