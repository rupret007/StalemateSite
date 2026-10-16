/* Shared continue store for the six-game suite.
   Classic script: attaches TurdSuiteTableContinue on globalThis.
   Tests import games/table-continue.js, which re-exports this API. */
(function attachTableContinue(root) {
  'use strict';

  const CONTINUE_KEY = 'turdsuite_continue_v1';
  const GUIDE_SEEN_KEY = 'turdsuite_guides_seen_v1';
  const CONTINUE_VERSION = 1;
  const CONTINUE_MAX_BYTES = 48 * 1024;

  const LIVE_HUB_GAMES = [
    'TurdAnoid.html',
    'turdtris.html',
    'turdjack.html',
    'crapeights.html',
    'turdrummy.html',
    'turdspades.html'
  ];

  const TABLE_CONTINUE_GAMES = [
    'turdjack.html',
    'crapeights.html',
    'turdrummy.html',
    'turdspades.html'
  ];

  const KIND_BY_PAGE = {
    'turdjack.html': 'turdjack',
    'crapeights.html': 'crapeights',
    'turdrummy.html': 'turdrummy',
    'turdspades.html': 'turdspades'
  };
  const JACK_DECKS = new Set([1, 2, 4, 6, 8]);
  const JACK_PAYOUTS = new Set([1.2, 1.5]);
  const JACK_STAT_KEYS = [
    'hands',
    'wins',
    'losses',
    'pushes',
    'surrenders',
    'blackjacks',
    'insuranceBets',
    'insuranceWins',
    'decisions',
    'correctDecisions',
    'bestDecisionStreak'
  ];

  const SPADE_SUITS = new Set(['C', 'D', 'H', 'S']);
  const EIGHTS_RANKS = new Set(['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']);
  const SPADE_PHASES = new Set(['bidding', 'play', 'roundEnd', 'matchEnd']);
  const RUMMY_PHASES = new Set(['draw', 'discard']);
  const RUMMY_SEATS = new Set(['player', 'ai']);
  const NAME_RE = /^[A-Za-z][A-Za-z .'-]{0,23}$/;

  function kindForPage(page) {
    return KIND_BY_PAGE[page] || '';
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function hasDangerousKey(value) {
    return (
      Object.prototype.hasOwnProperty.call(value, '__proto__') ||
      Object.prototype.hasOwnProperty.call(value, 'constructor') ||
      Object.prototype.hasOwnProperty.call(value, 'prototype')
    );
  }

  function finiteInt(value, min, max) {
    if (typeof value !== 'number' || !Number.isInteger(value) || !Number.isFinite(value)) {
      return null;
    }
    if (value < min || value > max) {
      return null;
    }
    return value;
  }

  function cleanString(value, max) {
    if (typeof value !== 'string') {
      return null;
    }
    if (value.length > max) {
      return null;
    }
    if (/[<>]/.test(value)) {
      return null;
    }
    return value;
  }

  function cleanCardId(value) {
    const id = cleanString(value, 40);
    if (id === null || !id) {
      return null;
    }
    return id;
  }

  function cleanSpadeCard(card) {
    if (!isPlainObject(card) || hasDangerousKey(card)) {
      return null;
    }
    const id = cleanCardId(card.id);
    const suit = cleanString(card.suit, 1);
    const rank = finiteInt(card.rank, 2, 14);
    if (!id || !SPADE_SUITS.has(suit) || rank === null) {
      return null;
    }
    return { id, suit, rank };
  }

  function cleanRummyCard(card) {
    if (!isPlainObject(card) || hasDangerousKey(card)) {
      return null;
    }
    const id = cleanCardId(card.id);
    const suit = cleanString(card.suit, 1);
    const rank = finiteInt(card.rank, 1, 13);
    if (!id || !SPADE_SUITS.has(suit) || rank === null) {
      return null;
    }
    return { id, suit, rank };
  }

  function cleanEightsCard(card) {
    if (!isPlainObject(card) || hasDangerousKey(card)) {
      return null;
    }
    const id = finiteInt(card.id, 1, 100000);
    const suit = cleanString(card.suit, 1);
    const rank = cleanString(card.rank, 2);
    if (id === null || !SPADE_SUITS.has(suit) || !EIGHTS_RANKS.has(rank)) {
      return null;
    }
    return { id, suit, rank };
  }

  function uniqueCardKeys(cards, keyFn) {
    const seen = new Set();
    for (const card of cards) {
      const key = keyFn(card);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
    }
    return true;
  }

  function cleanCardList(list, cleaner, max) {
    if (!Array.isArray(list) || list.length > max) {
      return null;
    }
    const cards = [];
    for (const item of list) {
      const card = cleaner(item);
      if (!card) {
        return null;
      }
      cards.push(card);
    }
    return cards;
  }

  function validateSpadesSnapshot(snapshot) {
    if (!isPlainObject(snapshot) || hasDangerousKey(snapshot)) {
      return null;
    }
    if (snapshot.kind !== 'turdspades' || snapshot.v !== CONTINUE_VERSION) {
      return null;
    }
    const phase = cleanString(snapshot.phase, 16);
    if (!SPADE_PHASES.has(phase)) {
      return null;
    }
    const round = finiteInt(snapshot.round, 1, 200);
    const dealer = finiteInt(snapshot.dealer, 0, 3);
    const leader = finiteInt(snapshot.leader, 0, 3);
    const currentPlayer = finiteInt(snapshot.currentPlayer, 0, 3);
    const bidTurn = finiteInt(snapshot.bidTurn, 0, 3);
    const bidChoice = finiteInt(snapshot.bidChoice, 0, 13);
    if (
      round === null ||
      dealer === null ||
      leader === null ||
      currentPlayer === null ||
      bidTurn === null ||
      bidChoice === null
    ) {
      return null;
    }
    if (!Array.isArray(snapshot.scores) || snapshot.scores.length !== 2) {
      return null;
    }
    if (!Array.isArray(snapshot.bags) || snapshot.bags.length !== 2) {
      return null;
    }
    const scores = snapshot.scores.map((score) => finiteInt(score, -5000, 5000));
    const bags = snapshot.bags.map((bag) => finiteInt(bag, 0, 30));
    if (scores.includes(null) || bags.includes(null)) {
      return null;
    }
    if (!Array.isArray(snapshot.bids) || snapshot.bids.length !== 4) {
      return null;
    }
    const bids = snapshot.bids.map((bid) => {
      if (bid === null) {
        return null;
      }
      return finiteInt(bid, 0, 13);
    });
    if (bids.some((bid, index) => snapshot.bids[index] !== null && bid === null)) {
      return null;
    }
    if (!Array.isArray(snapshot.tricks) || snapshot.tricks.length !== 4) {
      return null;
    }
    const tricks = snapshot.tricks.map((trick) => finiteInt(trick, 0, 13));
    if (tricks.includes(null)) {
      return null;
    }
    if (!Array.isArray(snapshot.hands) || snapshot.hands.length !== 4) {
      return null;
    }
    const hands = snapshot.hands.map((hand) => cleanCardList(hand, cleanSpadeCard, 13));
    if (hands.includes(null)) {
      return null;
    }
    if (!Array.isArray(snapshot.trick) || snapshot.trick.length > 4) {
      return null;
    }
    const trick = [];
    for (const entry of snapshot.trick) {
      if (!isPlainObject(entry) || hasDangerousKey(entry)) {
        return null;
      }
      const player = finiteInt(entry.player, 0, 3);
      const card = cleanSpadeCard(entry.card);
      if (player === null || !card) {
        return null;
      }
      trick.push({ player, card });
    }
    const allCards = hands.flat().concat(trick.map((entry) => entry.card));
    if (allCards.length > 52) {
      return null;
    }
    if (!uniqueCardKeys(allCards, (card) => `${card.suit}:${card.rank}`)) {
      return null;
    }
    if (!uniqueCardKeys(allCards, (card) => card.id)) {
      return null;
    }
    const selected = snapshot.selected === null ? null : cleanCardId(snapshot.selected);
    if (snapshot.selected !== null && !selected) {
      return null;
    }
    const sortMode = cleanString(snapshot.sortMode, 8);
    if (sortMode !== 'suit' && sortMode !== 'rank') {
      return null;
    }
    const msg = cleanString(snapshot.msg, 500);
    const summary = cleanString(snapshot.summary, 800);
    const lastRoundTone = cleanString(snapshot.lastRoundTone, 16);
    if (msg === null || summary === null) {
      return null;
    }
    if (!['neutral', 'victory', 'defeat', 'draw'].includes(lastRoundTone)) {
      return null;
    }
    const spadesBroken = snapshot.spadesBroken === true;
    return {
      kind: 'turdspades',
      v: CONTINUE_VERSION,
      round,
      dealer,
      leader,
      currentPlayer,
      bidTurn,
      phase,
      scores,
      bags,
      bids,
      tricks,
      hands,
      trick,
      spadesBroken,
      selected,
      bidChoice,
      sortMode,
      msg,
      summary,
      lastRoundTone
    };
  }

  function validateRummySnapshot(snapshot) {
    if (!isPlainObject(snapshot) || hasDangerousKey(snapshot)) {
      return null;
    }
    if (snapshot.kind !== 'turdrummy' || snapshot.v !== CONTINUE_VERSION) {
      return null;
    }
    const phase = cleanString(snapshot.phase, 16);
    const turn = cleanString(snapshot.turn, 8);
    const dealer = cleanString(snapshot.dealer, 8);
    if (!RUMMY_PHASES.has(phase) || !RUMMY_SEATS.has(turn) || !RUMMY_SEATS.has(dealer)) {
      return null;
    }
    const round = finiteInt(snapshot.round, 0, 200);
    const playerScore = finiteInt(snapshot.playerScore, 0, 5000);
    const aiScore = finiteInt(snapshot.aiScore, 0, 5000);
    if (round === null || playerScore === null || aiScore === null) {
      return null;
    }
    const stock = cleanCardList(snapshot.stock, cleanRummyCard, 52);
    const discard = cleanCardList(snapshot.discard, cleanRummyCard, 52);
    const playerHand = cleanCardList(snapshot.playerHand, cleanRummyCard, 12);
    const aiHand = cleanCardList(snapshot.aiHand, cleanRummyCard, 12);
    if (!stock || !discard || !playerHand || !aiHand) {
      return null;
    }
    const allCards = stock.concat(discard, playerHand, aiHand);
    if (allCards.length > 52) {
      return null;
    }
    if (!uniqueCardKeys(allCards, (card) => `${card.suit}:${card.rank}`)) {
      return null;
    }
    if (!uniqueCardKeys(allCards, (card) => card.id)) {
      return null;
    }
    if (snapshot.initialized && allCards.length !== 52) {
      return null;
    }
    const selectedCardId =
      snapshot.selectedCardId === null ? null : cleanCardId(snapshot.selectedCardId);
    const drawnCardId = snapshot.drawnCardId === null ? null : cleanCardId(snapshot.drawnCardId);
    if (snapshot.selectedCardId !== null && !selectedCardId) {
      return null;
    }
    if (snapshot.drawnCardId !== null && !drawnCardId) {
      return null;
    }
    const drawnCardSource =
      snapshot.drawnCardSource === null ? null : cleanString(snapshot.drawnCardSource, 16);
    if (
      snapshot.drawnCardSource !== null &&
      drawnCardSource !== 'stock' &&
      drawnCardSource !== 'discard'
    ) {
      return null;
    }
    const playerSortMode = cleanString(snapshot.playerSortMode, 8);
    if (playerSortMode !== 'suit' && playerSortMode !== 'rank') {
      return null;
    }
    const message = cleanString(snapshot.message, 500);
    const roundSummary = cleanString(snapshot.roundSummary, 800);
    const lastAiAction = cleanString(snapshot.lastAiAction, 240);
    if (message === null || roundSummary === null || lastAiAction === null) {
      return null;
    }
    if (typeof snapshot.roundOver !== 'boolean' || typeof snapshot.matchOver !== 'boolean') {
      return null;
    }
    if (typeof snapshot.initialized !== 'boolean' || !snapshot.initialized) {
      return null;
    }
    return {
      kind: 'turdrummy',
      v: CONTINUE_VERSION,
      round,
      dealer,
      turn,
      phase,
      playerScore,
      aiScore,
      stock,
      discard,
      playerHand,
      aiHand,
      selectedCardId,
      drawnCardId,
      drawnCardSource,
      playerSortMode,
      message,
      roundSummary,
      lastAiAction,
      roundOver: snapshot.roundOver,
      matchOver: snapshot.matchOver,
      initialized: true
    };
  }

  function validateEightsSnapshot(snapshot) {
    if (!isPlainObject(snapshot) || hasDangerousKey(snapshot)) {
      return null;
    }
    if (snapshot.kind !== 'crapeights' || snapshot.v !== CONTINUE_VERSION) {
      return null;
    }
    if (!Array.isArray(snapshot.players) || snapshot.players.length !== 4) {
      return null;
    }
    const players = [];
    for (let i = 0; i < snapshot.players.length; i += 1) {
      const player = snapshot.players[i];
      if (!isPlainObject(player) || hasDangerousKey(player)) {
        return null;
      }
      const name = cleanString(player.name, 24);
      if (!name || !NAME_RE.test(name)) {
        return null;
      }
      if (i === 0 && (player.human !== true || name !== 'You')) {
        return null;
      }
      if (i > 0 && player.human !== false) {
        return null;
      }
      const score = finiteInt(player.score, 0, 5000);
      const hand = cleanCardList(player.hand, cleanEightsCard, 52);
      if (score === null || !hand) {
        return null;
      }
      players.push({ name, human: i === 0, hand, score });
    }
    const deck = cleanCardList(snapshot.deck, cleanEightsCard, 52);
    const discard = cleanCardList(snapshot.discard, cleanEightsCard, 52);
    if (!deck || !discard) {
      return null;
    }
    const allCards = players.flatMap((player) => player.hand).concat(deck, discard);
    if (allCards.length > 52 || allCards.length < 1) {
      return null;
    }
    if (!uniqueCardKeys(allCards, (card) => `${card.suit}:${card.rank}`)) {
      return null;
    }
    if (!uniqueCardKeys(allCards, (card) => String(card.id))) {
      return null;
    }
    const roundNumber = finiteInt(snapshot.roundNumber, 1, 200);
    const currentPlayer = finiteInt(snapshot.currentPlayer, 0, 3);
    const direction = snapshot.direction === -1 ? -1 : snapshot.direction === 1 ? 1 : null;
    const activeSuit = cleanString(snapshot.activeSuit, 1);
    const pendingDrawCards = finiteInt(snapshot.pendingDrawCards, 0, 40);
    const pendingSkips = finiteInt(snapshot.pendingSkips, 0, 12);
    const nextCardId = finiteInt(snapshot.nextCardId, 1, 100000);
    if (
      roundNumber === null ||
      currentPlayer === null ||
      direction === null ||
      !SPADE_SUITS.has(activeSuit) ||
      pendingDrawCards === null ||
      pendingSkips === null ||
      nextCardId === null
    ) {
      return null;
    }
    if (
      typeof snapshot.roundActive !== 'boolean' ||
      typeof snapshot.hasDrawnThisTurn !== 'boolean'
    ) {
      return null;
    }
    const selectedCardId =
      snapshot.selectedCardId === null ? null : finiteInt(snapshot.selectedCardId, 1, 100000);
    if (snapshot.selectedCardId !== null && selectedCardId === null) {
      return null;
    }
    let pendingWildCard = null;
    if (snapshot.pendingWildCard !== null && snapshot.pendingWildCard !== undefined) {
      pendingWildCard = cleanEightsCard(snapshot.pendingWildCard);
      if (!pendingWildCard) {
        return null;
      }
    }
    if (!Array.isArray(snapshot.historyLog) || snapshot.historyLog.length > 16) {
      return null;
    }
    const historyLog = [];
    for (const line of snapshot.historyLog) {
      const clean = cleanString(line, 180);
      if (clean === null) {
        return null;
      }
      historyLog.push(clean);
    }
    let overlay = null;
    if (snapshot.overlay) {
      if (!isPlainObject(snapshot.overlay) || hasDangerousKey(snapshot.overlay)) {
        return null;
      }
      const title = cleanString(snapshot.overlay.title, 80);
      const summary = cleanString(snapshot.overlay.summary, 240);
      const tone = cleanString(snapshot.overlay.tone, 20);
      const flavor = cleanString(snapshot.overlay.flavor, 200);
      const kicker = cleanString(snapshot.overlay.kicker, 40);
      if (!title || !summary || !tone || flavor === null || kicker === null) {
        return null;
      }
      if (typeof snapshot.overlay.matchFinished !== 'boolean') {
        return null;
      }
      overlay = {
        title,
        summary,
        matchFinished: snapshot.overlay.matchFinished,
        tone,
        flavor,
        kicker
      };
    }
    return {
      kind: 'crapeights',
      v: CONTINUE_VERSION,
      players,
      deck,
      discard,
      roundNumber,
      currentPlayer,
      direction,
      activeSuit,
      pendingDrawCards,
      pendingSkips,
      roundActive: snapshot.roundActive,
      hasDrawnThisTurn: snapshot.hasDrawnThisTurn,
      selectedCardId,
      pendingWildCard,
      historyLog,
      nextCardId,
      overlay
    };
  }

  function cleanJackCard(card) {
    if (!isPlainObject(card) || hasDangerousKey(card)) {
      return null;
    }
    const suit = cleanString(card.suit, 1);
    const rank = cleanString(card.rank, 2);
    if (!SPADE_SUITS.has(suit) || !EIGHTS_RANKS.has(rank)) {
      return null;
    }
    return { rank, suit };
  }

  function jackInventoryOk(cards, decks) {
    if (!JACK_DECKS.has(decks) || cards.length !== decks * 52) {
      return false;
    }
    const counts = new Map();
    for (const card of cards) {
      const key = `${card.suit}:${card.rank}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    if (counts.size !== 52) {
      return false;
    }
    for (const count of counts.values()) {
      if (count !== decks) {
        return false;
      }
    }
    return true;
  }

  function cleanJackStats(raw) {
    if (!isPlainObject(raw) || hasDangerousKey(raw)) {
      return null;
    }
    const stats = {};
    for (const key of JACK_STAT_KEYS) {
      const value = finiteInt(raw[key], 0, 10000000);
      if (value === null) {
        return null;
      }
      stats[key] = value;
    }
    return stats;
  }

  function cleanJackRules(raw, shoeDecks) {
    if (!isPlainObject(raw) || hasDangerousKey(raw)) {
      return null;
    }
    const decks = finiteInt(raw.decks, 1, 8);
    if (!JACK_DECKS.has(decks) || decks !== shoeDecks) {
      return null;
    }
    if (typeof raw.blackjackPayout !== 'number' || !JACK_PAYOUTS.has(raw.blackjackPayout)) {
      return null;
    }
    if (
      typeof raw.dealerHitsSoft17 !== 'boolean' ||
      typeof raw.allowDoubleAfterSplit !== 'boolean' ||
      typeof raw.allowSurrender !== 'boolean' ||
      typeof raw.allowInsurance !== 'boolean' ||
      typeof raw.allowHitSplitAces !== 'boolean'
    ) {
      return null;
    }
    return {
      dealerHitsSoft17: raw.dealerHitsSoft17,
      blackjackPayout: raw.blackjackPayout,
      decks,
      allowDoubleAfterSplit: raw.allowDoubleAfterSplit,
      allowSurrender: raw.allowSurrender,
      allowInsurance: raw.allowInsurance,
      allowHitSplitAces: raw.allowHitSplitAces
    };
  }

  function validateJackSnapshot(snapshot) {
    if (!isPlainObject(snapshot) || hasDangerousKey(snapshot)) {
      return null;
    }
    if (snapshot.kind !== 'turdjack' || snapshot.v !== CONTINUE_VERSION) {
      return null;
    }
    if (snapshot.roundActive !== true) {
      return null;
    }
    const shoeDecks = finiteInt(snapshot.shoeDecks, 1, 8);
    if (!JACK_DECKS.has(shoeDecks)) {
      return null;
    }
    const bankroll = finiteInt(snapshot.bankroll, 0, 10000000);
    const currentBet = finiteInt(snapshot.currentBet, 10, 10000000);
    const splitBet = finiteInt(snapshot.splitBet, 0, 10000000);
    const lastBet = finiteInt(snapshot.lastBet, 0, 10000000);
    const runningCount = finiteInt(snapshot.runningCount, -2000, 2000);
    const shoeGeneration = finiteInt(snapshot.shoeGeneration, 0, 10000000);
    const cutCardsRemaining = finiteInt(snapshot.cutCardsRemaining, 0, 416);
    const activeHandIndex = finiteInt(snapshot.activeHandIndex, 0, 1);
    if (
      bankroll === null ||
      currentBet === null ||
      splitBet === null ||
      lastBet === null ||
      runningCount === null ||
      shoeGeneration === null ||
      cutCardsRemaining === null ||
      activeHandIndex === null
    ) {
      return null;
    }
    if (
      typeof snapshot.dealerHoleHidden !== 'boolean' ||
      typeof snapshot.dealerHoleCountResolved !== 'boolean' ||
      typeof snapshot.firstDecisionOpen !== 'boolean' ||
      typeof snapshot.splitRound !== 'boolean'
    ) {
      return null;
    }
    let dealerHoleShoeGeneration = null;
    if (
      snapshot.dealerHoleShoeGeneration !== null &&
      snapshot.dealerHoleShoeGeneration !== undefined
    ) {
      dealerHoleShoeGeneration = finiteInt(snapshot.dealerHoleShoeGeneration, 0, 10000000);
      if (dealerHoleShoeGeneration === null) {
        return null;
      }
    }
    const playerHand = cleanCardList(snapshot.playerHand, cleanJackCard, 21);
    const dealerHand = cleanCardList(snapshot.dealerHand, cleanJackCard, 21);
    const splitHand = cleanCardList(snapshot.splitHand, cleanJackCard, 21);
    const shoe = cleanCardList(snapshot.shoe, cleanJackCard, 416);
    const discard = cleanCardList(snapshot.discard, cleanJackCard, 416);
    if (!playerHand || !dealerHand || !splitHand || !shoe || !discard) {
      return null;
    }
    if (playerHand.length < 2 || dealerHand.length < 2) {
      return null;
    }
    if (snapshot.splitRound && splitHand.length < 1) {
      return null;
    }
    if (!snapshot.splitRound && splitHand.length !== 0) {
      return null;
    }
    if (activeHandIndex === 1 && !snapshot.splitRound) {
      return null;
    }
    const allCards = playerHand.concat(dealerHand, splitHand, shoe, discard);
    if (!jackInventoryOk(allCards, shoeDecks)) {
      return null;
    }
    const rules = cleanJackRules(snapshot.rules, shoeDecks);
    const stats = cleanJackStats(snapshot.stats);
    const status = cleanString(snapshot.status, 500);
    if (!rules || !stats || status === null) {
      return null;
    }
    const decisionStreak = finiteInt(snapshot.decisionStreak, 0, 10000);
    const hotStreak = finiteInt(snapshot.hotStreak, 0, 10000);
    const coldStreak = finiteInt(snapshot.coldStreak, 0, 10000);
    if (decisionStreak === null || hotStreak === null || coldStreak === null) {
      return null;
    }
    return {
      kind: 'turdjack',
      v: CONTINUE_VERSION,
      bankroll,
      currentBet,
      splitBet,
      lastBet,
      playerHand,
      dealerHand,
      splitHand,
      shoe,
      discard,
      runningCount,
      shoeGeneration,
      dealerHoleHidden: snapshot.dealerHoleHidden,
      dealerHoleShoeGeneration,
      dealerHoleCountResolved: snapshot.dealerHoleCountResolved,
      firstDecisionOpen: snapshot.firstDecisionOpen,
      splitRound: snapshot.splitRound,
      activeHandIndex,
      cutCardsRemaining,
      shoeDecks,
      roundActive: true,
      rules,
      stats,
      status,
      decisionStreak,
      hotStreak,
      coldStreak
    };
  }

  function validateSnapshot(page, snapshot) {
    if (!TABLE_CONTINUE_GAMES.includes(page)) {
      return null;
    }
    if (!isPlainObject(snapshot) || snapshot.kind !== kindForPage(page)) {
      return null;
    }
    if (page === 'turdspades.html') {
      return validateSpadesSnapshot(snapshot);
    }
    if (page === 'turdrummy.html') {
      return validateRummySnapshot(snapshot);
    }
    if (page === 'crapeights.html') {
      return validateEightsSnapshot(snapshot);
    }
    return validateJackSnapshot(snapshot);
  }

  function emptyStore() {
    return { v: CONTINUE_VERSION, games: {} };
  }

  function parseContinueStore(raw) {
    if (typeof raw !== 'string' || !raw || raw.length > CONTINUE_MAX_BYTES) {
      return emptyStore();
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return emptyStore();
    }
    if (!isPlainObject(parsed) || hasDangerousKey(parsed) || parsed.v !== CONTINUE_VERSION) {
      return emptyStore();
    }
    if (!isPlainObject(parsed.games) || hasDangerousKey(parsed.games)) {
      return emptyStore();
    }
    const games = {};
    for (const page of TABLE_CONTINUE_GAMES) {
      const entry = parsed.games[page];
      if (!isPlainObject(entry) || hasDangerousKey(entry) || !isPlainObject(entry.snapshot)) {
        continue;
      }
      const snapshot = validateSnapshot(page, entry.snapshot);
      if (!snapshot) {
        continue;
      }
      games[page] = {
        updatedAt: finiteInt(entry.updatedAt, 0, Number.MAX_SAFE_INTEGER) || 0,
        snapshot
      };
    }
    return { v: CONTINUE_VERSION, games };
  }

  function readStore(storage) {
    let raw = '';
    try {
      raw = storage.getItem(CONTINUE_KEY) || '';
    } catch {
      return emptyStore();
    }
    return parseContinueStore(raw);
  }

  function writeStore(storage, store) {
    const payload = JSON.stringify(store);
    if (payload.length > CONTINUE_MAX_BYTES) {
      return false;
    }
    try {
      storage.setItem(CONTINUE_KEY, payload);
      return true;
    } catch {
      return false;
    }
  }

  function rememberContinue(storage, page, snapshot) {
    const clean = validateSnapshot(page, snapshot);
    if (!clean) {
      return false;
    }
    const store = readStore(storage);
    store.games[page] = { updatedAt: Date.now(), snapshot: cloneJson(clean) };
    return writeStore(storage, store);
  }

  function loadContinue(storage, page) {
    if (!TABLE_CONTINUE_GAMES.includes(page)) {
      return null;
    }
    const entry = readStore(storage).games[page];
    return entry ? cloneJson(entry.snapshot) : null;
  }

  function clearContinue(storage, page) {
    if (!TABLE_CONTINUE_GAMES.includes(page)) {
      return false;
    }
    const store = readStore(storage);
    if (!store.games[page]) {
      return false;
    }
    delete store.games[page];
    return writeStore(storage, store);
  }

  function listContinuePages(storage) {
    return Object.keys(readStore(storage).games);
  }

  function hasContinue(storage, page) {
    return listContinuePages(storage).includes(page);
  }

  function isLiveSnapshot(page, snapshot) {
    const clean = validateSnapshot(page, snapshot);
    if (!clean) {
      return false;
    }
    if (page === 'turdspades.html') {
      return clean.phase !== 'matchEnd';
    }
    if (page === 'turdrummy.html') {
      return clean.matchOver !== true;
    }
    if (page === 'crapeights.html') {
      return !(clean.overlay && clean.overlay.matchFinished);
    }
    return clean.roundActive === true;
  }

  function listLiveContinuePages(storage) {
    const store = readStore(storage);
    return TABLE_CONTINUE_GAMES.filter((page) => {
      const entry = store.games[page];
      return !!(entry && isLiveSnapshot(page, entry.snapshot));
    });
  }

  function hasLiveContinue(storage, page) {
    return listLiveContinuePages(storage).includes(page);
  }

  function readGuideStore(storage) {
    let raw = '';
    try {
      raw = storage.getItem(GUIDE_SEEN_KEY) || '';
    } catch {
      return {};
    }
    if (typeof raw !== 'string' || !raw || raw.length > 2000) {
      return {};
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {};
    }
    if (!isPlainObject(parsed) || hasDangerousKey(parsed)) {
      return {};
    }
    const seen = {};
    for (const page of LIVE_HUB_GAMES) {
      if (parsed[page] === true) {
        seen[page] = true;
      }
    }
    return seen;
  }

  function hasSeenGuide(storage, page) {
    if (!LIVE_HUB_GAMES.includes(page)) {
      return false;
    }
    return readGuideStore(storage)[page] === true;
  }

  function markGuideSeen(storage, page) {
    if (!LIVE_HUB_GAMES.includes(page)) {
      return false;
    }
    const seen = readGuideStore(storage);
    seen[page] = true;
    try {
      storage.setItem(GUIDE_SEEN_KEY, JSON.stringify(seen));
      return true;
    } catch {
      return false;
    }
  }
  root.TurdSuiteTableContinue = {
    CONTINUE_KEY,
    GUIDE_SEEN_KEY,
    CONTINUE_VERSION,
    CONTINUE_MAX_BYTES,
    LIVE_HUB_GAMES,
    TABLE_CONTINUE_GAMES,
    kindForPage,
    isPlainObject,
    cloneJson,
    finiteInt,
    cleanString,
    validateSpadesSnapshot,
    validateRummySnapshot,
    validateEightsSnapshot,
    validateJackSnapshot,
    validateSnapshot,
    parseContinueStore,
    rememberContinue,
    loadContinue,
    clearContinue,
    listContinuePages,
    listLiveContinuePages,
    hasContinue,
    hasLiveContinue,
    isLiveSnapshot,
    hasSeenGuide,
    markGuideSeen
  };
})(globalThis);
