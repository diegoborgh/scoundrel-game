/*
 * Scoundrel — game.js
 * Complete game logic, rendering, audio, and event handling.
 *
 * Sections:
 *  1. Constants & Asset Mapping
 *  2. Game State
 *  3. Deck Construction & Shuffle
 *  4. Game Logic (room draw, card resolution, win/loss)
 *  5. Rendering (DOM updates, cards, status bar, animations)
 *  6. Audio (Web Audio API sfx + mute toggle)
 *  7. Event Handling (clicks, keyboard, touch)
 *  8. Initialization
 */

// ============================================================
// 1. CONSTANTS & ASSET MAPPING
// ============================================================

const SUITS = { CLUBS: 'clubs', SPADES: 'spades', DIAMONDS: 'diamonds', HEARTS: 'hearts' };
const SUIT_SYMBOLS = { clubs: '\u2663', spades: '\u2660', diamonds: '\u2666', hearts: '\u2665' };
const FACE_LABELS = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const MAX_HP = 20;
const CARDS_PER_ROOM = 4;
const CARDS_TO_RESOLVE = 3;

/** Return the asset image path for a card based on suit and value. */
function getCardAsset(suit, value) {
  switch (suit) {
    case SUITS.HEARTS:
      return 'assets/heart.webp';
    case SUITS.CLUBS:
      if (value <= 5) return 'assets/club-1.webp';
      if (value <= 10) return 'assets/club-2.webp';
      return 'assets/club-3.webp';
    case SUITS.SPADES:
      if (value <= 5) return 'assets/spade-1.webp';
      if (value <= 10) return 'assets/spade-2.webp';
      return 'assets/spade-3.webp';
    case SUITS.DIAMONDS:
      if (value <= 4) return 'assets/diamond-1.webp';
      if (value <= 7) return 'assets/diamond-2.webp';
      return 'assets/diamond-3.webp';
    default:
      return '';
  }
}

function cardDisplayValue(value) {
  return FACE_LABELS[value] || String(value);
}

function cardType(suit) {
  if (suit === SUITS.CLUBS || suit === SUITS.SPADES) return 'monster';
  if (suit === SUITS.DIAMONDS) return 'weapon';
  if (suit === SUITS.HEARTS) return 'potion';
  return 'unknown';
}

// ============================================================
// 2. GAME STATE
// ============================================================

const state = {
  dungeon: [],          // Array of { suit, value }
  room: [],             // Current room cards (up to 4)
  hp: MAX_HP,
  weapon: null,         // { value, lastDefeated: number|null }
  potionUsedThisRoom: false,
  resolvedThisRoom: 0,  // How many cards resolved in current room
  lastAvoided: false,   // Did player avoid the previous room?
  phase: 'idle',        // idle | room | resolving | gameover
  discardPile: [],      // Recently discarded (for display, keep last ~10)
  selectedIndex: null,   // Index of currently selected card in room
};

// ============================================================
// 3. DECK CONSTRUCTION & SHUFFLE
// ============================================================

