/**
 * TurdSpades table FX — trick sweep, spades-broken pulse; reduced-motion aware.
 */

/* global requestAnimationFrame */

export function prefersReducedMotion() {
  try {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
  } catch {
    return false;
  }
}

const SEAT_ANCHORS = {
  You: { x: 0.5, y: 0.92 },
  West: { x: 0.12, y: 0.45 },
  North: { x: 0.5, y: 0.08 },
  East: { x: 0.88, y: 0.45 }
};

export function trickSweepDurationMs(reduced) {
  return reduced ? 0 : 480;
}

export function cardFlightDurationMs(reduced) {
  return reduced ? 0 : 280;
}

export function spadesBrokenParticleCount(reduced) {
  return reduced ? 0 : 18;
}

/**
 * @param {HTMLElement} layer fixed overlay inside the table
 * @param {Array<{ seat: string, label: string }>} cards
 * @param {string} winnerSeat
 */
export function runTrickSweep(layer, cards, winnerSeat, options = {}) {
  if (!layer || !Array.isArray(cards) || !cards.length) {
    return Promise.resolve();
  }
  const reduced = options.reduced ?? prefersReducedMotion();
  const duration = trickSweepDurationMs(reduced);
  if (duration === 0) {
    return Promise.resolve();
  }
  const rect = layer.getBoundingClientRect();
  const target = SEAT_ANCHORS[winnerSeat] || SEAT_ANCHORS.You;
  const tx = rect.width * target.x;
  const ty = rect.height * target.y;

  const ghosts = cards.map((card, i) => {
    const el = document.createElement('div');
    el.className = 'ts-sweep-card';
    el.textContent = card.label || '?';
    el.style.left = `${rect.width * 0.5 + (i - 1.5) * 28}px`;
    el.style.top = `${rect.height * 0.42}px`;
    layer.appendChild(el);
    requestAnimationFrame(() => {
      el.style.transition = `transform ${duration}ms cubic-bezier(.25,.9,.3,1), opacity ${duration}ms ease`;
      el.style.transform = `translate(${tx - parseFloat(el.style.left)}px, ${ty - parseFloat(el.style.top)}px) scale(0.35)`;
      el.style.opacity = '0';
    });
    return el;
  });

  return new Promise((resolve) => {
    setTimeout(() => {
      ghosts.forEach((g) => g.remove());
      resolve();
    }, duration + 40);
  });
}

export function pulseSpadesBroken(tableEl, reduced) {
  if (!tableEl) {
    return;
  }
  const motion = reduced ?? prefersReducedMotion();
  tableEl.classList.remove('ts-spades-flash');
  void tableEl.offsetWidth;
  if (!motion) {
    tableEl.classList.add('ts-spades-flash');
    setTimeout(() => tableEl.classList.remove('ts-spades-flash'), 900);
  } else {
    tableEl.classList.add('ts-spades-lit');
    setTimeout(() => tableEl.classList.remove('ts-spades-lit'), 400);
  }
}

const SEAT_ANCHORS_PCT = {
  You: { x: 0.5, y: 0.88 },
  West: { x: 0.1, y: 0.42 },
  North: { x: 0.5, y: 0.1 },
  East: { x: 0.9, y: 0.42 }
};

export function dealAnimationDurationMs(reduced) {
  return reduced ? 0 : 600;
}

/**
 * Deal burst from table center to seat anchors (DOM overlay).
 */
