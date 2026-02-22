"""Economy engine — Essence generation, spending, and number formatting."""

from __future__ import annotations

import math
import random

from ouro.data.archetypes import ALL_ARCHETYPES
from ouro.data.balance import BALANCE
from ouro.data.curses import ALL_CURSES
from ouro.data.upgrades import ALL_UPGRADES, UpgradeEffect
from ouro.engine.game_state import GameState


def compute_derived(state: GameState) -> None:
    """Recompute cached derived values from current state + upgrades.

    Call this once per tick or after any upgrade purchase.
    """
    bal = BALANCE.economy

    # ── Essence per press ────────────────────────────────
    epp = bal.base_essence_per_press

    # Apply upgrade multipliers
    for uid, level in state.upgrade_levels.items():
        udef = ALL_UPGRADES[uid]
        if udef.effect == UpgradeEffect.ESSENCE_PER_PRESS and level > 0:
            epp *= 1.0 + udef.value_per_level * level

    # Apply scales multiplier (prestige 1)
    epp *= 1.0 + state.scales * BALANCE.prestige.scale_multiplier_per

    # Apply combo
    epp *= state.combo_multiplier

    # Archetype modifier
    archetype = ALL_ARCHETYPES.get(state.archetype_id)
    if archetype:
        epp *= archetype.epp_mult

    # Curse: Dull Fangs — -30% epp
    if state.curse_id == "dull_fangs":
        curse = ALL_CURSES["dull_fangs"]
        epp *= curse.magnitude

    # Ascension: Void Fang — global EPP multiplier
    from ouro.data.ascension_upgrades import ASCENSION_UPGRADES, AscensionEffect
    for uid, level in state.ascension_upgrade_levels.items():
        udef = ASCENSION_UPGRADES.get(uid)
        if udef and udef.effect == AscensionEffect.EPP_MULT and level > 0:
            epp *= 1.0 + udef.value_per_level * level

    # Cosmic-tier upgrade: COSMIC_INCOME_MULT (e.g., Stellar Coils — stage 5+ income boost)
    for uid, level in state.upgrade_levels.items():
        udef = ALL_UPGRADES[uid]
        if udef.effect == UpgradeEffect.COSMIC_INCOME_MULT and level > 0:
            epp *= 1.0 + udef.value_per_level * level

    state.essence_per_press = epp

    # ── Idle income ──────────────────────────────────
    idle = epp * bal.base_idle_fraction
    for uid, level in state.upgrade_levels.items():
        udef = ALL_UPGRADES[uid]
        if udef.effect == UpgradeEffect.IDLE_INCOME_MULT and level > 0:
            idle *= 1.0 + udef.value_per_level * level
    # Archetype idle modifier
    if archetype:
        idle *= archetype.idle_mult

    # Ascension: Endless Drift — passive income multiplier
    for uid, level in state.ascension_upgrade_levels.items():
        udef = ASCENSION_UPGRADES.get(uid)
        if udef and udef.effect == AscensionEffect.IDLE_BONUS and level > 0:
            idle *= 1.0 + udef.value_per_level * level

    # Curse: Frail Coils — no idle for the first N seconds
    if state.curse_id == "frail_coils":
        curse = ALL_CURSES["frail_coils"]
        if state.stats.run_start_time and (state.idle_seconds < curse.magnitude or
                state.stats.total_presses == 0):
            # Use total seconds in run, not idle_seconds (which resets on press)
            import time as _time
            elapsed_run = _time.time() - state.stats.run_start_time
            if elapsed_run < curse.magnitude:
                idle = 0.0
    state.idle_income_per_s = idle


