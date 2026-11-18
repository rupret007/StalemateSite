// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { createAiReviewPersistenceSink } from './helpers/ai-review-persistence.mjs';
import { createLatestPersistenceSnapshots } from './helpers/latest-persistence-snapshots.mjs';
function fixture(name, mode, override) {
    const source = readFileSync(new URL(name, import.meta.url), 'utf8');
    const start = source.indexOf('function boot('), end = source.indexOf('\nfunction guest(', start);
    if (start < 0 || end <= start) throw Error('Missing actual fixture boundaries');
    const env = mode === undefined ? {} : { DOT_SUPPLEMENTAL_PERSISTENCE: mode };
    const ai = name.includes('ai-review');
    return new Function('createLobby', 'process', 'createAiReviewPersistenceSink', 'createLatestPersistenceSnapshots', 'override',
        'let clock,now,engine,requests,frames,writes,seq;\n' + source.slice(start, end) +
        '\nboot(' + (ai ? '(override ? { persist: override } : {})' : 'override') + '); return { persist:engine.persist,writes };')
        (options => options, { env }, createAiReviewPersistenceSink, createLatestPersistenceSnapshots, override);
}
for (const file of ['hangout-ai-review-engine.test.js', 'hangout-report-receipts.test.js']) describe(file + ' actual persistence mode', () => {
    for (const mode of [undefined, '', '0', 'true', 'other']) it('preserves original all-write semantics for ' + String(mode), () => {
        const { persist, writes } = fixture(file, mode);
        const value = { nested: ['first'] };
        expect(persist('sessions', value)).toBe(1); value.nested[0] = 'second';
        expect(persist('sessions', value)).toBe(2);
        expect(writes).toEqual([['sessions', { nested: ['first'] }], ['sessions', { nested: ['second'] }]]);
        expect(() => persist('unrelated', { bad() {} })).toThrow();
        expect(writes).toHaveLength(2); expect(persist('third', {})).toBe(3);
    });
    it('uses supplemental behavior only for literal1', () => {
        const { persist, writes } = fixture(file, '1');
        expect(persist('sessions', { n: 1 })).toBe(1); expect(persist('sessions', { n: 2 })).toBe(2);
        expect(writes).toEqual(file.includes('ai-review') ? [] : [['sessions', { n: 2 }]]);
    });
    for (const mode of [undefined, '1']) it('retains explicit custom persistence override for ' + String(mode), () => {
        const custom = () => 17; expect(fixture(file, mode, custom).persist).toBe(custom);
    });
});
