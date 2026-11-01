// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { acknowledgeDelivery, createBoundedSerialQueue, createSocketDelivery, deliveryState } from '../../hangout-worker/src/socket-delivery.mjs';
import { applyStroke, actSnapshot } from '../../hangout-worker/src/lobby-act.mjs';
import { LOBBY_LIMITS } from '../../hangout-worker/src/lobby-core.mjs';

function socket(bufferedAmount) {
    return { readyState: 1, ...(bufferedAmount === undefined ? {} : { bufferedAmount }), frames: [],
        send(raw) { this.frames.push(JSON.parse(raw)); }, close(code, reason) { this.closed = { code, reason }; this.readyState = 3; } };
}
const limits = { frameBytes: 1024, pendingBytes: 2048, pendingFrames: 2, legacyFrames: 3 };

describe('bounded socket delivery', () => {
    it('closes an unacknowledged reader without queuing message bodies or blocking other readers', () => {
        const retired = vi.fn(), delivery = createSocketDelivery({ limits, onClosed: retired });
        const slow = socket(), healthy = socket();
        delivery.negotiate(slow, 1); delivery.negotiate(healthy, 1);
        expect(delivery.send(slow, { t: 'line', text: 'first' })).toBe(true);
        expect(delivery.send(slow, { t: 'line', text: 'second' })).toBe(true);
        expect(delivery.send(slow, { t: 'line', text: 'never queued' })).toBe(false);
        expect(slow.frames.map(f => f.text)).toEqual(['first', 'second']);
        expect(slow.closed).toMatchObject({ code: 4413 });
        expect(delivery.send(slow, { t: 'line', text: 'after closure' })).toBe(false);
        expect(retired).toHaveBeenCalledTimes(1);
        expect(delivery.send(healthy, { t: 'line', text: 'still connected' })).toBe(true);
        expect(delivery.snapshot()).toMatchObject({ pressureCloses: 1, sentFrames: 3 });
    });

    it('restores only sequence/byte accounting across hibernation and releases exact issued credit', () => {
        const ws = socket(); let saved;
        const opts = { limits, readState: () => saved, writeState: (_socket, state) => { saved = structuredClone(state); } };
        const first = createSocketDelivery(opts);
        first.negotiate(ws, 1);
        first.send(ws, { t: 'line', text: 'ephemeral text' }); first.send(ws, { t: 'line', text: 'another line' });
        expect(JSON.stringify(saved)).not.toMatch(/ephemeral|another|line|text/);
        const resumed = createSocketDelivery(opts);
        expect(resumed.acknowledge(ws, 1)).toBe(true);
        expect(saved).toMatchObject({ seq: 2, ack: 1 }); expect(saved.sizes).toHaveLength(1);
        expect(resumed.acknowledge(ws, 1)).toBe(true); expect(saved.sizes).toHaveLength(1);
        expect(resumed.send(ws, { t: 'notice', text: 'after wake' })).toBe(true);
        expect(ws.frames.at(-1).transportSeq).toBe(3);
        resumed.negotiate(ws, 1);
        expect(resumed.send(ws, { t: 'notice', text: 'hello cannot clear credit' })).toBe(false);
    });

    it('does not subtract acknowledged metrics when an older duplicate arrives', () => {
        const ws = socket(), delivery = createSocketDelivery(); delivery.negotiate(ws, 1);
        for (let i = 0; i < 4; i += 1) delivery.send(ws, { t: 'notice' });
        expect(delivery.acknowledge(ws, 4)).toBe(true);
        expect(delivery.acknowledge(ws, 1)).toBe(true);
        expect(delivery.snapshot().acknowledged).toBe(4);
    });

    it('bounds aggregate windows and releases shared credit exactly once on acknowledgement or closure', () => {
        const delivery = createSocketDelivery({ limits: { ...limits, totalPendingFrames: 3 } });
        const first = socket(), second = socket(), third = socket();
        for (const ws of [first, second, third]) delivery.negotiate(ws, 1);
        delivery.send(first, { t: 'notice' }); delivery.send(first, { t: 'notice' }); delivery.send(second, { t: 'notice' });
        expect(delivery.snapshot().pendingFrames).toBe(3);
        expect(delivery.send(second, { t: 'notice' })).toBe(false); expect(second.closed.reason).toMatch(/community delivery/);
        expect(delivery.snapshot().pendingFrames).toBe(2);
        expect(delivery.send(third, { t: 'notice' })).toBe(true);
        delivery.acknowledge(first, 2); expect(delivery.snapshot().pendingFrames).toBe(1);
        delivery.acknowledge(first, 1); expect(delivery.snapshot().pendingFrames).toBe(1);
        delivery.forget(third); delivery.forget(third);
        expect(delivery.snapshot()).toMatchObject({ pendingFrames: 0, pendingBytes: 0, peakPendingFrames: 3 });
    });

    it('rebuilds aggregate byte debt from surviving attachments before admitting more delivery', () => {
        const saved = new WeakMap(), opts = { readState: ws => saved.get(ws), writeState: (ws, state) => saved.set(ws, state) };
        const first = socket(), second = socket(), other = socket();
        const original = createSocketDelivery(opts);
        for (const ws of [first, second]) { original.negotiate(ws, 1); original.send(ws, { t: 'notice', text: 'connected state' }); }
        const bytes = original.snapshot().pendingBytes;
        const resumed = createSocketDelivery({ ...opts, limits: { totalPendingBytes: bytes } });
        expect(resumed.adopt(first)).toBe(true); expect(resumed.adopt(second)).toBe(true);
        expect(resumed.snapshot().pendingBytes).toBe(bytes);
        resumed.negotiate(other, 1);
        expect(resumed.send(other, { t: 'notice' })).toBe(false); expect(other.closed.code).toBe(4413);
        resumed.acknowledge(first, 1); resumed.forget(second);
        expect(resumed.snapshot()).toMatchObject({ pendingBytes: 0, pendingFrames: 0 });
    });

    it('rejects future, malformed and unnegotiated acknowledgements without granting credit', () => {
        for (const seq of [3, 0, -1, 1.5, '1', null]) {
            const ws = socket(), delivery = createSocketDelivery({ limits });
            delivery.negotiate(ws, 1); delivery.send(ws, { t: 'notice' });
            expect(delivery.acknowledge(ws, seq)).toBe(false);
            expect(ws.closed.code).toBe(4400);
        }
        const ws = socket(); expect(createSocketDelivery({ limits }).acknowledge(ws, 1)).toBe(false);
        expect(acknowledgeDelivery(deliveryState(), 1)).toBeNull();
    });

    it('bounds advancing controls, duplicate controls and control rate separately from chat', () => {
        const duplicate = socket(), duplicates = createSocketDelivery({ limits: { ...limits, duplicateAcks: 1 } });
        duplicates.negotiate(duplicate, 1); duplicates.send(duplicate, { t: 'notice' });
        expect(duplicates.acknowledge(duplicate, 1)).toBe(true);
        expect(duplicates.acknowledge(duplicate, 1)).toBe(true);
        expect(duplicates.acknowledge(duplicate, 1)).toBe(false); expect(duplicate.closed.code).toBe(4429);
        let clock = 1000;
        const fast = socket(), rate = createSocketDelivery({ now: () => clock, limits: { ...limits, ackBurst: 1, ackPerSecond: 1 } });
        rate.negotiate(fast, 1); rate.send(fast, { t: 'notice' }); expect(rate.acknowledge(fast, 1)).toBe(true);
        clock += 1000;
        rate.send(fast, { t: 'notice' }); expect(rate.acknowledge(fast, 2)).toBe(true);
        rate.send(fast, { t: 'notice' }); expect(rate.acknowledge(fast, 3)).toBe(false); expect(fast.closed.code).toBe(4429);
        const capped = socket(), count = createSocketDelivery({ limits: { ...limits, ackPerConnection: 1 } });
        count.negotiate(capped, 1); count.send(capped, { t: 'notice' }); count.acknowledge(capped, 1); count.send(capped, { t: 'notice' });
        expect(count.acknowledge(capped, 2)).toBe(false); expect(count.snapshot().controlCloses).toBe(1);
    });

    it('counts UTF-8 bytes and refuses oversized frames or aggregate byte pressure', () => {
        const payload = { t: 'line', text: '🌲'.repeat(12) };
        const size = new TextEncoder().encode(JSON.stringify({ ...payload, transportSeq: 1 })).byteLength;
        const ws = socket(), delivery = createSocketDelivery({ limits: { ...limits, pendingBytes: size * 2 - 1 } });
        delivery.negotiate(ws, 1); expect(delivery.send(ws, payload)).toBe(true);
        expect(delivery.send(ws, payload)).toBe(false); expect(ws.closed.code).toBe(4413);
        const large = socket(), capped = createSocketDelivery({ limits: { ...limits, frameBytes: 30 } });
        expect(capped.send(large, payload)).toBe(false); expect(large.frames).toEqual([]); expect(large.closed.code).toBe(1009);
    });

    it('preserves existing valid large painting snapshots rather than imposing a smaller activity limit', () => {
        const channel = { kind: 'art', act: { strokes: [], video: null } };
        const points = Array.from({ length: 400 }, () => [.1234, .5678]);
        for (let i = 0; i < 400; i += 1) expect(applyStroke(channel, { id: `stroke-${i}`, color: '#009ee8', size: 8, pts: points })).not.toBeNull();
        const frame = { t: 'join', ch: { name: '#art-staging', kind: 'art' }, act: actSnapshot(channel) };
        const bytes = new TextEncoder().encode(JSON.stringify(frame)).byteLength;
        expect(bytes).toBeGreaterThan(2 * 1024 * 1024); expect(bytes).toBeLessThan(LOBBY_LIMITS.roomStateBytes);
        const ws = socket(), delivery = createSocketDelivery(); delivery.negotiate(ws, 1);
        expect(delivery.send(ws, frame)).toBe(true); expect(ws.closed).toBeUndefined();
        expect(ws.frames[0].act.strokes).toHaveLength(400); expect(ws.frames[0].act.strokes.at(-1).pts).toEqual(points);
    });

    it('uses actual buffer pressure where available and a finite legacy allowance otherwise', () => {
        const observable = socket(0), legacy = socket(), delivery = createSocketDelivery({ limits });
        for (let i = 0; i < 8; i += 1) expect(delivery.send(observable, { t: 'notice' })).toBe(true);
        for (let i = 0; i < limits.legacyFrames; i += 1) expect(delivery.send(legacy, { t: 'notice' })).toBe(true);
        expect(delivery.send(legacy, { t: 'notice' })).toBe(false);
        expect(legacy.closed.code).toBe(4001); // Pre-feature clients already stop on4001.
        expect(legacy.closed.reason).toMatch(/client update required/);
        observable.bufferedAmount = limits.pendingBytes;
        expect(delivery.send(observable, { t: 'notice' })).toBe(false);
        expect(delivery.snapshot()).toMatchObject({ legacyCloses: 1, pressureCloses: 1 });
    });

    it('warns old pages after joining and uses their existing nonretryable stop code', () => {
        const ws = socket(), delivery = createSocketDelivery({ limits: { ...limits, legacyFrames: 5 } });
        delivery.negotiate(ws, undefined);
        expect(delivery.send(ws, { t: 'join', ch: { name: '#stalemate' } })).toBe(true);
        expect(ws.frames.map(frame => frame.t)).toEqual(['join', 'notice']);
        expect(ws.frames[1].text).toMatch(/Reload to keep chatting/);
        delivery.send(ws, { t: 'join', ch: { name: '#other' } });
        expect(ws.frames.filter(frame => frame.text?.includes('Reload to keep chatting'))).toHaveLength(1);
        while (!ws.closed) delivery.send(ws, { t: 'notice' });
        expect(ws.closed).toMatchObject({ code: 4001, reason: 'client update required; reload' });
    });

    it('fails closed on corrupt accounting, attachment failure and send failure', () => {
        for (const saved of [null, { ...deliveryState(), seq: 1000 }, { ...deliveryState(), legacyBytes: Infinity }]) {
            const ws = socket();
            expect(createSocketDelivery({ readState: () => saved }).send(ws, { t: 'notice' })).toBe(false);
            expect(ws.frames).toEqual([]); expect(ws.closed.code).toBe(4413);
        }
        const ws = socket(), retired = vi.fn();
        expect(createSocketDelivery({ writeState: () => { throw Error('attachment unavailable'); }, onClosed: retired }).send(ws, { t: 'notice' })).toBe(false);
        expect(retired).toHaveBeenCalledTimes(1);
        const gone = socket(); gone.send = () => { throw Error('gone'); };
        expect(createSocketDelivery().send(gone, { t: 'notice' })).toBe(false); expect(gone.closed.code).toBe(1011);
    });
});

describe('bounded local serial work', () => {
    it('bounds retained bytes/work, preserves order and reserves bounded membership cleanup', async () => {
        let release; const order = [], queue = createBoundedSerialQueue({ maxPending: 2, maxBytes: 12, maxCleanup: 1 });
        const first = queue.enqueue(async () => { order.push('start'); await new Promise(resolve => { release = resolve; }); order.push('finish'); }, 8);
        const second = queue.enqueue(() => order.push('second'), 4);
        await expect(queue.enqueue(() => order.push('not admitted'), 1)).rejects.toThrow('allowance');
        const cleanup = queue.enqueueCleanup(() => order.push('cleanup'));
        await expect(queue.enqueueCleanup(() => order.push('duplicate cleanup'))).rejects.toThrow('allowance');
        await Promise.resolve(); expect(order).toEqual(['start']); release();
        await Promise.all([first, second, cleanup]);
        expect(order).toEqual(['start', 'finish', 'second', 'cleanup']);
        expect(queue.snapshot()).toMatchObject({ pending: 0, cleanup: 0, bytes: 0, peakPending: 3, peakBytes: 12, rejected: 2 });
        await expect(queue.enqueue(() => {}, NaN)).rejects.toThrow('allowance');
    });
});
