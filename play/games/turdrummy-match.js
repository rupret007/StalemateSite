import './turdrummy-rules.js?v=7fc23a6923ddd65e';
import { shuffleDeck } from './arcade-deck.js?v=feb24df2eef77b9b';

const { balance, analyzeHand, scoreRound } = globalThis.TurdRummyRules;
const { knockLimit, matchTarget } = balance;
export const TURDRUMMY_MATCH_VERSION = 1;
const seats = ['a', 'b'];
const other = seat => seat === 'a' ? 'b' : 'a';
const handSize = 10;
const cards = Object.freeze(['C', 'D', 'H', 'S'].flatMap((suit, group) =>
  Array.from({ length: 13 }, (_, i) => Object.freeze({ suit, rank: i + 1, id: group * 13 + i }))));
const cardId = id => Number.isInteger(id) && id >= 0 && id < cards.length;
const matchId = id => typeof id === 'string' && /^[a-zA-Z0-9-]{5,80}$/.test(id);
const count = value => Number.isSafeInteger(value) && value >= 0;
const dealt = ids => ids.map(id => cards[id]);
function publicCard(id) {
  if (!cardId(id)) { return null; }
  const { suit, rank } = cards[id];
  return { suit, rank };
}

function newRound(round) {
  const stock = shuffleDeck(cards.map(card => card.id));
  const hands = { a: [], b: [] };
  for (let i = 0; i < handSize; i++) {
    hands.a.push(stock.pop());
    hands.b.push(stock.pop());
  }
  return { round, stock, hands, discard: [stock.pop()], turn: round % 2 ? 'b' : 'a', drawn: null, roundResult: null };
}

function validRoundResult(result) {
  return result === null || (result && seats.includes(result.winner) && seats.includes(result.knocker) &&
    ['gin', 'knock', 'undercut'].includes(result.kind) && count(result.points) && result.points <= 125 &&
    count(result.knockerDeadwood) && result.knockerDeadwood <= knockLimit &&
    count(result.defenderDeadwood) && result.defenderDeadwood <= 100 &&
    count(result.laidOff) && result.laidOff <= handSize);
}

function validCheckpoint(state) {
  if (state?.version !== TURDRUMMY_MATCH_VERSION || !matchId(state.id) || !count(state.revision) ||
      !count(state.round) || state.round < 1 || state.round > state.revision + 1 ||
      !seats.includes(state.turn) || !validRoundResult(state.roundResult) ||
      ![state.stock, state.discard, state.hands?.a, state.hands?.b].every(Array.isArray) ||
      !seats.every(seat => count(state.score?.[seat]) && state.score[seat] < matchTarget + 125) ||
      !(state.result === null || (seats.includes(state.result?.winner) && ['score', 'resigned'].includes(state.result.reason)))) { return false; }

  const all = [...state.stock, ...state.discard, ...state.hands.a, ...state.hands.b];
  if (all.length !== cards.length || !all.every(cardId) || new Set(all).size !== cards.length) { return false; }
  if (!seats.every(seat => state.hands[seat].length === handSize + Number(seat === state.turn && !!state.drawn))) { return false; }
  return state.drawn === null ? state.discard.length > 0
    : !state.roundResult && ['stock', 'discard'].includes(state.drawn?.source) && state.hands[state.turn].includes(state.drawn?.id);
}

export class TurdRummyMatch {
  #state;

