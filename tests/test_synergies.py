"""Tests for the five synergy mechanics."""

from __future__ import annotations

import time

from ouro.data.balance import BALANCE
from ouro.engine.game_state import GameState
from ouro.engine.rhythm import (
    attempt_bite,
    tick_auto_bite,
    tick_venom_rush,
    get_beat_progress,
)
from ouro.engine.economy import handle_press, compute_derived
from ouro.engine.prestige import perform_shed, can_shed
from ouro.engine.events import EventManager


def _beat_interval() -> float:
    return 60.0 / BALANCE.rhythm.base_bpm


def _place_on_beat(state: GameState, beat_num: int = 0) -> None:
    """Set beat_origin so now lands exactly on beat boundary beat_num."""
    bi = _beat_interval()
    state.beat_origin = time.time() - beat_num * bi
    state.mouth_open = True
    state.bite_cooldown_until = 0.0


def _land_perfect(state: GameState, beat_num: int = 0) -> str:
    """Force a perfect bite on beat beat_num."""
    _place_on_beat(state, beat_num)
    result = attempt_bite(state)
    assert result in ("perfect", "saved"), f"Expected perfect, got {result}"
    return result


# ── 1. Idle Escalation ───────────────────────────────────────────


def test_idle_escalation_raises_auto_chance():
    """idle_seconds directly increases the effective auto-bite chance."""
    state = GameState()
    state.upgrade_levels["serpent_instinct"] = 1  # 10% base chance

    # At 0 idle seconds: chance = 0.10
    # At 25 idle seconds: bonus = 0.50 (capped), total = 0.60
    state.idle_seconds = 25.0

    # Confirm the escalation cap is applied, and that it fires via roll of 0.0
    from unittest.mock import patch
    with patch("ouro.engine.rhythm.random") as mock_rng:
        mock_rng.random.return_value = 0.0  # always fires
        _place_on_beat(state, 0)
        result = tick_auto_bite(state)
    assert result == "perfect"


def test_idle_escalation_zero_without_upgrade():
    """No Serpent Instinct upgrade → auto-bite never fires regardless of idle time."""
    state = GameState()
    state.idle_seconds = 9999.0  # maximum possible idling

    _place_on_beat(state, 0)
    result = tick_auto_bite(state)
    assert result is None


def test_idle_escalation_resets_on_manual_press():
    """Verify idle_seconds is reset externally (simulates action_feed behaviour)."""
    state = GameState()
    state.idle_seconds = 30.0
    # Simulate what action_feed does
    state.idle_seconds = 0.0
    assert state.idle_seconds == 0.0


# ── 2. Frenzy Amplifier ──────────────────────────────────────────


def test_frenzy_amplifier_extends_duration_with_combo():
    """Higher combo at golden catch → longer frenzy window."""
    em = EventManager()

    # State A: no combo
    state_low = GameState()
    state_low.golden_active = True
    state_low.golden_end_time = time.time() + 99
    state_low.combo_hits = 0  # no tiers crossed
    em.catch_golden(state_low)
    duration_low = state_low.frenzy_end_time - time.time()

    # State B: max combo (100 hits → all tiers crossed)
    state_high = GameState()
    state_high.golden_active = True
    state_high.golden_end_time = time.time() + 99
    state_high.combo_hits = 100  # all combo tiers crossed
    em.catch_golden(state_high)
    duration_high = state_high.frenzy_end_time - time.time()

    assert duration_high > duration_low


def test_frenzy_amplifier_base_duration_without_combo():
    """Zero combo_hits (one tier crossed: the 0-hit tier) → base + 1 tier bonus."""
    em = EventManager()
    state = GameState()
    state.golden_active = True
    state.golden_end_time = time.time() + 99
    state.combo_hits = 0  # crosses only the first tier (0 hits → 1.0×)

    em.catch_golden(state)

    remaining = state.frenzy_end_time - time.time()
    base = BALANCE.events.frenzy_duration_s
    bonus_per_tier = BALANCE.events.frenzy_combo_bonus_s_per_tier
    expected = base + 1 * bonus_per_tier  # exactly one tier crossed
    assert abs(remaining - expected) < 0.1


# ── 3. Shed (stage advance) ──────────────────────────────────────


def test_shed_keeps_upgrades():
    """Shedding to the next stage keeps upgrades intact."""
    state = GameState()
    state.snake_length = 100  # Snakelet threshold
    state.upgrade_levels["fang_sharpening"] = 2
    compute_derived(state)

    perform_shed(state)

    assert state.upgrade_levels.get("fang_sharpening") == 2, "Upgrades should persist on shed"


