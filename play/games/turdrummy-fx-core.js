/* TurdRummy celebration confetti — pure particle math.
   Classic script: attaches TurdRummyFX on globalThis so turdrummy.html can
   use it from a plain <script> tag. games/turdrummy-fx.js re-exports this
   API for unit tests (see games/table-continue-core.js for the same split).

   Only the physics step is here; turdrummy.html owns the canvas draw loop
   and the prefers-reduced-motion gate (no burst is ever created when that
   media query matches). */
(function attachTurdRummyFX(root) {
  'use strict';

  const GRAVITY = 420;
  const DRAG = 0.985;
  const COLORS = ['#9cff73', '#ffd76a', '#ff7ab6', '#7ae6ff', '#ffbf7a', '#8effc2'];

  /**
   * @param {number} count
   * @param {number} cx origin x
   * @param {number} cy origin y
   * @param {() => number} rng returns a float in [0, 1); defaults to Math.random
   */
  function createBurst(count, cx, cy, rng) {
    const rand = rng || Math.random;
    const particles = [];
    const n = Math.max(0, Math.floor(count));
    for (let i = 0; i < n; i += 1) {
      const angle = -Math.PI / 2 + (rand() - 0.5) * Math.PI * 1.1;
      const speed = 140 + rand() * 220;
      particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        rot: rand() * Math.PI * 2,
        vr: (rand() - 0.5) * 10,
        size: 4 + rand() * 4,
        color: COLORS[Math.floor(rand() * COLORS.length)],
        life: 0.7 + rand() * 0.5
      });
    }
    return particles;
  }

  /**
   * Advance particles by dtSeconds; returns the surviving particles (new array).
   * @param {Array<object>} particles
   * @param {number} dtSeconds
   */
  function stepParticles(particles, dtSeconds) {
    const dt = Math.max(0, Math.min(0.05, dtSeconds));
    const next = [];
    for (const p of particles) {
      const life = p.life - dt;
      if (life <= 0) {
        continue;
      }
      const vx = p.vx * DRAG;
      const vy = p.vy * DRAG + GRAVITY * dt;
      next.push({
        x: p.x + vx * dt,
        y: p.y + vy * dt,
        vx,
        vy,
        rot: p.rot + p.vr * dt,
        vr: p.vr,
        size: p.size,
        color: p.color,
        life
      });
    }
    return next;
  }

  root.TurdRummyFX = {
    GRAVITY,
    DRAG,
    COLORS,
    createBurst,
    stepParticles
  };
})(typeof window !== 'undefined' ? window : globalThis);
