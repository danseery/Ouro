"""Prestige screen — Shed Skin and Ascension UI."""

from __future__ import annotations

from rich.text import Text
from textual.widget import Widget

from ouro.engine.economy import format_number
from ouro.engine.prestige import can_shed, can_ascend, compute_scales_reward
from ouro.engine.game_state import GameState
from ouro.data.balance import BALANCE


class PrestigeInfo(Widget):
    """Shows shed and ascension availability."""

    DEFAULT_CSS = """
    PrestigeInfo {
        width: 100%;
        height: auto;
        min-height: 5;
        padding: 1;
    }
    """

    def __init__(self, **kwargs) -> None:
        super().__init__(**kwargs)
        self._state: GameState | None = None

    def render(self) -> Text:
        text = Text()

        if self._state is None:
            return text

        state = self._state
        stages = BALANCE.prestige.growth_stages


        # ── Shed Skin ─────────────────────────────────────────────────
        text.append("  ─── Shed Skin ───\n", style="bold yellow")
        if can_ascend(state):
            text.append("  ─── Ascension ───\n", style="bold bright_yellow")
            text.append("  [A] Ascend! Open the upgrade tree.\n", style="bold bright_yellow")
            text.append("  You will reset, but keep Scales.\n", style="dim")
        elif can_shed(state):
            reward = compute_scales_reward(state)
            next_stage = stages[state.current_stage_index + 1][1]
            new_length = max(3, stages[state.current_stage_index + 1][0] // 2)
            text.append(f"  [S] Shed → {next_stage}  ", style="bold yellow")
            text.append(f"+{format_number(reward)} Scales\n", style="yellow")
            text.append(f"  Length resets to {format_number(new_length)}. Upgrades kept.\n", style="dim")
        else:
            next_i = state.current_stage_index + 1
            if next_i < len(stages):
                threshold = stages[next_i][0]
                needed = threshold - state.snake_length
                next_name = stages[next_i][1]
                text.append(f"  Next: {next_name}\n", style="dim")
                text.append(f"  Need {format_number(needed)} more length\n", style="dim")
                text.append(
                    f"  ({format_number(state.snake_length)}/{format_number(threshold)})\n",
                    style="dim",
                )
            else:
                text.append("  Reached max stage.\n", style="dim")

        return text

    def update_from_state(self, state: GameState) -> None:
        self._state = state
        self.refresh()
