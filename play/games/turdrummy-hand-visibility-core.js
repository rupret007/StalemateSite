/* TurdRummy: corner-index visibility for fanned hands (layout + QA).
   Classic script for turdrummy.html; games/turdrummy-hand-visibility.js re-exports for vitest. */
(function attachTurdRummyHandVisibility(root) {
  'use strict';

  const CORNER_INDEX_WIDTH = 16;
  const CORNER_INDEX_HEIGHT = 26;

  /** Minimum horizontal fan step so each card's top-left index clears the card to its left (with z-index stacking).
   *  `extraPx` covers face inset (card padding) so the 16×26 audit box, which is
   *  measured from `.card-face`, still sits on this card. */
  function minFanStepPx(cardWidth, extraPx) {
    const w = Math.max(0, Number(cardWidth) || 0);
    const extra = Math.max(0, Number(extraPx) || 0);
    return Math.min(w, CORNER_INDEX_WIDTH + extra);
  }

  function minFanStepRatio(cardWidth, extraPx) {
    const w = Math.max(1, Number(cardWidth) || 1);
    return minFanStepPx(w, extraPx) / w;
  }

  /**
   * Top-left index hit box in viewport coordinates (matches Playwright smoke).
   * @param {DOMRect|{left:number,top:number,width?:number,height?:number}} cardRect
   */
  function cornerIndexRect(cardRect) {
    const left = Number(cardRect.left) || 0;
    const top = Number(cardRect.top) || 0;
    return {
      left,
      top,
      right: left + CORNER_INDEX_WIDTH,
      bottom: top + CORNER_INDEX_HEIGHT,
      width: CORNER_INDEX_WIDTH,
      height: CORNER_INDEX_HEIGHT
    };
  }

  function rectContainsPoint(rect, x, y) {
    return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
  }

  function handCardFrom(node) {
    if (!node || !node.closest) {
      return null;
    }
    return node.closest('#playerHand .card-button, #playerHand .card');
  }

  /** True when the point is on this card, or on non-card chrome (dock, drawer, etc.). */
  function indexPointVisibleForCard(card, x, y) {
    if (!card) {
      return false;
    }
    const hit = document.elementFromPoint(x, y);
    if (!hit) {
      return false;
    }
    if (card === hit || card.contains(hit)) {
      return true;
    }
    const other = handCardFrom(hit);
    if (other && other !== card) {
      return false;
    }
    if (hit.closest('.coach, #coachCard')) {
      return false;
    }
    return true;
  }

  /**
   * DOM audit: each hand card's top-left index region must belong to that card (not a neighbour).
   * @param {ParentNode} handRoot usually #playerHand
   * @returns {{ok: boolean, failures: Array<{id: string, reason: string}>}}
   */
  function auditHandCornerIndices(handRoot) {
    const root = handRoot || document.getElementById('playerHand');
    const failures = [];
    if (!root || typeof document.elementFromPoint !== 'function') {
      return { ok: false, failures: [{ id: '', reason: 'missing hand root or elementFromPoint' }] };
    }
    const cards = [...root.querySelectorAll('.card-button, .card')].filter((el) => el.closest('#playerHand'));
    for (const card of cards) {
      const id = card.getAttribute('data-card-id') || card.getAttribute('data-hand-id') || '';
      const face = card.querySelector('.card-face');
      const box = (face || card).getBoundingClientRect();
      if (!box.width || !box.height) {
        continue;
      }
      const index = cornerIndexRect(box);
      const samples = [
        [index.left + 2, index.top + 2],
        [index.left + index.width - 2, index.top + 2],
        [index.left + 2, index.top + index.height - 2],
        [index.left + index.width - 2, index.top + index.height - 2]
      ];
      let blocked = false;
      for (const [sx, sy] of samples) {
        if (!rectContainsPoint(index, sx, sy)) {
          blocked = true;
          break;
        }
        if (!indexPointVisibleForCard(card, sx, sy)) {
          blocked = true;
          break;
        }
      }
      if (blocked) {
        failures.push({ id, reason: 'index region covered by another card' });
      }
    }
    return { ok: failures.length === 0, failures };
  }

  root.TurdRummyHandVisibility = {
    CORNER_INDEX_WIDTH,
    CORNER_INDEX_HEIGHT,
    minFanStepPx,
    minFanStepRatio,
    cornerIndexRect,
    auditHandCornerIndices
  };
})(typeof window !== 'undefined' ? window : globalThis);