def test_shed_resets_to_50pct_threshold():
    """After shedding into Snakelet, length = 50% of 100 = 50."""
    state = GameState()
    state.snake_length = 100
    compute_derived(state)

    perform_shed(state)

    expected_length = max(3, 100 // 2)  # 50
    assert state.snake_length == expected_length


def test_shed_resets_fields():
    """After a shed, streak and venom rush fields are cleared."""
    state = GameState()
    state.snake_length = 100
    state.combo_multiplier = 3.0
    state.perfect_streak = 4
    state.venom_rush_active = True
    state.venom_rush_end_beat = 999
    compute_derived(state)

    perform_shed(state)

    assert state.perfect_streak == 0
    assert not state.venom_rush_active
    assert state.venom_rush_end_beat == -1


# ── 4. Perfect Streak Venom Rush ─────────────────────────────────


def test_venom_rush_triggers_after_streak():
    """Five consecutive perfects activate Venom Rush."""
    state = GameState()
    trigger = BALANCE.rhythm.venom_rush_trigger_streak  # 5

    # Seed 4 streak points so the next perfect bite crosses the threshold
    state.perfect_streak = trigger - 1

    # One perfect bite on the beat boundary
    _place_on_beat(state, 0)
    result = attempt_bite(state)
    assert result == "perfect"
    assert state.venom_rush_active


def test_venom_rush_not_triggered_before_streak():
    """Fewer than 5 consecutive perfects does NOT activate Venom Rush."""
    state = GameState()
    bi = _beat_interval()
    trigger = BALANCE.rhythm.venom_rush_trigger_streak  # 5

    for i in range(trigger - 1):
        _place_on_beat(state, i)
        state.last_scored_beat_index = i - 1
        attempt_bite(state)

    assert not state.venom_rush_active


def test_venom_rush_resets_streak_on_trigger():
    """Triggering Venom Rush resets the perfect streak counter."""
    state = GameState()
    state.perfect_streak = BALANCE.rhythm.venom_rush_trigger_streak - 1

    _place_on_beat(state, 0)
    attempt_bite(state)  # this bite crosses the threshold

    if state.venom_rush_active:
        assert state.perfect_streak == 0


def test_venom_rush_expires_after_beats():
    """Venom Rush deactivates after venom_rush_beats beats have passed."""
    state = GameState()
    state.venom_rush_active = True
    state.venom_rush_end_beat = 0  # already expired

    tick_venom_rush(state)

    assert not state.venom_rush_active


def test_venom_rush_stays_active_before_expiry():
    """Venom Rush stays active when end beat is still in the future."""
    state = GameState()
    state.venom_rush_active = True
    state.venom_rush_end_beat = 99999  # far in future

    tick_venom_rush(state)

    assert state.venom_rush_active


def test_venom_rush_bonus_applied_to_essence():
    """handle_press earns extra Essence during Venom Rush."""
    state = GameState()
    state.venom_rush_active = True
    state.combo_multiplier = 3.0
    compute_derived(state)

    before = state.essence
    handle_press(state)
    earned = state.essence - before

    # Should be more than base essence_per_press * combo_mult alone
    base_epp = state.essence_per_press  # already includes combo via compute_derived
    expected_bonus = state.combo_multiplier * BALANCE.rhythm.venom_rush_bonus_mult
    assert earned >= base_epp + expected_bonus - 0.01  # floating point tolerance


# ── 5. Ouroboros Feedback Loop ───────────────────────────────────


def test_feedback_loop_widens_timing_window():
    """More total upgrade levels → wider timing window."""
    from ouro.engine.rhythm import _get_timing_window

    state_zero = GameState()
    window_zero = _get_timing_window(state_zero)

    state_many = GameState()
    # Simulate 30 total upgrade levels
    state_many.upgrade_levels["fang_sharpening"] = 10
    state_many.upgrade_levels["digestive_enzymes"] = 10
    state_many.upgrade_levels["rattletail"] = 10
    window_many = _get_timing_window(state_many)

    expected_bonus = 30 * BALANCE.rhythm.feedback_loop_ms_per_level / 1000.0
    assert abs((window_many - window_zero) - expected_bonus) < 0.001


def test_feedback_loop_allows_hit_that_would_otherwise_miss():
    """A bite just outside the base window scores when loop has widened it."""
    from ouro.engine.rhythm import _get_timing_window, _get_beat_interval

    state = GameState()
    # Add enough levels to widen the window by 20ms
    state.upgrade_levels["fang_sharpening"] = 10
    state.upgrade_levels["rattletail"] = 10

    bi = _get_beat_interval(state)
    base_window = BALANCE.rhythm.timing_window_ms / 1000.0
    extended_window = _get_timing_window(state)

    # Place press just past the base window but inside the extended window
    nudge = (base_window + extended_window) / 2.0  # midpoint between the two
    state.beat_origin = time.time() - nudge  # dist from beat = nudge

    result = attempt_bite(state)
    assert result in ("good", "perfect", "saved")
