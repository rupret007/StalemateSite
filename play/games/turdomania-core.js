/**
 * Turdomania: a Clickomania / SameGame rules core. Pure functions, no DOM.
 *
 * Board shape: board[col][row], row 0 is the BOTTOM of the column. Each cell
 * is a tile `{ id, kind }` or null. Columns are stored bottom-up so gravity is
 * just "drop the nulls" and the empty-column shift is "drop empty columns".
 */

export const POOP_KINDS = [
  { emoji: '💩', name: 'classic swirl', color: '#8a5a2b' },
  { emoji: '🌽', name: 'corn nugget', color: '#e8c64a' },
  { emoji: '🟢', name: 'green splat', color: '#58c46b' },
  { emoji: '🧻', name: 'paper roll', color: '#e9e4d8' },
  { emoji: '🫘', name: 'bean blast', color: '#c0473c' },
  { emoji: '🧀', name: 'cheese wedge', color: '#f2a93b' }
];

export const LEVELS = {
  easy: { label: 'Squirt', cols: 8, rows: 10, kinds: 3 },
  normal: { label: 'Log', cols: 10, rows: 12, kinds: 4 },
  hard: { label: 'Blowout', cols: 12, rows: 14, kinds: 5 }
};

export const CLEAR_BONUS = 1000;
export const BEST_KEY = 'turdomania_best_v1';
export const PREFS_KEY = 'turdomania_prefs_v1';

