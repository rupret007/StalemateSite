/* global Element, getComputedStyle */
/**
 * Shared helpers for Playwright overlap checks on tall table / arcade play pages.
 * Standalone (no imports) so Playwright can dynamic-import this file in the browser.
 */

function boxesIntersect(a, b) {
  if (!a || !b) {
    return false;
  }
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function isFullViewportBackdrop(rect, vw, vh) {
  if (!rect || vw <= 0 || vh <= 0) {
    return false;
  }
  const w = rect.width !== null && rect.width !== undefined ? rect.width : rect.right - rect.left;
  const h = rect.height !== null && rect.height !== undefined ? rect.height : rect.bottom - rect.top;
  return w >= vw * 0.94 && h >= vh * 0.94;
}

export const FLOATING_SELECTOR = [
  '#suite-music-toggle',
  '#suite-arcade-a11y-toggle',
  '#suite-arcade-a11y-mount',
  'a.suite-back-pill',
  '.suite-toast.show',
  '#jackConfirmOverlay[aria-hidden="false"]'
].join(',');

const DECOR_FIXED_SKIP = new Set(['suite-bg', 'suite-bg-tiles', 'suite-bg-wisp', 'suite-bg-bubble']);

/**
 * @param {Element} el
 * @returns {{ left: number, top: number, right: number, bottom: number, width: number, height: number } | null}
 */
export function visibleBox(el) {
  if (!el || !(el instanceof Element)) {
    return null;
  }
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
    return null;
  }
  if (style.pointerEvents === 'none') {
    return null;
  }
  const rect = el.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) {
    return null;
  }
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height
  };
}

/**
 * @param {{ left: number, top: number, right: number, bottom: number }} rect
 * @param {number} vw
 * @param {number} vh
 */
export function rectInViewport(rect, vw, vh) {
  if (!rect) {
    return false;
  }
  return rect.bottom > 1 && rect.top < vh - 1 && rect.right > 1 && rect.left < vw - 1;
}

/**
 * Collect fixed / floating layers that can steal taps from play controls.
 * @param {Document} doc
 */
export function collectFloatingBoxes(doc) {
  const vw = doc.defaultView?.innerWidth ?? 0;
  const vh = doc.defaultView?.innerHeight ?? 0;
  const floats = [];
  const seen = new Set();

  function push(el, label) {
    if (!el || seen.has(el)) {
      return;
    }
    const box = visibleBox(el);
    if (!box || isFullViewportBackdrop(box, vw, vh)) {
      return;
    }
    seen.add(el);
    floats.push({ el, label, box });
  }

  for (const sel of FLOATING_SELECTOR.split(',').map((s) => s.trim())) {
    doc.querySelectorAll(sel).forEach((el) => push(el, sel));
  }

  doc.querySelectorAll('body *').forEach((el) => {
    if (!(el instanceof Element) || seen.has(el)) {
      return;
    }
    const id = el.id || '';
    const cls = typeof el.className === 'string' ? el.className : '';
    if (DECOR_FIXED_SKIP.has(id) || cls.split(/\s+/).some((c) => DECOR_FIXED_SKIP.has(c))) {
      return;
    }
    const pos = getComputedStyle(el).position;
    if (pos !== 'fixed' && pos !== 'sticky') {
      return;
    }
    push(el, `fixed:${id || cls || el.tagName.toLowerCase()}`);
  });

  return floats;
}

/**
 * @param {Document} doc
 * @param {string[]} controlSelectors
 */
export function measurePlayOverlap(doc, controlSelectors) {
  const vw = doc.defaultView?.innerWidth ?? 0;
  const vh = doc.defaultView?.innerHeight ?? 0;
  const floats = collectFloatingBoxes(doc);
  const issues = [];

  for (const sel of controlSelectors) {
    doc.querySelectorAll(sel).forEach((ctrl) => {
      const box = visibleBox(ctrl);
      if (!box || !rectInViewport(box, vw, vh)) {
        return;
      }
      const cx = box.left + box.width / 2;
      const cy = box.top + box.height / 2;
      const hit = doc.elementFromPoint(cx, cy);
      const receivesHit =
        hit === ctrl || (hit instanceof Element && (ctrl.contains(hit) || hit.contains(ctrl)));
      if (!receivesHit) {
        issues.push({
          kind: 'hit',
          control: sel,
          id: ctrl.id || ctrl.getAttribute('data-mobile-action') || ctrl.className,
          blocker: hit?.id || hit?.className || hit?.tagName
        });
      }
      for (const f of floats) {
        if (f.el === ctrl || f.el.contains(ctrl) || ctrl.contains(f.el)) {
          continue;
        }
        if (boxesIntersect(box, f.box)) {
          issues.push({
            kind: 'box',
            control: sel,
            id: ctrl.id || ctrl.getAttribute('data-mobile-action') || ctrl.className,
            float: f.label
          });
        }
      }
    });
  }

  return issues;
}
