/**
 * Shared accessibility helpers (skip link, live region).
 */

export const SKIP_LINK_CLASS = 'suite-skip-link';
export const LIVE_REGION_ID = 'suite-live-region';

export function injectSkipLink(doc, targetId = 'hub-games', label = 'Skip to games') {
  if (!doc || !doc.body) return null;
  if (doc.querySelector(`.${SKIP_LINK_CLASS}`)) {
    return doc.querySelector(`.${SKIP_LINK_CLASS}`);
  }
  const target = doc.getElementById(targetId);
  if (!target) return null;
  const a = doc.createElement('a');
  a.className = SKIP_LINK_CLASS;
  a.href = `#${targetId}`;
  a.textContent = label;
  doc.body.insertBefore(a, doc.body.firstChild);
  return a;
}

export function createAnnouncer(doc) {
  let el = doc.getElementById(LIVE_REGION_ID);
  if (!el) {
    el = doc.createElement('div');
    el.id = LIVE_REGION_ID;
    el.className = 'suite-live-region';
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-atomic', 'true');
    el.setAttribute('role', 'status');
    doc.body.appendChild(el);
  }

  return {
    announce(message, politeness = 'polite') {
      if (!message) return;
      el.setAttribute('aria-live', politeness === 'assertive' ? 'assertive' : 'polite');
      el.textContent = '';
      // Force screen readers to notice the change
      void el.offsetWidth;
      el.textContent = String(message);
    },
    element: el
  };
}
