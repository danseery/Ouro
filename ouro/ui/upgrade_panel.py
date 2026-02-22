"""Upgrade panel — shows current offerings and lets player purchase."""

from __future__ import annotations

from rich.text import Text
from textual.widget import Widget
from textual.reactive import reactive

from ouro.data.upgrades import ALL_UPGRADES, UpgradeEffect, UpgradeDef
from ouro.engine.economy import format_number, get_upgrade_cost
from ouro.engine.game_state import GameState


def _stat_summary(udef: UpgradeDef, level: int) -> str:
    """Return a human-readable string of the current total effect for a given level.

    Returns empty string when level == 0 (nothing to show yet).
    """
    if level <= 0:
        return ""

    v = udef.value_per_level * level
    e = udef.effect

    if e == UpgradeEffect.ESSENCE_PER_PRESS:
        pct = v * 100
        mult = 1.0 + v
        return f"+{pct:.0f}% epp ({mult:.2f}×)"

    if e == UpgradeEffect.IDLE_INCOME_MULT:
        pct = v * 100
        mult = 1.0 + v
        return f"+{pct:.0f}% idle ({mult:.2f}×)"

    if e == UpgradeEffect.COMBO_DECAY_SLOW:
        tolerance = round(2 * (1.0 + v))  # base tolerance = 2 beats
        return f"{tolerance} beats of combo grace (base 2)"

    if e == UpgradeEffect.DOUBLE_PRESS_CHANCE:
        pct = min(v * 100, 95.0)
        return f"{pct:.0f}% double-essence chance"

    if e == UpgradeEffect.GOLDEN_DURATION_MULT:
        pct = v * 100
        return f"+{pct:.0f}% golden duration"

    if e == UpgradeEffect.UPGRADE_COST_DISCOUNT:
        pct = min(v * 100, 45.0)
        return f"{pct:.0f}% cost discount"

    if e == UpgradeEffect.MAX_COMBO_MULT_BONUS:
        top_base = 8.0  # base top-tier multiplier
        return f"max combo cap: {top_base + v:.1f}× (base {top_base:.1f}×)"

    if e == UpgradeEffect.SHED_SCALE_BONUS:
        return f"+{v:.1f} scales per shed"

    if e == UpgradeEffect.COSMIC_INCOME_MULT:
        pct = v * 100
        mult = 1.0 + v
        return f"+{pct:.0f}% cosmic income ({mult:.2f}×)"

    if e == UpgradeEffect.COMBO_SAVE_CHANCE:
        pct = min(v * 100, 95.0)
        return f"{pct:.0f}% chance chomp doesn't break combo"

    if e == UpgradeEffect.AUTO_BITE_CHANCE:
        pct = min(v * 100, 100.0)
        return f"{pct:.0f}% auto-bite chance per beat"

    if e == UpgradeEffect.MULTI_BITE_CHANCE:
        c = min(v, 0.80)
        p2 = c * 100
        p3 = c * c * 100
        p4 = c * c * c * 100
        return f"{p2:.0f}% double · {p3:.0f}% triple · {p4:.0f}% quad"

    return ""


class UpgradePanel(Widget):
    """Displays current upgrade offerings with cost and affordability."""

    DEFAULT_CSS = """
    UpgradePanel {
        width: 100%;
        height: 100%;
        padding: 1;
        overflow-y: auto;
    }
    """

    # Serialized offering data for reactivity
    offerings_text: reactive[str] = reactive("")

    def __init__(self, **kwargs) -> None:
        super().__init__(**kwargs)
        self._state: GameState | None = None

    def render(self) -> Text:
        text = Text()
        text.append("  ═══ Upgrades ═══\n\n", style="bold magenta")

        if self._state is None or not self._state.current_offerings:
            text.append("  No offerings yet...\n", style="dim italic")
            text.append("  Feed to grow, then\n", style="dim italic")
            text.append("  offerings appear.\n", style="dim italic")
            return text

        for i, uid in enumerate(self._state.current_offerings):
            udef = ALL_UPGRADES.get(uid)
            if udef is None:
                continue

            level = self._state.upgrade_levels.get(uid, 0)
            cost = get_upgrade_cost(self._state, uid)
            affordable = self._state.essence >= cost
            maxed = level >= udef.max_level

            # Keybind
            text.append(f"  [{i + 1}] ", style="bold")

            # Name + level
            if maxed:
                text.append(f"{udef.name} ", style="dim")
                text.append("MAX\n", style="bold green")
            else:
                name_style = "bold green" if affordable else "bold red"
                text.append(f"{udef.name} ", style=name_style)
                text.append(f"Lv.{level}\n", style="dim")

            # Description
            text.append(f"      {udef.description}\n", style="dim italic")

            # Current effective stat (only when at least 1 level owned)
            stat = _stat_summary(udef, level)
            if stat:
                text.append(f"      Now: {stat}\n", style="cyan")

            # Cost
            if not maxed:
                cost_style = "green" if affordable else "red"
                text.append(f"      Cost: {format_number(cost)} essence\n", style=cost_style)

            text.append("\n")

        return text

    def update_from_state(self, state: GameState) -> None:
        """Sync panel with game state."""
        self._state = state
        # Trigger re-render via reactive
        self.offerings_text = "|".join(
            f"{uid}:{state.upgrade_levels.get(uid, 0)}"
            for uid in state.current_offerings
        ) + f"|e:{state.essence:.0f}"
