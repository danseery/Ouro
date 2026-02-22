/* ═══════════════════════════════════════════════════════════════
   Ouro Engine — Complete client-side port of the Python engine.
   All game logic runs locally in the browser. No server required.
   ═══════════════════════════════════════════════════════════════ */

'use strict';

// ── Clock & random helpers ────────────────────────────────────
// Date.now() is used so beat_origin survives localStorage save/load across
// page reloads. For sub-ms rhythm precision at keypress time we snapshot
// performance.now() alongside. See _pressTime in game.js.
function now() { return Date.now() / 1000.0; }
// High-resolution timestamp for input capture only (not stored).
function nowHR() { return performance.now() / 1000.0; }
function randChoice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randUniform(a, b) { return Math.random() * (b - a) + a; }
function randInt(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; } // inclusive both ends

// ─────────────────────────────────────────────────────────────────
// BALANCE CONSTANTS  (mirrors data/balance.py)
// ─────────────────────────────────────────────────────────────────
const BALANCE = {
  rhythm: {
    base_bpm: 60.0,
    bpm_milestone_length: 15000,
    bpm_per_milestone: 1.0,
    max_bpm: 120.0,
    timing_window_ms: 140.0,
    perfect_window_ms: 55.0,
    bite_cooldown_fraction: 0.65,
    feedback_loop_ms_per_level: 1.0,
    venom_rush_trigger_streak: 5,
    venom_rush_beats: 3,
    venom_rush_bonus_mult: 2.0,
    idle_escalation_rate: 0.02,
    idle_escalation_cap: 0.50,
    combo_tiers: [[0, 1.0], [5, 1.5], [15, 2.0], [30, 3.0], [60, 5.0], [100, 8.0]],
    combo_miss_tolerance: 2,
  },
  economy: {
    base_essence_per_press: 1.0,
    essence_per_length: 10.0,
    base_idle_fraction: 0.02,
    upgrade_cost_growth: 1.40,
    suffixes: [[1e3,'K'],[1e6,'M'],[1e9,'B'],[1e12,'T'],[1e15,'Qa'],[1e18,'Qi']],
  },
  prestige: {
    scale_multiplier_per: 0.1,
    growth_stages: [
      [0,        'Hatchling'],
      [100,      'Snakelet'],
      [250,      'Local Predator'],
      [1000,     'Regional Devourer'],
      [20000,     'National Constrictor'],
      [400000,    'Continental Coil'],
      [8000000,    'Global Serpent'],
      [160000000,   'Stellar Devourer'],
      [3200000000,   'Galactic Ouroboros'],
      [1000000000000,  'Cosmic Scale'],
    ],
  },
  events: {
    golden_min_interval_s: 45.0,
    golden_max_interval_s: 120.0,
    golden_duration_s: 8.0,
    golden_reward_multiplier: 20.0,
    frenzy_duration_s: 8.0,
    frenzy_combo_bonus_s_per_tier: 0.5,
    challenge_min_interval_s: 120.0,
    challenge_max_interval_s: 240.0,
    challenge_duration_s: 10.0,
    bargain_min_interval_s: 90.0,
    bargain_max_interval_s: 180.0,
    bargain_duration_s: 12.0,
    bargain_cost_fraction: 0.30,
    echo_min_interval_s: 200.0,
    echo_max_interval_s: 350.0,
    echo_duration_s: 30.0,
  },
  meta: {
    starting_length_bonus: 1,
    starting_length_max_purchases: 10,
  },
  tick_rate_hz: 30.0,
};

// ─────────────────────────────────────────────────────────────────
// DATA: UPGRADES  (mirrors data/upgrades.py)
// ─────────────────────────────────────────────────────────────────
const UE = {  // UpgradeEffect enum
  ESSENCE_PER_PRESS:    'ESSENCE_PER_PRESS',
  COMBO_DECAY_SLOW:     'COMBO_DECAY_SLOW',
  IDLE_INCOME_MULT:     'IDLE_INCOME_MULT',
  DOUBLE_PRESS_CHANCE:  'DOUBLE_PRESS_CHANCE',
  GOLDEN_DURATION_MULT: 'GOLDEN_DURATION_MULT',
  UPGRADE_COST_DISCOUNT:'UPGRADE_COST_DISCOUNT',
  MAX_COMBO_MULT_BONUS: 'MAX_COMBO_MULT_BONUS',
  SHED_SCALE_BONUS:     'SHED_SCALE_BONUS',
  COSMIC_INCOME_MULT:   'COSMIC_INCOME_MULT',
  COMBO_SAVE_CHANCE:    'COMBO_SAVE_CHANCE',
  AUTO_BITE_CHANCE:     'AUTO_BITE_CHANCE',
  MULTI_BITE_CHANCE:    'MULTI_BITE_CHANCE',
};

const ALL_UPGRADES = {
  fang_sharpening:   { id:'fang_sharpening',   name:'Fang Sharpening',    description:'Each press tears deeper. +50% Essence per press per level.',                                          effect:UE.ESSENCE_PER_PRESS,    value_per_level:0.5,   base_cost:25,   max_level:100, tier:0, cosmic_only:false },
  elastic_scales:    { id:'elastic_scales',     name:'Elastic Scales',     description:'Combo lingers longer. +30% combo decay time per level.',                                              effect:UE.COMBO_DECAY_SLOW,     value_per_level:0.3,   base_cost:50,   max_level:100, tier:0, cosmic_only:false },
  digestive_enzymes: { id:'digestive_enzymes',  name:'Digestive Enzymes',  description:'Digest even while resting. +50% idle income per level.',                                             effect:UE.IDLE_INCOME_MULT,     value_per_level:0.5,   base_cost:100,  max_level:100, tier:0, cosmic_only:false },
  rattletail:        { id:'rattletail',          name:'Rattletail',         description:'A lucky rattle. +8% chance of double Essence per press per level.',                                 effect:UE.DOUBLE_PRESS_CHANCE,  value_per_level:0.08,  base_cost:75,   max_level:10,  tier:0, cosmic_only:false },
  hypnotic_eyes:     { id:'hypnotic_eyes',       name:'Hypnotic Eyes',      description:'Golden events linger in your gaze. +25% duration per level.',                                       effect:UE.GOLDEN_DURATION_MULT, value_per_level:0.25,  base_cost:150,  max_level:20,  tier:0, cosmic_only:false },
  venomous_bite:     { id:'venomous_bite',       name:'Venomous Bite',      description:'Upgrades dissolve easier. -5% upgrade costs per level.',                                            effect:UE.UPGRADE_COST_DISCOUNT,value_per_level:0.05,  base_cost:250,  max_level:11,  tier:0, cosmic_only:false },
  growth_hormone:    { id:'growth_hormone',      name:'Growth Hormone',     description:'Break through combo ceilings. +1 max combo tier per level.',                                        effect:UE.MAX_COMBO_MULT_BONUS, value_per_level:1.0,   base_cost:200,  max_level:30,  tier:0, cosmic_only:false },
  resilient_fangs:   { id:'resilient_fangs',     name:'Resilient Fangs',    description:"The ouroboros refuses to let go. +15% chance a Chomp doesn't break your combo per level.",         effect:UE.COMBO_SAVE_CHANCE,    value_per_level:0.15,  base_cost:150,  max_level:6,   tier:0, cosmic_only:false },
  cascading_fangs:   { id:'cascading_fangs',     name:'Cascading Fangs',    description:'One strike births another. Each bite has a cascading chance to strike again — up to 4 times.',    effect:UE.MULTI_BITE_CHANCE,    value_per_level:0.06,  base_cost:300,  max_level:10,  tier:0, cosmic_only:false },
  ancient_wisdom:    { id:'ancient_wisdom',      name:'Ancient Wisdom',     description:'Deeper sheds. +1 bonus Scale per shed per level.',                                                  effect:UE.SHED_SCALE_BONUS,     value_per_level:1.0,   base_cost:150,  max_level:50,  tier:1, cosmic_only:false },
  ouroboros_rhythm:  { id:'ouroboros_rhythm',    name:'Ouroboros Rhythm',   description:'+30% Essence per press, stacks with Fang Sharpening.',                                             effect:UE.ESSENCE_PER_PRESS,    value_per_level:0.3,   base_cost:200,  max_level:75,  tier:1, cosmic_only:false },
  serpent_instinct:  { id:'serpent_instinct',    name:'Serpent Instinct',   description:'The snake bites by reflex. +10% chance of an automatic perfect bite each beat per level.',         effect:UE.AUTO_BITE_CHANCE,     value_per_level:0.10,  base_cost:250,  max_level:10,  tier:1, cosmic_only:false },
  stellar_coils:     { id:'stellar_coils',       name:'Stellar Coils',      description:'Stars orbit your coils. +100% cosmic income per level.',                                            effect:UE.COSMIC_INCOME_MULT,   value_per_level:1.0,   base_cost:1200, max_level:100, tier:2, cosmic_only:true  },
  nebula_nests:      { id:'nebula_nests',        name:'Nebula Nests',       description:'Idle galaxies feed you. +100% idle income per level (cosmic).',                                     effect:UE.IDLE_INCOME_MULT,     value_per_level:1.0,   base_cost:2000, max_level:100, tier:2, cosmic_only:true  },
  void_shrines:      { id:'void_shrines',        name:'Void Shrines',       description:'+50% Essence per press (cosmic).',                                                                  effect:UE.ESSENCE_PER_PRESS,    value_per_level:0.5,   base_cost:2500, max_level:100, tier:2, cosmic_only:true  },
};

