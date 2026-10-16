import { card } from './turdjack-shoe-seed.js';

/**
 * Opening deal order: player, dealer up, player, dealer hole (each pop).
 * @typedef {'blackjack'|'bust'|'push'|'split'|'double'|'insurance'} TurdjackDevScenario
 */

/** @type {Record<TurdjackDevScenario, Array<{ rank: string, suit: string }>>} */
export const TURDJACK_DEV_DEAL_ORDER = {
  blackjack: [card('A'), card('9'), card('K'), card('7')],
  bust: [card('6'), card('9'), card('6'), card('4'), card('10')],
  push: [card('10'), card('10'), card('10'), card('10')],
  split: [card('8'), card('6'), card('8'), card('10')],
  double: [card('5'), card('6'), card('6'), card('10'), card('10')],
  insurance: [card('10'), card('A'), card('10'), card('K')]
};

/** @returns {TurdjackDevScenario[]} */
export function listTurdjackDevScenarios() {
  return Object.keys(TURDJACK_DEV_DEAL_ORDER);
}

/**
 * @param {TurdjackDevScenario} name
 */
export function dealOrderForScenario(name) {
  return TURDJACK_DEV_DEAL_ORDER[name] ? [...TURDJACK_DEV_DEAL_ORDER[name]] : null;
}

/**
 * @param {TurdjackDevScenario} name
 * @returns {{ afterDeal?: 'hit'|'split'|'double'|'stand', autoInsurance?: 'buy'|'skip' }}
 */
export function scenarioPlaybook(name) {
  if (name === 'bust') {return { afterDeal: 'hit' };}
  if (name === 'split') {return { afterDeal: 'split' };}
  if (name === 'double') {return { afterDeal: 'double' };}
  if (name === 'insurance') {return { autoInsurance: 'buy', afterDeal: 'stand' };}
  if (name === 'blackjack') {return { afterDeal: 'stand' };}
  if (name === 'push') {return { afterDeal: 'stand' };}
  return {};
}
