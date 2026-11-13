import { isIos, standaloneFrom } from './install-card.mjs';
import { rememberPlace } from './last-room.mjs';

export const OPEN_IN_APP_TITLE = 'Open in Hang Out';

const INVITE_KEYS = new Set(['invite', 'a', 'r', 'h', 'k', 's', 'g', 'e', 'grant']);

export function inviteSignal(search, hash) {
    const hit = (value) => {
        const raw = String(value || '').replace(/^[?#]/, '');
        if (!raw || raw.length > 8192) return false;
        try {
            for (const key of new URLSearchParams(raw).keys()) {
                if (INVITE_KEYS.has(String(key).toLowerCase())) return true;
            }
        } catch {
            return false;
        }
        return false;
    };
    return hit(search) || hit(hash);
}

export function openInAppCopy({ ios = false, installed = 'unknown' } = {}) {
    if (installed === 'installed') {
        return 'Hang Out is installed on this device. Switch to the Hang Out icon if this invite stayed in the browser.';
    }
    if (ios) {
        return 'iPhone opens invite links in Safari. A Hang Out icon on your home screen cannot take this link. Stay on this page to join.';
    }
    return 'If Hang Out is installed, this invite should open in the app. If it stayed in the browser, switch to the Hang Out icon. This page cannot tell whether the app is installed.';
}

export function openInAppDecision({ standalone = false, installed = 'unknown', inviteOnly = false, invitePresent = false } = {}) {
    if (standalone) return { show: false, installed };
    if (inviteOnly && !invitePresent) return { show: false, installed };
    if (installed !== 'installed' && installed !== 'unknown') return { show: false, installed };
    return { show: true, installed };
}

export async function detectInstalled(nav) {
    const fn = nav?.getInstalledRelatedApps;
    if (typeof fn !== 'function') return 'unknown';
    try {
        const apps = await fn.call(nav);
        if (!Array.isArray(apps) || apps.length === 0) return 'unknown';
        return 'installed';
    } catch {
        return 'unknown';
    }
}

export function fillOpenInApp(doc, { ios, installed }) {
    const region = doc.createElement('aside');
    region.className = 'hoa';
    region.dataset.openInApp = installed;
    region.setAttribute('role', 'region');
    region.setAttribute('aria-label', OPEN_IN_APP_TITLE);
    const title = doc.createElement('h2');
    title.textContent = OPEN_IN_APP_TITLE;
    const copy = doc.createElement('p');
    copy.textContent = openInAppCopy({ ios, installed });
    region.append(title, copy);
    return region;
}

export async function mountOpenInApp(doc, env) {
    const mode = doc.querySelector('meta[name="hangout-open-in-app"]')?.getAttribute('content');
    if (mode !== 'always' && mode !== 'invite') return false;
    const place = doc.querySelector('meta[name="hangout-place"]')?.getAttribute('content');
    if (place) rememberPlace(env.storage, place);
    const installed = env.installed || await detectInstalled(env.navigator);
    const decision = openInAppDecision({
        standalone: standaloneFrom(env),
        installed,
        inviteOnly: mode === 'invite',
        invitePresent: inviteSignal(env.search, env.hash)
    });
    if (!decision.show) return false;
    const region = fillOpenInApp(doc, {
        ios: isIos(env.userAgent, env.maxTouchPoints || 0),
        installed: decision.installed
    });
    const parent = doc.body || doc.documentElement;
    parent.insertBefore(region, parent.firstChild);
    return true;
}

const marker = typeof document !== 'undefined'
    ? document.querySelector('meta[name="hangout-open-in-app"]')
    : null;
if (marker && typeof navigator !== 'undefined') {
    mountOpenInApp(document, {
        userAgent: navigator.userAgent,
        maxTouchPoints: navigator.maxTouchPoints || 0,
        storage: localStorage,
        matchMedia: (query) => matchMedia(query),
        navigatorStandalone: navigator.standalone === true,
        navigator,
        search: location.search,
        hash: location.hash
    }).catch(() => {
        // The invite page still works if this hint cannot render.
    });
}
