// @vitest-environment node
// Exercise the production DO adapter: the local relay accepts sockets before connect,
// so its browser tests cannot catch frames dropped by the Worker's upgrade ordering.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HangoutLobby } from '../../hangout-worker/src/lobby-do.mjs';
import { AI_CATEGORIES } from '../../hangout-worker/src/ai-moderation.mjs';

class Socket {
    frames = [];
    close(code, reason) { this.closed = { code, reason }; }
    send(raw) { this.frames.push(JSON.parse(raw)); }
    serializeAttachment(value) { this.attachment = value; }
    deserializeAttachment() { return this.attachment; }
}

function stateWith(net = { lock: 'off' }) {
    const values = new Map([['net', net]]);
    const sockets = new Map();
    const background = [];
    return {
        values, background,
        waitUntil: (task) => background.push(task),
        storage: {
            get: async (key) => values.get(key),
            put: async (key, value) => values.set(key, value),
            list: async (options = {}) => new Map([...values].filter(([k]) => k.startsWith(options.prefix || '') && (!options.end || k < options.end)).sort(([a], [b]) => options.reverse ? b.localeCompare(a) : a.localeCompare(b)).slice(0, options.limit || Infinity)),
            delete: async (keys) => { for (const k of Array.isArray(keys) ? keys : [keys]) values.delete(k); },
            transaction: async (fn) => fn({ list: async ({ prefix = '', startAfter = '', limit = Infinity } = {}) => new Map([...values].filter(([key]) => key.startsWith(prefix) && key > startAfter).sort(([a], [b]) => a.localeCompare(b)).slice(0, limit)), get: async (k) => values.get(k), put: async (k, v) => values.set(k, structuredClone(v)), delete: async (k) => values.delete(k) }),
            getAlarm: async () => 1,
            setAlarm: async () => {}
        },
        blockConcurrencyWhile: (fn) => fn(),
        getWebSockets: (id) => [...sockets].filter(([, tags]) => !id || tags.includes(id)).map(([ws]) => ws),
        getTags: (ws) => sockets.get(ws) || [],
        acceptWebSocket: vi.fn((ws, tags) => sockets.set(ws, tags))
    };
}

function installUpgradeRuntime() {
    const pairs = [];
    vi.stubGlobal('WebSocketPair', class {
        constructor() { this[0] = new Socket(); this[1] = new Socket(); pairs.push(this); }
    });
    // Node's Response disallows 101; emulate just the Cloudflare upgrade extension.
    const NativeResponse = globalThis.Response;
    vi.stubGlobal('Response', class extends NativeResponse {
        constructor(body, init) {
            super(body, init?.status === 101 ? { status: 200 } : init);
            if (init?.status === 101) Object.defineProperty(this, 'status', { value: 101 });
            this.webSocket = init?.webSocket;
        }
    });
    return pairs;
}

const identity = { dev: 'device-test', iph: 'hash-test', role: 'fan', email: '', admin: false };
const request = (who = identity) => new Request('https://lobby.test/lobby', {
    headers: { 'X-Hangout-Identity': JSON.stringify(who) }
});

