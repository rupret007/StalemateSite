/* Desktop / wide viewport playfield sizing (portrait-first theater). */
(function attachTurdanoidLayout(root) {
  'use strict';

  /** Width / height of the reference phone playfield. */
  const REF_WIDTH = 390;
  const REF_HEIGHT = 844;
  const ASPECT = REF_WIDTH / REF_HEIGHT;

  /**
   * @param {number} stageW
   * @param {number} stageH
   * @returns {{ canvasW: number, canvasH: number, wide: boolean }}
   */
  function computePlayfield(stageW, stageH) {
    const sw = Math.max(1, Math.floor(stageW));
    const sh = Math.max(1, Math.floor(stageH));
    const wide = sw >= 720 && sw / sh > 1.12;
    if (!wide) {
      return { canvasW: sw, canvasH: sh, wide: false };
    }
    let canvasH = sh;
    let canvasW = Math.floor(canvasH * ASPECT);
    const maxW = Math.floor(sw * 0.56);
    if (canvasW > maxW) {
      canvasW = maxW;
      canvasH = Math.floor(canvasW / ASPECT);
    }
    canvasW = Math.max(320, canvasW);
    canvasH = Math.max(480, canvasH);
    canvasW -= canvasW % 2;
    canvasH -= canvasH % 2;
    return { canvasW, canvasH, wide: true };
  }

  /**
   * HUD insets so phone chrome clears the suite back pill and stays readable.
   * Tracking is in em; keep labels under 0.12 so words do not mash.
   */
  function hudMetrics(viewportWidth, safeLeft = 0) {
    const vw = Math.max(0, Number(viewportWidth) || 0);
    const narrow = vw > 0 && vw <= 520;
    const pillReserve = narrow ? 68 : 0;
    const left = Math.max(10, Math.floor(safeLeft) + pillReserve);
    // Phone chrome reserves the mute/pause cluster once, via the HUD box
    // inset (`right`). The lives column must not add a second inner margin.
    const right = narrow ? 108 : 10;
    return {
      narrow,
      left,
      right,
      innerRightMargin: narrow ? 0 : 104,
      top: 10,
      minTap: 44,
      trackingHud: 0.02,
      trackingLabel: 0.08,
      trackingButton: 0.06,
      hideLabelsBelow: 0,
      maxLifePips: 5
    };
  }

  /** Porcelain seat pips so life count stays countable on a phone bar. */
  function lifePipsHtml(count) {
    const n = Math.max(0, Math.floor(Number(count) || 0));
    if (n <= 0) {
      return '—';
    }
    const shown = Math.min(n, 5);
    let html = '';
    for (let i = 0; i < shown; i += 1) {
      html += '<i class="life-pip" aria-hidden="true"></i>';
    }
    if (n > 5) {
      html += `<span class="life-extra">×${n}</span>`;
    }
    return html;
  }

  /** Split "World · Level N · Pattern" so the hype plaque can wrap. */
  function splitHypeLine(msg) {
    const raw = String(msg === undefined || msg === null ? '' : msg).trim();
    const parts = raw
      .split(' · ')
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length >= 2) {
      return { kicker: parts[0], title: parts.slice(1).join(' · ') };
    }
    return { kicker: '', title: raw };
  }

  root.TurdanoidLayout = {
    REF_WIDTH,
    REF_HEIGHT,
    ASPECT,
    computePlayfield,
    hudMetrics,
    lifePipsHtml,
    splitHypeLine
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
