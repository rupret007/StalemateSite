/* Deterministic round-end scenarios for QA screenshots (knock, gin, undercut, match-win).
   Hands are disjoint 10+10 from one deck; validated in tests/turdrummy-moments.test.js. */
(function attachTurdRummyMomentFixtures(root) {
  'use strict';

  function card(shortId, idx) {
    const match = /^([CDHS])(1[0-3]|[1-9])$/.exec(shortId);
    if (!match) {
      throw new Error('Invalid fixture card ' + shortId);
    }
    return { id: shortId + '-' + String(idx), suit: match[1], rank: Number(match[2]) };
  }

  function hand(shortIds, startIdx) {
    let idx = startIdx;
    return shortIds.map((id) => card(id, idx++));
  }

  /** Player knocks and wins (not gin). Knocker deadwood 1. */
  const KNOCK = {
    knocker: 'player',
    isGin: false,
    playerIds: ['H3', 'H4', 'H5', 'C9', 'D9', 'S9', 'C10', 'D10', 'H10', 'D1'],
    aiIds: ['H6', 'H7', 'C1', 'C2', 'C3', 'S4', 'S5', 'S6', 'S7', 'S8'],
    playerScore: 12,
    aiScore: 18
  };

  /** Player calls gin (0 deadwood). */
  const GIN = {
    knocker: 'player',
    isGin: true,
    playerIds: ['H3', 'H4', 'H5', 'C9', 'D9', 'H9', 'S9', 'C10', 'D10', 'S10'],
    aiIds: ['H6', 'H7', 'C1', 'C2', 'C3', 'S4', 'S5', 'S6', 'S7', 'S8'],
    playerScore: 20,
    aiScore: 15
  };

  /** Player knocks at 1; AI layoffs to 0 — undercut to AI. */
  const UNDERCUT = {
    knocker: 'player',
    isGin: false,
    playerIds: KNOCK.playerIds,
    aiIds: KNOCK.aiIds,
    playerScore: 8,
    aiScore: 22
  };

  /** Player gins on the final hand to cross match target. */
  const MATCH_WIN = {
    knocker: 'player',
    isGin: true,
    playerIds: GIN.playerIds,
    aiIds: GIN.aiIds,
    playerScore: 95,
    aiScore: 40
  };

  const KINDS = {
    knock: KNOCK,
    gin: GIN,
    undercut: UNDERCUT,
    'match-win': MATCH_WIN
  };

  /**
   * @param {keyof KINDS | string} kind
   * @returns {{ knocker: string, isGin: boolean, playerHand: Array, aiHand: Array, playerScore: number, aiScore: number }}
   */
  function buildTableState(kind) {
    const spec = KINDS[kind];
    if (!spec) {
      throw new Error('Unknown moment kind: ' + kind);
    }
    const playerHand = hand(spec.playerIds, 0);
    const aiHand = hand(spec.aiIds, playerHand.length);
    return {
      knocker: spec.knocker,
      isGin: spec.isGin,
      playerHand,
      aiHand,
      playerScore: spec.playerScore,
      aiScore: spec.aiScore
    };
  }

  root.TurdRummyMoments = {
    KINDS: Object.keys(KINDS),
    buildTableState
  };
})(typeof window !== 'undefined' ? window : globalThis);
