// @vitest-environment node
// Actual beta gateway + Lobby + session authority on disk-backed SQLite. Only
// runtime sockets/Response and remote binding transports are test doubles. The
// alarm API maps to one key inside the same SQL transaction. Staff ingress and
// private-room provenance are explicitly synthetic internal fixtures, not Access
// JWT verification or a hosted/native-media qualification.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { betaFetch } from '../src/beta-entry.mjs';
import { betaSession } from '../src/beta-auth.mjs';
import { registryRequest } from '../src/beta-session-client.mjs';
import { HangoutLobby } from '../src/lobby-do.mjs';
import { accountId } from '../src/auth.mjs';
import { privateReportRef, LIMITS as PRIVATE_LIMITS } from '../src/private-reports.mjs';
import { writeLobbyEffects } from '../src/lobby-effect-records.mjs';
import { LOG_TTL } from '../src/community-state.mjs';
import { LOBBY_AUTHORITY_COMMUNITY } from '../src/lobby-session-authority.mjs';
import { createPartitionedParticipationConsents } from '../src/participation-partitions.mjs';
import { PARTICIPATION_PURPOSES } from '../src/participation-policy.mjs';
import { openDurableRecordSqlite } from '../../tests/support/durable-record-sqlite.mjs';

const ORIGIN = 'https://collocated-beta.fixture.test', NOW = Date.UTC(2026, 9, 25, 12);
const INVITE = 'synthetic-collocated-private-invite-'.repeat(2), PREVIEW = 'synthetic-collocated-preview-'.repeat(2);
const ALARM = '__test_native_alarm__', ROOM = 'a'.repeat(64), QUOTE = 'Selected private allegation fixture 9de12';
const cleanups = [], clone = value => structuredClone(value);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
class Socket {
    readyState = 1; frames = [];
    send(raw) { if (this.readyState !== 1) throw Error('closed'); this.frames.push(JSON.parse(raw)); }
    close(code, reason) { this.closed = { code, reason }; this.readyState = 3; }
    serializeAttachment(value) { this.saved = clone(value); }
    deserializeAttachment() { return clone(this.saved); }
}
beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] }); vi.setSystemTime(NOW);
    vi.stubGlobal('WebSocketPair', class { constructor() { this[0] = new Socket(); this[1] = new Socket(); } });
    const NativeResponse = globalThis.Response;
    vi.stubGlobal('Response', class extends NativeResponse {
        constructor(body, init) { super(body, init?.status === 101 ? { status: 200 } : init);
            if (init?.status === 101) Object.defineProperty(this, 'status', { value: 101 }); this.webSocket = init?.webSocket; }
    });
    vi.stubGlobal('fetch', vi.fn(async () => { throw Error('External network forbidden in integration fixture'); }));
});
afterEach(async () => {
    for (const item of cleanups.splice(0)) {
        for (const release of item.releases) release(new Response('fixture cleanup', { status: 503 }));
        for (const lobby of item.lobbies) lobby.presence.dispose();
        await Promise.allSettled(item.background.splice(0)); await item.driver.close(); await rm(item.directory, { recursive: true, force: true });
    }
    vi.useRealTimers(); vi.unstubAllGlobals();
});
function request(path, { cookie, body, upgrade = false, method = body === undefined ? 'GET' : 'POST', headers = {} } = {}) {
    return new Request(ORIGIN + path, { method, headers: { Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(upgrade ? { Upgrade: 'websocket' } : {}), ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function harness({ initialize = true, mode = 'lobby-v1', participation = false } = {}) {
    const directory = await mkdtemp(join(tmpdir(), 'lobby-session-integration-')), driver = openDurableRecordSqlite(join(directory, 'lobby.sqlite'));
    const background = [], sockets = new Map(), lobbies = [], releases = []; let queue = Promise.resolve(), lobby;
    const transaction = operation => driver.transaction(raw => operation({ ...raw,
        getAlarm: () => raw.get(ALARM), setAlarm: value => raw.put(ALARM, value), deleteAlarm: () => raw.delete(ALARM) }));
    const storage = { transaction };
    for (const name of ['get', 'put', 'delete', 'list', 'getAlarm', 'setAlarm', 'deleteAlarm']) storage[name] = (...args) => transaction(tx => tx[name](...args));
    const state = { storage, sockets, background,
        blockConcurrencyWhile(fn) { const task = queue.then(fn); queue = task.catch(() => {}); return task; },
        getWebSockets: tag => [...sockets].filter(([ws, tags]) => ws.readyState === 1 && (!tag || tags.includes(tag))).map(([ws]) => ws),
        getTags: ws => sockets.get(ws) || [], acceptWebSocket: (ws, tags) => sockets.set(ws, tags), waitUntil: task => background.push(task) };
    const env = { HANGOUT_BETA_MODE: 'protected', HANGOUT_SESSION_AUTHORITY: mode, HANGOUT_BETA_INVITE_VERSION: '1',
        ...(participation ? { HANGOUT_PARTICIPATION_AUTHORITY: 'c3-v1' } : {}),
        HANGOUT_BETA_INVITE_KEY: INVITE, HANGOUT_PREVIEW_KEY: PREVIEW, HANGOUT_HMAC_KEY: 'synthetic-collocated-signing-key-'.repeat(2),
        HANGOUT_MODERATOR_EMAILS: 'reviewer@example.invalid', HANGOUT_OWNER_EMAIL: 'owner@example.invalid',
        ASSETS: { fetch: async () => new Response('fixture asset', { headers: { 'Content-Type': 'text/plain' } }) },
        QUOTA: { idFromName: name => name, get: () => ({ fetch: async () => new Response('ok') }) },
        ROOMS: { idFromName: name => name, get: () => ({ fetch: async () => new Response('ok') }) },
        BETA_SESSIONS: { idFromName: vi.fn(() => { throw Error('Legacy registry must not be used'); }), get: vi.fn(() => { throw Error('Legacy registry must not be used'); }) }
    };
    const getLobby = () => { if (!lobby) { lobby = new HangoutLobby(state, env); lobbies.push(lobby); } return lobby; };
    env.LOBBY = { idFromName: name => name, get: () => ({ fetch: incoming => getLobby().fetch(incoming) }) };
    cleanups.push({ directory, driver, background, lobbies, releases });
    const bound = (operation, body = {}) => getLobby().fetch(new Request(`https://internal/__beta/authority/${operation}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
    const settle = async () => {
        for (let round = 0; round < 12; round++) {
            await Promise.all(background.splice(0)); await Promise.resolve();
            if (!background.length) return;
        }
        throw Error('Integration background work did not settle');
    };
    const guest = async () => {
        const response = await betaFetch(request('/beta/unlock', { body: { key: INVITE } }), env); expect(response.status).toBe(200);
        const cookie = response.headers.get('Set-Cookie').split(';')[0], session = await betaSession(request('/beta/state', { cookie }), env);
        expect(session).not.toBeNull(); return { cookie, ...session };
    };
    const visitor = async (nick, extra = {}) => {
        const who = await guest(), response = await betaFetch(request(`/lobby?preview=${PREVIEW}`, { cookie: who.cookie, upgrade: true }), env);
        expect(response.status).toBe(101); const socket = state.getWebSockets().at(-1);
        await getLobby().webSocketMessage(socket, JSON.stringify({ t: 'hello', nick, age13: true, ...extra })); await settle();
        expect(socket.frames.some(frame => frame.t === 'welcome' && frame.nick === nick)).toBe(true); return { ...who, socket };
    };
    const message = async (who, frame) => { await getLobby().webSocketMessage(who.socket, JSON.stringify(frame)); await settle(); };
    const cmd = (who, name, args = [], ch = '#stalemate') => message(who, { t: 'cmd', name, args, ch });
    if (initialize) expect((await bound('initialize')).status).toBe(200);
    return { driver, state, env, background, sockets, releases, lobby: getLobby, bound, settle, guest, visitor, message, cmd,
        async wake({ dropSockets = false } = {}) {
            getLobby().presence.dispose(); if (dropSockets) sockets.clear();
            lobby = new HangoutLobby(state, env); lobbies.push(lobby); await lobby.ready; await settle(); return lobby;
        } };
}
const logout = (h, who) => betaFetch(request('/beta/logout', { cookie: who.cookie, body: {} }), h.env);
async function submitPrivate(h, who) {
    const beta = { betaSid: who.access.sid, betaInviteVersion: who.access.version, expiresAt: who.access.exp };
    const report = { type: 'private-report', v: 1, request: 'R'.repeat(24), kind: 'message', target: null,
        claimedName: 'Fixture visitor', excerpt: QUOTE, reason: 'Synthetic human review test', consent: true };
    const provenance = { reporterRef: await privateReportRef('reporter', beta.betaSid, h.env.HANGOUT_HMAC_KEY),
        roomRef: await privateReportRef('room', ROOM, h.env.HANGOUT_HMAC_KEY), reporterConnection: 'pfixture', targetConnection: null,
        targetSessionRef: null, targetMembership: 'unverified' };
    const result = await h.lobby().fetch(new Request('https://internal/__beta/private-report', { method: 'POST',
        headers: { 'X-Hangout-Beta-Session': JSON.stringify(beta), 'X-Hangout-Private-Room': ROOM }, body: JSON.stringify({ report, provenance }) }));
    expect(result.status).toBe(200); await h.settle(); return result.json();
}

describe('opt-in session authority through the actual beta gateway and Lobby', () => {
    it('does not clear a newer quarantine when a held migration export later refuses', async () => {
        const h = await harness(), who = await h.visitor('MigrationVisitor'), started = deferred(), exportReply = deferred();
        h.env.BETA_SESSIONS = { idFromName: name => name, get: () => ({ fetch: () => { started.resolve(); return exportReply.promise; } }) };
        const migration = h.bound('migrate'); await started.promise;
        const originalTransaction = h.state.storage.transaction;
        h.state.storage.transaction = async () => { throw Error('Synthetic storage failure during export'); };
        await h.lobby().webSocketMessage(who.socket, JSON.stringify({ t: 'say', ch: '#stalemate', text: 'Never publish' }));
        expect(h.lobby().authorityUnavailable).toBe(true);
        h.state.storage.transaction = originalTransaction;
        exportReply.resolve(Response.json({ v: 1, sessions: [], mintRates: {} }));
        expect((await migration).status).toBe(503);
        expect(h.lobby().authorityUnavailable).toBe(true);
        expect((await betaFetch(request('/beta/unlock', { body: { key: INVITE } }), h.env)).status).toBe(503);
    });
    it('handles persistent storage failure during stale-socket cleanup inside the event gate', async () => {
        const h = await harness(), who = await h.visitor('CleanupVisitor');
        h.state.storage.transaction = async () => { throw Error('Synthetic unavailable native storage'); };
        await expect(h.lobby().webSocketMessage(who.socket, JSON.stringify({ t: 'say', ch: '#stalemate', text: 'Never publish' }))).resolves.toBeUndefined();
        expect(who.socket.closed.code).toBe(4401); expect(h.lobby().authorityUnavailable).toBe(true);
    });

    it('does not retire a durable binding when the real disconnect commit is refused', async () => {
        const h = await harness(), leaving = await h.visitor('LeavingGuest'), healthy = await h.visitor('HealthyGuest');
        const lobby = h.lobby(), leavingId = leaving.socket.deserializeAttachment().id, healthyId = healthy.socket.deserializeAttachment().id;
        const before = await lobby.authority.load(), beforeRollbacks = h.driver.stats.rollbacks;
        const beforeCommits = h.driver.stats.commits, originalTransaction = h.state.storage.transaction;
        const sessionsHex = Buffer.from('sessions').toString('hex');
        let tripped = false, sessionsManifestWrites = 0, attempts = 0, queued;
        const retry = deferred(), realDisconnect = lobby.engine.disconnect;
        // This observes the real method/result. It does not replace the engine
        // or manufacture the controlledRun refusal that this regression needs.
        const disconnect = vi.spyOn(lobby.engine, 'disconnect').mockImplementation((...args) => {
            // Hold only the retry before it enters the real engine/transaction.
            // The first result and every eventual retry result remain genuine.
            if (++attempts === 2) return retry.promise.then(() => realDisconnect(...args));
            return realDisconnect(...args);
        });
        h.state.storage.transaction = operation => originalTransaction(raw => operation({ ...raw, put: async (key, value) => {
            await raw.put(key, value);
            if (!key.includes(':manifest:') || !key.endsWith(sessionsHex)) return;
            sessionsManifestWrites++;
            if (!tripped) {
                tripped = true;
                // The actual SQLite write has happened inside its transaction;
                // throwing here rolls it back. Later conservative cost/session
                // persistence remains available and must not be faulted again.
                throw Error('Synthetic post-write disconnect session failure');
            }
        } }));
        try {
            await lobby.webSocketClose(leaving.socket, 1000);
            expect(tripped).toBe(true);
            expect(h.driver.stats.rollbacks - beforeRollbacks).toBe(1);
            expect(sessionsManifestWrites).toBeGreaterThanOrEqual(2);
            expect(h.driver.stats.commits).toBeGreaterThan(beforeCommits);
            expect(disconnect.mock.calls[0]).toEqual([leavingId]);
            expect(await disconnect.mock.results[0].value).toMatchObject({ ok: false });
            expect(leaving.socket.closed.code).toBe(1000);
            expect(lobby.engine._debug.conns.has(leavingId)).toBe(true);
            expect(lobby.engine._debug.conns.has(healthyId)).toBe(true);
            expect(healthy.socket.readyState).toBe(1);
            expect(healthy.socket.closed).toBeUndefined();

            const after = await lobby.authority.load();
            expect(after.state.sessions.connections.map(connection => connection.id).sort())
                .toEqual(before.state.sessions.connections.map(connection => connection.id).sort());
            // Acknowledging transport closure is not a committed member removal.
            // The engine and its conservative saved snapshot still contain this
            // connection, so no separate successful unbind may claim it retired.
            expect(after.bindings.map(({ binding }) => binding.id).sort())
                .toEqual(before.bindings.map(({ binding }) => binding.id).sort());

            const marker = 'A queued closed connection must not publish';
            queued = lobby.webSocketMessage(leaving.socket, JSON.stringify({ t: 'say', ch: '#stalemate', text: marker }));
            await vi.waitFor(() => expect(disconnect).toHaveBeenCalledTimes(2), { timeout: 1000, interval: 10 });
            retry.resolve(); await h.settle(); await queued;
            expect(await disconnect.mock.results[1].value).toBeUndefined();
            const retired = await lobby.authority.load();
            expect(retired.bindings.map(({ binding }) => binding.id)).toEqual([healthyId]);
            expect(retired.state.sessions.connections.map(connection => connection.id)).toEqual([healthyId]);
            expect(lobby.engine._debug.conns.has(leavingId)).toBe(false);
            expect(healthy.socket.frames.some(frame => frame.t === 'line' && frame.text === marker)).toBe(false);
            await h.message(healthy, { t: 'say', ch: '#stalemate', text: 'Healthy peer after committed retirement' });
            expect(healthy.socket.frames.some(frame => frame.t === 'line' && frame.text === 'Healthy peer after committed retirement')).toBe(true);
        } finally {
            retry.resolve(); h.state.storage.transaction = originalTransaction;
            await queued?.catch(() => {});
            await h.settle();
        }
    });

    it('bounds immediate retirement retries and uses the ordinary alarm after repeated real refusals', async () => {
        const h = await harness(), leaving = await h.visitor('RetryLeaving'), healthy = await h.visitor('RetryHealthy');
        const lobby = h.lobby(), leavingId = leaving.socket.deserializeAttachment().id, healthyId = healthy.socket.deserializeAttachment().id;
        const disconnect = vi.spyOn(lobby.engine, 'disconnect'), originalTransaction = h.state.storage.transaction;
        const sessionsHex = Buffer.from('sessions').toString('hex'); let failedInvocation = 0;
        h.state.storage.transaction = operation => originalTransaction(raw => operation({ ...raw, put: async (key, value) => {
            await raw.put(key, value);
            if (key.includes(':manifest:') && key.endsWith(sessionsHex) && disconnect.mock.calls.length > failedInvocation) {
                failedInvocation = disconnect.mock.calls.length;
                // Exactly one semantic-write fault per actual invocation;
                // its real conservative follow-up is allowed to commit.
                throw Error('Synthetic repeated disconnect session failure');
            }
        } }));
        try {
            await lobby.webSocketClose(leaving.socket, 1000); await h.settle();
            expect(disconnect).toHaveBeenCalledTimes(2);
            expect(await disconnect.mock.results[0].value).toMatchObject({ ok: false });
            expect(await disconnect.mock.results[1].value).toMatchObject({ ok: false });
            await h.settle(); expect(disconnect).toHaveBeenCalledTimes(2);
            let saved = await lobby.authority.load();
            expect(saved.bindings.map(({ binding }) => binding.id).sort()).toEqual([leavingId, healthyId].sort());
            expect(saved.state.sessions.connections.map(connection => connection.id).sort()).toEqual([leavingId, healthyId].sort());
            expect(healthy.socket.readyState).toBe(1);

            vi.setSystemTime(NOW + 60000);
            await lobby.alarm(); await h.settle();
            expect(disconnect).toHaveBeenCalledTimes(3);
            expect(await disconnect.mock.results[2].value).toMatchObject({ ok: false });
            await h.settle(); expect(disconnect).toHaveBeenCalledTimes(3);
            saved = await lobby.authority.load();
            expect(saved.bindings.map(({ binding }) => binding.id).sort()).toEqual([leavingId, healthyId].sort());
            expect(await h.state.storage.getAlarm()).toBeGreaterThan(Date.now());
            expect(healthy.socket.readyState).toBe(1);
        } finally { h.state.storage.transaction = originalTransaction; }
    });

    it('retries a real unbind rollback without restoring committed departed membership', async () => {
        const h = await harness(), leaving = await h.visitor('UnbindLeaving'), healthy = await h.visitor('UnbindHealthy');
        const lobby = h.lobby(), leavingId = leaving.socket.deserializeAttachment().id, healthyId = healthy.socket.deserializeAttachment().id;
        const originalTransaction = h.state.storage.transaction, bindingHex = Buffer.from('authority-connection:' + leavingId).toString('hex');
        const retry = deferred(), originalAuthority = lobby.authority; let attempts = 0, tripped = false;
        const disconnect = vi.spyOn(lobby.engine, 'disconnect');
        // The authority itself is frozen. This frozen facade delays only the
        // second actual unbind, then passes through its real transaction/result.
        // An already committed disconnect need not run again just to retry it.
        const unbind = vi.fn((...args) => ++attempts === 2
            ? retry.promise.then(() => originalAuthority.unbind(...args)) : originalAuthority.unbind(...args));
        lobby.authority = Object.freeze({ ...originalAuthority, unbind });
        h.state.storage.transaction = operation => originalTransaction(raw => operation({ ...raw, delete: async key => {
            const result = await raw.delete(key);
            if (!tripped && key.includes(':manifest:') && key.endsWith(bindingHex)) {
                tripped = true; throw Error('Synthetic post-delete unbind failure');
            }
            return result;
        } }));
        try {
            await lobby.webSocketClose(leaving.socket, 1000);
            expect(tripped).toBe(true);
            expect(await disconnect.mock.results[0].value).toBeUndefined();
            const pending = await lobby.authority.load();
            expect(pending.state.sessions.connections.map(connection => connection.id)).toEqual([healthyId]);
            expect(lobby.engine._debug.conns.has(leavingId)).toBe(false);
            expect(pending.bindings.map(({ binding }) => binding.id).sort()).toEqual([leavingId, healthyId].sort());
            expect(disconnect).toHaveBeenCalledExactlyOnceWith(leavingId);
            await vi.waitFor(() => expect(unbind).toHaveBeenCalledTimes(2), { timeout: 1000, interval: 10 });
            retry.resolve(); await h.settle();
            expect(await unbind.mock.results[1].value).toBeUndefined();
            expect(disconnect).toHaveBeenCalledExactlyOnceWith(leavingId);
            const retired = await lobby.authority.load();
            expect(retired.bindings.map(({ binding }) => binding.id)).toEqual([healthyId]);
            expect(retired.state.sessions.connections.map(connection => connection.id)).toEqual([healthyId]);
            expect(healthy.socket.readyState).toBe(1);
        } finally {
            retry.resolve(); h.state.storage.transaction = originalTransaction;
            await h.settle(); lobby.authority = originalAuthority;
        }
    });

    it('retains cold bindings until reconstructed sessions commit and then recovers consistently', async () => {
        const h = await harness(), leaving = await h.visitor('ColdLeaving'), healthy = await h.visitor('ColdHealthy');
        const leavingId = leaving.socket.deserializeAttachment().id, healthyId = healthy.socket.deserializeAttachment().id;
        const originalTransaction = h.state.storage.transaction, sessionsHex = Buffer.from('sessions').toString('hex');
        let tripped = false;
        // No close event is delivered to the old instance: the new Lobby must
        // reconcile its durable sessions against actual surviving sockets.
        leaving.socket.close(1000);
        h.state.storage.transaction = operation => originalTransaction(raw => operation({ ...raw, put: async (key, value) => {
            await raw.put(key, value);
            if (!tripped && key.includes(':manifest:') && key.endsWith(sessionsHex)) {
                tripped = true; throw Error('Synthetic reconstructed-session write failure');
            }
        } }));
        let failed;
        try { failed = await h.wake(); }
        finally { h.state.storage.transaction = originalTransaction; }
        expect(tripped).toBe(true); expect(failed.authorityUnavailable).toBe(true);
        const retained = await failed.authority.load();
        expect(retained.state.sessions.connections.map(connection => connection.id).sort()).toEqual([leavingId, healthyId].sort());
        expect(retained.bindings.map(({ binding }) => binding.id).sort()).toEqual([leavingId, healthyId].sort());

        const restored = await h.wake();
        expect(restored.authorityUnavailable).toBe(false);
        const saved = await restored.authority.load();
        expect(saved.state.sessions.connections.map(connection => connection.id)).toEqual([healthyId]);
        expect(saved.bindings.map(({ binding }) => binding.id)).toEqual([healthyId]);
        expect(restored.engine._debug.conns.has(leavingId)).toBe(false);
        expect(restored.engine._debug.conns.has(healthyId)).toBe(true);
        expect(healthy.socket.readyState).toBe(1);
    });

    it('keeps a revoked SID pending until failed closed-socket retirement really commits', async () => {
        const h = await harness(), leaving = await h.visitor('LogoutLeaving'), healthy = await h.visitor('LogoutHealthy');
        const lobby = h.lobby(), leavingId = leaving.socket.deserializeAttachment().id, healthyId = healthy.socket.deserializeAttachment().id;
        const originalTransaction = h.state.storage.transaction, sessionsHex = Buffer.from('sessions').toString('hex');
        const retry = deferred(), realDisconnect = lobby.engine.disconnect;
        let attempts = 0, tripped = false, denied, progress;
        const disconnect = vi.spyOn(lobby.engine, 'disconnect').mockImplementation((...args) =>
            ++attempts === 2 ? retry.promise.then(() => realDisconnect(...args)) : realDisconnect(...args));
        h.state.storage.transaction = operation => originalTransaction(raw => operation({ ...raw, put: async (key, value) => {
            await raw.put(key, value);
            if (!tripped && key.includes(':manifest:') && key.endsWith(sessionsHex)) {
                tripped = true; throw Error('Synthetic revoked-session disconnect failure');
            }
        } }));
        try {
            const result = await logout(h, leaving);
            expect(result.status).toBe(503);
            expect(result.headers.has('Set-Cookie')).toBe(false);
            expect(tripped).toBe(true);
            expect(await disconnect.mock.results[0].value).toMatchObject({ ok: false });
            expect(leaving.socket.closed.code).toBe(4401);
            expect(h.state.getWebSockets()).not.toContain(leaving.socket);
            const revoked = await lobby.authority.records.transaction(tx => tx.get(`authority-session:${leaving.access.sid}`));
            expect(revoked).toMatchObject({ revoked: true, pending: true });
            const pending = await lobby.authority.load();
            expect(pending.state.sessions.connections.map(connection => connection.id).sort()).toEqual([leavingId, healthyId].sort());
            expect(pending.bindings.map(({ binding }) => binding.id).sort()).toEqual([leavingId, healthyId].sort());

            // The held actual cleanup owns the event gate. Queue real requests
            // without awaiting them inside it; they run after cleanup releases.
            denied = betaFetch(request('/beta/state', { cookie: leaving.cookie }), h.env);
            progress = h.message(healthy, { t: 'say', ch: '#stalemate', text: 'Healthy guest after failed logout cleanup' });
            await vi.waitFor(() => expect(disconnect).toHaveBeenCalledTimes(2), { timeout: 1000, interval: 10 });
            retry.resolve(); await h.settle();
            expect((await denied).status).toBe(401); await progress;
            expect(healthy.socket.frames.some(frame => frame.t === 'line' && frame.text === 'Healthy guest after failed logout cleanup')).toBe(true);
            expect(healthy.socket.readyState).toBe(1);
            const retired = await lobby.authority.load();
            expect(retired.bindings.map(({ binding }) => binding.id)).toEqual([healthyId]);
            expect(retired.state.sessions.connections.map(connection => connection.id)).toEqual([healthyId]);

            vi.setSystemTime(revoked.retryAt);
            await lobby.alarm(); await h.settle();
            expect(await lobby.authority.records.transaction(tx => tx.get(`authority-session:${leaving.access.sid}`)))
                .toMatchObject({ revoked: true, pending: false });
            expect((await betaFetch(request('/beta/state', { cookie: leaving.cookie }), h.env)).status).toBe(401);
            expect(healthy.socket.readyState).toBe(1);
        } finally {
            retry.resolve(); h.state.storage.transaction = originalTransaction;
            await Promise.allSettled([denied, progress]); await h.settle();
        }
    });

    it('contains a failed fallback alarm write inside the event gate', async () => {
        const h = await harness(); h.state.storage.transaction = async () => { throw Error('Synthetic unavailable native storage'); };
        h.state.storage.setAlarm = async () => { throw Error('Synthetic unavailable fallback alarm'); };
        await expect(h.lobby().alarm()).resolves.toBeUndefined(); expect(h.lobby().authorityUnavailable).toBe(true);
    });
    it.each(['initialize', 'rotate'])('keeps a healthy authority usable after refused %s control retries', async operation => {
        const h = await harness(), before = [...h.driver.rows()];
        const result = await h.bound(operation, operation === 'rotate' ? { version: '1' } : {});
        expect(result.status).toBe(503); expect([...h.driver.rows()]).toEqual(before);
        const who = await h.guest();
        expect((await registryRequest(h.env, 'check', { sid: who.access.sid, exp: who.access.exp, version: '1' })).status).toBe(200);
        expect(h.lobby().authorityUnavailable).toBe(false);
    });
    it('fails closed for missing or unknown authority modes without initializing legacy state', async () => {
        for (const mode of ['lobby-v1', 'unknown-fixture-mode']) {
            const h = await harness({ initialize: false, mode });
            expect((await betaFetch(request('/beta/unlock', { body: { key: INVITE } }), h.env)).status).toBe(503);
            expect(h.driver.rows().size).toBe(0); expect(h.env.BETA_SESSIONS.get).not.toHaveBeenCalled();
            if (mode === 'lobby-v1') { expect((await h.bound('initialize')).status).toBe(200); expect((await h.guest()).access.sid).toBeTruthy(); }
        }
    });

    it('unlocks guests, shares chat and a drawing room, and keeps earlier text out of a fresh join', async () => {
        const h = await harness(), alice = await h.visitor('Alice', { entrySource: 'stalemate' }), bravo = await h.visitor('Bravo', { entrySource: 'rad-dad' });
        const body = 'Live shared lobby greeting'; await h.message(alice, { t: 'say', ch: '#stalemate', text: body });
        expect(bravo.socket.frames.some(frame => frame.t === 'line' && frame.text === body && frame.entrySource === 'stalemate')).toBe(true);
        await h.cmd(alice, 'join', ['#art-shared']); await h.cmd(bravo, 'join', ['#art-shared']);
        await h.message(alice, { t: 'act', kind: 'stroke', ch: '#art-shared', stroke: { id: 'fixture-stroke', color: '#009ee8', size: 8, pts: [[0.1, 0.2], [0.2, 0.3]] } });
        expect(bravo.socket.frames.some(frame => frame.t === 'act' && frame.kind === 'stroke')).toBe(true);
        const che = await h.visitor('CheGuest'); await h.cmd(che, 'join', ['#art-shared']);
        expect(JSON.stringify(che.socket.frames)).not.toContain(body);
        expect(che.socket.frames.some(frame => frame.t === 'join' && frame.ch?.name === '#art-shared' && frame.act.strokes.length === 1)).toBe(true);
        const saved = (await h.lobby().authority.load()).state; expect(JSON.stringify(saved)).not.toContain(body);
        expect(h.env.BETA_SESSIONS.get).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('clears cookies only after successful logout and stops the revoked passive socket receiving new chat', async () => {
        const h = await harness(), alice = await h.visitor('Alice'), bravo = await h.visitor('Bravo');
        const result = await logout(h, alice); expect(result.status).toBe(200); expect(result.headers.get('Set-Cookie')).toContain('Max-Age=0');
        expect(alice.socket.closed.code).toBe(4401); expect(bravo.socket.readyState).toBe(1);
        const before = alice.socket.frames.length; await h.message(bravo, { t: 'say', ch: '#stalemate', text: 'Only active visitors receive this' });
        expect(alice.socket.frames).toHaveLength(before);
        expect((await betaFetch(request('/beta/state', { cookie: alice.cookie }), h.env)).status).toBe(401);
        expect(await h.lobby().authority.records.transaction(tx => tx.get(`authority-session:${alice.access.sid}`))).toMatchObject({ revoked: true, pending: false });
    });

    it('bounds stalled Room closure at eight seconds while another guest check and chat progress', async () => {
        const h = await harness(), alice = await h.visitor('Alice'), bravo = await h.visitor('Bravo');
        expect((await registryRequest(h.env, 'room', { sid: alice.access.sid, version: alice.access.version, exp: alice.access.exp, room: ROOM })).status).toBe(200);
        const reached = deferred(), remote = deferred(); h.releases.push(remote.resolve); let signal, settled = false;
        h.env.ROOMS.get = () => ({ fetch: incoming => { signal = incoming.signal; reached.resolve(); return remote.promise; } });
        const startedAt = Date.now(), ending = logout(h, alice).then(result => { settled = true; return result; }); await reached.promise;
        let checkDone = false, chatDone = false;
        const checking = betaFetch(request('/beta/state', { cookie: bravo.cookie }), h.env).then(result => { checkDone = true; return result; });
        const chatting = h.message(bravo, { t: 'say', ch: '#stalemate', text: 'The lobby continues during remote closure' }).then(() => { chatDone = true; });
        await vi.waitFor(() => { expect(checkDone).toBe(true); expect(chatDone).toBe(true); }, { timeout: 100, interval: 1 });
        expect((await checking).status).toBe(200); await chatting; expect(settled).toBe(false);
        expect(bravo.socket.frames.some(frame => frame.t === 'line' && frame.text === 'The lobby continues during remote closure')).toBe(true);
        expect(alice.socket.frames.some(frame => frame.text === 'The lobby continues during remote closure')).toBe(false);
        await vi.advanceTimersByTimeAsync(7999 - (Date.now() - startedAt)); expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1); expect(settled).toBe(true);
        const result = await ending; expect(result.status).toBe(503); expect(result.headers.has('Set-Cookie')).toBe(false); expect(signal.aborted).toBe(true);
        expect(await h.lobby().authority.records.transaction(tx => tx.get(`authority-session:${alice.access.sid}`))).toMatchObject({ revoked: true, pending: true });
        remote.resolve(new Response('late success')); await Promise.resolve();
    });

    it('restores surviving socket metadata without replay and rejects a forged persisted socket binding', async () => {
        const h = await harness(), alice = await h.visitor('Alice'), bravo = await h.visitor('Bravo');
        await h.message(alice, { t: 'say', ch: '#stalemate', text: 'Session scrollback stays in its connected browser' });
        const before = alice.socket.frames.length;
        const attachment = bravo.socket.deserializeAttachment(); bravo.socket.serializeAttachment({ ...attachment, authorityRevision: 999 });
        await h.wake(); expect(alice.socket.readyState).toBe(1); expect(bravo.socket.closed.code).toBe(4401);
        expect(alice.socket.frames.slice(before).some(frame => ['hello', 'welcome', 'join', 'line'].includes(frame.t))).toBe(false);
        await h.message(alice, { t: 'say', ch: '#stalemate', text: 'Still connected after wake' });
        expect(alice.socket.frames.some(frame => frame.t === 'notice' && frame.text.startsWith('Slow mode:'))).toBe(true);
        await vi.advanceTimersByTimeAsync(3000);
        await h.message(alice, { t: 'say', ch: '#stalemate', text: 'Still connected after wake' });
        expect(alice.socket.frames.some(frame => frame.t === 'line' && frame.text === 'Still connected after wake')).toBe(true);
        expect((await h.lobby().authority.records.transaction(tx => tx.get('authority-connection-index:v1'))).ids).toEqual([alice.socket.deserializeAttachment().id]);
    });

    it('cold-starts without old sockets, removes their bindings, and allows a fresh connection', async () => {
        const h = await harness(), alice = await h.visitor('Alice'); await h.wake({ dropSockets: true });
        expect(h.lobby().authorityUnavailable).toBe(false);
        expect((await h.lobby().authority.records.transaction(tx => tx.get('authority-connection-index:v1'))).ids).toEqual([]);
        expect((await h.lobby().authority.load()).state.sessions.connections).toEqual([]);
        const response = await betaFetch(request(`/lobby?preview=${PREVIEW}`, { cookie: alice.cookie, upgrade: true }), h.env);
        expect(response.status).toBe(101); expect(h.state.getWebSockets()).toHaveLength(1);
    });

    it.each(['accept', 'attachment'])('rolls back connection membership after an injected upgrade %s failure', async boundary => {
        const h = await harness(), who = await h.guest();
        if (boundary === 'accept') vi.spyOn(h.state, 'acceptWebSocket').mockImplementationOnce(() => { throw Error('synthetic accept failure'); });
        else vi.spyOn(Socket.prototype, 'serializeAttachment').mockImplementationOnce(() => { throw Error('synthetic attachment failure'); });
        const response = await betaFetch(request(`/lobby?preview=${PREVIEW}`, { cookie: who.cookie, upgrade: true }), h.env);
        expect(response.status).toBe(503);
        expect(h.lobby().engine._debug.conns.size).toBe(0);
        expect((await h.lobby().authority.records.transaction(tx => tx.get('authority-connection-index:v1'))).ids).toEqual([]);
        expect(h.state.getWebSockets()).toHaveLength(0);
    });

    it('maintains a future alarm with an empty registry and prunes expired selected reports and logs', async () => {
        const h = await harness(); expect(await h.state.storage.getAlarm()).toBeGreaterThan(Date.now());
        const reporter = await h.guest(); await submitPrivate(h, reporter);
        await h.lobby().authority.records.transaction(tx => writeLobbyEffects({ tx, now: Date.now(), effects: [['modlog', {
            at: Date.now() - LOG_TTL + 1000, by: 'FixtureReviewer', action: 'dismiss-report', target: 'synthetic-id', reason: '', ch: '#stalemate'
        }]] }));
        vi.setSystemTime(Date.now() + PRIVATE_LIMITS.ttlMs + 1001); await h.lobby().alarm(); await h.settle();
        expect((await h.lobby().authority.health()).used).toBe(0); expect(await h.state.storage.getAlarm()).toBeGreaterThan(Date.now());
        expect((await h.lobby().privateReportQueue.snapshot()).reports).toEqual([]);
        expect((await h.lobby().authority.load()).state.modlog).toEqual([]);
    });

    it('uses a synthetic verified ingress profile but real staff authority, then withholds evidence after allowlist removal', async () => {
        const h = await harness(), guest = await h.visitor('Alice'); await submitPrivate(h, guest);
        const email = 'reviewer@example.invalid', profile = { kind: 'staff', account: await accountId(email, h.env.HANGOUT_HMAC_KEY),
            role: 'moderator', admin: true, expiresAt: Date.now() + 60000 }, sid = crypto.randomUUID();
        expect((await h.bound('register', { sid, version: '1', exp: Date.now() + 100000, iph: 'S'.repeat(22), profile })).status).toBe(200);
        const identity = { betaSid: sid, betaInviteVersion: '1', expiresAt: profile.expiresAt, dev: 'fixture-staff-device', iph: 'S'.repeat(22),
            role: profile.role, admin: profile.admin, account: profile.account, email };
        expect((await h.lobby().fetch(new Request('https://internal/lobby-admin', { headers: { 'X-Hangout-Identity': JSON.stringify(identity) } }))).status).toBe(101);
        const staff = { socket: h.state.getWebSockets().at(-1) }; await h.message(staff, { t: 'hello', nick: 'FixtureReviewer', age13: true });
        expect(JSON.stringify(staff.socket.frames.filter(frame => frame.t === 'admin'))).toContain(QUOTE);
        staff.socket.frames.length = 0; h.env.HANGOUT_MODERATOR_EMAILS = ''; h.lobby().engine.notifyAiStatus(); await h.settle();
        await h.message(guest, { t: 'say', ch: '#stalemate', text: 'Public conversation after staff removal' });
        expect(JSON.stringify(staff.socket.frames)).not.toContain(QUOTE); expect(JSON.stringify(guest.socket.frames)).not.toContain(QUOTE);
        expect(staff.socket.frames.some(frame => frame.t === 'admin')).toBe(false);
        expect((await h.lobby().privateReportQueue.snapshot()).reports).toHaveLength(1);
    });
});

describe('cohort preparation through the actual cookie gateway and SQLite Lobby', () => {
    it('keeps current C2 withdrawal, selected reporting, healthy progress and SID revocation authoritative', async () => {
        const h = await harness({ participation: true }), authority = h.lobby().authority;
        const participants = new Map(), decisions = new Map(); let serial = 0;
        const reference = () => 'synthetic_cohort_' + String(++serial).padStart(10, '0');
        const config = { policy: { version: 1, policyVersion: 'synthetic-cohort-gateway-v1', revision: 1,
            communityRef: LOBBY_AUTHORITY_COMMUNITY, noticeDigest: 'c'.repeat(64), decisionRef: 'synthetic_cohort_operator',
            state: 'qualified', purposes: [...PARTICIPATION_PURPOSES], issuedAt: NOW - 100, effectiveAt: NOW - 100,
            expiresAt: NOW + 1000000, maxSessionMs: 10000 },
            rules: { version: 1, verifierRef: 'synthetic_cohort_verifier', pendingMs: 10000, grantMs: 500000,
                subjectTailMs: 10000, guardianTailMs: 10000, receiptTailMs: 10000, callbackMs: 10000, operationMs: 10000 } };
        // Only these operator/relationship decisions are synthetic. Cookies,
        // current bound identity, C2 partitions, engine and SQL commits are real.
        const ledger = createPartitionedParticipationConsents({ storage: authority.records, now: () => Date.now(), randomRef: reference,
            admitSubject: async () => true, adapters: {
                qualifyPolicy: async () => ({ config, expiresAt: NOW + 1000000 }),
                authenticateParticipant: async ({ proof, purpose }) => { const value = participants.get(proof);
                    return purpose === 'begin' ? value : value && { principalRef: value.principalRef, communityRef: value.communityRef, expiresAt: value.expiresAt }; },
                verifyConsent: async ({ proof }) => decisions.get(proof), authenticateGuardian: async () => null, authorizeMaintenance: async () => null
            } });
        expect((await ledger.installPolicy('synthetic-cohort-operator')).ok).toBe(true);
        const visitor = async nick => {
            const who = await h.guest(), proof = reference(), principalRef = 's_' + who.access.sid;
            participants.set(proof, { operationRef: reference(), principalRef, communityRef: LOBBY_AUTHORITY_COMMUNITY, expiresAt: NOW + 500000 });
            const pending = await ledger.begin(proof, { expectedRevision: 0, purposes: [...PARTICIPATION_PURPOSES] }); expect(pending.ok).toBe(true);
            const decision = reference(); decisions.set(decision, { operationRef: reference(), pendingRef: pending.pendingRef, subjectRef: pending.subjectRef,
                principalRef, guardianPrincipalRef: 'synthetic_cohort_guardian', decisionRef: reference(), verifierRef: config.rules.verifierRef,
                status: 'approved', purposes: [...PARTICIPATION_PURPOSES], verifiedAt: NOW, expiresAt: NOW + 500000 });
            expect((await ledger.complete(decision)).state).toBe('authorized');
            const response = await betaFetch(request('/lobby?preview=' + PREVIEW, { cookie: who.cookie, upgrade: true }), h.env);
            expect(response.status).toBe(101); const socket = h.state.getWebSockets().at(-1);
            await h.message({ socket }, { t: 'hello', nick, age13: true });
            expect(socket.frames.some(frame => frame.t === 'welcome' && frame.nick === nick)).toBe(true);
            return { ...who, socket, binding: socket.deserializeAttachment() };
        };
        const alice = await visitor('CohortAlice'), bravo = await visitor('CohortBravo');
        const initial = await authority.resolveParticipationConnections([alice.binding, bravo.binding]);
        expect(initial.map(value => value?.principalRef)).toEqual(['s_' + alice.access.sid, 's_' + bravo.access.sid]);
        await h.message(bravo, { t: 'say', ch: '#stalemate', text: 'Selected cohort safety witness' });
        const received = alice.socket.frames.find(frame => frame.t === 'line' && frame.text === 'Selected cohort safety witness'); expect(received).toBeTruthy();
        const own = await betaFetch(request('/beta/participation', { cookie: alice.cookie }), h.env);
        const status = await own.json(); expect(status).toMatchObject({ state: 'authorized', revision: 2 });
        const stopped = await betaFetch(request('/beta/participation/stop', { cookie: alice.cookie, body: { expectedRevision: status.revision } }), h.env);
        expect(stopped.status).toBe(200); expect(await stopped.json()).toMatchObject({ state: 'withdrawn', revision: 3 }); await h.settle();
        expect(alice.socket.readyState).toBe(1); expect(alice.socket.frames.some(frame => frame.t === 'sharing-stopped')).toBe(true);
        await h.message(alice, { t: 'report', id: received.id, text: received.text });
        expect(alice.socket.frames.some(frame => frame.t === 'report-status' && frame.id === received.id && frame.submitted === true)).toBe(true);
        await h.message(alice, { t: 'say', ch: '#stalemate', text: 'Never publish after cohort withdrawal' });
        expect(bravo.socket.frames.some(frame => frame.t === 'line' && frame.text === 'Never publish after cohort withdrawal')).toBe(false);
        vi.setSystemTime(Date.now() + 4000);
        await h.message(bravo, { t: 'say', ch: '#stalemate', text: 'Healthy cohort peer continues' });
        expect(bravo.socket.frames.some(frame => frame.t === 'line' && frame.text === 'Healthy cohort peer continues')).toBe(true);
        expect((await logout(h, alice)).status).toBe(200); await h.settle();
        expect(await betaSession(request('/beta/state', { cookie: alice.cookie }), h.env)).toBeNull();
        const current = await authority.resolveParticipationConnections([alice.binding, bravo.binding]);
        expect(current[0]).toBeNull(); expect(current[1]?.principalRef).toBe('s_' + bravo.access.sid);
        expect(h.env.BETA_SESSIONS.idFromName).not.toHaveBeenCalled();
    });
});
