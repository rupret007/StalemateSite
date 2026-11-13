const status = document.querySelector('[data-guest-status]');
const invite = document.querySelector('[data-guest-invite]');
const join = document.querySelector('[data-guest-join]');
const retry = document.querySelector('[data-guest-retry]');
const gameTitle = document.querySelector('[data-guest-game]');
const webJam = document.querySelector('[data-webjam-guest]') !== null;
const historyKey = webJam ? 'webJamGameNightInvite' : 'gameNightInvite';
const restored = !location.hash && !location.search ? history.state?.[historyKey] : null;
const code = restored?.code ?? new URLSearchParams(location.hash.slice(1)).get(webJam ? 'grant' : 'invite');
const attempt = restored?.attempt ?? crypto.randomUUID().replaceAll('-', '');
const confirmedGame = typeof restored?.confirmedGame === 'string' ? restored.confirmedGame : '';
const closedInvitation = 'This invite is no longer available. Ask your host for a new one.';
const hasInvitation = typeof code === 'string' && (webJam ? /^[A-Za-z0-9_-]{32,128}$/.test(code) : code.length > 0 && code.length <= 250);

function retainInvitation(confirmedGame) {
    // A refresh can use this history entry, without putting the link back in the address.
    history.replaceState({ [historyKey]: { code, attempt, confirmedGame } }, '', location.pathname);
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
    if (!response.ok) throw Object.assign(new Error(value.error), { status: response.status });
    return value;
}

async function describe() {
    retry.hidden = true;
    if (!hasInvitation) {
        status.textContent = 'Open the Game Night invitation your host sent you.';
        return;
    }
    if (webJam) {
        status.textContent = 'You were invited from WebJam.';
        invite.hidden = false;
        if (document.activeElement === document.body || document.activeElement === retry) join.focus({ preventScroll: true });
        return;
    }
    status.textContent = 'Checking your invitation…';
    try {
        const { game, host } = await request('details');
        const inviter = document.querySelector('[data-guest-inviter]');
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
        const { next } = await request('accept', { age13: true, attempt });
        if (next !== '/r/45662413410ed051/lobby/?game-guest=1') throw new Error('Unexpected destination');
        location.replace(next);
    } catch (error) {
        const tableFull = webJam && error.status === 409;
        const closed = tableFull || error.status === 410;
        status.textContent = 'Couldn’t join just now. Try again.';
        if (tableFull) status.textContent = 'This table is full. Ask your host for a new invite when a seat opens.';
        else if (closed) status.textContent = closedInvitation;
        else if ([429, 503].includes(error.status)) status.textContent = error.message;
        if (closed) {
            clearInvitation();
            invite.hidden = true;
            if (webJam) {
                gameTitle.tabIndex = -1;
                gameTitle.setAttribute('aria-describedby', status.id);
                gameTitle.focus();
            } else {
                status.tabIndex = -1;
                status.focus({ preventScroll: true });
            }
        } else if (invite.hidden) {
            retry.hidden = false;
            if (document.activeElement === document.body) retry.focus({ preventScroll: true });
        } else {
            join.disabled = false;
            if (document.activeElement === document.body) join.focus({ preventScroll: true });
        }
    }
}

join.addEventListener('click', () => {
    retainInvitation(gameTitle.textContent);
    void accept();
});

retry.addEventListener('click', () => void (confirmedGame ? accept() : describe()));
if (hasInvitation && confirmedGame) {
    // Resume only an accept attempt already confirmed by this guest.
    gameTitle.textContent = confirmedGame;
    void accept();
} else {
    void describe();
}
