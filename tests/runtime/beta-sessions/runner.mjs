import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const FILE = fileURLToPath(import.meta.url), HERE = dirname(FILE);
const TOOLS = fileURLToPath(new URL('../durable-records/', import.meta.url));
const APP = fileURLToPath(new URL('../../../', import.meta.url));
const ENV = ['PATH', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'SYSTEMROOT', 'WINDIR'];
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const sources = () => Object.fromEntries([
    ['fixture/runner.mjs', FILE], ['fixture/worker.mjs', join(HERE, 'worker.mjs')],
    ...['beta-sessions.mjs', 'beta-session-state.mjs', 'core.mjs', 'beta-session-client.mjs', 'beta-ops.mjs', 'beta-auth.mjs', 'ai-eligibility.mjs', 'auth.mjs'].map(name => [`application/${name}`, join(APP, 'hangout-worker/src', name)]),
    ...['package.json', 'package-lock.json'].map(name => [`tools/${name}`, join(TOOLS, name)])
].map(([name, path]) => [name, hash(path)]));
const group = pid => execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,stat=,comm='], { encoding: 'utf8', timeout: 3000 }).trim().split('\n').map(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
    return match && { pid: +match[1], pgid: +match[3], state: match[4], command: basename(match[5]) };
}).filter(row => row && row.pgid === pid && !row.state.startsWith('Z'));
const kill = pid => { if (Number.isInteger(pid) && pid > 1) try { process.kill(-pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
async function stopped(pid) { for (let n = 0; n < 40; n++) { if (!group(pid).length) return; await new Promise(resolve => setTimeout(resolve, 25)); } assert.fail('owned runtime group still live'); }
async function child(state, nonce) {
    assert.equal(realpathSync(state), state); assert.match(basename(state), /^webjam-beta-lifecycle-[A-Za-z0-9]{6}$/); assert.match(nonce, /^[a-f0-9]{32}$/);
    assert.equal(typeof process.send, 'function'); assert.ok(group(process.pid).some(row => row.pid === process.pid));
    assert.deepEqual(Object.keys(process.env).filter(name => ![...ENV, ...(process.platform === 'darwin' ? ['__CF_USER_TEXT_ENCODING'] : [])].includes(name)), []);
    const require = createRequire(join(TOOLS, 'package.json'));
    const { Miniflare, convertV4MiniflareOptions, Log, LogLevel } = await import(pathToFileURL(require.resolve('miniflare')).href);
    const versions = Object.fromEntries(['miniflare', 'workerd', 'undici'].map(name => [name, JSON.parse(readFileSync(join(TOOLS, 'node_modules', name, 'package.json'))).version]));
    assert.deepEqual(versions, { miniflare: '5.20261019.2-beta', workerd: '1.20261019.1', undici: '7.30.1' });
    const workerd = require('workerd'), binarySha256 = hash(workerd.default), before = sources();
    assert.equal(workerd.compatibilityDate, '2026-10-19');
    let outboundCalls = 0, runtimeRestarts = 0, proof;
    const disconnected = () => kill(process.pid); process.on('disconnect', disconnected);
    const options = convertV4MiniflareOptions({
        name: 'webjam-beta-lifecycle-proof', rootPath: APP, modulesRoot: APP,
        modules: [{ type: 'ESModule', path: join(HERE, 'worker.mjs') }, ...['beta-sessions.mjs', 'beta-session-state.mjs', 'core.mjs', 'beta-session-client.mjs', 'beta-ops.mjs', 'beta-auth.mjs', 'ai-eligibility.mjs', 'auth.mjs'].map(name => ({ type: 'ESModule', path: join(APP, 'hangout-worker/src', name) }))],
        compatibilityDate: '2026-10-01', host: '127.0.0.1', port: 0, inspectorHost: '127.0.0.1', inspectorPort: 0,
        resourcePersistencePath: join(state, 'persist'), resourceTmpPath: join(state, 'runtime'),
        durableObjects: { SQLITE: { className: 'SqliteBeta', useSQLite: true }, LEGACY: { className: 'LegacyBeta', useSQLite: false } },
        bindings: { FIXTURE_NONCE: nonce, HANGOUT_BETA_MODE: 'protected', HANGOUT_BETA_INVITE_VERSION: '1' }, outboundService: () => { outboundCalls++; return new Response('denied', { status: 503 }); },
        cf: false, telemetry: { enabled: false }, unsafeRegisterWorker: false, unsafeRuntimeEnv: {},
        unsafeHandleRuntimeRestart: () => { runtimeRestarts++; }, log: new Log(LogLevel.ERROR), logRequests: false
    });
    options.unsafeEnableSharedStorage = false;
    const mf = new Miniflare(options);
    try {
        assert.equal((await mf.ready).hostname, '127.0.0.1');
        const results = {}, checks = [];
        const negativeRequests = [
            { path: '/SQLITE/budget', headers: { 'Content-Type': 'application/json', 'X-Fixture-Nonce': `${nonce}invalid` }, body: JSON.stringify({ phase: 'register' }) },
            { path: '/SQLITE/budget', headers: { 'Content-Type': 'application/json', 'X-Fixture-Nonce': nonce, Origin: 'https://untrusted-fixture.invalid' }, body: JSON.stringify({ phase: 'register' }) },
            { path: '/SQLITE/budget', headers: { 'Content-Type': 'text/plain', 'X-Fixture-Nonce': nonce }, body: JSON.stringify({ phase: 'register' }) },
            { path: '/UNKNOWN/budget', headers: { 'Content-Type': 'application/json', 'X-Fixture-Nonce': nonce }, body: JSON.stringify({ phase: 'register' }) },
            { path: '/SQLITE/budget', headers: { 'Content-Type': 'application/json', 'X-Fixture-Nonce': nonce }, body: 'x'.repeat(129) }
        ];
        for (const request of negativeRequests) {
            const response = await mf.dispatchFetch(`http://local-fixture.invalid${request.path}`, { method: 'POST', headers: request.headers, body: request.body });
            assert.equal(response.status, 403); await response.body?.cancel();
        }

        const call = async (backend, name, phase) => {
            const response = await mf.dispatchFetch(`http://local-fixture.invalid/${backend}/${name}`, { method: 'POST', headers: { 'X-Fixture-Nonce': nonce, 'Content-Type': 'application/json' }, body: JSON.stringify({ phase }) });
            return { status: response.status, body: await response.json() };
        };
        for (const backend of ['SQLITE', 'LEGACY']) {
            results[backend] = {};
            for (const name of ['budget', 'session', 'alarm']) {
                const initial = await call(backend, name, 'seed-alarm'); assert.equal(initial.status, 200); assert.equal(initial.body.sqlite, backend === 'SQLITE');
                const failed = await call(backend, name, `fail-${name}`); assert.deepEqual(failed, { status: 503, body: { reason: 'beta session registry unavailable' } });
                const afterFailure = await call(backend, name, 'inspect'); assert.equal(afterFailure.status, 200);
                assert.equal(afterFailure.body.objectId, initial.body.objectId); assert.deepEqual(afterFailure.body.records, initial.body.records);
                assert.equal(afterFailure.body.rates, initial.body.rates); assert.equal(afterFailure.body.alarm, initial.body.alarm);
                assert.equal(afterFailure.body.control.tripped.mode, name); assert.equal(afterFailure.body.control.tripped.scope, 'transaction');
                const retry = await call(backend, name, 'register'); assert.deepEqual(retry, { status: 200, body: { reason: 'registered' } });
                const afterRetry = await call(backend, name, 'inspect'); assert.equal(afterRetry.status, 200); assert.equal(afterRetry.body.records.length, 1);
                assert.equal(afterRetry.body.rates['A'.repeat(22)].count, 1); assert.ok(afterRetry.body.alarm > Date.now() && afterRetry.body.alarm < initial.body.alarm);
                results[backend][name] = { initial, failed, afterFailure, retry, afterRetry };
                checks.push({ name: `${backend}-real-register-after-${name}-rollback-and-retry`, pass: true });
            }
            for (const name of ['prune-register', 'prune-direct']) {
                const initial = await call(backend, name, 'seed-prune'); assert.equal(initial.status, 200); assert.equal(initial.body.records.length, 272);
                const failed = await call(backend, name, name === 'prune-register' ? 'fail-prune' : 'fail-direct-prune'); assert.equal(failed.status, 503);
                const afterFailure = await call(backend, name, 'inspect'); assert.equal(afterFailure.status, 200);
                assert.deepEqual(afterFailure.body.records, initial.body.records); assert.deepEqual(afterFailure.body.rates, initial.body.rates); assert.equal(afterFailure.body.alarm, initial.body.alarm);
                assert.equal(afterFailure.body.control.tripped.mode, 'second-delete'); assert.equal(afterFailure.body.control.tripped.scope, 'transaction');
                assert.deepEqual(afterFailure.body.control.events.filter(event => event.operation === 'delete' && event.batch).map(event => event.batch), [128, 128]);
                const retry = await call(backend, name, name === 'prune-register' ? 'register' : 'direct-prune'); assert.equal(retry.status, 200);
                const afterRetry = await call(backend, name, 'inspect'); assert.equal(afterRetry.status, 200);
                assert.equal(afterRetry.body.records.length, name === 'prune-register' ? 2 : 1);
                assert.ok(afterRetry.body.records.some(([key]) => key === 'session:native-still-live-session-0001'));
                assert.equal(afterRetry.body.rates['B'.repeat(22)].count, 3);
                if (name === 'prune-register') assert.equal(afterRetry.body.rates['A'.repeat(22)].count, 1);
                else assert.equal(afterRetry.body.rates['A'.repeat(22)], undefined);
                assert.deepEqual(afterRetry.body.control.events.filter(event => event.operation === 'delete' && event.batch).map(event => event.batch), [128, 128, 128, 128, 15]);
                // Keep receipts bounded: assert every seeded row, then store only
                // source-bound counts and digests rather than print 2,720 rows.
                const digestRows = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
                results[backend][name] = { failed, retry, baselineRows: initial.body.records.length, afterFailureRows: afterFailure.body.records.length,
                    baselineDigest: digestRows(initial.body.records), afterFailureDigest: digestRows(afterFailure.body.records), afterRetryRows: afterRetry.body.records.length,
                    baselineRates: initial.body.rates, afterFailureRates: afterFailure.body.rates, afterRetryRates: afterRetry.body.rates,
                    baselineAlarm: initial.body.alarm, afterFailureAlarm: afterFailure.body.alarm, afterRetryAlarm: afterRetry.body.alarm,
                    fault: afterFailure.body.control.tripped, deleteBatches: afterRetry.body.control.events.filter(event => event.operation === 'delete' && event.batch).map(event => event.batch), objectId: initial.body.objectId };
                checks.push({ name: `${backend}-real-${name}-271-expired-rollback-and-bounded-retry`, pass: true });
            }
        }
        assert.equal(outboundCalls, 0); assert.equal(runtimeRestarts, 0); assert.deepEqual(sources(), before);
        proof = { versions, binarySha256, compatibilityDate: '2026-10-01', results, checks, admissionDenials: negativeRequests.length, sources: before, outboundCalls, runtimeRestarts,
            node: process.version, platform: process.platform, architecture: process.arch,
            scope: 'Actual imported BetaSessions registration and prune on local SQLite and legacy KV; injected post-native-write faults prove rollback and bounded retries. No betaFetch/cookies/Access/socket/revoke-cross-object/hosted/deployment qualification.' };
        const acknowledged = new Promise((resolve, reject) => process.once('message', message => {
            try { assert.deepEqual(message, { type: 'cleanup-approved', nonce }); resolve(); } catch (error) { reject(error); }
        }));
        await new Promise((resolve, reject) => process.send({ type: 'proof', nonce, proof }, error => error ? reject(error) : resolve()));
        await acknowledged;
    } catch (error) {
        if (process.connected) await new Promise(resolve => process.send({ type: 'failure', nonce, error: String(error.stack || error).slice(0, 16384) }, resolve));
        throw error;
    } finally { await mf.dispose(); }
    assert.deepEqual(sources(), before); assert.equal(hash(workerd.default), binarySha256);
    await new Promise((resolve, reject) => process.send({ type: 'result', nonce, proof, miniflareDisposed: true }, error => error ? reject(error) : resolve()));
    process.off('disconnect', disconnected); process.disconnect();
}
async function parent() {
    assert.equal(process.argv.length, 2); assert.ok(['darwin', 'linux'].includes(process.platform));
    const before = sources(), state = realpathSync(await mkdtemp(join(tmpdir(), 'webjam-beta-lifecycle-'))), nonce = randomBytes(16).toString('hex');
    let proc, timer, receipt, captured, live = false, interrupted;
    const interrupt = signal => { interrupted ||= Error(`interrupted ${signal}`); if (live) kill(proc?.pid); };
    process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
    try {
        proc = spawn(process.execPath, [FILE, '--isolated', state, nonce], { cwd: HERE, env: Object.fromEntries(ENV.filter(name => typeof process.env[name] === 'string').map(name => [name, process.env[name]])), detached: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] }); live = true;
        let stdout = '', stderr = '', proof, result;
        await new Promise((resolve, reject) => {
            const fail = error => { clearTimeout(timer); if (live) kill(proc.pid); reject(error); };
            const append = (value, chunk) => { const next = value + chunk; if (next.length > 262144) { fail(Error('bounded logs exceeded')); return value; } return next; };
            proc.stdout.on('data', chunk => { stdout = append(stdout, chunk.toString()); }); proc.stderr.on('data', chunk => { stderr = append(stderr, chunk.toString()); });
            timer = setTimeout(() => fail(Error(`45s API proof timeout; no restart\n${stderr}`)), 45000); proc.on('error', fail);
            proc.on('message', message => { try {
                assert.equal(message.nonce, nonce); if (message.type === 'failure') throw Error(message.error);
                if (message.type === 'proof') {
                    assert.equal(proof, undefined); assert.deepEqual(message.proof.sources, before); proof = message.proof;
                    captured = group(proc.pid); assert.ok(captured.some(row => row.command.includes('workerd')));
                    proc.send({ type: 'cleanup-approved', nonce }, error => { if (error) fail(error); });
                } else { assert.equal(message.type, 'result'); assert.equal(result, undefined); assert.deepEqual(message.proof, proof); assert.equal(message.miniflareDisposed, true); result = message; }
            } catch (error) { fail(error); } });
            proc.on('close', async (code, signal) => { clearTimeout(timer); try {
                await stopped(proc.pid); live = false; if (interrupted) throw interrupted;
                assert.ok(result, `missing result at exit ${code}/${signal}\n${stderr}\n${stdout}`); assert.equal(code, 0); assert.equal(signal, null);
                receipt = { localNativeLifecycleQualified: true, ...result, processesBeforeCleanup: captured, childExitCode: code, noLiveOwnedProcesses: true, stdout, stderr }; resolve();
            } catch (error) { reject(error); } });
        });
        assert.deepEqual(sources(), before);
    } finally {
        clearTimeout(timer); if (live && proc?.pid) { kill(proc.pid); await stopped(proc.pid); }
        assert.equal(realpathSync(state), state); await rm(state, { recursive: true });
        process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
    }
    if (interrupted) throw interrupted;
    console.log(JSON.stringify({ ...receipt, temporaryStateRemoved: true }, null, 2));
}
try { if (process.argv[2] === '--isolated' && process.argv.length === 5) await child(process.argv[3], process.argv[4]); else await parent(); }
catch (error) { console.error(error.stack || error); process.exitCode = 1; }
