/* TurdRummy hand display helpers: meld grouping and fan spacing.
   Classic script: attaches TurdRummyMeld on globalThis so turdrummy.html can
   use it from a plain <script> tag. games/turdrummy-meld.js re-exports this
   API for unit tests (see games/table-continue-core.js for the same split).

   Pure layout math only. The solver that decides which cards are melded still
   lives in turdrummy.html (analyzeHand); these helpers only arrange its result
   on screen. */
(function attachTurdRummyMeld(root) {
  'use strict';

  /**
   * Orders an analysis result for display. Each meld becomes one contiguous
   * group, in the order the analysis found them, followed by one deadwood group.
   * @param {{melds?: Array<{type: string, cards: Array}>, deadwoodCards?: Array}} analysis
   * @returns {Array<{kind: 'set'|'run'|'deadwood', label: string, cards: Array}>}
   */
  function groupHandForDisplay(analysis) {
    const groups = [];
    const melds = (analysis && Array.isArray(analysis.melds)) ? analysis.melds : [];
    for (const meld of melds) {
      if (!meld || !Array.isArray(meld.cards) || meld.cards.length === 0) {
        continue;
      }
      const isSet = meld.type === 'set';
      groups.push({ kind: isSet ? 'set' : 'run', label: isSet ? 'Set' : 'Run', cards: meld.cards.slice() });
    }
    const deadwood = (analysis && Array.isArray(analysis.deadwoodCards)) ? analysis.deadwoodCards : [];
    if (deadwood.length > 0) {
      groups.push({ kind: 'deadwood', label: 'Deadwood', cards: deadwood.slice() });
    }
    return groups;
  }

  /**
   * How far each card is offset from the one before it, so the hand fits one row.
   * Inside a group, cards sit `step` apart. Each group starts at full card width,
   * and a group boundary adds `groupGap` on top, so for G groups of N cards:
   *   width = G*cardWidth + (N-G)*step + (G-1)*groupGap
   * Overlap is capped at `maxStepRatio` (a fan, not a stack). If one row would leave
   * less than `readableRatio` of each card visible (0.42 by default), `wrap` is true:
   * groups should flow onto a second row, and `step` is the largest overlap the biggest
   * group allows in one row (never below `minStepRatio`).
   * @returns {{step: number, width: number, cardWidth: number, wrap: boolean}} px.
   */
  function fanLayout(options) {
    const cardWidth = Math.max(0, Number(options.cardWidth) || 0);
    const count = Math.max(0, Math.floor(Number(options.count) || 0));
    const groups = Math.max(1, Math.floor(Number(options.groupCount) || 1));
    const available = Math.max(0, Number(options.availableWidth) || 0);
    const groupGap = Math.max(0, Number(options.groupGap) || 0);
    const largest = Math.max(1, Math.floor(Number(options.largestGroup) || count || 1));
    const maxRatio = options.maxStepRatio === undefined ? 0.6 : options.maxStepRatio;
    const indexStrip = options.indexStripPx === undefined ? 16 : Math.max(0, Number(options.indexStripPx) || 0);
    const indexRatio = cardWidth > 0 ? indexStrip / cardWidth : 0;
    const minRatio = Math.max(
      options.minStepRatio === undefined ? 0.3 : options.minStepRatio,
      indexRatio
    );
    if (count <= 1) {
      return { step: cardWidth, width: cardWidth, cardWidth, wrap: false };
    }
    const gaps = Math.max(0, groups - 1) * groupGap;
    const overlapCards = count - groups;
    if (overlapCards <= 0) {
      return { step: cardWidth, width: groups * cardWidth + gaps, cardWidth, wrap: false };
    }
    const fit = (available - groups * cardWidth - gaps) / overlapCards;
    // With several groups, a single row must leave a readable strip (corner rank + suit).
    // A lone group cannot wrap, so it simply takes the smallest strip that fits.
    const readableRatio = groups > 1
      ? Math.max(
        options.readableRatio === undefined ? 0.42 : options.readableRatio,
        indexRatio
      )
      : minRatio;
    if (fit >= cardWidth * readableRatio) {
      const step = Math.min(cardWidth * maxRatio, fit);
      return {
        step,
        width: groups * cardWidth + overlapCards * step + gaps,
        cardWidth,
        wrap: false
      };
    }
    // Crowded: let the groups wrap. Each row must hold the largest group at this overlap.
    const wrapStep = Math.min(cardWidth * maxRatio, (available - cardWidth) / Math.max(1, largest - 1));
    const step = Math.max(cardWidth * minRatio, wrapStep);
    return { step, width: available, cardWidth, wrap: true };
  }

  /**
   * Arc transform for one card in a fan. The middle card is level; cards toward
   * the edges tilt outward and drop slightly, so the hand reads as a curve.
   * @returns {{rotate: number, lift: number}} rotate in degrees, lift in px (positive = down).
   */
  function fanTransform(index, count, options) {
    const total = Math.max(1, Math.floor(count));
    const at = Math.min(total - 1, Math.max(0, Math.floor(index)));
    const centred = at - (total - 1) / 2;
    const maxTilt = options && options.maxTilt !== undefined ? options.maxTilt : 9;
    const maxSpan = Math.max(1, (total - 1) / 2);
    const rotate = (centred / maxSpan) * maxTilt;
    const arc = options && options.arc !== undefined ? options.arc : 9;
    const lift = (Math.abs(centred) / maxSpan) ** 2 * arc;
    return { rotate: Number(rotate.toFixed(2)), lift: Number(lift.toFixed(2)) };
  }

  root.TurdRummyMeld = {
    groupHandForDisplay,
    fanLayout,
    fanTransform
  };
})(typeof window !== 'undefined' ? window : globalThis);
