import { mountInstallCard } from './install-card.mjs';
import { mountShortcuts } from './last-room.mjs';
import { registerHomeScreenWorker } from './register-sw.mjs';
import { mountWhosHere } from './whos-here.mjs';

registerHomeScreenWorker(navigator, import.meta.url).catch(() => {
    // The choices still work if this browser will not register a worker.
});

const leaving = mountShortcuts(document, {
    search: location.search,
    storage: localStorage,
    replace: (href) => location.replace(href)
});

const here = document.querySelector('[data-whos-here]');
if (!leaving && here) {
    mountWhosHere(here, { fetch: (...args) => fetch(...args) }).catch(() => {
        const status = here.querySelector('[data-here-status]');
        if (status) status.textContent = 'No open rooms right now.';
    });
}

const card = document.querySelector('[data-install-card]');
if (!leaving && card) {
    mountInstallCard(card, {
        userAgent: navigator.userAgent,
        maxTouchPoints: navigator.maxTouchPoints || 0,
        storage: localStorage,
        matchMedia: (query) => matchMedia(query),
        navigatorStandalone: navigator.standalone === true,
        listen(type, handler) { addEventListener(type, handler); }
    });
}
