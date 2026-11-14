// @vitest-environment node
// Night-pass acceptance suite: server side (Game Night guest-session steer items 1-6).
//
// These tests pin the INTENDED contract. Tests tagged [CONTRACT] describe
// behaviour that does not exist on today's code and are expected to fail until
// the night pass is implemented. Tests tagged [PIN] hold today and must keep
// holding. Proposed (not yet existing) names are called out where they are used.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ARCADE_PROTOCOL, ARCADE_TAG, createArcadeTransport } from '../../hangout-worker/src/arcade-transport.mjs';
import * as invitations from '../../hangout-worker/src/game-night-invitations.mjs';
import { DEMO_INVITE_TTL } from '../../hangout-worker/src/beta-auth.mjs';

const HOUR = 60 * 60_000;
const room = '#game-2ca9e1x1be34a';
const ref = '0'.repeat(32);
const hostSid = 'host-session-aaaa';
const guestSid = 'guest-session-bbbb';
const hostActor = 'c' + '1'.repeat(32);
const guestActor = 'c' + '2'.repeat(32);

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

function tableFixture() {
    const records = new Map(), actors = new Map(), connections = [];
    let now = 1000, serial = 0;
    const storage = {
        get: vi.fn(async key => structuredClone(records.get(key))),
        put: vi.fn(async (key, value) => {
            for (const [name, record] of typeof key === 'string' ? [[key, value]] : Object.entries(key)) {
                records.set(name, structuredClone(record));
            }
        }),
        delete: vi.fn(async key => { for (const name of [key].flat()) records.delete(name); }),
        list: vi.fn(async ({ prefix = '' } = {}) => new Map([...records].filter(([key]) => key.startsWith(prefix))))
    };
    function fakeSocket(attachment) {
        return { frames: [], readyState: 1, serializeAttachment(data) { attachment = data; },
            deserializeAttachment: () => attachment, send(value) { this.frames.push(JSON.parse(value)); },
            close: vi.fn(function close() { this.readyState = 3; }) };
    }
    function bind(id, betaSid, canOpen, extra = {}) {
        actors.set(id, { betaSid, betaInviteVersion: '1', canPlay: true, canOpen,
            canJoin: subject => subject !== betaSid, canSee: () => true, ...extra });
    }
    function connect(id) {
        const binding = actors.get(id);
        const socket = fakeSocket({ actor: id, betaSid: binding.betaSid, betaInviteVersion: '1', room, ref, kind: ARCADE_TAG });
        connections.push(socket);
        return socket;
    }
    bind(hostActor, hostSid, true);
    bind(guestActor, guestSid, false);
    const host = connect(hostActor), guest = connect(guestActor);
    const state = {
        storage,
        getWebSockets: () => connections,
        acceptWebSocket: socket => { connections.push(socket); }
    };
    const transport = createArcadeTransport({ state,
        now: () => now, uuid: () => '00000000-0000-4000-8000-' + String(++serial).padStart(12, '0'),
        current: scope => actors.get(scope.actor), active: async () => true, approve: async () => true,
        charge: async () => true, allowed: () => true });
    const send = (socket, action, fields = {}) => transport.receive(socket, JSON.stringify({ version: 1, action, ...fields }));
    const board = socket => socket.frames.findLast(frame => frame.t === 'match-state')?.state;
    const errors = socket => socket.frames.filter(frame => frame.t === 'match-error').map(frame => frame.reason);
    // Seats a rostered invited guest the way an accepted invitation does today.
    async function seatInvitedGuest() {
        await send(host, 'open');
        const { id } = board(host);
        actors.get(guestActor).gameGuest = { game: 'chess', match: id, room, ref, host: hostSid, nameSeed: 1 };
        await send(guest, 'join', { id });
        return id;
    }
    async function finish(id) {
        await send(host, 'resign', { id, revision: 0 });
        expect(board(host).match.result, 'fixture: the resignation must finish the match').toBeTruthy();
    }
    return { host, guest, board, errors, send, connect, bind, actors, storage, transport, fakeSocket, connections,
        seatInvitedGuest, finish, advance(ms) { now += ms; }, time: () => now };
}

