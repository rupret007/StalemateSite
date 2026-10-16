/**
 * Cross-suite feel tuning (gameplay helpers, not save formats).
 * HTML pages mirror these numbers inline; keep tests here in sync.
 */

export const TURDANOID_FEEL = {
  comboWindowFrames: 105,
  /** Pointer follow smoothing at 60 FPS (frame-rate independent via scaleLerp). */
  pointerLerpPerFrame: 0.4,
  /** Snappier paddle follow while a touch is active (still lerped, not teleport). */
  pointerLerpTouchPerFrame: 0.62,
  minBallSpeed: 4.25,
  /** Min |vy|/speed — nudge off horizontal rails that never reach bricks. */
  minBallVerticalRatio: 0.2,
  /** Max radians from vertical for paddle english (wider = more control). */
  paddleEnglish: 1.12,
  shakeDecayPerFrame: 0.6,
  shakeBrickBreak: 7,
  shakeBrickChip: 2,
  shakePaddleHit: 4,
  /** Brief physics freeze on brick pops (60 FPS frames). */
  hitStopFramesOnBreak: 2,
  /** Ball center Y / canvas height above which the bottom danger vignette ramps in. */
  ballDangerStartRatio: 0.68
};

export const TURDTRIS_FEEL = {
  /** Stack-height ratio (see turdtris.html getDangerRatio) where HUD danger pulse starts. */
  dangerHudPulseRatio: 0.55,
  maxClearSparks: 26,
  maxClearSparksReduced: 8,
  shakeDecayPerFrame: 0.86,
  shakeEpsilon: 0.2,
  shakeCapReduced: 0,
  levelFlashFrames: 28
};

export const CARD_TABLE_FEEL = {
  crapeightsAiMs: 760,
  turdrummyQuickAiMs: 180,
  turdrummyAiMs: 540,
  /** Bot turn pacing (turdspades.html AI_TURN_MS); keep in sync. */
  turdspadesAiMs: 400
};

/** Frame-rate-independent exponential smoothing factor for `ts` game steps. */
export function scaleLerp(perFrameAt60, ts) {
  const base = Math.max(0, Math.min(1, perFrameAt60));
  const steps = Math.max(0, ts);
  return 1 - Math.pow(1 - base, steps);
}

export function lerpToward(current, target, t) {
  const f = Math.max(0, Math.min(1, t));
  return current + (target - current) * f;
}

export function clampMinBallSpeed(vx, vy, minSpeed = TURDANOID_FEEL.minBallSpeed) {
  const sp = Math.hypot(vx, vy);
  if (sp <= 0 || sp >= minSpeed) {
    return { vx, vy };
  }
  const f = minSpeed / sp;
  return { vx: vx * f, vy: vy * f };
}

/** Preserve speed while lifting near-horizontal ball paths (playtest softlock fix). */
export function nudgeBallOffHorizontalRail(
  vx,
  vy,
  minVerticalRatio = TURDANOID_FEEL.minBallVerticalRatio
) {
  const sp = Math.hypot(vx, vy);
  if (sp < 1e-6) {
    return { vx, vy };
  }
  if (Math.abs(vy) / sp >= minVerticalRatio) {
    return { vx, vy };
  }
  const vySign = vy === 0 ? 1 : Math.sign(vy);
  const newVy = vySign * sp * minVerticalRatio;
  const vxMag = Math.sqrt(Math.max(0, sp * sp - newVy * newVy));
  const vxSign = vx === 0 ? 1 : Math.sign(vx);
  return { vx: vxSign * vxMag, vy: newVy };
}

export function decayShake(shake, ts, decayPerFrame = TURDANOID_FEEL.shakeDecayPerFrame) {
  if (shake <= 0) {
    return 0;
  }
  return Math.max(0, shake - decayPerFrame * ts);
}

export function bumpShake(current, amount) {
  return Math.max(current || 0, amount || 0);
}

/**
 * 0–1 urgency when a falling ball is in the lower playfield (TurdAnoid danger vignette).
 * @param {Array<{vy?: number, y?: number, r?: number, stuck?: boolean}>} balls
 */
export function ballDangerRatio(balls, canvasHeight, paddleY, startRatio = TURDANOID_FEEL.ballDangerStartRatio) {
  if (!balls?.length || !canvasHeight) {
    return 0;
  }
  const threshold = canvasHeight * startRatio;
  let max = 0;
  for (const b of balls) {
    if (!b || b.stuck) {
      continue;
    }
    if (typeof b.vy !== 'number' || b.vy <= 0) {
      continue;
    }
    const y = typeof b.y === 'number' ? b.y : 0;
    if (y < threshold) {
      continue;
    }
    const r = typeof b.r === 'number' ? b.r : 0;
    const t = (y + r - threshold) / Math.max(1, canvasHeight - threshold);
    max = Math.max(max, Math.min(1, t));
  }
  return max;
}

/** Cosmetic haptics only — no-op when vibration is unavailable. */
export function tryLightHaptic(pattern = 8) {
  try {
    const browserNavigator = globalThis.navigator;
    if (typeof browserNavigator?.vibrate === 'function') {
      browserNavigator.vibrate(pattern);
    }
  } catch {
    /* ignore */
  }
}

/** @param {(query: string) => { matches: boolean } | null | undefined} matchMedia */
export function prefersReducedMotion(matchMedia) {
  try {
    const mq = matchMedia && matchMedia('(prefers-reduced-motion: reduce)');
    return !!(mq && mq.matches);
  } catch {
    return false;
  }
}
