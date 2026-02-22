"""Ascension Screen — permanent upgrade tree (Cookie Clicker-style meta-reset).

The player spends accumulated Scales on permanent upgrades before resetting their
run.  Upgrades persist across all future runs.  Pressing [X] confirms the ascension
and starts a fresh run with chosen bonuses active.
"""

from __future__ import annotations

from rich.text import Text
from textual.screen import Screen
from textual.widgets import Static, Footer
from textual.containers import Vertical
from textual.binding import Binding
from textual import on

from ouro.data.ascension_upgrades import ASCENSION_UPGRADES, AscensionUpgrade
from ouro.engine.economy import format_number
from ouro.engine.game_state import GameState
from ouro.engine.meta import MetaState


_KEYS = "1234567"   # one key per upgrade slot (max 7 upgrades)


class AscensionScreen(Screen[bool]):
    """Full-screen modal for picking ascension upgrades before meta-reset."""

    BINDINGS = [
        Binding("escape", "cancel", "Back (no ascend)"),
        Binding("x", "confirm_ascend", "ASCEND & RESET", show=True),
        *[Binding(k, f"buy_{k}", f"Buy {k}", show=False) for k in _KEYS],
    ]

    DEFAULT_CSS = """
    AscensionScreen {
        background: $surface;
        align: center top;
        padding: 2 4;
    }

    #asc-header {
        width: 100%;
        text-align: center;
        padding-bottom: 1;
    }

    #asc-upgrades {
        width: 100%;
        height: auto;
        padding: 0 2;
    }

    #asc-footer-hint {
        width: 100%;
        text-align: center;
        padding-top: 1;
    }
    """

    def __init__(self, state: GameState, meta: MetaState, **kwargs) -> None:
        super().__init__(**kwargs)
        self._state = state
        self._meta = meta

    # ── Compose ───────────────────────────────────────────────────

    def compose(self):
        yield Static(id="asc-header")
        with Vertical(id="asc-upgrades"):
            yield Static(id="asc-upgrade-list")
        yield Static(id="asc-footer-hint")
        yield Footer()

    def on_mount(self) -> None:
        self._refresh_display()

    # ── Actions ──────────────────────────────────────────────────

    def action_cancel(self) -> None:
        self.dismiss(False)

    def action_confirm_ascend(self) -> None:
        self.dismiss(True)

    def _buy(self, upgrade_id: str) -> None:
        udef = ASCENSION_UPGRADES[upgrade_id]
        current = self._meta.ascension_upgrade_levels.get(upgrade_id, 0)
        if current >= udef.max_level:
            return
        cost = udef.cost_at_level(current)
        if self._state.scales < cost:
            return
        self._state.scales -= cost
        self._meta.ascension_upgrade_levels[upgrade_id] = current + 1
        self._refresh_display()

    # Dynamic action methods for each key slot
    for _i, _k in enumerate(_KEYS):
        exec(
            f"def action_buy_{_k}(self) -> None:\n"
            f"    uids = list(ASCENSION_UPGRADES.keys())\n"
            f"    if {_i} < len(uids): self._buy(uids[{_i}])"
        )

    # ── Rendering ────────────────────────────────────────────────

    def _refresh_display(self) -> None:
        scales = self._state.scales

        # Header
        header = self.query_one("#asc-header", Static)
        h = Text()
        h.append("✦ ASCENSION ✦\n", style="bold bright_yellow")
        h.append(
            "The eternal cycle continues. Choose your permanent gifts.\n\n",
            style="dim italic",
        )
        h.append("  Scales available: ", style="dim")
        h.append(f"{format_number(scales)}\n", style="bold yellow")
        h.append(f"  Ascensions completed: {self._meta.ascension_count}\n", style="dim")
        header.update(h)

        # Upgrade list
        uid_list = list(ASCENSION_UPGRADES.keys())
        body = Text()
        for i, uid in enumerate(uid_list):
            key = _KEYS[i] if i < len(_KEYS) else "?"
            udef: AscensionUpgrade = ASCENSION_UPGRADES[uid]
            current = self._meta.ascension_upgrade_levels.get(uid, 0)
            at_max = current >= udef.max_level
            cost = udef.cost_at_level(current)
            affordable = scales >= cost and not at_max

            # Key label
            body.append(f"  [{key}] ", style="bold cyan" if affordable else "dim")

            # Name + level
            if at_max:
                body.append(f"{udef.name} ", style="bold bright_yellow")
                body.append("(MAX) ", style="bold yellow")
            else:
                body.append(f"{udef.name} ", style="bold white" if affordable else "dim")
                body.append(f"Lv{current}/{udef.max_level} ", style="dim")

            # Cost
            if not at_max:
                cost_style = "yellow" if affordable else "dim red"
                body.append(f"— {format_number(cost)} Scales ", style=cost_style)

            # Effect description
            body.append(f"({udef.description})\n", style="dim italic")

        list_widget = self.query_one("#asc-upgrade-list", Static)
        list_widget.update(body)

        # Footer hint
        hint_widget = self.query_one("#asc-footer-hint", Static)
        ft = Text()
        ft.append("\n  Press number key to buy upgrade\n", style="dim")
        ft.append("  [X] ASCEND & RESET ALL PROGRESS  ", style="bold bright_red")
        ft.append("  [Esc] Cancel\n", style="dim")
        hint_widget.update(ft)
