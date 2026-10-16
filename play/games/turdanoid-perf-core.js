/* Device-tier particle caps for TurdAnoid (no DOM). */
(function attachTurdanoidPerf(root) {
  'use strict';

  function perfTier(devicePixelRatio, hardwareConcurrency) {
    const dpr = devicePixelRatio || 1;
    const cores = hardwareConcurrency || 4;
    if (dpr >= 2.5 || cores <= 2) {
      return 'low';
    }
    if (dpr >= 2 || cores <= 4) {
      return 'mid';
    }
    return 'high';
  }

  const CAPS_BY_TIER = {
    low: { particles: 72, shards: 22, confetti: 32, fxParticles: 88 },
    mid: { particles: 110, shards: 36, confetti: 50, fxParticles: 130 },
    high: { particles: 160, shards: 52, confetti: 70, fxParticles: 160 }
  };

  function capsForDevice(devicePixelRatio, hardwareConcurrency) {
    const tier = perfTier(devicePixelRatio, hardwareConcurrency);
    return { tier, ...CAPS_BY_TIER[tier] };
  }

  function clampPoolLength(length, max) {
    const cap = Math.max(0, Math.floor(max || 0));
    const len = Math.max(0, Math.floor(length || 0));
    if (cap <= 0) {
      return 0;
    }
    return Math.min(len, cap);
  }

  root.TurdanoidPerf = {
    perfTier,
    capsForDevice,
    clampPoolLength
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
