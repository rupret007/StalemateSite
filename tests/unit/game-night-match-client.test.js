import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGameNightMatchClient } from '../../r/45662413410ed051/lobby/game-night-match-client.mjs';

describe('Game Night phone wake and history recovery', () => {
    let client, sockets, issue, hidden, events;
    const restored = () => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    const visibility = value => {
        hidden = value;
        document.dispatchEvent(new Event('visibilitychange'));
    };
    function ready(socket) {
        socket.readyState = WebSocket.OPEN;
        socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ t: 'match-ready', version: 1, ping: true }) }));
    }

    beforeEach(async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000);
        hidden = false;
        vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
        sockets = [];
        class MatchSocket extends EventTarget {
            static OPEN = 1;
            static CLOSING = 2;
            static CLOSED = 3;
            readyState = 0;
            send = vi.fn();
            close = vi.fn(() => { this.readyState = MatchSocket.CLOSED; });
            constructor() {
                super();
                sockets.push(this);
            }
        }
        vi.stubGlobal('WebSocket', MatchSocket);
        issue = vi.fn(async () => new Response(JSON.stringify({ ticket: 'm' + '1'.repeat(32), protocol: 'game-night.v1' })));
        vi.stubGlobal('fetch', issue);
        events = [];
        const spies = [window, document].map(target => {
            const add = target.addEventListener.bind(target);
            return vi.spyOn(target, 'addEventListener').mockImplementation((type, listener, options) => {
                events.push([target, type, listener, options]);
                add(type, listener, options);
            });
        });
        client = createGameNightMatchClient({ prefix: '/beta/arcade', onStatus: vi.fn(), onState: vi.fn(), onError: vi.fn() });
        for (const spy of spies) spy.mockRestore();
        client.start({ room: '#game-fixture', ref: 'fixture' });
        await vi.advanceTimersByTimeAsync(0);
        expect(sockets).toHaveLength(1);
        ready(sockets[0]);
    });

    afterEach(() => {
        client?.stop();
        for (const [target, type, listener, options] of events) target.removeEventListener(type, listener, options);
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it.each(['visibility first', 'history first'])('uses one ticket with an already closed ping-capable socket (%s)', async order => {
        visibility(true);
        vi.setSystemTime(1000 + 120_000);
        // The browser marks the socket closed before delivering its queued close event.
        sockets[0].readyState = WebSocket.CLOSED;
        if (order === 'visibility first') {
            visibility(false);
            restored();
        } else {
            restored();
            visibility(false);
        }
        expect(issue).toHaveBeenCalledTimes(2);
        expect(sockets[0].send).toHaveBeenCalledTimes(1); // Initial sync only.
        await vi.advanceTimersByTimeAsync(0);
        expect(sockets).toHaveLength(2);
    });

    function matchState(state) {
        sockets.at(-1).dispatchEvent(new MessageEvent('message', {
            data: JSON.stringify({ t: 'match-state', version: 1, room: '#game-fixture', state })
        }));
    }

    function fakeWakeLock() {
        const locks = [];
        const request = vi.fn(async () => {
            const lock = new EventTarget();
            lock.release = vi.fn(async () => lock.dispatchEvent(new Event('release')));
            locks.push(lock);
            return lock;
        });
        Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
        return { request, locks };
    }

    it('keeps the screen awake only for a seated match', async () => {
        const { request, locks } = fakeWakeLock();
        try {
            matchState({ seat: 'w', match: null });
            matchState({ seat: null, match: {} });
            expect(request).not.toHaveBeenCalled();

            matchState({ seat: 'w', match: {} });
            await vi.advanceTimersByTimeAsync(0);
            expect(request).toHaveBeenCalledExactlyOnceWith('screen');

            visibility(true);
            expect(locks[0].release).toHaveBeenCalledTimes(1);
            visibility(false);
            await vi.advanceTimersByTimeAsync(0);
            expect(request).toHaveBeenCalledTimes(2);

            matchState({ seat: 'w', match: { result: { winner: 'w' } } });
            expect(locks[1].release).toHaveBeenCalledTimes(1);
            matchState({ seat: 'w', match: {} });
            await vi.advanceTimersByTimeAsync(0);
            client.stop();
            expect(locks[2].release).toHaveBeenCalledTimes(1);
        } finally { delete navigator.wakeLock; }
    });

    it('releases a wake lock that arrives after leaving', async () => {
        const { request } = fakeWakeLock();
        const lock = new EventTarget();
        lock.release = vi.fn(async () => {});
        let resolve;
        request.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
        try {
            matchState({ seat: 'w', match: {} });
            client.stop();
            expect(request).toHaveBeenCalledTimes(1);
            resolve(lock);
            await vi.advanceTimersByTimeAsync(0);
            expect(lock.release).toHaveBeenCalledTimes(1);
        } finally { delete navigator.wakeLock; }
    });

    it('keeps the returned ticket through an upgrade that has not sent match-ready', async () => {
        restored();
        await vi.advanceTimersByTimeAsync(0);
        expect(sockets).toHaveLength(2);
        expect(sockets[1].readyState).toBe(0);
        restored();
        expect(issue).toHaveBeenCalledTimes(2);
        expect(sockets[1].close).not.toHaveBeenCalled();
        ready(sockets[1]);
        expect(sockets[1].send).toHaveBeenCalledTimes(1);
    });
});
