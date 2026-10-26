// Invitation-only real visitor beta. Never imports the pilot's role selector or synthetic emails.
import worker, { HangoutLobby, HangoutRoom, HangoutQuota, HangoutTurnBudget } from './index.mjs';
import { accountId, accessConfigured, hmacKeyOk, ipHash, newDeviceId, signDevice, verifyDevice } from './auth.mjs';
import { adminGate, ownerGate } from './lobby-do.mjs';
import { previewKeyOk } from './core.mjs';
import { BETA_TTL, BETA_COOKIE, BETA_IDENTITY_COOKIE, BetaSessionUnavailable, equalInvite, signBeta, betaCookie, betaSession, readBetaBody } from './beta-auth.mjs';
import { registryRequest } from './beta-session-client.mjs';
import { betaHealth } from './beta-ops.mjs';
import { entrySitesFromConfig } from '../../r/45662413410ed051/entry-sites.mjs';
import { lobbyParticipationMode, participationConfigurationValid } from './lobby-participation.mjs';
export { BetaSessions } from './beta-sessions.mjs';
export { HangoutLobby, HangoutRoom, HangoutQuota, HangoutTurnBudget };

const ROOT = '/r/45662413410ed051/';
const CSP = "default-src 'self'; script-src 'self' https://challenges.cloudflare.com https://www.youtube.com https://www.gstatic.com; style-src 'self' 'unsafe-inline'; frame-src https://challenges.cloudflare.com https://www.youtube.com https://www.youtube-nocookie.com; connect-src 'self' wss: https://challenges.cloudflare.com https://www.youtube.com https://*.googlevideo.com; img-src 'self' data: blob: https://i.ytimg.com; media-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const WEB_JOIN_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' https://webjam-turn-credentials.jeffstory007.workers.dev; media-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': CSP };
const reply = (body, status = 200, type = 'text/plain; charset=utf-8', extra = {}) => new Response(body, { status, headers: { ...headers, 'Content-Type': type, ...extra } });
const json = (body, status = 200, extra = {}) => reply(JSON.stringify(body), status, 'application/json; charset=utf-8', extra);
const redirect = (where, extra = {}) => reply(null, 303, 'text/plain', { Location: where, ...extra });
const sameOrigin = (request) => request.headers.get('Origin') === new URL(request.url).origin;
export function betaConfigured(env) {
    return participationConfigurationValid(env) && env.HANGOUT_BETA_MODE === 'protected' && hmacKeyOk(env.HANGOUT_HMAC_KEY) && hmacKeyOk(env.HANGOUT_BETA_INVITE_KEY) &&
        previewKeyOk(env.HANGOUT_PREVIEW_KEY, env.HANGOUT_PREVIEW_KEY) && env.ASSETS && env.LOBBY && env.QUOTA && env.ROOMS
        && (!env.HANGOUT_SESSION_AUTHORITY ? env.BETA_SESSIONS : env.HANGOUT_SESSION_AUTHORITY === 'lobby-v1');
}
export function betaAccessConfigured(env) {
    return accessConfigured(env) && accessConfigured({ ...env, HANGOUT_ACCESS_AUD: env.HANGOUT_OWNER_ACCESS_AUD }) && env.HANGOUT_ACCESS_AUD !== env.HANGOUT_OWNER_ACCESS_AUD;
}

