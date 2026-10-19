// @vitest-environment node
// Real DO/registry/queue integration. Staff identities are synthetic trusted
// internal fixtures; public staff admission still requires a verified Access JWT.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { HangoutRoom } from '../src/index.mjs';
import { HangoutLobby } from '../src/lobby-do.mjs';
import { betaFetch } from '../src/beta-entry.mjs';
import { betaSession } from '../src/beta-auth.mjs';
import { BetaSessions } from '../src/beta-sessions.mjs';
import { LIMITS } from '../src/private-reports.mjs';

const ORIGIN = 'https://private-report.fixture.test';
const INVITE = 'fixture-private-invitation-'.repeat(2), PREVIEW = 'fixture-private-preview-'.repeat(2);
const ROOM = 'a'.repeat(64), QUOTE = 'Synthetic private allegation: staff only 8f123';
const CONTROL = { type: 'private-report', v: 1, request: 'R'.repeat(24), kind: 'message', target: null,
    claimedName: 'Claimed nickname', excerpt: QUOTE, reason: 'Synthetic reason for human review', consent: true };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
class Socket {
    readyState = 1; frames = [];
    send(raw) { if (this.readyState !== 1) throw Error('closed'); this.frames.push(JSON.parse(raw)); }
    close(code, reason) { this.closed = { code, reason }; this.readyState = 3; }
    serializeAttachment(value) { this.saved = structuredClone(value); }
    deserializeAttachment() { return structuredClone(this.saved); }
}
function state() {
    const values = new Map(), sockets = new Map(), background = [];
    let tail = Promise.resolve(), alarm;
    const storage = {
        get: async key => structuredClone(values.get(key)), put: async (key, value) => { values.set(key, structuredClone(value)); },
        delete: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key); },
        list: async ({ prefix = '', limit = Infinity, reverse = false, end } = {}) => new Map([...values]
            .filter(([key]) => key.startsWith(prefix) && (!end || key < end))
            .sort(([a], [b]) => reverse ? b.localeCompare(a) : a.localeCompare(b)).slice(0, limit)
            .map(([key, value]) => [key, structuredClone(value)])),
        getAlarm: async () => alarm, setAlarm: async value => { alarm = value; }, deleteAlarm: async () => { alarm = undefined; }
    };
    storage.transaction = async fn => fn(storage);
    return { values, sockets, storage, background,
        blockConcurrencyWhile(fn) { const result = tail.then(fn); tail = result.catch(() => {}); return result; },
        getWebSockets: tag => [...sockets].filter(([ws, tags]) => ws.readyState === 1 && (!tag || tags.includes(tag))).map(([ws]) => ws),
        getTags: ws => sockets.get(ws) || [], acceptWebSocket: (ws, tags) => sockets.set(ws, tags),
        waitUntil: promise => background.push(promise)
    };
}
function runtime() {
    vi.stubGlobal('WebSocketPair', class { constructor() { this[0] = new Socket(); this[1] = new Socket(); } });
    const NativeResponse = globalThis.Response;
    vi.stubGlobal('Response', class extends NativeResponse {
        constructor(body, init) {
            super(body, init?.status === 101 ? { status: 200 } : init);
            if (init?.status === 101) Object.defineProperty(this, 'status', { value: 101 });
            this.webSocket = init?.webSocket;
        }
    });
    vi.stubGlobal('fetch', vi.fn(async () => { throw Error('External provider requests are forbidden in this fixture'); }));
}
function harness(extra = {}) {
    const lobbyState = state(), registryState = state(), roomState = state();
    const env = { HANGOUT_BETA_MODE: 'protected', HANGOUT_BETA_INVITE_VERSION: '1', HANGOUT_BETA_INVITE_KEY: INVITE,
        HANGOUT_PREVIEW_KEY: PREVIEW, HANGOUT_HMAC_KEY: 'fixture-private-report-signing-'.repeat(2),
        HANGOUT_ACCESS_TEAM: 'fixture.cloudflareaccess.com', HANGOUT_ACCESS_AUD: 'a'.repeat(64), HANGOUT_OWNER_ACCESS_AUD: 'b'.repeat(64),
        HANGOUT_MODERATOR_EMAILS: 'moderator@fixture.test', HANGOUT_OWNER_EMAIL: 'owner@fixture.test',
        HANGOUT_EXTRA_ORIGINS: ORIGIN, HANGOUT_TURNSTILE_SECRET: 'fixture-unused-turnstile',
        ASSETS: { fetch: vi.fn(async () => new Response('not found', { status: 404 })) },
        QUOTA: { idFromName: name => name, get: () => ({ fetch: async () => new Response('ok') }) }, ...extra };
    let lobby, room;
    env.LOBBY = { idFromName: name => name, get: () => ({ fetch: request => getLobby().fetch(request) }) };
    env.ROOMS = { idFromName: name => name, get: () => ({ fetch: request => getRoom().fetch(request) }) };
    const registry = new BetaSessions(registryState, env);
    env.BETA_SESSIONS = { idFromName: name => name, get: () => registry };
    function getLobby() { return lobby ||= new HangoutLobby(lobbyState, env); }
    function getRoom() { return room ||= new HangoutRoom(roomState, env); }
    return { env, lobbyState, registryState, roomState, registry, lobby: getLobby, room: getRoom,
        async wakeLobby() { lobby = new HangoutLobby(lobbyState, env); await lobby.ready; return lobby; } };
}
function request(path, { cookie, body, upgrade = false, method = body === undefined ? 'GET' : 'POST', headers = {} } = {}) {
    return new Request(ORIGIN + path, { method, headers: { Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(upgrade ? { Upgrade: 'websocket' } : {}), ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function guest(h) {
    const response = await betaFetch(request('/beta/unlock', { body: { key: INVITE } }), h.env);
    expect(response.status).toBe(200);
    const cookie = response.headers.get('Set-Cookie').split(';')[0];
    return { cookie, ...(await betaSession(request('/beta/state', { cookie }), h.env)) };
}
async function roomVisitor(h) {
    const who = await guest(h);
    const response = await betaFetch(request(`/room?room=${ROOM}&preview=${PREVIEW}`, { cookie: who.cookie, upgrade: true }), h.env);
    expect(response.status).toBe(101);
    return { ...who, socket: h.roomState.getWebSockets().at(-1) };
}
async function settle(h) {
    for (let round = 0; round < 8; round += 1) {
        const tasks = h.lobbyState.background.splice(0);
        await Promise.all(tasks); await Promise.resolve();
        if (!h.lobbyState.background.length) { await Promise.resolve(); if (!h.lobbyState.background.length) return; }
    }
    throw Error('Fixture background work did not settle');
}
async function lobbyVisitor(h, { role = 'fan', admin = false, nick = role === 'fan' ? 'OrdinaryVisitor' : 'FixtureModerator', beforeHello } = {}) {
    const who = await guest(h);
    let response;
    if (role === 'fan' && !admin) response = await betaFetch(request(`/lobby?preview=${PREVIEW}`, { cookie: who.cookie, upgrade: true }), h.env);
    else {
        // Explicit trusted internal fixture, never a public admission shortcut.
        const identity = { betaSid: who.access.sid, betaInviteVersion: who.access.version, expiresAt: who.access.exp,
            dev: 'fixture-device-' + crypto.randomUUID(), iph: 'I'.repeat(22), role, admin,
            email: role === 'owner' ? 'owner@fixture.test' : 'moderator@fixture.test', account: '' };
        response = await h.lobby().fetch(new Request('https://internal/lobby-admin', {
            headers: { 'X-Hangout-Identity': JSON.stringify(identity) }
        }));
    }
    expect(response.status).toBe(101);
    const socket = h.lobbyState.getWebSockets().at(-1);
    if (beforeHello) await beforeHello({ who, socket });
    await h.lobby().webSocketMessage(socket, JSON.stringify({ t: 'hello', nick, age13: true }));
    await settle(h);
    return { ...who, socket };
}
const latestAdmin = ws => ws.frames.filter(frame => frame.t === 'admin').at(-1);
const notices = ws => ws.frames.filter(frame => frame.t === 'notice').map(frame => frame.text);
const reportAck = ws => ws.frames.filter(frame => frame.privateReport).at(-1)?.privateReport;
const cmd = (h, who, action, id) => h.lobby().webSocketMessage(who.socket,
    JSON.stringify({ t: 'cmd', ch: '#stalemate', name: 'privatereport', args: [action, id] }));
async function submit(h, who, extra = {}) {
    await h.room().webSocketMessage(who.socket, JSON.stringify({ ...CONTROL, ...extra }));
    await settle(h);
    const ack = reportAck(who.socket);
    expect(ack).toMatchObject({ ok: true, status: 'pending' });
    return ack;
}
const privateActions = h => h.lobby().engine.modlog.filter(entry => entry.action.startsWith('private-report-'));
const assertNoQuote = (...sockets) => { for (const ws of sockets) expect(JSON.stringify(ws.frames)).not.toContain(QUOTE); };
function failRegistryRead(h, sid) {
    const fetchRegistry = h.registry.fetch.bind(h.registry);
    vi.spyOn(h.registry, 'fetch').mockImplementation(async request => {
        if (new URL(request.url).pathname === '/check' && (await request.clone().json()).sid === sid) {
            return new Response('Synthetic registry read unavailable', { status: 503 });
        }
        return fetchRegistry(request);
    });
}
function holdStaffRead(h, sid) {
    const reached = deferred(), release = deferred(), fetchRegistry = h.registry.fetch.bind(h.registry);
    const gate = { reached: reached.promise, release: release.resolve, valid: false };
    let held = false;
    vi.spyOn(h.registry, 'fetch').mockImplementation(async request => {
        const relevant = new URL(request.url).pathname === '/check' && (await request.clone().json()).sid === sid;
        const response = await fetchRegistry(request);
        if (relevant && !held) {
            held = true; gate.valid = response.status === 200; reached.resolve(); await release.promise;
        }
        return response;
    });
    return gate;
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-19T12:00:00Z')); runtime(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('private Room → durable Lobby queue → restricted staff review', () => {
    it('delivers unverified allegations only to staff, persists them, and resolves through the actual staff command', async () => {
        const h = harness({ HANGOUT_AI_MODERATION: 'review', OPENAI_API_KEY: 'synthetic-provider-key-unused' });
        const ordinary = await lobbyVisitor(h), staff = await lobbyVisitor(h, { role: 'moderator', admin: true });
        const reporter = await roomVisitor(h), target = await roomVisitor(h);
        const review = vi.spyOn(h.lobby().aiModerator, 'review');
        ordinary.socket.frames = []; target.socket.frames = [];
        const before = h.lobby().engine.snapshot(), ack = await submit(h, reporter, { target: target.socket.deserializeAttachment().id });
        expect(ack).toMatchObject({ ok: true, duplicate: false, status: 'pending' });
        const evidence = latestAdmin(staff.socket).state.privateReports.reports;
        expect(evidence).toHaveLength(1);
        expect(evidence[0]).toMatchObject({ id: ack.id, excerpt: QUOTE, claimedName: CONTROL.claimedName,
            quoteVerified: false, targetMembership: 'live' });
        expect(evidence[0]).not.toHaveProperty('targetSessionRef');
        expect(h.lobbyState.values.get('private-reports-v1').reports[0].excerpt).toBe(QUOTE);
        assertNoQuote(ordinary.socket, reporter.socket, target.socket);
        expect(review).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
        expect(h.lobby().engine.snapshot().bans).toEqual(before.bans);
        expect(ordinary.socket.frames.some(frame => ['delete', 'cam', 'kicked'].includes(frame.t))).toBe(false);
        await cmd(h, staff, 'resolve', ack.id); await settle(h);
        expect(h.lobbyState.values.get('private-reports-v1').reports).toEqual([]);
        expect(h.lobbyState.values.get('private-reports-v1').receipts[0].status).toBe('resolved');
        expect(latestAdmin(staff.socket).state.privateReports.reports).toEqual([]);
        expect(notices(staff.socket)).toContain('Private report resolved. No chat was deleted or participant punished.');
        expect(privateActions(h)).toEqual([expect.objectContaining({ action: 'private-report-resolve', target: ack.id })]);
        expect(reporter.socket.readyState).toBe(1); expect(target.socket.readyState).toBe(1);
        assertNoQuote(ordinary.socket, reporter.socket, target.socket);
    });

    for (const outcome of ['success', 'failure']) it(`waits for the real report write and handles held ${outcome} honestly`, async () => {
        const h = harness(), staff = await lobbyVisitor(h, { role: 'moderator', admin: true }), reporter = await roomVisitor(h);
        const reached = deferred(), release = deferred(), put = h.lobbyState.storage.put;
        let armed = true;
        vi.spyOn(h.lobbyState.storage, 'put').mockImplementation(async (key, value) => {
            if (key === 'private-reports-v1' && armed) {
                armed = false; reached.resolve(); await release.promise;
                if (outcome === 'failure') throw Error('Synthetic required write failed');
            }
            return put(key, value);
        });
        const pending = h.room().webSocketMessage(reporter.socket, JSON.stringify(CONTROL)); await reached.promise;
        expect(reportAck(reporter.socket)).toBeUndefined();
        expect(h.lobbyState.values.get('private-reports-v1')).toBeUndefined();
        expect(latestAdmin(staff.socket).state.privateReports.reports).toEqual([]);
        release.resolve(); await pending; await settle(h);
        if (outcome === 'success') {
            expect(reportAck(reporter.socket)).toMatchObject({ ok: true, status: 'pending' });
            expect(latestAdmin(staff.socket).state.privateReports.reports[0].excerpt).toBe(QUOTE);
        } else {
            expect(reportAck(reporter.socket)).toMatchObject({ ok: false, status: 503 });
            expect(JSON.stringify([...h.lobbyState.values])).not.toContain(QUOTE);
            expect(latestAdmin(staff.socket).state.privateReports.reports).toEqual([]);
        }
    });

    for (const outcome of ['success', 'failure']) it(`does not execute staff disposition until abuse accounting commits (${outcome})`, async () => {
        const h = harness(), staff = await lobbyVisitor(h, { role: 'moderator', admin: true }), reporter = await roomVisitor(h);
        const ack = await submit(h, reporter), queueResolve = vi.spyOn(h.lobby().privateReportQueue, 'resolve');
        staff.socket.frames = [];
        const reached = deferred(), release = deferred(), put = h.lobbyState.storage.put;
        let armed = true;
        vi.spyOn(h.lobbyState.storage, 'put').mockImplementation(async (key, value) => {
            if (key === 'abuse' && armed) {
                armed = false; reached.resolve(); await release.promise;
                if (outcome === 'failure') throw Error('Synthetic abuse accounting failed');
            }
            return put(key, value);
        });
        const pending = cmd(h, staff, 'resolve', ack.id); await reached.promise;
        expect(queueResolve).not.toHaveBeenCalled(); expect(privateActions(h)).toEqual([]);
        expect(h.lobbyState.values.get('private-reports-v1').receipts[0].status).toBe('pending');
        expect(notices(staff.socket).some(text => /Private report resolved/.test(text))).toBe(false);
        release.resolve(); await pending; await settle(h);
        if (outcome === 'success') {
            expect(queueResolve).toHaveBeenCalledOnce();
            expect(h.lobbyState.values.get('private-reports-v1').receipts[0].status).toBe('resolved');
            expect(privateActions(h)).toHaveLength(1);
        } else {
            expect(queueResolve).not.toHaveBeenCalled(); expect(privateActions(h)).toEqual([]);
            expect(h.lobbyState.values.get('private-reports-v1').receipts[0].status).toBe('pending');
            expect(notices(staff.socket).some(text => /Changes are not confirmed/.test(text))).toBe(true);
        }
    });

    it('does not confirm or log a disposition whose actual queue write fails', async () => {
        const h = harness(), staff = await lobbyVisitor(h, { role: 'moderator', admin: true }), reporter = await roomVisitor(h);
        const ack = await submit(h, reporter), put = h.lobbyState.storage.put;
        staff.socket.frames = [];
        vi.spyOn(h.lobbyState.storage, 'put').mockImplementation((key, value) => key === 'private-reports-v1'
            ? Promise.reject(Error('Synthetic disposition storage failure')) : put(key, value));
        await cmd(h, staff, 'dismiss', ack.id); await settle(h);
        expect(privateActions(h)).toEqual([]);
        expect(h.lobbyState.values.get('private-reports-v1').receipts[0].status).toBe('pending');
        expect(notices(staff.socket).some(text => /Private report changes are not confirmed/.test(text))).toBe(true);
        expect(notices(staff.socket).some(text => /Private report dismissed\./.test(text))).toBe(false);
    });

    for (const first of ['resolve', 'dismiss']) it(`keeps the actual ${first} disposition on an opposite duplicate without a false modlog`, async () => {
        const h = harness(), staff = await lobbyVisitor(h, { role: 'moderator', admin: true }), reporter = await roomVisitor(h);
        const ack = await submit(h, reporter);
        await cmd(h, staff, first, ack.id); await settle(h);
        const actual = first === 'resolve' ? 'resolved' : 'dismissed', before = privateActions(h);
        staff.socket.frames = [];
        await cmd(h, staff, first === 'resolve' ? 'dismiss' : 'resolve', ack.id); await settle(h);
        expect(h.lobbyState.values.get('private-reports-v1').receipts[0].status).toBe(actual);
        expect(privateActions(h)).toEqual(before);
        expect(notices(staff.socket)).toContain(`Private report was already ${actual}. No new action was taken.`);
        expect(h.lobbyState.values.get('private-reports-v1').reports).toEqual([]);
    });

    for (const mode of ['alarm', 'restart']) it(`purges persisted quotes after the TTL on ${mode}`, async () => {
        const h = harness(), staff = await lobbyVisitor(h, { role: 'moderator', admin: true }), reporter = await roomVisitor(h);
        await submit(h, reporter);
        expect(JSON.stringify([...h.lobbyState.values])).toContain(QUOTE);
        vi.setSystemTime(Date.now() + LIMITS.ttlMs + 1);
        if (mode === 'alarm') await h.lobby().alarm(); else await h.wakeLobby();
        await settle(h);
        expect(h.lobbyState.values.get('private-reports-v1')).toMatchObject({ reports: [], receipts: [] });
        expect(JSON.stringify([...h.lobbyState.values])).not.toContain(QUOTE);
        expect(h.lobby().privateReportState.reports).toEqual([]);
        expect(staff.socket.readyState).toBe(3);
    });

    it('does not expose or resolve reports for nonstaff, no-admin, revoked, expired or changed-role sessions', async () => {
        for (const mode of ['nonstaff', 'no-admin', 'revoked', 'expired', 'wrong-role']) {
            const h = harness(), reporter = await roomVisitor(h);
            const staff = await lobbyVisitor(h, mode === 'nonstaff' ? {} : { role: 'moderator', admin: mode !== 'no-admin' });
            const ack = await submit(h, reporter), resolve = vi.spyOn(h.lobby().privateReportQueue, 'resolve');
            staff.socket.frames = [];
            if (mode === 'revoked') {
                const response = await betaFetch(request('/beta/logout', { cookie: staff.cookie, body: {} }), h.env);
                expect(response.status).toBe(200);
            } else if (mode === 'expired') vi.setSystemTime(staff.access.exp + 1);
            else if (mode === 'wrong-role') h.env.HANGOUT_MODERATOR_EMAILS = '';
            await h.lobby().webSocketMessage(staff.socket, JSON.stringify({ t: 'admin-refresh' }));
            await cmd(h, staff, 'resolve', ack.id); await settle(h);
            expect(resolve).not.toHaveBeenCalled(); expect(privateActions(h)).toEqual([]);
            expect(h.lobbyState.values.get('private-reports-v1').receipts[0].status).toBe('pending');
            expect(staff.socket.frames.some(frame => frame.t === 'admin')).toBe(false);
            assertNoQuote(staff.socket);
        }
    });

    it('keeps private HTTP intake internal and public staff admission behind real JWT authorization', async () => {
        const h = harness(), who = await guest(h), lobby = h.lobby(); await lobby.ready;
        const intake = vi.spyOn(lobby, 'receivePrivateReport');
        const forged = { betaSid: who.access.sid, betaInviteVersion: who.access.version, expiresAt: who.access.exp,
            dev: 'forged-public-device', iph: 'I'.repeat(22), role: 'moderator', email: 'moderator@fixture.test', admin: true };
        const headers = { 'X-Hangout-Identity': JSON.stringify(forged), 'X-Hangout-Beta-Session': JSON.stringify(forged), 'X-Hangout-Private-Room': ROOM };
        for (const path of ['/__beta/private-report', '/lobby/__beta/private-report', '/private-report']) {
            expect((await betaFetch(request(path, { cookie: who.cookie, body: { report: CONTROL }, headers }), h.env)).status).toBe(405);
            expect((await worker.fetch(request(path, { body: { report: CONTROL }, headers }), h.env)).status).toBe(404);
            expect((await betaFetch(request(path, { cookie: who.cookie, headers }), h.env)).status).toBe(404);
        }
        const privileged = request(`/lobby-admin?preview=${PREVIEW}`, { cookie: who.cookie, upgrade: true, headers });
        expect((await betaFetch(privileged, h.env)).status).toBe(403);
        expect((await worker.fetch(privileged, h.env)).status).toBe(403);
        expect(intake).not.toHaveBeenCalled(); expect(h.lobbyState.values.has('private-reports-v1')).toBe(false);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('withholds new evidence when durable staff revocation is queued behind a held report write', async () => {
        const h = harness(), staff = await lobbyVisitor(h, { role: 'moderator', admin: true }), reporter = await roomVisitor(h);
        const reached = deferred(), release = deferred(), revoked = deferred(), disconnect = deferred();
        const putReport = h.lobbyState.storage.put, putSession = h.registryState.storage.put;
        let armed = true;
        vi.spyOn(h.lobbyState.storage, 'put').mockImplementation(async (key, value) => {
            if (key === 'private-reports-v1' && armed) { armed = false; reached.resolve(); await release.promise; }
            return putReport(key, value);
        });
        vi.spyOn(h.registryState.storage, 'put').mockImplementation(async (key, value) => {
            await putSession(key, value);
            if (key === 'session:' + staff.access.sid && value.revoked) revoked.resolve();
        });
        const fetchLobby = h.lobby().fetch.bind(h.lobby());
        vi.spyOn(h.lobby(), 'fetch').mockImplementation(request => {
            if (new URL(request.url).pathname === '/__beta/disconnect') disconnect.resolve();
            return fetchLobby(request);
        });
        staff.socket.frames = [];
        const intake = h.room().webSocketMessage(reporter.socket, JSON.stringify(CONTROL));
        await reached.promise;
        let logout;
        try {
            // Revocation commits before its disconnect RPC can enter the Lobby's
            // concurrency block. Awaiting logout here would deadlock the fixture.
            logout = betaFetch(request('/beta/logout', { cookie: staff.cookie, body: {} }), h.env);
            await Promise.all([revoked.promise, disconnect.promise]);
            expect(h.registryState.values.get('session:' + staff.access.sid).revoked).toBe(true);
            expect(staff.socket.readyState).toBe(1);
        } finally { release.resolve(); }
        await intake; expect((await logout).status).toBe(200); await settle(h);
        expect(reportAck(reporter.socket)).toMatchObject({ ok: true, status: 'pending' });
        assertNoQuote(staff.socket);
        expect(staff.socket.frames.some(frame => frame.t === 'admin' && frame.state.privateReports?.reports?.length)).toBe(false);
    });

    it('filters the exact TTL+1 admin refresh before an alarm can refresh the cached queue', async () => {
        const h = harness(), reporter = await roomVisitor(h);
        await submit(h, reporter);
        vi.setSystemTime(Date.now() + LIMITS.ttlMs - 1000);
        // A fresh legitimate eight-hour staff session makes the retention boundary
        // observable instead of hiding it behind the first session's expiry.
        const staff = await lobbyVisitor(h, { role: 'moderator', admin: true, nick: 'FreshTtlReviewer' });
        expect(latestAdmin(staff.socket).state.privateReports.reports[0].excerpt).toBe(QUOTE);
        staff.socket.frames = [];
        vi.setSystemTime(Date.now() + 1001);
        await h.lobby().webSocketMessage(staff.socket, JSON.stringify({ t: 'admin-refresh' })); await settle(h);
        expect(staff.socket.readyState).toBe(1);
        assertNoQuote(staff.socket);
        expect(latestAdmin(staff.socket).state.privateReports.reports).toEqual([]);
    });

    it('fails closed on a fresh registry read failure before delivering evidence to existing staff', async () => {
        const h = harness(), staff = await lobbyVisitor(h, { role: 'moderator', admin: true }), reporter = await roomVisitor(h);
        staff.socket.frames = [];
        failRegistryRead(h, staff.access.sid);
        await submit(h, reporter);
        assertNoQuote(staff.socket);
        expect(staff.socket.frames.some(frame => frame.t === 'admin' && frame.state.privateReports?.reports?.length)).toBe(false);
    });

    it('does not let new admin admission bypass the fresh private-evidence delivery check', async () => {
        const h = harness(), reporter = await roomVisitor(h);
        await submit(h, reporter);
        const staff = await lobbyVisitor(h, { role: 'moderator', admin: true,
            beforeHello: ({ who }) => failRegistryRead(h, who.access.sid) });
        assertNoQuote(staff.socket);
        expect(staff.socket.frames.some(frame => frame.t === 'admin' && frame.state.privateReports?.reports?.length)).toBe(false);
    });

    it('cannot restore an older admin snapshot after a newer disposition when its valid registry response arrives late', async () => {
        const h = harness(), staff = await lobbyVisitor(h, { role: 'moderator', admin: true }), reporter = await roomVisitor(h);
        const ack = await submit(h, reporter), gate = holdStaffRead(h, staff.access.sid);
        staff.socket.frames = [];
        await h.lobby().webSocketMessage(staff.socket, JSON.stringify({ t: 'admin-refresh' }));
        await gate.reached;
        expect(gate.valid).toBe(true);
        const olderTasks = new Set(h.lobbyState.background);
        expect(olderTasks.size).toBeGreaterThan(0);
        try {
            await cmd(h, staff, 'resolve', ack.id);
            // Do not await the deliberately held old dispatch. Complete every
            // newer background write/check after the real command has finished.
            await new Promise(resolve => queueMicrotask(resolve));
            const newer = h.lobbyState.background.filter(task => !olderTasks.has(task));
            expect(newer.length).toBeGreaterThan(0);
            await Promise.all(newer);
            const latest = latestAdmin(staff.socket);
            expect(latest.state.privateReports.reports).toEqual([]);
            expect(latest.state.modlog).toContainEqual(expect.objectContaining({ action: 'private-report-resolve', target: ack.id }));
            const count = staff.socket.frames.filter(frame => frame.t === 'admin').length;
            gate.release(); await settle(h);
            // Attaching the current private cache alone would hide the quote,
            // but still emit the old pre-disposition modlog. Neither is allowed.
            expect(staff.socket.frames.filter(frame => frame.t === 'admin')).toHaveLength(count);
            expect(latestAdmin(staff.socket)).toEqual(latest);
            assertNoQuote(staff.socket);
        } finally { gate.release(); }
    });

    it('rechecks role, admin privilege and socket membership after a valid deferred staff registry read', async () => {
        for (const mode of ['role-change', 'admin-removed', 'socket-close']) {
            const h = harness(), staff = await lobbyVisitor(h, { role: 'moderator', admin: true }), reporter = await roomVisitor(h);
            await submit(h, reporter);
            const gate = holdStaffRead(h, staff.access.sid);
            staff.socket.frames = [];
            await h.lobby().webSocketMessage(staff.socket, JSON.stringify({ t: 'admin-refresh' }));
            await gate.reached;
            expect(gate.valid).toBe(true);
            try {
                if (mode === 'role-change') h.env.HANGOUT_MODERATOR_EMAILS = '';
                else if (mode === 'admin-removed') staff.socket.serializeAttachment({ ...staff.socket.deserializeAttachment(), admin: false });
                else staff.socket.close(1000, 'Synthetic departure during auth');
            } finally { gate.release(); }
            await settle(h);
            expect(staff.socket.frames.some(frame => frame.t === 'admin')).toBe(false);
            assertNoQuote(staff.socket);
        }
    });
});
