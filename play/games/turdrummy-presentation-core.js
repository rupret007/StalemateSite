/* TurdRummy round-end presentation timing: banner visibility, trophy delay, hard cap.
   Classic script for turdrummy.html; games/turdrummy-presentation.js re-exports for vitest. */
(function attachTurdRummyPresentation(root) {
  'use strict';

  /** How long the round banner stays up if not skipped (must stay under ~3s total moment). */
  const ROUND_BANNER_VISIBLE_MS = 2800;

  /** After the banner clears, wait this long before the match trophy (readable gap). */
  const MATCH_TROPHY_AFTER_BANNER_MS = 450;

  /** Hard cap: auto-skip any round-end presentation (banner + stagger) at this limit. */
  const PRESENTATION_AUTO_SKIP_MS = 3000;

  /** Stagger step for opponent flip reveal at round end. */
  const REVEAL_STAGGER_STEP_MS = 90;

  /** Cap total stagger so a 10-card hand finishes flipping within the presentation budget. */
  const REVEAL_STAGGER_CAP_MS = 720;

  function trophyDelayMs() {
    return ROUND_BANNER_VISIBLE_MS + MATCH_TROPHY_AFTER_BANNER_MS;
  }

  root.TurdRummyPresentation = {
    ROUND_BANNER_VISIBLE_MS,
    MATCH_TROPHY_AFTER_BANNER_MS,
    PRESENTATION_AUTO_SKIP_MS,
    REVEAL_STAGGER_STEP_MS,
    REVEAL_STAGGER_CAP_MS,
    trophyDelayMs
  };
})(typeof window !== 'undefined' ? window : globalThis);
