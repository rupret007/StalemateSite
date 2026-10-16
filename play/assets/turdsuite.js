/* ============================================================
   Turdanoid Suite — shared runtime
   Loaded by every game. Provides:
   - Suite.toast(msg)       small floating message at the top
   - Suite.hype(msg, ms)    big center callout
   - Suite.fart() / .beep() / .ding() / .buzz()  shared SFX
   - auto: back-to-hub pill on every page (suppress with
     <body data-suite-no-back="1"> or window.SUITE_NO_BACK = true)
   - auto: ambient sewer backdrop (.suite-bg — tiles, wisps, bubbles;
     suppress with <body data-suite-no-bg="1">)
   - auto: iPhone double-tap-zoom prevention (CSS touch-action; no touchend guard)
   ============================================================ */
(function () {
  'use strict';

  // ---------- Audio ----------
  let actx = null;
  let muted = false;
  try { muted = localStorage.getItem('turdsuite_muted') === '1'; } catch (e) {}

  function ctx() {
    if (!actx) {
      try { actx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { actx = null; }
    }
    return actx;
  }
  function tone(freq, dur, type, vol, slide) {
    if (muted) return;
    const a = ctx(); if (!a) return;
    try {
      const o = a.createOscillator(), g = a.createGain();
      o.type = type || 'square';
      o.frequency.value = freq;
      if (slide) o.frequency.linearRampToValueAtTime(Math.max(20, freq + slide), a.currentTime + dur);
      g.gain.value = vol || 0.05;
      g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
      o.connect(g).connect(a.destination);
      o.start(); o.stop(a.currentTime + dur);
    } catch (e) {}
  }

  const Suite = {
    setMuted(b) { muted = !!b; try { localStorage.setItem('turdsuite_muted', b ? '1' : '0'); } catch (e) {} },
    isMuted() { return muted; },
    beep: function (f, d, t, v, s) { tone(f || 660, d || 0.06, t || 'triangle', v || 0.05, s || 0); },
    ding: function () {
      tone(660, 0.08, 'triangle', 0.05); setTimeout(() => tone(990, 0.1, 'triangle', 0.05), 60);
    },
    buzz: function () { tone(180, 0.18, 'sawtooth', 0.07, -100); },
    fart: function () {
      if (muted) return;
      const a = ctx(); if (!a) return;
      try {
        const o = a.createOscillator(), g = a.createGain(), lfo = a.createOscillator(), lg = a.createGain();
        o.type = 'sawtooth'; o.frequency.value = 120 + Math.random() * 30;
        lfo.type = 'sine'; lfo.frequency.value = 18 + Math.random() * 12; lg.gain.value = 40;
        lfo.connect(lg).connect(o.frequency);
        g.gain.value = 0.05;
        g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 0.4);
        o.connect(g).connect(a.destination);
        o.start(); lfo.start();
        o.stop(a.currentTime + 0.4); lfo.stop(a.currentTime + 0.4);
      } catch (e) {}
    },
    win: function () {
      if (muted) return;
      [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.18, 'triangle', 0.07), i * 110));
    }
  };

  // ---------- Toast ----------
  let toastEl = null;
  let toastT = 0;
  Suite.toast = function (msg, ms) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'suite-toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    void toastEl.offsetWidth; // restart transition
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('show'), ms || 1400);
  };

  // ---------- Hype ----------
  let hypeEl = null;
  let hypeT = 0;
  Suite.hype = function (msg, ms) {
    if (!hypeEl) {
      hypeEl = document.createElement('div');
      hypeEl.className = 'suite-hype';
      document.body.appendChild(hypeEl);
    }
    hypeEl.textContent = msg;
    void hypeEl.offsetWidth;
    hypeEl.classList.add('show');
    clearTimeout(hypeT);
    hypeT = setTimeout(() => hypeEl.classList.remove('show'), ms || 800);
  };

  // ---------- Quip banks (use Suite.quip('win') in any game) ----------
  const QUIPS = {
    win:    ['CERTIFIED FLUSHER', 'BOWL DOMINATED', 'SEWER ROYALTY', 'YOU WIN, KING/QUEEN OF SMELL'],
    lose:   ['FLUSHED', 'PLUNGED INTO DESPAIR', 'THE BOWL WINS AGAIN', 'TRY HOLDING IT NEXT TIME'],
    bust:   ['BUSTED LIKE A SEWER PIPE', 'OOF. EXPLOSIVE.', 'THAT WAS A LOT', 'TOO MUCH CURRY'],
    win_s:  ['NICE!', 'SLEEK!', 'TIDY!', 'CHEFS KISS', '✨ FLUSH-WORTHY ✨'],
    lose_s: ['oof', 'rip', 'classic', 'plumbing required'],
    pickup: ['NICE GRAB', 'INTO THE BOWL', 'GOOD HANDS'],
    streak: ['ON A ROLL', 'COMBO LOCKED', 'CHAIN OF DOOKIE', 'UNFLUSHABLE'],
    deal:   ['DEAL ME IN', 'DEAL THOSE TURDS', 'ANTE UP'],
    bid:    ['BIG TALK', 'WE LOVE CONFIDENCE', 'BOLD MOVE'],
    knock:  ['KNOCK KNOCK', 'WHOS THERE? POINTS.', 'CLEAN-UP TIME'],
    gin:    ['GIN! 🍸', 'PERFECT HAND', 'ABSOLUTE UNIT'],
    spades_break: ['SPADES BROKEN', 'GLOVES OFF', 'NOW WE PLAY DIRTY'],
    line:   ['LINE CLEAR', 'SCRUBBED', 'SQUEAKY CLEAN'],
    tetris: ['TETRIS! ', 'QUAD KILL', 'FOUR LINES, ONE FLUSH'],
    tspin:  ['T-SPIN! ', 'TWIRLED & FLUSHED', 'SHOWING OFF'],
    perfect:['PERFECT CLEAR!', 'NOTHING LEFT', 'IMMACULATE'],
  };
  Suite.quip = function (key) {
    const arr = QUIPS[key]; if (!arr || !arr.length) return '';
    return arr[Math.floor(Math.random() * arr.length)];
  };

  let announcer = null;
  function suiteImport(spec) {
    try {
      if (typeof window !== 'undefined' && window.__SUITE_SKIP_MODULES) {
        return Promise.resolve(null);
      }
      return import(spec);
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  Suite.announce = function (msg, politeness) {
    try {
      if (!announcer) {
        suiteImport('./suite-a11y.js').then(function (m) {
          if (!m) return;
          announcer = m.createAnnouncer(document);
          announcer.announce(msg, politeness);
        }).catch(function () {});
        return;
      }
      announcer.announce(msg, politeness);
    } catch (e) {}
  };

  let audioEngine = null;
  let audioPromise = null;
  Suite.audio = function () {
    if (audioEngine) return Promise.resolve(audioEngine);
    if (!audioPromise) {
      audioPromise = suiteImport('./suite-audio.js').then(function (m) {
        if (!m) return null;
        audioEngine = m.createSuiteAudio({
          isMuted: function () { return muted; },
          getContext: ctx,
          masterVolume: 1
        });
        return audioEngine;
      }).catch(function () { return null; });
    }
    return audioPromise;
  };

  let fxEngine = null;
  let fxPromise = null;
  Suite.fx = function () {
    if (fxEngine) return Promise.resolve(fxEngine);
    if (!fxPromise) {
      fxPromise = suiteImport('./suite-fx.js').then(function (m) {
        if (!m) return null;
        fxEngine = m.createSuiteFX(document.body);
        return fxEngine;
      }).catch(function () { return null; });
    }
    return fxPromise;
  };

  /** Quick pop on a stat tile or score chip after a score change. */
  Suite.bump = function (el) {
    if (!el || !el.classList) return;
    el.classList.remove('suite-pop');
    void el.offsetWidth;
    el.classList.add('suite-pop');
  };

  function enhancePhoneHud() {
    try {
      const targets = document.querySelectorAll('.hud, .topbar, .mobile-run-strip');
      for (let i = 0; i < targets.length; i++) {
        targets[i].classList.add('suite-phone-hud');
      }
    } catch (e) {}
  }

  // ---------- Back-to-Hub pill ----------
  function injectBackPill() {
    try {
      const skip = (document.body && document.body.dataset && document.body.dataset.suiteNoBack === '1') ||
                   window.SUITE_NO_BACK === true;
      if (skip) return;
      // Don't inject on either the canonical root hub or its legacy redirect.
      // GitHub Pages project URLs can be /Turdanoid or /Turdanoid/ — both are the door.
      if (isSuiteHubPage(currentPageName())) return;
      if (document.querySelector('.suite-back-pill')) return;
      const a = document.createElement('a');
      a.className = 'suite-back-pill';
      a.href = './';
      a.innerHTML = '<span class="arrow" aria-hidden="true">←</span><span class="suite-back-pill-label"> Hub</span>';
      a.setAttribute('aria-label', 'Back to game hub');
      document.body.appendChild(a);
    } catch (e) {}
  }

  // ---------- Ambient sewer backdrop ----------
  // Fixed layer behind every page (tiles, stink wisps, rising bubbles,
  // vignette). Pure CSS animation; suppress with <body data-suite-no-bg="1">.
  function injectAmbientBg() {
    try {
      if (!document.body) return;
      if (document.body.dataset && document.body.dataset.suiteNoBg === '1') return;
      if (document.querySelector('.suite-bg')) return;
      const bg = document.createElement('div');
      bg.className = 'suite-bg';
      bg.setAttribute('aria-hidden', 'true');
      let html = '<div class="suite-bg-tiles"></div>';
      for (let i = 0; i < 3; i++) html += '<div class="suite-bg-wisp"></div>';
      for (let i = 0; i < 12; i++) html += '<i class="suite-bg-bubble"></i>';
      html += '<div class="suite-bg-vignette"></div>';
      html += '<div class="suite-bg-parallax-far" aria-hidden="true"></div>';
      html += '<div class="suite-bg-parallax-near" aria-hidden="true"></div>';
      html += '<span class="suite-bg-critter" data-critter="rat" aria-hidden="true" style="--critter-delay:-8s;--critter-lane:22%"></span>';
      html += '<span class="suite-bg-critter" data-critter="duck" aria-hidden="true" style="--critter-delay:-31s;--critter-lane:68%"></span>';
      bg.innerHTML = html;
      document.body.insertBefore(bg, document.body.firstChild);
      suiteImport('./suite-ambient.js').then(function (m) {
        if (m && typeof m.enhanceAmbientBackground === 'function') {
          m.enhanceAmbientBackground(document);
        }
      }).catch(function () {});
    } catch (e) {}
  }

  // ---------- iPhone niceties (CSS touch-action; see suite-touch.js) ----------
  function preventDoubleTapZoom() {
    suiteImport('./suite-touch.js').then(function (m) {
      if (m && typeof m.installSuiteTouchPolicy === 'function') {
        m.installSuiteTouchPolicy(document);
      }
    }).catch(function () {});
  }

  // ---------- Last-played + honest table continue ----------
  const TableContinue = globalThis.TurdSuiteTableContinue || null;
  const LIVE_HUB_GAMES = (TableContinue && TableContinue.LIVE_HUB_GAMES) || [
    'TurdAnoid.html', 'turdtris.html', 'turdjack.html', 'crapeights.html', 'turdrummy.html', 'turdspades.html', 'turdomania.html'
  ];
  const LAST_GAME_KEY = 'turdsuite_last_game';
  const CONTINUE_KEY = (TableContinue && TableContinue.CONTINUE_KEY) || 'turdsuite_continue_v1';

  function currentPageName() {
    return (location.pathname || '').split('/').pop() || '';
  }

  function isSuiteHubPage(page) {
    const name = String(page || '').toLowerCase();
    return !name || name === 'index.html' || name === 'hub.html' || name === 'turdanoid';
  }

  Suite.escapeAttr = function (value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  };

  function suiteStorage() {
    try {
      return localStorage || null;
    } catch (e) {
      return null;
    }
  }

  Suite.table = {
    remember(page, snapshot) {
      try {
        const storage = suiteStorage();
        return !!(storage && TableContinue && TableContinue.rememberContinue(storage, page, snapshot));
      } catch (e) {
        return false;
      }
    },
    load(page) {
      try {
        const storage = suiteStorage();
        return storage && TableContinue ? TableContinue.loadContinue(storage, page) : null;
      } catch (e) {
        return null;
      }
    },
    clear(page) {
      try {
        const storage = suiteStorage();
        return !!(storage && TableContinue && TableContinue.clearContinue(storage, page));
      } catch (e) {
        return false;
      }
    },
    has(page) {
      try {
        const storage = suiteStorage();
        return !!(storage && TableContinue && TableContinue.hasLiveContinue(storage, page));
      } catch (e) {
        return false;
      }
    },
    list() {
      try {
        const storage = suiteStorage();
        return storage && TableContinue ? TableContinue.listLiveContinuePages(storage) : [];
      } catch (e) {
        return [];
      }
    }
  };

  Suite.guide = {
    hasSeen(page) {
      try {
        const storage = suiteStorage();
        return !!(storage && TableContinue && TableContinue.hasSeenGuide(storage, page));
      } catch (e) {
        return false;
      }
    },
    mark(page) {
      try {
        const storage = suiteStorage();
        return !!(storage && TableContinue && TableContinue.markGuideSeen(storage, page));
      } catch (e) {
        return false;
      }
    }
  };

  function recordLastGame() {
    const page = currentPageName();
    if (!LIVE_HUB_GAMES.includes(page)) return;
    try { localStorage.setItem(LAST_GAME_KEY, page); } catch (e) {}
  }

  function decorateHubCard(card, { lastPlayed, inProgress }) {
    if (!card) return;
    if (lastPlayed) card.classList.add('last-played');
    if (inProgress) card.classList.add('in-progress');
    const play = card.querySelector('.play');
    if (play) {
      play.textContent = '';
      play.appendChild(document.createTextNode(inProgress ? 'Continue ' : lastPlayed ? 'Play again ' : 'Play '));
      const arrow = document.createElement('i');
      arrow.textContent = '\u2192';
      play.appendChild(arrow);
    }
    const title = card.querySelector('h2');
    if (title && (lastPlayed || inProgress) && !card.getAttribute('aria-label')) {
      // aria-label replaces the card's whole accessible name, so spell out the
      // same things a sighted player reads: game, blurb, then action + state.
      // The badge is a CSS ::after and is hidden on phones, so this label is the
      // only "Continue" / "Play again" cue some players get.
      const blurb = (card.querySelector('.game-info p') || {}).textContent || '';
      const action = inProgress ? 'Continue' : 'Play again';
      const state = inProgress ? 'in progress' : 'last played';
      card.setAttribute(
        'aria-label',
        [title.textContent.trim(), blurb.trim(), action + ' — ' + state].filter(Boolean).join('. ')
      );
    }
  }

  function markHubProgress() {
    if (!isSuiteHubPage(currentPageName())) return;
    let last = '';
    try { last = localStorage.getItem(LAST_GAME_KEY) || ''; } catch (e) {}
    if (!LIVE_HUB_GAMES.includes(last)) last = '';
    const continuing = Suite.table.list();
    const cards = document.querySelectorAll('.game-card');
    for (let i = 0; i < cards.length; i++) {
      const href = cards[i].getAttribute('href') || '';
      decorateHubCard(cards[i], {
        lastPlayed: href === last,
        inProgress: continuing.indexOf(href) !== -1
      });
    }
    markHubResume(continuing, last);
  }

  // A returning player lands on the hub with the "Continue" tables marked
  // mid-grid, behind the masthead. Promote the single best pick-up target
  // into the masthead itself so it is one tap from the top of the page:
  // the last game opened when that table is still live, otherwise the first
  // table waiting. The static "no sign-in" badge reassures first-timers; a
  // player who already has a live table is better served by the shortcut.
  // Reads the same validated continue list the cards use; writes no storage.
  function wireHubMuteToggle() {
    try {
      const btn = document.getElementById('suite-hub-mute');
      if (!btn) return;
      function sync() {
        const on = muted;
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        btn.setAttribute('aria-label', on ? 'Sound off, tap to unmute suite sounds' : 'Sound on, tap to mute suite sounds');
        btn.textContent = on ? '🔇 Sound off' : '🔊 Sound on';
      }
      sync();
      btn.addEventListener('click', function () {
        Suite.setMuted(!muted);
        sync();
        if (!muted) {
          ctx();
          Suite.beep(520, 0.05, 'triangle', 0.04);
        }
      });
    } catch (e) {}
  }

  function enhanceHubDoor() {
    if (!isSuiteHubPage(currentPageName())) return;
    try {
      wireHubMuteToggle();
    } catch (e) {}
  }

  function markHubResume(continuing, last) {
    const badge = document.querySelector('.hero-badge');
    if (!badge || badge.classList.contains('hero-resume')) return;
    if (!continuing || !continuing.length) return;
    const target = continuing.indexOf(last) !== -1 ? last : continuing[0];
    const card = document.querySelector('.game-card[href="' + target + '"]');
    const heading = card && card.querySelector('h2');
    const name = heading ? heading.textContent.trim() : '';
    if (!name) return;
    const link = document.createElement('a');
    link.className = badge.className + ' hero-resume hero-continue-banner';
    link.setAttribute('href', target);
    link.textContent = '↩ Continue ' + name;
    link.setAttribute('aria-label', 'Continue your ' + name + ' game in progress');
    badge.replaceWith(link);
  }

  // ---------- Boot ----------
  function boot() {
    injectAmbientBg();
    injectBackPill();
    enhancePhoneHud();
    preventDoubleTapZoom();
    recordLastGame();
    markHubProgress();
    enhanceHubDoor();
    // unlock audio context on first interaction
    const unlock = function () {
      ctx();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.Suite = Suite;
})();