function invitationFixture() {
    const rows = new Map();
    const accepted = [];
    const lobby = {
        env: { HANGOUT_BETA_MODE: 'protected', HANGOUT_GAME_NIGHT_GUESTS: '1' },
        state: { storage: {
            get: async key => rows.get(key),
            list: async () => rows,
            put: async (key, record) => rows.set(key, record),
            delete: async keys => { for (const key of [keys].flat()) rows.delete(key); }
        } },
        controlBudget: { take: async () => true },
        arcadeAvailable: game => game === 'chess',
        arcadeBinding: () => ({ betaSid: hostSid, betaInviteVersion: '1', canOpen: true, canPlay: true, nick: 'ExampleHost' }),
        sessionActive: async () => true,
        engine: { invitedGameHost: () => hostActor },
        arcade: { get: () => ({
            hasGuestSeat: async () => true,
            reserveGuestSeat: async (_scope, _sid, _until, key, record) => {
                rows.set(key, record);
                accepted.push(record);
                return true;
            }
        }) }
    };
    const payload = { actor: hostActor, room: '#game-1acbefx23acbe', ref: 'c'.repeat(32),
        game: 'chess', match: '11111111-1111-4111-8111-111111111111' };
    const issue = async demo => (await invitations.gameInvitationRequest(lobby, 'issue', payload, { betaSid: hostSid, demo })).json();
    const accept = (code, attempt = 'e'.repeat(32)) => invitations.gameInvitationRequest(lobby, 'accept', { code, age13: true, attempt });
    const details = code => invitations.gameInvitationRequest(lobby, 'details', { code });
    return { lobby, rows, accepted, issue, accept, details };
}

// A snapshot may ride on the frame itself or under frame.snapshot.
const snapshotOf = frame => frame?.snapshot ?? frame;
const snapshotKeys = ['seq', 'phase', 'currentMatchId', 'yourSeat', 'turn'];
const lastSnapshot = socket => snapshotOf(socket.frames.findLast(frame => snapshotKeys.every(key => key in snapshotOf(frame))));

describe('steer item 1: night pass is table-scoped', () => {
    it('[PIN] a rostered guest keeps a seat across a rematch without a seat-unavailable error', async () => {
        const f = tableFixture(), id = await f.seatInvitedGuest();
        await f.finish(id);
        await f.send(f.guest, 'rematch', { id });
        await f.send(f.host, 'rematch', { id });
        const next = f.board(f.guest);
        expect(next.id).not.toBe(id);
        expect(next.waiting).toBe(false);
        expect(next.seat).toBeTruthy();
        expect(f.errors(f.guest)).not.toContain('seat-unavailable');
        // The pass still names the first match; a reconnect after the rematch must not unseat its holder.
        const again = f.connect(guestActor);
        await f.send(again, 'sync');
        expect(f.board(again)).toMatchObject({ id: next.id, seat: next.seat });
        expect(f.errors(again)).toEqual([]);
    });

    it('[CONTRACT] a rostered guest keeps a seat when the host reopens the table', async () => {
        // Today the guest credential is pinned to one match id (binding.gameGuest.match),
        // so a reopened table answers the rostered guest with seat-unavailable.
        const f = tableFixture(), id = await f.seatInvitedGuest();
        await f.send(f.host, 'leave', { id });
        await f.send(f.host, 'open');
        const reopened = f.board(f.host);
        expect(reopened.id).not.toBe(id);
        // The guest's client auto-follows: a sync, then a join only if the table did not seat it already.
        await f.send(f.guest, 'sync');
        if (!f.board(f.guest)?.seat) await f.send(f.guest, 'join', { id: reopened.id });
        expect(f.errors(f.guest)).not.toContain('seat-unavailable');
        expect(f.board(f.guest)).toMatchObject({ id: reopened.id, seat: expect.any(String) });
    });

    it('[CONTRACT] a rostered guest keeps a seat when the table lapsed and the host reopens it', async () => {
        const f = tableFixture(), id = await f.seatInvitedGuest();
        f.advance(41 * 60_000); // past the table's own idle window; the night pass outlives a single table record
        await f.transport.maintain();
        await f.send(f.host, 'open');
        const reopened = f.board(f.host);
        expect(reopened?.id).toBeTruthy();
        expect(reopened.id).not.toBe(id);
        await f.send(f.guest, 'sync');
        if (!f.board(f.guest)?.seat) await f.send(f.guest, 'join', { id: reopened.id });
        expect(f.errors(f.guest)).not.toContain('seat-unavailable');
        expect(f.board(f.guest)).toMatchObject({ id: reopened.id, seat: expect.any(String) });
    });

    it('[PIN] a reopened table still refuses a guest whose pass belongs to another table', async () => {
        const f = tableFixture(), id = await f.seatInvitedGuest();
        await f.send(f.host, 'leave', { id });
        await f.send(f.host, 'open');
        const reopened = f.board(f.host);
        const strangerActor = 'c' + '3'.repeat(32);
        f.bind(strangerActor, 'stranger-session-cccc', false, {
            gameGuest: { game: 'chess', match: id, room: '#game-aaaaaaxbbbbbb', ref: 'f'.repeat(32), host: 'other-host-session', nameSeed: 2 }
        });
        const stranger = f.connect(strangerActor);
        await f.send(stranger, 'join', { id: reopened.id });
        expect(f.board(stranger)?.seat ?? null).toBeNull();
    });

    it('[PIN] the same accept attempt gets the same pass back instead of an expired-invite refusal', async () => {
        const f = invitationFixture();
        const { code } = await f.issue(false);
        const first = await (await f.accept(code)).json();
        // After acceptance the table is no longer waiting (match running or rematched).
        f.lobby.arcade = { get: () => ({ hasGuestSeat: async () => false, reserveGuestSeat: async () => false }) };
        const repeat = await f.accept(code);
        expect(repeat.status).toBe(200);
        expect((await repeat.json()).sid).toBe(first.sid);
    });
});

