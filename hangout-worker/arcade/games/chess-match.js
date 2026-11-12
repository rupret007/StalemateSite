// SPDX-License-Identifier: GPL-3.0-or-later
import { Chess, automaticResult, claimReason, uciMove } from './chess-core.js';

export const CHESS_MATCH_VERSION = 1;
export const CHESS_INITIAL_CLOCK_MS = 10 * 60 * 1000;
const matchIdPattern = /^[a-zA-Z0-9-]{5,80}$/;
const colors = ['w', 'b'];
const opponent = color => color === 'w' ? 'b' : 'w';
const timestamp = value => Number.isSafeInteger(value) && value >= 0;

function legalMove(chess, text) {
  try {
    return chess.move(uciMove(text));
  } catch {
    return null;
  }
}

function drawClaim(chess, intended) {
  if (intended === undefined) { return claimReason(chess); }
  if (!legalMove(chess, intended)) { return null; }
  const reason = claimReason(chess);
  chess.undo();
  return reason;
}

// Call only after two admitted players are ready. The match service owns
// identities, seat grants, command serialization and durable writes.
export class ChessMatch {
  #chess = new Chess();
  #state;

  constructor(id, now) {
    if (typeof id !== 'string' || !matchIdPattern.test(id) || !timestamp(now)) {
      throw new TypeError('Invalid chess match identity or start time');
    }
    this.#state = {
      version: CHESS_MATCH_VERSION,
      id,
      revision: 0,
      clock: { w: CHESS_INITIAL_CLOCK_MS, b: CHESS_INITIAL_CLOCK_MS },
      turnStartedAt: now,
      moves: [],
      drawOffer: null,
      result: null
    };
  }

  // Only checkpoints from the service's own storage are eligible for restore.
  // Replay from the start so reconnect/restart keeps repetition history.
  static restore(checkpoint) {
    if (checkpoint?.version !== CHESS_MATCH_VERSION || !timestamp(checkpoint.revision) ||
        !colors.every(color => timestamp(checkpoint.clock?.[color]) &&
          checkpoint.clock[color] <= CHESS_INITIAL_CLOCK_MS) ||
        !Array.isArray(checkpoint.moves) || checkpoint.moves.length > 20000 ||
        checkpoint.revision < checkpoint.moves.length) {
      throw new TypeError('Invalid chess match checkpoint');
    }
    const match = new ChessMatch(checkpoint.id, checkpoint.turnStartedAt);
    for (const move of checkpoint.moves) {
      if (!legalMove(match.#chess, move)) { throw new TypeError('Invalid chess match history'); }
    }
    match.#state = globalThis.structuredClone(checkpoint);
    return match;
  }

  checkpoint() {
    return globalThis.structuredClone(this.#state);
  }

  get deadline() {
    const { clock, result, turnStartedAt } = this.#state;
    return result ? null : turnStartedAt + clock[this.#chess.turn()];
  }

  view(now) {
    const { id, revision, clock, drawOffer, result } = this.#state;
    const deadline = this.deadline;
    const turn = this.#chess.turn();
    return {
      version: CHESS_MATCH_VERSION,
      game: 'chess',
      id,
      revision,
      fen: this.#chess.fen(),
      moves: this.#state.moves.slice(),
      turn,
      clock: { ...clock, ...(deadline === null ? {} : { [turn]: Math.max(0, deadline - Math.max(now, this.#state.turnStartedAt)) }) },
      serverTime: now,
      deadline,
      drawOffer,
      result: result && { ...result }
    };
  }

  #finishByLoss(loser, reason) {
    const winner = opponent(loser);
    const hasPiece = this.#chess.board().flat().some(piece => piece?.color === winner && piece.type !== 'k');
    this.#state.result = hasPiece
      ? { winner, reason }
      : { winner: null, reason: `${reason} · opponent has only a king` };
    this.#state.drawOffer = null;
  }

  expire(now) {
    const deadline = this.deadline;
    if (!timestamp(now) || deadline === null || now < deadline) { return false; }
    const turn = this.#chess.turn();
    this.#state.clock[turn] = 0;
    this.#finishByLoss(turn, 'Time expired');
    this.#state.revision++;
    return true;
  }

  // The caller derives seat from authenticated membership. No command field
  // can select a seat, report its own time, or supply a resulting position.
  command(seat, request, now) {
    if (!colors.includes(seat) || !timestamp(now)) { return { ok: false, reason: 'unavailable' }; }
    const state = this.#state;
    if (request?.version !== CHESS_MATCH_VERSION || request.id !== state.id) {
      return { ok: false, reason: 'match-changed' };
    }
    if (this.expire(now)) { return { ok: false, reason: 'finished', changed: true }; }
    if (state.result) { return { ok: false, reason: 'finished' }; }
    if (request.revision !== state.revision) { return { ok: false, reason: 'stale' }; }
    const turn = this.#chess.turn();
    const time = Math.max(now, state.turnStartedAt);
    const remaining = this.deadline - time;
    switch (request.action) {
    case 'move': {
      if (seat !== turn) { return { ok: false, reason: 'wrong-turn' }; }
      const move = legalMove(this.#chess, request.move);
      if (!move) { return { ok: false, reason: 'illegal-move' }; }
      state.moves.push(move.lan);
      state.result = automaticResult(this.#chess);
      state.clock[seat] = remaining;
      state.turnStartedAt = time;
      if (state.drawOffer === opponent(seat)) { state.drawOffer = null; }
      break;
    }
    case 'offer-draw':
      if (state.drawOffer) { return { ok: false, reason: 'draw-pending' }; }
      state.drawOffer = seat;
      break;
    case 'accept-draw':
    case 'decline-draw':
      if (state.drawOffer !== opponent(seat)) { return { ok: false, reason: 'no-draw-offer' }; }
      if (request.action === 'accept-draw') { state.result = { winner: null, reason: 'Draw by agreement' }; }
      state.drawOffer = null;
      break;
    case 'claim-draw': {
      if (seat !== turn) { return { ok: false, reason: 'wrong-turn' }; }
      const reason = drawClaim(this.#chess, request.move);
      if (!reason) { return { ok: false, reason: 'no-draw-claim' }; }
      state.result = { winner: null, reason, ...(request.move ? { intended: request.move } : {}) };
      break;
    }
    case 'resign':
      this.#finishByLoss(seat, 'Resignation');
      break;
    default:
      return { ok: false, reason: 'unknown-action' };
    }
    if (state.result) {
      state.clock[turn] = remaining;
      state.drawOffer = null;
    }
    state.revision++;
    return { ok: true };
  }
}
