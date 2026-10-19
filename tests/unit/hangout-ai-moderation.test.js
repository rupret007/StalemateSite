// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AI_CATEGORIES, createAiModerator, parseModerationResult } from '../../hangout-worker/src/ai-moderation.mjs';

const body = (flags = []) => ({ model: 'omni-moderation-latest', results: [{ flagged: !!flags.length,
    categories: Object.fromEntries(AI_CATEGORIES.map((key) => [key, flags.includes(key)])),
    category_scores: Object.fromEntries(AI_CATEGORIES.map((key) => [key, flags.includes(key) ? 0.8 : 0.01])) }] });
const response = (flags = []) => new Response(JSON.stringify(body(flags)));
afterEach(() => vi.useRealTimers());

describe('server-only AI moderation adapter', () => {
    it('does not contact a provider when disabled or missing a secret', async () => {
        const fetchImpl = vi.fn();
        const off = createAiModerator({ apiKey: 'test', fetchImpl });
        expect(await off.review({ text: 'Hello' })).toMatchObject({ reason: 'disabled' });
        const missing = createAiModerator({ enabled: true, fetchImpl });
        expect(await missing.review({ text: 'Hello' })).toMatchObject({ reason: 'not-configured' });
        expect(missing.status().state).toBe('misconfigured');
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('sends only text to a fixed endpoint after a durable reservation and validates the result', async () => {
        const events = [];
        const fetchImpl = vi.fn(async () => { events.push('fetch'); return response(['harassment']); });
        const moderator = createAiModerator({ enabled: true, apiKey: 'test-only-secret', fetchImpl,
            saveUsage: async (usage) => { events.push(usage.used); } });
        const result = await moderator.review({ id: 'private-id', text: 'Some public text', nick: 'PrivateNick', ch: '#private-name' });
        expect(events).toEqual([1, 'fetch']);
        const [url, options] = fetchImpl.mock.calls[0];
        expect(url).toBe('https://api.openai.com/v1/moderations');
        expect(options.redirect).toBe('manual');
        expect(JSON.parse(options.body)).toEqual({ model: 'omni-moderation-latest', input: 'Some public text' });
        expect(result).toMatchObject({ status: 'reviewed', flagged: true, categories: ['harassment'] });
        expect(moderator.status()).toMatchObject({ checked: 1, flagged: 1, used: 1, pending: 0 });
        expect(JSON.stringify(moderator.status())).not.toContain('test-only-secret');
    });

    it('refuses provider redirects without forwarding the API key or treating them as reviewed', async () => {
        const fetchImpl = vi.fn(async (_url, options) => {
            // Match Workers, where redirect:error throws before a network call.
            if (options.redirect === 'error') throw new TypeError('Unsupported redirect mode');
            return new Response('private provider diagnostic', { status: 307, headers: { Location: 'https://untrusted.example/collect' } });
        });
        const moderator = createAiModerator({ enabled: true, apiKey: 'test-only-secret', fetchImpl });
        expect(await moderator.review({ text: 'Synthetic public text' })).toEqual({ status: 'unavailable', reason: 'review-failed' });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(fetchImpl.mock.calls[0][1].redirect).toBe('manual');
        expect(moderator.status()).toMatchObject({ used: 1, checked: 0, failed: 1 });
        expect(JSON.stringify(moderator.status())).not.toContain('private provider diagnostic');
    });

    it('rejects malformed classifier results instead of treating them as safe', () => {
        for (const value of [null, {}, { ...body(), results: [] }, { ...body(), model: '<script>' }]) expect(parseModerationResult(value)).toBeNull();
        const partial = body(); delete partial.results[0].categories.hate;
        expect(parseModerationResult(partial)).toBeNull();
        const badScore = body(); badScore.results[0].category_scores.hate = Infinity;
        expect(parseModerationResult(badScore)).toBeNull();
        const mismatch = body(['hate']); mismatch.results[0].flagged = false;
        expect(parseModerationResult(mismatch)).toBeNull();
        expect(parseModerationResult(body())).toMatchObject({ status: 'reviewed', flagged: false });
    });

    it('bounds concurrent work without queuing unlimited chat text', async () => {
        let finish;
        const fetchImpl = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
        const moderator = createAiModerator({ enabled: true, apiKey: 'test', fetchImpl, maxConcurrent: 1 });
        const first = moderator.review({ text: 'one' });
        await Promise.resolve();
        expect(await moderator.review({ text: 'two' })).toMatchObject({ reason: 'busy' });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        finish(response()); await first;
        expect(moderator.status()).toMatchObject({ pending: 0, skipped: 1 });
    });

    it('keeps a daily cap across restored state and resets only on a later day', async () => {
        let time = Date.UTC(2026, 9, 18);
        const fetchImpl = vi.fn(async () => response());
        const moderator = createAiModerator({ enabled: true, apiKey: 'test', fetchImpl, dailyLimit: 2,
            now: () => time, usage: { day: '2026-10-18', used: 1 } });
        await moderator.review({ text: 'one' });
        expect(await moderator.review({ text: 'two' })).toMatchObject({ reason: 'daily-limit' });
        expect(moderator.status().state).toBe('capped');
        time += 86400000;
        await moderator.review({ text: 'next day' });
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(moderator.status().used).toBe(1);
        const malformed = createAiModerator({ enabled: true, apiKey: 'test', fetchImpl, usage: { used: 'bad' } });
        expect(malformed.status().state).toBe('capped');
    });

    it('treats timeout as unavailable and backs off while normal chat may continue', async () => {
        vi.useFakeTimers();
        const fetchImpl = vi.fn(() => new Promise(() => {}));
        const moderator = createAiModerator({ enabled: true, apiKey: 'test', fetchImpl, timeoutMs: 20 });
        const pending = moderator.review({ text: 'hello' });
        await vi.advanceTimersByTimeAsync(21);
        expect(await pending).toMatchObject({ status: 'unavailable', reason: 'review-failed' });
        expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true);
        expect(moderator.status()).toMatchObject({ state: 'degraded', pending: 0, failed: 1, checked: 0 });
        expect(await moderator.review({ text: 'again' })).toMatchObject({ reason: 'backoff' });
    });

    it('never sends text if quota persistence fails, and never exposes provider error bodies', async () => {
        const fetchImpl = vi.fn();
        const moderator = createAiModerator({ enabled: true, apiKey: 'test', fetchImpl,
            saveUsage: async () => { throw new Error('storage unavailable'); } });
        expect(await moderator.review({ text: 'hello' })).toMatchObject({ status: 'unavailable' });
        expect(fetchImpl).not.toHaveBeenCalled();
        const failed = createAiModerator({ enabled: true, apiKey: 'test',
            fetchImpl: async () => new Response('sensitive provider diagnostic', { status: 429 }) });
        expect(await failed.review({ text: 'hello' })).toEqual({ status: 'unavailable', reason: 'review-failed' });
    });

    it('times out stalled quota storage and never sends a late request after it recovers', async () => {
        vi.useFakeTimers();
        let release;
        const fetchImpl = vi.fn();
        const moderator = createAiModerator({ enabled: true, apiKey: 'test', fetchImpl, timeoutMs: 20,
            saveUsage: () => new Promise((resolve) => { release = resolve; }) });
        const pending = moderator.review({ text: 'hello' });
        await vi.advanceTimersByTimeAsync(21);
        expect(await pending).toMatchObject({ status: 'unavailable' });
        expect(moderator.status().pending).toBe(0);
        release(); await Promise.resolve();
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('cancels an oversized streamed response before accumulating the whole body', async () => {
        const cancel = vi.fn();
        let chunks = 0;
        const fetchImpl = async () => new Response(new ReadableStream({
            pull(controller) { chunks += 1; controller.enqueue(new Uint8Array(20000)); }, cancel
        }));
        const moderator = createAiModerator({ enabled: true, apiKey: 'test', fetchImpl });
        expect(await moderator.review({ text: 'hello' })).toMatchObject({ status: 'unavailable' });
        expect(cancel).toHaveBeenCalled();
        expect(chunks).toBeLessThan(5);
    });

    it('does not send oversized or non-text input', async () => {
        const fetchImpl = vi.fn();
        const moderator = createAiModerator({ enabled: true, apiKey: 'test', fetchImpl });
        for (const text of ['', ' ', 'x'.repeat(301), { image: 'url' }]) await moderator.review({ text });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('an older success cannot erase a newer failure backoff', async () => {
        let resolveFirst;
        const fetchImpl = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
            .mockResolvedValueOnce(new Response('', { status: 429 }));
        const moderator = createAiModerator({ enabled: true, apiKey: 'test', fetchImpl });
        const first = moderator.review({ text: 'one' });
        await Promise.resolve();
        await moderator.review({ text: 'two' });
        resolveFirst(response()); await first;
        expect(moderator.status()).toMatchObject({ state: 'degraded', checked: 1, failed: 1 });
        expect(await moderator.review({ text: 'three' })).toMatchObject({ reason: 'backoff' });
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });
});
