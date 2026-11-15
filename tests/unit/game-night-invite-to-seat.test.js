// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
const client = vi.hoisted(() => ({ options: null }));
vi.mock('../../r/45662413410ed051/lobby/game-night-match-client.mjs', async original => ({
    ...await original(),
    createGameNightMatchClient: options => {
        client.options = options;
        return { start() {}, stop() {}, matchOpen: () => false, matchUnavailable: () => false, send: () => true };
    }
}));
vi.mock('../../r/45662413410ed051/lobby/game-night-audio.mjs', () => ({ gameNightCue: () => {} }));
import { gameInvitationRequest } from '../../hangout-worker/src/game-night-invitations.mjs';
import { GameNightTurdSpades } from '../../hangout-worker/src/game-night-turdspades.mjs';
import { mountArcadeTurdSpades } from '../../r/45662413410ed051/lobby/arcade-turdspades.mjs';

const host = 'host-session-aaaa';
const match = '11111111-1111-4111-8111-111111111111';
const room = '#game-1acbefx23acbe';
const ref = 'c'.repeat(32);
const passHash = 'b'.repeat(64);

function invitationLobby() {
    const rows = new Map();
    const table = {
        watchTableId: async scope => scope.tableId || match,
        guestTableId: async (_scope, id) => id,
        guestNightEndsAt: async () => Date.now() + 60_000,
        reserveGuestSeat: async (_scope, sid, _until, key, record) => {
            rows.set(key, record);
            return true;
        }
    };
    return {
        rows,
        lobby: {
            env: { HANGOUT_BETA_MODE: 'protected', HANGOUT_GAME_NIGHT_GUESTS: '1' },
            state: { storage: {
                get: async key => rows.get(key),
                list: async ({ prefix }) => new Map([...rows].filter(([key]) => key.startsWith(prefix))),
                put: async (key, record) => {
                    if (typeof key === 'string') rows.set(key, record);
                    else for (const [entry, value] of Object.entries(key)) rows.set(entry, value);
                },
                delete: async keys => keys.forEach(key => rows.delete(key))
            } },
            controlBudget: { take: async () => true },
            arcadeAvailable: game => game === 'turdspades',
            arcadeBinding: () => ({ betaSid: host, nick: 'Host', betaInviteVersion: '1', canOpen: true, canPlay: true }),
            sessionActive: async () => true,
            engine: { invitedGameHost: () => 'c' + 'a'.repeat(32) },
            arcade: new Map([['turdspades', table]])
        }
    };
}

function mountWatcherStatus() {
    const container = document.createElement('div');
    document.body.append(container);
    const view = mountArcadeTurdSpades(container, () => {});
    view.setRoom({ room, ref, actor: 'c' + 'a'.repeat(32) });
    return { container, view };
}

it('admits a fresh invitee to the room and gives a seated guest only their own Spades hand', async () => {
    const { lobby } = invitationLobby();
    const issue = await gameInvitationRequest(lobby, 'issue', {
        actor: 'c' + 'a'.repeat(32), room, ref, game: 'turdspades', match
    }, { betaSid: host });
    const { code } = await issue.json();
    const attempt = 'd'.repeat(32);
    const accepted = await gameInvitationRequest(lobby, 'accept', { code, age13: true, attempt, passHash });
    expect(accepted.status).toBe(200);
    const guest = await accepted.json();
    expect(guest.scope).toMatchObject({ room, ref, game: 'turdspades', match, host });

    const table = new GameNightTurdSpades(match, host);
    expect(table.join('north-player', match, 0, 'north')).toBe(true);
    expect(table.join('east-player', match, 0, 'east')).toBe(true);
    expect(table.join(guest.sid, match, 0, 'next')).toBe(true);
    const guestView = table.view(guest.sid), hostView = table.view(host);
    expect(guestView.seat).toBe('west');
    expect(guestView.match.hand).toHaveLength(13);
    expect(hostView.match.hand).toHaveLength(13);
    expect(guestView.match.hand).not.toEqual(hostView.match.hand);
    expect(table.view('other-phone').match.hand).toEqual([]);
});

it('keeps a fifth phone watching a full table with no hand and next-hand watcher copy', async () => {
    const { lobby } = invitationLobby();
    const issued = await gameInvitationRequest(lobby, 'issue', {
        actor: 'c' + 'a'.repeat(32), room, ref, game: 'turdspades', match, watch: true
    }, { betaSid: host });
    expect(issued.status).toBe(200);
    const { code } = await issued.json();
    const admitted = await gameInvitationRequest(lobby, 'accept', {
        code, age13: true, attempt: 'd'.repeat(32), passHash
    });
    expect(admitted.status).toBe(200);
    const guest = await admitted.json();
    expect(guest.scope).toMatchObject({ watch: true, tableId: match });

    const table = new GameNightTurdSpades(match, host);
    for (const [sid, seat] of [['west-player', 'west'], ['north-player', 'north'], ['east-player', 'east']]) {
        expect(table.join(sid, match, 0, seat)).toBe(true);
    }
    const watcher = table.view(guest.sid);
    expect(watcher.seat).toBeNull();
    expect(watcher.match.hand).toEqual([]);
    expect(watcher.match).not.toHaveProperty('hands');

    const { container } = mountWatcherStatus();
    try {
        const state = { version: 1, game: 'turdspades', id: match, tableId: match, seat: null,
            waiting: true, match: null, occupied: ['south', 'west', 'north', 'east'], watchOnly: true };
        client.options.onState({ state, canOpen: false });
        const status = container.querySelector('[data-spades-status]');
        expect(status).toBeTruthy();
        expect(status.textContent).toContain('Stay here to watch when the next hand starts.');
    } finally {
        container.remove();
    }
});

it('asks for a fresh link when an invitation is expired or already redeemed on another phone', async () => {
    vi.useFakeTimers();
    try {
        const { lobby } = invitationLobby();
        const issueInvite = async () => {
            const response = await gameInvitationRequest(lobby, 'issue', {
                actor: 'c' + 'a'.repeat(32), room, ref, game: 'turdspades', match
            }, { betaSid: host });
            return response.json();
        };
        const attempt = 'e'.repeat(32);
        const expired = await issueInvite();
        vi.setSystemTime(expired.until);
        const dead = await gameInvitationRequest(lobby, 'accept', { code: expired.code, age13: true, attempt, passHash });
        expect(dead.status).toBe(410);
        expect((await dead.json()).error).toBe('This invite is no longer available. Ask your host for a new one.');

        vi.setSystemTime(expired.until - 60_000);
        const reused = await issueInvite();
        expect((await gameInvitationRequest(lobby, 'accept', { code: reused.code, age13: true, attempt, passHash })).status).toBe(200);
        const secondPhone = await gameInvitationRequest(lobby, 'accept', {
            code: reused.code, age13: true, attempt: 'f'.repeat(32), passHash
        });
        expect(secondPhone.status).toBe(410);
        expect((await secondPhone.json()).error).toBe('This invite is no longer available. Ask your host for a new one.');
    } finally {
        vi.useRealTimers();
    }
});
