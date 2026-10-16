/* global CustomEvent */

import { createTurdspadesAudio } from './turdspades-audio.js';
import {
  prefersReducedMotion,
  pulseSpadesBroken,
  runTrickSweep,
  spawnSpadeShards,
  runDealAnimation,
  flyCardToTrick
} from './turdspades-fx.js';
import {
  explainAiPlay,
  formatCardLabel,
  teamContractNeed,
  estimateExpectedTricks,
  loadAiDifficulty,
  AI_DIFFICULTY_KEY,
  normalizeAiDifficulty
} from './turdspades-ai.js';
import { pickAiPlayCard } from './turdspades-play-ai.js';
import { fanStyle, sideFanStyle } from './turdspades-layout.js';
import { avatarSvg } from './turdspades-avatars.js';
import { showScoringReceipt } from './turdspades-round-ui.js';

const audio = createTurdspadesAudio();
const NAMES = ['You', 'West', 'North', 'East'];

function bindGestureUnlock() {
  const unlock = () => {
    audio.unlockFromGesture();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { once: true, passive: true });
  window.addEventListener('keydown', unlock, { once: true });
}

function ensureFxLayer(tableEl) {
  let layer = document.getElementById('tsSweepLayer');
  if (!layer && tableEl) {
    layer = document.createElement('div');
    layer.id = 'tsSweepLayer';
    layer.className = 'ts-sweep-layer';
    layer.setAttribute('aria-hidden', 'true');
    tableEl.appendChild(layer);
  }
  return layer;
}

function ensureFxCanvas(tableEl) {
  let canvas = document.getElementById('tsFxCanvas');
  if (!canvas && tableEl) {
    canvas = document.createElement('canvas');
    canvas.id = 'tsFxCanvas';
    canvas.className = 'ts-fx-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    tableEl.appendChild(canvas);
    const resize = () => {
      const r = tableEl.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(r.width));
      canvas.height = Math.max(1, Math.floor(r.height));
    };
    resize();
    window.addEventListener('resize', resize, { passive: true });
  }
  return canvas;
}

function ensureReceiptRoot() {
  let el = document.getElementById('tsReceiptOverlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'tsReceiptOverlay';
    el.className = 'ts-receipt-overlay';
    el.setAttribute('aria-live', 'polite');
    document.querySelector('.app')?.appendChild(el);
  }
  return el;
}

function ensureTableAnnouncer() {
  let el = document.getElementById('tsTableAnnouncer');
  if (!el) {
    el = document.createElement('div');
    el.id = 'tsTableAnnouncer';
    el.className = 'ts-table-announcer';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-atomic', 'true');
    document.querySelector('.app')?.prepend(el);
  }
  return el;
}

function announceTable(text) {
  if (!text) {
    return;
  }
  const el = ensureTableAnnouncer();
  el.textContent = '';
  void el.offsetWidth;
  el.textContent = text;
}

