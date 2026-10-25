// Local-only qualification. The parent imports no third-party modules and
// starts every runtime with a credential-free environment and an owned PGID.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, realpathSync, lstatSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const FILE = fileURLToPath(import.meta.url), ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const ENV_KEYS = ['PATH', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'SYSTEMROOT', 'WINDIR'];
const QUALIFY = ['outbound-egress-denied', 'utf8-chunk-roundtrip', 'mid-chunk-rollback', 'caught-failure-poisons-transaction',
    'final-authority-rollback', 'shrink-delete-no-orphans', 'corruption-denied', 'bounded-prefix-pagination', 'recovery-baseline-committed'];
const RECOVER = ['committed-baseline-survives-runtime-kill', 'uncommitted-overwrite-and-new-record-rolled-back', 'committed-multichunk-record-survives-runtime-kill'];
const sha = value => createHash('sha256').update(value).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function sources() {
    return Object.fromEntries(['worker.mjs', 'runner.mjs', 'package.json', 'package-lock.json', '../../../hangout-worker/src/durable-record-storage.mjs']
        .map(name => [name, sha(readFileSync(new URL(name, import.meta.url)))]));
}
function group(pid) {
    const all = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,stat=,comm='], { encoding: 'utf8', timeout: 3000 })
        .trim().split('\n').map(line => {
            const fields = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
            return fields && { pid: +fields[1], ppid: +fields[2], pgid: +fields[3], state: fields[4], command: basename(fields[5]) };
        }).filter(Boolean);
    return all.filter(row => row.pgid === pid && !row.state.startsWith('Z'));
}
async function stopped(pid) {
    for (let n = 0; n < 40; n++) { if (!group(pid).length) return; await delay(25); }
    assert.fail('owned runtime group still has live processes; recovery refused');
}
function checks(report, expected) {
    assert.equal(report.ok, true, report.error || 'worker refused qualification');
    assert.equal(report.sqlite?.enabled, true);
    assert.deepEqual(report.checks.map(c => c.name), expected);
    assert.ok(report.checks.every(c => c.pass === true));
    assert.match(report.objectId, /^[a-f0-9]{64}$/);
}
function sizeObservation(probe) {
    assert.deepEqual(Object.keys(probe).sort(), ['attemptedBytes', 'error', 'hostedLimitQualified', 'hostedLimitStatus', 'nativeRejected', 'rawOversizeAccepted']);
    assert.equal(probe.attemptedBytes, 3 * 1024 * 1024);
    assert.equal(typeof probe.nativeRejected, 'boolean');
    assert.equal(probe.rawOversizeAccepted, !probe.nativeRejected);
    assert.equal(typeof probe.error, 'string'); assert.ok(probe.error.length <= 240);
    assert.equal(probe.hostedLimitQualified, false);
    assert.equal(probe.hostedLimitStatus, 'unsupported-by-pinned-local-runtime');
}

