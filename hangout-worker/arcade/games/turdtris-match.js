import {
  SPRINT_INPUTS, SPRINT_TICK_MS, createSprintBoard, advanceSprint, applySprintInput, validSprintBoard, sprintNext
} from './turdtris-sprint.js';
import { MODES } from './turdtris-modes.js';

export const TURDTRIS_MATCH_VERSION = 1;
export const SPRINT_COUNTDOWN_MS = 3000;
export const SPRINT_LIMIT_MS = MODES.ultra.durationMs;
const cap = SPRINT_LIMIT_MS / SPRINT_TICK_MS;
const seats = ['a', 'b'];
const maxBatch = 6;
const capacity = 12;
const perInput = 2;
const clone = value => globalThis.structuredClone(value);
const mapSeats = fn => Object.fromEntries(seats.map(seat => [seat, fn(seat)]));
const isInt = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9-]{5,80}$/.test(value);

function validCheckpoint(state, id) {
  if (state?.version !== TURDTRIS_MATCH_VERSION || state.id !== id ||
      !isInt(state.seed, 0, 0xffffffff) || !isInt(state.startsAt, 0, Number.MAX_SAFE_INTEGER - SPRINT_LIMIT_MS) ||
      !isInt(state.revision, 0, cap * 4) || !seats.every(seat => validSprintBoard(state.boards?.[seat], cap))) { return false; }
  const tick = state.boards.a.tick;
  if (state.boards.b.tick !== tick || !seats.every(seat => {
    const pace = state.pace?.[seat];
    return isInt(pace?.sequence, 0, state.revision) && isInt(pace.credits, 0, capacity) && isInt(pace.at, 0, tick);
  })) { return false; }
  return state.result === null || ['finish', 'top-out', 'time', 'resign'].includes(state.result?.reason) &&
    (state.result.winner === null || seats.includes(state.result.winner)) && state.result.tick === tick;
}

function rank(a, b) {
  const lead = a.lines - b.lines || a.score - b.score;
  return lead > 0 ? 'a' : lead < 0 ? 'b' : null;
}

function raceResult(boards, target) {
  const { a, b } = boards;
  const aFinish = a.status === 'cleared' ? a.endedTick : Infinity;
  const bFinish = b.status === 'cleared' ? b.endedTick : Infinity;
  const first = Math.min(aFinish, bFinish);
  // Leave the winning tick open to both seats. A later tick cannot steal it.
  if (first < target || first === cap) {
    return { reason: 'finish', tick: first, winner: aFinish === bFinish ? null : aFinish < bFinish ? 'a' : 'b' };
  }
  if (a.status === 'top-out' && b.status === 'top-out') {
    return { reason: 'top-out', tick: Math.max(a.endedTick, b.endedTick), winner: rank(a, b) };
  }
  if (target === cap) { return { reason: 'time', tick: cap, winner: rank(a, b) }; }
  return null;
}

export class TurdtrisMatch {
  #state;

