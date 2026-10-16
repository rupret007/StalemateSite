import { stackShoeForDealOrder } from './turdjack-shoe-seed.js';
import {
  dealOrderForScenario,
  listTurdjackDevScenarios,
  scenarioPlaybook
} from './turdjack-dev-scenarios.js';

/**
 * @param {Window} win
 * @param {{
 *   prepareBetting: () => void,
 *   createFreshShoe: (decks?: number) => void,
 *   getShoe: () => Array<{ rank: string, suit: string }>,
 *   setBet: (amount: number) => void,
 *   deal: () => void,
 *   hit: () => void,
 *   stand: () => void,
 *   doubleDown: () => void,
 *   split: () => void,
 *   dismissGuide: () => void,
 * }} api
 */
export function attachTurdjackDev(win, api) {
  const host = win.location && win.location.hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') {return null;}

  const dev = {
    scenarios: listTurdjackDevScenarios(),
    _autoInsurance: null,

    prepare(scenario) {
      const order = dealOrderForScenario(scenario);
      if (!order) {throw new Error(`Unknown scenario: ${scenario}`);}
      api.dismissGuide();
      api.prepareBetting();
      api.createFreshShoe(1);
      stackShoeForDealOrder(api.getShoe(), order);
      api.setBet(10);
      const book = scenarioPlaybook(scenario);
      dev._autoInsurance = book.autoInsurance || null;
      return { scenario, order, book };
    },

    playScenario(scenario) {
      const { book } = dev.prepare(scenario);
      api.deal();
      globalThis.setTimeout(() => {
        if (book.afterDeal === 'hit') {api.hit();}
        else if (book.afterDeal === 'split') {api.split();}
        else if (book.afterDeal === 'double') {api.doubleDown();}
        else if (book.afterDeal === 'stand') {api.stand();}
      }, 80);
    }
  };

  win.__turdjackDev = dev;
  return dev;
}
