/* Shared on-site audio player (same-origin AAC under play/stalemate/). Honors stalemate.music. */
(function (global) {
    'use strict';

    var TRACKS = Object.freeze({
        manic: { file: 'manic.m4a', title: 'Manic' },
        andrea: { file: 'andrea.m4a', title: 'Andrea' },
        'only-been-18': { file: 'only-been-18.m4a', title: 'It\u2019s Only Been 18' }
    });

    var LOAD_DEADLINE_MS = 10000;
    var audio = null;
    var currentId = null;
    var bound = false;
    var statusEl = null;
    var statusTimer = null;
    var loadAttempt = null;
    var rowStatusCount = 0;

    function pref() {
        return global.StalemateMusicPref;
    }

    function musicOn() {
        var p = pref();
        if (!p) return true;
        return p.isOn();
    }

    function mediaRoot() {
        var site = global.StalemateSite;
        if (site && site.join && site.currentBase) {
            return site.join(site.currentBase(), 'play/stalemate/');
        }
        return '/play/stalemate/';
    }

    function trackSrc(id) {
        var track = TRACKS[id];
        if (!track) return '';
        return mediaRoot() + track.file;
    }

    function getStatusEl() {
        if (!statusEl && global.document) {
            statusEl = global.document.getElementById('stalemate-site-play-status');
            if (!statusEl) {
                statusEl = global.document.createElement('p');
                statusEl.id = 'stalemate-site-play-status';
                statusEl.setAttribute('role', 'status');
                statusEl.setAttribute('aria-live', 'polite');
                statusEl.hidden = true;
                global.document.body.appendChild(statusEl);
            }
        }
        return statusEl;
    }

    function getRowStatus(button) {
        if (!button || !global.document) return getStatusEl();
        var row = button.closest ? button.closest('[data-listen-track]') : null;
        if (!row) return getStatusEl();
        var el = row.querySelector('[data-site-play-status]');
        if (!el) {
            el = global.document.createElement('p');
            el.setAttribute('data-site-play-status', '');
            el.setAttribute('role', 'status');
            el.id = 'stalemate-site-play-status-' + (++rowStatusCount);
            el.hidden = true;
            row.appendChild(el);
            button.setAttribute('aria-describedby', el.id);
        }
        return el;
    }

    function showMusicOffStatus() {
        var el = getStatusEl();
        if (!el) return;
        if (statusTimer) global.clearTimeout(statusTimer);
        el.textContent = 'Site music is off. Turn it on with the Music toggle.';
        el.hidden = false;
        statusTimer = global.setTimeout(function () {
            el.hidden = true;
            el.textContent = '';
        }, 4000);
    }

    function getAudio() {
        if (!audio && global.document) {
            audio = global.document.createElement('audio');
            audio.preload = 'none';
            audio.setAttribute('playsinline', '');
            audio.id = 'stalemate-site-player';
            audio.setAttribute('data-stalemate-site-audio', '');
            global.document.body.appendChild(audio);
            audio.addEventListener('play', syncButtons);
            audio.addEventListener('pause', syncButtons);
            audio.addEventListener('ended', syncButtons);
        }
        return audio;
    }

    function playing() {
        if (!audio) return false;
        return !audio.paused && !audio.ended;
    }

    function clearLoadAttempt(retireOnly) {
        if (!loadAttempt) return;
        global.clearTimeout(loadAttempt.timer);
        if (loadAttempt.onCanPlay) loadAttempt.el.removeEventListener('canplay', loadAttempt.onCanPlay);
        if (loadAttempt.onError) loadAttempt.el.removeEventListener('error', loadAttempt.onError);
        if (!retireOnly && loadAttempt.button) {
            loadAttempt.button.removeAttribute('aria-disabled');
        }
        loadAttempt = null;
    }

    function settleLoadFailure(message, button) {
        var attempt = loadAttempt;
        clearLoadAttempt(true);
        var el = getAudio();
        try { el.pause(); } catch (e) { /* */ }
        try {
            el.removeAttribute('src');
            el.load();
        } catch (e2) { /* */ }
        if (button) {
            var track = TRACKS[button.getAttribute('data-site-play')];
            button.textContent = 'Reload player';
            button.setAttribute('data-site-play-reload', 'true');
            button.setAttribute('aria-label', track ? ('Reload ' + track.title + ' here') : 'Reload player');
            button.removeAttribute('aria-disabled');
            button.setAttribute('aria-pressed', 'false');
        }
        var status = button ? getRowStatus(button) : getStatusEl();
        status.textContent = message;
        status.hidden = false;
        if (attempt && attempt.button) attempt.button.removeAttribute('aria-disabled');
    }

    function resetLoadUi() {
        clearLoadAttempt(true);
        if (!global.document) return;
        global.document.querySelectorAll('[data-site-play]').forEach(function (button) {
            button.removeAttribute('data-site-play-reload');
            button.removeAttribute('aria-disabled');
            var label = button.getAttribute('data-site-play-label');
            if (label) button.textContent = label;
        });
        global.document.querySelectorAll('[data-site-play-status]').forEach(function (el) {
            el.hidden = true;
            el.textContent = '';
        });
    }

    function beginLoadWatch(id, button) {
        clearLoadAttempt(true);
        var el = getAudio();
        var status = button ? getRowStatus(button) : getStatusEl();
        if (button) {
            button.setAttribute('aria-disabled', 'true');
            button.textContent = 'Opening\u2026';
            button.setAttribute('aria-label', 'Opening ' + (TRACKS[id] ? TRACKS[id].title : 'track'));
        }
        status.hidden = false;
        status.textContent = 'Opening the player. You can also use the streaming links.';

        var token = {
            id: id,
            button: button,
            el: el,
            timer: null,
            onCanPlay: null,
            onError: null
        };
        loadAttempt = token;

        token.onCanPlay = function () {
            if (loadAttempt !== token) return;
            clearLoadAttempt(true);
            status.hidden = true;
            status.textContent = '';
            if (button) button.removeAttribute('aria-disabled');
            syncButtons();
        };
        token.onError = function () {
            if (loadAttempt !== token) return;
            settleLoadFailure('The track could not be opened. Reload it or use the streaming links.', button);
        };
        token.timer = global.setTimeout(function () {
            if (loadAttempt !== token) return;
            settleLoadFailure('The track is taking longer than expected. Reload it or use the streaming links.', button);
        }, LOAD_DEADLINE_MS);

        el.addEventListener('canplay', token.onCanPlay);
        el.addEventListener('error', token.onError);
    }

    function syncButtons() {
        if (!global.document) return;
        global.document.querySelectorAll('[data-site-play]').forEach(function (button) {
            if (button.getAttribute('data-site-play-reload') === 'true') {
                button.setAttribute('aria-pressed', 'false');
                return;
            }
            if (button.getAttribute('aria-disabled') === 'true') return;
            var id = button.getAttribute('data-site-play');
            var active = playing() && currentId === id;
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
            var label = button.getAttribute('data-site-play-label');
            if (label) button.textContent = active ? label.replace(/^▶\s*/, '\u275a\u275a ') : label;
        });
    }

    function pauseOthers() {
        if (!global.document) return;
        global.document.querySelectorAll('audio, video').forEach(function (el) {
            if (el === getAudio()) return;
            try { el.pause(); } catch (e) { /* */ }
        });
    }

    function play(id, button) {
        var track = TRACKS[id];
        if (!track) return Promise.resolve();
        if (!musicOn()) {
            showMusicOffStatus();
            syncButtons();
            return Promise.resolve();
        }
        var el = getAudio();
        var src = trackSrc(id);
        pauseOthers();
        var needsLoad = currentId !== id || el.getAttribute('src') !== src;
        if (needsLoad) {
            el.src = src;
            currentId = id;
            beginLoadWatch(id, button || null);
        }
        el.setAttribute('aria-label', track.title);
        return el.play().then(function () {
            if (loadAttempt && loadAttempt.id === id) {
                clearLoadAttempt(true);
                var status = button ? getRowStatus(button) : getStatusEl();
                status.hidden = true;
                status.textContent = '';
                if (button) button.removeAttribute('aria-disabled');
            }
            syncButtons();
        }).catch(function () {
            if (loadAttempt && loadAttempt.id === id) {
                settleLoadFailure('The track could not be opened. Reload it or use the streaming links.', button || null);
            }
            return undefined;
        });
    }

    function toggle(id, button) {
        if (playing() && currentId === id) {
            getAudio().pause();
            return Promise.resolve();
        }
        return play(id, button);
    }

    function bind() {
        if (!global.document || bound) return;
        bound = true;
        global.document.addEventListener('click', function (event) {
            var button = event.target && event.target.closest ? event.target.closest('[data-site-play]') : null;
            if (!button || button.tagName !== 'BUTTON') return;
            event.preventDefault();
            var id = button.getAttribute('data-site-play');
            if (!musicOn()) {
                showMusicOffStatus();
                syncButtons();
                return;
            }
            if (button.getAttribute('aria-disabled') === 'true') return;
            if (button.getAttribute('data-site-play-reload') === 'true') {
                button.removeAttribute('data-site-play-reload');
                var label = button.getAttribute('data-site-play-label');
                if (label) button.textContent = label;
                if (button.getAttribute('aria-label')) {
                    button.setAttribute('aria-label', 'Play ' + (TRACKS[id] ? TRACKS[id].title : 'track') + ' here');
                }
                toggle(id, button);
                return;
            }
            toggle(id, button);
        });
        global.addEventListener('stalemate-music-change', function (event) {
            if (event.detail && !event.detail.on && audio) {
                try { audio.pause(); } catch (e) { /* */ }
            }
            syncButtons();
        });
        global.document.addEventListener('play', function (event) {
            if (audio && event.target !== audio) {
                try { audio.pause(); } catch (e) { /* */ }
            }
        }, true);
        global.addEventListener('pagehide', function () {
            clearLoadAttempt(true);
            if (audio) {
                try { audio.pause(); } catch (e) { /* */ }
            }
            resetLoadUi();
            syncButtons();
        });
        syncButtons();
    }

    function init() {
        bind();
    }

    global.StalemateSitePlayer = Object.freeze({
        TRACKS: TRACKS,
        trackSrc: trackSrc,
        play: function (id) { return play(id, null); },
        toggle: function (id) { return toggle(id, null); },
        currentId: function () { return currentId; },
        init: init
    });

    if (global.document) {
        if (global.document.readyState === 'loading') {
            global.document.addEventListener('DOMContentLoaded', init);
        } else {
            init();
        }
    }
}(typeof globalThis === 'undefined' ? window : globalThis));
