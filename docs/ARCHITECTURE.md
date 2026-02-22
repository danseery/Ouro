# Ouro — Architecture Reference

> Optimized for LLM context. Every module, its purpose, key exports, and cross-references.

## Directory Layout

```
ouro/
├── __main__.py              # Entry: OuroApp().run()
├── app.py (430 lines)       # Textual App, game loop, key bindings, UI sync
├── data/                    # Static definitions (no mutable state)
│   ├── balance.py (191)     # BALANCE singleton — all tuning constants
│   ├── upgrades.py (280)    # Run upgrade definitions, UpgradeEffect enum
│   ├── ascension_upgrades.py (112) # Permanent meta upgrade tree (7 upgrades)
│   ├── archetypes.py        # Run archetypes (random at run start)
│   ├── curses.py (100)      # Run curses (random at run start)
│   ├── skins.py (95)        # Cosmetic snake skins
│   └── lore.py (164)        # Lore fragment text
├── engine/                  # Game logic (no UI imports)
│   ├── game_state.py (119)  # GameState dataclass, Phase enum, RunStats
│   ├── economy.py (235)     # compute_derived, handle_press, tick_idle, format_number
│   ├── rhythm.py (366)      # attempt_bite, tick_mouth, BPM, combo decay, venom rush
│   ├── prestige.py (152)    # can_shed/perform_shed, can_ascend/perform_ascension
│   ├── meta.py (161)        # MetaState, apply_ascension_starting_bonuses, save/load meta
│   ├── events.py (328)      # EventManager: Golden Ouroboros, Frenzy, Bargain, Echo, Challenges
│   ├── procedural.py (90)   # generate_offerings (weighted random upgrade selection)
│   └── save.py (178)        # save_run/load_run/delete_run (JSON)
├── ui/                      # Textual widgets (no engine logic)
│   ├── hud.py (212)         # Sidebar: Essence, length, combo, growth stage, goals
│   ├── rhythm_indicator.py (199) # ASCII jaw + beat bar + feedback text
│   ├── upgrade_panel.py (163)    # Run upgrade shop (3 offerings)
│   ├── ascension_screen.py (163) # Modal: spend Scales on permanent upgrades
│   ├── prestige_screen.py   # Shed/Ascend availability panel
│   ├── snake_display.py (126)    # ASCII ouroboros art (4 sizes)
│   ├── event_overlay.py     # Golden/Challenge/Bargain/Echo overlay
│   ├── collections.py (104) # Skins + Lore journal screen
│   └── styles.tcss          # Textual CSS
tests/                       # 47 tests
├── test_economy.py          # Economy math
├── test_rhythm.py (138)     # Bite timing, combo, BPM
├── test_prestige.py (128)   # Shed stage advance, ascension
└── test_synergies.py (289)  # Cross-system integration
```

---

## Core Data Flow

```
app._game_tick() [30Hz]
├── tick_idle(state, dt)
├── tick_mouth(state)             # reopens jaw after cooldown
├── tick_venom_rush(state)        # expires perfect-streak buff
├── tick_auto_bite(state)         # Serpent Instinct auto-bites
├── tick_combo_decay(state)       # resets combo on missed beats
├── tick_post_frenzy_bpm(state)   # steps BPM down after frenzy
├── compute_derived(state)        # recalc essence_per_press, idle_income_per_s
├── events.tick(state)            # Golden, Challenge, Bargain, Echo timers
└── _sync_ui()                    # push state to every widget

app.action_feed() [on Space/Enter]
├── attempt_bite(state)           # returns "perfect"/"good"/"miss"/"saved"/None
├── compute_derived(state)
├── handle_press(state)           # earn Essence, chain bites, rattletail
└── rhythm.set_feedback(result)   # visual jawbar + text feedback
```

---

## Key Types

### Phase (enum)
- `HATCHLING` — all normal gameplay (stages 0–9)
- ~~`VOID`~~ — **removed** (was unreachable dead code after COSMIC removal)
- ~~`COSMIC`~~ — **removed** (replaced by growth stages + ascension)

### GameState (dataclass, ~40 fields)
Critical fields:
```
essence, snake_length, phase, current_stage_index (0–9)
scales, total_scales_earned
combo_hits, combo_multiplier, combo_misses
upgrade_levels: dict[str, int]
ascension_upgrade_levels: dict[str, int]  # from meta, read by compute_derived
mouth_open, last_bite_result, beat_origin
post_frenzy_bpm, post_frenzy_next_step
archetype_id, curse_id
stats: RunStats
```

