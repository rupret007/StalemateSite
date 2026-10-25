// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAiModerator } from '../../hangout-worker/src/ai-moderation.mjs';
afterEach(() => vi.useRealTimers());
describe('participation provider dispatch boundary', () => {
    it.each([false, undefined, 'true', {}, null])('requires exact true from a supplied pre-dispatch guard (%j)', async result => {
        const fetchImpl = vi.fn(), moderator = createAiModerator({ enabled: true, apiKey: 'synthetic-only', fetchImpl });
        expect(await moderator.review({ text: 'Benign synthetic fixture', beforeDispatch: async () => result })).toMatchObject({ status: 'unavailable' });
        expect(fetchImpl).not.toHaveBeenCalled(); expect(moderator.status().used).toBe(1);
    });
    it.each(['guard', 'fence'])('does not let a late %s start a request after the overall timeout', async kind => {
        vi.useFakeTimers(); let entered, release;
        const inside = new Promise(resolve => { entered = resolve; }), held = new Promise(resolve => { release = resolve; });
        const fetchImpl = vi.fn(), moderator = createAiModerator({ enabled: true, apiKey: 'synthetic-only', fetchImpl, timeoutMs: 20 });
        const boundary = kind === 'guard' ? { beforeDispatch: async () => { entered(); await held; return true; } }
            : { startDispatch: async start => { entered(); await held; return start(); } };
        const pending = moderator.review({ text: 'Benign late fixture', ...boundary }); await inside;
        await vi.advanceTimersByTimeAsync(21); expect(await pending).toMatchObject({ status: 'unavailable' });
        release(); await vi.runAllTimersAsync(); expect(fetchImpl).not.toHaveBeenCalled(); expect(moderator.status()).toMatchObject({ used: 1, pending: 0 });
    });
});
