// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { GAME_INVITE_UNAVAILABLE, gameGuestScope, gameInvitationRequest } from '../../hangout-worker/src/game-night-invitations.mjs';

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
            expect((await result.json()).error).toBe(GAME_INVITE_UNAVAILABLE);
        }
    }
});


it('expires demo Chess invites after 72 hours and caps a late guest session', async () => {
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
        const issue = async demo => (await gameInvitationRequest(lobby, 'issue', payload, { betaSid: host, demo })).json();
        const ordinary = await issue(false), demo = await issue(true);
        expect(ordinary.until - now).toBe(20 * 60_000);
        expect(demo.until - now).toBe(72 * 60 * 60_000);
        vi.setSystemTime(demo.until - 1000);
        const response = await gameInvitationRequest(lobby, 'accept', { code: demo.code, age13: true, attempt: 'e'.repeat(32) });
        expect(response.status).toBe(200);
        expect(accepted.exp).toBe(demo.until);
        vi.setSystemTime(demo.until);
        expect((await gameInvitationRequest(lobby, 'details', { code: demo.code })).status).toBe(410);
    } finally {
        vi.useRealTimers();
    }
});
