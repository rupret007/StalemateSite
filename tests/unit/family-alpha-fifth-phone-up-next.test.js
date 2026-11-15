// @vitest-environment node
// Complements tests/e2e/family-alpha-gate.spec.js case 2: a fifth phone on a full
// four-player Spades table is queued as up-next, and an expired guest invite
// only offers the fresh-link ask without table or room secrets.
import { describe, expect, it, vi } from 'vitest';
import { ARCADE_TAG, createArcadeTransport } from '../../hangout-worker/src/arcade-transport.mjs';
import { DEMO_INVITE_TTL } from '../../hangout-worker/src/beta-auth.mjs';
import { GAME_INVITE_UNAVAILABLE, gameInvitationRequest } from '../../hangout-worker/src/game-night-invitations.mjs';
import { TABLE_FULL_COPY } from '../../hangout-worker/src/game-night-room-grants.mjs';

const room = '#game-2ca9e1x1be34a';
const ref = '0'.repeat(32);
const actorId = index => 'c' + String(index + 1).repeat(32);
const sidFor = index => 'seat-' + index;
const FOUR_PLAYER_SPADES = { label: 'four-player Spades', name: 'turdspades', seats: 4, open: {}, privateHands: true };

const SECRET_KEYS = ['room', 'ref', 'host', 'tableId', 'match', 'scope', 'sid', 'hand', 'hands', 'playable'];

function fixture(name, seats = 4) {
    const records = new Map(), actors = new Map(), connections = [];
    let now = 1000, matchCount = 0, alarm = null;
    const storage = {
        getAlarm: async () => alarm,
        setAlarm: async at => { alarm = at; },
        get: async key => structuredClone(records.get(key)),
        put: async (key, value) => {
            for (const [entry, record] of typeof key === 'string' ? [[key, value]] : Object.entries(key)) records.set(entry, structuredClone(record));
        },
        delete: async key => { for (const entry of [key].flat()) records.delete(entry); },
        list: async ({ prefix = '' } = {}) => new Map([...records].filter(([key]) => key.startsWith(prefix)))
    };
    function phone(index) {
        const id = actorId(index), betaSid = sidFor(index);
        if (!actors.has(id)) actors.set(id, { betaSid, betaInviteVersion: 1, canPlay: true, canOpen: index === 0,
            canJoin: subject => subject !== betaSid, canSee: () => true, isPresent: () => true });
        let attachment = { actor: id, betaSid, betaInviteVersion: 1, room, ref, kind: ARCADE_TAG + ':' + name };
        const socket = { frames: [], readyState: 1, serializeAttachment: data => { attachment = data; },
            deserializeAttachment: () => attachment, send(value) { this.frames.push(JSON.parse(value)); },
            close() { this.readyState = 3; } };
        connections.push(socket);
        return socket;
    }
    const transport = createArcadeTransport({ state: { storage, getWebSockets: () => connections }, name,
        now: () => now, uuid: () => 'c8eb7f10-e113-418f-9900-' + String(++matchCount).padStart(12, '0'),
        current: scope => actors.get(scope.actor), active: async () => true, approve: async () => true,
        charge: async () => true, allowed: () => true });
    const send = (socket, action, fields = {}) => transport.receive(socket, JSON.stringify({ version: 1, action, ...fields }));
    const hello = socket => transport.receive(socket, JSON.stringify({ version: 1, t: 'hello', lastSeq: 0 }));
    const last = socket => socket.frames.findLast(frame => frame.t === 'match-state' || frame.t === 'snapshot');
    const view = socket => last(socket)?.state;
    return { phone, send, hello, last, view, advance: ms => { now += ms; }, seats };
}

async function seatedFour() {
    const game = FOUR_PLAYER_SPADES;
    const f = fixture(game.name, game.seats);
    const phones = Array.from({ length: game.seats }, (_, index) => f.phone(index));
    for (const socket of phones) await f.hello(socket);
    await f.send(phones[0], 'open', game.open);
    const { id } = f.view(phones[0]);
    for (const socket of phones.slice(1)) await f.send(socket, 'join', { id, seat: 'next' });
    const seats = phones.map(socket => f.view(socket).seat);
    return { f, phones, id, seats, game };
}

