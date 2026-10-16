/* Stalemate overlay for vendored Turdanoid. Applied by scripts/sync-turdanoid.sh after each sync.
   1) Manic as game music: starts on first tap/key (iOS needs a gesture), loops, follows the game's own mute/sound setting.
   2) Black-and-white checkerboard on alternating bricks, mixed with the stock poop sprites. */
(function () {
  'use strict';
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- Music ----------
  var music = new Audio('stalemate/manic.m4a');
  music.id = 'stalemate-music';
  music.loop = true;
  music.preload = 'none';
  music.volume = 0.45;
  music.setAttribute('playsinline', '');
  window.StalemateMusic = music;
  var started = false;
  function blocked() {
    try { return typeof window.soundBlocked === 'function' ? !!window.soundBlocked() : false; } catch (e) { return false; }
  }
  function sync() {
    document.documentElement.dataset.stalemateMusic = music.paused ? 'paused' : 'playing';
  }
  function apply() {
    if (!started || blocked() || document.hidden) { music.pause(); sync(); return; }
    var p = music.play();
    if (p && p.then) p.then(sync, sync); else sync();
  }
  function firstGesture() {
    if (started) return;
    started = true;
    apply();
  }
  music.addEventListener('play', sync);
  music.addEventListener('pause', sync);
  ['pointerdown', 'touchend', 'keydown'].forEach(function (t) {
    window.addEventListener(t, firstGesture, { capture: true, passive: true });
  });
  // The game's own sound button and settings toggles: re-check after they update.
  document.addEventListener('click', function () { setTimeout(apply, 0); }, true);
  document.addEventListener('change', function () { setTimeout(apply, 0); }, true);
  document.addEventListener('visibilitychange', apply);
  sync();

  // ---------- Checkerboard bricks ----------
  var cv = document.getElementById('game');
  if (!cv || typeof window.drawBrick !== 'function') return;
  var ctx = cv.getContext('2d');
  var tile = document.createElement('canvas');
  tile.width = tile.height = 8;
  var tc = tile.getContext('2d');
  tc.fillStyle = '#f4f0e6'; tc.fillRect(0, 0, 8, 8);
  tc.fillStyle = '#111'; tc.fillRect(0, 0, 4, 4); tc.fillRect(4, 4, 4, 4);
  var pattern = ctx.createPattern(tile, 'repeat');
  var stock = window.drawBrick;
  window.drawBrick = function (b) {
    stock(b);
    if (!b || !pattern) return;
    var col = Math.round(b.x / Math.max(1, b.w)), row = Math.round(b.y / Math.max(1, b.h));
    if ((col + row) % 2 !== 0) return; // every other brick, so the poop sprites still show
    ctx.save();
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2, 4); else ctx.rect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);
    ctx.clip();
    ctx.globalAlpha = 0.62;
    ctx.translate(b.x, b.y);
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, b.w, b.h);
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5;
    ctx.strokeRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);
    ctx.restore();
  };
  if (reduce) document.documentElement.classList.add('stalemate-reduced');
})();
