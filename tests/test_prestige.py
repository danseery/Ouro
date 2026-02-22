"""Tests for the new stage-advance prestige system."""

from ouro.engine.game_state import GameState, Phase
from ouro.engine.prestige import (
    can_shed,
    compute_scales_reward,
    perform_shed,
    can_ascend,
    perform_ascension,
)
from ouro.data.balance import BALANCE


# ── Shed (stage advance) ─────────────────────────────────────────────────────

def test_cannot_shed_at_stage_0_below_threshold():
    """Hatchling can't shed until length >= Snakelet threshold (100)."""
    state = GameState()
    state.snake_length = 50
    assert not can_shed(state)


def test_can_shed_at_snakelet_threshold():
    state = GameState()
    state.snake_length = 100  # Snakelet threshold
    assert can_shed(state)


def test_shed_advances_stage():
    state = GameState()
    state.snake_length = 100
    assert state.current_stage_index == 0

    perform_shed(state)

    assert state.current_stage_index == 1
    assert state.stats.sheds == 1


def test_shed_resets_length_to_50_pct_of_new_threshold():
    """Length should reset to 50% of the new stage threshold."""
    state = GameState()
    state.snake_length = 100  # at stage 0, shed into stage 1 (Snakelet, threshold=100)
    perform_shed(state)
    expected = max(3, 100 // 2)  # 50
    assert state.snake_length == expected


def test_shed_keeps_upgrades():
    """Upgrades are NOT cleared on shed."""
    state = GameState()
    state.snake_length = 100
    state.upgrade_levels["fang_sharpening"] = 3

    perform_shed(state)

    assert state.upgrade_levels.get("fang_sharpening") == 3


def test_shed_awards_scales():
    state = GameState()
    state.snake_length = 100
    scales = perform_shed(state)
    assert scales > 0
    assert state.scales > 0


def test_cannot_shed_at_final_stage():
    """Stage 9 (Cosmic Scale) cannot shed further."""
    state = GameState()
    state.current_stage_index = 9   # final stage
    state.snake_length = 999_999
    assert not can_shed(state)


def test_shed_clears_combo():
    state = GameState()
    state.snake_length = 100
    state.combo_hits = 50
    state.combo_multiplier = 3.0

    perform_shed(state)

    assert state.combo_hits == 0
    assert state.combo_multiplier == 1.0


# ── Ascension ────────────────────────────────────────────────────────────────

def test_cannot_ascend_not_at_final_stage():
    state = GameState()
    state.current_stage_index = 8   # one short
    state.snake_length = 900_000
    assert not can_ascend(state)


def test_cannot_ascend_at_final_stage_below_length():
    state = GameState()
    state.current_stage_index = 9
    state.snake_length = 500_000   # below 900K
    assert not can_ascend(state)


def test_can_ascend_at_final_stage_and_length():
    state = GameState()
    state.current_stage_index = 9
    state.snake_length = 900_000
    assert can_ascend(state)


def test_ascension_resets_stage_and_length():
    state = GameState()
    state.current_stage_index = 9
    state.snake_length = 900_000
    state.scales = 99.0
    state.total_scales_earned = 99.0
    state.upgrade_levels["fang_sharpening"] = 2

    perform_ascension(state)

    assert state.current_stage_index == 0
    assert state.snake_length == 3
    # Scales persist
    assert state.scales == 99.0
    # Upgrades cleared
    assert len(state.upgrade_levels) == 0
    # Phase stays HATCHLING
    assert state.phase == Phase.HATCHLING
