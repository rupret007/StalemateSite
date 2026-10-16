/**
 * Bot intent copy for TurdSpades — mirrors live table heuristics (hints only).
 */

const NAMES = ['You', 'West', 'North', 'East'];

export function formatCardLabel(card) {
  if (!card) {
    return 'a card';
  }
  const rank =
    card.rank === 14 || card.rank === 'A'
      ? 'A'
      : card.rank === 13 || card.rank === 'K'
        ? 'K'
        : card.rank === 12 || card.rank === 'Q'
          ? 'Q'
          : card.rank === 11 || card.rank === 'J'
            ? 'J'
            : String(card.rank);
  const sym = { S: '\u2660', H: '\u2665', D: '\u2666', C: '\u2663' };
  return rank + (sym[card.suit] || card.suit || '');
}

/**
 * @param {object} ctx
 * @param {number} ctx.player
 * @param {{ suit: string, rank: number }} ctx.card
 * @param {number|null} ctx.playerBid
 * @param {number|null} ctx.partnerBid
 * @param {number} ctx.teamNeed tricks still needed on partnership contract
 * @param {boolean} ctx.nilCover
 * @param {boolean} ctx.leading
 */
export function explainAiPlay(ctx) {
  const who = NAMES[ctx.player] || 'Bot';
  const card = formatCardLabel(ctx.card);
  if (ctx.nilCover) {
    return `${who} covers partner's Nil with ${card}.`;
  }
  if (ctx.playerBid === 0) {
    return `${who} ducks Nil with ${card}.`;
  }
  if (ctx.teamNeed > 0 && ctx.leading) {
    return `${who} leads for ${ctx.teamNeed} more trick${ctx.teamNeed === 1 ? '' : 's'} (${card}).`;
  }
  if (ctx.teamNeed > 0) {
    return `${who} fights for the contract (${card}).`;
  }
  if (ctx.card?.suit === 'S') {
    return `${who} dumps trump — bags watch (${card}).`;
  }
  return `${who} sloughs ${card} — contract safe.`;
}

export function teamContractNeed(bids, tricks, player, partner) {
  const bidSum = (bids[player] === 0 ? 0 : bids[player] || 0) + (bids[partner] === 0 ? 0 : bids[partner] || 0);
  const taken = (tricks[player] || 0) + (tricks[partner] || 0);
  return Math.max(0, bidSum - taken);
}

/** Heuristic expected tricks from a 13-card hand (bid hint dial). */
export function estimateExpectedTricks(hand) {
  if (!Array.isArray(hand) || !hand.length) {
    return 0;
  }
  let v = 0;
  let s = 0;
  for (const c of hand) {
    const rank = typeof c.rank === 'number' ? c.rank : 0;
    if (c.suit === 'S') {
      s++;
      if (rank >= 14) {
        v += 1;
      } else if (rank >= 13) {
        v += 0.8;
      } else if (rank >= 11) {
        v += 0.5;
      }
    } else if (rank === 14) {
      v += 0.75;
    } else if (rank === 13) {
      v += 0.45;
    } else if (rank === 12) {
      v += 0.25;
    }
  }
  if (s >= 5) {
    v += 0.9;
  }
  if (s >= 6) {
    v += 0.7;
  }
  return Math.max(0, Math.min(13, Math.round(v)));
}

export const AI_DIFFICULTY_KEY = 'turdspades_ai_difficulty_v1';

export function normalizeAiDifficulty(raw) {
  if (raw === 'easy' || raw === 'normal' || raw === 'hard') {
    return raw;
  }
  return 'normal';
}

export function loadAiDifficulty(storage = globalThis.localStorage) {
  try {
    return normalizeAiDifficulty(storage?.getItem(AI_DIFFICULTY_KEY));
  } catch {
    return 'normal';
  }
}
