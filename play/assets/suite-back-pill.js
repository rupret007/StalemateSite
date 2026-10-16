/**
 * Back-to-hub pill placement helpers (CSS does the layout; these are for tests/tools).
 */

/** Viewport width at which shared CSS moves the pill to the top-left. */
export const NARROW_BACK_PILL_MAX_WIDTH = 520;

/** Compact top-left control size (matches shared CSS). */
export const BACK_PILL_TAP_SIZE = 44;

/** Gap between pill and page chrome after reserve (matches shared CSS). */
export const BACK_PILL_RESERVE_GAP = 10;

/**
 * Horizontal padding to keep titles/HUD clear of the top-left pill (px).
 * @param {{ suiteBack?: string } | DOMStringMap | undefined} dataset
 * @param {number} viewportWidth
 * @param {number} [safeLeft=8]
 */
export function backPillReserveX(dataset, viewportWidth, safeLeft = 8) {
  if (resolveBackPillPlacement(dataset, viewportWidth) === 'bottom') return 0;
  const inset = Math.max(8, safeLeft + 6);
  return inset + BACK_PILL_TAP_SIZE + BACK_PILL_RESERVE_GAP;
}

/**
 * @param {{ suiteBack?: string, suiteBackPill?: string } | DOMStringMap | undefined} dataset
 * @param {number} viewportWidth
 * @returns {'top' | 'bottom'}
 */
export function resolveBackPillPlacement(dataset, viewportWidth) {
  const raw = dataset?.suiteBack || dataset?.suiteBackPill || 'auto';
  const placement = String(raw).toLowerCase();
  if (placement === 'bottom') return 'bottom';
  if (placement === 'top') return 'top';
  if (Number(viewportWidth) <= NARROW_BACK_PILL_MAX_WIDTH) return 'top';
  return 'bottom';
}

/**
 * Axis-aligned box intersection (screen coordinates).
 * @param {{ left: number, top: number, right: number, bottom: number }} a
 * @param {{ left: number, top: number, right: number, bottom: number }} b
 */
export function boxesIntersect(a, b) {
  if (!a || !b) return false;
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/**
 * True if the hub pill overlaps any visible interactive control.
 * @param {{ left: number, top: number, right: number, bottom: number }} pillBox
 * @param {Array<{ left: number, top: number, right: number, bottom: number }>} controlBoxes
 */
export function pillOverlapsControls(pillBox, controlBoxes) {
  if (!pillBox || !controlBoxes?.length) return false;
  for (let i = 0; i < controlBoxes.length; i++) {
    if (boxesIntersect(pillBox, controlBoxes[i])) return true;
  }
  return false;
}

/**
 * @param {{ left: number, top: number, right: number, bottom: number }} rect
 * @param {number} vw
 * @param {number} vh
 */
export function isFullViewportBackdrop(rect, vw, vh) {
  if (!rect || vw <= 0 || vh <= 0) return false;
  const w = rect.width != null ? rect.width : rect.right - rect.left;
  const h = rect.height != null ? rect.height : rect.bottom - rect.top;
  return w >= vw * 0.94 && h >= vh * 0.94;
}

/**
 * Whether an element counts as an overlap target for the back pill (Playwright parity).
 * @param {string} tag
 * @param {string} role
 * @param {string} text
 * @param {boolean} isCanvasHudChip
 */
export function isBackPillOverlapTarget(tag, role, text, isCanvasHudChip = false) {
  if (isCanvasHudChip) return true;
  const trimmed = String(text || '').replace(/\s+/g, ' ').trim();
  if (trimmed.length > 0) return true;
  const t = String(tag || '').toLowerCase();
  const r = String(role || '').toLowerCase();
  if (t === 'button' || t === 'a' || t === 'input' || t === 'select' || t === 'textarea') return true;
  if (r === 'button' || r === 'link' || r === 'tab') return true;
  return false;
}
