"""Upgrade definitions — all purchasable upgrades and their effects."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum, auto


class UpgradeEffect(Enum):
    """What an upgrade modifies."""

    ESSENCE_PER_PRESS = auto()       # Multiply base essence per keypress
    COMBO_DECAY_SLOW = auto()        # Multiply combo decay time (higher = slower decay)
    IDLE_INCOME_MULT = auto()        # Multiply passive income
    DOUBLE_PRESS_CHANCE = auto()     # Chance of 2x essence on press (0.0-1.0 per level)
    GOLDEN_DURATION_MULT = auto()    # Golden event lasts longer
    UPGRADE_COST_DISCOUNT = auto()   # Reduce upgrade costs (multiplied, <1.0)
    MAX_COMBO_MULT_BONUS = auto()    # Increase max combo tier multiplier
    SHED_SCALE_BONUS = auto()        # Bonus scales on shed
    COSMIC_INCOME_MULT = auto()      # Stage 5+ income multiplier
    COMBO_SAVE_CHANCE = auto()       # % chance a miss doesn't break the combo (0.0–1.0 per level)
    AUTO_BITE_CHANCE = auto()        # % chance per beat of an automatic perfect bite while idle
    MULTI_BITE_CHANCE = auto()       # Each bite chains: chance of 2nd, 3rd, 4th strike (Bernoulli)


@dataclass(frozen=True)
class UpgradeDef:
    """Definition of a single upgrade."""

    id: str
    name: str
    description: str
    effect: UpgradeEffect
    # Value per level (interpretation depends on effect type)
    value_per_level: float
    base_cost: float
    max_level: int = 50
    # Tier: 0 = base pool, 1 = unlocked via meta, 2 = cosmic-only (stage 5+)
    tier: int = 0
    # If True, only offered at stage 5+ (late-game cosmic tier)
    cosmic_only: bool = False


# ── Base upgrade pool (always available) ──────────────────────────

FANG_SHARPENING = UpgradeDef(
    id="fang_sharpening",
    name="Fang Sharpening",
    description="Each press tears deeper. +50% Essence per press per level.",
    effect=UpgradeEffect.ESSENCE_PER_PRESS,
    value_per_level=0.5,
    base_cost=25,
    max_level=100,
)

ELASTIC_SCALES = UpgradeDef(
    id="elastic_scales",
    name="Elastic Scales",
    description="Combo lingers longer. +30% combo decay time per level.",
    effect=UpgradeEffect.COMBO_DECAY_SLOW,
    value_per_level=0.3,
    base_cost=50,
    max_level=100,
)

DIGESTIVE_ENZYMES = UpgradeDef(
    id="digestive_enzymes",
    name="Digestive Enzymes",
    description="Digest even while resting. +50% idle income per level.",
    effect=UpgradeEffect.IDLE_INCOME_MULT,
    value_per_level=0.5,
    base_cost=100,
    max_level=100,
)

RATTLETAIL = UpgradeDef(
    id="rattletail",
    name="Rattletail",
    description="A lucky rattle. +8% chance of double Essence per press per level.",
    effect=UpgradeEffect.DOUBLE_PRESS_CHANCE,
    value_per_level=0.08,
    base_cost=75,
    max_level=10,
)

HYPNOTIC_EYES = UpgradeDef(
    id="hypnotic_eyes",
    name="Hypnotic Eyes",
    description="Golden events linger in your gaze. +25% duration per level.",
    effect=UpgradeEffect.GOLDEN_DURATION_MULT,
    value_per_level=0.25,
    base_cost=150,
    max_level=20,
)

VENOMOUS_BITE = UpgradeDef(
    id="venomous_bite",
    name="Venomous Bite",
    description="Upgrades dissolve easier. -5% upgrade costs per level.",
    effect=UpgradeEffect.UPGRADE_COST_DISCOUNT,
    value_per_level=0.05,
    base_cost=250,
    max_level=11,  # 11 × 5% = 55% = hard cap
)

GROWTH_HORMONE = UpgradeDef(
    id="growth_hormone",
    name="Growth Hormone",
    description="Break through combo ceilings. +1 max combo tier per level.",
    effect=UpgradeEffect.MAX_COMBO_MULT_BONUS,
    value_per_level=1.0,
    base_cost=200,
    max_level=30,
)

RESILIENT_FANGS = UpgradeDef(
    id="resilient_fangs",
    name="Resilient Fangs",
    description="The ouroboros refuses to let go. +15% chance a Chomp doesn't break your combo per level.",
    effect=UpgradeEffect.COMBO_SAVE_CHANCE,
    value_per_level=0.15,
    base_cost=150,
    max_level=6,  # 6 × 15% = 90%, approaching the 95% cap
)

CASCADING_FANGS = UpgradeDef(
    id="cascading_fangs",
    name="Cascading Fangs",
    description="One strike births another. Each bite has a cascading chance to strike again — up to 4 times.",
    effect=UpgradeEffect.MULTI_BITE_CHANCE,
    value_per_level=0.06,   # +6% chain chance per level
    base_cost=300,
    max_level=10,           # 60% max chain — P(double)=60%, triple=36%, quad=22%
)

SERPENT_INSTINCT = UpgradeDef(
    id="serpent_instinct",
    name="Serpent Instinct",
    description="The snake bites by reflex. +10% chance of an automatic perfect bite each beat per level.",
    effect=UpgradeEffect.AUTO_BITE_CHANCE,
    value_per_level=0.10,
    base_cost=250,
    max_level=10,
    tier=1,
)

# ── Meta-unlockable upgrades (tier 1) ────────────────────────────

ANCIENT_WISDOM = UpgradeDef(
    id="ancient_wisdom",
    name="Ancient Wisdom",
    description="Deeper sheds. +1 bonus Scale per shed per level.",
    effect=UpgradeEffect.SHED_SCALE_BONUS,
    value_per_level=1.0,
    base_cost=150,
    max_level=50,
    tier=1,
)

OUROBOROS_RHYTHM = UpgradeDef(
    id="ouroboros_rhythm",
    name="Ouroboros Rhythm",
    description="The eternal pulse. +30% Essence per press, stacks with Fang Sharpening.",
    effect=UpgradeEffect.ESSENCE_PER_PRESS,
    value_per_level=0.3,
    base_cost=200,
    max_level=75,
    tier=1,
)

# ── Cosmic-only upgrades (tier 2) ────────────────────────────────

STELLAR_COILS = UpgradeDef(
    id="stellar_coils",
    name="Stellar Coils",
    description="Stars orbit your coils. +100% cosmic income per level.",
    effect=UpgradeEffect.COSMIC_INCOME_MULT,
    value_per_level=1.0,
    base_cost=1200,
    max_level=100,
    tier=2,
    cosmic_only=True,
)

NEBULA_NESTS = UpgradeDef(
    id="nebula_nests",
    name="Nebula Nests",
    description="Idle galaxies feed you. +100% idle income per level (cosmic).",
    effect=UpgradeEffect.IDLE_INCOME_MULT,
    value_per_level=1.0,
    base_cost=2000,
    max_level=100,
    tier=2,
    cosmic_only=True,
)

VOID_SHRINES = UpgradeDef(
    id="void_shrines",
    name="Void Shrines",
    description="The void echoes your rhythm. +50% Essence per press (cosmic).",
    effect=UpgradeEffect.ESSENCE_PER_PRESS,
    value_per_level=0.5,
    base_cost=2500,
    max_level=100,
    tier=2,
    cosmic_only=True,
)

# ── All upgrades registry ────────────────────────────────────────

ALL_UPGRADES: dict[str, UpgradeDef] = {
    u.id: u
    for u in [
        FANG_SHARPENING,
        ELASTIC_SCALES,
        DIGESTIVE_ENZYMES,
        RATTLETAIL,
        HYPNOTIC_EYES,
        VENOMOUS_BITE,
        GROWTH_HORMONE,
        RESILIENT_FANGS,
        CASCADING_FANGS,
        ANCIENT_WISDOM,
        OUROBOROS_RHYTHM,
        SERPENT_INSTINCT,
        STELLAR_COILS,
        NEBULA_NESTS,
        VOID_SHRINES,
    ]
}

BASE_POOL: list[str] = [uid for uid, u in ALL_UPGRADES.items() if u.tier == 0]
META_POOL: list[str] = [uid for uid, u in ALL_UPGRADES.items() if u.tier == 1]
COSMIC_POOL: list[str] = [uid for uid, u in ALL_UPGRADES.items() if u.tier == 2]
