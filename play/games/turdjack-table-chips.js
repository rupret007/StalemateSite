/** Felt bet circle chip stacks (denominations match turdjack-chips). */

import { breakBetIntoChipClasses } from './turdjack-chips.js';

/**
 * @param {number} amount
 * @param {number} maxChips
 * @returns {string}
 */
export function buildFeltChipStackHtml(amount, maxChips = 8) {
  const stack = breakBetIntoChipClasses(amount, maxChips);
  if (!stack.length) {return '';}
  return stack
    .map((c, i) => `<span class="felt-chip ${c}" style="--stack-i:${i}"></span>`)
    .join('');
}

/**
 * @param {number} amount
 * @returns {string}
 */
export function feltBetLabel(amount) {
  const n = Number.isFinite(amount) ? amount : 0;
  return n > 0 ? `$${n.toLocaleString()}` : 'Bet';
}
