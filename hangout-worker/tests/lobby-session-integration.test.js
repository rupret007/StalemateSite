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
async function harness({ initialize = true, mode = 'lobby-v1' } = {}) {
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
