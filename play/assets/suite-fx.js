/**
 * Canvas/DOM FX: shake, flash, confetti — reduced-motion aware.
 */

import { prefersReducedMotion } from '../games/suite-feel.js';

export const DEFAULT_PARTICLE_CAP = 48;

export function capParticleCount(requested, reducedMotion, cap = DEFAULT_PARTICLE_CAP) {
  const base = Math.max(0, Math.floor(requested || 0));
  if (reducedMotion) return Math.min(base, Math.max(0, Math.floor(cap * 0.15)));
  return Math.min(base, cap);
}

export function shakeIntensity(amount, reducedMotion) {
  const a = Math.max(0, amount || 0);
  if (reducedMotion) return a * 0.2;
  return a;
}

/**
 * @param {HTMLElement | null} root
 * @param {{ reducedMotion?: boolean, particleCap?: number }} options
 */
export function createSuiteFX(root, options = {}) {
  const doc = root && root.ownerDocument ? root.ownerDocument : document;
  const reduced =
    options.reducedMotion !== undefined
      ? options.reducedMotion
      : prefersReducedMotion((q) => (typeof window !== 'undefined' ? window.matchMedia(q) : null));
  const particleCap = options.particleCap ?? DEFAULT_PARTICLE_CAP;
  let shakeTimer = 0;
  let overlay = null;

  function ensureOverlay() {
    if (overlay && overlay.parentNode) return overlay;
    overlay = doc.createElement('div');
    overlay.className = 'suite-fx-flash';
    overlay.setAttribute('aria-hidden', 'true');
    doc.body.appendChild(overlay);
    return overlay;
  }

  return {
    prefersReducedMotion: () => reduced,

    screenShake(target, amount = 6, ms = 280) {
      const el = target || root || doc.body;
      if (!el || !el.classList) return;
      const px = shakeIntensity(amount, reduced);
      if (px < 0.5) return;
      el.classList.remove('suite-shake');
      void el.offsetWidth;
      el.style.setProperty('--suite-shake-px', `${px}px`);
      el.classList.add('suite-shake');
      clearTimeout(shakeTimer);
      shakeTimer = setTimeout(() => {
        el.classList.remove('suite-shake');
      }, ms);
    },

    flash(color = 'rgba(255, 255, 255, 0.35)', ms = 120) {
      if (reduced) return;
      const layer = ensureOverlay();
      layer.style.background = color;
      layer.classList.add('show');
      setTimeout(() => layer.classList.remove('show'), ms);
    },

    confetti(count = 24, origin = { x: 0.5, y: 0.4 }) {
      const n = capParticleCount(count, reduced, particleCap);
      if (!n || !doc.body) return;
      const host = doc.createElement('div');
      host.className = 'suite-fx-confetti-host';
      host.setAttribute('aria-hidden', 'true');
      const vw = doc.documentElement.clientWidth || 320;
      const vh = doc.documentElement.clientHeight || 640;
      const ox = (origin.x ?? 0.5) * vw;
      const oy = (origin.y ?? 0.4) * vh;
      const colors = ['#9effc8', '#ffd76a', '#ff9d74', '#b290ff', '#7ae6ff'];
      for (let i = 0; i < n; i++) {
        const bit = doc.createElement('i');
        bit.className = 'suite-fx-confetti-bit';
        const angle = (Math.PI * 2 * i) / n + Math.random() * 0.4;
        const dist = 40 + Math.random() * 90;
        bit.style.left = `${ox}px`;
        bit.style.top = `${oy}px`;
        bit.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
        bit.style.setProperty('--dy', `${Math.sin(angle) * dist - 30}px`);
        bit.style.background = colors[i % colors.length];
        bit.style.animationDuration = `${0.55 + Math.random() * 0.35}s`;
        host.appendChild(bit);
      }
      doc.body.appendChild(host);
      setTimeout(() => host.remove(), 1200);
    }
  };
}
