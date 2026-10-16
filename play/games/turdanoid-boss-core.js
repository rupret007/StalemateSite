/* Boss Flush — Sewer King patterns (opt-in mode; scoring uses turdanoid_boss_best_v1). */
(function attachTurdanoidBoss(root) {
  'use strict';

  const BOSS_BEST_KEY = 'turdanoid_boss_best_v1';
  const MAX_HP = 120;

  function phaseForHp(hp, maxHp) {
    const ratio = hp / Math.max(1, maxHp || MAX_HP);
    if (ratio > 0.66) {
      return 1;
    }
    if (ratio > 0.33) {
      return 2;
    }
    return 3;
  }

  /** Frames between sludge drops; lower = harder. */
  function sludgeIntervalFrames(phase) {
    if (phase >= 3) {
      return 42;
    }
    if (phase === 2) {
      return 58;
    }
    return 78;
  }

  function sludgeDamage(phase) {
    return phase >= 3 ? 2 : 1;
  }

  function bossHitScore(phase) {
    return 80 + phase * 40;
  }

  root.TurdanoidBoss = {
    BOSS_BEST_KEY,
    MAX_HP,
    phaseForHp,
    sludgeIntervalFrames,
    sludgeDamage,
    bossHitScore
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
