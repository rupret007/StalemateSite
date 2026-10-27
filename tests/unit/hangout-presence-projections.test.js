// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createPresenceProjections } from '../../hangout-worker/src/presence-projections.mjs';
import { createLobby } from '../../hangout-worker/src/lobby-core.mjs';

function scheduler(flush, extra = {}) {
    const timers = new Map(); let id = 0;
    const queue = createPresenceProjections({ flush, schedule: (fn, ms) => { timers.set(++id, { fn, ms }); return id; }, cancel: key => timers.delete(key), ...extra });
    return { queue, timers };
}
describe('bounded presence scheduling', () => {
    it('coalesces latest numeric generations and one directory bit without retaining payloads or resetting its deadline', async () => {
        const flushed = [], { queue, timers } = scheduler(batch => flushed.push(batch));
        for (let i = 1; i <= 200; i++) queue.mark({ channel: '#stalemate', generation: i, directory: true, text: 'never retain chat' });
        expect(timers.size).toBe(1); expect([...timers.values()][0].ms).toBe(50);
        expect(queue.snapshot()).toMatchObject({ marks: 200, pendingChannels: 1, directory: true, peakChannels: 1 });
        await queue.flush();
        expect(flushed).toEqual([{ directory: true, allChannels: false, channels: [{ name: '#stalemate', generation: 200 }] }]);
        expect(JSON.stringify(flushed)).not.toContain('never retain'); expect(timers.size).toBe(0);
    });
    it('bounds distinct names and uses a fresh active-room projection on overflow', async () => {
        const flushed = [], { queue } = scheduler(batch => flushed.push(batch), { maxChannels: 2 });
        for (const channel of ['#room-a', '#room-b', '#room-c', '#room-d']) queue.mark({ channel, generation: 1 });
        expect(queue.snapshot()).toMatchObject({ pendingChannels: 0, allChannels: true, peakChannels: 2, overflows: 1 });
        await queue.flush(); expect(flushed).toEqual([{ directory: false, allChannels: true, channels: [] }]);
        for (const value of [null, {}, { channel: '#x', generation: 1 }, { channel: '#okay', generation: -1 }, { channel: 'x'.repeat(1000), generation: 1 }]) expect(queue.mark(value)).toBe(false);
    });
    it('serializes flushes, bounds markers arriving while queued, and cancels disposed work', async () => {
        let release; const batches = [];
        const { queue, timers } = scheduler(batch => batches.push(batch), { serialize: async fn => { await new Promise(resolve => { release = resolve; }); return fn(); } });
        queue.mark({ directory: true }); const first = queue.flush(); await Promise.resolve();
        queue.mark({ channel: '#new-room', generation: 2 }); expect(timers.size).toBe(0);
        release(); await first; expect(batches).toHaveLength(1); expect(timers.size).toBe(1);
        const next = queue.flush(); await Promise.resolve(); queue.dispose(); release(); await next;
        expect(batches).toHaveLength(1); expect(queue.snapshot()).toMatchObject({ pendingChannels: 0, directory: false, scheduled: false });
        expect(queue.mark({ directory: true })).toBe(false);
        expect(() => createPresenceProjections({ flush() {}, delay: 51 })).toThrow('configuration');
    });
});

function application(persist = () => {}) {
    let engine, now = 1800000000000, count = 0; const frames = [];
    const { queue } = scheduler(batch => engine.flushPresence(batch));
    engine = createLobby({ now: () => now, persist, deferPresence: marker => queue.mark(marker), send: (id, frame) => frames.push({ recipient: id, ...frame }), limits: { defaultSlow: 0 } });
    const frame = (id, value) => engine.message(id, JSON.stringify(value));
    const command = (id, name, args = [], ch = '#stalemate', intent = {}) => frame(id, { t: 'cmd', name, args, ch, ...intent });
    const guest = async (nick, extra = {}) => {
        const id = `socket${++count}`;
        engine.connect({ id, dev: `dev-${nick}`, iph: `ip-${nick}`, ...extra });
        await frame(id, { t: 'hello', nick, age13: true }); return id;
    };
    return { engine, queue, frames, frame, command, guest, advance: value => { now += value; } };
}
const metadata = frames => frames.filter(frame => ['chan', 'list', 'ownership'].includes(frame.t));

