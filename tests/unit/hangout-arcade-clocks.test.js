import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEMO_INVITE_TTL } from '../../hangout-worker/src/beta-auth.mjs';
import { GAME_NIGHT_IDLE } from '../../hangout-worker/src/game-night-lifetime.mjs';

describe('Game Night operator clocks', () => {
    it('states a 72 hour ordinary invite and a guest session of 4 hours idle or night end', () => {
        expect(DEMO_INVITE_TTL).toBe(72 * 60 * 60_000);
        expect(GAME_NIGHT_IDLE).toBe(4 * 60 * 60_000);
        const doc = readFileSync('hangout-internal/HANGOUT_ARCADE_MULTIPLAYER.md', 'utf8');
        const review = doc.split('\n')[8];
        expect(review).toContain('An ordinary game link admits one guest and expires after 72 hours.');
        expect(review).toContain('until the guest has been idle for 4 hours or the night ends');
        expect(doc).not.toContain('expires after 20 minutes');
        expect(doc).not.toContain('up to two hours');
    });
});
