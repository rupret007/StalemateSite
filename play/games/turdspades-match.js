import { shuffleDeck } from './arcade-deck.js?v=feb24df2eef77b9b';
import { MATCH_TARGET, RANKS, RANK_VALUES, SUITS, scoreSpadesTeamRound } from './turdspades-engine.js';

export const TURDSPADES_MATCH_VERSION = 1;
export const SPADES_SEATS = Object.freeze(['south', 'west', 'north', 'east']);
const teams = [['south', 'north'], ['west', 'east']];
const cards = Object.freeze(SUITS.flatMap(suit => RANKS.map(rank => Object.freeze({ suit, rank }))));
const cardId = value => Number.isInteger(value) && value >= 0 && value < cards.length;
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9-]{5,80}$/.test(value);
const count = value => Number.isSafeInteger(value) && value >= 0;
const bidValue = value => count(value) && value <= 13;
const seatMap = make => Object.fromEntries(SPADES_SEATS.map(seat => [seat, make()]));
const clockwise = seat => SPADES_SEATS[(SPADES_SEATS.indexOf(seat) + 1) % SPADES_SEATS.length];
const teamOf = seat => teams[0].includes(seat) ? 0 : 1;

function newRound(round) {
  const shuffled = shuffleDeck(cards.map((_, id) => id));
  const hands = seatMap(() => []);
  for (let i = 0; i < 13; i++) {
    for (const seat of SPADES_SEATS) { hands[seat].push(shuffled.pop()); }
  }
  const dealer = SPADES_SEATS[(round - 1) % 4];
  return {
    round, dealer, turn: clockwise(dealer), phase: 'bid', hands, played: [],
    bids: seatMap(() => null), tricks: seatMap(() => 0), spadesBroken: false, roundResult: null
  };
}

function trickWinner(entries) {
  if (!entries.length) { return null; }
  const lead = cards[entries[0].id].suit;
  return entries.reduce((best, entry) => {
    const card = cards[entry.id], prior = cards[best.id];
    if (card.suit === prior.suit) { return RANK_VALUES[card.rank] > RANK_VALUES[prior.rank] ? entry : best; }
    return card.suit === 'S' || (card.suit === lead && prior.suit !== 'S') ? entry : best;
  }).seat;
}

function trickView(entries) {
  return entries.map(({ seat, id }) => ({ seat, ...cards[id] }));
}

function currentTrick(played) {
  const countInTrick = played.length % 4;
  return countInTrick ? played.slice(-countInTrick) : [];
}

function legalCards(state, seat) {
  const hand = state.hands[seat], lead = cards[currentTrick(state.played)[0]?.id]?.suit;
  if (lead) {
    const following = hand.filter(id => cards[id].suit === lead);
    return following.length ? following : hand;
  }
  if (state.spadesBroken) { return hand; }
  const nonTrump = hand.filter(id => cards[id].suit !== 'S');
  return nonTrump.length ? nonTrump : hand;
}

function scoreRound(state) {
  const summary = teams.map((seats, team) => scoreSpadesTeamRound({
    bids: seats.map(seat => state.bids[seat]), tricks: seats.map(seat => state.tricks[seat]), bags: state.bags[team]
  }));
  state.roundResult = summary.map((result, team) => ({
    delta: result.delta, contract: result.contractBid, made: result.contractMade, bags: result.bags,
    bagPenalties: result.bagPenalties, nil: result.nilResults.map(value => ({
      seat: teams[team][value.playerIndex], succeeded: value.succeeded
    }))
  }));
  for (let team = 0; team < 2; team++) {
    state.scores[team] += summary[team].delta;
    state.bags[team] = summary[team].bags;
  }
  state.phase = 'round-end';
  if (Math.max(...state.scores) >= MATCH_TARGET && state.scores[0] !== state.scores[1]) {
    state.result = { winner: Number(state.scores[1] > state.scores[0]), reason: 'score' };
  }
}

function validResult(result) {
  return result === null || ([0, 1].includes(result?.winner) && ['score', 'resigned'].includes(result?.reason));
}

function validCheckpoint(state) {
  if (state?.version !== TURDSPADES_MATCH_VERSION || !validId(state.id) || !count(state.revision) ||
      !count(state.round) || state.round < 1 || state.round > state.revision + 1 ||
      state.dealer !== SPADES_SEATS[(state.round - 1) % 4] || !SPADES_SEATS.includes(state.turn) ||
      !['bid', 'play', 'round-end'].includes(state.phase) || typeof state.spadesBroken !== 'boolean' ||
      !Array.isArray(state.scores) || state.scores.length !== 2 || !state.scores.every(Number.isSafeInteger) ||
      !Array.isArray(state.bags) || state.bags.length !== 2 || !state.bags.every(value => count(value) && value < 10) ||
      !validResult(state.result) || !Array.isArray(state.played) || state.played.length > 52 ||
      !SPADES_SEATS.every(seat => Array.isArray(state.hands?.[seat]) && state.hands[seat].length <= 13 &&
        (state.bids?.[seat] === null || bidValue(state.bids?.[seat])) && bidValue(state.tricks?.[seat]))) { return false; }
  if (!state.played.every(entry => SPADES_SEATS.includes(entry?.seat) && cardId(entry?.id))) { return false; }
  const partition = SPADES_SEATS.flatMap(seat => state.hands[seat]).concat(state.played.map(entry => entry.id));
  if (partition.length !== 52 || !partition.every(cardId) || new Set(partition).size !== 52) { return false; }
  if (!SPADES_SEATS.every(seat => state.hands[seat].length + state.played.filter(entry => entry.seat === seat).length === 13)) { return false; }
  if (state.phase === 'bid') { return !state.played.length && state.bids[state.turn] === null && state.roundResult === null; }
  if (!SPADES_SEATS.every(seat => bidValue(state.bids[seat]))) { return false; }
  if (state.phase === 'play') { return state.played.length < 52 && state.roundResult === null; }
  return state.played.length === 52 && Array.isArray(state.roundResult) && state.roundResult.length === 2 &&
    state.roundResult.every(result => Number.isSafeInteger(result?.delta) && count(result?.contract) &&
      typeof result.made === 'boolean' && count(result.bags) && count(result.bagPenalties) &&
      Array.isArray(result.nil) && result.nil.every(entry => SPADES_SEATS.includes(entry?.seat) && typeof entry.succeeded === 'boolean'));
}

