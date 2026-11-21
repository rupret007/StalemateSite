import { RANKS, SUITS, handValue } from './cards.js';
import { DEFAULT_RULES, INITIAL_BANKROLL, MIN_BET, isBlackjack, isSoft17 } from './turdjack-engine.js';
import { shuffleDeck } from './arcade-deck.js';

export const TURDJACK_MATCH_VERSION = 1;
export const JACK_SEATS = Object.freeze(['one', 'two', 'three', 'four']);
export const JACK_STAKES = Object.freeze([10, 20, 50, 100]);
const deck = Object.freeze(Array.from({ length: DEFAULT_RULES.decks * 52 }, (_, id) => Object.freeze({
  suit: SUITS[Math.floor(id / 13) % 4], rank: RANKS[id % 13]
})));
const cardId = id => Number.isInteger(id) && id >= 0 && id < deck.length;
const count = value => Number.isSafeInteger(value) && value >= 0;
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9-]{5,80}$/.test(value);
const cards = ids => ids.map(id => deck[id]);
const total = ids => handValue(cards(ids));
const natural = hand => !hand.split && isBlackjack(cards(hand.cards));
const inventory = () => shuffleDeck(deck.map((_, id) => id));
const makeHand = (ids, stake, split = false) => ({ cards: ids, stake, split, state: 'open', returned: null, outcome: null });
const resetSeat = chips => ({ chips, wager: null, cover: null, hands: [] });
const seatMap = (players, create) => Object.fromEntries(players.map(seat => [seat, create(seat)]));
const validPlayers = players => Array.isArray(players) && players.length >= 2 && players.length <= 4 &&
  players[0] === JACK_SEATS[0] && new Set(players).size === players.length && players.every(seat => JACK_SEATS.includes(seat));

function validHand(hand) {
  return Array.isArray(hand?.cards) && hand.cards.length >= 2 && hand.cards.every(cardId) &&
    [10, 20, 40, 50, 100, 200].includes(hand.stake) && typeof hand.split === 'boolean' &&
    ['open', 'stand', 'bust', 'surrender'].includes(hand.state) &&
    (hand.returned === null || count(hand.returned) && hand.returned <= 500) &&
    [null, 'win', 'blackjack', 'push', 'lose', 'bust', 'surrender'].includes(hand.outcome);
}

function validCheckpoint(state) {
  if (state?.version !== TURDJACK_MATCH_VERSION || !validId(state.id) || !count(state.revision) ||
      !count(state.round) || state.round < 1 || state.round > state.revision + 1 ||
      !validPlayers(state.players) || !['wager', 'insurance', 'play', 'settled'].includes(state.phase) ||
      typeof state.finished !== 'boolean' || (state.finished && !['wager', 'settled'].includes(state.phase)) ||
      ![state.shoe, state.discard, state.dealer].every(Array.isArray) ||
      !(state.active === null || state.players.includes(state.active)) ||
      !state.players.every(seat => {
        const player = state.seats?.[seat];
        return count(player?.chips) && [null, 0, ...JACK_STAKES].includes(player.wager) &&
          [null, 'none', 'insured', 'even'].includes(player.cover) &&
          Array.isArray(player.hands) && player.hands.length <= 2 && player.hands.every(validHand);
      })) { return false; }
  const partition = [...state.shoe, ...state.discard, ...state.dealer, ...state.players.flatMap(seat =>
    state.seats[seat].hands.flatMap(hand => hand.cards))];
  if (partition.length !== deck.length || !partition.every(cardId) || new Set(partition).size !== deck.length) { return false; }
  if (state.phase === 'wager') { return !state.dealer.length && state.players.every(seat => !state.seats[seat].hands.length); }
  if (state.dealer.length < 2) { return false; }
  return state.phase === 'play' ? !!state.active && state.seats[state.active].hands.some(hand => hand.state === 'open') : state.active === null;
}

function handSettlement(hand, dealer, dealerNatural, evenMoney) {
  if (evenMoney) { return ['blackjack', hand.stake * 2]; }
  if (hand.state === 'surrender') { return ['surrender', hand.stake / 2]; }
  if (hand.state === 'bust') { return ['bust', 0]; }
  if (natural(hand)) { return dealerNatural ? ['push', hand.stake] : ['blackjack', hand.stake * (1 + DEFAULT_RULES.blackjackPayout)]; }
  if (dealerNatural) { return ['lose', 0]; }
  const score = total(hand.cards), dealerScore = total(dealer);
  if (dealerScore > 21 || score > dealerScore) { return ['win', hand.stake * 2]; }
  return score === dealerScore ? ['push', hand.stake] : ['lose', 0];
}

