const status = document.querySelector('[data-guest-status]');
const invite = document.querySelector('[data-guest-invite]');
const join = document.querySelector('[data-guest-join]');
const retry = document.querySelector('[data-guest-retry]');
const code = new URLSearchParams(location.hash.slice(1)).get('invite');
const attempt = crypto.randomUUID().replaceAll('-', '');
if (location.hash || location.search) history.replaceState(null, '', location.pathname);

async function request(action, data) {
    const response = await fetch('/beta/game-night/invitation/' + action, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, ...data }),
        signal: AbortSignal.timeout(10000)
    });
    const value = await response.json();
    if (!response.ok) throw Object.assign(new Error(value.error), { status: response.status });
    return value;
}

async function describe() {
    retry.hidden = true;
    if (!code || code.length > 250) {
        status.textContent = 'Open the Game Night invitation your host sent you.';
        return;
    }
    status.textContent = 'Checking your invitation…';
    try {
        const { game, host } = await request('details');
        const inviter = document.querySelector('[data-guest-inviter]');
        inviter.textContent = `${host} invited you to play.`;
        inviter.hidden = false;
        document.querySelector('[data-guest-game]').textContent = game;
        status.textContent = '';
        invite.hidden = false;
        if (document.activeElement === document.body) join.focus({ preventScroll: true });
    } catch (error) {
        status.textContent = error.status === 410 ? error.message : 'Couldn’t check the invitation. Try again.';
        retry.hidden = error.status === 410;
    }
}

join.addEventListener('click', async () => {
    join.disabled = true;
    status.textContent = 'Joining the game…';
    try {
        const { next } = await request('accept', { age13: true, attempt });
        if (next !== '/r/45662413410ed051/lobby/?game-guest=1') throw new Error('Unexpected destination');
        location.replace(next);
    } catch (error) {
        status.textContent = [410, 429, 503].includes(error.status) ? error.message : 'Couldn’t join just now. Try again.';
        if (error.status === 410) invite.hidden = true;
        else {
            join.disabled = false;
            if (document.activeElement === document.body) join.focus({ preventScroll: true });
        }
    }
});

retry.addEventListener('click', () => void describe());
void describe();
