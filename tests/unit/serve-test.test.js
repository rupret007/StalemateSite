// @vitest-environment node

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
});

afterAll(async () => {
    if (server && server.exitCode === null) {
        const closed = once(server, 'close');
        server.kill();
        await closed;
    }
});

function getMedia(options) {
    return fetch(`${origin}/play/stalemate/manic.m4a`, options);
}

describe('test server media responses', () => {
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
