import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGameNightMatchClient } from '../../r/45662413410ed051/lobby/game-night-match-client.mjs';

describe('Game Night match reconnect privacy and recovery', () => {
    let client, sockets, issue, states, matches, status;

    function ready(socket, snapshots = true) {
        socket.readyState = WebSocket.OPEN;
        socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
            t: 'match-ready', version: 1, snapshots
        }) }));
    }
    function snapshot(socket, state, phase = 'playing', seq = 1) {
        socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
            t: 'snapshot', version: 1, room: '#reconnect-test', seq, phase,
            currentMatchId: state?.id ?? 'match-12345', state
        }) }));
    }

    beforeEach(async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000);
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
        issue = vi.fn(async () => new Response(JSON.stringify({ ticket: 'm' + '1'.repeat(32), protocol: 'game-night.v1' })));
        vi.stubGlobal('fetch', issue);
        states = [];
        matches = [];
        status = vi.fn();
        client = createGameNightMatchClient({
            prefix: '/beta/arcade', onStatus: status, onState: frame => states.push(frame),
            onError: vi.fn(), onMatch: (...args) => matches.push(args)
        });
        client.start({ room: '#reconnect-test', ref: 'fixture' });
        await vi.advanceTimersByTimeAsync(0);
        ready(sockets[0]);
    });

    afterEach(() => {
        client?.stop();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('reconnects after a non-terminal close and syncs the replacement connection', async () => {
        sockets[0].dispatchEvent(new CloseEvent('close', { code: 1006 }));
        expect(status).toHaveBeenLastCalledWith('reconnecting');
        await vi.advanceTimersByTimeAsync(1000);
        expect(sockets).toHaveLength(2);
        ready(sockets[1]);
        expect(JSON.parse(sockets[1].send.mock.calls[0][0])).toEqual({
            version: 1, t: 'hello', lastSeq: 0
        });
    });

    it.each([4001, 4003, 4403])('does not reconnect after terminal close %i', async code => {
        sockets[0].dispatchEvent(new CloseEvent('close', { code }));
        await vi.advanceTimersByTimeAsync(30_000);
        expect(issue).toHaveBeenCalledTimes(1);
        expect(sockets).toHaveLength(1);
        expect(status).toHaveBeenLastCalledWith('unavailable', code === 4403 ? 'room' : undefined);
    });

    it('resumes a Spades seat with its own hand and gives a watcher no hand', () => {
        const ownHand = ['AS', 'KH'];
        const resumedSeat = { id: 'match-spades', seat: 'north', match: { game: 'spades', hands: { north: ownHand } } };
        snapshot(sockets[0], resumedSeat);
        expect(matches.at(-1)[1].seat).toBe('north');
        expect(matches.at(-1)[1].match.hands).toEqual({ north: ownHand });

        const watcher = { id: 'match-spades', seat: null, match: { game: 'spades', phase: 'playing' } };
        snapshot(sockets[0], watcher, 'playing', 2);
        expect(matches.at(-1)[1].seat).toBeNull();
        expect(matches.at(-1)[1].match).not.toHaveProperty('hands');
        expect(JSON.stringify(matches.at(-1)[1])).not.toContain('AS');
    });

    it('delivers the finished result after reconnect so the result line remains available', async () => {
        snapshot(sockets[0], { id: 'match-finished', seat: 'south', match: { result: { winner: 'south', line: 'South wins' } } }, 'finished', 8);
        sockets[0].dispatchEvent(new CloseEvent('close', { code: 1006 }));
        await vi.advanceTimersByTimeAsync(1000);
        ready(sockets[1]);
        snapshot(sockets[1], { id: 'match-finished', seat: 'south', match: { result: { winner: 'south', line: 'South wins' } } }, 'finished', 8);
        expect(matches.at(-1)[1].match.result.line).toBe('South wins');
        expect(states.at(-1).phase).toBe('finished');
    });
});
