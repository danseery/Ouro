"""Tests for the economy engine."""

from ouro.engine.game_state import GameState
from ouro.engine.economy import (
    compute_derived,
    handle_press,
    tick_idle,
    get_upgrade_cost,
    purchase_upgrade,
    format_number,
)
from ouro.data.balance import BALANCE


def test_format_number_small():
    assert format_number(0) == "0"
    assert format_number(5) == "5"
    assert format_number(99.5) == "99.5"


def test_format_number_thousands():
    result = format_number(1500)
    assert "K" in result
    assert "1.5" in result


def test_format_number_millions():
    result = format_number(2_300_000)
    assert "M" in result


def test_base_essence_per_press():
    state = GameState()
    compute_derived(state)
    assert state.essence_per_press == BALANCE.economy.base_essence_per_press


def test_handle_press_earns_essence():
    state = GameState()
    compute_derived(state)
    initial = state.essence
    earned = handle_press(state)
    assert earned > 0
    assert state.essence > initial
    assert state.stats.total_presses == 1


def test_idle_income():
    state = GameState()
    compute_derived(state)
    earned = tick_idle(state, 1.0)
    assert earned >= 0  # may be very small


def test_upgrade_cost_scales():
    state = GameState()
    cost1 = get_upgrade_cost(state, "fang_sharpening")
    state.upgrade_levels["fang_sharpening"] = 1
    cost2 = get_upgrade_cost(state, "fang_sharpening")
    assert cost2 > cost1


def test_purchase_upgrade():
    state = GameState()
    state.essence = 10000
    compute_derived(state)
    assert purchase_upgrade(state, "fang_sharpening")
    assert state.upgrade_levels["fang_sharpening"] == 1
    assert state.essence < 10000


def test_purchase_upgrade_insufficient_funds():
    state = GameState()
    state.essence = 0
    compute_derived(state)
    assert not purchase_upgrade(state, "fang_sharpening")
