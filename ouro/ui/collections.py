"""Collections UI — Skins and Lore journal."""

from __future__ import annotations

from rich.text import Text
from textual.screen import Screen
from textual.widgets import Static, Header, Footer
from textual.containers import Vertical, Horizontal
from textual import on
from textual.binding import Binding

from ouro.data.skins import ALL_SKINS
from ouro.data.lore import LORE_FRAGMENTS
from ouro.engine.meta import MetaState


class CollectionsScreen(Screen):
    """Screen showing unlocked skins and lore fragments."""

    BINDINGS = [
        Binding("escape", "back", "Back"),
        Binding("q", "back", "Back"),
    ]

    def action_back(self) -> None:
        """Return to the game."""
        self.app.pop_screen()

    DEFAULT_CSS = """
    CollectionsScreen {
        background: $surface;
    }

    #collections-container {
        padding: 2;
        height: 100%;
        overflow-y: auto;
    }

    .section-header {
        text-style: bold;
        padding: 1 0;
    }

    .collection-item {
        padding: 0 2;
    }

    .locked {
        color: $text-muted;
    }

    .unlocked {
        color: $success;
    }
    """

    def __init__(self, meta: MetaState, **kwargs) -> None:
        super().__init__(**kwargs)
        self._meta = meta

    def compose(self):
        yield Header()
        with Vertical(id="collections-container"):
            yield Static(self._render_skins(), classes="collection-item")
            yield Static(self._render_lore(), classes="collection-item")
        yield Footer()

    def _render_skins(self) -> Text:
        text = Text()
        unlocked = set(self._meta.unlocked_skins)
        total = len(ALL_SKINS)
        count = len(unlocked)

        text.append(f"\n  ═══ Snake Skins ({count}/{total}) ═══\n\n", style="bold magenta")

        for skin_id, skin in ALL_SKINS.items():
            if skin_id in unlocked:
                active = " ◀" if skin_id == self._meta.active_skin else ""
                text.append(f"  ✦ {skin.name}{active}\n", style=skin.body_color)
                text.append(f"    {skin.description}\n\n", style="dim")
            else:
                text.append(f"  ▪ ???\n", style="dim")
                text.append(f"    {skin.unlock_hint}\n\n", style="dim italic")

        return text

    def _render_lore(self) -> Text:
        text = Text()
        collected = set(self._meta.collected_lore_ids)
        total = len(LORE_FRAGMENTS)
        count = len(collected)

        text.append(f"\n  ═══ Lore Fragments ({count}/{total}) ═══\n\n", style="bold cyan")

        for frag in LORE_FRAGMENTS:
            if frag.id in collected:
                text.append(f"  ✦ {frag.title}\n", style="bold")
                text.append(f"    \"{frag.text}\"\n\n", style="italic")
            else:
                text.append(f"  ▪ ???\n", style="dim")
                text.append(f"    {frag.unlock_hint}\n\n", style="dim italic")

        return text
