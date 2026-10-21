/** Daily Dump v1. Pure rules, Chicago dates, replay-validated local persistence. */
import * as Core from './turdomania-core.js';

export const RULES_VERSION = 1;
export const GENERATOR_VERSION = 1;
export const DAILY_RULES = Object.freeze({ level: 'normal', cols: 8, rows: 10, kinds: 4 });
export const ACTIVE_KEY = 'stalemate_daily_dump_active_v1';
export const ACTIVE_PREFIX = 'stalemate_daily_dump_run_v1:';
export const ACTIVE_INDEX_KEY = 'stalemate_daily_dump_index_v1';
export const RESULT_PREFIX = 'stalemate_daily_dump_result_v1:';
export const TIME_ZONE = 'America/Chicago';
const dateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
});

export function challengeDate(now = Date.now()) {
  const parts = dateFormatter.formatToParts(new Date(now));
  const part = (name) => parts.find((p) => p.type === name).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function validDate(date) {
  if (typeof date !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(date)) { return false; }
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

/** First millisecond of the next Chicago date; DST days can be 23 or 25 hours. */
export function nextResetAt(now = Date.now()) {
  const start = Number(new Date(now));
  const current = challengeDate(start);
  let low = start;
  let high = start + 36 * 60 * 60 * 1000;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (challengeDate(mid) === current) { low = mid; } else { high = mid; }
  }
  return high;
}

function hashSeed(value) {
  let seed = 2166136261;
  for (const char of value) { seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0; }
  return seed || 1;
}

export function makeChallenge(date = challengeDate()) {
  if (!validDate(date)) { throw new Error('Invalid Daily Dump date'); }
  const id = `daily-dump:${date}:r${RULES_VERSION}:g${GENERATOR_VERSION}:8x10:4`;
  return Object.freeze({
    id, date, rules: RULES_VERSION, generator: GENERATOR_VERSION,
    ...DAILY_RULES, seed: hashSeed(id)
  });
}

export function validChallenge(value) {
  if (!value || !validDate(value.date)) { return false; }
  const canonical = makeChallenge(value.date);
  return Object.keys(canonical).every((key) => value[key] === canonical[key]);
}

/** Only explicit daily parameters enter daily mode. Invalid links never alter free play. */
export function parseChallengeRequest(params, now = Date.now()) {
  if (!params.has('daily')) { return { requested: false, challenge: null, error: '' }; }
  const raw = params.get('daily');
  const date = raw === 'today' || raw === '1' ? challengeDate(now) : raw;
  let error = '';
  if (params.has('v') && params.get('v') !== String(RULES_VERSION)) {
    error = 'This challenge uses an unavailable rules version. Open today’s Daily Dump instead.';
  } else if (!validDate(date)) {
    error = 'That Daily Dump date is invalid. Open today’s challenge instead.';
  } else if (date > challengeDate(now)) {
    error = 'That Daily Dump has not arrived yet. Open today’s challenge instead.';
  }
  return { requested: true, challenge: error ? null : makeChallenge(date), error };
}

export function createRun(challenge, practice = false) {
  if (!validChallenge(challenge)) { throw new Error('Unsupported Daily Dump rules'); }
  const identity = makeChallenge(challenge.date);
  return {
    v: 1, challenge: identity, practice: Boolean(practice), moves: [],
    state: Core.newGame(DAILY_RULES.level, identity.seed, DAILY_RULES)
  };
}

export function playMove(run, col, row) {
  if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0) { return null; }
  const result = Core.play(run.state, col, row);
  if (!result) { return null; }
  return { ...result, run: { ...run, moves: run.moves.concat([[col, row]]), state: result.state } };
}

/** Serialized boards/scores are never trusted: rebuild from the frozen rules and legal moves. */
export function replayRun(saved) {
  if (!saved || saved.v !== 1 || typeof saved.practice !== 'boolean' || !validChallenge(saved.challenge)
    || !Array.isArray(saved.moves) || saved.moves.length > 40) { return null; }
  let run = createRun(saved.challenge, saved.practice);
  for (const move of saved.moves) {
    if (!Array.isArray(move) || move.length !== 2) { return null; }
    const result = playMove(run, move[0], move[1]);
    if (!result) { return null; }
    run = result.run;
  }
  return run;
}

export function undoPractice(run) {
  if (!run.practice || !run.moves.length) { return null; }
  return replayRun({ ...run, moves: run.moves.slice(0, -1) });
}

export function serializeRun(run) {
  return { v: 1, challenge: run.challenge, practice: run.practice, moves: run.moves };
}

function readJSON(storage, key) {
  let raw;
  try {
    raw = storage.getItem(key);
  } catch { return { value: null, status: 'unavailable' }; }
  if (!raw) { return { value: null, status: 'empty' }; }
  if (raw.length > 30000) { return { value: null, status: 'invalid' }; }
  try { return { value: JSON.parse(raw), status: 'ok' }; }
  catch { return { value: null, status: 'invalid' }; }
}

