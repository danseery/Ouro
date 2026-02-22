"""Rhythm indicator widget — Bite visualisation.

Shows an ASCII jaw that opens and closes with the beat.  The timing
window is represented by the jaw reaching its widest gape; pressing
Space *bites down* (closes the jaw) and triggers a timing evaluation.
After a bite the mouth stays locked (cooldown) then reopens.
"""

from __future__ import annotations

import time

from rich.align import Align
from rich.text import Text
from textual.widget import Widget
from textual.reactive import reactive

from ouro.data.balance import BALANCE


# How long feedback text stays on screen (seconds)
FEEDBACK_DURATION = 0.50

# ── Mouth ASCII frames (top jaw / bottom jaw) ────────────────────
# The frames represent mouth openness 0–4.
_TOP_JAW = [
    r"    ╲▔▔▔▔▔▔╱    ",  # 0 — closed (biting)
    r"   ╲▔▔▔▔▔▔▔▔╱   ",  # 1
    r"  ╲▔▔▔▔▔▔▔▔▔▔╱  ",  # 2
    r" ╲▔▔▔▔▔▔▔▔▔▔▔▔╱ ",  # 3
    r"╲▔▔▔▔▔▔▔▔▔▔▔▔▔▔╱",  # 4 — wide open (on beat)
]
_BOT_JAW = [
    r"    ╱▁▁▁▁▁▁╲    ",
    r"   ╱▁▁▁▁▁▁▁▁╲   ",
    r"  ╱▁▁▁▁▁▁▁▁▁▁╲  ",
    r" ╱▁▁▁▁▁▁▁▁▁▁▁▁╲ ",
    r"╱▁▁▁▁▁▁▁▁▁▁▁▁▁▁╲",
]

NUM_FRAMES = len(_TOP_JAW)  # 5
RHYTHM_ROW_WIDTH = 44


