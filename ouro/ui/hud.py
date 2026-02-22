"""HUD widget — Essence counter, combo, length, timers."""

from __future__ import annotations

from rich.text import Text
from textual.widget import Widget
from textual.reactive import reactive

from ouro.data.archetypes import ALL_ARCHETYPES
from ouro.data.balance import BALANCE
from ouro.data.curses import ALL_CURSES
from ouro.engine.economy import format_number
from ouro.engine.game_state import GameState


class HUD(Widget):
    """Heads-up display showing core game stats."""

    DEFAULT_CSS = """
    HUD {
        width: 100%;
        height: 100%;
        padding: 1;
    }
    """

    essence: reactive[str] = reactive("0")
    length: reactive[int] = reactive(3)
    growth_stage: reactive[str] = reactive("Hatchling")
    combo: reactive[str] = reactive("1.0x")
    combo_hits: reactive[int] = reactive(0)
    idle_income: reactive[str] = reactive("0/s")
    scales: reactive[str] = reactive("0")
    phase_name: reactive[str] = reactive("Hatchling")
    per_press: reactive[str] = reactive("1")
    avg_press_bpm: reactive[str] = reactive("--")
    goal_text: reactive[str] = reactive("")
    goal_pct: reactive[float] = reactive(0.0)
    archetype_id: reactive[str] = reactive("")
    curse_id: reactive[str] = reactive("")

    def render(self) -> Text:
        text = Text()

        # Phase header
        phase_colors = {
            "Hatchling": "bold cyan",
            "World Serpent": "bold yellow",
        }
        phase_style = phase_colors.get(self.phase_name, "bold white")
        text.append(f"  === {self.phase_name} ===\n\n", style=phase_style)

        # Essence
        text.append("  Essence: ", style="dim")
        text.append(f"{self.essence}\n", style="bold green")

        # Per press
        text.append("  Per Press: ", style="dim")
        text.append(f"{self.per_press}\n", style="green")

        # Idle income
        text.append("  Idle: ", style="dim")
        text.append(f"{self.idle_income}\n", style="green")

        # Average button BPM (last 10 feed presses)
        text.append("  Avg BPM (10): ", style="dim")
        text.append(f"{self.avg_press_bpm}\n", style="green")

        text.append("\n")

        # Snake length
        text.append("  Length: ", style="dim")
        text.append(f"{self.length}\n", style="bold cyan")
        text.append(f"  {self.growth_stage}\n", style="cyan")

        # Scales (prestige currency)
        text.append("  Scales: ", style="dim")
        text.append(f"{self.scales}\n", style="bold yellow")

        text.append("\n")

        # Combo
        combo_style = "bold"
        if "8" in self.combo:
            combo_style = "bold red"
        elif "5" in self.combo:
            combo_style = "bold magenta"
        elif "3" in self.combo:
            combo_style = "bold yellow"
        elif "2" in self.combo or "1.5" in self.combo:
            combo_style = "bold green"

        text.append("  Combo: ", style="dim")
        text.append(f"{self.combo}\n", style=combo_style)
        text.append(f"  Hits: {self.combo_hits}\n", style="dim")

        text.append("\n")

        # Current goal with progress bar
        if self.goal_text:
            text.append("  Goal: ", style="dim")
            text.append(f"{self.goal_text}\n", style="bold white")
            bar_width = 16
            filled = int(self.goal_pct * bar_width)
            bar = "#" * filled + "." * (bar_width - filled)
            pct_str = f"{self.goal_pct * 100:.0f}%"
            text.append(f"  [{bar}] {pct_str}\n", style="green")
            text.append("\n")

        # Archetype
        if self.archetype_id:
            archetype = ALL_ARCHETYPES.get(self.archetype_id)
            if archetype:
                text.append("  Archetype: ", style="dim")
                text.append(f"{archetype.name}\n", style="bold cyan")

        # Curse
        if self.curse_id:
            curse = ALL_CURSES.get(self.curse_id)
            if curse:
                text.append("  Curse: ", style="dim")
                text.append(f"{curse.name}\n", style="bold red")

        text.append("\n")
        text.append("  [Space] Feed  [1-3] Buy\n", style="dim italic")
        text.append("  [S] Shed  [A] Ascend\n", style="dim italic")
        text.append("  [Q] Quit\n", style="dim italic")

        return text

    def update_from_state(self, state: GameState, avg_press_bpm: float | None = None) -> None:
        """Sync HUD with game state."""
        self.essence = format_number(state.essence)
        self.length = state.snake_length
        # Growth stage from authoritative index
        stages = BALANCE.prestige.growth_stages
        self.growth_stage = stages[min(state.current_stage_index, len(stages) - 1)][1]
        self.combo = f"{state.combo_multiplier:.1f}x"
        self.combo_hits = state.combo_hits
        self.idle_income = f"{format_number(state.idle_income_per_s)}/s"
        self.scales = format_number(state.scales)
        self.archetype_id = state.archetype_id
        self.curse_id = state.curse_id

        # Phase name = current growth stage name
        stages = BALANCE.prestige.growth_stages
        self.phase_name = stages[min(state.current_stage_index, len(stages) - 1)][1]

        self.per_press = format_number(state.essence_per_press)
        if avg_press_bpm is not None:
            snapped_avg = (int(avg_press_bpm) // 10) * 10
            self.avg_press_bpm = f"{snapped_avg}"
        else:
            self.avg_press_bpm = "--"
        self._update_goal(state)

    def _update_goal(self, state: GameState) -> None:
        """Compute phase goal text and progress fraction."""
        from ouro.engine.prestige import can_shed, can_ascend

        stages = BALANCE.prestige.growth_stages
        if can_ascend(state):
            self.goal_text = "Ready to Ascend! [A]"
            self.goal_pct = 1.0
        elif can_shed(state):
            # Show progress toward next-next stage
            next_i = state.current_stage_index + 2
            if next_i < len(stages):
                target = stages[next_i][0]
                pct = min(state.snake_length / target, 1.0)
                self.goal_text = f"Grow to {format_number(target)} to shed again"
                self.goal_pct = pct
            else:
                self.goal_text = "Ready to Shed! [S]"
                self.goal_pct = 1.0
        else:
            # Not yet at next shed threshold
            next_i = state.current_stage_index + 1
            if next_i < len(stages):
                target = stages[next_i][0]
                pct = min(state.snake_length / target, 1.0)
                self.goal_text = f"Shed at {format_number(target)} length"
                self.goal_pct = pct
            else:
                # At final stage but not 900K yet
                target = stages[-1][0]
                pct = min(state.snake_length / target, 1.0)
                self.goal_text = f"Ascend at {format_number(target)} length"
                self.goal_pct = pct
