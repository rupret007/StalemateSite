import { emptyFourSeatMemory, fourOwnGameHref, presentFourSeat } from './four-seat-presence.mjs';

const sessions = new WeakMap();

function setHidden(element, hidden) {
    if (!element || element.hidden === hidden) return;
    element.hidden = hidden;
}

function setText(element, text) {
    if (!element || element.textContent === text) return;
    element.textContent = text;
}

function setAttr(element, name, value) {
    if (!element) return;
    if (value === '' && !element.hasAttribute(name)) return;
    if (element.getAttribute(name) === value) return;
    element.setAttribute(name, value);
}

function sessionFor(root) {
    let session = sessions.get(root);
    if (!session) {
        session = { memory: emptyFourSeatMemory(), pendingSelfLeft: false, applying: false };
        sessions.set(root, session);
    }
    return session;
}

function ensureStyle(doc) {
    if (!doc.head || doc.querySelector('link[data-four-presence-style]')) return;
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('./four-seat-presence.css', import.meta.url).href;
    link.dataset.fourPresenceStyle = 'true';
    doc.head.append(link);
}

function ensurePresence(root, status) {
    const doc = root.ownerDocument;
    let presence = root.querySelector('[data-four-presence]');
    if (!presence) {
        presence = doc.createElement('p');
        presence.className = 'four-presence small';
        presence.dataset.fourPresence = '';
        presence.hidden = true;
        const dot = doc.createElement('span');
        dot.className = 'four-presence-dot';
        dot.setAttribute('aria-hidden', 'true');
        const label = doc.createElement('span');
        label.dataset.fourPresenceLabel = '';
        presence.append(dot, label);
        status?.insertAdjacentElement('afterend', presence);
    }
    return presence;
}

function ensureOwnGame(root, status) {
    const doc = root.ownerDocument;
    let own = root.querySelector('[data-four-own-game]');
    if (!own) {
        own = doc.createElement('p');
        own.dataset.fourOwnGame = '';
        own.hidden = true;
        const link = doc.createElement('a');
        link.className = 'btn btn--small';
        link.textContent = 'Start your own game';
        own.append(link);
        const info = root.querySelector('.four-info') || status?.parentElement;
        info?.append(own);
    }
    const link = own.querySelector('a');
    const href = fourOwnGameHref(doc.defaultView?.location?.search || '');
    if (link && link.getAttribute('href') !== href) link.setAttribute('href', href);
    return own;
}

function clearWaitingBoard(root) {
    root.querySelectorAll('[data-four-presence-placeholder]').forEach(node => node.remove());
}

function ensureWaitingBoard(root) {
    const columns = root.querySelector('[data-four-columns]');
    const table = root.querySelector('[data-four-table]');
    const doc = root.ownerDocument;
    if (!columns || !table) return;
    if (columns.querySelector('button:not([data-four-presence-placeholder])')) {
        clearWaitingBoard(root);
        return;
    }
    if (columns.querySelector('[data-four-presence-placeholder]')) return;
    for (let column = 0; column < 7; column += 1) {
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = 'btn btn--small btn--ghost';
        button.dataset.fourPresencePlaceholder = '';
        button.disabled = true;
        button.tabIndex = -1;
        button.setAttribute('aria-hidden', 'true');
        button.textContent = String(column + 1);
        button.setAttribute('aria-label', `Drop in column ${column + 1}, waiting`);
        columns.append(button);
    }
    const body = table.createTBody();
    body.dataset.fourPresencePlaceholder = '';
    body.setAttribute('aria-hidden', 'true');
    for (let row = 0; row < 6; row += 1) {
        const line = body.insertRow();
        for (let column = 0; column < 7; column += 1) {
            const cell = line.insertCell();
            cell.dataset.mark = '';
            cell.setAttribute('aria-label', 'Empty');
            cell.append(doc.createElement('span'));
        }
    }
}

export function applyFourSeatPresence(root) {
    if (!root) return null;
    const session = sessionFor(root);
    const status = root.querySelector('[data-four-status]');
    const leave = root.querySelector('[data-four-leave]');
    const board = root.querySelector('[data-four-board]');
    if (!status) return null;
    if (session.pendingSelfLeft) {
        session.memory.selfLeft = true;
        session.pendingSelfLeft = false;
    }
    const current = status.textContent || '';
    const lobbyStatus = current === session.memory.shown ? session.memory.authored : current;
    const view = {
        status: lobbyStatus,
        leaveLabel: leave?.textContent || '',
        leaveHidden: !leave || leave.hidden || root.hidden,
        selfLeft: session.memory.selfLeft
    };
    const result = presentFourSeat(session.memory, view);
    session.memory = result.memory;
    setText(status, result.status);
    if (result.phase === 'ready') {
        if (status.hasAttribute('data-state')) status.removeAttribute('data-state');
    } else setAttr(status, 'data-state', result.phase);

    const presence = ensurePresence(root, status);
    const label = presence.querySelector('[data-four-presence-label]');
    setHidden(presence, result.presence === '');
    setAttr(presence, 'data-presence', result.presenceLive ? 'live' : result.presence ? 'gone' : '');
    setText(label, result.presence);

    const own = ensureOwnGame(root, status);
    setHidden(own, !result.ownGame);

    const realBoard = root.querySelector('[data-four-columns] button:not([data-four-presence-placeholder])');
    if (realBoard || !result.showBoard || root.hidden) clearWaitingBoard(root);
    else ensureWaitingBoard(root);
    if (board && !root.hidden && result.showBoard && !realBoard) setHidden(board, false);
    return result;
}

export function installFourSeatPresence(doc = document) {
    const root = doc.querySelector?.('[data-four]');
    if (!root || root.dataset.fourPresenceInstalled === 'true') return false;
    root.dataset.fourPresenceInstalled = 'true';
    ensureStyle(doc);
    const leave = root.querySelector('[data-four-leave]');
    leave?.addEventListener('click', () => {
        sessionFor(root).pendingSelfLeft = true;
        sessionFor(root).memory.selfLeft = true;
    });
    const observer = new MutationObserver(() => {
        const session = sessionFor(root);
        if (session.applying) return;
        session.applying = true;
        try { applyFourSeatPresence(root); }
        finally { session.applying = false; }
    });
    observer.observe(root, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['hidden']
    });
    applyFourSeatPresence(root);
    return true;
}
