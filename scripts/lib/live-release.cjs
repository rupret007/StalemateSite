'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

function normalizeBase(value, allowLocal = false) {
    const url = new URL(value);
    const publicHost = ['https://stalemate.band/', 'https://rupret007.github.io/StalemateSite/'].includes(url.href);
    const local = allowLocal && url.protocol === 'http:' && url.hostname === '127.0.0.1'
        && ['/', '/StalemateSite/'].includes(url.pathname) && !url.search && !url.hash;
    if ((!publicHost && !local) || url.username || url.password) throw Error('Use a configured public host or an explicitly enabled local test server.');
    return url.href;
}

function buildManifest(directory) {
    const files = [];
    function walk(relative = '') {
        for (const item of fs.readdirSync(path.join(directory, relative), { withFileTypes: true })) {
            const name = path.posix.join(relative, item.name);
            if (item.isDirectory()) walk(name);
            else if (name !== '.nojekyll') {
                const bytes = fs.readFileSync(path.join(directory, name));
                // Do not download the entire lyric video on every deployment.
                // Audio, scripts, pages, images and fonts are all hashed in full.
                files.push({ path: name, size: bytes.length, method: name.endsWith('.mp4') ? 'HEAD' : 'GET',
                    sha256: name.endsWith('.mp4') ? null : createHash('sha256').update(bytes).digest('hex') });
            }
        }
    }
    walk();
    const marker = fs.readFileSync(path.join(directory, 'play/VENDORED.txt'), 'utf8');
    const upstream = marker.match(/Turdanoid@([a-f0-9]{40})\b/)?.[1];
    if (!upstream) throw Error('Packaged arcade must identify its exact upstream commit.');
    return { upstream, files: files.sort((a, b) => a.path.localeCompare(b.path)), omitted: ['.nojekyll (build control file)'] };
}

async function probeRelease(base, files, fetcher = fetch, deadlineSignal) {
    const results = new Array(files.length);
    let next = 0;
    async function worker() {
        while (next < files.length) {
            const index = next++, file = files[index];
            try {
                deadlineSignal?.throwIfAborted();
                const response = await fetcher(new URL(file.path, base), { method: file.method,
                    cache: 'no-store', redirect: 'error', signal: deadlineSignal
                        ? AbortSignal.any([AbortSignal.timeout(10000), deadlineSignal]) : AbortSignal.timeout(10000) });
                const headers = Object.fromEntries(['content-length', 'content-type', 'cache-control', 'age', 'etag', 'last-modified']
                    .filter(key => response.headers.has(key)).map(key => [key, response.headers.get(key)]));
                let matches = response.status === 200, actualHash;
                if (file.method === 'HEAD') matches &&= headers['content-length'] === String(file.size);
                else {
                    const bytes = Buffer.from(await response.arrayBuffer());
                    actualHash = createHash('sha256').update(bytes).digest('hex');
                    matches &&= actualHash === file.sha256;
                }
                results[index] = { path: file.path, matches, status: response.status, actualHash, headers };
            } catch (error) { results[index] = { path: file.path, matches: false, error: error.message }; }
        }
    }
    await Promise.all(Array.from({ length: Math.min(4, files.length) }, worker));
    return results;
}

async function waitForRelease({ base, manifest, timeoutMs = 20 * 60 * 1000, pollMs = 30000,
    fetcher = fetch, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), record = () => {} }) {
    const started = now(), attempts = [];
    let pending = manifest.files;
    while (true) {
        const remaining = Math.max(1, timeoutMs - (now() - started));
        const results = await probeRelease(base, pending, fetcher, AbortSignal.timeout(remaining));
        const mismatches = results.filter(result => !result.matches);
        attempts.push({ at: new Date(now()).toISOString(), checked: results.length, mismatches });
        const receipt = { base, upstream: manifest.upstream, startedAt: new Date(started).toISOString(),
            fileCount: manifest.files.length, hashCount: manifest.files.filter(f => f.sha256).length, attempts };
        record({ ...receipt, status: mismatches.length ? 'waiting-for-release' : 'checking' });
        if (!mismatches.length) {
            if (pending.length === manifest.files.length) {
                record({ ...receipt, status: 'ready', finishedAt: new Date(now()).toISOString() });
                return receipt;
            }
            // Recheck the entire release after delayed files arrive. Do not
            // accept a mixed copy assembled from matches at different times.
            pending = manifest.files;
            continue;
        }
        if (now() - started >= timeoutMs) {
            record({ ...receipt, status: 'failed', finishedAt: new Date(now()).toISOString() });
            throw Error(`Published files did not match the tested release: ${mismatches.map(r => r.path).join(', ')}`);
        }
        pending = manifest.files.filter(file => mismatches.some(r => r.path === file.path));
        await sleep(Math.min(pollMs, timeoutMs - (now() - started)));
    }
}

module.exports = { normalizeBase, buildManifest, probeRelease, waitForRelease };
