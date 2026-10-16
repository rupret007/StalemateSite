/**
 * Bust-risk meter for player hands (21 pips, danger zone 17–21).
 * @param {number} total hand value after aces resolved
 * @param {boolean} isSoft
 * @returns {{ filled: number, danger: boolean, label: string }}
 */
export function handMeterState(total, isSoft) {
  const raw = Number.isFinite(total) ? total : 0;
  if (raw > 21) {
    return { filled: 21, danger: true, label: 'Bust' };
  }
  const t = Math.max(0, Math.min(21, raw));
  const filled = t;
  const danger = t >= 17 && t <= 21;
  let label = 'Building';
  if (t === 21) {label = 'Made 21';}
  else if (t >= 17) {label = isSoft ? 'Soft strong' : 'Standing zone';}
  else if (t >= 12) {label = 'Mid total';}
  else if (t > 0) {label = 'Low total';}
  return { filled, danger, label };
}

/**
 * @param {{ filled: number, danger: boolean, label: string }} state
 * @returns {string} HTML for .hand-meter
 */
export function renderHandMeterHtml(state) {
  const pips = [];
  for (let i = 1; i <= 21; i++) {
    const on = i <= state.filled;
    const danger = on && state.danger && i >= 17;
    pips.push(
      `<span class="pip${on ? ' on' : ''}${danger ? ' danger' : ''}" aria-hidden="true"></span>`
    );
  }
  return `<div class="hand-meter" role="presentation">${pips.join('')}<span class="label">${state.label}</span></div>`;
}
