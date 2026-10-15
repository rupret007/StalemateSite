(function initializeStalemateShowState(global) {
    'use strict';

    function assertFiniteTime(now) {
        const timestamp = Number(now);
        if (!Number.isFinite(timestamp)) {
            throw new TypeError('Show-state time must be a finite timestamp.');
        }
        return timestamp;
    }

    function readShow(element) {
        const starts = element.getAttribute('data-starts-at');
        const ends = element.getAttribute('data-ends-at');
        return {
            element,
            placeholder: element.getAttribute('data-placeholder') === 'true',
            startsAt: starts ? Date.parse(starts) : Number.NaN,
            endsAt: ends ? Date.parse(ends) : Number.NaN
        };
    }

    function getPhase(show, now = Date.now()) {
        const timestamp = assertFiniteTime(now);
        if (show.placeholder || !Number.isFinite(show.startsAt)) return 'upcoming';
        if (timestamp < show.startsAt) return 'upcoming';
        if (Number.isFinite(show.endsAt) && timestamp < show.endsAt) return 'live';
        return 'past';
    }

    function apply(root, now = Date.now()) {
        const timestamp = assertFiniteTime(now);
        const upcoming = root.querySelector('[data-upcoming-shows]');
        const past = root.querySelector('[data-past-shows]');
        const emptyUpcoming = root.querySelector('[data-upcoming-empty]');
        const emptyPast = root.querySelector('[data-past-empty]');
        const cards = Array.from(root.querySelectorAll('[data-show]'));

        cards.forEach((card) => {
            const phase = getPhase(readShow(card), timestamp);
            card.dataset.showPhase = phase;
            const list = phase === 'past' ? past : upcoming;
            if (list && card.parentElement !== list) list.appendChild(card);
            card.querySelectorAll('[data-show-live-action]').forEach((action) => {
                action.hidden = phase === 'past';
            });
        });

        const upcomingCount = upcoming
            ? upcoming.querySelectorAll('[data-show]').length
            : cards.filter((card) => card.dataset.showPhase !== 'past').length;
        const pastCount = past
            ? past.querySelectorAll('[data-show]').length
            : cards.filter((card) => card.dataset.showPhase === 'past').length;

        if (emptyUpcoming) emptyUpcoming.hidden = upcomingCount > 0;
        if (emptyPast) emptyPast.hidden = pastCount > 0;
        if (root.documentElement) root.documentElement.dataset.showCatalog = 'live';

        return Object.freeze({ upcomingCount, pastCount });
    }

    function start(root = global.document, now = Date.now()) {
        if (!root) return null;
        return apply(root, now);
    }

    const api = Object.freeze({
        getPhase,
        apply,
        start
    });

    global.StalemateShowState = api;

    if (global.document) {
        if (global.document.readyState === 'loading') {
            global.document.addEventListener('DOMContentLoaded', () => start(global.document), { once: true });
        } else {
            start(global.document);
        }
    }
}(typeof globalThis === 'undefined' ? window : globalThis));
