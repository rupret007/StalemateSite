/**
 * Round / match scoring receipt overlay (count-up, drama).
 */

/* global requestAnimationFrame, performance */

export function prefersReducedMotion() {
  try {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
  } catch {
    return false;
  }
}

export function formatReceiptLine(label, value) {
  const sign = value >= 0 ? '+' : '';
  return `${label}: ${sign}${value}`;
}

/**
 * @param {HTMLElement} root overlay host
 * @param {object} payload
 */
export function showScoringReceipt(root, payload, options = {}) {
  if (!root) {
    return Promise.resolve();
  }
  const reduced = options.reduced ?? prefersReducedMotion();
  const duration = reduced ? 0 : 2200;
  root.innerHTML = '';
  root.classList.add('show');
  const card = document.createElement('div');
  card.className = 'ts-receipt-card';
  card.innerHTML = `<h3>${payload.title || 'Round receipt'}</h3><ul class="ts-receipt-lines"></ul><div class="ts-receipt-total"></div>`;
  root.appendChild(card);
  const ul = card.querySelector('.ts-receipt-lines');
  const totalEl = card.querySelector('.ts-receipt-total');
  for (const line of payload.lines || []) {
    const li = document.createElement('li');
    li.textContent = line;
    ul.appendChild(li);
  }
  const target = payload.total ?? 0;
  if (duration === 0) {
    totalEl.textContent = `Round total: ${target >= 0 ? '+' : ''}${target}`;
    return new Promise((resolve) => {
      setTimeout(() => {
        root.classList.remove('show');
        resolve();
      }, 120);
    });
  }
  const start = performance.now();
  return new Promise((resolve) => {
    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      const val = Math.round(target * t);
      totalEl.textContent = `Round total: ${val >= 0 ? '+' : ''}${val}`;
      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        setTimeout(() => {
          root.classList.remove('show');
          resolve();
        }, 600);
      }
    }
    requestAnimationFrame(tick);
  });
}