function writeJSON(storage, key, value) {
  try { storage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

export function loadActive(storage, challenge = null) {
  let saved = readJSON(storage, ACTIVE_KEY);
  if (challenge && (saved.status !== 'ok' || saved.value?.challenge?.id !== challenge.id)) {
    saved = readJSON(storage, ACTIVE_PREFIX + challenge.id);
  }
  if (saved.status !== 'ok') { return { run: null, status: saved.status }; }
  const run = replayRun(saved.value);
  return { run, status: run ? 'ok' : 'invalid' };
}

export function saveActive(storage, run) {
  const previous = loadActive(storage);
  // Preserve an older unfinished daily before updating the hub's latest-run pointer.
  if (previous.run && previous.run.challenge.id !== run.challenge.id
    && !writeJSON(storage, ACTIVE_PREFIX + previous.run.challenge.id, serializeRun(previous.run))) { return false; }
  const saved = serializeRun(run);
  if (!writeJSON(storage, ACTIVE_PREFIX + run.challenge.id, saved)) { return false; }
  const storedIndex = readJSON(storage, ACTIVE_INDEX_KEY).value;
  const dates = Array.isArray(storedIndex) ? storedIndex.filter(validDate).slice(-30) : [];
  if (previous.run) { dates.push(previous.run.challenge.date); }
  dates.push(run.challenge.date);
  // Bound hub discovery without deleting an old dated session a player may still visit.
  const index = [...new Set(dates)].sort().slice(-30);
  if (!writeJSON(storage, ACTIVE_INDEX_KEY, index)) { return false; }
  return writeJSON(storage, ACTIVE_KEY, saved);
}

export function summarize(run, completedAt = null) {
  return {
    challenge: run.challenge, score: run.state.score, moves: run.state.moves,
    left: Core.tileCount(run.state.board), cleared: run.state.cleared,
    practice: run.practice, completedAt
  };
}

export function loadCompletedRun(storage, challenge) {
  const saved = readJSON(storage, RESULT_PREFIX + challenge.id);
  const run = saved.status === 'ok' ? replayRun(saved.value) : null;
  if (!run || run.practice || !run.state.over || run.challenge.id !== challenge.id
    || typeof saved.value.completedAt !== 'string'
    || !Number.isFinite(Date.parse(saved.value.completedAt))) { return null; }
  return { run, completedAt: saved.value.completedAt };
}

export function loadResult(storage, challenge) {
  const completed = loadCompletedRun(storage, challenge);
  return completed ? summarize(completed.run, completed.completedAt) : null;
}

/** Keep the first legal completed run. Local storage is not a competition authority. */
export function recordCompletion(storage, run, now = Date.now()) {
  if (run.practice || !run.state.over) { return { result: null, saved: false }; }
  const existing = loadResult(storage, run.challenge);
  if (existing) { return { result: existing, saved: true }; }
  const verified = replayRun(serializeRun(run));
  if (!verified || !verified.state.over) { return { result: null, saved: false }; }
  const completedAt = new Date(now).toISOString();
  const saved = writeJSON(storage, RESULT_PREFIX + run.challenge.id, { ...serializeRun(verified), completedAt });
  return { result: summarize(verified, completedAt), saved };
}

/** Small hub contract: no DOM, no arbitrary scores, no free-play keys. */
export function readDailyStatus(storage, now = Date.now()) {
  const challenge = makeChallenge(challengeDate(now));
  const result = loadResult(storage, challenge);
  const active = loadActive(storage);
  const todayActive = loadActive(storage, challenge);
  const resumable = (run) => run && !run.practice && !run.state.over;
  const resume = resumable(todayActive.run) ? todayActive.run : resumable(active.run) ? active.run : null;
  const storedIndex = readJSON(storage, ACTIVE_INDEX_KEY).value;
  const dates = Array.isArray(storedIndex) ? storedIndex.filter(validDate).slice(-30) : [];
  if (active.run) { dates.push(active.run.challenge.date); }
  let previous = null;
  for (const date of [...new Set(dates)].sort().reverse()) {
    if (date === challenge.date) { continue; }
    const candidate = loadActive(storage, makeChallenge(date)).run;
    if (resumable(candidate) && !loadResult(storage, candidate.challenge)) { previous = candidate; break; }
  }
  return {
    challenge, result, resume, previous,
    status: result ? 'completed' : resume && resume.challenge.id === challenge.id ? 'continue' : 'new',
    storageStatus: active.status, nextResetAt: nextResetAt(now)
  };
}

/** Keep the current deployment origin and project prefix, including localhost previews. */
export function challengeLink(challenge, gameURL) {
  const url = new globalThis.URL(gameURL);
  if (!/^https?:$/.test(url.protocol) || !validChallenge(challenge)) { throw new Error('Invalid challenge link'); }
  url.hash = '';
  url.search = '';
  url.searchParams.set('daily', challenge.date);
  url.searchParams.set('v', String(challenge.rules));
  return url.href;
}

export function shareText(result, link) {
  return `Stalemate Arcade · The Daily Dump\n${result.challenge.date} · Turdomania · rules v${result.challenge.rules}\n`
    + `${result.practice ? 'Practice: ' : ''}${result.score} points · ${result.moves} pops · `
    + `${result.cleared ? 'board flushed!' : `${result.left} tiles left`}\n${link}`;
}
