// The #stalemate lobby Durable Object + its Worker-side admission. Everything that can be refused is refused here,
// before a DO request is spent. Missing config/secrets => 503 (fail closed).
import { originAllowed, previewKeyOk } from './core.mjs';
import { accessConfigured, hmacKeyOk, ipHash, newDeviceId, roleForEmail, signDevice, verifyAccessJwt, verifyDevice } from './auth.mjs';
import { createLobby } from './lobby-core.mjs';

export function lobbyConfigured(env = {}) {
    return !!(env.LOBBY && env.QUOTA && hmacKeyOk(env.HANGOUT_HMAC_KEY) && typeof env.HANGOUT_PREVIEW_KEY === 'string' && env.HANGOUT_TURNSTILE_SECRET);
}

async function turnstileOk(token, ip, secret, fetchImpl = fetch) {
    if (!token || String(token).length > 2048) return false;
    try {
        const body = new FormData();
        body.append('secret', secret); body.append('response', token); body.append('remoteip', ip);
        const r = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
        return (await r.json()).success === true;
    } catch (e) { return false; }
}

const jwksCache = { url: '', at: 0, body: null };
async function fetchJwks(url) {
    if (jwksCache.url === url && jwksCache.body && Date.now() - jwksCache.at < 10 * 60 * 1000) return jwksCache.body;
    const r = await fetch(url, { redirect: 'error' });
    if (!r.ok) throw new Error('jwks');
    jwksCache.body = await r.json(); jwksCache.url = url; jwksCache.at = Date.now();
    return jwksCache.body;
}

// Also guards the login redirect; a header merely being present is never authentication.
export async function adminGate(request, env, deps = {}) {
    if (!accessConfigured(env)) return { status: 503, reason: 'access-not-configured' };
    try {
        const { email } = await verifyAccessJwt(request.headers.get('Cf-Access-Jwt-Assertion'), {
            team: env.HANGOUT_ACCESS_TEAM, aud: env.HANGOUT_ACCESS_AUD, fetchJwks: deps.fetchJwks || fetchJwks
        });
        const role = roleForEmail(email, env);
        if (!role) return { status: 403, reason: 'not-band' };
        return { ok: true, identity: { role, email, admin: true } };
    } catch { return { status: 403, reason: 'access' }; }
}

// Exported for tests: returns {status, reason} when refused, or {ok, identity} when the upgrade may proceed.
export async function lobbyGate(request, env, url, deps = {}) {
    if (!lobbyConfigured(env)) return { status: 503, reason: 'not-configured' };
    if (env.HANGOUT_OPEN === '0') return { status: 503, reason: 'back-soon' };
    if (request.headers.get('Upgrade') !== 'websocket') return { status: 426, reason: 'websocket only' };
    if (!originAllowed(request.headers.get('Origin'), env.HANGOUT_EXTRA_ORIGINS)) return { status: 403, reason: 'origin' };
    if (!previewKeyOk(url.searchParams.get('preview'), env.HANGOUT_PREVIEW_KEY)) return { status: 403, reason: 'preview' };
    const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
    const identity = { role: 'fan', email: '', admin: false };
    if (url.pathname === '/lobby-admin') {
        const admin = await adminGate(request, env, deps);
        if (!admin.ok) return admin;
        Object.assign(identity, admin.identity);
    } else if (!(await (deps.turnstile || turnstileOk)(url.searchParams.get('ts'), ip, env.HANGOUT_TURNSTILE_SECRET))) {
        return { status: 403, reason: 'bot-check' };
    }
    let dev = await verifyDevice(url.searchParams.get('dev'), env.HANGOUT_HMAC_KEY);
    const fresh = !dev;
    if (!dev) dev = newDeviceId();
    identity.dev = dev;
    identity.devToken = fresh ? await signDevice(dev, env.HANGOUT_HMAC_KEY) : null;
    identity.iph = await ipHash(ip, env.HANGOUT_HMAC_KEY);
    return { ok: true, identity };
}

