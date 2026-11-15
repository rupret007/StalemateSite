import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGameNightMatchClient } from '../../r/45662413410ed051/lobby/game-night-match-client.mjs';

describe('Game Night match reconnect', () => {
    let client, sockets, issue, states, matches, status;
    const room = '#reconnect-test';

    function ready(socket) {
        socket.readyState = WebSocket.OPEN;
        socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
            t: 'match-ready', version: 1, snapshots: true
        }) }));
    }

    function snapshot(socket, state, seq) {
        socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
            t: 'snapshot', version: 1, room, seq, phase: 'playing',
            currentMatchId: state.id, state
        }) }));
    }

    beforeEach(async () => {
        vi.useFakeTimers();
        sockets = [];
        class FakeSocket extends EventTarget {
            static OPEN = 1;
            static CLOSING = 2;
            static CLOSED = 3;
            readyState = 0;
            send = vi.fn();
            close = vi.fn(() => { this.readyState = FakeSocket.CLOSED; });
            constructor() { super(); sockets.push(this); }
        }
        vi.stubGlobal('WebSocket', FakeSocket);
        issue = vi.fn(async () => new Response(JSON.stringify({
            ticket: 'm' + '1'.repeat(32), protocol: 'game-night.v1'
        })));
        vi.stubGlobal('fetch', issue);
        states = [];
        matches = [];
        status = vi.fn();
        client = createGameNightMatchClient({
            prefix: '/beta/arcade', onStatus: status,
            onState: frame => states.push(frame), onMatch: (...args) => matches.push(args),
            onError: vi.fn()
        });
        client.start({ room, ref: 'fixture' });
        await vi.advanceTimersByTimeAsync(0);
        ready(sockets[0]);
    });

    afterEach(() => {
        client?.stop();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    const games = [
        ['Chess', { id: 'match-chess', seat: 'w', match: { game: 'chess', board: ['wK', 'bK'], turn: 'b' } }],
        ['partners Spades', { id: 'match-partners', seat: 'north', match: { game: 'spades', mode: 'partners', hands: { north: ['AS', 'KH'] }, trick: ['2C'] } }],
        ['four-player Spades', { id: 'match-four-spades', seat: 'east', match: { game: 'spades', mode: 'four', hands: { east: ['QD', 'JC'] }, trick: ['2C', '3C'] } }],
        ['Turdanoid', { id: 'match-turdanoid', seat: 'south', match: { game: 'turdanoid', score: 12, bricks: [1, 0, 1] } }]
    ];

    it.each(games)('%s reconnects into the same seat and match state', async (_game, state) => {
        snapshot(sockets[0], state, 7);
        const initial = matches.at(-1)[1];
        sockets[0].dispatchEvent(new CloseEvent('close', { code: 1006 }));
        expect(status).toHaveBeenLastCalledWith('reconnecting');

        await vi.advanceTimersByTimeAsync(1000);
        expect(sockets).toHaveLength(2);
        ready(sockets[1]);
        expect(JSON.parse(sockets[1].send.mock.calls[0][0])).toEqual({ version: 1, t: 'hello', lastSeq: 7 });

        snapshot(sockets[1], state, 8);
        expect(matches.at(-1)[1]).toEqual(initial);
        expect(matches.at(-1)[1]).toMatchObject({ id: state.id, seat: state.seat, match: state.match });
        expect(states.at(-1)).toMatchObject({ seq: 8, currentMatchId: state.id, state });
    });

    it('does not reconnect after a pre-snapshot room refusal 4403', async () => {
        // Before a table view, a room refusal means this invite cannot join.
        sockets[0].dispatchEvent(new CloseEvent('close', { code: 4403, reason: 'banned' }));
        await vi.advanceTimersByTimeAsync(30_000);
        expect(issue).toHaveBeenCalledTimes(1);
        expect(sockets).toHaveLength(1);
    });

    // The current base does not recognize 4003 as terminal; job 106 owns that client fix.
    it.fails('does not reconnect after a ban close 4003', async () => {
        sockets[0].dispatchEvent(new CloseEvent('close', { code: 4003, reason: 'banned' }));
        await vi.advanceTimersByTimeAsync(30_000);
        expect(issue).toHaveBeenCalledTimes(1);
        expect(sockets).toHaveLength(1);
    });

    // The client currently retries this post-view close. Keep the contract visible
    // without making this test-only change claim the unavailable client fix.
    it.fails('does not reconnect after a post-snapshot ban close 4403', async () => {
        snapshot(sockets[0], { id: 'match-banned', seat: 'w', match: { game: 'chess' } }, 7);
        sockets[0].dispatchEvent(new CloseEvent('close', { code: 4403, reason: 'banned' }));
        await vi.advanceTimersByTimeAsync(30_000);
        expect(issue).toHaveBeenCalledTimes(1);
        expect(sockets).toHaveLength(1);
    });

    // The client currently retries this close; resolving it requires changing
    // the locked match-client/lobby paths, which this task does not allow.
    it.fails('does not reconnect after a kick close 4001', async () => {
        sockets[0].dispatchEvent(new CloseEvent('close', { code: 4001, reason: 'kicked' }));
        await vi.advanceTimersByTimeAsync(30_000);
        expect(issue).toHaveBeenCalledTimes(1);
        expect(sockets).toHaveLength(1);
    });
});
