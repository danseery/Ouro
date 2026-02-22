"""Game state — single source of truth for the current run."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum, auto


class Phase(Enum):
    """Which phase of the run the player is in."""

    HATCHLING = auto()    # All normal gameplay (growth stages 0–9)


@dataclass
class RunStats:
    """Tracked metrics for the current run (used for scoring + unlocks)."""

    peak_length: int = 0
    total_essence_earned: float = 0.0
    total_presses: int = 0
    sheds: int = 0
    combo_high: float = 1.0
    golden_caught: int = 0
    golden_missed: int = 0
    challenges_completed: int = 0
    challenges_failed: int = 0
    run_start_time: float = field(default_factory=time.time)

    @property
    def run_duration_s(self) -> float:
        return time.time() - self.run_start_time


@dataclass
class GameState:
    """Complete mutable state for one run."""

    # ── Core resources ───────────────────────────────────
    essence: float = 0.0
    snake_length: int = 3  # starting length (modified by meta)

    # ── Phase & growth stage ─────────────────────────────
    phase: Phase = Phase.HATCHLING
    current_stage_index: int = 0   # 0 = Hatchling … 9 = Cosmic Scale

    # ── Prestige currencies ──────────────────────────────
    scales: float = 0.0           # earned via Shed Skin
    total_scales_earned: float = 0.0  # lifetime (this run) for ascension check
    # ── Archetype (chosen at run start) ──────────────────
    archetype_id: str = ""        # "" = none chosen yet

    # ── Active curse ─────────────────────────────────────
    curse_id: str = ""            # "" = no curse this run

    # ── Combo / Rhythm ───────────────────────────────────
    combo_hits: int = 0
    combo_multiplier: float = 1.0
    combo_misses: int = 0
    last_press_time: float = 0.0
    beat_origin: float = field(default_factory=time.time)
    last_scored_beat_index: int = -1
    last_auto_bite_beat_index: int = -1  # tracks beat auto-bite last fired on
    idle_seconds: float = 0.0            # seconds since last MANUAL press (Idle Escalation)
    perfect_streak: int = 0              # consecutive perfect bites (Venom Rush trigger)
    venom_rush_active: bool = False      # Perfect Streak Venom buff active
    venom_rush_end_beat: int = -1        # beat index when Venom Rush expires

    # Bite / mouth state
    mouth_open: bool = True               # True = ready to bite
    bite_cooldown_until: float = 0.0      # timestamp when mouth reopens
    last_bite_result: str = ""            # "perfect" | "good" | "miss" | ""

    # ── Upgrades: id → current_level ─────────────────────
    upgrade_levels: dict[str, int] = field(default_factory=dict)
    # Ascension (meta) upgrade levels — copied from MetaState at run start
    ascension_upgrade_levels: dict[str, int] = field(default_factory=dict)

    # ── Events ───────────────────────────────────────────
    golden_active: bool = False
    golden_end_time: float = 0.0
    # Feeding Frenzy (triggered by catching the Golden Ouroboros)
    frenzy_active: bool = False
    frenzy_end_time: float = 0.0
    frenzy_presses: int = 0       # presses scored during this frenzy
    challenge_active: bool = False
    challenge_type: str = ""
    challenge_end_time: float = 0.0
    challenge_target: float = 0.0
    challenge_progress: float = 0.0

    # ── Current upgrade offerings (3 at a time) ──────────
    current_offerings: list[str] = field(default_factory=list)

    # ── Stats ────────────────────────────────────────────
    stats: RunStats = field(default_factory=RunStats)

    # ── Derived / caches (recomputed each tick) ──────────
    essence_per_press: float = 1.0
    idle_income_per_s: float = 0.0

    # ── Post-frenzy BPM cooldown ─────────────────────────
    # When > 0, BPM is held at this value and stepped down to natural BPM
    post_frenzy_bpm: float = 0.0       # current override BPM (0 = inactive)
    post_frenzy_next_step: float = 0.0 # timestamp of next step-down

    def record_length(self) -> None:
        """Update peak length stat."""
        if self.snake_length > self.stats.peak_length:
            self.stats.peak_length = self.snake_length
