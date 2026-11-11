import { createBoard, findGroup, popGroup, newGame, play, tileCount } from './turdomania-core.js';

export const TURDOMANIA_DUEL_VERSION = 1;
export const DUEL_COUNTDOWN_MS = 3000;
export const DUEL_DURATION_MS = 90000;
export const DUEL_DIMS = Object.freeze({ cols: 6, rows: 6 });
const kinds = 3;
const tiles = DUEL_DIMS.cols * DUEL_DIMS.rows;
const seats = ['a', 'b'];
const mapSeats = fn => Object.fromEntries(seats.map(seat => [seat, fn(seat)]));
const clone = value => globalThis.structuredClone(value);
const int = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9-]{5,80}$/.test(value);

// Count distinct states, not tile identities. Gravity and future groups depend
// on the arrangement of kinds, so paths reaching the same arrangement converge.
export function findDuelSolution(initial, nodeLimit = 300) {
  const seen = new Set();
  function search(board) {
    if (!board.length) { return []; }
    if (seen.size >= nodeLimit) { return null; }
    const key = board.map(col => col.map(tile => tile.kind).join('')).join('/');
    if (seen.has(key)) { return null; }
    seen.add(key);
    const counts = Array(kinds).fill(0);
    for (const col of board) { for (const tile of col) { counts[tile.kind]++; } }
    if (counts.includes(1)) { return null; }
    const visited = new Set(), groups = [];
    for (const [col, stack] of board.entries()) {
      for (const [row, tile] of stack.entries()) {
        if (visited.has(tile.id)) { continue; }
        const group = findGroup(board, col, row);
        for (const [c, r] of group) { visited.add(board[c][r].id); }
        if (group.length > 1) { groups.push({ col, row, id: tile.id, size: group.length }); }
      }
    }
    groups.sort((a, b) => b.size - a.size);
    for (const { col, row, id } of groups) {
      if (seen.size >= nodeLimit) { break; }
      const next = search(popGroup(board, col, row).board);
      if (next) { return [id, ...next]; }
    }
    return null;
  }
  return search(initial);
}

export function pickDuelSeed(seed) {
  for (let offset = 0; offset < 4; offset++) {
    const candidate = ((seed + offset) >>> 0) || 1;
    const solution = findDuelSolution(createBoard(DUEL_DIMS.cols, DUEL_DIMS.rows, kinds, candidate));
    if (solution && solution.length >= 5) { return candidate; }
  }
  return 1; // Fixed, independently verified solvable fallback.
}

export function locateDuelTile(board, id) {
  for (const [col, stack] of board.entries()) {
    const row = stack.findIndex(tile => tile.id === id);
    if (row >= 0) { return [col, row]; }
  }
  return null;
}

function pop(state, id) {
  const cell = locateDuelTile(state.board, id);
  if (!cell) { return null; }
  const move = play(state, ...cell);
  return move ? { ...move.state, history: [] } : null;
}

function replay(seed, picks) {
  let board = newGame('easy', seed, DUEL_DIMS);
  for (const id of picks) {
    board = pop(board, id);
    if (!board) { throw new TypeError('Illegal Turdomania checkpoint move'); }
  }
  return board;
}

function rank(a, b) {
  const advantage = Number(a.cleared) - Number(b.cleared) || a.score - b.score || tileCount(b.board) - tileCount(a.board);
  return advantage > 0 ? 'a' : advantage < 0 ? 'b' : null;
}

function restoreState(saved, id) {
  if (saved.version !== TURDOMANIA_DUEL_VERSION || saved.id !== id || !int(saved.seed, 1, 0xffffffff) ||
      !int(saved.startsAt, DUEL_COUNTDOWN_MS, Number.MAX_SAFE_INTEGER - DUEL_DURATION_MS) ||
      !seats.every(seat => Array.isArray(saved.picks?.[seat]) && saved.picks[seat].length <= tiles / 2 &&
        saved.picks[seat].every(tile => int(tile, 0, tiles - 1)))) { throw new TypeError('Invalid Turdomania checkpoint'); }
  const boards = mapSeats(seat => replay(saved.seed, saved.picks[seat]));
  const { result } = saved;
  const complete = boards.a.over && boards.b.over;
  if (result === null) {
    if (complete) { throw new TypeError('Missing Turdomania result'); }
  } else {
    const deadline = saved.startsAt + DUEL_DURATION_MS;
    const scored = result?.reason === 'boards' || result?.reason === 'time';
    const valid = scored ? result.winner === rank(boards.a, boards.b) &&
      (result.reason === 'time' ? !complete && result.at === deadline : complete && result.at < deadline)
      : result?.reason === 'resign' && !complete && seats.includes(result.winner) && result.at < deadline;
    if (!valid || !int(result.at, saved.startsAt - DUEL_COUNTDOWN_MS, deadline) ||
        (scored && result.at < saved.startsAt)) { throw new TypeError('Invalid Turdomania result'); }
  }
  return boards;
}

