import { describe, expect, it } from 'vitest';
const {
    DEFAULT_TEST_PORT,
    resolveTestPort,
    testBaseURL
} = require('../../scripts/lib/e2e-test-server.cjs');

describe('e2e test port', () => {
    it('defaults to 4320 so it does not collide with Rad Dad’s 4317', () => {
        expect(DEFAULT_TEST_PORT).toBe(4320);
        expect(resolveTestPort({})).toBe(4320);
        expect(testBaseURL({})).toBe('http://127.0.0.1:4320');
    });

    it('accepts STALEMATE_TEST_PORT when it is a safe listening port', () => {
        expect(resolveTestPort({ STALEMATE_TEST_PORT: '4321' })).toBe(4321);
    });

    it('fails closed on a non-integer or privileged port', () => {
        expect(() => resolveTestPort({ STALEMATE_TEST_PORT: '80' })).toThrow(/1024/);
        expect(() => resolveTestPort({ STALEMATE_TEST_PORT: 'nope' })).toThrow(/integer/);
    });
});
