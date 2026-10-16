// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { admit, createBucket, limitsFrom, validFrame, previewKeyOk } from '../../hangout-worker/src/core.mjs';
import worker, { HangoutQuota } from '../../hangout-worker/src/index.mjs';

const KEY = 'k'.repeat(24);
const ROOM = 'a'.repeat(64);
const env = { HANGOUT_PREVIEW_KEY: KEY, ROOMS: {}, QUOTA: {} };
const url = (q) => new URL(`https://relay.example/room?${q}`);

describe('hangout relay worker rules', () => {
    it('fails closed when the preview secret or bindings are missing', () => {
        expect(admit({ url: url(`room=${ROOM}&preview=${KEY}`), origin: 'https://stalemate.band', env: {} })).toEqual({ status: 503, reason: 'not-configured' });
        expect(previewKeyOk('', undefined)).toBe(false);
        expect(previewKeyOk('short', 'short')).toBe(false);
    });

    it('checks exact origin, preview key and room id', () => {
        const ok = { url: url(`room=${ROOM}&preview=${KEY}`), origin: 'https://stalemate.band', env };
        expect(admit(ok)).toBeNull();
        expect(admit({ ...ok, origin: 'https://stalemate.band.evil.com' }).status).toBe(403);
        expect(admit({ ...ok, url: url(`room=${ROOM}&preview=nope`) }).reason).toBe('preview');
        expect(admit({ ...ok, url: url(`room=xyz&preview=${KEY}`) }).status).toBe(400);
        expect(admit({ ...ok, origin: 'http://127.0.0.1:4320' }).status).toBe(403);
        expect(admit({ ...ok, origin: 'http://127.0.0.1:4320', extraOrigins: 'http://127.0.0.1:4320' })).toBeNull();
    });

    it('only forwards well-formed ciphertext frames under the size cap', () => {
        expect(validFrame(JSON.stringify({ iv: 'A'.repeat(16), c: 'abc_-' }))).toEqual({ iv: 'A'.repeat(16), c: 'abc_-' });
        expect(validFrame(JSON.stringify({ iv: 'A'.repeat(16), c: 'x'.repeat(60000) }))).toBeNull();
        expect(validFrame(JSON.stringify({ text: 'plaintext' }))).toBeNull();
        expect(validFrame('not json')).toBeNull();
    });

    it('rate limits bursts and hard-caps messages per connection', () => {
        let t = 0;
        const bucket = createBucket({ ...limitsFrom({}), messagesPerConnection: 40 }, () => t);
        const first = Array.from({ length: 31 }, () => bucket.take());
        expect(first.slice(0, 30).every((v) => v === 'ok')).toBe(true);
        expect(first[30]).toBe('slow');
        t = 10000;
        for (let i = 0; i < 9; i += 1) bucket.take(); // 40 used
        expect(bucket.take()).toBe('spent');
    });

    it('clamps config so nobody can raise caps far past the free tier', () => {
        expect(limitsFrom({ HANGOUT_MAX_PEERS: '500' }).maxPeers).toBe(12);
        expect(limitsFrom({ HANGOUT_CONNECTIONS_PER_DAY: '99999999' }).connectionsPerDay).toBe(800);
    });

    it('daily connection quota returns 429 once spent', async () => {
        const store = new Map();
        const q = new HangoutQuota({ storage: { get: async (k) => store.get(k), put: async (k, v) => store.set(k, v) } }, { HANGOUT_CONNECTIONS_PER_DAY: '2' });
        expect((await q.fetch()).status).toBe(200);
        expect((await q.fetch()).status).toBe(200);
        expect((await q.fetch()).status).toBe(429);
    });

    it('worker answers 503 when quota accounting is unreachable', async () => {
        const broken = { ...env, QUOTA: { idFromName: () => 'x', get: () => ({ fetch: async () => { throw new Error('down'); } }) } };
        const req = new Request(`https://relay.example/room?room=${ROOM}&preview=${KEY}`, { headers: { Upgrade: 'websocket', Origin: 'https://stalemate.band' } });
        expect((await worker.fetch(req, broken)).status).toBe(503);
        const noKey = new Request(`https://relay.example/room?room=${ROOM}`, { headers: { Upgrade: 'websocket', Origin: 'https://stalemate.band' } });
        expect((await worker.fetch(noKey, env)).status).toBe(403);
    });
});