export class TurdomaniaDuel {
  #state;
  #boards;

  constructor(id, now, saved = null, seed = globalThis.crypto.getRandomValues(new Uint32Array(1))[0]) {
    if (!validId(id)) { throw new TypeError('Invalid Turdomania match identity'); }
    if (saved) {
      this.#boards = restoreState(saved, id);
      this.#state = clone(saved);
      return;
    }
    if (!int(now, 0, Number.MAX_SAFE_INTEGER - DUEL_COUNTDOWN_MS - DUEL_DURATION_MS) || !int(seed, 0, 0xffffffff)) {
      throw new TypeError('Invalid Turdomania start');
    }
    const chosen = pickDuelSeed(seed);
    this.#state = { version: TURDOMANIA_DUEL_VERSION, id, seed: chosen, startsAt: now + DUEL_COUNTDOWN_MS,
      picks: mapSeats(() => []), result: null };
    this.#boards = mapSeats(() => replay(chosen, []));
  }

  static restore(saved) { return new TurdomaniaDuel(saved?.id, null, saved, 0); }
  get deadline() { return this.#state.result ? null : this.#state.startsAt + DUEL_DURATION_MS; }
  checkpoint() { return clone(this.#state); }

  expire(now) {
    const deadline = this.deadline;
    if (deadline === null || now < deadline) { return false; }
    this.#state.result = { reason: 'time', at: deadline, winner: rank(this.#boards.a, this.#boards.b) };
    return true;
  }

  command(seat, frame, now) {
    const { id, startsAt, picks } = this.#state;
    if (!seats.includes(seat)) { return { ok: false, reason: 'unavailable' }; }
    if (frame?.id !== id || frame.version !== TURDOMANIA_DUEL_VERSION) { return { ok: false, reason: 'match-changed' }; }
    const changed = this.expire(now);
    if (this.#state.result) { return { ok: false, reason: 'finished', changed }; }
    if (frame.action === 'resign') {
      this.#state.result = { reason: 'resign', at: Math.max(startsAt - DUEL_COUNTDOWN_MS, now), winner: seat === 'a' ? 'b' : 'a' };
      return { ok: true };
    }
    if (frame.action !== 'pop') { return { ok: false, reason: 'unknown-action' }; }
    if (now < startsAt) { return { ok: false, reason: 'countdown' }; }
    const board = this.#boards[seat];
    if (board.over) { return { ok: false, reason: 'board-finished' }; }
    if (frame.move !== board.moves) { return { ok: false, reason: 'stale' }; }
    const next = int(frame.tile, 0, tiles - 1) ? pop(board, frame.tile) : null;
    if (!next) { return { ok: false, reason: 'illegal-group' }; }
    this.#boards[seat] = next;
    picks[seat].push(frame.tile);
    if (this.#boards.a.over && this.#boards.b.over) {
      this.#state.result = { reason: 'boards', at: now, winner: rank(this.#boards.a, this.#boards.b) };
    }
    return { ok: true };
  }

  view(seat, now) {
    const { id, startsAt, result } = this.#state;
    const board = seats.includes(seat) ? this.#boards[seat] : null;
    return {
      version: TURDOMANIA_DUEL_VERSION, game: 'turdomania', id, startsAt, at: now, endsAt: startsAt + DUEL_DURATION_MS,
      phase: result ? 'finished' : now < startsAt ? 'countdown' : 'play', result: result ? { ...result } : null,
      cols: DUEL_DIMS.cols, rows: DUEL_DIMS.rows,
      players: mapSeats(position => {
        const { score, moves, board, over, cleared } = this.#boards[position];
        return { score, moves, left: tileCount(board), over, cleared };
      }),
      self: board ? { board: clone(board.board) } : null,
      boards: !board ? mapSeats(position => clone(this.#boards[position].board)) : null
    };
  }
}
