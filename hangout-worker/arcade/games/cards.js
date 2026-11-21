/**
 * Shared card game logic for Turdanoid
 */

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const SUITS = ['S', 'H', 'D', 'C'];

/**
 * Creates a shuffled deck of cards.
 * @param {number} decks - Number of 52-card decks to include.
 * @returns {Array} Shuffled array of card objects {rank, suit}.
 */
export function createShoe(decks = 1) {
  const next = [];

  for (let d = 0; d < decks; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        next.push({ rank, suit });
      }
    }
  }

  // Fisher-Yates Shuffle
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }

  return next;
}

/**
 * Calculates the value of a card for scoring.
 */
export function getCardValue(card) {
  if (!card) {return 0;}
  if (card.rank === 'A') {return 11;}
  if (['K', 'Q', 'J'].includes(card.rank)) {return 10;}
  return parseInt(card.rank, 10);
}

/**
 * Calculates the total value of a Blackjack hand, accounting for Aces.
 */
export function handValue(hand) {
  let total = 0;
  let aces = 0;
  for (const card of hand) {
    total += getCardValue(card);
    if (card.rank === 'A') {aces++;}
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

/**
 * Returns true if the hand contains an Ace being counted as 11.
 */
export function isSoftHand(hand) {
  let total = 0;
  let aces = 0;
  for (const c of hand) {
    total += getCardValue(c);
    if (c.rank === 'A') {aces++;}
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return aces > 0;
}

/**
 * Returns the Hi-Lo value of a card for card counting.
 */
export function hiLoValue(card) {
  if (!card) {return 0;}
  if (['2', '3', '4', '5', '6'].includes(card.rank)) {return 1;}
  if (['10', 'J', 'Q', 'K', 'A'].includes(card.rank)) {return -1;}
  return 0;
}