function buildDungeon() {
  const deck = [];
  // Clubs 2-14 (all 13)
  for (let v = 2; v <= 14; v++) deck.push({ suit: SUITS.CLUBS, value: v });
  // Spades 2-14 (all 13)
  for (let v = 2; v <= 14; v++) deck.push({ suit: SUITS.SPADES, value: v });
  // Diamonds 2-10 (9 cards)
  for (let v = 2; v <= 10; v++) deck.push({ suit: SUITS.DIAMONDS, value: v });
  // Hearts 2-10 (9 cards)
  for (let v = 2; v <= 10; v++) deck.push({ suit: SUITS.HEARTS, value: v });
  // Total = 44
  return deck;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ============================================================
// 4. GAME LOGIC
// ============================================================

function resetGame() {
  state.dungeon = shuffle(buildDungeon());
  state.room = [];
  state.hp = MAX_HP;
  state.weapon = null;
  state.potionUsedThisRoom = false;
  state.resolvedThisRoom = 0;
  state.lastAvoided = false;
  state.phase = 'idle';
  state.discardPile = [];
  state.selectedIndex = null;
}

function drawRoom() {
  state.potionUsedThisRoom = false;
  state.resolvedThisRoom = 0;
  state.selectedIndex = null;

  // Draw cards from dungeon to fill room to 4
  while (state.room.length < CARDS_PER_ROOM && state.dungeon.length > 0) {
    state.room.push(state.dungeon.shift());
  }

  state.phase = 'room';
}

function canAvoid() {
  return !state.lastAvoided && state.room.length === CARDS_PER_ROOM && state.resolvedThisRoom === 0;
}

function avoidRoom() {
  if (!canAvoid()) return;
  // Place all 4 cards on bottom of dungeon
  for (const card of state.room) {
    state.dungeon.push(card);
  }
  state.room = [];
  state.lastAvoided = true;
  state.phase = 'idle';
  Audio.play('avoid');
  // Draw next room
  drawRoom();
  renderAll();
}

/** Preview what happens if a card is resolved. Returns { type, detail } */
function previewCard(card) {
  const type = cardType(card.suit);
  if (type === 'monster') {
    if (state.weapon && canUseWeaponOn(card)) {
      const dmg = Math.max(0, card.value - state.weapon.value);
      return { type: 'damage', detail: dmg === 0 ? 'No damage' : `\u2212${dmg} HP` };
    }
    return { type: 'damage', detail: `\u2212${card.value} HP` };
  }
  if (type === 'weapon') {
    return { type: 'equip', detail: `Equip \u2666${card.value}` };
  }
  if (type === 'potion') {
    if (state.potionUsedThisRoom) {
      return { type: 'waste', detail: 'No effect (potion used)' };
    }
    const heal = Math.min(card.value, MAX_HP - state.hp);
    return { type: 'heal', detail: heal > 0 ? `+${heal} HP` : 'HP full' };
  }
  return { type: 'unknown', detail: '' };
}

function canUseWeaponOn(monsterCard) {
  if (!state.weapon) return false;
  // If no monster defeated yet, weapon can be used on any
  if (state.weapon.lastDefeated === null) return true;
  // Otherwise monster value must be <= last defeated
  return monsterCard.value <= state.weapon.lastDefeated;
}

function resolveMonster(card, index) {
  let damage;
  if (state.weapon && canUseWeaponOn(card)) {
    damage = Math.max(0, card.value - state.weapon.value);
    state.weapon.lastDefeated = card.value;
    Audio.play('combat');
  } else {
    damage = card.value;
    Audio.play('combat');
  }
  state.hp -= damage;
  if (damage > 0) {
    showFloatingText(`\u2212${damage}`, 'damage');
    flashScreen('damage');
  }
}

function resolveWeapon(card, index) {
  // Equipping discards old weapon and any monsters stacked on it
  state.weapon = { value: card.value, lastDefeated: null };
  Audio.play('equip');
}

function resolvePotion(card, index) {
  if (state.potionUsedThisRoom) {
    // Discard without healing
    Audio.play('potion');
    return;
  }
  const heal = Math.min(card.value, MAX_HP - state.hp);
  state.hp += heal;
  state.potionUsedThisRoom = true;
  if (heal > 0) {
    showFloatingText(`+${heal}`, 'heal');
    flashScreen('heal');
  }
  Audio.play('potion');
}

function addToDiscard(card) {
  state.discardPile.push(card);
  if (state.discardPile.length > 12) state.discardPile.shift();
}

function calculateScore(won) {
  if (won) return state.hp;
  // Negative sum of all remaining monster values in dungeon + room
  let total = 0;
  const allRemaining = [...state.dungeon, ...state.room.filter(Boolean)];
  for (const card of allRemaining) {
    if (cardType(card.suit) === 'monster') total += card.value;
  }
  return -total;
}

// ============================================================
// 5. RENDERING
// ============================================================

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function renderAll() {
  renderStatusBar();
  renderRoom();
  renderActions();
  renderDiscard();
}

function renderStatusBar() {
  // HP
  const hpPct = Math.max(0, (state.hp / MAX_HP) * 100);
  $('#hp-fill').style.height = hpPct + '%';
  $('#hp-text').textContent = Math.max(0, state.hp);
  const vial = $('.hp-vial');
  vial.classList.toggle('low', state.hp <= 5 && state.hp > 0);

  // Weapon
  if (state.weapon) {
    $('#weapon-detail').textContent = `\u2666 ${state.weapon.value}`;
    if (state.weapon.lastDefeated !== null) {
      $('#weapon-constraint').textContent = `Can fight \u2264 ${cardDisplayValue(state.weapon.lastDefeated)}`;
    } else {
      $('#weapon-constraint').textContent = 'No constraint';
    }
  } else {
    $('#weapon-detail').textContent = 'None';
    $('#weapon-constraint').textContent = 'Barehanded';
  }

  // Deck count
  $('#deck-count').textContent = state.dungeon.length;
}

function renderRoom() {
  const container = $('#room-cards');
  const prompt = $('#room-prompt');
  container.innerHTML = '';

  if (state.phase === 'idle' || state.phase === 'gameover') {
    prompt.textContent = '';
    prompt.classList.remove('danger', 'heal');
    return;
  }

  // Room prompt
  const unresolvedCount = state.room.filter(c => c !== null).length;
  const remaining = CARDS_TO_RESOLVE - state.resolvedThisRoom;

  if (state.room.length < CARDS_PER_ROOM && state.dungeon.length === 0) {
    // Final room with fewer cards
    const mustResolve = Math.max(0, unresolvedCount - 1);
    if (mustResolve > 0) {
      prompt.textContent = `Final room \u2014 resolve ${mustResolve} card${mustResolve > 1 ? 's' : ''}`;
    } else if (unresolvedCount === 1) {
      prompt.textContent = 'Resolve the last card';
    } else {
      prompt.textContent = 'Final room';
    }
    prompt.classList.add('danger');
    prompt.classList.remove('heal');
  } else if (remaining > 0) {
    prompt.textContent = `Choose ${remaining} card${remaining > 1 ? 's' : ''} to resolve`;
    prompt.classList.remove('danger', 'heal');
  } else {
    prompt.textContent = '';
  }

  // Render each card
  state.room.forEach((card, i) => {
    if (card === null) return; // resolved

    const el = createCardElement(card, i);
    container.appendChild(el);
  });
}

function createCardElement(card, index) {
  const type = cardType(card.suit);
  const el = document.createElement('div');
  el.className = `card card--${type} card-enter`;
  el.setAttribute('role', 'listitem');
  el.setAttribute('tabindex', '0');
  el.dataset.index = index;

  const label = `${cardDisplayValue(card.value)} of ${card.suit} (${type})`;
  el.setAttribute('aria-label', label);

  if (state.selectedIndex === index) el.classList.add('selected');

  // Inner container
  const inner = document.createElement('div');
  inner.className = 'card-inner';

  // Image
  const img = document.createElement('img');
  img.className = 'card-art';
  img.src = getCardAsset(card.suit, card.value);
  img.alt = '';
  img.loading = 'eager';
  img.onerror = () => {
    // Fallback: show text-based card
    img.remove();
    const fallback = document.createElement('div');
    fallback.className = 'card-fallback';
    fallback.innerHTML = `
      <span class="fallback-value">${cardDisplayValue(card.value)}</span>
      <span class="fallback-suit">${SUIT_SYMBOLS[card.suit]}</span>
    `;
    inner.prepend(fallback);
  };
  inner.appendChild(img);

  // Overlay with value/suit
  const overlay = document.createElement('div');
  overlay.className = 'card-overlay';
  overlay.innerHTML = `
    <div class="card-value-top">
      <span>${cardDisplayValue(card.value)}</span>
      <span class="card-suit-symbol">${SUIT_SYMBOLS[card.suit]}</span>
    </div>
    <div class="card-value-bottom">
      <span>${cardDisplayValue(card.value)}</span>
      <span class="card-suit-symbol">${SUIT_SYMBOLS[card.suit]}</span>
    </div>
  `;
  inner.appendChild(overlay);

  // Preview tooltip (desktop hover)
  const preview = previewCard(card);
  const tip = document.createElement('div');
  const previewClass = preview.type === 'damage' ? 'preview-damage'
    : preview.type === 'heal' ? 'preview-heal'
    : preview.type === 'equip' ? 'preview-equip'
    : 'preview-waste';
  tip.className = `card-preview ${previewClass}`;
  tip.textContent = preview.detail;
  el.appendChild(tip);

  el.appendChild(inner);

  return el;
}

function renderActions() {
  const avoidBtn = $('#avoid-btn');
  if (state.phase === 'room') {
    avoidBtn.disabled = !canAvoid();
    avoidBtn.classList.remove('hidden');
  } else {
    avoidBtn.disabled = true;
    avoidBtn.classList.add('hidden');
  }
}

function renderDiscard() {
  const container = $('#discard-pile');
  container.innerHTML = '';
  const recent = state.discardPile.slice(-10);
  for (const card of recent) {
    const el = document.createElement('div');
    el.className = 'discard-mini';
    el.innerHTML = `<span>${cardDisplayValue(card.value)}</span><span>${SUIT_SYMBOLS[card.suit]}</span>`;
    container.appendChild(el);
  }
}

function showFloatingText(text, type) {
  const el = document.createElement('div');
  el.className = `float-text ${type}`;
  el.textContent = text;
  // Position near center of room area
  const room = $('#room-area');
  const rect = room.getBoundingClientRect();
  el.style.left = (rect.left + rect.width / 2 - 20) + 'px';
  el.style.top = (rect.top + rect.height / 2) + 'px';
  document.body.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

function flashScreen(type) {
  const el = $('#game-screen');
  const cls = type === 'damage' ? 'damage-flash' : 'heal-flash';
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 500);
}

function victoryFlavor(hp) {
  if (hp >= 20) return 'Untouched legend — the dungeon never laid a finger on you.';
  if (hp >= 15) return 'A masterful descent. Bards will sing of this one.';
  if (hp >= 10) return 'You conquered the dungeon!';
  if (hp >= 5)  return 'Bloodied but unbroken. You escaped with scars.';
  return 'By a single breath — you survived.';
}

function defeatFlavor(dungeonLeft) {
  if (dungeonLeft >= 30) return 'The dungeon barely stirred before it claimed you.';
  if (dungeonLeft >= 15) return 'So close to the depths, yet the shadows took you.';
  return 'The dungeon claims another soul...';
}

function animateScoreCountUp(el, target, duration = 900) {
  const start = performance.now();
  const from = 0;
  const delta = target - from;
  function tick(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(from + delta * eased);
    if (t < 1) requestAnimationFrame(tick);
    else el.textContent = target;
  }
  requestAnimationFrame(tick);
}

function launchConfetti() {
  const canvas = $('#confetti-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  const W = canvas.width;
  const H = canvas.height;

  const palettes = [
    ['#ffd76a', '#ffb347', '#ff8c1a'],      // gold
    ['#ff4d6d', '#ff8fa3', '#ffc2d1'],      // rose
    ['#7ae7ff', '#4dc3ff', '#2e8bff'],      // azure
    ['#b6ff7a', '#6cf26c', '#2fbf2f'],      // emerald
    ['#d89bff', '#b57aff', '#8a4dff'],      // violet
    ['#ffffff', '#fff6c8', '#ffe27a'],      // white-gold
  ];

  const rockets = [];
  const particles = [];

  function spawnRocket() {
    const palette = palettes[(Math.random() * palettes.length) | 0];
    const x = W * (0.15 + Math.random() * 0.7);
    const targetY = H * (0.15 + Math.random() * 0.3);
    rockets.push({
      x,
      y: H + 10 * dpr,
      vx: (Math.random() - 0.5) * 0.6 * dpr,
      vy: -(9 + Math.random() * 3) * dpr,
      targetY,
      palette,
      trail: [],
    });
  }

  function explode(rocket) {
    const count = 60 + ((Math.random() * 30) | 0);
    const speed = (3 + Math.random() * 2) * dpr;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.15;
      const spd = speed * (0.6 + Math.random() * 0.8);
      particles.push({
        x: rocket.x,
        y: rocket.y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        color: rocket.palette[(Math.random() * rocket.palette.length) | 0],
        life: 1,
        decay: 0.012 + Math.random() * 0.012,
        size: (1.5 + Math.random() * 1.5) * dpr,
      });
    }
  }

  const start = performance.now();
  const duration = 5000;
  let lastSpawn = 0;
  let running = true;

  function frame(now) {
    if (!running) return;
    const elapsed = now - start;

    // Fade previous frame for trail effect
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';

    // Spawn rockets periodically
    if (elapsed < duration - 1200 && now - lastSpawn > 280) {
      spawnRocket();
      if (Math.random() < 0.4) spawnRocket();
      lastSpawn = now;
    }

    // Update + draw rockets
    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i];
      r.vy += 0.08 * dpr;
      r.x += r.vx;
      r.y += r.vy;
      r.trail.push({ x: r.x, y: r.y });
      if (r.trail.length > 8) r.trail.shift();

      // Draw trail
      for (let j = 0; j < r.trail.length; j++) {
        const p = r.trail[j];
        const alpha = j / r.trail.length;
        ctx.fillStyle = r.palette[0];
        ctx.globalAlpha = alpha * 0.8;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2 * dpr * alpha, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      if (r.y <= r.targetY || r.vy >= 0) {
        explode(r);
        rockets.splice(i, 1);
      }
    }

    // Update + draw particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.vy += 0.04 * dpr;
      p.vx *= 0.99;
      p.vy *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.life -= p.decay;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (elapsed < duration || particles.length > 0 || rockets.length > 0) {
      requestAnimationFrame(frame);
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, W, H);
      running = false;
    }
  }
  requestAnimationFrame(frame);
}

