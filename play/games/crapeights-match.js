import './crapeights-rules.js?v=a053e73c5338e669';
import { shuffleDeck } from './arcade-deck.js?v=feb24df2eef77b9b';

const { suits, ranks, handSize, target, canPlay, cardPoints, cardEffect } = globalThis.CrapeightsRules;
export const CRAPEIGHTS_MATCH_VERSION = 1;
const duelSeats = ['a', 'b'];
export const CRAPEIGHTS_TABLE_SEATS = Object.freeze(['a', 'b', 'c', 'd']);
const cards = Object.freeze(suits.flatMap(suit => ranks.map(rank => Object.freeze({ suit, rank }))));
const maximumScore = target + cards.reduce((sum, card) => sum + cardPoints(card), 0);
const cardId = id => Number.isSafeInteger(id) && id >= 0 && id < cards.length;
const matchId = id => typeof id === 'string' && /^[a-zA-Z0-9-]{5,80}$/.test(id);
const count = value => Number.isSafeInteger(value) && value >= 0;
const publicCard = id => ({ ...cards[id] });

function newRound(seats, round) {
  const deck = shuffleDeck(cards.map((_, index) => index));
  const hands = Object.fromEntries(seats.map(seat => [seat, []]));
  for (let i = 0; i < handSize; i++) {
    for (const seat of seats) hands[seat].push(deck.pop());
  }
  while (cards[deck.at(-1)].rank === '8') { deck.unshift(deck.pop()); }
  const top = deck.pop();
  return {
    round, deck, hands, discard: [top], activeSuit: cards[top].suit, direction: 1,
    turn: seats[(round - 1) % seats.length], drawn: null, passes: 0, roundResult: null, action: null
  };
}

function validCheckpoint(saved, seats) {
  if (saved?.version !== CRAPEIGHTS_MATCH_VERSION || !matchId(saved.id) || !count(saved.revision) ||
      !count(saved.round) || saved.round < 1 || saved.round > saved.revision + 1 ||
      !seats.includes(saved.turn) || !suits.includes(saved.activeSuit) || ![-1, 1].includes(saved.direction) ||
      (saved.fourSeats !== undefined && saved.fourSeats !== true) ||
      !count(saved.passes) || saved.passes > seats.length ||
      ![saved.deck, saved.discard, ...seats.map(seat => saved.hands?.[seat])].every(Array.isArray) ||
      !saved.discard.length || !seats.every(seat => count(saved.score?.[seat]) && saved.score[seat] <= maximumScore)) { return false; }
  const partition = [...saved.deck, ...saved.discard, ...seats.flatMap(seat => saved.hands[seat])];
  return partition.length === cards.length && partition.every(cardId) && new Set(partition).size === cards.length &&
    (saved.drawn === null || saved.hands[saved.turn].includes(saved.drawn)) &&
    (saved.roundResult === null || (count(saved.roundResult?.points) &&
      (saved.roundResult.winner === null || seats.includes(saved.roundResult.winner)))) &&
    (saved.result === null || (seats.includes(saved.result?.winner) && ['score', 'resigned'].includes(saved.result.reason))) &&
    (saved.action === null || (seats.includes(saved.action?.seat) &&
      ['play', 'draw', 'pass', 'skip', 'draw-two'].includes(saved.action.kind)));
}

