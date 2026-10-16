// @vitest-environment node
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const V = require('../../r/45662413410ed051/video-core.js');

describe('hangout video core', () => {
    it('sends the sharp feed only to people watching you big, thumbnails to everyone else', () => {
        const main = V.encodingFor({ main: true, cams: 6, tier: 'good' });
        const thumb = V.encodingFor({ main: false, cams: 6, tier: 'good' });
        expect(main).toMatchObject({ active: true, maxBitrate: 600000, scaleResolutionDownBy: 1 });
        expect(thumb.maxBitrate).toBeLessThanOrEqual(120000);
        expect(thumb.scaleResolutionDownBy).toBeGreaterThanOrEqual(2);
        expect(thumb.maxFramerate).toBeLessThanOrEqual(10);
        // 8 cameras in a mesh: worst-case uplink stays under ~1.5 Mbps even if one viewer has us big.
        const total = V.encodingFor({ main: true, cams: 8, tier: 'good' }).maxBitrate + 6 * V.encodingFor({ cams: 8, tier: 'good' }).maxBitrate;
        expect(total).toBeLessThanOrEqual(1500000);
    });

    it('squeezes on weak or relayed links and pauses video entirely on bad ones', () => {
        expect(V.encodingFor({ main: true, tier: 'weak' }).maxBitrate).toBeLessThanOrEqual(250000);
        expect(V.encodingFor({ main: false, relayed: true }).maxBitrate).toBeLessThanOrEqual(90000);
        expect(V.encodingFor({ main: true, tier: 'bad' })).toMatchObject({ active: false });
        expect(V.encodingFor({ screen: true, tier: 'good' })).toMatchObject({ active: true, scaleResolutionDownBy: 1 });
        expect(V.encodingFor({ screen: true, tier: 'bad' }).active).toBe(true);
    });

    it('keeps jam-room video small so uplink stays free for WebJam audio', () => {
        const jam = V.encodingFor({ main: true, cams: 2, tier: 'good', jam: true });
        expect(jam.maxBitrate).toBeLessThanOrEqual(120000);
        expect(jam.maxFramerate).toBeLessThanOrEqual(10);
    });

    it('grades links from stats, never worse for missing numbers', () => {
        expect(V.gradeLink({})).toBe('good');
        expect(V.gradeLink({ rtt: 0.05, loss: 0, outKbps: 2000 })).toBe('good');
        expect(V.gradeLink({ rtt: 0.25 })).toBe('ok');
        expect(V.gradeLink({ loss: 0.08 })).toBe('weak');
        expect(V.gradeLink({ outKbps: 40 })).toBe('bad');
        expect(V.gradeLink({ loss: 0.3 })).toBe('bad');
    });

    it('drops to audio-only after 3 bad samples and needs 5 decent ones to come back', () => {
        expect(V.nextTier(['good', 'bad'], 'good')).toBe('weak');
        expect(V.nextTier(['bad', 'bad', 'bad'], 'weak')).toBe('bad');
        expect(V.nextTier(['bad', 'bad', 'bad', 'ok', 'ok'], 'bad')).toBe('bad');
        expect(V.nextTier(['ok', 'ok', 'good', 'good', 'ok'], 'bad')).toBe('weak');
        expect(V.nextTier(['good', 'good', 'good'], 'weak')).toBe('good');
        expect(V.nextTier([], 'ok')).toBe('ok');
    });

    it('picks the active speaker with hysteresis so the big tile does not flap', () => {
        let s = V.pickSpeaker({ a: 0.2, b: 0.01 }, null, 0, 0);
        expect(s.id).toBe('a');
        s = V.pickSpeaker({ a: 0.2, b: 0.5 }, 'a', 500, s.since);
        expect(s.id).toBe('a'); // too soon
        s = V.pickSpeaker({ a: 0.2, b: 0.25 }, 'a', 5000, s.since);
        expect(s.id).toBe('a'); // not clearly louder
        s = V.pickSpeaker({ a: 0.05, b: 0.4 }, 'a', 5000, 0);
        expect(s).toEqual({ id: 'b', since: 5000 });
        expect(V.pickSpeaker({ a: 0.001 }, null, 1, 0).id).toBeNull();
    });

    it('chooses the big tile: spotlight, then pin, then screen, then speaker, only if present', () => {
        expect(V.mainTile({ present: ['a', 'b', 'c'], spotlight: 'a', pin: 'b', speaker: 'c' })).toBe('a');
        expect(V.mainTile({ present: ['b', 'c'], spotlight: 'gone', pin: 'b', speaker: 'c' })).toBe('b');
        expect(V.mainTile({ present: ['b', 'c'], screen: 'c', speaker: 'b' })).toBe('c');
        expect(V.mainTile({ present: [] , speaker: 'x' })).toBeNull();
    });

    it('lays out the grid and keeps phones to two columns', () => {
        expect([1, 2, 4, 5, 8].map((n) => V.gridColumns(n, true))).toEqual([1, 2, 2, 3, 4]);
        expect(V.gridColumns(8, false)).toBe(2);
    });

    it('only allows known reactions, rate-limits them, and orders raised hands', () => {
        expect(V.cleanReaction('🤘')).toBe('🤘');
        expect(V.cleanReaction('<img>')).toBeNull();
        let times = [];
        const results = [];
        for (let i = 0; i < 6; i += 1) { const r = V.rateLimit(times, 1000 + i, 4, 5000); times = r.times; results.push(r.ok); }
        expect(results).toEqual([true, true, true, true, false, false]);
        expect(V.handQueue({ a: 30, b: 10, c: 20, d: null })).toEqual(['b', 'c', 'a']);
    });

    it('accepts only well-formed host moderation actions', () => {
        expect(V.cleanHostAction({ kind: 'mute', seq: 5, target: 'abc' })).toEqual({ kind: 'mute', seq: 5, target: 'abc' });
        expect(V.cleanHostAction({ kind: 'camoff', seq: 5, target: '*' })).toEqual({ kind: 'camoff', seq: 5, target: '*' });
        expect(V.cleanHostAction({ kind: 'mute', seq: 5, target: '*' })).toBeNull();
        expect(V.cleanHostAction({ kind: 'unmute', seq: 5, target: 'abc' })).toBeNull(); // never force anyone's mic on
        expect(V.cleanHostAction({ kind: 'remove', target: 'abc' })).toBeNull();
        expect(V.cleanHostAction({ kind: 'spot', seq: 1, target: null })).toEqual({ kind: 'spot', seq: 1, target: null });
        expect(V.cleanHostAction({ kind: 'lock', seq: 1, on: 1 })).toEqual({ kind: 'lock', seq: 1, on: true });
    });

    it('gates backgrounds on device strength and stops them when frames get slow', () => {
        expect(V.backgroundSupport({ wasm: true, webgl2: true, memory: 8, cores: 8 })).toBe('ok');
        expect(V.backgroundSupport({ wasm: true, webgl2: true, memory: 2, cores: 8 })).toBe('slow');
        expect(V.backgroundSupport({ wasm: true, webgl2: false })).toBe('no');
        expect(V.backgroundVerdict(Array(10).fill(200))).toBe('keep'); // not enough samples yet
        expect(V.backgroundVerdict(Array(30).fill(20))).toBe('keep');
        expect(V.backgroundVerdict(Array(30).fill(60))).toBe('lighten');
        expect(V.backgroundVerdict(Array(30).fill(120))).toBe('stop');
    });

    it('builds talk vs music mic constraints and tunes Opus for music mode', () => {
        expect(V.micConstraints(false)).toMatchObject({ echoCancellation: true, noiseSuppression: true });
        expect(V.micConstraints(true, 'dev1')).toMatchObject({ echoCancellation: false, noiseSuppression: false, autoGainControl: false, deviceId: { exact: 'dev1' } });
        const sdp = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;useinbandfec=1\r\n';
        const out = V.musicSdp(sdp);
        expect(out).toMatch(/a=fmtp:111 [^\r\n]*stereo=1/);
        expect(out).toMatch(/maxaveragebitrate=128000/);
        expect(out).toMatch(/minptime=10/);
        expect(out.match(/a=fmtp:111/g)).toHaveLength(1);
        expect(V.musicSdp('v=0\r\n')).toBe('v=0\r\n');
    });
});
