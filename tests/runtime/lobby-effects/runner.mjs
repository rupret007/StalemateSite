import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { assertNativeLobbySourceCatalogue } from './source-catalogue.mjs';
const FILE = fileURLToPath(import.meta.url), HERE = dirname(FILE);
const TOOLS = fileURLToPath(new URL('../durable-records/', import.meta.url));
const APP = fileURLToPath(new URL('../../../', import.meta.url));
const ENV = ['PATH', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'SYSTEMROOT', 'WINDIR'];
function rolldownBindingPackage() {
    if (process.platform === 'darwin' && process.arch === 'arm64') return '@rolldown/binding-darwin-arm64';
    if (process.platform === 'linux' && process.arch === 'x64') {
        assert.equal(typeof process.report?.getReport().header.glibcVersionRuntime, 'string', 'Linux proof requires GNU libc');
        return '@rolldown/binding-linux-x64-gnu';
    }
    assert.fail('Native Lobby proof supports only macOS ARM64 and Linux x64 GNU libc');
}

const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const sources = () => Object.fromEntries([
    ['fixture/runner.mjs', FILE], ['fixture/worker.mjs', join(HERE, 'worker.mjs')],
    ['fixture/source-catalogue.mjs', join(HERE, 'source-catalogue.mjs')],
    ...['lobby-core.mjs', 'lobby-effect-records.mjs', 'durable-record-storage.mjs', 'community-state.mjs', 'filter.mjs', 'lobby-act.mjs', 'message-receipts.mjs', 'transport-budget.mjs', 'participation-checkpoint.mjs', 'lobby-incident-sources.mjs', 'incident-cases.mjs'].map(name => [`application/${name}`, join(APP, 'hangout-worker/src', name)]),
    ...['r/45662413410ed051/sync-core.js', 'r/45662413410ed051/entry-sites.mjs', 'package.json', 'package-lock.json', 'hangout-worker/wrangler.beta.toml', 'node_modules/rolldown/package.json', 'node_modules/obscenity/package.json'].map(name => [`application/${name}`, join(APP, name)]),
    ...['package.json', 'package-lock.json'].map(name => [`tools/${name}`, join(TOOLS, name)])
].map(([name, path]) => [name, hash(path)]));
const group = pid => execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,stat=,comm='], { encoding: 'utf8', timeout: 3000 }).trim().split('\n').map(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
    return match && { pid: +match[1], pgid: +match[3], state: match[4], command: basename(match[5]) };
}).filter(row => row && row.pgid === pid && !row.state.startsWith('Z'));
const kill = pid => { if (Number.isInteger(pid) && pid > 1) try { process.kill(-pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
async function stopped(pid) { for (let n = 0; n < 40; n++) { if (!group(pid).length) return; await new Promise(resolve => setTimeout(resolve, 25)); } assert.fail('owned runtime group still live'); }
async function child(state, nonce) {
    assert.equal(realpathSync(state), state); assert.match(basename(state), /^webjam-lobby-native-[A-Za-z0-9]{6}$/); assert.match(nonce, /^[a-f0-9]{32}$/);
    assert.equal(typeof process.send, 'function'); assert.ok(group(process.pid).some(row => row.pid === process.pid));
    const disconnected = () => kill(process.pid); process.on('disconnect', disconnected);
    assert.deepEqual(Object.keys(process.env).filter(name => ![...ENV, ...(process.platform === 'darwin' ? ['__CF_USER_TEXT_ENCODING'] : [])].includes(name)), []);
    const require = createRequire(join(TOOLS, 'package.json'));
    const { Miniflare, convertV4MiniflareOptions, Log, LogLevel } = await import(pathToFileURL(require.resolve('miniflare')).href);
    const versions = Object.fromEntries(['miniflare', 'workerd', 'undici'].map(name => [name, JSON.parse(readFileSync(join(TOOLS, 'node_modules', name, 'package.json'))).version]));
    assert.deepEqual(versions, { miniflare: '5.20261019.2-beta', workerd: '1.20261019.1', undici: '7.30.1' });
    const workerd = require('workerd'), binarySha256 = hash(workerd.default), before = sources();
    assert.equal(workerd.compatibilityDate, '2026-10-19');
    const betaGlobal = readFileSync(join(APP, 'hangout-worker/wrangler.beta.toml'), 'utf8').split(/^\s*\[/m, 1)[0];
    assert.match(betaGlobal, /^compatibility_date\s*=\s*"2026-10-01"\s*$/m);
    assert.doesNotMatch(betaGlobal, /^\s*compatibility_flags\s*=/m);
    const appRequire = createRequire(join(APP, 'package.json'));
    const rolldownVersion = JSON.parse(readFileSync(appRequire.resolve('rolldown/package.json'))).version;
    assert.equal(rolldownVersion, '1.2.14');
    const bindingFile = appRequire.resolve(rolldownBindingPackage());
    const rolldownBindingSha256 = hash(bindingFile);
    const { rolldown } = await import(pathToFileURL(appRequire.resolve('rolldown')).href);
    const bundleInputs = {};
    const bundler = await rolldown({ input: join(HERE, 'worker.mjs'), platform: 'neutral', external: ['node:crypto'],
        plugins: [{ name: 'owned-input-digests', transform(code, id) {
            if (id.startsWith('\0')) return null;
            const path = realpathSync(id), sha256 = createHash('sha256').update(code).digest('hex');
            assert.equal(hash(path), sha256, `bundle input differs from source file: ${path}`);
            bundleInputs[path] = sha256; return null;
        } }] });
    let generated;
    try { generated = await bundler.generate({ format: 'esm', codeSplitting: false, sourcemap: false }); }
    finally { await bundler.close(); }
    assert.equal(generated.output.length, 1); assert.equal(generated.output[0].type, 'chunk');
    assert.ok(generated.output[0].imports.includes('node:crypto'));
    assert.ok(generated.output[0].imports.every(name => name === 'node:crypto'));
    const bundleCode = generated.output[0].code, bundleSha256 = createHash('sha256').update(bundleCode).digest('hex');
    const sourceCatalogue = assertNativeLobbySourceCatalogue(Object.keys(bundleInputs), {
        fixtureWorker: realpathSync(join(HERE, 'worker.mjs')), applicationRoot: realpathSync(APP),
        obscenityRoot: realpathSync(join(APP, 'node_modules/obscenity'))
    });
    for (const [path, sha256] of Object.entries(bundleInputs)) assert.equal(hash(path), sha256);
    let outboundCalls = 0, runtimeRestarts = 0, proof;
    const options = convertV4MiniflareOptions({
        name: 'webjam-lobby-effect-native', rootPath: state, modulesRoot: state, modules: [{ type: 'ESModule', path: join(state, 'bundle.mjs'), contents: bundleCode }],
        compatibilityDate: '2026-10-01', compatibilityFlags: [], host: '127.0.0.1', port: 0, inspectorHost: '127.0.0.1', inspectorPort: 0,
        resourcePersistencePath: join(state, 'persist'), resourceTmpPath: join(state, 'runtime'),
        durableObjects: { RECORDS: { className: 'LobbyProof', useSQLite: true } },
        bindings: { FIXTURE_NONCE: nonce }, outboundService: () => { outboundCalls++; return new Response('denied', { status: 503 }); },
        cf: false, telemetry: { enabled: false }, unsafeRegisterWorker: false, unsafeRuntimeEnv: {},
        unsafeHandleRuntimeRestart: () => { runtimeRestarts++; }, log: new Log(LogLevel.ERROR), logRequests: false
    });
    options.unsafeEnableSharedStorage = false;
    let mf = new Miniflare(options), firstWorkerdPids = [], secondWorkerdPids = [];
    const at = Date.now();
    const call = async phase => {
        const response = await mf.dispatchFetch('http://local-fixture.invalid/', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Fixture-Nonce': nonce }, body: JSON.stringify({ phase, at }) });
        const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); return body;
    };
    try {
        assert.equal((await mf.ready).hostname, '127.0.0.1');
        for (const headers of [{ 'Content-Type': 'application/json', 'X-Fixture-Nonce': `${nonce}wrong` }, { 'Content-Type': 'application/json', 'X-Fixture-Nonce': nonce, Origin: 'https://untrusted.invalid' }, { 'Content-Type': 'text/plain', 'X-Fixture-Nonce': nonce }]) {
            const response = await mf.dispatchFetch('http://local-fixture.invalid/', { method: 'POST', headers, body: JSON.stringify({ phase: 'qualify', at }) });
            assert.equal(response.status, 403); await response.body?.cancel();
        }
        const qualified = await call('qualify');
        assert.deepEqual([...qualified.main.checks, ...qualified.logs.checks], [
            { name: 'actual-engine-effects-native-commit', pass: true },
            { name: 'actual-native-room-manifest-fault-rolls-back', pass: true },
            { name: 'native-2000-log-segments-read-rollback-append', pass: true }
        ]);
        firstWorkerdPids = group(process.pid).filter(row => row.command.includes('workerd')).map(row => row.pid); assert.ok(firstWorkerdPids.length);
        await mf.dispose();
        assert.ok(group(process.pid).every(row => !firstWorkerdPids.includes(row.pid)), 'first workerd process still live after dispose');
        mf = new Miniflare({ ...options, resourceTmpPath: join(state, 'runtime-recovery') });
        assert.equal((await mf.ready).hostname, '127.0.0.1');
        secondWorkerdPids = group(process.pid).filter(row => row.command.includes('workerd')).map(row => row.pid);
        assert.ok(secondWorkerdPids.length && secondWorkerdPids.every(pid => !firstWorkerdPids.includes(pid)));
        const recovered = await call('recover');
        for (const name of ['main', 'logs']) { assert.equal(recovered[name].objectId, qualified[name].objectId); assert.equal(recovered[name].digest, qualified[name].digest); }
        assert.equal(recovered.logs.logs, 2000); assert.equal(recovered.main.rooms, 1); assert.ok(recovered.logs.physicalReadCalls < 4096);
        assert.equal(outboundCalls, 0); assert.equal(runtimeRestarts, 0); assert.deepEqual(sources(), before);
        for (const [path, sha256] of Object.entries(bundleInputs)) assert.equal(hash(path), sha256);
        assert.equal(hash(bindingFile), rolldownBindingSha256);
        const checks = [...qualified.main.checks, ...qualified.logs.checks, { name: 'fresh-workerd-process-recovers-exact-domain-digests', pass: true }];
        proof = { versions, binarySha256, compatibilityDate: '2026-10-01', compatibilityFlags: [], qualified, recovered, checks,
            rolldownVersion, rolldownBindingSha256, bundleSha256, bundleInputs, sourceCatalogue, firstWorkerdPids, secondWorkerdPids, admissionDenials: 3,
            sources: before, outboundCalls, runtimeRestarts, node: process.version, platform: process.platform, architecture: process.arch,
            scope: 'Actual source-engine effect generation and domain mapper/codec on local SQLite workerd at the beta date/empty flags; two fresh native processes and deliberate post-write faults. Pure engine capture is not C3 output staging or trusted session/guardian authority. Only the executing supported platform is qualified; no Windows/hosted limits/cost/recovery/deployment qualification.' };
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
    assert.equal(process.argv.length, 2); rolldownBindingPackage();
    const before = sources(), state = realpathSync(await mkdtemp(join(tmpdir(), 'webjam-lobby-native-'))), nonce = randomBytes(16).toString('hex');
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
                receipt = { localNativeLobbyEffectsQualified: true, ...result, processesBeforeCleanup: captured, childExitCode: code, noLiveOwnedProcesses: true, stdout, stderr }; resolve();
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
catch (error) {
    // Bundling/catalogue failures happen before Miniflare's try/finally. Report
    // them through the same bounded IPC failure path instead of leaving the
    // parent to discover an idle child at its unchanged45s deadline.
    if (process.argv[2] === '--isolated' && process.connected) await new Promise(resolve =>
        process.send({ type: 'failure', nonce: process.argv[4], error: String(error.stack || error).slice(0, 16384) }, resolve));
    console.error(error.stack || error); process.exitCode = 1;
}