function showGameOver(won) {
  const overlay = $('#gameover-overlay');
  const title = $('#gameover-title');
  const message = $('#gameover-message');
  const score = $('#gameover-score');

  title.textContent = won ? 'Victory' : 'Defeat';
  // Reassign className to restart the victory-pop animation on repeat views.
  title.className = 'gameover-title ' + (won ? 'victory' : 'defeat');

  const s = calculateScore(won);
  score.textContent = '0';

  message.textContent = won ? victoryFlavor(state.hp) : defeatFlavor(state.dungeon.length);

  // Show overlay BEFORE playing audio — don't let an audio error hide the UI.
  overlay.classList.add('active');
  overlay.style.display = 'flex';
  overlay.setAttribute('aria-hidden', 'false');

  if (won) {
    launchConfetti();
    setTimeout(() => animateScoreCountUp(score, s), 400);
  } else {
    score.textContent = s;
  }

  try {
    Audio.init();
    Audio.stopAmbient();
    Audio.play(won ? 'victory' : 'defeat');
    if (won) Audio.startVictoryMusic();
    else Audio.startDefeatMusic();
  } catch (err) {
    console.warn('Audio failed in gameover:', err);
  }
}

window.devWin = () => showGameOver(true);
window.devLose = () => showGameOver(false);

