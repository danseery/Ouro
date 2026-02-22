"""Meta-progression — Hades-style persistence across runs."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path

from ouro.data.balance import BALANCE
from ouro.engine.game_state import GameState, RunStats


META_DIR = Path.home() / ".ouro"
META_FILE = META_DIR / "meta.json"


@dataclass
class MetaState:
    """Persistent state across runs."""

    # Currency
    serpent_knowledge: int = 0

    # Upgrades purchased
    starting_length_bonus: int = 0     # extra starting length
    unlocked_upgrade_ids: list[str] = field(default_factory=list)
    unlocked_event_types: list[str] = field(default_factory=list)

    # Ascension
    ascension_count: int = 0
    ascension_upgrade_levels: dict[str, int] = field(default_factory=dict)

    # Collections
    unlocked_skins: list[str] = field(default_factory=lambda: ["emerald"])
    collected_lore_ids: list[int] = field(default_factory=list)
    active_skin: str = "emerald"

    # Lifetime stats
    total_runs: int = 0
    best_peak_length: int = 0
    best_total_essence: float = 0.0
    total_golden_caught: int = 0
    total_challenges_completed: int = 0

    def get_starting_length(self) -> int:
        """Get starting snake length with meta bonus."""
        base = 3
        bonus = self.starting_length_bonus * BALANCE.meta.starting_length_bonus
        return base + bonus

    def get_unlocked_upgrade_set(self) -> set[str]:
        """Get set of meta-unlocked upgrade IDs."""
        return set(self.unlocked_upgrade_ids)

    def apply_ascension_starting_bonuses(self, state: GameState) -> None:
        """Apply permanent ascension upgrade effects to a freshly created run state."""
        from ouro.data.ascension_upgrades import ASCENSION_UPGRADES, AscensionEffect
        from ouro.data.balance import BALANCE

        # Copy upgrade levels into the run state so compute_derived can read them
        state.ascension_upgrade_levels = dict(self.ascension_upgrade_levels)

        for uid, level in self.ascension_upgrade_levels.items():
            if level <= 0:
                continue
            udef = ASCENSION_UPGRADES.get(uid)
            if udef is None:
                continue
            if udef.effect == AscensionEffect.STARTING_ESSENCE:
                state.essence += udef.value_per_level * level
            elif udef.effect == AscensionEffect.STARTING_LENGTH:
                bonus = int(udef.value_per_level * level)
                state.snake_length = max(state.snake_length, 3) + bonus
                # Sync essence to reflect the bonus length
                state.essence = max(state.essence, state.snake_length * BALANCE.economy.essence_per_length)


def compute_knowledge_reward(stats: RunStats) -> int:
    """Calculate Serpent Knowledge earned from a run's stats."""
    if stats.peak_length <= 0:
        return 0

    base = max(1, int(math.log2(max(1, stats.peak_length))))
    base += stats.sheds
    return base


def apply_run_results(meta: MetaState, stats: RunStats) -> int:
    """Apply a completed run's results to meta state. Returns knowledge earned."""
    knowledge = compute_knowledge_reward(stats)
    meta.serpent_knowledge += knowledge
    meta.total_runs += 1

    # Update best stats
    if stats.peak_length > meta.best_peak_length:
        meta.best_peak_length = stats.peak_length
    if stats.total_essence_earned > meta.best_total_essence:
        meta.best_total_essence = stats.total_essence_earned
    meta.total_golden_caught += stats.golden_caught
    meta.total_challenges_completed += stats.challenges_completed

    return knowledge


def save_meta(meta: MetaState) -> None:
    """Save meta state to disk."""
    META_DIR.mkdir(parents=True, exist_ok=True)
    data = {
        "serpent_knowledge": meta.serpent_knowledge,
        "starting_length_bonus": meta.starting_length_bonus,
        "unlocked_upgrade_ids": meta.unlocked_upgrade_ids,
        "unlocked_event_types": meta.unlocked_event_types,
        "ascension_count": meta.ascension_count,
        "ascension_upgrade_levels": meta.ascension_upgrade_levels,
        "unlocked_skins": meta.unlocked_skins,
        "collected_lore_ids": meta.collected_lore_ids,
        "active_skin": meta.active_skin,
        "total_runs": meta.total_runs,
        "best_peak_length": meta.best_peak_length,
        "best_total_essence": meta.best_total_essence,
        "total_golden_caught": meta.total_golden_caught,
        "total_challenges_completed": meta.total_challenges_completed,
    }
    META_FILE.write_text(json.dumps(data, indent=2))


def load_meta() -> MetaState:
    """Load meta state from disk, or return fresh state if none exists."""
    if not META_FILE.exists():
        return MetaState()

    try:
        data = json.loads(META_FILE.read_text())
        return MetaState(
            serpent_knowledge=data.get("serpent_knowledge", 0),
            starting_length_bonus=data.get("starting_length_bonus", 0),
            unlocked_upgrade_ids=data.get("unlocked_upgrade_ids", []),
            unlocked_event_types=data.get("unlocked_event_types", []),
            ascension_count=data.get("ascension_count", 0),
            ascension_upgrade_levels=data.get("ascension_upgrade_levels", {}),
            unlocked_skins=data.get("unlocked_skins", ["emerald"]),
            collected_lore_ids=data.get("collected_lore_ids", []),
            active_skin=data.get("active_skin", "emerald"),
            total_runs=data.get("total_runs", 0),
            best_peak_length=data.get("best_peak_length", 0),
            best_total_essence=data.get("best_total_essence", 0.0),
            total_golden_caught=data.get("total_golden_caught", 0),
            total_challenges_completed=data.get("total_challenges_completed", 0),
        )
    except (json.JSONDecodeError, KeyError):
        return MetaState()
