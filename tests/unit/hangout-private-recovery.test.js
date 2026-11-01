// @vitest-environment node
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const H = require('../../r/45662413410ed051/sync-core.js');
const R = require('../../r/45662413410ed051/private-recovery.js');
const point = index => [index / 10000, index / 10000];
const points = (start, count) => Array.from({ length: count }, (_, i) => point(start + i));
const stroke = (id, pts, extra = {}) => ({ id, color: '#000000', size: 8, pts, ...extra });
const delta = (id, offset, pts, epoch = 0, extra = {}) => ({ type: 'stroke', offset, epoch, stroke: stroke(id, pts, extra) });
// These fixtures represent the caller-verified boundary, not a signature verifier.
const signed = (kind, seq, extra = {}) => ({ type: 'host', body: { kind, seq, ...extra }, sig: 'verified_fixture' });
const clear = seq => signed('clear', seq);
const lock = (seq, on = true) => signed('lock', seq, { on });
const spot = (seq, target = 'peer_1') => signed('spot', seq, { target });
const video = (seq, id = 'BtnyqIHTDMM', extra = {}) => ({ signed: signed('video', seq,
    { source: { kind: 'yt', id }, playing: true, pos: 21, t: seq * 1000, ...extra }), t: seq * 1000 });
const snapshot = (extra = {}) => ({ seq: 0, epoch: 0, clear: null, strokes: [], video: null, mods: [], ...extra });
const current = (extra = {}) => ({ state: H.emptyState(), lastVideoSigned: null, lastClearSigned: null,
    mods: { lock: null, spot: null }, lastHostSeq: 0, drawingEpoch: 0, ...extra });
const journal = () => R.createJournal({ H });
const candidate = (j, snap = snapshot(), state = current()) => {
    const result = j.merge(snap, state);
    expect(result.ok, result.error).toBe(true);
    return result.candidate;
};