// ============================================================
// 6. AUDIO (Web Audio API procedural SFX)
// ============================================================

const Audio = (() => {
  let ctx = null;
  let muted = false;
  let ambientNode = null;
  let ambientGain = null;
  let initialized = false;

  function init() {
    if (initialized) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    initialized = true;
  }

  function ensureCtx() {
    if (!ctx) init();
    if (ctx.state === 'suspended') ctx.resume();
  }

  /** Play a simple tone/noise for a given sfx type */
  function play(type) {
    if (muted || !initialized) return;
    ensureCtx();
    switch (type) {
      case 'draw': sfxDraw(); break;
      case 'combat': sfxCombat(); break;
      case 'equip': sfxEquip(); break;
      case 'potion': sfxPotion(); break;
      case 'avoid': sfxAvoid(); break;
      case 'victory': sfxVictory(); break;
      case 'defeat': sfxDefeat(); break;
      case 'click': sfxClick(); break;
    }
  }

  function sfxDraw() {
    // Stone grinding — filtered noise burst
    const dur = 0.35;
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.3;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = 400;
    filt.Q.value = 2;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    src.connect(filt).connect(gain).connect(ctx.destination);
    src.start();
    src.stop(ctx.currentTime + dur);
  }

  function sfxCombat() {
    // Impact thud — low sine + noise
    const dur = 0.25;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(80, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur);
  }

  function sfxEquip() {
    // Heavy blade clang — deep resonant strike with weighty low-end body
    const t0 = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = 0.25;
    master.connect(ctx.destination);

    // Low thump — the weight of the blade landing
    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(120, t0);
    thump.frequency.exponentialRampToValueAtTime(55, t0 + 0.25);
    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(0.0001, t0);
    thumpGain.gain.exponentialRampToValueAtTime(0.5, t0 + 0.005);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.35);
    thump.connect(thumpGain).connect(master);
    thump.start(t0);
    thump.stop(t0 + 0.4);

    // Low inharmonic partials — heavy, resonant clang body
    const partials = [
      { freq: 220, amp: 0.22, decay: 1.4 },
      { freq: 340, amp: 0.16, decay: 1.2 },
      { freq: 520, amp: 0.11, decay: 1.0 },
      { freq: 780, amp: 0.07, decay: 0.8 },
      { freq: 1150, amp: 0.04, decay: 0.6 },
    ];
    partials.forEach(p => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(p.freq * 1.015, t0);
      osc.frequency.exponentialRampToValueAtTime(p.freq, t0 + 0.15);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(p.amp, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + p.decay);
      osc.connect(g).connect(master);
      osc.start(t0);
      osc.stop(t0 + p.decay + 0.05);
    });

    // Noise transient — metallic impact grit
    const nbuf = ctx.createBuffer(1, ctx.sampleRate * 0.06, ctx.sampleRate);
    const nd = nbuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1);
    const nsrc = ctx.createBufferSource();
    nsrc.buffer = nbuf;
    const nfilt = ctx.createBiquadFilter();
    nfilt.type = 'bandpass';
    nfilt.frequency.value = 1800;
    nfilt.Q.value = 1.2;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.35, t0);
    ng.gain.exponentialRampToValueAtTime(0.001, t0 + 0.08);
    nsrc.connect(nfilt).connect(ng).connect(master);
    nsrc.start(t0);
    nsrc.stop(t0 + 0.08);
  }

  function sfxPotion() {
    // Glass clink — two short high tones
    [0, 0.08].forEach(delay => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 2200 + delay * 3000;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.06, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.12);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.12);
    });
  }

  function sfxAvoid() {
    // Shuffle/slide sound — filtered noise
    const dur = 0.3;
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.15;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = 'highpass';
    filt.frequency.value = 800;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    src.connect(filt).connect(gain).connect(ctx.destination);
    src.start();
    src.stop(ctx.currentTime + dur);
  }

  function sfxVictory() {
    // Layered fanfare: triumphant arpeggio + sustained chord + shimmer
    const t0 = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);

    // Ascending heroic arpeggio (C major triad up to high C, then D)
    const arp = [523, 659, 784, 1047, 1175];
    arp.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      const t = t0 + i * 0.1;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      osc.connect(gain).connect(master);
      osc.start(t);
      osc.stop(t + 0.5);
    });

    // Sustained chord swells in after arpeggio (C + E + G + high C)
    const chord = [261, 329, 392, 523];
    const chordStart = t0 + 0.5;
    const chordDur = 2.0;
    chord.forEach(freq => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 2000;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, chordStart);
      gain.gain.linearRampToValueAtTime(0.05, chordStart + 0.3);
      gain.gain.linearRampToValueAtTime(0.04, chordStart + chordDur - 0.4);
      gain.gain.exponentialRampToValueAtTime(0.0001, chordStart + chordDur);
      osc.connect(filt).connect(gain).connect(master);
      osc.start(chordStart);
      osc.stop(chordStart + chordDur);
    });

    // Shimmer: high sine sparkles
    [0.6, 0.85, 1.1, 1.4, 1.7].forEach((delay, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 1568 + i * 200;
      const gain = ctx.createGain();
      const t = t0 + delay;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      osc.connect(gain).connect(master);
      osc.start(t);
      osc.stop(t + 0.3);
    });
  }

  function sfxDefeat() {
    // Descending tones
    [300, 220, 150, 80].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      const t = ctx.currentTime + i * 0.15;
      gain.gain.setValueAtTime(0.08, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.35);
    });
  }

  function sfxClick() {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 600;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.04, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.06);
  }

  let titleMaster = null;
  let titleLoopId = null;

  function playTitleLoop() {
    if (!initialized || muted || !titleMaster) return;
    ensureCtx();
    const bpm = 160;
    const beat = 60 / bpm;
    const t0 = ctx.currentTime + 0.05;

    const arpNotes = [
      131, 196, 262, 196, 311, 262, 196, 262,
      131, 196, 262, 196, 311, 262, 196, 262,
      117, 175, 233, 175, 294, 233, 175, 233,
      117, 175, 233, 175, 294, 233, 175, 233,
      104, 156, 208, 156, 262, 208, 156, 208,
      104, 156, 208, 156, 262, 208, 156, 208,
      110, 165, 220, 165, 277, 220, 165, 220,
      110, 165, 220, 165, 277, 220, 165, 220,
    ];

    arpNotes.forEach((f, i) => {
      const t = t0 + i * beat;
      const osc1 = ctx.createOscillator();
      osc1.type = 'square';
      osc1.frequency.value = f;
      const osc2 = ctx.createOscillator();
      osc2.type = 'sawtooth';
      osc2.frequency.value = f * 1.003;
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.setValueAtTime(600, t);
      filt.frequency.linearRampToValueAtTime(1100, t + beat * 0.3);
      filt.frequency.exponentialRampToValueAtTime(400, t + beat * 0.9);
      filt.Q.value = 4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.015);
      g.gain.setValueAtTime(0.1, t + beat * 0.5);
      g.gain.exponentialRampToValueAtTime(0.0001, t + beat * 0.95);
      osc1.connect(filt);
      osc2.connect(filt);
      filt.connect(g).connect(titleMaster);
      osc1.start(t);
      osc1.stop(t + beat);
      osc2.start(t);
      osc2.stop(t + beat);
    });

    const subs = [[65.5, 0], [58.5, 16], [52, 32], [55, 48]];
    subs.forEach(([f, b]) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const g = ctx.createGain();
      const t = t0 + b * beat;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.18, t + beat * 2);
      g.gain.setValueAtTime(0.15, t + beat * 14);
      g.gain.exponentialRampToValueAtTime(0.0001, t + beat * 16);
      osc.connect(g).connect(titleMaster);
      osc.start(t);
      osc.stop(t + beat * 16 + 0.1);
    });

    const padChords = [
      [[262, 311, 392], 0, 16],
      [[233, 294, 349], 16, 16],
      [[208, 262, 311], 32, 16],
      [[220, 277, 330], 48, 16],
    ];
    padChords.forEach(([freqs, b, d]) => {
      freqs.forEach(f => {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = f * 2;
        const filt = ctx.createBiquadFilter();
        filt.type = 'lowpass';
        filt.frequency.value = 800;
        const g = ctx.createGain();
        const t = t0 + b * beat;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.015, t + beat * 4);
        g.gain.setValueAtTime(0.015, t + d * beat - beat * 3);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d * beat);
        osc.connect(filt).connect(g).connect(titleMaster);
        osc.start(t);
        osc.stop(t + d * beat + 0.1);
      });
    });

    const loopDur = 64 * beat * 1000;
    titleLoopId = setTimeout(() => { if (titleMaster) playTitleLoop(); }, loopDur - 100);
  }

  function startTitleMusic() {
    if (!initialized) return;
    ensureCtx();
    if (titleMaster) return;
    titleMaster = ctx.createGain();
    titleMaster.gain.value = 0.55;
    titleMaster.connect(ctx.destination);
    playTitleLoop();
  }

  function stopTitleMusic() {
    if (titleLoopId) { clearTimeout(titleLoopId); titleLoopId = null; }
    if (titleMaster) { titleMaster.disconnect(); titleMaster = null; }
  }

  let defeatMaster = null;
  let defeatLoopId = null;

  function playDefeatLoop() {
    if (!initialized || muted || !defeatMaster) return;
    ensureCtx();
    const bpm = 90;
    const beat = 60 / bpm;
    const t0 = ctx.currentTime + 0.1;

    const bass = [147, 147, 175, 175, 131, 131, 139, 147,
                  147, 147, 175, 175, 131, 131, 139, 147];
    bass.forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = f;
      const g = ctx.createGain();
      const t = t0 + i * beat;
      g.gain.setValueAtTime(0.1, t);
      g.gain.setValueAtTime(0.1 * 0.7, t + beat * 0.9 * 0.8);
      g.gain.exponentialRampToValueAtTime(0.0001, t + beat * 0.9 - 0.01);
      osc.connect(g).connect(defeatMaster);
      osc.start(t);
      osc.stop(t + beat * 0.9);
    });

    const melody = [
      [587, 0, 2], [554, 2, 1], [523, 3, 1],
      [494, 4, 2], [440, 6, 1], [466, 7, 0.5], [440, 7.5, 0.5],
      [392, 8, 2], [440, 10, 1], [494, 11, 1],
      [523, 12, 1.5], [494, 13.5, 0.5], [440, 14, 1], [392, 15, 1],
    ];
    melody.forEach(([f, b, d]) => {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = f;
      const g = ctx.createGain();
      const t = t0 + b * beat;
      const dur = d * beat * 0.95;
      g.gain.setValueAtTime(0.07, t);
      g.gain.setValueAtTime(0.07 * 0.7, t + dur * 0.8);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur - 0.01);
      osc.connect(g).connect(defeatMaster);
      osc.start(t);
      osc.stop(t + dur);
    });

    for (let i = 0; i < 16; i++) {
      if (i % 2 === 0) {
        const t = t0 + i * beat;
        const buf = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let j = 0; j < d.length; j++) d[j] = (Math.random() * 2 - 1);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.12, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
        src.connect(g).connect(defeatMaster);
        src.start(t);
        src.stop(t + 0.06);
      }
    }

    const loopDur = 16 * beat * 1000;
    defeatLoopId = setTimeout(() => { if (defeatMaster) playDefeatLoop(); }, loopDur - 100);
  }

  let victoryMaster = null;
  let victoryLoopId = null;

  function playVictoryLoop() {
    if (!initialized || muted || !victoryMaster) return;
    ensureCtx();
    const bpm = 152;
    const beat = 60 / bpm;
    const t0 = ctx.currentTime + 0.1;

    const fanfare = [
      [262, 0, 1], [330, 1, 0.5], [392, 1.5, 0.5], [523, 2, 2],
      [494, 4, 0.5], [523, 4.5, 0.5], [587, 5, 1.5], [523, 6.5, 0.5],
      [392, 7, 1], [440, 8, 0.5], [494, 8.5, 0.5], [523, 9, 1],
      [587, 10, 0.5], [659, 10.5, 0.5], [784, 11, 2],
      [659, 13, 0.5], [784, 13.5, 0.5], [880, 14, 1], [784, 15, 0.5], [880, 15.5, 0.5],
      [1047, 16, 3],
      [880, 19, 1], [784, 20, 1], [659, 21, 1], [523, 22, 3],
    ];
    fanfare.forEach(([f, b, d]) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const osc2 = ctx.createOscillator();
      osc2.type = 'square';
      osc2.frequency.value = f * 1.002;
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 2200;
      const g = ctx.createGain();
      const t = t0 + b * beat;
      const dur = d * beat * 0.92;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.14, t + 0.02);
      g.gain.setValueAtTime(0.12, t + dur * 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(filt);
      osc2.connect(filt);
      filt.connect(g).connect(victoryMaster);
      osc.start(t);
      osc.stop(t + dur + 0.05);
      osc2.start(t);
      osc2.stop(t + dur + 0.05);
    });

    const bass = [
      [131, 0, 4], [147, 4, 3], [131, 7, 3],
      [147, 10, 1], [165, 11, 2], [196, 13, 3],
      [262, 16, 3], [220, 19, 2], [196, 21, 1], [131, 22, 4],
    ];
    bass.forEach(([f, b, d]) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 400;
      const g = ctx.createGain();
      const t = t0 + b * beat;
      const dur = d * beat * 0.9;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.03);
      g.gain.setValueAtTime(0.1, t + dur * 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(filt).connect(g).connect(victoryMaster);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    });

    const chords = [
      [[262, 330, 392], 0, 7],
      [[294, 349, 440], 7, 4],
      [[330, 392, 494], 11, 5],
      [[262, 330, 392, 523], 16, 5],
      [[220, 330, 440], 21, 5],
    ];
    chords.forEach(([freqs, b, d]) => {
      freqs.forEach(f => {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = f;
        const filt = ctx.createBiquadFilter();
        filt.type = 'lowpass';
        filt.frequency.value = 900;
        const g = ctx.createGain();
        const t = t0 + b * beat;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.03, t + beat * 1.5);
        g.gain.setValueAtTime(0.03, t + d * beat - beat * 1.5);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d * beat);
        osc.connect(filt).connect(g).connect(victoryMaster);
        osc.start(t);
        osc.stop(t + d * beat + 0.1);
      });
    });

    const hits = [0, 2, 4, 7, 9, 11, 13, 16, 19, 22];
    hits.forEach(b => {
      const t = t0 + b * beat;
      const buf = ctx.createBuffer(1, ctx.sampleRate * 0.06, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let j = 0; j < d.length; j++) d[j] = (Math.random() * 2 - 1);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const filt = ctx.createBiquadFilter();
      filt.type = 'highpass';
      filt.frequency.value = 2000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.15, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
      src.connect(filt).connect(g).connect(victoryMaster);
      src.start(t);
      src.stop(t + 0.07);
    });

    [0, 0.15, 0.3, 0.5, 0.7, 0.9, 1.2].forEach((delay, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 2000 + i * 300;
      const g = ctx.createGain();
      const t = t0 + 16 * beat + delay;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.06, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      osc.connect(g).connect(victoryMaster);
      osc.start(t);
      osc.stop(t + 0.35);
    });

    const loopDur = 26 * beat * 1000;
    victoryLoopId = setTimeout(() => { if (victoryMaster) playVictoryLoop(); }, loopDur - 100);
  }

  function startVictoryMusic() {
    init();
    ensureCtx();
    if (victoryMaster) return;
    victoryMaster = ctx.createGain();
    victoryMaster.gain.value = 0.6;
    victoryMaster.connect(ctx.destination);
    playVictoryLoop();
  }

  function stopVictoryMusic() {
    if (victoryLoopId) { clearTimeout(victoryLoopId); victoryLoopId = null; }
    if (victoryMaster) { victoryMaster.disconnect(); victoryMaster = null; }
  }

  function startDefeatMusic() {
    init();
    ensureCtx();
    if (defeatMaster) return;
    defeatMaster = ctx.createGain();
    defeatMaster.gain.value = 0.6;
    defeatMaster.connect(ctx.destination);
    playDefeatLoop();
  }

  function stopDefeatMusic() {
    if (defeatLoopId) { clearTimeout(defeatLoopId); defeatLoopId = null; }
    if (defeatMaster) { defeatMaster.disconnect(); defeatMaster = null; }
  }

  function startAmbient() {
    if (!initialized || muted) return;
    ensureCtx();
    if (ambientNode) return;
    // Low drone — very quiet oscillator
    ambientNode = ctx.createOscillator();
    ambientNode.type = 'sawtooth';
    ambientNode.frequency.value = 55;
    ambientGain = ctx.createGain();
    ambientGain.gain.value = 0.02;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 120;
    ambientNode.connect(filt).connect(ambientGain).connect(ctx.destination);
    ambientNode.start();
  }

  function stopAmbient() {
    if (ambientNode) {
      try { ambientNode.stop(); } catch (e) { /* already stopped */ }
      ambientNode = null;
      ambientGain = null;
    }
  }

  function toggleMute() {
    muted = !muted;
    if (muted) stopAmbient();
    else startAmbient();
    return muted;
  }

  return { init, play, startAmbient, stopAmbient, startTitleMusic, stopTitleMusic, startVictoryMusic, stopVictoryMusic, startDefeatMusic, stopDefeatMusic, toggleMute, get muted() { return muted; }, get ctx() { ensureCtx(); return ctx; } };
})();

