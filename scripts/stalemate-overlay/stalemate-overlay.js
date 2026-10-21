/* Site-specific Turdanoid decoration and results. Music belongs to the shared
   Suite player in assets/suite-music.js; this overlay never creates audio. */
(function () {
  'use strict';
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

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
    // A narrow top edge carries the band signature while leaving damage cracks,
    // health pips and power-up symbols in the stock brick fully readable.
    ctx.globalAlpha = 1;
    ctx.translate(b.x, b.y);
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, b.w, Math.min(4, b.h * 0.18));
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
    (Date.now() < SHOW_END ? '<p class="stalemate-end__show">See Stalemate live: Sat, Oct 24, 4:45 PM, Los Amigo’s, Plano · <a class="stalemate-end__showlink" href="https://rockinoctober.com" target="_blank" rel="noopener noreferrer">Come see us live, Oct 24</a></p>' : '');
  restart.insertAdjacentElement('afterend', box);
  var showLink = box.querySelector('.stalemate-end__showlink');
  if (showLink) showLink.addEventListener('click', function () {
    if (typeof window.smTrack === 'function') window.smTrack('gameover-turdanoid-show');
  });
  var shareBtn = box.querySelector('#stalemateShare');
  var status = document.createElement('p');
  status.className = 'stalemate-end__status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  box.appendChild(status);
  var fallback = document.createElement('textarea');
  fallback.className = 'stalemate-end__copy';
  fallback.setAttribute('aria-label', 'Score and link to copy');
  fallback.readOnly = true;
  fallback.hidden = true;
  box.appendChild(fallback);
  var file = null;
  var renderedScore = null;
  var renderVersion = 0;
  function score() {
    var el = document.getElementById('endScore');
    return el ? el.textContent.trim() : '0';
  }
  function render() {
    file = null;
    renderedScore = score();
    var version = ++renderVersion;
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
    g.fillStyle = '#b5dc08'; g.font = '700 50px Impact, "Arial Black", sans-serif'; g.fillText('STALEMATE ARCADE', 540, 740);
    g.fillStyle = '#f4f0e6'; g.font = '700 28px sans-serif'; g.fillText(shareUrl.replace(/^https?:\/\//, ''), 540, 805, 840);
    if (c.toBlob) c.toBlob(function (b) {
      if (version === renderVersion) file = b && typeof File === 'function' ? new File([b], 'turdanoid-score.png', { type: 'image/png' }) : null;
    }, 'image/png');
  }
  function visible() { return !end.hasAttribute('inert') && end.offsetParent !== null; }
  new MutationObserver(function () { if (visible()) render(); }).observe(end, { attributes: true, attributeFilter: ['class', 'inert', 'style'] });
  var shareUrl = new URL('TurdAnoid.html', location.href).href;
  async function copyResult(text) {
    var fullText = text + ' ' + shareUrl;
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(fullText);
      status.textContent = 'Score and link copied.';
    } catch (error) {
      fallback.value = fullText;
      fallback.hidden = false;
      fallback.focus();
      fallback.select();
      status.textContent = 'Select and copy your score and link below.';
    }
  }
  shareBtn.addEventListener('click', async function () {
    status.textContent = '';
    fallback.hidden = true;
    var text = 'I scored ' + score() + ' in Turdanoid. Brick-breaker, but gross.';
    var payload = { title: 'Turdanoid · Stalemate Arcade', text: text, url: shareUrl };
    if (file && renderedScore === score() && navigator.canShare) {
      try {
        var withFile = { files: [file], title: payload.title, text: text, url: shareUrl };
        if (navigator.canShare(withFile)) payload = withFile;
      } catch (error) { /* Continue with text and link when files are unsupported. */ }
    }
    if (navigator.share) {
      try {
        await navigator.share(payload);
        status.textContent = 'Shared.';
        return;
      } catch (error) {
        if (error && error.name === 'AbortError') { status.textContent = 'Sharing cancelled.'; return; }
      }
    }
    await copyResult(text);
  });
})();
