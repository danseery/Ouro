"""Ouro Web — Flask server that wraps the Python game engine.

Serves a single-page game UI and exposes a JSON API for game actions.
The game loop ticks are driven lazily: each API request catches up on
elapsed time before returning the current state.
"""

from __future__ import annotations

import json
import random
import threading
import time
from pathlib import Path

from flask import Flask, jsonify, render_template, request

from ouro.data.archetypes import ALL_ARCHETYPES
from ouro.data.ascension_upgrades import ASCENSION_UPGRADES
from ouro.data.balance import BALANCE
from ouro.data.curses import ALL_CURSES, roll_curse
from ouro.data.upgrades import ALL_UPGRADES
from ouro.engine.economy import (
    can_afford_upgrade,
    compute_derived,
    format_number,
    get_upgrade_cost,
    handle_press,
    purchase_upgrade,
    tick_idle,
)
from ouro.engine.events import EventManager
from ouro.engine.game_state import GameState
from ouro.engine.meta import (
    MetaState,
    apply_run_results,
    load_meta,
    save_meta,
)
from ouro.engine.prestige import (
    can_ascend,
    can_shed,
    compute_scales_reward,
    perform_ascension,
    perform_shed,
)
from ouro.engine.procedural import refresh_offerings
from ouro.engine.rhythm import (
    apply_bite_result,
    attempt_bite,
    get_beat_progress,
    get_bite_cooldown_s,
    get_current_bpm,
    get_perfect_window_s,
    get_timing_window_s,
    tick_auto_bite,
    tick_combo_decay,
    tick_mouth,
    tick_post_frenzy_bpm,
    tick_venom_rush,
)
from ouro.engine.save import delete_run, load_run, save_run

# ---------------------------------------------------------------------------
# Flask app
# ---------------------------------------------------------------------------

_DIR = Path(__file__).parent
app = Flask(
    __name__,
    template_folder=str(_DIR / "templates"),
    static_folder=str(_DIR / "static"),
)
app.secret_key = "ouro-web-secret"

# Disable static file caching during development
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0
app.config["TEMPLATES_AUTO_RELOAD"] = True

# ---------------------------------------------------------------------------
# In-memory game session (single-player)
# ---------------------------------------------------------------------------

_lock = threading.Lock()
_state: GameState | None = None
_meta: MetaState | None = None
_events: EventManager | None = None
_last_tick: float = 0.0
_last_autosave: float = 0.0
_pending_notifications: list[str] = []
_press_timestamps: list[float] = []


def _ensure_game() -> None:
    """Initialise the game if not yet started."""
    global _state, _meta, _events, _last_tick, _last_autosave
    if _state is not None:
        return
    _meta = load_meta()
    saved = load_run()
    if saved is not None:
        _state = saved
    else:
        _state = _new_run_state()
    _events = EventManager()
    _last_tick = time.time()
    _last_autosave = time.time()
    if not _state.current_offerings:
        refresh_offerings(_state, _meta.get_unlocked_upgrade_set())
    compute_derived(_state)


def _new_run_state() -> GameState:
    assert _meta is not None
    archetype = random.choice(list(ALL_ARCHETYPES.values()))
    curse_id = roll_curse()
    state = GameState(
        snake_length=_meta.get_starting_length(),
        archetype_id=archetype.id,
        curse_id=curse_id,
    )
    for uid, level in archetype.starting_upgrades.items():
        state.upgrade_levels[uid] = level
    _meta.apply_ascension_starting_bonuses(state)
    compute_derived(state)
    return state


