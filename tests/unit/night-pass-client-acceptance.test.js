// Night-pass acceptance suite: browser client and host-facing copy
// (Game Night guest-session steer items 2, 3, 6 and 7).
//
// [CONTRACT] = intended behaviour that does not exist on today's code (expected to fail).
// [PIN] = holds today and must keep holding. Proposed names are called out where used.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as matchClient from '../../r/45662413410ed051/lobby/game-night-match-client.mjs';

const room = '#game-2ca9e1x1be34a';
const scope = { actor: 'c' + '1'.repeat(32), room, ref: '0'.repeat(32) };
const firstMatch = '00000000-0000-4000-8000-000000000001';
const nextMatch = '00000000-0000-4000-8000-000000000002';

class FakeSocket {
    static OPEN = 1;
    static CLOSING = 2;
    static instances = [];
    constructor(url, protocols) {
        this.url = String(url); this.protocols = protocols; this.readyState = 1; this.sent = []; this.listeners = {};
        FakeSocket.instances.push(this);
    }
    addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
    send(value) { this.sent.push(JSON.parse(value)); }
    close() { this.readyState = 3; }
    emit(type, event) { for (const handler of this.listeners[type] || []) handler(event); }
    frame(value) { this.emit('message', { data: JSON.stringify(value) }); }
    drop(code) { this.readyState = 3; this.emit('close', { code }); }
}

async function clientFixture(extra = {}) {
    const calls = { onStatus: vi.fn(), onState: vi.fn(), onError: vi.fn(), onMatch: vi.fn(), onRematch: vi.fn() };
    const client = matchClient.createGameNightMatchClient({ prefix: '/beta/arcade', ...calls, ...extra });
    client.start(scope);
    await vi.advanceTimersByTimeAsync(0);
    const socket = () => FakeSocket.instances.at(-1);
    expect(FakeSocket.instances).toHaveLength(1);
    socket().frame({ t: 'match-ready', version: 1 });
    return { client, calls, socket };
}

const playing = (id, seat = 'b') => ({ version: 1, game: 'chess', id, seat, waiting: false, hasOpenSeat: false,
    match: { id, turn: 'w', moves: [], result: null }, rematch: null });

beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200,
        json: async () => ({ ticket: 'm' + 'a'.repeat(32), protocol: 'game-night.v1' }) })));
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('steer item 2: clients auto-follow a rematch', () => {
    it('[CONTRACT] a {t:"rematch",matchId} broadcast is followed without any user action', async () => {
        // Today the client drops unknown frame types. Following means either re-syncing to the
        // announced match or handing the id to a (proposed) onRematch callback.
        const f = await clientFixture();
        f.socket().frame({ t: 'match-state', version: 1, room, state: playing(firstMatch) });
        const syncs = () => f.socket().sent.filter(frame => frame.action === 'sync').length;
        const before = syncs();
        f.socket().frame({ t: 'rematch', matchId: nextMatch });
        const followed = syncs() > before || f.calls.onRematch.mock.calls.some(([id]) => id === nextMatch);
        expect(followed).toBe(true);
        expect(f.calls.onError).not.toHaveBeenCalled();
    });

    it('[PIN] the state for the rematched match reaches the table view as soon as it arrives', async () => {
        const f = await clientFixture();
        f.socket().frame({ t: 'match-state', version: 1, room, state: playing(firstMatch) });
        const next = { t: 'match-state', version: 1, room, state: playing(nextMatch, 'w') };
        f.socket().frame(next);
        expect(f.calls.onState).toHaveBeenLastCalledWith(next);
        expect(f.calls.onMatch.mock.calls.at(-1)[1]).toMatchObject({ id: nextMatch, seat: 'w' });
    });
});

