/* Shared on-site audio player (same-origin AAC under play/stalemate/). Honors stalemate.music. */
(function (global) {
    'use strict';

    var TRACKS = Object.freeze({
        manic: { file: 'manic.m4a', title: 'Manic' },
        andrea: { file: 'andrea.m4a', title: 'Andrea' },
        'only-been-18': { file: 'only-been-18.m4a', title: 'It\u2019s Only Been 18' }
    });

    var audio = null;
    var currentId = null;
    var bound = false;

    function pref() {
        return global.StalemateMusicPref;
    }

    function musicOn() {
        return !pref() || pref().isOn();
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

    function getAudio() {
        if (!audio && global.document) {
            audio = global.document.createElement('audio');
            audio.preload = 'none';
            audio.setAttribute('playsinline', '');
            audio.id = 'stalemate-site-player';
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

    function syncButtons() {
        if (!global.document) return;
        global.document.querySelectorAll('[data-site-play]').forEach(function (button) {
            var id = button.getAttribute('data-site-play');
            var active = playing() && currentId === id;
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
            var label = button.getAttribute('data-site-play-label');
            if (label) button.textContent = active ? label.replace(/^▶\s*/, '❚❚ ') : label;
        });
    }

    function pauseOthers() {
        if (!global.document) return;
        global.document.querySelectorAll('audio, video').forEach(function (el) {
            if (el === getAudio()) return;
            try { el.pause(); } catch (e) { /* */ }
        });
    }

    function play(id) {
        var track = TRACKS[id];
        if (!track) return Promise.resolve();
        if (!musicOn()) {
            syncButtons();
            return Promise.resolve();
        }
        var el = getAudio();
        var src = trackSrc(id);
        pauseOthers();
        if (currentId !== id || el.getAttribute('src') !== src) {
            el.src = src;
            currentId = id;
        }
        el.setAttribute('aria-label', track.title);
        return el.play().catch(function () { return undefined; });
    }

    function toggle(id) {
        if (playing() && currentId === id) {
            getAudio().pause();
            return Promise.resolve();
        }
        return play(id);
    }

    function bind() {
        if (!global.document || bound) return;
        bound = true;
        global.document.addEventListener('click', function (event) {
            var button = event.target && event.target.closest ? event.target.closest('[data-site-play]') : null;
            if (!button || button.tagName !== 'BUTTON') return;
            event.preventDefault();
            var id = button.getAttribute('data-site-play');
            if (!musicOn()) return;
            toggle(id);
        });
        global.addEventListener('stalemate-music-change', function () {
            if (!musicOn() && audio) {
                try { audio.pause(); } catch (e) { /* */ }
            }
            syncButtons();
        });
        global.document.addEventListener('play', function (event) {
            if (audio && event.target !== audio) {
                try { audio.pause(); } catch (e) { /* */ }
            }
        }, true);
        syncButtons();
    }

    function init() {
        bind();
    }

    global.StalemateSitePlayer = Object.freeze({
        TRACKS: TRACKS,
        trackSrc: trackSrc,
        play: play,
        toggle: toggle,
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