def _do_ticks() -> None:
    """Catch up game ticks since the last call."""
    assert _state is not None and _meta is not None and _events is not None
    global _last_tick, _last_autosave
    now = time.time()
    dt = now - _last_tick
    if dt <= 0:
        return
    # Cap catch-up to 60 s to avoid mega-ticks after long AFK
    dt = min(dt, 60.0)
    _last_tick = now

    tick_idle(_state, dt)
    _state.idle_seconds += dt
    tick_mouth(_state)
    tick_venom_rush(_state)

    auto_result = tick_auto_bite(_state)
    if auto_result is not None:
        handle_press(_state)
        compute_derived(_state)

    tick_combo_decay(_state)
    tick_post_frenzy_bpm(_state)
    compute_derived(_state)

    notifs = _events.tick(_state)
    _pending_notifications.extend(notifs)

    if not _state.current_offerings:
        refresh_offerings(_state, _meta.get_unlocked_upgrade_set())

    if now - _last_autosave >= 30.0:
        save_run(_state)
        _last_autosave = now


def _state_json() -> dict:
    """Build the JSON blob sent to the frontend."""
    assert _state is not None and _meta is not None and _events is not None
    s = _state
    stages = BALANCE.prestige.growth_stages
    stage_name = stages[min(s.current_stage_index, len(stages) - 1)][1]

    # Goal
    goal_text, goal_pct = _compute_goal(s)

    # Offerings
    offerings = []
    for uid in s.current_offerings:
        udef = ALL_UPGRADES.get(uid)
        if udef is None:
            continue
        level = s.upgrade_levels.get(uid, 0)
        cost = get_upgrade_cost(s, uid)
        offerings.append({
            "id": uid,
            "name": udef.name,
            "description": udef.description,
            "level": level,
            "max_level": udef.max_level,
            "cost": format_number(cost),
            "cost_raw": cost,
            "can_afford": s.essence >= cost,
            "maxed": level >= udef.max_level,
        })

    # Archetype / curse
    archetype_info = None
    arch = ALL_ARCHETYPES.get(s.archetype_id)
    if arch:
        archetype_info = {"name": arch.name, "tagline": arch.tagline}

    curse_info = None
    curse = ALL_CURSES.get(s.curse_id)
    if curse:
        curse_info = {"name": curse.name, "description": curse.description}

    # Shed info
    shed_info = {}
    if can_ascend(s):
        shed_info = {"status": "ascend"}
    elif can_shed(s):
        reward = compute_scales_reward(s)
        next_stage = stages[s.current_stage_index + 1][1]
        shed_info = {
            "status": "ready",
            "next_stage": next_stage,
            "reward": format_number(reward),
        }
    else:
        next_i = s.current_stage_index + 1
        if next_i < len(stages):
            threshold = stages[next_i][0]
            shed_info = {
                "status": "growing",
                "next_stage": stages[next_i][1],
                "current": s.snake_length,
                "threshold": threshold,
            }

    # Ascension upgrades (for the ascension modal)
    asc_upgrades = []
    for uid, udef in ASCENSION_UPGRADES.items():
        lvl = s.ascension_upgrade_levels.get(uid, 0)
        cost = udef.cost_at_level(lvl) if lvl < udef.max_level else 0
        asc_upgrades.append({
            "id": uid,
            "name": udef.name,
            "description": udef.description,
            "level": lvl,
            "max_level": udef.max_level,
            "cost": cost,
            "can_afford": s.scales >= cost and lvl < udef.max_level,
        })

    # Drain pending notifications
    notifs = list(_pending_notifications)
    _pending_notifications.clear()

    now = time.time()

    return {
        "essence": format_number(s.essence),
        "essence_raw": s.essence,
        "snake_length": s.snake_length,
        "combo_multiplier": s.combo_multiplier,
        "combo_hits": s.combo_hits,
        "per_press": format_number(s.essence_per_press),
        "per_press_raw": s.essence_per_press,
        "idle_income": f"{format_number(s.idle_income_per_s)}/s",
        "scales": format_number(s.scales),
        "scales_raw": s.scales,
        "growth_stage": stage_name,
        "current_stage_index": s.current_stage_index,
        "bpm": get_current_bpm(s),
        "beat_progress": get_beat_progress(s),
        "timing_window_s": get_timing_window_s(s),
        "perfect_window_s": get_perfect_window_s(s),
        "bite_cooldown_s": get_bite_cooldown_s(s),
        "beat_origin": s.beat_origin,
        "mouth_open": s.mouth_open,
        "last_bite_result": s.last_bite_result,
        "frenzy_active": s.frenzy_active,
        "frenzy_end_time": s.frenzy_end_time,
        "frenzy_presses": s.frenzy_presses,
        "venom_rush_active": s.venom_rush_active,
        "golden_active": s.golden_active,
        "golden_end_time": s.golden_end_time,
        "challenge_active": s.challenge_active,
        "challenge_type": s.challenge_type,
        "challenge_end_time": s.challenge_end_time,
        "challenge_progress": s.challenge_progress,
        "challenge_target": s.challenge_target,
        "bargain_active": _events.bargain_active if _events else False,
        "echo_active": _events.echo_active if _events else False,
        "echo_upgrade_id": _events.echo_upgrade_id if _events else "",
        "can_shed": can_shed(s),
        "can_ascend": can_ascend(s),
        "archetype": archetype_info,
        "curse": curse_info,
        "offerings": offerings,
        "goal_text": goal_text,
        "goal_pct": goal_pct,
        "shed_info": shed_info,
        "ascension_upgrades": asc_upgrades,
        "ascension_count": _meta.ascension_count if _meta else 0,
        "notifications": notifs,
        "server_time": now,
        "stats": {
            "peak_length": s.stats.peak_length,
            "total_essence": format_number(s.stats.total_essence_earned),
            "total_presses": s.stats.total_presses,
            "sheds": s.stats.sheds,
            "combo_high": s.stats.combo_high,
            "golden_caught": s.stats.golden_caught,
            "challenges_completed": s.stats.challenges_completed,
            "run_duration": s.stats.run_duration_s,
        },
    }


