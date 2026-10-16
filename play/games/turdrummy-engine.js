/**
 * TurdRummy Card Game Engine
 * Decoupled logic for Gin Rummy gameplay.
 * Ported from turdrummy.html to be unit-testable.
 */

export const SUITS = ['C', 'D', 'H', 'S'];
export const SUIT_ORDER = { C: 0, D: 1, H: 2, S: 3 };

export class TurdRummyEngine {
  constructor() {
    this.deck = this.createDeck();
    this.playerHand = [];
    this.aiHand = [];
    this.discardPile = [];
    this.stockPile = [];
  }

  createDeck() {
    const deck = [];
    for (const suit of SUITS) {
      for (let rank = 1; rank <= 13; rank++) {
        deck.push({ suit, rank, id: `${suit}${rank}` });
      }
    }
    return deck;
  }

  shuffle(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  deal() {
    this.stockPile = this.shuffle([...this.deck]);
    this.playerHand = this.stockPile.splice(0, 10);
    this.aiHand = this.stockPile.splice(0, 10);
    this.discardPile = [this.stockPile.pop()];
  }

  /**
   * Calculate deadwood score for a hand.
   * Simplified version for testing: assumes no melds.
   * Real version in game uses complex meld-finding.
   */
  calculateDeadwood(hand) {
    return hand.reduce((total, card) => {
      const val = card.rank > 10 ? 10 : (card.rank === 1 ? 1 : card.rank);
      return total + val;
    }, 0);
  }

  /**
   * Find sets (3 or 4 cards of same rank)
   */
  findSets(hand) {
    const ranks = {};
    hand.forEach(card => {
      ranks[card.rank] = (ranks[card.rank] || []);
      ranks[card.rank].push(card);
    });

    return Object.values(ranks).filter(group => group.length >= 3);
  }

  /**
   * Find runs (3 or more consecutive cards of same suit)
   */
  findRuns(hand) {
    const suits = {};
    hand.forEach(card => {
      suits[card.suit] = (suits[card.suit] || []);
      suits[card.suit].push(card);
    });

    const runs = [];
    for (const suit in suits) {
      const sorted = suits[suit].sort((a, b) => a.rank - b.rank);
      let currentRun = [sorted[0]];

      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].rank === sorted[i-1].rank + 1) {
          currentRun.push(sorted[i]);
        } else {
          if (currentRun.length >= 3) {runs.push(currentRun);}
          currentRun = [sorted[i]];
        }
      }
      if (currentRun.length >= 3) {runs.push(currentRun);}
    }
    return runs;
  }
}
