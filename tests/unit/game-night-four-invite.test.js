// @vitest-environment node
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createLobby } from '../../hangout-worker/src/lobby-core.mjs';
import { gameInvitationRequest } from '../../hangout-worker/src/game-night-invitations.mjs';
import { gameNightInvite, gameNightLabels } from '../../r/45662413410ed051/lobby/game-night.mjs';

const MATCH = '11111111-1111-4111-8111-111111111111';
const ROOM = '#game-1acbefx23acbe';
const REF = 'ab'.repeat(16);
const ACTOR = `c${'a'.repeat(32)}`;
const HOST_SID = 'host-session-aaaa';

describe('Four invite identity', () => {
    it('names Four and accepts only a real match id', () => {
        expect(gameNightLabels.four).toBe('Four in a Row');
        expect(gameNightInvite('four', MATCH)).toEqual({ game: 'four', match: MATCH });
        expect(gameNightInvite('four', 'not-a-match')).toBeNull();
        expect(gameNightInvite('missing', MATCH)).toBeNull();
        expect(gameNightInvite('chess', MATCH)).toEqual({ game: 'chess', match: MATCH });
    });
});

describe('Four guest seat on the room', () => {
    let clock, lobby, inbox;
    beforeEach(() => {
        clock = 1_800_000_000_000;
        inbox = new Map();
        lobby = createLobby({
            gameNight: true,
            now: () => clock,
            send: (id, message) => { if (!inbox.has(id)) inbox.set(id, []); inbox.get(id).push(message); },
            close: () => {}
        });
    });
    const notices = id => (inbox.get(id) || []).filter(message => message.t === 'notice' || message.t === 'denied').map(message => message.text).join('\n');
    const four = id => (inbox.get(id) || []).findLast(message => message.t === 'four' && message.ch === ROOM)?.game;
    function connect(id, nick, extra) {
        expect(lobby.connect({ id, dev: `dev-${id}`, iph: `ip-${id}`, role: 'fan', ...extra }).ok).toBe(true);
        return lobby.message(id, JSON.stringify({ t: 'hello', nick, age13: true }));
    }
    function play(id, args, ref) {
        clock += 2000;
        return lobby.message(id, JSON.stringify({ t: 'cmd', name: 'four', args, ch: ROOM, roomInstance: ref }));
    }

    it('lets an invited Four guest take the open seat and drop, and keeps other guests off the board', async () => {
        await connect('host', 'FourHost', { betaSid: HOST_SID });
        await lobby.message('host', JSON.stringify({ t: 'cmd', name: 'join', args: [ROOM], ch: '#stalemate' }));
        const ref = (inbox.get('host') || []).findLast(message => message.t === 'join').ch.keepRef;
        expect(lobby.fourGuestSeat({ room: ROOM, ref, match: 'wrong', host: HOST_SID })).toBe(false);
        await play('host', ['open'], ref);
        const id = four('host').id;
        expect(lobby.fourGuestSeat({ room: ROOM, ref, match: id, host: HOST_SID })).toBe(true);
        expect(lobby.fourGuestSeat({ room: ROOM, ref, match: id, host: 'someone-else-here' })).toBe(false);

        const chessGuest = 'chess-guest';
        expect(lobby.connect({ id: chessGuest, dev: 'dev-chess', iph: 'ip-chess', role: 'fan', betaSid: 'chess-guest-session',
            gameGuest: { room: ROOM, ref, host: HOST_SID, nameSeed: 1200, game: 'chess', match: id } }).ok).toBe(true);
        await lobby.message(chessGuest, JSON.stringify({ t: 'hello', nick: 'Ignored', age13: true }));
        await play(chessGuest, ['join', id], ref);
        expect(notices(chessGuest)).toContain('This invitation is for playing and chatting');
        expect(four('host').guest).toBe('');

        const guest = 'four-guest';
        expect(lobby.connect({ id: guest, dev: 'dev-four', iph: 'ip-four', role: 'fan', betaSid: 'four-guest-session',
            gameGuest: { room: ROOM, ref, host: HOST_SID, nameSeed: 2400, game: 'four', match: id } }).ok).toBe(true);
        await lobby.message(guest, JSON.stringify({ t: 'hello', nick: 'Ignored', age13: true }));
        await play(guest, ['join', id], ref);
        expect(four(guest)).toMatchObject({ id, guest, moves: 0 });
        expect(lobby.fourGuestSeat({ room: ROOM, ref, match: id, host: HOST_SID })).toBe(false);
        await play('host', ['drop', id, '0', '1'], ref);
        await play(guest, ['drop', id, '1', '2'], ref);
        expect(four(guest)).toMatchObject({ moves: 2, lastColumn: 1, guest });
        expect(four(guest).board.filter(Boolean)).toEqual(['X', 'O']);
        for (let revision = 2; revision < 7; revision++) {
            const next = revision % 2 ? guest : 'host';
            await play(next, ['drop', id, String(revision), next === guest ? '2' : '1'], ref);
        }
        expect(four(guest).winner).toBe('X');
        await play(guest, ['rematch', id], ref);
        expect(four('host').rematch).toBe('O');
        await play('host', ['rematch', id], ref);
        expect(four(guest)).toMatchObject({ id, guest, moves: 0, round: 1 });
        await play('host', ['drop', id, '0', '1'], ref);
        expect(four(guest).moves).toBe(0);
        await play('host', ['drop', id, '0', '1', '1'], ref);
        expect(four(guest).moves).toBe(1);
        await lobby.disconnect(guest);
        expect(inbox.get('host').findLast(message => message.t === 'four')).toMatchObject({ game: null, ended: 'guest-disconnected' });
    });
});

