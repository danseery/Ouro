"""Archetype definitions — build identities chosen at run start.

Each archetype gives a starting bonus and gates which upgrades appear first
in the offerings pool (biased draw rather than fully exclusive).
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class ArchetypeDef:
    """Definition of a single build archetype."""

    id: str
    name: str
    tagline: str
    description: str
    # Starting upgrade overrides: uid → level granted for free
    starting_upgrades: dict[str, int] = field(default_factory=dict)
    # Upgrade IDs that are weighted 3× more likely to appear in offerings
    preferred_pool: list[str] = field(default_factory=list)
    # Flat multiplier applied to base_essence_per_press
    epp_mult: float = 1.0
    # Flat multiplier applied to idle_income_per_s
    idle_mult: float = 1.0
    # Flat multiplier on timing window (>1 = more forgiving, <1 = tighter)
    timing_mult: float = 1.0
    # Combo multiplier bonus added to every resolved tier value
    combo_tier_bonus: float = 0.0


COILED_STRIKER = ArchetypeDef(
    id="coiled_striker",
    name="Coiled Striker",
    tagline="Strike fast. Strike hard.",
    description=(
        "You live at the beat boundary. Start with Fang Sharpening Lv2. "
        "All combo tiers grant +0.5x bonus, but the timing window is 20% tighter."
    ),
    starting_upgrades={"fang_sharpening": 2},
    preferred_pool=["fang_sharpening", "rattletail", "growth_hormone", "resilient_fangs"],
    epp_mult=1.0,
    idle_mult=0.5,       # active build — idle is penalised
    timing_mult=0.80,    # 20% tighter window
    combo_tier_bonus=0.5,
)

PATIENT_OUROBOROS = ArchetypeDef(
    id="patient_ouroboros",
    name="Patient Ouroboros",
    tagline="The coil tightens while you rest.",
    description=(
        "You grow in silence. Start with Digestive Enzymes Lv2. "
        "Idle income is doubled, but active combo builds half as fast."
    ),
    starting_upgrades={"digestive_enzymes": 2},
    preferred_pool=["digestive_enzymes", "elastic_scales", "hypnotic_eyes", "serpent_instinct"],
    epp_mult=0.8,        # active income slightly penalised
    idle_mult=2.0,       # idle income doubled
    timing_mult=1.0,
    combo_tier_bonus=0.0,
)

RHYTHM_INCARNATE = ArchetypeDef(
    id="rhythm_incarnate",
    name="Rhythm Incarnate",
    tagline="You are the beat.",
    description=(
        "Pure tempo mastery. No starting upgrades, but the perfect window is "
        "40% wider and Venom Rush triggers after only 3 perfect bites instead of 5."
    ),
    starting_upgrades={},
    preferred_pool=["fang_sharpening", "ouroboros_rhythm", "growth_hormone", "venomous_bite"],
    epp_mult=1.0,
    idle_mult=1.0,
    timing_mult=1.0,    # overall window unchanged
    combo_tier_bonus=0.0,
    # Note: perfect_window override and venom_rush_trigger_streak override
    # are handled specially in rhythm.py by checking archetype_id directly.
)


ALL_ARCHETYPES: dict[str, ArchetypeDef] = {
    a.id: a for a in [COILED_STRIKER, PATIENT_OUROBOROS, RHYTHM_INCARNATE]
}
