/* TurdAnoid FX helpers — reduced-motion gating (classic script for TurdAnoid.html). */
(function attachTurdanoidFx(root) {
  'use strict';

  function isReducedMotion(mediaQuery) {
    return !!(mediaQuery && mediaQuery.matches);
  }

  /** Screen shake translation; zero when reduced motion is on. */
  function shakeOffset(shake, reducedMotion, random = Math.random) {
    if (!shake || shake <= 0 || isReducedMotion(reducedMotion)) {
      return { sx: 0, sy: 0 };
    }
    return {
      sx: (random() - 0.5) * shake,
      sy: (random() - 0.5) * shake
    };
  }

  /** White flash overlay alpha multiplier. */
  function flashStrength(flash, reducedMotion) {
    if (!flash || flash <= 0) {
      return 0;
    }
    const base = flash * 0.35;
    return isReducedMotion(reducedMotion) ? base * 0.35 : base;
  }

  /** Parallax / ambient drift speed multiplier. */
  function parallaxSpeedFactor(reducedMotion) {
    return isReducedMotion(reducedMotion) ? 0.12 : 1;
  }

  /** Cap cosmetic particle spawns when motion is reduced. */
  function clampBurstCount(requested, reducedMotion, floor = 2) {
    const n = Math.max(0, Math.floor(requested));
    if (!isReducedMotion(reducedMotion)) {
      return n;
    }
    return Math.min(n, Math.max(floor, Math.ceil(n * 0.22)));
  }

  /** Danger vignette pulse: steady when reduced motion. */
  function dangerPulse(nowMs, reducedMotion) {
    if (isReducedMotion(reducedMotion)) {
      return 1;
    }
    return 0.72 + 0.28 * Math.sin(nowMs * 0.014);
  }

  /** Full juice (shards, confetti bursts, heavy parallax) when motion is OK. */
  function allowJuiceEffects(reducedMotion) {
    return !isReducedMotion(reducedMotion);
  }

  function confettiCount(requested, reducedMotion) {
    if (!allowJuiceEffects(reducedMotion)) {
      return 0;
    }
    return clampBurstCount(requested, reducedMotion, 4);
  }

  function themeTokens() {
    return (root.TurdanoidTheme && root.TurdanoidTheme.TOKENS) || {
      slime: '#3ecf9a',
      brass: '#e8c56a',
      rose: '#d878a8',
      aqua: '#5ec8e0',
      coral: '#ff6d5a',
      porcelain: '#e8f4ef'
    };
  }

  function impactColor(kind) {
    const t = themeTokens();
    if (kind === 'paddle' || kind === 'wall') {
      return t.slime;
    }
    if (kind === 'fire' || kind === 'boss') {
      return t.coral;
    }
    if (kind === 'gold') {
      return t.brass;
    }
    return t.aqua;
  }

  function confettiPalette() {
    const t = themeTokens();
    return [t.slime, t.brass, t.rose, t.aqua];
  }

  function flashFill(flash, reducedMotion) {
    const a = flashStrength(flash, reducedMotion);
    if (a <= 0) {
      return { r: 255, g: 255, b: 255, a: 0, css: 'rgba(255,255,255,0)' };
    }
    const t = themeTokens();
    const rgb = root.TurdanoidTheme ? root.TurdanoidTheme.hexToRgb(t.porcelain) : { r: 232, g: 244, b: 239 };
    return {
      r: rgb.r,
      g: rgb.g,
      b: rgb.b,
      a,
      css: `rgba(${rgb.r},${rgb.g},${rgb.b},${a})`
    };
  }

  function makeSpark(x, y, col, rng = Math.random) {
    const a = rng() * Math.PI * 2;
    const sp = 1.4 + rng() * 2.4;
    return {
      spark: true,
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      g: 0.04,
      life: 12 + rng() * 8,
      r: 1.2 + rng() * 1.8,
      rot: a,
      col: col || themeTokens().brass
    };
  }

  function paintSpark(ctx, p) {
    if (!ctx || !p) {
      return false;
    }
    const a = Math.max(0, p.life / 20);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot || 0);
    ctx.fillStyle = p.col || themeTokens().brass;
    ctx.beginPath();
    ctx.moveTo(-p.r * 2.2, 0);
    ctx.lineTo(0, -p.r * 0.55);
    ctx.lineTo(p.r * 2.2, 0);
    ctx.lineTo(0, p.r * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    ctx.beginPath();
    ctx.moveTo(-p.r * 0.7, 0);
    ctx.lineTo(0, -p.r * 0.22);
    ctx.lineTo(p.r * 0.7, 0);
    ctx.lineTo(0, p.r * 0.22);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    return true;
  }

  function paintImpactRing(ctx, ring) {
    if (!ctx || !ring || ring.life <= 0) {
      return false;
    }
    ctx.save();
    const fade = Math.max(0, ring.life / 14);
    ctx.strokeStyle = ring.col || themeTokens().slime;
    ctx.globalAlpha = fade * 0.72;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(ring.x, ring.y, ring.r, 0, 6.283);
    ctx.stroke();
    ctx.strokeStyle = themeTokens().porcelain;
    ctx.globalAlpha = fade * 0.35;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(ring.x, ring.y, ring.r * 0.72, 0, 6.283);
    ctx.stroke();
    ctx.restore();
    return true;
  }

  root.TurdanoidFX = {
    isReducedMotion,
    shakeOffset,
    flashStrength,
    parallaxSpeedFactor,
    clampBurstCount,
    dangerPulse,
    allowJuiceEffects,
    confettiCount,
    impactColor,
    confettiPalette,
    flashFill,
    makeSpark,
    paintSpark,
    paintImpactRing
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
