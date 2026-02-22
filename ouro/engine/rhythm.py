"""Rhythm / combo system — Bite & Release model.

The ouroboros bites its own tail on each beat.  Press Space to BITE (close
the mouth).  The bite is evaluated against the absolute beat clock:

  - Near the beat boundary → PERFECT or GOOD → combo builds
  - Far from the beat       → MISS             → combo penalised

After every bite the mouth LOCKS SHUT for a cooldown period (65 % of the
beat interval).  This is longer than the OS key‑repeat interval (~30 ms)
so holding Space can never trigger a second bite.  The mouth reopens
automatically via ``tick_mouth``, called each game tick.

The beat clock is absolute (anchored at ``state.beat_origin``) and never
re‑anchored by player input, so the "BITE NOW!" window is always honest.
"""

from __future__ import annotations

import random
import time

from ouro.data.archetypes import ALL_ARCHETYPES
from ouro.data.balance import BALANCE
from ouro.data.curses import ALL_CURSES
from ouro.data.upgrades import ALL_UPGRADES, UpgradeEffect
from ouro.engine.game_state import GameState


# ── Helpers ──────────────────────────────────────────────────────


def _get_beat_interval(state: GameState) -> float:
    bpm = get_current_bpm(state)
    return 60.0 / bpm


def _get_timing_window(state: GameState) -> float:
    """Timing window in seconds, widened by Ouroboros Feedback Loop."""
    base_ms = BALANCE.rhythm.timing_window_ms
    total_levels = sum(state.upgrade_levels.values())
    base_ms += total_levels * BALANCE.rhythm.feedback_loop_ms_per_level
    window = base_ms / 1000.0

    # Archetype timing multiplier
    archetype = ALL_ARCHETYPES.get(state.archetype_id)
    if archetype:
        window *= archetype.timing_mult

    # Curse: Twitchy Jaw — bite_cooldown_fraction increased (handled in bite)
    return window


def _get_bite_cooldown_fraction(state: GameState) -> float:
    """Bite cooldown fraction, optionally inflated by the Twitchy Jaw curse."""
    frac = BALANCE.rhythm.bite_cooldown_fraction
    if state.curse_id == "twitchy_jaw":
        frac *= ALL_CURSES["twitchy_jaw"].magnitude
    return min(frac, 0.95)  # never fully lock the mouth


def _get_perfect_window(state: GameState | None = None) -> float:
    """Perfect window, widened for Rhythm Incarnate archetype."""
    ms = BALANCE.rhythm.perfect_window_ms
    if state and state.archetype_id == "rhythm_incarnate":
        ms *= 1.40  # 40% wider perfect window
    return ms / 1000.0


def _resolve_combo_multiplier(state: GameState) -> float:
    tiers = BALANCE.rhythm.combo_tiers
    max_tier_hits = tiers[-1][0]  # hits needed for the top tier
    mult = 1.0
    archetype = ALL_ARCHETYPES.get(state.archetype_id)
    tier_bonus = archetype.combo_tier_bonus if archetype else 0.0

    # Growth Hormone (MAX_COMBO_MULT_BONUS) raises the top-tier multiplier cap
    top_tier_bonus = 0.0
    for uid, level in state.upgrade_levels.items():
        udef = ALL_UPGRADES[uid]
        if udef.effect == UpgradeEffect.MAX_COMBO_MULT_BONUS and level > 0:
            top_tier_bonus += udef.value_per_level * level

    for hits_needed, m in tiers:
        if state.combo_hits >= hits_needed:
            bonus = tier_bonus
            if hits_needed == max_tier_hits:
                bonus += top_tier_bonus
            mult = m + bonus
    return max(mult, 1.0)


def _get_save_chance(state: GameState) -> float:
    """Compute total combo-save chance from upgrades (capped at 0.95)."""
    chance = 0.0
    for uid, level in state.upgrade_levels.items():
        udef = ALL_UPGRADES[uid]
        if udef.effect == UpgradeEffect.COMBO_SAVE_CHANCE and level > 0:
            chance += udef.value_per_level * level
    return min(chance, 0.95)


# ── Public API ───────────────────────────────────────────────────


