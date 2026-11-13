// Invitation-only real visitor beta. Never imports the pilot's role selector or synthetic emails.
import worker, { HangoutLobby, HangoutRoom, HangoutQuota, HangoutTurnBudget } from './index.mjs';
import { accountId, accessConfigured, hmacKeyOk, ipHash, newDeviceId, signDevice, verifyDevice } from './auth.mjs';
import { adminGate, ownerGate } from './lobby-do.mjs';
import { previewKeyOk } from './core.mjs';
import { BETA_TTL, BETA_COOKIE, BETA_IDENTITY_COOKIE, GAME_GUEST_COOKIE, BetaSessionUnavailable, equalInvite, signBeta, readBeta, betaCookie, betaSession, readBetaBody } from './beta-auth.mjs';
import { registryRequest } from './beta-session-client.mjs';
import { betaHealth } from './beta-ops.mjs';
import { entrySitesFromConfig } from '../../r/45662413410ed051/entry-sites.mjs';
import { gameNightLabels } from '../../r/45662413410ed051/lobby/game-night.mjs';
import { lobbyParticipationMode, participationConfigurationValid } from './lobby-participation.mjs';
import { incidentSourceConfigurationValid } from './lobby-incident-sources.mjs';
import { publicBetaHelp } from './beta-public-help.mjs';
import { arcadeEnabled, arcadeGame, arcadePath, arcadeRoomRequest } from './arcade-transport.mjs';
import { mediaEnabled, mediaPath } from './game-night-media.mjs';
import { GAME_GUEST_PATH, GAME_INVITATION_PATH, gameGuestEnabled, gameGuestScope, gameGuestSessionRef } from './game-night-invitations.mjs';
export { BetaSessions } from './beta-sessions.mjs';
export { HangoutLobby, HangoutRoom, HangoutQuota, HangoutTurnBudget };