describe('steer item 2: rematch is broadcast and never stalls on an absent seat', () => {
    it('[CONTRACT] the table broadcasts {t:"rematch",matchId} to every connected seat', async () => {
        const f = tableFixture(), id = await f.seatInvitedGuest();
        await f.finish(id);
        await f.send(f.guest, 'rematch', { id });
        await f.send(f.host, 'rematch', { id });
        const matchId = f.board(f.host).id;
        expect(matchId).not.toBe(id);
        for (const socket of [f.host, f.guest]) {
            expect(socket.frames).toContainEqual(expect.objectContaining({ t: 'rematch', matchId }));
        }
    });

    it('[CONTRACT] a rematch proceeds while the other seat is disconnected', async () => {
        // Today a two-seat rematch waits for a vote from every occupied seat, so an absent seat stalls it.
        const f = tableFixture(), id = await f.seatInvitedGuest();
        await f.finish(id);
        f.guest.readyState = 3; // the guest's socket is gone; its seat stays rostered
        await f.send(f.host, 'rematch', { id });
        const next = f.board(f.host);
        expect(next.id).not.toBe(id);
        expect(next.waiting).toBe(false);
        expect(f.host.frames).toContainEqual(expect.objectContaining({ t: 'rematch', matchId: next.id }));
        // The absent player returns to the new match in its rostered seat.
        const back = f.connect(guestActor);
        await f.send(back, 'sync');
        expect(f.board(back)).toMatchObject({ id: next.id, seat: expect.any(String) });
        expect(f.errors(back)).toEqual([]);
    });
});

describe('steer item 3: reconnect renders from the server snapshot', () => {
    it('[PIN] a reconnecting seated guest is sent the open match, not an empty table', async () => {
        const f = tableFixture(), id = await f.seatInvitedGuest();
        const again = f.connect(guestActor);
        await f.send(again, 'sync');
        expect(f.board(again)).toMatchObject({ id, seat: 'b', waiting: false });
        expect(f.board(again).match).toBeTruthy();
    });

    it('[CONTRACT] a reconnect is answered with {seq,phase,currentMatchId,yourSeat,turn}', async () => {
        const f = tableFixture(), id = await f.seatInvitedGuest();
        const again = f.connect(guestActor);
        await f.send(again, 'sync');
        const snapshot = lastSnapshot(again);
        expect(snapshot, 'no frame carried the snapshot fields').toBeTruthy();
        expect(Number.isInteger(snapshot.seq)).toBe(true);
        expect(snapshot.phase).not.toBe('lobby');
        expect(snapshot).toMatchObject({ currentMatchId: id, yourSeat: 'b', turn: 'w' });
    });

    it('[CONTRACT] the snapshot says phase=lobby with no currentMatchId only before a table is open', async () => {
        const f = tableFixture();
        await f.send(f.guest, 'sync');
        expect(lastSnapshot(f.guest)).toMatchObject({ phase: 'lobby', currentMatchId: null, yourSeat: null });
        await f.send(f.host, 'open');
        const { id } = f.board(f.host);
        expect(lastSnapshot(f.guest).currentMatchId).toBe(id);
    });

    it('[CONTRACT] snapshot seq increases with every change so a client can drop stale frames', async () => {
        const f = tableFixture(), id = await f.seatInvitedGuest();
        const before = lastSnapshot(f.guest)?.seq;
        await f.send(f.host, 'move', { id, revision: 0, move: 'e2e4' });
        const after = lastSnapshot(f.guest);
        expect(Number.isInteger(before)).toBe(true);
        expect(after.seq).toBeGreaterThan(before);
        expect(after.turn).toBe('b');
    });
});

