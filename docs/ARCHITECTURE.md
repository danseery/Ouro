# Ouro — Architecture Reference

> Optimized for LLM context. Every module, its purpose, key exports, and cross-references.

## Repository Layout

```
ouro/
└── web/                     # Python Flask dev server
    ├── server.py            # Minimal static-file server (serves index.html + static/)
    ├── __main__.py          # Entry: python -m ouro.web
    └── static/
        ├── engine.js        # Full game engine — canonical implementation
        ├── game.js          # UI rendering, input handling, game loop
        ├── style.css        # All styling
        └── index.html       # Standalone entry point (used by static build)
scripts/
└── build.sh                 # Copies static/ to build/ with content-hash filenames
build/                       # Generated — deployed to Azure Static Web Apps
```

---

## Runtime Modes

| Mode | Entry point | Notes |
|------|------------|-------|
| **Static** | `build/index.html` | Production. All game logic runs in the browser. |
| **Flask dev server** | `python -m ouro.web` | Local development. Serves `ouro/web/static/`. No server-side game logic. |

The Python layer is **dev-server only** — it serves static assets and nothing else.
All game state, economy, rhythm, events, prestige, and save logic live in `engine.js`.

---

## Core Data Flow (`engine.js`)

```
gameTick() [~30Hz, requestAnimationFrame]
├── tickIdle(state, dt)
├── tickMouth(state)              # reopens jaw after cooldown
├── tickVenomRush(state)          # expires perfect-streak buff
├── tickAutoBite(state)           # Serpent Instinct auto-bites
├── tickComboDecay(state)         # resets combo on missed beats
├── tickPostFrenzyBpm(state)      # steps BPM down after frenzy
├── computeDerived(state)         # recalc essencePerPress, idleIncomePerS
├── events.tick(state)            # Golden, Challenge, Bargain, Echo timers
└── render()                      # push state to DOM (game.js)

onBite() [Space / click]
├── attemptBite(state)            # returns "perfect"/"good"/"miss"/"saved"/null
├── computeDerived(state)
├── handlePress(state)            # earn Essence, chain bites, rattletail
└── showFeedback(result)          # visual jawbar + text feedback
```

---

## Key State (`engine.js`)

### Game State (~40 fields)
```
essence, snake_length, phase, current_stage_index (0–9)
scales, total_scales_earned
combo_hits, combo_multiplier, combo_misses
upgrade_levels: { [id]: level }
ascension_upgrade_levels: { [id]: level }   // from meta, read by computeDerived
mouth_open, last_bite_result, beat_origin
post_frenzy_bpm, post_frenzy_next_step
archetype_id, curse_id
stats: RunStats
```

### Meta State (persists in `localStorage`)
```
serpent_knowledge, ascension_count
ascension_upgrade_levels: { [id]: level }
unlocked_upgrade_ids, unlocked_skins, lore_fragments
```

---

## Prestige System

### Shed (stage advance, NOT a full reset)
- **Trigger:** `snake_length >= growth_stages[current_stage_index + 1][0]`
- **Effect:** `current_stage_index += 1`, length = `50% × new_threshold`, Scales earned, **upgrades KEPT**, rhythm state reset
- **Cannot shed** at stage 9 (final)

### Ascension (meta-reset)
- **Trigger:** `current_stage_index === 9 AND snake_length >= 900_000`
- **Flow:** `actionAscend()` → push `AscensionScreen` modal → player buys permanent upgrades with Scales → confirm → `performAscension()` → `newRunState()` → `meta.ascension_count++`
- **Resets:** stage to 0, length to 3, upgrades cleared, fresh archetype/curse
- **Persists:** Scales balance, `meta.ascension_upgrade_levels`

### Ascension Upgrades (7 total)
| ID | Name | Tier | Effect | Base Cost |
|----|------|------|--------|-----------|
| serpent_memory | Serpent Memory | Flat | +50 starting Essence/lvl | 5 |
| ancient_coil | Ancient Coil | Flat | +10 starting Length/lvl | 8 |
| endless_drift | Endless Drift | Flat | Idle income × (1+10%/lvl) | 10 |
| serpent_hoard | Serpent's Hoard | Flat | +1 offering slot/lvl | 20 |
| void_fang | Void Fang | Power | EPP × (1+50%/lvl) | 50 |
| scale_harvest | Scale Harvest | Power | Shed Scales × (1+25%/lvl) | 30 |
| cosmic_tempo | Cosmic Tempo | Power | +10 max BPM/lvl | 40 |

---

## Rhythm System

- **BPM:** base 60, +1 per 15K length, max 120, snapped to multiples of 10
- **Windows:** timing_window_ms=140, perfect_window_ms=55
- **Bite cooldown:** 65% of beat interval (prevents held-key spam)
- **Combo tiers:** 0→1×, 5→1.5×, 15→2×, 30→3×, 60→5×, 100→8×
- **Venom Rush:** 5 consecutive perfects → 3 beats of bonus Essence
- **Post-frenzy cooldown:** holds max BPM 10s, then steps -10 every 5s

---

## Events

| Event | Interval | Duration | Effect |
|-------|----------|----------|--------|
| Golden Ouroboros | 45–120s | 8s | Press G → Feeding Frenzy (mash freely) |
| Timed Challenge | 120–240s | 10s | Skill check → Essence reward |
| Serpent's Bargain | 90–180s | 12s | Sacrifice 30% Essence → free upgrade |
| Ancient Echo | 200–350s | 30s | Free upgrade claim |

---

## Economy

### `computeDerived(state)` recalculates:
```
essencePerPress = base × upgrade_mults × scales_mult × combo × archetype × curse × ascension_epp
idleIncomePerS  = epp × idle_fraction × upgrades × archetype × ascension_idle
```

### `handlePress(state)` applies:
- Rattletail double-press chance (capped 95%)
- Cascading Fangs chain (up to 4 total hits, 80% cap)
- Venom Rush bonus (combo × 2.0)
- Length update: `3 + Math.floor(essence / 10)`

---

## Save Format

- **Run state:** `localStorage['ouro_run']` — full game state, auto-saved every 30s
- **Meta state:** `localStorage['ouro_meta']` — MetaState with ascension_count, upgrade levels, collections
- New fields always have fallback defaults for backward compatibility

---

## Static Build & Deployment

`scripts/build.sh` copies `ouro/web/static/` → `build/` with SHA-256 content-hash
suffixes for cache-busting. `staticwebapp.config.json` is also copied to `build/`.
Deploy the `build/` folder to Azure Static Web Apps.

---

## Known Gaps / TODOs

1. **`serpent_hoard` / `cosmic_tempo`** ascension upgrades: effects defined but not yet wired into `engine.js` offering count or BPM cap.
2. **Collections / Skins** system: unlock conditions defined but not checked during gameplay.
3. **Lore** fragments: defined but no trigger system to unlock them during a run.