describe('HangoutLobby AI review integration', () => {
    it('tracks failed evidence writes and exposes storage degradation without an unhandled rejection', async () => {
        const state = stateWith();
        const originalPut = state.storage.put;
        state.storage.put = async (key, value) => {
            if (key === 'ai-reviews') throw new Error('fixture write failed');
            return originalPut(key, value);
        };
        const lobby = new HangoutLobby(state, {});
        await lobby.ready;
        await lobby.persistState('ai-reviews', []);
        await Promise.all(state.background);
        expect(lobby.engine.adminState().aiModeration.evidenceStorage).toBe('degraded');
        expect(state.values.has('ai-reviews')).toBe(false);
    });

    it('keeps provider calls server-side and restores bounded moderation evidence and quota after hibernation', async () => {
        const pairs = installUpgradeRuntime();
        const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
            model: 'omni-moderation-latest', results: [{ flagged: true,
                categories: Object.fromEntries(AI_CATEGORIES.map((key) => [key, key === 'harassment'])),
                category_scores: Object.fromEntries(AI_CATEGORIES.map((key) => [key, key === 'harassment' ? 0.9 : 0.01])) }]
        })));
        vi.stubGlobal('fetch', fetchImpl);
        const state = stateWith();
        const env = { HANGOUT_AI_MODERATION: 'review', OPENAI_API_KEY: 'test-only-secret', HANGOUT_AI_DAILY_LIMIT: '1',
            HANGOUT_AI_PROVIDER_READINESS: 'qualified', HANGOUT_AI_CHILD_DATA_READINESS: 'qualified' };
        const lobby = new HangoutLobby(state, env);
        await lobby.fetch(request());
        const server = pairs[0][1];
        await lobby.webSocketMessage(server, JSON.stringify({ t: 'hello', nick: 'ReviewGuest', age13: true }));
        await lobby.webSocketMessage(server, JSON.stringify({ t: 'say', ch: '#stalemate', text: 'A synthetic line for the review fixture' }));
        await Promise.all(state.background);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ model: 'omni-moderation-latest', input: 'A synthetic line for the review fixture' });
        expect(state.values.get('ai-usage').used).toBe(1);
        expect(state.values.get('ai-reviews')).toHaveLength(1);
        expect(lobby.engine.adminState().aiReviews[0]).toMatchObject({ from: 'ReviewGuest', categories: ['harassment'] });
        expect(lobby.engine.adminState().aiModeration.state).toBe('capped');
        expect(server.frames.some((frame) => frame.t === 'admin')).toBe(false);
        expect(JSON.stringify(server.frames)).not.toContain('test-only-secret');
        expect(state.values.get('net')).not.toHaveProperty('aiReviews');

        const restored = new HangoutLobby(state, env);
        await restored.ready;
        expect(restored.engine.adminState().aiReviews).toHaveLength(1);
        expect(restored.engine.adminState().aiModeration).toMatchObject({ state: 'capped', used: 1 });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('makes no provider request when review is requested without qualified provider and child-data handling', async () => {
        const pairs = installUpgradeRuntime();
        const fetchImpl = vi.fn(); vi.stubGlobal('fetch', fetchImpl);
        const state = stateWith();
        const lobby = new HangoutLobby(state, { HANGOUT_AI_MODERATION: 'review', OPENAI_API_KEY: 'test-only-secret' });
        await lobby.fetch(request());
        const socket = pairs[0][1];
        await lobby.webSocketMessage(socket, JSON.stringify({ t: 'hello', nick: 'UnqualifiedReview', age13: true,
            providerReady: true, childConsent: true, HANGOUT_AI_CHILD_DATA_READINESS: 'qualified' }));
        await lobby.webSocketMessage(socket, JSON.stringify({ t: 'say', ch: '#stalemate', text: 'Ordinary chat stays available without AI qualification' }));
        await Promise.all(state.background);
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(socket.frames.some((frame) => frame.t === 'line')).toBe(true);
        expect(lobby.engine.adminState().aiModeration).toMatchObject({ enabled: false, requested: true, state: 'not-qualified',
            eligibility: { allowed: false, reasons: ['provider-not-qualified', 'child-data-not-qualified'] } });
    });

    it('makes no provider request in the default local/production configuration', async () => {
        const pairs = installUpgradeRuntime();
        const fetchImpl = vi.fn(); vi.stubGlobal('fetch', fetchImpl);
        const state = stateWith();
        const lobby = new HangoutLobby(state, {});
        await lobby.fetch(request());
        const server = pairs[0][1];
        await lobby.webSocketMessage(server, JSON.stringify({ t: 'hello', nick: 'PlainGuest', age13: true }));
        await lobby.webSocketMessage(server, JSON.stringify({ t: 'say', ch: '#stalemate', text: 'Ordinary public chat' }));
        await Promise.all(state.background);
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(lobby.engine.adminState().aiModeration.state).toBe('disabled');
        expect(server.frames).toContainEqual(expect.objectContaining({ t: 'line', text: 'Ordinary public chat' }));
    });
});