const BASE_POOL   = Object.values(ALL_UPGRADES).filter(u => u.tier === 0).map(u => u.id);
const META_POOL   = Object.values(ALL_UPGRADES).filter(u => u.tier === 1).map(u => u.id);
const COSMIC_POOL = Object.values(ALL_UPGRADES).filter(u => u.tier === 2).map(u => u.id);

// ─────────────────────────────────────────────────────────────────
// DATA: ARCHETYPES  (mirrors data/archetypes.py)
// ─────────────────────────────────────────────────────────────────
const ALL_ARCHETYPES = {
  coiled_striker: {
    id:'coiled_striker', name:'Coiled Striker', tagline:'Strike fast. Strike hard.',
    description:'You live at the beat boundary. +25% Essence per press, all combo tiers grant +1.0x bonus, but the timing window is 20% tighter and idle income is halved.',
    starting_upgrades:{},
    preferred_pool:['fang_sharpening','rattletail','growth_hormone','resilient_fangs'],
    epp_mult:1.25, idle_mult:0.5, timing_mult:0.80, combo_tier_bonus:1.0,
  },
  patient_ouroboros: {
    id:'patient_ouroboros', name:'Patient Ouroboros', tagline:'The coil tightens while you rest.',
    description:'You grow in silence. Idle income is 2.5x and you are immune to debuffs, but active Essence per press is reduced by 20% and combo builds at half speed.',
    starting_upgrades:{},
    preferred_pool:['digestive_enzymes','elastic_scales','hypnotic_eyes','serpent_instinct'],
    epp_mult:0.8, idle_mult:2.5, timing_mult:1.0, combo_tier_bonus:0.0, debuff_immune:true,
  },
  rhythm_incarnate: {
    id:'rhythm_incarnate', name:'Rhythm Incarnate', tagline:'You are the beat.',
    description:'Pure tempo mastery. No starting upgrades, but the perfect window is 40% wider and Venom Rush triggers after only 3 perfect bites instead of 5.',
    starting_upgrades:{},
    preferred_pool:['fang_sharpening','ouroboros_rhythm','growth_hormone','venomous_bite'],
    epp_mult:1.0, idle_mult:1.0, timing_mult:1.0, combo_tier_bonus:0.0,
  },
};

// ─────────────────────────────────────────────────────────────────
// DATA: DEBUFFS — triggered by player skill failures, temporary (~8 s)
// ─────────────────────────────────────────────────────────────────
const DEBUFF_DURATION_S = 8.0;  // mirrors golden_duration_s
const ALL_DEBUFFS = {
  reckless_strike:  { id:'reckless_strike',  name:'Reckless Strike',  description:'Timing window −30% — impatience costs precision.'  },
  shattered_rhythm: { id:'shattered_rhythm', name:'Shattered Rhythm', description:'Combo breaks twice as fast.'                       },
  sluggish_jaw:     { id:'sluggish_jaw',     name:'Sluggish Jaw',     description:'Bite cooldown +40% longer.'                        },
  leaking_venom:    { id:'leaking_venom',    name:'Leaking Venom',    description:'−25% Essence per press.'                           },
  hollow_scales:    { id:'hollow_scales',    name:'Hollow Scales',    description:'Idle income halved.'                               },
};

// Apply a debuff only if none is currently active.
function _applyDebuff(state, debuffId) {
  if (state.debuff_id) return false;
  // Patient Ouroboros is immune to debuffs
  const arch = ALL_ARCHETYPES[state.archetype_id];
  if (arch && arch.debuff_immune) return false;
  state.debuff_id = debuffId;
  state.debuff_end_time = now() + DEBUFF_DURATION_S;
  return true;
}

// Clear expired debuff each tick.
function tickDebuff(state) {
  if (state.debuff_id && now() >= state.debuff_end_time) {
    state.debuff_id = '';
    state.debuff_end_time = 0.0;
  }
}

// ─────────────────────────────────────────────────────────────────
// ARCHETYPE RESONANCE  (earned through playstyle, not assigned at random)
// ─────────────────────────────────────────────────────────────────
// Thresholds:
//   Rhythm Incarnate  — 8 consecutive perfect bites (no misses or goods in between)
//   Coiled Striker    — sustain 5.0x combo (60+ hits) for 15 unbroken seconds
//   Patient Ouroboros — accumulate 45 idle seconds in the run

const ARCHETYPE_OFFER_DURATION_S = 25.0;
const PEAK_COMBO_HITS    = 60;  // 5.0x tier threshold
const PATIENCE_THRESHOLD = 45;  // idle seconds
const PERFECTS_THRESHOLD = 8;   // consecutive perfect bites
const PEAK_COMBO_SECS    = 15;  // seconds sustained at peak

function tickArchetypeResonance(state, dt) {
  const t = now();

  // Expire a pending offer
  if (state.archetype_offer_id && t >= state.archetype_offer_expires) {
    const expired = state.archetype_offer_id;
    state.archetype_offer_id = '';
    state.archetype_offer_expires = 0.0;
    return `archetype_offer_expired:${expired}`;
  }

  // Don’t generate a new offer while one is already pending
  if (state.archetype_offer_id) return null;

  // Update combo_peak_seconds: must be SUSTAINED, resets if combo drops
  if (state.combo_hits >= PEAK_COMBO_HITS) {
    state.combo_peak_seconds += dt;
  } else {
    state.combo_peak_seconds = 0.0;
  }

  // Check conditions — never offer the currently active archetype
  if (state.resonance_perfects >= PERFECTS_THRESHOLD
      && state.archetype_id !== 'rhythm_incarnate') {
    state.archetype_offer_id = 'rhythm_incarnate';
    state.archetype_offer_expires = t + ARCHETYPE_OFFER_DURATION_S;
    return 'archetype_awakened:rhythm_incarnate';
  }
  if (state.combo_peak_seconds >= PEAK_COMBO_SECS
      && state.archetype_id !== 'coiled_striker') {
    state.archetype_offer_id = 'coiled_striker';
    state.archetype_offer_expires = t + ARCHETYPE_OFFER_DURATION_S;
    state.combo_peak_seconds = 0.0;
    return 'archetype_awakened:coiled_striker';
  }
  if (state.idle_seconds >= PATIENCE_THRESHOLD
      && state.archetype_id !== 'patient_ouroboros') {
    state.archetype_offer_id = 'patient_ouroboros';
    state.archetype_offer_expires = t + ARCHETYPE_OFFER_DURATION_S;
    state.idle_seconds = 0.0; // reset so we don’t immediately re-trigger
    return 'archetype_awakened:patient_ouroboros';
  }

  return null;
}

