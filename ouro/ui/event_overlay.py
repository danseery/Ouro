"""Event overlay — Golden Ouroboros and Timed Challenge popups."""

from __future__ import annotations

import time

from rich.text import Text
from textual.widget import Widget
from textual.reactive import reactive

from ouro.engine.economy import format_number
from ouro.engine.game_state import GameState


class EventOverlay(Widget):
    """Overlay widget for active events (golden ouroboros, challenges)."""

    DEFAULT_CSS = """
    EventOverlay {
        width: 100%;
        height: auto;
        min-height: 3;
        content-align: center middle;
        text-align: center;
        padding: 0 1;
    }
    """

    event_text: reactive[str] = reactive("")

    def render(self) -> Text:
        if not self.event_text:
            return Text("")

        text = Text()
        text.append(self.event_text, style="bold")
        return text

    def update_from_state(self, state: GameState) -> None:
        """Update overlay based on active events."""
        now = time.time()

        if state.frenzy_active:
            remaining = max(0, state.frenzy_end_time - now)
            self.event_text = (
                f"🐍 FEEDING FRENZY!  "
                f"MASH SPACE!  "
                f"{state.frenzy_presses} bites  "
                f"({remaining:.1f}s)"
            )
            self.styles.background = "darkorange"
            self.styles.color = "white"
            self.styles.display = "block"

        elif state.golden_active:
            remaining = max(0, state.golden_end_time - now)
            self.event_text = (
                f"✦ GOLDEN OUROBOROS! ✦  "
                f"Press [G] to catch!  "
                f"({remaining:.1f}s)"
            )
            self.styles.background = "gold"
            self.styles.color = "black"
            self.styles.display = "block"

        elif state.challenge_active:
            remaining = max(0, state.challenge_end_time - now)
            progress = state.challenge_progress
            target = state.challenge_target
            pct = min(100, (progress / target * 100)) if target > 0 else 0
            self.event_text = (
                f"⚡ CHALLENGE: {state.challenge_type} ⚡  "
                f"{pct:.0f}%  ({remaining:.1f}s)"
            )
            self.styles.background = "darkblue"
            self.styles.color = "white"
            self.styles.display = "block"

        else:
            self.event_text = ""
            self.styles.display = "none"
