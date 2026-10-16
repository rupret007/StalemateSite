/* Stalemate overlay for vendored Turdanoid. Applied by scripts/sync-turdanoid.sh after each sync.
   1) Stalemate songs as game music: Manic on level 1, then Andrea, then It's Only Been 18, rotating per level.
      Starts on first tap/key (iOS needs a gesture), loops within a level, follows the game's own mute/sound setting,
      pauses while the tab is hidden.
   2) Black-and-white checkerboard on alternating bricks, mixed with the stock poop sprites. */
(function () {
  'use strict';
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- Music ----------
  var PLAYLIST = [
    { file: 'stalemate/manic.m4a', title: 'Manic' },
    { file: 'stalemate/andrea.m4a', title: 'Andrea' },
    { file: 'stalemate/only-been-18.m4a', title: 'It\u2019s Only Been 18' }
  ];
  function trackForLevel(n) {
    n = Math.floor(Number(n));
    if (!(n >= 1)) n = 1;
    return PLAYLIST[(n - 1) % PLAYLIST.length];
  }
  function currentLevel() {
    try { return typeof level === 'number' ? level : 1; } catch (e) { return 1; } // the game's top-level `let level`
  }
  window.StalematePlaylist = { tracks: PLAYLIST.slice(), trackForLevel: trackForLevel };
  var music = new Audio();
  var track = trackForLevel(currentLevel());
  music.src = track.file;
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
    var d = document.documentElement.dataset;
    d.stalemateMusic = music.paused ? 'paused' : 'playing';
    d.stalemateTrack = track.title;
  }
  function apply() {
    if (!started || blocked() || document.hidden) { music.pause(); sync(); return; }
    var p = music.play();
    if (p && p.then) p.then(sync, sync); else sync();
  }
  function checkLevel() {
    var next = trackForLevel(currentLevel());
    if (next === track) return;
    track = next;
    music.pause();
    music.src = track.file; // new song starts from the top on each level change
    apply();
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
  setInterval(checkLevel, 400);
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

/* Game over: Listen to Manic + Oct 24 show line + Share score (Web Share API, image pre-rendered so iOS keeps the tap). */
(function () {
  'use strict';
  var end = document.getElementById('endScreen');
  var restart = document.getElementById('btnRestart');
  if (!end || !restart) return;
  var SHOW_END = Date.parse('2026-10-25T00:00:00-05:00');
  var box = document.createElement('div');
  box.className = 'stalemate-end';
  box.innerHTML =
    '<a class="stalemate-end__listen" href="../#home">Listen to Manic</a>' +
    '<button type="button" class="stalemate-end__share" id="stalemateShare">Share score</button>' +
    (Date.now() < SHOW_END ? '<p class="stalemate-end__show">See Stalemate live: Sat, Oct 24, 4:45 PM, Los Amigo’s, Plano</p>' : '');
  restart.insertAdjacentElement('afterend', box);
  var shareBtn = box.querySelector('#stalemateShare');
  var file = null;
  function score() {
    var el = document.getElementById('endScore');
    return el ? el.textContent.trim() : '0';
  }
  function render() {
    var c = document.createElement('canvas');
    c.width = 1080; c.height = 1080;
    var g = c.getContext('2d');
    for (var i = 0; i < 12; i++) for (var j = 0; j < 12; j++) {
      g.fillStyle = (i + j) % 2 ? '#111' : '#f4f0e6';
      g.fillRect(i * 90, j * 90, 90, 90);
    }
    g.fillStyle = '#171410'; g.fillRect(90, 225, 900, 630);
    g.textAlign = 'center';
    g.fillStyle = '#ed2765'; g.font = '900 110px Impact, "Arial Black", sans-serif'; g.fillText('TURDANOID', 540, 370);
    g.fillStyle = '#f4f0e6'; g.font = '900 150px Impact, "Arial Black", sans-serif'; g.fillText(score(), 540, 560);
    g.font = '700 54px Impact, "Arial Black", sans-serif'; g.fillText('POINTS. GROSS.', 540, 640);
    g.fillStyle = '#b5dc08'; g.font = '700 50px Impact, "Arial Black", sans-serif'; g.fillText('stalemate.band/play', 540, 780);
    if (c.toBlob) c.toBlob(function (b) { file = b ? new File([b], 'turdanoid-score.png', { type: 'image/png' }) : null; }, 'image/png');
  }
  function visible() { return !end.hasAttribute('inert') && end.offsetParent !== null; }
  new MutationObserver(function () { if (visible()) render(); }).observe(end, { attributes: true, attributeFilter: ['class', 'inert', 'style'] });
  var url = location.origin + location.pathname.replace(/[^/]*$/, '');
  shareBtn.addEventListener('click', function () {
    var text = 'I scored ' + score() + ' in Turdanoid. Brick-breaker, but gross.';
    var withFile = file ? { files: [file], title: 'Turdanoid', text: text, url: url } : null;
    if (withFile && navigator.canShare && navigator.canShare(withFile)) {
      navigator.share(withFile).catch(function () {});
    } else if (navigator.share) {
      navigator.share({ text: text, url: url }).catch(function () {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text + ' ' + url).then(function () { shareBtn.textContent = 'Copied!'; }, function () {});
    }
  });
})();