// Accept the pending archetype offer: apply bonuses, reset counters.
function acceptArchetype(state) {
  const id = state.archetype_offer_id;
  if (!id) return false;
  const arch = ALL_ARCHETYPES[id];
  if (!arch) return false;

  state.archetype_id = id;
  state.archetype_offer_id = '';
  state.archetype_offer_expires = 0.0;
  state.combo_peak_seconds = 0.0;
  state.resonance_perfects = 0;

  // Gift the archetype’s starting upgrades as a free bonus (+1 per key)
  for (const [uid, giftLevel] of Object.entries(arch.starting_upgrades)) {
    const current = state.upgrade_levels[uid] || 0;
    const udef = ALL_UPGRADES[uid];
    if (udef) state.upgrade_levels[uid] = Math.min(current + giftLevel, udef.max_level);
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────
// DATA: ASCENSION UPGRADES  (mirrors data/ascension_upgrades.py)
// ─────────────────────────────────────────────────────────────────
const AE = {  // AscensionEffect enum
  STARTING_ESSENCE: 'STARTING_ESSENCE',
  STARTING_LENGTH:  'STARTING_LENGTH',
  IDLE_BONUS:       'IDLE_BONUS',
  EPP_MULT:         'EPP_MULT',
  SHED_SCALES_MULT: 'SHED_SCALES_MULT',
  MAX_BPM_BONUS:    'MAX_BPM_BONUS',
  EXTRA_OFFERING:   'EXTRA_OFFERING',
};

const ASCENSION_UPGRADES = {
  serpent_memory: { id:'serpent_memory', name:'Serpent Memory',  description:'+50 starting Essence per level',       effect:AE.STARTING_ESSENCE, value_per_level:50.0, base_cost:50_000,  cost_growth:2.0, max_level:10 },
  ancient_coil:   { id:'ancient_coil',   name:'Ancient Coil',    description:'+10 starting Length per level',        effect:AE.STARTING_LENGTH,  value_per_level:10.0, base_cost:100_000, cost_growth:2.5, max_level:5  },
  endless_drift:  { id:'endless_drift',  name:'Endless Drift',   description:'Idle income × (1 + 10% per level)',    effect:AE.IDLE_BONUS,       value_per_level:0.10, base_cost:200_000, cost_growth:2.5, max_level:5  },
  serpent_hoard:  { id:'serpent_hoard',  name:"Serpent's Hoard", description:'+1 upgrade offering slot per level',   effect:AE.EXTRA_OFFERING,   value_per_level:1.0,  base_cost:500_000, cost_growth:3.0, max_level:3  },
  void_fang:      { id:'void_fang',      name:'Void Fang',       description:'Global EPP × (1 + 50% per level)',     effect:AE.EPP_MULT,         value_per_level:0.50, base_cost:400_000, cost_growth:2.5, max_level:5  },
  scale_harvest:  { id:'scale_harvest',  name:'Scale Harvest',   description:'Scales per shed × (1 + 25% per level)',effect:AE.SHED_SCALES_MULT, value_per_level:0.25, base_cost:250_000, cost_growth:2.5, max_level:5  },
  cosmic_tempo:   { id:'cosmic_tempo',   name:'Cosmic Tempo',    description:'+10 max BPM cap per level',            effect:AE.MAX_BPM_BONUS,    value_per_level:10.0, base_cost:300_000, cost_growth:2.5, max_level:5  },
};

function ascCostAtLevel(udef, currentLevel) {
  return Math.floor(udef.base_cost * Math.pow(udef.cost_growth, currentLevel));
}

// ─────────────────────────────────────────────────────────────────
// GAME STATE  (mirrors engine/game_state.py)
// ─────────────────────────────────────────────────────────────────
function newRunStats(overrides = {}) {
  return Object.assign({
    peak_length: 0,
    total_essence_earned: 0.0,
    total_presses: 0,
    sheds: 0,
    combo_high: 1.0,
    golden_caught: 0,
    golden_missed: 0,
    challenges_completed: 0,
    challenges_failed: 0,
    run_start_time: now(),
  }, overrides);
}

function newGameState(overrides = {}) {
  const t = now();
  return Object.assign({
    essence: 0.0,
    snake_length: 3,
    current_stage_index: 0,
    scales: 0.0,
    total_scales_earned: 0.0,
    archetype_id: '',
    curse_id: '',          // legacy field — kept for save-data compat only
    debuff_id: '',         // active temporary debuff id
    debuff_end_time: 0.0,  // epoch when debuff expires
    miss_streak: 0,        // consecutive out-of-window presses
    resonance_perfects: 0, // consecutive perfects (doesn’t reset on Venom Rush)
    combo_peak_seconds: 0.0,    // sustained seconds at 5.0x+ combo
    archetype_offer_id: '',     // archetype currently being offered
    archetype_offer_expires: 0.0,
    combo_hits: 0,
    combo_multiplier: 1.0,
    combo_misses: 0,
    last_press_time: 0.0,
    press_timestamps: [],      // ring buffer of last 10 press times for rolling BPM
    rolling_bpm: 0.0,          // avg BPM over last 10 presses
    beat_origin: t,
    last_scored_beat_index: -1,
    last_auto_bite_beat_index: -1,
    idle_seconds: 0.0,
    perfect_streak: 0,
    venom_rush_active: false,
    venom_rush_end_beat: -1,
    mouth_open: true,
    bite_cooldown_until: 0.0,
    last_bite_result: '',
    upgrade_levels: {},
    ascension_upgrade_levels: {},
    golden_active: false,
    golden_end_time: 0.0,
    frenzy_active: false,
    frenzy_end_time: 0.0,
    frenzy_presses: 0,
    challenge_active: false,
    challenge_type: '',
    challenge_end_time: 0.0,
    challenge_target: 0.0,
    challenge_progress: 0.0,
    challenge_combo_target: 0.0,  // for COMBO_SUSTAIN: the required multiplier level
    current_offerings: [],
    essence_per_press: 1.0,
    idle_income_per_s: 0.0,
    post_frenzy_bpm: 0.0,
    post_frenzy_next_step: 0.0,
    stats: newRunStats(),
  }, overrides);
}

function newMetaState(overrides = {}) {
  return Object.assign({
    serpent_knowledge: 0,
    starting_length_bonus: 0,
    unlocked_upgrade_ids: [],
    unlocked_event_types: [],
    ascension_count: 0,
    ascension_upgrade_levels: {},
    unlocked_skins: ['emerald'],
    collected_lore_ids: [],
    active_skin: 'emerald',
    total_runs: 0,
    best_peak_length: 0,
    best_total_essence: 0.0,
    total_golden_caught: 0,
    total_challenges_completed: 0,
  }, overrides);
}

// ─────────────────────────────────────────────────────────────────
// META HELPERS  (mirrors engine/meta.py)
// ─────────────────────────────────────────────────────────────────
function getStartingLength(meta) {
  return 3 + meta.starting_length_bonus * BALANCE.meta.starting_length_bonus;
}

function getUnlockedUpgradeSet(meta) {
  return new Set(meta.unlocked_upgrade_ids);
}

function applyAscensionStartingBonuses(meta, state) {
  state.ascension_upgrade_levels = Object.assign({}, meta.ascension_upgrade_levels);
  for (const [uid, level] of Object.entries(meta.ascension_upgrade_levels)) {
    if (level <= 0) continue;
    const udef = ASCENSION_UPGRADES[uid];
    if (!udef) continue;
    if (udef.effect === AE.STARTING_ESSENCE) {
      state.essence += udef.value_per_level * level;
    } else if (udef.effect === AE.STARTING_LENGTH) {
      const bonus = Math.floor(udef.value_per_level * level);
      state.snake_length = Math.max(state.snake_length, 3) + bonus;
      state.essence = Math.max(state.essence, state.snake_length * BALANCE.economy.essence_per_length);
    }
  }
}

function computeKnowledgeReward(stats) {
  if (stats.peak_length <= 0) return 0;
  return Math.max(1, Math.floor(Math.log2(Math.max(1, stats.peak_length)))) + stats.sheds;
}

function applyRunResults(meta, stats) {
  const knowledge = computeKnowledgeReward(stats);
  meta.serpent_knowledge += knowledge;
  meta.total_runs += 1;
  if (stats.peak_length > meta.best_peak_length) meta.best_peak_length = stats.peak_length;
  if (stats.total_essence_earned > meta.best_total_essence) meta.best_total_essence = stats.total_essence_earned;
  meta.total_golden_caught += stats.golden_caught;
  meta.total_challenges_completed += stats.challenges_completed;
  return knowledge;
}

// ─────────────────────────────────────────────────────────────────
// ECONOMY ENGINE  (mirrors engine/economy.py)
// ─────────────────────────────────────────────────────────────────
function computeDerived(state) {
  const bal = BALANCE.economy;
  let epp = bal.base_essence_per_press;

  // Upgrade multipliers
  for (const [uid, level] of Object.entries(state.upgrade_levels)) {
    const udef = ALL_UPGRADES[uid];
    if (udef && udef.effect === UE.ESSENCE_PER_PRESS && level > 0)
      epp *= 1.0 + udef.value_per_level * level;
  }

  // Scales multiplier
  epp *= 1.0 + state.scales * BALANCE.prestige.scale_multiplier_per;

  // Combo
  epp *= state.combo_multiplier;

  // Archetype
  const arch = ALL_ARCHETYPES[state.archetype_id];
  if (arch) epp *= arch.epp_mult;

  // Debuff: leaking_venom — −25% EPP for a short time
  if (state.debuff_id === 'leaking_venom') epp *= 0.75;

  // Ascension: void_fang (EPP_MULT)
  for (const [uid, level] of Object.entries(state.ascension_upgrade_levels)) {
    const udef = ASCENSION_UPGRADES[uid];
    if (udef && udef.effect === AE.EPP_MULT && level > 0)
      epp *= 1.0 + udef.value_per_level * level;
  }

  // Cosmic income (COSMIC_INCOME_MULT)
  for (const [uid, level] of Object.entries(state.upgrade_levels)) {
    const udef = ALL_UPGRADES[uid];
    if (udef && udef.effect === UE.COSMIC_INCOME_MULT && level > 0)
      epp *= 1.0 + udef.value_per_level * level;
  }

  state.essence_per_press = epp;

  // Idle income
  let idle = epp * bal.base_idle_fraction;
  for (const [uid, level] of Object.entries(state.upgrade_levels)) {
    const udef = ALL_UPGRADES[uid];
    if (udef && udef.effect === UE.IDLE_INCOME_MULT && level > 0)
      idle *= 1.0 + udef.value_per_level * level;
  }
  if (arch) idle *= arch.idle_mult;

  // Ascension: endless_drift (IDLE_BONUS)
  for (const [uid, level] of Object.entries(state.ascension_upgrade_levels)) {
    const udef = ASCENSION_UPGRADES[uid];
    if (udef && udef.effect === AE.IDLE_BONUS && level > 0)
      idle *= 1.0 + udef.value_per_level * level;
  }

  // Debuff: hollow_scales — idle income halved for a short time
  if (state.debuff_id === 'hollow_scales') idle *= 0.5;

  state.idle_income_per_s = idle;
}

function handlePress(state) {
  let earned = state.essence_per_press;

  // Rattletail: double press chance
  let doubleChance = 0.0;
  for (const [uid, level] of Object.entries(state.upgrade_levels)) {
    const udef = ALL_UPGRADES[uid];
    if (udef && udef.effect === UE.DOUBLE_PRESS_CHANCE && level > 0)
      doubleChance += udef.value_per_level * level;
  }
  if (doubleChance > 0 && Math.random() < Math.min(doubleChance, 0.95)) earned *= 2.0;

  // Cascading Fangs: Bernoulli chain up to 4 total
  let chainChance = 0.0;
  for (const [uid, level] of Object.entries(state.upgrade_levels)) {
    const udef = ALL_UPGRADES[uid];
    if (udef && udef.effect === UE.MULTI_BITE_CHANCE && level > 0)
      chainChance += udef.value_per_level * level;
  }
  chainChance = Math.min(chainChance, 0.80);
  if (chainChance > 0) {
    let extra = 0;
    while (extra < 3 && Math.random() < chainChance) extra++;
    earned *= (1 + extra);
  }

  state.essence += earned;
  state.stats.total_essence_earned += earned;
  state.stats.total_presses += 1;

  // Venom Rush bonus
  if (state.venom_rush_active) {
    const bonus = state.combo_multiplier * BALANCE.rhythm.venom_rush_bonus_mult;
    state.essence += bonus;
    state.stats.total_essence_earned += bonus;
  }

  // Snake growth
  const epl = BALANCE.economy.essence_per_length;
  state.snake_length = 3 + Math.floor(state.essence / epl);
  if (state.snake_length > state.stats.peak_length) state.stats.peak_length = state.snake_length;

  return earned;
}

function tickIdle(state, dt) {
  const earned = state.idle_income_per_s * dt;
  if (earned > 0) {
    state.essence += earned;
    state.stats.total_essence_earned += earned;
    const epl = BALANCE.economy.essence_per_length;
    state.snake_length = 3 + Math.floor(state.essence / epl);
    if (state.snake_length > state.stats.peak_length) state.stats.peak_length = state.snake_length;
  }
  return earned;
}

function getUpgradeCost(state, uid) {
  const udef = ALL_UPGRADES[uid];
  const level = state.upgrade_levels[uid] || 0;
  let cost = udef.base_cost * Math.pow(BALANCE.economy.upgrade_cost_growth, level);

  for (const [id2, lvl] of Object.entries(state.upgrade_levels)) {
    const ud = ALL_UPGRADES[id2];
    if (ud && ud.effect === UE.UPGRADE_COST_DISCOUNT && lvl > 0)
      cost *= Math.max(0.45, 1.0 - ud.value_per_level * lvl);
  }

  return cost;
}

function purchaseUpgrade(state, uid) {
  const udef = ALL_UPGRADES[uid];
  if (!udef) return false;
  const currentLevel = state.upgrade_levels[uid] || 0;
  if (currentLevel >= udef.max_level) return false;
  const cost = getUpgradeCost(state, uid);
  if (state.essence < cost) return false;

  state.essence -= cost;
  const epl = BALANCE.economy.essence_per_length;
  state.snake_length = 3 + Math.floor(state.essence / epl);
  state.upgrade_levels[uid] = currentLevel + 1;
  computeDerived(state);
  return true;
}

function formatNumber(n) {
  if (n < 0) return '-' + formatNumber(-n);
  const suffixes = BALANCE.economy.suffixes;
  for (let i = suffixes.length - 1; i >= 0; i--) {
    const [threshold, suffix] = suffixes[i];
    if (n >= threshold) {
      const value = n / threshold;
      if (value >= 100) return `${value.toFixed(0)}${suffix}`;
      if (value >= 10)  return `${value.toFixed(1)}${suffix}`;
      return `${value.toFixed(2)}${suffix}`;
    }
  }
  if (n >= 100) return n.toFixed(0);
  if (n >= 10)  return n.toFixed(1);
  if (n === Math.floor(n)) return String(Math.floor(n));
  return n.toFixed(1);
}

// ─────────────────────────────────────────────────────────────────
// RHYTHM ENGINE  (mirrors engine/rhythm.py)
// ─────────────────────────────────────────────────────────────────
function _getBeatInterval(state) {
  return 60.0 / getCurrentBpm(state);
}

function _getTimingWindow(state) {
  let ms = BALANCE.rhythm.timing_window_ms;
  const totalLevels = Object.values(state.upgrade_levels).reduce((a, b) => a + b, 0);
  ms += totalLevels * BALANCE.rhythm.feedback_loop_ms_per_level;
  let window = ms / 1000.0;
  const arch = ALL_ARCHETYPES[state.archetype_id];
  if (arch) window *= arch.timing_mult;
  // Debuff: reckless_strike — timing window narrowed
  if (state.debuff_id === 'reckless_strike') window *= 0.70;
  return window;
}

function _getPerfectWindow(state) {
  let ms = BALANCE.rhythm.perfect_window_ms;
  if (state.archetype_id === 'rhythm_incarnate') ms *= 1.40;
  return ms / 1000.0;
}

function _getBiteCooldownFraction(state) {
  let frac = BALANCE.rhythm.bite_cooldown_fraction;
  if (state.debuff_id === 'sluggish_jaw') frac *= 1.40;
  return Math.min(frac, 0.95);
}

function _resolveComboMultiplier(state) {
  const tiers = BALANCE.rhythm.combo_tiers;
  const maxTierHits = tiers[tiers.length - 1][0];
  const arch = ALL_ARCHETYPES[state.archetype_id];
  const tierBonus = arch ? arch.combo_tier_bonus : 0.0;

  let topTierBonus = 0.0;
  for (const [uid, level] of Object.entries(state.upgrade_levels)) {
    const udef = ALL_UPGRADES[uid];
    if (udef && udef.effect === UE.MAX_COMBO_MULT_BONUS && level > 0)
      topTierBonus += udef.value_per_level * level;
  }

  let mult = 1.0;
  for (const [hitsNeeded, m] of tiers) {
    if (state.combo_hits >= hitsNeeded) {
      let bonus = tierBonus;
      if (hitsNeeded === maxTierHits) bonus += topTierBonus;
      mult = m + bonus;
    }
  }
  return Math.max(mult, 1.0);
}

function _getSaveChance(state) {
  let chance = 0.0;
  for (const [uid, level] of Object.entries(state.upgrade_levels)) {
    const udef = ALL_UPGRADES[uid];
    if (udef && udef.effect === UE.COMBO_SAVE_CHANCE && level > 0)
      chance += udef.value_per_level * level;
  }
  return Math.min(chance, 0.95);
}

function _applyMiss(state) {
  state.combo_misses += 1;
  state.miss_streak = (state.miss_streak || 0) + 1;
  state.resonance_perfects = 0; // any miss breaks the perfect streak
  let tolerance = BALANCE.rhythm.combo_miss_tolerance;
  // Debuff: shattered_rhythm — combo breaks twice as fast
  if (state.debuff_id === 'shattered_rhythm') tolerance = Math.max(1, Math.floor(tolerance / 2));
  if (state.combo_misses >= tolerance) {
    state.combo_hits = 0;
    state.combo_misses = 0;
    state.combo_multiplier = 1.0;
  }
  // 3 consecutive out-of-window presses → hollow_scales
  if (state.miss_streak >= 3) {
    _applyDebuff(state, 'hollow_scales');
    state.miss_streak = 0;
  }
}

function getCurrentBpm(state) {
  const bal = BALANCE.rhythm;
  // Apply cosmic_tempo ascension upgrade (MAX_BPM_BONUS)
  let maxBpm = bal.max_bpm;
  for (const [uid, level] of Object.entries(state.ascension_upgrade_levels)) {
    const udef = ASCENSION_UPGRADES[uid];
    if (udef && udef.effect === AE.MAX_BPM_BONUS && level > 0)
      maxBpm += udef.value_per_level * level;
  }

  // BPM ramps from base toward max based on progress through the current stage.
  // Each stage starts at base_bpm and approaches max_bpm as you near the shed threshold.
  const stages = BALANCE.prestige.growth_stages;
  const idx    = state.current_stage_index;

  // Current stage floor and next stage ceiling
  const stageFloor   = stages[idx]   ? stages[idx][0]   : 0;
  const nextIdx      = idx + 1;
  const stageCeiling = nextIdx < stages.length ? stages[nextIdx][0] : stages[idx][0] * 2;

  // Progress 0..1 through the current stage
  const range    = Math.max(1, stageCeiling - stageFloor);
  const progress = Math.min(1.0, Math.max(0.0, (state.snake_length - stageFloor) / range));

  // Smooth ramp: base → max, snapped to nearest 10 BPM
  const rawBpm  = bal.base_bpm + progress * (maxBpm - bal.base_bpm);
  const snapped = Math.round(rawBpm / 10) * 10;
  const natural = Math.max(bal.base_bpm, Math.min(snapped, maxBpm));

  if (state.post_frenzy_bpm > natural) return state.post_frenzy_bpm;
  return natural;
}

function getBeatProgress(state) {
  const beatInterval = _getBeatInterval(state);
  const elapsed = now() - state.beat_origin;
  return ((elapsed % beatInterval) + beatInterval) % beatInterval / beatInterval;
}

function getTimingWindowS(state) { return _getTimingWindow(state); }
function getPerfectWindowS(state) { return _getPerfectWindow(state); }
function getBiteCooldownS(state)  { return _getBeatInterval(state) * _getBiteCooldownFraction(state); }

// Rolling BPM — keeps a ring buffer of the last 10 manual press timestamps and
// computes the average inter-press BPM. Called by attemptBite on every press.
function _updateRollingBpm(state, tNow) {
  state.press_timestamps.push(tNow);
  if (state.press_timestamps.length > 10) state.press_timestamps.shift();
  if (state.press_timestamps.length < 2) { state.rolling_bpm = 0; return; }
  let totalInterval = 0;
  let count = 0;
  for (let i = 1; i < state.press_timestamps.length; i++) {
    const interval = state.press_timestamps[i] - state.press_timestamps[i - 1];
    if (interval > 0) { totalInterval += interval; count++; }
  }
  state.rolling_bpm = count > 0 ? 60.0 / (totalInterval / count) : 0;
}

// attemptBite
// tAt  — beat-position timestamp from last rAF frame (_beatCache.t).
//        Used only for scoring so cursor pixel and evaluation are aligned.
// Cooldown gating always uses the real wall-clock time so a stale rAF
// timestamp never silently drops a valid press.
function attemptBite(state, tAt) {
  const tNow = now();
  const t    = (tAt !== undefined) ? tAt : tNow;

  if (state.frenzy_active) {
    state.frenzy_presses += 1;
    state.combo_hits += 1;
    state.combo_misses = 0;
    state.combo_multiplier = _resolveComboMultiplier(state);
    if (state.combo_multiplier > state.stats.combo_high) state.stats.combo_high = state.combo_multiplier;
    state.last_press_time = tNow;
    _updateRollingBpm(state, tNow);
    const beatInterval = _getBeatInterval(state);
    const elapsed = t - state.beat_origin;
    const beatPos = ((elapsed % beatInterval) + beatInterval) % beatInterval;
    const cycleIdx = Math.floor(elapsed / beatInterval);
    state.last_scored_beat_index = (beatPos > beatInterval * 0.5) ? cycleIdx + 1 : cycleIdx;
    state.last_bite_result = 'perfect';
    return 'perfect';
  }

  // FEED_FRENZY challenge: snap cursor pinned to centre — no timing window, no
  // cooldown gate. Every press scores as perfect; win is determined by rolling
  // BPM average at expiry.
  if (state.challenge_active && state.challenge_type === 'FEED_FRENZY') {
    const trigger = state.archetype_id === 'rhythm_incarnate' ? 3 : BALANCE.rhythm.venom_rush_trigger_streak;
    state.combo_hits += 2;
    state.combo_misses = 0;
    state.combo_multiplier = _resolveComboMultiplier(state);
    if (state.combo_multiplier > state.stats.combo_high) state.stats.combo_high = state.combo_multiplier;
    state.perfect_streak += 1;
    if (state.perfect_streak >= trigger) {
      const curBeat = Math.floor((tNow - state.beat_origin) / _getBeatInterval(state));
      state.venom_rush_active   = true;
      state.venom_rush_end_beat = curBeat + BALANCE.rhythm.venom_rush_beats;
      state.perfect_streak = 0;
    }
    state.miss_streak = 0;
    state.resonance_perfects += 1;
    state.last_press_time = tNow;
    _updateRollingBpm(state, tNow);
    state.last_bite_result = 'perfect';
    return 'perfect';
  }

  // Cooldown gate — always use real time, never the stale rAF timestamp.
  if (tNow < state.bite_cooldown_until) return null;

  const beatInterval  = _getBeatInterval(state);
  const timingWindow  = _getTimingWindow(state);
  const perfectWindow = _getPerfectWindow(state);
  const elapsed       = t - state.beat_origin;
  const beatPos       = ((elapsed % beatInterval) + beatInterval) % beatInterval;
  const currentBeatIndex = Math.floor(elapsed / beatInterval);
  const dist          = Math.min(beatPos, beatInterval - beatPos);

  // Which beat is the player actually targeting?
  // Early hits (beatPos > half interval) are aiming at the NEXT beat.
  // Late hits (beatPos <= half interval) are aiming at the CURRENT beat.
  const scoredBeatIndex = (beatPos > beatInterval * 0.5)
    ? currentBeatIndex + 1
    : currentBeatIndex;

  // Lock mouth for one cooldown period.
  const cooldown = beatInterval * _getBiteCooldownFraction(state);
  state.mouth_open         = false;
  state.bite_cooldown_until = tNow + cooldown;
  state.last_press_time    = tNow;
  _updateRollingBpm(state, tNow);

  // Same beat already scored — discard silently.
  if (scoredBeatIndex === state.last_scored_beat_index) return null;

  if (dist <= perfectWindow) {
    state.last_scored_beat_index = scoredBeatIndex;
    state.combo_hits  += 2;
    state.combo_misses = 0;
    state.combo_multiplier = _resolveComboMultiplier(state);
    if (state.combo_multiplier > state.stats.combo_high) state.stats.combo_high = state.combo_multiplier;
    const trigger = state.archetype_id === 'rhythm_incarnate' ? 3 : BALANCE.rhythm.venom_rush_trigger_streak;
    state.perfect_streak += 1;
    if (state.perfect_streak >= trigger) {
      state.venom_rush_active  = true;
      state.venom_rush_end_beat = currentBeatIndex + BALANCE.rhythm.venom_rush_beats;
      state.perfect_streak = 0;
    }
    state.miss_streak = 0;
    state.resonance_perfects += 1;
    state.last_bite_result = 'perfect';
    return 'perfect';
  }

  if (dist <= timingWindow) {
    state.last_scored_beat_index = scoredBeatIndex;
    state.combo_hits  += 1;
    state.combo_misses = 0;
    state.combo_multiplier = _resolveComboMultiplier(state);
    if (state.combo_multiplier > state.stats.combo_high) state.stats.combo_high = state.combo_multiplier;
    state.perfect_streak     = 0;
    state.miss_streak        = 0;
    state.resonance_perfects = 0;
    state.last_bite_result   = 'good';
    return 'good';
  }

  state.perfect_streak = 0;
  if (Math.random() < _getSaveChance(state)) { state.last_bite_result = 'saved'; return 'saved'; }
  _applyMiss(state);
  state.last_bite_result = 'miss';
  return 'miss';
}

function tickMouth(state) {
  // Keep mouth_open in sync for UI indicators (BITE! / wait).
  // Cooldown gating in attemptBite uses now() directly, so this
  // is only needed for the visual jaw display.
  state.mouth_open = now() >= state.bite_cooldown_until;
}

function tickVenomRush(state) {
  if (!state.venom_rush_active) return;
  const beatInterval = _getBeatInterval(state);
  const elapsed = now() - state.beat_origin;
  const currentBeat = Math.floor(elapsed / beatInterval);
  if (currentBeat >= state.venom_rush_end_beat) state.venom_rush_active = false;
}

function tickAutoBite(state) {
  if (state.frenzy_active) return null;

  let chance = 0.0;
  for (const [uid, level] of Object.entries(state.upgrade_levels)) {
    const udef = ALL_UPGRADES[uid];
    if (udef && udef.effect === UE.AUTO_BITE_CHANCE && level > 0)
      chance += udef.value_per_level * level;
  }
  if (chance <= 0.0) return null;

  const idleBonus = Math.min(
    state.idle_seconds * BALANCE.rhythm.idle_escalation_rate,
    BALANCE.rhythm.idle_escalation_cap,
  );
  const totalChance = Math.min(chance + idleBonus, 0.95);

  const t = now();
  const beatInterval = _getBeatInterval(state);
  const elapsed = t - state.beat_origin;
  const currentBeatIndex = Math.floor(elapsed / beatInterval);

  if (currentBeatIndex <= state.last_auto_bite_beat_index) return null;
  state.last_auto_bite_beat_index = currentBeatIndex;

  if (Math.random() >= totalChance) return null;
  if (!state.mouth_open) return null;

  const cooldown = beatInterval * BALANCE.rhythm.bite_cooldown_fraction;
  state.mouth_open = false;
  state.bite_cooldown_until = t + cooldown;
  state.last_press_time = t;
  state.last_scored_beat_index = currentBeatIndex;
  state.combo_hits += 2;
  state.combo_misses = 0;
  state.combo_multiplier = _resolveComboMultiplier(state);
  if (state.combo_multiplier > state.stats.combo_high) state.stats.combo_high = state.combo_multiplier;
  state.last_bite_result = 'perfect';
  return 'perfect';
}

function tickComboDecay(state) {
  if (state.combo_hits === 0 || state.frenzy_active) return;
  const beatInterval = _getBeatInterval(state);
  const elapsed = now() - state.beat_origin;
  const currentBeatIndex = Math.floor(elapsed / beatInterval);
  const missed = currentBeatIndex - state.last_scored_beat_index;

  let tolerance = BALANCE.rhythm.combo_miss_tolerance;
  for (const [uid, level] of Object.entries(state.upgrade_levels)) {
    const udef = ALL_UPGRADES[uid];
    if (udef && udef.effect === UE.COMBO_DECAY_SLOW && level > 0)
      tolerance = Math.round(tolerance * (1.0 + udef.value_per_level * level));
  }

  if (missed >= tolerance) {
    const hadCombo = state.combo_hits > 0;
    state.combo_hits = 0;
    state.combo_misses = 0;
    state.combo_multiplier = 1.0;
    // Missing enough beats to break a built-up combo → leaking_venom
    if (hadCombo) _applyDebuff(state, 'leaking_venom');
  }
}

function tickPostFrenzyBpm(state) {
  if (state.post_frenzy_bpm <= 0.0) return;
  const t = now();
  if (t < state.post_frenzy_next_step) return;
  const bal = BALANCE.rhythm;

  // Compute the same stage-progress natural BPM (without post-frenzy override)
  let maxBpm = bal.max_bpm;
  for (const [uid, level] of Object.entries(state.ascension_upgrade_levels)) {
    const udef = ASCENSION_UPGRADES[uid];
    if (udef && udef.effect === AE.MAX_BPM_BONUS && level > 0)
      maxBpm += udef.value_per_level * level;
  }
  const stages = BALANCE.prestige.growth_stages;
  const idx    = state.current_stage_index;
  const stageFloor   = stages[idx] ? stages[idx][0] : 0;
  const nextIdx      = idx + 1;
  const stageCeiling = nextIdx < stages.length ? stages[nextIdx][0] : stages[idx][0] * 2;
  const range    = Math.max(1, stageCeiling - stageFloor);
  const progress = Math.min(1.0, Math.max(0.0, (state.snake_length - stageFloor) / range));
  const rawBpm   = bal.base_bpm + progress * (maxBpm - bal.base_bpm);
  const snapped  = Math.round(rawBpm / 10) * 10;
  const natural  = Math.max(bal.base_bpm, Math.min(snapped, maxBpm));

  state.post_frenzy_bpm = Math.max(state.post_frenzy_bpm - 10.0, natural);
  if (state.post_frenzy_bpm <= natural) state.post_frenzy_bpm = 0.0;
  else state.post_frenzy_next_step = t + 5.0;
}

// ─────────────────────────────────────────────────────────────────
// PRESTIGE ENGINE  (mirrors engine/prestige.py)
// ─────────────────────────────────────────────────────────────────
function canShed(state) {
  const stages = BALANCE.prestige.growth_stages;
  const nextIndex = state.current_stage_index + 1;
  if (nextIndex >= stages.length) return false;
  return state.snake_length >= stages[nextIndex][0];
}

function canAscend(state) {
  const stages = BALANCE.prestige.growth_stages;
  const finalIndex = stages.length - 1;
  if (state.current_stage_index !== finalIndex) return false;
  return state.snake_length >= stages[finalIndex][0];
}

function computeScalesReward(state) {
  let base = Math.floor(Math.sqrt(state.snake_length));

  for (const [uid, level] of Object.entries(state.upgrade_levels)) {
    const udef = ALL_UPGRADES[uid];
    if (udef && udef.effect === UE.SHED_SCALE_BONUS && level > 0)
      base += udef.value_per_level * level;
  }

  for (const [uid, level] of Object.entries(state.ascension_upgrade_levels)) {
    const udef = ASCENSION_UPGRADES[uid];
    if (udef && udef.effect === AE.SHED_SCALES_MULT && level > 0)
      base *= 1.0 + udef.value_per_level * level;
  }

  return base;
}

function performShed(state) {
  if (!canShed(state)) return 0.0;
  const scalesEarned = computeScalesReward(state);
  state.current_stage_index += 1;
  const newThreshold = BALANCE.prestige.growth_stages[state.current_stage_index][0];
  const newLength = Math.max(3, Math.floor(newThreshold / 2));
  const newEssence = newLength * BALANCE.economy.essence_per_length;

  state.scales += scalesEarned;
  state.total_scales_earned += scalesEarned;
  state.snake_length = newLength;
  state.essence = newEssence;
  state.combo_hits = 0;
  state.combo_misses = 0;
  state.combo_multiplier = 1.0;
  state.last_press_time = 0.0;
  state.last_scored_beat_index = -1;
  state.last_auto_bite_beat_index = -1;
  state.idle_seconds = 0.0;
  state.perfect_streak = 0;
  state.venom_rush_active = false;
  state.venom_rush_end_beat = -1;
  state.mouth_open = true;
  state.bite_cooldown_until = 0.0;
  state.last_bite_result = '';
  state.frenzy_active = false;
  state.frenzy_end_time = 0.0;
  state.frenzy_presses = 0;
  state.current_offerings = [];
  state.beat_origin = now();
  state.post_frenzy_bpm = 0.0;
  state.post_frenzy_next_step = 0.0;
  state.stats.sheds += 1;
  return scalesEarned;
}

function performAscension(state) {
  const keptScales = state.scales;
  const keptTotalScales = state.total_scales_earned;
  const keptAscLevels = Object.assign({}, state.ascension_upgrade_levels);
  // Reset to defaults but preserve prestige currencies
  const fresh = newGameState();
  Object.assign(state, fresh);
  state.scales = keptScales;
  state.total_scales_earned = keptTotalScales;
  state.ascension_upgrade_levels = keptAscLevels;
  state.beat_origin = now();
}

// ─────────────────────────────────────────────────────────────────
// PROCEDURAL OFFERINGS  (mirrors engine/procedural.py)
// ─────────────────────────────────────────────────────────────────
function generateOfferings(state, metaUnlocked, count = 3) {
  // Extra offering slots from ascension upgrades
  let extraSlots = 0;
  for (const [uid, level] of Object.entries(state.ascension_upgrade_levels)) {
    const udef = ASCENSION_UPGRADES[uid];
    if (udef && udef.effect === AE.EXTRA_OFFERING && level > 0)
      extraSlots += Math.floor(udef.value_per_level * level);
  }
  count = count + extraSlots;

  let pool = [...BASE_POOL];
  for (const uid of META_POOL) {
    if (metaUnlocked.has(uid)) pool.push(uid);
  }
  if (state.current_stage_index >= 5) pool.push(...COSMIC_POOL);

  const available = pool.filter(uid => {
    const udef = ALL_UPGRADES[uid];
    return (state.upgrade_levels[uid] || 0) < udef.max_level
      && !(udef.cosmic_only && state.current_stage_index < 5);
  });

  if (available.length === 0) return [];

  const arch = ALL_ARCHETYPES[state.archetype_id];
  let poolToSample = available;
  if (arch && arch.preferred_pool.length > 0) {
    const weighted = [];
    for (const uid of available) {
      const weight = arch.preferred_pool.includes(uid) ? 3 : 1;
      for (let i = 0; i < weight; i++) weighted.push(uid);
    }
    poolToSample = weighted;
  }

  const seen = new Set();
  const result = [];
  let attempts = 0;
  while (result.length < Math.min(count, available.length) && attempts < 1000) {
    const pick = randChoice(poolToSample);
    if (!seen.has(pick)) { seen.add(pick); result.push(pick); }
    attempts++;
  }
  return result;
}

function refreshOfferings(state, metaUnlocked) {
  state.current_offerings = generateOfferings(state, metaUnlocked);
}

// ─────────────────────────────────────────────────────────────────
// EVENT MANAGER  (mirrors engine/events.py)
// ─────────────────────────────────────────────────────────────────
class EventManager {
  constructor() {
    this._nextGoldenTime    = this._scheduleGolden();
    this._nextChallengeTime = this._scheduleChallenge();
    this._nextBargainTime   = this._scheduleBargain();
    this._nextEchoTime      = this._scheduleEcho();
    this._currentChallengeSpec = null;
    this._challengeStartPresses = 0;
    this._challengeStartTime = 0.0;
    this._patienceLastPress = 0;
    this._bargainActive = false;
    this._bargainEndTime = 0.0;
    this._echoActive = false;
    this._echoEndTime = 0.0;
    this._echoUpgradeId = '';
  }

  get bargain_active() { return this._bargainActive; }
  get echo_active()    { return this._echoActive; }
  get echo_upgrade_id(){ return this._echoUpgradeId; }

  _scheduleGolden()    { return now() + randUniform(BALANCE.events.golden_min_interval_s,    BALANCE.events.golden_max_interval_s); }
  _scheduleChallenge() { return now() + randUniform(BALANCE.events.challenge_min_interval_s, BALANCE.events.challenge_max_interval_s); }
  _scheduleBargain()   { return now() + randUniform(BALANCE.events.bargain_min_interval_s,   BALANCE.events.bargain_max_interval_s); }
  _scheduleEcho()      { return now() + randUniform(BALANCE.events.echo_min_interval_s,      BALANCE.events.echo_max_interval_s); }

  _goldenDuration(state) {
    let dur = BALANCE.events.golden_duration_s;
    for (const [uid, level] of Object.entries(state.upgrade_levels)) {
      const udef = ALL_UPGRADES[uid];
      if (udef && udef.effect === UE.GOLDEN_DURATION_MULT && level > 0)
        dur *= 1.0 + udef.value_per_level * level;
    }
    return dur;
  }

  _randomChallenge(state) {
    const types = ['FEED_FRENZY', 'COMBO_SUSTAIN', 'PATIENCE'];
    const ctype = randChoice(types);
    const dur = BALANCE.events.challenge_duration_s;
    if (ctype === 'FEED_FRENZY') {
      // Target is a rolling BPM average. Cursor pins to centre so timing is
      // irrelevant — pure mashing speed decides the outcome.
      return { ctype, description:`Feeding Frenzy: mash at 150 BPM avg!`, target: 150.0, duration_s:dur, reward_mult:5.0 };
    }
    if (ctype === 'COMBO_SUSTAIN') {
      const comboTarget = randChoice([3.0, 5.0, 8.0]);
      // target = full duration so progress tracks cumulative hold-time vs total time.
      return { ctype, description:`Hold ${comboTarget.toFixed(0)}x combo for ${dur.toFixed(0)}s!`,
               target: dur, combo_target: comboTarget, duration_s: dur, reward_mult: 5.0 };
    }
    // PATIENCE
    return { ctype, description:`Don't press anything for ${dur.toFixed(0)}s!`, target:dur, duration_s:dur, reward_mult:8.0 };
  }

  tick(state) {
    const t = now();
    const notifications = [];

    // Golden Ouroboros
    if (!state.golden_active && t >= this._nextGoldenTime) {
      state.golden_active = true;
      state.golden_end_time = t + this._goldenDuration(state);
      notifications.push('golden_spawn');
    }
    if (state.golden_active && t >= state.golden_end_time) {
      state.golden_active = false;
      state.stats.golden_missed += 1;
      this._nextGoldenTime = this._scheduleGolden();
      notifications.push('golden_missed');
    }

    // Feeding Frenzy expiry
    if (state.frenzy_active && t >= state.frenzy_end_time) {
      state.frenzy_active = false;
      const reward = state.essence_per_press * state.frenzy_presses * BALANCE.events.golden_reward_multiplier;
      state.essence += reward;
      state.stats.total_essence_earned += reward;
      notifications.push(`frenzy_end:${state.frenzy_presses}:${reward.toFixed(0)}`);
      state.frenzy_presses = 0;
      state.post_frenzy_bpm = BALANCE.rhythm.max_bpm;
      state.post_frenzy_next_step = t + 10.0;
    }

    // Timed Challenges
    if (!state.challenge_active && t >= this._nextChallengeTime) {
      const spec = this._randomChallenge(state);
      this._currentChallengeSpec = spec;
      state.challenge_active = true;
      state.challenge_type = spec.ctype;
      state.challenge_end_time = t + spec.duration_s;
      state.challenge_target = spec.target;
      state.challenge_progress = 0.0;
      state.challenge_combo_target = spec.combo_target || 0.0;
      this._challengeStartPresses = state.stats.total_presses;
      this._challengeStartTime = t;
      this._challengeLastTickT = t;
      this._patienceLastPress = state.stats.total_presses;
      notifications.push(`challenge_start:${spec.description}`);
    }

    if (state.challenge_active) {
      // Guard: spec can be null after a page reload (not serialised). Clear and
      // reschedule so the game never gets permanently stuck in a challenge.
      if (!this._currentChallengeSpec) {
        state.challenge_active = false;
        this._nextChallengeTime = this._scheduleChallenge();
      }
      const spec = this._currentChallengeSpec;
      if (!spec) { /* cleared above */ }
      else if (spec.ctype === 'FEED_FRENZY') {
        // Progress = current rolling tap BPM (capped at target for the bar)
        state.challenge_progress = Math.min(spec.target, state.rolling_bpm);
      } else if (spec.ctype === 'COMBO_SUSTAIN') {
        // Accumulate only the time actually spent at-or-above the required combo.
        // No instant fail — let the timer expire if they can't sustain it.
        const dt = t - (this._challengeLastTickT || t);
        if (state.combo_multiplier >= spec.combo_target) {
          state.challenge_progress = Math.min(spec.target, state.challenge_progress + dt);
        }
      } else if (spec.ctype === 'PATIENCE') {
        if (state.stats.total_presses > this._patienceLastPress) {
          state.challenge_active = false;
          state.stats.challenges_failed += 1;
          this._nextChallengeTime = this._scheduleChallenge();
          // Pressed when you shouldn't have → precision penalty
          _applyDebuff(state, 'reckless_strike');
          notifications.push(`challenge_failed:${spec.ctype}`);
        } else {
          state.challenge_progress = t - this._challengeStartTime;
        }
      }
      this._challengeLastTickT = t; // used by COMBO_SUSTAIN dt accumulation

      // Auto-win on progress (not used for FEED_FRENZY — checked at expiry instead)
      if (spec && state.challenge_active && state.challenge_progress >= spec.target && spec.ctype !== 'FEED_FRENZY') {
        state.challenge_active = false;
        state.stats.challenges_completed += 1;
        const reward = state.essence_per_press * spec.reward_mult * 10;
        state.essence += reward;
        state.stats.total_essence_earned += reward;
        this._nextChallengeTime = this._scheduleChallenge();
        notifications.push(`challenge_complete:${reward.toFixed(0)}`);
      }
      if (spec && state.challenge_active && t >= state.challenge_end_time) {
        state.challenge_active = false;
        this._nextChallengeTime = this._scheduleChallenge();
        if (spec.ctype === 'FEED_FRENZY') {
          // Win if rolling BPM is at or above target when time expires
          if (state.rolling_bpm >= spec.target) {
            state.stats.challenges_completed += 1;
            const reward = state.essence_per_press * spec.reward_mult * 10;
            state.essence += reward;
            state.stats.total_essence_earned += reward;
            notifications.push(`challenge_complete:${reward.toFixed(0)}`);
          } else {
            state.stats.challenges_failed += 1;
            _applyDebuff(state, 'sluggish_jaw');
            notifications.push(`challenge_failed:${spec.ctype}`);
          }
        } else {
          state.stats.challenges_failed += 1;
          if (spec.ctype === 'COMBO_SUSTAIN') _applyDebuff(state, 'shattered_rhythm');
          notifications.push(`challenge_failed:${spec.ctype}`);
        }
      }
    }

    // Serpent's Bargain
    if (!this._bargainActive && t >= this._nextBargainTime) {
      this._bargainActive = true;
      this._bargainEndTime = t + BALANCE.events.bargain_duration_s;
      notifications.push('bargain_spawn');
    }
    if (this._bargainActive && t >= this._bargainEndTime) {
      this._bargainActive = false;
      this._nextBargainTime = this._scheduleBargain();
      notifications.push('bargain_expired');
    }

    // Ancient Echo
    if (!this._echoActive && t >= this._nextEchoTime) {
      const candidates = BASE_POOL.filter(uid =>
        (state.upgrade_levels[uid] || 0) < ALL_UPGRADES[uid].max_level
      );
      if (candidates.length > 0) {
        this._echoUpgradeId = randChoice(candidates);
        this._echoActive = true;
        this._echoEndTime = t + BALANCE.events.echo_duration_s;
        notifications.push(`echo_spawn:${this._echoUpgradeId}`);
      } else {
        this._nextEchoTime = this._scheduleEcho();
      }
    }
    if (this._echoActive && t >= this._echoEndTime) {
      this._echoActive = false;
      this._echoUpgradeId = '';
      this._nextEchoTime = this._scheduleEcho();
      notifications.push('echo_expired');
    }

    return notifications;
  }

  catchGolden(state) {
    if (!state.golden_active) return 0.0;
    state.golden_active = false;
    state.stats.golden_caught += 1;
    this._nextGoldenTime = this._scheduleGolden();

    state.frenzy_active = true;
    const tiersEarned = BALANCE.rhythm.combo_tiers.filter(([h]) => state.combo_hits >= h).length;
    const bonusS = tiersEarned * BALANCE.events.frenzy_combo_bonus_s_per_tier;
    state.frenzy_end_time = now() + BALANCE.events.frenzy_duration_s + bonusS;
    state.frenzy_presses = 0;
    state.mouth_open = true;
    state.bite_cooldown_until = 0.0;
    return -1.0;
  }

  acceptBargain(state, metaUnlocked) {
    if (!this._bargainActive) return false;
    const cost = state.essence * BALANCE.events.bargain_cost_fraction;
    if (cost <= 0) return false;
    state.essence -= cost;
    this._bargainActive = false;
    this._nextBargainTime = this._scheduleBargain();
    // Grant free upgrade from current offerings
    const candidates = state.current_offerings.filter(uid =>
      (state.upgrade_levels[uid] || 0) < ALL_UPGRADES[uid].max_level
    );
    if (candidates.length > 0) {
      const uid = candidates[0];
      const grantCost = getUpgradeCost(state, uid);
      state.essence += grantCost;
      purchaseUpgrade(state, uid);
    }
    return true;
  }

  acceptEcho(state, metaUnlocked) {
    if (!this._echoActive || !this._echoUpgradeId) return false;
    const uid = this._echoUpgradeId;
    const cost = getUpgradeCost(state, uid);
    state.essence += cost;
    const result = purchaseUpgrade(state, uid);
    if (!result) state.essence -= cost;
    this._echoActive = false;
    this._nextEchoTime = this._scheduleEcho();
    return result;
  }

  // Serialise/restore event scheduling state so timers survive page reloads
  toJSON() {
    return {
      _nextGoldenTime: this._nextGoldenTime,
      _nextChallengeTime: this._nextChallengeTime,
      _nextBargainTime: this._nextBargainTime,
      _nextEchoTime: this._nextEchoTime,
      _bargainActive: this._bargainActive,
      _bargainEndTime: this._bargainEndTime,
      _echoActive: this._echoActive,
      _echoEndTime: this._echoEndTime,
      _echoUpgradeId: this._echoUpgradeId,
    };
  }

  static fromJSON(d) {
    const em = new EventManager();
    em._nextGoldenTime    = d._nextGoldenTime    ?? em._nextGoldenTime;
    em._nextChallengeTime = d._nextChallengeTime ?? em._nextChallengeTime;
    em._nextBargainTime   = d._nextBargainTime   ?? em._nextBargainTime;
    em._nextEchoTime      = d._nextEchoTime      ?? em._nextEchoTime;
    em._bargainActive     = d._bargainActive     ?? false;
    em._bargainEndTime    = d._bargainEndTime    ?? 0;
    em._echoActive        = d._echoActive        ?? false;
    em._echoEndTime       = d._echoEndTime       ?? 0;
    em._echoUpgradeId     = d._echoUpgradeId     ?? '';
    return em;
  }
}

// ─────────────────────────────────────────────────────────────────
// SAVE / LOAD  (localStorage — mirrors engine/save.py + meta.py)
// ─────────────────────────────────────────────────────────────────
const LS_RUN_KEY  = 'ouro_run_v1';
const LS_META_KEY = 'ouro_meta_v1';
const LS_EVT_KEY  = 'ouro_events_v1';

function saveRun(state, events) {
  try {
    const d = {
      essence: state.essence,
      snake_length: state.snake_length,
      current_stage_index: state.current_stage_index,
      scales: state.scales,
      total_scales_earned: state.total_scales_earned,
      archetype_id: state.archetype_id,
      resonance_perfects: state.resonance_perfects,
      combo_peak_seconds: state.combo_peak_seconds,
      archetype_offer_id: state.archetype_offer_id,
      archetype_offer_expires: state.archetype_offer_expires,
      debuff_id: state.debuff_id,
      debuff_end_time: state.debuff_end_time,
      miss_streak: state.miss_streak,
      combo_hits: state.combo_hits,
      combo_multiplier: state.combo_multiplier,
      combo_misses: state.combo_misses,
      last_press_time: state.last_press_time,
      beat_origin: state.beat_origin,
      last_scored_beat_index: state.last_scored_beat_index,
      last_auto_bite_beat_index: state.last_auto_bite_beat_index,
      idle_seconds: state.idle_seconds,
      perfect_streak: state.perfect_streak,
      venom_rush_active: state.venom_rush_active,
      venom_rush_end_beat: state.venom_rush_end_beat,
      mouth_open: state.mouth_open,
      bite_cooldown_until: state.bite_cooldown_until,
      last_bite_result: state.last_bite_result,
      upgrade_levels: Object.assign({}, state.upgrade_levels),
      ascension_upgrade_levels: Object.assign({}, state.ascension_upgrade_levels),
      post_frenzy_bpm: state.post_frenzy_bpm,
      post_frenzy_next_step: state.post_frenzy_next_step,
      golden_active: state.golden_active,
      golden_end_time: state.golden_end_time,
      frenzy_active: state.frenzy_active,
      frenzy_end_time: state.frenzy_end_time,
      frenzy_presses: state.frenzy_presses,
      challenge_active: state.challenge_active,
      challenge_type: state.challenge_type,
      challenge_end_time: state.challenge_end_time,
      challenge_target: state.challenge_target,
      challenge_progress: state.challenge_progress,
      challenge_combo_target: state.challenge_combo_target,
      current_offerings: [...state.current_offerings],
      essence_per_press: state.essence_per_press,
      idle_income_per_s: state.idle_income_per_s,
      stats: Object.assign({}, state.stats),
    };
    localStorage.setItem(LS_RUN_KEY, JSON.stringify(d));
    if (events) localStorage.setItem(LS_EVT_KEY, JSON.stringify(events.toJSON()));
  } catch (e) { /* non-fatal */ }
}

function loadRun() {
  try {
    const raw = localStorage.getItem(LS_RUN_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    const t = now();
    // Re-anchor beat_origin: if saved long ago, reset to now
    let beatOrigin = d.beat_origin ?? t;
    if (t - beatOrigin > 3600) beatOrigin = t;

    const stats = newRunStats(d.stats || {});
    const state = newGameState({
      essence: d.essence ?? 0,
      snake_length: d.snake_length ?? 3,
      current_stage_index: d.current_stage_index ?? 0,
      scales: d.scales ?? 0,
      total_scales_earned: d.total_scales_earned ?? 0,
      archetype_id: d.archetype_id ?? '',
      resonance_perfects: d.resonance_perfects ?? 0,
      combo_peak_seconds: d.combo_peak_seconds ?? 0,
      archetype_offer_id: d.archetype_offer_id ?? '',
      archetype_offer_expires: d.archetype_offer_expires ?? 0,
      debuff_id: d.debuff_id ?? '',
      debuff_end_time: d.debuff_end_time ?? 0,
      miss_streak: d.miss_streak ?? 0,
      combo_hits: d.combo_hits ?? 0,
      combo_multiplier: d.combo_multiplier ?? 1,
      combo_misses: d.combo_misses ?? 0,
      last_press_time: d.last_press_time ?? 0,
      beat_origin: beatOrigin,
      last_scored_beat_index: d.last_scored_beat_index ?? -1,
      last_auto_bite_beat_index: d.last_auto_bite_beat_index ?? -1,
      idle_seconds: d.idle_seconds ?? 0,
      perfect_streak: d.perfect_streak ?? 0,
      venom_rush_active: d.venom_rush_active ?? false,
      venom_rush_end_beat: d.venom_rush_end_beat ?? -1,
      mouth_open: d.mouth_open ?? true,
      bite_cooldown_until: d.bite_cooldown_until ?? 0,
      last_bite_result: d.last_bite_result ?? '',
      upgrade_levels: d.upgrade_levels ?? {},
      ascension_upgrade_levels: d.ascension_upgrade_levels ?? {},
      post_frenzy_bpm: d.post_frenzy_bpm ?? 0,
      post_frenzy_next_step: d.post_frenzy_next_step ?? 0,
      golden_active: d.golden_active ?? false,
      golden_end_time: d.golden_end_time ?? 0,
      frenzy_active: d.frenzy_active ?? false,
      frenzy_end_time: d.frenzy_end_time ?? 0,
      frenzy_presses: d.frenzy_presses ?? 0,
      challenge_active: d.challenge_active ?? false,
      challenge_type: d.challenge_type ?? '',
      challenge_end_time: d.challenge_end_time ?? 0,
      challenge_target: d.challenge_target ?? 0,
      challenge_progress: d.challenge_progress ?? 0,
      challenge_combo_target: d.challenge_combo_target ?? 0,
      current_offerings: d.current_offerings ?? [],
      essence_per_press: d.essence_per_press ?? 1,
      idle_income_per_s: d.idle_income_per_s ?? 0,
      stats,
    });
    return state;
  } catch (e) { return null; }
}

function deleteRun() {
  localStorage.removeItem(LS_RUN_KEY);
  localStorage.removeItem(LS_EVT_KEY);
}

function deleteMeta() {
  localStorage.removeItem(LS_META_KEY);
}

function loadEvents() {
  try {
    const raw = localStorage.getItem(LS_EVT_KEY);
    if (!raw) return null;
    return EventManager.fromJSON(JSON.parse(raw));
  } catch (e) { return null; }
}

function saveMeta(meta) {
  try {
    localStorage.setItem(LS_META_KEY, JSON.stringify({
      serpent_knowledge: meta.serpent_knowledge,
      starting_length_bonus: meta.starting_length_bonus,
      unlocked_upgrade_ids: meta.unlocked_upgrade_ids,
      unlocked_event_types: meta.unlocked_event_types,
      ascension_count: meta.ascension_count,
      ascension_upgrade_levels: meta.ascension_upgrade_levels,
      unlocked_skins: meta.unlocked_skins,
      collected_lore_ids: meta.collected_lore_ids,
      active_skin: meta.active_skin,
      total_runs: meta.total_runs,
      best_peak_length: meta.best_peak_length,
      best_total_essence: meta.best_total_essence,
      total_golden_caught: meta.total_golden_caught,
      total_challenges_completed: meta.total_challenges_completed,
    }));
  } catch (e) { /* non-fatal */ }
}

function loadMeta() {
  try {
    const raw = localStorage.getItem(LS_META_KEY);
    if (!raw) return newMetaState();
    const d = JSON.parse(raw);
    return newMetaState({
      serpent_knowledge: d.serpent_knowledge ?? 0,
      starting_length_bonus: d.starting_length_bonus ?? 0,
      unlocked_upgrade_ids: d.unlocked_upgrade_ids ?? [],
      unlocked_event_types: d.unlocked_event_types ?? [],
      ascension_count: d.ascension_count ?? 0,
      ascension_upgrade_levels: d.ascension_upgrade_levels ?? {},
      unlocked_skins: d.unlocked_skins ?? ['emerald'],
      collected_lore_ids: d.collected_lore_ids ?? [],
      active_skin: d.active_skin ?? 'emerald',
      total_runs: d.total_runs ?? 0,
      best_peak_length: d.best_peak_length ?? 0,
      best_total_essence: d.best_total_essence ?? 0,
      total_golden_caught: d.total_golden_caught ?? 0,
      total_challenges_completed: d.total_challenges_completed ?? 0,
    });
  } catch (e) { return newMetaState(); }
}

// ─────────────────────────────────────────────────────────────────
// NEW RUN FACTORY  (mirrors app.py _new_run_state)
// ─────────────────────────────────────────────────────────────────
function createNewRunState(meta) {
  const archetype = randChoice(Object.values(ALL_ARCHETYPES));
  const state = newGameState({
    snake_length: getStartingLength(meta),
    archetype_id: archetype.id,
    beat_origin: now(),
    stats: newRunStats({ run_start_time: now() }),
  });
  for (const [uid, level] of Object.entries(archetype.starting_upgrades)) {
    state.upgrade_levels[uid] = level;
  }
  applyAscensionStartingBonuses(meta, state);
  computeDerived(state);
  return state;
}
