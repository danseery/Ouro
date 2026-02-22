# Ouro — The Eternal Serpent

Roguelike incremental TUI game. Python 3.12 + Textual 8.0.

```
Feed → Grow → Shed → Ascend → Repeat
```

## Quick Start

```bash
cd /home/bloc/projects/ouro
source .venv/bin/activate
python -m ouro              # run the game
pytest tests/ -q            # 47 tests
```

## Controls

| Key | Action |
|-----|--------|
| Space / Enter | Feed (bite) — rhythmic timing matters |
| S | Shed Skin (advance growth stage) |
| A | Ascend (meta-reset, opens upgrade tree) |
| G | Catch Golden Ouroboros |
| B | Accept Serpent's Bargain |
| E | Accept Ancient Echo |
| 1-3 | Buy offered upgrades |
| C | Collections screen |
| Q | Quit |

## Game Loop Summary

1. **Feed** — Press Space rhythmically to earn Essence. Combo builds with well-timed bites (perfect/good/miss). Snake length grows with Essence.
2. **Shed** — When length reaches next growth stage threshold, shed to advance. Upgrades kept, length resets to 50% of new threshold, earn Scales.
3. **Ascend** — At Cosmic Scale (stage 9, 900K length), open Ascension screen. Spend Scales on permanent upgrades (persist across all future runs). Full reset.

## Growth Stages (10)

```
0: Hatchling (0)        5: Continental Coil (50K)
1: Snakelet (100)       6: Global Serpent (150K)
2: Local Predator (500) 7: Stellar Devourer (350K)
3: Regional Devourer (2K) 8: Galactic Ouroboros (650K)
4: National Constrictor (10K) 9: Cosmic Scale (900K)
```

Stored as `state.current_stage_index` (authoritative, not derived from length).

## Project Structure

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for full module reference.
See [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) for design philosophy.

## Tech

- **Python 3.12.3**, **Textual 8.0.0** TUI framework
- 30 Hz game loop (`app.py` → `_game_tick()`)
- Save: `~/.ouro/run.json` (run state) + `~/.ouro/meta.json` (persistent meta)
- ~4900 lines across 35 source files
- 47 tests (pytest)
## Development Workflow

> ⚠️ **CRITICAL — never commit directly to `main`.**
> All changes must go through a feature branch and be reviewed before merging.

```bash
# 1. Create a branch for every change
git checkout -b feat/your-feature-name

# 2. Make changes, commit on the branch
git add <files>
git commit -m "feat: describe the change"

# 3. Push the branch (does NOT deploy to production)
git push -u origin feat/your-feature-name

# 4. Review the changes locally, then merge to main when satisfied
git checkout main
git merge --no-ff feat/your-feature-name
git push   # ← this triggers the Azure deployment
```

**Branch naming**: `feat/`, `fix/`, `style/`, `ci/` prefixes.  
**`main` = production.** Every push to `main` deploys to https://witty-grass-033444c10.6.azurestaticapps.net instantly.