describe('Four invitation issue', () => {
    function lobbyFor(seatOpen) {
        const rows = new Map();
        const calls = [];
        const lobby = {
            env: { HANGOUT_BETA_MODE: 'protected', HANGOUT_OPEN: '1', HANGOUT_GAME_NIGHT_GUESTS: '1', HANGOUT_BETA_INVITE_VERSION: '1' },
            state: { storage: {
                list: async () => rows,
                delete: async keys => { for (const key of keys) rows.delete(key); },
                put: async (key, value) => { rows.set(key, value); },
                get: async key => rows.get(key)
            } },
            controlBudget: { take: async () => true },
            sessionActive: async () => true,
            arcadeBinding: () => ({ betaSid: HOST_SID, betaInviteVersion: '1', canOpen: true, canPlay: true, gameGuest: false, nick: 'FourHost', socket: {} }),
            arcadeAvailable: name => name === 'chess',
            arcade: { get(name) {
                calls.push(name);
                if (name === 'four') throw new Error('Four is not an arcade table');
                return { hasGuestSeat: async () => false };
            } },
            engine: {
                fourGuestSeat: () => seatOpen,
                invitedGameHost: () => ACTOR
            }
        };
        return { lobby, calls };
    }

    it('issues, describes and accepts an open Four seat without the arcade transport', async () => {
        const { lobby, calls } = lobbyFor(true);
        const issued = await gameInvitationRequest(lobby, 'issue', {
            actor: ACTOR, room: ROOM, ref: REF, game: 'four', match: MATCH
        }, { betaSid: HOST_SID });
        expect(issued.status).toBe(200);
        const { code } = await issued.json();
        expect(code).toMatch(/^[a-f0-9]{32}$/);
        expect(calls).toEqual([]);
        const details = await gameInvitationRequest(lobby, 'details', { code }, null);
        expect(details.status).toBe(200);
        expect(await details.json()).toEqual({ game: 'Four in a Row', host: 'FourHost' });
        const accepted = await gameInvitationRequest(lobby, 'accept', { code, age13: true, attempt: 'c'.repeat(32) }, null);
        expect(accepted.status).toBe(200);
        expect((await accepted.json()).scope).toMatchObject({ game: 'four', match: MATCH, room: ROOM, host: HOST_SID });
        const again = await gameInvitationRequest(lobby, 'accept', { code, age13: true, attempt: 'd'.repeat(32) }, null);
        expect(again.status).toBe(410);
    });

    it('expires demo game links after 72 hours and caps a late guest session', async () => {
        const { lobby } = lobbyFor(true);
        const now = Date.now();
        vi.useFakeTimers();
        try {
            vi.setSystemTime(now);
            const payload = { actor: ACTOR, room: ROOM, ref: REF, game: 'four', match: MATCH };
            const issue = async demo => (await gameInvitationRequest(lobby, 'issue', payload, { betaSid: HOST_SID, demo })).json();
            const ordinary = await issue(false);
            const demo = await issue(true);
            expect(ordinary.until - now).toBe(20 * 60_000);
            expect(demo.until - now).toBe(72 * 60 * 60_000);
            vi.setSystemTime(demo.until - 1000);
            const accepted = await gameInvitationRequest(lobby, 'accept', { code: demo.code, age13: true, attempt: 'e'.repeat(32) }, null);
            expect(accepted.status).toBe(200);
            expect((await accepted.json()).exp).toBe(demo.until);
            vi.setSystemTime(demo.until);
            expect((await gameInvitationRequest(lobby, 'details', { code: demo.code }, null)).status).toBe(410);
        } finally { vi.useRealTimers(); }
    });

    it('refuses a Four invite when the seat is taken and still checks Chess on its own table', async () => {
        const closed = lobbyFor(false);
        const denied = await gameInvitationRequest(closed.lobby, 'issue', {
            actor: ACTOR, room: ROOM, ref: REF, game: 'four', match: MATCH
        }, { betaSid: HOST_SID });
        expect(denied.status).toBe(403);
        expect(closed.calls).toEqual([]);
        const chess = lobbyFor(true);
        const chessDenied = await gameInvitationRequest(chess.lobby, 'issue', {
            actor: ACTOR, room: ROOM, ref: REF, game: 'chess', match: MATCH
        }, { betaSid: HOST_SID });
        expect(chessDenied.status).toBe(403);
        expect(chess.calls).toEqual(['chess']);
    });
});
