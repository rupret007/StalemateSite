/** Optional challenges have isolated records; Classic is always the load default. */
export const MODES = Object.freeze({
  classic: Object.freeze({ id: 'classic', name: 'Classic', bestKey: 'turdtrisHighScore' }),
  sprint: Object.freeze({ id: 'sprint', name: 'Sprint 40L', bestKey: 'turdtrisSprint40BestMs_v1', lineGoal: 40 }),
  ultra: Object.freeze({ id: 'ultra', name: 'Ultra 2:00', bestKey: 'turdtrisUltra120Best_v1', durationMs: 120000 })
});

export function modeDefinition(id) {
  return Object.hasOwn(MODES, id) ? MODES[id] : MODES.classic;
}

export function readModeBest(storage, id) {
  try {
    const raw = storage.getItem(modeDefinition(id).bestKey);
    const value = Number(raw);
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  } catch { return 0; }
}

export function isModeComplete(id, lines, elapsedMs) {
  return id === 'sprint' ? lines >= 40 : id === 'ultra' && elapsedMs >= 120000;
}

export function challengeRecord(id, { score = 0, elapsedMs = 0, completed = false }, previous = 0) {
  if (id === 'sprint') {
    const time = Math.ceil(elapsedMs);
    return completed && time > 0 && (previous === 0 || time < previous) ? time : previous;
  }
  return Math.max(previous, Math.floor(score));
}

export function formatRunTime(milliseconds, tenths = false) {
  const ms = Math.max(0, Number(milliseconds) || 0);
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}${tenths ? `.${Math.floor(ms / 100) % 10}` : ''}`;
}
