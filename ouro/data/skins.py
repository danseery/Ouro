"""Snake skin definitions — cosmetic collectibles."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SkinDef:
    """Definition of a snake skin (cosmetic)."""

    id: str
    name: str
    description: str
    # Rich text markup colors for snake segments
    head_color: str
    body_color: str
    tail_color: str
    # Unlock condition (evaluated at run-end)
    unlock_hint: str


ALL_SKINS: dict[str, SkinDef] = {}


def _register(*skins: SkinDef) -> None:
    for s in skins:
        ALL_SKINS[s.id] = s


_register(
    SkinDef(
        id="emerald",
        name="Emerald",
        description="The hatchling's first scales.",
        head_color="bright_green",
        body_color="green",
        tail_color="dark_green",
        unlock_hint="Default skin.",
    ),
    SkinDef(
        id="obsidian",
        name="Obsidian",
        description="Forged in the heat of cosmic fire.",
        head_color="bright_white",
        body_color="grey37",
        tail_color="grey11",
        unlock_hint="Complete your first Ascension.",
    ),
    SkinDef(
        id="golden",
        name="Golden",
        description="Blessed by fortune's gaze.",
        head_color="bright_yellow",
        body_color="yellow",
        tail_color="dark_goldenrod",
        unlock_hint="Catch 10 Golden Ouroboros events in one run.",
    ),
    SkinDef(
        id="skeletal",
        name="Skeletal",
        description="Nothing but bone and will.",
        head_color="bright_white",
        body_color="white",
        tail_color="grey50",
        unlock_hint="Shed Skin 5 times in one run.",
    ),
    SkinDef(
        id="prismatic",
        name="Prismatic",
        description="Every scale a different hue.",
        head_color="bright_magenta",
        body_color="bright_cyan",
        tail_color="bright_yellow",
        unlock_hint="Complete all timed challenges in one run.",
    ),
    SkinDef(
        id="void",
        name="Void",
        description="Where the serpent moves, reality bends.",
        head_color="bright_magenta",
        body_color="purple",
        tail_color="black",
        unlock_hint="Reach length 1000 in one run.",
    ),
    SkinDef(
        id="ancient",
        name="Ancient",
        description="The first serpent remembers everything.",
        head_color="dark_goldenrod",
        body_color="orange3",
        tail_color="brown",
        unlock_hint="Collect all lore fragments.",
    ),
)
