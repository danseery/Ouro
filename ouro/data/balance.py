"""Balance constants — all tuning knobs in one place.

Tweak these to adjust game feel, pacing, and difficulty curves.
All costs follow: base_cost * (growth_rate ^ times_purchased)
"""

from dataclasses import dataclass, field


@dataclass(frozen=True)
class RhythmBalance:
    """Tuning for the rhythm / combo system."""

    # Tempo: beats per minute at run start
    base_bpm: float = 60.0
    # Snake length per milestone (one milestone = +bpm_per_milestone)
    bpm_milestone_length: int = 15_000
    # BPM increase per milestone
    bpm_per_milestone: float = 1.0
    max_bpm: float = 120.0

    # Timing window: how many ms off-beat is still "on rhythm"
    timing_window_ms: float = 140.0
    # Perfect hit window (inner)
    perfect_window_ms: float = 55.0

    # Bite cooldown: fraction of beat_interval that the mouth stays locked
    # after a press.  Must be > OS key‑repeat interval (~30 ms) to block
    # held‑key spam, but < 1.0 so skilled tapping can hit every beat.
    bite_cooldown_fraction: float = 0.65

    # Ouroboros Feedback Loop: each total upgrade level widens the timing window
    feedback_loop_ms_per_level: float = 1.0

    # Perfect Streak Venom Rush
    venom_rush_trigger_streak: int = 5       # consecutive perfects needed
    venom_rush_beats: int = 3                # how many beats the rush lasts
    venom_rush_bonus_mult: float = 2.0       # extra Essence = combo_mult * this

    # Idle Escalation (Serpent Instinct bonus while not pressing manually)
    idle_escalation_rate: float = 0.02       # bonus auto-bite chance per idle second
    idle_escalation_cap: float = 0.50        # maximum bonus from idling

    # Combo multiplier tiers: [hits_needed, multiplier]
    combo_tiers: tuple[tuple[int, float], ...] = (
        (0, 1.0),
        (5, 1.5),
        (15, 2.0),
        (30, 3.0),
        (60, 5.0),
        (100, 8.0),
    )
    # How many full beats can be missed before combo resets
    combo_miss_tolerance: int = 2


@dataclass(frozen=True)
class EconomyBalance:
    """Tuning for Essence generation and spending."""

    # Base Essence per keypress (before combo / upgrades)
    base_essence_per_press: float = 1.0

    # Snake length gained per N essence (visual growth rate)
    essence_per_length: float = 10.0

    # Idle income: fraction of active income generated passively
    base_idle_fraction: float = 0.02

    # Upgrade cost scaling: cost = base * (growth ^ level)
    upgrade_cost_growth: float = 1.40

    # Large number formatting thresholds
    suffixes: tuple[tuple[float, str], ...] = (
        (1e3, "K"),
        (1e6, "M"),
        (1e9, "B"),
        (1e12, "T"),
        (1e15, "Qa"),
        (1e18, "Qi"),
    )


@dataclass(frozen=True)
class PrestigeBalance:
    """Tuning for Shed Skin and Ascension."""

    # Shed Skin
    # (shed threshold is implicit: shed when snake_length >= next stage threshold)
    # Scales earned = floor(sqrt(length_at_shed))
    # Scales multiplier: 1 + (total_scales * scale_multiplier_per)
    scale_multiplier_per: float = 0.1

    # Growth stages: (min_length, display_name) — early-fast, late-slow curve
    # Applied to any phase; the name updates as snake_length grows.
    growth_stages: tuple[tuple[int, str], ...] = (
        (0,       "Hatchling"),          # Stage 1  — newborn
        (100,     "Snakelet"),           # Stage 2  — first shed threshold
        (500,     "Local Predator"),     # Stage 3  — small-territory predator
        (2_000,   "Regional Devourer"),  # Stage 4  — claims a region
        (10_000,  "National Constrictor"), # Stage 5 — nation-sized coil
        (50_000,  "Continental Coil"),   # Stage 6  — continent-spanning serpent
        (150_000, "Global Serpent"),     # Stage 7  — wraps the world
        (350_000, "Stellar Devourer"),   # Stage 8  — swallows stars
        (650_000, "Galactic Ouroboros"), # Stage 9  — spiral of galaxies
        (900_000, "Cosmic Scale"),       # Stage 10 — apex, ascension available
    )


@dataclass(frozen=True)
class EventBalance:
    """Tuning for Golden Ouroboros, Timed Challenges, and Serpent's Bargain."""

    # Golden Ouroboros
    golden_min_interval_s: float = 45.0
    golden_max_interval_s: float = 120.0
    golden_duration_s: float = 8.0
    golden_reward_multiplier: float = 20.0  # times current per-second rate
    # Feeding Frenzy duration (triggered on catch)
    frenzy_duration_s: float = 8.0
    # Frenzy Amplifier: each combo multiplier tier adds bonus frenzy seconds
    frenzy_combo_bonus_s_per_tier: float = 0.5

    # Timed Challenges
    challenge_min_interval_s: float = 120.0
    challenge_max_interval_s: float = 240.0
    challenge_duration_s: float = 10.0

    # Serpent's Bargain (new mid-run event)
    bargain_min_interval_s: float = 90.0
    bargain_max_interval_s: float = 180.0
    bargain_duration_s: float = 12.0        # window to accept/decline
    bargain_cost_fraction: float = 0.30     # fraction of current essence spent


    # Ancient Echo (free upgrade offer)
    echo_min_interval_s: float = 200.0
    echo_max_interval_s: float = 350.0
    echo_duration_s: float = 30.0          # seconds to claim before it vanishes


@dataclass(frozen=True)
class MetaBalance:
    """Tuning for Hades-style meta-progression."""

    # Serpent Knowledge earned per run = floor(log2(peak_length)) + sheds

    # Meta-upgrade costs (Serpent Knowledge)
    starting_length_cost: int = 3
    starting_length_bonus: int = 1  # added per purchase
    starting_length_max_purchases: int = 10

    new_upgrade_unlock_cost: int = 5


@dataclass(frozen=True)
class GameBalance:
    """Top-level container for all balance constants."""

    rhythm: RhythmBalance = field(default_factory=RhythmBalance)
    economy: EconomyBalance = field(default_factory=EconomyBalance)
    prestige: PrestigeBalance = field(default_factory=PrestigeBalance)
    events: EventBalance = field(default_factory=EventBalance)
    meta: MetaBalance = field(default_factory=MetaBalance)

    # Run timing
    tick_rate_hz: float = 30.0  # game loop ticks per second


# Singleton — import this everywhere
BALANCE = GameBalance()
