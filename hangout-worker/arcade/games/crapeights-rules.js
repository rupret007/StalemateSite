/* Rules used by both the solo table and the authoritative online table. */
(function (root) {
  'use strict';

  const suits = Object.freeze(['S', 'H', 'D', 'C']);
  const ranks = Object.freeze(['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']);
  const effects = Object.freeze({ '2': 'draw-two', J: 'skip', Q: 'reverse', '8': 'wild' });

  function cardPoints(card) {
    if (!card) { return 0; }
    if (card.rank === '8') { return 50; }
    if (card.rank === 'A') { return 1; }
    if (['J', 'Q', 'K'].includes(card.rank)) { return 10; }
    return Number(card.rank);
  }

  function canPlay(card, top, suit) {
    return !!(card && top && (card.rank === '8' || card.suit === suit || card.rank === top.rank));
  }

  function cardEffect(card) { return effects[card.rank] || null; }

  root.CrapeightsRules = Object.freeze({ suits, ranks, handSize: 7, target: 200, cardPoints, canPlay, cardEffect });
})(globalThis);