describe('atomic private activity recovery journal', () => {
    it('replays a post-capture tail once, including exact duplicates and agreeing overlaps', () => {
        const j = journal();
        const first = delta('line', 2, points(2, 3));
        expect(j.recordStroke(first)).toBe(true);
        const before = j.status();
        expect(j.recordStroke(structuredClone(first))).toBe(true);
        expect(j.status()).toEqual(before);
        expect(j.recordStroke(delta('line', 4, points(4, 3)))).toBe(true);
        const result = candidate(j, snapshot({ strokes: [stroke('line', points(0, 3))] }));
        expect(result.state.strokes).toEqual([stroke('line', points(0, 7))]);
        expect(H.strokeRangeStatus(result.state).pendingPoints).toBe(0);
    });

    it('resolves an out-of-order gap only when a contiguous prefix is available', () => {
        const j = journal(), live = current();
        expect(j.recordStroke(delta('line', 2, points(2, 2)))).toBe(true);
        const original = structuredClone(live);
        expect(j.merge(snapshot(), live)).toEqual({ ok: false, error: 'unresolved-stroke-gap' });
        expect(live).toEqual(original);
        expect(j.status().ok).toBe(true);
        expect(j.recordStroke(delta('line', 0, points(0, 2)))).toBe(true);
        expect(candidate(j, snapshot(), live).state.strokes).toEqual([stroke('line', points(0, 4))]);
    });

    it('preserves canvas layer order when one stroke tail precedes another stroke prefix', () => {
        const j = journal(), live = H.emptyState();
        for (const msg of [delta('later-visible', 1, [point(1)]), delta('first-visible', 0, [point(0)]),
            delta('later-visible', 0, [point(0)])]) {
            j.recordStroke(msg); H.apply(live, msg);
        }
        expect(live.strokes.map(item => item.id)).toEqual(['first-visible', 'later-visible']);
        expect(candidate(j).state.strokes).toEqual(live.strokes);
    });

    it('merges full 3200-point snapshot strokes without clipping to a delta limit', () => {
        const j = journal();
        j.recordStroke(delta('long', 3199, [point(3199)]));
        const result = candidate(j, snapshot({ strokes: [stroke('long', points(0, 3200))] }));
        expect(result.state.strokes[0].pts).toHaveLength(3200);
        expect(result.state.strokes[0].pts.at(-1)).toEqual(point(3199));
        expect(j.merge(snapshot({ strokes: [stroke('too-long', points(0, 3201))] }), current()))
            .toEqual({ ok: false, error: 'invalid-snapshot' });
    });

    it('keeps live chat by reference and never imports a legacy snapshot backlog', () => {
        const live = current();
        live.state.chat.push({ name: 'Here', text: 'Received while connected', t: 123 });
        const result = candidate(journal(), snapshot({ chat: [{ text: 'Before joining' }] }), live);
        expect(result.state.chat).toBe(live.state.chat);
        expect(result.state.chat).toHaveLength(1);
        expect(result.state).not.toBe(live.state);
    });

    it('preserves the creator canvas when an empty newcomer supplies peer recovery', () => {
        const live = current({ preserveDrawing: true });
        live.state.strokes.push(stroke('known', points(0, 3)));
        live.state.chat.push({ text: 'Current connection' });
        const before = structuredClone(live);
        const result = candidate(journal(), snapshot(), live);
        expect(result.state.strokes).toEqual(before.state.strokes);
        expect(result.state.strokes).not.toBe(live.state.strokes);
        expect(result.state.chat).toBe(live.state.chat);
        result.state.strokes[0].pts[0][0] = 1;
        expect(live).toEqual(before);
    });

    it('keeps a longer known prefix and replays its live tail over a shorter peer copy', () => {
        const live = current({ preserveDrawing: true }), j = journal();
        live.state.strokes.push(stroke('line', points(0, 1000)));
        j.recordStroke(delta('line', 999, points(999, 102)));
        const result = candidate(j, snapshot({ strokes: [stroke('line', points(0, 450))] }), live);
        expect(result.state.strokes).toEqual([stroke('line', points(0, 1101))]);
    });

    it('extends a retained prefix from a full peer stroke and deduplicates the live overlap', () => {
        const live = current({ preserveDrawing: true }), j = journal();
        live.state.strokes.push(stroke('line', points(0, 450)));
        j.recordStroke(delta('line', 999, points(999, 102)));
        const result = candidate(j, snapshot({ strokes: [stroke('line', points(0, 1050))] }), live);
        expect(result.state.strokes).toEqual([stroke('line', points(0, 1101))]);
        expect(H.strokeRangeStatus(result.state).pendingPoints).toBe(0);
    });

    it('keeps known layer order and appends peer-only and live-only strokes once', () => {
        const live = current({ preserveDrawing: true }), j = journal();
        live.state.strokes.push(stroke('bottom', [point(0)]), stroke('known-only', [point(7)]), stroke('top', points(1, 2)));
        j.recordStroke(delta('live-only', 0, [point(9)]));
        const snap = snapshot({ strokes: [stroke('peer-only', [point(8)]),
            stroke('top', points(1, 3)), stroke('bottom', [point(0)])] });
        const before = structuredClone({ live, snap });
        const result = candidate(j, snap, live);
        expect(result.state.strokes).toEqual([stroke('bottom', [point(0)]), stroke('known-only', [point(7)]), stroke('top', points(1, 3)),
            stroke('peer-only', [point(8)]), stroke('live-only', [point(9)])]);
        expect({ live, snap }).toEqual(before);
    });

    it('replaces retained creator art after a higher verified clear epoch', () => {
        const live = current({ preserveDrawing: true, drawingEpoch: 4, lastClearSigned: clear(4), lastHostSeq: 4 });
        live.state.strokes.push(stroke('old', [point(0)]), stroke('shared', [point(99)]));
        const j = journal(); j.recordStroke(delta('shared', 1, [point(2)], 7));
        const result = candidate(j, snapshot({ seq: 7, epoch: 7, clear: clear(7),
            strokes: [stroke('shared', [point(1)])] }), live);
        expect(result.state.strokes).toEqual([stroke('shared', points(1, 2))]);
        expect(result.drawingEpoch).toBe(7);
        expect(result.lastClearSigned).toEqual(clear(7));
    });

    it('keeps fresh snapshot replacement unless drawing preservation is explicitly enabled', () => {
        for (const preserveDrawing of [undefined, false, 'true']) {
            const live = current({ preserveDrawing });
            live.state.strokes.push(stroke('old', [point(0)]));
            expect(candidate(journal(), snapshot({ strokes: [stroke('fresh', [point(1)])] }), live).state.strokes)
                .toEqual([stroke('fresh', [point(1)])]);
        }
    });

    it('fails conflicting retained and peer prefixes atomically, including stroke metadata', () => {
        for (const bad of [stroke('shared', [point(99)]), stroke('shared', [point(0)], { size: 9 })]) {
            const live = current({ preserveDrawing: true });
            live.state.strokes.push(stroke('known', [point(3)]), stroke('shared', points(0, 2)));
            const snap = snapshot({ strokes: [stroke('new-peer', [point(8)]), bad] });
            const before = structuredClone({ live, snap });
            expect(journal().merge(snap, live)).toEqual({ ok: false, error: 'drawing-conflict' });
            expect({ live, snap }).toEqual(before);
        }
    });

    it('fails a preserved canvas union above the stroke cap without evicting known art', () => {
        const live = current({ preserveDrawing: true });
        live.state.strokes = Array.from({ length: H.LIMITS.strokesKept }, (_, i) => stroke('known-' + i, [point(0)]));
        const before = structuredClone(live);
        expect(journal().merge(snapshot({ strokes: [stroke('extra', [point(1)])] }), live))
            .toEqual({ ok: false, error: 'drawing-exhausted' });
        expect(live).toEqual(before);
        const j = journal(); j.recordStroke(delta('extra', 0, [point(1)]));
        expect(j.merge(snapshot(), live)).toEqual({ ok: false, error: 'drawing-exhausted' });
        expect(live).toEqual(before);
    });

    it('uses a live post-capture clear epoch and replays only strokes after that clear', () => {
        const j = journal();
        j.recordStroke(delta('before-clear', 0, points(0, 2)));
        j.recordHost(clear(5));
        j.recordStroke(delta('after-clear', 0, points(5, 2), 5));
        const result = candidate(j, snapshot({ strokes: [stroke('captured-old', points(0, 2))] }));
        expect(result.drawingEpoch).toBe(5);
        expect(result.lastClearSigned).toEqual(clear(5));
        expect(result.state.strokes).toEqual([stroke('after-clear', points(5, 2))]);
        expect(result.lastHostSeq).toBe(5);
    });

    it('does not reapply an equal clear over the already captured post-clear canvas', () => {
        const j = journal(), proof = clear(5);
        j.recordHost(proof);
        j.recordStroke(delta('line', 2, points(2, 2), 5));
        const result = candidate(j, snapshot({ seq: 10, epoch: 5, clear: proof, strokes: [stroke('line', points(0, 2))] }),
            current({ drawingEpoch: 5, lastClearSigned: proof, lastHostSeq: 10 }));
        expect(result.state.strokes).toEqual([stroke('line', points(0, 4))]);
        expect(result.drawingEpoch).toBe(5);
        expect(result.lastHostSeq).toBe(10);
    });

    it('preserves the newer installed clear against an older capture without reviving old art', () => {
        const j = journal();
        j.recordStroke(delta('new-art', 0, points(0, 2), 12));
        const live = current({ drawingEpoch: 12, lastClearSigned: clear(12), lastHostSeq: 20 });
        const result = candidate(j, snapshot({ seq: 9, epoch: 5, clear: clear(5), strokes: [stroke('old-art', points(0, 2))] }), live);
        expect(result.state.strokes).toEqual([stroke('new-art', points(0, 2))]);
        expect(result.lastClearSigned).toEqual(clear(12));
        expect(result.lastHostSeq).toBe(20);
    });

    it('fails a future stroke epoch without an accepted signed clear proof', () => {
        const j = journal(); j.recordStroke(delta('future', 0, [point(0)], 8));
        expect(j.merge(snapshot(), current())).toEqual({ ok: false, error: 'unproved-epoch' });
    });

    it('keeps only the newest journal clear and excludes all earlier drawing epochs', () => {
        const j = journal();
        j.recordHost(clear(5)); j.recordStroke(delta('old', 0, [point(0)], 5));
        j.recordHost(clear(9)); j.recordStroke(delta('latest', 0, [point(1)], 9));
        const result = candidate(j);
        expect(result.state.strokes).toEqual([stroke('latest', [point(1)])]);
        expect(result.drawingEpoch).toBe(9);
        expect(j.status().ops).toBe(3);
    });

    it('restores a freshly attested persistent lock below the global sequence floor', () => {
        const result = candidate(journal(), snapshot({ seq: 40, mods: [lock(3), spot(4)] }),
            current({ lastHostSeq: 20, lastVideoSigned: video(20) }));
        expect(result.mods).toEqual({ lock: lock(3), spot: spot(4) });
        expect(result.lastVideoSigned).toEqual(video(20));
        expect(result.state.video).toEqual({ source: { kind: 'yt', id: 'BtnyqIHTDMM' }, playing: true, pos: 21, t: 20000 });
        expect(result.lastHostSeq).toBe(40);
    });

    it('selects each control domain independently instead of discarding old persistent controls', () => {
        const j = journal();
        const live = current({ lastHostSeq: 30, lastVideoSigned: video(29), mods: { lock: lock(7), spot: spot(8) } });
        j.recordHost(lock(7)); j.recordHost(video(29).signed, 29000);
        j.recordHost(spot(31, null));
        const result = candidate(j, snapshot({ seq: 25, video: video(24), mods: [lock(6, false), spot(9)] }), live);
        expect(result.lastVideoSigned).toEqual(video(29));
        expect(result.mods).toEqual({ lock: lock(7), spot: spot(31, null) });
        expect(result.lastHostSeq).toBe(31);
    });

    it('refuses uncorroborated old journal controls even when their signature was caller-verified', () => {
        for (const action of [lock(3), spot(3), video(3).signed, clear(3)]) {
            const j = journal(); expect(j.recordHost(action, 3000)).toBe(true);
            expect(j.merge(snapshot({ seq: 10 }), current({ lastHostSeq: 10 })))
                .toEqual({ ok: false, error: 'stale-journal-control' });
        }
    });

    it('allows an old journal domain only when current state or fresh attestation corroborates its body', () => {
        const j = journal(); j.recordHost(lock(3));
        const result = candidate(j, snapshot({ seq: 12, mods: [lock(3)] }), current({ lastHostSeq: 10 }));
        expect(result.mods.lock).toEqual(lock(3));
        expect(result.lastHostSeq).toBe(12);
    });

    it('uses signed video time rather than unsigned fallback and preserves signed body key order', () => {
        const ordered = { type: 'host', body: { pos: 11, source: { kind: 'file', id: 'manic' }, kind: 'video', t: 8000, seq: 8, playing: false }, sig: 'verified_fixture' };
        const j = journal(); j.recordHost(ordered, 9999);
        const result = candidate(j);
        expect(JSON.stringify(result.lastVideoSigned.signed.body)).toBe(JSON.stringify(ordered.body));
        expect(result.lastVideoSigned.t).toBe(8000);
        expect(result.state.video).toEqual({ source: { kind: 'file', id: 'manic' }, playing: false, pos: 11, t: 8000 });
    });

    it('supports a caller-verified legacy video timestamp without changing its signed body', () => {
        const old = video(5); delete old.signed.body.t;
        const j = journal(); j.recordHost(old.signed, 1234);
        expect(candidate(j).lastVideoSigned).toEqual({ signed: old.signed, t: 1234 });
    });

    it('latches conflicting overlapping points or metadata atomically without retaining the bad range', () => {
        for (const bad of [delta('line', 1, [point(99), point(2)]), delta('line', 2, [point(2)], 0, { size: 9 })]) {
            const j = journal(); j.recordStroke(delta('line', 0, points(0, 2)));
            const before = j.status();
            expect(j.recordStroke(bad)).toBe(false);
            expect(j.status()).toEqual({ ...before, ok: false, error: 'stroke-conflict' });
            expect(j.recordStroke(delta('other', 0, [point(0)]))).toBe(false);
            expect(j.merge(snapshot(), current())).toEqual({ ok: false, error: 'stroke-conflict' });
        }
    });

    it('fails a conflict with the captured prefix without mutating any current state or metadata', () => {
        const j = journal(); j.recordStroke(delta('line', 1, [point(99), point(2)]));
        const live = current({ lastHostSeq: 9, mods: { lock: lock(3), spot: null } });
        live.state.chat.push({ text: 'Live' }); live.state.strokes.push(stroke('untouched', [point(0)]));
        const original = structuredClone(live);
        expect(j.merge(snapshot({ seq: 9, strokes: [stroke('line', points(0, 2))] }), live))
            .toEqual({ ok: false, error: 'drawing-conflict' });
        expect(live).toEqual(original);
    });

    it('rejects same-sequence conflicting host domains and detects fresh/current conflicts', () => {
        const j = journal(); j.recordHost(lock(3));
        const before = j.status();
        expect(j.recordHost(lock(3, false))).toBe(false);
        expect(j.status()).toEqual({ ...before, ok: false, error: 'host-conflict' });
        const clean = journal();
        expect(clean.merge(snapshot({ seq: 5, mods: [lock(3, false)] }), current({ lastHostSeq: 5, mods: { lock: lock(3), spot: null } })))
            .toEqual({ ok: false, error: 'host-conflict' });
    });

    it('owns canonical clones and does not charge duplicate signatures or older controls twice', () => {
        const j = journal(), msg = delta('line', 0, [[0.123456, 0.654321]]), action = lock(3);
        j.recordStroke(msg); j.recordHost(action);
        const before = j.status();
        expect(j.recordStroke(delta('line', 0, [[0.1235, 0.6543]]))).toBe(true);
        expect(j.recordHost({ ...lock(3), sig: 'another_valid_signature' })).toBe(true);
        expect(j.recordHost(lock(2, false))).toBe(true);
        expect(j.status()).toEqual(before);
        msg.stroke.pts[0][0] = 1; action.body.on = false;
        const result = candidate(j);
        expect(result.state.strokes[0].pts).toEqual([[0.1235, 0.6543]]);
        expect(result.mods.lock.body.on).toBe(true);
        result.mods.lock.body.on = false;
        expect(candidate(j).mods.lock.body.on).toBe(true);
    });

    it('rejects legacy or malformed journal deltas instead of claiming they can be recovered', () => {
        const legacy = delta('line', 0, [point(0)]); delete legacy.offset;
        const noEpoch = delta('line', 0, [point(0)]); delete noEpoch.epoch;
        for (const msg of [legacy, noEpoch]) {
            const j = journal(); expect(j.recordStroke(msg)).toBe(false);
            expect(j.status().error).toBe('legacy-stroke');
        }
        for (const msg of [delta('line', -1, [point(0)]), delta('line', 3199, points(0, 2)),
            delta('line', 0, points(0, 401)), delta('line', 0, [[NaN, 0]]), delta('line', 0, [point(0)], '0')]) {
            const j = journal(); expect(j.recordStroke(msg)).toBe(false);
            expect(j.status().error).toBe('invalid-stroke');
        }
    });

    it('rejects malformed snapshot, epoch proofs, duplicate stroke IDs and invalid host action shapes', () => {
        const j = journal();
        for (const bad of [snapshot({ epoch: 1, seq: 1 }), snapshot({ seq: 3, epoch: 2, clear: clear(3) }),
            snapshot({ seq: 1, mods: [lock(2)] }), snapshot({ seq: 3, mods: [lock(2), lock(3)] }),
            snapshot({ strokes: [stroke('same', [point(0)]), stroke('same', [point(1)])] })]) {
            expect(j.merge(bad, current())).toEqual({ ok: false, error: 'invalid-snapshot' });
        }
        expect(j.merge(snapshot(), current({ drawingEpoch: 2 }))).toEqual({ ok: false, error: 'invalid-current' });
        for (const bad of [lock(1, 'yes'), spot(1, 'bad peer'), signed('mute', 1), video(1, 'bad').signed, clear(0)]) {
            const fresh = journal(); expect(fresh.recordHost(bad)).toBe(false);
            expect(fresh.status().error).toBe('invalid-host-action');
        }
    });

    it('bounds retained operations and latches overflow without silently losing accepted work', () => {
        const j = journal();
        for (let i = 0; i < R.LIMITS.ops; i += 1) expect(j.recordStroke(delta('line-' + i, 0, [point(0)]))).toBe(true);
        const before = j.status();
        expect(j.recordStroke(delta('overflow', 0, [point(0)]))).toBe(false);
        expect(j.status()).toEqual({ ...before, ok: false, error: 'journal-limit-ops' });
        expect(j.merge(snapshot(), current())).toEqual({ ok: false, error: 'journal-limit-ops' });
    });

    it('bounds retained point payloads even before the operation cap is reached', () => {
        const j = journal(), chunk = points(0, 400);
        for (let i = 0; i < R.LIMITS.points / chunk.length; i += 1) expect(j.recordStroke(delta('line-' + i, 0, chunk))).toBe(true);
        const before = j.status();
        expect(before.points).toBe(R.LIMITS.points);
        expect(j.recordStroke(delta('overflow', 0, [point(0)]))).toBe(false);
        expect(j.status()).toEqual({ ...before, ok: false, error: 'journal-limit-points' });
    });

    it('bounds total serialized payload bytes and releases replaced host payload accounting', () => {
        const j = journal();
        expect(j.recordHost(lock(1))).toBe(true);
        const first = j.status();
        expect(j.recordHost(lock(2))).toBe(true);
        expect(j.status()).toEqual(first);
        const large = lock(3); large.body.padding = 'x'.repeat(R.LIMITS.bytes);
        const before = j.status();
        expect(j.recordHost(large)).toBe(false);
        expect(j.status()).toEqual({ ...before, ok: false, error: 'journal-limit-bytes' });
    });
});