export function runDealAnimation(layer, seatCounts, options = {}) {
  if (!layer || !seatCounts) {
    return Promise.resolve();
  }
  const reduced = options.reduced ?? prefersReducedMotion();
  const duration = dealAnimationDurationMs(reduced);
  if (!duration) {
    return Promise.resolve();
  }
  const rect = layer.getBoundingClientRect();
  const seats = [
    { name: 'North', count: seatCounts.north || 0 },
    { name: 'West', count: seatCounts.west || 0 },
    { name: 'East', count: seatCounts.east || 0 },
    { name: 'You', count: seatCounts.you || 0 }
  ];
  const ghosts = [];
  for (const seat of seats) {
    const anchor = SEAT_ANCHORS_PCT[seat.name] || SEAT_ANCHORS_PCT.You;
    const tx = rect.width * anchor.x;
    const ty = rect.height * anchor.y;
    const n = Math.min(seat.count, 6);
    for (let i = 0; i < n; i++) {
      const el = document.createElement('div');
      el.className = 'ts-sweep-card ts-deal-ghost';
      el.textContent = '\u2660';
      el.style.left = `${rect.width * 0.5}px`;
      el.style.top = `${rect.height * 0.45}px`;
      layer.appendChild(el);
      ghosts.push(el);
      const delay = i * 28 + seats.indexOf(seat) * 40;
      setTimeout(() => {
        el.style.transition = `transform ${duration}ms cubic-bezier(.2,.9,.3,1), opacity ${duration}ms ease`;
        el.style.transform = `translate(${tx - rect.width * 0.5}px, ${ty - rect.height * 0.45}px) scale(0.4)`;
        el.style.opacity = '0.15';
      }, delay);
    }
  }
  return new Promise((resolve) => {
    setTimeout(() => {
      ghosts.forEach((g) => g.remove());
      resolve();
    }, duration + 520);
  });
}

/**
 * Fly a played card label from seat to trick well.
 */
export function flyCardToTrick(layer, fromSeat, label, options = {}) {
  if (!layer) {
    return Promise.resolve();
  }
  const reduced = options.reduced ?? prefersReducedMotion();
  const duration = cardFlightDurationMs(reduced);
  if (!duration) {
    return Promise.resolve();
  }
  const rect = layer.getBoundingClientRect();
  const from = SEAT_ANCHORS_PCT[fromSeat] || SEAT_ANCHORS_PCT.You;
  const el = document.createElement('div');
  el.className = 'ts-sweep-card';
  el.textContent = label || '?';
  el.style.left = `${rect.width * from.x}px`;
  el.style.top = `${rect.height * from.y}px`;
  layer.appendChild(el);
  const cx = rect.width * 0.5;
  const cy = rect.height * 0.42;
  requestAnimationFrame(() => {
    el.style.transition = `transform ${duration}ms cubic-bezier(.25,.9,.3,1)`;
    el.style.transform = `translate(${cx - rect.width * from.x}px, ${cy - rect.height * from.y}px) scale(1.05)`;
  });
  return new Promise((resolve) => {
    setTimeout(() => {
      el.remove();
      resolve();
    }, duration + 30);
  });
}

export function spawnSpadeShards(canvas, reduced) {
  const motionReduced = reduced ?? prefersReducedMotion();
  if (!canvas || motionReduced) {
    return;
  }
  const count = spadesBrokenParticleCount(motionReduced);
  if (!count) {
    return;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }
  const w = canvas.width;
  const h = canvas.height;
  const shards = [];
  for (let i = 0; i < count; i++) {
    shards.push({
      x: w * 0.5 + (Math.random() - 0.5) * 80,
      y: h * 0.4 + (Math.random() - 0.5) * 40,
      vx: (Math.random() - 0.5) * 6,
      vy: -2 - Math.random() * 5,
      life: 28 + Math.floor(Math.random() * 18)
    });
  }
  let frame = 0;
  function tick() {
    ctx.clearRect(0, 0, w, h);
    let alive = 0;
    for (const s of shards) {
      if (s.life <= 0) {
        continue;
      }
      alive++;
      s.x += s.vx;
      s.y += s.vy;
      s.vy += 0.18;
      s.life--;
      ctx.fillStyle = 'rgba(180,210,255,0.85)';
      ctx.fillRect(s.x, s.y, 4, 6);
    }
    frame++;
    if (alive > 0 && frame < 60) {
      requestAnimationFrame(tick);
    } else {
      ctx.clearRect(0, 0, w, h);
    }
  }
  requestAnimationFrame(tick);
}
