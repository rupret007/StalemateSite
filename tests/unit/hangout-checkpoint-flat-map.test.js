// @vitest-environment node
// Frozen comparison fixture is byte-identical to 9c25bce checkpoint source.
import { afterEach, expect, it, vi } from 'vitest';
import { createParticipationCheckpoint as baseline } from './fixtures/participation-checkpoint-9c25-baseline.mjs';
import { createParticipationCheckpoint as candidate } from '../../hangout-worker/src/participation-checkpoint.mjs';
afterEach(() => vi.restoreAllMocks());
for (const [name, make] of [['baseline', baseline], ['candidate', candidate]]) {
    it(`${name}: restores Map edge keys, cycles, aliases and insertion order in place`, () => {
        vi.spyOn(performance, 'now').mockReturnValue(0);
        const key = { nested: { n: 1 } }, value = { n: 2 }, map = new Map();
        map.set(undefined, null); map.set(null, undefined); map.set(NaN, -0); map.set(-0, NaN);
        map.set(key, value); map.set(map, map); map.set(value, key);
        const set = new Set([key, value, map]); const roots = { map, key, value, set, empty: new Map() };
        const entries = [...map]; const cp = make(roots);
        map.delete(null); map.set(null, 9); map.set(key, {}); map.delete(undefined); map.set('new', 4);
        key.nested.n = 8; value.n = 9; set.clear(); roots.empty.set('new', 1);
        expect(cp.restore()).toBe(true);
        expect([...map.keys()]).toEqual(entries.map(([k]) => k));
        for (const [k, v] of entries) expect(map.get(k)).toBe(v);
        expect(map.get(map)).toBe(map); expect(map.get(value)).toBe(key);
        expect(key.nested.n).toBe(1); expect(value.n).toBe(2);
        expect([...set]).toEqual([key, value, map]); expect(roots.empty.size).toBe(0);
        expect(cp.restore()).toBe(false);
    });
    it(`${name}: preflight failure preserves changed graph and consumes one-shot restore`, () => {
        vi.spyOn(performance, 'now').mockReturnValue(0);
        const key = { n: 1 }, map = new Map([[key, { n: 2 }]]), roots = { map, key };
        const cp = make(roots); map.set('later', 3); key.n = 4; Object.freeze(key);
        expect(() => cp.restore()).toThrow();
        expect(map.has('later')).toBe(true); expect(key.n).toBe(4); expect(cp.restore()).toBe(false);
    });
    it(`${name}: restores prototype mutation with original Map identity`, () => {
        vi.spyOn(performance, 'now').mockReturnValue(0);
        const map = new Map([[null, undefined]]), roots = { map };
        const cp = make(roots); Object.setPrototypeOf(map, {});
        expect(cp.restore()).toBe(true); expect(Object.getPrototypeOf(map)).toBe(Map.prototype);
        expect(map.has(null)).toBe(true); expect(map.get(null)).toBeUndefined();
    });
}
function trace(make, expireAt = Infinity) {
    let calls = 0; const clock = [];
    vi.spyOn(performance, 'now').mockImplementation(() => { const value = ++calls >= expireAt ? 51 : 0; clock.push(value); return value; });
    const key = { v: 1 }, map = new Map([[null, undefined], [key, key]]); map.set(map, key);
    const roots = { map, key, alias: new Set([map, key]) };
    const result = { clock, metrics: null, captureError: null, restoreError: null, second: null };
    let cp;
    try { cp = make(roots); result.metrics = cp.metrics; } catch (error) { result.captureError = error.message; }
    if (cp) {
        key.v = 9; map.clear(); map.set('changed', null);
        try { result.restored = cp.restore(); } catch (error) { result.restoreError = error.message; }
        result.second = cp.restore();
    }
    result.graph = { keyValue: key.v, size: map.size, hasSelf: map.has(map), hasKey: map.has(key), hasChanged: map.has('changed'), keyAlias: map.get(key) === key };
    vi.restoreAllMocks(); return result;
}
it('preserves exact logical metrics, capture/restore clock cadence and every deterministic expiry boundary', () => {
    const reference = trace(baseline); expect(trace(candidate)).toEqual(reference);
    expect(reference.captureError).toBeNull(); expect(reference.restoreError).toBeNull();
    for (let expireAt = 2; expireAt <= reference.clock.length + 1; expireAt++) {
        expect(trace(candidate, expireAt), `expiry at clock call ${expireAt}`).toEqual(trace(baseline, expireAt));
    }
});
it('preserves exact byte/node limits independently of flat private storage size', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const graph = () => new Map([[undefined, null], [NaN, 2], ['edge', 3]]);
    const old = baseline(graph()).metrics, next = candidate(graph()).metrics;
    expect(next).toEqual(old);
    for (const make of [baseline, candidate]) {
        expect(make(graph(), { maxBytes: old.bytes, maxNodes: old.nodes }).metrics).toEqual({ ...old, maxBytes: old.bytes, maxNodes: old.nodes });
        expect(() => make(graph(), { maxBytes: old.bytes - 1 })).toThrow('Participation checkpoint limit exceeded');
        expect(() => make(graph(), { maxNodes: old.nodes - 1 })).toThrow('Participation checkpoint limit exceeded');
    }
});
