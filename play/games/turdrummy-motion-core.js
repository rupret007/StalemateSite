/* TurdRummy motion helpers: pure timing and geometry for card flights,
   count-up numbers and staggered reveals.
   Classic script: attaches TurdRummyMotion on globalThis so turdrummy.html can
   use it from a plain <script> tag. games/turdrummy-motion.js re-exports this
   API for unit tests (see games/table-continue-core.js for the same split).

   Every helper here is side-effect free. The page decides whether to call them:
   `shouldAnimate` is the single reduced-motion gate for flights, tweens and
   reveal stagger, so there is one place to audit. */
(function attachTurdRummyMotion(root) {
  'use strict';

  /**
   * True only when motion is allowed. Reduced motion always wins, and the
   * environment must be able to animate at all (WAAPI / rAF).
   * @param {{reduced?: boolean, canAnimate?: boolean}} env
   */
  function shouldAnimate(env) {
    if (!env) {return false;}
    return !env.reduced && !!env.canAnimate;
  }

  /** Ease-out cubic: fast start, soft landing. t is clamped to [0, 1]. */
  function easeOutCubic(t) {
    const x = Math.max(0, Math.min(1, t));
    return 1 - Math.pow(1 - x, 3);
  }

  /**
   * Value at progress `t` (0..1) of a count-up from `from` to `to`. Returns whole
   * numbers, because deadwood and points are integers.
   */
  function tweenValue(from, to, t) {
    const a = Number(from) || 0;
    const b = Number(to) || 0;
    const eased = easeOutCubic(t);
    if (eased >= 1) {return b;}
    return Math.round(a + (b - a) * eased);
  }

  /** Delay for item `index` in a stagger, capped so long hands do not drag. */
  function staggerDelay(index, stepMs, capMs) {
    const i = Math.max(0, Math.floor(Number(index) || 0));
    const cap = capMs === undefined ? Infinity : capMs;
    return Math.min(cap, i * Math.max(0, Number(stepMs) || 0));
  }

  /**
   * Translate + scale that moves a box from `from` onto `to` (both DOMRect-like
   * {left, top, width, height}). Used with WAAPI transforms on a fixed-position
   * clone, so the flight never reflows the real hand.
   * @returns {{dx: number, dy: number, scale: number}}
   */
  function flightDelta(from, to) {
    const fromCx = from.left + from.width / 2;
    const fromCy = from.top + from.height / 2;
    const toCx = to.left + to.width / 2;
    const toCy = to.top + to.height / 2;
    const scale = from.width > 0 ? Math.min(1.25, Math.max(0.5, to.width / from.width)) : 1;
    return {
      dx: Number((toCx - fromCx).toFixed(2)),
      dy: Number((toCy - fromCy).toFixed(2)),
      scale: Number(scale.toFixed(3))
    };
  }

  /**
   * Flight duration in ms, scaled by distance. Round 3 keeps every card flight in the snappy
   * 180-320 ms band: long hops still read as a move, and the bot's discard flight starts only
   * after its draw flight has landed.
   */
  function flightDuration(distancePx) {
    const d = Math.max(0, Number(distancePx) || 0);
    return Math.round(Math.min(320, Math.max(180, 180 + d * 0.25)));
  }

  root.TurdRummyMotion = {
    shouldAnimate,
    easeOutCubic,
    tweenValue,
    staggerDelay,
    flightDelta,
    flightDuration
  };
})(typeof window !== 'undefined' ? window : globalThis);
