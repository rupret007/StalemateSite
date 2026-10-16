/**
 * Seat title copy: full labels for wide layouts, short for narrow (screen reader keeps full).
 */

export const SEAT_LABELS = {
  dealer: { full: 'Dealer (Toilet Boss)', short: 'Dealer' },
  player: { full: 'Player (You + Poop Luck)', short: 'You' },
  split: { full: 'Split Hand (Backup Turd Luck)', short: 'Split' }
};

/**
 * @param {'dealer'|'player'|'split'} seat
 * @param {'full'|'short'} variant
 */
export function seatLabel(seat, variant = 'full') {
  const row = SEAT_LABELS[seat];
  if (!row) {return '';}
  return variant === 'short' ? row.short : row.full;
}

/**
 * @param {'dealer'|'player'|'split'} seat
 */
export function seatAriaLabel(seat) {
  const row = SEAT_LABELS[seat];
  if (!row) {return '';}
  return row.full.replace(/\s*\(/, ', ').replace(/\)/, '');
}
