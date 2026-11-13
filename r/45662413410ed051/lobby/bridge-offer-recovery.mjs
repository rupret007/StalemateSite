// Stale offer. Imported later beside the chess panel and the expired link page.

export const ASK_HOST_TOAST = 'This game invitation no longer has an open seat. Ask the host for a fresh invitation.';
export const JOIN_AS_BLACK = 'Join as Black';
export const BLACK_OPEN = 'Black is open. Join to play.';
export const EXPIRED_SENTENCE = 'This invite can’t open the game anymore. Ask your host for a new invite.';
export const RETURN_LABEL = 'Return to room';
export const LOBBY_RETURN = '/r/45662413410ed051/lobby/';
export const GAME_GUEST_RETURN = '/r/45662413410ed051/lobby/?game-guest=1';
const RETURNS = new Set([LOBBY_RETURN, GAME_GUEST_RETURN]);

const asksHost = text => typeof text === 'string' && text.toLowerCase().includes('ask the host');

export function recoverPanel({ toast = null, action = null, status = null } = {}) {
    const offersJoin = action === JOIN_AS_BLACK;
    const hideToast = offersJoin && asksHost(toast);
    return {
        toast: hideToast ? null : toast,
        status: offersJoin ? (status || BLACK_OPEN) : status,
        actions: offersJoin ? [JOIN_AS_BLACK] : []
    };
}

export function roomReturn(returnTo) {
    return RETURNS.has(returnTo) ? returnTo : LOBBY_RETURN;
}

export function expiredLinkRecovery({ hasLobbySession = false, returnTo = LOBBY_RETURN } = {}) {
    if (hasLobbySession !== true) return { sentence: EXPIRED_SENTENCE, actions: [] };
    return {
        sentence: EXPIRED_SENTENCE,
        actions: [{ label: RETURN_LABEL, href: roomReturn(returnTo), minHeightPx: 44 }]
    };
}

export function renderRecovery(document, input) {
    const view = recoverPanel(input);
    const root = document.createElement('div');
    if (view.status) {
        const status = document.createElement('p');
        status.dataset.panelStatus = 'true';
        status.textContent = view.status;
        root.append(status);
    }
    if (view.toast) {
        const note = document.createElement('p');
        note.dataset.toast = 'true';
        note.textContent = view.toast;
        root.append(note);
    }
    for (const label of view.actions) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.style.minHeight = '44px';
        root.append(button);
    }
    return root;
}

export function renderExpiredRecovery(document, input) {
    const view = expiredLinkRecovery(input);
    const root = document.createElement('main');
    const heading = document.createElement('h1');
    const sentence = document.createElement('p');
    sentence.textContent = view.sentence;
    root.append(heading, sentence);
    const action = view.actions[0];
    if (action) {
        const link = document.createElement('a');
        link.href = action.href;
        link.textContent = action.label;
        link.className = 'btn';
        link.style.minHeight = `${action.minHeightPx}px`;
        root.append(link);
    }
    return root;
}