const ROOT = '/r/45662413410ed051/';
const LOBBY_PAGE = `${ROOT}lobby/`;
const GAME_GUEST_QUERY = '?game-guest=1';
const CSP = "default-src 'self'; script-src 'self' https://challenges.cloudflare.com https://www.youtube.com https://www.gstatic.com; style-src 'self' 'unsafe-inline'; frame-src https://challenges.cloudflare.com https://www.youtube.com https://www.youtube-nocookie.com; connect-src 'self' wss: https://challenges.cloudflare.com https://www.youtube.com https://*.googlevideo.com; img-src 'self' data: blob: https://i.ytimg.com; media-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const WEB_JOIN_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' https://webjam-turn-credentials.jeffstory007.workers.dev; media-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const READ_ONLY_PAGE = {
    'Content-Security-Policy': "default-src 'none'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'Permissions-Policy': 'camera=(), geolocation=(), microphone=()',
};
const LOBBY_ENTRANCE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Private invitation required · Hang Out</title>
<link rel="stylesheet" href="/beta/style.css">
</head>
<body>
<main>
<h1>Enter Hang Out</h1>
<p>Use your private invitation to enter the community or return to a saved lobby bookmark.</p>
<p><a class="button" href="/beta/">Enter invitation</a></p>
<p>Camera and microphone stay off.</p>
</main>
</body>
</html>`;
const invitationForm = label => `<form id="unlock"><div class="invitation-field"><label>Invitation code<input id="code" type="password" autocomplete="off" required></label><p id="code-error"></p></div><button>${label}</button></form>`;
const MUSIC_RETURN_ENTRANCE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Return to Hang Out · WebJam</title>
<link rel="stylesheet" href="/beta/style.css">
</head>
<body>
<main>
<h1>Open Hang Out first</h1>
<p>This browser profile isn’t signed in to the private beta.</p>
<p>Choose <strong>End browser invite</strong> in WebJam. Open Hang Out in this browser profile, enter your private invitation, then send a fresh Music invite from your Jam room.</p>
<p><a class="button" href="/beta/">Open Hang Out</a></p>
</main>
</body>
</html>`;
const WEB_JOIN_ENTRANCE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Enter Hang Out to join WebJam</title>
<link rel="stylesheet" href="/beta/style.css">
<script type="module" src="/beta/client.js"></script>
</head>
<body data-web-join-entry>
<main>
<h1>Join WebJam</h1>
<p class="lede">Enter your Hang Out invitation code to continue to the audio check.</p>
<p id="status" role="status">Checking your invitation…</p>
<button id="retry" type="button" hidden>Try again</button>
<section id="login" aria-label="Private invitation" hidden>
${invitationForm('Continue to audio check')}
</section>
</main>
</body>
</html>`;
const WEB_JOIN_UNAVAILABLE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Browser audio is unavailable · WebJam</title>
<link rel="stylesheet" href="/beta/style.css">
</head>
<body>
<main>
<h1>Browser audio is unavailable</h1>
<p>Browser audio is turned off for this private beta. You can still use Hang Out.</p>
<p><a class="button" href="${ROOT}lobby/">Return to Hang Out</a></p>
</main>
</body>
</html>`;
const GAME_GUEST_ENTRANCE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Game Night invitation</title><link rel="stylesheet" href="/beta/style.css"><script type="module" src="${GAME_GUEST_PATH}.js"></script></head>
<body><main class="game-invitation"><p class="eyebrow">PRIVATE GAME NIGHT</p><h1 data-guest-game>Game Night</h1>
<p class="lede" data-guest-inviter hidden></p><p data-guest-status role="status">Checking your invitation…</p>
<section data-guest-invite aria-label="Accept the invitation" hidden>
<p id="guest-agreement">By joining, you confirm you’re 13+ and agree to the house rules.</p>
<button type="button" aria-describedby="guest-agreement" data-guest-join>Join game</button>
<p class="muted">Camera and microphone stay off. <a href="/beta/privacy" target="_blank" rel="noopener">Read the house rules</a></p>
</section><button type="button" data-guest-retry hidden>Try again</button></main></body></html>`;
const GAME_GUEST_STYLE = `
.game-invitation h1 { font-size: clamp(2.6rem, 9vw, 4.5rem); }
.game-invitation section { max-width: 32rem; }
.game-invitation section p:first-child { margin-top: 0; }
.game-invitation section p:last-child { margin-bottom: 0; }
.game-invitation [data-guest-join] { width: 100%; min-height: 48px; }
.game-invitation [data-guest-status]:empty { display: none; }
`;
const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': CSP };
const reply = (body, status = 200, type = 'text/plain; charset=utf-8', extra = {}) => new Response(body, { status, headers: { ...headers, 'Content-Type': type, ...extra } });
const json = (body, status = 200, extra = {}) => reply(JSON.stringify(body), status, 'application/json; charset=utf-8', extra);
const redirect = (where, extra = {}) => reply(null, 303, 'text/plain', { Location: where, ...extra });
const sameOrigin = (request) => request.headers.get('Origin') === new URL(request.url).origin;
export function betaConfigured(env) {
    return participationConfigurationValid(env) && incidentSourceConfigurationValid(env) && env.HANGOUT_BETA_MODE === 'protected' && hmacKeyOk(env.HANGOUT_HMAC_KEY) && hmacKeyOk(env.HANGOUT_BETA_INVITE_KEY) &&
        previewKeyOk(env.HANGOUT_PREVIEW_KEY, env.HANGOUT_PREVIEW_KEY) && env.ASSETS && env.LOBBY && env.QUOTA && env.ROOMS
        && (!env.HANGOUT_SESSION_AUTHORITY ? env.BETA_SESSIONS : env.HANGOUT_SESSION_AUTHORITY === 'lobby-v1');
}
export function betaAccessConfigured(env) {
    return accessConfigured(env) && accessConfigured({ ...env, HANGOUT_ACCESS_AUD: env.HANGOUT_OWNER_ACCESS_AUD }) && env.HANGOUT_ACCESS_AUD !== env.HANGOUT_OWNER_ACCESS_AUD;
}

const SHELL = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Stalemate · Private community beta</title><link rel="stylesheet" href="/beta/style.css"><script defer src="/beta/client.js"></script></head><body><main><p class="eyebrow">STALEMATE / INVITATION ONLY</p><h1>Hang Out<span aria-hidden="true">_</span></h1><p class="lede">Pick a nick. Find your people.<br>Make something together.</p><p id="status" role="status">Checking your invitation…</p><div class="recovery-actions"><button id="retry" type="button" hidden>Try again</button><button id="retry-leave" type="button" hidden>Retry leaving</button></div><section id="login" hidden><h2>Your private invitation</h2><p>Open the invitation you received, or enter its code here.</p>${invitationForm('Enter the community ↗')}</section><section id="inside" hidden><h2>You’re on the guest list.</h2><p id="identity"></p><a class="button" href="${ROOT}lobby/">Choose a nickname and join ↗</a><p id="band-games" hidden><a id="band-game-night" class="button secondary" href="${ROOT}lobby/">Enter Game Night ↗</a></p><div class="options"><a id="owner" href="/lobby-owner/login">Verify your email to keep a room</a><a id="staff" href="/lobby-admin/login">Moderator sign-in</a><a id="moderation" href="${ROOT}admin/" hidden>Open moderation panel</a></div><p class="muted">Guest chat needs no account. Email verification is optional and lets you recover your registered rooms on another device. Staff permissions are granted separately.</p><form id="logout"><button class="secondary">Leave this beta</button></form></section><aside><h2>A little field guide</h2><ol><li>Say hello in #stalemate. Chat starts when you join; there’s no earlier backlog.</li><li>Start your own channel, shared canvas, watch room, or WebJam room.</li><li>Use Host tools → Keep this room after verifying your email to reserve its name.</li><li>Report abusive messages from their message menu. Hosts manage their rooms; community moderators review reports.</li></ol><a href="/beta/privacy">House rules, data handling &amp; contact</a></aside><p class="muted">Private beta. Cameras stay off until you choose them. Email sign-in uses Cloudflare Access.</p></main></body></html>`;
const STYLE = `:root{color-scheme:dark;font:16px/1.6 system-ui,sans-serif;background:#101414;color:#eeeeda}*{box-sizing:border-box}body{margin:0;padding:32px 20px}main{max-width:680px;margin:auto}h1{font-size:clamp(3rem,12vw,5rem);line-height:1;letter-spacing:-.06em;margin:24px 0}h1 span,a,.eyebrow{color:#d1fa78}h2{font-size:1.35rem;line-height:1.3}p,li{overflow-wrap:anywhere}.eyebrow{font:11px/1.5 ui-monospace,monospace;letter-spacing:.08em}.lede{font-size:1.3rem}section,aside{padding:24px;border:1px solid #343d36;margin:24px 0;background:#171d1a}[hidden]{display:none!important}label{display:block;font-size:14px}input{display:block;width:100%;min-width:0;font:16px/1.5 ui-monospace,monospace;padding:12px;margin:8px 0 16px;background:#101414;color:inherit;border:1px solid #65725d}.button,button{display:inline-flex;justify-content:center;align-items:center;min-height:46px;max-width:100%;padding:12px 18px;font:600 16px/1.4 ui-monospace,monospace;border:1px solid #d1fa78;background:#d1fa78;color:#142014;text-decoration:none;cursor:pointer}.recovery-actions{display:flex;flex-wrap:wrap;gap:12px}button:disabled{opacity:.65;cursor:wait}.secondary{background:none;border-color:#65725d;color:inherit;font-size:16px}.options{display:flex;flex-wrap:wrap;gap:12px 20px;margin:24px 0;font-size:14px}.muted{font-size:13px;color:#a1aaa2}ol{padding-left:20px}li{padding-bottom:10px}a:focus-visible,button:focus-visible,input:focus-visible{outline:2px solid #d1fa78;outline-offset:4px}#status{color:#e5c181;font:12px/1.6 ui-monospace,monospace}@media(max-width:480px){body{padding:24px 16px}section,aside{padding:20px}.options{flex-direction:column}.button{width:100%}}`;
const CLIENT = `import * as entrance from '/beta/entry-sites.mjs';
const { createEntrySiteRegistry, entrySourceFromParams, ENTRY_HANDOFF_KEY, entryHandoff, GAME_NIGHT_QUERY, gameNightEntry, gameNightFragment } = entrance;
const entrySites = createEntrySiteRegistry(__ENTRY_SITES__);
const $ = s => document.querySelector(s);
const webJoinEntry = document.body.hasAttribute('data-web-join-entry');
const inside = $('#inside'), logout = $('#logout'), retryLeave = $('#retry-leave');
const code = $('#code'), codeError = $('#code-error'), retry = $('#retry');
if (!webJoinEntry) {
    const params = new URLSearchParams(location.search);
    const source = entrySourceFromParams(params, entrySites);
    const game = gameNightEntry?.(params, location.hash);
    const rememberEntry = () => { try { sessionStorage.setItem(ENTRY_HANDOFF_KEY, entryHandoff(source, true, Date.now(), entrySites)); } catch { /* Entrance memory is optional. */ } };
    const lobby = $('#inside .button');
    lobby.href = '${ROOT}lobby/?entry-return=1' + (game ? '&' + GAME_NIGHT_QUERY + (game.table ? '&table=' + encodeURIComponent(game.table) : '') + (game.prepareShare ? '&deliver=share' : '') + gameNightFragment(game.target) : '');
    if (game) {
        lobby.textContent = 'Enter Game Night ↗';
        $('.lede').textContent = 'Play and chat with friends in a private Game Night room.';
    }
    $('#owner').href = '/lobby-owner/login?entry-return=1';
    lobby.addEventListener('click', rememberEntry);
    if (__GAME_NIGHT_OPEN__ && GAME_NIGHT_QUERY && !game && !params.has('game-night') &&
        (source === 'rad-dad' || source === 'stalemate')) {
        const arcade = $('#band-game-night');
        arcade.href = '${ROOT}lobby/?entry-return=1&' + GAME_NIGHT_QUERY;
        arcade.addEventListener('click', rememberEntry);
        $('#band-games').hidden = false;
    }
    $('#owner').addEventListener('click', rememberEntry);
}
let currentAttempt = null, operation = '', leavingUnconfirmed = false;
const unavailable = 'Community access is temporarily unavailable. Try again when you are ready.';
function render(phase, message, identity) {
    $('#status').textContent = message;
    $('#login').hidden = phase !== 'invitation' && !(webJoinEntry && operation === 'unlock');
    if (inside) inside.hidden = phase !== 'ready';
    $('#retry').hidden = phase !== 'unavailable' && phase !== 'denied';
    if (retryLeave) retryLeave.hidden = phase !== 'leave-unconfirmed';
    const busy = operation !== '';
    for (const element of document.querySelectorAll('#unlock button, #logout button, #retry, #retry-leave, #code')) element.disabled = busy;
    $('#unlock').setAttribute('aria-busy', String(operation === 'unlock'));
    logout?.setAttribute('aria-busy', String(operation === 'logout'));
    if (phase !== 'ready') return;
    code.value = '';
    if (webJoinEntry) { location.reload(); return; }
    const roles = { owner: 'owner', band: 'band', moderator: 'moderator' };
    $('#identity').textContent = identity.kind === 'staff' ? 'Signed in as ' + roles[identity.role] + '.'
        : identity.kind === 'owner' ? 'Email verified. You can keep and recover rooms.' : 'Join as a guest with just a nickname.';
    $('#staff').hidden = !identity.staffConfigured;
    $('#moderation').hidden = identity.kind !== 'staff';
    $('#owner').hidden = !identity.emailConfigured || identity.kind === 'owner';
}
function begin(kind) {
    // A queued logout can supersede an outstanding read. All duplicate actions
    // and other overlaps stay disabled; the opaque attempt also fences late data.
    if (operation && !(kind === 'logout' && operation === 'check')) return null;
    const attempt = currentAttempt = {};
    operation = kind;
    render('loading', kind === 'logout' ? 'Leaving this beta…' : kind === 'unlock' ? 'Checking your invitation…' : 'Checking community access…');
    return attempt;
}
function finish(attempt, phase, message, identity) {
    if (attempt !== currentAttempt) return;
    const retryCode = operation === 'unlock' && phase === 'invitation';
    operation = '';
    render(phase, retryCode && codeError ? '' : message, identity);
    if (retryCode) {
        if (codeError) codeError.textContent = message;
        code.setAttribute('aria-invalid', 'true');
        code.setAttribute('aria-describedby', codeError ? 'code-error' : 'status');
        code.focus({ preventScroll: Boolean(codeError) });
        codeError?.parentElement.scrollIntoView?.({ block: 'center' });
    }
}
function clearCodeError() {
    code.removeAttribute('aria-invalid');
    code.removeAttribute('aria-describedby');
    if (codeError) codeError.textContent = '';
}
async function accessRequest(path, options = {}) {
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((resolve, reject) => {
        timer = setTimeout(() => { reject(new Error('community-request-timeout')); controller.abort(); }, 10000);
    });
    try {
        // Bound headers AND body consumption. The race also fences a late
        // response if a transport does not settle when its signal is aborted.
        return await Promise.race([(async () => {
            const response = await fetch(path, { ...options, signal: controller.signal });
            let value;
            if (response.ok) { try { value = await response.json(); } catch { /* Invalid JSON cannot confirm access or leaving. */ } }
            return { ok: response.ok, status: response.status, value };
        })(), timeout]);
    } finally { clearTimeout(timer); }
}
async function post(path, body) {
    const response = await accessRequest(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { ok: response.ok && response.value?.ok === true, status: response.status };
}
function validState(value) {
    return value && !Array.isArray(value) && ['guest', 'owner', 'staff'].includes(value.kind)
        && typeof value.emailConfigured === 'boolean' && typeof value.staffConfigured === 'boolean'
        && (value.kind !== 'staff' || ['owner', 'band', 'moderator'].includes(value.role));
}
async function draw({ refocusInvitation = false } = {}) {
    if (leavingUnconfirmed) return;
    const attempt = begin('check');
    if (!attempt) return;
    try {
        const response = await accessRequest('/beta/state');
        if (attempt !== currentAttempt) return;
        if (response.status === 401) {
            finish(attempt, 'invitation', 'A private invitation is required.');
            if (refocusInvitation && [document.body, retry].includes(document.activeElement)) code.focus();
            return;
        }
        if (response.status === 403) return finish(attempt, 'denied', 'Access was denied. Check the house rules or contact the community owner.');
        if (!response.ok) return finish(attempt, 'unavailable', unavailable);
        const identity = response.value;
        if (attempt !== currentAttempt) return;
        if (!validState(identity)) return finish(attempt, 'unavailable', unavailable);
        finish(attempt, 'ready', 'Invitation accepted.', identity);
    } catch { finish(attempt, 'unavailable', unavailable); }
}
async function unlock(key) {
    if (leavingUnconfirmed) return;
    const attempt = begin('unlock');
    if (!attempt) return;
    clearCodeError();
    try {
        const result = await post('/beta/unlock', { key });
        if (attempt !== currentAttempt) return;
        if (!result.ok) return finish(attempt, result.status === 401 || result.status === 403 ? 'invitation' : 'unavailable',
            result.status === 401 || result.status === 403 ? 'The invitation was not accepted. Check the code or the house rules before trying again.' : unavailable);
        code.value = '';
        operation = '';
        await draw();
    } catch { finish(attempt, 'unavailable', unavailable); }
}
async function leave() {
    const attempt = begin('logout');
    if (!attempt) return;
    leavingUnconfirmed = true;
    try {
        const result = await post('/beta/logout', {});
        if (attempt !== currentAttempt) return;
        if (!result.ok) return finish(attempt, 'leave-unconfirmed', 'Leaving was not confirmed. Connections may still be closing. Choose Retry leaving.');
        for (const key of ['hangout-owner', 'hangout-preview', ENTRY_HANDOFF_KEY]) {
            try { sessionStorage.removeItem(key); } catch { /* Confirmed server logout does not depend on optional hints. */ }
        }
        leavingUnconfirmed = false;
        operation = '';
        await draw();
    } catch { finish(attempt, 'leave-unconfirmed', 'Leaving was not confirmed. Connections may still be closing. Choose Retry leaving.'); }
}
code.addEventListener('input', () => {
    if (!code.hasAttribute('aria-invalid')) return;
    clearCodeError();
    if (!codeError) $('#status').textContent = '';
});
$('#unlock').addEventListener('submit', event => { event.preventDefault(); unlock(code.value); });
logout?.addEventListener('submit', event => { event.preventDefault(); leave(); });
retry.addEventListener('click', () => draw({ refocusInvitation: true }));
retryLeave?.addEventListener('click', leave);
if (webJoinEntry) {
    // The music capability belongs to the audio client. Leave it in the tab's
    // fragment and reload only after the admission cookie passes /beta/state.
    draw();
} else {
    const key = new URLSearchParams(location.hash.slice(1)).get('invite');
    if (location.hash || location.search) history.replaceState(null, '', location.pathname);
    if (key) {
        // Keep the code in this tab so a guest can resubmit after an outage.
        code.value = key;
        unlock(key);
    } else draw();
}`;

