/**
 * Responsive layout helpers for Crapjack table chrome (unit-tested).
 */

/**
 * Felt bet circle overlaps the card lane on phones during a live hand; hide it then.
 * @param {boolean} roundActive
 * @param {number} viewportWidth
 */
export function showFeltBetCircle(roundActive, viewportWidth) {
  const w = Number.isFinite(viewportWidth) ? viewportWidth : 1280;
  if (!roundActive) {return true;}
  return w > 980;
}

/**
 * Big total badges replace the score pill on narrow viewports.
 * @param {number} viewportWidth
 */
export function showHandScorePill(viewportWidth) {
  const w = Number.isFinite(viewportWidth) ? viewportWidth : 1280;
  return w > 980;
}

/**
 * @param {number} viewportWidth
 */
export function useCompactSeatTitles(viewportWidth) {
  const w = Number.isFinite(viewportWidth) ? viewportWidth : 1280;
  return w <= 680;
}

/**
 * Short/narrow phones: collapse chrome and keep the felt in view during a live hand.
 * @param {number} viewportWidth
 * @param {number} viewportHeight
 * @param {boolean} roundActive
 */
export function useTableFirstPlayLayout(viewportWidth, viewportHeight, roundActive) {
  if (!roundActive) {return false;}
  const w = Number.isFinite(viewportWidth) ? viewportWidth : 1280;
  const h = Number.isFinite(viewportHeight) ? viewportHeight : 900;
  if (w <= 390) {return true;}
  if (w <= 680 && h <= 740) {return true;}
  return false;
}

/**
 * Between hands on phones: keep only live bankroll/bet tiles in the main HUD (session stats stay in Table Menu).
 * @param {number} viewportWidth
 * @param {boolean} roundActive
 */
export function useCompactBetweenHandsHud(viewportWidth, roundActive) {
  if (roundActive) {return false;}
  const w = Number.isFinite(viewportWidth) ? viewportWidth : 1280;
  return w <= 390;
}

/**
 * @param {boolean} reducedMotion
 * @returns {'instant' | 'auto'}
 */
export function playFocusScrollBehavior(reducedMotion) {
  return reducedMotion ? 'instant' : 'auto';
}
