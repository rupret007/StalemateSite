/**
 * TurdAnoid Turbo balance logic.
 *
 * These constants and helpers mirror the live tuning inside TurdAnoid.html
 * (single-file game, no build step). If you change balance numbers there,
 * update this module and tests/turdanoid.test.js to match.
 */

export const TURDANOID_BALANCE = {
  ball: {
    baseSpeed: 5.4,
    perLevel: 0.16,
    maxLevelBonus: 3.0
  },
  paddle: {
    baseSpeed: 7.0,
    perLevel: 0.2,
    maxLevelBonus: 4
  },
  drops: {
    lowLevelBase: 0.32,
    lowLevelStep: 0.04, // levels 1-2
    midLevelBase: 0.26,
    midLevelStep: 0.02, // levels 3-8
    lateBase: 0.16,
    lateStep: 0.005, // levels 9+
    lateFloor: 0.12,
    lastStandBricks: 24,
    lastStandBonus: 0.06,
    badPickupMinLevel: 6,
    badPickupChance: 0.12
  },
  levels: {
    winAfterLevel: 30,
    clearBonusBase: 200,
    clearBonusPerLevel: 50
  },
  scoring: {
    brickHitBase: 10,
    brickHitPerLevel: 2,
    brickBreakPerLevel: 5,
    flushBreakPerLevel: 15,
    comboWindowFrames: 105,
    comboHitsPerMultStep: 4,
    comboMultStep: 0.5
  }
};

/**
 * Ball launch speed for a level. Matches newBall() in TurdAnoid.html.
 */
export function computeBallSpeed(level) {
  const b = TURDANOID_BALANCE.ball;
  return b.baseSpeed + Math.min(level * b.perLevel, b.maxLevelBonus);
}

/**
 * Keyboard paddle speed for a level. Matches step() in TurdAnoid.html.
 */
export function computePaddleSpeed(level) {
  const p = TURDANOID_BALANCE.paddle;
  return p.baseSpeed + Math.min(level * p.perLevel, p.maxLevelBonus);
}

/**
 * Chance that a destroyed brick drops a power-up.
 * Matches maybeDrop() in TurdAnoid.html.
 */
export function computeDropChance(level, remainingBricks) {
  const d = TURDANOID_BALANCE.drops;
  let chance;
  if (level <= 2) {
    chance = d.lowLevelBase - (level - 1) * d.lowLevelStep;
  } else if (level <= 8) {
    chance = d.midLevelBase - (level - 2) * d.midLevelStep;
  } else {
    chance = Math.max(d.lateFloor, d.lateBase - (level - 8) * d.lateStep);
  }
  if (remainingBricks < d.lastStandBricks) {
    chance += d.lastStandBonus;
  }
  return chance;
}

/**
 * The 19 power-up types shipped in TurdAnoid.html, with unlock levels,
 * pick weights, and bad-pickup flags.
 */
export const POWERS = [
  // Standard Arkanoid kit (level 1+)
  { t: 'enlarge', unlock: 1, weight: 3 },
  { t: 'slow', unlock: 1, weight: 2 },
  { t: 'catch', unlock: 1, weight: 2 },
  { t: 'multi', unlock: 1, weight: 2 },
  { t: 'life', unlock: 1, weight: 0.6 },
  { t: 'laser', unlock: 1, weight: 2.5 },
  // Themed combat (level 2+)
  { t: 'paper', unlock: 2, weight: 2 },
  { t: 'shield', unlock: 2, weight: 1.4 },
  { t: 'fire', unlock: 2, weight: 1.6 },
  // Creative funny set (level 3-6)
  { t: 'bomb', unlock: 3, weight: 1.4 },
  { t: 'plunger', unlock: 3, weight: 1.6 },
  { t: 'flush', unlock: 4, weight: 1.2 },
  { t: 'hotdog', unlock: 4, weight: 1.5 },
  { t: 'ghost', unlock: 5, weight: 1.3 },
  { t: 'skunk', unlock: 5, weight: 1.4 },
  { t: 'gold', unlock: 6, weight: 1.0 },
  // Bad ones (level 6+)
  { t: 'shrink', unlock: 6, bad: true, weight: 1 },
  { t: 'speed', unlock: 6, bad: true, weight: 1 },
  { t: 'reverse', unlock: 8, bad: true, weight: 0.8 }
];

/**
 * Power-ups available at a given level.
 */
export function unlockedPowers(level, { includeBad = true } = {}) {
  return POWERS.filter((p) => level >= (p.unlock || 1) && (includeBad || !p.bad));
}

/**
 * Whether a destroyed brick should drop a power-up.
 * @param {number} level
 * @param {number} remainingBricks
 * @param {Function} rng - injectable for deterministic tests
 */
export function shouldDropPowerUp(level, remainingBricks, rng = Math.random) {
  return rng() < computeDropChance(level, remainingBricks);
}

/**
 * Weighted power-up selection matching maybeDrop() in TurdAnoid.html:
 * bad pickups never appear before level 6, then 12% of the time.
 * @returns {string|null} power-up type
 */
export function selectPowerUpType(level, rng = Math.random) {
  const d = TURDANOID_BALANCE.drops;
  const pool = unlockedPowers(level);
  const goodPool = pool.filter((p) => !p.bad);
  const badPool = pool.filter((p) => p.bad);
  const pickBad = level >= d.badPickupMinLevel && badPool.length > 0 && rng() < d.badPickupChance;
  const arr = pickBad ? badPool : goodPool;
  if (!arr.length) {
    return null;
  }
  let total = 0;
  for (const p of arr) {
    total += p.weight || 1;
  }
  let roll = rng() * total;
  let picked = arr[0];
  for (const item of arr) {
    roll -= item.weight || 1;
    if (roll <= 0) {
      picked = item;
      break;
    }
  }
  return picked.t;
}

/**
 * Score for a single brick hit. Matches step() in TurdAnoid.html.
 */
export function computeBrickHitScore(level, comboHits, goldActive = false) {
  const s = TURDANOID_BALANCE.scoring;
  const mult =
    (1 + Math.floor(comboHits / s.comboHitsPerMultStep) * s.comboMultStep) * (goldActive ? 2 : 1);
  return Math.round((s.brickHitBase + level * s.brickHitPerLevel) * mult);
}

/**
 * Level-clear bonus. Matches the level-clear block in TurdAnoid.html.
 */
export function computeLevelClearBonus(level) {
  const l = TURDANOID_BALANCE.levels;
  return l.clearBonusBase + level * l.clearBonusPerLevel;
}

/**
 * Destroy bonus for a brick kill. Matches Bomb and other area-kill paths
 * in TurdAnoid.html (Gold Rush doubles the payout).
 */
export function computeBrickBreakScore(level, goldActive = false) {
  const s = TURDANOID_BALANCE.scoring;
  return (goldActive ? 2 : 1) * s.brickBreakPerLevel * level;
}

/**
 * Mega Flush bonus for each bottom-row brick it actually removes.
 * Matches flushDestroyPoints() in TurdAnoid.html (3× destroy, Gold Rush 2×).
 */
export function computeFlushBreakScore(level, goldActive = false) {
  const s = TURDANOID_BALANCE.scoring;
  return (goldActive ? 2 : 1) * s.flushBreakPerLevel * level;
}