const SHELL = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Stalemate · Private community beta</title><link rel="stylesheet" href="/beta/style.css"><script defer src="/beta/client.js"></script></head><body><main><p class="eyebrow">STALEMATE / INVITATION ONLY</p><h1>Hang Out<span aria-hidden="true">_</span></h1><p class="lede">Pick a nick. Find your people.<br>Make something together.</p><p id="status" role="status">Checking your invitation…</p><section id="login" hidden><h2>Your private invitation</h2><p>Open the invitation you received, or enter its code here.</p><form id="unlock"><label>Invitation code<input id="code" type="password" autocomplete="off" required></label><button>Enter the community ↗</button></form></section><section id="inside" hidden><h2>You’re on the guest list.</h2><p id="identity"></p><a class="button" href="${ROOT}lobby/">Choose a nickname and join ↗</a><div class="options"><a id="owner" href="/lobby-owner/login">Verify your email to keep a room</a><a id="staff" href="/lobby-admin/login">Moderator sign-in</a><a id="moderation" href="${ROOT}admin/" hidden>Open moderation panel</a></div><p class="muted">Guest chat needs no account. Email verification is optional and lets you recover your registered rooms on another device. Staff permissions are granted separately.</p><form id="logout"><button class="secondary">Leave this beta</button></form></section><aside><h2>A little field guide</h2><ol><li>Say hello in #stalemate. Chat starts when you join; there’s no earlier backlog.</li><li>Start your own channel, shared canvas, watch room, or WebJam room.</li><li>Use Host tools → Keep this room after verifying your email to reserve its name.</li><li>Report abusive messages from their message menu. Hosts manage their rooms; community moderators review reports.</li></ol><a href="/beta/privacy">House rules, data handling &amp; contact</a></aside><p class="muted">Private beta. Cameras stay off until you choose them. Email sign-in uses Cloudflare Access.</p></main></body></html>`;
const STYLE = `:root{color-scheme:dark;font:16px/1.6 system-ui,sans-serif;background:#101414;color:#eeeeda}*{box-sizing:border-box}body{margin:0;padding:32px 20px}main{max-width:680px;margin:auto}h1{font-size:clamp(3rem,12vw,5rem);line-height:1;letter-spacing:-.06em;margin:24px 0}h1 span,a,.eyebrow{color:#d1fa78}h2{font-size:1.35rem;line-height:1.3}p,li{overflow-wrap:anywhere}.eyebrow{font:11px/1.5 ui-monospace,monospace;letter-spacing:.08em}.lede{font-size:1.3rem}section,aside{padding:24px;border:1px solid #343d36;margin:24px 0;background:#171d1a}[hidden]{display:none!important}label{display:block;font-size:14px}input{display:block;width:100%;min-width:0;font:16px/1.5 ui-monospace,monospace;padding:12px;margin:8px 0 16px;background:#101414;color:inherit;border:1px solid #65725d}.button,button{display:inline-flex;justify-content:center;align-items:center;min-height:46px;max-width:100%;padding:12px 18px;font:600 14px/1.4 ui-monospace,monospace;border:1px solid #d1fa78;background:#d1fa78;color:#142014;text-decoration:none;cursor:pointer}.secondary{background:none;border-color:#65725d;color:inherit;font-size:12px}.options{display:flex;flex-wrap:wrap;gap:12px 20px;margin:24px 0;font-size:14px}.muted{font-size:13px;color:#a1aaa2}ol{padding-left:20px}li{padding-bottom:10px}a:focus-visible,button:focus-visible,input:focus-visible{outline:2px solid #d1fa78;outline-offset:4px}#status{color:#e5c181;font:12px/1.6 ui-monospace,monospace}@media(max-width:480px){body{padding:24px 16px}section,aside{padding:20px}.options{flex-direction:column}.button{width:100%}}`;
const CLIENT = `import { createEntrySiteRegistry, entrySourceFromParams, ENTRY_HANDOFF_KEY, entryHandoff } from '/beta/entry-sites.mjs';
const entrySites = createEntrySiteRegistry(__ENTRY_SITES__);
const source = entrySourceFromParams(new URLSearchParams(location.search), entrySites);
const $ = s => document.querySelector(s);
const rememberEntry = () => sessionStorage.setItem(ENTRY_HANDOFF_KEY, entryHandoff(source, true, Date.now(), entrySites));
$('#inside .button').href = '${ROOT}lobby/?entry-return=1';
$('#owner').href = '/lobby-owner/login?entry-return=1';
$('#inside .button').addEventListener('click', rememberEntry);
$('#owner').addEventListener('click', rememberEntry);
async function post(path, body) {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const value = await r.json();
    if (!r.ok) throw Error(value.error || 'Request failed');
    return value;
}
function error(e) { $('#status').textContent = e.message || String(e); }
async function draw() {
    const r = await fetch('/beta/state');
    if (!r.ok) { $('#status').textContent = 'A private invitation is required.'; $('#login').hidden = false; $('#inside').hidden = true; return; }
    const s = await r.json();
    $('#login').hidden = true; $('#inside').hidden = false; $('#status').textContent = 'Invitation accepted.';
    $('#identity').textContent = s.kind === 'staff' ? 'Signed in as ' + s.role + '.' : s.kind === 'owner' ? 'Email verified. You can keep and recover rooms.' : 'Join as a guest with just a nickname.';
    $('#staff').hidden = !s.staffConfigured; $('#moderation').hidden = s.kind !== 'staff'; $('#owner').hidden = !s.emailConfigured || s.kind === 'owner';
}
$('#unlock').addEventListener('submit', async e => { e.preventDefault(); try { await post('/beta/unlock', { key: $('#code').value }); $('#code').value = ''; await draw(); } catch (e) { error(e); } });
$('#logout').addEventListener('submit', async e => { e.preventDefault(); try { await post('/beta/logout', {}); sessionStorage.removeItem('hangout-owner'); sessionStorage.removeItem('hangout-preview'); sessionStorage.removeItem(ENTRY_HANDOFF_KEY); await draw(); } catch (e) { error(e); } });
const key = new URLSearchParams(location.hash.slice(1)).get('invite');
if (location.hash || location.search) history.replaceState(null, '', location.pathname);
(async () => { try { if (key) await post('/beta/unlock', { key }); await draw(); } catch (e) { error(e); $('#login').hidden = false; } })();`;

