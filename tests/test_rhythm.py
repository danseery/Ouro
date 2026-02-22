"""Tests for the rhythm / combo system — Bite model."""

import time
from unittest.mock import patch

from ouro.data.balance import BALANCE
from ouro.engine.game_state import GameState
from ouro.engine.rhythm import attempt_bite, tick_mouth, tick_combo_decay


def _beat_interval():
    return 60.0 / BALANCE.rhythm.base_bpm


def test_bite_on_beat_scores():
    """Bite immediately after beat_origin → on the beat boundary → perfect or good."""
    state = GameState()
    result = attempt_bite(state)
    assert result in ("perfect", "good")
    assert state.combo_hits >= 1


def test_bite_locks_mouth():
    """After a bite, mouth is locked and subsequent presses return None."""
    state = GameState()
    result = attempt_bite(state)
    assert result is not None
    assert not state.mouth_open

    # Second press while mouth locked → None (swallowed)
    result2 = attempt_bite(state)
    assert result2 is None


def test_tick_mouth_reopens():
    """tick_mouth reopens the mouth after cooldown expires."""
    state = GameState()
    attempt_bite(state)
    assert not state.mouth_open

    # Force cooldown to be in the past
    state.bite_cooldown_until = time.time() - 0.1
    tick_mouth(state)
    assert state.mouth_open


def test_held_key_blocked():
    """Rapid presses (simulating held key) only score once per bite cycle."""
    state = GameState()
    results = []
    for _ in range(20):
        results.append(attempt_bite(state))

    # Only the first should be a real result, rest should be None
    real = [r for r in results if r is not None]
    assert len(real) == 1


def test_combo_builds_across_bites():
    """Multiple well-timed bites across beat cycles build combo."""
    state = GameState()
    bi = _beat_interval()

    for i in range(5):
        # Simulate being at beat boundary by setting beat_origin so now is on a beat
        state.beat_origin = time.time() - (i * bi)
        state.mouth_open = True
        state.bite_cooldown_until = 0.0
        result = attempt_bite(state)
        assert result in ("perfect", "good"), f"Bite {i} was {result}"

    assert state.combo_hits >= 5


def test_combo_decay():
    """Combo resets if too many beats pass without a scored hit."""
    state = GameState()
    state.combo_hits = 10
    state.combo_multiplier = 3.0
    state.beat_origin = time.time() - 100  # many beats ago
    state.last_scored_beat_index = 0       # last scored on beat 0

    tick_combo_decay(state)

    assert state.combo_hits == 0
    assert state.combo_multiplier == 1.0


def test_combo_no_decay_when_recent():
    """Combo stays intact when last scored beat is current."""
    state = GameState()
    state.combo_hits = 10
    state.combo_multiplier = 3.0
    bi = _beat_interval()
    elapsed = time.time() - state.beat_origin
    state.last_scored_beat_index = int(elapsed / bi)

    tick_combo_decay(state)

    assert state.combo_hits == 10  # unchanged


def test_miss_in_grey_zone():
    """Pressing in the grey zone (far from beat) returns miss."""
    state = GameState()
    bi = _beat_interval()
    # Place beat_origin so that we're exactly mid-beat (0.5 through the cycle)
    state.beat_origin = time.time() - (bi * 0.5)

    result = attempt_bite(state)
    assert result == "miss"


def test_mouth_state_after_miss():
    """Even a miss locks the mouth (cooldown applies to all bites)."""
    state = GameState()
    bi = _beat_interval()
    state.beat_origin = time.time() - (bi * 0.5)

    attempt_bite(state)
    assert not state.mouth_open


def test_double_tap_same_beat():
    """Two bites in the same beat: first scores, second after cooldown is miss."""
    state = GameState()
    # First bite — on beat
    r1 = attempt_bite(state)
    assert r1 in ("perfect", "good")
    beat_idx = state.last_scored_beat_index

    # Force mouth open (as if cooldown passed) but still same beat
    state.mouth_open = True
    state.bite_cooldown_until = 0.0

    r2 = attempt_bite(state)
    # Should be "miss" because same beat index was already scored
    assert r2 == "miss"
