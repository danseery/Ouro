# Ouro — Game Design Document

> *The serpent that devours itself, only to be reborn.*

## Genre
**Roguelike Incremental** — A unique hybrid combining the escalating number-crunch of idle/incremental games with the per-run variety and meta-progression of roguelikes.

## Thematic Identity
The ouroboros (snake eating its own tail) isn't just a skin — it **is** the mechanical metaphor:

| Theme | Mechanic |
|---|---|
| Snake grows | Accumulate currency (Essence) |
| Snake eats its tail | Spend currency (sacrifice length for upgrades) |
| Shedding skin | Stage advance — grow through 10 named stages, keeping upgrades |
| Scales of wisdom | Permanent Essence multiplier + Ascension currency |
| Ascension | Cookie Clicker-style meta-reset → permanent upgrade tree |
| The cycle repeats | Roguelike reset — run ends, meta-unlocks persist |

---

## Core Loop

```
[FEED] → Rhythmic biting (spacebar/enter) → gain Essence, snake grows
   ↓
[GROW] → Snake length increases → unlock new upgrade tiers
   ↓
[BITE] → Sacrifice tail segments → purchase upgrades/generators
   ↓
[AMPLIFY] → Upgrades increase feed rate, unlock abilities
   ↓
[SHED] → Stage advance: earn Scales, length halved, upgrades KEPT
   ↓  (repeat through 10 growth stages)
[ASCEND] → At stage 9 + 900K length: meta-reset, spend Scales on permanent upgrades
   ↓
[NEW RUN] → Fresh run with Ascension bonuses → new cycle begins
```

---

## Psychology Principles Driving Design

### 1. Variable Ratio Reinforcement (B.F. Skinner)
**Where:** Golden Ouroboros events, random upgrade offerings, timed challenges
**Why:** Unpredictable reward schedules produce the highest response rates. The player never knows when the next golden event will appear, creating constant anticipation.

### 2. Loss Aversion (Kahneman & Tversky)
**Where:** "Bite Tail" purchase mechanic — you visually shrink to buy upgrades
**Why:** Losses are felt ~2x more intensely than equivalent gains. Watching your snake shrink creates agonizing, engaging decisions: "Is this upgrade worth 15 segments?"

### 3. Endowed Progress Effect (Nunes & Dreze)
**Where:** Runs start with length 3 (not 0); meta-unlocks give head starts
**Why:** Artificial progress makes completion feel closer, increasing motivation to continue.

### 4. Escalation of Commitment / Sunk Cost (Arkes & Blumer)
**Where:** Mid-run prestige decisions — "I've built up 500 segments, do I really shed now?"
**Why:** Investment in the current state makes resets psychologically costly, even when optimal.

### 5. Zeigarnik Effect
**Where:** Next upgrade always visible but unaffordable; lore fragments tease missing pieces
**Why:** Incomplete tasks create cognitive tension that demands resolution. Players push "just one more" to reach the next threshold.

### 6. Flow State (Csikszentmihalyi)
**Where:** Rhythm mechanics scale difficulty with progression; combo system requires attention
**Why:** Optimal challenge-to-skill ratio creates absorption. Active mashing with rhythm targets keeps players engaged vs. passive idle clicking.

### 7. Completionism / Collection Drive
**Where:** Snake skins, lore fragments, achievements — tracked with completion percentage
**Why:** Progress toward 100% is intrinsically motivating. Each missing piece is a small Zeigarnik effect.

### 8. Near-Miss Effect (Reid, 1986)
**Where:** "Almost caught the golden ouroboros," narrowly missing a challenge timer
**Why:** Near-misses are interpreted as "almost winning" rather than "losing," motivating retry.

### 9. Self-Determination Theory (Deci & Ryan)
**Where:** Procedural upgrade choices give autonomy; skill-based rhythm gives competence; meta-unlocks give progression (relatedness to past self)
**Why:** Intrinsic motivation from autonomy, competence, and relatedness.

---

## Progression Layers

### Layer 0: Feeding (Moment-to-Moment)
- **Input:** Spacebar/Enter mashing
- **Rhythm System:** A tempo indicator pulses. Hitting keys in rhythm builds a combo multiplier (1x → 2x → 3x → 5x). Missing the beat resets the combo.
- **Output:** Each press generates Essence (base amount × combo × upgrades)
- **Visual:** Snake visually grows on the canvas, segments light up on rhythm hits

