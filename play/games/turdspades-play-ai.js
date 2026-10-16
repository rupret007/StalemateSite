/**
 * TurdSpades bot play selection — testable, difficulty-aware.
 */

const SUIT_ORDER = { C: 0, D: 1, H: 2, S: 3 };

function rankVal(card) {
  return typeof card.rank === 'number' ? card.rank : 0;
}

function low(cards, sortFn) {
  return cards.slice().sort(sortFn)[0];
}

function high(cards, sortFn) {
  return cards.slice().sort(sortFn).reverse()[0];
}

function defaultSort(a, b) {
  return rankVal(a) - rankVal(b) || (SUIT_ORDER[a.suit] ?? 0) - (SUIT_ORDER[b.suit] ?? 0);
}

function defaultSortDesc(a, b) {
  return rankVal(b) - rankVal(a) || (SUIT_ORDER[b.suit] ?? 0) - (SUIT_ORDER[a.suit] ?? 0);
}

function publicSpadeKeys(card) {
  if (!card || card.suit !== 'S') {
    return [];
  }
  const keys = [];
  if (card.id !== undefined && card.id !== null && String(card.id) !== '') {
    keys.push(`id:${card.id}`);
  }
  if (card.rank !== undefined && card.rank !== null) {
    keys.push(`sr:${card.suit}:${card.rank}`);
  }
  return keys;
}

function countPublicSpades(trick, played) {
  const seen = new Set();
  let n = 0;
  const consider = (card) => {
    const keys = publicSpadeKeys(card);
    if (!keys.length) {
      return;
    }
    if (keys.some((key) => seen.has(key))) {
      return;
    }
    for (const key of keys) {
      seen.add(key);
    }
    n += 1;
  };
  if (Array.isArray(trick)) {
    for (const entry of trick) {
      consider(entry?.card);
    }
  }
  if (Array.isArray(played)) {
    for (const card of played) {
      consider(card);
    }
  }
  return n;
}

export function countRemainingSpades(hands, trick, played = []) {
  let inPlay = 0;
  for (const hand of hands || []) {
    if (!Array.isArray(hand)) {
      continue;
    }
    inPlay += hand.filter((c) => c.suit === 'S').length;
  }
  inPlay += countPublicSpades(trick, played);
  return Math.max(0, 13 - inPlay);
}

/** Unseen trump from the acting seat: own hand plus unique public cards. */
export function unseenSpadesForPlayer(state, player) {
  const ownHand = Array.isArray(state?.hands?.[player]) ? state.hands[player] : [];
  return countRemainingSpades([ownHand], state?.trick, state?.playedThisRound || []);
}

export function spadesPlayedHigh(played) {
  const ranks = (played || []).filter((c) => c.suit === 'S').map((c) => rankVal(c));
  return ranks.length ? Math.max(...ranks) : 0;
}

/**
 * @param {object} ctx
 * @param {object} ctx.state full table state
 * @param {number} ctx.player
 * @param {object[]} ctx.legal
 * @param {object} ctx.helpers beats, winnerEntry, pickNilCoverCard, low, high
 * @param {'easy'|'normal'|'hard'} ctx.difficulty
 */
export function pickAiPlayCard(ctx) {
  const { state, player, legal, helpers, difficulty = 'normal' } = ctx;
  if (!legal?.length) {
    return null;
  }
  const partner = (player + 2) % 4;
  const { beats, winnerEntry, pickNilCoverCard } = helpers;
  const lowFn = helpers.low || ((cards) => low(cards, defaultSort));
  const highFn = helpers.high || ((cards) => high(cards, defaultSortDesc));

  const bidSum =
    (state.bids[player] === 0 ? 0 : state.bids[player] || 0) +
    (state.bids[partner] === 0 ? 0 : state.bids[partner] || 0);
  const taken = (state.tricks[player] || 0) + (state.tricks[partner] || 0);
  const need = bidSum - taken;

  if (state.bids[player] === 0) {
    if (!state.trick.length) {
      return lowFn(legal);
    }
    const lead = state.trick[0].card.suit;
    const best = winnerEntry(state.trick)?.card;
    const losing = legal.filter((card) => !beats(card, best, lead));
    return losing.length ? highFn(losing) : lowFn(legal);
  }

  const nilCover = pickNilCoverCard(legal, partner);
  if (nilCover) {
    return nilCover;
  }

  const played = state.playedThisRound || [];
  const spadesLeft = unseenSpadesForPlayer(state, player);
  const topSpadeSeen = spadesPlayedHigh(played);

  if (!state.trick.length) {
    if (need > 0) {
      const nonSp = legal.filter((c) => c.suit !== 'S');
      const pool = nonSp.length ? nonSp : legal;
      return highFn(pool);
    }
    if (difficulty !== 'easy' && spadesLeft <= 4) {
      const lowSp = legal.filter((c) => c.suit === 'S');
      if (lowSp.length) {
        return lowFn(lowSp);
      }
    }
    return lowFn(legal);
  }

  const lead = state.trick[0].card.suit;
  const best = winnerEntry(state.trick)?.card;
  const trickWinner = winnerEntry(state.trick);
  const partnerWinning = trickWinner && trickWinner.player === partner && need <= 0;

  const follow = legal.filter((c) => c.suit === lead);
  if (follow.length) {
    if (partnerWinning && difficulty !== 'easy') {
      return lowFn(follow);
    }
    if (need > 0) {
      const canWin = follow.filter((c) => beats(c, best, lead));
      if (canWin.length) {
        return lowFn(canWin);
      }
    }
    return lowFn(follow);
  }

  const spades = legal.filter((c) => c.suit === 'S');
  if (spades.length) {
    if (partnerWinning && difficulty !== 'easy') {
      return lowFn(spades);
    }
    if (need > 0) {
      const canWin = spades.filter((c) => beats(c, best, lead));
      if (canWin.length) {
        if (difficulty === 'hard' && topSpadeSeen >= 12) {
          const under = canWin.filter((c) => rankVal(c) < topSpadeSeen);
          if (under.length) {
            return lowFn(under);
          }
        }
        return lowFn(canWin);
      }
    }
    if (difficulty === 'hard' && need <= 0) {
      return lowFn(spades);
    }
    return lowFn(spades);
  }

  return highFn(legal);
}
