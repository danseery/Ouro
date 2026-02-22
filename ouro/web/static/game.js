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

let lastBiteResult    = null;
let feedbackTimer     = null;
let feedbackFadeTimer = null;
const FEEDBACK_DURATION = 500;  // ms

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
let _tapBpmLocked = '— tap';
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
  archetype:      $('#hud-archetype'),
  curse:          $('#hud-curse'),
  snakeArt:       $('#snake-art'),
  snakeLength:    $('#snake-length-label'),
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
  rhythmHits:     $('#rhythm-hits'),
  biteBtn:        $('#bite-button'),
  shedBtn:        $('#btn-shed'),
  ascendBtn:      $('#btn-ascend'),
  saveBtn:        $('#btn-save'),
  settingsBtn:        $('#btn-settings'),
  settingsModal:      $('#settings-modal'),
  settingsCloseBtn:   $('#btn-settings-close'),
  clearSaveBtn:       $('#btn-clear-save'),
  clearSaveConfirm:   $('#clear-save-confirm'),
  clearConfirmYes:    $('#btn-clear-confirm-yes'),
  clearConfirmNo:     $('#btn-clear-confirm-no'),
  upgradeList:    $('#upgrade-list'),
  kbBuyRange:     $('#kb-buy-range'),
  eventOverlay:   $('#event-overlay'),
  eventText:      $('#event-text'),
  eventTimer:     $('#event-timer'),
  eventActionBtn: $('#event-action-btn'),
  prestigeContent:    $('#prestige-content'),
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
      showToast(`🐍 Frenzy over! ${parts[1]} bites → +${parts[2]} Essence!`, 'warning');
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
    } else if (n.startsWith('archetype_awakened:')) {
      const id   = n.split(':')[1];
      const arch = ALL_ARCHETYPES[id];
      if (arch) showToast(`⚔ ${arch.name} awakens! Press T to transform.`, 'warning');
    } else if (n.startsWith('archetype_offer_expired:')) {
      showToast('The awakening fades...', 'info');
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
  renderUpgrades();
  renderEvents();
  renderPrestige();
  renderAscensionBadge();
}

function renderHUD() {
  const s = state;
  dom.essence.textContent  = formatNumber(s.essence);
  dom.perPress.textContent = formatNumber(s.essence_per_press);
  dom.idle.textContent     = formatNumber(s.idle_income_per_s) + '/s';
  dom.length.textContent   = s.snake_length;
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

  // Goal bar
  const goal = _goalInfo(s);
  dom.goalText.textContent = goal.text;
  dom.goalBar.style.width  = `${(goal.pct * 100).toFixed(1)}%`;
  dom.goalPct.textContent  = `${(goal.pct * 100).toFixed(0)}%`;

  // Archetype & active debuff (with countdown)
  const arch = ALL_ARCHETYPES[s.archetype_id];
  if (arch) {
    dom.archetype.textContent = `⚔ ${arch.name}: ${arch.tagline}`;
  } else {
    // Show resonance progress toward each archetype
    const p1 = `${s.resonance_perfects}/8 perfects`;
    const p2 = `${Math.floor(Math.min(100, (s.combo_peak_seconds / 15) * 100))}% peak combo`;
    const p3 = `${Math.floor(Math.min(100, (s.idle_seconds / 45) * 100))}% patience`;
    dom.archetype.textContent = `⚔ Awakening: ${p1} · ${p2} · ${p3}`;
  }
  const debuff = ALL_DEBUFFS[s.debuff_id];
  if (debuff && s.debuff_end_time > now()) {
    const rem = Math.max(0, s.debuff_end_time - now()).toFixed(1);
    dom.curse.textContent = `⚡ ${debuff.name}: ${debuff.description} (${rem}s)`;
    dom.curse.className = 'curse-info debuff-active';
  } else {
    dom.curse.textContent = '';
    dom.curse.className = 'curse-info';
  }
}

