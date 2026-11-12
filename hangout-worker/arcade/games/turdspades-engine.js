/**
 * Turdspades Game Engine
 * Decoupled logic for Spades (trick-taking) gameplay.
 * Ported from turdspades.html to be unit-testable.
 */

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const SUITS = ['S', 'H', 'D', 'C'];
export const MATCH_TARGET = 250;

export const RANK_VALUES = {
  2: 2,
  3: 3,
  4: 4,
  5: 5,
  6: 6,
  7: 7,
  8: 8,
  9: 9,
  10: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14
};

/**
 * Nil is deliberately rare for the bots. A hand must have no ace or king,
 * no dangerous high spade, no more than three spades, and at most one queen.
 */
function cardRankValue(card) {
  if (!card) {
    return 0;
  }
  if (typeof card.rank === 'number') {
    return card.rank;
  }
  return RANK_VALUES[card.rank] || 0;
}

/**
 * When a partner called Nil and is currently winning the trick,
 * play the cheapest legal overtake. Returns null when covering
 * does not apply or no overtake exists.
 */
export function pickNilCoverCard(
  legal,
  { partnerBid, winnerPlayer, partner, cardBeatsWinner } = {}
) {
  if (
    partnerBid !== 0 ||
    winnerPlayer !== partner ||
    !Array.isArray(legal) ||
    typeof cardBeatsWinner !== 'function'
  ) {
    return null;
  }
  const covers = legal.filter((card) => cardBeatsWinner(card));
  if (!covers.length) {
    return null;
  }
  return covers.slice().sort((a, b) => {
    const rankDelta = cardRankValue(a) - cardRankValue(b);
    if (rankDelta !== 0) {
      return rankDelta;
    }
    return String(a.suit || '').localeCompare(String(b.suit || ''));
  })[0];
}

export function shouldBidNil(hand) {
  if (!Array.isArray(hand) || hand.length !== 13) {
    return false;
  }

  const spades = hand.filter((card) => card.suit === 'S');
  const acesOrKings = hand.filter((card) => RANK_VALUES[card.rank] >= 13);
  const queens = hand.filter((card) => card.rank === 'Q');
  const highSpades = spades.filter((card) => RANK_VALUES[card.rank] >= 10);

  return (
    spades.length <= 3 && acesOrKings.length === 0 && queens.length <= 1 && highSpades.length === 0
  );
}

/**
 * Score one partnership's round, including individual Nil contracts.
 * Nil tricks still count toward the partnership contract and can become bags.
 */
export function scoreSpadesTeamRound({ bids, tricks, bags = 0 }) {
  if (!Array.isArray(bids) || bids.length !== 2 || !Array.isArray(tricks) || tricks.length !== 2) {
    throw new TypeError('bids and tricks must each contain two partnership values');
  }
  if (bids.some((bid) => !Number.isInteger(bid) || bid < 0 || bid > 13)) {
    throw new RangeError('bids must be whole numbers from 0 through 13');
  }
  if (tricks.some((count) => !Number.isInteger(count) || count < 0 || count > 13)) {
    throw new RangeError('tricks must be whole numbers from 0 through 13');
  }
  if (!Number.isInteger(bags) || bags < 0) {
    throw new RangeError('bags must be a non-negative whole number');
  }

  const contractBid = bids.reduce((sum, bid) => sum + (bid === 0 ? 0 : bid), 0);
  const tricksTaken = tricks.reduce((sum, count) => sum + count, 0);
  const contractMade = tricksTaken >= contractBid;
  const overtricks = contractMade ? tricksTaken - contractBid : 0;
  const contractPoints = contractMade ? contractBid * 10 + overtricks : -contractBid * 10;
  const nilResults = bids.flatMap((bid, playerIndex) => {
    if (bid !== 0) {
      return [];
    }
    const succeeded = tricks[playerIndex] === 0;
    return [
      { playerIndex, succeeded, tricks: tricks[playerIndex], points: succeeded ? 100 : -100 }
    ];
  });
  const nilPoints = nilResults.reduce((sum, result) => sum + result.points, 0);

  let nextBags = bags + overtricks;
  let bagPenalties = 0;
  while (nextBags >= 10) {
    nextBags -= 10;
    bagPenalties += 1;
  }

  return {
    contractBid,
    tricksTaken,
    contractMade,
    contractPoints,
    overtricks,
    nilResults,
    nilPoints,
    bagPenalties,
    bags: nextBags,
    delta: contractPoints + nilPoints - bagPenalties * 100
  };
}

