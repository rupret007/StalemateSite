import { describe, expect, it } from 'vitest';
import { TABLE_FULL_COPY } from '../../hangout-worker/src/game-night-room-grants.mjs';

describe('game night room grant full table copy', () => {
    it('tells guests they are waiting for the next open seat', () => {
        expect(TABLE_FULL_COPY).toBe('Table full. You’re in line for the next open seat.');
    });
});
