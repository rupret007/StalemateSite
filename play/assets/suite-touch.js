/**
 * Mobile touch policy for the suite.
 * iOS double-tap zoom is prevented via CSS `touch-action: manipulation`
 * (see `.suite-no-zoom` in turdsuite.css). We intentionally do NOT call
 * `preventDefault()` on rapid touchend — that cancelled the synthesized click
 * on quick second taps (Turdtris, card buttons, chips).
 */

const ROOT_TOUCH_CLASS = 'suite-touch-manipulation';

/**
 * @param {Document} doc
 */
export function ensureTouchManipulationOnRoot(doc) {
  if (!doc?.documentElement) return;
  doc.documentElement.classList.add(ROOT_TOUCH_CLASS);
}

/**
 * Legacy double-tap guard always returned true in round 0–3 and blocked clicks.
 * Kept for tests documenting the removed behaviour.
 */
export function shouldPreventDefaultOnRapidTouchEnd() {
  return false;
}

/**
 * @param {Document} doc
 */
export function installSuiteTouchPolicy(doc) {
  if (!doc || doc.__suiteTouchPolicyInstalled) return;
  Object.defineProperty(doc, '__suiteTouchPolicyInstalled', { value: true, configurable: true });
  ensureTouchManipulationOnRoot(doc);
}
