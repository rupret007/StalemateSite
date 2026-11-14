import { GAME_INVITE_UNAVAILABLE } from '/r/45662413410ed051/lobby/game-night.mjs';
import { unlockGameNightAudio } from '/r/45662413410ed051/lobby/game-night-audio.mjs';

const status = document.querySelector('[data-guest-status]');
const invite = document.querySelector('[data-guest-invite]');
const join = document.querySelector('[data-guest-join]');
const retry = document.querySelector('[data-guest-retry]');
const gameTitle = document.querySelector('[data-guest-game]');
const resumeGuest = document.querySelector('[data-resume-guest]') !== null;
const passPrefix = 'gn:pass:';
const joinedInvitePrefix = 'gn:joined-invite:';
const lastTableKey = 'gn:last-table';
const tableIdPattern = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const passPattern = /^[a-f0-9]{64}$/;
const lobbyPath = '/r/45662413410ed051/lobby/?game-guest=1';
const gameDestination = tableId => lobbyPath + (typeof tableId === 'string' && tableIdPattern.test(tableId) ? '&table=' + tableId : '');
const requestedTable = resumeGuest ? new URLSearchParams(location.search).get('table') : null;
const webJam = document.querySelector('[data-webjam-guest]') !== null;
const historyKey = webJam ? 'webJamGameNightInvite' : 'gameNightInvite';
const restored = !location.hash && !location.search ? history.state?.[historyKey] : null;
const code = restored?.code ?? new URLSearchParams(location.hash.slice(1)).get(webJam ? 'grant' : 'invite');
const attempt = restored?.attempt ?? crypto.randomUUID().replaceAll('-', '');
const pass = restored?.pass ?? Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
const confirmedGame = typeof restored?.confirmedGame === 'string' ? restored.confirmedGame : '';
const hasInvitation = typeof code === 'string' && (webJam ? /^[A-Za-z0-9_-]{32,128}$/.test(code) : code.length > 0 && code.length <= 250);

async function sha256(value) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function retainInvitation(confirmedGame) {
    // A refresh can use this history entry, without putting the link back in the address.
    history.replaceState({ [historyKey]: { code, attempt, pass, confirmedGame } }, '', location.pathname);
}

function clearInvitation() {
    history.replaceState(null, '', location.pathname);
}

if (hasInvitation) retainInvitation(confirmedGame);
else if (!resumeGuest && (location.hash || location.search || restored)) clearInvitation();

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
    try {
        const tableId = localStorage.getItem(joinedInvitePrefix + await sha256(code));
        if (tableIdPattern.test(tableId || '') && passPattern.test(localStorage.getItem(passPrefix + tableId) || '')) {
            location.replace(gameDestination(tableId));
            return;
        }
    } catch { /* Browsers without local storage can return using the saved lobby address. */ }
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
        status.textContent = error.status === 410 ? GAME_INVITE_UNAVAILABLE : 'Couldn’t check the invitation. Try again.';
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
        const body = { age13: true, attempt, passHash: await sha256(pass) };
        const { next, tableId } = await request('accept', body);
        if (next !== lobbyPath) throw new Error('Unexpected destination');
        if (tableIdPattern.test(tableId || '')) {
            try {
                localStorage.setItem(passPrefix + tableId, pass);
                localStorage.setItem(joinedInvitePrefix + await sha256(code), tableId);
                localStorage.setItem(lastTableKey, tableId);
                sessionStorage.setItem(lastTableKey, tableId);
            } catch { /* The session cookie still admits the guest. */ }
        }
        clearInvitation();
        location.replace(gameDestination(tableId));
    } catch (error) {
        const tableFull = webJam && error.status === 409;
        const closed = tableFull || error.status === 410;
        status.textContent = 'Couldn’t join just now. Try again.';
        if (tableFull) status.textContent = 'This table is full. Ask your host for a new invite when a seat opens.';
        else if (closed) status.textContent = GAME_INVITE_UNAVAILABLE;
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

join.addEventListener('click', event => {
    unlockGameNightAudio(event);
    retainInvitation(gameTitle.textContent);
    void accept();
});

function showClosedInvitation() {
    status.textContent = GAME_INVITE_UNAVAILABLE;
    status.tabIndex = -1;
    status.focus({ preventScroll: true });
}

async function resume() {
    let tableId, savedPass;
    retry.hidden = true;
    try {
        tableId = requestedTable || sessionStorage.getItem(lastTableKey) || localStorage.getItem(lastTableKey);
        if (tableIdPattern.test(tableId || '')) savedPass = localStorage.getItem(passPrefix + tableId);
    } catch { /* This browser may block local storage. */ }
    if (!passPattern.test(savedPass || '')) {
        showClosedInvitation();
        return;
    }
    status.textContent = 'Connecting…';
    try {
        const response = await fetch('/beta/game-night/invitation/resume', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tableId, pass: savedPass }),
            signal: AbortSignal.timeout(10000)
        });
        if (response.status === 410) {
            showClosedInvitation();
            try {
                localStorage.removeItem(passPrefix + tableId);
                if (localStorage.getItem(lastTableKey) === tableId) localStorage.removeItem(lastTableKey);
                if (sessionStorage.getItem(lastTableKey) === tableId) sessionStorage.removeItem(lastTableKey);
            } catch { /* The rejected pass cannot authorize a session. */ }
            return;
        }
        const { next } = response.ok ? await response.json() : {};
        if (next !== lobbyPath) throw new Error('Could not resume');
        location.replace(gameDestination(tableId));
    } catch {
        status.textContent = 'Couldn’t reconnect. Try again.';
        retry.hidden = false;
        retry.focus({ preventScroll: true });
    }
}

retry.addEventListener('click', () => void (resumeGuest ? resume() : confirmedGame ? accept() : describe()));
if (resumeGuest) {
    void resume();
} else if (hasInvitation && confirmedGame) {
    // Resume only an accept attempt already confirmed by this guest.
    gameTitle.textContent = confirmedGame;
    void accept();
} else {
    void describe();
}
