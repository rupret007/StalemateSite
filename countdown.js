(function initializeStalemateCountdown(global) {
    'use strict';

    function assertFiniteTime(now) {
        const timestamp = Number(now);
        if (!Number.isFinite(timestamp)) {
            throw new TypeError('Countdown time must be a finite timestamp.');
        }
        return timestamp;
    }

    function pad(value) {
        return String(Math.max(0, value)).padStart(2, '0');
    }

    function remainingParts(startsAt, now = Date.now()) {
        const start = Date.parse(startsAt);
        const timestamp = assertFiniteTime(now);
        if (!Number.isFinite(start)) return null;
        const ms = start - timestamp;
        if (ms <= 0) return null;
        const totalSeconds = Math.floor(ms / 1000);
        return Object.freeze({
            days: Math.floor(totalSeconds / 86400),
            hours: Math.floor((totalSeconds % 86400) / 3600),
            minutes: Math.floor((totalSeconds % 3600) / 60),
            seconds: totalSeconds % 60,
            ms
        });
    }

    function fillClock(root, parts) {
        const days = root.querySelector('[data-countdown-days]');
        const hours = root.querySelector('[data-countdown-hours]');
        const minutes = root.querySelector('[data-countdown-minutes]');
        const seconds = root.querySelector('[data-countdown-seconds]');
        if (days) days.textContent = pad(parts.days);
        if (hours) hours.textContent = pad(parts.hours);
        if (minutes) minutes.textContent = pad(parts.minutes);
        if (seconds) seconds.textContent = pad(parts.seconds);
    }

    function apply(root, now = Date.now()) {
        const timestamp = assertFiniteTime(now);
        const blocks = Array.from(root.querySelectorAll('[data-next-show]'));
        const activeShow = blocks.find((block) => remainingParts(block.getAttribute('data-starts-at'), timestamp));
        root.querySelectorAll('[data-show-before]').forEach((element) => { element.hidden = !activeShow; });
        root.querySelectorAll('[data-show-copy]').forEach((element) => {
            if (!element.hasAttribute('data-evergreen')) element.setAttribute('data-evergreen', element.textContent);
            element.textContent = element.getAttribute(activeShow ? 'data-before' : 'data-evergreen');
        });
        root.querySelectorAll('[data-show-action]').forEach((element) => {
            if (!element.hasAttribute('data-evergreen-label')) {
                element.setAttribute('data-evergreen-label', element.textContent);
                element.setAttribute('data-evergreen-href', element.getAttribute('href'));
            }
            element.textContent = element.getAttribute(activeShow ? 'data-before-label' : 'data-evergreen-label');
            element.setAttribute('href', activeShow ? activeShow.getAttribute('data-show-href') : element.getAttribute('data-evergreen-href'));
            element.setAttribute('data-track', activeShow ? element.getAttribute('data-before-track') : 'show-cta-next-fallback');
        });
        let visibleCount = 0;

        blocks.forEach((block) => {
            const parts = remainingParts(block.getAttribute('data-starts-at'), timestamp);
            if (!parts) {
                block.hidden = true;
                return;
            }
            block.hidden = false;
            visibleCount += 1;
            const clock = block.querySelector('[data-countdown-clock]');
            if (clock) {
                fillClock(block, parts);
                clock.hidden = false;
            }
        });

        return Object.freeze({ visibleCount });
    }

    let timer = null;

    function stop() {
        if (timer !== null) {
            global.clearInterval(timer);
            timer = null;
        }
    }

    function start(root = global.document, now = Date.now()) {
        if (!root || !root.querySelector('[data-next-show]')) return null;
        const result = apply(root, now);
        stop();
        if (result.visibleCount > 0 && typeof global.setInterval === 'function') {
            timer = global.setInterval(() => {
                const next = apply(root, Date.now());
                if (next.visibleCount === 0) stop();
            }, 1000);
        }
        return result;
    }

    const api = Object.freeze({
        remainingParts,
        apply,
        start,
        stop
    });

    global.StalemateCountdown = api;

    if (global.document) {
        if (global.document.readyState === 'loading') {
            global.document.addEventListener('DOMContentLoaded', () => start(global.document), { once: true });
        } else {
            start(global.document);
        }
        global.addEventListener('pagehide', stop);
        global.addEventListener('focus', () => start(global.document));
        global.document.addEventListener('visibilitychange', () => {
            if (!global.document.hidden) start(global.document);
        });
        global.addEventListener('pageshow', (event) => {
            if (event.persisted) start(global.document);
        });
    }
}(typeof globalThis === 'undefined' ? window : globalThis));