export class TurdJackMatch {
  #state;

  constructor(id, players, saved = null) {
    if (!validId(id) || !validPlayers(players)) { throw new TypeError('Invalid Crapjack table identity'); }
    if (saved && (saved.id !== id || !validCheckpoint(saved))) { throw new TypeError('Invalid Crapjack checkpoint'); }
    this.#state = saved ? globalThis.structuredClone(saved) : {
      version: TURDJACK_MATCH_VERSION, id, players: [...players], revision: 0, round: 1, phase: 'wager',
      finished: false, active: null, shoe: inventory(), discard: [], dealer: [], seats: seatMap(players, () => resetSeat(INITIAL_BANKROLL))
    };
  }

  static restore(saved) { return new TurdJackMatch(saved?.id, saved?.players, saved); }
  get finished() { return this.#state.finished; }
  get players() { return this.#state.players.slice(); }
  checkpoint() { return globalThis.structuredClone(this.#state); }

  #actions(seat) {
    const state = this.#state, player = state.seats[seat];
    if (!player || state.finished) { return []; }
    if (state.phase === 'wager') {
      return player.chips < MIN_BET ? ['wager', 'recharge'] : ['wager'];
    }
    if (state.phase === 'insurance' && player.hands.length && player.cover === null) {
      return ['skip-cover', ...(natural(player.hands[0]) || player.chips >= player.wager / 2 ? ['cover'] : [])];
    }
    if (state.phase === 'settled') { return ['next-round']; }
    if (state.phase !== 'play' || state.active !== seat) { return []; }
    const hand = player.hands.find(value => value.state === 'open');
    if (!hand) { return []; }
    const first = hand.cards.length === 2, enough = player.chips >= hand.stake;
    return ['hit', 'stand',
      ...(first && enough && (!hand.split || DEFAULT_RULES.allowDoubleAfterSplit) ? ['double'] : []),
      ...(first && !hand.split && enough && deck[hand.cards[0]].rank === deck[hand.cards[1]].rank ? ['split'] : []),
      ...(first && !hand.split ? ['surrender'] : [])];
  }

  view(seat) {
    const { id, players, revision, round, phase, finished, active, dealer, seats } = this.#state;
    const reveal = phase === 'settled', own = players.includes(seat) ? seats[seat] : null;
    const actions = this.#actions(seat);
    if (own && !finished && seat === players[0] && (phase === 'wager' || reveal)) { actions.push('finish'); }
    return {
      version: TURDJACK_MATCH_VERSION, game: 'turdjack', id, players: [...players], revision, round, phase, active,
      dealer: cards(reveal ? dealer : dealer.slice(0, 1)).map(card => ({ ...card })),
      dealerHidden: dealer.length > 1 && !reveal,
      dealerTotal: reveal ? total(dealer) : null,
      table: seatMap(players, position => ({
        wager: seats[position].wager, hands: seats[position].hands.map(hand => ({ count: hand.cards.length, outcome: reveal ? hand.outcome : null })),
        ready: phase === 'insurance' ? !seats[position].hands.length || seats[position].cover !== null : seats[position].wager !== null
      })),
      self: own && {
        chips: own.chips, wager: own.wager, cover: own.cover,
        hands: own.hands.map(hand => ({
          cards: cards(hand.cards).map(card => ({ ...card })), total: total(hand.cards), stake: hand.stake,
          active: active === seat && hand === own.hands.find(value => value.state === 'open'),
          outcome: reveal ? hand.outcome : null, returned: reveal ? hand.returned : null
        }))
      },
      stakes: [...JACK_STAKES], actions, result: finished ? { reason: 'table-ended' } : null
    };
  }

  #settle() {
    const state = this.#state;
    const dealerNatural = isBlackjack(cards(state.dealer));
    const needsDealer = state.players.some(seat => state.seats[seat].hands.some(hand => hand.state === 'stand' && !natural(hand)));
    if (!dealerNatural && needsDealer) {
      while (total(state.dealer) < 17 || (DEFAULT_RULES.dealerHitsSoft17 && isSoft17(cards(state.dealer)))) {
        state.dealer.push(state.shoe.pop());
      }
    }
    for (const seat of state.players) {
      const player = state.seats[seat];
      if (player.cover === 'insured' && dealerNatural) { player.chips += player.wager / 2 * 3; }
      for (const hand of player.hands) {
        [hand.outcome, hand.returned] = handSettlement(hand, state.dealer, dealerNatural, player.cover === 'even');
        player.chips += hand.returned;
      }
    }
    state.phase = 'settled';
    state.active = null;
  }

  #advance() {
    const state = this.#state;
    state.active = state.players.find(seat => state.seats[seat].hands.some(hand => hand.state === 'open')) ?? null;
    if (!state.active) { this.#settle(); }
  }

  #startPlay() {
    const state = this.#state;
    if (isBlackjack(cards(state.dealer))) { this.#settle(); return; }
    for (const seat of state.players) {
      const hand = state.seats[seat].hands[0];
      if (hand && natural(hand)) { hand.state = 'stand'; }
    }
    state.phase = 'play';
    this.#advance();
  }

  #deal() {
    const state = this.#state;
    if (state.shoe.length < deck.length / 2) {
      state.shoe = inventory();
      state.discard = [];
    }
    const playing = state.players.filter(seat => state.seats[seat].wager > 0);
    for (const seat of playing) {
      const player = state.seats[seat];
      player.chips -= player.wager;
      player.hands = [makeHand([], player.wager)];
    }
    for (let n = 0; n < 2; n++) {
      for (const seat of playing) { state.seats[seat].hands[0].cards.push(state.shoe.pop()); }
      state.dealer.push(state.shoe.pop());
    }
    if (DEFAULT_RULES.allowInsurance && deck[state.dealer[0]].rank === 'A') { state.phase = 'insurance'; }
    else { this.#startPlay(); }
  }

  #takeAction(seat, action) {
    const state = this.#state, player = state.seats[seat];
    const hand = player.hands.find(value => value.state === 'open');
    if (action === 'split') {
      player.chips -= hand.stake;
      const moved = hand.cards.pop(), splitAces = deck[moved].rank === 'A' && !DEFAULT_RULES.allowHitSplitAces;
      hand.split = true;
      hand.cards.push(state.shoe.pop());
      const second = makeHand([moved, state.shoe.pop()], hand.stake, true);
      player.hands.push(second);
      for (const split of player.hands) {
        if (splitAces || total(split.cards) === 21) { split.state = 'stand'; }
      }
    } else if (action === 'surrender') { hand.state = 'surrender'; }
    else if (action === 'stand') { hand.state = 'stand'; }
    else {
      if (action === 'double') { player.chips -= hand.stake; hand.stake *= 2; }
      hand.cards.push(state.shoe.pop());
      const score = total(hand.cards);
      if (score > 21) { hand.state = 'bust'; }
      else if (score === 21 || action === 'double') { hand.state = 'stand'; }
    }
    this.#advance();
  }

  command(seat, frame) {
    const state = this.#state, player = state.seats[seat];
    if (!state.players.includes(seat) || !player) { return { ok: false, reason: 'unavailable' }; }
    if (frame?.id !== state.id || frame.version !== TURDJACK_MATCH_VERSION) { return { ok: false, reason: 'match-changed' }; }
    if (frame.revision !== state.revision) { return { ok: false, reason: 'stale' }; }
    if (state.finished) { return { ok: false, reason: 'finished' }; }
    const { action } = frame;
    if (action === 'finish' && seat === state.players[0] && ['wager', 'settled'].includes(state.phase)) {
      state.finished = true;
    } else if (!this.#actions(seat).includes(action)) { return { ok: false, reason: 'action-unavailable' }; }
    else if (action === 'recharge') { player.chips = INITIAL_BANKROLL; }
    else if (action === 'wager') {
      if (![0, ...JACK_STAKES].includes(frame.chips) || frame.chips > player.chips) { return { ok: false, reason: 'invalid-wager' }; }
      player.wager = frame.chips;
      if (state.players.every(position => state.seats[position].wager !== null) &&
          state.players.some(position => state.seats[position].wager > 0)) { this.#deal(); }
    } else if (action === 'cover' || action === 'skip-cover') {
      player.cover = action === 'skip-cover' ? 'none' : natural(player.hands[0]) ? 'even' : 'insured';
      if (player.cover === 'insured') { player.chips -= player.wager / 2; }
      if (state.players.every(position => !state.seats[position].hands.length || state.seats[position].cover !== null)) { this.#startPlay(); }
    } else if (action === 'next-round') {
      state.discard.push(...state.dealer, ...state.players.flatMap(position => state.seats[position].hands.flatMap(hand => hand.cards)));
      state.seats = seatMap(state.players, position => resetSeat(state.seats[position].chips));
      state.dealer = [];
      state.phase = 'wager';
      state.round++;
    } else { this.#takeAction(seat, action); }
    state.revision++;
    return { ok: true };
  }
}
