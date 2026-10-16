// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { applyClear, applyStroke, applyVideo, cleanRtc, actSnapshot } from '../../hangout-worker/src/lobby-act.mjs';

const require = createRequire(import.meta.url);
const H = require('../../r/45662413410ed051/sync-core.js');

const chan = (kind) => ({ kind, act: { strokes: [], video: null } });

describe('lobby open-room activity relay', () => {
    it('keeps paint strokes on art and bobross channels', () => {
        const c = chan('art');
        const stroke = { id: 's1', color: H.COLORS[2], size: 8, pts: [[0.1, 0.2], [0.3, 0.4]] };
        expect(applyStroke(c, stroke)).toMatchObject({ id: 's1' });
        expect(c.act.strokes).toHaveLength(1);
        expect(applyStroke(chan('watch'), stroke)).toBeNull();
    });

    it('clear wipes strokes', () => {
        const c = chan('bobross');
        applyStroke(c, { id: 's1', color: H.COLORS[0], size: 4, pts: [[0, 0]] });
        expect(applyClear(c)).toBe(true);
        expect(c.act.strokes).toHaveLength(0);
    });

    it('synced video accepts YouTube sources only', () => {
        const c = chan('watch');
        const v = applyVideo(c, { source: { kind: 'yt', id: 'oh5p5f5_-7A' }, playing: true, pos: 12 }, 1000);
        expect(v).toMatchObject({ source: { kind: 'yt', id: 'oh5p5f5_-7A' }, playing: true, pos: 12, t: 1000 });
        expect(applyVideo(c, { source: { kind: 'yt', id: 'not-valid!!!!' }, playing: true, pos: 0 }, 2000)).toBeNull();
        expect(actSnapshot(c).video.source.id).toBe('oh5p5f5_-7A');
    });

    it('sanitizes rtc signaling frames', () => {
        expect(cleanRtc({ to: 'c1', sdp: { type: 'offer', sdp: 'v=0' } })).toMatchObject({ to: 'c1' });
        expect(cleanRtc({ to: '', ice: { candidate: 'x' } })).toBeNull();
        expect(cleanRtc({ to: 'c2', ice: { candidate: 'a'.repeat(2000) } })).toBeNull();
    });
});
