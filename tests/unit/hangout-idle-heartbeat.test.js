// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIdleHeartbeat, LOBBY_IDLE_HEARTBEAT_MS as interval } from '../../r/45662413410ed051/lobby/idle-heartbeat.mjs';

afterEach(() => vi.useRealTimers());
function fixture() {
    vi.useFakeTimers();
    const socket = { readyState: 1, bufferedAmount: 0, send: vi.fn(), close: vi.fn() };
    let current = true;
    return { socket, heartbeat: createIdleHeartbeat(socket, () => current, () => Date.now()),
        stale: () => { current = false; } };
}

describe('negotiated idle lobby heartbeat', () => {
    it('sends only a transport control after a quiet interval, never chat or credentials', () => {
        const f = fixture(); f.heartbeat.negotiate(1);
        vi.advanceTimersByTime(interval - 1); expect(f.socket.send).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(f.socket.send).toHaveBeenCalledExactlyOnceWith('{"t":"transport-ping"}');
        f.heartbeat.stop(); expect(vi.getTimerCount()).toBe(0);
    });
    it.each([undefined, true, 0, 2])('does not ping an older or unsupported server (%s)', version => {
        const f = fixture(); f.heartbeat.negotiate(version);
        vi.advanceTimersByTime(interval * 3);
        expect(f.socket.send).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    });
    it('uses normal incoming traffic instead of adding keepalives to a busy room', () => {
        const f = fixture(); f.heartbeat.negotiate(1);
        vi.advanceTimersByTime(interval - 1000); f.heartbeat.received();
        vi.advanceTimersByTime(1000); expect(f.socket.send).not.toHaveBeenCalled();
        vi.advanceTimersByTime(interval); expect(f.socket.send).toHaveBeenCalledTimes(1);
        f.heartbeat.stop();
    });
    it('never queues pings behind undrained browser output', () => {
        const f = fixture(); f.heartbeat.negotiate(1); f.socket.bufferedAmount = 128;
        vi.advanceTimersByTime(interval * 3); expect(f.socket.send).not.toHaveBeenCalled();
        f.socket.bufferedAmount = 0; vi.advanceTimersByTime(interval);
        expect(f.socket.send).toHaveBeenCalledTimes(1); f.heartbeat.stop();
    });
    it.each(['stale', 'closed', 'stopped'])('retires its timer when the socket is %s', mode => {
        const f = fixture(); f.heartbeat.negotiate(1);
        if (mode === 'stale') f.stale();
        if (mode === 'closed') f.socket.readyState = 3;
        if (mode === 'stopped') f.heartbeat.stop();
        vi.advanceTimersByTime(interval * 3);
        expect(f.socket.send).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    });
    it('hands a failed write back to normal reconnect handling without retaining a timer', () => {
        const f = fixture(); f.socket.send.mockImplementation(() => { throw Error('synthetic write failure'); });
        f.heartbeat.negotiate(1); vi.advanceTimersByTime(interval);
        expect(f.socket.close).toHaveBeenCalledExactlyOnceWith(4000, 'connection check unavailable');
        expect(vi.getTimerCount()).toBe(0);
    });
});
