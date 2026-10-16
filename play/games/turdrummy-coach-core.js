/* TurdRummy first-round coach: the step script and its advance rules.
   Classic script: attaches TurdRummyCoach on globalThis so turdrummy.html can
   use it from a plain <script> tag. games/turdrummy-coach.js re-exports this
   API for unit tests (see games/table-continue-core.js for the same split).

   Steps advance on the real action that the step teaches (`drawn`, `discarded`),
   or on Next (`manual`). The page supplies the events; this file only decides
   which step comes next, so the script can be tested without a DOM. */
(function attachTurdRummyCoach(root) {
  'use strict';

  const COACH_KEY = 'turdrummyCoach_v1';

  /** `spot` names a highlight target the page knows how to find. */
  const COACH_STEPS = [
    {
      id: 'draw',
      title: 'Start your turn',
      body: 'Tap Draw Stock for a fresh card, or Draw Discard to take the face-up card.',
      spot: 'stock',
      advanceOn: 'drawn'
    },
    {
      id: 'discard',
      title: 'Shed one card',
      body: 'Tap a card in your hand, then Discard. Keep the cards that build sets and runs.',
      spot: 'hand',
      advanceOn: 'discarded'
    },
    {
      id: 'melds',
      title: 'Read the brackets',
      body: 'Coloured brackets are melds. Grey cards are deadwood and count against you at the end.',
      spot: 'hand',
      advanceOn: 'manual'
    },
    {
      id: 'knock',
      title: 'Knock or Gin',
      body: 'Knock when deadwood is 10 or less. Gin at 0 ends the round with a bonus.',
      spot: 'knock',
      advanceOn: 'manual'
    }
  ];

  /**
   * Index of the step to show after `event`. An event that does not match the
   * current step's `advanceOn` leaves the coach where it is.
   * @param {number} index current step index
   * @param {'drawn'|'discarded'|'next'} event
   * @returns {number} next index; equals COACH_STEPS.length when the coach is finished
   */
  function nextCoachIndex(index, event) {
    const at = Math.max(0, Math.floor(Number(index) || 0));
    if (at >= COACH_STEPS.length) {return COACH_STEPS.length;}
    const step = COACH_STEPS[at];
    const matches = event === 'next' || event === step.advanceOn;
    return matches ? at + 1 : at;
  }

  /** @returns {boolean} true once the coach has been finished or skipped. */
  function loadCoachDone(storage) {
    try {
      return (storage || root.localStorage).getItem(COACH_KEY) === '1';
    } catch {
      return false;
    }
  }

  function markCoachDone(storage) {
    try {
      (storage || root.localStorage).setItem(COACH_KEY, '1');
    } catch {
      /* ignore */
    }
    return true;
  }

  root.TurdRummyCoach = {
    COACH_KEY,
    COACH_STEPS,
    nextCoachIndex,
    loadCoachDone,
    markCoachDone
  };
})(typeof window !== 'undefined' ? window : globalThis);
