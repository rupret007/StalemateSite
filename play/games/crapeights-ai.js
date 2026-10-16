/**
 * Fair, deterministic four-seat Crappy Eights decisions.
 * Accepts only the acting hand, public hand counts and public observations.
 * Classic script on the page; side-effect import in unit tests.
 */
(function (root) {
  'use strict';

  const SUITS = ['S', 'H', 'D', 'C'];
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

  function normalizeDifficulty(value) {
    const difficulty = typeof value === 'string' ? value.trim().toLowerCase() : 'normal';
    return ['easy', 'normal', 'sharp'].includes(difficulty) ? difficulty : 'normal';
  }

  function points(card) {
    if (card.rank === '8') { return 50; }
    if (card.rank === 'A') { return 1; }
    return ['J', 'Q', 'K'].includes(card.rank) ? 10 : Number(card.rank);
  }

  function createMemory() {
    return { turn: 0, seats: [] };
  }

  function observe(memory, { playerIndex, type, suit, rank } = {}) {
    if (!memory || !Array.isArray(memory.seats) || !Number.isInteger(playerIndex) ||
      playerIndex < 0 || playerIndex > 3 || !SUITS.includes(suit) ||
      !['pass', 'play'].includes(type)) {
      return memory;
    }
    memory.turn += 1;
    // A draw may have repaired a weak suit. Observations are clues, never proof.
    memory.seats.forEach((seat) => {
      SUITS.forEach((s) => { seat.shortSuits[s] *= 0.88; });
    });
    if (!memory.seats[playerIndex]) {
      memory.seats[playerIndex] = { shortSuits: { S: 0, H: 0, D: 0, C: 0 } };
    }
    const seat = memory.seats[playerIndex];
    if (type === 'pass') {
      seat.shortSuits[suit] = Math.min(2, seat.shortSuits[suit] + 1);
    } else {
      seat.shortSuits[suit] = 0;
      seat.lastSuit = suit;
      seat.lastRank = RANKS.includes(rank) ? rank : null;
    }
    return memory;
  }

  function weakness(memory, playerIndex, suit) {
    return memory?.seats?.[playerIndex]?.shortSuits?.[suit] || 0;
  }

  function chooseSuit(hand, excludeId, { nextPlayerIndex, memory, difficulty } = {}) {
    const level = normalizeDifficulty(difficulty);
    const cards = hand.filter((card) => card.rank !== '8' &&
      (excludeId === undefined || card.id !== excludeId));
    let best = 'C';
    let bestScore = -Infinity;
    SUITS.forEach((suit) => {
      const suited = cards.filter((card) => card.suit === suit);
      let score = suited.length * 12;
      if (level !== 'easy') {
        score = suited.length * 12 + suited.reduce((sum, card) => sum + points(card), 0) / 20 +
          weakness(memory, nextPlayerIndex, suit) * 7;
      }
      if (level === 'sharp') { score += routeValue(cards, suit, '8', 3); }
      if (score > bestScore) {
        best = suit;
        bestScore = score;
      }
    });
    return best;
  }

  function danger(count) {
    if (count === 1) { return 64; }
    if (count === 2) { return 36; }
    if (count === 3) { return 12; }
    return 0;
  }

  function sameCard(a, b) {
    return a === b || (a.id !== undefined && b.id !== undefined
      ? a.id === b.id : a.rank === b.rank && a.suit === b.suit);
  }

  function tieKey(card) {
    return RANKS.indexOf(card.rank) * 4 + SUITS.indexOf(card.suit);
  }

  // This is a plan through our own cards, not a prediction of hidden cards or
  // consecutive turns. A bounded search keeps large drawn hands inexpensive.
  function routeValue(hand, suit, rank, depth) {
    if (!depth || !hand.length) { return 0; }
    const options = hand.filter((card) => card.rank !== '8' &&
      (card.suit === suit || card.rank === rank));
    options.sort((a, b) => (b.rank === '2') - (a.rank === '2') ||
      points(b) - points(a) || tieKey(a) - tieKey(b));
    return Math.max(0, ...options.slice(0, 6).map((card) => {
      const rest = hand.filter((held) => !sameCard(card, held));
      const drawTwoSequence = rank === '2' && card.rank === '2' ? 12 : 0;
      return 7 + points(card) / 10 + drawTwoSequence +
        routeValue(rest, card.suit, card.rank, depth - 1);
    }));
  }

  function separateGroups(hand) {
    const remaining = hand.filter((card) => card.rank !== '8');
    let groups = 0;
    while (remaining.length) {
      groups += 1;
      const connected = [remaining.pop()];
      for (let i = 0; i < connected.length; i += 1) {
        for (let j = remaining.length - 1; j >= 0; j -= 1) {
          if (remaining[j].suit === connected[i].suit || remaining[j].rank === connected[i].rank) {
            connected.push(...remaining.splice(j, 1));
          }
        }
      }
    }
    return groups;
  }

  function chooseCard({ hand, playableCards, playerIndex = 0, counts = [],
    direction = 1, activeSuit, topCard, memory, difficulty } = {}) {
    if (!Array.isArray(hand) || !Array.isArray(playableCards)) { return null; }
    const candidates = playableCards.filter((card) => hand.some((held) => sameCard(card, held)) &&
      (!topCard || card.rank === '8' || card.suit === activeSuit || card.rank === topCard.rank));
    if (!candidates.length) { return null; }
    const level = normalizeDifficulty(difficulty);
    const seatCount = Math.max(2, counts.length || 4);
    const step = direction === -1 ? -1 : 1;
    const nextSeat = (distance, dir = step) => (playerIndex + distance * dir + seatCount * 2) % seatCount;
    const next = nextSeat(1);
    const nextDanger = danger(counts[next]);
    const otherDanger = Math.max(0, ...counts.map((count, index) => index === playerIndex ? 0 : danger(count)));

    function evaluate(card) {
      const rest = hand.filter((held) => !sameCard(card, held));
      if (!rest.length) { return 10000; }
      // Easy sheds a large ordinary card and saves wilds, with no opponent
      // tactics or inference. It is still legal, deterministic and able to win.
      if (level === 'easy') { return card.rank === '8' ? -50 : points(card); }
      const denies = card.rank === '2' || card.rank === 'J';
      const recipient = card.rank === 'Q' ? nextSeat(1, -step) : denies ? nextSeat(2) : next;
      const recipientDanger = recipient === playerIndex ? 0 : danger(counts[recipient]);
      const suit = card.rank === '8'
        ? chooseSuit(rest, undefined, { nextPlayerIndex: recipient, memory, difficulty: level }) : card.suit;
      const ordinary = rest.filter((held) => held.rank !== '8');
      const followups = ordinary.filter((held) => held.suit === suit || held.rank === card.rank);
      // Reward both the next available play and a bridge to the rest of the hand.
      const bridge = Math.max(0, ...followups.map((followup) => ordinary.filter((held) =>
        held !== followup && (held.suit === followup.suit || held.rank === followup.rank)).length));
      let score = followups.length * 8 + bridge * 2;
      score += points(card) * (otherDanger >= 36 ? 1.05 : 0.35);
      score -= recipientDanger * 0.8;
      score += weakness(memory, recipient, suit) * (6 + recipientDanger / 5);
      if (denies) {
        score += nextDanger * 1.2 + (card.rank === '2' ? 12 : 7);
      }
      if (card.rank === 'Q') {
        // Reversal is useful only after considering who receives the turn.
        score += nextDanger * 0.35 + 2;
      }
      if (card.rank === '8') {
        // Save the escape hatch in a quiet table, but shed its 50-point risk
        // when someone can go out. Keeping a wild as the final card is ideal.
        score -= otherDanger >= 36 ? 16 : 46;
        if (rest.length === 1 && ordinary.length === 1 && otherDanger < 36) { score -= 10; }
      }
      if (level === 'sharp') {
        score += routeValue(rest, suit, card.rank, 3);
        // A reserve eight reconnects isolated suit/rank groups. Its 50-point
        // liability still takes precedence when another player is almost out.
        if (card.rank === '8' && otherDanger < 36) {
          score -= Math.max(0, separateGroups(rest) - 1) * 18;
        }
      }
      return score;
    }

    // Sorting a copy makes ties reproducible without changing the caller's hand.
    return candidates.map((card) => ({ card, score: evaluate(card) }))
      .sort((a, b) => b.score - a.score || tieKey(a.card) - tieKey(b.card) ||
        (Number(a.card.id) || 0) - (Number(b.card.id) || 0))[0].card;
  }

  root.CrapeightsAI = Object.freeze({ normalizeDifficulty, createMemory, observe, chooseSuit, chooseCard });
})(globalThis);
