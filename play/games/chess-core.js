// SPDX-License-Identifier: GPL-3.0-or-later
import { Chess, DEFAULT_POSITION } from '../assets/chess/chess.js';

export { Chess, DEFAULT_POSITION };
export const SAVE_KEY = 'arcade_chess_save_v1';
export const RESULTS_KEY = 'arcade_chess_results_v1';
export const LEVELS = Object.freeze({
  friendly: { label: 'Friendly', skill: 0, depth: 2, ms: 180, description: 'Our shortest searches and lowest skill setting. Start here; it can still spot tactics.' },
  casual: { label: 'Casual', skill: 4, depth: 5, ms: 350, description: 'Looks a few moves ahead. Take your time and try a plan.' },
  club: { label: 'Club', skill: 12, depth: 10, ms: 700, description: 'Deeper searches and fewer mistakes. Expect a challenge.' },
  sharp: { label: 'Sharp', skill: 20, depth: 18, ms: 1400, description: 'Our strongest setting. Still bounded for your device.' }
});
export const colorName = color => color === 'w' ? 'White' : 'Black';
export const pieceName = type => ({ p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' })[type] || '';
export const uciMove = text => {
  if (typeof text !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(text)) { throw new Error('Invalid move'); }
  return { from: text.slice(0, 2), to: text.slice(2, 4), ...(text[4] ? { promotion: text[4] } : {}) };
};
const identity = fen => fen.split(' ').slice(0, 4).join(' ');

export function repetitions(chess) {
  const current = identity(chess.fen());
  const history = chess.history({ verbose: true });
  return (history.length ? history.filter(move => identity(move.before) === current).length : 0) + 1;
}

export function claimReason(chess) {
  if (chess.isCheckmate() || chess.isStalemate() || chess.isInsufficientMaterial()) { return null; }
  if (chess.isThreefoldRepetition()) { return 'Threefold repetition'; }
  if (Number(chess.fen().split(' ')[4]) >= 100) { return '50-move rule'; }
  return null;
}

export function automaticResult(chess) {
  if (chess.isCheckmate()) { return { winner: chess.turn() === 'w' ? 'b' : 'w', reason: 'Checkmate' }; }
  if (chess.isStalemate()) { return { winner: null, reason: 'Stalemate' }; }
  if (chess.isInsufficientMaterial()) { return { winner: null, reason: 'Insufficient material' }; }
  if (Number(chess.fen().split(' ')[4]) >= 150) { return { winner: null, reason: '75-move rule' }; }
  if (repetitions(chess) >= 5) { return { winner: null, reason: 'Fivefold repetition' }; }
  return null;
}

// These are the legal moves that can be declared as an intended draw claim.
// The real board and its repetition history remain unchanged.
export function intendedClaims(chess) {
  if (automaticResult(chess)) { return []; }
  const choices = [];
  for (const move of chess.moves({ verbose: true })) {
    chess.move(move);
    const reason = claimReason(chess);
    chess.undo();
    if (reason) { choices.push({ move: move.lan, san: move.san, reason }); }
  }
  return choices;
}

export function createGame(options = {}) {
  return {
    chess: new Chess(options.fen || DEFAULT_POSITION),
    start: options.fen || DEFAULT_POSITION,
    id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    mode: options.mode === 'local' ? 'local' : 'computer',
    side: options.side === 'b' ? 'b' : 'w',
    level: Object.hasOwn(LEVELS, options.level) ? options.level : 'casual',
    flipped: options.side === 'b', hints: 0, undos: 0, result: null, updated: Date.now()
  };
}

export function playMove(game, move) {
  if (game.result) { throw new Error('This game is finished'); }
  const played = game.chess.move(typeof move === 'string' ? uciMove(move) : move);
  game.result = automaticResult(game.chess);
  game.updated = Date.now();
  return played;
}

export function claimDraw(game, intended = null) {
  if (game.result) { return false; }
  const reason = intended
    ? intendedClaims(game.chess).find(choice => choice.move === intended)?.reason
    : claimReason(game.chess);
  if (!reason) { return false; }
  game.result = { winner: null, reason, ...(intended ? { intended } : {}) };
  game.updated = Date.now();
  return true;
}

export function resign(game) {
  if (game.result) { return false; }
  const loser = game.mode === 'computer' ? game.side : game.chess.turn();
  const winner = loser === 'w' ? 'b' : 'w';
  const hasMatingPiece = game.chess.board().flat().some(piece => piece?.color === winner && piece.type !== 'k');
  game.result = hasMatingPiece ? { winner, reason: 'Resignation' } : { winner: null, reason: 'Resignation · opponent has only a king' };
  game.updated = Date.now();
  return true;
}

export function undoTurn(game) {
  if (game.result || !game.chess.history().length ||
      (game.mode === 'computer' && !game.chess.history({ verbose: true }).some(move => move.color === game.side))) { return 0; }
  let count = 0;
  do {
    game.chess.undo(); count++;
  } while (game.mode === 'computer' && game.chess.turn() !== game.side && game.chess.history().length);
  game.undos++;
  game.updated = Date.now();
  return count;
}

export function snapshot(game) {
  return { version: 1, id: game.id, mode: game.mode, side: game.side, level: game.level,
    start: game.start, moves: game.chess.history({ verbose: true }).map(move => move.lan),
    flipped: game.flipped, hints: game.hints, undos: game.undos, result: game.result, updated: game.updated };
}

export function restore(raw) {
  try {
    if (typeof raw === 'string' && raw.length > 240000) { return null; }
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!data || data.version !== 1 || !/^[a-zA-Z0-9-]{5,80}$/.test(data.id) ||
        !['computer', 'local'].includes(data.mode) || !['w', 'b'].includes(data.side) ||
        !Object.hasOwn(LEVELS, data.level) || data.start !== DEFAULT_POSITION ||
        !Array.isArray(data.moves) || data.moves.length > 20000 ||
        !Number.isSafeInteger(data.updated) || data.updated <= 0 || typeof data.flipped !== 'boolean' ||
        ![data.hints, data.undos].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 100000)) { return null; }
    const game = createGame(data);
    game.id = data.id;
    for (const move of data.moves) { playMove(game, move); }
    game.flipped = data.flipped; game.hints = data.hints; game.undos = data.undos; game.updated = data.updated;
    if (data.result) {
      if (game.result) {
        if (JSON.stringify(game.result) !== JSON.stringify(data.result)) { return null; }
      } else if (['Resignation', 'Resignation · opponent has only a king'].includes(data.result.reason)) {
        resign(game);
        if (game.result.winner !== data.result.winner || game.result.reason !== data.result.reason) { return null; }
      } else if (!claimDraw(game, data.result.intended || null) || data.result.reason !== game.result.reason || data.result.winner !== null) {
        return null;
      }
    } else if (game.result) { return null; }
    game.updated = data.updated;
    return game;
  } catch { return null; }
}