async function child(phase, state, nonce) {
    assert.ok(['qualify', 'crash', 'recover'].includes(phase));
    assert.match(nonce, /^[a-f0-9]{32}$/);
    assert.ok(lstatSync(state).isDirectory() && !lstatSync(state).isSymbolicLink());
    assert.equal(realpathSync(state), state);
    assert.match(basename(state), /^webjam-durable-runtime-[A-Za-z0-9]{6}$/);
    // macOS itself adds this locale variable even when spawn receives an
    // otherwise empty environment. It is never inherited from the caller.
    const childKeys = process.platform === 'darwin' ? [...ENV_KEYS, '__CF_USER_TEXT_ENCODING'] : ENV_KEYS;
    const unexpected = Object.keys(process.env).filter(key => !childKeys.includes(key));
    assert.equal(unexpected.length, 0, `unexpected inherited environment names: ${JSON.stringify(unexpected)}`);
    assert.equal(typeof process.send, 'function', 'private parent IPC required');
    assert.ok(group(process.pid).some(row => row.pid === process.pid), 'isolated child must own its process group');
    const require = createRequire(import.meta.url);
    const { Miniflare, convertV4MiniflareOptions, Log, LogLevel } = await import('miniflare');
    const workerd = require('workerd');
    const versions = Object.fromEntries(['miniflare', 'workerd', 'undici'].map(name => [name,
        JSON.parse(readFileSync(new URL(`node_modules/${name}/package.json`, import.meta.url), 'utf8')).version]));
    assert.deepEqual(versions, { miniflare: '5.20261019.2-beta', workerd: '1.20261019.1', undici: '7.30.1' });
    assert.equal(workerd.compatibilityDate, '2026-10-19');
    const binaryHash = sha(readFileSync(workerd.default)), before = sources(), logs = [];
    let outboundCalls = 0, gateCalls = 0, runtimeRestarts = 0, finished = false;
    const disconnected = () => { if (!finished) { try { process.kill(-process.pid, 'SIGKILL'); } catch {} } };
    process.on('disconnect', disconnected);
    const options = convertV4MiniflareOptions({
        name: 'webjam-local-durable-proof', rootPath: ROOT, modulesRoot: ROOT,
        modules: [
            { type: 'ESModule', path: join(dirname(FILE), 'worker.mjs') },
            { type: 'ESModule', path: join(ROOT, 'hangout-worker/src/durable-record-storage.mjs') }
        ], compatibilityDate: '2026-10-01',
        host: '127.0.0.1', port: 0, inspectorHost: '127.0.0.1', inspectorPort: 0,
        resourcePersistencePath: join(state, 'persist'), resourceTmpPath: join(state, `runtime-${phase}`),
        durableObjects: { RECORDS: { className: 'RecordFixture', useSQLite: true } },
        bindings: { FIXTURE_NONCE: nonce },
        cf: false, telemetry: { enabled: false }, unsafeRegisterWorker: false, unsafeRuntimeEnv: {},
        unsafeHandleRuntimeRestart: () => { runtimeRestarts++; },
        log: new Log(LogLevel.ERROR), logRequests: false,
        outboundService: () => { outboundCalls++; return new Response('local test egress denied', { status: 503, headers: { 'X-WebJam-Test-Egress': 'denied' } }); },
        serviceBindings: { GATE: () => { gateCalls++; return new Promise(() => {}); } },
        handleStructuredLogs: entry => {
            const message = String(entry.message);
            if (logs.join('').length < 65536) logs.push(message.slice(0, 8192));
            if (phase === 'crash' && message.includes(`WEBJAM_DURABLE_STAGED:${nonce}`))
                process.send({ type: 'staged', phase, nonce, pid: process.pid, marker: `WEBJAM_DURABLE_STAGED:${nonce}`,
                    sources: before, versions, workerdBinarySha256: binaryHash, runtimeRestarts, outboundCalls });
        }
    });
    // Inspect the translated API, rather than relying on old v4 persistence
    // option names that this pinned v5 release no longer accepts.
    assert.equal(options.resourcePersistencePath, join(state, 'persist'));
    options.unsafeEnableSharedStorage = false;
    const mf = new Miniflare(options);
    const request = async name => {
        const response = await mf.dispatchFetch('http://local-fixture.invalid/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phase: name, nonce }) });
        const report = await response.json();
        assert.equal(response.status, 200, JSON.stringify(report));
        assert.equal(report.phase, name); assert.equal(report.nonce, nonce);
        return report;
    };
    try {
        const url = await mf.ready;
        assert.equal(url.hostname, '127.0.0.1');
        if (phase === 'crash') { await request('crash'); assert.fail('crash phase unexpectedly returned'); }
        if (phase === 'qualify') {
            const badNonce = (nonce[0] === 'a' ? 'b' : 'a') + nonce.slice(1);
            for (const [token, headers] of [[badNonce, { 'Content-Type': 'application/json' }],
                [nonce, { 'Content-Type': 'text/plain' }], [nonce, { 'Content-Type': 'application/json', Origin: 'https://untrusted-test.invalid' }]]) {
                const denied = await mf.dispatchFetch('http://local-fixture.invalid/', { method: 'POST', headers,
                    body: JSON.stringify({ phase: 'qualify', nonce: token }) });
                assert.equal(denied.status, 403, 'loopback fixture admitted an unauthorized browser-style request');
                await denied.body?.cancel();
            }
        }
        const report = await request(phase);
        checks(report, phase === 'qualify' ? QUALIFY : RECOVER);
        let counters;
        if (phase === 'qualify') {
            // An accepted local raw value is an observation, never a passing
            // hosted-limit control. No wrapper/config cap may simulate one.
            sizeObservation(report.sizeProbe);
            const concurrent = await Promise.all(Array.from({ length: 8 }, () => request('increment')));
            concurrent.forEach(result => { checks(result, ['actual-async-counter-transaction']); assert.equal(result.objectId, report.objectId); });
            counters = concurrent.map(result => result.counter).sort((a, b) => a - b);
            assert.deepEqual(counters, [1, 2, 3, 4, 5, 6, 7, 8]);
        } else assert.equal(report.counter, 8);
        assert.equal(outboundCalls, phase === 'qualify' ? 1 : 0, 'unexpected external fetch attempted');
        assert.equal(gateCalls, 0, 'unexpected crash gate call');
        assert.equal(runtimeRestarts, 0, 'unexpected automatic workerd restart');
        await mf.dispose();
        assert.deepEqual(sources(), before, 'qualification source changed during execution');
        assert.equal(sha(readFileSync(workerd.default)), binaryHash);
        await new Promise((resolve, reject) => process.send({ type: 'result', phase, nonce, report, counters, versions,
            workerdBinarySha256: binaryHash, compatibilityDate: '2026-10-01', sources: before,
            environmentNames: Object.keys(process.env).sort(), outboundCalls, gateCalls, runtimeRestarts,
            loopbackAdmissionDenials: phase === 'qualify' ? 3 : 0, logs }, error => error ? reject(error) : resolve()));
    } catch (error) {
        // Report a real startup/test failure before a failed runtime's dispose
        // can stall. The parent stops the entire owned group and never retries.
        if (process.connected) await new Promise(resolve => process.send({ type: 'failure', phase, nonce,
            error: String(error?.stack || error).slice(0, 16384) }, () => resolve()));
        throw error;
    } finally { await mf.dispose(); }
    finished = true;
    process.off('disconnect', disconnected);
    process.disconnect();
}

async function parent() {
    assert.equal(process.argv.length, 2, 'this command accepts no user paths or options');
    assert.ok(['darwin', 'linux'].includes(process.platform), 'whole-runtime crash qualification currently requires macOS or Linux');
    const state = realpathSync(await mkdtemp(join(tmpdir(), 'webjam-durable-runtime-'))), nonce = randomBytes(16).toString('hex');
    const before = sources(), results = [], live = new Set();
    let interrupted = null;
    const interrupt = signal => {
        interrupted ||= Error(`qualification interrupted by ${signal}`);
        for (const pid of live) { try { process.kill(-pid, 'SIGKILL'); } catch {} }
    };
    process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
    async function run(phase) {
        if (interrupted) throw interrupted;
        const env = Object.fromEntries(ENV_KEYS.filter(key => typeof process.env[key] === 'string').map(key => [key, process.env[key]]));
        const proc = spawn(process.execPath, [FILE, '--isolated-phase', phase, state, nonce], { cwd: ROOT, env,
            detached: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
        live.add(proc.pid);
        let stdout = '', stderr = '', result = null, staged = false, crash = null;
        return new Promise((resolve, reject) => {
            let timer;
            const abort = error => { clearTimeout(timer); try { process.kill(-proc.pid, 'SIGKILL'); } catch {} reject(error); };
            const append = (old, data) => {
                const value = old + data.toString();
                if (value.length > 256 * 1024) { abort(Error('bounded child logs exceeded')); return old; }
                return value;
            };
            proc.stdout.on('data', data => { stdout = append(stdout, data); });
            proc.stderr.on('data', data => { stderr = append(stderr, data); });
            timer = setTimeout(() => abort(Error(`local ${phase} qualification timed out; no restart:\n${stderr.slice(0, 3000)}\n${stderr.slice(-3000)}`)), 45000);
            proc.on('error', abort);
            proc.on('message', message => {
                try {
                    assert.equal(message.phase, phase); assert.equal(message.nonce, nonce);
                    if (message.type === 'failure') throw Error(message.error);
                    if (message.type === 'result') { assert.equal(result, null); result = message; }
                    else {
                        assert.equal(message.type, 'staged'); assert.equal(phase, 'crash'); assert.equal(staged, false);
                        assert.equal(message.pid, proc.pid); assert.equal(message.marker, `WEBJAM_DURABLE_STAGED:${nonce}`);
                        assert.deepEqual(message.sources, results[0].sources); assert.deepEqual(message.versions, results[0].versions);
                        assert.equal(message.workerdBinarySha256, results[0].workerdBinarySha256);
                        assert.equal(message.runtimeRestarts, 0); assert.equal(message.outboundCalls, 0);
                        const owned = group(proc.pid);
                        assert.ok(owned.some(p => p.pid === proc.pid));
                        assert.ok(owned.some(p => p.command.includes('workerd')), 'actual workerd process required before crash');
                        staged = true; crash = { marker: message.marker, processesBeforeKill: owned, signal: 'SIGKILL',
                            sources: message.sources, versions: message.versions, workerdBinarySha256: message.workerdBinarySha256, runtimeRestarts: message.runtimeRestarts };
                        process.kill(-proc.pid, 'SIGKILL');
                    }
                } catch (error) { abort(error); }
            });
            proc.on('close', async (code, signal) => {
                clearTimeout(timer);
                try {
                    await stopped(proc.pid); live.delete(proc.pid);
                    if (interrupted) throw interrupted;
                    if (phase === 'crash') {
                        assert.ok(staged && crash, `runtime terminated before staged-write proof: ${stderr}`);
                        assert.equal(signal, 'SIGKILL'); assert.equal(result, null);
                        resolve({ phase, crash, noLiveGroupMembersAfterKill: true, stdout, stderr });
                    } else {
                        assert.equal(code, 0, `${phase} failed: ${stderr}\n${stdout}`); assert.ok(result, 'successful exit without qualified result');
                        resolve({ ...result, stdout, stderr, noLiveGroupMembersAfterDispose: true });
                    }
                } catch (error) { reject(error); }
            });
        });
    }
    let receipt;
    try {
        results.push(await run('qualify')); results.push(await run('crash')); results.push(await run('recover'));
        assert.equal(results[0].report.objectId, results[2].report.objectId, 'recovery used a different Durable Object');
        assert.ok(results[0].report.record.bytes > 3 * 1024 * 1024 && results[0].report.record.chunks > 32);
        assert.deepEqual(results[2].report.multiRecord, { bytes: results[0].report.record.bytes, sha256: results[0].report.record.sha256 });
        assert.deepEqual(results[0].sources, before);
        assert.deepEqual(results[0].sources, results[2].sources);
        assert.deepEqual(results[0].versions, results[2].versions);
        assert.equal(results[0].workerdBinarySha256, results[2].workerdBinarySha256);
        assert.equal(results[0].compatibilityDate, results[2].compatibilityDate);
        assert.deepEqual(sources(), before);
        receipt = { localMappingQualified: true, hostedLimitQualified: false,
            hostedLimitStatus: 'unsupported-by-pinned-local-runtime', rawOversizeAccepted: results[0].report.sizeProbe.rawOversizeAccepted,
            node: process.version, platform: process.platform, architecture: process.arch,
            nonce, results, scope: 'Pinned local workerd SQLite record mapping, eight concurrent callers and whole-runtime crash recovery only; no hosted size-limit enforcement, replication, PITR, authority/key, capacity, native audio or release qualification. Concurrent success does not prove callbacks retried.' };
    } finally {
        for (const pid of live) { try { process.kill(-pid, 'SIGKILL'); } catch {} await stopped(pid); }
        assert.equal(realpathSync(state), state); assert.ok(!lstatSync(state).isSymbolicLink());
        await rm(state, { recursive: true });
        process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
        if (!receipt) console.error('Local runtime qualification failed; no passing receipt was emitted.');
    }
    if (interrupted) throw interrupted;
    console.log(JSON.stringify(receipt, null, 2));
}

try {
    if (process.argv[2] === '--isolated-phase' && process.argv.length === 6)
        await child(process.argv[3], process.argv[4], process.argv[5]);
    else await parent();
} catch (error) { console.error(error?.stack || String(error)); process.exitCode = 1; }