// ============================================================
// 7. EVENT HANDLING
// ============================================================

const canHover = window.matchMedia('(hover: hover)').matches;

function handleCardClick(index) {
  if (state.phase !== 'room') return;
  if (state.room[index] === null) return;

  Audio.play('click');

  if (canHover) {
    resolveCard(index);
    return;
  }

  if (state.selectedIndex === index) {
    resolveCard(index);
    return;
  }

  state.selectedIndex = index;
  const container = $('#room-cards');
  const prev = container.querySelector('.card.selected');
  if (prev) prev.classList.remove('selected');
  const next = container.querySelector(`.card[data-index="${index}"]`);
  if (next) next.classList.add('selected');
}

function setupEventListeners() {
  // Start title music on first interaction with start screen
  let titleMusicStarted = false;
  const startTitleMusicOnce = () => {
    if (titleMusicStarted) return;
    titleMusicStarted = true;
    Audio.init();
    Audio.startTitleMusic();
  };
  $('#start-screen').addEventListener('click', startTitleMusicOnce);

  // Start button
  $('#start-btn').addEventListener('click', () => {
    startTitleMusicOnce();
    Audio.stopTitleMusic();
    startGame();
  });

  // Rules
  const openRules = () => {
    $('#rules-modal').classList.add('active');
    $('#rules-modal').setAttribute('aria-hidden', 'false');
  };
  $('#rules-btn').addEventListener('click', openRules);
  $('#help-btn').addEventListener('click', openRules);
  $('#rules-close').addEventListener('click', () => {
    $('#rules-modal').classList.remove('active');
    $('#rules-modal').setAttribute('aria-hidden', 'true');
  });
  $('.modal-backdrop').addEventListener('click', () => {
    $('#rules-modal').classList.remove('active');
    $('#rules-modal').setAttribute('aria-hidden', 'true');
  });

  // Room card clicks (delegated)
  $('#room-cards').addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    handleCardClick(parseInt(card.dataset.index, 10));
  });

  // Avoid
  $('#avoid-btn').addEventListener('click', avoidRoom);

  // Confirm

  // Restart
  $('#restart-btn').addEventListener('click', () => {
    Audio.stopVictoryMusic();
    Audio.stopDefeatMusic();
    const overlay = $('#gameover-overlay');
    overlay.classList.remove('active');
    overlay.style.display = '';
    overlay.setAttribute('aria-hidden', 'true');
    startGame();
  });

  // Mute
  $('#mute-btn').addEventListener('click', () => {
    const muted = Audio.toggleMute();
    $('#mute-btn').classList.toggle('muted', muted);
  });

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    if (state.phase !== 'room') return;

    const cards = [...$$('#room-cards .card')];
    if (cards.length === 0) return;

    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const focused = document.activeElement;
      const currentIdx = cards.indexOf(focused);
      let next;
      if (e.key === 'ArrowRight') {
        next = currentIdx < cards.length - 1 ? currentIdx + 1 : 0;
      } else {
        next = currentIdx > 0 ? currentIdx - 1 : cards.length - 1;
      }
      cards[next].focus();
    }

    if (e.key === 'Enter' || e.key === ' ') {
      const focused = document.activeElement;
      if (focused.classList.contains('card')) {
        e.preventDefault();
        handleCardClick(parseInt(focused.dataset.index, 10));
      }
    }

    // 'a' for avoid
    if (e.key === 'a' && canAvoid()) {
      avoidRoom();
    }
  });
}

