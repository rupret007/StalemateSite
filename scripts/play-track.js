/* Vendored /play/ analytics — injected by scripts/sync-turdanoid.sh (copy to play/stalemate/). */
(function () {
  'use strict';
  var track = window.smTrack;
  var durBucket = window.smDurBucket;
  var levelCap = window.smLevelCap;
  if (!track) return;

  var file = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  var SLUG = {
    'index.html': 'hub',
    'hub.html': 'hub',
    'turdanoid.html': 'turdanoid',
    'turdtris.html': 'turdtris',
    'turdjack.html': 'turdjack',
    'crapeights.html': 'crapeights',
    'turdrummy.html': 'turdrummy',
    'turdspades.html': 'turdspades',
    'turdomania.html': 'turdomania',
    'neon-arkanoid.html': 'neon-arkanoid'
  };
  var g = SLUG[file] || '';

  function round() {
    return {
      active: false,
      startedAt: 0,
      startSent: false,
      overSent: false,
      durSent: false,
      levelSent: false
    };
  }

  var state = round();
  var dailyStarted = false;
  var dailyCompleted = false;

  function rankedDaily() {
    return g === 'turdomania' && document.body.classList.contains('daily-dump') && !document.body.classList.contains('daily-practice');
  }

  function markStart() {
    if (state.startSent) return;
    state.startSent = true;
    state.active = true;
    state.startedAt = Date.now();
    if (g && g !== 'hub') track('play-' + g + '-start');
    if (rankedDaily() && !dailyStarted) {
      dailyStarted = true;
      track('play-daily-dump-start');
    }
  }

  function markOver(levelValue) {
    if (!state.active || state.overSent) return;
    state.overSent = true;
    state.active = false;
    if (rankedDaily() && dailyStarted && !dailyCompleted) {
      dailyCompleted = true;
      track('play-daily-dump-completed');
    }
    if (g && g !== 'hub') {
      track('play-' + g + '-over');
      if (!state.durSent) {
        state.durSent = true;
        var sec = (Date.now() - state.startedAt) / 1000;
        track('play-' + g + '-dur-' + durBucket(sec));
      }
      if (!state.levelSent && levelValue != null) {
        state.levelSent = true;
        track('play-' + g + '-level-' + levelCap(levelValue));
      }
    }
  }

  function resetRound() {
    state = round();
  }

  function observeVisible(el, onShow) {
    if (!el) return;
    var seen = false;
    var check = function () {
      if (seen) return;
      var show = el.classList.contains('show') || el.style.display === 'flex' || el.style.display === 'block';
      if (show && el.offsetParent !== null) {
        seen = true;
        onShow();
      }
    };
    new MutationObserver(check).observe(el, { attributes: true, attributeFilter: ['class', 'style'] });
    check();
  }

  /* --- Hub (index.html, hub.html): hub-open + hub-card-* --- */
  if (g === 'hub') {
    track('hub-open');
    document.addEventListener('click', function (e) {
      if (e.target && e.target.closest && e.target.closest('#daily-hub-play, #daily-hub-previous')) {
        track('hub-daily-open');
        return;
      }
      var card = e.target && e.target.closest ? e.target.closest('a.game-card[href]') : null;
      if (!card) return;
      var href = (card.getAttribute('href') || '').replace(/\.html$/i, '').toLowerCase();
      if (href === 'turdanoid') href = 'turdanoid';
      var slug = href.replace(/[^a-z0-9-]/g, '-');
      if (slug) track('hub-card-' + slug);
    }, true);
    return;
  }

  if (!g) return;

  /* The shared playlist owns one audio element; titles can change between songs. */
  var musicWired = false;
  function wireMusic(music) {
    if (musicWired || !music || typeof music.addEventListener !== 'function') return;
    musicWired = true;
    var playedTrack = false;
    music.addEventListener('play', function () {
      if (playedTrack) return;
      playedTrack = true;
      track('music-ingame-play');
    });
    document.addEventListener('click', function (e) {
      if (!e.target || !e.target.closest || !e.target.closest('#btnSound, #suite-music-toggle')) return;
      setTimeout(function () {
        var blocked = false;
        try {
          blocked = (typeof window.soundBlocked === 'function' && window.soundBlocked())
            || (window.Suite && typeof window.Suite.isMuted === 'function' && window.Suite.isMuted())
            || (window.Suite && typeof window.Suite.isMusicEnabled === 'function' && !window.Suite.isMusicEnabled());
        } catch (err) { /* Optional player preferences cannot interrupt the game. */ }
        if (music.paused && blocked) track('music-ingame-mute');
      }, 0);
    }, true);
  }
  try {
    if (window.Suite && typeof window.Suite.music === 'function') {
      Promise.resolve(window.Suite.music()).then(function (player) {
        if (player) wireMusic(player.audioElement);
      }).catch(function () { /* Playback and analytics remain optional. */ });
    }
  } catch (err) { /* Optional shared player is unavailable. */ }

  /* --- Turdanoid: start #btnStart; over #endScreen.show; level window.TQA.level --- */
  if (g === 'turdanoid') {
    var btnStart = document.getElementById('btnStart');
    if (btnStart) btnStart.addEventListener('click', markStart, { once: true });
    observeVisible(document.getElementById('endScreen'), function () {
      var lvl = 1;
      try { if (window.TQA && typeof window.TQA.level === 'number') lvl = window.TQA.level; } catch (e) { /* */ }
      markOver(lvl);
    });
    var shareBtn = document.getElementById('stalemateShare');
    if (shareBtn) shareBtn.addEventListener('click', function () { track('gameover-turdanoid-share'); }, { once: true });
    document.addEventListener('click', function (e) {
      if (e.target && e.target.closest && e.target.closest('.stalemate-end__listen')) {
        track('gameover-turdanoid-listen-manic');
      }
    }, true);
    document.getElementById('btnRestart') && document.getElementById('btnRestart').addEventListener('click', resetRound);
    return;
  }

  /* --- Turdtris: start startSelectedMode/quickStartRun; over #gameOverOverlay; level global --- */
  if (g === 'turdtris') {
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('[onclick*="startSelectedMode"], [onclick*="quickStartRun"]')) markStart();
    }, true);
    observeVisible(document.getElementById('gameOverOverlay'), function () {
      var el = document.getElementById('level');
      var lvl = el ? parseInt(el.textContent, 10) : 1;
      markOver(isFinite(lvl) ? lvl : 1);
    });
    return;
  }

  /* --- Turdjack: start #dealBtn; over when table phase returns to betting after a hand --- */
  if (g === 'turdjack') {
    var dealBtn = document.getElementById('dealBtn');
    if (dealBtn) dealBtn.addEventListener('click', markStart);
    var table = document.querySelector('.table-stage');
    if (table) {
      var wasPlaying = false;
      new MutationObserver(function () {
        var phase = table.dataset.phase;
        if (phase === 'playing') wasPlaying = true;
        if (wasPlaying && phase === 'betting') {
          wasPlaying = false;
          markOver(null);
          resetRound();
        }
      }).observe(table, { attributes: true, attributeFilter: ['data-phase'] });
    }
    return;
  }

  /* --- Crapeights: start welcome guide dismiss; over roundOverlay match-win/loss --- */
  if (g === 'crapeights') {
    var welcome = document.getElementById('welcomeGuide');
    if (welcome) {
      welcome.addEventListener('click', function (e) {
        if (e.target && e.target.closest && e.target.closest('button')) markStart();
      }, { once: true });
    }
    var card = document.getElementById('roundOverlayCard');
    if (card) {
      new MutationObserver(function () {
        var tone = card.dataset.tone;
        if (tone === 'match-win' || tone === 'match-loss') {
          markOver(null);
        }
      }).observe(card, { attributes: true, attributeFilter: ['data-tone'] });
    }
    return;
  }

  /* --- Turdrummy: start first deal (round value > 0); over #trophyOverlay.show --- */
  if (g === 'turdrummy') {
    var roundVal = document.getElementById('roundValue');
    if (roundVal) {
      new MutationObserver(function () {
        var n = parseInt(roundVal.textContent, 10);
        if (n > 0) markStart();
      }).observe(roundVal, { childList: true, characterData: true, subtree: true });
    }
    observeVisible(document.getElementById('trophyOverlay'), function () { markOver(null); });
    return;
  }

  /* --- Turdspades: start turdspades:round-dealt round 1; over turdspades:match-end; level #roundV --- */
  if (g === 'turdspades') {
    window.addEventListener('turdspades:round-dealt', function (ev) {
      if (ev.detail && ev.detail.round === 1) markStart();
    });
    window.addEventListener('turdspades:match-end', function () {
      var rv = document.getElementById('roundV');
      var lvl = rv ? parseInt(rv.textContent, 10) : null;
      markOver(lvl);
    });
    return;
  }

  /* --- Turdomania: start first board key/pointer on #board; over #overlay.show; level = difficulty (not numeric) --- */
  if (g === 'turdomania') {
    var board = document.getElementById('board');
    if (board) {
      var started = false;
      var onFirst = function () {
        if (started) return;
        started = true;
        markStart();
      };
      board.addEventListener('keydown', onFirst, { once: true });
      board.addEventListener('pointerdown', onFirst, { once: true });
    }
    observeVisible(document.getElementById('overlay'), function () {
      markOver(null);
    });
    document.addEventListener('click', function (e) {
      if (!rankedDaily() || !e.target || !e.target.closest || !e.target.closest('#dailyShare, #dailyCopy')) return;
      var result = document.getElementById('overlay');
      if (result && result.classList.contains('show') && result.offsetParent !== null) {
        track('gameover-daily-dump-share');
      }
    }, true);
    return;
  }

  /* --- Neon Arkanoid: start launchBall / gameRunning; over #gameOver visible; level gameInstance.level --- */
  if (g === 'neon-arkanoid') {
    var pollStart = setInterval(function () {
      if (window.gameInstance && window.gameInstance.gameRunning && !window.gameInstance.awaitingLaunch) {
        clearInterval(pollStart);
        markStart();
      }
    }, 250);
    setTimeout(function () { clearInterval(pollStart); }, 60000);
    var go = document.getElementById('gameOver');
    if (go) {
      new MutationObserver(function () {
        if (go.style.display === 'block' || go.offsetParent) {
          var lvl = window.gameInstance && window.gameInstance.level;
          markOver(lvl);
        }
      }).observe(go, { attributes: true, attributeFilter: ['style', 'class'] });
    }
    return;
  }
})();