afterEach(() => vi.unstubAllGlobals());

describe('HangoutLobby peer close acknowledgement', () => {
    it('acknowledges a half-closed socket before readiness and retires only its admitted member', async () => {
        const pairs = installUpgradeRuntime(), state = stateWith(), lobby = new HangoutLobby(state, {});
        await lobby.fetch(request()); await lobby.fetch(request({ ...identity, dev: 'healthy-device', iph: 'healthy-ip' }));
        const leaving = pairs[0][1], healthy = pairs[1][1];
        await lobby.webSocketMessage(leaving, JSON.stringify({ t: 'hello', nick: 'LeavingGuest', age13: true }));
        await lobby.webSocketMessage(healthy, JSON.stringify({ t: 'hello', nick: 'HealthyGuest', age13: true }));
        const id = leaving.attachment.id, healthyId = healthy.attachment.id;
        let release; lobby.ready = new Promise(resolve => { release = resolve; });
        leaving.readyState = 2; const close = vi.spyOn(leaving, 'close');
        const pending = lobby.webSocketClose(leaving, 1000, 'untrusted peer reason');
        expect(close).toHaveBeenCalledExactlyOnceWith(1000);
        expect(lobby.engine._debug.conns.has(id)).toBe(true);
        expect(lobby.engine._debug.conns.has(healthyId)).toBe(true);
        release(); await pending;
        expect(lobby.engine._debug.conns.has(id)).toBe(false);
        expect(lobby.engine._debug.conns.has(healthyId)).toBe(true);
        expect(healthy.closed).toBeUndefined();
    });

    it.each([undefined, 1005, 1006, 1015, 2999, 5000, '1000'])(
        'uses a legal normal acknowledgement for no-status/reserved code %s', async code => {
            const ws = { readyState: 2, close: vi.fn() }, forget = vi.fn(), disconnect = vi.fn(), unbind = vi.fn();
            const receiver = { ready: Promise.resolve(), delivery: { forget }, authorityUnavailable: false, authorityMode: true,
                liveBindings: new Map([['leaving', {}], ['healthy', {}]]), engine: { disconnect }, authority: { unbind },
                state: { getTags: () => ['leaving'], blockConcurrencyWhile: fn => fn() } };
            await HangoutLobby.prototype.webSocketClose.call(receiver, ws, code, 'never echo this');
            expect(ws.close).toHaveBeenCalledExactlyOnceWith(1000);
            expect(forget).toHaveBeenCalledExactlyOnceWith(ws);
            expect(disconnect).toHaveBeenCalledExactlyOnceWith('leaving');
            expect(unbind).toHaveBeenCalledExactlyOnceWith('leaving');
            expect([...receiver.liveBindings.keys()]).toEqual(['healthy']);
        });

    it('preserves an application close code and retires authority state even when acknowledgement throws', async () => {
        const ws = { readyState: 2, close: vi.fn(() => { throw Error('transport already gone'); }) };
        const disconnect = vi.fn(), unbind = vi.fn();
        const receiver = { ready: Promise.resolve(), delivery: { forget: vi.fn() }, authorityUnavailable: false, authorityMode: true,
            liveBindings: new Map([['leaving', {}]]), engine: { disconnect }, authority: { unbind },
            state: { getTags: () => ['leaving'], blockConcurrencyWhile: fn => fn() } };
        await HangoutLobby.prototype.webSocketClose.call(receiver, ws, 4401, 'private runtime reason');
        expect(ws.close).toHaveBeenCalledExactlyOnceWith(4401);
        expect(disconnect).toHaveBeenCalledExactlyOnceWith('leaving');
        expect(unbind).toHaveBeenCalledExactlyOnceWith('leaving');
        expect(receiver.liveBindings.size).toBe(0);
    });

    it('does not repeat a completed automatic acknowledgement but still retires its binding', async () => {
        const ws = { readyState: 3, close: vi.fn() }, disconnect = vi.fn();
        const receiver = { ready: Promise.resolve(), delivery: { forget: vi.fn() }, authorityUnavailable: false, authorityMode: false,
            liveBindings: new Map([['leaving', {}]]), engine: { disconnect },
            state: { getTags: () => ['leaving'], blockConcurrencyWhile: fn => fn() } };
        await HangoutLobby.prototype.webSocketClose.call(receiver, ws, 1000);
        expect(ws.close).not.toHaveBeenCalled();
        expect(disconnect).toHaveBeenCalledExactlyOnceWith('leaving');
        expect(receiver.liveBindings.size).toBe(0);
    });
});

