"""Lore fragments — narrative collectibles unlocked via achievements."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class LoreFragment:
    """A piece of the ouroboros myth."""

    id: int
    title: str
    text: str
    unlock_hint: str


LORE_FRAGMENTS: list[LoreFragment] = [
    LoreFragment(
        id=1,
        title="The Hunger Before",
        text=(
            "In the beginning, there was only hunger. "
            "No mouth to feed it, no body to house it — just an ache "
            "that stretched across the nothing."
        ),
        unlock_hint="Complete your first run.",
    ),
    LoreFragment(
        id=2,
        title="The First Coil",
        text=(
            "The hunger folded in on itself. Where it bent, "
            "something formed — a single scale, bright as a new star. "
            "The first serpent had no tail to eat, so it consumed the void."
        ),
        unlock_hint="Reach length 50 in a single run.",
    ),
    LoreFragment(
        id=3,
        title="The Discovery",
        text=(
            "Growing tired, the serpent turned its head and saw — "
            "itself. Miles of coiled body, an endless feast. "
            "The first bite was ecstasy."
        ),
        unlock_hint="Purchase your first upgrade by biting your tail.",
    ),
    LoreFragment(
        id=4,
        title="The Paradox",
        text=(
            "To consume yourself is to diminish. To diminish is to hunger. "
            "To hunger is to grow. The serpent understood: "
            "destruction and creation were the same motion."
        ),
        unlock_hint="Shed Skin for the first time.",
    ),
    LoreFragment(
        id=5,
        title="The Shed",
        text=(
            "Dead scales fell like autumn leaves. Beneath — new skin, "
            "luminous and raw. The serpent was smaller now, "
            "but each new scale held the memory of a thousand old ones."
        ),
        unlock_hint="Shed Skin 3 times in a single run.",
    ),
    LoreFragment(
        id=6,
        title="The Rhythm",
        text=(
            "There is a pulse in the void. Not a heart — something older. "
            "The serpent learned to move with it, and where its body "
            "struck the beat, reality rippled."
        ),
        unlock_hint="Reach a 5x combo multiplier.",
    ),
    LoreFragment(
        id=7,
        title="The Golden Visitor",
        text=(
            "Sometimes another serpent appears — golden, flickering, "
            "impossible. It offers a gift if you can catch it. "
            "Most cannot. It does not wait."
        ),
        unlock_hint="Catch your first Golden Ouroboros.",
    ),
    LoreFragment(
        id=8,
        title="The Challenge",
        text=(
            "The void tests the worthy. Speed, patience, precision — "
            "each trial a mirror. The serpent that passes sees itself more clearly."
        ),
        unlock_hint="Complete 5 timed challenges across all runs.",
    ),
    LoreFragment(
        id=9,
        title="The Expansion",
        text=(
            "Scales upon scales upon scales. The serpent could no longer "
            "see its own tail. The world was small now. "
            "Or perhaps the serpent had grown too large for it."
        ),
        unlock_hint="Reach length 500 in a single run.",
    ),
    LoreFragment(
        id=10,
        title="The Ascension",
        text=(
            "The serpent uncoiled and wrapped itself around the world. "
            "Stars nested in its curves. Galaxies tumbled between its ribs. "
            "It was no longer a serpent — it was the architecture of everything."
        ),
        unlock_hint="Achieve Cosmic Ascension for the first time.",
    ),
    LoreFragment(
        id=11,
        title="The Cosmic Hunger",
        text=(
            "Even gods hunger. The World Serpent gazed at the stars "
            "and saw only meals. It began to eat the sky."
        ),
        unlock_hint="Earn 1M Essence in a single run.",
    ),
    LoreFragment(
        id=12,
        title="The Memory",
        text=(
            "Between cycles, something persists — not the body, "
            "not the scales, but a knowing. The serpent remembers "
            "how to be hungry before it remembers how to be."
        ),
        unlock_hint="Complete 5 total runs.",
    ),
    LoreFragment(
        id=13,
        title="The Other Serpents",
        text=(
            "In the spaces between stars, the World Serpent saw traces — "
            "old coils, shed skins, bite marks. Others had been here. "
            "Others had eaten their own tails."
        ),
        unlock_hint="Unlock 3 different snake skins.",
    ),
    LoreFragment(
        id=14,
        title="The Question",
        text=(
            "If the serpent eats its entire tail and reaches its head, "
            "does it disappear? Or does it become everything?"
        ),
        unlock_hint="Reach length 0 by spending all segments on upgrades.",
    ),
    LoreFragment(
        id=15,
        title="The Answer",
        text=(
            "Yes."
        ),
        unlock_hint="Collect all other lore fragments.",
    ),
]
