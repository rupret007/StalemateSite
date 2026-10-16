/** Chip payout / sweep cues from round status text (reduced-motion skips animation in page kit). */

/**
 * @param {string} statusText
 * @returns {'pay'|'sweep'|null}
 */
export function chipSettlementKind(statusText) {
  const t = String(statusText || '').toLowerCase();
  if (!t) {return null;}

  if (t.includes('insurance hit') || t.includes('even money locked')) {return 'pay'; }
  if (t.includes('blackjack! paid') || (t.includes('blackjack') && t.includes('paid'))) {return 'pay'; }

  const winHits = (t.match(/beats dealer|dealer bust|wins \$/g) || []).length;
  const lossHits = (t.match(/loses to dealer|got flushed|surrender accepted/g) || []).length;
  const bustHits = (t.match(/\bbusts\b/g) || []).length;

  if (winHits > lossHits) {return 'pay'; }
  if (lossHits > winHits) {return 'sweep'; }
  if (bustHits > 0 && winHits === 0) {return 'sweep'; }
  if (t.includes('dealer blackjack')) {return 'sweep'; }

  return null;
}

/**
 * @param {boolean} reducedMotion
 * @param {'pay'|'sweep'|null} kind
 */
export function shouldAnimateChipSettlement(reducedMotion, kind) {
  return !reducedMotion && (kind === 'pay' || kind === 'sweep');
}
