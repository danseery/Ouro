# Ouro — The Eternal Serpent

Roguelike incremental web game. The snake that devours itself, only to be reborn.

```
Feed → Grow → Shed → Ascend → Repeat
```

---

## Quick Start

### Prerequisites

- Python 3.11+
- A virtual environment (recommended)

### Setup

```bash
# Enter the project directory
cd ouro

# Create and activate a virtual environment
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate

# Install dependencies
pip install -e .
```

### Run

```bash
# Start the local dev server (Flask), then open http://localhost:5000
python -m ouro.web

# OR open the static build directly in a browser
open build/index.html
```

### Build (static deploy)

```bash
bash scripts/build.sh
# Output goes to build/ — deploy this folder to Azure Static Web Apps
```

---

## Architecture Overview

The game has two runtime modes:

| Mode | Entry point | When to use |
|------|------------|-------------|
| **Static** | `build/index.html` | Production / Azure SWA deployment |
| **Flask dev server** | `python -m ouro.web` | Local development |

### Canonical Engine: Browser (JavaScript)

The authoritative game engine runs entirely in the browser — no server round-trips occur during gameplay.

```
ouro/web/static/
├── engine.js   ← Full game engine (state, economy, rhythm, events, prestige)
├── game.js     ← UI rendering, input handling, 30 Hz requestAnimationFrame loop
├── style.css
└── index.html  ← Standalone entry point
```

### Python Package Layout

```
ouro/
└── web/        # Flask dev server + static assets
    ├── static/ # engine.js, game.js, style.css, index.html
    └── __main__.py
scripts/
└── build.sh    # Copies static/ to build/ with content-hash filenames
build/          # Generated — deployed to Azure Static Web Apps
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full module-level reference and data-flow diagrams.

---

## Game Loop

```
[FEED]    Rhythmic spacebar/click → Essence earned, snake grows
   ↓
[GROW]    Snake length unlocks upgrade tiers
   ↓
[SHED]    At threshold: stage advances, Scales earned, length halved, upgrades KEPT
   ↓   (10 growth stages total)
[ASCEND]  Stage 9 + 900K length → spend Scales on permanent upgrades → full reset
   ↓
[NEW RUN] Begins with Ascension bonuses applied → cycle repeats
```

### Growth Stages

| # | Name | Length Threshold |
|---|------|-----------------|
| 0 | Hatchling | 0 |
| 1 | Snakelet | 100 |
| 2 | Local Predator | 500 |
| 3 | Regional Devourer | 2K |
| 4 | National Constrictor | 10K |
| 5 | Continental Coil | 50K |
| 6 | Global Serpent | 150K |
| 7 | Stellar Devourer | 350K |
| 8 | Galactic Ouroboros | 650K |
| 9 | Cosmic Scale | 900K |

Stage is stored as `state.current_stage_index` (authoritative — never derived from length).

---

## Key Design Decisions

### Prestige is Low-Friction (Shed ≠ Full Reset)
Shedding advances a stage but **keeps all run upgrades**. Only Ascension (stage 9 → 0) is a full reset. This reduces prestige anxiety and keeps runs feeling continuous.

### Rhythm as Active Engagement
A 60–120 BPM jaw indicator pulses on screen. Hits in the good window earn Essence; perfect-window hits build a Venom Rush bonus. Combo tiers (1×→8×) reward sustained rhythm and keep the game from being passive idle clicking.

### Procedural Offerings (3 per shed)
Run upgrades are drawn from a weighted pool in the JS engine, not a fixed shop. The pool expands through Serpent Knowledge (meta-currency). Players shape builds through selection, not exhaustion.

### Ascension Upgrade Tree (permanent, across all runs)

| Upgrade | Tier | Effect |
|---------|------|--------|
| Serpent Memory | Flat | +50 starting Essence / level |
| Ancient Coil | Flat | +10 starting Length / level |
| Endless Drift | Flat | Idle income ×1.1 / level |
| Serpent's Hoard | Flat | +1 offering slot / level |
| Void Fang | Power | EPP ×1.5 / level |
| Scale Harvest | Power | Shed Scales ×1.25 / level |
| Cosmic Tempo | Power | +10 max BPM / level |

Applied at run start — starting essence/length bonuses and EPP/idle multipliers are recalculated in `engine.js` each new run.

### Events

| Event | Interval | Duration | Effect |
|-------|----------|----------|--------|
| Golden Ouroboros | 45–120 s | 8 s | Press G → Feeding Frenzy (free mash) |
| Timed Challenge | 120–240 s | 10 s | Skill check → Essence burst |
| Serpent's Bargain | 90–180 s | 12 s | Sacrifice 30% Essence → free upgrade |
| Ancient Echo | 200–350 s | 30 s | Free upgrade claim |

### Save Format
- Run state: `.ouro/run.json` under the user home directory — full `GameState`, auto-saved every 30 s
- Meta state: `.ouro/meta.json` under the user home directory — Ascension count, permanent upgrade levels, collections

New fields always use `.get()` defaults for backward compatibility.

### Static Build & Deployment
`scripts/build.sh` copies `ouro/web/static/` → `build/` with SHA-256 content-hash suffixes for cache-busting. The `build/` folder is deployed directly to Azure Static Web Apps alongside `staticwebapp.config.json`.

---

## Controls (Browser)

| Key / Input | Action |
|------------|--------|
| Space / Enter / Click | Feed (bite) — rhythmic timing matters |
| S | Shed Skin (advance stage) |
| A | Ascend (open meta-upgrade screen) |
| G | Catch Golden Ouroboros |
| B | Accept Serpent's Bargain |
| E | Accept Ancient Echo |
| 1 / 2 / 3 | Buy offered upgrade |
| C | Collections screen |
| Q | Quit |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Game engine | Vanilla JavaScript (`ouro/web/static/engine.js`) |
| UI / rendering | Vanilla JavaScript + DOM (`ouro/web/static/game.js`) |
| Dev server | Python 3.11+, Flask 3.0+ |
| Build / packaging | `hatchling`, `scripts/build.sh` |
| Hosting | Azure Static Web Apps |

---

## Known Gaps / Roadmap

- `serpent_hoard` and `cosmic_tempo` ascension upgrades are defined in `engine.js` but not yet wired into offering count / BPM cap.
- Collections (skins) and Lore systems have data defined in `engine.js` but unlock triggers are not active during gameplay.

---

See [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) for full design philosophy and psychology principles.
See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full module reference and data-flow diagrams.
