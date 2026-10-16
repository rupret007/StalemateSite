/** Table moment banners + bankroll tween helpers. */

/**
 * @param {string} statusText
 * @returns {'blackjack'|'bust'|'push'|'insurance'|'win'|null}
 */
export function momentKindFromStatus(statusText) {
  const t = String(statusText || '').toLowerCase();
  if (!t) {return null;}
  if (t.includes('even money') || (t.includes('blackjack') && !t.includes('dealer'))) {
    return 'blackjack';
  }
  if (t.includes('insurance hit') || (t.includes('insurance') && t.includes('win'))) {
    return 'insurance';
  }
  if (t.includes('bust') && !t.includes('dealer bust')) {return 'bust';}
  if (t.includes('push') || t.includes('stalemate')) {return 'push';}
  if (t.includes('beats dealer') || t.includes('dealer bust') || t.includes('paid')) {
    return 'win';
  }
  return null;
}

/**
 * @param {'blackjack'|'bust'|'push'|'insurance'|'win'} kind
 */
export function momentBannerCopy(kind) {
  if (kind === 'blackjack') {return 'CRAPJACK!'; }
  if (kind === 'bust') {return 'FLUSHED!'; }
  if (kind === 'push') {return 'STINKY PUSH'; }
  if (kind === 'insurance') {return 'INSURANCE PAID'; }
  if (kind === 'win') {return 'CHIPS INCOMING'; }
  if (kind === 'split') {return 'SPLIT THE PAIR'; }
  if (kind === 'double') {return 'DOUBLE DOWN'; }
  return '';
}

/**
 * Linear tween steps for bankroll display.
 * @param {number} from
 * @param {number} to
 * @param {number} steps
 */
export function bankrollTweenSteps(from, to, steps = 12) {
  const a = Number.isFinite(from) ? from : 0;
  const b = Number.isFinite(to) ? to : 0;
  if (steps <= 1 || a === b) {return [b];}
  const out = [];
  for (let i = 1; i <= steps; i++) {
    out.push(Math.round(a + ((b - a) * i) / steps));
  }
  return out;
}

/**
 * @param {number} hot
 * @param {number} cold
 */
export function tableEdgeStreakLabel(hot, cold) {
  if (hot >= 3) {return `🔥 Heater ×${hot}`;}
  if (cold >= 3) {return `🧊 Cold ×${cold}`;}
  return '';
}
