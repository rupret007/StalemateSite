// @vitest-environment node
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const H = require('../../r/45662413410ed051/sync-core.js');
const point = (index) => [index / 10000, index / 10000];
const points = (start, count) => Array.from({ length: count }, (_, index) => point(start + index));
const stroke = (id, pts, extra = {}) => ({ id, color: '#000000', size: 8, pts, ...extra });
const range = (state, id, offset, pts, extra = {}) => H.apply(state, { type: 'stroke', offset, stroke: stroke(id, pts, extra) });
const status = (state) => H.strokeRangeStatus(state);
const emptyRanges = { pendingStrokes: 0, pendingRanges: 0, pendingPoints: 0, exhausted: false, conflicted: false };

describe('absolute drawing ranges', () => {
    it('deduplicates absolute offsets and merges an overlapping live tail exactly once', () => {
        const state = H.emptyState();
        range(state, 'line', 0, points(0, 3));
        range(state, 'line', 0, points(0, 3));
        expect(state.strokes[0].pts).toEqual(points(0, 3));
        range(state, 'line', 2, points(2, 3));
        expect(state.strokes[0].pts).toEqual(points(0, 5));
        expect(range(state, 'line', 1, points(1, 3))).toBeNull();
        expect(state.strokes[0].pts).toEqual(points(0, 5));
        expect(status(state)).toEqual(emptyRanges);
    });

    it('keeps all 3200-point snapshot strokes while ordinary deltas stay capped at 400', () => {
        const state = H.emptyState();
        H.apply(state, { type: 'snapshot', state: { strokes: [stroke('long', points(0, 3200))] } });
        expect(state.strokes[0].pts).toHaveLength(3200);
        expect(state.strokes[0].pts.at(-1)).toEqual(point(3199));
        expect(H.cleanStroke(stroke('delta', points(0, 3200))).pts).toHaveLength(400);
        expect(H.cleanSnapshotStroke(stroke('snapshot', points(0, 3201))).pts).toHaveLength(3200);
        expect([stroke('one', points(0, 500)), stroke('two', points(0, 500))].map(H.cleanStroke).map((item) => item.pts.length)).toEqual([400, 400]);
    });

    it('preserves the legacy append contract when the top-level offset is absent', () => {
        const state = H.emptyState();
        const message = { type: 'stroke', stroke: stroke('legacy', points(0, 2)) };
        H.apply(state, message); H.apply(state, message);
        expect(state.strokes[0].pts).toEqual([...points(0, 2), ...points(0, 2)]);
        H.apply(state, { type: 'stroke', stroke: stroke('legacy', points(2, 1), { size: 12 }) });
        expect(state.strokes[0].pts).toHaveLength(5);
        expect(state.strokes[0].size).toBe(8);
        expect(status(state)).toEqual(emptyRanges);
    });

    it('does not expose an out-of-order stroke until its contiguous prefix arrives', () => {
        const state = H.emptyState();
        expect(range(state, 'gap', 2, points(2, 2))).toBeNull();
        expect(state.strokes).toEqual([]);
        expect(status(state)).toEqual({ ...emptyRanges, pendingStrokes: 1, pendingRanges: 1, pendingPoints: 2 });
        expect(range(state, 'gap', 0, points(0, 2))).toBe('draw');
        expect(state.strokes[0].pts).toEqual(points(0, 4));
        expect(status(state)).toEqual(emptyRanges);
    });

    it('keeps separated gaps invisible and drains only the contiguous prefix', () => {
        const state = H.emptyState();
        range(state, 'holes', 1, [point(1)]); range(state, 'holes', 3, [point(3)]);
        expect(status(state).pendingRanges).toBe(2);
        range(state, 'holes', 0, [point(0)]);
        expect(state.strokes[0].pts).toEqual(points(0, 2));
        expect(status(state)).toEqual({ ...emptyRanges, pendingStrokes: 1, pendingRanges: 1, pendingPoints: 1 });
        range(state, 'holes', 2, [point(2)]);
        expect(state.strokes[0].pts).toEqual(points(0, 4));
        expect(status(state)).toEqual(emptyRanges);
    });

    it('compares canonical wire coordinates without duplicating rounded overlaps', () => {
        const state = H.emptyState();
        range(state, 'canonical', 0, [[0.123456, 0.654321]]);
        range(state, 'canonical', 0, [[0.1235, 0.6543], [0.5, 0.5]]);
        expect(state.strokes[0].pts).toEqual([[0.1235, 0.6543], [0.5, 0.5]]);
        expect(status(state)).toEqual(emptyRanges);
    });

    it('rejects conflicting visible metadata and points before adding any new tail', () => {
        const state = H.emptyState(); range(state, 'line', 0, points(0, 2));
        const original = structuredClone(state.strokes);
        expect(range(state, 'line', 1, [point(99), point(2)])).toBeNull();
        expect(range(state, 'line', 2, [point(2)], { size: 9 })).toBeNull();
        expect(range(state, 'line', 2, [point(2)], { color: '#ffffff' })).toBeNull();
        expect(state.strokes).toEqual(original);
        expect(status(state)).toEqual({ ...emptyRanges, conflicted: true });
    });

    it('rejects conflicts with staged points atomically without consuming the pending gap', () => {
        const state = H.emptyState(); range(state, 'line', 2, points(2, 2));
        expect(range(state, 'line', 0, [point(0), point(1), point(99)])).toBeNull();
        expect(range(state, 'line', 0, points(0, 2), { size: 9 })).toBeNull();
        expect(state.strokes).toEqual([]);
        expect(status(state)).toEqual({ ...emptyRanges, pendingStrokes: 1, pendingRanges: 1, pendingPoints: 2, conflicted: true });
        range(state, 'line', 0, points(0, 2));
        expect(state.strokes[0].pts).toEqual(points(0, 4));
        expect(status(state).conflicted).toBe(true);
    });

    it('rejects malformed absolute positions and overlong ranges without changing activity', () => {
        const state = H.emptyState();
        for (const offset of [-1, 0.5, 3200, '0', null, undefined]) expect(range(state, 'invalid', offset, [point(0)])).toBeNull();
        expect(range(state, 'invalid', 3199, points(0, 2))).toBeNull();
        expect(range(state, 'invalid', 0, points(0, 401))).toBeNull();
        expect(range(state, 'invalid', 0, [[0, 0], [NaN, 1], [1, 1]])).toBeNull();
        expect(state.strokes).toEqual([]); expect(status(state)).toEqual(emptyRanges);
    });

    it('accepts the last absolute point at 3199 but never clips a crossing range', () => {
        const state = H.emptyState();
        H.apply(state, { type: 'snapshot', state: { strokes: [stroke('long', points(0, 3199))] } });
        expect(range(state, 'long', 3199, points(3199, 2))).toBeNull();
        expect(state.strokes[0].pts).toHaveLength(3199);
        range(state, 'long', 3199, [point(3199)]);
        expect(state.strokes[0].pts).toEqual(points(0, 3200));
        expect(range(state, 'long', 3199, [point(3199)])).toBeNull();
    });

    it('preserves a live tail after capture when an appended snapshot repeats its older prefix', () => {
        const state = H.emptyState();
        H.apply(state, { type: 'snapshot', state: { strokes: [stroke('line', points(0, 2))] } });
        range(state, 'line', 2, points(2, 2));
        H.apply(state, { type: 'snapshot', state: { append: true, strokes: [stroke('line', points(0, 2))] } });
        expect(state.strokes).toEqual([stroke('line', points(0, 4))]);
        range(state, 'line', 2, points(2, 2));
        expect(state.strokes[0].pts).toEqual(points(0, 4));
    });

    it('bridges pending points from a validated appended prefix without dropping another chunk gap', () => {
        const state = H.emptyState();
        range(state, 'one', 2, points(2, 2)); range(state, 'other', 3, points(3, 1));
        H.apply(state, { type: 'snapshot', state: { append: true, strokes: [stroke('one', points(0, 2))] } });
        expect(state.strokes).toEqual([stroke('one', points(0, 4))]);
        expect(status(state)).toEqual({ ...emptyRanges, pendingStrokes: 1, pendingRanges: 1, pendingPoints: 1 });
        H.apply(state, { type: 'snapshot', state: { append: true, strokes: [stroke('other', points(0, 3))] } });
        expect(state.strokes[1].pts).toEqual(points(0, 4)); expect(status(state)).toEqual(emptyRanges);
    });

    it('allows a matching legacy prefix to bridge an already staged absolute tail', () => {
        const state = H.emptyState(); range(state, 'mixed', 2, points(2, 2));
        H.apply(state, { type: 'stroke', stroke: stroke('mixed', points(0, 2)) });
        expect(state.strokes[0].pts).toEqual(points(0, 4)); expect(status(state)).toEqual(emptyRanges);
    });

    it('bounds unknown pending strokes and exposes exhaustion without showing holes', () => {
        const state = H.emptyState();
        for (let index = 0; index < H.LIMITS.strokeRangeStrokes; index += 1) range(state, 'gap-' + index, 1, [point(1)]);
        range(state, 'overflow', 1, [point(1)]);
        expect(state.strokes).toEqual([]);
        expect(status(state)).toEqual({ ...emptyRanges, pendingStrokes: H.LIMITS.strokeRangeStrokes,
            pendingRanges: H.LIMITS.strokeRangeStrokes, pendingPoints: H.LIMITS.strokeRangeStrokes, exhausted: true });
        H.resetStrokeRanges(state); expect(status(state)).toEqual(emptyRanges);
    });

    it('bounds disjoint pending ranges and does not charge duplicate ranges twice', () => {
        const state = H.emptyState();
        for (let index = 0; index < H.LIMITS.strokeRanges; index += 1) range(state, 'fragmented', index * 2 + 1, [point(index * 2 + 1)]);
        const before = status(state); range(state, 'fragmented', 1, [point(1)]);
        expect(status(state)).toEqual(before);
        range(state, 'fragmented', H.LIMITS.strokeRanges * 2 + 1, [point(H.LIMITS.strokeRanges * 2 + 1)]);
        expect(status(state)).toEqual({ ...before, exhausted: true });
        expect(state.strokes).toEqual([]);
    });

    it('bounds total staged points even when each stroke and range fits its own limit', () => {
        const state = H.emptyState(); let total = 0, index = 0;
        while (total < H.LIMITS.strokeRangePoints) {
            const count = Math.min(3199, H.LIMITS.strokeRangePoints - total);
            for (let offset = 1; offset <= count; offset += 400) range(state, 'points-' + index, offset, points(offset, Math.min(400, count - offset + 1)));
            total += count; index += 1;
        }
        expect(status(state).pendingPoints).toBe(H.LIMITS.strokeRangePoints);
        range(state, 'one-too-many', 1, [point(1)]);
        expect(status(state).pendingPoints).toBe(H.LIMITS.strokeRangePoints);
        expect(status(state).exhausted).toBe(true); expect(state.strokes).toEqual([]);
    });

    it('resets pending ranges and latches on clear/full replacement while preserving chat', () => {
        const state = H.emptyState();
        H.apply(state, { type: 'chat', name: 'Here', text: 'Received live' }, { t: 100 });
        range(state, 'line', 2, [point(2)]); range(state, 'line', 2, [point(99)]);
        expect(status(state).conflicted).toBe(true);
        H.apply(state, { type: 'clear' }); expect(status(state)).toEqual(emptyRanges);
        range(state, 'line', 2, [point(2)]);
        H.apply(state, { type: 'snapshot', state: { strokes: [stroke('replacement', [point(0)])], chat: [] } });
        expect(state.strokes).toEqual([stroke('replacement', [point(0)])]); expect(status(state)).toEqual(emptyRanges);
        expect(state.chat).toEqual([{ name: 'Here', text: 'Received live', t: 100 }]);
    });

    it('keeps range bookkeeping local to each state and out of serialized activity', () => {
        const first = H.emptyState(), second = H.emptyState();
        range(first, 'gap', 1, [point(1)]);
        expect(status(second)).toEqual(emptyRanges);
        expect(JSON.parse(JSON.stringify(first))).toEqual({ strokes: [], chat: [], video: null });
        const copy = status(first); copy.pendingPoints = 0;
        expect(status(first).pendingPoints).toBe(1);
    });
});
