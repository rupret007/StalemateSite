/** Lightweight attract-mode falling-piece simulation (canvas/CSS pixel coords). */

const PIECES = {
  I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
  O: [[1, 1], [1, 1]],
  T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
  S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
  Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
  J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
  L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]]
};

const LETTERS = Object.keys(PIECES);

export function createAttractField(width, height, reducedMotion = false) {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  const pieces = [];
  const maxPieces = reducedMotion ? 6 : 14;

  function spawn() {
    const name = LETTERS[Math.floor(Math.random() * LETTERS.length)];
    const matrix = PIECES[name];
    const block = 12 + Math.floor(Math.random() * 10);
    pieces.push({
      name,
      matrix,
      block,
      x: Math.random() * Math.max(1, w - matrix[0].length * block),
      y: -matrix.length * block - Math.random() * h * 0.4,
      spin: reducedMotion ? 0 : (Math.random() - 0.5) * 0.04,
      angle: Math.random() * Math.PI,
      vy: reducedMotion ? 0.35 + Math.random() * 0.25 : 0.55 + Math.random() * 0.85,
      alpha: 0.18 + Math.random() * 0.22
    });
  }

  while (pieces.length < maxPieces) { spawn(); }

  return {
    width: w,
    height: h,
    reducedMotion: !!reducedMotion,
    resize(nextW, nextH) {
      this.width = Math.max(1, Math.floor(nextW));
      this.height = Math.max(1, Math.floor(nextH));
    },
    step(deltaMs = 16) {
      const dt = Math.min(48, Math.max(1, deltaMs)) / 16;
      for (let i = pieces.length - 1; i >= 0; i--) {
        const p = pieces[i];
        p.y += p.vy * dt * (p.block * 0.55);
        if (!this.reducedMotion) { p.angle += p.spin * dt; }
        if (p.y > this.height + p.block * 4) {
          pieces.splice(i, 1);
          if (pieces.length < maxPieces) { spawn(); }
        }
      }
      while (pieces.length < maxPieces) { spawn(); }
    },
    pieces() {
      return pieces;
    }
  };
}
