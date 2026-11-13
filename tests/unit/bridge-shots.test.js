// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fieldLooksSecret } from '../e2e/support/bridge-shots.mjs';

describe('bridge screenshot field blanking', () => {
    it('blanks a signed invitation or url-safe token, not only a long hex run', () => {
        expect(fieldLooksSecret('abcdabcdabcdabcd')).toBe(true);
        const signed = `${'z'.repeat(24)}.${'Z'.repeat(43)}`;
        expect(/[a-f0-9]{16,}/i.test(signed)).toBe(false);
        expect(fieldLooksSecret(signed)).toBe(true);
        const token = 'test-value-1-'.padEnd(43, 'z');
        expect(/[a-f0-9]{16,}/i.test(token)).toBe(false);
        expect(fieldLooksSecret(token)).toBe(true);
        expect(fieldLooksSecret('Open a ten-minute match')).toBe(false);
        expect(fieldLooksSecret('')).toBe(false);
        expect(fieldLooksSecret('guest@example.com')).toBe(false);
    });
});
