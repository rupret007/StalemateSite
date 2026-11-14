// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { gameGuestScope, gameInvitationRequest } from '../../hangout-worker/src/game-night-invitations.mjs';

import { gameNightReturnHint, gameNightRoomName } from '../../r/45662413410ed051/lobby/game-night.mjs';

it('keeps a saved game only in a Game Night room', () => {
    const fields = { ref: 'a'.repeat(32), until: 2000 };
    const validRoom = room => gameNightRoomName(room) || room === '#general';
    const gameRoom = { ...fields, room: '#game-1acbefx23acbe', game: 'chess' };
    const lobbyRoom = { ...fields, room: '#general' };

    expect(gameNightReturnHint(gameRoom, validRoom, 1000)).toEqual(gameRoom);
    expect(gameNightReturnHint({ ...lobbyRoom, game: 'chess' }, validRoom, 1000)).toEqual(lobbyRoom);
});

it('closes legacy invitations for retired games, including previously accepted links', async () => {
    const code = 'a'.repeat(32);
    const attempt = 'b'.repeat(32);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(attempt));
    const redeemer = Buffer.from(digest).toString('hex');
    const scope = {
        game: 'four', match: '11111111-1111-4111-8111-111111111111',
        room: '#game-1acbefx23acbe', ref: 'c'.repeat(32), host: 'host-session-aaaa', nameSeed: 1
    };
    const invitation = { scope, until: Date.now() + 60000, version: '1' };
    const env = { HANGOUT_BETA_MODE: 'protected', HANGOUT_GAME_NIGHT_GUESTS: '1' };

    expect(gameGuestScope(scope)).toBeNull();
    expect(gameGuestScope({ ...scope, game: 'chess' })).toMatchObject({ game: 'chess' });
    for (const record of [invitation, { ...invitation, redeemer }]) {
        const lobby = { env, state: { storage: { get: async () => record } } };
        for (const [operation, body] of [['details', { code }], ['accept', { code, age13: true, attempt }]]) {
            const result = await gameInvitationRequest(lobby, operation, body);
            expect(result.status).toBe(410);
            expect((await result.json()).error).toBe('This invite is no longer available. Ask your host for a new one.');
        }
    }
});


it('caps demo Chess links and admitted guests at the demo host session deadline', async () => {
    vi.useFakeTimers();
    try {
        const now = Date.now();
        const host = 'host-session-aaaa';
        const rows = new Map();
        let accepted;
        const lobby = {
            env: { HANGOUT_BETA_MODE: 'protected', HANGOUT_GAME_NIGHT_GUESTS: '1' },
            state: { storage: {
                get: async key => rows.get(key),
                list: async () => rows,
                put: async (key, record) => rows.set(key, record)
            } },
            controlBudget: { take: async () => true },
            arcadeAvailable: game => game === 'chess',
            arcadeBinding: () => ({ betaSid: host, betaInviteVersion: '1', canOpen: true, canPlay: true }),
            sessionActive: async () => true,
            engine: { invitedGameHost: () => 'c' + 'a'.repeat(32) },
            arcade: { get: () => ({
                hasGuestSeat: async () => true,
                guestTableId: async (_scope, match) => match,
                guestNightEndsAt: async () => now + 16 * 60 * 60_000,
                reserveGuestSeat: async (_scope, _sid, _until, key, record) => {
                    rows.set(key, record);
                    accepted = record;
                    return true;
                }
            }) }
        };
        const payload = {
            actor: 'c' + 'a'.repeat(32), room: '#game-1acbefx23acbe', ref: 'c'.repeat(32),
            game: 'chess', match: '11111111-1111-4111-8111-111111111111'
        };
        const issue = async (demo, exp) => (await gameInvitationRequest(lobby, 'issue', payload, { betaSid: host, demo, exp })).json();
        const hostDeadline = now + 6 * 60 * 60_000;
        const ordinary = await issue(false), demo = await issue(true, hostDeadline);
        expect(ordinary.until - now).toBe(72 * 60 * 60_000);
        expect(demo.until).toBe(hostDeadline);
        const shortHostDeadline = now + 5000;
        const short = await issue(true, shortHostDeadline);
        expect(short.until).toBe(shortHostDeadline);
        const attempt = 'e'.repeat(32);
        const accept = code => gameInvitationRequest(lobby, 'accept', { code, age13: true, attempt });
        expect((await accept(demo.code)).status).toBe(200);
        expect(accepted.exp).toBe(hostDeadline);
        for (let count = 0; count < 6; count += 1) await issue(false);
        const limited = await gameInvitationRequest(lobby, 'issue', payload, { betaSid: host });
        expect(limited.status).toBe(429);
        expect((await limited.json()).error).toBe('Too many invitations are still on record. Share a current link for this game or try again later.');
        expect((await accept(ordinary.code)).status).toBe(200);
        const guestDeadline = accepted.exp;
        expect(guestDeadline - now).toBe(16 * 60 * 60_000);
        expect(guestDeadline).toBeLessThan(ordinary.until);
        vi.setSystemTime(shortHostDeadline - 1000);
        expect((await accept(short.code)).status).toBe(200);
        expect(accepted.exp).toBe(shortHostDeadline);
        vi.setSystemTime(shortHostDeadline);
        expect((await accept(short.code)).status).toBe(410);
        expect((await gameInvitationRequest(lobby, 'details', { code: short.code })).status).toBe(410);
        vi.setSystemTime(guestDeadline - 1);
        expect((await accept(ordinary.code)).status).toBe(200);
        vi.setSystemTime(guestDeadline);
        expect((await accept(ordinary.code)).status).toBe(410);
    } finally {
        vi.useRealTimers();
    }
});
