import { PLACE_KIND_LABEL, placeHref } from './door.mjs';
import { safeChoiceHref } from './last-room.mjs';

// Open rooms and tables from an existing GET. Personal fields are dropped.

export const OPEN_PLACE_READS = Object.freeze(['/beta/state']);
export const EMPTY_COPY = 'No open rooms right now.';

const KIND_LABEL = PLACE_KIND_LABEL;

export function safeReadPath(value) {
    if (typeof value !== 'string' || value.length > 80) return false;
    if (!value.startsWith('/') || value.startsWith('//')) return false;
    if (/[?#\\\s]/.test(value) || /invit|grant|token|preview/i.test(value)) return false;
    return /^\/[a-z0-9./_-]+$/.test(value);
}

export function readPaths(value) {
    const raw = typeof value === 'string' && value.trim() ? value.trim().split(/\s+/) : OPEN_PLACE_READS;
    return raw.filter(safeReadPath);
}

export function publicPlace(source) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
    const kind = source.kind;
    if (typeof kind !== 'string' || !Object.hasOwn(KIND_LABEL, kind)) return null;
    if (source.key !== false) return null;
    if (kind === 'game') {
        if (source.locked !== true && source.locked !== false) return null;
    } else if (source.locked !== false) return null;
    if (!Number.isSafeInteger(source.count) || source.count < 1) return null;
    if (!Number.isSafeInteger(source.max) || source.max < 1 || source.count >= source.max) return null;
    let title = typeof source.title === 'string' ? source.title.trim() : '';
    if (!title) title = KIND_LABEL[kind];
    if (title.length > 40 || /[\u0000-\u001f\u007f]/.test(title)) return null;
    return { kind, title, count: source.count };
}

export function placesFromPayload(payload) {
    const lists = [];
    if (Array.isArray(payload)) lists.push(payload);
    else if (payload && typeof payload === 'object') {
        if (Array.isArray(payload.rooms)) lists.push(payload.rooms);
        if (Array.isArray(payload.tables)) lists.push(payload.tables);
    }
    const seen = new Set();
    const places = [];
    for (const list of lists) {
        for (const source of list) {
            const place = publicPlace(source);
            if (!place) continue;
            const key = `${place.kind}\n${place.title}\n${place.count}`;
            if (seen.has(key)) continue;
            seen.add(key);
            places.push(place);
            if (places.length === 8) return places;
        }
    }
    return places;
}

export async function loadOpenPlaces(fetchImpl, endpoints = OPEN_PLACE_READS) {
    const found = [];
    for (const endpoint of endpoints) {
        if (!safeReadPath(endpoint) || found.length >= 8) continue;
        try {
            const response = await fetchImpl(endpoint, {
                method: 'GET',
                credentials: 'same-origin',
                cache: 'no-store',
                redirect: 'error',
                headers: { Accept: 'application/json' }
            });
            if (!response?.ok) continue;
            const type = typeof response.headers?.get === 'function' ? response.headers.get('content-type') || '' : '';
            if (!type.includes('json')) continue;
            found.push(...placesFromPayload(await response.json()));
        } catch {
            // A missed read is the empty state, not an error to display.
        }
    }
    return found.slice(0, 8);
}

const DOOR_KIND = Object.freeze({
    art: 'draw',
    watch: 'watch',
    game: 'game-night',
    jam: 'jam',
    chat: 'hangout',
    bobross: 'draw'
});

export function hrefForPlace(place) {
    const kind = DOOR_KIND[place.kind] || 'hangout';
    if (kind === 'jam') return './?go=webjam';
    const extra = { count: place.count, via: place.kind };
    const titled = place.title ? placeHref(kind, place.title, extra) : '';
    if (titled && safeChoiceHref(titled)) return titled;
    const plain = placeHref(kind, '', extra);
    return safeChoiceHref(plain) ? plain : '';
}

export function renderPlaces(root, places, safeHref) {
    const doc = root.ownerDocument;
    const status = root.querySelector('[data-here-status]');
    const list = root.querySelector('[data-here-list]');
    if (!status || !list) return;
    list.replaceChildren();
    if (!places.length) {
        list.hidden = true;
        status.textContent = EMPTY_COPY;
        return;
    }
    status.textContent = places.length === 1 ? '1 open right now.' : `${places.length} open right now.`;
    list.hidden = false;
    for (const place of places) {
        const item = doc.createElement('li');
        const name = doc.createElement('span');
        name.className = 'here__name';
        name.textContent = place.title;
        const meta = doc.createElement('span');
        meta.className = 'here__meta';
        meta.textContent = `${place.count} here · ${KIND_LABEL[place.kind]}`;
        const href = hrefForPlace(place);
        const row = safeHref(href) ? doc.createElement('a') : doc.createElement('div');
        row.className = 'here__place';
        if (row.tagName === 'A') row.setAttribute('href', href);
        row.append(name, meta);
        item.append(row);
        list.append(item);
    }
}

export async function mountWhosHere(root, env, { load = loadOpenPlaces, safeHref = safeChoiceHref } = {}) {
    const check = safeHref;
    const endpoints = readPaths(root.getAttribute('data-reads'));
    let places = [];
    try {
        places = await load(env.fetch, endpoints);
    } catch {
        places = [];
    }
    renderPlaces(root, Array.isArray(places) ? places.slice(0, 8) : [], check);
}