### MetaState (dataclass) — persists in `~/.ouro/meta.json`
```
serpent_knowledge, ascension_count
ascension_upgrade_levels: dict[str, int]
unlocked_upgrade_ids, unlocked_skins, etc.
```

---

## Prestige System

### Shed (stage advance, NOT a full reset)
- **Trigger:** `snake_length >= growth_stages[current_stage_index + 1][0]`
- **Effect:** `current_stage_index += 1`, length = `50% × new_threshold`, Scales earned, **upgrades KEPT**, rhythm state reset
- **Cannot shed** at stage 9 (final)

### Ascension (Cookie Clicker-style meta-reset)
- **Trigger:** `current_stage_index == 9 AND snake_length >= 900,000`
- **Flow:** `action_ascend()` → push `AscensionScreen` modal → player buys permanent upgrades with Scales → confirm → `perform_ascension()` + `_new_run_state()` + `meta.ascension_count++`
- **Resets:** stage to 0, length to 3, upgrades cleared, fresh archetype/curse
- **Persists:** Scales balance, `meta.ascension_upgrade_levels`

### Ascension Upgrades (7 total, in `data/ascension_upgrades.py`)
| ID | Name | Tier | Effect | Base Cost |
|----|------|------|--------|-----------|
| serpent_memory | Serpent Memory | Flat | +50 starting Essence/lvl | 5 |
| ancient_coil | Ancient Coil | Flat | +10 starting Length/lvl | 8 |
| endless_drift | Endless Drift | Flat | Idle income × (1+10%/lvl) | 10 |
| serpent_hoard | Serpent's Hoard | Flat | +1 offering slot/lvl | 20 |
| void_fang | Void Fang | Power | EPP × (1+50%/lvl) | 50 |
| scale_harvest | Scale Harvest | Power | Shed Scales × (1+25%/lvl) | 30 |
| cosmic_tempo | Cosmic Tempo | Power | +10 max BPM/lvl | 40 |

Applied in `meta.apply_ascension_starting_bonuses(state)` (starting essence/length) and `economy.compute_derived()` (EPP/idle multipliers).

---

## Rhythm System

- **BPM:** base 60, +1 per 15K length, max 120, snapped to multiples of 10
- **Windows:** timing_window_ms=140, perfect_window_ms=55
- **Bite cooldown:** 65% of beat interval (prevents held-key spam)
- **Combo tiers:** 0→1x, 5→1.5x, 15→2x, 30→3x, 60→5x, 100→8x
- **Venom Rush:** 5 consecutive perfects → 3 beats of bonus Essence
- **Post-frenzy cooldown:** holds max BPM 10s, then steps -10 every 5s

### Jaw bar colors (rhythm_indicator.py)
- Expanding (idle): white
- Good window: bold green
- Perfect window: bold bright_blue
- Miss/locked: bold red
- Frenzy: bold bright_yellow

---

## Events (engine/events.py)

| Event | Interval | Duration | Effect |
|-------|----------|----------|--------|
| Golden Ouroboros | 45–120s | 8s | Press G → Feeding Frenzy (mash freely) |
| Timed Challenge | 120–240s | 10s | Skill check → Essence reward |
| Serpent's Bargain | 90–180s | 12s | Sacrifice 30% Essence → free upgrade |
| Ancient Echo | 200–350s | 30s | Free upgrade claim |

---

## Economy (engine/economy.py)

### compute_derived(state) recalculates:
```
essence_per_press = base × upgrade_mults × scales_mult × combo × archetype × curse × ascension_epp
idle_income_per_s = epp × idle_fraction × upgrades × archetype × ascension_idle
```

### handle_press(state) applies:
- Rattletail double-press chance (capped 95%)
- Cascading Fangs chain (up to 4 total hits, 80% cap)
- Venom Rush bonus (combo × 2.0)
- Length update: `3 + int(essence / 10)`

---

## Save Format

- **Run state:** `~/.ouro/run.json` — full GameState serialized, auto-save every 30s
- **Meta state:** `~/.ouro/meta.json` — MetaState with ascension_count, ascension_upgrade_levels, collections
- New fields always have `.get()` defaults for backward compatibility

---

## Known Gaps / TODOs

1. **`serpent_hoard` / `cosmic_tempo`** ascension upgrades: effects defined but not yet wired into `procedural.py` offering count or `rhythm.py` BPM cap.
2. **Collections / Skins** system exists but unlock conditions aren't checked during gameplay.
3. **Lore** fragments defined but no trigger system to unlock them.