// ============================================================
// 8. INITIALIZATION
// ============================================================

function startGame() {
  resetGame();

  // Switch screens
  $('#start-screen').classList.remove('active');
  $('#game-screen').classList.add('active');
  const overlay = $('#gameover-overlay');
  overlay.classList.remove('active');
  overlay.style.display = '';

  // Draw first room
  drawRoom();
  Audio.play('draw');
  Audio.startAmbient();
  renderAll();
}

function resolveCard(index) {
  const card = state.room[index];
  if (!card) return;

  const type = cardType(card.suit);

  if (type === 'monster') {
    resolveMonster(card, index);
  } else if (type === 'weapon') {
    resolveWeapon(card, index);
  } else if (type === 'potion') {
    resolvePotion(card, index);
  }

  state.resolvedThisRoom++;
  state.room[index] = null;
  state.selectedIndex = null;
  addToDiscard(card);

  // Death check
  if (state.hp <= 0) {
    state.hp = 0;
    state.phase = 'gameover';
    renderAll();
    // Show defeat overlay after a brief pause so the damage flash can play.
    // Wrapped in try/catch to guarantee the overlay appears even if something throws.
    window.setTimeout(() => {
      try { showGameOver(false); }
      catch (err) {
        console.error('showGameOver failed:', err);
        const overlay = document.getElementById('gameover-overlay');
        if (overlay) overlay.classList.add('active');
      }
    }, 600);
    return;
  }

  const unresolvedCards = state.room.filter(c => c !== null);
  const totalDealtThisRoom = state.resolvedThisRoom + unresolvedCards.length;
  const isShortRoom = totalDealtThisRoom < CARDS_PER_ROOM;
  const targetResolve = isShortRoom
    ? Math.max(1, totalDealtThisRoom - (state.dungeon.length > 0 ? 1 : 0))
    : CARDS_TO_RESOLVE;

  // If it's the very last room and dungeon is empty, resolve all cards
  if (state.dungeon.length === 0 && isShortRoom) {
    // Must resolve all remaining
    if (unresolvedCards.length === 0) {
      // All done — win
      state.room = [];
      state.phase = 'gameover';
      renderAll();
      setTimeout(() => showGameOver(true), 600);
      return;
    }
    // Still more to resolve
    renderAll();
    return;
  }

  if (state.resolvedThisRoom >= targetResolve) {
    // Room complete — remaining card(s) stay for next room
    state.room = unresolvedCards;
    state.lastAvoided = false;
    state.phase = 'idle';

    if (state.dungeon.length === 0 && state.room.length === 0) {
      state.phase = 'gameover';
      renderAll();
      setTimeout(() => showGameOver(true), 600);
      return;
    }

    renderAll();
    setTimeout(() => {
      drawRoom();
      if (state.room.length === 0) {
        state.phase = 'gameover';
        renderAll();
        setTimeout(() => showGameOver(true), 400);
        return;
      }
      Audio.play('draw');
      renderAll();
    }, 500);
    return;
  }

  renderAll();
}

function init() {
  setupEventListeners();
}

// Boot
document.addEventListener('DOMContentLoaded', init);
