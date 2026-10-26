// The #stalemate lobby Durable Object + its Worker-side admission. Everything that can be refused is refused here,
// before a DO request is spent. Missing config/secrets => 503 (fail closed).
import { originAllowed, previewKeyOk } from './core.mjs';
import { accountId, accessConfigured, hmacKeyOk, ipHash, newDeviceId, roleForEmail, signDevice, verifyAccessJwt, verifyDevice } from './auth.mjs';
import { createLobby, LOBBY_LIMITS } from './lobby-core.mjs';
import { LOG_TTL } from './community-state.mjs';
import { createAiModerator } from './ai-moderation.mjs';
import { aiEligibility } from './ai-eligibility.mjs';
import { activeBetaSession, validBetaSession } from './beta-session-client.mjs';
import { INTERNAL_HEALTH_PATH, aiHealth, dailyUsage, healthJson } from './beta-ops.mjs';
import { createPrivateReportQueue, privateReportRef, validatePrivateReportControl, LIMITS as PRIVATE_REPORT_LIMITS } from './private-reports.mjs';
import { createSocketDelivery } from './socket-delivery.mjs';
import { createTransportControlBudget } from './transport-budget.mjs';
import { createPresenceProjections } from './presence-projections.mjs';
import { entrySitesFromConfig } from '../../r/45662413410ed051/entry-sites.mjs';
import { lobbyAuthorityMode, createLobbySessionAuthority, createLobbyAuthorityStorage, initializeLobbySessionAuthority, migrateLobbySessionAuthority, LOBBY_AUTHORITY_MARKER, LOBBY_AUTHORITY_PATH } from './lobby-session-authority.mjs';
import { createLobbyParticipation, lobbyParticipationMode, participationConfigurationValid } from './lobby-participation.mjs';
import { PARTICIPATION_POLICY_KEY } from './participation-partitions.mjs';
import { lobbyIncidentSourceMode, incidentSourceConfigurationValid } from './lobby-incident-sources.mjs';

const privateReportResponse = (value) => new Response(JSON.stringify(value), {
    status: value.ok ? 200 : Number.isInteger(value.status) ? value.status : 503,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});
async function legacyRegistrySnapshot(env) {
    if (!env.BETA_SESSIONS) throw Error('old registry unavailable');
    const controller = new AbortController(); let timer, reader;
    const pending = (async () => {
        const response = await env.BETA_SESSIONS.get(env.BETA_SESSIONS.idFromName('global')).fetch(new Request('https://registry/__beta/migration-export', { signal: controller.signal }));
        if (!response.ok || !response.body) throw Error('old registry unavailable');
        reader = response.body.getReader(); const decoder = new TextDecoder(); let text = '', size = 0;
        while (true) {
            const part = await reader.read(); if (part.done) break;
            size += part.value.byteLength; if (size > 2 * 1024 * 1024) throw Error('old registry capacity'); text += decoder.decode(part.value, { stream: true });
        }
        return JSON.parse(text + decoder.decode());
    })();
    // A late timed-out export can never enter the migration transaction.
    pending.catch(() => {});
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(Error('old registry timeout')), 8000); });
    try { return await Promise.race([pending, deadline]); }
    finally { clearTimeout(timer); controller.abort(); reader?.cancel().catch(() => {}); }
}

