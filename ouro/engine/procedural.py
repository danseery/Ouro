"""Procedural upgrade offering system — roguelike variety per run."""

from __future__ import annotations

import random

from ouro.data.archetypes import ALL_ARCHETYPES
from ouro.data.upgrades import ALL_UPGRADES, BASE_POOL, COSMIC_POOL, META_POOL
from ouro.engine.game_state import GameState


def generate_offerings(
    state: GameState,
    meta_unlocked_ids: set[str],
    count: int = 3,
) -> list[str]:
    """Generate a set of random upgrade offerings for the player to pick from.

    Args:
        state: Current game state.
        meta_unlocked_ids: Set of upgrade IDs unlocked via meta-progression.
        count: Number of offerings to generate.

    Returns:
        List of upgrade IDs offered.
    """
    # Build the available pool
    pool: list[str] = []

    # Base pool is always available
    pool.extend(BASE_POOL)

    # Meta-unlocked upgrades are available if unlocked
    for uid in META_POOL:
        if uid in meta_unlocked_ids:
            pool.append(uid)

    # Cosmic upgrades available from midgame (stage 5+) onward
    if state.current_stage_index >= 5:
        pool.extend(COSMIC_POOL)

    # Filter out maxed upgrades and wrong-phase exclusives
    available = [
        uid for uid in pool
        if state.upgrade_levels.get(uid, 0) < ALL_UPGRADES[uid].max_level
        and not (ALL_UPGRADES[uid].cosmic_only and state.current_stage_index < 5)
    ]

    if not available:
        return []

    # Archetype preference weighting: 3× weight for preferred upgrades
    archetype = ALL_ARCHETYPES.get(state.archetype_id)
    if archetype and archetype.preferred_pool:
        weighted: list[str] = []
        for uid in available:
            weight = 3 if uid in archetype.preferred_pool else 1
            weighted.extend([uid] * weight)
        pool_to_sample = weighted
    else:
        pool_to_sample = available

    # Deduplicate but preserve weighting via sample-without-replacement from distinct ids
    # Build a weighted draw: pick `count` unique IDs, biased by weight
    seen: set[str] = set()
    result: list[str] = []
    attempts = 0
    while len(result) < min(count, len(available)) and attempts < 1000:
        pick = random.choice(pool_to_sample)
        if pick not in seen:
            seen.add(pick)
            result.append(pick)
        attempts += 1

    return result


def refresh_offerings(
    state: GameState,
    meta_unlocked_ids: set[str],
) -> None:
    """Refresh the current offerings in state."""
    state.current_offerings = generate_offerings(state, meta_unlocked_ids)
