/**
 * Scroll / viewport focus helpers for narrow-phone live hands.
 */
import {
  playFocusScrollBehavior,
  useCompactBetweenHandsHud,
  useTableFirstPlayLayout
} from './turdjack-layout.js';

export { useCompactBetweenHandsHud };

/**
 * @param {DOMRect|{top:number,left:number,bottom:number,right:number}} rect
 * @param {number} viewportWidth
 * @param {number} viewportHeight
 * @param {number} [slack]
 */
export function rectInsideViewport(rect, viewportWidth, viewportHeight, slack = 2) {
  const w = Number.isFinite(viewportWidth) ? viewportWidth : 0;
  const h = Number.isFinite(viewportHeight) ? viewportHeight : 0;
  return (
    rect.top >= -slack &&
    rect.left >= -slack &&
    rect.bottom <= h + slack &&
    rect.right <= w + slack
  );
}

/**
 * Keep dealer, player, totals, and mobile pit actions on-screen during a live hand.
 * @param {Document} doc
 * @param {{ roundActive: boolean, viewportWidth: number, viewportHeight: number, reducedMotion?: boolean }} opts
 */
export function focusPlayTable(doc, opts) {
  const {
    roundActive,
    viewportWidth,
    viewportHeight,
    reducedMotion = false
  } = opts;
  if (!useTableFirstPlayLayout(viewportWidth, viewportHeight, roundActive)) {
    return;
  }
  const behavior = playFocusScrollBehavior(reducedMotion);
  const dealer = doc.getElementById('dealerCards');
  const player = doc.getElementById('playerCards');
  const pit = doc.getElementById('mobilePit');
  const anchor = dealer || doc.querySelector('.table');
  if (anchor) {
    anchor.scrollIntoView({ block: 'start', inline: 'nearest', behavior });
  }
  if (player) {
    player.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior });
  }
  if (pit && pit.offsetParent !== null) {
    pit.scrollIntoView({ block: 'end', inline: 'nearest', behavior });
  }
}

/**
 * @param {Document} doc
 * @param {{ roundActive: boolean, viewportWidth: number, viewportHeight: number }} opts
 */
export function applyTableFirstBodyClass(doc, opts) {
  const on = useTableFirstPlayLayout(opts.viewportWidth, opts.viewportHeight, opts.roundActive);
  doc.body.classList.toggle('jack-table-first', on);
  return on;
}