export class TurdspadesEngine {
  constructor() {
    this.deck = [];
    this.hands = [[], [], [], []]; // 4 players: 0=Player, 1=CPU1, 2=Partner, 3=CPU2
    this.trick = [];
    this.currentPlayer = 0; // 0-3
    this.round = 1;
    this.tricksInRound = 0;
    this.declarations = [0, 0, 0, 0]; // Tricks each player declared
    this.actualTricks = [0, 0, 0, 0]; // Tricks each player actually took
    this.team1Score = 0;
    this.team2Score = 0;
    this.team1Bags = 0;
    this.team2Bags = 0;
    this.lastRoundResult = null;
    this.gameOver = false;
    this.winner = null;
    this.dealer = 0; // Player who deals
    this.firstPlayer = 0; // Player who leads the trick

    this.createAndDeal();
  }

  createAndDeal() {
    this.hands = [[], [], [], []];
    this.createDeck();
    this.dealCards();
  }

  createDeck() {
    this.deck = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        this.deck.push({ rank, suit });
      }
    }
    // Fisher-Yates shuffle
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }
  }

  dealCards() {
    // Deal 13 cards to each of 4 players
    let cardIndex = 0;
    for (let i = 0; i < 13; i++) {
      for (let player = 0; player < 4; player++) {
        this.hands[player].push(this.deck[cardIndex++]);
      }
    }
    // Sort each hand
    for (let player = 0; player < 4; player++) {
      this.hands[player].sort((a, b) => {
        const suitOrder = { S: 0, H: 1, D: 2, C: 3 };
        if (suitOrder[a.suit] !== suitOrder[b.suit]) {
          return suitOrder[a.suit] - suitOrder[b.suit];
        }
        return RANK_VALUES[b.rank] - RANK_VALUES[a.rank];
      });
    }
  }

  getHand(player) {
    return this.hands[player] || [];
  }

  canFollowSuit(card, leadSuit) {
    if (!leadSuit) {
      return true;
    }
    return card.suit === leadSuit;
  }

  hasSuit(player, suit) {
    return this.hands[player].some((card) => card.suit === suit);
  }

  getCardValue(card) {
    return RANK_VALUES[card.rank] || 0;
  }

  // Get the suit of a card
  getCardSuit(card) {
    return card.suit;
  }

  // Check if a card is a Spade
  isSpade(card) {
    return card.suit === 'S';
  }

  // Check if Spades have been broken (played in a non-Lead trick)
  spadesBroken() {
    // Check if any spade has been played in tricks 2-13 of this round
    // (First trick doesn't break spades unless someone leads spade)
    if (this.tricksInRound === 0) {
      return false;
    }

    // Check if spade was played in any previous trick of this round
    // For simplicity, track if any non-lead suit was spade
    return false; // Simplified - would need to track actual play history
  }

  playCard(player, cardIndex) {
    if (player !== this.currentPlayer) {
      return { valid: false, message: 'Not your turn' };
    }

    const hand = this.hands[player];
    if (cardIndex < 0 || cardIndex >= hand.length) {
      return { valid: false, message: 'Invalid card index' };
    }

    const card = hand[cardIndex];
    const leadSuit = this.trick.length > 0 ? this.trick[0].suit : null;

    // Must follow suit if possible
    if (leadSuit && this.hasSuit(player, leadSuit)) {
      if (card.suit !== leadSuit) {
        return { valid: false, message: 'Must follow suit' };
      }
    }

    // Remove card from hand and add to trick
    hand.splice(cardIndex, 1);
    this.trick.push({ player, card });

    // Check if trick is complete
    if (this.trick.length === 4) {
      this.resolveTrick();
    } else {
      this.currentPlayer = (this.currentPlayer + 1) % 4;
    }

    return { valid: true, card };
  }

  resolveTrick() {
    const leadSuit = this.trick[0].card.suit;
    let winningPlayer = this.trick[0].player;
    let highestValue = this.getCardValue(this.trick[0].card);
    let highestSpadeValue = -1;
    let hasTrumpSpade = false;

    for (let i = 1; i < this.trick.length; i++) {
      const { player, card } = this.trick[i];
      const isSpade = card.suit === 'S';
      const value = this.getCardValue(card);

      if (isSpade) {
        if (!hasTrumpSpade || value > highestSpadeValue) {
          hasTrumpSpade = true;
          highestSpadeValue = value;
          winningPlayer = player;
        }
      } else if (!hasTrumpSpade && card.suit === leadSuit) {
        if (value > highestValue) {
          highestValue = value;
          winningPlayer = player;
        }
      }
    }

    // Award trick to winner
    this.actualTricks[winningPlayer]++;
    this.tricksInRound++;
    this.firstPlayer = winningPlayer;
    this.currentPlayer = winningPlayer;

    // Clear trick for next round
    this.trick = [];

    // Check if round is over
    if (this.tricksInRound === 13) {
      this.resolveRound();
    }
  }

  resolveRound() {
    const team1Result = scoreSpadesTeamRound({
      bids: [this.declarations[0], this.declarations[2]],
      tricks: [this.actualTricks[0], this.actualTricks[2]],
      bags: this.team1Bags
    });
    const team2Result = scoreSpadesTeamRound({
      bids: [this.declarations[1], this.declarations[3]],
      tricks: [this.actualTricks[1], this.actualTricks[3]],
      bags: this.team2Bags
    });

    this.team1Score += team1Result.delta;
    this.team2Score += team2Result.delta;
    this.team1Bags = team1Result.bags;
    this.team2Bags = team2Result.bags;
    this.lastRoundResult = { team1: team1Result, team2: team2Result };

    const team1ReachedTarget = this.team1Score >= MATCH_TARGET;
    const team2ReachedTarget = this.team2Score >= MATCH_TARGET;
    if ((team1ReachedTarget || team2ReachedTarget) && this.team1Score !== this.team2Score) {
      this.gameOver = true;
      this.winner = this.team1Score > this.team2Score ? 'team1' : 'team2';
    }

    // Setup next round
    this.round++;
    this.tricksInRound = 0;
    this.actualTricks = [0, 0, 0, 0];
    this.dealer = (this.dealer + 1) % 4;
    this.firstPlayer = (this.dealer + 1) % 4;
    this.currentPlayer = this.firstPlayer;

    // Create new deck and deal
    this.createAndDeal();
  }

  declareBid(player, tricks) {
    if (tricks < 0 || tricks > 13) {
      return false;
    }
    this.declarations[player] = tricks;
    return true;
  }

  // CPU auto-declaration based on spade count and strength
  cpuDeclareBid(player) {
    const hand = this.hands[player];
    if (shouldBidNil(hand)) {
      this.declarations[player] = 0;
      return 0;
    }
    let spades = 0;
    let highCards = 0;

    for (const card of hand) {
      if (card.suit === 'S') {
        spades++;
      }
      if (this.getCardValue(card) >= 10) {
        highCards++;
      }
    }

    // Simple bid calculation
    const bid = Math.min(13, Math.max(1, Math.floor(spades * 0.5) + Math.floor(highCards * 0.3)));
    this.declarations[player] = bid;
    return bid;
  }

  // Simple CPU play - plays lowest valid card
  cpuPlayCard(player) {
    if (this.currentPlayer !== player) {
      return null;
    }

    const hand = this.hands[player];
    const leadSuit = this.trick.length > 0 ? this.trick[0].card.suit : null;

    let playable = [];

    if (leadSuit && this.hasSuit(player, leadSuit)) {
      // Must follow suit
      playable = hand.filter((card) => card.suit === leadSuit);
    } else if (leadSuit && !this.hasSuit(player, leadSuit)) {
      // Can play anything - prefer playing spades if not leading
      playable = hand;
    } else {
      // Leading - play highest non-spade if possible to save spades
      playable = hand.filter((card) => card.suit !== 'S');
      if (playable.length === 0) {
        playable = hand;
      }
    }

    // Play lowest card in playable set
    playable.sort((a, b) => this.getCardValue(a) - this.getCardValue(b));
    const toPlay = playable[0];
    const index = hand.indexOf(toPlay);

    return this.playCard(player, index);
  }

  getScore() {
    return {
      team1: this.team1Score,
      team2: this.team2Score,
      team1Bags: this.team1Bags,
      team2Bags: this.team2Bags
    };
  }

  getTrick() {
    return this.trick;
  }

  isGameOver() {
    return this.gameOver;
  }

  getWinner() {
    return this.winner;
  }
}