async function disconnect(env, session) {
    let result;
    try { result = await registryRequest(env, 'revoke', { sid: session.access.sid, exp: session.access.exp, version: session.access.version }); }
    catch { throw new BetaSessionUnavailable('Your current session could not be revoked. Please try again.'); }
    if (!result.ok) throw new BetaSessionUnavailable('Your session is revoked, but some connections could not be closed. A retry is queued; please try again.');
}
async function newAccess(env, { exp = Date.now() + BETA_TTL, ip = '0.0.0.0', profile = null, gameGuest, sid = crypto.randomUUID() } = {}) {
    const access = { v: 1, sid, exp, scope: gameGuest ? 'game-night' : 'guest', version: String(env.HANGOUT_BETA_INVITE_VERSION || '1'), ...(gameGuest ? { gameGuest } : {}) };
    let result;
    try { result = await registryRequest(env, 'register', { sid: access.sid, exp: access.exp, version: access.version, iph: await ipHash(ip, env.HANGOUT_HMAC_KEY),
        ...(env.HANGOUT_SESSION_AUTHORITY === 'lobby-v1' ? { profile } : {}) }); }
    catch { throw new BetaSessionUnavailable('The community session service is temporarily unavailable.'); }
    if (gameGuest && result.status === 409) result = await registryRequest(env, 'check', { sid, exp, version: access.version });
    if (result.status !== 200) throw new BetaSessionUnavailable(result.status === 429 ? 'The beta session allowance is full. Please try again later.' : 'The community session service is temporarily unavailable.', result.status === 429 ? 429 : 503);
    return { access, cookie: betaCookie(gameGuest ? GAME_GUEST_COOKIE : BETA_COOKIE, await signBeta('access', access, env.HANGOUT_HMAC_KEY), exp - Date.now()) };
}

