'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { normalizeBase, buildManifest, waitForRelease } = require('./lib/live-release.cjs');

async function main() {
    const root = path.resolve(__dirname, '..');
    const base = normalizeBase(process.env.STALEMATE_LIVE_BASE, process.env.STALEMATE_ALLOW_LOCAL_LIVE === '1');
    const out = path.resolve(process.env.STALEMATE_LIVE_OUT || 'live-results');
    fs.mkdirSync(out, { recursive: true });
    const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout?.trim();
    if (!/^[a-f0-9]{40}$/.test(sha || '') || (process.env.STALEMATE_EXPECT_SITE_SHA && process.env.STALEMATE_EXPECT_SITE_SHA !== sha)) {
        throw Error('Live verification must check out the exact expected site commit.');
    }
    const packaged = spawnSync(process.execPath, [path.join(__dirname, 'package-pages.cjs')], { cwd: root, stdio: 'inherit' });
    if (packaged.status !== 0) throw Error('Could not package the expected release.');
    const manifest = { expectedSiteCommit: sha, ...buildManifest(path.join(root, 'dist')) };
    fs.writeFileSync(path.join(out, 'expected-release.json'), JSON.stringify(manifest, null, 2) + '\n');
    await waitForRelease({ base, manifest,
        // Local failures should surface promptly; production allows the band
        // domain's independent quarter-hour mirror to finish publishing.
        timeoutMs: process.env.STALEMATE_ALLOW_LOCAL_LIVE === '1' ? 10000 : undefined,
        record: receipt => fs.writeFileSync(path.join(out, 'readiness.json'), JSON.stringify({ expectedSiteCommit: sha, ...receipt }, null, 2) + '\n') });
    const result = spawnSync(process.execPath, [require.resolve('@playwright/test/cli'), 'test', '--config=playwright.live.config.js'], {
        cwd: root, stdio: 'inherit', env: { ...process.env, STALEMATE_LIVE_BASE: base, STALEMATE_LIVE_OUT: out }
    });
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ base, expectedSiteCommit: sha, upstream: manifest.upstream,
        publicFiles: manifest.files.length, hashedFiles: manifest.files.filter(f => f.sha256).length,
        browserStatus: result.status === 0 ? 'passed' : 'failed', retries: 0,
        finishedAt: new Date().toISOString(), phoneTesting: 'emulated; physical iPhone lock/app-switch behavior unverified' }, null, 2) + '\n');
    if (result.status !== 0) throw Error('Live browser checks failed. First-failure diagnostics are retained; browser checks are not retried.');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
