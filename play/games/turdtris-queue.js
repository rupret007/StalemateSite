/** Read upcoming 7-bag piece names without mutating the live sequence. */

const PIECE_NAMES = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];

export function normalizePieceName(name) {
  if (typeof name !== 'string') { return null; }
  const upper = name.trim().toUpperCase();
  return PIECE_NAMES.includes(upper) ? upper : null;
}

/**
 * @param {string[]} sequence - live bag stack (next pop is sequence[sequence.length - 1])
 * @param {string|null|undefined} immediateNext - already-drawn next piece name
 * @param {number} limit - how many upcoming labels to return (1–5 typical)
 */
export function peekUpcomingPieceNames(sequence, immediateNext, limit = 5) {
  const cap = Math.max(0, Math.min(5, Math.floor(Number(limit) || 0)));
  if (cap === 0) { return []; }
  const names = [];
  const first = normalizePieceName(immediateNext);
  if (first) { names.push(first); }
  if (!Array.isArray(sequence)) { return names.slice(0, cap); }
  for (let i = sequence.length - 1; i >= 0 && names.length < cap; i--) {
    const piece = normalizePieceName(sequence[i]);
    if (piece) { names.push(piece); }
  }
  return names.slice(0, cap);
}