/** mulberry32: small deterministic PRNG for seeded boards and tests. */
export function seededRandom(seed) {
  let a = Number(seed) >>> 0 || 1;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createBoard(cols, rows, kinds, seed) {
  const rand = seededRandom(seed);
  const board = [];
  let id = 0;
  for (let c = 0; c < cols; c++) {
    const col = [];
    for (let r = 0; r < rows; r++) {
      col.push({ id: id++, kind: Math.floor(rand() * kinds) });
    }
    board.push(col);
  }
  return board;
}

/** Build a board from kind numbers, given as visual rows TOP first (null = empty). */
export function boardFromRows(rowsTopFirst) {
  const height = rowsTopFirst.length;
  const width = height ? rowsTopFirst[0].length : 0;
  const board = [];
  let id = 0;
  for (let c = 0; c < width; c++) {
    const col = [];
    for (let r = 0; r < height; r++) {
      const kind = rowsTopFirst[height - 1 - r][c];
      col.push(kind === null || kind === undefined ? null : { id: id++, kind });
    }
    board.push(col);
  }
  return board;
}

/** Inverse of boardFromRows, padded to the given height with null. */
export function boardToRows(board, height) {
  const out = [];
  for (let r = height - 1; r >= 0; r--) {
    const line = [];
    for (let c = 0; c < board.length; c++) {
      const cell = board[c][r];
      line.push(cell ? cell.kind : null);
    }
    out.push(line);
  }
  return out;
}

export function cellAt(board, col, row) {
  const column = board[col];
  return column ? column[row] || null : null;
}

/** Flood-fill the 4-neighbour group of the same kind. Returns [[col,row],...]. */
export function findGroup(board, col, row) {
  const start = cellAt(board, col, row);
  if (!start) {return [];}
  const seen = new Set();
  const stack = [[col, row]];
  const out = [];
  while (stack.length) {
    const [c, r] = stack.pop();
    const key = c + ',' + r;
    if (seen.has(key)) {continue;}
    seen.add(key);
    const cell = cellAt(board, c, r);
    if (!cell || cell.kind !== start.kind) {continue;}
    out.push([c, r]);
    stack.push([c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]);
  }
  return out;
}

/** Classic SameGame scoring: (n - 2)^2, so pairs score 0 and big groups pay. */
export function scoreForGroup(n) {
  return n >= 2 ? (n - 2) * (n - 2) : 0;
}

/** Gravity: tiles fall to fill holes. Returns new board (input untouched). */
export function applyGravity(board) {
  return board.map((col) => col.filter(Boolean));
}

/** Empty columns close up: columns to the right slide left. */
export function shiftColumns(board) {
  return board.filter((col) => col.some(Boolean));
}

export function tileCount(board) {
  let n = 0;
  for (const col of board) {for (const cell of col) {if (cell) {n++;}}}
  return n;
}

export function hasMoves(board) {
  for (let c = 0; c < board.length; c++) {
    const col = board[c];
    for (let r = 0; r < col.length; r++) {
      const cell = col[r];
      if (!cell) {continue;}
      const up = cellAt(board, c, r + 1);
      const right = cellAt(board, c + 1, r);
      if ((up && up.kind === cell.kind) || (right && right.kind === cell.kind)) {return true;}
    }
  }
  return false;
}

/**
 * Pop the group at (col,row). Returns null when the tap is not a legal move
 * (empty cell or a lone tile), otherwise { board, removed, points }.
 */
export function popGroup(board, col, row) {
  const group = findGroup(board, col, row);
  if (group.length < 2) {return null;}
  const kill = new Set(group.map(([c, r]) => c + ',' + r));
  const removed = group.map(([c, r]) => board[c][r]);
  const holed = board.map((column, c) =>
    column.map((cell, r) => (kill.has(c + ',' + r) ? null : cell))
  );
  const next = shiftColumns(applyGravity(holed));
  return { board: next, removed, points: scoreForGroup(group.length) };
}

/** Full game state helpers (immutable). */
/**
 * Board size that keeps every tile at least `minCell` px inside `availW` x `availH`.
 * The level's full size is used whenever it fits; narrow phones get fewer columns/rows
 * (never below 6 x 8) with the same kinds, rules and scoring.
 */
export function fitDims(levelKey, availW, availH, minCell = 32) {
  const level = LEVELS[levelKey] || LEVELS.normal;
  const fit = (n, avail, floor) => Math.max(Math.min(n, floor), Math.min(n, Math.floor(avail / minCell)));
  return { cols: fit(level.cols, availW, 6), rows: fit(level.rows, availH, 8) };
}

export function newGame(levelKey = 'normal', seed = Date.now(), dims = null) {
  const level = LEVELS[levelKey] || LEVELS.normal;
  const cols = dims && dims.cols > 0 ? Math.min(level.cols, dims.cols | 0) : level.cols;
  const rows = dims && dims.rows > 0 ? Math.min(level.rows, dims.rows | 0) : level.rows;
  const board = createBoard(cols, rows, level.kinds, seed);
  return {
    level: LEVELS[levelKey] ? levelKey : 'normal',
    seed: Number(seed) >>> 0,
    cols,
    rows,
    board,
    score: 0,
    moves: 0,
    history: [],
    over: !hasMoves(board),
    cleared: false,
    bonus: 0
  };
}

export function play(state, col, row) {
  if (state.over) {return null;}
  const result = popGroup(state.board, col, row);
  if (!result) {return null;}
  const cleared = tileCount(result.board) === 0;
  const bonus = cleared ? CLEAR_BONUS : 0;
  const over = cleared || !hasMoves(result.board);
  return {
    state: {
      ...state,
      board: result.board,
      score: state.score + result.points + bonus,
      moves: state.moves + 1,
      history: state.history.concat([
        { board: state.board, score: state.score, moves: state.moves }
      ]),
      over,
      cleared,
      bonus
    },
    removed: result.removed,
    points: result.points,
    bonus
  };
}

export function undo(state) {
  if (!state.history.length) {return null;}
  const prev = state.history[state.history.length - 1];
  return {
    ...state,
    board: prev.board,
    score: prev.score,
    moves: prev.moves,
    history: state.history.slice(0, -1),
    over: false,
    cleared: false,
    bonus: 0
  };
}

/** Best-score store: { v: 1, best: { easy, normal, hard } } with safe parsing. */
export function readBest(storage) {
  const out = { easy: 0, normal: 0, hard: 0 };
  try {
    const parsed = JSON.parse(storage.getItem(BEST_KEY) || 'null');
    if (parsed && parsed.v === 1 && parsed.best && typeof parsed.best === 'object') {
      for (const k of Object.keys(out)) {
        const n = parseInt(parsed.best[k], 10);
        if (Number.isFinite(n) && n > 0) {out[k] = n;}
      }
    }
  } catch {
    /* corrupt store -> zeros */
  }
  return out;
}

export function recordBest(storage, levelKey, score) {
  const best = readBest(storage);
  if (!(levelKey in best) || !(score > best[levelKey])) {return false;}
  best[levelKey] = Math.floor(score);
  try {
    storage.setItem(BEST_KEY, JSON.stringify({ v: 1, best }));
  } catch {
    return false;
  }
  return true;
}