### Layer 1: Growth & Spending
- **Currency:** Essence (earned from feeding) + Snake Length (visual representation)
- **Spending:** "Bite Tail" — select an upgrade, snake visually shortens
- **Upgrades (per-run, procedurally offered 3 at a time):**
  - **Fang Sharpening** — increase base Essence per press
  - **Elastic Scales** — combo multiplier decays slower
  - **Digestive Enzymes** — passive Essence generation (small idle income)
  - **Rattletail** — chance of 2x Essence on press
  - **Hypnotic Eyes** — golden events last longer
  - **Coiled Rest** — idle income multiplier
  - **Venomous Bite** — upgrades cost less (segment discount)
  - **Growth Hormone** — increase max combo multiplier cap
  - **Cascading Fangs** — chain hit chance (up to 4 total, 80% cap)
  - **Serpent Instinct** — auto-bites at medium quality
  - *...more unlockable via meta-progression*

### Layer 2: Shed Skin (Stage Advance)
- **10 Growth Stages:** Hatchling → Snakelet → Local Predator → Regional Devourer → National Constrictor → Continental Coil → Global Serpent → Stellar Devourer → Galactic Ouroboros → Cosmic Scale
- **Trigger:** Snake length reaches next stage's threshold
- **Effect:** Advance `current_stage_index`, earn **Scales**, length resets to **50% of new threshold**
- **Key:** Upgrades are **KEPT** across sheds (not a full reset)
- **Scales:** Permanent multiplier to all Essence generation AND currency for Ascension upgrades
- **Psychology:** Low-friction prestige — progress feels continuous, not punishing

### Layer 3: Ascension (Meta-Reset)
- **Trigger:** Stage 9 (Cosmic) + snake length ≥ 900,000
- **Flow:** Open Ascension Screen → spend Scales on permanent upgrades → confirm → full reset
- **Resets:** Stage to 0, length to 3, Essence to 0, all run upgrades cleared
- **Persists:** Scales balance, Ascension upgrade levels (in MetaState)
- **Ascension Upgrade Tree (7 upgrades):**
  - *Flat Passives:* Serpent Memory (+50 starting Essence), Ancient Coil (+10 starting Length), Endless Drift (idle ×1.1/lvl), Serpent's Hoard (+1 offering slot)
  - *Power Spikes:* Void Fang (EPP ×1.5/lvl), Scale Harvest (shed Scales ×1.25/lvl), Cosmic Tempo (+10 max BPM/lvl)
- **Psychology:** Cookie Clicker "heavenly chips" model — each Ascension makes runs faster/deeper

### Meta Layer: Hades-Style Persistence
- **Persists across runs:**
  - Unlocked snake skins (cosmetic)
  - Collected lore fragments (narrative)
  - **Serpent Knowledge** points — spend to:
    - Add new upgrades to the procedural offering pool
    - Increase starting length slightly (Endowed Progress)
    - Unlock new event types
  - **Ascension upgrade levels** — permanent power boosts
  - **Ascension count** — total ascensions completed
- **Stored in:** `~/.ouro/meta.json`

---

## Events System

### Golden Ouroboros (Variable Ratio)
- **Spawn:** Random interval (45-120 seconds), announced by visual flash
- **Mechanic:** Press G → triggers **Feeding Frenzy** (mash freely, no rhythm needed, 8s)
- **Reward:** Massive Essence burst, temporary max BPM
- **Miss penalty:** Disappears after 8 seconds if ignored. Mild FOMO.
- **Post-Frenzy:** BPM holds at max for 10s, then steps down by -10 every 5s

### Timed Challenges (Skill-Based)
- **Spawn:** Every 2-4 minutes
- **Duration:** 10 seconds
- **Reward:** Essence burst scaled to current rate
- **Failure:** No penalty, just missed reward

### Serpent's Bargain
- **Spawn:** Every 90-180 seconds, lasts 12s
- **Mechanic:** Sacrifice 30% of current Essence → receive a free upgrade

### Ancient Echo
- **Spawn:** Every 200-350 seconds, lasts 30s
- **Mechanic:** Free upgrade claim (no cost)

---

## Collections

### Snake Skins
Unlocked at meta-milestones. Visible on the ASCII snake.

| Skin | Unlock Condition |
|---|---|
| Emerald | Default |
| Obsidian | Complete first Ascension |
| Golden | Catch 10 Golden Ouroboros in one run |
| Skeletal | Shed through all 10 stages in one run |
| Prismatic | Complete all timed challenges in one run |
| Void | Reach length 1000 |
| Ancient | Collect all lore fragments |
| *...more via meta-progression* | |

### Lore Fragments
Unlocked via achievements. Piece together the myth of Ouro.

- Fragment 1: "In the beginning, there was only hunger..."
- Fragment 2: "The first serpent had no tail to eat, so it consumed the void..."
- Fragment 3-20: Unlockable, telling the creation/destruction cycle story
- **UI:** Lore journal accessible from main menu, shows collected/missing pieces

