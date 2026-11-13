import { HOST_ASK } from './open-in-app.mjs';

// A door matches the row that opened it. The name field and the enter button stay visible.

export const DOOR_KINDS = Object.freeze(['hangout', 'game-night', 'draw', 'watch', 'jam']);

const KIND = new Set(DOOR_KINDS);
const TITLE = /^[A-Za-z0-9][A-Za-z0-9 .'-]{0,39}$/;
const DROP = ['preview', 'relay', 'turn', 'invite', 'grant', 'token'];

const FALLBACK = Object.freeze({
    hangout: 'Hang Out',
    'game-night': 'Game Night',
    draw: 'Drawing room',
    watch: 'Watch party',
    jam: 'WebJam'
});

const KICKER = Object.freeze({
    hangout: 'Hang Out',
    'game-night': 'Game Night',
    draw: 'Draw together',
    watch: 'Watch together',
    jam: 'WebJam'
});

const STEP = Object.freeze({
    hangout: 'Pick a name and jump in.',
    'game-night': 'Pick a name and jump in.',
    draw: 'Pick a name and draw together.',
    watch: 'Pick a name and watch together.',
    jam: HOST_ASK
});

export function placeHref(kind, title = '') {
    const params = new URLSearchParams();
    params.set('kind', KIND.has(kind) ? kind : 'hangout');
    if (title) params.set('title', title);
    if (params.get('kind') === 'game-night') params.set('game-night', '1');
    return `door.html?${params.toString()}`;
}

export function parseDoor(search) {
    const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
    const requested = params.get('kind') || 'hangout';
    const kind = KIND.has(requested) ? requested : 'hangout';
    const rawTitle = params.get('title') || '';
    const title = TITLE.test(rawTitle) && !/invite|grant|token|preview/i.test(rawTitle) ? rawTitle : '';
    return {
        kind,
        title,
        heading: title || FALLBACK[kind],
        kicker: KICKER[kind],
        step: STEP[kind],
        gameNight: kind === 'game-night'
    };
}

export function retainDoorQuery(currentHref, nextHref) {
    let current;
    try {
        current = new URL(currentHref);
    } catch {
        return String(nextHref);
    }
    if (current.searchParams.get('kind') !== 'game-night') return String(nextHref);
    let next;
    try {
        next = new URL(String(nextHref), current);
    } catch {
        return String(nextHref);
    }
    if (next.origin !== current.origin) return String(nextHref);
    if (!next.searchParams.get('kind')) next.searchParams.set('kind', 'game-night');
    const title = current.searchParams.get('title');
    if (title && !next.searchParams.has('title')) next.searchParams.set('title', title);
    for (const key of [...next.searchParams.keys()]) {
        if (DROP.includes(key.toLowerCase())) next.searchParams.delete(key);
    }
    next.searchParams.set('game-night', '1');
    return `${next.pathname}${next.search}${next.hash}`;
}

export function guardGameNightFlag(history, location) {
    const native = history.replaceState.bind(history);
    if (history.replaceState.hangoutDoorGuarded) return;
    const wrapped = (state, title, url) => {
        const next = retainDoorQuery(location.href, url == null ? location.href : url);
        native(state, title, next);
    };
    wrapped.hangoutDoorGuarded = true;
    history.replaceState = wrapped;
}

function showFields(name, enter) {
    if (name) name.hidden = false;
    if (enter) enter.hidden = false;
}

export function mountDoor(doc, env = {}) {
    const parsed = parseDoor(env.search || '');
    const title = doc.querySelector('[data-door-title]');
    const kicker = doc.querySelector('[data-door-kicker]');
    const step = doc.querySelector('[data-door-step]');
    if (title) title.textContent = parsed.heading;
    if (kicker) kicker.textContent = parsed.kicker;
    if (step) step.textContent = parsed.step;
    if (typeof doc.title === 'string') doc.title = `${parsed.heading} · Hang Out`;
    const name = doc.querySelector('[data-name]');
    const enter = doc.querySelector('[data-enter]');
    showFields(name, enter);
    const submit = () => {
        showFields(name, enter);
        const typed = String(name?.value || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 24);
        const status = doc.querySelector('[data-door-status]');
        if (typed.length < 2) {
            if (status) status.textContent = 'Type a name to jump in.';
            if (typeof name?.focus === 'function') name.focus();
            return;
        }
        try { env.storage?.setItem('hangout-nick', typed); } catch { /* private mode */ }
        if (status) status.textContent = parsed.kind === 'jam' ? parsed.step : 'Name saved on this device.';
    };
    enter?.addEventListener('click', submit);
    name?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        submit();
    });
    if (parsed.gameNight && env.history && env.location) {
        guardGameNightFlag(env.history, env.location);
        const kept = retainDoorQuery(env.location.href, env.location.href);
        const current = new URL(env.location.href);
        if (current.searchParams.get('game-night') !== '1') env.history.replaceState(null, '', kept);
    }
    return parsed;
}

if (typeof document !== 'undefined' && document.querySelector('[data-door-page]')) {
    mountDoor(document, {
        search: location.search,
        storage: localStorage,
        history,
        location
    });
}
