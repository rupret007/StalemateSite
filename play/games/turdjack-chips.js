/** Chip denomination visualization for Crapjack bet HUD. */

export const CHIP_DENOMS = [
  { v: 1000, c: 'c1000' },
  { v: 500, c: 'c500' },
  { v: 100, c: 'c100' },
  { v: 25, c: 'c25' },
  { v: 10, c: 'c10' }
];

/**
 * @param {number} amount
 * @param {number} maxChips
 * @returns {string[]}
 */
export function breakBetIntoChipClasses(amount, maxChips = 12) {
  if (!amount || amount <= 0) {return [];}
  const stack = [];
  let rem = amount;
  for (const d of CHIP_DENOMS) {
    while (rem >= d.v && stack.length < maxChips) {
      stack.push(d.c);
      rem -= d.v;
    }
  }
  return stack;
}

/**
 * @param {number} amount
 * @returns {string}
 */
export function buildChipStackHtml(amount) {
  const stack = breakBetIntoChipClasses(amount);
  if (!stack.length) {return '';}
  return (
    ' <span class="chip-stack">' +
    stack.map((c) => `<span class="chip-vis ${c}"></span>`).join('') +
    '</span>'
  );
}
