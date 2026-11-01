// @vitest-environment node

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { hangoutRelayWsBase } from '../../scripts/lib/e2e-test-server.cjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const media = readFileSync(new URL('../../play/stalemate/manic.m4a', import.meta.url));
let server;
let origin;

beforeAll(async () => {
    const reservation = createServer();
    reservation.listen(0, '127.0.0.1');
    await once(reservation, 'listening');
    const port = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    origin = `http://127.0.0.1:${port}`;
    server = spawn(process.execPath, ['scripts/serve-test.cjs'], {
        cwd: repoRoot,
        env: { ...process.env, STALEMATE_TEST_PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    await new Promise((resolve, reject) => {
        let output = '';
        server.stdout.on('data', (chunk) => {
            output += chunk;
            if (output.includes(`Stalemate test server on ${origin}`)) resolve();
        });
        server.stderr.on('data', (chunk) => { output += chunk; });
        server.once('error', reject);
        server.once('exit', (code) => reject(new Error(`Test server exited (${code}): ${output}`)));
    });
}, 30000);

afterAll(async () => {
    if (server && server.exitCode === null) {
        const closed = once(server, 'close');
        server.kill();
        await closed;
    }
}, 30000);

function getMedia(options) {
    return fetch(`${origin}/play/stalemate/manic.m4a`, options);
}

// Loaded CI runners can take >5s to stream the 1.5 MB fixture; allow 30s, same assertions.
describe('test server media responses', { timeout: 30000 }, () => {
    it('serves the full file with its byte length and range support', async () => {
        const response = await getMedia();
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('audio/mp4');
        expect(response.headers.get('content-length')).toBe(String(media.length));
        expect(response.headers.get('accept-ranges')).toBe('bytes');
        expect(Buffer.from(await response.arrayBuffer())).toEqual(media);
    });

    it.each([
        ['bytes=0-1', 0, 1],
        ['bytes=20-', 20, media.length - 1],
        ['bytes=-8', media.length - 8, media.length - 1],
        [`bytes=${media.length - 2}-${media.length + 10}`, media.length - 2, media.length - 1]
    ])('serves the requested bytes for %s', async (range, start, end) => {
        const response = await getMedia({ headers: { Range: range } });
        expect(response.status).toBe(206);
        expect(response.headers.get('content-range')).toBe(`bytes ${start}-${end}/${media.length}`);
        expect(response.headers.get('content-length')).toBe(String(end - start + 1));
        expect(Buffer.from(await response.arrayBuffer())).toEqual(media.subarray(start, end + 1));
    });

    it.each([`bytes=${media.length}-`, 'bytes=-0'])('rejects unsatisfiable %s', async (range) => {
        const response = await getMedia({ headers: { Range: range } });
        expect(response.status).toBe(416);
        expect(response.headers.get('content-range')).toBe(`bytes */${media.length}`);
        expect((await response.arrayBuffer()).byteLength).toBe(0);
    });

    it('answers HEAD with full-file headers and no body, ignoring Range', async () => {
        const response = await getMedia({ method: 'HEAD', headers: { Range: 'bytes=0-1' } });
        expect(response.status).toBe(200);
        expect(response.headers.get('content-length')).toBe(String(media.length));
        expect(response.headers.get('content-range')).toBeNull();
        expect((await response.arrayBuffer()).byteLength).toBe(0);
    });

    it('keeps missing paths as a complete 404 response even with Range', async () => {
        const response = await fetch(`${origin}/missing-media.m4a`, { headers: { Range: 'bytes=0-1' } });
        const missing = readFileSync(new URL('../../404.html', import.meta.url));
        expect(response.status).toBe(404);
        expect(response.headers.get('content-range')).toBeNull();
        expect(Buffer.from(await response.arrayBuffer())).toEqual(missing);
    });
});

describe('same-origin lobby test namespaces', () => {
    function guest(namespace, nick) {
        const ws = new WebSocket(`${hangoutRelayWsBase(origin, namespace)}/lobby?preview=local-preview-key-0001`, { headers: { origin } });
        const frames = [];
        const waiters = new Set();
        ws.on('message', (raw) => {
            const frame = JSON.parse(String(raw));
            frames.push(frame);
            if (frame.t === 'hello') ws.send(JSON.stringify({ t: 'hello', nick, age13: true }));
            for (const waiter of waiters) if (waiter.predicate(frame)) { waiters.delete(waiter); waiter.resolve(frame); }
        });
        const next = (predicate) => {
            const found = frames.find(predicate);
            return found ? Promise.resolve(found) : new Promise((resolve) => waiters.add({ predicate, resolve }));
        };
        return { ws, next, joined: next((frame) => frame.t === 'join' && frame.ch.name === '#stalemate') };
    }

    it('isolates memberships and per-IP room quotas without raising the production cap', async () => {
        const peers = [];
        try {
            for (let i = 0; i < 3; i += 1) {
                const peer = guest('quota-first', `Host${i}`); peers.push(peer);
                await peer.joined;
                const room = `#art-first-${i}`;
                peer.ws.send(JSON.stringify({ t: 'cmd', name: 'join', args: [room], ch: '#stalemate' }));
                await peer.next((frame) => frame.t === 'join' && frame.ch.name === room);
            }
            const blocked = guest('quota-first', 'HostFourth'); peers.push(blocked);
            await blocked.joined;
            blocked.ws.send(JSON.stringify({ t: 'cmd', name: 'join', args: ['#art-fourth'], ch: '#stalemate' }));
            // A deliberately legacy peer also receives an update notice. Wait
            // for the actual quota decision, preserving the admission assertion.
            const refusal = await blocked.next((frame) => frame.t === 'notice' && frame.kind === 'error' && frame.text.includes('Too many new rooms'));
            expect(refusal.text).toContain('Too many new rooms');

            // Same origin/IP and same nickname as the first engine, but a new scenario.
            const separate = guest('quota-second', 'Host0'); peers.push(separate);
            const joined = await separate.joined;
            expect(joined.ch.names.map((person) => person.nick)).toEqual(['Host0']);
            separate.ws.send(JSON.stringify({ t: 'cmd', name: 'join', args: ['#art-second'], ch: '#stalemate' }));
            await separate.next((frame) => frame.t === 'join' && frame.ch.name === '#art-second');
            const logs = await fetch(`${hangoutRelayWsBase(origin, 'quota-second').replace(/^ws/, 'http')}/__test/modlog.json`).then((response) => response.json());
            expect(logs.filter((entry) => entry.action === 'room-open').map((entry) => entry.target)).toEqual(['#art-second']);
        } finally { for (const peer of peers) peer.ws.terminate(); }
    });
});