function renderSnake() {
  const s      = state;
  const canvas = dom.snakeArt;
  if (!canvas) return;
  if (typeof canvas.getContext !== 'function') return;

  // Force bitmap size — attributes may parse as strings in some browsers
  canvas.width  = 200;
  canvas.height = 200;
  const W = 200, H = 200;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  const cx = W / 2;
  const cy = H / 2;

  // ── Stage / frenzy color ──────────────────────────────────────────────────
  const isFrenzy = s.frenzy_active;
  const stageIdx = s.current_stage_index || 0;
  let R, G, B;
  if      (isFrenzy)      [R,G,B] = [255, 160,   0];
  else if (stageIdx >= 8) [R,G,B] = [200, 120, 255];
  else if (stageIdx >= 6) [R,G,B] = [100, 160, 255];
  else if (stageIdx >= 4) [R,G,B] = [  0, 220, 255];
  else                    [R,G,B] = [  0, 255, 136];
  const col  = `rgb(${R},${G},${B})`;
  const colA = (a) => `rgba(${R},${G},${B},${a})`;

  // ── Geometry ──────────────────────────────────────────────────────────────
  const maxR   = Math.min(W, H) * 0.38;   // outermost ring radius
  const innerR = maxR * 0.28;             // innermost coil radius
  // Coils: 1 ring early-game → up to 4 at cosmic
  const totalCoils = 1 + Math.min(3, stageIdx * 0.4);
  const ringGap    = totalCoils > 1 ? (maxR - innerR) / (totalCoils - 1) : 0;

  // Snake girth: thick at all stages, grows with log of length
  const MAX_LEN  = 900_000;
  const logFrac  = Math.log1p(s.snake_length) / Math.log1p(MAX_LEN); // 0→1
  const lineW    = maxR * (0.10 + 0.16 * logFrac);  // 10%→26% of ring radius

  // Body arc: portion of the spiral covered by the snake.
  // tailFrac=1 means no body; shrinks toward 0 over the game.
  const tailFrac  = Math.max(0, 1 - logFrac * 1.05);
  const MOUTH_GAP = 0.03;  // gap between tail tip and head (the bite point)

  // Map t∈[0,1] to (x,y) on the Archimedean spiral
  function spiralPt(t) {
    const angle = -Math.PI / 2 + t * totalCoils * Math.PI * 2;
    const r     = maxR - t * (totalCoils - 1) * ringGap;
    return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r];
  }

  // ── Ghost ring (always-visible faint track) ───────────────────────────────
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.strokeStyle = col;
  ctx.lineWidth   = lineW * 0.55;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
  ctx.beginPath();
  const GSTEPS = 120;
  for (let i = 0; i <= GSTEPS; i++) {
    const [x, y] = spiralPt(i / GSTEPS);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();

  // ── Body stroke ───────────────────────────────────────────────────────────
  const bodyEnd   = 1 - MOUTH_GAP;
  const BSTEPS    = 80;
  if (tailFrac < bodyEnd) {
    // Build gradient along the body path for tail→head fade-in
    const [tx0, ty0] = spiralPt(tailFrac);
    const [tx1, ty1] = spiralPt(bodyEnd);
    const grad = ctx.createLinearGradient(tx0, ty0, tx1, ty1);
    grad.addColorStop(0, colA(0.15));
    grad.addColorStop(1, colA(1.0));

    ctx.save();
    ctx.strokeStyle = grad;
    ctx.lineWidth   = lineW;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.shadowColor = col;
    ctx.shadowBlur  = lineW * 1.2;
    ctx.beginPath();
    for (let i = 0; i <= BSTEPS; i++) {
      const t      = tailFrac + (i / BSTEPS) * (bodyEnd - tailFrac);
      const [x, y] = spiralPt(t);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ── Head ─────────────────────────────────────────────────────────────────
  const headR  = lineW * 0.78;  // slightly wider than body
  const [hx, hy] = spiralPt(1);

  ctx.shadowColor = col;
  ctx.shadowBlur  = headR * 2.5;
  ctx.fillStyle   = col;
  ctx.beginPath();
  ctx.arc(hx, hy, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // Eye
  const eyeR  = headR * 0.38;
  const [ex, ey] = [hx + headR * 0.28, hy - headR * 0.20];
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.beginPath(); ctx.arc(ex, ey, eyeR, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(ex, ey, eyeR * 0.42, 0, Math.PI * 2); ctx.fill();

  // ── Label ─────────────────────────────────────────────────────────────────
  dom.snakeLength.textContent = `Length: ${s.snake_length}`;

  if (isFrenzy) {
    dom.snakeArt.classList.add('frenzy-mode');
    dom.snakeArt.classList.remove('pulse');
  } else {
    dom.snakeArt.classList.remove('frenzy-mode');
  }
  dom.biteBtn.classList.toggle('frenzy-mode', !!isFrenzy);
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

  dom.rhythmBpm.textContent   = `${bpm.toFixed(0)} BPM`;
  dom.rhythmCombo.textContent = `${s.combo_multiplier.toFixed(1)}x`;
  dom.rhythmHits.textContent  = `${s.combo_hits} hits`;
  if (dom.rhythmTapBpm) {
    // Latch tap BPM once per beat (when the cursor finishes a pass) so the
    // value is stable and readable rather than flickering every frame.
    const currentBeatIndex = Math.floor((_beatCache.t - s.beat_origin) / beatInterval);
    if (currentBeatIndex !== _lastBeatIndexForTap) {
      _lastBeatIndexForTap = currentBeatIndex;
      _tapBpmLocked = s.rolling_bpm > 0 ? `${Math.round(s.rolling_bpm)} tap` : '— tap';
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
    dom.eventActionBtn.textContent = '[G] Catch!';
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
    dom.eventActionBtn.textContent = '[B] Accept';
    dom.eventActionBtn.className   = '';
    dom.eventActionBtn.onclick     = acceptBargain;
  } else if (ev && ev.echo_active) {
    const uid  = ev.echo_upgrade_id;
    const name = ALL_UPGRADES[uid] ? ALL_UPGRADES[uid].name : uid;
    dom.eventOverlay.className     = 'echo';
    dom.eventText.textContent      = `✦ Ancient Echo — Free upgrade: ${name}`;
    dom.eventTimer.textContent     = '';
    dom.eventActionBtn.textContent = '[E] Claim';
    dom.eventActionBtn.className   = '';
    dom.eventActionBtn.onclick     = acceptEcho;
  } else if (s.archetype_offer_id) {
    const offeredArch = ALL_ARCHETYPES[s.archetype_offer_id];
    const remaining   = Math.max(0, s.archetype_offer_expires - t);
    dom.eventOverlay.className     = 'archetype';
    dom.eventText.textContent      = `⚔ ${offeredArch.name} awakens — ${offeredArch.tagline}`;
    dom.eventTimer.textContent     = `${remaining.toFixed(1)}s`;
    dom.eventActionBtn.textContent = '[T] Transform';
    dom.eventActionBtn.className   = '';
    dom.eventActionBtn.onclick     = acceptArchetypeOffer;
  } else {
    dom.eventOverlay.className = 'hidden';
    dom.eventActionBtn.classList.add('hidden');
  }
}

function renderPrestige() {
  const info = _shedInfo(state);
  let html = '';
  if (info.status === 'ascend') {
    html = '<span style="color:var(--purple)">✦ Ready to Ascend! Open the upgrade tree.</span>';
    dom.shedBtn.disabled   = true;
    dom.ascendBtn.disabled = false;
  } else if (info.status === 'ready') {
    html = `<span style="color:var(--yellow)">Shed → ${info.next_stage} (+${info.reward} Scales)</span>`;
    dom.shedBtn.disabled   = false;
    dom.ascendBtn.disabled = true;
  } else {
    const pct = info.threshold > 0
      ? Math.min(100, info.current / info.threshold * 100) : 0;
    html = `Next: ${info.next_stage} (${formatNumber(info.current)}/${formatNumber(info.threshold)} — ${pct.toFixed(0)}%)`;
    dom.shedBtn.disabled   = true;
    dom.ascendBtn.disabled = true;
  }
  dom.prestigeContent.innerHTML = html;
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
    perfect: '✦ PERFECT BITE ✦',
    good:    'GOOD BITE',
    miss:    'CHOMP — MISS!',
    saved:   '★ COMBO SAVED! ★',
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

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function doFeed() {
  if (!state) return;

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
  if (!state || !canShed(state)) {
    showToast('Not ready to shed — grow more!', 'error');
    return;
  }
  const scalesEarned = performShed(state);
  const stageName    = _growthStage(state);
  showToast(`🐍 Shed Skin → ${stageName}! +${Math.floor(scalesEarned)} Scales`, 'warning');
  refreshOfferings(state, getUnlockedUpgradeSet(meta));
  computeDerived(state);
  renderAll();
}

function catchGolden() {
  if (!state || !events) return;
  events.catchGolden(state);
  showToast('🐍 FEEDING FRENZY! MASH SPACE!', 'warning');
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

function acceptArchetypeOffer() {
  if (!state || !state.archetype_offer_id) return;
  const arch = ALL_ARCHETYPES[state.archetype_offer_id];
  const ok   = acceptArchetype(state);
  if (ok && arch) {
    computeDerived(state);
    refreshOfferings(state, getUnlockedUpgradeSet(meta));
    showToast(`⚔ You are ${arch.name}! ${arch.description}`, 'success');
    renderAll();
    saveRun(state, events);
  }
}

function doSave() {
  if (!state) return;
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
  deleteRun();
  deleteMeta();
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

  performAscension(state);
  applyAscensionStartingBonuses(meta, state);

  // Archetypes are now earned through playstyle, not assigned at random.
  // Clear everything — player will awaken a new archetype by playing naturally.
  state.archetype_id          = '';
  state.archetype_offer_id    = '';
  state.archetype_offer_expires = 0.0;
  state.debuff_id             = '';
  state.debuff_end_time       = 0.0;
  state.resonance_perfects    = 0;
  state.combo_peak_seconds    = 0.0;
  state.snake_length = getStartingLength(meta);
  computeDerived(state);
  refreshOfferings(state, getUnlockedUpgradeSet(meta));

  events = new EventManager();

  showToast(`✦ ASCENSION ${meta.ascension_count}! The eternal cycle begins anew.`, 'warning');
  closeAscensionModal();
  saveMeta(meta);
  saveRun(state, events);
  renderAll();
}

// ---------------------------------------------------------------------------
// Input Handling
// ---------------------------------------------------------------------------

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  if (!dom.ascensionModal.classList.contains('hidden')) {
    if (e.key === 'Escape') closeAscensionModal();
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
    case 'KeyT': acceptArchetypeOffer();   break;
  }
});

dom.biteBtn.addEventListener('click', (e) => { e.preventDefault(); doFeed(); });
dom.shedBtn.addEventListener('click', doShed);
dom.ascendBtn.addEventListener('click', openAscensionModal);
dom.saveBtn.addEventListener('click', doSave);
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
      <p>Land <strong>5 perfect bites in a row</strong> (3 with the Rhythm Incarnate archetype) to trigger Venom Rush — a short burst that grants bonus Essence on every beat.</p>

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
        <tr><td><span class="keybind-hint">T</span></td><td>Transform (accept archetype offer)</td></tr>
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
      <p>Archetypes are <strong>playstyle identities</strong> that you earn through your actions during a run. Each one modifies your stats in a unique way and grants free starting upgrades. You begin every run with no archetype — your playstyle unlocks them naturally.</p>
      <p>When an archetype awakens, a purple banner appears. Press <span class="keybind-hint">T</span> within 25 seconds to accept the transformation. You can only hold one archetype at a time; accepting a new one replaces the old.</p>

      <div class="guide-item">
        <div class="guide-item-name">Rhythm Incarnate</div>
        <div class="guide-item-desc">
          <strong>"You are the beat."</strong><br>
          <em>Earned by landing 8 consecutive perfect bites.</em><br>
          The perfect timing zone is 40% wider, and Venom Rush only needs 3 perfects instead of 5. No starting upgrades — pure mastery rewards.
        </div>
      </div>

      <div class="guide-item">
        <div class="guide-item-name">Coiled Striker</div>
        <div class="guide-item-desc">
          <strong>"Strike fast. Strike hard."</strong><br>
          <em>Earned by sustaining a 5x combo (60+ hits) for 15 unbroken seconds.</em><br>
          Essence per press is boosted by 25%, and every combo tier grants an extra +1.0x bonus multiplier. The tradeoff: your timing window is 20% tighter and idle income is halved. A high-risk, high-reward identity for aggressive players.
        </div>
      </div>

      <div class="guide-item">
        <div class="guide-item-name">Patient Ouroboros</div>
        <div class="guide-item-desc">
          <strong>"The coil tightens while you rest."</strong><br>
          <em>Earned by accumulating 45 seconds of idle time.</em><br>
          Idle income is multiplied by 2.5x and you become completely immune to all debuffs. The tradeoff: active Essence per press is reduced by 20% and combo builds at half speed.
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

function openSettings() {
  if (!dom.settingsModal) return;
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

  tickMouth(state);
  tickVenomRush(state);
  tickComboDecay(state);
  tickDebuff(state);
  const archetypeNotif = tickArchetypeResonance(state, dt);
  tickPostFrenzyBpm(state);

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
  if (state) renderRhythm();
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
  if (state) {
    saveRun(state, events);
    saveMeta(meta);
  }
}, 30_000);

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

(function init() {
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
  console.log('🐍 Ouro — serverless client-side engine running!');
})();