describe('HangoutLobby WebSocket admission', () => {
    it.each([null, 'signed-test-device'])('delivers hello after accepting a guest, with device token %s', async (devToken) => {
        const pairs = installUpgradeRuntime();
        const state = stateWith();
        const lobby = new HangoutLobby(state, {});
        const response = await lobby.fetch(request({ ...identity, devToken }));
        expect(response.status).toBe(101);
        const server = pairs[0][1];
        expect(state.getWebSockets()).toEqual([server]);
        expect(server.frames.filter((frame) => frame.t === 'hello')).toEqual([
            { t: 'hello', role: 'fan', lock: 'off', shield: false, budget: 'ok', needNick: true, verified: false, capabilities: { moderate: false, configure: false, register: false }, features: { entrySources: 1, privateMessageContext: 1, privateMessagePeers: 1, personTargets: 1, roomKeep: 1, messageResults: 1 } }
        ]);
        expect(server.frames.map((frame) => frame.t)).toEqual(devToken ? ['device', 'hello'] : ['hello']);
        expect(lobby.pendingAdmission.size).toBe(0);

        // The client can now answer hello and receive its actual lobby membership.
        await lobby.webSocketMessage(server, JSON.stringify({ t: 'hello', nick: 'GuestOne', age13: true }));
        expect(server.frames).toContainEqual(expect.objectContaining({ t: 'welcome', nick: 'GuestOne' }));
        expect(server.frames).toContainEqual(expect.objectContaining({ t: 'join', ch: expect.objectContaining({ name: '#stalemate' }) }));
    });

    it('refuses a closed lobby before allocating or accepting any WebSocket', async () => {
        const pairs = installUpgradeRuntime();
        const state = stateWith({ lock: 'closed' });
        const lobby = new HangoutLobby(state, {});
        const response = await lobby.fetch(request());
        expect(response.status).toBe(503);
        expect(await response.text()).toBe('locked');
        expect(pairs).toHaveLength(0);
        expect(state.acceptWebSocket).not.toHaveBeenCalled();
        expect(lobby.engine._debug.conns.size).toBe(0);
        expect(lobby.pendingAdmission.size).toBe(0);
    });

    it('preserves a surviving connection and room membership without a new hello after hibernation', async () => {
        const pairs = installUpgradeRuntime(); const state = stateWith();
        const first = new HangoutLobby(state, {}); await first.fetch(request());
        const server = pairs[0][1];
        const message = (lobby, frame) => lobby.webSocketMessage(server, JSON.stringify(frame));
        await message(first, { t: 'hello', nick: 'GuestBack', age13: true });
        await message(first, { t: 'cmd', name: 'join', args: ['#connected-room'], ch: '#stalemate' });
        await message(first, { t: 'say', ch: '#connected-room', text: 'Connected session marker' });
        expect(JSON.stringify(state.values.get('sessions'))).not.toContain('Connected session marker');
        const before = server.frames.length;
        const restored = new HangoutLobby(state, {}); await restored.ready;
        expect(server.frames.slice(before).some((f) => f.t === 'hello' || f.t === 'join')).toBe(false);
        expect(restored.engine._debug.conns.get(server.attachment.id).nick).toBe('GuestBack');
        expect(restored.engine._debug.channels.get('#connected-room').members.has(server.attachment.id)).toBe(true);
        await message(restored, { t: 'say', ch: '#connected-room', text: 'Still connected after wake' });
        expect(server.frames).toContainEqual(expect.objectContaining({ t: 'line', text: 'Still connected after wake' }));
    });
    it('closes a surviving socket if its saved session metadata is missing', async () => {
        const state = stateWith(); const server = new Socket();
        server.serializeAttachment({ id: 'survivor', ...identity }); state.acceptWebSocket(server, ['survivor']);
        const lobby = new HangoutLobby(state, {}); await lobby.ready;
        expect(server.closed).toMatchObject({ code: 4401, reason: 'session-missing' });
        expect(server.frames.some((f) => f.t === 'hello')).toBe(false);
    });
});

