/* Site-wide music on/off — localStorage key stalemate.music ("on" | "off", default on). */
(function (global) {
    'use strict';

    var KEY = 'stalemate.music';
    var SITE_AUDIO_SELECTOR = '#stalemate-site-player, [data-stalemate-site-audio], [data-qr-audio]';
    var playPatched = false;

    function read() {
        try {
            var value = global.localStorage.getItem(KEY);
            return value === 'off' ? 'off' : 'on';
        } catch (e) {
            return 'on';
        }
    }

    function write(next) {
        try {
            global.localStorage.setItem(KEY, next === 'off' ? 'off' : 'on');
        } catch (e) { /* private mode */ }
    }

    function isOn() {
        return read() === 'on';
    }

    function syncDocument() {
        if (global.document && global.document.documentElement) {
            global.document.documentElement.dataset.stalemateMusicPref = read();
        }
    }

    function isSiteBackgroundMedia(el) {
        if (!el || !el.matches) return false;
        return el.matches(SITE_AUDIO_SELECTOR);
    }

    function pauseSiteBackgroundMedia() {
        if (!global.document) return;
        global.document.querySelectorAll(SITE_AUDIO_SELECTOR).forEach(function (el) {
            try { el.pause(); } catch (e) { /* */ }
        });
    }

    function patchSiteAutoplay() {
        if (playPatched || !global.HTMLMediaElement) return;
        playPatched = true;
        var nativePlay = global.HTMLMediaElement.prototype.play;
        global.HTMLMediaElement.prototype.play = function patchedPlay() {
            if (!isOn() && isSiteBackgroundMedia(this)) {
                try { this.pause(); } catch (e) { /* */ }
                return Promise.resolve();
            }
            return nativePlay.apply(this, arguments);
        };
    }

    function renderToggle(button) {
        var on = isOn();
        button.setAttribute('aria-pressed', on ? 'true' : 'false');
        button.textContent = on ? 'Music on' : 'Music off';
    }

    function bindToggle(button) {
        if (button.dataset.musicToggleBound === '1') return;
        button.dataset.musicToggleBound = '1';
        renderToggle(button);
        button.addEventListener('click', function () {
            write(isOn() ? 'off' : 'on');
            syncDocument();
            renderToggle(button);
            if (!isOn()) pauseSiteBackgroundMedia();
            global.dispatchEvent(new CustomEvent('stalemate-music-change', { detail: { on: isOn() } }));
        });
    }

    function init() {
        patchSiteAutoplay();
        syncDocument();
        if (!isOn()) pauseSiteBackgroundMedia();
        if (!global.document) return;
        global.document.querySelectorAll('[data-music-toggle]').forEach(bindToggle);
        global.addEventListener('storage', function (event) {
            if (event.key !== KEY) return;
            syncDocument();
            global.document.querySelectorAll('[data-music-toggle]').forEach(renderToggle);
            if (!isOn()) pauseSiteBackgroundMedia();
            global.dispatchEvent(new CustomEvent('stalemate-music-change', { detail: { on: isOn() } }));
        });
        global.addEventListener('stalemate-music-change', function () {
            if (!isOn()) pauseSiteBackgroundMedia();
        });
    }

    function bindToggles() {
        if (!global.document) return;
        global.document.querySelectorAll('[data-music-toggle]').forEach(bindToggle);
    }

    global.StalemateMusicPref = Object.freeze({
        KEY: KEY,
        read: read,
        write: write,
        isOn: isOn,
        pauseAllMedia: pauseSiteBackgroundMedia,
        bindToggles: bindToggles,
        init: init
    });

    patchSiteAutoplay();
    syncDocument();

    if (global.document) {
        if (global.document.readyState === 'loading') {
            global.document.addEventListener('DOMContentLoaded', init);
        } else {
            init();
        }
    }
}(typeof globalThis === 'undefined' ? window : globalThis));
