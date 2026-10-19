// The #stalemate lobby Durable Object + its Worker-side admission. Everything that can be refused is refused here,
// before a DO request is spent. Missing config/secrets => 503 (fail closed).
import { originAllowed, previewKeyOk } from './core.mjs';
import { accountId, accessConfigured, hmacKeyOk, ipHash, newDeviceId, roleForEmail, signDevice, verifyAccessJwt, verifyDevice } from './auth.mjs';
import { createLobby, LOBBY_LIMITS } from './lobby-core.mjs';
import { LOG_TTL } from './community-state.mjs';
import { createAiModerator } from './ai-moderation.mjs';
import { activeBetaSession, validBetaSession } from './beta-session-client.mjs';
import { INTERNAL_HEALTH_PATH, aiHealth, dailyUsage, healthJson } from './beta-ops.mjs';
import { createPrivateReportQueue, privateReportRef, validatePrivateReportControl, LIMITS as PRIVATE_REPORT_LIMITS } from './private-reports.mjs';

const privateReportResponse = (value) => new Response(JSON.stringify(value), {
    status: value.ok ? 200 : Number.isInteger(value.status) ? value.status : 503,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

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
// Fixed categories only: provider errors can contain credentials or arbitrary text.
const accessFailure = (error) => ['missing', 'malformed', 'alg', 'kid', 'signature', 'issuer', 'audience', 'expired', 'not-yet', 'email', 'jwks', 'crypto'].includes(error?.message) ? error.message : 'verification';
function betaSessionInvalid(attachment, env) {
    return env.HANGOUT_BETA_MODE === 'protected' && (attachment.betaEnded || !validBetaSession(attachment, env));
}
function socketIdentityInvalid(attachment, env) {
    return attachment.sessionEnded || betaSessionInvalid(attachment, env) || attachment.expiresAt && attachment.expiresAt <= Date.now() ||
        attachment.admin && roleForEmail(attachment.email, env) !== attachment.role;
}
async function fetchJwks(url) {
    if (jwksCache.url === url && jwksCache.body && Date.now() - jwksCache.at < 10 * 60 * 1000) return jwksCache.body;
    let r;
    // Workers rejects redirect:'error' before sending the request. Manual mode
    // plus the !ok check below refuses redirects without following them.
    try { r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(8000) }); }
    catch (error) {
        console.warn('hangout.access-jwks', 'request', ['TypeError', 'AbortError', 'TimeoutError'].includes(error?.name) ? error.name : 'Error');
        throw new Error('jwks');
    }
    if (!r.ok) { console.warn('hangout.access-jwks', 'status', r.status); throw new Error('jwks'); }
    try { jwksCache.body = await r.json(); }
    catch { console.warn('hangout.access-jwks', 'body', 'invalid-json'); throw new Error('jwks'); }
    jwksCache.url = url; jwksCache.at = Date.now();
    return jwksCache.body;
}

// Reuse cryptographic staff authorization for redirects and WebSocket admission.
export async function adminGate(request, env, deps = {}) {
    if (!accessConfigured(env)) return { status: 503, reason: 'access-not-configured' };
    try {
        const { email, expiresAt } = await verifyAccessJwt(request.headers.get('Cf-Access-Jwt-Assertion'), {
            team: env.HANGOUT_ACCESS_TEAM, aud: env.HANGOUT_ACCESS_AUD, fetchJwks: deps.fetchJwks || fetchJwks
        });
        const role = roleForEmail(email, env);
        if (!role) return { status: 403, reason: 'not-band' };
        return { ok: true, identity: { role, email, expiresAt, admin: true } };
    } catch (error) { return { status: 403, reason: 'access', check: accessFailure(error) }; }
}

