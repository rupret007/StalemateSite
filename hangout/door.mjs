import { HOST_ASK } from './open-in-app.mjs';

// A door matches the row that opened it. The name field and the enter button stay visible.
// This page has no public address for that room. The visit leads with that one line
// and Hang Out home. Jump in stays, and it is not the loud control.

export const DOOR_KINDS = Object.freeze(['hangout', 'game-night', 'draw', 'watch', 'jam']);

export const PLACE_KIND_LABEL = Object.freeze({
    chat: 'Chat',
    art: 'Draw together',
    bobross: 'Paint-along',
    watch: 'Watch together',
    jam: 'WebJam',
    game: 'Game Night'
});

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

export function cannotOpenLine(heading) {
    const name = String(heading || 'this room').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40);
    return `This visit can't open ${name || 'this room'}.`;
}

export function placeHref(kind, title = '', extra = {}) {
    const params = new URLSearchParams();
    params.set('kind', KIND.has(kind) ? kind : 'hangout');
    if (title) params.set('title', title);
    const count = Number(extra.count);
    if (Number.isSafeInteger(count) && count >= 1 && count <= 99) params.set('count', String(count));
    if (Object.hasOwn(PLACE_KIND_LABEL, extra.via)) params.set('via', extra.via);
    if (params.get('kind') === 'game-night') params.set('game-night', '1');
    return `door.html?${params.toString()}`;
}

function oneValue(params, key, pattern) {
    const values = params.getAll(key);
    if (values.length !== 1 || !pattern.test(values[0])) return '';
    return values[0];
}

export function parseDoor(search) {
    const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
    const requested = params.get('kind') || 'hangout';
    const kind = KIND.has(requested) ? requested : 'hangout';
    const rawTitle = params.get('title') || '';
    const title = TITLE.test(rawTitle) && !/invite|grant|token|preview/i.test(rawTitle) ? rawTitle : '';
    const count = Number(oneValue(params, 'count', /^[1-9][0-9]?$/)) || 0;
    const via = oneValue(params, 'via', /^[a-z]+$/);
    const kindLabel = Object.hasOwn(PLACE_KIND_LABEL, via) ? PLACE_KIND_LABEL[via] : KICKER[kind];
    return {
        kind,
        title,
        count,
        via: Object.hasOwn(PLACE_KIND_LABEL, via) ? via : '',
        heading: title || FALLBACK[kind],
        kicker: KICKER[kind],
        kindLabel,
        meta: count ? `${count} here · ${kindLabel}` : '',
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
    const count = oneValue(current.searchParams, 'count', /^[1-9][0-9]?$/);
    if (count && !next.searchParams.has('count')) next.searchParams.set('count', count);
    const via = oneValue(current.searchParams, 'via', /^[a-z]+$/);
    if (Object.hasOwn(PLACE_KIND_LABEL, via) && !next.searchParams.has('via')) next.searchParams.set('via', via);
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

// The named room has no public address on this page, so the visit cannot open it.
export function presentClosedDoor(doc, heading) {
    const line = cannotOpenLine(heading);
    let lead = doc.querySelector('[data-door-lead]');
    const status = doc.querySelector('[data-door-status]');
    if (!lead && status) {
        status.dataset.doorLead = '';
        status.classList.add('door-lead');
        lead = status;
    }
    if (!lead) {
        lead = doc.createElement('p');
        lead.className = 'door-lead';
        lead.dataset.doorLead = '';
        lead.setAttribute('role', 'status');
    }
    lead.textContent = line;
    const name = doc.querySelector('[data-name]');
    const slot = doc.querySelector('[data-door-form]') || name;
    const earlier = Boolean(slot && lead.parentElement && (slot.compareDocumentPosition(lead) & Node.DOCUMENT_POSITION_PRECEDING));
    if (slot && !earlier) slot.before(lead);
    else if (!lead.parentElement) doc.body.append(lead);
    const home = doc.querySelector('[data-door-home]');
    if (home) {
        home.classList.add('door-home--lead');
        if (home.previousElementSibling !== lead) lead.after(home);
    }
    const enter = doc.querySelector('[data-enter]');
    if (enter) enter.classList.add('door__enter--quiet');
    if (status && status !== lead) {
        status.textContent = line;
        status.hidden = true;
    }
    return line;
}

export function mountDoor(doc, env = {}) {
    const parsed = parseDoor(env.search || '');
    const title = doc.querySelector('[data-door-title]');
    const kicker = doc.querySelector('[data-door-kicker]');
    const step = doc.querySelector('[data-door-step]');
    if (title) title.textContent = parsed.heading;
    if (kicker) kicker.textContent = parsed.kicker;
    if (step) step.textContent = parsed.step;
    const meta = doc.querySelector('[data-door-meta]');
    if (meta) {
        meta.textContent = parsed.meta;
        meta.hidden = !parsed.meta;
    }
    if (typeof doc.title === 'string') doc.title = `${parsed.heading} · Hang Out`;
    const name = doc.querySelector('[data-name]');
    const enter = doc.querySelector('[data-enter]');
    showFields(name, enter);
    presentClosedDoor(doc, parsed.heading);
    const submit = () => {
        showFields(name, enter);
        const typed = String(name?.value || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 24);
        const status = doc.querySelector('[data-door-status]');
        const lead = doc.querySelector('[data-door-lead]');
        if (typed.length < 2) {
            if (status) {
                status.hidden = false;
                status.textContent = 'Type a name to jump in.';
            }
            if (typeof name?.focus === 'function') name.focus();
            return;
        }
        try { env.storage?.setItem('hangout-nick', typed); } catch { /* private mode */ }
        const line = cannotOpenLine(parsed.heading);
        if (lead && lead !== status) lead.textContent = line;
        if (status) {
            status.textContent = line;
            status.hidden = Boolean(lead && lead !== status);
        }
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
