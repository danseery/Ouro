/* ═══════════════════════════════════════════════════════════════
   Ouro Web — Client-side UI, Input & Local Game Loop
   Depends on engine.js (must be loaded first).
   No server required — all game logic runs in the browser.
   ═══════════════════════════════════════════════════════════════ */

'use strict';

// ---------------------------------------------------------------------------
// Global Game Objects
// ---------------------------------------------------------------------------

let state  = null;   // GameState (from engine.js)
let meta   = null;   // MetaState
let events = null;   // EventManager
let _saveEpoch = null; // Guards against stale-tab save clobbering

let lastBiteResult    = null;
let feedbackTimer     = null;
let feedbackFadeTimer = null;
const FEEDBACK_DURATION = 500;  // ms
let _lastIdleMissVisualBeat = -1;

// Ascension modal pending purchases before confirmation
let ascensionPurchases = {};

// ─── BPM Re-anchor ────────────────────────────────────────────────────────
// When the snake grows past a BPM milestone the beat interval changes.
// Without re-anchoring, beat_origin stays the same and the cursor snaps
// to a new position mid-bar. We re-anchor to preserve the current phase.
let _lastKnownBpm = 0;

function _maybeReanchorBeat() {
  if (!state) return;
  const bpm = getCurrentBpm(state);
  if (_lastKnownBpm > 0 && bpm !== _lastKnownBpm) {
    const t = now();
    const oldInterval = 60.0 / _lastKnownBpm;
    const elapsed = t - state.beat_origin;
    const phase = ((elapsed % oldInterval) + oldInterval) % oldInterval / oldInterval;
    const newInterval = 60.0 / bpm;
    // Move beat_origin so the current bar phase is preserved; only speed changes.
    state.beat_origin = t - phase * newInterval;
  }
  _lastKnownBpm = bpm;
}

// ─── Beat Cache ────────────────────────────────────────────────────────────
// Updated ONLY in renderRhythm() via requestAnimationFrame — never at keypress.
// doFeed() reads this cache directly for scoring so the evaluated beat position
// is the exact same timestamp used to draw the cursor pixel. True physical
// detection: no time slips between render and score.
let _beatCache = { t: 0, bpm: 60, beatInterval: 1, prog: 0, displayProg: 0.5, dist: 0.5 };

// Tap BPM is latched once per beat (when the cursor completes a pass) so it
// stays readable rather than updating every rAF frame.
let _tapBpmLocked = '— rate';
let _lastBeatIndexForTap = -1;

function _sampleBeat() {
  if (!state) return;
  _maybeReanchorBeat();
  const bpm         = getCurrentBpm(state);
  const beatInterval = 60.0 / Math.max(bpm, 1);
  const t           = now();
  const elapsed     = t - state.beat_origin;
  const beatPos     = ((elapsed % beatInterval) + beatInterval) % beatInterval;
  const prog        = beatPos / beatInterval;
  _beatCache = {
    t,
    bpm,
    beatInterval,
    prog,
    displayProg: (prog + 0.5) % 1.0,
    dist: Math.min(beatPos, beatInterval - beatPos),
  };
}

// ---------------------------------------------------------------------------
// Snake ASCII Art
// ---------------------------------------------------------------------------

// Snake art is now drawn on a <canvas> by renderSnake() below.

const TOP_JAW = [
  "    ╲▔▔▔▔▔▔╱    ",
  "   ╲▔▔▔▔▔▔▔▔╱   ",
  "  ╲▔▔▔▔▔▔▔▔▔▔╱  ",
  " ╲▔▔▔▔▔▔▔▔▔▔▔▔╱ ",
  "╲▔▔▔▔▔▔▔▔▔▔▔▔▔▔╱"
];
const BOT_JAW = [
  "    ╱▁▁▁▁▁▁╲    ",
  "   ╱▁▁▁▁▁▁▁▁╲   ",
  "  ╱▁▁▁▁▁▁▁▁▁▁╲  ",
  " ╱▁▁▁▁▁▁▁▁▁▁▁▁╲ ",
  "╱▁▁▁▁▁▁▁▁▁▁▁▁▁▁╲"
];
const NUM_FRAMES = TOP_JAW.length;

// ---------------------------------------------------------------------------
// DOM References
// ---------------------------------------------------------------------------

const $ = (sel) => document.querySelector(sel);
const isMobile = () => window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 700;
const dom = {
  essence:  $('#hud-essence'),
  perPress: $('#hud-per-press'),
  idle:     $('#hud-idle'),
  length:   $('#hud-length'),
  stage:    $('#hud-stage'),
  scales:   $('#hud-scales'),
  combo:    $('#hud-combo'),
  hits:     $('#hud-hits'),
  goalText: $('#hud-goal-text'),
  goalBar:  $('#hud-goal-bar'),
  goalPct:  $('#hud-goal-pct'),
  curse:          $('#hud-curse'),
  rhythmHint:     $('#rhythm-hint'),
  snakeArt:       $('#snake-art'),
  snakeLength:    $('#snake-length-label'),
  shedBarFill:    $('#shed-bar-fill'),
  shedBarLabel:   $('#shed-bar-label'),
  jawTop:         $('#jaw-top'),
  jawBot:         $('#jaw-bottom'),
  jawHint:        $('#jaw-hint'),
  feedback:       $('#rhythm-feedback'),
  beatCursor:     $('#beat-bar-cursor'),
  beatPerfect:    $('#beat-bar-perfect'),
  beatGood:       $('#beat-bar-good'),
  rhythmBpm:      $('#rhythm-bpm'),
  rhythmTapBpm:   $('#rhythm-tap-bpm'),
  rhythmCombo:    $('#rhythm-combo'),
  rhythmComboCount: $('#rhythm-combo-count'),
  rhythmPerfectStreak: $('#rhythm-perfect-streak'),
  biteBtn:        $('#bite-button'),
  shedBtn:        $('#btn-shed'),
  ascendBtn:      $('#btn-ascend'),
  saveBtn:        $('#btn-save'),
  settingsBtn:        $('#btn-settings'),
  settingsModal:      $('#settings-modal'),
  settingsCloseBtn:   $('#btn-settings-close'),
  autoSaveToggle:     $('#settings-auto-save'),
  showWelcomeToggle:  $('#settings-show-welcome'),
  clearSaveBtn:       $('#btn-clear-save'),
  clearSaveConfirm:   $('#clear-save-confirm'),
  clearConfirmYes:    $('#btn-clear-confirm-yes'),
  clearConfirmNo:     $('#btn-clear-confirm-no'),
  upgradeList:       $('#upgrade-list'),
  archetypeSelect:   $('#archetype-select'),
  kbBuyRange:        $('#kb-buy-range'),
  eventOverlay:   $('#event-overlay'),
  eventText:      $('#event-text'),
  eventTimer:     $('#event-timer'),
  eventActionBtn: $('#event-action-btn'),
  prestigeContent:    $('#prestige-content'),
  runStats:           $('#run-stats'),
  ascensionModal:     $('#ascension-modal'),
  ascensionBadge:     $('#ascension-badge'),
  ascensionCount:     $('#ascension-count'),
  modalScales:        $('#modal-scales-value'),
  ascensionList:      $('#ascension-upgrade-list'),
  ascendConfirm:      $('#btn-ascend-confirm'),
  ascendCancel:       $('#btn-ascend-cancel'),
  toastContainer:     $('#toast-container'),
  guideBtn:           $('#btn-guide'),
  guideModal:         $('#guide-modal'),
  guideCloseBtn:      $('#btn-guide-close'),
  guideContent:       $('#guide-content'),
  collectionsBtn:         $('#btn-collections'),
  collectionsModal:       $('#collections-modal'),
  collectionsCloseBtn:    $('#btn-collections-close'),
  collectionsContent:     $('#collections-content'),
};

// ---------------------------------------------------------------------------
// Toast Notifications
// ---------------------------------------------------------------------------

function _resetClearSaveUI() {
  if (dom.clearSaveBtn)    dom.clearSaveBtn.classList.remove('hidden');
  if (dom.clearSaveConfirm) dom.clearSaveConfirm.classList.add('hidden');
}