async function disconnect(env, session) {
    let result;
    try { result = await registryRequest(env, 'revoke', { sid: session.access.sid, exp: session.access.exp, version: session.access.version }); }
    catch { throw new BetaSessionUnavailable('Your current session could not be revoked. Please try again.'); }
    if (!result.ok) throw new BetaSessionUnavailable('Your session is revoked, but some connections could not be closed. A retry is queued; please try again.');
}
async function newAccess(env, { exp = Date.now() + BETA_TTL, ip = '0.0.0.0', profile = null } = {}) {
    const access = { v: 1, sid: crypto.randomUUID(), exp, scope: 'guest', version: String(env.HANGOUT_BETA_INVITE_VERSION || '1') };
    let result;
    try { result = await registryRequest(env, 'register', { sid: access.sid, exp: access.exp, version: access.version, iph: await ipHash(ip, env.HANGOUT_HMAC_KEY),
        ...(env.HANGOUT_SESSION_AUTHORITY === 'lobby-v1' ? { profile } : {}) }); }
    catch { throw new BetaSessionUnavailable('The community session service is temporarily unavailable.'); }
    if (result.status !== 200) throw new BetaSessionUnavailable(result.status === 429 ? 'The beta session allowance is full. Please try again later.' : 'The community session service is temporarily unavailable.', result.status === 429 ? 429 : 503);
    return { access, cookie: betaCookie(BETA_COOKIE, await signBeta('access', access, env.HANGOUT_HMAC_KEY), exp - Date.now()) };
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
    if (url.pathname === '/beta/style.css') return reply(STYLE, 200, 'text/css');
    if (url.pathname === '/beta/client.js') return reply(CLIENT.replace('__ENTRY_SITES__', () => JSON.stringify(Object.values(entrySitesFromConfig(env.HANGOUT_ENTRY_SITES)))), 200, 'text/javascript');
    if (url.pathname === '/beta/entry-sites.mjs') {
        // Only this public, credential-free display registry is available before
        // invitation admission. Other collaboration assets remain protected.
        const asset = await env.ASSETS.fetch(new Request(`${url.origin}${ROOT}entry-sites.mjs`));
        return reply(asset.body, asset.status, 'text/javascript');
    }
    if (request.method === 'POST' && url.pathname.startsWith('/beta/')) {
        if (!sameOrigin(request) || !/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || '')) return json({ error: 'Same-origin JSON request required.' }, 403);
        if (Number(request.headers.get('Content-Length') || 0) > 2048) return json({ error: 'Request too large.' }, 413);
        const body = await readBetaBody(request);
        if (!body) return json({ error: 'Invalid or oversized request.' }, 400);
        if (url.pathname === '/beta/unlock') {
            if (!equalInvite(body.key, env.HANGOUT_BETA_INVITE_KEY)) return json({ error: 'Invitation was not accepted.' }, 403);
            const previous = await betaSession(request, env, Date.now(), { allowRevoked: true });
            if (previous && !previous.revoked) return json({ ok: true });
            if (previous) await disconnect(env, previous);
            return json({ ok: true }, 200, { 'Set-Cookie': (await newAccess(env, { ip: request.headers.get('CF-Connecting-IP') || '0.0.0.0' })).cookie });
        }
        const session = await betaSession(request, env, Date.now(), { allowRevoked: url.pathname === '/beta/logout' });
        if (!session) return json({ error: 'Private invitation required.' }, 401);
        if (url.pathname === '/beta/logout') {
            await disconnect(env, session);
            return json({ ok: true }, 200, { 'Set-Cookie': betaCookie(BETA_COOKIE, '', 0) });
        }
        return json({ error: 'Unknown request.' }, 404);
    }
    const session = await betaSession(request, env);
    if (!session) return reply('Private invitation required. Open your invitation link.', 401);
    if (url.pathname === '/beta/privacy') return redirect(`${ROOT}terms/`);
    if (url.pathname === '/beta/state') return json({ kind: session.identity?.kind || 'guest', role: session.identity?.role || 'fan', emailConfigured: betaAccessConfigured(env), staffConfigured: betaAccessConfigured(env) });
    if (url.pathname === '/beta/bootstrap.js') return reply(`sessionStorage.setItem('hangout-preview',${JSON.stringify(env.HANGOUT_PREVIEW_KEY)});sessionStorage.setItem('hangout-owner',${JSON.stringify(session.identity?.kind === 'owner' ? '1' : '0')});window.HangoutEntrySites=${JSON.stringify(Object.values(entrySitesFromConfig(env.HANGOUT_ENTRY_SITES)))};`, 200, 'text/javascript');
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
    if (['/lobby', '/lobby-owner', '/lobby-admin'].includes(url.pathname)) {
        if (env.HANGOUT_OPEN === '0' && url.pathname !== '/lobby-admin') return reply('The community is temporarily paused. Please try again later.', 503);
        if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return reply('WebSocket required.', 426);
        if (!sameOrigin(request) || !previewKeyOk(url.searchParams.get('preview'), env.HANGOUT_PREVIEW_KEY)) return reply('Admission denied.', 403);
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
        Object.assign(identity, { betaSid: session.access.sid, betaInviteVersion: session.access.version, expiresAt: identity.expiresAt || session.access.exp, dev, iph: await ipHash(request.headers.get('CF-Connecting-IP') || '0.0.0.0', env.HANGOUT_HMAC_KEY), devToken: fresh ? await signDevice(dev, env.HANGOUT_HMAC_KEY) : null });
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
    if (lobbyParticipationMode(env) && (assetPath === '/join' || assetPath.startsWith('/join/'))) return reply('This audio path is unavailable under the current participation permissions.', 503);
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
        .replace('<head>', '<head><script src="/beta/bootstrap.js"></script>');
    return reply(page, asset.status, 'text/html; charset=utf-8');
}
export async function betaFetch(request, env, deps = {}) {
    try { return await betaRequest(request, env, deps); }
    catch (error) { if (error instanceof BetaSessionUnavailable) return json({ error: error.message }, error.status); throw error; }
}
export default { fetch: betaFetch };
