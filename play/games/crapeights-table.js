/** Small, deterministic presentation rules shared by the live table and tests. */
(function (root) {
  'use strict';
  const suits = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
  const actions = { '2': 'Draw two', J: 'Skip', Q: 'Reverse', '8': 'Wild, choose a suit' };
  function cardLabel(card, playable, selected) {
    return `${card.rank} of ${suits[card.suit]}${actions[card.rank] ? `, ${actions[card.rank]}` : ''}, ${playable ? 'playable' : 'does not match'}${selected ? ', selected' : ''}`;
  }
  function handPoints(hand) {
    return hand.reduce((total, card) => total + (card.rank === '8' ? 50 : card.rank === 'A' ? 1 : ['J', 'Q', 'K'].includes(card.rank) ? 10 : Number(card.rank)), 0);
  }
  function fanLayout(count) {
    const visible = Math.min(8, Math.max(0, count));
    return Array.from({ length: visible }, (_, i) => ({
      x: (i - (visible - 1) / 2) * 12,
      y: Math.abs(i - (visible - 1) / 2) * 2,
      angle: (i - (visible - 1) / 2) * 7
    }));
  }
  function focusIndex(current, key, count) {
    if (!count) { return -1; }
    if (key === 'Home') { return 0; }
    if (key === 'End') { return count - 1; }
    return (current + (key === 'ArrowLeft' ? -1 : 1) + count) % count;
  }
  function turnHint({ human, active, name, suit, rank, playableCount, drawn, selected }) {
    if (!active) { return { title: 'Round complete', detail: 'The sewer has spoken. Check the scores.' }; }
    if (!human) { return { title: `${name} is thinking`, detail: 'Plan your next move. Eights are always wild.' }; }
    if (selected) { return { title: `Play ${selected.rank} of ${suits[selected.suit]}`, detail: actions[selected.rank] || 'Play Selected, or tap this card again to play.' }; }
    if (drawn) { return { title: 'Play or pass', detail: 'Your draw is done. Play a matching card or pass.' }; }
    return {
      title: playableCount ? `Your move · ${playableCount} playable` : 'Your move · draw a card',
      detail: `Match ${suits[suit]} or ${rank}. ${playableCount ? 'Lit cards can play.' : 'An 8 works on anything.'}`
    };
  }
  root.CrapeightsTable = Object.freeze({ cardLabel, handPoints, fanLayout, focusIndex, turnHint });
})(globalThis);
