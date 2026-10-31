/**
 * Guideline-style delayed auto-shift for Turdtris keyboard play.
 */

export const DAS_DELAY_MS = 156;
export const ARR_MS = 33;
/** Max simulated frame duration for DAS ticks (matches turdtris.html MAX_FRAME_MS). */
export const MAX_TICK_MS = 33;
export const MOBILE_REPEAT_MS = 52;
/** Delay before held mobile D-pad keys start repeating (matches keyboard DAS feel). */
export const MOBILE_REPEAT_INITIAL_DELAY_MS = 148;

/**
 * @param {number} deltaMs
 * @returns {number}
 */
export function normalizeTickDelta(deltaMs) {
  if (!Number.isFinite(deltaMs)) {
    return 0;
  }
  return Math.min(MAX_TICK_MS, Math.max(0, deltaMs));
}

export class DasTracker {
  constructor() {
    this.left = false;
    this.right = false;
    this.leftDas = 0;
    this.rightDas = 0;
    this.leftArr = 0;
    this.rightArr = 0;
  }

  pressLeft() {
    this.left = true;
    this.leftDas = 0;
    this.leftArr = 0;
    return { moveLeft: 1, moveRight: 0 };
  }

  pressRight() {
    this.right = true;
    this.rightDas = 0;
    this.rightArr = 0;
    return { moveLeft: 0, moveRight: 1 };
  }

  releaseLeft() {
    this.left = false;
    this.leftDas = 0;
    this.leftArr = 0;
  }

  releaseRight() {
    this.right = false;
    this.rightDas = 0;
    this.rightArr = 0;
  }

  /**
   * @param {number} deltaMs elapsed since last frame
   * @returns {{ moveLeft: number, moveRight: number }}
   */
  tick(deltaMs) {
    let moveLeft = 0;
    let moveRight = 0;
    const dt = normalizeTickDelta(deltaMs);

    if (this.left) {
      const delayRemaining = Math.max(0, DAS_DELAY_MS - this.leftDas);
      this.leftDas += dt;
      if (this.leftDas >= DAS_DELAY_MS) {
        // Only time after the initial delay contributes to repeats.
        this.leftArr += Math.max(0, dt - delayRemaining);
        while (this.leftArr >= ARR_MS) {
          this.leftArr -= ARR_MS;
          moveLeft++;
        }
      }
    }

    if (this.right) {
      const delayRemaining = Math.max(0, DAS_DELAY_MS - this.rightDas);
      this.rightDas += dt;
      if (this.rightDas >= DAS_DELAY_MS) {
        this.rightArr += Math.max(0, dt - delayRemaining);
        while (this.rightArr >= ARR_MS) {
          this.rightArr -= ARR_MS;
          moveRight++;
        }
      }
    }

    return { moveLeft, moveRight };
  }
}
