import { mountInstallCard } from './install-card.mjs';
import { registerHomeScreenWorker } from './register-sw.mjs';

const card = document.querySelector('[data-install-card]');
if (card) {
    mountInstallCard(card, {
        userAgent: navigator.userAgent,
        maxTouchPoints: navigator.maxTouchPoints || 0,
        storage: localStorage,
        matchMedia: (query) => matchMedia(query),
        navigatorStandalone: navigator.standalone === true,
        listen(type, handler) { addEventListener(type, handler); }
    });
}

registerHomeScreenWorker(navigator, import.meta.url).catch(() => {
    // The choices still work if this browser will not register a worker.
});