def handle_press(state: GameState) -> float:
    """Handle a single keypress. Returns Essence earned."""
    earned = state.essence_per_press

    # Curse: Echo Curse — every Nth press earns nothing
    if state.curse_id == "echo_curse":
        n = int(ALL_CURSES["echo_curse"].magnitude)
        if state.stats.total_presses > 0 and (state.stats.total_presses % n) == 0:
            state.stats.total_presses += 1
            return 0.0

    # Double press chance (Rattletail)
    double_chance = 0.0
    for uid, level in state.upgrade_levels.items():
        udef = ALL_UPGRADES[uid]
        if udef.effect == UpgradeEffect.DOUBLE_PRESS_CHANCE and level > 0:
            double_chance += udef.value_per_level * level
    if double_chance > 0 and random.random() < min(double_chance, 0.95):
        earned *= 2.0

    # Cascading Fangs — Bernoulli chain: each hit re-rolls for another, up to 4 total
    chain_chance = 0.0
    for uid, level in state.upgrade_levels.items():
        udef = ALL_UPGRADES[uid]
        if udef.effect == UpgradeEffect.MULTI_BITE_CHANCE and level > 0:
            chain_chance += udef.value_per_level * level
    chain_chance = min(chain_chance, 0.80)
    if chain_chance > 0:
        extra = 0
        while extra < 3 and random.random() < chain_chance:
            extra += 1
        earned *= (1 + extra)

    state.essence += earned
    state.stats.total_essence_earned += earned
    state.stats.total_presses += 1

    # Venom Rush bonus: extra Essence = combo_mult × venom_rush_bonus_mult
    if state.venom_rush_active:
        venom_bonus = state.combo_multiplier * BALANCE.rhythm.venom_rush_bonus_mult
        state.essence += venom_bonus
        state.stats.total_essence_earned += venom_bonus

    # Update snake length
    epl = BALANCE.economy.essence_per_length
    new_length = 3 + int(state.essence / epl)  # length is a function of total essence
    state.snake_length = new_length
    state.record_length()

    return earned


def tick_idle(state: GameState, dt: float) -> float:
    """Apply idle income for dt seconds. Returns Essence earned."""
    earned = state.idle_income_per_s * dt
    if earned > 0:
        state.essence += earned
        state.stats.total_essence_earned += earned

        epl = BALANCE.economy.essence_per_length
        state.snake_length = 3 + int(state.essence / epl)
        state.record_length()

    return earned


def get_upgrade_cost(state: GameState, upgrade_id: str) -> float:
    """Calculate the current cost of the next level of an upgrade."""
    udef = ALL_UPGRADES[upgrade_id]
    level = state.upgrade_levels.get(upgrade_id, 0)
    cost = udef.base_cost * (BALANCE.economy.upgrade_cost_growth ** level)

    # Apply discount upgrades (capped at 55% off — cost never drops below 45%)
    for uid, lvl in state.upgrade_levels.items():
        ud = ALL_UPGRADES[uid]
        if ud.effect == UpgradeEffect.UPGRADE_COST_DISCOUNT and lvl > 0:
            cost *= max(0.45, 1.0 - ud.value_per_level * lvl)

    # Curse: Iron Gut — +40% upgrade costs
    if state.curse_id == "iron_gut":
        cost *= ALL_CURSES["iron_gut"].magnitude

    return cost


def can_afford_upgrade(state: GameState, upgrade_id: str) -> bool:
    """Check if the player can afford an upgrade."""
    cost = get_upgrade_cost(state, upgrade_id)
    return state.essence >= cost


def purchase_upgrade(state: GameState, upgrade_id: str) -> bool:
    """Attempt to purchase an upgrade. Returns True if successful."""
    udef = ALL_UPGRADES[upgrade_id]
    current_level = state.upgrade_levels.get(upgrade_id, 0)

    if current_level >= udef.max_level:
        return False

    cost = get_upgrade_cost(state, upgrade_id)
    if state.essence < cost:
        return False

    # Spend essence (bite the tail!)
    state.essence -= cost
    # Snake shrinks
    epl = BALANCE.economy.essence_per_length
    state.snake_length = 3 + int(state.essence / epl)

    # Apply upgrade
    state.upgrade_levels[upgrade_id] = current_level + 1

    # Recompute derived values
    compute_derived(state)

    return True


def format_number(n: float) -> str:
    """Format a number with suffixes for readability."""
    if n < 0:
        return f"-{format_number(-n)}"

    for threshold, suffix in reversed(BALANCE.economy.suffixes):
        if n >= threshold:
            value = n / threshold
            if value >= 100:
                return f"{value:.0f}{suffix}"
            elif value >= 10:
                return f"{value:.1f}{suffix}"
            else:
                return f"{value:.2f}{suffix}"

    if n >= 100:
        return f"{n:.0f}"
    elif n >= 10:
        return f"{n:.1f}"
    elif n == int(n):
        return str(int(n))
    else:
        return f"{n:.1f}"
