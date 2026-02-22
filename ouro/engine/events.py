"""Events — Golden Ouroboros, Timed Challenges, Bargains, and Echoes."""

from __future__ import annotations

import random
import time
from dataclasses import dataclass
from enum import Enum, auto

from ouro.data.balance import BALANCE
from ouro.data.curses import ALL_CURSES
from ouro.data.upgrades import ALL_UPGRADES, UpgradeEffect
from ouro.engine.game_state import GameState


class ChallengeType(Enum):
    """Types of timed challenges."""

    FEED_FRENZY = auto()      # "Feed N times in T seconds"
    COMBO_SUSTAIN = auto()    # "Maintain Nx combo for T seconds"
    PATIENCE = auto()         # "Don't press for T seconds"


@dataclass
class ChallengeSpec:
    """Specification for a timed challenge instance."""

    challenge_type: ChallengeType
    description: str
    target: float
    duration_s: float
    reward_essence_mult: float = 5.0


def _random_challenge(state: GameState) -> ChallengeSpec:
    """Generate a random challenge appropriate to current game state."""
    ctype = random.choice(list(ChallengeType))
    dur = BALANCE.events.challenge_duration_s

    if ctype == ChallengeType.FEED_FRENZY:
        target = random.randint(30, 60)
        return ChallengeSpec(
            challenge_type=ctype,
            description=f"Feed {target} times in {dur:.0f}s!",
            target=target,
            duration_s=dur,
        )
    elif ctype == ChallengeType.COMBO_SUSTAIN:
        target = random.choice([3.0, 5.0, 8.0])
        return ChallengeSpec(
            challenge_type=ctype,
            description=f"Hold {target:.0f}x combo for {dur:.0f}s!",
            target=target,
            duration_s=dur,
        )
    else:  # PATIENCE
        target = dur
        return ChallengeSpec(
            challenge_type=ctype,
            description=f"Don't press anything for {dur:.0f}s!",
            target=target,
            duration_s=dur,
            reward_essence_mult=8.0,  # higher reward for patience
        )