def _compute_goal(s: GameState) -> tuple[str, float]:
    stages = BALANCE.prestige.growth_stages
    if can_ascend(s):
        return "Ready to Ascend!", 1.0
    if can_shed(s):
        next_i = s.current_stage_index + 2
        if next_i < len(stages):
            target = stages[next_i][0]
            pct = min(s.snake_length / target, 1.0)
            return f"Grow to {format_number(target)} to shed again", pct
        return "Ready to Shed!", 1.0
    next_i = s.current_stage_index + 1
    if next_i < len(stages):
        target = stages[next_i][0]
        pct = min(s.snake_length / target, 1.0)
        return f"Shed at {format_number(target)} length", pct
    target = stages[-1][0]
    pct = min(s.snake_length / target, 1.0)
    return f"Ascend at {format_number(target)} length", pct


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("game.html")


@app.route("/api/state")
def api_state():
    with _lock:
        _ensure_game()
        _do_ticks()
        return jsonify(_state_json())


@app.route("/api/action/feed", methods=["POST"])
def action_feed():
    with _lock:
        _ensure_game()
        assert _state is not None
        _do_ticks()
        _state.idle_seconds = 0.0
        was_venom = _state.venom_rush_active

        # Accept a pre-evaluated result from the client (client-side timing).
        # Fall back to server-side attempt_bite when no client result is sent.
        body = request.get_json(silent=True) or {}
        client_result = body.get("client_result")
        if client_result in ("perfect", "good", "miss"):
            result = apply_bite_result(_state, client_result)
        else:
            result = attempt_bite(_state)

        bite_result = result
        if result is not None:
            if _state.venom_rush_active and not was_venom:
                _pending_notifications.append("venom_rush")
            compute_derived(_state)
            handle_press(_state)
        _do_ticks()
        data = _state_json()
        data["bite_result"] = bite_result
        return jsonify(data)


@app.route("/api/action/buy/<int:idx>", methods=["POST"])
def action_buy(idx: int):
    with _lock:
        _ensure_game()
        assert _state is not None and _meta is not None
        _do_ticks()
        offerings = _state.current_offerings
        result = False
        if idx < len(offerings):
            uid = offerings[idx]
            result = purchase_upgrade(_state, uid)
            if result:
                refresh_offerings(_state, _meta.get_unlocked_upgrade_set())
        data = _state_json()
        data["purchase_result"] = result
        return jsonify(data)


