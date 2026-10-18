// @vitest-environment node
// Exercise the production DO adapter: the local relay accepts sockets before connect,
// so its browser tests cannot catch frames dropped by the Worker's upgrade ordering.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HangoutLobby } from '../../hangout-worker/src/lobby-do.mjs';

class Socket {
    frames = [];
    send(raw) { this.frames.push(JSON.parse(raw)); }
    serializeAttachment(value) { this.attachment = value; }
    deserializeAttachment() { return this.attachment; }
}

function stateWith(net = { lock: 'off' }) {
    const values = new Map([['net', net]]);
    const sockets = new Map();
    return {
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
