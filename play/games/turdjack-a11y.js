/**
 * Screen-reader announcements and dealer pacing helpers (unit-tested).
 */

/**
 * @param {number} reducedMotion
 */
export function dealerHitDelayMs(reducedMotion) {
  return reducedMotion ? 0 : 340;
}

/**
 * @param {Document | { getElementById: (id: string) => { textContent?: string } | null }} doc
 * @param {string} message
 */
export function announceLive(doc, message) {
  const text = String(message || '').trim();
  if (!text) {return;}
  const live = doc.getElementById('jackLiveRegion');
  if (live) {live.textContent = text;}
}

/**
 * @param {number} dealerTotal
 */
export function dealerRevealAnnouncement(dealerTotal) {
  return `Dealer reveals hole. Dealer shows ${dealerTotal}.`;
}

/**
 * @param {number} dealerTotal
 */
export function dealerHitAnnouncement(dealerTotal) {
  if (dealerTotal > 21) {return `Dealer busts at ${dealerTotal}.`;}
  return `Dealer hits. Dealer total ${dealerTotal}.`;
}

/**
 * @param {string} statusText
 */
export function roundResultAnnouncement(statusText) {
  const t = String(statusText || '').trim();
  if (!t) {return '';}
  return `Round result. ${t}`;
}
