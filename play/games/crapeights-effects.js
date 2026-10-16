/** Crappy Eights: bounded table reactions, scoring receipts and optional display stats. */
(function (root) {
  'use strict';

  const STATS_KEY = 'crapeights_stats_v1';
  const SUITS = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const SUIT_COLORS = { S: '#bdc9ff', H: '#ff9aa9', D: '#ffc084', C: '#a6edb1' };
  const SPEECH = {
    idle: ['Something smells strategic.', 'Just airing out my hand.', 'Flush with confidence.'],
    thinking: ['Plotting a royal flush…', 'Let me sniff this out…', 'Calculating the stink…'],
    skip: ['Well, that stinks.', 'My turn went down the drain.', 'Rude. Hygienic, but rude.'],
    drawtwo: ['A double helping?!', 'Two-ply punishment.', 'This hand needs a plumber.'],
    reverse: ['Back up the pipe!', 'A change in the current.', 'Wrong way down the drain.'],
    wild: ['A fresh coat of stink.', 'My sewer, my suit.', 'Time to repaint the pipes.'],
    oneleft: ['ONE LEFT! Smell victory?', 'ONE LEFT! Flush incoming.', 'ONE LEFT! Hold your nose.'],
    win: ['Clean sweep. Dirty hands.', 'Crowned king of the commode!', 'The sewer has spoken.']
  };

  function speechFor(type, seatIndex = 0) {
    const lines = SPEECH[type] || SPEECH.idle;
    const index = Number.isFinite(seatIndex) ? Math.abs(Math.trunc(seatIndex)) : 0;
    return lines[index % lines.length];
  }

  function motionPolicy(reducedMotion = false) {
    return {
      flightCount: reducedMotion ? 0 : 2,
      reactionDuration: reducedMotion ? 0 : 540,
      orbitDuration: reducedMotion ? 0 : 850,
      receiptStep: reducedMotion ? 0 : 75,
      maxTransientNodes: 8,
      speechDuration: 2600
    };
  }

  function stampAnchor(target, viewportWidth = root.innerWidth || 390) {
    const rect = target?.getBoundingClientRect?.();
    if (!rect?.width) { return null; }
    const avatar = target.querySelector?.('.ce-avatar');
    const avatarRect = avatar?.getBoundingClientRect?.();
    const bandTop = avatarRect ? avatarRect.bottom + 6 : rect.top + rect.height * 0.38;
    const bandBottom = rect.bottom - 8;
    const clampX = (value) => Math.max(58, Math.min(Number(viewportWidth) - 58, value));
    if (bandBottom <= bandTop) {
      return { left: clampX(rect.left + rect.width / 2), top: rect.top + rect.height * 0.72 };
    }
    const top = Math.min(bandBottom - 12, Math.max(bandTop + 12, rect.top + rect.height * 0.58));
    return { left: clampX(rect.left + rect.width / 2), top };
  }

  function actionPlan({ type, playerIndex = 0, targetIndex = playerIndex, count = 2, suit = 'C', direction = 1 } = {}, reducedMotion = false) {
    const policy = motionPolicy(reducedMotion);
    const target = type === 'skip' || type === 'drawtwo' ? targetIndex : playerIndex;
    const amount = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 2;
    const labels = { drawtwo: `+${amount} CARDS`, skip: 'SKIP', reverse: direction === 1 ? '↻ REVERSE' : '↺ REVERSE', wild: `${SUITS[suit] || SUITS.C} WILD SUIT`, oneleft: 'ONE LEFT!', win: 'SEWER CHAMPION' };
    return {
      type, target, label: labels[type] || '', speech: speechFor(type, target),
      flightCount: type === 'drawtwo' ? Math.min(amount, policy.flightCount) : 0,
      animate: !reducedMotion,
      color: type === 'wild' ? SUIT_COLORS[suit] || SUIT_COLORS.C : '#ffe4a3'
    };
  }

  function pointsFor(card) {
    if (card?.rank === '8') { return 50; }
    if (card?.rank === 'A') { return 1; }
    if (['J', 'Q', 'K'].includes(card?.rank)) { return 10; }
    const value = Number(card?.rank);
    return Number.isInteger(value) && value >= 2 && value <= 10 ? value : 0;
  }

  function scoringReceipt(players, winnerIndex) {
    const rows = (Array.isArray(players) ? players : []).flatMap((player, index) => {
      if (index === winnerIndex) { return []; }
      const cards = (Array.isArray(player?.hand) ? player.hand : []).map(card => ({ rank: String(card.rank), suit: String(card.suit), points: pointsFor(card) }));
      return [{ index, name: String(player?.name || `Seat ${index + 1}`), cards, points: cards.reduce((sum, card) => sum + card.points, 0) }];
    });
    return { rows, total: rows.reduce((sum, row) => sum + row.points, 0) };
  }

  function sanitizeStats(raw) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const result = { v: 1 };
    for (const key of ['roundsPlayed', 'roundsWon', 'matchesPlayed', 'matchesWon', 'pointsCollected', 'bestRound', 'winStreak', 'bestStreak']) {
      result[key] = Number.isSafeInteger(source[key]) && source[key] >= 0 ? source[key] : 0;
    }
    result.roundsWon = Math.min(result.roundsWon, result.roundsPlayed);
    result.matchesWon = Math.min(result.matchesWon, result.matchesPlayed);
    result.winStreak = Math.min(result.winStreak, result.roundsWon);
    result.bestStreak = Math.min(Math.max(result.bestStreak, result.winStreak), result.roundsWon);
    return result;
  }

  function readStats(storage) {
    try { return sanitizeStats(JSON.parse((storage || root.localStorage)?.getItem(STATS_KEY) || '{}')); }
    catch { return sanitizeStats(null); }
  }

  function saveStats(stats, storage) {
    try {
      const destination = storage || root.localStorage;
      if (!destination?.setItem) { return false; }
      destination.setItem(STATS_KEY, JSON.stringify(sanitizeStats(stats)));
      return true;
    } catch { return false; }
  }

  function recordRound(stats, { humanWon = false, points = 0, matchFinished = false } = {}) {
    const result = sanitizeStats(stats);
    const increment = (key, amount = 1) => { result[key] = Math.min(Number.MAX_SAFE_INTEGER, result[key] + amount); };
    const awarded = Number.isSafeInteger(points) && points >= 0 ? points : 0;
    increment('roundsPlayed');
    if (humanWon) {
      increment('roundsWon');
      increment('pointsCollected', awarded);
      increment('winStreak');
      result.bestRound = Math.max(result.bestRound, awarded);
      result.bestStreak = Math.max(result.bestStreak, result.winStreak);
    } else { result.winStreak = 0; }
    if (matchFinished) {
      increment('matchesPlayed');
      if (humanWon) { increment('matchesWon'); }
    }
    return result;
  }

  function createController({ seat = () => null, fan = seat, deck, pile, arena, presentation = {}, announce = () => {}, reducedMotion } = {}) {
    const doc = root.document;
    const timers = new Set();
    const animations = new Set();
    const transients = new Set();
    const bubbles = new Map();
    const receiptTallies = new Map();
    let overlay = null;
    let thinkingIndex = -1;
    let disposed = false;
    const media = root.matchMedia?.('(prefers-reduced-motion: reduce)');
    const isReduced = () => typeof reducedMotion === 'function' ? !!reducedMotion() : typeof reducedMotion === 'boolean' ? reducedMotion : !!media?.matches;

    function later(callback, delay) {
      const timer = setTimeout(() => { timers.delete(timer); if (!disposed) { callback(); } }, delay);
      timers.add(timer);
      return timer;
    }

    function animate(node, frames, options) {
      if (disposed || isReduced() || !node?.animate) { return null; }
      const animation = node.animate(frames, options);
      animations.add(animation);
      const finish = () => { animations.delete(animation); };
      animation.onfinish = finish;
      animation.oncancel = finish;
      return animation;
    }

    function ensureOverlay() {
      if (!doc?.body || disposed) { return null; }
      if (!overlay?.isConnected) {
        overlay = doc.createElement('div');
        overlay.className = 'ce-action-layer';
        overlay.setAttribute('aria-hidden', 'true');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:10031;overflow:hidden;pointer-events:none;contain:strict;';
        doc.body.appendChild(overlay);
      }
      return overlay;
    }

    function transient(node, duration) {
      const host = ensureOverlay();
      if (!host) { return false; }
      while (transients.size >= motionPolicy(isReduced()).maxTransientNodes) {
        const oldest = transients.values().next().value;
        oldest.remove();
        transients.delete(oldest);
      }
      transients.add(node);
      host.appendChild(node);
      later(() => { node.remove(); transients.delete(node); }, duration);
      return true;
    }

    function bubble(index, type, customText) {
      const target = seat(index);
      if (!target || !doc || disposed) { return; }
      let node = bubbles.get(index)?.node;
      if (!node?.isConnected) {
        node = doc.createElement('span');
        node.className = 'ce-speech';
        node.setAttribute('aria-hidden', 'true');
        target.appendChild(node);
      }
      const previous = bubbles.get(index);
      if (previous) { clearTimeout(previous.timer); timers.delete(previous.timer); }
      node.textContent = customText || speechFor(type, index);
      node.dataset.reaction = type;
      target.dataset.reaction = type;
      const timer = later(() => {
        node.remove();
        delete target.dataset.reaction;
        bubbles.delete(index);
      }, motionPolicy(isReduced()).speechDuration);
      bubbles.set(index, { node, timer, target });
      if (type !== 'thinking' && type !== 'idle') {
        const avatar = target.querySelector?.('.ce-avatar');
        const frames = type === 'skip' || type === 'drawtwo'
          ? [{ transform: 'rotate(0)' }, { transform: 'rotate(-12deg) translateY(3px)', offset: 0.25 }, { transform: 'rotate(10deg)', offset: 0.65 }, { transform: 'rotate(0)' }]
          : [{ transform: 'translateY(0) scale(1)' }, { transform: 'translateY(-9px) scale(1.07)', offset: 0.4 }, { transform: 'translateY(0) scale(1)' }];
        animate(avatar, frames, { duration: motionPolicy(isReduced()).reactionDuration, easing: 'ease-out' });
      }
    }

    function stamp(plan, target) {
      const anchor = stampAnchor(target, root.innerWidth || 390);
      if (!anchor || !doc) { return; }
      const node = doc.createElement('strong');
      node.className = `ce-action-stamp ce-action-${plan.type}`;
      node.textContent = plan.label;
      const { left, top } = anchor;
      node.style.cssText = `position:absolute;left:${left}px;top:${top}px;max-width:150px;text-align:center;transform:translate(-50%,-50%);font:900 ${plan.type === 'skip' ? 30 : 19}px/1.1 'Trebuchet MS',sans-serif;letter-spacing:.06em;color:${plan.color};text-shadow:0 3px 0 #13291f,0 0 18px #000;background:#17382fed;border:2px solid currentColor;border-radius:8px;padding:8px 12px;box-shadow:0 8px 25px #0005;`;
      if (!transient(node, isReduced() ? 1800 : 1300)) { return; }
      animate(node, [
        { transform: 'translate(-50%,-50%) rotate(-8deg) scale(1.6)', opacity: 0 },
        { transform: 'translate(-50%,-50%) rotate(-8deg) scale(1)', opacity: 1, offset: 0.18 },
        { transform: 'translate(-50%,-50%) rotate(-8deg) scale(1)', opacity: 1, offset: 0.76 },
        { transform: 'translate(-50%,-70%) rotate(-8deg) scale(.95)', opacity: 0 }
      ], { duration: 1250, easing: 'ease-out', fill: 'forwards' });
    }

    function reverseOrbit(direction) {
      if (isReduced()) { return; }
      const rect = arena?.getBoundingClientRect?.();
      if (!rect || !doc) { return; }
      const node = doc.createElement('div');
      node.className = 'ce-reverse-orbit';
      const size = Math.min(rect.width - 18, rect.height - 12, 260);
      node.style.cssText = `position:absolute;left:${rect.left + rect.width / 2 - size / 2}px;top:${rect.top + rect.height / 2 - size / 2}px;width:${size}px;height:${size}px;border:2px dashed #ffe7a599;border-radius:50%;color:#ffe7a5;box-shadow:0 0 20px #ffe7a533;`;
      for (const [position, glyph] of [['top:-25px;left:calc(50% - 22px)', direction === 1 ? '➜' : '⬅'], ['bottom:-25px;left:calc(50% - 22px)', direction === 1 ? '⬅' : '➜']]) {
        const arrow = doc.createElement('b');
        arrow.textContent = glyph;
        arrow.style.cssText = `position:absolute;${position};font-size:42px;text-shadow:0 2px 8px #000;`;
        node.appendChild(arrow);
      }
      transient(node, 950);
      animate(node, [{ transform: 'rotate(0deg) scale(.8)', opacity: 0 }, { opacity: 1, offset: 0.15 }, { transform: `rotate(${direction * 175}deg) scale(1.06)`, opacity: 0 }], { duration: 900, easing: 'ease-out', fill: 'forwards' });
    }

    function action(event) {
      if (disposed) { return null; }
      const plan = actionPlan(event, isReduced());
      if (!plan.label) { return plan; }
      bubble(plan.target, event.type, plan.speech);
      announce(`${event.name ? `${event.name}: ` : ''}${plan.label}.`);
      stamp(plan, event.type === 'wild' || event.type === 'reverse' ? pile : seat(plan.target));
      for (let i = 0; i < plan.flightCount; i++) {
        later(() => { if (!isReduced()) { presentation.flyCard?.({ source: deck, target: fan(plan.target) }); } }, i * 145);
      }
      if (event.type === 'reverse') { reverseOrbit(event.direction || 1); }
      if (event.type === 'wild') {
        animate(pile, [{ boxShadow: `0 0 0 0 ${plan.color}00` }, { boxShadow: `0 0 25px 17px ${plan.color}99`, offset: 0.3 }, { boxShadow: `0 0 0 0 ${plan.color}00` }], { duration: 850, easing: 'ease-out' });
      }
      if (event.type === 'win' && event.matchFinished && !isReduced()) { presentation.celebrate?.({ target: event.target || seat(plan.target) }); }
      return plan;
    }

    function setThinking(index) {
      if (disposed || index === thinkingIndex) { return; }
      if (thinkingIndex >= 0) {
        const priorSeat = seat(thinkingIndex);
        if (priorSeat) { delete priorSeat.dataset.thinking; }
        const priorBubble = bubbles.get(thinkingIndex);
        if (priorBubble?.node.dataset.reaction === 'thinking') {
          priorBubble.node.remove();
          clearTimeout(priorBubble.timer);
          timers.delete(priorBubble.timer);
          delete priorBubble.target.dataset.reaction;
          bubbles.delete(thinkingIndex);
        }
      }
      thinkingIndex = index;
      if (index > 0) {
        const target = seat(index);
        if (target) { target.dataset.thinking = 'true'; }
        if (!bubbles.has(index)) { bubble(index, 'thinking'); }
      }
    }

    function settleReceipt(container) {
      const tally = receiptTallies.get(container);
      if (!tally) { return; }
      tally.timers.forEach(timer => { clearTimeout(timer); timers.delete(timer); });
      tally.counter.textContent = `+${tally.total}`;
      receiptTallies.delete(container);
    }

    function renderReceipt(container, receipt) {
      if (!container || !doc || disposed) { return; }
      settleReceipt(container);
      container.replaceChildren();
      container.className = 'ce-receipt';
      container.setAttribute('aria-label', `Scoring receipt: ${receipt.total} points collected from leftover cards`);
      const title = doc.createElement('div');
      title.className = 'ce-receipt-title';
      title.textContent = 'THE DAMAGE RECEIPT';
      container.appendChild(title);
      const visualCards = [];
      for (const row of receipt.rows) {
        const line = doc.createElement('div');
        line.className = 'ce-receipt-row';
        const heading = doc.createElement('div');
        heading.className = 'ce-receipt-name';
        heading.textContent = `${row.name} · ${row.points} pts`;
        const cards = doc.createElement('div');
        cards.className = 'ce-receipt-cards';
        for (const card of row.cards) {
          const node = doc.createElement('span');
          node.className = 'ce-receipt-card';
          node.dataset.red = String(card.suit === 'H' || card.suit === 'D');
          node.textContent = `${card.rank}${SUITS[card.suit] || ''}`;
          node.title = `${card.rank}${SUITS[card.suit] || ''}: ${card.points} points`;
          cards.appendChild(node);
          visualCards.push({ node, card });
        }
        line.append(heading, cards);
        container.appendChild(line);
      }
      const total = doc.createElement('div');
      total.className = 'ce-receipt-total';
      const label = doc.createElement('span');
      label.textContent = 'TOTAL FLUSHED';
      const counter = doc.createElement('strong');
      counter.setAttribute('aria-hidden', 'true');
      counter.textContent = `+${receipt.total}`;
      total.append(label, counter);
      container.appendChild(total);
      if (isReduced() || !visualCards.length) { return; }
      counter.textContent = '+0';
      let tally = 0;
      const pending = { counter, total: receipt.total, timers: new Set() };
      receiptTallies.set(container, pending);
      visualCards.forEach(({ node, card }, index) => {
        const timer = later(() => {
          pending.timers.delete(timer);
          if (!container.isConnected || isReduced()) { settleReceipt(container); return; }
          tally += card.points;
          counter.textContent = `+${tally}`;
          if (!pending.timers.size) { receiptTallies.delete(container); }
          animate(node, [{ transform: 'perspective(180px) rotateY(90deg)', opacity: 0.2 }, { transform: 'perspective(180px) rotateY(0deg)', opacity: 1 }], { duration: 260, easing: 'ease-out' });
          presentation.flyCard?.({ source: node, target: counter, card });
          animate(counter, [{ transform: 'scale(1.14)' }, { transform: 'scale(1)' }], { duration: 180, easing: 'ease-out' });
        }, 250 + index * motionPolicy(false).receiptStep);
        pending.timers.add(timer);
      });
    }

    function stopMotion() {
      receiptTallies.forEach((_, container) => settleReceipt(container));
      animations.forEach(animation => animation.cancel());
      animations.clear();
      transients.forEach(node => node.remove());
      transients.clear();
      presentation.clearEffects?.();
    }

    function clear() {
      timers.forEach(timer => clearTimeout(timer));
      timers.clear();
      stopMotion();
      bubbles.forEach(({ node, target }) => { node.remove(); delete target.dataset.reaction; delete target.dataset.thinking; });
      bubbles.clear();
      const target = seat(thinkingIndex);
      if (target) { delete target.dataset.thinking; }
      thinkingIndex = -1;
    }

    function motionChanged(event) { if (event.matches) { stopMotion(); } }
    if (media?.addEventListener) { media.addEventListener('change', motionChanged); }
    else { media?.addListener?.(motionChanged); }

    function destroy() {
      clear();
      disposed = true;
      overlay?.remove();
      if (media?.removeEventListener) { media.removeEventListener('change', motionChanged); }
      else { media?.removeListener?.(motionChanged); }
    }

    return { action, setThinking, bubble, renderReceipt, clear, destroy };
  }

  root.CrapeightsEffects = Object.freeze({ STATS_KEY, speechFor, motionPolicy, actionPlan, stampAnchor, scoringReceipt, sanitizeStats, readStats, saveStats, recordRound, createController });
})(globalThis);