describe('steer item 4: guest lifetimes are separate from the invite TTL', () => {
    it('[PIN] the demo invite TTL is 72 hours', () => {
        expect(DEMO_INVITE_TTL).toBe(72 * HOUR);
    });

    it('[CONTRACT] exports a 4h sliding idle and a 16h absolute guest lifetime', () => {
        // Proposed export names on game-night-invitations.mjs: GUEST_IDLE_TTL, GUEST_ABSOLUTE_TTL.
        expect(invitations.GUEST_IDLE_TTL).toBe(4 * HOUR);
        expect(invitations.GUEST_ABSOLUTE_TTL).toBe(16 * HOUR);
        expect(new Set([invitations.GUEST_IDLE_TTL, invitations.GUEST_ABSOLUTE_TTL, DEMO_INVITE_TTL]).size).toBe(3);
    });

    it.each([['ordinary', false], ['demo', true]])('[CONTRACT] an accepted %s invite yields idle (now+4h) and absolute (now+16h) expiries',
        async (_label, demo) => {
            vi.useFakeTimers();
            const f = invitationFixture();
            const { code } = await f.issue(demo);
            const now = Date.now();
            const response = await f.accept(code);
            expect(response.status).toBe(200);
            // Field names are left to the implementation; the two instants are the contract.
            const instants = Object.values(await response.json()).filter(Number.isFinite);
            expect(instants).toContain(now + 4 * HOUR);
            expect(instants).toContain(now + 16 * HOUR);
        });

    it('[CONTRACT] a guest who accepts just before the invite lapses is not cut off at the invite TTL', async () => {
        // Today exp = min(now + 2h, invite until) for demo invites. This also supersedes the existing
        // "caps a late guest session" expectation in game-night-invitations.test.js.
        vi.useFakeTimers();
        const f = invitationFixture();
        const demo = await f.issue(true);
        vi.setSystemTime(demo.until - 1000);
        const now = Date.now();
        const response = await f.accept(demo.code);
        expect(response.status).toBe(200);
        const { exp } = await response.json();
        expect(exp).toBeGreaterThan(demo.until);
        expect(exp).toBeLessThanOrEqual(now + 16 * HOUR);
    });

    it('[CONTRACT] guest idle time slides with activity but never past the absolute lifetime', () => {
        // Proposed pure helper on game-night-invitations.mjs:
        //   guestPassExpiry({ acceptedAt, lastSeenAt }) -> epoch ms at which the pass ends.
        const { guestPassExpiry } = invitations;
        expect(guestPassExpiry, 'CONTRACT NOT IMPLEMENTED: guestPassExpiry').toBeTypeOf('function');
        const acceptedAt = 1_000_000;
        expect(guestPassExpiry({ acceptedAt, lastSeenAt: acceptedAt })).toBe(acceptedAt + 4 * HOUR);
        expect(guestPassExpiry({ acceptedAt, lastSeenAt: acceptedAt + 3 * HOUR })).toBe(acceptedAt + 7 * HOUR);
        expect(guestPassExpiry({ acceptedAt, lastSeenAt: acceptedAt + 15 * HOUR })).toBe(acceptedAt + 16 * HOUR);
    });
});

