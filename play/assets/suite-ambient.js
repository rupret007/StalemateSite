/**
 * Extra sewer backdrop depth (parallax layers + occasional critters).
 * CSS transforms only; honours reduced motion and pauses when tab hidden.
 */

export function prefersReducedMotion(doc = document) {
  try {
    return !!doc.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * @param {boolean} hidden document.hidden
 * @param {boolean} reduced prefers-reduced-motion
 */
export function shouldRunAmbientMotion(hidden, reduced) {
  if (reduced) return false;
  if (hidden) return false;
  return true;
}

export const CRITTER_TYPES = ['rat', 'duck'];

/**
 * @param {number} seed 0..1
 */
export function pickCritterType(seed) {
  const n = Number(seed);
  if (!Number.isFinite(n)) return CRITTER_TYPES[0];
  return CRITTER_TYPES[Math.abs(Math.floor(n * CRITTER_TYPES.length)) % CRITTER_TYPES.length];
}

/**
 * @param {HTMLElement} bgRoot .suite-bg element
 * @param {{ reduced?: boolean, hidden?: boolean }} state
 */
export function syncAmbientMotionState(bgRoot, state) {
  if (!bgRoot) return;
  const run = shouldRunAmbientMotion(!!state.hidden, !!state.reduced);
  bgRoot.classList.toggle('suite-bg-paused', !run);
  bgRoot.classList.toggle('suite-bg-static', !!state.reduced);
}

/**
 * @param {ParentNode} bgRoot
 */
export function ensureAmbientDepthLayers(bgRoot) {
  if (!bgRoot || bgRoot.querySelector('.suite-bg-parallax-far')) return;
  const far = document.createElement('div');
  far.className = 'suite-bg-parallax-far';
  far.setAttribute('aria-hidden', 'true');
  const near = document.createElement('div');
  near.className = 'suite-bg-parallax-near';
  near.setAttribute('aria-hidden', 'true');
  const tiles = bgRoot.querySelector('.suite-bg-tiles');
  if (tiles && tiles.nextSibling) {
    bgRoot.insertBefore(far, tiles.nextSibling);
    bgRoot.insertBefore(near, far.nextSibling);
  } else {
    bgRoot.appendChild(far);
    bgRoot.appendChild(near);
  }
}

/**
 * @param {ParentNode} bgRoot
 * @param {number} count max critters on screen
 */
export function ensureAmbientCritters(bgRoot, count = 2) {
  if (!bgRoot) return;
  const existing = bgRoot.querySelectorAll('.suite-bg-critter').length;
  for (let i = existing; i < count; i++) {
    const el = document.createElement('span');
    el.className = 'suite-bg-critter';
    el.setAttribute('aria-hidden', 'true');
    const type = pickCritterType((i + 1) * 0.37);
    el.dataset.critter = type;
    el.style.setProperty('--critter-delay', `${-12 - i * 19}s`);
    el.style.setProperty('--critter-lane', `${18 + i * 34}%`);
    bgRoot.appendChild(el);
  }
}

/**
 * @param {Document} doc
 */
export function enhanceAmbientBackground(doc) {
  const bg = doc.querySelector('.suite-bg');
  if (!bg) return () => {};
  ensureAmbientDepthLayers(bg);
  ensureAmbientCritters(bg, 2);
  const reduced = prefersReducedMotion(doc);
  const apply = () => {
    syncAmbientMotionState(bg, { reduced, hidden: !!doc.hidden });
  };
  apply();
  const onVis = () => apply();
  doc.addEventListener('visibilitychange', onVis);
  let mq;
  try {
    mq = doc.defaultView?.matchMedia('(prefers-reduced-motion: reduce)');
    if (mq && typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', apply);
    } else if (mq && typeof mq.addListener === 'function') {
      mq.addListener(apply);
    }
  } catch {
    /* ignore */
  }
  return () => {
    doc.removeEventListener('visibilitychange', onVis);
    if (mq && typeof mq.removeEventListener === 'function') {
      mq.removeEventListener('change', apply);
    } else if (mq && typeof mq.removeListener === 'function') {
      mq.removeListener(apply);
    }
  };
}