describe('steer item 3: after a reconnect the UI renders only from the server snapshot', () => {
    it('[PIN] a reconnect re-syncs and hands the view exactly what the server sent', async () => {
        const f = await clientFixture();
        f.socket().frame({ t: 'match-state', version: 1, room, state: playing(firstMatch) });
        f.socket().drop(1006);
        expect(f.calls.onStatus).toHaveBeenLastCalledWith('reconnecting');
        await vi.advanceTimersByTimeAsync(500);
        expect(FakeSocket.instances).toHaveLength(2);
        f.socket().frame({ t: 'match-ready', version: 1 });
        expect(f.socket().sent).toEqual([{ version: 1, action: 'sync' }]);
        const fresh = { t: 'match-state', version: 1, room, state: playing(nextMatch, 'w') };
        f.socket().frame(fresh);
        expect(f.calls.onState).toHaveBeenLastCalledWith(fresh);
    });

    it('[CONTRACT] a snapshot older than the last rendered seq is dropped', async () => {
        const f = await clientFixture();
        const snapshot = (seq, id) => ({ t: 'match-state', version: 1, room, seq, phase: 'playing',
            currentMatchId: id, yourSeat: 'b', turn: 'w', state: playing(id) });
        f.socket().frame(snapshot(5, nextMatch));
        f.socket().frame(snapshot(4, firstMatch));
        expect(f.calls.onState).toHaveBeenCalledTimes(1);
        expect(f.calls.onState.mock.calls[0][0].seq).toBe(5);
    });

    it('[CONTRACT] "wait for host" is shown only when phase=lobby and there is no currentMatchId', () => {
        // Proposed pure export on game-night-match-client.mjs:
        //   gameNightSnapshotStatus({ seq, phase, currentMatchId, yourSeat, turn }) -> { waitForHost: boolean, ... }
        // Every table view derives its "Waiting for the host…" line from it, never from local state.
        const { gameNightSnapshotStatus } = matchClient;
        expect(gameNightSnapshotStatus, 'CONTRACT NOT IMPLEMENTED: gameNightSnapshotStatus').toBeTypeOf('function');
        const base = { seq: 7, yourSeat: null, turn: null };
        expect(gameNightSnapshotStatus({ ...base, phase: 'lobby', currentMatchId: null }).waitForHost).toBe(true);
        for (const snapshot of [
            { ...base, phase: 'lobby', currentMatchId: firstMatch },
            { ...base, phase: 'playing', currentMatchId: firstMatch, yourSeat: 'b', turn: 'w' },
            { ...base, phase: 'playing', currentMatchId: firstMatch },
            { ...base, phase: 'finished', currentMatchId: firstMatch, yourSeat: 'b' },
            { ...base, phase: 'rematch', currentMatchId: nextMatch, yourSeat: 'w', turn: 'w' }
        ]) {
            expect(gameNightSnapshotStatus(snapshot).waitForHost, JSON.stringify(snapshot)).toBe(false);
        }
    });
});

describe('steer item 6: the replaced (older) socket stands down', () => {
    it('[PIN] a client whose socket was replaced does not reconnect over the newest one', async () => {
        const f = await clientFixture();
        f.socket().frame({ t: 'match-state', version: 1, room, state: playing(firstMatch) });
        f.socket().drop(4409);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(FakeSocket.instances).toHaveLength(1);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(f.calls.onStatus).toHaveBeenLastCalledWith('unavailable', expect.any(String));
    });
});

describe('steer item 7: host-facing copy carries no hard-coded durations', () => {
    const root = process.cwd();
    const lobbyDir = join(root, 'r/45662413410ed051/lobby');
    const files = [
        ...readdirSync(lobbyDir).filter(name => /^(?:lobby\.js|index\.html|game-night.*\.m?js|arcade-.*\.mjs)$/.test(name))
            .map(name => join('r/45662413410ed051/lobby', name)),
        'r/45662413410ed051/entry-sites.mjs',
        'hangout-worker/src/game-night-invitations.mjs',
        'hangout-worker/src/beta-entry.mjs'
    ];
    // "20 min", "20 minutes", "2 hours", "72-hour", "3 days" …
    const duration = /\b\d+(?:\s|-|&nbsp;)?(?:min(?:ute)?s?|h(?:ou)?rs?|days?)\b/i;
    // Copy about invitations, guest passes and the Game Night table.
    const subject = /invitation|game night|night pass|guest (?:pass|link|can|session|access)|your host|rematch|seat/i;
    const comment = /^\s*(?:\/\/|\/?\*|<!--)/;

    it('[CONTRACT] no invite or guest-pass copy states a literal duration', () => {
        // Today: lobby.js says "One guest can use this invitation within 20 minutes."
        const offenders = [];
        for (const file of files) {
            readFileSync(join(root, file), 'utf8').split('\n').forEach((line, index) => {
                if (!comment.test(line) && subject.test(line) && duration.test(line)) {
                    offenders.push(`${file}:${index + 1}: ${line.trim().slice(0, 160)}`);
                }
            });
        }
        expect(offenders).toEqual([]);
    });

    it('[CONTRACT] the host invite status derives its wording from the server inviteExpiresAt', () => {
        const source = readFileSync(join(lobbyDir, 'lobby.js'), 'utf8');
        expect(source.includes('inviteExpiresAt')).toBe(true);
    });

    it('[CONTRACT] the guest invitation page reads inviteExpiresAt instead of assuming a lifetime', () => {
        const source = readFileSync(join(lobbyDir, 'game-night-guest.js'), 'utf8');
        expect(source.includes('inviteExpiresAt')).toBe(true);
    });
});
