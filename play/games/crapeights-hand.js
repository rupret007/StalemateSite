/* Fitted fan geometry: no horizontal scrolling and a separate exposed tap lane. */
(function (root) {
  'use strict';
  function layout(count, availableWidth, compact = false) {
    const total = Math.max(0, Math.min(52, Math.floor(Number(count) || 0)));
    const width = Math.max(180, Number(availableWidth) || 300);
    const inset = 14;
    const capacity = Math.max(1, Math.floor((width - inset * 2 - 78) / 48) + 1);
    const rows = Math.max(1, Math.ceil(total / capacity));
    const perRow = Math.ceil(total / rows);
    const cardWidth = Math.min(width > 650 ? (compact ? 92 : 108) : 84, width - inset * 2 - Math.max(0, perRow - 1) * 48);
    const cardHeight = Math.round(cardWidth * 1.42);
    const stride = cardHeight - 44;
    const cards = Array.from({ length: total }, (_, index) => {
      const row = Math.floor(index / perRow);
      const size = Math.min(perRow, total - row * perRow);
      const offset = index % perRow - (size - 1) / 2;
      const step = Math.min(cardWidth * 0.74, (width - inset * 2 - cardWidth) / Math.max(1, size - 1));
      const arc = size > 1 ? offset / ((size - 1) / 2) : 0;
      return { x: (width - cardWidth) / 2 + offset * step, y: (compact ? 28 : 34) + row * stride + arc * arc * 10,
        angle: arc * 4, row, z: index + 1 };
    });
    return { cards, rows, cardWidth, cardHeight, height: total ? (compact ? 48 : 58) + cardHeight + (rows - 1) * stride : 70 };
  }
  root.CrapeightsHand = Object.freeze({ layout });
})(globalThis);
