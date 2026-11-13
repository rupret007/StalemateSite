// Last place on this device. The value is one of three names, never a URL or a token.

export const LAST_ROOM_KEY = 'hangout-last-room';
export const PLACES = Object.freeze(['hangout', 'game-night', 'webjam']);

const PLACE = new Set(PLACES);

export function rememberPlace(storage, place) {
    if (!PLACE.has(place)) return false;
    try {
        storage.setItem(LAST_ROOM_KEY, place);
        return true;
    } catch {
        return false;
    }
}

export function readPlace(storage) {
    try {
        const value = storage.getItem(LAST_ROOM_KEY);
        return PLACE.has(value) ? value : '';
    } catch {
        return '';
    }
}

export function placeFromShortcut(search, storage) {
    let go = '';
    try {
        go = new URLSearchParams(String(search || '').replace(/^\?/, '')).get('go') || '';
    } catch {
        return '';
    }
    if (go === 'last') return readPlace(storage);
    return PLACE.has(go) ? go : '';
}

export function safeChoiceHref(value) {
    if (typeof value !== 'string' || value.length < 2 || value.length > 200) return false;
    if (/[\s\\#]/.test(value) || /invite|grant|token|preview|javascript:|data:/i.test(value)) return false;
    let url;
    try {
        url = new URL(value, 'https://hangout.example/hangout/');
    } catch {
        return false;
    }
    if (url.origin !== 'https://hangout.example' || url.username || url.password || url.hash) return false;
    const keys = [...url.searchParams.keys()];
    if (keys.length > 1) return false;
    if (keys.length === 1 && !(keys[0] === 'game-night' && url.searchParams.get('game-night') === '1')) return false;
    return true;
}

export function choiceHref(doc, place) {
    if (!PLACE.has(place)) return '';
    const link = doc.querySelector(`[data-place="${place}"]`);
    const href = link?.getAttribute('href') || '';
    return safeChoiceHref(href) ? href : '';
}

export function mountShortcuts(doc, env) {
    const place = placeFromShortcut(env.search, env.storage);
    if (place) rememberPlace(env.storage, place);
    // WebJam has no invite on this page. Stay here and ask for the host's link
    // instead of opening the join page, which treats a missing link as invalid.
    if (place && place !== 'webjam') {
        const href = choiceHref(doc, place);
        if (href) {
            env.replace(href);
            return true;
        }
    }
    for (const link of doc.querySelectorAll('[data-place]')) {
        link.addEventListener('click', (event) => {
            const name = link.getAttribute('data-place');
            rememberPlace(env.storage, name);
            if (name !== 'webjam') return;
            if (event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            env.onWebjam?.();
        });
    }
    return false;
}
