// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createAiReviewPersistenceSink } from './helpers/ai-review-persistence.mjs';

describe('AI-review test persistence sink', () => {
    it('deep snapshots every review emission including empty deletion/expiry state', () => {
        const writes = []; const sink = createAiReviewPersistenceSink(writes);
        const entry = { id: 'm1', categories: ['harassment'], nested: { note: 'original' } };
        expect(sink.persist('ai-reviews', [entry])).toBe(1);
        entry.categories.push('changed'); entry.nested.note = 'changed';
        expect(sink.persist('ai-reviews', [])).toBe(2);
        expect(writes).toEqual([
            ['ai-reviews', [{ id: 'm1', categories: ['harassment'], nested: { note: 'original' } }]],
            ['ai-reviews', []]
        ]);
        expect(sink.counts.get('ai-reviews')).toBe(2);
    });
    it('counts unrelated keys without reading or retaining their payloads and preserves call ordinals', () => {
        const writes = []; const sink = createAiReviewPersistenceSink(writes);
        const payload = new Proxy({}, { get() { throw new Error('unrelated payload inspected'); } });
        expect(sink.persist('sessions', payload)).toBe(1);
        expect(sink.persist('net', payload)).toBe(2);
        expect(sink.persist('sessions', payload)).toBe(3);
        expect(sink.persist('ai-reviews', [])).toBe(4);
        expect([...sink.counts]).toEqual([['sessions', 2], ['net', 1], ['ai-reviews', 1]]);
        expect(writes).toEqual([['ai-reviews', []]]);
        expect(Object.keys(sink).sort()).toEqual(['counts', 'persist']);
    });
    it('propagates review clone errors without adding a partial write or advancing successful counts', () => {
        const writes = []; const sink = createAiReviewPersistenceSink(writes);
        expect(() => sink.persist('ai-reviews', [() => {}])).toThrow();
        expect(writes).toEqual([]); expect([...sink.counts]).toEqual([]);
        expect(sink.persist('ai-reviews', [])).toBe(1);
    });
});