def attempt_bite(state: GameState) -> str | None:
    """Try to bite.  Returns result string or ``None`` if mouth is locked.

    ``None`` means the press was completely swallowed (held key / cooldown)
    and should produce NO feedback at all — not even "miss".
    """
    now = time.time()

    # ── Feeding Frenzy — bypass all rhythm rules ──────────────────
    if state.frenzy_active:
        # No cooldown, no timing window — every press is a hit.
        state.frenzy_presses += 1
        state.combo_hits += 1
        state.combo_misses = 0
        state.combo_multiplier = _resolve_combo_multiplier(state)
        if state.combo_multiplier > state.stats.combo_high:
            state.stats.combo_high = state.combo_multiplier
        state.last_press_time = now
        # Keep last_scored_beat_index current so decay doesn't fire after frenzy
        beat_interval = _get_beat_interval(state)
        elapsed = now - state.beat_origin
        state.last_scored_beat_index = int(elapsed / beat_interval)
        state.last_bite_result = "perfect"
        # Mouth stays open (no cooldown) so mashing works freely
        return "perfect"

    # Mouth still shut from last bite → swallow input silently
    if not state.mouth_open:
        return None

    # ── Evaluate against absolute beat clock ─────────────────────
    beat_interval = _get_beat_interval(state)
    timing_window = _get_timing_window(state)
    perfect_window = _get_perfect_window(state)

    elapsed = now - state.beat_origin
    beat_pos = elapsed % beat_interval
    current_beat_index = int(elapsed / beat_interval)

    # Distance from nearest beat boundary
    dist = min(beat_pos, beat_interval - beat_pos)

    # ── Lock the mouth shut (cooldown) ─────────────────────────────
    cooldown = beat_interval * _get_bite_cooldown_fraction(state)
    state.mouth_open = False
    state.bite_cooldown_until = now + cooldown
    state.last_press_time = now

    # ── Already scored this beat → miss (double‑tap in same beat) ─
    if current_beat_index == state.last_scored_beat_index:
        if random.random() < _get_save_chance(state):
            state.last_bite_result = "saved"
            return "saved"
        _apply_miss(state)
        state.last_bite_result = "miss"
        return "miss"

    # ── Perfect ──────────────────────────────────────────────────
    if dist <= perfect_window:
        state.last_scored_beat_index = current_beat_index
        state.combo_hits += 2
        state.combo_misses = 0
        state.combo_multiplier = _resolve_combo_multiplier(state)
        if state.combo_multiplier > state.stats.combo_high:
            state.stats.combo_high = state.combo_multiplier
        # Venom Rush — track perfect streak
        # Rhythm Incarnate: triggers after 3 perfects instead of 5
        trigger = (
            3 if state.archetype_id == "rhythm_incarnate"
            else BALANCE.rhythm.venom_rush_trigger_streak
        )
        state.perfect_streak += 1
        if state.perfect_streak >= trigger:
            state.venom_rush_active = True
            state.venom_rush_end_beat = current_beat_index + BALANCE.rhythm.venom_rush_beats
            state.perfect_streak = 0
        state.last_bite_result = "perfect"
        return "perfect"

    # ── Good ─────────────────────────────────────────────────────
    if dist <= timing_window:
        state.last_scored_beat_index = current_beat_index
        state.combo_hits += 1
        state.combo_misses = 0
        state.combo_multiplier = _resolve_combo_multiplier(state)
        if state.combo_multiplier > state.stats.combo_high:
            state.stats.combo_high = state.combo_multiplier
        state.perfect_streak = 0  # good breaks perfect streak
        state.last_bite_result = "good"
        return "good"

    # ── Miss ─────────────────────────────────────────────────────
    state.perfect_streak = 0  # miss breaks perfect streak
    if random.random() < _get_save_chance(state):
        state.last_bite_result = "saved"
        return "saved"
    _apply_miss(state)
    state.last_bite_result = "miss"
    return "miss"


