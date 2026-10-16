/**
 * Turdtris presentation helpers (FX caps, callouts). Tested here; wired in turdtris.html.
 */

import { TURDTRIS_FEEL } from './suite-feel.js';

export function prefersReducedMotion(mediaQuery) {
  if (!mediaQuery) {return false;}
  if (typeof mediaQuery.matches === 'boolean') {return mediaQuery.matches;}
  return false;
}

export function effectiveShake(amount, mediaQuery) {
  const n = Number(amount) || 0;
  if (n <= 0) {return 0;}
  if (prefersReducedMotion(mediaQuery)) {return Math.min(n, TURDTRIS_FEEL.shakeCapReduced);}
  return n;
}

export function decaySceneShake(shake, decay = TURDTRIS_FEEL.shakeDecayPerFrame) {
  if (shake <= 0) {return 0;}
  const next = shake * decay;
  return next < TURDTRIS_FEEL.shakeEpsilon ? 0 : next;
}

export function sparkCountForClear(baseCount, mediaQuery) {
  const base = Math.max(0, Math.floor(baseCount));
  const max = prefersReducedMotion(mediaQuery)
    ? TURDTRIS_FEEL.maxClearSparksReduced
    : TURDTRIS_FEEL.maxClearSparks;
  return Math.min(base, max);
}

/**
 * @param {{ lines: number, tSpin?: boolean, combo?: number, b2b?: number, perfect?: boolean }} evt
 * @returns {Array<{ text: string, color: string, priority: number }>}
 */
export function buildClearCallouts(evt) {
  const lines = Math.max(0, Math.floor(evt.lines || 0));
  const combo = Math.max(0, Math.floor(evt.combo || 0));
  const b2b = Math.max(0, Math.floor(evt.b2b || 0));
  const out = [];

  if (evt.perfect) {
    out.push({ text: 'PERFECT CLEAR', color: '#8ee8c7', priority: 100 });
  }
  if (evt.tSpin && lines > 0) {
    const label = `T-SPIN ${['', 'SINGLE', 'DOUBLE', 'TRIPLE'][lines] || lines}`;
    out.push({ text: label, color: '#d6a2ff', priority: 90 });
  } else if (lines === 4) {
    out.push({ text: 'TURDTRIS!', color: '#72dbff', priority: 85 });
  } else if (lines === 3) {
    out.push({ text: 'TRIPLE FLUSH', color: '#83f7ae', priority: 70 });
  } else if (lines === 2) {
    out.push({ text: 'DOUBLE SCRUB', color: '#ffe181', priority: 60 });
  }

  if (b2b > 1 && (evt.tSpin || lines === 4)) {
    out.push({ text: `B2B ×${b2b}`, color: '#8ee8c7', priority: 75 });
  }
  if (combo > 1) {
    out.push({ text: `COMBO ×${combo}`, color: '#ffcb87', priority: 50 + Math.min(combo, 8) });
  }

  return out.sort((a, b) => b.priority - a.priority);
}

export function levelUpFlashDurationFrames() {
  return TURDTRIS_FEEL.levelFlashFrames;
}

export function levelUpBannerText(level, mutatorName) {
  const name = mutatorName || 'Warmup Flow';
  return `LEVEL ${level} — ${name}`;
}
