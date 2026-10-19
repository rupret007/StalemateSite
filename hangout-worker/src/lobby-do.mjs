// The #stalemate lobby Durable Object + its Worker-side admission. Everything that can be refused is refused here,
// before a DO request is spent. Missing config/secrets => 503 (fail closed).
import { originAllowed, previewKeyOk } from './core.mjs';
import { accountId, accessConfigured, hmacKeyOk, ipHash, newDeviceId, roleForEmail, signDevice, verifyAccessJwt, verifyDevice } from './auth.mjs';
import { createLobby } from './lobby-core.mjs';
import { LOG_TTL } from './community-state.mjs';
import { createAiModerator } from './ai-moderation.mjs';

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

const jwksCache = { at: 0, body: null };
async function fetchJwks(url) {
    if (jwksCache.body && Date.now() - jwksCache.at < 10 * 60 * 1000) return jwksCache.body;
    const r = await fetch(url, { redirect: 'error' });
    if (!r.ok) throw new Error('jwks');
    jwksCache.body = await r.json(); jwksCache.at = Date.now();
    return jwksCache.body;
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
        if (!accessConfigured(env)) return { status: 503, reason: 'access-not-configured' };
        try {
            const { email, expiresAt } = await verifyAccessJwt(request.headers.get('Cf-Access-Jwt-Assertion'), { team: env.HANGOUT_ACCESS_TEAM, aud: env.HANGOUT_ACCESS_AUD, fetchJwks: deps.fetchJwks || fetchJwks });
            const role = roleForEmail(email, env);
            if (!role) return { status: 403, reason: 'not-band' };
            Object.assign(identity, { role, email, expiresAt, account: await accountId(email, env.HANGOUT_HMAC_KEY), admin: true });
        } catch (e) { return { status: 403, reason: 'access' }; }
    } else if (url.pathname === '/lobby-owner') {
        try {
            if (!env.HANGOUT_OWNER_ACCESS_AUD) return { status: 503, reason: 'owner-signin-not-configured' };
            const { email, expiresAt } = await verifyAccessJwt(request.headers.get('Cf-Access-Jwt-Assertion'), { team: env.HANGOUT_ACCESS_TEAM, aud: env.HANGOUT_OWNER_ACCESS_AUD, fetchJwks: deps.fetchJwks || fetchJwks });
            Object.assign(identity, { account: await accountId(email, env.HANGOUT_HMAC_KEY), expiresAt });
        } catch { return { status: 403, reason: 'owner-signin' }; }
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
// go to SQLite storage when they change. Optional AI quota reservations are stored before each check.
export class HangoutLobby {
    constructor(state, env) {
        this.state = state;
        this.env = env;
        this.pendingAdmission = new Map();
        this.evidenceStorage = 'ready';
        this.ready = state.blockConcurrencyWhile(async () => {
            this.aiModerator = createAiModerator({
                enabled: env.HANGOUT_AI_MODERATION === 'review',
                apiKey: env.OPENAI_API_KEY,
                dailyLimit: env.HANGOUT_AI_DAILY_LIMIT,
                usage: await state.storage.get('ai-usage'),
                saveUsage: async (usage) => {
                    try { await state.storage.put('ai-usage', usage); }
                    catch (error) { this.storageFailed(); throw error; }
                },
                onChange: () => this.engine?.notifyAiStatus()
            });
            this.engine = createLobby({
                aiModerationStatus: () => ({ ...this.aiModerator.status(), evidenceStorage: this.evidenceStorage }),
                reviewPublicText: env.HANGOUT_AI_MODERATION === 'review' ? ({ id, text }) => {
                    const task = this.aiModerator.review({ text }).then((result) => this.engine.applyAiReview(id, result));
                    this.state.waitUntil?.(task);
                    return task;
                } : undefined,
                send: (id, msg) => {
                    const ws = this.byId(id);
                    if (ws) ws.send(JSON.stringify(msg));
                    else this.pendingAdmission.get(id)?.push(msg);
                },
                close: (id, code, reason) => { const ws = this.byId(id); if (ws) try { ws.close(code, reason); } catch (e) { /* gone */ } },
                persist: (kind, data) => {
                    if (['rooms', 'abuse'].includes(kind)) return this.persistRequired(kind, data);
                    if (['net', 'ai-reviews', 'moderation-queue'].includes(kind)) return this.persistState(kind, data);
                    if (kind === 'modlog') { this.logSeq = (this.logSeq || 0) + 1; this.persistState(`log:${String(Date.now()).padStart(15, '0')}:${crypto.randomUUID()}`, data); }
                },
                limits: { webJoinOrigins: String(env.WEBJAM_WEB_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean) }
            });
            this.engine.restore((await state.storage.get('net')) || {});
            this.engine.restoreAiReviews((await state.storage.get('ai-reviews')) || []);
            this.engine.restoreModerationQueue((await state.storage.get('moderation-queue')) || {});
            const roomIndex = await state.storage.get('room-index');
            if (roomIndex !== undefined) {
                const records = roomIndex?.version === 1 && Array.isArray(roomIndex.names) && roomIndex.names.length <= 1030 ? await Promise.all(roomIndex.names.map((name) => state.storage.get(`community-room:${name}`))) : null;
                await this.engine.restoreRooms(records ? { version: 1, rooms: records } : null);
            } else await this.engine.restoreRooms(await state.storage.get('rooms'));
            this.engine.restoreAbuse(await state.storage.get('abuse'));
            await this.engine.tick();
            await this.pruneLogs();
            const logs = await state.storage.list({ prefix: 'log:', reverse: true, limit: 2000 });
            this.engine.restoreLog([...logs.values()].reverse());
            // After hibernation, sockets survive but memory doesn't: re-admit them (nick resets, they re-hello).
            for (const ws of state.getWebSockets()) {
                const a = ws.deserializeAttachment() || {};
                if (a.id) {
                    if (a.expiresAt && a.expiresAt <= Date.now() || a.admin && roleForEmail(a.email, env) !== a.role) { ws.close(4401, 'sign in again'); continue; }
                    this.engine.connect(a);
                }
            }
            if (!(await state.storage.getAlarm())) await state.storage.setAlarm(Date.now() + 60 * 1000);
        });
    }
    storageFailed() {
        this.evidenceStorage = 'degraded';
        this.engine?.notifyAiStatus();
    }
    persistState(key, value) {
        // Track persistence separately from classifier work; failed writes are visible, never detached rejections.
        const task = Promise.resolve().then(() => this.state.storage.put(key, value)).catch(() => this.storageFailed());
        this.state.waitUntil?.(task);
        return task;
    }
    byId(id) { return this.state.getWebSockets(id)[0]; }
    async persistRequired(key, value) {
        try {
            if (key === 'rooms') {
                await this.state.storage.transaction(async (txn) => {
                    const old = await txn.get('room-index');
                    const names = value.rooms.map((r) => r.name);
                    for (const room of value.rooms) {
                        const k = `community-room:${room.name}`;
                        if (JSON.stringify(await txn.get(k)) !== JSON.stringify(room)) await txn.put(k, room);
                    }
                    for (const name of old?.names || []) if (!names.includes(name)) await txn.delete(`community-room:${name}`);
                    await txn.put('room-index', { version: 1, names });
                    await txn.delete('rooms'); // retire the legacy aggregate after committing the index
                });
            } else await this.state.storage.put(key, value);
        } catch (error) { this.storageFailed(); throw error; }
    }
    async pruneLogs() {
        let startAfter; let kept = 0;
        do {
            const rows = await this.state.storage.list({ prefix: 'log:', reverse: true, limit: 500, ...(startAfter ? { end: startAfter } : {}) });
            if (!rows.size) break;
            const remove = [];
            for (const [key, value] of rows) {
                if (!Number.isFinite(value?.at) || Date.now() - value.at >= LOG_TTL || kept >= 2000) remove.push(key); else kept++;
                startAfter = key;
            }
            if (remove.length) await this.state.storage.delete(remove);
            if (rows.size < 500) break;
        } while (true);
    }
    async alarm() {
        await this.ready;
        return this.state.blockConcurrencyWhile(async () => {
            await this.engine.tick(); await this.pruneLogs();
            for (const ws of this.state.getWebSockets()) {
                const a = ws.deserializeAttachment() || {};
                if (a.expiresAt && a.expiresAt <= Date.now() || a.admin && roleForEmail(a.email, this.env) !== a.role) { ws.close(4401, 'sign in again'); await this.engine.disconnect(a.id); }
            }
            await this.state.storage.setAlarm(Date.now() + 60000);
        });
    }
    async fetch(request) {
        await this.ready;
        let identity;
        try { identity = JSON.parse(request.headers.get('X-Hangout-Identity')); } catch (e) { return new Response('no', { status: 400 }); }
        if (!identity || !identity.dev) return new Response('no', { status: 400 });
        const id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
        // Admission may refuse before upgrade, but successful connect also emits the
        // hello the browser waits for. Hold those frames until the socket is accepted.
        const initialFrames = [];
        this.pendingAdmission.set(id, initialFrames);
        let verdict;
        try {
            verdict = this.engine.connect({ id, dev: identity.dev, iph: identity.iph, role: identity.role, email: identity.email, account: identity.account, expiresAt: identity.expiresAt, admin: identity.admin });
        } finally {
            this.pendingAdmission.delete(id);
        }
        if (!verdict.ok) return new Response(verdict.reason, { status: verdict.status });
        const pair = new WebSocketPair();
        this.state.acceptWebSocket(pair[1], [id]);
        pair[1].serializeAttachment({ id, dev: identity.dev, iph: identity.iph, role: identity.role, email: identity.email, account: identity.account, expiresAt: identity.expiresAt, admin: identity.admin });
        if (identity.devToken) pair[1].send(JSON.stringify({ t: 'device', token: identity.devToken }));
        for (const frame of initialFrames) pair[1].send(JSON.stringify(frame));
        return new Response(null, { status: 101, webSocket: pair[0] });
    }
    async webSocketMessage(ws, raw) {
        await this.ready;
        return this.state.blockConcurrencyWhile(async () => {
            const a = ws.deserializeAttachment() || {};
            if (a.expiresAt && a.expiresAt <= Date.now() || a.admin && roleForEmail(a.email, this.env) !== a.role) { ws.close(4401, 'sign in again'); return this.engine.disconnect(a.id); }
            return this.engine.message(this.state.getTags(ws)[0], typeof raw === 'string' ? raw : '');
        });
    }
    async webSocketClose(ws) { await this.ready; return this.state.blockConcurrencyWhile(() => Promise.resolve(this.engine.disconnect(this.state.getTags(ws)[0]))); }
    async webSocketError(ws) { return this.webSocketClose(ws); }
}
