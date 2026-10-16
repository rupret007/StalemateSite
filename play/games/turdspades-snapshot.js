/**
 * TurdSpades continue snapshot apply/serialize — must stay aligned with turdspades.html persistTable.
 */

const PHASES = new Set(['bidding', 'play', 'roundEnd', 'matchEnd']);

/**
 * @returns {object} blank table state shell (matches turdspades.html `state` defaults)
 */
export function createSpadesTableState() {
  return {
    round: 0,
    dealer: 0,
    leader: 1,
    currentPlayer: 1,
    bidTurn: 1,
    phase: 'bidding',
    scores: [0, 0],
    bags: [0, 0],
    bids: [null, null, null, null],
    tricks: [0, 0, 0, 0],
    hands: [[], [], [], []],
    trick: [],
    spadesBroken: false,
    selected: null,
    bidChoice: 4,
    sortMode: 'suit',
    msg: '',
    summary: '',
    lastRoundTone: 'neutral',
    playedThisRound: []
  };
}

/**
 * Apply a validated turdspades v:1 snapshot onto a live state object (mutates state).
 * @param {object} state
 * @param {object} snap validated snapshot (from validateSpadesSnapshot or equivalent)
 * @returns {boolean}
 */
export function mergeSpadesContinueSnapshot(state, snap) {
  if (!state || !snap || snap.kind !== 'turdspades' || snap.v !== 1) {
    return false;
  }
  if (!Number.isInteger(snap.round) || snap.round < 1) {
    return false;
  }
  if (!Array.isArray(snap.hands) || snap.hands.length !== 4) {
    return false;
  }
  if (!Array.isArray(snap.scores) || snap.scores.length !== 2) {
    return false;
  }
  if (!Array.isArray(snap.bags) || snap.bags.length !== 2) {
    return false;
  }
  if (!PHASES.has(snap.phase)) {
    return false;
  }
  state.round = snap.round;
  state.dealer = snap.dealer;
  state.leader = snap.leader;
  state.currentPlayer = snap.currentPlayer;
  state.bidTurn = snap.bidTurn;
  state.phase = snap.phase;
  state.scores = snap.scores.slice();
  state.bags = snap.bags.slice();
  state.bids = snap.bids.slice();
  state.tricks = snap.tricks.slice();
  state.hands = snap.hands.map((hand) =>
    hand.map((card) => ({ id: card.id, suit: card.suit, rank: card.rank }))
  );
  state.trick = (snap.trick || []).map((entry) => ({
    player: entry.player,
    card: { id: entry.card.id, suit: entry.card.suit, rank: entry.card.rank }
  }));
  state.spadesBroken = !!snap.spadesBroken;
  state.selected = snap.selected;
  state.bidChoice = snap.bidChoice;
  state.sortMode = snap.sortMode === 'rank' ? 'rank' : 'suit';
  state.msg = String(snap.msg || '');
  state.summary = String(snap.summary || '');
  state.lastRoundTone = snap.lastRoundTone || 'neutral';
  state.playedThisRound = Array.isArray(snap.playedThisRound)
    ? snap.playedThisRound.map((c) => ({ id: c.id, suit: c.suit, rank: c.rank }))
    : [];
  return true;
}

/**
 * Build persist/continue payload from live state (optional playedThisRound).
 * @param {object} state
 */
export function serializeSpadesTableState(state) {
  if (!state) {
    return null;
  }
  return {
    kind: 'turdspades',
    v: 1,
    round: state.round,
    dealer: state.dealer,
    leader: state.leader,
    currentPlayer: state.currentPlayer,
    bidTurn: state.bidTurn,
    phase: state.phase,
    scores: state.scores.slice(),
    bags: state.bags.slice(),
    bids: state.bids.slice(),
    tricks: state.tricks.slice(),
    hands: state.hands.map((hand) =>
      hand.map((card) => ({ id: card.id, suit: card.suit, rank: card.rank }))
    ),
    trick: state.trick.map((entry) => ({
      player: entry.player,
      card: { id: entry.card.id, suit: entry.card.suit, rank: entry.card.rank }
    })),
    spadesBroken: !!state.spadesBroken,
    selected: state.selected,
    bidChoice: state.bidChoice,
    sortMode: state.sortMode,
    msg: String(state.msg || ''),
    summary: String(state.summary || ''),
    lastRoundTone: state.lastRoundTone,
    playedThisRound: (state.playedThisRound || []).map((c) => ({
      id: c.id,
      suit: c.suit,
      rank: c.rank
    }))
  };
}
