import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEMO_INVITE_TTL } from '../../hangout-worker/src/beta-auth.mjs';
import { GAME_NIGHT_IDLE, GAME_NIGHT_LENGTH } from '../../hangout-worker/src/game-night-lifetime.mjs';

describe('Game Night operator clocks', () => {
    it('states a 72 hour ordinary invite and a guest session of 4 hours idle or night end', () => {
        expect(DEMO_INVITE_TTL).toBe(72 * 60 * 60_000);
        expect(GAME_NIGHT_IDLE).toBe(4 * 60 * 60_000);
        const doc = readFileSync('hangout-internal/HANGOUT_ARCADE_MULTIPLAYER.md', 'utf8');
        expect(GAME_NIGHT_LENGTH).toBe(16 * 60 * 60_000);
        const review = doc.split('## Local Game Night review')[1]?.split('## Baseline and ownership')[0];
        expect(review).toContain('An ordinary game link admits one guest and expires after 72 hours.');
        expect(review).toContain('capped by the demo host session’s deadline');
        expect(review).toContain('four hours of inactivity or at the table’s 16-hour night deadline, whichever comes first');
        expect(doc).not.toContain('expires after 20 minutes');
        expect(doc).not.toContain('up to two hours');
    });
});