def _apply_miss(state: GameState) -> None:
    state.combo_misses += 1
    # Brittle Scales: tolerance is halved (minimum 1)
    tolerance = BALANCE.rhythm.combo_miss_tolerance
    if state.curse_id == "brittle_scales":
        tolerance = max(1, tolerance // 2)
    if state.combo_misses >= tolerance:
        state.combo_hits = 0
        state.combo_misses = 0
        state.combo_multiplier = 1.0


def tick_mouth(state: GameState) -> None:
    """Reopen the mouth once cooldown expires.  Call every game tick."""
    if not state.mouth_open and time.time() >= state.bite_cooldown_until:
        state.mouth_open = True
        state.last_bite_result = ""


def tick_venom_rush(state: GameState) -> None:
    """Expire Venom Rush once its beat window has passed."""
    if not state.venom_rush_active:
        return
    beat_interval = _get_beat_interval(state)
    elapsed = time.time() - state.beat_origin
    current_beat = int(elapsed / beat_interval)
    if current_beat >= state.venom_rush_end_beat:
        state.venom_rush_active = False


def tick_auto_bite(state: GameState) -> str | None:
    """Fire an automatic perfect bite once per beat based on upgrade chance.

    Only triggers on the first tick of a new beat so it fires at most once
    per beat cycle.  If the mouth is closed (player just bit manually) the
    auto-bite is skipped — manual play always takes priority.

    Returns ``"perfect"`` when a bite fires, ``None`` otherwise.
    """
    if state.frenzy_active:
        return None  # frenzy handles its own scoring

    # Compute chance from upgrades
    chance = 0.0
    for uid, level in state.upgrade_levels.items():
        udef = ALL_UPGRADES[uid]
        if udef.effect == UpgradeEffect.AUTO_BITE_CHANCE and level > 0:
            chance += udef.value_per_level * level
    if chance <= 0.0:
        return None

    # Idle Escalation: auto-bite chance ramps up the longer you go without
    # pressing manually.  Resets to 0 on any manual press in action_feed.
    idle_bonus = min(
        state.idle_seconds * BALANCE.rhythm.idle_escalation_rate,
        BALANCE.rhythm.idle_escalation_cap,
    )
    total_chance = min(chance + idle_bonus, 0.95)

    now = time.time()
    beat_interval = _get_beat_interval(state)
    elapsed = now - state.beat_origin
    current_beat_index = int(elapsed / beat_interval)

    # Only fire once per beat (on the first tick of a new beat)
    if current_beat_index <= state.last_auto_bite_beat_index:
        return None

    state.last_auto_bite_beat_index = current_beat_index

    # Roll the chance
    if random.random() >= total_chance:
        return None

    # Mouth closed (manual bite in progress) — skip this beat gracefully
    if not state.mouth_open:
        return None

    # Fire a perfect auto-bite
    cooldown = beat_interval * BALANCE.rhythm.bite_cooldown_fraction
    state.mouth_open = False
    state.bite_cooldown_until = now + cooldown
    state.last_press_time = now
    state.last_scored_beat_index = current_beat_index
    state.combo_hits += 2
    state.combo_misses = 0
    state.combo_multiplier = _resolve_combo_multiplier(state)
    if state.combo_multiplier > state.stats.combo_high:
        state.stats.combo_high = state.combo_multiplier
    state.last_bite_result = "perfect"
    return "perfect"


def tick_combo_decay(state: GameState) -> None:
    """Reset combo if too many beats pass without a scored hit."""
    if state.combo_hits == 0 or state.frenzy_active:
        return

    beat_interval = _get_beat_interval(state)
    elapsed = time.time() - state.beat_origin
    current_beat_index = int(elapsed / beat_interval)
    missed = current_beat_index - state.last_scored_beat_index

    # Elastic Scales (COMBO_DECAY_SLOW): multiply the beat tolerance
    tolerance = BALANCE.rhythm.combo_miss_tolerance
    for uid, level in state.upgrade_levels.items():
        udef = ALL_UPGRADES[uid]
        if udef.effect == UpgradeEffect.COMBO_DECAY_SLOW and level > 0:
            tolerance = round(tolerance * (1.0 + udef.value_per_level * level))

    if missed >= tolerance:
        state.combo_hits = 0
        state.combo_misses = 0
        state.combo_multiplier = 1.0


def get_current_bpm(state: GameState) -> float:
    bal = BALANCE.rhythm
    milestones = state.snake_length // bal.bpm_milestone_length
    raw_bpm = min(bal.base_bpm + milestones * bal.bpm_per_milestone, bal.max_bpm)
    snapped = (int(raw_bpm) // 10) * 10
    natural = float(max(int(bal.base_bpm), min(snapped, int(bal.max_bpm))))
    # Post-frenzy override: use elevated BPM if still cooling down
    if state.post_frenzy_bpm > natural:
        return state.post_frenzy_bpm
    return natural


def tick_post_frenzy_bpm(state: GameState) -> None:
    """Step the post-frenzy BPM down toward natural BPM every 5 seconds."""
    if state.post_frenzy_bpm <= 0.0:
        return
    now = time.time()
    if now < state.post_frenzy_next_step:
        return
    bal = BALANCE.rhythm
    milestones = state.snake_length // bal.bpm_milestone_length
    raw = min(bal.base_bpm + milestones * bal.bpm_per_milestone, bal.max_bpm)
    snapped = (int(raw) // 10) * 10
    natural = float(max(int(bal.base_bpm), min(snapped, int(bal.max_bpm))))
    # Step down one interval (10 BPM)
    state.post_frenzy_bpm = max(state.post_frenzy_bpm - 10.0, natural)
    if state.post_frenzy_bpm <= natural:
        state.post_frenzy_bpm = 0.0  # deactivate override
    else:
        state.post_frenzy_next_step = now + 5.0  # next step in 5s


def get_beat_progress(state: GameState) -> float:
    """Current position within the beat cycle (0.0–1.0), absolute clock."""
    beat_interval = _get_beat_interval(state)
    elapsed = time.time() - state.beat_origin
    return (elapsed % beat_interval) / beat_interval


def get_beat_dist_frac(state: GameState) -> float:
    """Fractional distance to the nearest beat boundary (0.0 = on beat)."""
    prog = get_beat_progress(state)
    return min(prog, 1.0 - prog)


def get_timing_window_s(state: GameState) -> float:
    """Current GOOD timing window in seconds, matching bite scoring logic."""
    return _get_timing_window(state)


def get_perfect_window_s(state: GameState) -> float:
    """Current PERFECT timing window in seconds, matching bite scoring logic."""
    return _get_perfect_window(state)


def get_bite_cooldown_s(state: GameState) -> float:
    """Mouth cooldown duration in seconds after a bite."""
    return _get_beat_interval(state) * _get_bite_cooldown_fraction(state)


def apply_bite_result(state: GameState, result: str) -> str:
    """Apply a pre-evaluated bite result from the client.

    Mirrors the state mutations in ``attempt_bite`` but skips timing
    re-evaluation — the client is authoritative about perfect/good/miss.
    Returns the (possibly saved) result string.
    """
    import random as _random

    now = time.time()
    beat_interval = _get_beat_interval(state)
    elapsed = now - state.beat_origin
    current_beat_index = int(elapsed / beat_interval)

    # Lock the mouth (same cooldown as server-side)
    cooldown = beat_interval * _get_bite_cooldown_fraction(state)
    state.mouth_open = False
    state.bite_cooldown_until = now + cooldown
    state.last_press_time = now

    if state.frenzy_active:
        # Frenzy always scores perfect regardless of client result
        state.frenzy_presses += 1
        state.combo_hits += 1
        state.combo_misses = 0
        state.combo_multiplier = _resolve_combo_multiplier(state)
        if state.combo_multiplier > state.stats.combo_high:
            state.stats.combo_high = state.combo_multiplier
        state.last_scored_beat_index = current_beat_index
        state.last_bite_result = "perfect"
        return "perfect"

    if result == "perfect":
        state.last_scored_beat_index = current_beat_index
        state.combo_hits += 2
        state.combo_misses = 0
        state.combo_multiplier = _resolve_combo_multiplier(state)
        if state.combo_multiplier > state.stats.combo_high:
            state.stats.combo_high = state.combo_multiplier
        trigger = (
            3 if state.archetype_id == "rhythm_incarnate"
            else BALANCE.rhythm.venom_rush_trigger_streak
        )
        state.perfect_streak += 1
        if state.perfect_streak >= trigger:
            state.venom_rush_active = True
            state.venom_rush_end_beat = current_beat_index + BALANCE.rhythm.venom_rush_beats
            state.perfect_streak = 0
        state.last_bite_result = "perfect"
        return "perfect"

    if result == "good":
        state.last_scored_beat_index = current_beat_index
        state.combo_hits += 1
        state.combo_misses = 0
        state.combo_multiplier = _resolve_combo_multiplier(state)
        if state.combo_multiplier > state.stats.combo_high:
            state.stats.combo_high = state.combo_multiplier
        state.perfect_streak = 0
        state.last_bite_result = "good"
        return "good"

    # miss — apply combo penalty, but still allow save-chance upgrade to trigger
    state.perfect_streak = 0
    if _random.random() < _get_save_chance(state):
        state.last_bite_result = "saved"
        return "saved"
    _apply_miss(state)
    state.last_bite_result = "miss"
    return "miss"

