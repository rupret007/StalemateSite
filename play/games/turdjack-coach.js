/** Basic-strategy coach UI helpers (button highlight + practice checks). */

export const ACTION_BUTTON_IDS = {
  hit: 'hitBtn',
  stand: 'standBtn',
  double: 'doubleBtn',
  split: 'splitBtn',
  surrender: 'surrenderBtn',
  deal: 'dealBtn'
};

/**
 * @param {string} action
 * @returns {string|null}
 */
export function coachButtonIdForAction(action) {
  if (!action) {return null;}
  return ACTION_BUTTON_IDS[action] || null;
}

/**
 * @param {string} playerAction
 * @param {string} optimalAction
 * @returns {boolean}
 */
export function isOptimalDecision(playerAction, optimalAction) {
  return String(playerAction) === String(optimalAction);
}

/**
 * @param {{ action: string, reason: string }|null} advice
 * @returns {string}
 */
export function coachWhyLine(advice) {
  if (!advice || !advice.action) {return '';}
  const label = advice.action.charAt(0).toUpperCase() + advice.action.slice(1);
  return `${label}: ${advice.reason || ''}`.trim();
}