function showToast(msg, type = 'info') {
  // Evict oldest toast if already at cap
  const MAX_TOASTS = 4;
  while (dom.toastContainer.children.length >= MAX_TOASTS) {
    dom.toastContainer.firstChild.remove();
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  dom.toastContainer.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ---------------------------------------------------------------------------
// Computed helpers for rendering
// ---------------------------------------------------------------------------

function _growthStage(s) {
  return BALANCE.prestige.growth_stages[s.current_stage_index][1];
}

function _goalInfo(s) {
  const stages = BALANCE.prestige.growth_stages;
  const nextIdx = s.current_stage_index + 1;
  if (canAscend(s)) {
    return { text: 'Ready to Ascend!', pct: 1.0 };
  }
  if (canShed(s)) {
    const next   = stages[nextIdx][1];
    const reward = computeScalesReward(s);
    return { text: `Shed → ${next} (+${Math.floor(reward)} Scales)`, pct: 1.0 };
  }
  if (nextIdx < stages.length) {
    const threshold = stages[nextIdx][0];
    const current   = s.snake_length;
    const pct       = threshold > 0 ? Math.min(1.0, current / threshold) : 0;
    return { text: `→ ${stages[nextIdx][1]} (${formatNumber(current)}/${formatNumber(threshold)})`, pct };
  }
  // At final stage — show progress toward the ascension-length threshold
  const finalThreshold = stages[s.current_stage_index][0];
  const current = s.snake_length;
  const pct     = finalThreshold > 0 ? Math.min(1.0, current / finalThreshold) : 0;
  return { text: `→ Ascension (${formatNumber(current)}/${formatNumber(finalThreshold)})`, pct };
}

function _shedInfo(s) {
  const stages  = BALANCE.prestige.growth_stages;
  const nextIdx = s.current_stage_index + 1;
  if (canAscend(s)) return { status: 'ascend' };
  if (canShed(s)) {
    return {
      status:     'ready',
      next_stage: stages[nextIdx][1],
      reward:     Math.floor(computeScalesReward(s)),
    };
  }
  if (nextIdx < stages.length) {
    return {
      status:     'growing',
      next_stage: stages[nextIdx][1],
      threshold:  stages[nextIdx][0],
      current:    s.snake_length,
    };
  }
  // At final stage but haven't regrown to ascension threshold yet
  const finalThreshold = stages[s.current_stage_index][0];
  return {
    status:     'growing',
    next_stage: 'Ascension',
    threshold:  finalThreshold,
    current:    s.snake_length,
  };
}

function _offeringInfo(s) {
  return (s.current_offerings || []).map(uid => {
    const udef  = ALL_UPGRADES[uid];
    const level = s.upgrade_levels[uid] || 0;
    const cost  = getUpgradeCost(s, uid);
    return {
      id:         uid,
      name:       udef.name,
      description:udef.description,
      level,
      max_level:  udef.max_level,
      cost:       formatNumber(cost),
      cost_raw:   cost,
      can_afford: s.essence >= cost,
      maxed:      level >= udef.max_level,
    };
  });
}

// ---------------------------------------------------------------------------
// Process Notifications from EventManager.tick()
// ---------------------------------------------------------------------------

function processNotifications(notifs) {
  for (const n of notifs) {
    if (n === 'golden_spawn') {
      showToast('✦ A Golden Ouroboros appears! Press G!', 'warning');
    } else if (n === 'golden_missed') {
      showToast('The Golden Ouroboros fades away...', 'info');
    } else if (n.startsWith('frenzy_end:')) {
      const parts = n.split(':');
      showToast(`🐍 Frenzy over! ${parts[1]} bites`, 'warning');
    } else if (n.startsWith('challenge_start:')) {
      showToast(`⚡ Challenge: ${n.split(':', 2)[1]}`, 'warning');
    } else if (n.startsWith('challenge_complete:')) {
      showToast(`✓ Challenge complete! +${n.split(':')[1]} Essence`, 'success');
    } else if (n.startsWith('challenge_failed')) {
      const parts = n.split(':');
      const challengeType = parts[1] || '';
      const label = challengeType ? formatChallengeType(challengeType) : 'Challenge';
      showToast(`✗ Challenge failed: ${label}`, 'error');
    } else if (n === 'bargain_spawn') {
      showToast("🐍 Serpent's Bargain! Press B to sacrifice 30% essence for a free upgrade!", 'warning');
    } else if (n === 'bargain_expired') {
      showToast("The Serpent's Bargain fades...", 'info');
    } else if (n.startsWith('echo_spawn:')) {
      showToast('✦ Ancient Echo: free upgrade available! Press E!', 'warning');
    } else if (n === 'echo_expired') {
      showToast('The Ancient Echo fades...', 'info');
    } else if (n.startsWith('archetype_unlocked:')) {
      const id   = n.split(':')[1];
      const arch = ALL_ARCHETYPES[id];
      if (arch && !(meta.unlocked_archetypes || []).includes(id)) {
        meta.unlocked_archetypes = (meta.unlocked_archetypes || []).concat([id]);
        saveMeta(meta);
        showToast(`⚔ ${arch.name} unlocked! Select it from the Archetype panel.`, 'success');
        _lastArchetypeSelectKey = '';  // force re-render
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderAll() {
  if (!state) return;
  renderHUD();
  renderSnake();
  renderArchetypeSelect();
  renderUpgrades();
  renderEvents();
  renderPrestige();
  renderRunStats();
  renderAscensionBadge();
}

function renderHUD() {
  const s = state;
  dom.essence.textContent  = formatNumber(s.essence);
  dom.perPress.textContent = formatNumber(s.essence_per_press);
  dom.idle.textContent     = formatNumber(s.idle_income_per_s) + '/s';
  dom.stage.textContent    = _growthStage(s);
  dom.scales.textContent   = formatNumber(s.scales);
  dom.combo.textContent    = `${s.combo_multiplier.toFixed(1)}x`;
  dom.hits.textContent     = s.combo_hits;

  // Combo colour
  const mult = s.combo_multiplier;
  dom.combo.className = 'stat-value';
  if (mult >= 8) {
    dom.combo.classList.add('combo-glow-max');
    dom.combo.style.color      = 'var(--red)';
    dom.combo.style.textShadow = 'var(--red-glow)';
  } else if (mult >= 5) {
    dom.combo.style.color      = 'var(--purple)';
    dom.combo.style.textShadow = 'var(--purple-glow)';
  } else if (mult >= 3) {
    dom.combo.style.color      = 'var(--yellow)';
    dom.combo.style.textShadow = 'var(--yellow-glow)';
  } else if (mult >= 1.5) {
    dom.combo.style.color      = 'var(--green)';
    dom.combo.style.textShadow = 'var(--green-glow)';
  } else {
    dom.combo.style.color      = '';
    dom.combo.style.textShadow = '';
  }

  // Active debuff (with countdown) — shown in the rhythm hint slot
  // Full/shed-ready takes priority over debuff display
  const debuff = ALL_DEBUFFS[s.debuff_id];
  if (canShed(s)) {
    dom.rhythmHint.textContent = '── coil is full  ✦  shed your skin ──';
    dom.rhythmHint.className = 'rhythm-hint full-mode';
  } else if (debuff && s.debuff_end_time > now()) {
    const rem = Math.max(0, s.debuff_end_time - now()).toFixed(1);
    dom.rhythmHint.textContent = `⚡ ${debuff.name}: ${debuff.description} (${rem}s)`;
    dom.rhythmHint.className = 'rhythm-hint debuff-active';
  } else if (s.post_frenzy_bpm > 0) {
    dom.rhythmHint.textContent = '── the coil settles ──';
    dom.rhythmHint.className = 'rhythm-hint post-frenzy';
  } else {
    dom.rhythmHint.textContent = '── bite the tail on the beat ──';
    dom.rhythmHint.className = 'rhythm-hint';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Snake rendering helpers
// ─────────────────────────────────────────────────────────────────────────────

const STAGE_ICONS = ['🥚','🐍','🦎','🗺️','🏛️','🌍','🌎','⭐','🌌','🔮'];
// Enabled only when URL contains ?dev — never active on the production URL
const DEV_MODE = new URLSearchParams(window.location.search).has('dev');
// Preload stage icon images (PNG, tinted at render time)
const _stageImgs = Array.from({length: 10}, (_, i) => {
  const img = new Image();
  img.src = `icons/stage_${i}.png`;
  return img;
});

function _drawStageIcon(ctx, stageIdx, cx, cy, size, col) {
  const img = _stageImgs[stageIdx];
  if (img && img.complete && img.naturalWidth) {
    // Draw PNG onto offscreen canvas, then tint via source-in composite.
    const off = document.createElement('canvas');
    off.width = off.height = size;
    const octx = off.getContext('2d');
    octx.drawImage(img, 0, 0, size, size);
    octx.globalCompositeOperation = 'source-in';
    octx.fillStyle = col;
    octx.fillRect(0, 0, size, size);
    ctx.globalAlpha = 0.85;
    // Snap to integer pixel to prevent sub-pixel interpolation artefacts
    ctx.drawImage(off, Math.round(cx - size / 2), Math.round(cy - size / 2));
    ctx.globalAlpha = 1.0;
  } else {
    // Fallback to emoji while image loads
    ctx.font = `${size}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.85;
    ctx.fillText(STAGE_ICONS[stageIdx] || '🐍', cx, cy);
    ctx.globalAlpha = 1.0;
  }
}


// Fast HSL→RGB for the Prismatic skin rainbow cycle.
function _hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function _stageColor(stageIdx, isFrenzy) {
  // Frenzy always overrides to orange regardless of skin.
  if (isFrenzy) return [255, 160, 0];
  const skin = meta?.active_skin ?? 'emerald';
  switch (skin) {
    case 'golden':    return [241, 193,  15];
    case 'prismatic': return _hslToRgb((Date.now() / 20) % 360, 100, 65);
    case 'obsidian':  return [142, 155, 168];
    case 'skeletal':  return [223, 230, 233];
    case 'void':      return [108,  92, 231];
    case 'ancient':   return [225, 112,  85];
    default:  // emerald — original stage-based palette
      if (stageIdx >= 8) return [200, 120, 255];
      if (stageIdx >= 6) return [100, 160, 255];
      if (stageIdx >= 4) return [  0, 220, 255];
      return [0, 255, 136];
  }
}

// Shed animation state
let _shedAnim = null; // { startTime, duration, fromStageIdx }

function _startShedAnim(s) {
  _shedAnim = {
    startTime:    performance.now() / 1000,
    duration:     2.0,
    fromStageIdx: s.current_stage_index || 0,
  };
}

function _drawShedAnim(ctx, W, H, cx, cy, ringR, t) {
  const fromIdx  = _shedAnim.fromStageIdx;
  const [R,G,B]  = _stageColor(fromIdx, false);
  const col      = `rgb(${R},${G},${B})`;
  const colA     = (a) => `rgba(${R},${G},${B},${a})`;

  // Phase 1 (0 → 0.60): mouth gap closes, whole ring speeds up its spin
  // Phase 2 (0.60 → 0.80): expanding flash burst
  // Phase 3 (0.80 → 1.00): new (next-stage) baby snake fades in

  if (t < 0.60) {
    const spinAngle  = (t / 0.60) * Math.PI * 3.5;       // 1.75 full turns
    const mouthGap   = 0.03 * Math.max(0, 1 - t / 0.25); // closes by t=0.25
    const lineW      = ringR * 0.26;                       // thick shedding ring
    const glow       = lineW * (1.0 + t * 2.5);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(spinAngle);

    // Ghost track
    ctx.globalAlpha = 0.14;
    ctx.strokeStyle = col;
    ctx.lineWidth   = lineW * 0.5;
    ctx.beginPath();
    ctx.arc(0, 0, ringR, 0, Math.PI * 2);
    ctx.stroke();

    // Body arc
    const startAngle = -Math.PI / 2 + mouthGap * Math.PI * 2;
    const endAngle   = -Math.PI / 2 + (1.0 - mouthGap) * Math.PI * 2;
    ctx.globalAlpha = 1.0;
    ctx.strokeStyle = col;
    ctx.lineWidth   = lineW;
    ctx.lineCap     = 'round';
    ctx.shadowColor = col;
    ctx.shadowBlur  = glow;
    ctx.beginPath();
    ctx.arc(0, 0, ringR, startAngle, endAngle);
    ctx.stroke();
    ctx.restore();

  } else if (t < 0.80) {
    const flashT = (t - 0.60) / 0.20; // 0→1
    const alpha  = 1.0 - flashT;
    const bR     = ringR * (1.0 + flashT * 1.2);

    ctx.save();
    // Outer colour burst
    ctx.globalAlpha = alpha * 0.75;
    ctx.fillStyle   = col;
    ctx.shadowColor = col;
    ctx.shadowBlur  = bR * 1.8;
    ctx.beginPath();
    ctx.arc(cx, cy, bR, 0, Math.PI * 2);
    ctx.fill();
    // Inner white core
    ctx.globalAlpha = alpha;
    ctx.shadowBlur  = bR * 0.8;
    ctx.fillStyle   = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, cy, bR * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

  } else {
    const fadeT     = (t - 0.80) / 0.20; // 0→1
    const nextIdx   = Math.min(fromIdx + 1, BALANCE.prestige.growth_stages.length - 1);
    const [nR,nG,nB] = _stageColor(nextIdx, false);
    const nCol      = `rgb(${nR},${nG},${nB})`;
    const nColA     = (a) => `rgba(${nR},${nG},${nB},${a})`;
    const lineW     = ringR * 0.10;

    ctx.save();
    ctx.globalAlpha = fadeT;

    // Ghost track
    ctx.strokeStyle = nColA(0.12);
    ctx.lineWidth   = lineW * 0.55;
    ctx.beginPath();
    ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
    ctx.stroke();

    // Small baby body (just a sliver)
    ctx.strokeStyle = nCol;
    ctx.lineWidth   = lineW;
    ctx.lineCap     = 'round';
    ctx.shadowColor = nCol;
    ctx.shadowBlur  = lineW * 1.2;
    ctx.beginPath();
    ctx.arc(cx, cy, ringR,
      -Math.PI / 2 + 0.92 * Math.PI * 2,
      -Math.PI / 2 + 0.97 * Math.PI * 2);
    ctx.stroke();

    // Head
    const hAngle = -Math.PI / 2 + 0.97 * Math.PI * 2;
    const headR  = lineW * 0.78;
    ctx.shadowBlur = headR * 2.5;
    ctx.fillStyle  = nCol;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(hAngle) * ringR,
            cy + Math.sin(hAngle) * ringR, headR, 0, Math.PI * 2);
    ctx.fill();

    // Center icon (next stage)
    const iconSize = Math.round(ringR * 1.40);
    ctx.shadowBlur    = 0;
    ctx.textAlign     = 'center';
    ctx.textBaseline  = 'middle';
    _drawStageIcon(ctx, nextIdx, cx, cy, iconSize, nCol);

    ctx.restore();
  }
}

function renderSnake() {
  const s      = state;
  const canvas = dom.snakeArt;
  if (!canvas) return;
  if (typeof canvas.getContext !== 'function') return;

  canvas.width  = 160;
  canvas.height = 160;
  const W = 160, H = 160;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  const cx    = W / 2;
  const cy    = H / 2;
  const ringR = Math.min(W, H) * 0.38;

  // ── Shed animation takes full control ─────────────────────────────────────
  if (_shedAnim) {
    const elapsed = performance.now() / 1000 - _shedAnim.startTime;
    const t       = elapsed / _shedAnim.duration;
    if (t >= 1.0) {
      // Animation complete — perform the actual shed
      _shedAnim = null;
      const scalesEarned = performShed(state);
      const stageName    = _growthStage(state);
      // Skin + lore checks — performShed already incremented stats.sheds
      const newSkinsAtShed = checkAndGrantSkins(meta, state);
      const newLoreAtShed  = checkAndGrantLore(meta, state);
      if (newSkinsAtShed.length > 0 || newLoreAtShed.length > 0) saveMeta(meta);
      showToast(`🐍 Shed Skin → ${stageName}! +${Math.floor(scalesEarned)} Scales`, 'warning');
      for (const lid of newLoreAtShed) {
        const frag = LORE_FRAGMENTS.find(f => f.id === lid);
        showToast(`📜 Lore: ${frag ? frag.title : lid}`, 'info');
      }
      for (const sid of newSkinsAtShed) {
        const skin = SNAKE_SKINS.find(s => s.id === sid);
        showToast(`🎨 Skin unlocked: ${skin ? skin.name : sid}!`, 'success');
      }
      refreshOfferings(state, getUnlockedUpgradeSet(meta));
      computeDerived(state);
      renderAll();
      return;
    }
    _drawShedAnim(ctx, W, H, cx, cy, ringR, t);
    // Keep shed bar at 100% during animation
    dom.shedBarFill.style.width = '100%';
    dom.shedBarFill.className   = 'shed-bar-fill shed-ready';
    dom.shedBarLabel.textContent = 'Shedding…';
    dom.snakeLength.textContent  = s.snake_length;
    return;
  }

  // ── Stage / frenzy color ──────────────────────────────────────────────────
  const isFrenzy = s.frenzy_active;
  const stageIdx = s.current_stage_index || 0;
  const [R,G,B]  = _stageColor(stageIdx, isFrenzy);
  const col      = `rgb(${R},${G},${B})`;
  const colA     = (a) => `rgba(${R},${G},${B},${a})`;

  // ── Stage-relative girth & body coverage ──────────────────────────────────
  const stages       = BALANCE.prestige.growth_stages;
  const stageFloor   = stages[stageIdx][0];
  const nextIdx      = stageIdx + 1;
  const stageCeiling = nextIdx < stages.length ? stages[nextIdx][0] : stageFloor * 2;
  const stageRange   = Math.max(1, stageCeiling - stageFloor);
  const stageProgress = Math.min(1.0, Math.max(0.0,
    (s.snake_length - stageFloor) / stageRange));

  // Minimum visual progress so the snake always has a small visible body.
  const MIN_DISPLAY = 0.14;
  const displayProgress = Math.max(MIN_DISPLAY, stageProgress);
  // lineW: thin at start of stage, thick by end  (10 % → 30 % of ring radius)
  const lineW    = ringR * (0.10 + 0.20 * displayProgress);
  // tailFrac: 0 = full circle, 1 = empty.  Clamped so body always shows ~14 %.
  const tailFrac   = Math.max(0, 1.0 - displayProgress * 1.05);
  const isShedReady = canShed(s);
  // Gap sits on the TAIL side when shed-ready (mouth faces tail tip)
  // so body runs from (tailFrac + gap) → 1.0.  Normally: tailFrac → 1.0, no gap.
  const MOUTH_GAP  = 0.028;
  const bodyStart  = tailFrac + (isShedReady ? MOUTH_GAP : 0);
  const bodyEnd    = 1.0;
  let tailTipX = null;
  let tailTipY = null;

  // ── Helper: point on the single circle ring ───────────────────────────────
  const circlePt = (frac) => {
    const angle = -Math.PI / 2 + frac * Math.PI * 2;
    return [cx + Math.cos(angle) * ringR, cy + Math.sin(angle) * ringR];
  };

  // ── Ghost ring ────────────────────────────────────────────────────────────
  ctx.save();
  ctx.globalAlpha = 0.05;
  ctx.strokeStyle = col;
  ctx.lineWidth   = lineW * 0.55;
  ctx.beginPath();
  ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // ── Body arc (head-bright → tail-dim gradient) ──────────────────────────
  if (bodyStart < bodyEnd) {
    const startAngle = -Math.PI / 2 + bodyStart * Math.PI * 2;
    const endAngle   = -Math.PI / 2 + bodyEnd   * Math.PI * 2;
    // Conic gradient centred on the ring centre sweeps with the arc.
    // Stop 0 is at startAngle (tail), stop arcFrac is at endAngle (head).
    const arcFrac = (endAngle - startAngle) / (Math.PI * 2);
    const bodyGrad = ctx.createConicGradient(startAngle, cx, cy);
    bodyGrad.addColorStop(0,        colA(0.25));  // tail: dark
    bodyGrad.addColorStop(arcFrac,  colA(0.95));  // head: bright
    bodyGrad.addColorStop(1,        colA(0.25));  // wrap (not visible)
    ctx.save();
    ctx.strokeStyle = bodyGrad;
    ctx.lineWidth   = lineW;
    ctx.lineCap     = 'butt';
    ctx.shadowColor = col;
    ctx.shadowBlur  = lineW * 1.2;
    ctx.beginPath();
    ctx.arc(cx, cy, ringR, startAngle, endAngle);
    ctx.stroke();
    ctx.restore();
  }

  // ── Tapered tail tip ── hidden when shed-ready (tip would sit inside open mouth)
  if (tailFrac < 0.98 && !isShedReady) {
    const ta       = -Math.PI / 2 + tailFrac * Math.PI * 2;
    const [tx, ty] = circlePt(tailFrac);
    // Normal direction: backward (CCW, away from body).
    // When shed-ready: forward (CW, toward head/mouth) so the tip sits in the gap.
    const sign = isShedReady ? -1 : 1;
    const bx = sign * Math.sin(ta);
    const by = sign * (-Math.cos(ta));
    // perpendicular to tangent (body width axis)
    const px = Math.cos(ta);
    const py = Math.sin(ta);
    ctx.save();
    ctx.fillStyle   = colA(0.25);  // match tail-end of body gradient
    ctx.shadowColor = col;
    ctx.shadowBlur  = lineW * 0.7;
    ctx.beginPath();
    tailTipX = tx + bx * lineW * 0.85;
    tailTipY = ty + by * lineW * 0.85;
    ctx.moveTo(tailTipX, tailTipY); // point
    ctx.lineTo(tx + px * lineW * 0.52, ty + py * lineW * 0.52); // right base
    ctx.lineTo(tx - px * lineW * 0.52, ty - py * lineW * 0.52); // left base
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ── Head ─────────────────────────────────────────────────────────────────
  const headR     = lineW * 0.78;
  const [hx, hy]  = circlePt(1.0);

  ctx.save();
  ctx.shadowColor = col;
  ctx.shadowBlur  = headR * 2.5;
  ctx.fillStyle   = col;
  // Pac-man head: always draw with a mouth gap.
  // At frac=1.0 (12 o'clock) the forward CW tangent is canvas angle 0 (right).
  const mouthHalf = isShedReady ? 0.68 : 0.46; // wider mouth when ready to shed
  const mouthDir  = 0; // mouth opens rightward
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.arc(hx, hy, headR, mouthDir + mouthHalf, mouthDir - mouthHalf + Math.PI * 2, false);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.shadowBlur  = 0;

  // Eye: upper-left of head (away from mouth, which opens right)
  const eyeR = headR * 0.38;
  const ex = hx - headR * 0.22;
  const ey = hy - headR * 0.38;
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.beginPath(); ctx.arc(ex, ey, eyeR, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(ex, ey, eyeR * 0.42, 0, Math.PI * 2); ctx.fill();

  // ── Center stage icon ─────────────────────────────────────────────────────
  const iconSize = Math.round(ringR * 1.40);
  ctx.textAlign     = 'center';
  ctx.textBaseline  = 'middle';
  _drawStageIcon(ctx, stageIdx, cx, cy, iconSize, col);

  // ── Length label & shed bar ───────────────────────────────────────────────
  dom.snakeLength.textContent = s.snake_length;

  const shedInfo = _shedInfo(s);
  if (shedInfo.status === 'ascend') {
    dom.shedBarFill.style.width  = '100%';
    dom.shedBarFill.className    = 'shed-bar-fill shed-ascend';
    dom.shedBarLabel.textContent = '✦ Ready to Ascend!';
  } else if (shedInfo.status === 'ready') {
    dom.shedBarFill.style.width  = '100%';
    dom.shedBarFill.className    = 'shed-bar-fill shed-ready';
    dom.shedBarLabel.textContent = `Shed → ${shedInfo.next_stage} (+${shedInfo.reward} Scales)`;
  } else {
    const pct = shedInfo.threshold > 0
      ? Math.min(100, shedInfo.current / shedInfo.threshold * 100) : 0;
    dom.shedBarFill.style.width  = `${pct.toFixed(1)}%`;
    dom.shedBarFill.className    = 'shed-bar-fill';
    dom.shedBarLabel.textContent =
      `Next: ${shedInfo.next_stage} (${formatNumber(shedInfo.current)}/${formatNumber(shedInfo.threshold)})`;
  }

  if (isFrenzy) {
    dom.snakeArt.classList.add('frenzy-mode');
    dom.snakeArt.classList.remove('pulse');
  } else {
    dom.snakeArt.classList.remove('frenzy-mode');
  }
  dom.biteBtn.classList.toggle('frenzy-mode', !!isFrenzy);
  dom.biteBtn.classList.toggle('full-mode', !isFrenzy && canShed(s));
}

// Format large counts as compact strings: 999 → "999", 1000 → "1k", 1500 → "1.5k", etc.
function fmtCount(n) {
  const tiers = [[1e12,'T'],[1e9,'B'],[1e6,'M'],[1e3,'k']];
  for (const [div, sfx] of tiers) {
    if (n >= div) {
      const v = n / div;
      const s = v >= 100 ? Math.round(v).toString()
               : v >= 10  ? v.toFixed(1)
               :             v.toFixed(2);
      return s.replace(/\.?0+$/, '') + sfx;
    }
  }
  return String(n);
}

function renderRhythm() {
  const s = state;
  if (!s) return;

  // Sample beat position NOW — this is the ground truth for both cursor
  // position and the hit evaluation in the current frame.
  _sampleBeat();
  const { bpm, beatInterval, prog, displayProg, dist } = _beatCache;
  const timingWindowS  = getTimingWindowS(s);
  const perfectWindowS = getPerfectWindowS(s);

  dom.rhythmBpm.textContent   = `${bpm.toFixed(0)} target`;
  dom.rhythmCombo.textContent = `${s.combo_multiplier.toFixed(1)} mult`;
  if (dom.rhythmComboCount) {
    dom.rhythmComboCount.textContent = `${fmtCount(s.combo_hits || 0)} combo`;
  }
  if (dom.rhythmPerfectStreak) {
    dom.rhythmPerfectStreak.textContent = `${fmtCount(s.perfect_streak || 0)} perfect`;
  }
  if (dom.rhythmTapBpm) {
    // Latch tap BPM once per beat (when the cursor finishes a pass) so the
    // value is stable and readable rather than flickering every frame.
    const currentBeatIndex = Math.floor((_beatCache.t - s.beat_origin) / beatInterval);
    if (currentBeatIndex !== _lastBeatIndexForTap) {
      _lastBeatIndexForTap = currentBeatIndex;
      _tapBpmLocked = s.rolling_bpm > 0 ? `${Math.round(s.rolling_bpm)} rate` : '— rate';
    }
    dom.rhythmTapBpm.textContent = _tapBpmLocked;
  }

  // Feed Frenzy challenge: snap cursor pinned to centre, every press perfect
  if (s.challenge_active && s.challenge_type === 'FEED_FRENZY') {
    const frame = NUM_FRAMES - 1;
    dom.jawTop.textContent = TOP_JAW[frame];
    dom.jawBot.textContent = BOT_JAW[frame];
    dom.jawTop.className   = 'jaw jaw-perfect';
    dom.jawBot.className   = 'jaw jaw-perfect';
    dom.jawHint.textContent = 'MASH!';
    dom.jawHint.className   = 'jaw-hint hint-frenzy';
    const barTrack = dom.beatCursor.parentElement;
    if (barTrack) {
      dom.beatCursor.style.left  = `${barTrack.offsetWidth * 0.5}px`;
      dom.beatGood.style.width    = '0px';
      dom.beatPerfect.style.width = '0px';
    }
    return;
  }

  // Frenzy override
  if (s.frenzy_active) {
    const frame = NUM_FRAMES - 1;
    dom.jawTop.textContent = TOP_JAW[frame];
    dom.jawBot.textContent = BOT_JAW[frame];
    dom.jawTop.className   = 'jaw jaw-frenzy';
    dom.jawBot.className   = 'jaw jaw-frenzy';
    dom.jawHint.textContent = 'MASH!';
    dom.jawHint.className   = 'jaw-hint hint-frenzy';
    const barTrack = dom.beatCursor.parentElement;
    if (barTrack) {
      dom.beatCursor.style.left   = `${barTrack.offsetWidth * 0.5}px`;
      dom.beatGood.style.width    = '0px';
      dom.beatPerfect.style.width = '0px';
    }
    return;
  }

  const inPerfect = dist <= perfectWindowS;
  const inGood    = dist <= timingWindowS;
  const mouthOpen = s.mouth_open;

  // Jaw frame — widest opening at beat boundary
  const opennessFrac = 1.0 - Math.min((dist / beatInterval) / 0.5, 1.0);
  let frame = Math.round(opennessFrac * (NUM_FRAMES - 1));
  frame = Math.max(0, Math.min(frame, NUM_FRAMES - 1));
  dom.jawTop.textContent = TOP_JAW[frame];
  dom.jawBot.textContent = BOT_JAW[frame];

  // Jaw colour
  let jawClass = 'jaw ';
  if (s.venom_rush_active) {
    jawClass += inGood ? 'jaw-venom' : 'jaw-miss';
  } else if (!mouthOpen) {
    if      (lastBiteResult === 'perfect') jawClass += 'jaw-perfect';
    else if (lastBiteResult === 'good')    jawClass += 'jaw-good';
    else                                   jawClass += 'jaw-locked';
  } else if (inPerfect) {
    jawClass += 'jaw-perfect';
  } else if (inGood) {
    jawClass += 'jaw-good';
  } else {
    jawClass += 'jaw-idle';
  }
  dom.jawTop.className = jawClass;
  dom.jawBot.className = jawClass;

  // Hint text
  if (s.venom_rush_active) {
    dom.jawHint.textContent = 'VENOM!';
    dom.jawHint.className   = 'jaw-hint hint-venom';
  } else if (!mouthOpen) {
    dom.jawHint.textContent = '● wait';
    dom.jawHint.className   = 'jaw-hint hint-wait';
  } else if (inGood) {
    dom.jawHint.textContent = 'BITE!';
    dom.jawHint.className   = 'jaw-hint hint-bite';
  } else {
    dom.jawHint.textContent = '● wait';
    dom.jawHint.className   = 'jaw-hint hint-wait';
  }

  // Beat bar cursor + zone widths
  const barTrack = dom.beatCursor.parentElement;
  if (barTrack) {
    const trackWidth  = barTrack.offsetWidth;
    const timingFrac  = timingWindowS  / beatInterval;
    const perfectFrac = perfectWindowS / beatInterval;
    dom.beatCursor.style.left    = `${displayProg * trackWidth}px`;
    dom.beatGood.style.width    = `${timingFrac  * 2 * trackWidth}px`;
    dom.beatPerfect.style.width  = `${perfectFrac * 2 * trackWidth}px`;
  }

  // Snake pulse on beat
  if (dist / beatInterval < 0.08) {
    dom.snakeArt.classList.add('pulse');
  } else {
    dom.snakeArt.classList.remove('pulse');
  }
}

let _lastOfferingsKey = null;

const _ARCHETYPE_KEYS = [
  { id: 'coiled_striker',    key: 'Z' },
  { id: 'rhythm_incarnate',  key: 'X' },
  { id: 'patient_ouroboros', key: 'C' },
];

const _ARCHETYPE_UNLOCK_HINTS = {
  coiled_striker:    'Sustain a 5.0x combo for 15 seconds',
  rhythm_incarnate:  'Land 15 consecutive perfect bites',
  patient_ouroboros: 'Accumulate 45 seconds of idle time',
};

function _fmtCooldown(secs) {
  const m = Math.floor(secs / 60);
  const s = Math.ceil(secs % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

let _lastArchetypeSelectKey = '';

function renderArchetypeSelect() {
  if (!dom.archetypeSelect || !state || !meta) return;
  const currentId   = state.archetype_id;
  const unlocked    = meta.unlocked_archetypes || [];
  const cooldownRem = Math.max(0, state.archetype_switch_available_at - now());
  const cacheKey    = `${currentId}|${unlocked.slice().sort().join(',')}|${Math.floor(cooldownRem)}`;
  if (cacheKey === _lastArchetypeSelectKey) return;
  _lastArchetypeSelectKey = cacheKey;

  let html = '';
  _ARCHETYPE_KEYS.forEach(({ id, key }) => {
    const arch = ALL_ARCHETYPES[id];
    if (!arch) return;
    const isActive    = id === currentId;
    const isLocked    = !unlocked.includes(id);
    const onCooldown  = !isActive && !isLocked && cooldownRem > 0;

    let classes = 'archetype-card';
    if (isActive)   classes += ' active';
    if (isLocked)   classes += ' locked';
    if (onCooldown) classes += ' on-cooldown';

    let badgeHtml = '';
    if (isActive) {
      const badgeText = cooldownRem > 0
        ? `ACTIVE &bull; switch in ${_fmtCooldown(cooldownRem)}`
        : 'ACTIVE';
      badgeHtml = `<span class="archetype-active-badge">${badgeText}</span>`;
    } else if (onCooldown) {
      badgeHtml = `<span class="archetype-cooldown-badge">${_fmtCooldown(cooldownRem)}</span>`;
    }

    const descHtml = isLocked
      ? `<div class="archetype-unlock-hint">🔒 ${_ARCHETYPE_UNLOCK_HINTS[id]}</div>`
      : `<div class="upgrade-effect">${arch.description}</div>`;

    html += `
    <div class="${classes}" data-id="${id}">
      <div class="upgrade-top">
        <span>
          <span class="upgrade-key">${key}</span>
          <span class="archetype-card-name">${arch.name}</span>
        </span>
        ${badgeHtml}
      </div>
      <div class="archetype-card-tagline">${arch.tagline}</div>
      ${descHtml}
    </div>`;
  });
  dom.archetypeSelect.innerHTML = html;
  dom.archetypeSelect.querySelectorAll('.archetype-card:not(.locked):not(.on-cooldown)').forEach(card => {
    card.addEventListener('click', () => selectArchetype(card.dataset.id));
  });
}

function selectArchetype(id) {
  if (!state || !ALL_ARCHETYPES[id]) return;
  if (state.archetype_id === id) return;
  const unlocked = meta.unlocked_archetypes || [];
  if (!unlocked.includes(id)) return;
  if (state.archetype_switch_available_at > now()) return;
  state.archetype_id = id;
  state.archetype_switch_available_at = now() + ARCHETYPE_SWITCH_COOLDOWN_S;
  computeDerived(state);
  refreshOfferings(state, getUnlockedUpgradeSet(meta));
  _lastArchetypeSelectKey = '';
  renderAll();
}

function renderUpgrades() {
  const offerings = _offeringInfo(state);

  // Only rebuild DOM when offerings actually change — prevents hover flutter
  // and ensures clicks always land on stable elements.
  const key = offerings.length === 0
    ? ''
    : offerings.map(o => `${o.id}:${o.level}:${o.cost}:${o.can_afford ? 1 : 0}:${o.maxed ? 1 : 0}`).join('|');
  if (key === _lastOfferingsKey) return;
  _lastOfferingsKey = key;

  // Update keybind legend to reflect actual offering count
  if (dom.kbBuyRange) dom.kbBuyRange.textContent = `1-${offerings.length || 3}`;

  if (offerings.length === 0) {
    dom.upgradeList.innerHTML = '<div class="no-offerings">Feed to grow, then offerings appear.</div>';
    return;
  }
  let html = '';
  offerings.forEach((o, i) => {
    const cls      = o.maxed ? 'maxed' : (o.can_afford ? 'affordable' : 'unaffordable');
    const costText = o.maxed ? 'MAX' : `Cost: ${o.cost}`;
    const costCls  = o.maxed ? 'maxed' : (o.can_afford ? 'affordable' : 'unaffordable');

    // Split description into flavor text + mechanical effect
    // Effects typically start with +, -, or a digit after a sentence break
    let flavor = o.description;
    let effect = '';
    const m = o.description.match(/^(.+?[.!])\s*([+\-\d].+)$/);
    if (m) {
      flavor = m[1];
      effect = m[2];
    }

    html += `
    <div class="upgrade-card ${cls}" data-uid="${o.id}">
      <div class="upgrade-top">
        <span>
          <span class="upgrade-key">${i + 1}</span>
          <span class="upgrade-name">${o.name}</span>
        </span>
        <span class="upgrade-level">Lv.${o.level}/${o.max_level}</span>
      </div>
      <div class="upgrade-desc">${flavor}</div>
      ${effect ? `<div class="upgrade-effect">${effect}</div>` : ''}
      <div class="upgrade-cost ${costCls}">${costText}</div>
    </div>`;
  });
  dom.upgradeList.innerHTML = html;
}

function formatChallengeType(challengeType) {
  const labels = {
    FEED_FRENZY: 'Feed Frenzy',
    COMBO_SUSTAIN: 'Combo Sustain',
    PATIENCE: 'Patience',
  };
  return labels[challengeType] || 'Challenge';
}

function renderEvents() {
  const s  = state;
  const ev = events;
  const t  = now();

  if (s.frenzy_active) {
    const remaining = Math.max(0, s.frenzy_end_time - t);
    dom.eventOverlay.className = 'frenzy';
    dom.eventText.textContent  = `🐍 FEEDING FRENZY! MASH SPACE! ${s.frenzy_presses} bites`;
    dom.eventTimer.textContent = `${remaining.toFixed(1)}s`;
    dom.eventActionBtn.classList.add('hidden');
  } else if (s.golden_active) {
    const remaining = Math.max(0, s.golden_end_time - t);
    dom.eventOverlay.className     = 'golden';
    dom.eventText.textContent      = '✦ GOLDEN OUROBOROS! ✦';
    dom.eventTimer.textContent     = `${remaining.toFixed(1)}s`;
    dom.eventActionBtn.textContent = isMobile() ? 'Catch!' : '[G] Catch!';
    dom.eventActionBtn.className   = '';
    dom.eventActionBtn.onclick     = catchGolden;
  } else if (s.challenge_active) {
    const remaining = Math.max(0, s.challenge_end_time - t);
    const pct = s.challenge_target > 0
      ? Math.min(100, s.challenge_progress / s.challenge_target * 100) : 0;
    const challengeLabel = formatChallengeType(s.challenge_type);
    let bannerText;
    if (s.challenge_type === 'FEED_FRENZY') {
      const tapBpm = Math.round(s.rolling_bpm);
      bannerText = `⚡ Feeding Frenzy — ${tapBpm} / 150 BPM`;
    } else if (s.challenge_type === 'COMBO_SUSTAIN' && s.challenge_combo_target > 0) {
      const hasCombo = s.combo_multiplier >= s.challenge_combo_target;
      const comboStatus = hasCombo ? '✅' : `need ${s.challenge_combo_target.toFixed(0)}×`;
      bannerText = `⚡ ${challengeLabel} (${comboStatus}) — ${pct.toFixed(0)}%`;
    } else {
      bannerText = `⚡ ${challengeLabel} — ${pct.toFixed(0)}%`;
    }
    dom.eventOverlay.className = 'challenge';
    dom.eventText.textContent  = bannerText;
    dom.eventTimer.textContent = `${remaining.toFixed(1)}s`;
    dom.eventActionBtn.classList.add('hidden');
  } else if (ev && ev.bargain_active) {
    dom.eventOverlay.className     = 'bargain';
    dom.eventText.textContent      = "🐍 Serpent's Bargain — Sacrifice 30% essence for a free upgrade";
    dom.eventTimer.textContent     = '';
    dom.eventActionBtn.textContent = isMobile() ? 'Accept' : '[B] Accept';
    dom.eventActionBtn.className   = '';
    dom.eventActionBtn.onclick     = acceptBargain;
  } else if (ev && ev.echo_active) {
    const uid  = ev.echo_upgrade_id;
    const name = ALL_UPGRADES[uid] ? ALL_UPGRADES[uid].name : uid;
    dom.eventOverlay.className     = 'echo';
    dom.eventText.textContent      = `✦ Ancient Echo — Free upgrade: ${name}`;
    dom.eventTimer.textContent     = '';
    dom.eventActionBtn.textContent = isMobile() ? 'Claim' : '[E] Claim';
    dom.eventActionBtn.className   = '';
    dom.eventActionBtn.onclick     = acceptEcho;
  } else {
    dom.eventOverlay.className = 'hidden';
    dom.eventActionBtn.classList.add('hidden');
  }
}

function renderPrestige() {
  const info = _shedInfo(state);
  let html = '';
  let tip = '';
  if (info.status === 'ascend') {
    html = '<span style="color:var(--purple)">✦ Ready to Ascend! Open the upgrade tree.</span>';
    tip = 'You reached final-stage threshold. Ascend to convert run progress into permanent progression.';
    dom.shedBtn.disabled   = true;
    dom.ascendBtn.disabled = false;
  } else if (info.status === 'ready') {
    html = `<span style="color:var(--yellow)">Shed → ${info.next_stage} (+${info.reward} Scales)</span>`;
    tip = `Shed now to advance to ${info.next_stage} and gain about ${info.reward} Scales.`;
    dom.shedBtn.disabled   = false;
    dom.ascendBtn.disabled = true;
  } else {
    const pct = info.threshold > 0
      ? Math.min(100, info.current / info.threshold * 100) : 0;
    html = `Next: ${info.next_stage} (${formatNumber(info.current)}/${formatNumber(info.threshold)} — ${pct.toFixed(0)}%)`;
    tip = `Progress toward ${info.next_stage}: ${pct.toFixed(0)}%.`;
    dom.shedBtn.disabled   = true;
    dom.ascendBtn.disabled = true;
  }
  dom.prestigeContent.innerHTML = html;
  dom.prestigeContent.title = tip;
}

function renderRunStats() {
  if (!dom.runStats || !state || !state.stats) return;
  const s = state.stats;
  const scored = Math.max(0, s.scored_bites || 0);
  const perfect = Math.max(0, s.perfect_bites || 0);
  const perfectPct = scored > 0 ? (perfect / scored * 100) : 0;
  dom.runStats.innerHTML = `
    <div class="run-stat-card" title="Highest combo multiplier reached in this run">
      <div class="run-stat-label" title="Highest combo multiplier reached in this run">Max Combo</div>
      <div class="run-stat-value">${Number(s.combo_high || 1).toFixed(1)}x</div>
    </div>
    <div class="run-stat-card" title="Longest consecutive perfect-bite chain in this run">
      <div class="run-stat-label" title="Longest consecutive perfect-bite chain in this run">Perfect Chain</div>
      <div class="run-stat-value">${Math.floor(s.best_perfect_chain || 0)}</div>
    </div>
    <div class="run-stat-card" title="Perfect accuracy = perfect bites / scored bites">
      <div class="run-stat-label" title="Perfect accuracy = perfect bites / scored bites">Perfect %</div>
      <div class="run-stat-value">${perfectPct.toFixed(2)}%</div>
    </div>
    <div class="run-stat-card" title="How many times Venom Rush activated this run">
      <div class="run-stat-label" title="How many times Venom Rush activated this run">Venom Rush</div>
      <div class="run-stat-value">${Math.floor(s.venom_rush_procs || 0)}</div>
    </div>
    <div class="run-stat-card" title="Golden Ouroboros catches this run">
      <div class="run-stat-label" title="Golden Ouroboros catches this run">Goldens</div>
      <div class="run-stat-value">${Math.floor(s.golden_caught || 0)}</div>
    </div>
    <div class="run-stat-card" title="Debuffs applied to you this run">
      <div class="run-stat-label" title="Debuffs applied to you this run">Debuffs</div>
      <div class="run-stat-value">${Math.floor(s.debuffs_triggered || 0)}</div>
    </div>
  `;
}

function renderAscensionBadge() {
  if (meta && meta.ascension_count > 0) {
    dom.ascensionBadge.classList.remove('hidden');
    dom.ascensionCount.textContent = meta.ascension_count;
  }
}

// ---------------------------------------------------------------------------
// Feedback Display
// ---------------------------------------------------------------------------

function showBiteFeedback(result) {
  if (!result) return;
  lastBiteResult = result;
  clearTimeout(feedbackTimer);
  clearTimeout(feedbackFadeTimer);
  const labels = {
    perfect:     '✦ PERFECT BITE ✦',
    good:        'GOOD BITE',
    'auto-good': '⟳ AUTO BITE',
    honed:       '✦ HONED BITE ✦',
    miss:        'CHOMP — MISS!',
    'idle-miss': 'Rhythm slipping…',
    saved:       '★ COMBO SAVED! ★',
  };
  dom.feedback.textContent = labels[result] || '';
  dom.feedback.className   = `feedback fb-${result}`;
  feedbackTimer = setTimeout(() => {
    dom.feedback.classList.add('fb-fading');
    feedbackFadeTimer = setTimeout(() => {
      dom.feedback.textContent = '';
      dom.feedback.className   = 'feedback';
    }, 300);
  }, FEEDBACK_DURATION);
}

function maybeShowIdleMissFeedback(state, comboBeforeDecay) {
  if (!state) return;
  if (comboBeforeDecay <= 1.0) {
    _lastIdleMissVisualBeat = -1;
    return;
  }
  if (state.frenzy_active) return;

  const beatInterval  = 60.0 / Math.max(getCurrentBpm(state), 1);
  const timingWindow  = getTimingWindowS(state);
  const t             = now();

  // Only visualize true idle misses (no recent press).
  if (t - state.last_press_time < beatInterval * 0.9) return;

  const elapsed           = t - state.beat_origin;
  const currentBeatIndex  = Math.floor(elapsed / beatInterval);
  if (currentBeatIndex <= state.last_scored_beat_index) return;
  if (currentBeatIndex === _lastIdleMissVisualBeat) return;

  // Wait until the timing window for this beat has fully closed before
  // declaring a miss — otherwise we fire in the middle of the hit zone.
  const beatPos = elapsed - currentBeatIndex * beatInterval;
  if (beatPos < timingWindow) return;

  _lastIdleMissVisualBeat = currentBeatIndex;
  state.perfect_streak = 0;  // missed beat — break perfect streak immediately
  showBiteFeedback('idle-miss');
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function doFeed() {
  if (!state) return;
  if (_shedAnim) return;  // block biting during shed animation

  // DO NOT resample here. _beatCache.t was set by the most recent renderRhythm()
  // rAF call — that is the exact timestamp used to draw the cursor pixel the
  // player is reacting to. Scoring at the same time = true physical detection:
  // what you see on the bar is exactly what gets evaluated.
  const result = attemptBite(state, _beatCache.t);
  if (result === null) return;  // mouth locked

  handlePress(state);
  showBiteFeedback(result);
  lastBiteResult = result;

  computeDerived(state);

  if (state.current_offerings.length === 0) {
    refreshOfferings(state, getUnlockedUpgradeSet(meta));
  }
  renderAll();
}

function buyUpgradeById(uid) {
  if (!state) return;
  const ok = purchaseUpgrade(state, uid);
  if (ok) {
    showToast('Upgraded!', 'success');
    refreshOfferings(state, getUnlockedUpgradeSet(meta));
    computeDerived(state);
    renderAll();
  } else {
    showToast("Can't afford that upgrade.", 'error');
  }
}

function buyUpgrade(index) {
  const uid = (state.current_offerings || [])[index];
  if (uid) buyUpgradeById(uid);
}

function doShed() {
  if (_shedAnim) return;                   // already animating
  if (!state || !canShed(state)) {
    showToast('Not ready to shed — grow more!', 'error');
    return;
  }
  // Start the visual animation; performShed is called at the end of renderSnake
  _startShedAnim(state);
}

function catchGolden() {
  if (!state || !events) return;
  const caught = events.catchGolden(state);
  if (caught) showToast('🐍 FEEDING FRENZY! MASH SPACE!', 'warning');
  renderAll();
}

function acceptBargain() {
  if (!state || !events) return;
  const ok = events.acceptBargain(state, getUnlockedUpgradeSet(meta));
  if (ok) {
    showToast('Bargain accepted — essence sacrificed, upgrade granted!', 'success');
    computeDerived(state);
    renderAll();
  }
}

function acceptEcho() {
  if (!state || !events) return;
  const ok = events.acceptEcho(state, getUnlockedUpgradeSet(meta));
  if (ok) {
    showToast('Ancient Echo accepted — free upgrade!', 'success');
    computeDerived(state);
    renderAll();
  }
}



function doSave() {
  if (!state) return;
  if (_saveEpoch !== getSaveEpoch()) {
    showToast('Save blocked: another tab/session reset save data. Reload this tab.', 'error');
    return;
  }
  saveRun(state, events);
  saveMeta(meta);
  const knowledge = computeKnowledgeReward(state.stats);
  showToast(`Game saved! (${knowledge} Knowledge pending on run end)`, 'success');
}

const _SNARKY_WIPE = [
  'Done. Every scale, every upgrade, every memory — gone. Hope it was worth it.',
  'Remarkable. Truly the bravest move in idle gaming. Your serpent is no more.',
  'The void has claimed your progress. It was absolutely delicious.',
  'Everything, obliterated. The universe remains unimpressed.',
  'Bold. Foolish. Magnificent. Starting fresh, just like the ouroboros intended.',
];

function doClearSave() {
  // Step 1: reveal inline confirm, hide the initial button
  if (!dom.clearSaveBtn || !dom.clearSaveConfirm) return;
  dom.clearSaveBtn.classList.add('hidden');
  dom.clearSaveConfirm.classList.remove('hidden');
}

function confirmClearSave() {
  rotateSaveEpoch();
  purgeAllSaveData();
  closeSettings();
  location.reload();
}

// ---------------------------------------------------------------------------
// Ascension Modal
// ---------------------------------------------------------------------------

function openAscensionModal() {
  if (!state || !canAscend(state)) {
    const stages = BALANCE.prestige.growth_stages;
    const finalIdx = stages.length - 1;
    if (state && state.current_stage_index === finalIdx) {
      showToast(`Grow to ${formatNumber(stages[finalIdx][0])} length to Ascend.`, 'error');
    } else {
      showToast('Reach Cosmic Scale first to Ascend.', 'error');
    }
    return;
  }
  ascensionPurchases = {};
  renderAscensionModal();
  dom.ascensionModal.classList.remove('hidden');
}

function closeAscensionModal() {
  dom.ascensionModal.classList.add('hidden');
}

function renderAscensionModal() {
  let availableScales = state.scales;

  // Subtract pending purchases
  for (const [uid, times] of Object.entries(ascensionPurchases)) {
    const udef     = ASCENSION_UPGRADES[uid];
    if (!udef) continue;
    const baseLevel = meta.ascension_upgrade_levels[uid] || 0;
    for (let i = 0; i < times; i++) {
      availableScales -= ascCostAtLevel(udef, baseLevel + i);
    }
  }
  availableScales = Math.max(0, availableScales);
  dom.modalScales.textContent = formatNumber(Math.floor(availableScales));

  let html = '';
  for (const [uid, udef] of Object.entries(ASCENSION_UPGRADES)) {
    const baseLevel    = meta.ascension_upgrade_levels[uid] || 0;
    const pending      = ascensionPurchases[uid] || 0;
    const effectiveLvl = baseLevel + pending;
    const maxed        = effectiveLvl >= udef.max_level;
    const cost         = ascCostAtLevel(udef, effectiveLvl);
    const canBuy       = !maxed && availableScales >= cost;
    const cls          = canBuy ? 'can-buy' : '';
    html += `
    <div class="asc-upgrade ${cls}" onclick="buyAscensionUpgradeModal('${uid}')">
      <div class="asc-upgrade-info">
        <div class="asc-upgrade-name">${udef.name} (Lv.${effectiveLvl}/${udef.max_level})</div>
        <div class="asc-upgrade-desc">${udef.description}</div>
      </div>
      <div class="asc-upgrade-cost">${maxed ? 'MAX' : formatNumber(cost) + ' Scales'}</div>
    </div>`;
  }
  dom.ascensionList.innerHTML = html;
}

function buyAscensionUpgradeModal(uid) {
  ascensionPurchases[uid] = (ascensionPurchases[uid] || 0) + 1;
  renderAscensionModal();
}

function confirmAscension() {
  if (!state || !meta) return;

  // Commit pending purchases to meta
  let currentScales = state.scales;
  for (const [uid, times] of Object.entries(ascensionPurchases)) {
    const udef = ASCENSION_UPGRADES[uid];
    if (!udef) continue;
    const baseLevel = meta.ascension_upgrade_levels[uid] || 0;
    for (let i = 0; i < times; i++) {
      const lvl  = baseLevel + i;
      if (lvl >= udef.max_level) break;
      const cost = ascCostAtLevel(udef, lvl);
      if (currentScales < cost) break;
      currentScales -= cost;
      meta.ascension_upgrade_levels[uid] = (meta.ascension_upgrade_levels[uid] || 0) + 1;
    }
  }
  state.scales = currentScales;

  meta.ascension_count += 1;
  applyRunResults(meta, state.stats);

  // Skin & lore unlock checks — must run before performAscension wipes state
  const newSkins = checkAndGrantSkins(meta, state);
  const newLore  = checkAndGrantLore(meta, state);

  performAscension(state);
  applyAscensionStartingBonuses(meta, state);

  // Archetypes are now earned through playstyle, not assigned at random.
  // Clear everything — player will awaken a new archetype by playing naturally.
  state.archetype_id          = '';
  state.archetype_switch_available_at = 0.0;
  state.notified_unlocks      = [];
  state.debuff_id             = '';
  state.debuff_end_time       = 0.0;
  state.resonance_perfects    = 0;
  state.combo_peak_seconds    = 0.0;
  state.snake_length = getStartingLength(meta);
  computeDerived(state);
  refreshOfferings(state, getUnlockedUpgradeSet(meta));

  events = new EventManager();

  for (const lid of newLore) {
    const frag = LORE_FRAGMENTS.find(f => f.id === lid);
    showToast(`📜 Lore: ${frag ? frag.title : lid}`, 'info');
  }
  for (const skinId of newSkins) {
    const skin = SNAKE_SKINS.find(s => s.id === skinId);
    showToast(`🎨 Skin unlocked: ${skin ? skin.name : skinId}!`, 'success');
  }
  showToast(`✦ ASCENSION ${meta.ascension_count}! The eternal cycle begins anew.`, 'warning');
  closeAscensionModal();
  saveMeta(meta);
  saveRun(state, events);
  renderAll();
}

// ---------------------------------------------------------------------------
// Input Handling
// ---------------------------------------------------------------------------

// ── DEV: stage skip (Shift+] next / Shift+[ prev) — only active with ?dev ──
function devSetStage(targetIdx) {
  if (!state || !DEV_MODE) return;
  const stages = BALANCE.prestige.growth_stages;
  targetIdx = Math.max(0, Math.min(targetIdx, stages.length - 1));
  state.current_stage_index = targetIdx;
  // Set length to threshold + 10% so the shed bar isn't immediately full
  const threshold = stages[targetIdx][0];
  state.snake_length        = Math.max(3, Math.floor(threshold * 1.10));
  state.essence             = state.snake_length * BALANCE.economy.essence_per_length;
  state.stage_essence_earned = state.essence;
  state.combo_hits          = 0;
  state.combo_misses        = 0;
  state.combo_multiplier    = 1.0;
  state.last_press_time     = 0.0;
  state.last_scored_beat_index      = -1;
  state.last_auto_bite_beat_index   = -1;
  state.frenzy_active       = false;
  state.venom_rush_active   = false;
  _shedAnim                 = null;   // cancel any in-progress shed animation
  computeDerived(state);
  refreshOfferings(state, getUnlockedUpgradeSet(meta));
  renderAll();
  const stageName = _growthStage(state);
  showToast(`⚡ DEV → Stage ${targetIdx}: ${stageName}`, 'warning');
}

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  if (!dom.ascensionModal.classList.contains('hidden')) {
    if (e.key === 'Escape') closeAscensionModal();
    return;
  }

  if (_welcomeModal && !_welcomeModal.classList.contains('hidden')) {
    if (e.key === 'Escape') closeWelcome();
    return;
  }

  if (dom.collectionsModal && !dom.collectionsModal.classList.contains('hidden')) {
    if (e.key === 'Escape') closeCollections();
    return;
  }
  if (dom.settingsModal && !dom.settingsModal.classList.contains('hidden')) {
    if (e.key === 'Escape') closeSettings();
    return;
  }

  if (dom.guideModal && !dom.guideModal.classList.contains('hidden')) {
    if (e.key === 'Escape') closeGuide();
    return;
  }

  // Block OS key-repeat — each physical press must be a distinct down+up cycle.
  // This stops holding spacebar from cheesing frenzy mode (which has no cooldown).
  if (e.repeat) return;

  switch (e.code) {
    case 'Space':
    case 'Enter':
      e.preventDefault();
      doFeed();
      dom.biteBtn.classList.add('pressed');
      setTimeout(() => dom.biteBtn.classList.remove('pressed'), 100);
      break;
    case 'Digit1': case 'Numpad1': buyUpgrade(0); break;
    case 'Digit2': case 'Numpad2': buyUpgrade(1); break;
    case 'Digit3': case 'Numpad3': buyUpgrade(2); break;
    case 'Digit4': case 'Numpad4': buyUpgrade(3); break;
    case 'Digit5': case 'Numpad5': buyUpgrade(4); break;
    case 'Digit6': case 'Numpad6': buyUpgrade(5); break;
    case 'KeyS': doShed();             break;
    case 'KeyA': openAscensionModal(); break;
    case 'KeyG': catchGolden();        break;
    case 'KeyB': acceptBargain();      break;
    case 'KeyE': acceptEcho();            break;
    case 'KeyZ': selectArchetype('coiled_striker');    break;
    case 'KeyX': selectArchetype('rhythm_incarnate');  break;
    case 'KeyC': selectArchetype('patient_ouroboros'); break;
    // DEV stage skip (only with ?dev in URL)
    case 'BracketRight': if (DEV_MODE && e.shiftKey && state) devSetStage((state.current_stage_index || 0) + 1); break;
    case 'BracketLeft':  if (DEV_MODE && e.shiftKey && state) devSetStage((state.current_stage_index || 0) - 1); break;
  }
});

dom.biteBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); doFeed(); });
dom.shedBtn.addEventListener('click', doShed);
dom.ascendBtn.addEventListener('click', openAscensionModal);
dom.saveBtn.addEventListener('click', doSave);
if (dom.collectionsBtn)      dom.collectionsBtn.addEventListener('click', openCollections);
if (dom.collectionsCloseBtn) dom.collectionsCloseBtn.addEventListener('click', closeCollections);
if (dom.collectionsModal) {
  dom.collectionsModal.addEventListener('click', (e) => {
    if (e.target === dom.collectionsModal) closeCollections();
  });
}
if (dom.collectionsModal) {
  dom.collectionsModal.addEventListener('click', (e) => {
    const btn = e.target.closest('.guide-tab[data-col-tab]');
    if (btn) _renderCollectionsTab(btn.dataset.colTab);
  });
}
if (dom.settingsBtn) dom.settingsBtn.addEventListener('click', openSettings);
if (dom.settingsCloseBtn) dom.settingsCloseBtn.addEventListener('click', closeSettings);
if (dom.settingsModal) {
  dom.settingsModal.addEventListener('click', (e) => {
    if (e.target === dom.settingsModal) closeSettings();
  });
}
if (dom.clearSaveBtn)    dom.clearSaveBtn.addEventListener('click', doClearSave);
if (dom.clearConfirmYes) dom.clearConfirmYes.addEventListener('click', confirmClearSave);
if (dom.clearConfirmNo)  dom.clearConfirmNo.addEventListener('click', () => { _resetClearSaveUI(); });
if (dom.autoSaveToggle) {
  dom.autoSaveToggle.addEventListener('change', () => {
    if (!meta) return;
    meta.auto_save_enabled = !!dom.autoSaveToggle.checked;
    saveMeta(meta);
    showToast(`Auto-save ${meta.auto_save_enabled ? 'enabled' : 'disabled'}.`, 'info');
  });
}
if (dom.showWelcomeToggle) {
  dom.showWelcomeToggle.addEventListener('change', () => {
    if (!meta) return;
    meta.show_welcome_modal = !!dom.showWelcomeToggle.checked;
    saveMeta(meta);
    if (!meta.show_welcome_modal && _welcomeModal && !_welcomeModal.classList.contains('hidden')) {
      closeWelcome();
    }
    showToast(`Welcome modal ${meta.show_welcome_modal ? 'enabled' : 'hidden'}.`, 'info');
  });
}

// Upgrade cards — event delegation so dynamically rendered cards are always clickable
dom.upgradeList.addEventListener('click', (e) => {
  const card = e.target.closest('.upgrade-card[data-uid]');
  if (!card) return;
  const uid = card.dataset.uid;
  if (uid) buyUpgradeById(uid);
});
dom.ascendConfirm.addEventListener('click', confirmAscension);
dom.ascendCancel.addEventListener('click', closeAscensionModal);
dom.ascensionModal.addEventListener('click', (e) => {
  if (e.target === dom.ascensionModal) closeAscensionModal();
});

// ---------------------------------------------------------------------------
// Guide Modal
// ---------------------------------------------------------------------------

const GUIDE_TABS = {
  basics: function() {
    return `
      <h3>How to Play</h3>
      <p>Ouro is a rhythm-based idle game. You grow an eternal serpent by <strong>biting your own tail in time with the beat</strong>. Each successful bite earns Essence, which makes you longer and unlocks upgrades.</p>

      <h3>The Beat Bar</h3>
      <p>A cursor sweeps across the beat bar at the bottom of the screen. Time your bite (press <span class="keybind-hint">Space</span> or click the Bite button) to land in the scoring zones:</p>
      <ul>
        <li><strong>Perfect</strong> — Dead-center on the beat. Worth double combo credit and advances your Venom Rush streak.</li>
        <li><strong>Good</strong> — Close to the beat. Builds combo normally.</li>
        <li><strong>Miss</strong> — Outside the timing window. Damages your combo and can trigger debuffs.</li>
      </ul>

      <h3>Combo</h3>
      <p>Consecutive successful bites build your <strong>Combo Multiplier</strong>, which increases all Essence earned. Higher combos unlock higher multiplier tiers. Two consecutive misses will break your combo entirely.</p>
      <table class="stat-table">
        <tr><th>Hits</th><th>Multiplier</th></tr>
        <tr><td>0</td><td>1.0x</td></tr>
        <tr><td>5</td><td>1.5x</td></tr>
        <tr><td>15</td><td>2.0x</td></tr>
        <tr><td>30</td><td>3.0x</td></tr>
        <tr><td>60</td><td>5.0x</td></tr>
        <tr><td>100</td><td>8.0x</td></tr>
      </table>

      <h3>Venom Rush</h3>
      <p>Land <strong>15 perfect bites in a row</strong> (10 with the Rhythm Incarnate archetype) to trigger Venom Rush — a short burst that grants bonus Essence on every beat.</p>

      <h3>Tempo</h3>
      <p>The game starts each stage at <strong>60 BPM</strong> and ramps upward in <strong>10 BPM steps</strong> as you approach the next Shed Skin threshold, reaching up to <strong>120 BPM</strong> (higher with Ascension upgrades) right before you shed. After shedding, the tempo resets back to 60 BPM for the new stage. Catching a Golden Ouroboros temporarily spikes the BPM to maximum, which then gradually cools back down to your natural tempo.</p>

      <h3>Idle Income</h3>
      <p>Your serpent digests passively even when you're not pressing. Idle income scales with your total upgrades and archetype bonuses.</p>

      <h3>Controls</h3>
      <table class="stat-table">
        <tr><th>Key</th><th>Action</th></tr>
        <tr><td><span class="keybind-hint">Space</span></td><td>Bite (also Enter or click)</td></tr>
        <tr><td><span class="keybind-hint">1</span>–<span class="keybind-hint">6</span></td><td>Buy upgrade in slot (up to 6 with Serpent's Hoard)</td></tr>
        <tr><td><span class="keybind-hint">S</span></td><td>Shed Skin (prestige within a run)</td></tr>
        <tr><td><span class="keybind-hint">A</span></td><td>Ascend (full reset with permanent upgrades)</td></tr>
        <tr><td><span class="keybind-hint">G</span></td><td>Catch Golden Ouroboros</td></tr>
        <tr><td><span class="keybind-hint">B</span></td><td>Accept Serpent's Bargain</td></tr>
        <tr><td><span class="keybind-hint">E</span></td><td>Accept Ancient Echo</td></tr>
      </table>
    `;
  },

  upgrades: function() {
    const tierLabels = ['Standard Upgrades', 'Advanced Upgrades', 'Cosmic Upgrades'];
    const tierDescs  = [
      'Available from the start. The foundation of your serpent\'s power.',
      'Unlocked through Knowledge gained across multiple runs.',
      'Exclusive to cosmic-level serpents. Require Cosmic Scale stage to access.'
    ];
    let html = '<h3>Upgrades</h3>';
    html += '<p>Upgrades are purchased with Essence. Each has multiple levels, and costs increase with each purchase. The <strong>Venomous Bite</strong> upgrade reduces all upgrade costs.</p>';
    html += '<p>Your upgrade offerings refresh when you Shed Skin. Different archetypes favor different upgrade pools.</p>';

    for (let tier = 0; tier <= 2; tier++) {
      html += `<div class="guide-tier-label">${tierLabels[tier]}</div>`;
      html += `<p style="font-size:0.7rem;margin-top:0;">${tierDescs[tier]}</p>`;
      for (const u of Object.values(ALL_UPGRADES)) {
        if (u.tier !== tier) continue;
        html += `<div class="guide-item">`;
        html += `  <div class="guide-item-name">${u.name}</div>`;
        html += `  <div class="guide-item-desc">${u.description} <span style="color:var(--text-dim);">(Max level: ${u.max_level})</span></div>`;
        html += `</div>`;
      }
    }
    return html;
  },

  events: function() {
    return `
      <h3>Events</h3>
      <p>Events appear periodically during gameplay. Each has a colored banner at the top of the screen and a limited time to act.</p>

      <div class="guide-item">
        <div class="guide-item-name yellow">Golden Ouroboros</div>
        <div class="guide-item-desc">
          A golden serpent appears briefly. Press <span class="keybind-hint">G</span> to catch it and trigger a <strong>Feeding Frenzy</strong> — a timed bonus phase where every press counts as a perfect hit and earns massive Essence. The frenzy reward scales with how many times you press during it. Higher combo tiers when you catch it extend the frenzy duration. Appears every 45–120 seconds.
        </div>
      </div>

      <div class="guide-item">
        <div class="guide-item-name cyan">Timed Challenge</div>
        <div class="guide-item-desc">
          A skill test with a 10-second timer. Three types:
          <ul>
            <li><strong>Feed Frenzy</strong> — Bite a target number of times before time runs out. Failing applies the Sluggish Jaw debuff.</li>
            <li><strong>Combo Sustain</strong> — Hold a specific combo multiplier for the full duration. Failing applies Shattered Rhythm.</li>
            <li><strong>Patience</strong> — Don't press anything for the full duration. Pressing early fails the challenge and applies Reckless Strike.</li>
          </ul>
          Completing a challenge rewards a large Essence bonus. Appears every 2–4 minutes.
        </div>
      </div>

      <div class="guide-item">
        <div class="guide-item-name green">Serpent's Bargain</div>
        <div class="guide-item-desc">
          Press <span class="keybind-hint">B</span> to sacrifice <strong>30% of your current Essence</strong> in exchange for a free upgrade from your current offerings. The first available upgrade in your offering list is granted automatically. Appears every 90–180 seconds and lasts 12 seconds.
        </div>
      </div>

      <div class="guide-item">
        <div class="guide-item-name purple">Ancient Echo</div>
        <div class="guide-item-desc">
          Press <span class="keybind-hint">E</span> to receive a <strong>free level in a random upgrade</strong> at no cost. The upgrade is chosen from your available pool. The echo lasts 30 seconds before fading. Appears every 3–6 minutes.
        </div>
      </div>
    `;
  },

  archetypes: function() {
    return `
      <h3>Archetypes</h3>
      <p>Archetypes are <strong>permanent playstyle identities</strong> that you unlock by demonstrating the right behaviour during any run. Once unlocked, an archetype is yours forever across all runs — select it freely from the Archetype panel on the left using its key or by clicking.</p>
      <p><strong>Switching carries a 15-minute cooldown.</strong> You begin each run with no archetype active. Choose deliberately — you cannot swap again until the cooldown expires.</p>

      <div class="guide-item">
        <div class="guide-item-name">Rhythm Incarnate <span style="font-weight:400;color:var(--text-dim)">— press X</span></div>
        <div class="guide-item-desc">
          <strong>"You are the beat."</strong><br>
          <em>Unlock: land 15 consecutive perfect bites in a single run.</em><br>
          The perfect timing zone is 40% wider, and Venom Rush triggers after only 10 perfects instead of 15. Pure mastery rewards.
        </div>
      </div>

      <div class="guide-item">
        <div class="guide-item-name">Coiled Striker <span style="font-weight:400;color:var(--text-dim)">— press Z</span></div>
        <div class="guide-item-desc">
          <strong>"Strike fast. Strike hard."</strong><br>
          <em>Unlock: sustain a 5.0x combo (60+ hits) for 15 unbroken seconds.</em><br>
          +25% Essence per press, every combo tier grants an extra +1.0x bonus. Trade-off: timing window is 20% tighter and idle income is halved.
        </div>
      </div>

      <div class="guide-item">
        <div class="guide-item-name">Patient Ouroboros <span style="font-weight:400;color:var(--text-dim)">— press C</span></div>
        <div class="guide-item-desc">
          <strong>"The coil tightens while you rest."</strong><br>
          <em>Unlock: accumulate 45 seconds of idle time in a single run.</em><br>
          Idle income ×2.5, full debuff immunity. Trade-off: active Essence per press −20%, combo builds at half speed.
        </div>
      </div>
    `;
  },

  debuffs: function() {
    return `
      <h3>Debuffs</h3>
      <p>Debuffs are <strong>temporary penalties</strong> triggered by poor play. Each lasts for 8 seconds. Only one debuff can be active at a time — if you already have one, new triggers are ignored until it expires.</p>

      <div class="guide-item">
        <div class="guide-item-name orange">Reckless Strike</div>
        <div class="guide-item-desc">Your timing window shrinks by 30%. Triggered by pressing during a Patience challenge.</div>
      </div>

      <div class="guide-item">
        <div class="guide-item-name orange">Shattered Rhythm</div>
        <div class="guide-item-desc">Your combo breaks after just one miss instead of two. Triggered by failing a Combo Sustain challenge.</div>
      </div>

      <div class="guide-item">
        <div class="guide-item-name orange">Sluggish Jaw</div>
        <div class="guide-item-desc">Bite cooldown takes 40% longer, reducing how quickly you can press again. Triggered by failing a Feed Frenzy challenge.</div>
      </div>

      <div class="guide-item">
        <div class="guide-item-name orange">Leaking Venom</div>
        <div class="guide-item-desc">Essence earned per press is reduced by 25%. Triggered by certain failure conditions.</div>
      </div>

      <div class="guide-item">
        <div class="guide-item-name orange">Hollow Scales</div>
        <div class="guide-item-desc">Idle income is halved. Triggered by 3 consecutive missed bites.</div>
      </div>
    `;
  },

  ascension: function() {
    let html = `
      <h3>Progression</h3>
      <p>Your serpent grows through a series of stages. Reaching each new stage threshold allows you to <strong>Shed Skin</strong>, which resets your Essence and length within the run, but earns you <strong>Scales</strong> — a permanent prestige currency.</p>

      <h3>Growth Stages</h3>
      <table class="stat-table">
        <tr><th>Stage</th><th>Length Required</th></tr>`;

    const stages = BALANCE.prestige.growth_stages;
    for (const [len, name] of stages) {
      html += `<tr><td>${name}</td><td>${len > 0 ? len.toLocaleString() : 'Starting'}</td></tr>`;
    }

    html += `
      </table>

      <h3>Shedding Skin</h3>
      <p>Press <span class="keybind-hint">S</span> when you reach the next stage threshold. Shedding resets your Essence, length, combo, and offerings, but you keep your upgrade levels and earn Scales. The number of Scales earned is based on your length at the time of shedding.</p>

      <h3>Cosmic Ascension</h3>
      <p>Once you reach the final stage (<strong>Cosmic Scale</strong>), press <span class="keybind-hint">A</span> to Ascend. This is a full reset — everything goes back to the beginning. In return, you keep your Scales and can spend them on <strong>permanent Ascension upgrades</strong> that carry across all future runs.</p>
      <p>Each Ascension also earns <strong>Knowledge</strong> based on your run performance, which permanently unlocks access to higher-tier upgrades in future runs.</p>

      <h3>Ascension Upgrades</h3>`;

    for (const u of Object.values(ASCENSION_UPGRADES)) {
      html += `<div class="guide-item">`;
      html += `  <div class="guide-item-name cyan">${u.name}</div>`;
      html += `  <div class="guide-item-desc">${u.description} <span style="color:var(--text-dim);">(Max level: ${u.max_level})</span></div>`;
      html += `</div>`;
    }

    return html;
  },
};

// ---------------------------------------------------------------------------
// Collections Modal
// ---------------------------------------------------------------------------

let _activeColTab = 'lore';

function _buildCollectionsLore() {
  const collected = new Set(meta?.collected_lore_ids ?? []);
  const total = LORE_FRAGMENTS.length;
  const count = LORE_FRAGMENTS.filter(f => collected.has(f.id)).length;
  let html = `<p style="color:var(--text-dim);margin-bottom:12px">Fragments collected: <strong style="color:var(--cyan)">${count} / ${total}</strong></p>`;
  for (const frag of LORE_FRAGMENTS) {
    const unlocked = collected.has(frag.id);
    if (unlocked) {
      html += `
        <div class="guide-item" style="border-left:3px solid var(--cyan);padding-left:10px">
          <div class="guide-item-name cyan">${frag.title}</div>
          <div class="guide-item-desc" style="font-style:italic;color:var(--text)">${frag.text}</div>
        </div>`;
    } else {
      html += `
        <div class="guide-item" style="border-left:3px solid var(--text-dim);padding-left:10px;opacity:0.45">
          <div class="guide-item-name" style="color:var(--text-dim)">${frag.title}</div>
          <div class="guide-item-desc" style="color:var(--text-dim)">??? — find this fragment to unlock its text.</div>
        </div>`;
    }
  }
  return html;
}

function _buildCollectionsSkins() {
  const unlocked = new Set(meta?.unlocked_skins ?? ['emerald']);
  const activeSkin = meta?.active_skin ?? 'emerald';
  let html = '<p style="color:var(--text-dim);margin-bottom:12px">Click an unlocked skin to equip it.</p>';
  for (const skin of SNAKE_SKINS) {
    const isUnlocked = unlocked.has(skin.id);
    const isActive   = skin.id === activeSkin;
    const border     = isActive ? `3px solid ${skin.color}` : isUnlocked ? `1px solid ${skin.color}` : '1px solid var(--border)';
    const opacity    = isUnlocked ? '1' : '0.4';
    const cursor     = isUnlocked && !isActive ? 'pointer' : 'default';
    html += `
      <div class="guide-item col-skin-card" data-skin-id="${skin.id}"
           style="border-left:${border};padding-left:10px;opacity:${opacity};cursor:${cursor}">
        <div class="guide-item-name" style="color:${skin.color}">
          ${ isActive ? '◉ ' : isUnlocked ? '◎ ' : '○ '}${skin.name}${ isActive ? ' <span style="font-size:0.8em;color:var(--text-dim)">(equipped)</span>' : '' }
        </div>
        <div class="guide-item-desc">${isUnlocked ? skin.unlockDesc : '🔒 ' + skin.unlockDesc}</div>
      </div>`;
  }
  return html;
}

function _buildCollectionsStats() {
  const m = meta ?? {};
  const rows = [
    ['Serpent Knowledge', m.serpent_knowledge ?? 0],
    ['Total Runs',        m.total_runs ?? 0],
    ['Ascensions',        m.ascension_count ?? 0],
    ['Best Peak Length',  m.best_peak_length ?? 0],
    ['Best Essence',      formatNumber(Math.floor(m.best_total_essence ?? 0))],
    ['Golden Caught',     m.total_golden_caught ?? 0],
    ['Challenges Done',   m.total_challenges_completed ?? 0],
    ['Lore Collected',    `${(m.collected_lore_ids ?? []).length} / ${LORE_FRAGMENTS.length}`],
    ['Skins Unlocked',    `${(m.unlocked_skins ?? ['emerald']).length} / ${SNAKE_SKINS.length}`],
  ];
  let html = '<table class="stat-table" style="width:100%;margin-top:4px">';
  for (const [label, value] of rows) {
    html += `<tr><td>${label}</td><td style="text-align:right;color:var(--cyan)">${value}</td></tr>`;
  }
  html += '</table>';
  return html;
}

function _renderCollectionsTab(tab) {
  if (!dom.collectionsContent) return;
  _activeColTab = tab;
  // Update tab button states
  if (dom.collectionsModal) {
    for (const btn of dom.collectionsModal.querySelectorAll('.guide-tab')) {
      btn.classList.toggle('active', btn.dataset.colTab === tab);
    }
  }
  let html = '';
  if (tab === 'lore')  html = _buildCollectionsLore();
  if (tab === 'skins') html = _buildCollectionsSkins();
  if (tab === 'stats') html = _buildCollectionsStats();
  dom.collectionsContent.innerHTML = html;
  // Skin equip click handler
  if (tab === 'skins') {
    dom.collectionsContent.querySelectorAll('.col-skin-card[data-skin-id]').forEach(card => {
      card.addEventListener('click', () => {
        const sid = card.dataset.skinId;
        if (!meta || !meta.unlocked_skins.includes(sid)) return;
        meta.active_skin = sid;
        saveMeta(meta);
        _renderCollectionsTab('skins');  // refresh
        showToast(`Skin equipped: ${sid}`, 'success');
      });
    });
  }
}

function openCollections() {
  if (!dom.collectionsModal) return;
  _renderCollectionsTab(_activeColTab);
  dom.collectionsModal.classList.remove('hidden');
}

function closeCollections() {
  if (!dom.collectionsModal) return;
  dom.collectionsModal.classList.add('hidden');
}

function openSettings() {
  if (!dom.settingsModal) return;
  if (dom.autoSaveToggle) {
    dom.autoSaveToggle.checked = (meta?.auto_save_enabled !== false);
  }
  if (dom.showWelcomeToggle) {
    dom.showWelcomeToggle.checked = (meta?.show_welcome_modal !== false);
  }
  dom.settingsModal.classList.remove('hidden');
}

function closeSettings() {
  if (!dom.settingsModal) return;
  dom.settingsModal.classList.add('hidden');
  _resetClearSaveUI();
}

function openGuide(tab) {
  if (!dom.guideModal) return;
  const t = tab || 'basics';
  setGuideTab(t);
  dom.guideModal.classList.remove('hidden');
}

function closeGuide() {
  if (!dom.guideModal) return;
  dom.guideModal.classList.add('hidden');
}

function setGuideTab(tabId) {
  if (!dom.guideContent || !dom.guideModal) return;
  const gen = GUIDE_TABS[tabId];
  if (!gen) return;
  dom.guideContent.innerHTML = gen();
  // Update active tab button
  dom.guideModal.querySelectorAll('.guide-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
}

// ---------------------------------------------------------------------------
// Welcome Modal
// ---------------------------------------------------------------------------

const _welcomeModal     = $('#welcome-modal');
const _welcomeCloseBtn  = $('#btn-welcome-close');
const _welcomeHideToggle = $('#welcome-hide-toggle');

function openWelcome() {
  if (_welcomeHideToggle) {
    _welcomeHideToggle.checked = (meta?.show_welcome_modal === false);
  }
  if (_welcomeModal) _welcomeModal.classList.remove('hidden');
}

function closeWelcome() {
  if (_welcomeModal) _welcomeModal.classList.add('hidden');
}

if (_welcomeCloseBtn) _welcomeCloseBtn.addEventListener('click', closeWelcome);
if (_welcomeHideToggle) {
  _welcomeHideToggle.addEventListener('change', () => {
    if (!meta) return;
    meta.show_welcome_modal = !_welcomeHideToggle.checked;
    saveMeta(meta);
    if (dom.showWelcomeToggle) dom.showWelcomeToggle.checked = (meta.show_welcome_modal !== false);
  });
}
if (_welcomeModal) {
  _welcomeModal.addEventListener('click', (e) => {
    if (e.target === _welcomeModal) closeWelcome();
  });
}

if (dom.guideBtn) dom.guideBtn.addEventListener('click', () => openGuide());
if (dom.guideCloseBtn) dom.guideCloseBtn.addEventListener('click', closeGuide);
if (dom.guideModal) {
  dom.guideModal.addEventListener('click', (e) => {
    if (e.target === dom.guideModal) closeGuide();
  });
  dom.guideModal.querySelectorAll('.guide-tab').forEach(btn => {
    btn.addEventListener('click', () => setGuideTab(btn.dataset.tab));
  });
}

// ---------------------------------------------------------------------------
// Game Tick (30 Hz)
// ---------------------------------------------------------------------------

let _lastTickTime  = 0;
let _lastDebuffId  = '';

function gameTick() {
  if (!state) return;
  const t  = now();
  const dt = Math.min(t - _lastTickTime, 0.5);  // cap at 500ms
  _lastTickTime = t;

  // Re-anchor beat_origin first so all tick functions use updated phase.
  _maybeReanchorBeat();

  const comboBeforeDecay = state.combo_multiplier;

  tickMouth(state);
  tickVenomRush(state);
  tickComboDecay(state);
  maybeShowIdleMissFeedback(state, comboBeforeDecay);
  tickDebuff(state);
  const archetypeNotif = tickArchetypeResonance(state, dt);
  tickPostFrenzyBpm(state);
  tickRollingBpmDecay(state);

  const autoResult = tickAutoBite(state);
  if (autoResult) {
    handlePress(state);
    showBiteFeedback(autoResult);
    lastBiteResult = autoResult;
  }

  // Idle seconds accumulate while not pressing
  if (t - state.last_press_time > 1.0) state.idle_seconds += dt;
  tickIdle(state, dt);

  // Events
  const notifs = events.tick(state);
  processNotifications(notifs);

  // Toast when a new debuff is applied this tick
  if (state.debuff_id !== _lastDebuffId) {
    if (state.debuff_id) {
      const db = ALL_DEBUFFS[state.debuff_id];
      if (db) showToast(`⚡ ${db.name}: ${db.description}`, 'error');
    }
    _lastDebuffId = state.debuff_id;
  }

  // Archetype resonance notifications
  if (archetypeNotif) processNotifications([archetypeNotif]);

  computeDerived(state);

  if (state.current_offerings.length === 0) {
    refreshOfferings(state, getUnlockedUpgradeSet(meta));
  }
}

// ---------------------------------------------------------------------------
// Render Loop (60 fps)
// ---------------------------------------------------------------------------

function renderLoop() {
  if (state) {
    renderRhythm();
    // Drive shed animation at full frame rate
    if (_shedAnim) renderSnake();
  }
  requestAnimationFrame(renderLoop);
}

// Full render after each engine tick
function gameTickAndRender() {
  gameTick();
  renderAll();
}

// ---------------------------------------------------------------------------
// Auto-save every 30 s
// ---------------------------------------------------------------------------

setInterval(() => {
  if (state && meta?.auto_save_enabled !== false) {
    if (_saveEpoch !== getSaveEpoch()) return;
    saveRun(state, events);
    saveMeta(meta);
  }
}, 30_000);

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

(function init() {
  _saveEpoch = getSaveEpoch();
  meta = loadMeta();

  const savedState = loadRun();
  if (savedState) {
    state  = savedState;
    events = loadEvents() || new EventManager();
    computeDerived(state);
    // Make sure offerings are populated
    if (!state.current_offerings || state.current_offerings.length === 0) {
      refreshOfferings(state, getUnlockedUpgradeSet(meta));
    }
  } else {
    state  = createNewRunState(meta);
    events = new EventManager();
    refreshOfferings(state, getUnlockedUpgradeSet(meta));
  }

  _lastTickTime = now();

  // Seed BPM tracker so the first tick never triggers a false re-anchor.
  _lastKnownBpm = getCurrentBpm(state);

  // Engine tick at 30 Hz
  setInterval(gameTickAndRender, Math.round(1000 / BALANCE.tick_rate_hz));

  // Smooth 60 fps render for beat bar
  requestAnimationFrame(renderLoop);

  renderAll();

  // Show welcome modal whenever player is on first ascension and still early-stage
  if (meta.show_welcome_modal !== false
      && meta.ascension_count === 0
      && state.current_stage_index <= 1) {
    openWelcome();
}

  console.log('🐍 Ouro — serverless client-side engine running!');
})();
