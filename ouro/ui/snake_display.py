"""Snake display widget — ASCII snake rendering with animations."""

from __future__ import annotations

from rich.text import Text
from textual.widget import Widget
from textual.reactive import reactive

from ouro.data.skins import ALL_SKINS, SkinDef
from ouro.engine.game_state import GameState, Phase


# Ouroboros ASCII art frames (the snake eating its tail)
OURO_SMALL = [
    "    ╭───╮    ",
    "   ╭┘ ◉ └╮   ",
    "   │      │   ",
    "   ╰╮    ╭╯   ",
    "    ╰────╯    ",
]

OURO_MEDIUM = [
    "      ╭─────╮      ",
    "    ╭─┘  ◉  └─╮    ",
    "   ╭┘         └╮   ",
    "   │            │   ",
    "   │            │   ",
    "   ╰╮         ╭╯   ",
    "    ╰─╮     ╭─╯    ",
    "      ╰─────╯      ",
]

OURO_LARGE = [
    "        ╭───────╮        ",
    "      ╭─┘   ◉   └─╮      ",
    "    ╭─┘             └─╮    ",
    "   ╭┘                 └╮   ",
    "   │                   │   ",
    "   │                   │   ",
    "   │                   │   ",
    "   ╰╮                 ╭╯   ",
    "    ╰─╮             ╭─╯    ",
    "      ╰─╮         ╭─╯      ",
    "        ╰─────────╯        ",
]

OURO_COSMIC = [
    "          ✦ ╭─══════─╮ ✦          ",
    "       ╭──╤═╡  ◉◉◉   ╞═╤──╮       ",
    "     ╭─╯  │           │  ╰─╮     ",
    "    ╭╯    │  ✧ ✦ ✧    │    ╰╮    ",
    "   ╭╯     │           │     ╰╮   ",
    "   │      │   ★   ★   │      │   ",
    "   │      │           │      │   ",
    "   │      │  ✧     ✧  │      │   ",
    "   ╰╮     │           │     ╭╯   ",
    "    ╰╮    │           │    ╭╯    ",
    "     ╰─╮  │           │  ╭─╯     ",
    "       ╰──╧═╡       ╞═╧──╯       ",
    "          ✦ ╰─══════─╯ ✦          ",
]


def _get_art_for_length(length: int, phase: Phase, stage_index: int = 0) -> list[str]:
    """Select the appropriate ASCII art based on snake length and stage."""
    if stage_index >= 9:
        return OURO_COSMIC
    if length < 30:
        return OURO_SMALL
    elif length < 100:
        return OURO_MEDIUM
    else:
        return OURO_LARGE


def _get_skin(skin_id: str) -> SkinDef:
    return ALL_SKINS.get(skin_id, ALL_SKINS["emerald"])


class SnakeDisplay(Widget):
    """Displays the ASCII ouroboros snake with color and animation."""

    DEFAULT_CSS = """
    SnakeDisplay {
        width: 100%;
        height: 1fr;
        content-align: center middle;
    }
    """

    snake_length: reactive[int] = reactive(3)
    phase: reactive[Phase] = reactive(Phase.HATCHLING)
    stage_index: reactive[int] = reactive(0)
    skin_id: reactive[str] = reactive("emerald")
    pulse: reactive[bool] = reactive(False)  # toggles for beat animation

    def render(self) -> Text:
        skin = _get_skin(self.skin_id)
        art = _get_art_for_length(self.snake_length, self.phase, self.stage_index)

        text = Text()
        color = skin.body_color
        if self.pulse:
            color = skin.head_color  # brighter on beat

        for i, line in enumerate(art):
            if i == 1:
                # Head line — use head color
                text.append(line + "\n", style=skin.head_color)
            elif i == len(art) - 1:
                # Tail line — use tail color
                text.append(line + "\n", style=skin.tail_color)
            else:
                text.append(line + "\n", style=color)

        # Length indicator
        text.append(f"\n  Length: {self.snake_length}", style="bold")

        return text

    def update_from_state(self, state: GameState, skin_id: str = "emerald") -> None:
        """Sync display with game state."""
        self.snake_length = state.snake_length
        self.phase = state.phase
        self.stage_index = state.current_stage_index
        self.skin_id = skin_id
