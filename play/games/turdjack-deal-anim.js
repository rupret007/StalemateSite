/** Deal-from-shoe flight + hole flip timing (skip when reduced motion). */

/**
 * @param {boolean} reducedMotion
 */
export function useDealFlight(reducedMotion) {
  return !reducedMotion;
}

/**
 * @param {DOMRect} from
 * @param {DOMRect} to
 * @returns {{ dx: number, dy: number, dist: number }}
 */
export function flightDelta(from, to) {
  const fx = from.left + from.width * 0.5;
  const fy = from.top + from.height * 0.3;
  const tx = to.left + to.width * 0.5;
  const ty = to.top + to.height * 0.5;
  const dx = fx - tx;
  const dy = fy - ty;
  const dist = Math.hypot(dx, dy);
  return { dx, dy, dist };
}

/**
 * @param {number} dist
 * @param {boolean} reducedMotion
 */
export function dealFlightDurationMs(dist, reducedMotion) {
  if (reducedMotion) {return 0;}
  return Math.min(320, Math.max(180, 160 + dist * 0.22));
}

/**
 * @param {number} reducedMotion
 */
export function dealerRevealPauseMs(reducedMotion) {
  return reducedMotion ? 0 : 520;
}
