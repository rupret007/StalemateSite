/* Level-clear score tally — lines, easing, timing (testable). */
(function attachTurdanoidTally(root) {
  'use strict';

  function easeOutCubic(t) {
    const x = Math.max(0, Math.min(1, t));
    return 1 - Math.pow(1 - x, 3);
  }

  /**
   * @param {{ level: number, bonus: number, stars: number, bricks: number, maxCombo: number, levelMs: number, lives: number }} snap
   */
  function buildClearTallyLines(snap) {
    const lines = [];
    const level = snap.level || 1;
    lines.push({
      kind: 'points',
      label: `Level ${level} clear`,
      value: snap.bonus || 0
    });
    lines.push({
      kind: 'stat',
      label: 'Bricks smashed',
      value: snap.bricks || 0
    });
    lines.push({
      kind: 'stat',
      label: 'Peak combo',
      value: snap.maxCombo || 0,
      suffix: '×'
    });
    lines.push({
      kind: 'time',
      label: 'Level time',
      ms: Math.max(0, snap.levelMs || 0)
    });
    lines.push({
      kind: 'stars',
      label: 'Lives bonus',
      stars: Math.max(1, Math.min(3, snap.stars || 1)),
      lives: snap.lives || 0
    });
    return lines;
  }

  function formatTallyTime(ms) {
    const sec = Math.floor(ms / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function lineDurationMs(line, reducedMotion) {
    if (reducedMotion) {
      return line.kind === 'points' ? 420 : 280;
    }
    if (line.kind === 'points') {
      return 1100;
    }
    if (line.kind === 'stars') {
      return 700;
    }
    return 520;
  }

  function animatedPoints(line, progress) {
    const target = line.value || 0;
    return Math.round(target * easeOutCubic(progress));
  }

  root.TurdanoidTally = {
    easeOutCubic,
    buildClearTallyLines,
    formatTallyTime,
    lineDurationMs,
    animatedPoints
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