describe('durable community storage', () => {
    it('prunes preexisting logs by age and count across storage pages', async () => {
        const state = stateWith(); const now = Date.now();
        for (let i = 0; i < 2200; i++) state.values.set(`log:${String(i).padStart(15, '0')}:test`, { at: now - i, action: 'fixture' });
        state.values.set('log:000000000000000:old', { at: now - 31 * 86400000 });
        const lobby = new HangoutLobby(state, {}); await lobby.ready;
        expect([...state.values.keys()].filter((k) => k.startsWith('log:'))).toHaveLength(2000);
        expect(state.values.has('log:000000000000000:old')).toBe(false);
    });
    it('restores per-room records and fails closed if an indexed record is missing', async () => {
        const state = stateWith(); const lobby = new HangoutLobby(state, {}); await lobby.ready;
        lobby.engine.connect({ id: 'one', dev: 'dev-one', iph: 'ip-one', account: 'account-one' });
        const msg = (f) => lobby.engine.message('one', JSON.stringify(f));
        await msg({ t: 'hello', nick: 'Alice', age13: true });
        await msg({ t: 'cmd', name: 'join', args: ['#friends'], ch: '#stalemate' });
        await msg({ t: 'cmd', name: 'register', args: [], ch: '#friends' });
        expect(state.values.get('room-index')).toEqual({ version: 1, names: ['#friends'] });
        const restored = new HangoutLobby(state, {}); await restored.ready;
        expect(restored.engine._debug.channels.get('#friends').owner).toBe('account-one');
        state.values.delete('community-room:#friends');
        const damaged = new HangoutLobby(state, {}); await damaged.ready;
        expect(damaged.engine.adminState().lock).toBe('readonly');
    });
    it('revokes staff access on hibernation when the email is removed from the allowlist', async () => {
        const state = stateWith(); const ws = new Socket();
        ws.serializeAttachment({ id: 'old-mod', dev: 'old-device', iph: 'old-ip', role: 'moderator', admin: true, email: 'removed@example.test', expiresAt: Date.now() + 60000 });
        state.acceptWebSocket(ws, ['old-mod']);
        const lobby = new HangoutLobby(state, {}); await lobby.ready;
        expect(ws.closed.code).toBe(4401);
        expect(lobby.engine._debug.conns.has('old-mod')).toBe(false);
    });
});

it('ends only the matching private-pilot sockets when its operator changes role or logs out', async () => {
    const pairs = installUpgradeRuntime(); const state = stateWith();
    const lobby = new HangoutLobby(state, { PILOT_MODE: 'protected' });
    const sid = 'private-pilot-session-123';
    await lobby.fetch(request({ ...identity, pilotSid: sid }));
    await lobby.fetch(request({ ...identity, dev: 'other-device', pilotSid: 'different-pilot-session-456' }));
    const response = await lobby.fetch(new Request('https://internal/__pilot/disconnect', { method: 'POST', headers: { 'X-Hangout-Identity': JSON.stringify({ pilotSid: sid }) } }));
    expect(response.status).toBe(200); expect(pairs[0][1].closed.code).toBe(4401);
    expect(pairs[1][1].closed).toBeUndefined();
});
