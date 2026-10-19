// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { betaFetch } from '../src/beta-entry.mjs';
import { betaSession, BETA_TTL } from '../src/beta-auth.mjs';
import { BetaSessions, BETA_SESSION_LIMIT, BETA_SESSION_ROOM_LIMIT, BETA_RETRY_BATCH, BETA_MINT_PER_IP_HOUR } from '../src/beta-sessions.mjs';
import { registryRequest } from '../src/beta-session-client.mjs';
import { HangoutRoom } from '../src/index.mjs';
import { HangoutLobby } from '../src/lobby-do.mjs';
import { createBucket, limitsFrom } from '../src/core.mjs';

const ORIGIN = 'https://beta.example';
const INVITE = 'beta-lifecycle-private-invite-'.repeat(2);
const PREVIEW = 'beta-lifecycle-compatibility-'.repeat(2);
const ROOM = 'a'.repeat(64), OTHER_ROOM = 'b'.repeat(64);
const FRAME = JSON.stringify({ iv: 'A'.repeat(16), c: 'ciphertext_only' });
class Socket {
    readyState = 1; frames = [];
    close(code, reason) { this.closed = { code, reason }; this.readyState = 3; }
    send(raw) { if (this.readyState !== 1) throw Error('closed'); this.frames.push(JSON.parse(raw)); }
    serializeAttachment(value) { this.attachment = structuredClone(value); }
    deserializeAttachment() { return structuredClone(this.attachment); }
}
function state() {
    const values = new Map(), sockets = new Map(), background = [];
    let queue = Promise.resolve(), alarm;
    const storage = {
        get: async (key) => structuredClone(values.get(key)), put: async (key, value) => values.set(key, structuredClone(value)),
        delete: async (keys) => { for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key); },
        list: async ({ prefix = '', limit = Infinity, reverse = false, end } = {}) => new Map([...values].filter(([key]) => key.startsWith(prefix) && (!end || key < end)).sort(([a], [b]) => reverse ? b.localeCompare(a) : a.localeCompare(b)).slice(0, limit).map(([key, value]) => [key, structuredClone(value)])),
        getAlarm: async () => alarm, setAlarm: async (value) => { alarm = value; }, deleteAlarm: async () => { alarm = undefined; }
    };
    storage.transaction = async (fn) => fn(storage);
    return { values, sockets, background, storage,
        blockConcurrencyWhile(fn) { const result = queue.then(fn); queue = result.catch(() => {}); return result; },
        getWebSockets: (tag) => [...sockets].filter(([ws, tags]) => ws.readyState !== 3 && (!tag || tags.includes(tag))).map(([ws]) => ws),
        getTags: (ws) => sockets.get(ws) || [], acceptWebSocket: (ws, tags) => sockets.set(ws, tags),
        waitUntil: (promise) => background.push(promise)
    };
}
function runtime() {
    vi.stubGlobal('WebSocketPair', class { constructor() { this[0] = new Socket(); this[1] = new Socket(); } });
    const NativeResponse = globalThis.Response;
    vi.stubGlobal('Response', class extends NativeResponse {
        constructor(body, init) { super(body, init?.status === 101 ? { status: 200 } : init); if (init?.status === 101) Object.defineProperty(this, 'status', { value: 101 }); this.webSocket = init?.webSocket; }
    });
}
function harness() {
    const registryState = state(), lobbyState = state(), roomStates = new Map(), rooms = new Map();
    const env = {
        HANGOUT_BETA_MODE: 'protected', HANGOUT_BETA_INVITE_VERSION: '1', HANGOUT_BETA_INVITE_KEY: INVITE,
        HANGOUT_HMAC_KEY: 'beta-lifecycle-signing-key-'.repeat(2), HANGOUT_PREVIEW_KEY: PREVIEW,
        ASSETS: { fetch: async () => new Response('<head></head><body>private product</body>', { headers: { 'Content-Type': 'text/html' } }) },
        QUOTA: { idFromName: (n) => n, get: () => ({ fetch: async () => new Response('ok') }) }
    };
    let lobby;
    const room = (id) => {
        if (!rooms.has(id)) { roomStates.set(id, state()); rooms.set(id, new HangoutRoom(roomStates.get(id), env)); }
        return rooms.get(id);
    };
    env.LOBBY = { idFromName: (n) => n, get: () => ({ fetch: (r) => { lobby ||= new HangoutLobby(lobbyState, env); return lobby.fetch(r); } }) };
    env.ROOMS = { idFromName: (n) => n, get: (id) => ({ fetch: (r) => room(id).fetch(r) }) };
    const registry = new BetaSessions(registryState, env);
    env.BETA_SESSIONS = { idFromName: (n) => n, get: () => registry };
    return { env, registry, registryState, roomStates, rooms, lobbyState, room,
        lobby: () => { lobby ||= new HangoutLobby(lobbyState, env); return lobby; },
        async wake(id) { const next = new HangoutRoom(roomStates.get(id), env); rooms.set(id, next); await next.ready; return next; }
    };
}
function request(path, { cookie, body, upgrade = false, method = body === undefined ? 'GET' : 'POST', headers = {} } = {}) {
    return new Request(ORIGIN + path, { method, headers: { Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(upgrade ? { Upgrade: 'websocket' } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
async function guest(h) {
    const response = await betaFetch(request('/beta/unlock', { body: { key: INVITE } }), h.env);
    expect(response.status).toBe(200);
    const cookie = response.headers.get('Set-Cookie').split(';')[0];
    return { cookie, ...(await betaSession(request('/beta/state', { cookie }), h.env)) };
}
async function join(h, who, id = ROOM, headers = {}) {
    const response = await betaFetch(request(`/room?room=${id}&preview=${PREVIEW}`, { cookie: who.cookie, upgrade: true, headers }), h.env);
    expect(response.status).toBe(101);
    const ws = h.roomStates.get(id).getWebSockets().at(-1);
    return ws;
}
const logout = (h, who) => betaFetch(request('/beta/logout', { cookie: who.cookie, body: {} }), h.env);
const record = (who, rooms = []) => ({ v: 1, sid: who.access.sid, version: '1', createdAt: Date.now(), exp: who.access.exp, revoked: false, pending: false, attempt: 0, retryAt: 0, rooms });

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-19T03:00:00Z')); runtime(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('beta session revocation across private rooms and lobby', () => {
    it('closes every registered room and lobby socket, preserves another visitor, and rejects copied cookies', async () => {
        const h = harness(), a = await guest(h), b = await guest(h);
        const lobby = await betaFetch(request(`/lobby?preview=${PREVIEW}`, { cookie: a.cookie, upgrade: true }), h.env);
        expect(lobby.status).toBe(101);
        const lobbySocket = h.lobbyState.getWebSockets()[0];
        const a1 = await join(h, a), a2 = await join(h, a, OTHER_ROOM), b1 = await join(h, b);
        const response = await logout(h, a);
        expect(response.status).toBe(200); expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0');
        for (const ws of [lobbySocket, a1, a2]) expect(ws.closed.code).toBe(4401);
        expect(b1.readyState).toBe(1);
        expect((await betaFetch(request('/beta/state', { cookie: a.cookie }), h.env)).status).toBe(401);
        expect((await betaFetch(request(`/room?room=${ROOM}&preview=${PREVIEW}`, { cookie: a.cookie, upgrade: true }), h.env)).status).toBe(401);
        const saved = h.registryState.values.get(`session:${a.access.sid}`);
        expect(saved).toMatchObject({ revoked: true, pending: false, rooms: [ROOM, OTHER_ROOM] });
        const before = b1.frames.length; await h.room(ROOM).webSocketMessage(a1, FRAME); expect(b1.frames).toHaveLength(before);
        expect(JSON.stringify([...h.registryState.values])).not.toContain('ciphertext_only');
    });
    it('durably revokes before fanout, reports failed closure honestly, and retries even when socket metadata is ended', async () => {
        const h = harness(), a = await guest(h), ws = await join(h, a);
        vi.spyOn(ws, 'close').mockImplementationOnce(() => { throw Error('transport close failed'); });
        const failed = await logout(h, a);
        expect(failed.status).toBe(503); expect(failed.headers.has('Set-Cookie')).toBe(false);
        expect(h.registryState.values.get(`session:${a.access.sid}`)).toMatchObject({ revoked: true, pending: true });
        expect((await betaFetch(request('/beta/state', { cookie: a.cookie }), h.env)).status).toBe(401);
        expect(ws.readyState).toBe(1); expect(ws.deserializeAttachment().ended).toBe(true);
        vi.setSystemTime(Date.now() + 60000); await h.registry.alarm();
        expect(ws.closed.code).toBe(4401); expect(h.registryState.values.get(`session:${a.access.sid}`).pending).toBe(false);
        expect((await logout(h, a)).status).toBe(200);
    });
    it('registers before upgrade and closes an admission that races logout', async () => {
        const h = harness(), a = await guest(h);
        let release, observed, revoked, checkCount = 0;
        const paused = new Promise((resolve) => { release = resolve; });
        const reached = new Promise((resolve) => { observed = resolve; });
        const committed = new Promise((resolve) => { revoked = resolve; });
        const put = h.registryState.storage.put;
        vi.spyOn(h.registryState.storage, 'put').mockImplementation(async (key, value) => { const result = await put(key, value); if (value.revoked) revoked(); return result; });
        const nativeFetch = h.registry.fetch.bind(h.registry);
        vi.spyOn(h.registry, 'fetch').mockImplementation(async (r) => {
            const response = await nativeFetch(r);
            if (new URL(r.url).pathname === '/check' && ++checkCount === 2) { observed(); await paused; }
            return response;
        });
        const admission = betaFetch(request(`/room?room=${ROOM}&preview=${PREVIEW}`, { cookie: a.cookie, upgrade: true }), h.env);
        await reached;
        const ending = logout(h, a);
        await committed;
        expect(h.registryState.values.get(`session:${a.access.sid}`).revoked).toBe(true);
        release();
        expect((await admission).status).toBe(101); expect((await ending).status).toBe(200);
        expect([...h.roomStates.get(ROOM).sockets.keys()][0].closed.code).toBe(4401);
    });
    it('fails closed and returns a service error when the registry cannot be read', async () => {
        const h = harness(), a = await guest(h);
        h.env.BETA_SESSIONS.get = () => { throw Error('registry down'); };
        const response = await betaFetch(request('/beta/state', { cookie: a.cookie }), h.env);
        expect(response.status).toBe(503); expect(await response.text()).toContain('unavailable');
    });
    it('never forwards browser requests to internal revocation endpoints or trusts their supplied session header', async () => {
        const h = harness(), a = await guest(h);
        const headers = { 'X-Hangout-Beta-Session': JSON.stringify({ betaSid: 'attacker-session-123456', betaInviteVersion: '1', expiresAt: a.access.exp }) };
        const ws = await join(h, a, ROOM, headers);
        expect(ws.deserializeAttachment().betaSid).toBe(a.access.sid);
        expect((await betaFetch(request('/__beta/disconnect', { cookie: a.cookie, body: {}, headers: { 'X-Hangout-Identity': JSON.stringify({ betaSid: a.access.sid }) } }), h.env)).status).toBe(405);
        expect(ws.readyState).toBe(1);
    });
});

describe('private socket expiry, hibernation and cost caps', () => {
    it('expires an idle socket by alarm and refuses old cookie admission', async () => {
        const h = harness(), a = await guest(h), ws = await join(h, a);
        vi.setSystemTime(a.access.exp + 1);
        await h.room(ROOM).alarm();
        expect(ws.closed.code).toBe(4401);
        expect((await betaFetch(request('/beta/state', { cookie: a.cookie }), h.env)).status).toBe(401);
    });
    it('rejects expired or changed-version frames locally without a registry RPC', async () => {
        for (const kind of ['expiry', 'version']) {
            const h = harness(), a = await guest(h), ws = await join(h, a), spy = vi.spyOn(h.registry, 'fetch');
            if (kind === 'expiry') vi.setSystemTime(a.access.exp + 1); else h.env.HANGOUT_BETA_INVITE_VERSION = '2';
            await h.room(ROOM).webSocketMessage(ws, FRAME);
            expect(ws.closed.code).toBe(4401); expect(spy).not.toHaveBeenCalled();
        }
    });
    it('checks revocation on wake and rejects orphaned or corrupt attachments', async () => {
        const h = harness(), a = await guest(h), ws = await join(h, a);
        const saved = h.registryState.values.get(`session:${a.access.sid}`);
        h.registryState.values.set(`session:${a.access.sid}`, { ...saved, revoked: true, pending: true });
        await h.wake(ROOM); expect(ws.closed.code).toBe(4401);
        const b = await guest(h), second = await join(h, b, OTHER_ROOM);
        second.serializeAttachment({ ...second.deserializeAttachment(), bucket: { v: 1, tokens: -1, total: 0, last: Date.now() } });
        await h.wake(OTHER_ROOM); expect(second.closed.code).toBe(4401);
    });
    it('deduplicates registry checks per SID on wake/alarm and avoids adding regular RPCs per frame', async () => {
        const h = harness(), a = await guest(h), first = await join(h, a), second = await join(h, a), spy = vi.spyOn(h.registry, 'fetch');
        const room = await h.wake(ROOM);
        expect(spy.mock.calls.filter(([r]) => new URL(r.url).pathname === '/check')).toHaveLength(1);
        spy.mockClear(); await room.alarm(); expect(spy).toHaveBeenCalledOnce();
        spy.mockClear(); await room.webSocketMessage(first, FRAME); await room.webSocketMessage(second, FRAME);
        expect(spy).not.toHaveBeenCalled();
    });
    it('preserves the absolute frame cap through hibernation without storing ciphertext', async () => {
        const h = harness(), a = await guest(h), ws = await join(h, a);
        const saved = ws.deserializeAttachment(); saved.bucket.total = 7999; ws.serializeAttachment(saved);
        const room = await h.wake(ROOM);
        await room.webSocketMessage(ws, FRAME); expect(ws.closed).toBeUndefined();
        await room.webSocketMessage(ws, FRAME); expect(ws.closed).toMatchObject({ code: 4429, reason: 'message cap' });
        expect(ws.deserializeAttachment().bucket.total).toBe(8001);
        expect(JSON.stringify(ws.deserializeAttachment())).not.toContain('ciphertext_only');
        expect(h.roomStates.get(ROOM).values.size).toBe(0);
    });
    it('preserves burst exhaustion through wake, then refills with elapsed time', async () => {
        const h = harness(), a = await guest(h), ws = await join(h, a);
        ws.serializeAttachment({ ...ws.deserializeAttachment(), bucket: { v: 1, tokens: 0, last: Date.now(), total: 30 } });
        const room = await h.wake(ROOM);
        await room.webSocketMessage(ws, FRAME); expect(ws.frames.at(-1)).toEqual({ slow: true });
        expect(ws.deserializeAttachment().bucket).toMatchObject({ tokens: 0, total: 31 });
        vi.setSystemTime(Date.now() + 1000); await room.webSocketMessage(ws, FRAME);
        expect(ws.deserializeAttachment().bucket).toMatchObject({ tokens: 7, total: 32 }); expect(ws.closed).toBeUndefined();
    });
    it('keeps IDs distinct across a wake at the same timestamp and enforces peer capacity', async () => {
        const h = harness(), a = await guest(h), first = await join(h, a);
        await h.wake(ROOM); const second = await join(h, a);
        expect(first.deserializeAttachment().id).not.toBe(second.deserializeAttachment().id);
        h.room(ROOM).limits.maxPeers = 2;
        expect((await betaFetch(request(`/room?room=${ROOM}&preview=${PREVIEW}`, { cookie: a.cookie, upgrade: true }), h.env)).status).toBe(429);
    });
    it('validates bucket snapshots and never refills by moving the clock backward', () => {
        const limits = limitsFrom({}); let time = 1000;
        const bucket = createBucket(limits, () => time); bucket.take();
        const copy = createBucket(limits, () => time, bucket.snapshot());
        time = 0; copy.take(); expect(copy.snapshot()).toMatchObject({ tokens: 28, last: 1000, total: 2 });
        expect(() => createBucket(limits, () => time, { ...copy.snapshot(), total: -1 })).toThrow('invalid bucket');
    });
});

describe('bounded beta registry retention', () => {
    it('bounds room registrations before allocating more relay objects', async () => {
        const h = harness(), a = await guest(h);
        for (let i = 0; i < BETA_SESSION_ROOM_LIMIT; i++) await join(h, a, i.toString(16).padStart(64, '0'));
        const response = await betaFetch(request(`/room?room=${'f'.repeat(64)}&preview=${PREVIEW}`, { cookie: a.cookie, upgrade: true }), h.env);
        expect(response.status).toBe(429); expect(h.rooms.size).toBe(BETA_SESSION_ROOM_LIMIT);
        expect(h.registryState.values.get(`session:${a.access.sid}`).rooms).toHaveLength(BETA_SESSION_ROOM_LIMIT);
    });
    it('keeps tombstones until cookie expiry and prunes them on alarm', async () => {
        const h = harness(), a = await guest(h);
        expect((await logout(h, a)).status).toBe(200);
        vi.setSystemTime(a.access.exp - 1); await h.registry.alarm(); expect(h.registryState.values.size).toBe(1);
        vi.setSystemTime(a.access.exp + 1); await h.registry.alarm(); expect(h.registryState.values.size).toBe(0); expect(await h.registryState.storage.getAlarm()).toBeUndefined();
    });
    it('caps session records, reuses capacity only after pruning, and issues no untracked cookie', async () => {
        const h = harness();
        for (let i = 0; i < BETA_SESSION_LIMIT; i++) {
            const sid = `session-${String(i).padStart(16, '0')}`;
            h.registryState.values.set(`session:${sid}`, record({ access: { sid, exp: Date.now() + BETA_TTL } }));
        }
        const full = await betaFetch(request('/beta/unlock', { body: { key: INVITE } }), h.env);
        expect(full.status).toBe(429); expect(full.headers.has('Set-Cookie')).toBe(false); expect(h.registryState.values.size).toBe(BETA_SESSION_LIMIT);
        vi.setSystemTime(Date.now() + BETA_TTL + 1);
        await guest(h); expect([...h.registryState.values.keys()].filter((key) => key.startsWith('session:'))).toHaveLength(1);
    });
    it('fails closed on corrupt registry state rather than silently discarding revocation', async () => {
        const h = harness(), a = await guest(h);
        h.registryState.values.set(`session:${a.access.sid}`, { sid: a.access.sid, revoked: 'broken' });
        expect((await registryRequest(h.env, 'check', { sid: a.access.sid, exp: a.access.exp, version: '1' })).status).toBe(503);
        expect((await betaFetch(request('/beta/state', { cookie: a.cookie }), h.env)).status).toBe(503);
    });
    it('bounds alarm retries and backs off failed fanouts while preserving pending tombstones', async () => {
        const h = harness(), close = vi.fn(async () => new Response('unavailable', { status: 503 }));
        h.env.LOBBY.get = () => ({ fetch: close });
        for (let i = 0; i < BETA_RETRY_BATCH + 4; i++) {
            const sid = `session-${String(i).padStart(16, '0')}`;
            h.registryState.values.set(`session:${sid}`, { ...record({ access: { sid, exp: Date.now() + BETA_TTL } }), revoked: true, pending: true, attempt: 1, retryAt: Date.now() });
        }
        await h.registry.alarm(); expect(close).toHaveBeenCalledTimes(BETA_RETRY_BATCH);
        await h.registry.alarm(); expect(close).toHaveBeenCalledTimes(BETA_RETRY_BATCH + 4);
        await h.registry.alarm(); expect(close).toHaveBeenCalledTimes(BETA_RETRY_BATCH + 4);
        expect([...h.registryState.values.values()].every((value) => value.pending && value.attempt === 2 && value.retryAt === Date.now() + 120000)).toBe(true);
    });
    it('reuses a valid invitation session instead of exhausting the registry on repeat unlocks', async () => {
        const h = harness(), a = await guest(h), ws = await join(h, a);
        for (let i = 0; i < 50; i++) {
            const response = await betaFetch(request('/beta/unlock', { cookie: a.cookie, body: { key: INVITE } }), h.env);
            expect(response.status).toBe(200); expect(response.headers.has('Set-Cookie')).toBe(false);
        }
        expect([...h.registryState.values.keys()].filter((key) => key.startsWith('session:'))).toHaveLength(1);
        expect(Object.values(h.registryState.values.get('mint-rates'))[0].count).toBe(1);
        expect((await betaSession(request('/beta/state', { cookie: a.cookie }), h.env)).access).toEqual(a.access);
        expect(ws.readyState).toBe(1);
    });
    it('limits fresh cookie minting per daily IP code, isolates other visitors, and prunes the budget window', async () => {
        const h = harness();
        for (let i = 0; i < BETA_MINT_PER_IP_HOUR; i++) await guest(h);
        const blocked = await betaFetch(request('/beta/unlock', { body: { key: INVITE } }), h.env);
        expect(blocked.status).toBe(429); expect(blocked.headers.has('Set-Cookie')).toBe(false);
        const other = await betaFetch(request('/beta/unlock', { body: { key: INVITE }, headers: { 'CF-Connecting-IP': '198.51.100.23' } }), h.env);
        expect(other.status).toBe(200); expect(JSON.stringify([...h.registryState.values])).not.toContain('198.51.100.23');
        vi.setSystemTime(Date.now() + 3600001); await h.registry.alarm();
        expect(h.registryState.values.has('mint-rates')).toBe(false);
        await guest(h);
        expect(Object.values(h.registryState.values.get('mint-rates'))[0].count).toBe(1);
    });
});
