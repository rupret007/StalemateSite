/** Canvas table FX — confetti / flash; respects reduced motion. */

const PALETTES = {
  win: ['#ffd76a', '#8effc2', '#ffe08d', '#ffffff'],
  blackjack: ['#ffd76a', '#ff7ab6', '#8effc2', '#ffffff'],
  bust: ['#ff6f6f', '#ff8f8f', '#4a1010'],
  push: ['#ffbf7a', '#b8d7ca']
};

/**
 * @param {boolean} reducedMotion
 */
export function fxParticleBudget(reducedMotion) {
  return reducedMotion ? 8 : 36;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ reducedMotion?: boolean }} options
 */
export function createTableFx(canvas, options = {}) {
  let reducedMotion = !!options.reducedMotion;
  const particles = [];
  let raf = 0;
  let shaking = false;

  const ctx = canvas.getContext('2d');

  function resize() {
    const parent = canvas.parentElement;
    if (!parent) {return;}
    const rect = parent.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function spawnBurst(kind) {
    const colors = PALETTES[kind] || PALETTES.win;
    const budget = fxParticleBudget(reducedMotion);
    const w = canvas.clientWidth || 300;
    const h = canvas.clientHeight || 200;
    const cx = w * 0.5;
    const cy = h * 0.42;
    for (let i = 0; i < budget; i++) {
      const angle = (Math.PI * 2 * i) / budget + Math.random() * 0.4;
      const speed = reducedMotion ? 1.2 + Math.random() * 1.5 : 2.5 + Math.random() * 4.5;
      particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (reducedMotion ? 0.5 : 2),
        life: reducedMotion ? 0.45 : 0.9 + Math.random() * 0.4,
        age: 0,
        r: reducedMotion ? 2 : 2 + Math.random() * 3,
        color: colors[i % colors.length]
      });
    }
    if (!raf) {raf = globalThis.requestAnimationFrame(tick);}
  }

  function tick(ts) {
    raf = 0;
    const last = tick._last || ts;
    const dt = Math.min(0.05, (ts - last) / 1000);
    tick._last = ts;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age += dt;
      if (p.age >= p.life) {
        particles.splice(i, 1);
        continue;
      }
      p.vy += 6 * dt;
      p.x += p.vx;
      p.y += p.vy;
      const alpha = 1 - p.age / p.life;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (particles.length) {raf = globalThis.requestAnimationFrame(tick);}
  }

  function burstFromStatus(text) {
    const t = String(text || '').toLowerCase();
    if (!t) {return;}
    if (t.includes('blackjack') && !t.includes('dealer')) {
      spawnBurst('blackjack');
      return;
    }
    if (t.includes('bust') && !t.includes('dealer bust')) {
      spawnBurst('bust');
      return;
    }
    if (t.includes('push')) {
      spawnBurst('push');
      return;
    }
    if (t.includes('beats dealer') || t.includes('paid') || t.includes('dealer bust')) {
      spawnBurst('win');
    }
  }

  function shakeTable(tableEl) {
    if (reducedMotion || !tableEl || shaking) {return;}
    shaking = true;
    tableEl.classList.add('table-shake');
    tableEl.addEventListener(
      'animationend',
      () => {
        tableEl.classList.remove('table-shake');
        shaking = false;
      },
      { once: true }
    );
  }

  function setReducedMotion(next) {
    reducedMotion = !!next;
  }

  resize();
  return { resize, burstFromStatus, shakeTable, setReducedMotion, spawnBurst };
}
