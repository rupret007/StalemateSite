/**
 * Big hand-total badges (soft/hard indication).
 * @param {number} total
 * @param {boolean} isSoft
 * @param {boolean} hidden
 */
export function formatHandTotalBadge(total, isSoft, hidden = false) {
  if (hidden) {
    return { text: '?', mode: 'hidden', aria: 'Score hidden' };
  }
  const t = Number.isFinite(total) ? total : 0;
  if (t > 21) {
    return { text: String(t), mode: 'bust', aria: `Bust at ${t}` };
  }
  if (t === 21) {
    return { text: '21', mode: 'made', aria: 'Twenty-one' };
  }
  let mode = 'hard';
  if (isSoft) {mode = 'soft';}
  return {
    text: String(t),
    mode,
    aria: isSoft ? `Soft ${t}` : `Hard ${t}`
  };
}

/**
 * @param {{ text: string, mode: string }} badge
 * @returns {string}
 */
export function renderTotalBadgeHtml(badge) {
  const mode = badge.mode || 'hard';
  const aria = badge.aria ? ` aria-label="${String(badge.aria).replace(/"/g, '&quot;')}"` : '';
  return `<span class="total-badge mode-${mode}" data-mode="${mode}" role="status"${aria}>${badge.text}</span>`;
}