export function loadGame(storage) {
  try { return restore(storage?.getItem(SAVE_KEY)); } catch { return null; }
}
export function saveGame(storage, game) {
  try { if (!storage) { return false; } storage.setItem(SAVE_KEY, JSON.stringify(snapshot(game))); return true; } catch { return false; }
}

export function readResults(storage) {
  try {
    const data = JSON.parse(storage?.getItem(RESULTS_KEY) || 'null');
    if (!data || data.version !== 1 || !Array.isArray(data.ids) || data.ids.length > 1000 ||
        !data.ids.every(id => typeof id === 'string' && id.length <= 80) ||
        !['wins', 'losses', 'draws', 'local', 'assisted'].every(key => Number.isSafeInteger(data[key]) && data[key] >= 0)) { throw new Error(); }
    return data;
  } catch { return { version: 1, ids: [], wins: 0, losses: 0, draws: 0, local: 0, assisted: 0 }; }
}
export function recordResult(storage, game) {
  if (!game.result || !storage) { return false; }
  const results = readResults(storage);
  if (results.ids.includes(game.id)) { return true; }
  if (game.mode === 'local') { results.local++; }
  else if (!game.result.winner) { results.draws++; }
  else if (game.result.winner === game.side) { results.wins++; }
  else { results.losses++; }
  if (game.hints || game.undos) { results.assisted++; }
  results.ids = [...results.ids.slice(-999), game.id];
  try { storage.setItem(RESULTS_KEY, JSON.stringify(results)); return true; } catch { return false; }
}

export function exportPgn(game) {
  const chess = game.chess;
  chess.setHeader('Event', game.mode === 'local' ? 'Arcade pass-and-play' : `Arcade computer practice (${LEVELS[game.level].label})`);
  chess.setHeader('White', game.mode === 'local' || game.side === 'w' ? 'Player (White)' : 'Stockfish Lite');
  chess.setHeader('Black', game.mode === 'local' || game.side === 'b' ? 'Player (Black)' : 'Stockfish Lite');
  chess.setHeader('Result', !game.result ? '*' : !game.result.winner ? '1/2-1/2' : game.result.winner === 'w' ? '1-0' : '0-1');
  chess.setHeader('Termination', game.result?.reason || 'Unfinished');
  chess.setHeader('Mode', 'casual');
  return chess.pgn({ maxWidth: 80 }) + `\n{Practice aids: ${game.hints} hints, ${game.undos} takebacks.${game.result?.intended ? ` Draw claimed with intended move ${game.result.intended}.` : ''}}\n`;
}
