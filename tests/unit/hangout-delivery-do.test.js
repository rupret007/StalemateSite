// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { HangoutLobby } from '../../hangout-worker/src/lobby-do.mjs';
import { DELIVERY_LIMITS } from '../../hangout-worker/src/socket-delivery.mjs';

function runtime() {
    const values = new Map([['net', { lock: 'off' }]]), sockets = new Map(), background = [];
    return {
        values, sockets, background,
        storage: {
            get: async key => values.get(key), put: async (key, value) => { values.set(key, structuredClone(value)); },
            list: async () => new Map(), delete: async key => { values.delete(key); }, getAlarm: async () => 1,
            transaction: async fn => fn({ list: async ({ prefix = '', startAfter = '', limit = Infinity } = {}) => new Map([...values].filter(([key]) => key.startsWith(prefix) && key > startAfter).sort(([a], [b]) => a.localeCompare(b)).slice(0, limit)), get: async key => values.get(key), put: async (key, value) => { values.set(key, structuredClone(value)); }, delete: async key => { values.delete(key); } })
        },
        blockConcurrencyWhile: fn => fn(), waitUntil: task => background.push(task),
        getWebSockets: id => [...sockets.values()].filter(ws => ws.readyState === 1 && (!id || ws.id === id)),
        getTags: ws => [ws.id]
    };
}
async function visitor(lobby, state, id) {
    const ws = { id, readyState: 1, frames: [], attachment: { id, dev: `dev-${id}`, iph: `ip-${id}`, role: 'fan', admin: false },
        serializeAttachment(value) { this.attachment = structuredClone(value); }, deserializeAttachment() { return structuredClone(this.attachment); },
        send(raw) { this.frames.push(JSON.parse(raw)); }, close(code, reason) { this.closed = { code, reason }; this.readyState = 3; } };
    state.sockets.set(id, ws);
    expect(lobby.engine.connect(ws.attachment)).toMatchObject({ ok: true });
    await lobby.webSocketMessage(ws, JSON.stringify({ t: 'hello', nick: id, age13: true, transport: 1 }));
    return ws;
}
const ack = (lobby, ws, seq = ws.attachment.delivery.seq) => lobby.webSocketMessage(ws, JSON.stringify({ t: 'transport-ack', seq }));

describe('production lobby delivery adapter', () => {
    it('durably prepays acknowledgement blocks without changing chat state and preserves credit through hibernation', async () => {
        const state = runtime(), lobby = new HangoutLobby(state, {}); await lobby.ready;
        const ws = await visitor(lobby, state, 'DeliveryGuest');
        expect(ws.attachment.delivery.sizes.length).toBeGreaterThan(0);
        const net = structuredClone(lobby.engine.snapshot()), sessions = structuredClone(state.values.get('sessions'));
        await ack(lobby, ws);
        expect(lobby.engine.snapshot()).toEqual({ ...net, budget: { ...net.budget, requests: net.budget.requests + 1 } });
        expect(state.values.get('sessions')).toEqual(sessions);
        expect(ws.attachment.controlGrant.remaining).toBe(19);
        lobby.delivery.send(ws, { t: 'notice', text: 'connected-only marker' });
        const last = ws.attachment.delivery.seq, received = ws.frames.length;
        const resumed = new HangoutLobby(state, {}); await resumed.ready;
        expect(ws.frames).toHaveLength(received);
        expect(ws.attachment.delivery.seq).toBe(last);
        expect(resumed.delivery.snapshot().pendingFrames).toBe(1);
        await ack(resumed, ws, last);
        expect(ws.attachment.controlGrant.remaining).toBe(18);
        expect(resumed.controlBudget.snapshot().reservations).toBe(0);
        expect(ws.attachment.delivery).toMatchObject({ seq: last, ack: last, sizes: [] });
        expect(resumed.delivery.snapshot().pendingFrames).toBe(0);
        expect(JSON.stringify(ws.attachment.delivery)).not.toContain('connected-only marker');
        resumed.delivery.send(ws, { t: 'notice', text: 'after wake' });
        expect(ws.frames.at(-1)).toMatchObject({ transportSeq: last + 1, text: 'after wake' });
    });

    it('retires an unacknowledging member once and continues delivery to healthy members', async () => {
        const state = runtime(), lobby = new HangoutLobby(state, {}); await lobby.ready;
        const slow = await visitor(lobby, state, 'SlowGuest'), healthy = await visitor(lobby, state, 'HealthyGuest');
        await ack(lobby, slow); await ack(lobby, healthy);
        for (let i = 0; i <= DELIVERY_LIMITS.pendingFrames; i += 1) lobby.delivery.send(slow, { t: 'notice', text: 'bounded synthetic output' });
        expect(slow.closed).toMatchObject({ code: 4413 });
        await Promise.all(state.background);
        expect(lobby.engine._debug.conns.has(slow.id)).toBe(false);
        expect(lobby.engine._debug.conns.has(healthy.id)).toBe(true);
        expect(lobby.delivery.send(healthy, { t: 'notice', text: 'healthy delivery continues' })).toBe(true);
        expect(healthy.frames.at(-1).text).toBe('healthy delivery continues');
        expect(slow.attachment.delivery.sizes).toHaveLength(DELIVERY_LIMITS.pendingFrames);
        expect(lobby.delivery.snapshot().pressureCloses).toBe(1);
    });

    it('rejects future acknowledgements and does not expose success before required storage commits', async () => {
        const state = runtime(), lobby = new HangoutLobby(state, {}); await lobby.ready;
        const ws = await visitor(lobby, state, 'StoredGuest'); await ack(lobby, ws);
        const originalPut = state.storage.put; let release;
        state.storage.put = async (key, value) => {
            if (key === 'abuse') await new Promise(resolve => { release = resolve; });
            return originalPut(key, value);
        };
        const sending = lobby.webSocketMessage(ws, JSON.stringify({ t: 'say', ch: '#stalemate', text: 'await the durable commit' }));
        await Promise.resolve();
        expect(ws.frames.some(frame => frame.text === 'await the durable commit')).toBe(false);
        expect(release).toBeTypeOf('function'); release(); await sending;
        expect(ws.frames.some(frame => frame.t === 'line' && frame.text === 'await the durable commit')).toBe(true);
        await ack(lobby, ws, ws.attachment.delivery.seq + 1);
        expect(ws.closed).toMatchObject({ code: 4400 });
        await Promise.all(state.background);
        expect(lobby.engine._debug.conns.has(ws.id)).toBe(false);
    });
});