function assertNoSecretLeak(body, label) {
    const text = JSON.stringify(body);
    for (const key of SECRET_KEYS) expect(body, label + ': top-level ' + key).not.toHaveProperty(key);
    expect(text, label).not.toMatch(/#game-[a-f0-9]{6}x[a-f0-9]{6}/);
    expect(text, label).not.toMatch(/"ref"\s*:/);
    expect(text, label).not.toMatch(/11111111-1111-4111-8111-111111111111/);
}

describe('family alpha fifth phone: full four-player Spades table', () => {
    it('locks the demo "you\'re up next game" copy the lobby surfaces when the table is full', () => {
        expect(TABLE_FULL_COPY).toBe("Table full, you're up next game");
        expect(TABLE_FULL_COPY).toMatch(/up next game/i);
    });

    it('queues a fifth connected phone as up-next without seating over a connected player', async () => {
        const { f, phones, id, seats } = await seatedFour();
        const fifth = f.phone(FOUR_PLAYER_SPADES.seats);
        await f.hello(fifth);
        expect(f.last(fifth)).toMatchObject({ t: 'snapshot', phase: 'playing', currentMatchId: id, yourSeat: null });
        expect(f.view(fifth)).toMatchObject({ seat: null, waiting: false, hasOpenSeat: false, upNext: true });
        expect(f.view(fifth).match).toBeTruthy();
        expect(phones.map(socket => f.view(socket).seat)).toEqual(seats);
        await f.send(fifth, 'join', { id, seat: 'next' });
        expect(fifth.frames.at(-1)).toEqual({ t: 'match-error', reason: 'seat-unavailable' });
        expect(phones.map(socket => f.view(socket).seat)).toEqual(seats);
        expect(f.view(fifth)).toMatchObject({ seat: null, upNext: true });
    });

    it('does not deal a private hand to the fifth phone while it waits up-next (#557/#560)', async () => {
        const { f, phones } = await seatedFour();
        const fifth = f.phone(FOUR_PLAYER_SPADES.seats);
        await f.hello(fifth);
        const seatedHands = phones.map(socket => f.view(socket).match.hand);
        expect(seatedHands.every(hand => hand?.length === 13)).toBe(true);
        expect(f.view(fifth).match.hand).toEqual([]);
        expect(Object.keys(f.view(fifth).match)).not.toContain('hands');
        const sent = JSON.stringify(fifth.frames);
        for (const hand of seatedHands) expect(sent).not.toContain(JSON.stringify(hand));
        expect(sent).not.toMatch(/"playable":/);
    });
});

describe('family alpha fifth phone: expired guest invite', () => {
    const demoRoom = '#game-1acbefx23acbe';
    const demoRef = 'c'.repeat(32);
    const demoMatch = '11111111-1111-4111-8111-111111111111';

    function invitations() {
        const host = 'host-session-aaaa', rows = new Map();
        const lobby = {
            env: { HANGOUT_BETA_MODE: 'protected', HANGOUT_GAME_NIGHT_GUESTS: '1' },
            state: { storage: {
                get: async key => rows.get(key), list: async () => rows,
                put: async (key, record) => rows.set(key, record), delete: async keys => { for (const key of [keys].flat()) rows.delete(key); }
            } },
            controlBudget: { take: async () => true },
            arcadeAvailable: () => true,
            arcadeBinding: () => ({ betaSid: host, betaInviteVersion: '1', canOpen: true, canPlay: true, nick: 'HostExample' }),
            sessionActive: async () => true,
            engine: { invitedGameHost: () => 'c' + 'a'.repeat(32) },
            arcade: { get: () => ({
                hasGuestSeat: async () => true,
                guestTableId: async (_scope, match) => match,
                guestNightEndsAt: async () => Date.now() + DEMO_INVITE_TTL,
                reserveGuestSeat: async (_scope, _sid, _until, key, record) => { rows.set(key, record); return true; }
            }) }
        };
        const issue = async game => (await gameInvitationRequest(lobby, 'issue', {
            actor: 'c' + 'a'.repeat(32), room: demoRoom, ref: demoRef, game, match: demoMatch
        }, { betaSid: host })).json();
        return { lobby, issue, rows };
    }

    it('answers with the fresh-link ask and leaks no table state or room secret', async () => {
        vi.useFakeTimers();
        try {
            const now = Date.now();
            const { lobby, issue, rows } = invitations();
            const first = await issue('turdspades');
            expect(first.until - now).toBe(DEMO_INVITE_TTL);
            const live = await gameInvitationRequest(lobby, 'details', { code: first.code });
            expect(live.status).toBe(200);
            const liveBody = await live.json();
            expect(liveBody.game).toBeTruthy();
            expect(liveBody.host).toBeTruthy();
            expect(liveBody).not.toHaveProperty('scope');
            expect(liveBody).not.toHaveProperty('room');
            const stored = [...rows.values()][0];
            expect(stored.scope.room).toBe(demoRoom);
            expect(stored.scope.ref).toBe(demoRef);
            vi.setSystemTime(first.until);
            for (const operation of ['details', 'accept']) {
                const body = operation === 'accept' ? { age13: true, attempt: 'e'.repeat(32) } : {};
                const closed = await gameInvitationRequest(lobby, operation, { code: first.code, ...body });
                expect(closed.status).toBe(410);
                const payload = await closed.json();
                expect(payload).toEqual({ error: GAME_INVITE_UNAVAILABLE });
                assertNoSecretLeak(payload, operation + ' after expiry');
            }
            expect(GAME_INVITE_UNAVAILABLE).toMatch(/ask your host for a new one/i);
            const fresh = await issue('turdspades');
            expect(fresh.code).not.toBe(first.code);
            expect((await gameInvitationRequest(lobby, 'details', { code: fresh.code })).status).toBe(200);
        } finally { vi.useRealTimers(); }
    });
});