function showBotHint(text) {
  if (!text) {
    return;
  }
  let el = document.getElementById('tsBotHint');
  if (!el) {
    el = document.createElement('div');
    el.id = 'tsBotHint';
    el.className = 'ts-bot-hint';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(showBotHint._t);
  showBotHint._t = setTimeout(() => el.classList.remove('show'), 2800);
}

function mountAvatars() {
  const map = [
    ['avatarYou', 'you'],
    ['avatarWest', 'west'],
    ['avatarNorth', 'north'],
    ['avatarEast', 'east']
  ];
  for (const [id, key] of map) {
    const node = document.getElementById(id);
    if (node && !node.innerHTML) {
      node.innerHTML = avatarSvg(key);
    }
  }
}

function updateScoreStrip() {
  const st = globalThis.state;
  if (!st) {
    return;
  }
  const strip = document.getElementById('tsScoreStrip');
  if (!strip) {
    return;
  }
  const bidA =
    st.bids[0] === null && st.bids[2] === null
      ? '-'
      : `${(st.bids[0] === 0 ? 0 : st.bids[0] || 0) + (st.bids[2] === 0 ? 0 : st.bids[2] || 0)}`;
  const bidB =
    st.bids[1] === null && st.bids[3] === null
      ? '-'
      : `${(st.bids[1] === 0 ? 0 : st.bids[1] || 0) + (st.bids[3] === 0 ? 0 : st.bids[3] || 0)}`;
  const trickA = (st.tricks[0] || 0) + (st.tricks[2] || 0);
  const trickB = (st.tricks[1] || 0) + (st.tricks[3] || 0);
  strip.innerHTML = `<span class="us">Us <strong>${st.scores[0]}</strong> <em>bid ${bidA} / ${trickA} · bags ${st.bags[0]}</em></span>
    <span class="vs">vs</span>
    <span class="them">Them <strong>${st.scores[1]}</strong> <em>bid ${bidB} / ${trickB} · bags ${st.bags[1]}</em></span>`;
}

function updateTrickStacks() {
  const st = globalThis.state;
  if (!st) {
    return;
  }
  const stacks = [
    ['stackYou', 0],
    ['stackNorth', 2],
    ['stackWest', 1],
    ['stackEast', 3]
  ];
  for (const [id, p] of stacks) {
    const el = document.getElementById(id);
    if (!el) {
      continue;
    }
    const n = st.tricks[p] || 0;
    el.textContent = n ? String(n) : '';
    el.classList.toggle('show', n > 0);
  }
}

function updateBidHint() {
  const st = globalThis.state;
  const hint = document.getElementById('bidExpectedHint');
  if (!hint || !st || st.phase !== 'bidding' || st.bidTurn !== 0) {
    if (hint) {
      hint.textContent = '';
    }
    return;
  }
  const est = estimateExpectedTricks(st.hands[0] || []);
  hint.textContent = `Hand suggests ~${est} trick${est === 1 ? '' : 's'}`;
}

function partnerBidBubble() {
  const st = globalThis.state;
  const bubble = document.getElementById('partnerBidBubble');
  if (!bubble || !st) {
    return;
  }
  if (st.phase !== 'bidding' || st.bids[2] === null) {
    bubble.classList.remove('show');
    bubble.textContent = '';
    return;
  }
  const b = st.bids[2];
  bubble.textContent = b === 0 ? 'North bids Nil — cover me!' : `North locks ${b} tricks.`;
  bubble.classList.add('show');
}

function applyFanStyles() {
  const st = globalThis.state;
  if (!st) {
    return;
  }
  const youCards = document.querySelectorAll('#youCards .card');
  const total = youCards.length;
  youCards.forEach((card, i) => {
    card.style.cssText += `;${fanStyle(i, total, { spreadDeg: 4.8, liftPx: 18 })}`;
  });
  const fanBacks = (id, side) => {
    const backs = document.querySelectorAll(`#${id} .back`);
    const n = backs.length;
    backs.forEach((b, i) => {
      b.style.cssText += `;${sideFanStyle(i, n, side)}`;
    });
  };
  fanBacks('northBack', 'north');
  fanBacks('westBack', 'west');
  fanBacks('eastBack', 'east');
}

function mountBidChips() {
  const row = document.getElementById('bidChips');
  if (!row || row.dataset.mounted) {
    return;
  }
  row.dataset.mounted = '1';
  for (let n = 0; n <= 13; n++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ts-bid-chip';
    btn.dataset.bid = String(n);
    btn.textContent = n === 0 ? 'Nil' : String(n);
    btn.addEventListener('click', () => {
      const st = globalThis.state;
      if (!st || st.phase !== 'bidding' || st.bidTurn !== 0) {
        return;
      }
      st.bidChoice = n;
      window.dispatchEvent(new CustomEvent('turdspades:bid-tick'));
      if (typeof globalThis.render === 'function') {
        globalThis.render();
      }
    });
    row.appendChild(btn);
  }
}

function syncBidChips() {
  const st = globalThis.state;
  const row = document.getElementById('bidChips');
  if (!row || !st) {
    return;
  }
  row.querySelectorAll('.ts-bid-chip').forEach((btn) => {
    const v = Number(btn.dataset.bid);
    btn.classList.toggle('active', st.bidChoice === v);
    btn.classList.toggle('nil-chip', v === 0);
  });
}

function mountDifficultySelect() {
  const host = document.getElementById('tsAiDifficulty');
  if (!host || host.dataset.mounted) {
    return;
  }
  host.dataset.mounted = '1';
  const sel = document.createElement('select');
  sel.id = 'tsAiDifficultySelect';
  sel.className = 'ts-ai-select';
  sel.setAttribute('aria-label', 'Bot difficulty');
  for (const opt of [
    ['easy', 'Easy bots'],
    ['normal', 'Normal bots'],
    ['hard', 'Hard bots']
  ]) {
    const o = document.createElement('option');
    o.value = opt[0];
    o.textContent = opt[1];
    sel.appendChild(o);
  }
  sel.value = loadAiDifficulty();
  sel.addEventListener('change', () => {
    try {
      localStorage.setItem(AI_DIFFICULTY_KEY, normalizeAiDifficulty(sel.value));
    } catch {
      /* ignore */
    }
  });
  host.appendChild(sel);
}

export function mountTurdspadesEnhancements() {
  bindGestureUnlock();
  const tableEl = document.querySelector('.table');
  const sweepLayer = ensureFxLayer(tableEl);
  const fxCanvas = ensureFxCanvas(tableEl);
  const receiptRoot = ensureReceiptRoot();
  const reduced = () => prefersReducedMotion();

  mountAvatars();
  mountBidChips();
  mountDifficultySelect();

  window.__tsPickAiCard = (player) => {
    const st = globalThis.state;
    if (!st || typeof globalThis.legalCards !== 'function') {
      return null;
    }
    const legal = globalThis.legalCards(player);
    return pickAiPlayCard({
      state: st,
      player,
      legal,
      difficulty: loadAiDifficulty(),
      helpers: {
        beats: globalThis.beats,
        winnerEntry: globalThis.winnerEntry,
        pickNilCoverCard: globalThis.pickNilCoverCard,
        low: globalThis.low,
        high: globalThis.high
      }
    });
  };

  window.__tsExplainAi = (player, card, flags = {}) => {
    const st = globalThis.state;
    if (!st) {
      return '';
    }
    const partner = (player + 2) % 4;
    const need = teamContractNeed(st.bids, st.tricks, player, partner);
    return explainAiPlay({
      player,
      card,
      playerBid: st.bids[player],
      partnerBid: st.bids[partner],
      teamNeed: need,
      nilCover: !!flags.nilCover,
      leading: !st.trick.length
    });
  };

  window.__tsAfterRender = () => {
    updateScoreStrip();
    updateTrickStacks();
    updateBidHint();
    partnerBidBubble();
    syncBidChips();
    applyFanStyles();
  };

  window.addEventListener('turdspades:card-played', (ev) => {
    const { card, player } = ev.detail || {};
    audio.playCardPlay(card);
    const seat = NAMES[player] || 'You';
    if (player !== 0) {
      announceTable(`${seat} plays ${formatCardLabel(card)}`);
    }
    flyCardToTrick(sweepLayer, seat, formatCardLabel(card), { reduced: reduced() });
  });

  window.addEventListener('turdspades:round-dealt', () => {
    const st = globalThis.state;
    if (!st) {
      return;
    }
    runDealAnimation(sweepLayer, {
      north: st.hands[2]?.length || 0,
      west: st.hands[1]?.length || 0,
      east: st.hands[3]?.length || 0,
      you: st.hands[0]?.length || 0
    }, { reduced: reduced() });
  });

  window.addEventListener('turdspades:contract-locked', (ev) => {
    const banner = document.getElementById('tsContractBanner');
    if (!banner) {
      return;
    }
    banner.textContent = ev.detail?.text || '';
    banner.classList.add('show');
    setTimeout(() => banner.classList.remove('show'), 3200);
  });

  window.addEventListener('turdspades:round-scored', (ev) => {
    const detail = ev.detail || {};
    const delta = detail.deltaUs;
    if (typeof delta === 'number') {
      const sign = delta >= 0 ? '+' : '';
      announceTable(
        detail.matchEnd
          ? `Match over. Your team ${sign}${delta} this round.`
          : `Round scored. Your team ${sign}${delta}.`
      );
    }
    showScoringReceipt(receiptRoot, {
      title: detail.matchEnd ? 'Match settled' : 'Round receipt',
      lines: detail.lines || [],
      total: detail.deltaUs
    }, { reduced: reduced() });
    if (detail.matchEnd && detail.won) {
      let trophy = document.getElementById('tsTrophy');
      if (!trophy) {
        trophy = document.createElement('div');
        trophy.id = 'tsTrophy';
        trophy.className = 'ts-trophy';
        trophy.innerHTML = '<span>\uD83C\uDFC6</span><p>Sewer royalty!</p>';
        document.body.appendChild(trophy);
      }
      trophy.classList.add('show');
      setTimeout(() => trophy.classList.remove('show'), 4000);
    }
  });

  window.addEventListener('turdspades:avatar-mood', (ev) => {
    const { seat, mood } = ev.detail || {};
    const id = seat === 'north' ? 'avatarNorth' : seat === 'west' ? 'avatarWest' : seat === 'east' ? 'avatarEast' : 'avatarYou';
    const node = document.getElementById(id);
    if (node) {
      node.innerHTML = avatarSvg(seat || 'you', mood || 'neutral');
    }
  });

  window.addEventListener('turdspades:spades-broken', () => {
    audio.playSpadesBroken();
    announceTable('Spades are broken — trump is live');
    pulseSpadesBroken(tableEl, reduced());
    spawnSpadeShards(fxCanvas, reduced());
  });

  window.addEventListener('turdspades:trick-complete', (ev) => {
    const { winner, trick } = ev.detail || {};
    audio.playTrickWin();
    announceTable(`${NAMES[winner] || 'Player'} wins the trick`);
    tsEventAvatar(winner, 'happy');
    if (!trick?.length) {
      return;
    }
    const cards = trick.map((e) => ({
      seat: e.playerName,
      label: formatCardLabel(e.card)
    }));
    const winnerName = NAMES[winner] || 'You';
    runTrickSweep(sweepLayer, cards, winnerName, { reduced: reduced() });
  });

  window.addEventListener('turdspades:bid-tick', () => audio.playBidTick());
  window.addEventListener('turdspades:bid-locked', (ev) => {
    audio.playBidLock(!!ev.detail?.nil);
  });
  window.addEventListener('turdspades:bag-penalty', () => audio.playBagPenalty());
  window.addEventListener('turdspades:match-end', (ev) => audio.playMatchFanfare(!!ev.detail?.won));
  window.addEventListener('turdspades:bot-hint', (ev) => {
    showBotHint(ev.detail?.text || '');
  });

  const drawerBtn = document.getElementById('tsDrawerToggle');
  const drawer = document.getElementById('tsDetailsDrawer');
  if (drawerBtn && drawer) {
    drawerBtn.addEventListener('click', () => {
      drawer.classList.toggle('open');
      drawerBtn.setAttribute('aria-expanded', drawer.classList.contains('open') ? 'true' : 'false');
    });
  }
}

function tsEventAvatar(winnerPlayer, mood) {
  const keys = ['you', 'west', 'north', 'east'];
  const seat = keys[winnerPlayer] || 'you';
  window.dispatchEvent(new CustomEvent('turdspades:avatar-mood', { detail: { seat, mood } }));
}

mountTurdspadesEnhancements();
