import { isIos, standaloneFrom } from './install-card.mjs';
import { rememberPlace } from './last-room.mjs';
import { registerHomeScreenWorker } from './register-sw.mjs';

export const OPEN_IN_APP_TITLE = 'Open in Hang Out';
export const JUMP_LABEL = 'Jump in';
export const HOME_LABEL = 'Go to Hang Out home';
export const IPHONE_LIMIT = 'iPhone opens this link in Safari.';
export const HOST_ASK = 'Ask your host to send the invite; tap it and you\'re in.';
export const INVITE_LEDE = 'Draw together, play a table, or join a jam.';

const INVITE_KEYS = new Set(['invite', 'a', 'r', 'h', 'k', 's', 'g', 'e', 'grant']);
const ROOM_SECRET = /^[A-Za-z0-9_-]{24}$/;
const ROOM_HOST = /^[A-Za-z0-9_-]{80,100}$/;

function paramsOf(value) {
    const raw = String(value || '').replace(/^[?#]/, '');
    if (!raw || raw.length > 8192) return null;
    try {
        return new URLSearchParams(raw);
    } catch {
        return null;
    }
}

function capabilityOk(value) {
    try {
        const pad = value.length % 4 === 0 ? '' : '='.repeat(4 - (value.length % 4));
        const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + pad);
        if (binary.length !== 32) return false;
        for (let index = 0; index < binary.length; index += 1) {
            if (binary.charCodeAt(index) !== 0) return true;
        }
        return false;
    } catch {
        return false;
    }
}

function webjamValid(params, now) {
    const keys = [...params.keys()];
    if (keys.length !== 4 || ['k', 's', 'g', 'e'].some((key) => params.getAll(key).length !== 1)) return false;
    const capability = params.get('k') || '';
    const session = params.get('s') || '';
    const generationRaw = params.get('g') || '';
    const expiresRaw = params.get('e') || '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(capability) || !capabilityOk(capability)) return false;
    if (!/^[0-9a-f]{64}$/.test(session) || /^0+$/.test(session)) return false;
    if (!/^[1-9][0-9]*$/.test(generationRaw) || !/^[1-9][0-9]*$/.test(expiresRaw)) return false;
    const generation = Number(generationRaw);
    const expiresAt = Number(expiresRaw);
    if (!Number.isSafeInteger(generation) || generation > 4294967295) return false;
    if (!Number.isSafeInteger(expiresAt)) return false;
    return expiresAt * 1000 > now && expiresAt * 1000 <= now + 630000;
}

function roomValid(params) {
    if (params.getAll('r').length !== 1 || params.getAll('h').length !== 1) return false;
    return ROOM_SECRET.test(params.get('r') || '') && ROOM_HOST.test(params.get('h') || '');
}

export function inviteSignal(search, hash) {
    return classifyInvite(search, hash) !== 'absent';
}

export function classifyInvite(search, hash, now = Date.now()) {
    let saw = false;
    for (const value of [hash, search]) {
        const params = paramsOf(value);
        if (!params) continue;
        for (const key of params.keys()) {
            if (INVITE_KEYS.has(String(key).toLowerCase())) saw = true;
        }
        if (webjamValid(params, now) || roomValid(params)) return 'valid';
    }
    return saw ? 'invalid' : 'absent';
}

export function hostPreview(search) {
    const params = paramsOf(search);
    return Boolean(params?.has('preview'));
}

export function hangoutHomePath(moduleUrl) {
    let home;
    try {
        home = new URL('./', moduleUrl);
    } catch {
        return '';
    }
    if (home.protocol !== 'http:' && home.protocol !== 'https:') return '';
    return safeHomeHref(home.pathname);
}

export function safeHomeHref(value) {
    if (typeof value !== 'string' || value.length < 9 || value.length > 200) return '';
    if (!value.startsWith('/') || value.includes('..') || value.includes('\\') || /[?#\s]/.test(value)) return '';
    if (!value.endsWith('/hangout/')) return '';
    if (/invite|grant|token|preview|javascript:|data:/i.test(value)) return '';
    return value;
}

export function openInAppLines({ ios = false, action = 'home', place = '', led = false, alreadyHome = false } = {}) {
    const lines = [];
    const homeAsk = place === 'webjam' && action === 'home';
    if (!led && homeAsk) lines.push(HOST_ASK);
    // The WebJam ask on the home screen has no invite link, so it does not mention Safari.
    if (ios && !(alreadyHome && homeAsk)) lines.push(IPHONE_LIMIT);
    return lines;
}

export function openInAppDecision({
    standalone = false,
    installed = 'unknown',
    link = 'absent',
    hostPreview: preview = false
} = {}) {
    if (standalone) return { show: false, action: 'none', installed };
    if (installed !== 'installed' && installed !== 'unknown') return { show: false, action: 'none', installed };
    if (link === 'valid') return { show: true, action: 'jump', installed };
    if (link === 'absent' && preview) return { show: false, action: 'none', installed };
    return { show: true, action: 'home', installed };
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

export function jumpIn(doc) {
    const gate = doc.querySelector('[data-gate], #prejoin, .join-card');
    if (gate && typeof gate.scrollIntoView === 'function') gate.scrollIntoView({ block: 'nearest' });
    const name = doc.querySelector('[data-name]');
    const named = name && String(name.value || '').trim().length >= 2;
    if (name && !named) {
        name.focus();
        return 'name';
    }
    const enter = doc.querySelector('[data-enter], #join');
    const kept = enter && !enter.disabled && (!enter.hidden || enter.dataset.jumpDuplicate === 'hidden');
    if (kept) {
        if (!enter.hidden && typeof enter.focus === 'function') enter.focus();
        enter.click();
        return 'enter';
    }
    const mic = doc.querySelector('#check-mic');
    if (mic && !mic.disabled) {
        mic.focus();
        return 'mic';
    }
    if (name) name.focus();
    return 'focus';
}

export function orangeMarkHref(moduleUrl) {
    let url;
    try {
        url = new URL('../assets/hangout-app/webjam-mark.svg', moduleUrl);
    } catch {
        return '';
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (url.username || url.password || url.search || url.hash) return '';
    if (!url.pathname.endsWith('/assets/hangout-app/webjam-mark.svg')) return '';
    return url.href;
}

// A real invite keeps one Jump in, and it sits with the name field.
export function seatJumpWithName(doc) {
    const enter = doc.querySelector('[data-enter], #join');
    if (!enter || enter.closest('[data-open-in-app]')) return false;
    enter.hidden = false;
    if (enter.dataset.jumpDuplicate) delete enter.dataset.jumpDuplicate;
    enter.classList.add('hoa__jump');
    const name = doc.querySelector('[data-name]');
    const anchor = name?.closest('label') || name;
    if (anchor && enter !== anchor && !anchor.contains(enter)) anchor.after(enter);
    return true;
}

export function showInviteMark(doc) {
    doc.documentElement.classList.add('hoa-invite');
    const tag = doc.querySelector('.hang-head .tag');
    if (tag) tag.textContent = INVITE_LEDE;
    return true;
}

export function fillOpenInApp(doc, { ios = false, installed = 'unknown', action = 'home', place = '', homeHref = '', alreadyHome = false, markHref = '' } = {}) {
    const region = doc.createElement('aside');
    region.className = 'hoa';
    region.dataset.openInApp = installed;
    region.dataset.action = action;
    region.setAttribute('role', 'region');
    region.setAttribute('aria-label', OPEN_IN_APP_TITLE);
    const href = safeHomeHref(homeHref);
    const webjamHome = place === 'webjam' && action === 'home';
    if (webjamHome) {
        const lead = doc.createElement('p');
        lead.className = 'hoa__lead';
        lead.textContent = HOST_ASK;
        region.append(lead);
    }
    if (action === 'jump') {
        if (markHref) {
            const mark = doc.createElement('img');
            mark.className = 'hoa__mark';
            mark.alt = '';
            mark.width = 72;
            mark.height = 72;
            mark.src = markHref;
            region.append(mark);
        }
    } else if (href && !alreadyHome) {
        const link = doc.createElement('a');
        link.className = webjamHome ? 'hoa__quiet' : 'hoa__go';
        link.href = href;
        link.textContent = HOME_LABEL;
        region.append(link);
    }
    for (const text of openInAppLines({ ios, action, place, led: webjamHome, alreadyHome })) {
        const line = doc.createElement('p');
        line.className = 'hoa__line';
        line.textContent = text;
        region.append(line);
    }
    return region;
}

export function keepSingleJump(doc) {
    return seatJumpWithName(doc);
}

export async function mountOpenInApp(doc, env) {
    const mode = doc.querySelector('meta[name="hangout-open-in-app"]')?.getAttribute('content');
    if (mode !== 'always' && mode !== 'invite') return false;
    const place = doc.querySelector('meta[name="hangout-place"]')?.getAttribute('content') || '';
    if (place) rememberPlace(env.storage, place);
    if (doc.querySelector('[data-open-in-app]')) return true;
    const link = env.link || classifyInvite(env.search, env.hash);
    const installed = env.installed || 'unknown';
    const decision = openInAppDecision({
        standalone: standaloneFrom(env),
        installed,
        link,
        hostPreview: env.hostPreview === true || hostPreview(env.search)
    });
    if (!decision.show) return false;
    const markHref = decision.action === 'jump' ? orangeMarkHref(env.moduleUrl || '') : '';
    const region = fillOpenInApp(doc, {
        ios: isIos(env.userAgent, env.maxTouchPoints || 0),
        installed: decision.installed,
        action: decision.action,
        place: place === 'webjam' ? 'webjam' : place,
        homeHref: env.homeHref || '',
        markHref
    });
    const parent = doc.body || doc.documentElement;
    parent.insertBefore(region, parent.firstChild);
    if (decision.action === 'jump') {
        showInviteMark(doc);
        seatJumpWithName(doc);
    }
    if (!env.installed) {
        const detected = await detectInstalled(env.navigator);
        if (detected === 'installed') region.dataset.openInApp = detected;
    }
    return true;
}

export function mountHostAsk(slot, env) {
    if (!slot) return false;
    const doc = slot.ownerDocument;
    const region = fillOpenInApp(doc, {
        ios: isIos(env.userAgent, env.maxTouchPoints || 0),
        installed: 'unknown',
        action: 'home',
        place: 'webjam',
        homeHref: env.homeHref || '',
        alreadyHome: true
    });
    slot.replaceChildren(region);
    slot.hidden = false;
    return true;
}

const marker = typeof document !== 'undefined'
    ? document.querySelector('meta[name="hangout-open-in-app"]')
    : null;
if (marker && typeof navigator !== 'undefined' && typeof location !== 'undefined') {
    const homeHref = hangoutHomePath(import.meta.url);
    mountOpenInApp(document, {
        userAgent: navigator.userAgent,
        maxTouchPoints: navigator.maxTouchPoints || 0,
        storage: localStorage,
        matchMedia: (query) => matchMedia(query),
        navigatorStandalone: navigator.standalone === true,
        navigator,
        search: location.search,
        hash: location.hash,
        homeHref,
        moduleUrl: import.meta.url
    }).catch(() => {
        // The invite page still works if this hint cannot render.
    });
    registerHomeScreenWorker(navigator, import.meta.url).catch(() => {
        // The hint is already on the page if this browser will not install a worker.
    });
}
