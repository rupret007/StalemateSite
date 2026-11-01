// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { HangoutLobby } from '../../hangout-worker/src/lobby-do.mjs';

function runtime() {
    const values = new Map([['net', { lock: 'off' }]]), sockets = new Map(), background = [];
    return {
        values, sockets, background,
        storage: {
            get: async key => values.get(key), put: async (key, value) => { values.set(key, structuredClone(value)); },
            list: async () => new Map(), delete: async key => { values.delete(key); }, getAlarm: async () => 1,
            transaction: async fn => fn({ list: async ({ prefix = '', startAfter = '', limit = Infinity } = {}) => new Map([...values].filter(([key]) => key.startsWith(prefix) && key > startAfter).sort(([a], [b]) => a.localeCompare(b)).slice(0, limit)), get: async key => values.get(key), put: async (key, value) => { values.set(key, structuredClone(value)); }, delete: async key => { values.delete(key); } })
        },
        blockConcurrencyWhile: fn => { const result = fn(); expect(result).toBeInstanceOf(Promise); return result; },
        waitUntil: task => background.push(task),
        getWebSockets: id => [...sockets.values()].filter(ws => ws.readyState === 1 && (!id || ws.id === id)), getTags: ws => [ws.id]
    };
}
async function visitor(lobby, state, id, transport = 1) {
    const ws = { id, readyState: 1, frames: [], attachment: { id, dev: `dev-${id}`, iph: `ip-${id}`, role: 'fan', admin: false },
        serializeAttachment(value) { this.attachment = structuredClone(value); }, deserializeAttachment() { return structuredClone(this.attachment); },
        send(raw) { this.frames.push(JSON.parse(raw)); }, close(code, reason) { this.closed = { code, reason }; this.readyState = 3; } };
    state.sockets.set(id, ws); expect(lobby.engine.connect(ws.attachment)).toMatchObject({ ok: true });
    await lobby.webSocketMessage(ws, JSON.stringify({ t: 'hello', nick: id, age13: true, ...(transport ? { transport } : {}) })); return ws;
}

describe('production presence scheduling adapter', () => {
    it('flushes before idle and restores both legacy and negotiated sockets without replaying presence, chat or initial joins', async () => {
        const state = runtime(), lobby = new HangoutLobby(state, {}); await lobby.ready;
        const legacy = await visitor(lobby, state, 'LegacyGuest', 0), current = await visitor(lobby, state, 'CurrentGuest');
        expect(current.frames.some(f => f.t === 'join')).toBe(true); expect(legacy.frames.some(f => f.t === 'event')).toBe(true);
        legacy.frames.length = 0; current.frames.length = 0;
        await lobby.presence.flush();
        expect(legacy.frames.filter(f => f.t === 'chan')).toHaveLength(1); expect(current.frames.filter(f => f.t === 'chan')).toHaveLength(1);
        expect(legacy.frames.every(f => f.transportSeq === undefined)).toBe(true);
        expect(current.frames.every(f => Number.isSafeInteger(f.transportSeq))).toBe(true);
        expect(JSON.stringify(state.values.get('sessions'))).not.toContain('generation');
        expect(lobby.presence.snapshot()).toMatchObject({ scheduled: false, running: false, pendingChannels: 0 });
        legacy.frames.length = 0; current.frames.length = 0; lobby.presence.dispose();
        const resumed = new HangoutLobby(state, {}); await resumed.ready; await resumed.presence.flush();
        expect(legacy.frames).toEqual([]); expect(current.frames).toEqual([]);
        expect(resumed.engine._debug.conns.size).toBe(2); expect(resumed.delivery.snapshot().pendingFrames).toBeGreaterThan(0);
        resumed.presence.dispose();
    });
    it('rechecks adapter identity expiry when a previously committed dirty marker flushes', async () => {
        const state = runtime(), lobby = new HangoutLobby(state, {}); await lobby.ready;
        const revoked = await visitor(lobby, state, 'ExpiredGuest'), healthy = await visitor(lobby, state, 'HealthyGuest');
        revoked.attachment.expiresAt = Date.now() - 1;
        revoked.frames.length = 0; healthy.frames.length = 0;
        await lobby.presence.flush(); await Promise.all(state.background);
        expect(revoked.frames).toEqual([]); expect(revoked.closed).toMatchObject({ code: 4401 });
        expect(lobby.engine._debug.conns.has(revoked.id)).toBe(false);
        await lobby.presence.flush();
        expect(healthy.frames.filter(f => f.t === 'chan').at(-1).ch.names.map(n => n.nick)).toEqual(['HealthyGuest']);
        lobby.presence.dispose();
    });
});
