"""Curse definitions — run modifiers randomly assigned at run start.

Curses make runs harder in interesting ways. Players can see which curse
is active at all times in the HUD. Curses are a permanent-ish debuff for
the entire run — they cannot be removed (only embraced).
"""

from __future__ import annotations

import random
from dataclasses import dataclass


@dataclass(frozen=True)
class CurseDef:
    """Definition of a single run curse."""

    id: str
    name: str
    description: str
    # Effect magnitudes — interpreted by the engine based on id
    magnitude: float = 1.0


# ── Curses ───────────────────────────────────────────────────────

BRITTLE_SCALES = CurseDef(
    id="brittle_scales",
    name="Brittle Scales",
    description="Every miss deals double combo damage.",
    magnitude=2.0,   # combo_miss_tolerance halved (rounds to 1)
)

DULL_FANGS = CurseDef(
    id="dull_fangs",
    name="Dull Fangs",
    description="-30% base Essence per press.",
    magnitude=0.70,  # multiplied onto epp
)

IRON_GUT = CurseDef(
    id="iron_gut",
    name="Iron Gut",
    description="All upgrades cost 40% more.",
    magnitude=1.40,  # multiplied onto upgrade costs
)

CLOUDED_VISION = CurseDef(
    id="clouded_vision",
    name="Clouded Vision",
    description="Golden events are 50% shorter.",
    magnitude=0.50,  # multiplied onto golden_duration_s
)

TWITCHY_JAW = CurseDef(
    id="twitchy_jaw",
    name="Twitchy Jaw",
    description="Bite cooldown is 30% longer — the mouth hesitates.",
    magnitude=1.30,  # multiplied onto bite_cooldown_fraction
)

SHEDLESS_SKIN = CurseDef(
    id="shedless_skin",
    name="Shedless Skin",
    description="First shed of the run grants only 40% of normal Scales.",
    magnitude=0.40,  # multiplied onto scales reward for sheds == 1
)

FRAIL_COILS = CurseDef(
    id="frail_coils",
    name="Frail Coils",
    description="Idle income disabled for the first 60 seconds of the run.",
    magnitude=60.0,  # seconds of idle suppression
)

ECHO_CURSE = CurseDef(
    id="echo_curse",
    name="Echo Curse",
    description="Every 4th press earns no Essence — the ouroboros swallows it whole.",
    magnitude=4.0,  # every Nth press is void
)


ALL_CURSES: dict[str, CurseDef] = {
    c.id: c for c in [
        BRITTLE_SCALES,
        DULL_FANGS,
        IRON_GUT,
        CLOUDED_VISION,
        TWITCHY_JAW,
        SHEDLESS_SKIN,
        FRAIL_COILS,
        ECHO_CURSE,
    ]
}


def roll_curse() -> str:
    """Pick a random curse id for a new run."""
    return random.choice(list(ALL_CURSES.keys()))