async function gameInvitation(request, env, path, body) {
    if (path === 'leave') {
        const session = await betaSession(request, env, Date.now(), { gameGuest: true, allowRevoked: true });
        if (session && body.sessionRef === await gameGuestSessionRef(session.access.sid)) await disconnect(env, session);
        return json({ ok: true });
    }
    if (!gameGuestEnabled(env) || !['issue', 'details', 'accept'].includes(path)) return json({ error: 'Game invitations are unavailable.' }, 404);
    const session = path === 'issue' ? await betaSession(request, env) : null;
    if (path === 'issue' && !session) return json({ error: 'Private invitation required.' }, 401);
    if (path !== 'issue') {
        const invitation = await readBeta('game-invitation', body.code, env.HANGOUT_HMAC_KEY);
        if (!invitation) return json({ error: 'This invitation is invalid or has expired. Ask your host for a new invite.' }, 410);
        body = { ...body, code: invitation.sid };
    }
    const response = await env.LOBBY.get(env.LOBBY.idFromName('stalemate')).fetch(`https://lobby${GAME_INVITATION_PATH}/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body, session: session && { betaSid: session.access.sid } })
    });
    const data = await response.json().catch(() => ({ error: 'Game invitations are temporarily unavailable.' }));
    if (path === 'issue' && response.ok) return json({ code: await signBeta('game-invitation', { v: 1, sid: data.code, exp: data.until }, env.HANGOUT_HMAC_KEY) });
    if (path !== 'accept' || !response.ok) return json(data, response.status);
    const scope = gameGuestScope(data.scope);
    if (!scope) return json({ error: 'This invitation could not be confirmed.' }, 503);
    const { cookie } = await newAccess(env, { gameGuest: scope, sid: data.sid, exp: data.exp, ip: request.headers.get('CF-Connecting-IP') || '0.0.0.0' });
    return json({ next: `${LOBBY_PAGE}${GAME_GUEST_QUERY}` }, 200, { 'Set-Cookie': cookie });
}

function gameGuestAsset(path) {
    return path.startsWith(`${ROOT}lobby/`) && /\.(?:js|mjs|css)$/.test(path)
        || path.startsWith(ROOT) && /^[-a-z.]+\.(?:js|mjs|webp)$/.test(path.slice(ROOT.length))
        || path.startsWith('/play/games/') || path.startsWith('/play/assets/') || path.startsWith('/assets/');
}
async function checkTurnstile(request, env, url, deps) {
    if (!env.HANGOUT_TURNSTILE_SITEKEY) return true;
    if (!env.HANGOUT_TURNSTILE_SECRET) return false;
    const token = url.searchParams.get('ts');
    if (!token || token.length > 2048) return false;
    try {
        const body = new FormData(); body.set('secret', env.HANGOUT_TURNSTILE_SECRET); body.set('response', token); body.set('remoteip', request.headers.get('CF-Connecting-IP') || '0.0.0.0');
        const result = await (deps.fetch || fetch)('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body, signal: AbortSignal.timeout(8000) });
        const verdict = await result.json();
        return result.ok && verdict.success === true && verdict.hostname === new URL(request.url).hostname;
    } catch { return false; }
}

async function betaRequest(request, env, deps = {}) {
    const url = new URL(request.url);
    const help = await publicBetaHelp(request, env);
    if (help) return help;
    let assetPath;
    try { assetPath = new URL(url.origin + decodeURIComponent(url.pathname)).pathname; }
    catch { return reply('Invalid path.', 400); }
    if (url.pathname === '/robots.txt') return reply('User-agent: *\nDisallow: /\n');
    if (url.pathname === '/beta/health') return betaHealth(request, env, { betaConfigured: !!betaConfigured(env), accessConfigured: betaAccessConfigured(env) });
    if (!betaConfigured(env)) return reply('Private community beta is not configured.', 503);
    if (['/', '/beta', '/beta/'].includes(url.pathname)) return reply(SHELL
        .replace('Stalemate · Private community beta', 'Hang Out · Private community beta')
        .replace('STALEMATE / INVITATION ONLY', 'HANG OUT / INVITATION ONLY')
        .replace('<script defer src="/beta/client.js">', '<script type="module" src="/beta/client.js">'), 200, 'text/html; charset=utf-8');
    if (url.pathname === '/beta/style.css') return reply(STYLE + GAME_GUEST_STYLE +
        '#code-error{color:#e5c181;font-size:.875rem;margin:-4px 0 12px}#code-error:empty{display:none}', 200, 'text/css');
    if (url.pathname === GAME_GUEST_PATH || url.pathname === GAME_GUEST_PATH + '.js') {
        if (!gameGuestEnabled(env) || !['GET', 'HEAD'].includes(request.method)) return reply('Game invitations are unavailable.', 404);
        if (url.pathname === GAME_GUEST_PATH) return reply(request.method === 'HEAD' ? null : GAME_GUEST_ENTRANCE, 200, 'text/html; charset=utf-8');
        const asset = await env.ASSETS.fetch(new Request(`${url.origin}${LOBBY_PAGE}game-night-guest.js`));
        return reply(request.method === 'HEAD' ? null : asset.body, asset.status, 'text/javascript');
    }
    if (url.pathname === '/beta/client.js') return reply(CLIENT
        .replace('__GAME_NIGHT_OPEN__', () => String(env.HANGOUT_OPEN !== '0'))
        .replace('__ENTRY_SITES__', () => JSON.stringify(Object.values(entrySitesFromConfig(env.HANGOUT_ENTRY_SITES)))), 200, 'text/javascript');
    if (url.pathname === '/beta/entry-sites.mjs') {
        // Only this public, credential-free display registry is available before
        // invitation admission. Other collaboration assets remain protected.
        const asset = await env.ASSETS.fetch(new Request(`${url.origin}${ROOT}entry-sites.mjs`));
        return reply(asset.body, asset.status, 'text/javascript');
    }
    if (request.method === 'POST' && url.pathname.startsWith('/beta/') && !arcadePath(url.pathname) && !mediaPath(url.pathname)) {
        if (!sameOrigin(request) || !/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || '')) return json({ error: 'Same-origin JSON request required.' }, 403);
        if (Number(request.headers.get('Content-Length') || 0) > 2048) return json({ error: 'Request too large.' }, 413);
        const body = await readBetaBody(request);
        if (!body) return json({ error: 'Invalid or oversized request.' }, 400);
        if (url.pathname.startsWith(GAME_INVITATION_PATH + '/')) return gameInvitation(request, env, url.pathname.slice(GAME_INVITATION_PATH.length + 1), body);
        if (url.pathname === '/beta/unlock') {
            if (!equalInvite(body.key, env.HANGOUT_BETA_INVITE_KEY)) return json({ error: 'Invitation was not accepted.' }, 403);
            const previous = await betaSession(request, env, Date.now(), { allowRevoked: true });
            if (previous && !previous.revoked) return json({ ok: true });
            if (previous) await disconnect(env, previous);
            return json({ ok: true }, 200, { 'Set-Cookie': (await newAccess(env, { ip: request.headers.get('CF-Connecting-IP') || '0.0.0.0' })).cookie });
        }
        const session = await betaSession(request, env, Date.now(), { allowRevoked: url.pathname === '/beta/logout' });
        if (!session) return json({ error: 'Private invitation required.' }, 401);
        if (url.pathname === '/beta/participation/stop') {
            if (!lobbyParticipationMode(env)) return json({ error: 'Unknown request.' }, 404);
            if (Object.keys(body).length !== 1 || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) return json({ error: 'Invalid request.' }, 400);
            const result = await registryRequest(env, 'participation-stop', { sid: session.access.sid, version: session.access.version, exp: session.access.exp, request: { expectedRevision: body.expectedRevision } });
            return json(await result.json(), result.status);
        }
        if (url.pathname === '/beta/logout') {
            await disconnect(env, session);
            const result = json({ ok: true }, 200, { 'Set-Cookie': betaCookie(BETA_COOKIE, '', 0) });
            result.headers.append('Set-Cookie', betaCookie(BETA_IDENTITY_COOKIE, '', 0));
            return result;
        }
        return json({ error: 'Unknown request.' }, 404);
    }
    const gameGuestRequested = url.searchParams.get('game-guest') === '1';
    const gameGuestsAvailable = gameGuestEnabled(env);
    if (gameGuestRequested && !gameGuestsAvailable) return reply('Game invitations are unavailable.', 404);
    const session = await betaSession(request, env, Date.now(), { gameGuest: gameGuestRequested })
        || gameGuestsAvailable && !gameGuestRequested && ['GET', 'HEAD'].includes(request.method) && gameGuestAsset(assetPath)
            && await betaSession(request, env, Date.now(), { gameGuest: true });
    const webJoinPage = ['/join', '/join/', '/join/index.html'].includes(assetPath);
    if (!session) {
        if (gameGuestRequested && assetPath === LOBBY_PAGE) return reply('Your Game Night access ended. Ask your host for a new invitation.', 401);
        const returnPage = assetPath === '/join/handoff.html';
        const lobbyPage = [`${ROOT}lobby`, `${ROOT}lobby/`, `${ROOT}lobby/index.html`].includes(assetPath);
        if (['GET', 'HEAD'].includes(request.method) && !request.headers.get('Upgrade') && (lobbyPage || returnPage)) {
            const entrance = returnPage ? MUSIC_RETURN_ENTRANCE : LOBBY_ENTRANCE;
            return reply(request.method === 'HEAD' ? null : entrance, 401, 'text/html; charset=utf-8', READ_ONLY_PAGE);
        }
        if (['GET', 'HEAD'].includes(request.method) && webJoinPage) {
            return reply(request.method === 'HEAD' ? null : WEB_JOIN_ENTRANCE, 401, 'text/html; charset=utf-8', {
                'Content-Security-Policy': "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
                'Permissions-Policy': 'camera=(), geolocation=(), microphone=()',
            });
        }
        return reply('Private invitation required. Open your invitation link.', 401);
    }
    const guest = session.access.scope === 'game-night' && gameGuestScope(session.access.gameGuest);
    if (session.access.scope === 'game-night' && !guest) return reply('This game invitation could not be confirmed.', 403);
    if (guest && !(url.pathname === '/lobby' || url.pathname === '/beta/bootstrap.js' || url.pathname === '/beta/state'
        || arcadePath(url.pathname) && arcadeGame(url.pathname) === guest.game
        || ['GET', 'HEAD'].includes(request.method) && (assetPath === LOBBY_PAGE || gameGuestAsset(assetPath)))) {
        return reply('This invitation is for your Game Night room.', 403);
    }
    if (url.pathname === '/beta/participation') {
        if (!lobbyParticipationMode(env)) return json({ error: 'Unknown request.' }, 404);
        if (request.method !== 'GET' || url.search) return json({ error: 'GET without parameters required.' }, 400);
        const result = await registryRequest(env, 'participation', { sid: session.access.sid, version: session.access.version, exp: session.access.exp });
        return json(await result.json(), result.status);
    }
    if (url.pathname === '/beta/state') return json({ kind: session.identity?.kind || 'guest', role: session.identity?.role || 'fan', emailConfigured: betaAccessConfigured(env), staffConfigured: betaAccessConfigured(env) });
    if (url.pathname === '/beta/bootstrap.js') {
        const bootstrap = { preview: env.HANGOUT_PREVIEW_KEY, owner: session.identity?.kind === 'owner' };
        if (guest) bootstrap.gameGuest = { room: guest.room, ref: guest.ref, game: guest.game, match: guest.match, sessionRef: await gameGuestSessionRef(session.access.sid) };
        return reply(`window.HangoutBootstrap=${JSON.stringify(bootstrap)};window.HangoutEntrySites=${JSON.stringify(Object.values(entrySitesFromConfig(env.HANGOUT_ENTRY_SITES)))};${lobbyParticipationMode(env) ? 'window.HangoutParticipationControls=true;' : ''}${guest ? '' : "try{sessionStorage.setItem('hangout-preview',window.HangoutBootstrap.preview);sessionStorage.setItem('hangout-owner',window.HangoutBootstrap.owner?'1':'0');}catch{}"}`, 200, 'text/javascript');
    }
    if (url.pathname === '/lobby-owner/login' || url.pathname === '/lobby-admin/login') {
        if (request.method !== 'GET') return reply('GET required.', 405);
        if (!betaAccessConfigured(env)) return reply('Email verification is not configured. Guest chat is still available from your invitation.', 503);
        const owner = url.pathname === '/lobby-owner/login';
        const gate = await (owner ? ownerGate : adminGate)(request, env, deps);
        if (!gate.ok) {
            console.warn('hangout.access-denied', owner ? 'owner' : 'staff', gate.check || gate.reason);
            return reply(owner ? 'Verified email sign-in required.' : 'Restricted moderator sign-in required.', gate.status);
        }
        await disconnect(env, session);
        const profile = { kind: owner ? 'owner' : 'staff', account: await accountId(gate.identity.email, env.HANGOUT_HMAC_KEY),
            role: owner ? 'fan' : gate.identity.role, admin: !owner, expiresAt: Math.min(session.access.exp, gate.identity.expiresAt) };
        const next = await newAccess(env, { exp: session.access.exp, ip: request.headers.get('CF-Connecting-IP') || '0.0.0.0', profile });
        const identity = { v: 1, sid: next.access.sid, exp: Math.min(next.access.exp, gate.identity.expiresAt), kind: owner ? 'owner' : 'staff', email: gate.identity.email, role: owner ? 'fan' : gate.identity.role };
        const token = await signBeta('identity', identity, env.HANGOUT_HMAC_KEY);
        const result = redirect(owner ? `${ROOT}lobby/?owner=1${url.searchParams.get('entry-return') === '1' ? '&entry-return=1' : ''}` : `${ROOT}admin/?signed-in=1`, { 'Set-Cookie': betaCookie(BETA_IDENTITY_COOKIE, token, identity.exp - Date.now()) });
        result.headers.append('Set-Cookie', next.cookie);
        return result;
    }
    if (arcadePath(url.pathname) || mediaPath(url.pathname)) {
        if (!(mediaPath(url.pathname) ? mediaEnabled(env) : arcadeEnabled(env, arcadeGame(url.pathname)))) return reply('Room service unavailable.', 404);
        if (!sameOrigin(request) || url.search && (!guest || url.search !== GAME_GUEST_QUERY)) return reply('Admission denied.', 403);
        const issuing = url.pathname.endsWith('-ticket');
        if (issuing ? request.method !== 'POST' || !/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || '')
            : request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return reply('Invalid match request.', 400);
        const scope = issuing ? arcadeRoomRequest(await readBetaBody(request)) : null;
        if (issuing && !scope) return reply('Current room required.', 400);
        if (guest && scope && (scope.room !== guest.room || scope.ref !== guest.ref)) return reply('This invitation is for your Game Night room.', 403);
        const next = new Headers(request.headers);
        next.delete('Cookie');
        next.delete('Content-Length');
        next.set('X-Hangout-Arcade', JSON.stringify({ scope, session: {
            betaSid: session.access.sid, betaInviteVersion: session.access.version
        } }));
        const forward = new Request(url, { method: request.method, headers: next });
        return env.LOBBY.get(env.LOBBY.idFromName('stalemate')).fetch(forward);
    }
    if (['/lobby', '/lobby-owner', '/lobby-admin'].includes(url.pathname)) {
        if (env.HANGOUT_OPEN === '0' && url.pathname !== '/lobby-admin') return reply('The community is temporarily paused. Please try again later.', 503);
        if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return reply('WebSocket required.', 426);
        if (!sameOrigin(request) || !previewKeyOk(url.searchParams.get('preview'), env.HANGOUT_PREVIEW_KEY)) return reply('Admission denied.', 403);
        if (guest && url.searchParams.get('game-room') !== guest.ref) return reply('This invitation is for a different Game Night room.', 403);
        let identity = { role: 'fan', email: '', admin: false, account: '' };
        if (url.pathname !== '/lobby') {
            if (!betaAccessConfigured(env)) return reply('Email verification is not configured.', 503);
            const gate = await (url.pathname === '/lobby-owner' ? ownerGate : adminGate)(request, env, deps);
            if (!gate.ok) return reply('Verified sign-in required.', gate.status);
            identity = { ...identity, ...(url.pathname === '/lobby-admin' ? gate.identity : {}), account: await accountId(gate.identity.email, env.HANGOUT_HMAC_KEY), expiresAt: Math.min(session.access.exp, gate.identity.expiresAt) };
        } else if (!await checkTurnstile(request, env, url, deps)) return reply('Guest verification failed. Please try again.', 403);
        let dev = await verifyDevice(url.searchParams.get('dev'), env.HANGOUT_HMAC_KEY);
        const fresh = !dev;
        if (!dev) dev = newDeviceId();
        Object.assign(identity, { betaSid: session.access.sid, betaInviteVersion: session.access.version, expiresAt: identity.expiresAt || session.access.exp, dev, iph: await ipHash(request.headers.get('CF-Connecting-IP') || '0.0.0.0', env.HANGOUT_HMAC_KEY), devToken: fresh ? await signDevice(dev, env.HANGOUT_HMAC_KEY) : null, ...(guest ? { gameGuest: guest } : {}) });
        let status;
        try { status = (await env.QUOTA.get(env.QUOTA.idFromName('global')).fetch('https://quota/take', { method: 'POST' })).status; }
        catch { status = 503; }
        if (status !== 200) return reply('Community connection allowance unavailable. Please try again later.', status === 429 ? 429 : 503);
        const next = new Headers(request.headers); next.set('X-Hangout-Identity', JSON.stringify(identity));
        return env.LOBBY.get(env.LOBBY.idFromName('stalemate')).fetch(new Request(request, { headers: next }));
    }
    if (url.pathname === '/room' || url.pathname === '/turn') {
        if (!sameOrigin(request)) return reply('Admission denied.', 403);
        if (lobbyParticipationMode(env)) return reply('This media path is unavailable under the current participation permissions.', 503);
        if (env.HANGOUT_OPEN === '0') return reply('The community is temporarily paused.', 503);
        // No current non-retrying session/start fence spans this external
        // credential issuer. Keep it unavailable in the new authority mode.
        if (url.pathname === '/turn' && env.HANGOUT_SESSION_AUTHORITY === 'lobby-v1') return reply('Relay credentials are temporarily unavailable.', 503);
        let next = request;
        if (url.pathname === '/room') {
            const trusted = new Headers(request.headers);
            trusted.set('X-Hangout-Beta-Session', JSON.stringify({ betaSid: session.access.sid, betaInviteVersion: session.access.version, expiresAt: session.access.exp }));
            next = new Request(request, { headers: trusted });
        }
        return worker.fetch(next, { ...env, HANGOUT_EXTRA_ORIGINS: url.origin });
    }
    if ((assetPath === `${ROOT}admin` || assetPath.startsWith(`${ROOT}admin/`)) && session.identity?.kind !== 'staff') return reply('Restricted moderator sign-in required.', 403);
    if (lobbyParticipationMode(env) && (assetPath === '/join' || assetPath.startsWith('/join/'))) {
        if (webJoinPage && ['GET', 'HEAD'].includes(request.method) && !request.headers.get('Upgrade')) {
            return reply(request.method === 'HEAD' ? null : WEB_JOIN_UNAVAILABLE, 503, 'text/html; charset=utf-8', READ_ONLY_PAGE);
        }
        return reply('This audio path is unavailable under the current participation permissions.', 503);
    }
    if (!['GET', 'HEAD'].includes(request.method)) return reply('Method not allowed.', 405);
    const asset = await env.ASSETS.fetch(request);
    if (assetPath === '/join' || assetPath.startsWith('/join/')) {
        // Web Join is a separate opt-in audio client. Keep its stricter policy
        // and omit the chat bootstrap; invitation admission above still applies.
        const result = new Response(asset.body, asset);
        for (const [key, value] of Object.entries(headers)) result.headers.set(key, value);
        result.headers.set('Content-Security-Policy', WEB_JOIN_CSP);
        result.headers.set('Permissions-Policy', 'camera=(), geolocation=(), microphone=(self)');
        return result;
    }
    if (!asset.headers.get('Content-Type')?.includes('text/html')) {
        const result = new Response(asset.body, asset); for (const [key, value] of Object.entries(headers)) result.headers.set(key, value); return result;
    }
    const contact = String(env.HANGOUT_MODERATION_CONTACT || '').trim();
    const contactHtml = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}$/i.test(contact)
        ? `<a data-contact href="mailto:${contact}">${contact}</a>`
        : '<b data-contact>Moderation contact is not configured yet. Use the in-chat Report action to contact community moderators.</b>';
    const page = (await asset.text()).replace(/(<meta name="hangout-relay" content=")[^"]*(")/g, `$1${url.origin.replace(/^http/, 'ws')}$2`)
        .replace(/(<meta name="hangout-turn" content=")[^"]*(")/g, `$1${env.HANGOUT_TURN_ENABLED === '1' ? `${url.origin}/turn` : ''}$2`)
        .replace(/(<meta name="hangout-turnstile" content=")[^"]*(")/g, `$1${String(env.HANGOUT_TURNSTILE_SITEKEY || '').replace(/[^A-Za-z0-9_-]/g, '')}$2`)
        .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/gi, '').replace(/<script[^>]*goatcounter[^>]*><\/script>/gi, '')
        .replace(/<b data-contact>[\s\S]*?<\/b>/, contactHtml)
        .replace('<head>', `<head><script src="/beta/bootstrap.js${guest ? GAME_GUEST_QUERY : ''}"></script>`);
    const content = guest && assetPath === LOBBY_PAGE ? page
        .replace('<main class="gate" data-gate>', '<main class="gate" data-gate hidden>')
        .replace('<main class="gate" data-game-guest-connecting hidden>', '<main class="gate" data-game-guest-connecting>')
        .replace('<h1 data-game-guest-title>Game Night</h1>', `<h1 data-game-guest-title>${gameNightLabels[guest.game]}</h1>`)
        : page;
    return reply(content, asset.status, 'text/html; charset=utf-8');
}
export async function betaFetch(request, env, deps = {}) {
    try { return await betaRequest(request, env, deps); }
    catch (error) { if (error instanceof BetaSessionUnavailable) return json({ error: error.message }, error.status); throw error; }
}
export default { fetch: betaFetch };
