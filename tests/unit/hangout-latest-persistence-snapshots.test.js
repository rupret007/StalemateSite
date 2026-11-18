// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createLatestPersistenceSnapshots } from './helpers/latest-persistence-snapshots.mjs';

describe('bounded test persistence snapshots', () => {
    it('clones every kind, preserves prior snapshots from mutation and latest empty removals', () => {
        const writes = []; const persist = createLatestPersistenceSnapshots(writes);
        const value = { receipts: [{ id: 'first' }] };
        expect(persist('sessions', value)).toBe(1);
        const first = writes[0][1]; value.receipts[0].id = 'second';
        expect(first.receipts[0].id).toBe('first');
        expect(persist('sessions', value)).toBe(2);
        expect(writes).toHaveLength(1); expect(first.receipts[0].id).toBe('first');
        expect(writes[0][1].receipts[0].id).toBe('second');
        const other = { reports: ['original'] }; persist('moderation-queue', other);
        other.reports.push('later'); expect(writes[1][1].reports).toEqual(['original']);
        persist('sessions', { receipts: [] }); expect(writes[0][1].receipts).toEqual([]);
        expect(writes).toHaveLength(2);
    });
    it('preserves clone errors for existing and new kinds before changing snapshots or ordinals', () => {
        const writes = []; const persist = createLatestPersistenceSnapshots(writes);
        expect(persist('sessions', { n: 1 })).toBe(1);
        for (const key of ['sessions', 'new-kind']) expect(() => persist(key, { bad() {} })).toThrow();
        expect(writes).toEqual([['sessions', { n: 1 }]]);
        expect(persist('new-kind', { n: 2 })).toBe(2);
        expect(persist('sessions', { n: 3 })).toBe(3);
        expect(writes).toHaveLength(2);
    });
    it('bounds retained history by distinct keys while preserving synchronous reads', () => {
        const writes = []; const persist = createLatestPersistenceSnapshots(writes); let reads = 0;
        for (let n = 0; n < 1003; n++) {
            expect(persist('sessions', { get n() { reads++; return n; } })).toBe(n + 1);
        }
        expect(reads).toBe(1003); expect(writes).toEqual([['sessions', { n: 1002 }]]);
    });
});
