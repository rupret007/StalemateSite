/** Pure input and presentation helpers; none of these change legacy scoring. */

export const INPUT_SETTINGS_KEY = 'turdtrisInputFeel_v1';
export const DEFAULT_INPUT_SETTINGS = Object.freeze({ das: 156, arr: 33, softDrop: 0 });

function finiteNumber(value, fallback) {
  if (value === null || value === '' || typeof value === 'boolean') { return fallback; }
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** A zero softDrop setting retains the original gravity / 15, with a 20ms floor. */
export function normalizeInputSettings(value) {
  const source = value && typeof value === 'object' ? value : {};
  const drop = finiteNumber(source.softDrop, DEFAULT_INPUT_SETTINGS.softDrop);
  return {
    das: Math.round(clamp(finiteNumber(source.das, DEFAULT_INPUT_SETTINGS.das), 60, 300)),
    arr: Math.round(clamp(finiteNumber(source.arr, DEFAULT_INPUT_SETTINGS.arr), 16, 120)),
    softDrop: drop === 0 ? 0 : Math.round(clamp(drop, 20, 150))
  };
}

export function parseInputSettings(serialized) {
  try {
    return normalizeInputSettings(JSON.parse(serialized));
  } catch {
    return { ...DEFAULT_INPUT_SETTINGS };
  }
}

export function softDropInterval(gravityMs, settings = DEFAULT_INPUT_SETTINGS) {
  const gravity = Math.max(1, finiteNumber(gravityMs, 1000));
  const configured = normalizeInputSettings(settings).softDrop;
  return configured || Math.max(20, Math.floor(gravity / 15));
}

/**
 * Preserve the existing three occupied corners rule, including walls and ceiling.
 * Supply lastAction only to override piece.lastActionRotate (e.g. 'rotate'/'move').
 * This deliberately does not introduce a new mini-spin classification or score.
 */
export function detectTSpin({ piece, grid, lastAction, cols, rows }) {
  const rotated = lastAction === undefined
    ? piece && piece.lastActionRotate
    : lastAction === true || lastAction === 'rotate';
  if (!piece || piece.name !== 'T' || !rotated || !Array.isArray(grid)) { return false; }
  const width = cols ?? grid[0]?.length ?? 10;
  const height = rows ?? grid.length;
  let occupied = 0;
  for (const [r, c] of [
    [piece.row, piece.col],
    [piece.row, piece.col + 2],
    [piece.row + 2, piece.col],
    [piece.row + 2, piece.col + 2]
  ]) {
    if (r < 0 || r >= height || c < 0 || c >= width || grid[r]?.[c]) { occupied++; }
  }
  return occupied >= 3;
}

export function isPerfectClear(grid) {
  return Array.isArray(grid) && grid.length > 0 && grid.every((row) =>
    Array.isArray(row) && row.length > 0 && row.every((cell) => !cell));
}

/** Gesture distances use CSS pixels, so thresholds are stable on Retina phones. */
export function classifyGesture({ dx, dy, elapsedMs }) {
  if (![dx, dy, elapsedMs].every(Number.isFinite) || elapsedMs < 0) { return null; }
  const x = Math.abs(dx);
  const y = Math.abs(dy);
  if (x < 18 && y < 18 && elapsedMs <= 250) { return 'rotate'; }
  if (x >= 24 && x > y * 1.15) { return dx < 0 ? 'left' : 'right'; }
  if (y < 26 || y <= x * 1.15) { return null; }
  const flick = y >= 40 && elapsedMs <= 240 && y / Math.max(1, elapsedMs) >= 0.45;
  if (flick) { return 'hardDrop'; }
  return dy > 0 ? 'softDrop' : null;
}

/** Vibration is opt-in to the caller and always disabled for reduced motion. */
export function hapticDuration(kind, reducedMotion = false, enabled = true) {
  if (!enabled || reducedMotion === true || reducedMotion?.matches === true) { return 0; }
  return { move: 5, rotate: 7, softDrop: 4, hardDrop: 18, drop: 18, hold: 9, lock: 10, clear: 18 }[kind] || 0;
}

/** Retain at most one rotate request across a spawn; clear on pause/blur/restart. */
export class RotationBuffer {
  constructor(windowMs = 120) {
    this.windowMs = Math.max(0, finiteNumber(windowMs, 120));
    this.clear();
  }

  queue(direction, now) {
    if ((direction !== -1 && direction !== 1) || !Number.isFinite(now)) { return false; }
    this.pending = { direction, time: now };
    return true;
  }

  consume(now) {
    const pending = this.pending;
    this.clear();
    if (!pending || !Number.isFinite(now)) { return 0; }
    const elapsed = now - pending.time;
    return elapsed >= 0 && elapsed <= this.windowMs ? pending.direction : 0;
  }

  clear() {
    this.pending = null;
  }
}

/** Fresh runs and old continuation snapshots can both initialize safely. */
export function createRunStats(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(['pieces', 'elapsedMs', 'maxCombo', 'tetrises', 'tSpins', 'perfectClears'].map((key) =>
    [key, Math.max(0, Math.floor(finiteNumber(source[key], 0)))]));
}

export function recordLock(stats, { lines = 0, combo = 0, tSpin = false, perfect = false } = {}) {
  const next = createRunStats(stats);
  next.pieces++;
  next.maxCombo = Math.max(next.maxCombo, Math.max(0, finiteNumber(combo, 0)));
  if (lines === 4) { next.tetrises++; }
  if (tSpin) { next.tSpins++; }
  if (perfect && lines > 0) { next.perfectClears++; }
  return next;
}

export function piecesPerSecond(stats) {
  const value = createRunStats(stats);
  return value.elapsedMs > 0 ? value.pieces / (value.elapsedMs / 1000) : 0;
}