export class TurdSpadesMatch {
  #state;

  constructor(id, saved = null) {
    if (!validId(id)) { throw new TypeError('Invalid TurdSpades match identity'); }
    if (saved && (saved.id !== id || !validCheckpoint(saved))) { throw new TypeError('Invalid TurdSpades checkpoint'); }
    this.#state = saved ? globalThis.structuredClone(saved) : {
      version: TURDSPADES_MATCH_VERSION, id, revision: 0, scores: [0, 0], bags: [0, 0], result: null, ...newRound(1)
    };
  }

  static restore(saved) { return new TurdSpadesMatch(saved?.id, saved); }
  get finished() { return !!this.#state.result; }
  checkpoint() { return globalThis.structuredClone(this.#state); }

  view(seat) {
    const state = this.#state;
    const { id, revision, round, dealer, turn, phase, bids, tricks, scores, bags, played, spadesBroken, roundResult, result, hands } = state;
    const viewer = SPADES_SEATS.includes(seat) ? seat : null;
    const yourTurn = viewer === turn && !result;
    const legal = yourTurn && phase === 'play' ? new Set(legalCards(state, viewer)) : new Set();
    const hand = viewer ? hands[viewer].slice().sort((a, b) => Math.floor(a / 13) - Math.floor(b / 13) ||
      RANK_VALUES[cards[b].rank] - RANK_VALUES[cards[a].rank]).map(id => ({ id, ...cards[id], playable: legal.has(id) })) : [];
    const completed = played.length - played.length % 4;
    const last = completed ? played.slice(completed - 4, completed) : [];
    return {
      version: TURDSPADES_MATCH_VERSION, game: 'turdspades', id, revision, target: MATCH_TARGET, round, dealer, turn, phase,
      bids: { ...bids }, tricks: { ...tricks }, scores: scores.slice(), bags: bags.slice(), spadesBroken,
      counts: Object.fromEntries(SPADES_SEATS.map(position => [position, hands[position].length])),
      trick: trickView(currentTrick(played)), lastTrick: trickView(last), lastWinner: trickWinner(last), hand,
      canBid: yourTurn && phase === 'bid',
      roundResult: roundResult?.map(({ delta, contract, made, bags, bagPenalties, nil }) => ({
        delta, contract, made, bags, bagPenalties, nil: nil.map(({ seat, succeeded }) => ({ seat, succeeded }))
      })) ?? null,
      result: result && { winner: result.winner, reason: result.reason }
    };
  }

  command(seat, frame) {
    const state = this.#state;
    if (!SPADES_SEATS.includes(seat)) { return { ok: false, reason: 'unavailable' }; }
    if (frame?.id !== state.id || frame.version !== TURDSPADES_MATCH_VERSION) { return { ok: false, reason: 'match-changed' }; }
    if (frame.revision !== state.revision) { return { ok: false, reason: 'stale' }; }
    if (state.result) { return { ok: false, reason: 'finished' }; }
    if (frame.action === 'resign') {
      state.result = { winner: 1 - teamOf(seat), reason: 'resigned' };
    } else if (frame.action === 'next-round' && state.phase === 'round-end') {
      Object.assign(state, newRound(state.round + 1));
    } else {
      if (seat !== state.turn) { return { ok: false, reason: 'wrong-turn' }; }
      if (state.phase === 'bid' && frame.action === 'bid') {
        if (!bidValue(frame.bid)) { return { ok: false, reason: 'invalid-bid' }; }
        state.bids[seat] = frame.bid;
        state.turn = clockwise(seat);
        if (state.turn === clockwise(state.dealer)) { state.phase = 'play'; }
      } else if (state.phase === 'play' && frame.action === 'play') {
        if (!cardId(frame.card) || !legalCards(state, seat).includes(frame.card)) { return { ok: false, reason: 'illegal-card' }; }
        const hand = state.hands[seat];
        hand.splice(hand.indexOf(frame.card), 1);
        if (cards[frame.card].suit === 'S') { state.spadesBroken = true; }
        state.played.push({ id: frame.card, seat });
        if (state.played.length % 4 === 0) {
          state.turn = trickWinner(state.played.slice(-4));
          state.tricks[state.turn]++;
          if (state.played.length === 52) { scoreRound(state); }
        } else { state.turn = clockwise(seat); }
      } else { return { ok: false, reason: 'wrong-phase' }; }
    }
    state.revision++;
    return { ok: true };
  }
}
