import { TETROMINOS, SRS_I, SRS_JLSTZ, rotate, isValidMove, calculateScore } from './turdtris_logic.js';
import { detectTSpin, isPerfectClear } from './turdtris-presentation.js';
import { MODES } from './turdtris-modes.js';

export const SPRINT_TICK_MS = 20;
export const SPRINT_LINE_GOAL = MODES.sprint.lineGoal;
export const SPRINT_COLS = 10;
export const SPRINT_ROWS = 22;
export const SPRINT_INPUTS = Object.freeze(['left', 'right', 'cw', 'ccw', 'soft', 'drop', 'hold']);
const names = Object.keys(TETROMINOS).sort();
const rotations = Object.fromEntries(names.map(name => {
  const first = TETROMINOS[name];
  const second = rotate(first, 1);
  const third = rotate(second, 1);
  return [name, [first, second, third, rotate(third, 1)]];
}));
const lockTicks = 500 / SPRINT_TICK_MS;
const moveResets = 12;
const gravityTicks = [1000, 793, 618, 473, 355, 262].map(ms => Math.ceil(ms / SPRINT_TICK_MS));
const blankRow = () => Array(SPRINT_COLS).fill(0);
const levelFor = lines => 1 + Math.floor(Math.min(lines, SPRINT_LINE_GOAL) / 8);
const fallDelay = board => gravityTicks[levelFor(board.lines) - 1];
const isPiece = name => names.includes(name);

