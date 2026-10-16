/** Board dimensions preserve room for the phone HUD, previews, and thumb dock. */
export const MOBILE_BOARD_FOCUS_MAX_WIDTH = 980;

/** Side columns + gap reserved beside the well on desktop cabinets. */
export const DESKTOP_CABINET_HORIZONTAL_RESERVE = 360;

/** Top chrome (title row + padding) on desktop play viewports. */
export const DESKTOP_CABINET_VERTICAL_CHROME = 108;

export function shouldUseBoardFocusLayout(viewportWidth) {
  const w = Number(viewportWidth);
  if (!Number.isFinite(w)) {return false;}
  return w > 0 && w <= MOBILE_BOARD_FOCUS_MAX_WIDTH;
}

function positiveDimension(value, fallback) {
  const dimension = Number(value);
  return Number.isFinite(dimension) && dimension > 0 ? dimension : fallback;
}

/**
 * CSS stays responsive to dynamic browser chrome and the device safe area.
 * Numeric dimensions let callers check fit without reading layout on each frame.
 * safeAreaBottom is the measured CSS environment inset, in pixels, when available.
 */
export function boardCanvasCssWidth(viewportWidth, viewportHeight, safeAreaBottom = 0) {
  const w = positiveDimension(viewportWidth, 390);
  const h = positiveDimension(viewportHeight, 844);
  const inset = Number.isFinite(Number(safeAreaBottom)) ? Math.max(0, Number(safeAreaBottom)) : 0;
  const mobile = shouldUseBoardFocusLayout(w);
  if (!mobile) {
    const chrome = DESKTOP_CABINET_VERTICAL_CHROME;
    const boardWidth = Math.max(
      0,
      Math.min(
        420,
        Math.floor((h - chrome - inset) / 2),
        Math.floor((w - DESKTOP_CABINET_HORIZONTAL_RESERVE) / 2)
      )
    );
    const cssWidth = `min(420px, calc((100dvh - ${chrome}px - env(safe-area-inset-bottom)) / 2), calc((100vw - ${DESKTOP_CABINET_HORIZONTAL_RESERVE}px) / 2))`;
    return {
      width: cssWidth,
      boardWidth,
      boardHeight: boardWidth * 2,
      horizontalReservation: DESKTOP_CABINET_HORIZONTAL_RESERVE,
      verticalReservation: chrome,
      safeAreaBottom: inset,
      mobile
    };
  }
  const horizontalReservation = 42;
  const verticalReservation = h <= 700 ? 302 : 330;
  const boardWidth = Math.max(0, Math.min(w - horizontalReservation, (h - verticalReservation - inset) / 2));
  return {
    width: `min(calc(100vw - ${horizontalReservation}px), calc((100dvh - ${verticalReservation}px - env(safe-area-inset-bottom)) / 2))`,
    boardWidth,
    boardHeight: boardWidth * 2,
    horizontalReservation,
    verticalReservation,
    safeAreaBottom: inset,
    mobile
  };
}