export function lobbyConfigured(env = {}) {
    return !!(participationConfigurationValid(env) && incidentSourceConfigurationValid(env) && env.LOBBY && env.QUOTA && hmacKeyOk(env.HANGOUT_HMAC_KEY) && typeof env.HANGOUT_PREVIEW_KEY === 'string' && env.HANGOUT_TURNSTILE_SECRET);
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
// Pending retirement entries come only from already-admitted bindings/members.
// A failed semantic removal must retain its durable lifecycle fence for recovery.
const CLOSED_RETIREMENT_BATCH = 16;
const retirementDegraded = lobby => { try { lobby.storageFailed?.(); } catch { /* keep cleanup retryable */ } };
function rememberRetirement(lobby, id, sid = '') {
    lobby.pendingClosed ||= new Map();
    if (lobby.pendingClosed.has(id)) return lobby.pendingClosed.get(id);
    const binding = lobby.liveBindings?.get(id);
    const member = binding ? null : lobby.engine?.sessionSnapshot?.().connections.find(value => value.id === id);
    if (!binding && !member) return null;
    const entry = { id, sid: binding?.betaSid || member?.betaSid || sid, disconnected: false, retryUsed: false, needsRetry: false, running: false };
    lobby.pendingClosed.set(id, entry); return entry;
}
function closeTransport(lobby, ws, code, reason = '', extra = {}) {
    lobby.closedSockets ||= new WeakSet(); lobby.closedSockets.add(ws);
    let attachment = {}; try { attachment = ws.deserializeAttachment?.() || {}; } catch { /* WeakSet still fences queued frames */ }
    let id = attachment.id; if (!id) try { id = lobby.state.getTags(ws)[0]; } catch { /* no new untrusted retirement entry */ }
    const entry = rememberRetirement(lobby, id, attachment.betaSid || '');
    try { ws.serializeAttachment({ ...attachment, ...extra, sessionEnded: true }); } catch { /* WeakSet is the local fail-closed fallback */ }
    lobby.liveBindings?.delete(id); lobby.delivery.forget(ws);
    let acknowledged = true;
    try { if (ws.readyState !== 3) { if (reason) ws.close(code, reason); else ws.close(code); } } catch { acknowledged = false; }
    return { entry, acknowledged };
}
async function retireClosed(lobby, entry, gate, retry = false) {
    if (!entry) return true;
    if (entry.running || entry.needsRetry && !retry) return false;
    entry.running = true;
    try {
        if (!entry.disconnected) {
            const result = await lobby.engine.disconnect(entry.id);
            if (result?.ok === false) { entry.needsRetry = true; entry.retryAfter = gate; retirementDegraded(lobby); return false; }
            entry.disconnected = true; // undefined is the existing successful return.
        }
        if (lobby.authorityMode && (await lobby.authority.unbind(entry.id))?.ok === false) { entry.needsRetry = true; entry.retryAfter = gate; retirementDegraded(lobby); return false; }
        lobby.pendingClosed.delete(entry.id); return true;
    } catch (error) { entry.needsRetry = true; entry.retryAfter = gate; if (error?.overloaded === true) entry.retryUsed = true; retirementDegraded(lobby); return false; }
    finally { entry.running = false; }
}
function pendingSid(lobby, sid) { return [...(lobby.pendingClosed?.values() || [])].some(entry => entry.sid === sid); }
function queueRetirementRetry(lobby) {
    if (lobby.retirementRetryScheduled || lobby.authorityUnavailable) return;
    const selected = [...(lobby.pendingClosed?.values() || [])].filter(entry => entry.needsRetry && !entry.retryUsed && !entry.running && entry.retryAfter?.settled !== false).slice(0, CLOSED_RETIREMENT_BATCH);
    if (!selected.length) return;
    // Consume the one background attempt before dispatch. No completion handler
    // recursively schedules another attempt; the ordinary alarm is the fallback.
    for (const entry of selected) entry.retryUsed = true;
    lobby.retirementRetryScheduled = true;
    let task;
    try { task = retirementGate(lobby, async gate => {
        for (const entry of selected) if (lobby.pendingClosed.get(entry.id) === entry) await retireClosed(lobby, entry, gate, true);
    }, false); } catch { lobby.retirementRetryScheduled = false; retirementDegraded(lobby); return; }
    const finished = Promise.resolve(task).catch(() => retirementDegraded(lobby)).finally(() => { lobby.retirementRetryScheduled = false; });
    lobby.state.waitUntil?.(finished);
}
function retirementGate(lobby, operation, retry = true) {
    // Publish the owner token before invoking even a synchronous/reentrant gate.
    // Another completed event cannot retry this entry until its failed owner
    // promise has settled. Never await a new cleanup gate from inside that owner.
    const gate = { settled: false };
    let task;
    try { task = lobby.state.blockConcurrencyWhile(() => operation(gate)); }
    catch (error) { gate.settled = true; throw error; }
    const settled = Promise.resolve(task).then(() => { gate.settled = true; if (retry) queueRetirementRetry(lobby); },
        () => { gate.settled = true; if (retry) queueRetirementRetry(lobby); });
    lobby.state.waitUntil?.(settled); return task;
}
export class HangoutLobby {
    constructor(state, env) {
        this.state = state;
        this.env = env;
        this.pendingAdmission = new Map();
        this.closedSockets = new WeakSet();
        this.pendingClosed = new Map();
        this.retirementRetryScheduled = false;
        this.presence = createPresenceProjections({
            flush: batch => this.engine.flushPresence(batch),
            serialize: async fn => { await this.ready; return this.state.blockConcurrencyWhile(async () => fn()); }
        });
        this.controlBudget = createTransportControlBudget({
            reserve: id => this.engine.reserveTransportControl(id),
            available: id => this.engine.transportControlReady(id),
            readState: ws => ws.deserializeAttachment()?.controlGrant,
            writeState: (ws, controlGrant) => ws.serializeAttachment({ ...(ws.deserializeAttachment() || {}), controlGrant })
        });
        this.delivery = createSocketDelivery({
            readState: ws => ws.deserializeAttachment()?.delivery,
            writeState: (ws, delivery) => ws.serializeAttachment({ ...(ws.deserializeAttachment() || {}), delivery }),
            onClosed: ws => {
                // Retire membership without waiting for a slow peer's close handshake.
                // Scheduling preserves the current engine command's commit/flush ordering.
                const ended = Promise.resolve().then(() => this.webSocketClose(ws)).catch(() => this.storageFailed());
                this.state.waitUntil?.(ended);
            }
        });
        this.evidenceStorage = 'ready';
        this.storageFailureToken = {}; // Opaque identity; never wraps or enters durable state.
        this.privateReportState = { storage: 'disabled', reports: [] };
        this.privateAdminDispatch = new WeakMap();
        this.authorityMode = lobbyAuthorityMode(env);
        this.liveBindings = new Map();
        this.ready = state.blockConcurrencyWhile(async () => {
            try { await this.start(); }
            catch (error) { if (!this.authorityMode) throw error; this.storageFailureToken = {}; this.authorityUnavailable = true; this.evidenceStorage = 'degraded'; }
        });
    }
    async start() {
        const state = this.state, env = this.env;
        try { this.participationMode = lobbyParticipationMode(env); this.incidentSourceMode = lobbyIncidentSourceMode(env); }
        catch { this.authorityUnavailable = true; return; }
        if (env.HANGOUT_SESSION_AUTHORITY && !this.authorityMode) { this.authorityUnavailable = true; return; }
        if (this.authorityMode && env.HANGOUT_BETA_MODE !== 'protected') { this.authorityUnavailable = true; return; }
        this.authorityUnavailable = false;
        let recovered;
        if (this.authorityMode) {
            this.authority = createLobbySessionAuthority({ storage: state.storage, env });
            recovered = await this.authority.load();
            this.liveBindings.clear();
            for (const { binding, active } of recovered.bindings) if (active) this.liveBindings.set(binding.id, binding);
        }

        // Fence mode removal before ANY legacy fallback, including beta-mode removal. Any strict
        // authority marker (including domains without C2) forbids legacy fallback. Read the
        // same physical authority namespace before any legacy initialization.
        if (!this.participationMode && !this.authorityMode) {
            try {
                const records = createLobbyAuthorityStorage(state.storage);
                if (await records.transaction(async tx => await tx.get(LOBBY_AUTHORITY_MARKER) !== undefined || await tx.get(PARTICIPATION_POLICY_KEY) !== undefined)) { this.authorityUnavailable = true; return; }
            } catch { this.authorityUnavailable = true; return; }
        }

        // Only the separate authenticated pilot can initialize its first empty network.
        // A later missing/corrupt record still restores fail-closed after this sentinel exists.
        const bootstrapKey = env.HANGOUT_BETA_MODE === 'protected' ? 'beta-initialized' : 'pilot-initialized';
        if (!this.authorityMode && (env.PILOT_MODE === 'protected' || env.HANGOUT_BETA_MODE === 'protected') && !(await state.storage.get(bootstrapKey))) {
            await state.storage.transaction(async (txn) => {
                if ((await txn.get('net')) === undefined && (await txn.get('room-index')) === undefined) await txn.put('net', { lock: 'off' });
                await txn.put(bootstrapKey, true);
            });
        }
        if (env.HANGOUT_BETA_MODE === 'protected') {
            this.privateQueueActor = { kind: 'maintenance' };
            this.privateReportQueue = createPrivateReportQueue({ storage: this.authorityMode ? this.authority.privateStorage(() => this.privateQueueActor) : state.storage });
            await this.refreshPrivateReports(false);
        }
        const eligibility = aiEligibility(env);
        this.aiModerator = createAiModerator({
            enabled: eligibility.allowed && !this.authorityMode,
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
            incidentSources: !!this.incidentSourceMode,
            ...(this.authorityMode ? { effectCommit: this.authority.effectCommit } : {}),
            ...(this.participationMode ? { participation: createLobbyParticipation({ env, authority: this.authority }) } : {}),
            deferPresence: marker => this.presence.mark(marker),
            aiModerationStatus: () => ({ ...this.aiModerator.status(), requested: eligibility.requested,
                ...(eligibility.requested && !eligibility.allowed ? { state: 'not-qualified' } : {}),
                eligibility, evidenceStorage: this.evidenceStorage }),
            reviewPublicText: eligibility.allowed && !this.authorityMode ? ({ id, text }) => {
                const task = this.aiModerator.review({ text }).then((result) => this.engine.applyAiReview(id, result));
                this.state.waitUntil?.(task);
                return task;
            } : undefined,
            send: (id, msg) => {
                const ws = this.byId(id);
                if (ws) {
                    if (this.closedSockets.has(ws)) return;
                    const a = ws.deserializeAttachment() || {};
                    if (socketIdentityInvalid(a, env) || this.authorityMode && !this.bindingLive(a)) {
                        if (!a.sessionEnded) {
                            closeTransport(this, ws, 4401, 'sign in again');
                            const ended = Promise.resolve().then(() => this.webSocketClose(ws)).catch(() => this.storageFailed());
                            this.state.waitUntil?.(ended);
                        }
                        return;
                    }
                    if (msg.t === 'admin' && env.HANGOUT_BETA_MODE === 'protected') {
                        this.sendPrivateAdmin(ws, id, msg);
                        return;
                    }
                    this.delivery.send(ws, msg);
                }
                else this.pendingAdmission.get(id)?.push(msg);
            },
            close: (id, code, reason) => { const ws = this.byId(id); if (ws) { this.delivery.forget(ws); try { ws.close(code, reason); } catch (e) { /* gone */ } } },
            persist: (kind, data) => {
                if (['rooms', 'abuse', 'sessions', 'moderation-queue', 'net'].includes(kind)) return this.persistRequired(kind, data);
                if (kind === 'ai-reviews') return this.persistState(kind, data);
                if (kind === 'modlog') { this.logSeq = (this.logSeq || 0) + 1; this.persistState(`log:${String(Date.now()).padStart(15, '0')}:${crypto.randomUUID()}`, data); }
            },
            limits: { webJoinOrigins: String(env.WEBJAM_WEB_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean), entrySites: entrySitesFromConfig(env.HANGOUT_ENTRY_SITES) }
        });
        this.engine.restore(recovered ? recovered.state.net : (await state.storage.get('net')) || {});
        const confirmRestore = async task => { const result = await task; if (this.authorityMode && result?.ok === false) throw Error('authority restore unavailable'); return result; };
        await confirmRestore(this.engine.restoreAiReviews(recovered ? recovered.state.aiReviews : (await state.storage.get('ai-reviews')) || []));
        await confirmRestore(this.engine.restoreModerationQueue(recovered ? recovered.state.moderationQueue : (await state.storage.get('moderation-queue')) || {}));
        const roomIndex = recovered ? undefined : await state.storage.get('room-index');
        if (recovered) await confirmRestore(this.engine.restoreRooms(recovered.state.rooms));
        else if (roomIndex !== undefined) {
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
        this.engine.restoreAbuse(recovered ? recovered.state.abuse : await state.storage.get('abuse'));
        // Hibernation preserves the browser's actual connection. Restore metadata only:
        // never send hello/join or erase its connected-session scrollback on an idle wake.
        const live = [], sockets = new Map(), betaChecks = new Map();
        for (const ws of state.getWebSockets()) {
            const a = ws.deserializeAttachment() || {};
            if (!a.id) { ws.close(4401, 'session unavailable'); continue; }
            if (this.closedSockets.has(ws) || socketIdentityInvalid(a, env) || this.authorityMode && !this.bindingLive(a)) { ws.close(4401, 'sign in again'); continue; }
            if (env.HANGOUT_BETA_MODE === 'protected') {
                if (!betaChecks.has(this.authorityMode ? a.id : a.betaSid)) betaChecks.set(this.authorityMode ? a.id : a.betaSid, this.sessionActive(a));
                if (!await betaChecks.get(this.authorityMode ? a.id : a.betaSid)) { ws.close(4401, 'beta session ended'); continue; }
            }
            if (!this.delivery.adopt(ws)) continue;
            live.push(a); sockets.set(a.id, ws);
        }
        const roomsBeforeResume = JSON.stringify(this.engine.roomSnapshot());
        const savedSessions = recovered ? recovered.state.sessions : await state.storage.get('sessions');
        const restored = this.engine.restoreSessions(savedSessions, live);
        for (const rejected of restored.rejected) {
            const ws = sockets.get(rejected.id);
            if (ws) { this.delivery.forget(ws); ws.close(4401, rejected.reason); }
        }
        if (this.participationMode) await confirmRestore(this.engine.refreshParticipation());
        const currentRooms = this.engine.roomSnapshot();
        if (JSON.stringify(currentRooms) !== roomsBeforeResume) await this.persistRequired('rooms', currentRooms);
        const currentSessions = this.engine.sessionSnapshot();
        if (JSON.stringify(savedSessions) !== JSON.stringify(currentSessions)) await this.persistRequired('sessions', currentSessions);
        if (recovered) {
            const resumed = new Set(restored.resumed);
            // Confirm the pruned durable session snapshot BEFORE retiring the
            // bindings that authorize its removal. A failed write retains them.
            for (const { binding } of recovered.bindings) if (!resumed.has(binding.id)) {
                this.liveBindings.delete(binding.id); await this.authority.unbind(binding.id); this.pendingClosed.delete(binding.id);
            }
        }
        await confirmRestore(this.engine.tick());
        await this.pruneLogs();
        if (recovered) this.engine.restoreLog(recovered.state.modlog);
        else { const logs = await state.storage.list({ prefix: 'log:', reverse: true, limit: 2000 }); this.engine.restoreLog([...logs.values()].reverse()); }
        if (this.authorityMode) { await this.authority.schedule(); this.privateQueueActor = null; }
        else if (!(await state.storage.getAlarm())) await state.storage.setAlarm(Date.now() + 60 * 1000);
    }

    bindingLive(value) {
        if (this.authorityUnavailable) return false;
        const saved = this.liveBindings.get(value.id);
        return !!saved && saved.expiresAt > Date.now() && ['id', 'betaSid', 'betaInviteVersion', 'dev', 'iph', 'account', 'role', 'admin', 'expiresAt', 'authorityRef', 'authorityRevision']
            .every(key => saved[key] === value[key]);
    }
    async sessionActive(value) {
        if (!this.authorityMode) return activeBetaSession(this.env, value);
        try {
            if (value.id) return await this.authority.validate(value);
            return !!await this.authority.check({ sid: value.betaSid, version: value.betaInviteVersion, exp: value.expiresAt });
        } catch {
            // An unavailable/corrupt strict authority is different from an
            // ordinary validation denial or a controlled retirement refusal.
            this.authorityUnavailable = true; this.storageFailed(); return false;
        }
    }
    async closeLocalSession(sid, gate, attempted) {
        for (const [id, binding] of this.liveBindings) if (binding.betaSid === sid) {
            rememberRetirement(this, id, sid); this.liveBindings.delete(id);
        }
        let closed = true;
        for (const ws of this.state.getWebSockets()) {
            const attachment = ws.deserializeAttachment() || {};
            if (attachment.betaSid !== sid) continue;
            if (!closeTransport(this, ws, 4401, 'beta session ended', { betaEnded: true }).acknowledged) closed = false;
        }
        const selected = [...(this.pendingClosed?.values() || [])].filter(entry => entry.sid === sid && !attempted?.has(entry.id))
            .slice(0, Math.max(0, CLOSED_RETIREMENT_BATCH - (attempted?.size || 0)));
        for (const entry of selected) { attempted?.add(entry.id); if (!await retireClosed(this, entry, gate, !!attempted)) closed = false; }
        return closed && !pendingSid(this, sid);
    }
    async closeAuthoritySession(record, localClosed) {
        // Called only AFTER the authority gate has returned. No self-RPC and no
        // authority lock spans remote Room fanout or a stalled target.
        const controller = new AbortController(); let timer;
        const calls = record.rooms.map(room => () => this.env.ROOMS.get(this.env.ROOMS.idFromName(room)).fetch(new Request('https://session/__beta/disconnect', {
            method: 'POST', headers: { 'X-Hangout-Identity': JSON.stringify({ betaSid: record.sid }) }, signal: controller.signal
        })));
        const completed = Promise.allSettled(calls.map(call => Promise.resolve().then(call))).then(results => localClosed && results.every(result => result.status === 'fulfilled' && result.value.ok));
        const deadline = new Promise(resolve => { timer = setTimeout(() => { resolve(false); controller.abort(); }, 8000); });
        let closed;
        try { closed = await Promise.race([completed, deadline]); } finally { clearTimeout(timer); }
        if (!closed || pendingSid(this, record.sid)) return false;
        await this.state.blockConcurrencyWhile(async () => {
            try { if (pendingSid(this, record.sid)) { closed = false; return; } await this.authority.confirmClosed(record); } catch { closed = false; }
        });
        return closed;
    }
    async authorityRequest(request, operation) {
        const reply = (status, reason, extra = {}) => Response.json({ reason, ...extra }, { status, headers: { 'Cache-Control': 'no-store' } });
        if (!participationConfigurationValid(this.env)) return reply(503, 'participation authority unavailable');
        if (!incidentSourceConfigurationValid(this.env)) return reply(503, 'incident source authority unavailable');
        if (!this.authorityMode || this.env.HANGOUT_BETA_MODE !== 'protected') return reply(404, 'not found');
        if (operation === 'health' && request.method === 'GET') {
            if (this.authorityUnavailable) return healthJson({ storage: 'unavailable' }, 503);
            try { return healthJson({ storage: 'ok', quota: await this.authority.health() }); } catch { return healthJson({ storage: 'unavailable' }, 503); }
        }
        if (request.method !== 'POST') return reply(405, 'POST required');
        let body;
        try { const text = await request.text(); if (new TextEncoder().encode(text).byteLength > 2048) return reply(413, 'request too large'); body = JSON.parse(text); }
        catch { return reply(400, 'request'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, 'request');
        // Bound-only application migration controls. Neither gateway forwards
        // these paths. The caller owns independently verified writer drain.
        if (['initialize', 'migrate', 'rotate'].includes(operation)) {
            let registrySnapshot;
            if (operation === 'migrate') {
                try {
                    registrySnapshot = await legacyRegistrySnapshot(this.env);
                } catch { return reply(503, 'old registry export unavailable'); }
            }
            return this.state.blockConcurrencyWhile(async () => {
                // Export happens outside this gate. Preserve the health at gate
                // entry, including any newer quarantine while export waited.
                const healthyBefore = !this.authorityUnavailable && !!this.engine;
                const previousEngine = this.engine, failureToken = this.storageFailureToken;
                const quiescent = () => this.state.getWebSockets().length === 0 && this.liveBindings.size === 0
                    && this.pendingAdmission.size === 0 && this.pendingClosed.size === 0 && !this.retirementRetryScheduled;
                const initializingQuarantine = operation === 'initialize' && !previousEngine && this.authorityUnavailable === true;
                let restoring = false, knownNew = false;
                try {
                    knownNew = initializingQuarantine && quiescent();
                    if (initializingQuarantine && !knownNew) return reply(503, 'authority initialize unavailable');
                    if (this.state.getWebSockets().some(ws => ws.readyState === undefined || ws.readyState === 1)) return reply(409, 'live Lobby sockets require drain');
                    if (operation === 'rotate') {
                        this.authority ||= createLobbySessionAuthority({ storage: this.state.storage, env: this.env });
                        const result = await this.authority.rotate(body.version); if (result.status !== 200) return reply(result.status, result.reason);
                    } else if (operation === 'initialize') {
                        const fresh = createLobby({ now: () => Date.now() });
                        await initializeLobbySessionAuthority({ storage: this.state.storage, env: this.env, state: {
                            net: fresh.snapshot(), rooms: fresh.roomSnapshot(), abuse: fresh.abuseSnapshot(), sessions: fresh.sessionSnapshot(),
                            moderationQueue: { reports: [], held: [] }, aiReviews: [], modlog: []
                        } });
                    } else await migrateLobbySessionAuthority({ storage: this.state.storage, env: this.env, registrySnapshot });
                    restoring = true; await this.start();
                    if (this.authorityUnavailable || !this.engine) return reply(503, 'authority restore unavailable');
                    if (knownNew) {
                        // Only this successful empty-domain transaction can
                        // retire the known-empty constructor quarantine. No
                        // prior engine means no detached engine/provider work.
                        // Queue failures may be encoded rather than thrown.
                        if (this.engine === previousEngine || this.storageFailureToken !== failureToken
                            || this.privateQueueActor !== null || this.privateReportQueue?.status().storage !== 'ready'
                            || this.privateReportState.storage !== 'ready' || !quiescent()) {
                            this.authorityUnavailable = true;
                            return reply(503, 'authority restore unavailable');
                        }
                        this.evidenceStorage = 'ready';
                    }
                    return reply(200, operation + ' complete');
                } catch {
                    // A duplicate/refused owner control is not evidence that
                    // an already healthy domain became corrupt. Verify durable
                    // integrity before retaining that existing running state.
                    this.authorityUnavailable = true;
                    if (healthyBefore && !restoring) try { await this.authority.load(); this.authorityUnavailable = false; } catch { /* remains closed */ }
                    return reply(503, 'authority migration unavailable');
                }
            });
        }
        if (this.authorityUnavailable) return reply(503, 'authority unavailable');
        let closing, localClosed;
        const response = await retirementGate(this, async gate => {
            try {
                if (operation === 'participation' || operation === 'participation-stop') {
                    if (!this.participationMode) return reply(404, 'not found');
                    const keys = operation === 'participation' ? ['sid', 'version', 'exp'] : ['sid', 'version', 'exp', 'request'];
                    if (Object.keys(body).length !== keys.length || keys.some(key => !Object.hasOwn(body, key))) return reply(400, 'request');
                    const result = await this.authority.ownParticipation(body);
                    if (operation === 'participation-stop' && result.state === 'withdrawn') {
                        // Reduction is already durably committed. Failed local
                        // cleanup cannot restore a grant or become a false ack.
                        let cleanup = 'confirmed';
                        try { const refreshed = await this.engine.refreshParticipation(); if (refreshed?.ok === false) cleanup = 'unconfirmed'; }
                        catch { cleanup = 'unconfirmed'; }
                        return reply(200, 'sharing withdrawn', { ...result, cleanup });
                    }
                    return reply(200, 'own sharing', result);
                }
                if (operation === 'register') { const result = await this.authority.register(body); return reply(result.status, result.reason); }
                if (operation === 'check') { const result = await this.authority.check(body); return result ? reply(200, result.reason, { profile: result.profile }) : reply(403, 'expired or revoked'); }
                if (operation === 'room') { const result = await this.authority.room(body); return reply(result.status, result.reason); }
                if (operation === 'revoke') {
                    closing = await this.authority.revoke(body); if (!closing) return reply(403, 'expired or revoked');
                    // Tombstone is already committed. Subsequent scheduling or
                    // close failure must not resurrect this SID.
                    for (const [id, binding] of this.liveBindings) if (binding.betaSid === closing.sid) { rememberRetirement(this, id, closing.sid); this.liveBindings.delete(id); }
                    await this.authority.schedule(); localClosed = await this.closeLocalSession(closing.sid, gate); return null;
                }
                return reply(404, 'not found');
            } catch { return reply(503, 'authority unavailable'); }
        });
        if (response) return response;
        try { return await this.closeAuthoritySession(closing, localClosed) ? reply(200, 'revoked and closed') : reply(503, 'session revoked; closure retry queued'); }
        catch { return reply(503, 'session revoked; closure retry queued'); }
    }

    sendPrivateAdmin(ws, id, msg) {
        if (this.closedSockets.has(ws)) return;
        const original = ws.deserializeAttachment() || {};
        if (this.engine?.privateAdminReady?.(id) !== true) return;
        if (!original.admin || !['owner', 'band', 'moderator'].includes(original.role)
            || socketIdentityInvalid(original, this.env)) return;
        const generation = (this.privateAdminDispatch.get(ws) || 0) + 1;
        this.privateAdminDispatch.set(ws, generation);
        const run = async () => {
            // A registry revocation can commit while its disconnect RPC waits
            // behind this Lobby event. Local socket metadata alone is not proof
            // that private evidence may still be delivered.
            const active = await this.sessionActive(original);
            if (this.closedSockets.has(ws) || this.privateAdminDispatch.get(ws) !== generation || this.byId(id) !== ws
                || this.engine?.privateAdminReady?.(id) !== true) return;
            const current = ws.deserializeAttachment() || {};
            if (socketIdentityInvalid(current, this.env) || !current.admin
                || this.authorityMode && !this.bindingLive(current)
                || !['owner', 'band', 'moderator'].includes(current.role)
                || ['id', 'betaSid', 'betaInviteVersion', 'expiresAt', 'role', 'email', 'admin']
                    .some(key => current[key] !== original[key])
                || ws.readyState !== undefined && ws.readyState !== 1) return;
            if (!active) {
                closeTransport(this, ws, 4401, 'sign in again');
                const ended = Promise.resolve().then(() => this.webSocketClose(ws)).catch(() => this.storageFailed());
                this.state.waitUntil?.(ended);
                return;
            }
            const now = Date.now();
            const privateReports = { ...this.privateReportState, reports: this.privateReportState.reports.filter(report =>
                Number.isFinite(report.at) && report.at <= now && now - report.at < PRIVATE_REPORT_LIMITS.ttlMs) };
            // Read the current queue only after authentication, and supersede
            // older checks so an old frame cannot restore dismissed evidence.
            this.delivery.send(ws, { ...msg, state: { ...msg.state, privateReports } });
        };
        const task = (this.authorityMode ? Promise.resolve().then(() => this.state.blockConcurrencyWhile(run)) : run())
            .catch(() => { /* No private evidence is sent on delivery failure. */ });
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
            || socketIdentityInvalid(a, this.env) || !await this.sessionActive(a)) return { ok: false };
        const current = ws.deserializeAttachment() || {};
        if (socketIdentityInvalid(current, this.env) || current.betaSid !== a.betaSid
            || ws.readyState !== undefined && ws.readyState !== 1) return { ok: false };
        this.privateQueueActor = { binding: a };
        try { const result = await this.privateReportQueue.resolve(id, action); await this.refreshPrivateReports(); return result; }
        finally { this.privateQueueActor = null; }
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
            || !await this.sessionActive(beta)) return privateReportResponse({ ok: false, error: 'unavailable', status: 503 });
        const checked = validatePrivateReportControl(body?.report);
        if (!checked.ok) return privateReportResponse({ ok: false, error: 'invalid-report', status: 400 });
        const reporterRef = await privateReportRef('reporter', beta.betaSid, this.env.HANGOUT_HMAC_KEY);
        const roomRef = await privateReportRef('room', room, this.env.HANGOUT_HMAC_KEY);
        if (body?.provenance?.reporterRef !== reporterRef || body.provenance.roomRef !== roomRef
            || !validBetaSession(beta, this.env)) return privateReportResponse({ ok: false, error: 'invalid-report', status: 400 });
        this.privateQueueActor = { sid: beta.betaSid };
        try { const result = await this.privateReportQueue.submit(checked.report, body.provenance); await this.refreshPrivateReports(); return privateReportResponse(result); }
        finally { this.privateQueueActor = null; }
    }
    storageFailed() {
        this.storageFailureToken = {};
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
            if (this.authorityMode) return await this.authority.records.transaction(tx => this.authority.writeParticipationEffects({ tx, effects: [[key, value]] }));
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
        if (this.authorityMode) return this.authority.maintenance();
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
        if (this.authorityMode) {
            let due = []; const attempted = new Set();
            const retryAlarm = async () => {
                try {
                    const now = Date.now(), at = now + 60000, earlier = await this.state.storage.getAlarm();
                    // Reaffirm the alarm even when its earlier future deadline
                    // wins: an actual scheduling failure must remain visible.
                    await this.state.storage.setAlarm(Number.isFinite(earlier) && earlier > now ? Math.min(earlier, at) : at);
                } catch { this.authorityUnavailable = true; this.storageFailed(); }
            };
            const schedule = async () => {
                const earlier = this.pendingClosed.size ? await this.state.storage.getAlarm() : null;
                await this.authority.schedule();
                if (Number.isFinite(earlier) && earlier > Date.now()) {
                    const next = await this.state.storage.getAlarm();
                    if (next === null || next === undefined || next > earlier) await this.state.storage.setAlarm(earlier);
                }
            };
            await retirementGate(this, async gate => {
                try {
                    if (this.authorityUnavailable) { await retryAlarm(); return; }
                    for (const entry of [...this.pendingClosed.values()].slice(0, CLOSED_RETIREMENT_BATCH)) {
                        entry.retryUsed = true; attempted.add(entry.id); await retireClosed(this, entry, gate, true);
                    }
                    for (const ws of this.state.getWebSockets()) {
                        const a = ws.deserializeAttachment() || {};
                        if (this.closedSockets.has(ws) || socketIdentityInvalid(a, this.env) || !await this.sessionActive(a)) {
                            const { entry } = closeTransport(this, ws, 4401, 'sign in again', { betaEnded: true });
                            if (entry && !attempted.has(entry.id) && attempted.size < CLOSED_RETIREMENT_BATCH) {
                                attempted.add(entry.id); await retireClosed(this, entry, gate);
                            }
                        }
                    }
                    // Retention is reducing housekeeping. Run it before the
                    // affirmative refresh, which can refuse an expired policy.
                    if (this.participationMode && (await this.authority.maintainParticipation())?.ok !== true) throw Error('participation retention unavailable');
                    if (this.participationMode && (await this.engine.refreshParticipation())?.ok === false) throw Error('participation refresh unavailable');
                    const ticked = await this.engine.tick();
                    if (this.participationMode && ticked?.ok === false) throw Error('participation tick unavailable');
                    await this.pruneLogs();
                    this.privateQueueActor = { kind: 'maintenance' };
                    try { await this.refreshPrivateReports(); } finally { this.privateQueueActor = null; }
                    due = await this.authority.due(); await schedule();
                } catch { this.storageFailed(); await retryAlarm(); }
            });
            for (const record of due) {
                let attempt, closed;
                await retirementGate(this, async gate => {
                    try { attempt = await this.authority.retry(record.sid); if (attempt) closed = await this.closeLocalSession(record.sid, gate, attempted); }
                    catch { /* Durable pending state remains retryable. */ }
                });
                if (attempt) await this.closeAuthoritySession(attempt, closed).catch(() => false);
            }
            await this.state.blockConcurrencyWhile(async () => {
                try { await schedule(); } catch { await retryAlarm(); }
            });
            queueRetirementRetry(this);
            return;
        }
        return retirementGate(this, async gate => {
            const betaChecks = new Map();
            for (const ws of this.state.getWebSockets()) {
                const a = ws.deserializeAttachment() || {};
                let ended = socketIdentityInvalid(a, this.env);
                if (!ended && this.env.HANGOUT_BETA_MODE === 'protected') {
                    if (!betaChecks.has(a.betaSid)) betaChecks.set(a.betaSid, activeBetaSession(this.env, a));
                    ended = !await betaChecks.get(a.betaSid);
                }
                if (this.closedSockets.has(ws) || ended) { const { entry } = closeTransport(this, ws, 4401, 'sign in again'); await retireClosed(this, entry, gate); }
            }
            await this.engine.tick(); await this.pruneLogs();
            await this.refreshPrivateReports();
            await this.state.storage.setAlarm(Date.now() + 60000);
        });
    }
    async fetch(request) {
        await this.ready;
        const path = new URL(request.url).pathname;
        if (path.startsWith(LOBBY_AUTHORITY_PATH)) return this.authorityRequest(request, path.slice(LOBBY_AUTHORITY_PATH.length));
        if (this.authorityUnavailable) return new Response('community authority unavailable', { status: 503 });
        if (new URL(request.url).pathname === '/__beta/private-report') {
            return this.state.blockConcurrencyWhile(() => this.receivePrivateReport(request));
        }
        if (new URL(request.url).pathname === INTERNAL_HEALTH_PATH) {
            if (this.env.HANGOUT_BETA_MODE !== 'protected' || request.method !== 'GET') return new Response('not found', { status: 404 });
            return this.state.blockConcurrencyWhile(async () => {
                try {
                    // Ordinary wake/restore already ran. This read neither spends
                    // allowance nor applies any administrative/moderation action.
                    if (this.privateReportQueue?.status().storage !== 'ready' || this.privateReportState.storage !== 'ready') {
                        return healthJson({ storage: 'unavailable' }, 503);
                    }
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
                    if (a.pilotSid === identity.pilotSid) { this.delivery.forget(ws); ws.close(4401, 'pilot identity changed'); await this.engine.disconnect(a.id); }
                }
                return new Response('ok');
            });
        }
        if (this.env.HANGOUT_BETA_MODE === 'protected' && new URL(request.url).pathname === '/__beta/disconnect' && request.method === 'POST' && /^[a-z0-9-]{16,64}$/.test(identity?.betaSid || '')) {
            return this.state.blockConcurrencyWhile(async () => {
                for (const ws of this.state.getWebSockets()) {
                    const a = ws.deserializeAttachment() || {};
                    if (a.betaSid === identity.betaSid) { this.delivery.forget(ws); ws.serializeAttachment({ ...a, betaEnded: true }); ws.close(4401, 'beta session ended'); await this.engine.disconnect(a.id); }
                }
                return new Response('ok');
            });
        }
        return retirementGate(this, async gate => {
        if (!identity || !identity.dev) return new Response('no', { status: 400 });
        if (socketIdentityInvalid(identity, this.env)) return new Response('session required', { status: 403 });
        if (this.env.HANGOUT_BETA_MODE === 'protected' && !await this.sessionActive(identity)) return new Response('beta session required', { status: 403 });
        if (socketIdentityInvalid(identity, this.env)) return new Response('session required', { status: 403 });
        const id = `c${crypto.randomUUID().replaceAll('-', '')}`;
        let trusted = { ...identity, id };
        if (this.authorityMode) {
            try {
                trusted = { ...trusted, authorityRef: id, authorityRevision: 1 };
                await this.authority.bind(trusted); this.liveBindings.set(id, trusted);
            } catch { return new Response('community identity unavailable', { status: 403 }); }
        }
        // Admission may refuse before upgrade, but successful connect also emits the
        // hello the browser waits for. Hold those frames until the socket is accepted.
        const initialFrames = [];
        this.pendingAdmission.set(id, initialFrames);
        let verdict;
        try {
            verdict = await this.engine.connect(trusted);
        } finally {
            this.pendingAdmission.delete(id);
        }
        if (!verdict.ok) {
            if (this.authorityMode) { this.liveBindings.delete(id); await this.authority.unbind(id).catch(() => {}); }
            return new Response(verdict.reason, { status: verdict.status || 503 });
        }
        let pair;
        try {
        pair = new WebSocketPair();
        this.state.acceptWebSocket(pair[1], [id]);
        pair[1].serializeAttachment({ id, pilotSid: this.env.PILOT_MODE === 'protected' ? identity.pilotSid : undefined,
            betaSid: this.env.HANGOUT_BETA_MODE === 'protected' ? identity.betaSid : undefined,
            betaInviteVersion: this.env.HANGOUT_BETA_MODE === 'protected' ? identity.betaInviteVersion : undefined,
            ...(this.authorityMode ? { authorityRef: id, authorityRevision: 1 } : {}),
            dev: identity.dev, iph: identity.iph, role: identity.role, email: identity.email, account: identity.account, expiresAt: identity.expiresAt, admin: identity.admin });
        if (identity.devToken) this.delivery.send(pair[1], { t: 'device', token: identity.devToken });
        for (const frame of initialFrames) {
            if (frame.t === 'admin' && this.env.HANGOUT_BETA_MODE === 'protected') this.sendPrivateAdmin(pair[1], id, frame);
            else this.delivery.send(pair[1], frame);
        }
        return new Response(null, { status: 101, webSocket: pair[0] });
        } catch {
            const entry = rememberRetirement(this, id, trusted.betaSid || '');
            if (pair?.[1]) closeTransport(this, pair[1], 1011, 'admission unavailable');
            this.liveBindings.delete(id);
            await retireClosed(this, entry, gate);
            return new Response('community admission unavailable', { status: 503 });
        }
        });
    }
    async webSocketMessage(ws, raw) {
        if (this.closedSockets?.has(ws)) return;
        await this.ready;
        if (this.closedSockets?.has(ws)) return;
        if (this.authorityUnavailable) { ws.close(1011, 'community authority unavailable'); return; }
        return retirementGate(this, async gate => {
            try {
            const a = ws.deserializeAttachment() || {};
            if (this.closedSockets?.has(ws) || socketIdentityInvalid(a, this.env) || this.authorityMode && !await this.sessionActive(a)) { const { entry } = closeTransport(this, ws, 4401, 'sign in again'); await retireClosed(this, entry, gate); return; }
            if (this.closedSockets?.has(ws)) return;
            // Transport control prepays request units from the same daily budget,
            // but never spends a person's chat allowance or mutates room authority.
            if (typeof raw === 'string' && raw.length <= LOBBY_LIMITS.actFrameBytes) {
                let control;
                try { control = JSON.parse(raw); } catch { /* The engine refuses malformed application frames. */ }
                if (control?.t === 'transport-ack') {
                    if (!await this.controlBudget.take(ws, a.id)) {
                        const { entry } = closeTransport(this, ws, 4413, 'community control allowance unavailable');
                        return await retireClosed(this, entry, gate);
                    }
                    return this.delivery.acknowledge(ws, control.seq);
                }
                if (control?.t === 'hello' && !this.delivery.negotiate(ws, control.transport)) return;
            }
            const result = await this.engine.message(this.state.getTags(ws)[0], typeof raw === 'string' ? raw : '');
            if (result?.privateReportAction) {
                let resolved;
                try { resolved = await this.resolvePrivateReport(result.privateReportAction); }
                catch { resolved = { ok: false }; }
                return await this.engine.completePrivateReportAction(a.id, resolved);
            }
            return result;
            } catch (error) {
                if (!this.authorityMode) throw error;
                this.authorityUnavailable = true; this.storageFailed();
                try { if (ws.readyState === undefined || ws.readyState === 1) ws.close(1011, 'community authority unavailable'); } catch { /* gone */ }
            }
        });
    }
    async webSocketClose(ws, code) {
        const replyCode = Number.isInteger(code) && (code >= 1000 && code <= 1014 && ![1004, 1005, 1006].includes(code)
            || code >= 3000 && code <= 4999) ? code : 1000;
        // The attachment and WeakSet fence queued frames before any await;
        // acknowledgement/credit release do not claim semantic retirement.
        const { entry } = closeTransport(this, ws, replyCode);
        await this.ready;
        if (this.authorityUnavailable) return;
        return retirementGate(this, gate => retireClosed(this, entry, gate));
    }
    async webSocketError(ws) { return this.webSocketClose(ws); }
}