// A bag depends only on the shared seed and its ordinal. Hold, reconnect and
// unequal playing speeds cannot change the underlying sequence.
export function sprintBag(seed, index) {
  let word = (seed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0;
  const bag = names.slice();
  for (let i = bag.length - 1; i > 0; i--) {
    word = (word + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(word ^ (word >>> 15), word | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    const j = ((mixed ^ (mixed >>> 14)) >>> 0) % (i + 1);
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

export function sprintNext(seed, cursor, length = 3) {
  let bagNumber = -1, bag;
  return Array.from({ length }, (_, offset) => {
    const position = cursor + offset, index = Math.floor(position / 7);
    if (index !== bagNumber) { bag = sprintBag(seed, index); bagNumber = index; }
    return bag[position % 7];
  });
}

const matrixFor = piece => rotations[piece.name][piece.rotation];
const valid = (board, piece, row = piece.row, col = piece.col) => isValidMove(matrixFor(piece), row, col, board.grid);

export function sprintCells(piece, row = piece?.row) {
  if (!piece) { return []; }
  return matrixFor(piece).flatMap((line, dy) => line.flatMap((cell, dx) => cell ? [[row + dy, piece.col + dx]] : []));
}

export function sprintGhost(board) {
  if (!board.piece) { return []; }
  let row = board.piece.row;
  while (valid(board, board.piece, row + 1)) { row++; }
  return sprintCells(board.piece, row);
}

function stop(board, status) {
  board.status = status;
  board.endedTick = board.tick;
  board.piece = null;
  board.lockAt = null;
}

function spawn(board, seed, name = sprintNext(seed, board.cursor++, 1)[0]) {
  const piece = { name, rotation: 0, row: name === 'I' ? -1 : -2,
    col: Math.floor((SPRINT_COLS - TETROMINOS[name][0].length) / 2), lastActionRotate: false };
  board.fallAt = board.tick + fallDelay(board);
  board.lockAt = null;
  board.resets = 0;
  board.piece = piece;
  // Match the solo game's spawn squeeze recovery.
  for (const row of [0, -1, -2]) {
    for (const col of [0, -1, 1, -2, 2, -3, 3]) {
      if (!valid(board, piece, piece.row + row, piece.col + col)) { continue; }
      piece.row += row;
      piece.col += col;
      if (!valid(board, piece, piece.row + 1)) { board.lockAt = board.tick + lockTicks; }
      return;
    }
  }
  stop(board, 'top-out');
}

export function createSprintBoard(seed) {
  const board = {
    grid: Array.from({ length: SPRINT_ROWS }, blankRow), tick: 0, cursor: 0, hold: null, canHold: true,
    piece: null, fallAt: 0, lockAt: null, resets: 0, lines: 0, score: 0, combo: 0, b2b: 0,
    status: 'playing', endedTick: null
  };
  spawn(board, seed);
  return board;
}

function lock(board, seed) {
  const cells = sprintCells(board.piece);
  if (cells.some(([row]) => row < 0)) { stop(board, 'top-out'); return; }
  for (const [row, col] of cells) { board.grid[row][col] = board.piece.name; }
  const spin = detectTSpin({ piece: board.piece, grid: board.grid });
  const remaining = board.grid.filter(row => !row.every(Boolean));
  const lines = SPRINT_ROWS - remaining.length;
  if (lines) {
    const level = levelFor(board.lines), difficult = spin || lines === 4;
    board.score += calculateScore(lines, level, spin, difficult && board.b2b > 0);
    board.b2b = difficult ? board.b2b + 1 : 0;
    board.combo++;
    if (board.combo > 1) { board.score += board.combo * 50 * level; }
    board.grid = [...Array.from({ length: lines }, blankRow), ...remaining];
    if (isPerfectClear(board.grid)) { board.score += 1200 * level; }
    board.lines += lines;
  } else { board.combo = 0; }
  if (board.lines >= SPRINT_LINE_GOAL) { stop(board, 'cleared'); return; }
  board.canHold = true;
  spawn(board, seed);
}

function ground(board, reset) {
  if (valid(board, board.piece, board.piece.row + 1)) { board.lockAt = null; return; }
  if (board.lockAt === null) { board.lockAt = board.tick + lockTicks; }
  else if (reset && board.resets < moveResets) {
    board.lockAt = board.tick + lockTicks;
    board.resets++;
  }
}

export function advanceSprint(board, seed, target) {
  while (board.status === 'playing') {
    const event = Math.min(board.fallAt, board.lockAt ?? Infinity);
    if (event > target) { break; }
    board.tick = event;
    if (event === board.lockAt) { lock(board, seed); }
    else {
      if (valid(board, board.piece, board.piece.row + 1)) { board.piece.row++; }
      board.fallAt = event + fallDelay(board);
      ground(board, false);
    }
  }
  board.tick = Math.max(board.tick, target);
}

export function applySprintInput(board, seed, action) {
  if (board.status !== 'playing') { return false; }
  const piece = board.piece;
  if (action === 'hold') {
    if (!board.canHold) { return false; }
    const prior = board.hold;
    board.hold = piece.name;
    board.canHold = false;
    spawn(board, seed, prior ?? undefined);
  } else if (action === 'drop') {
    const start = piece.row;
    while (valid(board, piece, piece.row + 1)) { piece.row++; }
    board.score += (piece.row - start) * 2;
    lock(board, seed);
  } else if (action === 'soft') {
    if (!valid(board, piece, piece.row + 1)) { lock(board, seed); return true; }
    piece.row++;
    piece.lastActionRotate = false;
    board.score++;
    ground(board, false);
  } else if (action === 'left' || action === 'right') {
    const col = piece.col + (action === 'left' ? -1 : 1);
    if (!valid(board, piece, piece.row, col)) { return false; }
    piece.col = col;
    piece.lastActionRotate = false;
    ground(board, true);
  } else if (action === 'cw' || action === 'ccw') {
    const rotation = (piece.rotation + (action === 'cw' ? 1 : 3)) % 4;
    const kicks = piece.name === 'O' ? [[0, 0]] : (piece.name === 'I' ? SRS_I : SRS_JLSTZ)[piece.rotation + '>' + rotation];
    const test = { ...piece, rotation, lastActionRotate: true };
    for (const [x, y] of kicks) {
      if (!valid(board, test, piece.row - y, piece.col + x)) { continue; }
      board.piece = { ...test, row: piece.row - y, col: piece.col + x };
      ground(board, true);
      return true;
    }
    return false;
  } else { return false; }
  return true;
}

const numberIn = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;

export function validSprintBoard(board, cap) {
  if (!board || !numberIn(board.tick, 0, cap) || !numberIn(board.cursor, 1, cap * 2) ||
      !numberIn(board.lines, 0, SPRINT_LINE_GOAL + 3) || !numberIn(board.score, 0, cap * 10000) ||
      !numberIn(board.combo, 0, board.lines) || !numberIn(board.b2b, 0, board.lines) ||
      !numberIn(board.resets, 0, moveResets) || typeof board.canHold !== 'boolean' ||
      !(board.hold === null || isPiece(board.hold)) ||
      !Array.isArray(board.grid) || board.grid.length !== SPRINT_ROWS ||
      !board.grid.every(row => Array.isArray(row) && row.length === SPRINT_COLS && row.every(cell => cell === 0 || isPiece(cell)))) { return false; }
  if (board.status !== 'playing') {
    return ['cleared', 'top-out'].includes(board.status) && board.piece === null && board.lockAt === null &&
      numberIn(board.endedTick, 0, board.tick) && (board.status === 'cleared') === (board.lines >= SPRINT_LINE_GOAL);
  }
  const { piece } = board;
  return board.lines < SPRINT_LINE_GOAL && board.endedTick === null &&
    numberIn(board.fallAt, board.tick + 1, cap + gravityTicks[0]) &&
    (board.lockAt === null || numberIn(board.lockAt, board.tick + 1, cap + lockTicks)) &&
    !!piece && isPiece(piece.name) && numberIn(piece.rotation, 0, 3) &&
    numberIn(piece.row, -SPRINT_ROWS, SPRINT_ROWS - 1) && numberIn(piece.col, -3, SPRINT_COLS - 1) &&
    typeof piece.lastActionRotate === 'boolean' && valid(board, piece);
}
