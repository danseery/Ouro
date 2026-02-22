"""Ascension upgrades — permanent meta-progression tree (Cookie Clicker-style).

Purchased with Scales during Ascension. Effects persist across all subsequent runs.
Two tiers: cheap flat passives and expensive multiplicative power-spikes.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum, auto


class AscensionEffect(Enum):
    STARTING_ESSENCE = auto()  # start each run with bonus essence
    STARTING_LENGTH  = auto()  # start each run with bonus length
    IDLE_BONUS       = auto()  # passive income × (1 + value × level)
    EPP_MULT         = auto()  # global EPP × (1 + value × level)
    SHED_SCALES_MULT = auto()  # scales earned per shed × (1 + value × level)
    MAX_BPM_BONUS    = auto()  # raise max BPM cap by value × level
    EXTRA_OFFERING   = auto()  # +value upgrade offering slots per level


@dataclass(frozen=True)
class AscensionUpgrade:
    id: str
    name: str
    description: str
    effect: AscensionEffect
    value_per_level: float
    base_cost: int       # Scales cost at level 1
    cost_growth: float   # multiplier per additional level
    max_level: int

    def cost_at_level(self, current_level: int) -> int:
        """Scale cost for the *next* purchase given current_level owned."""
        return int(self.base_cost * (self.cost_growth ** current_level))


ASCENSION_UPGRADES: dict[str, AscensionUpgrade] = {
    # ── Cheap flat passives ───────────────────────────────────────────
    "serpent_memory": AscensionUpgrade(
        id="serpent_memory",
        name="Serpent Memory",
        description="+50 starting Essence per level",
        effect=AscensionEffect.STARTING_ESSENCE,
        value_per_level=50.0,
        base_cost=50_000,
        cost_growth=2.0,
        max_level=10,
    ),
    "ancient_coil": AscensionUpgrade(
        id="ancient_coil",
        name="Ancient Coil",
        description="+10 starting Length per level",
        effect=AscensionEffect.STARTING_LENGTH,
        value_per_level=10.0,
        base_cost=100_000,
        cost_growth=2.5,
        max_level=5,
    ),
    "endless_drift": AscensionUpgrade(
        id="endless_drift",
        name="Endless Drift",
        description="Idle income × (1 + 10% per level)",
        effect=AscensionEffect.IDLE_BONUS,
        value_per_level=0.10,
        base_cost=200_000,
        cost_growth=2.5,
        max_level=5,
    ),
    "serpent_hoard": AscensionUpgrade(
        id="serpent_hoard",
        name="Serpent's Hoard",
        description="+1 upgrade offering slot per level",
        effect=AscensionEffect.EXTRA_OFFERING,
        value_per_level=1.0,
        base_cost=500_000,
        cost_growth=3.0,
        max_level=3,
    ),
    # ── Expensive multiplicative power-spikes ─────────────────────────
    "void_fang": AscensionUpgrade(
        id="void_fang",
        name="Void Fang",
        description="Global EPP × (1 + 50% per level)",
        effect=AscensionEffect.EPP_MULT,
        value_per_level=0.50,
        base_cost=400_000,
        cost_growth=2.5,
        max_level=5,
    ),
    "scale_harvest": AscensionUpgrade(
        id="scale_harvest",
        name="Scale Harvest",
        description="Scales per shed × (1 + 25% per level)",
        effect=AscensionEffect.SHED_SCALES_MULT,
        value_per_level=0.25,
        base_cost=250_000,
        cost_growth=2.5,
        max_level=5,
    ),
    "cosmic_tempo": AscensionUpgrade(
        id="cosmic_tempo",
        name="Cosmic Tempo",
        description="+10 max BPM cap per level",
        effect=AscensionEffect.MAX_BPM_BONUS,
        value_per_level=10.0,
        base_cost=300_000,
        cost_growth=2.5,
        max_level=5,
    ),
}
