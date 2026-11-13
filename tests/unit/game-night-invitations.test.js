// @vitest-environment node
import { expect, it } from 'vitest';
import { gameGuestScope, gameInvitationRequest } from '../../hangout-worker/src/game-night-invitations.mjs';

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
            expect((await result.json()).error).toContain('Ask your host for a new invite.');
        }
    }
});