  constructor(id, now, saved = null, seed = globalThis.crypto.getRandomValues(new Uint32Array(1))[0]) {
    if (!validId(id)) { throw new TypeError('Invalid Turdtris match identity'); }
    if (saved && !validCheckpoint(saved, id)) { throw new TypeError('Invalid Turdtris checkpoint'); }
    if (!saved && (!isInt(now, 0, Number.MAX_SAFE_INTEGER - SPRINT_LIMIT_MS - SPRINT_COUNTDOWN_MS) ||
        !isInt(seed, 0, 0xffffffff))) { throw new TypeError('Invalid Turdtris start'); }
    this.#state = saved ? clone(saved) : {
      version: TURDTRIS_MATCH_VERSION, id, seed, startsAt: now + SPRINT_COUNTDOWN_MS, revision: 0, result: null,
      boards: mapSeats(() => createSprintBoard(seed)),
      pace: mapSeats(() => ({ sequence: 0, credits: capacity, at: 0 }))
    };
  }

  static restore(saved) { return new TurdtrisMatch(saved?.id, null, saved, 0); }
  get deadline() {
    const { result, startsAt, boards } = this.#state;
    if (result) { return null; }
    const wins = seats.filter(seat => boards[seat].status === 'cleared').map(seat => boards[seat].endedTick + 1);
    return startsAt + Math.min(cap, ...wins) * SPRINT_TICK_MS;
  }
  checkpoint() { return clone(this.#state); }

  #tick(now) {
    const { startsAt, boards } = this.#state;
    return Math.min(cap, Math.max(boards.a.tick, Math.floor((now - startsAt) / SPRINT_TICK_MS)));
  }

  #at(now) {
    const state = this.#state, target = this.#tick(now);
    const boards = clone(state.boards);
    if (state.result) { return { boards, result: state.result }; }
    for (const seat of seats) { advanceSprint(boards[seat], state.seed, target); }
    const result = raceResult(boards, target);
    if (result && result.tick < target) {
      for (const seat of seats) {
        boards[seat] = clone(state.boards[seat]);
        advanceSprint(boards[seat], state.seed, result.tick);
      }
    }
    return { boards, result };
  }

  #finish(boards, result) {
    this.#state.boards = boards;
    this.#state.result = result;
    this.#state.revision++;
  }

  expire(now) {
    if (this.#state.result) { return false; }
    const { boards, result } = this.#at(now);
    if (!result) { return false; }
    this.#finish(boards, result);
    return true;
  }

  command(seat, frame, now) {
    const state = this.#state;
    if (!seats.includes(seat)) { return { ok: false, reason: 'unavailable' }; }
    if (frame?.id !== state.id || frame.version !== TURDTRIS_MATCH_VERSION) { return { ok: false, reason: 'match-changed' }; }
    const { boards, result } = this.#at(now);
    if (result) {
      const changed = !state.result;
      if (changed) { this.#finish(boards, result); }
      return { ok: false, reason: 'finished', changed };
    }
    const board = boards[seat];
    if (frame.action === 'resign') {
      this.#finish(boards, { reason: 'resign', tick: board.tick, winner: seat === 'a' ? 'b' : 'a' });
      return { ok: true };
    }
    if (frame.action !== 'input') { return { ok: false, reason: 'unknown-action' }; }
    if (now < state.startsAt) { return { ok: false, reason: 'countdown' }; }
    if (board.status !== 'playing') { return { ok: false, reason: 'board-finished' }; }
    const pace = state.pace[seat];
    if (frame.sequence !== pace.sequence + 1) { return { ok: false, reason: 'sequence' }; }
    if (!Array.isArray(frame.inputs) || !frame.inputs.length || frame.inputs.length > maxBatch ||
        !frame.inputs.every(input => SPRINT_INPUTS.includes(input))) { return { ok: false, reason: 'invalid-input' }; }
    const credits = Math.min(capacity, pace.credits + board.tick - pace.at) - frame.inputs.length * perInput;
    if (credits < 0) { return { ok: false, reason: 'input-paced' }; }
    for (const input of frame.inputs) { applySprintInput(board, state.seed, input); }
    state.pace[seat] = { sequence: frame.sequence, credits, at: board.tick };
    const after = raceResult(boards, board.tick);
    if (after) { this.#finish(boards, after); }
    else { state.boards = boards; state.revision++; }
    return { ok: true };
  }

  view(seat, now) {
    const { id, seed, startsAt, revision, result, pace } = this.#state;
    const { boards } = this.#at(now);
    const phase = result ? 'finished' : now < startsAt ? 'countdown' : 'play';
    return {
      version: TURDTRIS_MATCH_VERSION, game: 'turdtris', id, revision, seed, startsAt, at: now,
      endsAt: startsAt + SPRINT_LIMIT_MS, phase, result: result ? { ...result } : null,
      boards: mapSeats(position => {
        const board = boards[position];
        return { grid: board.grid.map(row => row.map(cell => cell || '.').join('')), piece: board.piece,
          lines: board.lines, score: board.score, status: board.status };
      }),
      self: seats.includes(seat) ? { board: boards[seat], sequence: pace[seat].sequence,
        next: sprintNext(seed, boards[seat].cursor) } : null
    };
  }
}
