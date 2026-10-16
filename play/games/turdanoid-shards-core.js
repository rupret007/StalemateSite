/* Brick shard debris — spawn + physics (testable, used from TurdAnoid.html). */
(function attachTurdanoidShards(root) {
  'use strict';

  function shardCap(requested, reducedMotion, fxApi) {
    const n = Math.max(0, Math.floor(requested || 0));
    if (fxApi && typeof fxApi.clampBurstCount === 'function') {
      return fxApi.clampBurstCount(n, reducedMotion, 0);
    }
    if (reducedMotion && reducedMotion.matches) {
      return Math.min(n, 3);
    }
    return n;
  }

  function spawnShardsFromBrick(brick, count, rng = Math.random) {
    const n = Math.max(1, Math.floor(count || 8));
    const shards = [];
    const cx = brick.x + brick.w / 2;
    const cy = brick.y + brick.h / 2;
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2;
      const sp = 1.5 + rng() * 4;
      const w = 3 + rng() * 6;
      const h = 2 + rng() * 5;
      shards.push({
        x: cx + (rng() - 0.5) * brick.w,
        y: cy + (rng() - 0.5) * brick.h,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 1.2,
        rot: rng() * Math.PI,
        vr: (rng() - 0.5) * 0.2,
        w,
        h,
        life: 28 + rng() * 22,
        max: 50,
        c1: brick.c1 || (root.TurdanoidTheme && root.TurdanoidTheme.TOKENS.slime) || '#3ecf9a',
        c2: brick.c2 || (root.TurdanoidTheme && root.TurdanoidTheme.TOKENS.slimeDeep) || '#1a7a58',
        alpha: 1
      });
    }
    return shards;
  }

  function stepShard(s, ts, gravity = 0.22) {
    if (!s) {
      return false;
    }
    s.x += s.vx * ts;
    s.y += s.vy * ts;
    s.vy += gravity * ts;
    s.rot += s.vr * ts;
    s.life -= ts;
    s.alpha = Math.max(0, s.life / (s.max || 40));
    return s.life > 0;
  }

  root.TurdanoidShards = {
    shardCap,
    spawnShardsFromBrick,
    stepShard
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
