const status = document.querySelector('[data-guest-status]');
const invite = document.querySelector('[data-guest-invite]');
const join = document.querySelector('[data-guest-join]');
const retry = document.querySelector('[data-guest-retry]');
const gameTitle = document.querySelector('[data-guest-game]');
const inviter = document.querySelector('[data-guest-inviter]');
const returnToRoom = document.querySelector('[data-guest-return]');
const webJam = document.querySelector('[data-webjam-guest]') !== null;
const historyKey = webJam ? 'webJamGameNightInvite' : 'gameNightInvite';
const restored = !location.hash && !location.search ? history.state?.[historyKey] : null;
const fragment = new URLSearchParams(location.hash.slice(1));
const code = restored?.code ?? fragment.get(webJam ? 'grant' : 'invite');
// Only WebJam's pre-reservation offer requests waiting. A refresh keeps the original deadline.
let waitUntil = webJam ? restored?.waitUntil ?? (fragment.get('wait') === '1' ? -1 : 0) : 0;
const attempt = restored?.attempt ?? crypto.randomUUID().replaceAll('-', '');
const confirmedGame = typeof restored?.confirmedGame === 'string' ? restored.confirmedGame : '';
const closedInvitation = 'This invite is no longer available. Ask your host for a new one.';
const hasInvitation = typeof code === 'string' && (webJam ? /^[A-Za-z0-9_-]{32,128}$/.test(code) : code.length > 0 && code.length <= 250);

function retainInvitation(confirmedGame) {
    // A refresh can use this history entry, without putting the link back in the address.
    history.replaceState({ [historyKey]: { code, attempt, confirmedGame, waitUntil } }, '', location.pathname);
}

function clearInvitation() {
    history.replaceState(null, '', location.pathname);
}

if (hasInvitation) retainInvitation(confirmedGame);
else if (location.hash || location.search || restored) clearInvitation();

async function request(action, data) {
    const path = webJam ? '/beta/game-night/room-grant/redeem' : '/beta/game-night/invitation/' + action;
    const body = webJam ? { value: code, ...data } : { code, ...data };
    const response = await fetch(path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000)
    });
    const value = await response.json();
    if (!response.ok) throw Object.assign(new Error(value.error), { status: response.status, tableFull: value.tableFull === true });
    return value;
}

async function acceptInvitation() {
    const body = { age13: true, attempt };
    let retriedConnection = false;
    for (;;) {
        try { return await request('accept', body); }
        catch (error) {
            if (webJam && !retriedConnection && error.status === undefined) {
                retriedConnection = true;
                status.textContent = 'Reconnecting to confirm your seat…';
                continue;
            }
            const remaining = waitUntil - Date.now();
            if (!webJam || error.status !== 410 || remaining <= 0) throw error;
            join.textContent = 'Waiting for host…';
            status.textContent = 'Waiting for your host to reserve your Chess seat…';
            await new Promise(resolve => setTimeout(resolve, Math.min(2000, remaining)));
        }
    }
}

async function describe() {
    retry.hidden = true;
    if (!hasInvitation) {
        status.textContent = 'Open the Game Night invitation your host sent you.';
        if (returnToRoom) returnToRoom.hidden = false;
        return;
    }
    if (webJam) {
        if (waitUntil !== 0) gameTitle.textContent = 'Royal Flush Chess';
        status.textContent = 'You were invited from WebJam.';
        invite.hidden = false;
        if (document.activeElement === document.body || document.activeElement === retry) join.focus({ preventScroll: true });
        return;
    }
    status.textContent = 'Checking your invitation…';
    try {
        const { game, host } = await request('details');
        inviter.textContent = `${host} invited you to play.`;
        inviter.hidden = false;
        gameTitle.textContent = game;
        status.textContent = '';
        invite.hidden = false;
        if (document.activeElement === document.body) join.focus({ preventScroll: true });
    } catch (error) {
        status.textContent = error.status === 410 ? closedInvitation : 'Couldn’t check the invitation. Try again.';
        retry.hidden = error.status === 410;
        if (error.status === 410) {
            clearInvitation();
            status.tabIndex = -1;
            status.focus({ preventScroll: true });
        }
    }
}

async function accept() {
    retry.hidden = true;
    join.disabled = true;
    status.textContent = 'Joining the game…';
    try {
        const { next } = await acceptInvitation();
        if (next !== '/r/45662413410ed051/lobby/?game-guest=1') throw new Error('Unexpected destination');
        if (webJam) clearInvitation();
        location.replace(next);
    } catch (error) {
        const tableFull = webJam && error.status === 409 && error.tableFull;
        const closed = tableFull || error.status === 410;
        status.textContent = 'Couldn’t join just now. Try again.';
        if (tableFull) status.textContent = returnToRoom ? 'This table is full. Return to your room for the next game.'
            : 'This table is full. Ask your host for a new invite when a seat opens.';
        else if (closed) status.textContent = webJam && waitUntil > 0
            ? 'Your Chess seat wasn’t confirmed. Ask your host for a new WebJam invite.' : closedInvitation;
        else if ([429, 503].includes(error.status)) status.textContent = error.message;
        if (closed) {
            clearInvitation();
            invite.hidden = true;
            if (returnToRoom) returnToRoom.hidden = false;
            if (webJam) {
                gameTitle.tabIndex = -1;
                gameTitle.setAttribute('aria-describedby', status.id);
                gameTitle.focus({ preventScroll: true });
            } else {
                status.tabIndex = -1;
                status.focus({ preventScroll: true });
            }
        } else if (invite.hidden) {
            retry.hidden = false;
            if (document.activeElement === document.body) retry.focus({ preventScroll: true });
        } else {
            join.disabled = false;
            join.textContent = 'Join game';
            if (document.activeElement === document.body) join.focus({ preventScroll: true });
        }
    }
}

join.addEventListener('click', () => {
    if (waitUntil === -1) waitUntil = Date.now() + 25_000;
    retainInvitation(gameTitle.textContent);
    void accept();
});

retry.addEventListener('click', () => void (confirmedGame ? accept() : describe()));
if (hasInvitation && confirmedGame) {
    // Resume only an accept attempt already confirmed by this guest.
    gameTitle.textContent = confirmedGame;
    if (webJam) invite.hidden = false;
    void accept();
} else {
    void describe();
}