export async function ownerGate(request, env, deps = {}) {
    if (!accessConfigured({ ...env, HANGOUT_ACCESS_AUD: env.HANGOUT_OWNER_ACCESS_AUD })) return { status: 503, reason: 'owner-signin-not-configured' };
    try {
        const { email, expiresAt } = await verifyAccessJwt(request.headers.get('Cf-Access-Jwt-Assertion'), {
            team: env.HANGOUT_ACCESS_TEAM, aud: env.HANGOUT_OWNER_ACCESS_AUD, fetchJwks: deps.fetchJwks || fetchJwks
        });
        return { ok: true, identity: { email, expiresAt } };
    } catch (error) { return { status: 403, reason: 'owner-signin', check: accessFailure(error) }; }
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
        Object.assign(identity, admin.identity, { account: await accountId(admin.identity.email, env.HANGOUT_HMAC_KEY) });
    } else if (url.pathname === '/lobby-owner') {
        const owner = await ownerGate(request, env, deps);
        if (!owner.ok) return owner;
        Object.assign(identity, { account: await accountId(owner.identity.email, env.HANGOUT_HMAC_KEY), expiresAt: owner.identity.expiresAt });
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
        this.privateReportState = { storage: 'disabled', reports: [] };
        this.privateAdminDispatch = new WeakMap();
        this.ready = state.blockConcurrencyWhile(async () => {
            // Only the separate authenticated pilot can initialize its first empty network.
            // A later missing/corrupt record still restores fail-closed after this sentinel exists.
            const bootstrapKey = env.HANGOUT_BETA_MODE === 'protected' ? 'beta-initialized' : 'pilot-initialized';
            if ((env.PILOT_MODE === 'protected' || env.HANGOUT_BETA_MODE === 'protected') && !(await state.storage.get(bootstrapKey))) {
                await state.storage.transaction(async (txn) => {
                    if ((await txn.get('net')) === undefined && (await txn.get('room-index')) === undefined) await txn.put('net', { lock: 'off' });
                    await txn.put(bootstrapKey, true);
                });
            }
            if (env.HANGOUT_BETA_MODE === 'protected') {
                this.privateReportQueue = createPrivateReportQueue({ storage: state.storage });
                await this.refreshPrivateReports(false);
            }
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
                    if (ws) {
                        const a = ws.deserializeAttachment() || {};
                        if (socketIdentityInvalid(a, env)) {
                            if (!a.sessionEnded) {
                                ws.serializeAttachment({ ...a, sessionEnded: true });
                                ws.close(4401, 'sign in again');
                                const ended = Promise.resolve().then(() => this.webSocketClose(ws)).catch(() => this.storageFailed());
                                this.state.waitUntil?.(ended);
                            }
                            return;
                        }
                        if (msg.t === 'admin' && env.HANGOUT_BETA_MODE === 'protected') {
                            this.sendPrivateAdmin(ws, id, msg);
                            return;
                        }
                        ws.send(JSON.stringify(msg));
                    }
                    else this.pendingAdmission.get(id)?.push(msg);
                },
                close: (id, code, reason) => { const ws = this.byId(id); if (ws) try { ws.close(code, reason); } catch (e) { /* gone */ } },
                persist: (kind, data) => {
                    if (['rooms', 'abuse', 'sessions', 'moderation-queue', 'net'].includes(kind)) return this.persistRequired(kind, data);
                    if (kind === 'ai-reviews') return this.persistState(kind, data);
                    if (kind === 'modlog') { this.logSeq = (this.logSeq || 0) + 1; this.persistState(`log:${String(Date.now()).padStart(15, '0')}:${crypto.randomUUID()}`, data); }
                },
                limits: { webJoinOrigins: String(env.WEBJAM_WEB_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean) }
            });
            this.engine.restore((await state.storage.get('net')) || {});
            this.engine.restoreAiReviews((await state.storage.get('ai-reviews')) || []);
            await this.engine.restoreModerationQueue((await state.storage.get('moderation-queue')) || {});
            const roomIndex = await state.storage.get('room-index');
            if (roomIndex !== undefined) {
                let records = roomIndex?.version === 1 && Array.isArray(roomIndex.names) && roomIndex.names.length <= 1030
                    && roomIndex.names.every((name) => /^#[a-z0-9-]{2,30}$/.test(name))
                    && new Set(roomIndex.names).size === roomIndex.names.length ? [] : null;
                let bytes = 32;
                if (records) for (const name of roomIndex.names) {
                    const record = await state.storage.get(`community-room:${name}`);
                    try { bytes += new TextEncoder().encode(JSON.stringify(record)).byteLength + 1; }
                    catch { records = null; break; }
                    if (bytes > LOBBY_LIMITS.roomStateBytes) { records = null; break; }
                    records.push(record);
                }
                await this.engine.restoreRooms(records ? { version: 1, rooms: records } : null);
            } else await this.engine.restoreRooms(await state.storage.get('rooms'));
            this.engine.restoreAbuse(await state.storage.get('abuse'));
            // Hibernation preserves the browser's actual connection. Restore metadata only:
            // never send hello/join or erase its connected-session scrollback on an idle wake.
            const live = [], sockets = new Map(), betaChecks = new Map();
            for (const ws of state.getWebSockets()) {
                const a = ws.deserializeAttachment() || {};
                if (!a.id) { ws.close(4401, 'session unavailable'); continue; }
                if (socketIdentityInvalid(a, env)) { ws.close(4401, 'sign in again'); continue; }
                if (env.HANGOUT_BETA_MODE === 'protected') {
                    if (!betaChecks.has(a.betaSid)) betaChecks.set(a.betaSid, activeBetaSession(env, a));
                    if (!await betaChecks.get(a.betaSid)) { ws.close(4401, 'beta session ended'); continue; }
                }
                live.push(a); sockets.set(a.id, ws);
            }
            const roomsBeforeResume = JSON.stringify(this.engine.roomSnapshot());
            const savedSessions = await state.storage.get('sessions');
            const restored = this.engine.restoreSessions(savedSessions, live);
            for (const rejected of restored.rejected) sockets.get(rejected.id)?.close(4401, rejected.reason);
            const currentRooms = this.engine.roomSnapshot();
            if (JSON.stringify(currentRooms) !== roomsBeforeResume) await this.persistRequired('rooms', currentRooms);
            const currentSessions = this.engine.sessionSnapshot();
            if (JSON.stringify(savedSessions) !== JSON.stringify(currentSessions)) await this.persistRequired('sessions', currentSessions);
            await this.engine.tick();
            await this.pruneLogs();
            const logs = await state.storage.list({ prefix: 'log:', reverse: true, limit: 2000 });
            this.engine.restoreLog([...logs.values()].reverse());
            if (!(await state.storage.getAlarm())) await state.storage.setAlarm(Date.now() + 60 * 1000);
        });
    }
    sendPrivateAdmin(ws, id, msg) {
        const original = ws.deserializeAttachment() || {};
        if (!original.admin || !['owner', 'band', 'moderator'].includes(original.role)
            || socketIdentityInvalid(original, this.env)) return;
        const generation = (this.privateAdminDispatch.get(ws) || 0) + 1;
        this.privateAdminDispatch.set(ws, generation);
        const task = (async () => {
            // A registry revocation can commit while its disconnect RPC waits
            // behind this Lobby event. Local socket metadata alone is not proof
            // that private evidence may still be delivered.
            const active = await activeBetaSession(this.env, original);
            if (this.privateAdminDispatch.get(ws) !== generation || this.byId(id) !== ws) return;
            const current = ws.deserializeAttachment() || {};
            if (socketIdentityInvalid(current, this.env) || !current.admin
                || !['owner', 'band', 'moderator'].includes(current.role)
                || ['id', 'betaSid', 'betaInviteVersion', 'expiresAt', 'role', 'email', 'admin']
                    .some(key => current[key] !== original[key])
                || ws.readyState !== undefined && ws.readyState !== 1) return;
            if (!active) {
                ws.serializeAttachment({ ...current, sessionEnded: true });
                ws.close(4401, 'sign in again');
                const ended = Promise.resolve().then(() => this.webSocketClose(ws)).catch(() => this.storageFailed());
                this.state.waitUntil?.(ended);
                return;
            }
            const now = Date.now();
            const privateReports = { ...this.privateReportState, reports: this.privateReportState.reports.filter(report =>
                Number.isFinite(report.at) && report.at <= now && now - report.at < PRIVATE_REPORT_LIMITS.ttlMs) };
            // Read the current queue only after authentication, and supersede
            // older checks so an old frame cannot restore dismissed evidence.
            ws.send(JSON.stringify({ ...msg, state: { ...msg.state, privateReports } }));
        })().catch(() => { /* No private evidence is sent on delivery failure. */ });
        this.state.waitUntil?.(task);
        return task;
    }
    async refreshPrivateReports(notify = true) {
        if (!this.privateReportQueue) return;
        const cleanup = await this.privateReportQueue.prune();
        const result = await this.privateReportQueue.snapshot();
        this.privateReportState = result.ok
            ? { storage: cleanup.ok ? result.storage : 'unavailable', reports: result.reports }
            : { storage: 'unavailable', reports: [] };
        if (notify) this.engine?.notifyAiStatus();
    }
    async resolvePrivateReport({ connection, action, id }) {
        const ws = this.byId(connection);
        const a = ws?.deserializeAttachment() || {};
        if (!this.privateReportQueue || !a.admin || !['owner', 'band', 'moderator'].includes(a.role)
            || socketIdentityInvalid(a, this.env) || !await activeBetaSession(this.env, a)) return { ok: false };
        const current = ws.deserializeAttachment() || {};
        if (socketIdentityInvalid(current, this.env) || current.betaSid !== a.betaSid
            || ws.readyState !== undefined && ws.readyState !== 1) return { ok: false };
        const result = await this.privateReportQueue.resolve(id, action);
        await this.refreshPrivateReports();
        return result;
    }
    async receivePrivateReport(request) {
        if (this.env.HANGOUT_BETA_MODE !== 'protected' || request.method !== 'POST' || !this.privateReportQueue) {
            return privateReportResponse({ ok: false, error: 'unavailable', status: 503 });
        }
        let beta, body;
        const room = request.headers.get('X-Hangout-Private-Room');
        try {
            beta = JSON.parse(request.headers.get('X-Hangout-Beta-Session'));
            const text = await request.text();
            if (new TextEncoder().encode(text).byteLength > 8192) throw new Error('request');
            body = JSON.parse(text);
        } catch { return privateReportResponse({ ok: false, error: 'invalid-report', status: 400 }); }
        if (!validBetaSession(beta, this.env) || !/^[0-9a-f]{64}$/.test(room || '')
            || !await activeBetaSession(this.env, beta)) return privateReportResponse({ ok: false, error: 'unavailable', status: 503 });
        const checked = validatePrivateReportControl(body?.report);
        if (!checked.ok) return privateReportResponse({ ok: false, error: 'invalid-report', status: 400 });
        const reporterRef = await privateReportRef('reporter', beta.betaSid, this.env.HANGOUT_HMAC_KEY);
        const roomRef = await privateReportRef('room', room, this.env.HANGOUT_HMAC_KEY);
        if (body?.provenance?.reporterRef !== reporterRef || body.provenance.roomRef !== roomRef
            || !validBetaSession(beta, this.env)) return privateReportResponse({ ok: false, error: 'invalid-report', status: 400 });
        const result = await this.privateReportQueue.submit(checked.report, body.provenance);
        await this.refreshPrivateReports();
        return privateReportResponse(result);
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
            const betaChecks = new Map();
            for (const ws of this.state.getWebSockets()) {
                const a = ws.deserializeAttachment() || {};
                let ended = socketIdentityInvalid(a, this.env);
                if (!ended && this.env.HANGOUT_BETA_MODE === 'protected') {
                    if (!betaChecks.has(a.betaSid)) betaChecks.set(a.betaSid, activeBetaSession(this.env, a));
                    ended = !await betaChecks.get(a.betaSid);
                }
                if (ended) { ws.close(4401, 'sign in again'); await this.engine.disconnect(a.id); }
            }
            await this.engine.tick(); await this.pruneLogs();
            await this.refreshPrivateReports();
            await this.state.storage.setAlarm(Date.now() + 60000);
        });
    }
    async fetch(request) {
        await this.ready;
        if (new URL(request.url).pathname === '/__beta/private-report') {
            return this.state.blockConcurrencyWhile(() => this.receivePrivateReport(request));
        }
        if (new URL(request.url).pathname === INTERNAL_HEALTH_PATH) {
            if (this.env.HANGOUT_BETA_MODE !== 'protected' || request.method !== 'GET') return new Response('not found', { status: 404 });
            return this.state.blockConcurrencyWhile(async () => {
                try {
                    // Ordinary wake/restore already ran. This read neither spends
                    // allowance nor applies any administrative/moderation action.
                    const net = this.engine.snapshot();
                    return healthJson({ storage: 'ok', lock: net.lock, shield: net.shield, lockAuto: net.lockAuto, evidenceStorage: this.evidenceStorage,
                        quota: (() => { const daily = dailyUsage(net.budget, 'requests'); return daily && { ...daily, limit: LOBBY_LIMITS.requestBudget }; })(),
                        ai: aiHealth(this.env, await this.state.storage.get('ai-usage'), this.aiModerator.status()) });
                } catch { return healthJson({ storage: 'unavailable' }, 503); }
            });
        }
        let identity;
        try { identity = JSON.parse(request.headers.get('X-Hangout-Identity')); } catch (e) { return new Response('no', { status: 400 }); }
        if (this.env.PILOT_MODE === 'protected' && new URL(request.url).pathname === '/__pilot/disconnect' && request.method === 'POST' && /^[a-z0-9-]{16,64}$/.test(identity?.pilotSid || '')) {
            return this.state.blockConcurrencyWhile(async () => {
                for (const ws of this.state.getWebSockets()) {
                    const a = ws.deserializeAttachment() || {};
                    if (a.pilotSid === identity.pilotSid) { ws.close(4401, 'pilot identity changed'); await this.engine.disconnect(a.id); }
                }
                return new Response('ok');
            });
        }
        if (this.env.HANGOUT_BETA_MODE === 'protected' && new URL(request.url).pathname === '/__beta/disconnect' && request.method === 'POST' && /^[a-z0-9-]{16,64}$/.test(identity?.betaSid || '')) {
            return this.state.blockConcurrencyWhile(async () => {
                for (const ws of this.state.getWebSockets()) {
                    const a = ws.deserializeAttachment() || {};
                    if (a.betaSid === identity.betaSid) { ws.serializeAttachment({ ...a, betaEnded: true }); ws.close(4401, 'beta session ended'); await this.engine.disconnect(a.id); }
                }
                return new Response('ok');
            });
        }
        return this.state.blockConcurrencyWhile(async () => {
        if (!identity || !identity.dev) return new Response('no', { status: 400 });
        if (socketIdentityInvalid(identity, this.env)) return new Response('session required', { status: 403 });
        if (this.env.HANGOUT_BETA_MODE === 'protected' && !await activeBetaSession(this.env, identity)) return new Response('beta session required', { status: 403 });
        if (socketIdentityInvalid(identity, this.env)) return new Response('session required', { status: 403 });
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
        pair[1].serializeAttachment({ id, pilotSid: this.env.PILOT_MODE === 'protected' ? identity.pilotSid : undefined,
            betaSid: this.env.HANGOUT_BETA_MODE === 'protected' ? identity.betaSid : undefined,
            betaInviteVersion: this.env.HANGOUT_BETA_MODE === 'protected' ? identity.betaInviteVersion : undefined,
            dev: identity.dev, iph: identity.iph, role: identity.role, email: identity.email, account: identity.account, expiresAt: identity.expiresAt, admin: identity.admin });
        if (identity.devToken) pair[1].send(JSON.stringify({ t: 'device', token: identity.devToken }));
        for (const frame of initialFrames) {
            if (frame.t === 'admin' && this.env.HANGOUT_BETA_MODE === 'protected') this.sendPrivateAdmin(pair[1], id, frame);
            else pair[1].send(JSON.stringify(frame));
        }
        return new Response(null, { status: 101, webSocket: pair[0] });
        });
    }
    async webSocketMessage(ws, raw) {
        await this.ready;
        return this.state.blockConcurrencyWhile(async () => {
            const a = ws.deserializeAttachment() || {};
            if (socketIdentityInvalid(a, this.env)) { ws.close(4401, 'sign in again'); return this.engine.disconnect(a.id); }
            const result = await this.engine.message(this.state.getTags(ws)[0], typeof raw === 'string' ? raw : '');
            if (result?.privateReportAction) {
                let resolved;
                try { resolved = await this.resolvePrivateReport(result.privateReportAction); }
                catch { resolved = { ok: false }; }
                return this.engine.completePrivateReportAction(a.id, resolved);
            }
            return result;
        });
    }
    async webSocketClose(ws) { await this.ready; return this.state.blockConcurrencyWhile(() => Promise.resolve(this.engine.disconnect(this.state.getTags(ws)[0]))); }
    async webSocketError(ws) { return this.webSocketClose(ws); }
}
