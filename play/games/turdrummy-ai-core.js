/* TurdRummy AI discard-memory helpers.
   Classic script: attaches TurdRummyAI on globalThis so turdrummy.html can
   use it from a plain <script> tag. games/turdrummy-ai.js re-exports this
   API for unit tests (see games/table-continue-core.js for the same split).

   The live page already tracks every card either side has discarded in
   state.discard (nothing extra to persist). This module turns that history
   into a "how risky is it to discard this card" signal: cards whose rank or
   suit-neighbors are already dead in the pile are less likely to complete
   an opponent's set or run, so they are safer to let go. */
(function attachTurdRummyAI(root) {
  'use strict';

  const SAFETY_WEIGHTS = {
    deadRank: 1.5,
    deadNeighbor: 0.5
  };

  /**
   * How safe `card` is to discard given the cards already seen in the
   * discard pile. Higher = safer (more of its rank/run neighborhood is
   * already dead, so an opponent is less likely holding a matching set
   * or run). Pure function: does not mutate `discardHistory`.
   * @param {Array<{suit: string, rank: number, id?: string}>} discardHistory
   * @param {{suit: string, rank: number, id?: string}} card
   */
  function computeDiscardSafety(discardHistory, card) {
    if (!card || !Array.isArray(discardHistory) || discardHistory.length === 0) {
      return 0;
    }
    let deadRankCount = 0;
    let deadNeighborCount = 0;
    for (const seen of discardHistory) {
      if (!seen || seen.id === card.id) {
        continue;
      }
      if (seen.rank === card.rank) {
        deadRankCount += 1;
        continue;
      }
      if (seen.suit === card.suit) {
        const gap = Math.abs(seen.rank - card.rank);
        if (gap === 1 || gap === 2) {
          deadNeighborCount += 1;
        }
      }
    }
    return deadRankCount * SAFETY_WEIGHTS.deadRank + deadNeighborCount * SAFETY_WEIGHTS.deadNeighbor;
  }

  const DIFFICULTY_KEY = 'turdrummyDifficulty_v1';
  const DEFAULT_LEVEL = 'normal';

  /* Per-level knobs. `normal` is the round-1 strength plus the feed-risk term, so
     an existing player gets a slightly sharper bot without a setting change.
     `easy` ignores what the human is building and makes small scoring mistakes;
     `sharp` leans harder on feed risk and knocks a point earlier. */
  const AI_PROFILES = {
    easy: { feedRiskBias: 0, discardSafetyBias: 0, scoreNoise: 1.4, knockOffset: -2, stockPressure: 0 },
    normal: { feedRiskBias: 1, discardSafetyBias: 1, scoreNoise: 0, knockOffset: 0, stockPressure: 1 },
    sharp: { feedRiskBias: 1.8, discardSafetyBias: 1.4, scoreNoise: 0, knockOffset: 1, stockPressure: 1 }
  };

  const FEED_WEIGHTS = {
    sameRank: 1,
    runNear: 1,
    runFar: 0.5
  };

  /** Normalises any input to a known level; unknown values fall back to Normal. */
  function profileFor(level) {
    const key = typeof level === 'string' && Object.prototype.hasOwnProperty.call(AI_PROFILES, level)
      ? level
      : DEFAULT_LEVEL;
    return { level: key, ...AI_PROFILES[key] };
  }

  /**
   * Cards the human took from the discard pile that they still hold: a taken
   * card that now sits in the discard pile was thrown back, so it no longer
   * signals a set or run in progress.
   * @param {Array<{id: string}>} takes cards drawn from discard by the human
   * @param {Array<{id: string}>} discard current discard pile
   */
  function activeHumanTakes(takes, discard) {
    if (!Array.isArray(takes) || takes.length === 0) {return [];}
    const thrownBack = new Set((Array.isArray(discard) ? discard : []).map((card) => card && card.id));
    return takes.filter((card) => card && !thrownBack.has(card.id));
  }

  /**
   * How much discarding `card` would feed the human, given the cards they took
   * from the discard that they still hold. A same-rank card helps a set; a
   * same-suit card one or two ranks away helps a run (one away counts more).
   * Pure: nothing is mutated. Returns 0 when there is no signal.
   */
  function computeFeedRisk(takes, card) {
    if (!card || !Array.isArray(takes) || takes.length === 0) {return 0;}
    let risk = 0;
    for (const taken of takes) {
      if (!taken || taken.id === card.id) {continue;}
      if (taken.rank === card.rank) {
        risk += FEED_WEIGHTS.sameRank;
      } else if (taken.suit === card.suit) {
        const gap = Math.abs(taken.rank - card.rank);
        if (gap === 1) {risk += FEED_WEIGHTS.runNear;}
        else if (gap === 2) {risk += FEED_WEIGHTS.runFar;}
      }
    }
    return risk;
  }

  /**
   * Knock threshold for the bot. `baseThreshold` is the score-driven value the
   * page already computes. This adds two terms: the level's knock offset, and
   * stock pressure (a stock that is nearly gone and a round that has run a while
   * means waiting costs more than a few deadwood points).
   * @param {{baseThreshold: number, profile: object, aiTurns: number, stockCount: number, knockLimit?: number}} input
   */
  function computeKnockThreshold(input) {
    const limit = input.knockLimit === undefined ? 10 : input.knockLimit;
    const profile = input.profile || profileFor(DEFAULT_LEVEL);
    let threshold = input.baseThreshold + profile.knockOffset;
    const turns = Math.max(0, Math.floor(input.aiTurns || 0));
    const stock = Math.max(0, Math.floor(input.stockCount || 0));
    if (profile.stockPressure && stock <= 4 && turns >= 6) {threshold += 1;}
    return Math.max(3, Math.min(limit, threshold));
  }

  /** Adds a bounded, deterministic-given-rng wobble to a score (Easy only). */
  function applyScoreNoise(score, amplitude, rng) {
    if (!amplitude) {return score;}
    const draw = typeof rng === 'function' ? rng() : Math.random();
    return score + (draw * 2 - 1) * amplitude;
  }

  /** @returns {'easy'|'normal'|'sharp'} the saved level, defaulting to Normal. */
  function loadDifficulty(storage) {
    try {
      const raw = (storage || root.localStorage).getItem(DIFFICULTY_KEY);
      return Object.prototype.hasOwnProperty.call(AI_PROFILES, raw) ? raw : DEFAULT_LEVEL;
    } catch {
      return DEFAULT_LEVEL;
    }
  }

  function saveDifficulty(storage, level) {
    const next = Object.prototype.hasOwnProperty.call(AI_PROFILES, level) ? level : DEFAULT_LEVEL;
    try {
      (storage || root.localStorage).setItem(DIFFICULTY_KEY, next);
    } catch {
      /* ignore */
    }
    return next;
  }

  root.TurdRummyAI = {
    SAFETY_WEIGHTS,
    computeDiscardSafety,
    DIFFICULTY_KEY,
    DEFAULT_LEVEL,
    AI_PROFILES,
    FEED_WEIGHTS,
    profileFor,
    activeHumanTakes,
    computeFeedRisk,
    computeKnockThreshold,
    applyScoreNoise,
    loadDifficulty,
    saveDifficulty
  };
})(typeof window !== 'undefined' ? window : globalThis);
