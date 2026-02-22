"""Run save/load — persists the current run to disk between sessions."""

from __future__ import annotations

import json
import time
from pathlib import Path

from ouro.engine.game_state import GameState, Phase, RunStats

SAVE_DIR = Path.home() / ".ouro"
RUN_FILE = SAVE_DIR / "run.json"


# ── Serialisation helpers ────────────────────────────────────────


def _state_to_dict(state: GameState) -> dict:
    s = state
    return {
        "essence": s.essence,
        "snake_length": s.snake_length,
        "phase": s.phase.name,
        "scales": s.scales,
        "total_scales_earned": s.total_scales_earned,
        "archetype_id": s.archetype_id,
        "curse_id": s.curse_id,
        "combo_hits": s.combo_hits,
        "combo_multiplier": s.combo_multiplier,
        "combo_misses": s.combo_misses,
        "last_press_time": s.last_press_time,
        "beat_origin": s.beat_origin,
        "last_scored_beat_index": s.last_scored_beat_index,
        "last_auto_bite_beat_index": s.last_auto_bite_beat_index,
        "idle_seconds": s.idle_seconds,
        "perfect_streak": s.perfect_streak,
        "venom_rush_active": s.venom_rush_active,
        "venom_rush_end_beat": s.venom_rush_end_beat,
        "mouth_open": s.mouth_open,
        "bite_cooldown_until": s.bite_cooldown_until,
        "last_bite_result": s.last_bite_result,
        "upgrade_levels": dict(s.upgrade_levels),
        "ascension_upgrade_levels": dict(s.ascension_upgrade_levels),
        "current_stage_index": s.current_stage_index,
        "post_frenzy_bpm": s.post_frenzy_bpm,
        "post_frenzy_next_step": s.post_frenzy_next_step,
        "golden_active": s.golden_active,
        "golden_end_time": s.golden_end_time,
        "frenzy_active": s.frenzy_active,
        "frenzy_end_time": s.frenzy_end_time,
        "frenzy_presses": s.frenzy_presses,
        "challenge_active": s.challenge_active,
        "challenge_type": s.challenge_type,
        "challenge_end_time": s.challenge_end_time,
        "challenge_target": s.challenge_target,
        "challenge_progress": s.challenge_progress,
        "current_offerings": list(s.current_offerings),
        "essence_per_press": s.essence_per_press,
        "idle_income_per_s": s.idle_income_per_s,
        "stats": {
            "peak_length": s.stats.peak_length,
            "total_essence_earned": s.stats.total_essence_earned,
            "total_presses": s.stats.total_presses,
            "sheds": s.stats.sheds,
            "combo_high": s.stats.combo_high,
            "golden_caught": s.stats.golden_caught,
            "golden_missed": s.stats.golden_missed,
            "challenges_completed": s.stats.challenges_completed,
            "challenges_failed": s.stats.challenges_failed,
            "run_start_time": s.stats.run_start_time,
        },
    }


def _dict_to_state(d: dict) -> GameState:
    stats_d = d.get("stats", {})
    stats = RunStats(
        peak_length=stats_d.get("peak_length", 0),
        total_essence_earned=stats_d.get("total_essence_earned", 0.0),
        total_presses=stats_d.get("total_presses", 0),
        sheds=stats_d.get("sheds", 0),
        combo_high=stats_d.get("combo_high", 1.0),
        golden_caught=stats_d.get("golden_caught", 0),
        golden_missed=stats_d.get("golden_missed", 0),
        challenges_completed=stats_d.get("challenges_completed", 0),
        challenges_failed=stats_d.get("challenges_failed", 0),
        run_start_time=stats_d.get("run_start_time", time.time()),
    )

    # Re-anchor beat_origin relative to elapsed time so rhythm stays correct
    saved_beat_origin = d.get("beat_origin", time.time())
    now = time.time()
    # If the saved game is very old, just reset beat origin to now
    beat_origin = now if (now - saved_beat_origin) > 3600 else saved_beat_origin

    state = GameState(
        essence=d.get("essence", 0.0),
        snake_length=d.get("snake_length", 3),
        phase=Phase[d.get("phase", "HATCHLING")],
        scales=d.get("scales", 0.0),
        total_scales_earned=d.get("total_scales_earned", 0.0),
        archetype_id=d.get("archetype_id", ""),
        curse_id=d.get("curse_id", ""),
        combo_hits=d.get("combo_hits", 0),
        combo_multiplier=d.get("combo_multiplier", 1.0),
        combo_misses=d.get("combo_misses", 0),
        last_press_time=d.get("last_press_time", 0.0),
        beat_origin=beat_origin,
        last_scored_beat_index=d.get("last_scored_beat_index", -1),
        last_auto_bite_beat_index=d.get("last_auto_bite_beat_index", -1),
        idle_seconds=d.get("idle_seconds", 0.0),
        perfect_streak=d.get("perfect_streak", 0),
        venom_rush_active=d.get("venom_rush_active", False),
        venom_rush_end_beat=d.get("venom_rush_end_beat", -1),
        mouth_open=d.get("mouth_open", True),
        bite_cooldown_until=d.get("bite_cooldown_until", 0.0),
        last_bite_result=d.get("last_bite_result", ""),
        upgrade_levels=d.get("upgrade_levels", {}),
        ascension_upgrade_levels=d.get("ascension_upgrade_levels", {}),
        current_stage_index=d.get("current_stage_index", 0),
        post_frenzy_bpm=d.get("post_frenzy_bpm", 0.0),
        post_frenzy_next_step=d.get("post_frenzy_next_step", 0.0),
        golden_active=d.get("golden_active", False),
        golden_end_time=d.get("golden_end_time", 0.0),
        frenzy_active=d.get("frenzy_active", False),
        frenzy_end_time=d.get("frenzy_end_time", 0.0),
        frenzy_presses=d.get("frenzy_presses", 0),
        challenge_active=d.get("challenge_active", False),
        challenge_type=d.get("challenge_type", ""),
        challenge_end_time=d.get("challenge_end_time", 0.0),
        challenge_target=d.get("challenge_target", 0.0),
        challenge_progress=d.get("challenge_progress", 0.0),
        current_offerings=d.get("current_offerings", []),
        essence_per_press=d.get("essence_per_press", 1.0),
        idle_income_per_s=d.get("idle_income_per_s", 0.0),
        stats=stats,
    )
    return state


# ── Public API ───────────────────────────────────────────────────


def save_run(state: GameState) -> None:
    """Persist the current run to disk."""
    SAVE_DIR.mkdir(parents=True, exist_ok=True)
    try:
        RUN_FILE.write_text(json.dumps(_state_to_dict(state), indent=2))
    except OSError:
        pass  # Non-fatal — just don't save


def load_run() -> GameState | None:
    """Load a saved run from disk.  Returns None if no save exists."""
    if not RUN_FILE.exists():
        return None
    try:
        data = json.loads(RUN_FILE.read_text())
        return _dict_to_state(data)
    except Exception:
        return None  # Corrupt save — start fresh


def delete_run() -> None:
    """Remove the saved run file (call after a clean exit / new run)."""
    try:
        RUN_FILE.unlink(missing_ok=True)
    except OSError:
        pass