describe('authorized latest presence projections', () => {
    it('keeps first join, commands, chat and events immediate while reducing burst projections', async () => {
        const { engine, queue, frames, guest, frame, command } = application();
        const a = await guest('Alice'); frames.length = 0; const b = await guest('Bravo');
        expect(frames.some(f => f.recipient === b && f.t === 'join')).toBe(true);
        expect(frames.some(f => f.recipient === a && f.t === 'event')).toBe(true);
        expect(frames.some(f => f.recipient === a && f.t === 'chan')).toBe(false);
        await frame(a, { t: 'say', ch: '#stalemate', text: 'Immediate live chat' });
        expect(frames.filter(f => f.t === 'line' && f.text === 'Immediate live chat')).toHaveLength(2);
        await command(b, 'list'); expect(frames.some(f => f.recipient === b && f.t === 'list' && f.show)).toBe(true);
        frames.length = 0; await queue.flush();
        expect(frames.filter(f => f.t === 'chan')).toHaveLength(2);
        expect(frames.filter(f => f.t === 'list')).toHaveLength(2);
        expect(frames.filter(f => f.t === 'line' || f.t === 'join')).toEqual([]);
        expect(engine._debug.conns.size).toBe(2);
    });
    it.each(['invite', 'keyed', 'locked'])('recomputes %s room visibility and skips departed members', async restriction => {
        const { engine, queue, frames, guest, command } = application();
        const a = await guest('Alice'), b = await guest('Bravo'), outside = await guest('Watcher');
        await command(a, 'join', ['#private-room']); await command(b, 'join', ['#private-room']);
        if (restriction === 'locked') await command(a, 'lock', [], '#private-room');
        else await command(a, 'mode', restriction === 'invite' ? ['+i'] : ['+k', 'roomKey123'], '#private-room');
        await engine.disconnect(b); frames.length = 0; await queue.flush();
        expect(frames.some(f => f.recipient === b)).toBe(false);
        expect(frames.filter(f => f.recipient === outside && f.t === 'chan').every(f => f.ch.name !== '#private-room')).toBe(true);
        expect(frames.find(f => f.recipient === outside && f.t === 'list').rooms).toEqual([]);
        expect(frames.find(f => f.recipient === a && f.t === 'chan' && f.ch.name === '#private-room').ch.names.map(n => n.nick)).toEqual(['Alice']);
        expect(JSON.stringify(frames)).not.toContain('roomKey123');
    });
    it('does not defer mode/camera/host or privacy changes behind presence metadata', async () => {
        const { queue, frames, guest, command, frame } = application();
        const a = await guest('Alice'), b = await guest('Bravo');
        await command(a, 'join', ['#art-night']); await command(b, 'join', ['#art-night']);
        await command(a, 'op', ['Bravo'], '#art-night', { personNamed: true });
        expect(frames.filter(f => f.t === 'chan' && f.ch.name === '#art-night').at(-1).ch.names.find(n => n.nick === 'Bravo').prefix).toBe('@');
        await frame(b, { t: 'cam', ch: '#art-night', on: true, adult18: true }); frames.length = 0;
        await command(a, 'mode', ['-C'], '#art-night');
        expect(frames.some(f => f.t === 'cam' && f.on === false)).toBe(true);
        expect(frames.filter(f => f.t === 'chan' && f.ch.name === '#art-night').at(-1).ch.modes.C).toBe(false);
        await command(a, 'deop', ['Bravo'], '#art-night', { personNamed: true });
        expect(frames.filter(f => f.t === 'chan' && f.ch.name === '#art-night').at(-1).ch.names.find(n => n.nick === 'Bravo').prefix).toBe('');
        await frame(b, { t: 'entry-source', source: '' });
        expect(frames.at(-1)).toMatchObject({ t: 'entry-source', source: '' });
        frames.length = 0; await queue.flush();
        expect(frames.filter(f => f.t === 'chan' && f.ch.name === '#art-night').at(-1).ch.modes.C).toBe(false);
    });
    it('does not project a closed room into a different room with the same name', async () => {
        const { engine, queue, frames, guest, command, advance } = application();
        const a = await guest('Alice'); await command(a, 'join', ['#reused']);
        const generation = engine._debug.channels.get('#reused').generation;
        await command(a, 'close', [], '#reused'); advance(11 * 60000); await command(a, 'join', ['#reused']);
        expect(engine._debug.channels.get('#reused').generation).not.toBe(generation);
        frames.length = 0; engine.flushPresence({ directory: false, allChannels: false, channels: [{ name: '#reused', generation }] });
        expect(frames).toEqual([]); await queue.flush();
        expect(frames.some(f => f.t === 'chan' && f.ch.name === '#reused')).toBe(true);
    });
    it('uses current owner and revoked co-host authority after a pending presence burst', async () => {
        const { queue, frames, guest, command } = application();
        const a = await guest('Alice', { account: 'a'.repeat(64) }), b = await guest('Bravo', { account: 'b'.repeat(64) });
        await command(a, 'join', ['#owned-room']); await command(a, 'register', [], '#owned-room');
        await command(b, 'join', ['#owned-room']); await command(a, 'cohost', ['add', 'Bravo'], '#owned-room', { personNamed: true });
        await command(a, 'transfer', ['Bravo'], '#owned-room', { personNamed: true }); await command(b, 'acceptowner', [], '#owned-room');
        await command(b, 'cohost', ['remove', 'Alice'], '#owned-room', { personNamed: true });
        expect(frames.filter(f => f.t === 'ownership' && f.recipient === b).at(-1).cohosts).toEqual([]);
        frames.length = 0; await queue.flush();
        expect(frames.filter(f => f.t === 'ownership').map(f => f.recipient)).toEqual([b]);
        expect(frames.find(f => f.t === 'chan' && f.ch.name === '#owned-room').ch.names.find(n => n.nick === 'Alice')).toMatchObject({ owner: false, prefix: '' });
        expect(frames.find(f => f.t === 'list' && f.recipient === a).rooms.find(r => r.name === '#owned-room').mine).toBe(false);
    });
    it('queues no dirty success before storage commits and blocks projection during a pending mutation', async () => {
        let release;
        const { engine, queue, frames, guest, command } = application(key => key === 'rooms' ? new Promise(resolve => { release = resolve; }) : undefined);
        const a = await guest('Alice'); const before = queue.snapshot().marks;
        const joining = command(a, 'join', ['#not-yet-committed']);
        expect(queue.snapshot().marks).toBe(before); frames.length = 0;
        engine.flushPresence({ directory: true, allChannels: true, channels: [] }); expect(metadata(frames)).toEqual([]);
        release(); await joining; expect(queue.snapshot().marks).toBeGreaterThan(before);
        await queue.flush(); expect(frames.some(f => f.t === 'list' && f.rooms.some(room => room.name === '#not-yet-committed'))).toBe(true);
    });
    it('never uses an earlier committed marker to publish a later failed mutation', async () => {
        let fail = false;
        const { engine, queue, frames, guest, command } = application(key => fail && key === 'rooms' ? Promise.reject(Error('storage failed')) : undefined);
        const a = await guest('Alice'), b = await guest('Bravo');
        const before = queue.snapshot().marks; fail = true;
        await command(a, 'join', ['#failed-room']); expect(queue.snapshot().marks).toBe(before);
        frames.length = 0; await queue.flush(); expect(metadata(frames)).toEqual([]);
        expect(engine.adminState().lock).toBe('readonly'); expect(engine._debug.conns.has(b)).toBe(true);
    });
    it('keeps synchronous behavior for direct engine callers that do not opt into coalescing', () => {
        const frames = [], engine = createLobby({ send: (_id, frame) => frames.push(frame) });
        engine.connect({ id: 'sync', dev: 'device-sync', iph: 'ip-sync' });
        engine.message('sync', JSON.stringify({ t: 'hello', nick: 'DirectGuest', age13: true }));
        expect(frames.some(frame => frame.t === 'chan')).toBe(true);
    });
});
