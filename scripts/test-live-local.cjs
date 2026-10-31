'use strict';
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

const root = path.resolve(__dirname, '..');
const port = process.env.STALEMATE_TEST_PORT || '4345';
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['scripts/serve-test.cjs'], { cwd: root,
    env: { ...process.env, STALEMATE_TEST_PORT: port }, stdio: 'inherit' });

async function main() {
    try {
        const deadline = Date.now() + 10000;
        while (true) {
            if (server.exitCode !== null) throw Error('Local live-check server exited early.');
            try { if ((await fetch(origin, { signal: AbortSignal.timeout(500) })).ok) break; } catch { /* startup */ }
            if (Date.now() >= deadline) throw Error('Local live-check server did not start.');
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        for (const prefix of ['/', '/StalemateSite/']) {
            const child = spawn(process.execPath, ['scripts/verify-live.cjs'], { cwd: root, stdio: 'inherit', env: {
                ...process.env, STALEMATE_ALLOW_LOCAL_LIVE: '1', STALEMATE_LIVE_BASE: origin + prefix,
                STALEMATE_LIVE_OUT: path.join(root, 'live-results', prefix === '/' ? 'local-root' : 'local-project')
            } });
            const [code] = await once(child, 'exit');
            if (code !== 0) throw Error(`Live verifier failed at local ${prefix}`);
        }
    } finally { server.kill('SIGTERM'); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
