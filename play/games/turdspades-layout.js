/**
 * TurdSpades table layout helpers (fan geometry, readable indices).
 */

export function fanTransform(index, total, spreadDeg = 4.2, liftPx = 14) {
  if (total <= 1) {
    return { rotate: 0, ty: 0, z: index };
  }
  const mid = (total - 1) / 2;
  const offset = index - mid;
  const rotate = offset * spreadDeg;
  const ty = -Math.abs(offset) * (liftPx / Math.max(1, total - 1));
  return { rotate, ty, z: index };
}

export function fanStyle(index, total, options = {}) {
  const { rotate, ty, z } = fanTransform(index, total, options.spreadDeg, options.liftPx);
  return `--fan-r:${rotate}deg;--fan-y:${ty}px;--fan-z:${z};z-index:${z}`;
}

/** Side-seat back fan: rotate stack visually toward table center. */
export function sideFanStyle(index, total, side = 'west') {
  const { rotate, ty, z } = fanTransform(index, total, 3.2, 8);
  if (side === 'north') {
    return `--fan-r:${rotate}deg;--fan-y:${ty}px;--fan-z:${z};z-index:${z}`;
  }
  const base = side === 'west' ? -72 : 72;
  return `--fan-r:${base + rotate * 0.35}deg;--fan-y:${ty}px;--fan-z:${z};z-index:${z}`;
}

export function trickEntryPosition(seatName) {
  const map = {
    You: { top: '68%', left: '50%', tx: '-50%', ty: '0' },
    North: { top: '8%', left: '50%', tx: '-50%', ty: '0' },
    West: { top: '42%', left: '14%', tx: '0', ty: '-50%' },
    East: { top: '42%', left: '86%', tx: '-100%', ty: '-50%' }
  };
  return map[seatName] || map.You;
}