---

## Run Structure (30-60 minutes)

```
Minutes 0-5:   Tutorial zone. Feed, grow, first upgrades.
Minutes 5-10:  First choices matter. Procedural upgrades shape build.
Minutes 10-15: Stages 1-3. Shed decisions flow naturally (upgrades kept).
Minutes 15-25: Mid-game. Stages 4-6. Build momentum, synergies emerge.
Minutes 25-35: Late-game. Stages 7-8. BPM rising, events frequent.
Minutes 35-45: Stage 9 (Cosmic). Push toward 900K for Ascension.
Minutes 45-60: Ascension available. Spend Scales, meta-reset, new cycle.
Run End:       Ascension → permanent upgrades purchased → new run with bonuses
```

---

## Balancing Philosophy

### Number Scaling
- Use **abbreviation display** for large numbers (1.5K, 2.3M, 1.7B, etc.)
- Internal precision: Python float (sufficient for game scale)
- Scaling curve: Exponential cost, polynomial income → natural walls that shedding resolves

### Procedural Offerings
- Each upgrade tier offers **3 random upgrades** from the unlocked pool
- Player picks 1, the other 2 are discarded (autonomy + FOMO)
- Pool expands via meta-unlocks → more variety in later runs
- Cosmic-tier upgrades locked until stage 5+

### Difficulty Scaling
- Rhythm BPM: base 60, +1 per 15K length, max 120 (snapped to 10s)
- Timing windows: 140ms good, 55ms perfect
- Combo decay after 2 missed beats
- Event frequency increases in later stages

---

## Technical Architecture

### Stack
- **Python 3.12 / Flask** — dev server only; game logic is fully client-side
- **JavaScript** — canonical game engine (`engine.js`) + UI (`game.js`)
- **localStorage** — save format in the browser
- **Azure Static Web Apps** — production hosting (CDN, auto HTTPS)

### Module Structure
See [ARCHITECTURE.md](ARCHITECTURE.md) for full module-by-module reference.

```
ouro/
├── engine/              # Python engine (used by tests + Flask server reference)
│   ├── game_state.py    # GameState dataclass, Phase enum (HATCHLING only)
│   ├── economy.py       # compute_derived, handle_press, tick_idle
│   ├── rhythm.py        # Bite timing, combo, BPM, venom rush
│   ├── prestige.py      # Shed (stage advance) + Ascension (meta-reset)
│   ├── events.py        # Golden, Challenge, Bargain, Echo events
│   ├── procedural.py    # Weighted random upgrade offerings
│   ├── meta.py          # MetaState, ascension bonuses, save/load
│   └── save.py          # Run state JSON serialization
├── web/
│   ├── server.py        # Flask dev server (serves index.html)
│   └── static/
│       ├── engine.js    # Full game engine port — runs in browser, no server calls
│       ├── game.js      # UI rendering, input handling, 30Hz loop
│       ├── style.css    # All styling
│       └── index.html   # Standalone entry point (used by static build)
└── data/
    ├── upgrades.py      # Run upgrade definitions
    ├── ascension_upgrades.py # Permanent upgrade tree (7 upgrades)
    ├── archetypes.py    # Run archetype modifiers
    ├── curses.py        # Run curse modifiers
    ├── skins.py         # Cosmetic skin definitions
    ├── lore.py          # Lore fragment text
    └── balance.py       # BALANCE singleton (all tuning constants)
tests/
    ├── test_economy.py
    ├── test_rhythm.py
    ├── test_prestige.py
    └── test_synergies.py
```

---

## Key Metrics to Track (Per Run)
- Peak snake length
- Total Essence earned
- Growth stage reached (0–9)
- Number of sheds
- Ascension achieved (y/n)
- Combo high score
- Golden events caught / missed
- Challenges completed / failed
- Run duration
- Scales earned
- Serpent Knowledge earned

These feed into the end-of-run score screen and meta-progression.

---

## Synergy System (5 named synergies)

Certain upgrade combinations unlock named synergies with bonus effects:

1. **Ouroboros Engine** — Fang Sharpening 3 + Elastic Scales 2 → +20% EPP per combo tier
2. **Eternal Coil** — Coiled Rest 2 + Growth Hormone 2 → idle income scales with max combo cap
3. **Venom Cascade** — Venomous Bite 2 + Rattletail 3 → chain hits also get cost discount
4. **Hypnotic Frenzy** — Hypnotic Eyes 2 + Digestive Enzymes 3 → idle income doubled during events
5. **Shed Momentum** — Elastic Scales 3 + Growth Hormone 3 → combo floor of 5 after each shed

Synergies are checked dynamically in `economy.compute_derived()` and displayed in the HUD.
