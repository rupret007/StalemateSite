// @vitest-environment node
// Exercise the production DO adapter: the local relay accepts sockets before connect,
// so its browser tests cannot catch frames dropped by the Worker's upgrade ordering.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HangoutLobby } from '../../hangout-worker/src/lobby-do.mjs';
import { AI_CATEGORIES } from '../../hangout-worker/src/ai-moderation.mjs';

class Socket {
    frames = [];
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
            list: async () => new Map(),
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
            if (key === 'ai-reviews' || key === 'moderation-queue') throw new Error('fixture write failed');
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
        const env = { HANGOUT_AI_MODERATION: 'review', OPENAI_API_KEY: 'test-only-secret', HANGOUT_AI_DAILY_LIMIT: '1' };
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
            { t: 'hello', role: 'fan', lock: 'off', shield: false, budget: 'ok', needNick: true }
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

    it('re-admits a surviving socket with one hello after hibernation', async () => {
        const state = stateWith();
        const server = new Socket();
        server.serializeAttachment({ id: 'survivor', ...identity });
        state.acceptWebSocket(server, ['survivor']);
        const lobby = new HangoutLobby(state, {});
        await lobby.ready;
        expect(server.frames.filter((frame) => frame.t === 'hello')).toHaveLength(1);
        expect(server.frames[0]).toMatchObject({ t: 'hello', needNick: true });
        await lobby.webSocketMessage(server, JSON.stringify({ t: 'hello', nick: 'GuestBack', age13: true }));
        expect(server.frames).toContainEqual(expect.objectContaining({ t: 'welcome', nick: 'GuestBack' }));
        expect(lobby.pendingAdmission.size).toBe(0);
    });
});
