"""Prestige systems — Shed Skin (stage advance) and Ascension (full meta-reset)."""

from __future__ import annotations

import math
import time

from ouro.data.balance import BALANCE
from ouro.data.curses import ALL_CURSES
from ouro.data.upgrades import ALL_UPGRADES, UpgradeEffect
from ouro.engine.game_state import GameState, RunStats


def can_shed(state: GameState) -> bool:
    """True if not at the final stage and length has reached the next stage threshold."""
    stages = BALANCE.prestige.growth_stages
    next_index = state.current_stage_index + 1
    if next_index >= len(stages):
        return False
    return state.snake_length >= stages[next_index][0]


def compute_scales_reward(state: GameState) -> float:
    """Calculate how many Scales a shed would yield at current length."""
    from ouro.data.ascension_upgrades import ASCENSION_UPGRADES, AscensionEffect
    base = math.floor(math.sqrt(state.snake_length))

    # Apply Shed Scale Bonus run upgrades
    bonus = 0.0
    for uid, level in state.upgrade_levels.items():
        udef = ALL_UPGRADES[uid]
        if udef.effect == UpgradeEffect.SHED_SCALE_BONUS and level > 0:
            bonus += udef.value_per_level * level
    base = base + bonus

    # Ascension: Scale Harvest multiplier
    for uid, level in state.ascension_upgrade_levels.items():
        udef = ASCENSION_UPGRADES.get(uid)
        if udef and udef.effect == AscensionEffect.SHED_SCALES_MULT and level > 0:
            base *= 1.0 + udef.value_per_level * level

    # Curse: Shedless Skin — first shed only gives 40% scales
    if state.curse_id == "shedless_skin" and state.stats.sheds == 0:
        base = base * ALL_CURSES["shedless_skin"].magnitude

    return base


def perform_shed(state: GameState) -> float:
    """Advance to next growth stage. Length resets to 50% of new stage threshold.

    Upgrades are *kept* — this is a stage advance, not a full reset.
    Returns Scales earned.
    """
    if not can_shed(state):
        return 0.0

    scales_earned = compute_scales_reward(state)

    # Advance stage
    state.current_stage_index += 1
    new_threshold = BALANCE.prestige.growth_stages[state.current_stage_index][0]

    # Length resets to 50% of new stage's min threshold
    new_length = max(3, new_threshold // 2)
    new_essence = new_length * BALANCE.economy.essence_per_length

    # Apply scales
    state.scales += scales_earned
    state.total_scales_earned += scales_earned

    # Reset length / essence
    state.snake_length = new_length
    state.essence = new_essence

    # Reset rhythm / combat — upgrades intentionally NOT cleared
    state.combo_hits = 0
    state.combo_misses = 0
    state.combo_multiplier = 1.0
    state.last_press_time = 0.0
    state.last_scored_beat_index = -1
    state.last_auto_bite_beat_index = -1
    state.idle_seconds = 0.0
    state.perfect_streak = 0
    state.venom_rush_active = False
    state.venom_rush_end_beat = -1
    state.mouth_open = True
    state.bite_cooldown_until = 0.0
    state.last_bite_result = ""
    state.frenzy_active = False
    state.frenzy_end_time = 0.0
    state.frenzy_presses = 0
    state.current_offerings.clear()
    state.beat_origin = time.time()
    state.post_frenzy_bpm = 0.0
    state.post_frenzy_next_step = 0.0

    state.stats.sheds += 1

    return scales_earned


def can_ascend(state: GameState) -> bool:
    """True when at the final growth stage and length has reached its threshold."""
    stages = BALANCE.prestige.growth_stages
    final_index = len(stages) - 1
    if state.current_stage_index != final_index:
        return False
    return state.snake_length >= stages[final_index][0]


def perform_ascension(state: GameState) -> None:
    """Full run reset — Scales persist, everything else clears.

    Call this after the player has spent Scales in the Ascension screen.
    The caller (app.py) is responsible for applying meta bonuses to the
    fresh state and incrementing meta.ascension_count.
    """
    # Scales persist across Ascension
    kept_scales = state.scales
    kept_total_scales = state.total_scales_earned
    kept_ascension_levels = dict(state.ascension_upgrade_levels)

    # Full reset
    state.essence = 0.0
    state.snake_length = 3
    state.current_stage_index = 0
    state.scales = kept_scales
    state.total_scales_earned = kept_total_scales
    state.ascension_upgrade_levels = kept_ascension_levels
    state.combo_hits = 0
    state.combo_misses = 0
    state.combo_multiplier = 1.0
    state.last_press_time = 0.0
    state.last_scored_beat_index = -1
    state.last_auto_bite_beat_index = -1
    state.idle_seconds = 0.0
    state.perfect_streak = 0
    state.venom_rush_active = False
    state.venom_rush_end_beat = -1
    state.mouth_open = True
    state.bite_cooldown_until = 0.0
    state.last_bite_result = ""
    state.frenzy_active = False
    state.frenzy_end_time = 0.0
    state.frenzy_presses = 0
    state.post_frenzy_bpm = 0.0
    state.post_frenzy_next_step = 0.0
    state.upgrade_levels.clear()
    state.current_offerings.clear()
    state.beat_origin = time.time()
    state.stats = RunStats()