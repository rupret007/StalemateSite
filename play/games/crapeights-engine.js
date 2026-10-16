/**
 * Crapeights (Crazy Eights) Game Engine
 * Decoupled logic for Crazy Eights gameplay.
 * Ported from crapeights.html to be unit-testable.
 */

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const SUITS = ['S', 'H', 'D', 'C'];

export const EIGHT_RANKS = ['8'];

export class CrapeightsEngine {
  constructor(decks = 1) {
    this.decks = decks;
    this.deck = [];
    this.playerHand = [];
    this.cpuHand = [];
    this.discardPile = [];
    this.currentPlayer = 'player'; // 'player' or 'cpu'
    this.gameOver = false;
    this.winner = null;
    this.direction = 1; // 1 for clockwise, -1 for counter-clockwise
    this.drawCount = 0; // Accumulated draw penalty
    this.lastPlayWasEight = false;
    this.currentSuit = null; // When an 8 is played, this tracks the declared suit

    this.createDeck();
    this.deal();
  }

  createDeck() {
    this.deck = [];
    for (let d = 0; d < this.decks; d++) {
      for (const suit of SUITS) {
        for (const rank of RANKS) {
          this.deck.push({ rank, suit });
        }
      }
    }
    // Fisher-Yates shuffle
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }
  }

  drawCard() {
    if (this.deck.length === 0) {
      this.reshuffleDiscard();
    }
    return this.deck.pop();
  }

  reshuffleDiscard() {
    if (this.discardPile.length <= 1) {return;}
    const topCard = this.discardPile.pop();
    this.deck = [...this.discardPile];
    this.discardPile = [topCard];
    // Fisher-Yates shuffle
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }
  }

  deal() {
    // Deal 5 cards to each player
    for (let i = 0; i < 5; i++) {
      this.playerHand.push(this.drawCard());
      this.cpuHand.push(this.drawCard());
    }
    // Flip first card to discard pile
    this.discardPile.push(this.drawCard());
    this.currentSuit = this.discardPile[0].suit;
    this.lastPlayWasEight = this.discardPile[0].rank === '8';

    // Handle case where first card is an 8
    if (this.lastPlayWasEight) {
      // Player goes first after an initial 8
      this.currentPlayer = 'player';
    }
  }

  canPlayCard(card) {
    const topCard = this.discardPile[this.discardPile.length - 1];
    if (!card || !topCard) {return false;}

    // 8s are wild - can always be played
    if (card.rank === '8') {return true;}

    // Check suit match
    const effectiveSuit = this.currentSuit || topCard.suit;
    if (card.suit === effectiveSuit) {return true;}

    // Check rank match
    if (card.rank === topCard.rank) {return true;}

    return false;
  }

  playCard(card, suitOverride = null) {
    if (!this.canPlayCard(card)) {
      return { valid: false, message: 'Cannot play this card' };
    }

    // Remove card from hand
    const index = this.playerHand.findIndex(c => c.rank === card.rank && c.suit === card.suit);
    if (index === -1) {return { valid: false, message: 'Card not in hand' };}
    this.playerHand.splice(index, 1);

    // Play to discard pile
    this.discardPile.push(card);

    // Handle 8
    if (card.rank === '8') {
      this.lastPlayWasEight = true;
      this.currentSuit = suitOverride || card.suit;
      // 8 doesn't change direction in standard rules, just forces suit declaration
    } else {
      this.lastPlayWasEight = false;
      this.currentSuit = card.suit;
    }

    // Check for win
    if (this.playerHand.length === 0) {
      this.gameOver = true;
      this.winner = 'player';
      return { valid: true, message: 'Player wins!' };
    }

    // Switch turns
    this.switchTurn();

    return { valid: true, message: 'Card played' };
  }

  drawFromDeck() {
    const drawn = this.drawCard();
    if (!drawn) {
      this.switchTurn();
      return { card: null, canPlay: false };
    }
    this.playerHand.push(drawn);

    // Check if drawn card can be played
    if (this.canPlayCard(drawn)) {
      return { card: drawn, canPlay: true };
    }

    // Switch turns after drawing
    this.switchTurn();
    return { card: drawn, canPlay: false };
  }

  switchTurn() {
    this.currentPlayer = this.currentPlayer === 'player' ? 'cpu' : 'player';
  }

  cpuPlay() {
    if (this.currentPlayer !== 'cpu' || this.gameOver) {return null;}

    // CPU strategy: play matching card, prefer non-8s, then 8s
    const playable = this.cpuHand.filter(card => this.canPlayCard(card));

    if (playable.length === 0) {
      // Draw
      const drawn = this.drawCard();
      if (!drawn) {
        this.switchTurn();
        return { action: 'draw', card: null };
      }
      this.cpuHand.push(drawn);
      if (this.canPlayCard(drawn)) {
        // CPU plays drawn card if possible
        this.discardPile.push(drawn);
        this.cpuHand = this.cpuHand.filter(c => c !== drawn);
        if (drawn.rank === '8') {
          this.lastPlayWasEight = true;
          // Pick a suit CPU has most of
          this.currentSuit = this.mostCommonSuit(this.cpuHand);
        } else {
          this.lastPlayWasEight = false;
          this.currentSuit = drawn.suit;
        }
        if (this.cpuHand.length === 0) {
          this.gameOver = true;
          this.winner = 'cpu';
        } else {
          this.switchTurn();
        }
      } else {
        this.switchTurn();
      }
      return { action: 'draw', card: drawn };
    }

    // Play highest non-8 card, or 8 if only 8s available
    playable.sort((a, b) => {
      if (a.rank === '8' && b.rank !== '8') {return 1;}
      if (b.rank === '8' && a.rank !== '8') {return -1;}
      return 0;
    });

    const played = playable[0];
    this.discardPile.push(played);
    this.cpuHand = this.cpuHand.filter(c => c !== played);

    if (played.rank === '8') {
      this.lastPlayWasEight = true;
      this.currentSuit = this.mostCommonSuit(this.cpuHand);
    } else {
      this.lastPlayWasEight = false;
      this.currentSuit = played.suit;
    }

    // Check for win
    if (this.cpuHand.length === 0) {
      this.gameOver = true;
      this.winner = 'cpu';
    } else {
      this.switchTurn();
    }

    return { action: 'play', card: played };
  }

  mostCommonSuit(hand) {
    const counts = {};
    for (const card of hand) {
      counts[card.suit] = (counts[card.suit] || 0) + 1;
    }
    let max = 0;
    let suit = 'S';
    for (const [s, count] of Object.entries(counts)) {
      if (count > max) {
        max = count;
        suit = s;
      }
    }
    return suit;
  }

  getTopCard() {
    return this.discardPile[this.discardPile.length - 1];
  }

  getPlayerHandSize() {
    return this.playerHand.length;
  }

  getCpuHandSize() {
    return this.cpuHand.length;
  }
}
