import { isIos } from './install-card.mjs';
import { HOST_ASK, classifyInvite, fillOpenInApp, hangoutHomePath } from './open-in-app.mjs';

// A join page with no invite asks for the host's link. This runs from the page
// itself, including the visit before a service worker is installed.

export function repairAbsentJoin(doc, env = {}) {
    if (classifyInvite(env.search, env.hash) !== 'absent') return false;
    const status = doc.getElementById('status');
    const paint = () => {
        if (status && /invalid web join invite/i.test(status.textContent || '')) {
            status.textContent = HOST_ASK;
            status.removeAttribute('data-failure');
        }
        const hint = doc.getElementById('error-hint');
        if (hint) {
            hint.textContent = '';
            hint.hidden = true;
        }
        const retry = doc.getElementById('retry');
        if (retry) retry.hidden = true;
    };
    paint();
    if (status && typeof MutationObserver === 'function') {
        const observer = new MutationObserver(paint);
        observer.observe(status, { subtree: true, childList: true, characterData: true });
    }
    if (typeof setTimeout === 'function') setTimeout(paint, 0);
    if (!doc.querySelector('[data-open-in-app]')) {
        const region = fillOpenInApp(doc, {
            ios: env.ios === true,
            action: 'home',
            place: 'webjam',
            homeHref: env.homeHref || '',
            alreadyHome: false
        });
        const parent = doc.body || doc.documentElement;
        if (parent) parent.insertBefore(region, parent.firstChild);
    }
    return true;
}

const marker = typeof document !== 'undefined'
    ? document.querySelector('meta[name="hangout-join-absent"]')
    : null;
if (marker && typeof location !== 'undefined') {
    repairAbsentJoin(document, {
        search: location.search,
        hash: location.hash,
        homeHref: hangoutHomePath(import.meta.url),
        ios: isIos(navigator.userAgent, navigator.maxTouchPoints || 0)
    });
}
