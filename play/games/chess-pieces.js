// SPDX-License-Identifier: GPL-3.0-or-later
// Maurizio Monge's Spatial pieces, MIT; configured SVGs are self-hosted.
// Exact art/source pins and modifications: assets/chess/board-vendor-lock.json.
// Rule reminders, not tactical evaluations. The legal-move generator still
// decides which destinations are safe in the current position.
export const PIECE_GUIDE = Object.freeze({
  p: { name: 'Pawn', reminder: 'Pawns move forward into empty squares and capture diagonally.', detail: 'One square toward the far end, or two from its starting square if clear. Captures one square diagonally.' },
  n: { name: 'Knight', reminder: 'Knights jump two squares one way and one across.', detail: 'An L shape: two squares in one direction, then one across. The only piece that can jump over others.' },
  b: { name: 'Bishop', reminder: 'Bishops move diagonally without jumping over pieces.', detail: 'Any distance diagonally, staying on the same square color. Other pieces block its path.' },
  r: { name: 'Rook', reminder: 'Rooks move along a row or column without jumping over pieces.', detail: 'Any distance along a row or column. Other pieces block its path.' },
  q: { name: 'Queen', reminder: 'Queens move straight or diagonally without jumping over pieces.', detail: 'Any distance along a row, column or diagonal. Other pieces block its path.' },
  k: { name: 'King', reminder: 'Kings move one square, or castle when allowed. Keep your king out of check.', detail: 'One square in any direction, always out of attack. Castling is a special move explained below.' }
});
export function pieceSvg(type, color) {
  if (!PIECE_GUIDE[type] || !['w', 'b'].includes(color)) { return ''; }
  const source = new globalThis.URL(`../assets/chess/pieces/spatial-${color}${type}.svg`, import.meta.url).href;
  return `<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false" data-color="${color}"><image href="${source}" width="48" height="48"/></svg>`;
}

export async function loadPieceArtwork() {
  await Promise.all(['w', 'b'].flatMap(color => Object.keys(PIECE_GUIDE).map(type => new Promise((resolve, reject) => {
    const image = new globalThis.Image();
    image.onload = () => image.naturalWidth ? resolve() : reject(new Error('The chess pieces could not load.'));
    image.onerror = () => reject(new Error('The chess pieces could not load.'));
    image.src = new globalThis.URL(`../assets/chess/pieces/spatial-${color}${type}.svg`, import.meta.url).href;
  }))));
}
