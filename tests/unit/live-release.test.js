// @vitest-environment node
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
const require = createRequire(import.meta.url);
const { normalizeBase, buildManifest, probeRelease, waitForRelease } = require('../../scripts/lib/live-release.cjs');
const hash = value => createHash('sha256').update(value).digest('hex');
const file = (path, bytes) => ({ path, method: 'GET', size: Buffer.byteLength(bytes), sha256: hash(bytes) });

describe('public deployment qualification', () => {
    it('accepts only the configured hosts and explicitly enabled local root/project routes', () => {
        expect(normalizeBase('https://stalemate.band/')).toBe('https://stalemate.band/');
        expect(normalizeBase('https://rupret007.github.io/StalemateSite/')).toContain('/StalemateSite/');
        for (const url of ['https://example.com/', 'http://stalemate.band/', 'https://stalemate.band/?x=1',
            'https://user:password@stalemate.band/', 'http://127.0.0.1:4345/']) expect(() => normalizeBase(url)).toThrow();
        expect(normalizeBase('http://127.0.0.1:4345/StalemateSite/', true)).toContain('/StalemateSite/');
        expect(() => normalizeBase('http://127.0.0.1:4345/private/', true)).toThrow();
    });

    it('hashes audio and ordinary public files; checks video length without downloading it', () => {
        const root = mkdtempSync(join(tmpdir(), 'stalemate-manifest-'));
        try {
            mkdirSync(join(root, 'play'));
            writeFileSync(join(root, 'play/VENDORED.txt'), 'Turdanoid@' + 'b'.repeat(40));
            writeFileSync(join(root, 'song.m4a'), Buffer.from([0, 1, 255]));
            writeFileSync(join(root, 'video.mp4'), Buffer.from([0, 5]));
            writeFileSync(join(root, 'index.html'), 'new homepage');
            writeFileSync(join(root, '.nojekyll'), '');
            const manifest = buildManifest(root);
            expect(manifest.upstream).toBe('b'.repeat(40));
            expect(manifest.files).toHaveLength(4);
            expect(manifest.files.find(f => f.path === 'song.m4a').sha256).toBe(hash(Buffer.from([0, 1, 255])));
            expect(manifest.files.find(f => f.path === 'video.mp4')).toMatchObject({ method: 'HEAD', size: 2, sha256: null });
            writeFileSync(join(root, 'play/VENDORED.txt'), 'unversioned');
            expect(() => buildManifest(root)).toThrow('exact upstream');
        } finally { rmSync(root, { recursive: true, force: true }); }
    });

    it('detects stale homepage assets even when the arcade revision is unchanged', async () => {
        const files = [file('styles.css', 'new styles'), file('play/VENDORED.txt', 'same upstream')];
        const results = await probeRelease('https://stalemate.band/', files, async url =>
            new Response(url.pathname === '/styles.css' ? 'old styles' : 'same upstream'));
        expect(results.map(r => r.matches)).toEqual([false, true]);
    });

    it('detects missing files, network failures, corrupted audio and wrong video size', async () => {
        const files = [file('missing.js', ''), file('offline.css', ''), file('song.m4a', 'expected audio'),
            { path: 'video.mp4', method: 'HEAD', size: 20, sha256: null }];
        const results = await probeRelease('https://stalemate.band/', files, async (url, options) => {
            if (url.pathname === '/offline.css') throw Error('network down');
            if (url.pathname === '/missing.js') return new Response('not found', { status: 404 });
            if (url.pathname === '/song.m4a') return new Response('corrupt audio');
            expect(options.method).toBe('HEAD');
            return new Response(null, { headers: { 'content-length': '19' } });
        });
        expect(results.every(r => !r.matches)).toBe(true);
        expect(results[1].error).toBe('network down');
    });

    it('waits for the delayed mirror, preserves its first mismatch and rechecks the complete release', async () => {
        let now = 0, revision = 0;
        const history = [], requests = [];
        const manifest = { upstream: 'b'.repeat(40), files: [file('index.html', 'home'), file('styles.css', 'new')] };
        const receipt = await waitForRelease({ base: 'https://stalemate.band/', manifest, now: () => now,
            pollMs: 30, timeoutMs: 100,
            sleep: async ms => { now += ms; revision++; }, record: value => history.push(structuredClone(value)),
            fetcher: async url => { requests.push(url.pathname); return new Response(url.pathname === '/index.html' ? 'home' : revision ? 'new' : 'old'); } });
        expect(receipt.attempts.map(a => a.checked)).toEqual([2, 1, 2]);
        expect(history[0].attempts[0].mismatches[0].path).toBe('styles.css');
        expect(history.at(-1).status).toBe('ready');
        expect(requests.filter(p => p === '/index.html')).toHaveLength(2);
    });

    it('fails after the deadline with the unresolved paths and first-attempt evidence intact', async () => {
        let now = 0;
        const history = [];
        await expect(waitForRelease({ base: 'https://stalemate.band/',
            manifest: { upstream: 'b'.repeat(40), files: [file('styles.css', 'new')] },
            timeoutMs: 60, pollMs: 30, now: () => now, sleep: async ms => { now += ms; },
            record: value => history.push(structuredClone(value)), fetcher: async () => new Response('old')
        })).rejects.toThrow('styles.css');
        expect(now).toBe(60); expect(history.at(-1).status).toBe('failed');
        expect(history.at(-1).attempts).toHaveLength(3);
        expect(history[0].attempts).toHaveLength(1);
    });

    it('cancels in-flight and queued requests at the overall readiness deadline', async () => {
        let startedRequests = 0;
        const history = [];
        await expect(waitForRelease({ base: 'https://stalemate.band/', timeoutMs: 20,
            manifest: { upstream: 'b'.repeat(40), files: Array.from({ length: 12 }, (_, i) => file(`asset${i}.js`, 'new')) },
            record: value => history.push(structuredClone(value)),
            fetcher: (_, { signal }) => new Promise((resolve, reject) => {
                startedRequests++;
                signal.addEventListener('abort', () => reject(Error('request aborted at deadline')), { once: true });
            })
        })).rejects.toThrow('asset0.js');
        expect(startedRequests).toBe(4);
        expect(history.at(-1).status).toBe('failed');
        expect(history.at(-1).attempts[0].mismatches).toHaveLength(12);
    });
});