export class CrapeightsMatch {
  #state;
  #seats;
  constructor(id, saved = null, fourSeats = saved?.fourSeats === true) {
    this.#seats = fourSeats ? CRAPEIGHTS_TABLE_SEATS : duelSeats;
    if (!matchId(id)) { throw new TypeError('Invalid Crappy Eights match identity'); }
    if (saved && (saved.id !== id || !validCheckpoint(saved, this.#seats))) { throw new TypeError('Invalid Crappy Eights checkpoint'); }
    this.#state = saved ? globalThis.structuredClone(saved) : { version: CRAPEIGHTS_MATCH_VERSION, id, revision: 0, score: Object.fromEntries(this.#seats.map(seat => [seat, 0])), result: null,
      ...(fourSeats ? { fourSeats: true } : {}), ...newRound(this.#seats, 1) };
  }

  static restore(saved) {
    return new CrapeightsMatch(saved?.id, saved);
  }

  get finished() { return !!this.#state.result; }

  checkpoint() { return globalThis.structuredClone(this.#state); }

  #playable(id) {
    const { activeSuit, discard } = this.#state;
    return canPlay(cards[id], cards[discard.at(-1)], activeSuit);
  }

  view(seat) {
    const { id, revision, round, deck, discard, hands, turn, score, direction, activeSuit, roundResult, result, drawn, action } = this.#state;
    const viewer = this.#seats.includes(seat) ? seat : null;
    const yourTurn = viewer === turn && !roundResult && !result;
    const hand = viewer ? hands[viewer].map(id => ({ id, ...publicCard(id), playable: yourTurn && this.#playable(id) })) : [];
    return {
      version: CRAPEIGHTS_MATCH_VERSION, game: 'crapeights', id, revision, round, target, turn, direction, activeSuit,
      top: publicCard(discard.at(-1)), deckCount: deck.length, counts: Object.fromEntries(this.#seats.map(position => [position, hands[position].length])), score: { ...score },
      hand, canDraw: yourTurn && drawn === null, canPass: yourTurn && drawn !== null,
      roundResult: roundResult && { winner: roundResult.winner, points: roundResult.points },
      result: result && { winner: result.winner, reason: result.reason },
      action: action && { kind: action.kind, seat: action.seat, ...(action.kind === 'draw-two' ? { count: action.count } : {}) }
    };
  }

  #draw(seat) {
    const state = this.#state;
    if (!state.deck.length && state.discard.length > 1) {
      state.deck = shuffleDeck(state.discard.splice(0, state.discard.length - 1));
    }
    if (!state.deck.length) { return null; }
    const id = state.deck.pop();
    state.hands[seat].push(id);
    return id;
  }

  #endRound(winner) {
    const state = this.#state;
    const points = winner ? this.#seats.filter(seat => seat !== winner).flatMap(seat => state.hands[seat])
      .reduce((sum, id) => sum + cardPoints(cards[id]), 0) : 0;
    state.roundResult = { winner, points };
    if (winner) {
      state.score[winner] += points;
      if (state.score[winner] >= target) { state.result = { winner, reason: 'score' }; }
    }
  }

  #next(seat, steps = 1) {
    return this.#seats[(this.#seats.indexOf(seat) + this.#seats.length + steps * this.#state.direction) % this.#seats.length];
  }

  #advance(seat, steps) {
    this.#state.turn = this.#next(seat, steps);
    this.#state.drawn = null;
  }

  #play(seat, request) {
    const state = this.#state;
    const index = state.hands[seat].indexOf(request.card);
    const card = cards[request.card];
    if (index < 0 || !this.#playable(request.card)) { return 'illegal-card'; }
    const effect = cardEffect(card);
    if (effect === 'wild' && !suits.includes(request.suit)) { return 'choose-suit'; }
    state.hands[seat].splice(index, 1);
    state.discard.push(request.card);
    state.activeSuit = effect === 'wild' ? request.suit : card.suit;
    state.action = { kind: 'play', seat };
    state.passes = 0;
    state.drawn = null;
    if (effect === 'reverse') { state.direction *= -1; }
    if (!state.hands[seat].length) { this.#endRound(seat); return ''; }
    if (effect === 'draw-two') {
      const opponent = this.#next(seat);
      const first = this.#draw(opponent) !== null;
      const second = this.#draw(opponent) !== null;
      state.action = { kind: 'draw-two', seat: opponent, count: Number(first) + Number(second) };
      this.#advance(seat, 2);
    } else if (effect === 'skip') {
      state.action = { kind: 'skip', seat: this.#next(seat) };
      this.#advance(seat, 2);
    } else { this.#advance(seat); }
    return '';
  }

  command(seat, request) {
    const state = this.#state;
    if (!this.#seats.includes(seat)) { return { ok: false, reason: 'unavailable' }; }
    if (request?.version !== CRAPEIGHTS_MATCH_VERSION || request.id !== state.id) { return { ok: false, reason: 'match-changed' }; }
    if (request.revision !== state.revision) { return { ok: false, reason: 'stale' }; }
    if (state.result) { return { ok: false, reason: 'finished' }; }
    if (request.action === 'resign') {
      if (state.fourSeats) return { ok: false, reason: 'unavailable' };
      state.result = { winner: this.#next(seat), reason: 'resigned' };
    } else if (request.action === 'next-round' && state.roundResult) {
      Object.assign(state, newRound(this.#seats, state.round + 1));
    } else {
      if (state.roundResult) { return { ok: false, reason: 'round-finished' }; }
      if (seat !== state.turn) { return { ok: false, reason: 'wrong-turn' }; }
      if (request.action === 'play') {
        if (!cardId(request.card)) { return { ok: false, reason: 'illegal-card' }; }
        const error = this.#play(seat, request);
        if (error) { return { ok: false, reason: error }; }
      } else if (request.action === 'draw' && state.drawn === null) {
        const drawn = this.#draw(seat);
        state.action = { kind: 'draw', seat };
        state.passes = drawn === null ? state.passes + 1 : 0;
        if (state.passes === this.#seats.length) { this.#endRound(null); }
        else if (drawn !== null && this.#playable(drawn)) { state.drawn = drawn; }
        else { this.#advance(seat); }
      } else if (request.action === 'pass' && state.drawn !== null) {
        state.action = { kind: 'pass', seat };
        this.#advance(seat);
      } else { return { ok: false, reason: 'unavailable' }; }
    }
    state.revision++;
    return { ok: true };
  }
}