  constructor(id, saved = null) {
    if (!matchId(id)) { throw new TypeError('Invalid TurdRummy match identity'); }
    if (saved && (saved.id !== id || !validCheckpoint(saved))) { throw new TypeError('Invalid TurdRummy checkpoint'); }
    this.#state = saved ? globalThis.structuredClone(saved) : {
      version: TURDRUMMY_MATCH_VERSION, id, revision: 0, score: { a: 0, b: 0 }, result: null, ...newRound(1)
    };
  }

  static restore(saved) { return new TurdRummyMatch(saved?.id, saved); }
  get finished() { return !!this.#state.result; }
  checkpoint() { return globalThis.structuredClone(this.#state); }

  view(seat) {
    const { id, revision, round, stock, discard, hands, turn, score, roundResult, result, drawn } = this.#state;
    const viewer = seats.includes(seat) ? seat : null;
    const yourTurn = viewer === turn && !roundResult && !result;
    const phase = drawn ? 'discard' : 'draw';
    const hand = viewer ? dealt(hands[viewer]).sort((a, b) => a.id - b.id).map(card => ({ ...card })) : [];
    const blocked = yourTurn && drawn?.source === 'discard' ? drawn.id : null;
    return {
      version: TURDRUMMY_MATCH_VERSION, game: 'turdrummy', id, revision, round, target: matchTarget,
      turn, phase, knockLimit, top: publicCard(discard.at(-1)), stockCount: stock.length, score: { ...score },
      counts: { a: hands.a.length, b: hands.b.length }, hand, blocked, drawn: yourTurn ? drawn?.id ?? null : null,
      canDrawStock: yourTurn && !drawn && (stock.length > 0 || discard.length > 1),
      canTakeDiscard: yourTurn && !drawn && discard.length > 0,
      roundResult: roundResult && {
        winner: roundResult.winner, knocker: roundResult.knocker, kind: roundResult.kind, points: roundResult.points,
        knockerDeadwood: roundResult.knockerDeadwood, defenderDeadwood: roundResult.defenderDeadwood, laidOff: roundResult.laidOff
      },
      result: result && { winner: result.winner, reason: result.reason }
    };
  }

  #draw(source, seat) {
    const state = this.#state;
    if (source === 'stock' && !state.stock.length && state.discard.length > 1) {
      state.stock = shuffleDeck(state.discard.splice(0, state.discard.length - 1));
    }
    const id = state[source].pop();
    if (id === undefined) { return 'pile-empty'; }
    state.hands[seat].push(id);
    state.drawn = { source, id };
    return '';
  }

  #discard(seat, id, action) {
    const state = this.#state, hand = state.hands[seat];
    const index = hand.indexOf(id);
    if (!cardId(id) || index === -1) { return 'illegal-card'; }
    if (state.drawn.source === 'discard' && state.drawn.id === id) { return 'return-discard'; }
    if (action !== 'discard') {
      const analysis = analyzeHand(dealt(hand.filter(card => card !== id)));
      if (action === 'gin' && analysis.deadwoodScore !== 0) { return 'not-gin'; }
      if (analysis.deadwoodScore > knockLimit) { return 'knock-limit'; }
      const settled = scoreRound(analysis, dealt(state.hands[other(seat)]));
      const winner = settled.kind === 'undercut' ? other(seat) : seat;
      state.roundResult = {
        winner, knocker: seat, kind: settled.kind, points: settled.points,
        knockerDeadwood: analysis.deadwoodScore, defenderDeadwood: settled.defenderDeadwood, laidOff: settled.laidOffCards.length
      };
      state.score[winner] += settled.points;
      if (state.score[winner] >= matchTarget) { state.result = { winner, reason: 'score' }; }
    }
    hand.splice(index, 1);
    state.discard.push(id);
    state.drawn = null;
    state.turn = other(seat);
    return '';
  }

  command(seat, request) {
    const state = this.#state;
    if (!seats.includes(seat)) { return { ok: false, reason: 'unavailable' }; }
    if (request?.version !== TURDRUMMY_MATCH_VERSION || request.id !== state.id) { return { ok: false, reason: 'match-changed' }; }
    if (request.revision !== state.revision) { return { ok: false, reason: 'stale' }; }
    if (state.result) { return { ok: false, reason: 'finished' }; }
    const { action } = request;
    if (action === 'resign') {
      state.result = { winner: other(seat), reason: 'resigned' };
    } else if (action === 'next-round' && state.roundResult) {
      Object.assign(state, newRound(state.round + 1));
    } else {
      if (state.roundResult) { return { ok: false, reason: 'round-finished' }; }
      if (seat !== state.turn) { return { ok: false, reason: 'wrong-turn' }; }
      let reason = 'wrong-phase';
      if (!state.drawn && ['draw-stock', 'draw-discard'].includes(action)) {
        reason = this.#draw(action === 'draw-stock' ? 'stock' : 'discard', seat);
      } else if (state.drawn && ['discard', 'knock', 'gin'].includes(action)) {
        reason = this.#discard(seat, request.card, action);
      }
      if (reason) { return { ok: false, reason }; }
    }
    state.revision++;
    return { ok: true };
  }
}
