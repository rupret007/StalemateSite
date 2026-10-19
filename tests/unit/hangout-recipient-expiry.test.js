// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HangoutLobby } from '../../hangout-worker/src/lobby-do.mjs';
import { HangoutRoom } from '../../hangout-worker/src/index.mjs';

class Socket {
    frames = []; readyState = 1;
    send(raw) { if (this.readyState !== 1) throw Error('closed'); this.frames.push(JSON.parse(raw)); }
    close(code, reason) { this.readyState = 3; this.closed = { code, reason }; }
    serializeAttachment(value) { this.attachment = structuredClone(value); }
    deserializeAttachment() { return structuredClone(this.attachment); }
}
function storageState() {
    const values = new Map(), sockets = new Map();
    const storage = {
        get: async (key) => structuredClone(values.get(key)),
        put: async (key, value) => values.set(key, structuredClone(value)),
        delete: async (keys) => { for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key); },
        list: async ({ prefix = '', limit = Infinity, reverse = false, end } = {}) => new Map([...values].filter(([key]) => key.startsWith(prefix) && (!end || key < end)).sort(([a], [b]) => reverse ? b.localeCompare(a) : a.localeCompare(b)).slice(0, limit)),
        getAlarm: async () => 1, setAlarm: async () => {}, deleteAlarm: async () => {}
    };
    storage.transaction = (fn) => fn(storage);
    return { values, sockets, storage, blockConcurrencyWhile: (fn) => fn(), waitUntil: () => {},
        getWebSockets: (tag) => [...sockets].filter(([ws, tags]) => ws.readyState === 1 && (!tag || tags.includes(tag))).map(([ws]) => ws),
        getTags: (ws) => sockets.get(ws) || [], acceptWebSocket: (ws, tags) => sockets.set(ws, tags) };
}
function installRuntime() {
    const pairs = [];
    vi.stubGlobal('WebSocketPair', class { constructor() { this[0] = new Socket(); this[1] = new Socket(); pairs.push(this); } });
    const NativeResponse = globalThis.Response;
    vi.stubGlobal('Response', class extends NativeResponse {
        constructor(body, init) { super(body, init?.status === 101 ? { status: 200 } : init); if (init?.status === 101) Object.defineProperty(this, 'status', { value: 101 }); this.webSocket = init?.webSocket; }
    });
    return pairs;
}
const env = () => ({ HANGOUT_BETA_MODE: 'protected', HANGOUT_BETA_INVITE_VERSION: '1',
    HANGOUT_MODERATOR_EMAILS: 'first@example.test,second@example.test',
    BETA_SESSIONS: { idFromName: (name) => name, get: () => ({ fetch: vi.fn(async () => new Response('active')) }) } });
const identity = (label, expiry = 60000) => ({ dev: `dev-${label}`, iph: `ip-${label}`, role: 'fan', email: '', admin: false,
    betaSid: `beta-session-${label.toLowerCase()}-123456`, betaInviteVersion: '1', expiresAt: Date.now() + expiry });

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-19T03:00:00Z')); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('authorization applies to recipients before the next alarm', () => {
    it('disconnects an expired staff connection before the alarm ticks the community engine', async () => {
        const pairs = installRuntime(), state = storageState(), config = env(), lobby = new HangoutLobby(state, config);
        const who = { ...identity('short-staff', 1000), email: 'first@example.test', role: 'moderator', admin: true };
        expect((await lobby.fetch(new Request('https://internal/lobby-admin', { headers: { 'X-Hangout-Identity': JSON.stringify(who) } }))).status).toBe(101);
        const socket = pairs.at(-1)[1];
        await lobby.webSocketMessage(socket, JSON.stringify({ t: 'hello', nick: 'ShortWatcher', age13: true }));
        const id = socket.deserializeAttachment().id;
        expect(lobby.engine._debug.conns.has(id)).toBe(true);
        const tick = lobby.engine.tick;
        const observed = vi.spyOn(lobby.engine, 'tick').mockImplementation(async () => {
            expect(socket.closed?.code).toBe(4401);
            expect(lobby.engine._debug.conns.has(id)).toBe(false);
            return tick();
        });
        vi.setSystemTime(Date.now() + 1001);
        await lobby.alarm();
        expect(observed).toHaveBeenCalledOnce();
    });

    it('keeps a valid sender in the lobby while an expired recipient receives no fresh chat', async () => {
        const pairs = installRuntime(), state = storageState(), lobby = new HangoutLobby(state, env());
        const admit = async (who, nick) => {
            const response = await lobby.fetch(new Request('https://internal/lobby', { headers: { 'X-Hangout-Identity': JSON.stringify(who) } }));
            expect(response.status).toBe(101);
            const socket = pairs.at(-1)[1];
            await lobby.webSocketMessage(socket, JSON.stringify({ t: 'hello', nick, age13: true }));
            return socket;
        };
        const expired = await admit(identity('short', 1000), 'ShortVisitor');
        const active = await admit(identity('active'), 'ActiveVisitor');
        expired.frames = []; active.frames = [];
        vi.setSystemTime(Date.now() + 1001);
        await lobby.webSocketMessage(active, JSON.stringify({ t: 'say', ch: '#stalemate', text: 'Fresh text after the other visitor expired' }));
        expect(active.frames.some((frame) => frame.t === 'line')).toBe(true);
        expect(expired.frames).toEqual([]);
        expect(expired.closed?.code).toBe(4401);
    });
    it('does not push a fresh moderation queue to a staff socket removed from the allowlist', async () => {
        const pairs = installRuntime(), state = storageState(), config = env(), lobby = new HangoutLobby(state, config);
        const admit = async (email, label) => {
            const who = { ...identity(label), email, role: 'moderator', admin: true };
            expect((await lobby.fetch(new Request('https://internal/lobby-admin', { headers: { 'X-Hangout-Identity': JSON.stringify(who) } }))).status).toBe(101);
            const socket = pairs.at(-1)[1];
            await lobby.webSocketMessage(socket, JSON.stringify({ t: 'hello', nick: label, age13: true }));
            expect(socket.frames.some((frame) => frame.t === 'admin')).toBe(true);
            return socket;
        };
        const removed = await admit('first@example.test', 'FirstWatcher'), kept = await admit('second@example.test', 'SecondWatcher');
        removed.frames = []; kept.frames = [];
        config.HANGOUT_MODERATOR_EMAILS = 'second@example.test';
        lobby.engine.notifyAiStatus();
        await Promise.resolve();
        expect(kept.frames.some((frame) => frame.t === 'admin')).toBe(true);
        expect(removed.frames).toEqual([]);
        expect(removed.closed?.code).toBe(4401);
    });
    it('does not relay ciphertext from an active private-room sender to an expired recipient', async () => {
        const pairs = installRuntime(), state = storageState(), room = new HangoutRoom(state, env());
        const admit = async (who) => {
            expect((await room.fetch(new Request('https://internal/room', { headers: { 'X-Hangout-Beta-Session': JSON.stringify(who) } }))).status).toBe(101);
            return pairs.at(-1)[1];
        };
        const expired = await admit(identity('short', 1000)), active = await admit(identity('active'));
        expired.frames = []; active.frames = [];
        vi.setSystemTime(Date.now() + 1001);
        await room.webSocketMessage(active, JSON.stringify({ iv: 'A'.repeat(16), c: 'fresh_ciphertext_only' }));
        expect(expired.frames).toEqual([]);
        expect(expired.closed?.code).toBe(4401);
        expect(active.readyState).toBe(1);
    });
});
