/**
 * Shared Easy / Normal / Hard tuning for every game in the Turdanoid suite.
 * Normal multipliers are exactly 1 (and lives bonus 0) so shipped balance is unchanged.
 */

export const DIFFICULTY_KEY = 'turdsuite_difficulty_v1';

export const DIFFICULTY_IDS = ['easy', 'normal', 'hard'];

/** @typedef {'easy'|'normal'|'hard'} SuiteDifficultyId */

/**
 * speed — arcade pacing (ball speed, gravity divisor, deal pacing).
 * lives — bonus starting lives / bankroll steps (0 on normal).
 * spawn — power-up / pickup rate multiplier (>1 = more help on easy).
 */
export const SUITE_DIFFICULTY_TUNING = {
  easy: { speed: 0.88, lives: 1, spawn: 1.15 },
  normal: { speed: 1, lives: 0, spawn: 1 },
  hard: { speed: 1.12, lives: -1, spawn: 0.88 }
};

export function normalizeDifficulty(value) {
  const d = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (d === 'easy' || d === 'hard') {
    return d;
  }
  if (d === 'sharp') {
    return 'hard';
  }
  return 'normal';
}

export function getTuning(id) {
  const key = normalizeDifficulty(id);
  return SUITE_DIFFICULTY_TUNING[key];
}

export function safeStorage(storage) {
  try {
    return storage || null;
  } catch {
    return null;
  }
}

export function loadDifficulty(storage) {
  const store = safeStorage(storage);
  if (!store) {
    return 'normal';
  }
  try {
    return normalizeDifficulty(store.getItem(DIFFICULTY_KEY));
  } catch {
    return 'normal';
  }
}

export function saveDifficulty(storage, value) {
  const store = safeStorage(storage);
  if (!store) {
    return false;
  }
  const next = normalizeDifficulty(value);
  try {
    store.setItem(DIFFICULTY_KEY, next);
    return true;
  } catch {
    return false;
  }
}

export function isNormalDifficulty(id) {
  return normalizeDifficulty(id) === 'normal';
}

export function applySpeedMultiplier(base, id) {
  const n = Number(base);
  if (!Number.isFinite(n)) {
    return base;
  }
  if (isNormalDifficulty(id)) {
    return n;
  }
  return n * getTuning(id).speed;
}

/** Lower gravity interval (ms) = faster fall; easy lengthens the interval. */
export function applyGravityMs(baseMs, id) {
  const n = Number(baseMs);
  if (!Number.isFinite(n)) {
    return baseMs;
  }
  if (isNormalDifficulty(id)) {
    return n;
  }
  return Math.max(1, Math.round(n / getTuning(id).speed));
}

export function applySpawnMultiplier(base, id) {
  const n = Number(base);
  if (!Number.isFinite(n)) {
    return base;
  }
  if (isNormalDifficulty(id)) {
    return n;
  }
  return n * getTuning(id).spawn;
}

export function applyStartingLives(baseLives, id) {
  const n = Math.floor(Number(baseLives));
  if (!Number.isFinite(n)) {
    return baseLives;
  }
  if (isNormalDifficulty(id)) {
    return n;
  }
  return Math.max(1, n + getTuning(id).lives);
}

export function applyBankrollBonus(baseBankroll, id, step = 200) {
  const n = Number(baseBankroll);
  if (!Number.isFinite(n)) {
    return baseBankroll;
  }
  if (isNormalDifficulty(id)) {
    return n;
  }
  return Math.max(0, n + getTuning(id).lives * step);
}

/**
 * Map suite difficulty to per-game bot labels.
 * @param {SuiteDifficultyId} id
 * @param {'sharp'|'hard'} hardFlavor
 */
export function mapCardAiDifficulty(id, hardFlavor = 'sharp') {
  const level = normalizeDifficulty(id);
  if (level === 'hard') {
    return hardFlavor === 'hard' ? 'hard' : 'sharp';
  }
  return level;
}