@app.route("/api/action/shed", methods=["POST"])
def action_shed():
    with _lock:
        _ensure_game()
        assert _state is not None and _meta is not None
        _do_ticks()
        result = False
        scales_earned = 0.0
        if can_shed(_state):
            scales_earned = perform_shed(_state)
            compute_derived(_state)
            refresh_offerings(_state, _meta.get_unlocked_upgrade_set())
            save_run(_state)
            result = True
        data = _state_json()
        data["shed_result"] = result
        data["scales_earned"] = format_number(scales_earned)
        return jsonify(data)


@app.route("/api/action/catch_golden", methods=["POST"])
def action_catch_golden():
    with _lock:
        _ensure_game()
        assert _state is not None and _events is not None
        _do_ticks()
        result = _events.catch_golden(_state)
        if result == -1.0:
            compute_derived(_state)
        data = _state_json()
        data["golden_caught"] = result == -1.0
        return jsonify(data)


@app.route("/api/action/accept_bargain", methods=["POST"])
def action_accept_bargain():
    with _lock:
        _ensure_game()
        assert _state is not None and _meta is not None and _events is not None
        _do_ticks()
        result = _events.accept_bargain(_state)
        if result:
            compute_derived(_state)
            refresh_offerings(_state, _meta.get_unlocked_upgrade_set())
        data = _state_json()
        data["bargain_accepted"] = result
        return jsonify(data)


@app.route("/api/action/accept_echo", methods=["POST"])
def action_accept_echo():
    with _lock:
        _ensure_game()
        assert _state is not None and _meta is not None and _events is not None
        _do_ticks()
        result = _events.accept_echo(_state)
        if result:
            compute_derived(_state)
            refresh_offerings(_state, _meta.get_unlocked_upgrade_set())
        data = _state_json()
        data["echo_accepted"] = result
        return jsonify(data)


@app.route("/api/action/ascend", methods=["POST"])
def action_ascend():
    """Begin ascension: buy ascension upgrades (sent in body) then reset."""
    global _state, _events
    with _lock:
        _ensure_game()
        assert _state is not None and _meta is not None and _events is not None
        _do_ticks()
        if not can_ascend(_state):
            return jsonify({"error": "Cannot ascend yet"}), 400

        # Apply any upgrade purchases from the request body
        body = request.get_json(silent=True) or {}
        purchases = body.get("purchases", {})  # {uid: times_to_buy}
        for uid, times in purchases.items():
            udef = ASCENSION_UPGRADES.get(uid)
            if udef is None:
                continue
            for _ in range(int(times)):
                lvl = _state.ascension_upgrade_levels.get(uid, 0)
                if lvl >= udef.max_level:
                    break
                cost = udef.cost_at_level(lvl)
                if _state.scales < cost:
                    break
                _state.scales -= cost
                _state.ascension_upgrade_levels[uid] = lvl + 1
                _meta.ascension_upgrade_levels[uid] = lvl + 1

        perform_ascension(_state)
        _meta.ascension_count += 1
        save_meta(_meta)
        _state = _new_run_state()
        _events = EventManager()
        refresh_offerings(_state, _meta.get_unlocked_upgrade_set())
        delete_run()
        data = _state_json()
        data["ascension_complete"] = True
        return jsonify(data)


@app.route("/api/action/save", methods=["POST"])
def action_save():
    with _lock:
        _ensure_game()
        assert _state is not None and _meta is not None
        save_run(_state)
        knowledge = apply_run_results(_meta, _state.stats)
        save_meta(_meta)
        return jsonify({"saved": True, "knowledge": knowledge})


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def run_server(host: str = "127.0.0.1", port: int = 5000, debug: bool = False) -> None:
    """Start the Flask development server."""
    app.run(host=host, port=port, debug=debug, use_reloader=False)
