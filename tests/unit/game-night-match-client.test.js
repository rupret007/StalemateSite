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