class EventManager:
    """Manages Golden Ouroboros spawns and Timed Challenges."""

    def __init__(self) -> None:
        self._next_golden_time: float = self._schedule_golden()
        self._next_challenge_time: float = self._schedule_challenge()
        self._next_bargain_time: float = self._schedule_bargain()
        self._next_echo_time: float = self._schedule_echo()
        self._current_challenge_spec: ChallengeSpec | None = None
        self._challenge_start_presses: int = 0
        self._challenge_start_time: float = 0.0
        self._patience_last_press: int = 0
        # Active transient events
        self._bargain_active: bool = False
        self._bargain_end_time: float = 0.0
        self._echo_active: bool = False
        self._echo_end_time: float = 0.0
        self._echo_upgrade_id: str = ""

    def _schedule_golden(self) -> float:
        bal = BALANCE.events
        delay = random.uniform(bal.golden_min_interval_s, bal.golden_max_interval_s)
        return time.time() + delay

    def _schedule_challenge(self) -> float:
        bal = BALANCE.events
        delay = random.uniform(
            bal.challenge_min_interval_s, bal.challenge_max_interval_s
        )
        return time.time() + delay

    def _golden_duration(self, state: GameState) -> float:
        """Get golden event duration, accounting for upgrades and curses."""
        dur = BALANCE.events.golden_duration_s
        for uid, level in state.upgrade_levels.items():
            udef = ALL_UPGRADES[uid]
            if udef.effect == UpgradeEffect.GOLDEN_DURATION_MULT and level > 0:
                dur *= 1.0 + udef.value_per_level * level
        # Curse: Clouded Vision — 50% shorter golden
        if state.curse_id == "clouded_vision":
            dur *= ALL_CURSES["clouded_vision"].magnitude
        return dur

    def _schedule_bargain(self) -> float:
        bal = BALANCE.events
        delay = random.uniform(bal.bargain_min_interval_s, bal.bargain_max_interval_s)
        return time.time() + delay

    def _schedule_echo(self) -> float:
        bal = BALANCE.events
        delay = random.uniform(bal.echo_min_interval_s, bal.echo_max_interval_s)
        return time.time() + delay

    def tick(self, state: GameState) -> list[str]:
        """Tick the event system. Returns list of event notifications."""
        now = time.time()
        notifications: list[str] = []

        # ── Golden Ouroboros ─────────────────────────────
        if not state.golden_active and now >= self._next_golden_time:
            # Spawn golden event
            state.golden_active = True
            state.golden_end_time = now + self._golden_duration(state)
            notifications.append("golden_spawn")

        if state.golden_active and now >= state.golden_end_time:
            # Golden expired without being caught
            state.golden_active = False
            state.stats.golden_missed += 1
            self._next_golden_time = self._schedule_golden()
            notifications.append("golden_missed")

        # ── Feeding Frenzy ──────────────────────
        if state.frenzy_active and now >= state.frenzy_end_time:
            state.frenzy_active = False
            # Reward scales with how many times they mashed
            reward = state.essence_per_press * state.frenzy_presses * BALANCE.events.golden_reward_multiplier
            state.essence += reward
            state.stats.total_essence_earned += reward
            notifications.append(f"frenzy_end:{state.frenzy_presses}:{reward:.0f}")
            state.frenzy_presses = 0
            # Trigger BPM cooldown: hold at max for 10s then step down
            state.post_frenzy_bpm = BALANCE.rhythm.max_bpm
            state.post_frenzy_next_step = now + 10.0

        # ── Timed Challenges ─────────────────────────────
        if not state.challenge_active and now >= self._next_challenge_time:
            spec = _random_challenge(state)
            self._current_challenge_spec = spec
            state.challenge_active = True
            state.challenge_type = spec.challenge_type.name
            state.challenge_end_time = now + spec.duration_s
            state.challenge_target = spec.target
            state.challenge_progress = 0.0
            self._challenge_start_presses = state.stats.total_presses
            self._challenge_start_time = now
            self._patience_last_press = state.stats.total_presses
            notifications.append(f"challenge_start:{spec.description}")

        if state.challenge_active:
            spec = self._current_challenge_spec
            assert spec is not None

            # Update progress
            if spec.challenge_type == ChallengeType.FEED_FRENZY:
                state.challenge_progress = float(
                    state.stats.total_presses - self._challenge_start_presses
                )
            elif spec.challenge_type == ChallengeType.COMBO_SUSTAIN:
                if state.combo_multiplier >= spec.target:
                    state.challenge_progress = now - self._challenge_start_time
                else:
                    # Reset progress if combo drops below target
                    self._challenge_start_time = now
                    state.challenge_progress = 0.0
            elif spec.challenge_type == ChallengeType.PATIENCE:
                if state.stats.total_presses > self._patience_last_press:
                    # Failed — pressed a key
                    state.challenge_active = False
                    state.stats.challenges_failed += 1
                    self._next_challenge_time = self._schedule_challenge()
                    notifications.append("challenge_failed")
                else:
                    state.challenge_progress = now - self._challenge_start_time

            # Check completion
            if state.challenge_active and state.challenge_progress >= spec.target:
                state.challenge_active = False
                state.stats.challenges_completed += 1
                # Reward
                reward = state.essence_per_press * spec.reward_essence_mult * 10
                state.essence += reward
                state.stats.total_essence_earned += reward
                self._next_challenge_time = self._schedule_challenge()
                notifications.append(f"challenge_complete:{reward:.0f}")

            # Check timeout
            if state.challenge_active and now >= state.challenge_end_time:
                state.challenge_active = False
                state.stats.challenges_failed += 1
                self._next_challenge_time = self._schedule_challenge()
                notifications.append("challenge_failed")

        # ── Serpent's Bargain ────────────────────────────
        if not self._bargain_active and now >= self._next_bargain_time:
            self._bargain_active = True
            self._bargain_end_time = now + BALANCE.events.bargain_duration_s
            notifications.append("bargain_spawn")

        if self._bargain_active and now >= self._bargain_end_time:
            self._bargain_active = False
            self._next_bargain_time = self._schedule_bargain()
            notifications.append("bargain_expired")

        # ── Ancient Echo (free upgrade offer) ────────────
        if not self._echo_active and now >= self._next_echo_time:
            # Pick a random non-maxed upgrade to offer
            from ouro.data.upgrades import ALL_UPGRADES, BASE_POOL
            candidates = [
                uid for uid in BASE_POOL
                if state.upgrade_levels.get(uid, 0) < ALL_UPGRADES[uid].max_level
            ]
            if candidates:
                self._echo_upgrade_id = random.choice(candidates)
                self._echo_active = True
                self._echo_end_time = now + BALANCE.events.echo_duration_s
                notifications.append(f"echo_spawn:{self._echo_upgrade_id}")

        if self._echo_active and now >= self._echo_end_time:
            self._echo_active = False
            self._echo_upgrade_id = ""
            self._next_echo_time = self._schedule_echo()
            notifications.append("echo_expired")

        return notifications

    # ── Public bargain/echo API ───────────────────────────────

    @property
    def bargain_active(self) -> bool:
        return self._bargain_active

    @property
    def echo_active(self) -> bool:
        return self._echo_active

    @property
    def echo_upgrade_id(self) -> str:
        return self._echo_upgrade_id

    def accept_bargain(self, state: GameState) -> bool:
        """Player accepts the Serpent's Bargain. Returns True if accepted."""
        if not self._bargain_active:
            return False
        cost = state.essence * BALANCE.events.bargain_cost_fraction
        if cost <= 0:
            return False
        state.essence -= cost
        self._bargain_active = False
        self._next_bargain_time = self._schedule_bargain()  # must reschedule or it re-fires next tick

        # Grant one free upgrade level (pick from current non-maxed offerings)
        from ouro.data.upgrades import ALL_UPGRADES
        from ouro.engine.economy import get_upgrade_cost, purchase_upgrade
        candidates = [
            uid for uid in state.current_offerings
            if state.upgrade_levels.get(uid, 0) < ALL_UPGRADES[uid].max_level
        ]
        if candidates:
            uid = candidates[0]
            grant_cost = get_upgrade_cost(state, uid)
            state.essence += grant_cost      # inject just enough
            purchase_upgrade(state, uid)     # buy it
            # if purchase failed for any reason, don't leave phantom essence
            # (purchase_upgrade deducts the cost itself)

        return True

    def decline_bargain(self) -> None:
        self._bargain_active = False
        self._next_bargain_time = self._schedule_bargain()

    def accept_echo(self, state: GameState) -> bool:
        """Player claims the Ancient Echo free upgrade. Returns True if claimed."""
        from ouro.engine.economy import purchase_upgrade
        if not self._echo_active or not self._echo_upgrade_id:
            return False
        # Give it free by injecting enough essence temporarily
        from ouro.data.upgrades import ALL_UPGRADES
        from ouro.engine.economy import get_upgrade_cost
        cost = get_upgrade_cost(state, self._echo_upgrade_id)
        state.essence += cost  # free it
        result = purchase_upgrade(state, self._echo_upgrade_id)
        if not result:
            state.essence -= cost  # undo if failed
        self._echo_active = False
        self._next_echo_time = self._schedule_echo()
        return result

    def catch_golden(self, state: GameState) -> float:
        """Player catches the golden ouroboros — starts a Feeding Frenzy."""
        if not state.golden_active:
            return 0.0

        state.golden_active = False
        state.stats.golden_caught += 1
        self._next_golden_time = self._schedule_golden()

        # Start Feeding Frenzy — combo and essence for rapid mashing
        state.frenzy_active = True
        # Frenzy Amplifier: each combo multiplier tier adds bonus seconds
        tiers_earned = sum(
            1 for threshold, _ in BALANCE.rhythm.combo_tiers if state.combo_hits >= threshold
        )
        bonus_s = tiers_earned * BALANCE.events.frenzy_combo_bonus_s_per_tier
        state.frenzy_end_time = time.time() + BALANCE.events.frenzy_duration_s + bonus_s
        state.frenzy_presses = 0
        # Open the mouth immediately so first press scores right away
        state.mouth_open = True
        state.bite_cooldown_until = 0.0

        return -1.0  # signals frenzy started (not a direct reward)