class RhythmIndicator(Widget):
    """Bite-rhythm visualisation.

    An ASCII jaw opens as the beat approaches and closes when the player
    presses Space (biting the tail).  Combo and timing feedback are shown
    alongside.
    """

    DEFAULT_CSS = """
    RhythmIndicator {
        width: 100%;
        height: 8;
        content-align: center middle;
        padding: 0 1 0 3;
    }
    """

    beat_progress: reactive[float] = reactive(0.0)  # 0.0–1.0 within one beat
    combo_mult: reactive[float] = reactive(1.0)
    combo_hits: reactive[int] = reactive(0)
    bpm: reactive[float] = reactive(90.0)
    mouth_open: reactive[bool] = reactive(True)
    frenzy_active: reactive[bool] = reactive(False)
    venom_rush_active: reactive[bool] = reactive(False)

    def __init__(self, **kwargs) -> None:
        super().__init__(**kwargs)
        self._feedback_until: float = 0.0
        self._feedback_text: str = ""
        self._feedback_key: str = ""

    # ── Public API ────────────────────────────────────────────────

    def set_feedback(self, result: str | None) -> None:
        """Record a bite result for on-screen feedback.

        ``None`` means the press was swallowed (mouth still locked) — no
        visual change.
        """
        if result is None:
            return
        self._feedback_until = time.time() + FEEDBACK_DURATION
        self._feedback_text = {
            "perfect": "✦ PERFECT BITE ✦",
            "good": "GOOD BITE",
            "miss": "CHOMP — MISS!",
            "saved": "★ COMBO SAVED! ★",
        }.get(result, "")
        self._feedback_key = result

    # ── Rendering ─────────────────────────────────────────────────

    def render(self) -> Align:
        prog = self.beat_progress

        # ── Feeding Frenzy override — jaw wide open, everything glows ───
        if self.frenzy_active:
            text = Text()
            top = _TOP_JAW[NUM_FRAMES - 1].strip()
            bot = _BOT_JAW[NUM_FRAMES - 1].strip()
            text.append(f"{top:^{RHYTHM_ROW_WIDTH}}\n", style="bold bright_yellow")
            text.append(f"{'MASH!':^{RHYTHM_ROW_WIDTH}}\n", style="bold bright_yellow")
            text.append(f"{bot:^{RHYTHM_ROW_WIDTH}}\n", style="bold bright_yellow")
            text.append(f"{'🔥 NO MISSES — EVERY BITE COUNTS! 🔥':^{RHYTHM_ROW_WIDTH}}\n", style="bold yellow")
            combo_label, combo_style = _combo_style(self.combo_mult)
            stats_plain = f"{self.bpm:>3.0f} BPM  {combo_label}  ({self.combo_hits:>4} hits)"
            pad_left = max(0, (RHYTHM_ROW_WIDTH - len(stats_plain)) // 2)
            pad_right = max(0, RHYTHM_ROW_WIDTH - len(stats_plain) - pad_left)
            text.append(" " * pad_left)
            text.append(f"{self.bpm:>3.0f} BPM  ", style="dim")
            text.append(combo_label, style=combo_style)
            text.append(f"  ({self.combo_hits:>4} hits)", style="dim")
            text.append(" " * pad_right + "\n")
            text.append(f"{'─── FEEDING FRENZY ───':^{RHYTHM_ROW_WIDTH}}\n", style="bold bright_yellow")
            return Align(text, align="center", vertical="middle")
        beat_interval = 60.0 / max(self.bpm, 1.0)
        timing_frac = (BALANCE.rhythm.timing_window_ms / 1000.0) / beat_interval
        perfect_frac = (BALANCE.rhythm.perfect_window_ms / 1000.0) / beat_interval

        # Distance to nearest beat boundary (0.0 = on beat)
        dist = min(prog, 1.0 - prog)
        in_perfect = dist <= perfect_frac
        in_good = dist <= timing_frac

        # ── Choose mouth frame (always beat-driven so player can time next bite) ─
        openness = 1.0 - min(dist / 0.5, 1.0)  # 1.0 on beat, 0.0 mid-beat
        frame = int(openness * (NUM_FRAMES - 1))
        frame = max(0, min(frame, NUM_FRAMES - 1))

        # Jaw colour — dim/red when locked so beat position is still readable
        if self.venom_rush_active:
            jaw_style = "bold bright_red" if in_good else "red"
        elif not self.mouth_open:
            jaw_style = {
                "perfect": "bold bright_blue",
                "good": "bold green",
            }.get(self._feedback_key, "bold red")
        elif in_perfect:
            jaw_style = "bold bright_blue"
        elif in_good:
            jaw_style = "bold green"
        else:
            jaw_style = "white"

        text = Text()

        # ── Row 1: top jaw ────────────────────────────────────────────────
        top_jaw = _TOP_JAW[frame].strip()
        text.append(f"{top_jaw:^{RHYTHM_ROW_WIDTH}}\n", style=jaw_style)

        # ── Row 2: hint inside the mouth (BITE! / wait / VENOM!) ──────────
        hint_str, hint_style = _hint(self.mouth_open, in_good, self.venom_rush_active)
        text.append(f"{hint_str.strip():^{RHYTHM_ROW_WIDTH}}\n", style=hint_style)

        # ── Row 3: bottom jaw ─────────────────────────────────────────────
        bot_jaw = _BOT_JAW[frame].strip()
        text.append(f"{bot_jaw:^{RHYTHM_ROW_WIDTH}}\n", style=jaw_style)

        # ── Row 4: feedback (or blank spacer) ─────────────────────────────
        now = time.time()
        if now < self._feedback_until and self._feedback_text:
            fb_style = {
                "perfect": "bold bright_blue",
                "good": "bold green",
                "miss": "bold red",
                "saved": "bold yellow",
            }.get(self._feedback_key, "dim")
            text.append(f"{self._feedback_text:^{RHYTHM_ROW_WIDTH}}\n", style=fb_style)
        else:
            text.append(f"{'':^{RHYTHM_ROW_WIDTH}}\n")

        # ── Row 5: BPM  |  combo  |  hits (centered with mixed styles) ───
        combo_label, combo_style = _combo_style(self.combo_mult)
        stats_plain = f"{self.bpm:>3.0f} BPM  {combo_label}  ({self.combo_hits:>4} hits)"
        pad_left = max(0, (RHYTHM_ROW_WIDTH - len(stats_plain)) // 2)
        pad_right = max(0, RHYTHM_ROW_WIDTH - len(stats_plain) - pad_left)
        text.append(" " * pad_left)
        text.append(f"{self.bpm:>3.0f} BPM  ", style="dim")
        text.append(combo_label, style=combo_style)
        text.append(f"  ({self.combo_hits:>4} hits)", style="dim")
        text.append(" " * pad_right + "\n")

        # ── Row 6: persistent hint (always visible) ───────────────────────
        text.append(f"{'─── bite the tail on the beat ───':^{RHYTHM_ROW_WIDTH}}\n", style="dim italic")

        return Align(text, align="center", vertical="middle")


def _hint(mouth_open: bool, in_good: bool, venom_rush: bool = False) -> tuple[str, str]:
    """Return fixed-width (7-char) hint label and rich style."""
    if venom_rush:
        return "VENOM! ", "bold bright_red"
    if not mouth_open:
        return "○ wait ", "white"
    if in_good:
        return "BITE!  ", "bold bright_green"
    return "·····  ", "dim"


def _combo_style(mult: float) -> tuple[str, str]:
    """Return (label, rich_style) for a combo multiplier value."""
    if mult >= 8.0:
        return f"COMBO {mult:.0f}x", "bold bright_red"
    elif mult >= 5.0:
        return f"COMBO {mult:.0f}x", "bold magenta"
    elif mult >= 3.0:
        return f"COMBO {mult:.0f}x", "bold yellow"
    elif mult >= 1.5:
        return f"COMBO {mult:.1f}x", "bold green"
    else:
        return f"COMBO {mult:.1f}x", "dim"
