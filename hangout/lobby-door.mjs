// Keeps game-night=1 when a lobby navigation cleans the address bar, and puts the
// name field and enter button back when that page says it is not open yet.

const DROP = ['preview', 'relay', 'turn', 'invite', 'grant', 'token'];

export function isLobbyNavigation(url) {
    let path;
    try {
        path = (url instanceof URL ? url : new URL(String(url))).pathname;
    } catch {
        return false;
    }
    if (path.endsWith('/index.html')) path = path.slice(0, -'/index.html'.length);
    if (path.endsWith('/')) path = path.slice(0, -1);
    return path.endsWith('/lobby');
}

export function retainLobbyGameNight(currentHref, nextHref) {
    let current;
    try {
        current = new URL(currentHref);
    } catch {
        return String(nextHref);
    }
    const hadFlag = current.searchParams.getAll('game-night').length === 1
        && current.searchParams.get('game-night') === '1';
    if (!hadFlag) return String(nextHref);
    let next;
    try {
        next = new URL(String(nextHref), current);
    } catch {
        return String(nextHref);
    }
    if (next.origin !== current.origin) return String(nextHref);
    for (const key of [...next.searchParams.keys()]) {
        if (DROP.includes(key.toLowerCase())) next.searchParams.delete(key);
    }
    next.searchParams.set('game-night', '1');
    return `${next.pathname}${next.search}${next.hash}`;
}

export function revealClosedDoor(doc, { gameNight = false } = {}) {
    const copy = doc.querySelector('[data-gate-copy]');
    const roomTitle = doc.querySelector('[data-gate-title]');
    const text = `${copy?.textContent || ''} ${roomTitle?.textContent || ''}`;
    if (!/not open yet|still building this one|isn.t open to the public/i.test(text)) return false;
    if (copy) copy.textContent = 'Pick a name and jump in.';
    if (roomTitle && /not open yet/i.test(roomTitle.textContent || '')) {
        roomTitle.textContent = gameNight ? 'Game Night' : 'Hang Out';
    }
    const heading = doc.querySelector('h1');
    if (heading && gameNight) heading.textContent = 'Game Night';
    const enter = doc.querySelector('[data-enter]');
    const nameLabel = doc.querySelector('.nickrow') || doc.querySelector('[data-name]')?.closest('label');
    if (enter) {
        enter.hidden = false;
        enter.disabled = false;
    }
    if (nameLabel) nameLabel.hidden = false;
    return true;
}

export function startLobbyDoor(doc, location, history) {
    let night = false;
    try {
        const current = new URL(location.href);
        night = current.searchParams.getAll('game-night').length === 1 && current.searchParams.get('game-night') === '1';
    } catch {
        night = false;
    }
    const native = history.replaceState.bind(history);
    if (!history.replaceState.hangoutLobbyGuarded) {
        const wrapped = (state, title, url) => {
            const next = url == null ? undefined : retainLobbyGameNight(location.href, url);
            native(state, title, next);
        };
        wrapped.hangoutLobbyGuarded = true;
        history.replaceState = wrapped;
    }
    const reveal = () => revealClosedDoor(doc, { gameNight: night });
    if (typeof queueMicrotask === 'function') queueMicrotask(reveal);
    else reveal();
}

function trustedBase(value, pageUrl) {
    let base;
    let page;
    try {
        base = new URL(String(value || ''));
        page = pageUrl instanceof URL ? pageUrl : new URL(String(pageUrl));
    } catch {
        return '';
    }
    if (base.origin !== page.origin || base.username || base.password || base.search || base.hash) return '';
    if (!base.pathname.endsWith('/hangout/')) return '';
    if (base.protocol !== 'https:' && base.protocol !== 'http:') return '';
    if (/["'<>\s]/.test(base.href)) return '';
    return base.href;
}

export function injectLobbyDoor(html, assetBase, pageUrl) {
    const base = trustedBase(assetBase, pageUrl);
    if (typeof html !== 'string' || !base || !html.includes('</head>')) return html;
    if (html.includes('hangout/lobby-door.mjs') || html.includes('name="hangout-lobby-door"')) return html;
    const tags = [
        '<meta name="hangout-lobby-door" content="keep">',
        `<script type="module" src="${base}lobby-door.mjs"></script>`
    ].join('');
    return html.replace('</head>', `${tags}</head>`);
}

if (typeof document !== 'undefined' && document.querySelector('meta[name="hangout-lobby-door"]')) {
    startLobbyDoor(document, location, history);
}