export async function admitLobby(request, env, url) {
    const gate = await lobbyGate(request, env, url);
    if (!gate.ok) return new Response(gate.reason, { status: gate.status });
    let quota;
    try { quota = (await env.QUOTA.get(env.QUOTA.idFromName('global')).fetch('https://quota/take', { method: 'POST' })).status; } catch (e) { quota = 503; }
    if (quota !== 200) return new Response('lobby is resting', { status: quota === 429 ? 429 : 503 });
    const headers = new Headers(request.headers);
    headers.set('X-Hangout-Identity', JSON.stringify(gate.identity));
    return env.LOBBY.get(env.LOBBY.idFromName('stalemate')).fetch(new Request(request, { headers }));
}

// One DO = one network. Uses the WebSocket Hibernation API; durable bits (bans, filters, lock, shield, mod log)
// go to SQLite storage only when they change, never per chat line.
export class HangoutLobby {
    constructor(state, env) {
        this.state = state;
        this.env = env;
        this.ready = state.blockConcurrencyWhile(async () => {
            this.engine = createLobby({
                send: (id, msg) => { const ws = this.byId(id); if (ws) ws.send(JSON.stringify(msg)); },
                close: (id, code, reason) => { const ws = this.byId(id); if (ws) try { ws.close(code, reason); } catch (e) { /* gone */ } },
                persist: (kind, data) => {
                    if (kind === 'net') this.state.storage.put('net', data);
                    if (kind === 'modlog') { this.logSeq = (this.logSeq || 0) + 1; this.state.storage.put(`log:${String(Date.now()).padStart(15, '0')}:${this.logSeq}`, data); }
                },
                limits: { webJoinOrigins: String(env.WEBJAM_WEB_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean) }
            });
            this.engine.restore((await state.storage.get('net')) || {});
            const logs = await state.storage.list({ prefix: 'log:', reverse: true, limit: 2000 });
            this.engine.restoreLog([...logs.values()].reverse());
            // After hibernation, sockets survive but memory doesn't: re-admit them (nick resets, they re-hello).
            for (const ws of state.getWebSockets()) {
                const a = ws.deserializeAttachment() || {};
                if (a.id) { this.engine.connect(a); }
            }
            if (!(await state.storage.getAlarm())) await state.storage.setAlarm(Date.now() + 60 * 1000);
        });
    }
    byId(id) { return this.state.getWebSockets(id)[0]; }
    async alarm() { await this.ready; this.engine.tick(); await this.state.storage.setAlarm(Date.now() + 60 * 1000); }
    async fetch(request) {
        await this.ready;
        let identity;
        try { identity = JSON.parse(request.headers.get('X-Hangout-Identity')); } catch (e) { return new Response('no', { status: 400 }); }
        if (!identity || !identity.dev) return new Response('no', { status: 400 });
        const id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
        const verdict = this.engine.connect({ id, dev: identity.dev, iph: identity.iph, role: identity.role, email: identity.email, admin: identity.admin });
        if (!verdict.ok) return new Response(verdict.reason, { status: verdict.status });
        const pair = new WebSocketPair();
        this.state.acceptWebSocket(pair[1], [id]);
        pair[1].serializeAttachment({ id, dev: identity.dev, iph: identity.iph, role: identity.role, email: identity.email, admin: identity.admin });
        if (identity.devToken) pair[1].send(JSON.stringify({ t: 'device', token: identity.devToken }));
        return new Response(null, { status: 101, webSocket: pair[0] });
    }
    async webSocketMessage(ws, raw) { await this.ready; this.engine.message(this.state.getTags(ws)[0], typeof raw === 'string' ? raw : ''); }
    async webSocketClose(ws) { await this.ready; this.engine.disconnect(this.state.getTags(ws)[0]); }
    async webSocketError(ws) { return this.webSocketClose(ws); }
}
