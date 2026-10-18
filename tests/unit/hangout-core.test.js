// @vitest-environment node
import { webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const require = createRequire(import.meta.url);
const H = require('../../r/45662413410ed051/sync-core.js');

describe('hangout sync core', () => {
    it('parses YouTube links and rejects everything else', () => {
        expect(H.parseYouTubeId('https://www.youtube.com/watch?v=oh5p5f5_-7A&t=3')).toBe('oh5p5f5_-7A');
        expect(H.parseYouTubeId('https://youtu.be/BtnyqIHTDMM')).toBe('BtnyqIHTDMM');
        expect(H.parseYouTubeId('https://m.youtube.com/shorts/Dws9G6UFyUQ')).toBe('Dws9G6UFyUQ');
        expect(H.parseYouTubeId('https://evil.example/watch?v=oh5p5f5_-7A')).toBeNull();
        expect(H.parseYouTubeId('javascript:alert(1)')).toBeNull();
    });

    it('only allows the site’s own Manic file as a non-YouTube source', () => {
        expect(H.cleanSource({ kind: 'file', id: 'manic' })).toEqual({ kind: 'file', id: 'manic' });
        expect(H.cleanSource({ kind: 'file', id: '../../etc/passwd' })).toBeNull();
        expect(H.cleanSource({ kind: 'url', id: 'https://x' })).toBeNull();
    });

    it('extrapolates position from the relay clock and corrects drift over 1 s', () => {
        const v = { playing: true, pos: 10, t: 1000 };
        expect(H.expectedPosition(v, 6000)).toBe(15);
        expect(H.expectedPosition({ ...v, playing: false }, 6000)).toBe(10);
        expect(H.needsCorrection(14.2, 15)).toBe(false);
        expect(H.needsCorrection(13.5, 15)).toBe(true);
    });

    it('estimates the relay clock offset from the tightest sample', () => {
        let now = 0;
        const clock = H.createClock(() => now);
        now = 1000; clock.sample(5900); // 100 ms late
        now = 2000; clock.sample(6990); // 10 ms late (tighter)
        now = 3000; clock.sample(7500); // very late, ignored
        expect(clock.offset).toBe(4990);
        expect(clock.relayNow()).toBe(7990);
    });

    it('drops stale video updates and keeps the newest', () => {
        const s = H.emptyState();
        H.apply(s, { type: 'video', source: { kind: 'yt', id: 'oh5p5f5_-7A' }, playing: true, pos: 5 }, { t: 200 });
        expect(H.apply(s, { type: 'video', source: { kind: 'yt', id: 'BtnyqIHTDMM' }, playing: true, pos: 0 }, { t: 100 })).toBeNull();
        expect(s.video.source.id).toBe('oh5p5f5_-7A');
    });

    it('sanitizes strokes and chat and caps their size', () => {
        const s = H.emptyState();
        expect(H.apply(s, { type: 'stroke', stroke: { id: 'a', color: 'red', size: 4, pts: [[0, 0]] } })).toBeNull();
        H.apply(s, { type: 'stroke', stroke: { id: 'a', color: H.COLORS[2], size: 999, pts: [[2, -1], [0.5, 0.5]] } });
        expect(s.strokes[0].size).toBe(48);
        expect(s.strokes[0].pts[0]).toEqual([1, 0]);
        H.apply(s, { type: 'chat', name: 'x'.repeat(80), text: `hi\u0000${'y'.repeat(900)}` });
        expect(s.chat[0].name).toHaveLength(24);
        expect(s.chat[0].text.length).toBe(400);
        for (let i = 0; i < 300; i += 1) H.apply(s, { type: 'chat', name: 'a', text: String(i) });
        expect(s.chat.length).toBe(H.LIMITS.chatKept);
    });

    it('appends strokes when snapshot chunking is used', () => {
        const s = H.emptyState();
        H.apply(s, { type: 'snapshot', state: { strokes: [{ id: 'a', color: '#000000', size: 10, pts: [[0, 0]] }] } });
        expect(s.strokes.length).toBe(1);
        H.apply(s, { type: 'snapshot', state: { strokes: [{ id: 'b', color: '#ffffff', size: 10, pts: [[1, 1]] }], append: true } });
        expect(s.strokes.length).toBe(2);
        expect(s.strokes[1].id).toBe('b');
    });

    it('end-to-end encrypts frames; the relay cannot read or tamper', async () => {
        const secret = H.newSecret();
        expect(H.validSecret(secret)).toBe(true);
        const a = await H.deriveRoom(secret);
        const b = await H.deriveRoom(secret);
        expect(a.roomId).toBe(b.roomId);
        expect(a.roomId).toMatch(/^[0-9a-f]{64}$/);
        const frame = await H.seal(a.key, { type: 'chat', text: 'paint a happy tree' });
        expect(frame.c).not.toContain('happy');
        expect(await H.open(b.key, frame)).toEqual({ type: 'chat', text: 'paint a happy tree' });
        const bad = { ...frame, c: frame.c.slice(0, -2) + (frame.c.endsWith('A') ? 'BB' : 'AA') };
        await expect(H.open(b.key, bad)).rejects.toBeTruthy();
        const other = await H.deriveRoom(H.newSecret());
        await expect(H.open(other.key, frame)).rejects.toBeTruthy();
    });
});
