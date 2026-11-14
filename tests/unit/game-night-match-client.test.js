import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGameNightMatchClient, matchUnavailableText } from '../../r/45662413410ed051/lobby/game-night-match-client.mjs';

describe('Game Night phone wake and history recovery', () => {
    let client, sockets, issue, hidden, events;
    const restored = () => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    const visibility = value => {
        hidden = value;
        document.dispatchEvent(new Event('visibilitychange'));
    };
    function ready(socket, features = {}) {
        socket.readyState = WebSocket.OPEN;
        socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ t: 'match-ready', version: 1, ping: true, ...features }) }));
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

    it('uses one ticket on history restore and repeats hello with the confirmed snapshot sequence', async () => {
        client.start({ room: '#game-fixture', ref: 'fixture' });
        await vi.advanceTimersByTimeAsync(0);
        const current = sockets.at(-1);
        ready(current, { snapshots: true });
        expect(current.send.mock.calls.map(([data]) => JSON.parse(data))).toEqual([{ version: 1, t: 'hello', lastSeq: 0 }]);
        current.dispatchEvent(new MessageEvent('message', {
            data: JSON.stringify({ t: 'snapshot', version: 1, room: '#game-fixture', seq: 7, state: null })
        }));
        visibility(true);
        vi.setSystemTime(121_000);
        restored();
        visibility(false);
        expect(issue).toHaveBeenCalledTimes(3); // Original setup, new scope, single restore.
        await vi.advanceTimersByTimeAsync(0);
        const replacement = sockets.at(-1);
        ready(replacement, { snapshots: true });
        expect(replacement.send.mock.calls.map(([data]) => JSON.parse(data))).toEqual([{ version: 1, t: 'hello', lastSeq: 7 }]);
    });

    function snapshot(fields) {
        sockets.at(-1).dispatchEvent(new MessageEvent('message', {
            data: JSON.stringify({ t: 'snapshot', version: 1, room: '#game-fixture', seq: 1, state: null, ...fields })
        }));
    }

    it('tells a table view when a game is open but hidden, so it never says to wait for the host', async () => {
        client.start({ room: '#game-fixture', ref: 'fixture' });
        await vi.advanceTimersByTimeAsync(0);
        ready(sockets.at(-1), { snapshots: true });
        expect(client.matchOpen()).toBe(false);
        expect(client.matchUnavailable()).toBe(false);
        snapshot({ phase: 'lobby', currentMatchId: null });
        expect(client.matchOpen()).toBe(false);
        expect(client.matchUnavailable()).toBe(false);
        for (const phase of ['playing', 'finished']) {
            snapshot({ phase, currentMatchId: 'match-fixture' });
            expect(client.matchOpen()).toBe(true);
            expect(client.matchUnavailable()).toBe(false);
        }
        snapshot({ phase: 'unavailable', currentMatchId: null });
        expect(client.matchOpen()).toBe(false);
        expect(client.matchUnavailable()).toBe(true);
        expect(matchUnavailableText).toBe('This table isn\'t available from this invite. Ask the host for a fresh link.');
        snapshot({ phase: 'playing', currentMatchId: 'match-fixture', state: { seat: null, match: {} } });
        expect(client.matchOpen()).toBe(false);
        expect(client.matchUnavailable()).toBe(false);
    });

    it.each(['arcade-chess', 'arcade-crapeights', 'arcade-turdrummy', 'arcade-turdspades', 'arcade-turdjack'])(
        'checks for a hidden game before the waiting-for-host copy in %s', async view => {
            const { readFileSync } = await import('node:fs');
            const source = readFileSync(`r/45662413410ed051/lobby/${view}.mjs`, 'utf8');
            const unavailable = source.indexOf('!model && client.matchUnavailable()');
            const hidden = source.indexOf('} else if (!model && client.matchOpen()) {');
            const waiting = source.indexOf('Waiting for the host to open');
            expect(unavailable).toBeGreaterThan(-1);
            expect(hidden).toBeGreaterThan(unavailable);
            expect(waiting).toBeGreaterThan(hidden);
            expect(source.slice(unavailable, hidden)).toContain('matchUnavailableText');
            expect(source.slice(hidden, waiting)).toContain('matchHiddenText');
        });

    it('keeps trying to reconnect with a capped wait while the page is visible', async () => {
        const status = vi.fn();
        client.stop();
        client = createGameNightMatchClient({ prefix: '/beta/arcade', onStatus: status, onState: vi.fn(), onError: vi.fn() });
        client.start({ room: '#game-fixture', ref: 'fixture' });
        await vi.advanceTimersByTimeAsync(0);
        const delays = [];
        const timeout = vi.spyOn(globalThis, 'setTimeout');
        for (let attempt = 0; attempt < 12; attempt++) {
            const before = sockets.length;
            timeout.mockClear();
            sockets.at(-1).dispatchEvent(new CloseEvent('close', { code: 1006 }));
            expect(status).toHaveBeenLastCalledWith('reconnecting');
            delays.push(timeout.mock.calls.at(-1)[1]);
            await vi.advanceTimersByTimeAsync(delays.at(-1));
            expect(sockets).toHaveLength(before + 1);
        }
        expect(status).not.toHaveBeenCalledWith('unavailable', undefined);
        expect(Math.max(...delays)).toBeLessThanOrEqual(10_000);
        expect(delays.at(-1)).toBeGreaterThanOrEqual(7_500);
        expect(delays[0]).toBeLessThan(1_000);
    });

    it('waits while the page is hidden and reconnects when it is shown again', async () => {
        visibility(true);
        sockets[0].dispatchEvent(new CloseEvent('close', { code: 1006 }));
        await vi.advanceTimersByTimeAsync(3_000);
        expect(sockets).toHaveLength(1);
        expect(issue).toHaveBeenCalledTimes(1);
        visibility(false);
        await vi.advanceTimersByTimeAsync(0);
        expect(sockets).toHaveLength(2);
    });

    describe('rematch frame', () => {
        let onRematch, current;
        const sent = () => current.send.mock.calls.map(([data]) => JSON.parse(data));
        const frame = data => current.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) }));
        beforeEach(async () => {
            onRematch = vi.fn();
            client.stop();
            client = createGameNightMatchClient({ prefix: '/beta/arcade', onStatus: vi.fn(), onState: vi.fn(), onError: vi.fn(), onRematch });
            client.start({ room: '#game-fixture', ref: 'fixture' });
            await vi.advanceTimersByTimeAsync(0);
            current = sockets.at(-1);
            ready(current, { snapshots: true });
            frame({ t: 'snapshot', version: 1, room: '#game-fixture', seq: 4, phase: 'finished', currentMatchId: 'match-one',
                state: { id: 'match-one', seat: 'w', match: { result: { winner: 'w' } } } });
            current.send.mockClear();
        });

        it('follows the new match when its snapshot arrives', async () => {
            frame({ t: 'rematch', matchId: 'match-two' });
            expect(onRematch).toHaveBeenCalledExactlyOnceWith('match-two');
            frame({ t: 'snapshot', version: 1, room: '#game-fixture', seq: 5, phase: 'playing', currentMatchId: 'match-two',
                state: { id: 'match-two', seat: 'b', match: {} } });
            await vi.advanceTimersByTimeAsync(5_000);
            expect(sent()).toEqual([]);
        });

        it('asks for the new match when its snapshot does not arrive', async () => {
            frame({ t: 'rematch', matchId: 'match-two' });
            await vi.advanceTimersByTimeAsync(1_500);
            expect(sent()).toEqual([{ version: 1, action: 'sync' }]);
        });

        it('ignores a malformed rematch frame and one for the match already shown', async () => {
            frame({ t: 'rematch', matchId: 7 });
            frame({ t: 'rematch', matchId: 'match-one' });
            await vi.advanceTimersByTimeAsync(5_000);
            expect(onRematch).not.toHaveBeenCalled();
            expect(sent()).toEqual([]);
        });
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

    it('retries a pending wake lock denied during a hide and return', async () => {
        const { request, locks } = fakeWakeLock();
        let reject;
        request.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
        try {
            matchState({ seat: 'w', match: {} });
            visibility(true);
            visibility(false);
            expect(request).toHaveBeenCalledTimes(1);
            reject(new DOMException('Document became hidden', 'NotAllowedError'));
            await vi.advanceTimersByTimeAsync(0);
            expect(request).toHaveBeenCalledTimes(2);
            expect(locks).toHaveLength(1);
            client.stop();
            expect(locks[0].release).toHaveBeenCalledOnce();
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
