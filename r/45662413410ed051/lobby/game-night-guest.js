const status = document.querySelector('[data-guest-status]');
const invite = document.querySelector('[data-guest-invite]');
const join = document.querySelector('[data-guest-join]');
const retry = document.querySelector('[data-guest-retry]');
const gameTitle = document.querySelector('[data-guest-game]');
const restored = !location.hash && !location.search ? history.state?.gameNightInvite : null;
const code = restored?.code ?? new URLSearchParams(location.hash.slice(1)).get('invite');
const attempt = restored?.attempt ?? crypto.randomUUID().replaceAll('-', '');
const confirmedGame = typeof restored?.confirmedGame === 'string' ? restored.confirmedGame : '';
const hasInvitation = typeof code === 'string' && code.length > 0 && code.length <= 250;

function retainInvitation(confirmedGame) {
    // A refresh can use this history entry, without putting the link back in the address.
    history.replaceState({ gameNightInvite: { code, attempt, confirmedGame } }, '', location.pathname);
}

function clearInvitation() {
    history.replaceState(null, '', location.pathname);
}

if (hasInvitation) retainInvitation(confirmedGame);
else if (location.hash || location.search || restored) clearInvitation();

async function request(action, data) {
    const response = await fetch('/beta/game-night/invitation/' + action, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, ...data }),
        signal: AbortSignal.timeout(10000)
    });
    const value = await response.json();
    if (!response.ok) throw Object.assign(new Error(value.error), { status: response.status });
    return value;
}

// An expired invite cannot be retried from this page, so no button is offered.
function showExpiredInvite() {
    status.textContent = 'This invite expired. Ask your host for a new invite.';
    retry.hidden = true;
    invite.hidden = true;
    clearInvitation();
}

async function describe() {
    retry.hidden = true;
    if (!hasInvitation) {
        status.textContent = 'Open the Game Night invitation your host sent you.';
        return;
    }
    status.textContent = 'Checking…';
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
        if (error.status === 410) showExpiredInvite();
        else {
            status.textContent = 'Couldn’t check the invitation. Try again.';
            retry.hidden = false;
        }
    }
}

async function accept() {
    retry.hidden = true;
    join.disabled = true;
    status.textContent = 'Joining…';
    try {
        const { next } = await request('accept', { age13: true, attempt });
        if (next !== '/r/45662413410ed051/lobby/?game-guest=1') throw new Error('Unexpected destination');
        location.replace(next);
    } catch (error) {
        if (error.status === 410) {
            showExpiredInvite();
            return;
        }
        status.textContent = [429, 503].includes(error.status) ? error.message : 'Couldn’t join just now. Try again.';
        if (invite.hidden) {
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
