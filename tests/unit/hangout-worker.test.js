// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { admit, createBucket, limitsFrom, validFrame, previewKeyOk } from '../../hangout-worker/src/core.mjs';
import worker, { HangoutQuota, HangoutRoom } from '../../hangout-worker/src/index.mjs';

const KEY = 'k'.repeat(24);
const ROOM = 'a'.repeat(64);
const env = { HANGOUT_PREVIEW_KEY: KEY, ROOMS: {}, QUOTA: {} };
const url = (q) => new URL(`https://relay.example/room?${q}`);

describe('hangout relay worker rules', () => {
    it('fails closed when the preview secret or bindings are missing', async () => {
        await expect(admit({ url: url(`room=${ROOM}`), origin: 'https://stalemate.band', env: {}, previewKey: KEY })).resolves.toEqual({ status: 503, reason: 'not-configured' });
        expect(previewKeyOk('', undefined)).toBe(false);
        expect(previewKeyOk('short', 'short')).toBe(false);
    });

    it('checks exact origin, preview key and room id', async () => {
        const ok = { url: url(`room=${ROOM}`), origin: 'https://stalemate.band', env, previewKey: KEY };
        expect(await admit(ok)).toBeNull();
        expect((await admit({ ...ok, origin: 'https://stalemate.band.evil.com' })).status).toBe(403);
        expect((await admit({ ...ok, previewKey: 'nope' })).reason).toBe('preview');
        expect((await admit({ ...ok, url: url(`room=xyz`), previewKey: KEY })).status).toBe(400);
        expect((await admit({ ...ok, origin: 'http://127.0.0.1:4320' })).status).toBe(403);
        expect(await admit({ ...ok, origin: 'http://127.0.0.1:4320', extraOrigins: 'http://127.0.0.1:4320' })).toBeNull();
    });

    it('only forwards well-formed ciphertext frames under the size cap', () => {
        expect(validFrame(JSON.stringify({ iv: 'A'.repeat(16), c: 'abc_-' }))).toEqual({ iv: 'A'.repeat(16), c: 'abc_-' });
        expect(validFrame(JSON.stringify({ iv: 'A'.repeat(16), c: 'x'.repeat(60000) }))).not.toBeNull();
        expect(validFrame(JSON.stringify({ iv: 'A'.repeat(16), c: 'x'.repeat(1024 * 1024) }))).toBeNull();
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
        const brokenQuota = { idFromName: () => 'x', get: () => ({ fetch: async () => { throw new Error('down'); } }) };
        const room = new HangoutRoom({ getWebSockets: () => [] }, { ...env, QUOTA: brokenQuota });
        const rooms = { idFromName: () => 'room', get: () => room };
        const req = wsRequest(ROOM, KEY);
        expect((await worker.fetch(req, { ...env, QUOTA: brokenQuota, ROOMS: rooms })).status).toBe(503);
        const noKey = wsRequest(ROOM, '');
        expect((await worker.fetch(noKey, env)).status).toBe(403);
    });

    it('does not consume daily quota when admission fails before the room accepts', async () => {
        let quotaTakes = 0;
        const quotaBinding = {
            idFromName: () => 'global',
            get: () => ({
                fetch: async () => {
                    quotaTakes += 1;
                    return new Response('ok');
                }
            })
        };
        const fullRoom = { fetch: async () => new Response('room full', { status: 429 }) };
        const rooms = { idFromName: () => 'room', get: () => fullRoom };
        const req = wsRequest(ROOM, KEY);
        const res = await worker.fetch(req, { ...env, QUOTA: quotaBinding, ROOMS: rooms });
        expect(res.status).toBe(429);
        expect(quotaTakes).toBe(0);
    });

    it('accepts the preview key from Sec-WebSocket-Protocol, not the query string', async () => {
        const base = { url: url(`room=${ROOM}`), origin: 'https://stalemate.band', env };
        expect(await admit({ ...base, previewKey: KEY })).toBeNull();
        expect((await admit({ ...base, previewKey: 'nope' })).reason).toBe('preview');
        expect((await admit({ ...base, url: url(`room=${ROOM}&preview=${KEY}`), previewKey: undefined })).reason).toBe('preview');
    });

    it('accepts a per-room invite relay token instead of the global preview key', async () => {
        const { roomRelayToken } = await import('../../hangout-worker/src/core.mjs');
        const token = await roomRelayToken(KEY, ROOM);
        expect(token.length).toBeGreaterThan(16);
        expect(token).not.toBe(KEY);
        const base = { url: url(`room=${ROOM}`), origin: 'https://stalemate.band', env };
        expect(await admit({ ...base, previewKey: token })).toBeNull();
        expect((await admit({ ...base, previewKey: 'nope' })).reason).toBe('preview');
    });

    it('echoes Sec-WebSocket-Protocol on the 101 when the client offered one', async () => {
        globalThis.WebSocketPair = vi.fn(function WebSocketPair() {
            return [{}, { send: () => {}, close: () => {} }];
        });
        let upgradeInit;
        const ResponseMock = vi.fn(function Response(body, init) {
            upgradeInit = init;
            return {
                status: init?.status,
                headers: new Headers(init?.headers || {}),
                webSocket: init?.webSocket
            };
        });
        vi.stubGlobal('Response', ResponseMock);
        const state = { getWebSockets: () => [], acceptWebSocket: vi.fn() };
        const quotaBinding = {
            idFromName: () => 'global',
            get: () => ({ fetch: async () => ({ status: 200 }) })
        };
        const room = new HangoutRoom(state, { QUOTA: quotaBinding });
        const res = await room.fetch(wsRequest(ROOM, KEY));
        expect(res.status).toBe(101);
        expect(res.headers.get('Sec-WebSocket-Protocol')).toBe(KEY);
        expect(upgradeInit.headers).toEqual({ 'Sec-WebSocket-Protocol': KEY });
    });
});

function wsRequest(room, previewKey) {
    const headers = { Upgrade: 'websocket', Origin: 'https://stalemate.band' };
    if (previewKey) headers['Sec-WebSocket-Protocol'] = previewKey;
    return new Request(`https://relay.example/room?room=${room}`, { headers });
}