describe('steer item 5: the server returns inviteExpiresAt with invites', () => {
    it.each([['ordinary', false], ['demo', true]])('[CONTRACT] issuing an %s invite returns inviteExpiresAt', async (_label, demo) => {
        vi.useFakeTimers();
        const f = invitationFixture();
        const issued = await f.issue(demo);
        expect(Number.isFinite(issued.inviteExpiresAt)).toBe(true);
        expect(issued.inviteExpiresAt).toBeGreaterThan(Date.now());
        // The stored record is the single source: the returned instant is the one the server enforces.
        const [record] = [...f.rows.values()];
        expect(issued.inviteExpiresAt).toBe(record.until);
    });

    it('[CONTRACT] invitation details return the same inviteExpiresAt to the guest page', async () => {
        vi.useFakeTimers();
        const f = invitationFixture();
        const issued = await f.issue(false);
        const response = await f.details(issued.code);
        expect(response.status).toBe(200);
        const [record] = [...f.rows.values()];
        expect((await response.json()).inviteExpiresAt).toBe(record.until);
    });

    it('[PIN] an invite stops working exactly at the instant the server reported', async () => {
        vi.useFakeTimers();
        const f = invitationFixture();
        const issued = await f.issue(false);
        const reported = issued.inviteExpiresAt ?? issued.until;
        vi.setSystemTime(reported - 1);
        expect((await f.details(issued.code)).status).toBe(200);
        vi.setSystemTime(reported);
        expect((await f.details(issued.code)).status).toBe(410);
    });
});

describe('steer item 6: newest socket per player wins', () => {
    // Node's Response refuses status 101, so the upgrade path gets a minimal stand-in.
    class UpgradeResponse {
        constructor(body, init = {}) { this.body = body; this.status = init.status ?? 200; this.webSocket = init.webSocket; }
        get ok() { return this.status >= 200 && this.status < 300; }
        async json() { return JSON.parse(this.body); }
    }
    function socketFixture() {
        const f = tableFixture();
        vi.stubGlobal('Response', UpgradeResponse);
        vi.stubGlobal('WebSocketPair', class { constructor() { this[0] = {}; this[1] = f.fakeSocket(null); } });
        async function open(actor) {
            const { betaSid, betaInviteVersion } = f.actors.get(actor);
            const session = { betaSid, betaInviteVersion };
            const grant = await f.transport.issue({ actor, room, ref }, session);
            expect(grant.status).toBe(200);
            const { ticket } = await grant.json();
            const before = new Set(f.connections);
            const response = await f.transport.upgrade(`${ARCADE_PROTOCOL}, ${ticket}`, session);
            expect(response.status).toBe(101);
            return f.connections.find(socket => !before.has(socket));
        }
        return { ...f, open };
    }

    it('[PIN] a second connection for the same player closes the older one', async () => {
        const f = socketFixture();
        const older = await f.open(guestActor);
        const newer = await f.open(guestActor);
        expect(older.close).toHaveBeenCalledWith(4409, expect.any(String));
        expect(newer.close).not.toHaveBeenCalled();
        expect(newer.frames).toContainEqual(expect.objectContaining({ t: 'match-ready' }));
    });

    it('[PIN] frames from the replaced socket are ignored', async () => {
        const f = socketFixture();
        const hostSocket = await f.open(hostActor);
        await f.send(hostSocket, 'open');
        const { id } = f.board(hostSocket);
        const older = await f.open(guestActor);
        const newer = await f.open(guestActor);
        // A replaced socket whose native close has not landed yet can still deliver a queued frame.
        older.readyState = 1;
        const writes = f.storage.put.mock.calls.length, seen = older.frames.length;
        await f.send(older, 'join', { id });
        expect(f.storage.put.mock.calls).toHaveLength(writes);
        expect(older.frames).toHaveLength(seen);
        expect(f.board(hostSocket)).toMatchObject({ id, waiting: true });
        await f.send(newer, 'join', { id });
        expect(f.board(newer)).toMatchObject({ id, seat: 'b', waiting: false });
    });

    it('[CONTRACT] the newest socket wins per player, even from a second lobby connection', async () => {
        // Today replacement is keyed by lobby actor id, so one player (one session id) with two
        // lobby connections keeps two live match sockets.
        const f = socketFixture();
        const secondActor = 'c' + '4'.repeat(32);
        f.bind(secondActor, guestSid, false);
        const older = await f.open(guestActor);
        const newer = await f.open(secondActor);
        expect(older.close).toHaveBeenCalledWith(4409, expect.any(String));
        expect(newer.close).not.toHaveBeenCalled();
    });
});
