// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { GAME_INVITE_UNAVAILABLE, gameInvitationRequest } from '../../hangout-worker/src/game-night-invitations.mjs';

it('refuses expired and already-used demo invites with only the fresh-link ask', async () => {
    vi.useFakeTimers();
    try {
        const now = Date.now();
        const host = 'host-session-aaaa';
        const rows = new Map();
        const reserveGuestSeat = vi.fn(async (_scope, _sid, _until, key, record) => {
            rows.set(key, record);
            return true;
        });
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
            arcadeBinding: () => ({ betaSid: host, betaInviteVersion: '1', canOpen: true, canPlay: true, nick: 'Host' }),
            sessionActive: async () => true,
            engine: { invitedGameHost: () => 'c' + 'a'.repeat(32) },
            arcade: { get: () => ({
                hasGuestSeat: async () => true,
                guestTableId: async (_scope, match) => match,
                guestNightEndsAt: async () => now + 60_000,
                reserveGuestSeat
            }) }
        };
        const issue = async exp => (await gameInvitationRequest(lobby, 'issue', {
            actor: 'c' + 'a'.repeat(32), room: '#game-1acbefx23acbe', ref: 'c'.repeat(32),
            game: 'chess', match: '11111111-1111-4111-8111-111111111111'
        }, { betaSid: host, demo: true, exp })).json();
        const attempt = 'e'.repeat(32);
        const refuse = async response => {
            expect(response.status).toBe(410);
            const body = await response.json();
            expect(body).toEqual({ error: GAME_INVITE_UNAVAILABLE });
            expect(body.error).toBe('This invite is no longer available. Ask your host for a new one.');
            for (const field of ['seat', 'seats', 'hand', 'hands', 'roster', 'players']) expect(body).not.toHaveProperty(field);
        };

        const expired = await issue(now + 30_000);
        vi.setSystemTime(expired.until);
        await refuse(await gameInvitationRequest(lobby, 'accept', { code: expired.code, age13: true, attempt }));
        expect(reserveGuestSeat).not.toHaveBeenCalled();

        await refuse(await gameInvitationRequest(lobby, 'issue', {
            actor: 'c' + 'a'.repeat(32), room: '#game-1acbefx23acbe', ref: 'c'.repeat(32),
            game: 'chess', match: '11111111-1111-4111-8111-111111111111'
        }, { betaSid: host, demo: true, exp: expired.until }));

        const fresh = await issue(now + 60_000);
        expect(fresh.code).not.toBe(expired.code);
        const firstClaim = await gameInvitationRequest(lobby, 'accept', { code: fresh.code, age13: true, attempt });
        expect(firstClaim.status).toBe(200);
        const admitted = await firstClaim.json();
        expect(admitted).toEqual({ scope: expect.any(Object), sid: expect.any(String), exp: expect.any(Number) });
        for (const field of ['seat', 'seats', 'hand', 'hands', 'roster', 'players']) expect(admitted).not.toHaveProperty(field);
        expect(reserveGuestSeat).toHaveBeenCalledTimes(1);
        const retry = await gameInvitationRequest(lobby, 'accept', { code: fresh.code, age13: true, attempt });
        expect(retry.status).toBe(200);
        expect(await retry.json()).toEqual(admitted);
        expect(reserveGuestSeat).toHaveBeenCalledTimes(1);
    } finally {
        vi.useRealTimers();
    }
});
