// Local native regression only. Never deploy the fixture Worker.
// Parent uses builtins only; runtime children inherit no account credentials.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync, lstatSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const FILE = fileURLToPath(import.meta.url), HERE = dirname(FILE);
const APP = fileURLToPath(new URL('../../../', import.meta.url));
const TOOLS = fileURLToPath(new URL('../durable-records/', import.meta.url));
const ORIGIN = 'https://local-fixture.invalid', INVITE = 'owned-fixture-invite-not-a-production-credential-2026', PREVIEW = 'owned-fixture-preview-token-20261025';
const ENV = ['PATH', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'SYSTEMROOT', 'WINDIR'];
const PARTICIPATION = process.argv.includes('--participation'), INCIDENT = process.argv.includes('--incident-sources'), TRAFFIC_ACKS = process.argv.includes('--traffic-acks'), PRESSURE_ONLY = process.argv.includes('--pressure-only'), DIAGNOSE_CLOSE = process.argv.includes('--diagnose-close'), FANOUT_50 = process.argv.includes('--fanout-50'), PROVIDER_START = process.argv.includes('--provider-start');
const MODE = [...(PARTICIPATION ? ['--participation'] : []), ...(INCIDENT ? ['--incident-sources'] : []), ...(TRAFFIC_ACKS ? ['--traffic-acks'] : []), ...(PRESSURE_ONLY ? ['--pressure-only'] : []), ...(DIAGNOSE_CLOSE ? ['--diagnose-close'] : []), ...(FANOUT_50 ? ['--fanout-50'] : []), ...(PROVIDER_START ? ['--provider-start'] : [])];
const RETENTION_PROOF = PARTICIPATION && !INCIDENT && !TRAFFIC_ACKS && !PRESSURE_ONLY && !DIAGNOSE_CLOSE && !FANOUT_50 && !PROVIDER_START;
assert.ok(!TRAFFIC_ACKS || PARTICIPATION && !INCIDENT, '--traffic-acks requires --participation and does not select incident mode');
assert.ok(!PRESSURE_ONLY || PARTICIPATION && !INCIDENT && !TRAFFIC_ACKS, '--pressure-only requires --participation and refuses incident/traffic flags');
assert.ok(!DIAGNOSE_CLOSE || PARTICIPATION && TRAFFIC_ACKS && !INCIDENT && !PRESSURE_ONLY, '--diagnose-close is an explicit traffic-ACK-only diagnostic');
assert.ok(!FANOUT_50 || PARTICIPATION && !INCIDENT && !TRAFFIC_ACKS && !PRESSURE_ONLY && !DIAGNOSE_CLOSE, '--fanout-50 requires only --participation');
assert.ok(!PROVIDER_START || PARTICIPATION && !INCIDENT && !TRAFFIC_ACKS && !PRESSURE_ONLY && !DIAGNOSE_CLOSE && !FANOUT_50, '--provider-start requires only --participation');
const FANOUT_PREFIX = 'Fanout fifty ephemeral marker ';
const PRESSURE_PREFIX = 'Pressure probe ephemeral marker ';
const TRAFFIC_PREFIX = 'ACK probe ephemeral marker ';
const latencySummary = values => {
    assert.ok(values.length > 0 && values.length <= 2000 && values.every(value => Number.isFinite(value) && value >= 0));
    const sorted = [...values].sort((a, b) => a - b), at = fraction => +sorted[Math.ceil(sorted.length * fraction) - 1].toFixed(3);
    return { samples: sorted.length, p50Ms: at(.5), p95Ms: at(.95), p99Ms: at(.99), maxMs: +sorted.at(-1).toFixed(3) };
};
const OWN_KEYS = ['available', 'canStop', 'ok', 'purposes', 'reason', 'revision', 'state'].sort();
const OWN_PURPOSES = ['public-text', 'public-artifact', 'public-disclosure', 'room-creation', 'room-registration', 'direct-contact', 'camera', 'audio', 'media-reception', 'external-provider', 'ai-public-review'].sort();
const EPHEMERAL_BODY_MARKERS = ['Native Stalemate ephemeral greeting', 'Native Rad Dad ephemeral greeting', 'Native remaining visitor greeting', 'native-media-control-no-body-persistence', ...(TRAFFIC_ACKS ? [TRAFFIC_PREFIX] : []), ...(PRESSURE_ONLY ? [PRESSURE_PREFIX] : [])].sort();
function assertNativeRollback(witness, record) {
    assert.deepEqual(Object.keys(witness).sort(), ['record', 'originalSha256', 'stagedSha256', 'restoredSha256', 'nativeWriteCompleted', 'stagedChanged', 'nativeTransactionRejected', 'restoredBeforeEngineRecovery'].sort());
    assert.equal(witness.record, record);
    for (const key of ['originalSha256', 'stagedSha256', 'restoredSha256']) assert.match(witness[key], /^[a-f0-9]{64}$/);
    assert.notEqual(witness.stagedSha256, witness.originalSha256);
    assert.equal(witness.restoredSha256, witness.originalSha256);
    for (const key of ['nativeWriteCompleted', 'stagedChanged', 'nativeTransactionRejected', 'restoredBeforeEngineRecovery']) assert.equal(witness[key], true);
}
function assertRetentionHealth(value) {
    assert.deepEqual(Object.keys(value).sort(), ['authorityUnavailable', 'events', 'evidenceStorage', 'overflow', 'storageFailedCount'].sort());
    assert.ok(['ready', 'degraded', 'other'].includes(value.evidenceStorage));
    assert.equal(typeof value.authorityUnavailable, 'boolean'); assert.equal(typeof value.overflow, 'boolean');
    assert.ok(Number.isSafeInteger(value.storageFailedCount) && value.storageFailedCount >= 0 && value.storageFailedCount <= 65535);
    assert.ok(Array.isArray(value.events) && value.events.length <= 128);
    for (const event of value.events) {
        assert.deepEqual(Object.keys(event).sort(), ['outcome', 'reason', 'stage']);
        assert.ok(['start', 'storage-failed', 'authority-maintain', 'authority-due', 'authority-schedule', 'engine-refresh', 'engine-tick', 'prune-logs', 'private-reports'].includes(event.stage));
        assert.ok(['called', 'returned', 'returned-denied', 'threw'].includes(event.outcome));
        assert.ok(['none', 'other', 'storage-corrupt', 'storage-unavailable', 'record-capacity', 'record-format', 'record-key', 'record-list',
            'policy-unavailable', 'invalid-policy', 'invalid-cursor', 'partition-read-capacity', 'partition-write-capacity', 'not-authorized',
            'participation-unavailable', 'participation-capacity', 'session-unavailable', 'maintenance-unavailable', 'policy-not-active',
            'reference-conflict', 'invalid-storage-key', 'capacity-or-invalid-state', 'lobby-authority-unavailable', 'Invalid participation storage'].includes(event.reason));
    }
}
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const sources = () => Object.fromEntries([
    ['fixture/runner.mjs', FILE], ['fixture/worker.mjs', join(HERE, 'worker.mjs')], ['fixture/README.md', join(HERE, 'README.md')],
    ['fixture/control-credit-observation.mjs', join(HERE, 'control-credit-observation.mjs')],
    ...readdirSync(join(APP, 'hangout-worker/src')).filter(name => name.endsWith('.mjs')).sort().map(name => [`application/src/${name}`, join(APP, 'hangout-worker/src', name)]),
    ...['r/45662413410ed051/sync-core.js', 'r/45662413410ed051/entry-sites.mjs', 'package.json', 'package-lock.json', '.github/workflows/durable-record-runtime.yml', 'hangout-worker/wrangler.beta.toml', 'node_modules/rolldown/package.json', 'node_modules/obscenity/package.json'].map(name => [`application/${name}`, join(APP, name)]),
    ...['package.json', 'package-lock.json'].map(name => [`tools/${name}`, join(TOOLS, name)])
].map(([name, path]) => [name, hash(path)]));
function bindingPackage() {
    if (process.platform === 'darwin' && process.arch === 'arm64') return '@rolldown/binding-darwin-arm64';
    if (process.platform === 'linux' && process.arch === 'x64') {
        assert.equal(typeof process.report?.getReport().header.glibcVersionRuntime, 'string', 'GNU libc required');
        return '@rolldown/binding-linux-x64-gnu';
    }
    assert.fail('native session fixture supports only macOS ARM64 and Linux x64 GNU libc');
}
const group = pid => execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,stat=,comm='], { encoding: 'utf8', timeout: 3000 }).trim().split('\n').map(line => {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
    return m && { pid: +m[1], ppid: +m[2], pgid: +m[3], state: m[4], command: basename(m[5]) };
}).filter(row => row && row.pgid === pid && !row.state.startsWith('Z'));
const kill = pid => { if (Number.isInteger(pid) && pid > 1) try { process.kill(-pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
async function stopped(pid) { for (let n = 0; n < 80; n++) { if (!group(pid).length) return; await delay(25); } assert.fail('owned group still live'); }
const ipc = message => new Promise((resolve, reject) => process.send(message, error => error ? reject(error) : resolve()));
function receive(expected, nonce) {
    return new Promise((resolve, reject) => process.once('message', message => {
        try { assert.equal(message?.type, expected); assert.equal(message.nonce, nonce); resolve(message); }
        catch (error) { reject(error); }
    }));
}

class Visitor {
    constructor(socket, label, transport = false, acknowledge = true) {
        this.acknowledge = acknowledge; this.transport = transport; this.rawTransport = { count: 0, bytes: 0, firstSequence: 0, lastSequence: 0, firstAt: null, lastAt: null, kinds: {} };
        this.rawTransportHash = createHash('sha256'); this.frameTimes = [];
        this.ack = { sent: 0, lastSequence: 0, lastAt: -Infinity, pending: 0, minSpacingMs: null }; this.ackTimer = null;
        this.socket = socket; this.label = label; this.frames = []; this.bytes = 0; this.waiters = new Set(); this.closed = null; this.failure = null;
        this.commandCount = 0; this.barrierSequence = 0; this.lastCommand = null;
        socket.addEventListener('message', event => {
            try {
                assert.equal(typeof event.data, 'string', label + ': text frame required');
                this.bytes += event.data.length; assert.ok(this.bytes <= 2 * 1024 * 1024 && this.frames.length < 2000, label + ': output cap');
                let frame = JSON.parse(event.data); assert.equal(typeof frame?.t, 'string');
                const receivedAt = performance.now();
                if (this.transport) {
                    if (Object.hasOwn(frame, 'transportSeq')) {
                        // Witness the actual native envelope before a semantic copy
                        // strips ONLY this transport field for the old assertions.
                        assert.ok(Number.isSafeInteger(frame.transportSeq) && frame.transportSeq === this.rawTransport.lastSequence + 1, label + ': raw sequence gap/duplicate');
                        const raw = this.rawTransport; raw.count++; raw.bytes += Buffer.byteLength(event.data);
                        assert.match(frame.t, /^[a-z-]{1,40}$/); raw.kinds[frame.t] = (raw.kinds[frame.t] || 0) + 1;
                        assert.ok(Object.keys(raw.kinds).length <= 32, label + ': raw frame kind bound');
                        raw.firstSequence ||= frame.transportSeq; raw.lastSequence = frame.transportSeq; raw.firstAt ??= receivedAt; raw.lastAt = receivedAt;
                        this.rawTransportHash.update(event.data);
                        this.ack.pending++;
                        const semantic = { ...frame }; delete semantic.transportSeq; frame = semantic;
                    } else assert.ok(this.rawTransport.count === 0 && ['device', 'hello'].includes(frame.t), label + ': unsequenced non-handshake frame');
                }
                this.frames.push(frame); this.frameTimes.push(receivedAt);
                if (this.transport && this.acknowledge && this.ack.pending) {
                    if (this.ack.pending >= 8) this.flushAck();
                    else if (!this.ackTimer) this.ackTimer = setTimeout(() => this.flushAck(), 50);
                }
                for (const check of [...this.waiters]) check();
            } catch (error) { this.cancelAck(); this.failure = error; for (const check of [...this.waiters]) check(); }
        });
        socket.addEventListener('close', event => { this.cancelAck(); this.closed = { code: event.code, reason: event.reason }; for (const check of [...this.waiters]) check(); });
        socket.addEventListener('error', () => { this.cancelAck(); this.failure = Error(label + ': websocket error'); for (const check of [...this.waiters]) check(); });
        socket.accept();
    }
    cancelAck() { clearTimeout(this.ackTimer); this.ackTimer = null; }
    flushAck() {
        this.cancelAck();
        if (!this.transport || !this.acknowledge || !this.ack.pending || this.closed || this.failure || this.socket.readyState !== 1) return;
        const remaining = 50 - (performance.now() - this.ack.lastAt);
        if (remaining > 0) { this.ackTimer = setTimeout(() => this.flushAck(), remaining); return; }
        try {
            const at = performance.now(), sequence = this.rawTransport.lastSequence;
            assert.ok(sequence > this.ack.lastSequence, this.label + ': duplicate client ACK');
            this.socket.send(JSON.stringify({ t: 'transport-ack', seq: sequence }));
            if (this.ack.sent) this.ack.minSpacingMs = Math.min(this.ack.minSpacingMs ?? Infinity, at - this.ack.lastAt);
            this.ack.sent++; this.ack.lastSequence = sequence; this.ack.lastAt = at; this.ack.pending = 0;
        } catch (error) { this.failure = error; for (const check of [...this.waiters]) check(); }
    }
    transportSnapshot() {
        assert.ok(this.transport && !this.failure && this.ack.pending === 0 && this.ack.lastSequence === this.rawTransport.lastSequence);
        return { ...this.rawTransport, kinds: { ...this.rawTransport.kinds }, rawEnvelopeSha256: this.rawTransportHash.copy().digest('hex'),
            acknowledgementsSent: this.ack.sent, acknowledgedSequence: this.ack.lastSequence, minAckSpacingMs: this.ack.minSpacingMs };
    }
    pressureSnapshot() {
        assert.ok(this.transport && !this.acknowledge && !this.failure && this.closed?.code === 4413);
        return { ...this.rawTransport, kinds: { ...this.rawTransport.kinds }, rawEnvelopeSha256: this.rawTransportHash.copy().digest('hex'),
            acknowledgementsSent: this.ack.sent, acknowledgedSequence: this.ack.lastSequence, pendingUnhandledCredit: this.ack.pending };
    }
    send(value) {
        assert.equal(this.closed, null, this.label + ': unexpectedly closed');
        if (value.t === 'cmd') { this.commandCount++; this.lastCommand = { name: String(value.name).slice(0, 32), channel: typeof value.ch === 'string' ? value.ch : '' }; }
        this.socket.send(JSON.stringify(value));
    }
    async wait(predicate, label, since = 0, close = false) {
        return new Promise((resolve, reject) => {
            let timer;
            const finish = (error, value) => { clearTimeout(timer); this.waiters.delete(check); error ? reject(error) : resolve(value); };
            const check = () => {
                if (this.failure) return finish(this.failure);
                const value = close ? this.closed : this.frames.slice(since).find(predicate);
                if (value) return finish(null, value);
                if (this.closed && !close) finish(Error(this.label + ': closed before ' + label));
            };
            timer = setTimeout(() => finish(Error(this.label + ': missing ' + label + ' ' + JSON.stringify({
                commandCount: this.commandCount, barrierSequence: this.barrierSequence, lastCommand: this.lastCommand, closeCode: this.closed?.code || null,
                recent: this.frames.slice(-6).map(frame => ({ t: frame.t, kind: typeof frame.kind === 'string' ? frame.kind : '',
                    text: typeof frame.text === 'string' ? frame.text.slice(0, 120) : '',
                    channel: typeof frame.ch === 'string' ? frame.ch : typeof frame.ch?.name === 'string' ? frame.ch.name : '' }))
            }))), 6000); this.waiters.add(check); check();
        });
    }
    async command(name, args = [], channel = '#stalemate', predicate = null, label = name) {
        const since = this.frames.length; this.send({ t: 'cmd', name, args, ch: channel });
        return predicate ? this.wait(predicate, label, since) : undefined;
    }
    async barrier(channel = '#stalemate') {
        this.barrierSequence++;
        await this.command('names', [channel], channel, f => f.t === 'notice' && f.text.startsWith(channel + ':'), 'ordered names response');
    }
}

async function runtime(phase, state, nonce) {
    assert.ok(['visitors', 'recover'].includes(phase)); assert.match(nonce, /^[a-f0-9]{32}$/);
    assert.ok(lstatSync(state).isDirectory() && !lstatSync(state).isSymbolicLink()); assert.equal(realpathSync(state), state);
    assert.match(basename(state), /^webjam-session-native-[A-Za-z0-9]{6}$/);
    assert.equal(typeof process.send, 'function'); assert.ok(group(process.pid).some(row => row.pid === process.pid));
    // Install before the first async import so private parent input cannot be
    // delivered before the recovery listener exists.
    const recoveryMessage = phase === 'recover' ? receive('recovery', nonce) : null;
    const incidentKeyMessage = INCIDENT && phase === 'visitors' ? receive('incident-key', nonce) : null;
    assert.deepEqual(Object.keys(process.env).filter(name => ![...ENV, ...(process.platform === 'darwin' ? ['__CF_USER_TEXT_ENCODING'] : [])].includes(name)), []);
    const disconnected = () => kill(process.pid); process.on('disconnect', disconnected);
    const require = createRequire(join(TOOLS, 'package.json'));
    const { Miniflare, convertV4MiniflareOptions, Log, LogLevel } = await import(pathToFileURL(require.resolve('miniflare')).href);
    const versions = Object.fromEntries(['miniflare', 'workerd', 'undici'].map(name => [name, JSON.parse(readFileSync(join(TOOLS, 'node_modules', name, 'package.json'))).version]));
    assert.deepEqual(versions, { miniflare: '5.20261019.2-beta', workerd: '1.20261019.1', undici: '7.30.1' });
    const workerd = require('workerd'), binarySha256 = hash(workerd.default), before = sources();
    assert.equal(workerd.compatibilityDate, '2026-10-19');
    const beta = readFileSync(join(APP, 'hangout-worker/wrangler.beta.toml'), 'utf8').split(/^\s*\[/m, 1)[0];
    assert.match(beta, /^compatibility_date\s*=\s*"2026-10-01"\s*$/m); assert.doesNotMatch(beta, /^\s*compatibility_flags\s*=/m);
    const appRequire = createRequire(join(APP, 'package.json'));
    const rolldownVersion = JSON.parse(readFileSync(appRequire.resolve('rolldown/package.json'))).version; assert.equal(rolldownVersion, '1.2.14');
    const binding = appRequire.resolve(bindingPackage()), rolldownBindingSha256 = hash(binding);
    const { rolldown } = await import(pathToFileURL(appRequire.resolve('rolldown')).href), bundleInputs = {};
    const bundler = await rolldown({ input: join(HERE, 'worker.mjs'), platform: 'neutral', external: ['node:crypto'], plugins: [{ name: 'frozen-inputs', transform(code, id) {
        if (id.startsWith('\0')) return null;
        const path = realpathSync(id), sha256 = createHash('sha256').update(code).digest('hex'); assert.equal(hash(path), sha256, 'transformed source mismatch');
        bundleInputs[path] = sha256; return null;
    } }] });
    let generated; try { generated = await bundler.generate({ format: 'esm', codeSplitting: false, sourcemap: false }); } finally { await bundler.close(); }
    assert.equal(generated.output.length, 1); assert.equal(generated.output[0].type, 'chunk');
    assert.ok(generated.output[0].imports.includes('node:crypto'), 'actual native node:crypto import required');
    assert.ok(generated.output[0].imports.every(name => name === 'node:crypto'));
    const bundleCode = generated.output[0].code, bundleSha256 = createHash('sha256').update(bundleCode).digest('hex');
    for (const suffix of ['/beta-entry.mjs', '/beta-public-help.mjs', '/lobby-do.mjs', '/lobby-session-authority.mjs', '/lobby-core.mjs', '/lobby-effect-records.mjs', '/durable-record-storage.mjs'])
        assert.ok(Object.keys(bundleInputs).some(path => path.endsWith(suffix)), 'missing actual source ' + suffix);
    if (PARTICIPATION) for (const suffix of ['/lobby-participation.mjs', '/participation-enforcement.mjs', '/participation-partitions.mjs', '/participation-policy.mjs'])
        assert.ok(Object.keys(bundleInputs).some(path => path.endsWith(suffix)), 'missing actual participation source ' + suffix);
    if (INCIDENT) for (const suffix of ['/lobby-incident-sources.mjs', '/incident-cases.mjs'])
        assert.ok(Object.keys(bundleInputs).some(path => path.endsWith(suffix)), 'missing actual incident source ' + suffix);
    const recoveryInput = INCIDENT && phase === 'recover' ? await recoveryMessage : null;
    const fixtureIncidentKey = INCIDENT ? (phase === 'visitors' ? (await incidentKeyMessage).key : recoveryInput.fixtureIncidentKey) : null;
    if (INCIDENT) assert.ok(typeof fixtureIncidentKey === 'string' && /^[a-f0-9]{64}$/.test(fixtureIncidentKey), 'private synthetic key input invalid');
    let outboundCalls = 0, runtimeRestarts = 0;
    const options = convertV4MiniflareOptions({
        name: 'webjam-local-session-authority', rootPath: state, modulesRoot: state,
        modules: [{ type: 'ESModule', path: join(state, 'bundle.mjs'), contents: bundleCode }],
        compatibilityDate: '2026-10-01', compatibilityFlags: [], host: '127.0.0.1', port: 0, inspectorHost: '127.0.0.1', inspectorPort: 0,
        resourcePersistencePath: join(state, 'persist'), resourceTmpPath: join(state, 'runtime-' + phase),
        durableObjects: { LOBBY: { className: 'FixtureLobby', useSQLite: true }, ROOMS: { className: 'HangoutRoom', useSQLite: true }, QUOTA: { className: 'HangoutQuota', useSQLite: true } },
        bindings: { FIXTURE_NONCE: nonce, HANGOUT_SESSION_AUTHORITY: 'lobby-v1', HANGOUT_BETA_MODE: 'protected',
            ...(PARTICIPATION ? { HANGOUT_PARTICIPATION_AUTHORITY: 'c3-v1' } : {}),
            ...(RETENTION_PROOF ? { FIXTURE_RETENTION_PROOF: 'retention-v1' } : {}),
            ...(PROVIDER_START ? { FIXTURE_PROVIDER_START_PROOF: 'start-v1' } : {}),
            ...(TRAFFIC_ACKS ? { FIXTURE_TRAFFIC_ACKS: 'ack-v1' } : {}),
            ...(PRESSURE_ONLY ? { FIXTURE_PRESSURE_ONLY: 'pressure-v1' } : {}),
            ...(DIAGNOSE_CLOSE ? { FIXTURE_CLOSE_DIAGNOSTIC: 'close-v1' } : {}),
            ...(FANOUT_50 ? { FIXTURE_FANOUT_50: 'fanout-v1' } : {}),
            ...(INCIDENT ? { HANGOUT_INCIDENT_SOURCE_BRIDGE: 'i3a-v1', FIXTURE_INCIDENT_KEY: fixtureIncidentKey } : {}),
            HANGOUT_HMAC_KEY: 'owned-fixture-hmac-not-a-production-credential-2026', HANGOUT_BETA_INVITE_KEY: INVITE, HANGOUT_PREVIEW_KEY: PREVIEW,
            HANGOUT_BETA_INVITE_VERSION: '1', HANGOUT_OPEN: '1', HANGOUT_AI_ENABLED: '0', HANGOUT_TURN_ENABLED: '0' },
        outboundService: () => { outboundCalls++; return new Response('denied', { status: 503, headers: { 'X-WebJam-Test-Egress': 'denied' } }); },
        cf: false, telemetry: { enabled: false }, unsafeRegisterWorker: false, unsafeRuntimeEnv: {},
        unsafeHandleRuntimeRestart: () => { runtimeRestarts++; }, log: new Log(LogLevel.ERROR), logRequests: false
    }); options.unsafeEnableSharedStorage = false;
    const mf = new Miniflare(options), visitors = [];
    const headers = (cookie = '', ip = '192.0.2.1') => ({ 'X-Fixture-Nonce': nonce, Origin: ORIGIN, 'CF-Connecting-IP': ip, ...(cookie ? { Cookie: cookie } : {}) });
    const call = (path, cookie = '', body, ip) => mf.dispatchFetch(ORIGIN + path, { headers: { ...headers(cookie, ip), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
    const control = async (operation, body = {}) => {
        const response = await mf.dispatchFetch(ORIGIN + '/_fixture/' + operation, { method: 'POST', headers: { 'X-Fixture-Nonce': nonce, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        assert.equal(response.status, 200, 'fixture control ' + operation + ' refused'); return response.json();
    };
    const unlock = async (ip, { grant = true, admissionProfile = null } = {}) => {
        if (FANOUT_50 && admissionProfile) admissionProfile.unlockStart = performance.now();
        const response = await call('/beta/unlock', '', { key: INVITE }, ip); assert.equal(response.status, 200, 'real guest unlock refused');
        const body = await response.json();
        if (FANOUT_50 && admissionProfile) admissionProfile.unlockParsed = performance.now();
        assert.deepEqual(body, { ok: true });
        const value = response.headers.get('Set-Cookie'); assert.equal(typeof value, 'string', 'missing real signed cookie');
        assert.ok(/^__Host-hangout-beta=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=[1-9][0-9]*$/.test(value), 'signed guest cookie policy was not satisfied');
        const cookie = value.split(';', 1)[0];
        if (PARTICIPATION && grant) {
            if (FANOUT_50 && admissionProfile) admissionProfile.grantStart = performance.now();
            const result = await control('participation-grant', { cookie });
            if (FANOUT_50 && admissionProfile) admissionProfile.grantParsed = performance.now();
            assert.deepEqual(result, { authorizedSyntheticGrant: true });
        }
        return cookie;
    };
    const connect = async (cookie, label, source, ip, transport = false, acknowledge = true, admissionProfile = null) => {
        if (FANOUT_50 && admissionProfile) admissionProfile.upgradeStart = performance.now();
        const response = await mf.dispatchFetch(ORIGIN + '/lobby?preview=' + PREVIEW, { headers: { ...headers(cookie, ip), Upgrade: 'websocket' } });
        if (FANOUT_50 && admissionProfile) admissionProfile.upgrade101 = performance.now();
        assert.equal(response.status, 101, label + ': actual gateway upgrade refused'); assert.ok(response.webSocket, label + ': missing WebSocket');
        const visitor = new Visitor(response.webSocket, label, transport, acknowledge); visitors.push(visitor);
        const hello = await visitor.wait(f => f.t === 'hello', 'actual hello');
        if (FANOUT_50 && admissionProfile) admissionProfile.serverHello = performance.now();
        assert.deepEqual(hello.features, { entrySources: 1, privateMessageContext: 1, privateMessagePeers: 1, personTargets: 1, roomKeep: 1, messageResults: 1 }); assert.equal(hello.role, 'fan');
        if (FANOUT_50 && admissionProfile) admissionProfile.clientHello = performance.now();
        visitor.send({ t: 'hello', nick: label, age13: true, entrySource: source, ...(transport ? { transport: 1 } : {}) });
        await visitor.wait(f => f.t === 'join' && f.ch.name === '#stalemate', 'lobby membership');
        if (FANOUT_50 && admissionProfile) admissionProfile.joined = performance.now();
        return visitor;
    };
    const joinRoom = (visitor, room) => visitor.command('join', [room], '#stalemate', f => f.t === 'join' && f.ch.name === room, 'join ' + room);
    const denyUnknown = async (cookie, label, dev = '', ip = '192.0.2.12') => {
        const query = new URLSearchParams({ preview: PREVIEW }); if (dev) query.set('dev', dev);
        const response = await mf.dispatchFetch(ORIGIN + '/lobby?' + query, { headers: { ...headers(cookie, ip), Upgrade: 'websocket',
            'X-Hangout-Identity': JSON.stringify({ account: 'a_' + 'x'.repeat(43), role: 'owner', admin: true, principalRef: 'forged_principal_ref' }) } });
        assert.equal(response.status, 101); const visitor = new Visitor(response.webSocket, label); visitors.push(visitor);
        assert.equal((await visitor.wait(frame => frame.t === 'hello', 'actual ungranted hello')).role, 'fan');
        visitor.send({ t: 'hello', nick: label, age13: true, subjectRef: 'forged_subject_ref', principalRef: 'forged_principal_ref' });
        await visitor.wait(frame => frame.t === 'notice' && frame.kind === 'error' && /participation/.test(frame.text), 'actual ungranted refusal');
        assert.ok(visitor.frames.every(frame => frame.t !== 'welcome' && frame.t !== 'join'));
        const logout = await call('/beta/logout', cookie, {}); assert.equal(logout.status, 200); await logout.body?.cancel();
        assert.equal((await visitor.wait(() => false, 'ungranted session logout', 0, true)).code, 4401);
    };
    const ownSharing = async cookie => {
        const response = await call('/beta/participation', cookie); assert.equal(response.status, 200, 'actual caller sharing GET refused');
        const value = await response.json(); assert.deepEqual(Object.keys(value).sort(), OWN_KEYS, 'sharing GET exposed unexpected caller fields');
        return value;
    };
    const waitCommandBudget = async visitor => {
        const pacing = await control('inspect'), deadline = pacing.commandReadyAt.find(row => row.nick === visitor.label)?.at;
        assert.ok(Number.isSafeInteger(deadline) && deadline >= 0 && deadline - Date.now() <= 1000, 'unexpected current command deadline');
        while (Date.now() < deadline) await delay(deadline - Date.now());
    };
    let proof, secrets, incidentSource, sharing, safetyCookie, traffic, retention;
    const trafficMetrics = () => control('traffic-metrics');
    const assertTrafficAccounting = (metrics, snapshots) => {
        assert.equal(metrics.sockets.length, 3);
        for (let slot = 0; slot < 3; slot++) {
            const socket = metrics.sockets[slot], peer = snapshots[slot];
            assert.equal(socket.slot, slot); assert.equal(socket.controls, peer.acknowledgementsSent);
            assert.equal(socket.sequence, peer.lastSequence); assert.equal(socket.acknowledged, socket.sequence);
            assert.equal(socket.remainingControls, 20 * Math.ceil(socket.controls / 20) - socket.controls);
            assert.equal(socket.pendingFrames, 0);
            assert.ok(peer.minAckSpacingMs === null || peer.minAckSpacingMs >= 50, 'native client ACK spacing below current frontend policy');
        }
        assert.equal(metrics.delivery.controlFrames, snapshots.reduce((sum, peer) => sum + peer.acknowledgementsSent, 0));
        assert.equal(metrics.controlBudget.consumedControls, metrics.delivery.controlFrames);
        assert.equal(metrics.controlBudget.reservations, metrics.sockets.reduce((sum, socket) => sum + Math.ceil(socket.controls / 20), 0));
        assert.equal(metrics.controlBudget.prepaidControls, metrics.controlBudget.reservations * 20);
        assert.equal(metrics.sockets.reduce((sum, socket) => sum + socket.remainingControls, 0), metrics.controlBudget.prepaidControls - metrics.controlBudget.consumedControls);
        for (const field of ['pressureCloses', 'failures', 'legacyCloses', 'controlCloses']) assert.equal(metrics.delivery[field], 0);
        assert.equal(metrics.controlBudget.refused, 0); assert.equal(metrics.delivery.pendingFrames, 0); assert.equal(metrics.delivery.pendingBytes, 0);
        assert.equal(metrics.transactions.started, metrics.transactions.committed + metrics.transactions.rejected);
    };
    const drainTraffic = async peers => {
        const deadline = performance.now() + 6000;
        for (;;) {
            for (const peer of peers) { if (peer.failure) throw peer.failure; assert.equal(peer.closed, null, 'healthy traffic peer closed'); }
            const metrics = await trafficMetrics();
            if (peers.every(peer => peer.ack.pending === 0 && peer.ack.lastSequence === peer.rawTransport.lastSequence)
                && metrics.sockets.length === 3 && metrics.sockets.every((socket, slot) => socket.slot === slot
                    && socket.enabled && socket.sequence === peers[slot].rawTransport.lastSequence && socket.acknowledged === socket.sequence
                    && socket.controls === peers[slot].ack.sent && socket.pendingFrames === 0)) return metrics;
            assert.ok(performance.now() < deadline, 'actual native ACK drain exceeded existing6s wait'); await delay(25);
        }
    };
    const probeLine = async (writer, peers, suffix, messageNumber) => {
        const offsets = peers.map(peer => peer.frames.length), text = TRAFFIC_PREFIX + suffix;
        const id = messageNumber.toString(16).padStart(32, '0'), started = performance.now();
        writer.send({ t: 'say', ch: '#stalemate', text, clientMessageId: id });
        const lines = await Promise.all(peers.map((peer, index) => peer.wait(frame => frame.t === 'line' && frame.text === text, 'traffic line delivery', offsets[index])));
        assert.equal(new Set(lines.map(line => line.id)).size, 1, 'traffic peers received different native line identities');
        const deliveries = lines.map((line, index) => {
            assert.equal(peers[index].frames.slice(offsets[index]).filter(frame => frame.t === 'line' && frame.text === text).length, 1, 'duplicate native traffic line');
            return peers[index].frameTimes[peers[index].frames.indexOf(line)] - started;
        });
        const result = await writer.wait(frame => frame.t === 'message-result' && frame.id === id, 'traffic sender result', offsets[peers.indexOf(writer)]);
        assert.equal(result.status, 'published', 'native traffic publication refused');
        return { started, deliveries, disposition: writer.frameTimes[writer.frames.indexOf(result)] - started };
    };
    try {
        assert.equal((await mf.ready).hostname, '127.0.0.1');
        if (PROVIDER_START) {
            const within = async (task, label) => {
                let timer;
                try { return await Promise.race([task, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(label + ': existing6s wait exceeded')), 6000); })]); }
                finally { clearTimeout(timer); }
            };
            const provider = (action, slot, scenario, cookie) => within(control('provider-start-proof', action === 'prepare'
                ? { action, slot, cookie } : { action, slot, scenario }), 'provider-start ' + action + ' ' + (scenario || slot));
            const state = () => within(control('provider-start-state'), 'provider-start state');
            const scenarios = ['positive', 'hold', 'after-stop', 'after-revoke', 'callback-close'];
            const stages = ['native-tx-callback-enter', 'native-tx-callback-exit', 'native-tx-promise-resolved', 'native-tx-rejected',
                'validate-called', 'validate-returned', 'start-invoked', 'response-held', 'response-released', 'callback-close-marked',
                'dispatch-denied', 'dispatch-settled', 'close-await-after-dispatch', 'retirement-resolved', 'retirement-rejected', 'retirement-observed'];
            const checkState = value => {
                assert.deepEqual(Object.keys(value).sort(), ['overflow', 'observationFailed', 'activeNativeCallbacks', 'pendingResponses', 'health', 'cases', 'events'].sort());
                assert.equal(value.overflow, false); assert.equal(value.observationFailed, false);
                assert.deepEqual(Object.keys(value.health).sort(), ['authorityUnavailable', 'capturedOwnerCount', 'evidenceStorage', 'failureTokenMatchesCapturedOwners', 'freshOwnerBaseline']);
                assert.ok(['ready', 'degraded', 'other'].includes(value.health.evidenceStorage));
                assert.equal(typeof value.health.authorityUnavailable, 'boolean');
                assert.ok(Number.isInteger(value.health.capturedOwnerCount) && value.health.capturedOwnerCount >= 0 && value.health.capturedOwnerCount <= 3);
                assert.equal(typeof value.health.failureTokenMatchesCapturedOwners, 'boolean');
                assert.equal(typeof value.health.freshOwnerBaseline, 'boolean');
                assert.equal(value.activeNativeCallbacks, 0); assert.ok(Number.isSafeInteger(value.pendingResponses) && value.pendingResponses >= 0 && value.pendingResponses <= 1);
                assert.ok(Array.isArray(value.cases) && value.cases.length <= 5); assert.ok(value.events.length <= 128);
                for (const row of value.cases) {
                    assert.deepEqual(Object.keys(row).sort(), ['slot', 'scenario', 'runCount', 'validateCalls', 'startCalls', 'completed', 'denied', 'reason',
                        'pendingResponse', 'readonlyTx', 'validationTransactionObserved', 'transactionCompletedBeforeStart', 'startOutsideNativeCallback',
                        'callbackCloseMarked', 'closeRetired'].sort());
                    assert.ok(Number.isInteger(row.slot) && row.slot >= 0 && row.slot <= 2 && scenarios.includes(row.scenario));
                    for (const name of ['runCount', 'validateCalls', 'startCalls']) assert.ok(Number.isSafeInteger(row[name]) && row[name] >= 0 && row[name] <= 64);
                    assert.ok(row.startCalls <= 1); assert.ok(['none', 'participation-denied', 'participation-unavailable', 'other'].includes(row.reason));
                    for (const name of ['completed', 'denied', 'pendingResponse', 'readonlyTx', 'validationTransactionObserved', 'transactionCompletedBeforeStart',
                        'startOutsideNativeCallback', 'callbackCloseMarked', 'closeRetired']) assert.equal(typeof row[name], 'boolean');
                }
                for (const [index, event] of value.events.entries()) {
                    assert.deepEqual(Object.keys(event).sort(), ['ordinal', 'slot', 'scenario', 'stage'].sort());
                    assert.equal(event.ordinal, index + 1); assert.ok(event.slot >= 0 && event.slot <= 2 && scenarios.includes(event.scenario) && stages.includes(event.stage));
                }
                return value;
            };
            const row = (value, scenario) => { const rows = value.cases.filter(item => item.scenario === scenario); assert.equal(rows.length, 1); return rows[0]; };
            const positive = (value, scenario) => {
                const result = row(value, scenario);
                assert.equal(result.startCalls, 1); assert.ok(result.validateCalls >= 1); assert.equal(result.readonlyTx, true);
                assert.equal(result.validationTransactionObserved, true); assert.equal(result.transactionCompletedBeforeStart, true);
                assert.equal(result.startOutsideNativeCallback, true);
                const events = value.events.filter(item => item.scenario === scenario), at = stage => events.find(item => item.stage === stage)?.ordinal;
                assert.ok(at('validate-called') < at('native-tx-promise-resolved') && at('native-tx-promise-resolved') < at('start-invoked'));
                return result;
            };
            const assertProviderHealth = (value, capturedOwners) => {
                // privacy() only sees authorityUnavailable. storageFailed() can
                // degrade evidence while leaving that flag false, so the final
                // provider-state witness has to name both and the owner token.
                const health = value.health;
                assert.equal(health.evidenceStorage, 'ready');
                assert.equal(health.authorityUnavailable, false);
                assert.equal(health.capturedOwnerCount, capturedOwners);
                assert.equal(health.failureTokenMatchesCapturedOwners, capturedOwners > 0);
                assert.equal(health.freshOwnerBaseline, capturedOwners === 0);
            };
            const privacy = observed => {
                assert.equal(observed.authorityUnavailable, false); assert.equal(observed.sqlite, true);
                assert.deepEqual(Object.keys(observed.ordinaryBodiesAbsent).sort(), EPHEMERAL_BODY_MARKERS);
                assert.deepEqual(Object.keys(observed.rawScan.perChunkOrdinaryBodiesAbsent).sort(), EPHEMERAL_BODY_MARKERS);
                assert.ok(Object.values(observed.ordinaryBodiesAbsent).every(Boolean));
                assert.ok(Object.values(observed.rawScan.perChunkOrdinaryBodiesAbsent).every(Boolean));
                assert.equal(observed.logicalScan.requiredRecordsPresent, true); assert.ok(observed.rawScan.rows > 0 && observed.rawScan.bytes > 0);
            };
            const oneLive = async expected => {
                const deadline = Date.now() + 6000;
                for (;;) {
                    const observed = await within(control('inspect'), 'provider-start binding inspection');
                    if (observed.bindingCount === expected && observed.liveBindingCount === expected
                        && observed.durableSessionNicks.length === expected && observed.engineSessionNicks.length === expected) return observed;
                    assert.ok(Date.now() < deadline, 'provider-start actual binding retirement exceeded existing6s wait'); await delay(25);
                }
            };
            if (phase === 'visitors') {
                let admissionDenials = 0;
                for (const requestHeaders of [{ 'Content-Type': 'application/json' }, { 'X-Fixture-Nonce': nonce + 'x', 'Content-Type': 'application/json' },
                    { 'X-Fixture-Nonce': nonce, 'Content-Type': 'application/json', Origin: 'https://hostile.invalid' },
                    { 'X-Fixture-Nonce': nonce, 'Content-Type': 'text/plain' }]) {
                    const response = await mf.dispatchFetch(ORIGIN + '/_fixture/provider-start-state', { method: 'POST', headers: requestHeaders, body: '{}' });
                    assert.equal(response.status, 403); await response.body?.cancel(); admissionDenials++;
                }
                const wrongMethod = await mf.dispatchFetch(ORIGIN + '/_fixture/provider-start-state', { method: 'GET', headers: { 'X-Fixture-Nonce': nonce, 'Content-Type': 'application/json' } });
                assert.equal(wrongMethod.status, 403); await wrongMethod.body?.cancel(); admissionDenials++;
                const missing = await call('/beta/unlock', '', { key: INVITE }); assert.equal(missing.status, 503); await missing.body?.cancel();
                assert.equal((await control('initialize')).reason, 'initialize complete');
                assert.deepEqual(await control('participation-policy'), { installed: true });
                assert.deepEqual(await control('egress-probe'), { status: 503, denied: true });
                const cookies = [], peers = [];
                for (let index = 0; index < 4; index++) {
                    const cookie = await unlock(`192.0.2.${21 + index}`); cookies.push(cookie);
                    peers.push(await connect(cookie, `NativeStart${'ABCD'[index]}`, index % 2 ? 'rad-dad' : 'stalemate', `192.0.2.${21 + index}`));
                }
                assert.equal(new Set(cookies).size, 4);
                const [a, b, c, d] = peers;
                for (let slot = 0; slot < 3; slot++) assert.deepEqual(await provider('prepare', slot, undefined, cookies[slot]),
                    { slot, prepared: true, realCookieBindingAndC2: true, originalOwner: true, productionProviderOff: true });
                let observed = checkState(await provider('run', 0, 'positive'));
                assert.equal(positive(observed, 'positive').completed, true);
                const initialValidations = row(observed, 'positive').validateCalls;
                observed = checkState(await provider('run', 0, 'replay'));
                assert.equal(row(observed, 'positive').startCalls, 1); assert.equal(row(observed, 'positive').validateCalls, initialValidations);
                assert.equal(row(observed, 'positive').runCount, 2); assert.equal(row(observed, 'positive').reason, 'participation-denied');
                assert.deepEqual(await provider('run', 0, 'hold'), { slot: 0, scenario: 'hold', started: true, responsePending: true });
                observed = checkState(await state()); assert.equal(observed.pendingResponses, 1); positive(observed, 'hold');
                const own = await within(ownSharing(cookies[0]), 'provider-start pre-Stop status'); assert.equal(own.revision, 2);
                const stopAt = a.frames.length, stopped = await within(call('/beta/participation/stop', cookies[0], { expectedRevision: own.revision }), 'provider-start realStop while response held');
                assert.equal(stopped.status, 200); assert.deepEqual(await stopped.json(), { reason: 'sharing withdrawn', ok: true, state: 'withdrawn',
                    available: false, purposes: [], revision: 3, canStop: true, cleanup: 'confirmed' });
                await a.wait(frame => frame.t === 'sharing-stopped', 'actualStop during held start response', stopAt); assert.equal(a.closed, null);
                const text = 'Native remaining visitor greeting', cAt = c.frames.length, dAt = d.frames.length;
                d.send({ t: 'say', ch: '#stalemate', text });
                await Promise.all([c.wait(frame => frame.t === 'line' && frame.text === text, 'healthy peer while response held', cAt),
                    d.wait(frame => frame.t === 'line' && frame.text === text, 'healthy author while response held', dAt)]);
                observed = checkState(await state()); assert.equal(observed.pendingResponses, 1);
                observed = checkState(await provider('run', 0, 'after-stop'));
                assert.equal(row(observed, 'after-stop').startCalls, 0); assert.equal(row(observed, 'after-stop').reason, 'participation-denied');
                assert.ok(row(observed, 'after-stop').validateCalls >= 1);
                observed = checkState(await within(control('provider-start-release'), 'provider-start explicit response release'));
                assert.equal(observed.pendingResponses, 0); assert.equal(row(observed, 'hold').completed, true); positive(observed, 'hold');
                const loggedOut = await within(call('/beta/logout', cookies[1], {}), 'provider-start real logout');
                assert.equal(loggedOut.status, 200); assert.deepEqual(await loggedOut.json(), { ok: true });
                assert.equal((await b.wait(() => false, 'actual revokedB close', 0, true)).code, 4401);
                const copied = await call('/beta/state', cookies[1]); assert.equal(copied.status, 401); await copied.body?.cancel();
                observed = checkState(await provider('run', 1, 'after-revoke'));
                assert.equal(row(observed, 'after-revoke').startCalls, 0); assert.equal(row(observed, 'after-revoke').reason, 'participation-denied');
                observed = checkState(await provider('run', 2, 'callback-close'));
                const callback = row(observed, 'callback-close'); assert.ok(callback.validateCalls >= 1);
                assert.equal(callback.callbackCloseMarked, true); assert.equal(callback.validationTransactionObserved, true);
                assert.equal(callback.startCalls, 0); assert.equal(callback.reason, 'participation-denied'); assert.equal(callback.closeRetired, true);
                assert.equal((await c.wait(() => false, 'actual callback-initiatedC close', 0, true)).code, 1000);
                const callbackEvents = observed.events.filter(item => item.scenario === 'callback-close'), firstAt = stage => callbackEvents.find(item => item.stage === stage)?.ordinal;
                assert.ok(firstAt('callback-close-marked') < firstAt('native-tx-promise-resolved') && firstAt('native-tx-promise-resolved') < firstAt('dispatch-denied'));
                assert.ok(firstAt('retirement-resolved') > firstAt('callback-close-marked')); // promise observation, not retirement-start vs gate exit
                assert.ok(firstAt('close-await-after-dispatch') > firstAt('dispatch-settled')); // fixture awaits the close promise after dispatch settles
                assert.equal(d.closed, null); await waitCommandBudget(d); await d.barrier();
                a.socket.close(1000, 'owned withdrawn start fixture complete');
                assert.equal((await a.wait(() => false, 'withdrawnA normal close', 0, true)).code, 1000);
                const checkpoint = await oneLive(1); assert.deepEqual(checkpoint.durableSessionNicks, ['NativeStartD']); privacy(checkpoint);
                observed = checkState(await state()); assertProviderHealth(observed, 3);
                assert.equal(observed.pendingResponses, 0); assert.equal(observed.cases.reduce((sum, item) => sum + item.startCalls, 0), 2);
                assert.deepEqual(checkpoint.nativeRollbackWitnesses, []);
                proof = { checks: ['actual-original-owner-and-readonly-native-TX-before-once-start', 'same-request-identity-cannot-start-twice',
                    'held-response-releases-owner-for-realStop-and-healthy-publication', 'committedStop-and-revoke-prevent-captured-start',
                    'native-callback-close-sync-fence-prevents-start-and-close-promise-is-awaited-after-dispatch', 'complete-private-state-scan-and-one-live-owned-loss-checkpoint'],
                    admissionDenials, providerStart: { observed, realCookieGuests: 4, zeroNetworkStartCallbacks: 2, originalOwner: true,
                        currentProductionProviderOff: true, healthyProgressWhileHeld: true, stopRevision: 3, realRevokeReplayDenied: true },
                    checkpoint, sources: before, versions, binarySha256, rolldownVersion, rolldownBindingSha256, bundleSha256, bundleInputs,
                    outboundCalls, runtimeRestarts, workerdPids: group(process.pid).filter(item => item.command.includes('workerd')).map(item => item.pid) };
                secrets = { revokedCookie: cookies[1], withdrawnCookie: cookies[0], liveCookie: cookies[3] };
                assert.equal(outboundCalls, 1); assert.equal(runtimeRestarts, 0); assert.deepEqual(sources(), before);
                for (const [path, digest] of Object.entries(bundleInputs)) assert.equal(hash(path), digest);
                await ipc({ type: 'checkpoint', phase, nonce, proof, secrets }); await new Promise(() => {});
            } else {
                const received = recoveryInput || await recoveryMessage; secrets = received.secrets;
                assert.ok(received.providerStart?.currentProductionProviderOff && secrets.revokedCookie && secrets.withdrawnCookie && secrets.liveCookie);
                const revoked = await call('/beta/state', secrets.revokedCookie); assert.equal(revoked.status, 401); await revoked.body?.cancel();
                const active = await call('/beta/state', secrets.liveCookie); assert.equal(active.status, 200); assert.equal((await active.json()).kind, 'guest');
                const withdrawn = await ownSharing(secrets.withdrawnCookie);
                assert.deepEqual(withdrawn, { reason: 'own sharing', ok: true, state: 'withdrawn', available: false, purposes: [], revision: 3, canStop: true });
                const recovered = await control('inspect'); privacy(recovered);
                assert.equal(recovered.objectId, received.checkpoint.objectId); assert.deepEqual(recovered.rooms, received.checkpoint.rooms); assert.deepEqual(recovered.reports, received.checkpoint.reports);
                assert.equal(recovered.bindingCount, 0); assert.equal(recovered.liveBindingCount, 0); assert.deepEqual(recovered.durableSessionNicks, []); assert.deepEqual(recovered.engineSessionNicks, []);
                const empty = checkState(await state()); assertProviderHealth(empty, 0);
                assert.deepEqual(empty.cases, []); assert.deepEqual(empty.events, []); assert.equal(empty.pendingResponses, 0);
                const returning = await connect(secrets.liveCookie, 'NativeStartReturn', 'rad-dad', '192.0.2.24');
                await returning.barrier(); assert.ok(returning.frames.every(frame => frame.t !== 'line'), 'provider-start cold newcomer received old text');
                proof = { checks: ['cold-owned-process-loss-prunes-the-real-remaining-binding', 'revocation-and-withdrawal-persist-with-healthy-grant', 'no-old-start-request-or-response-is-replayed', 'cold-phase-fresh-owner-baseline'],
                    providerStart: { freshFixtureRequestsEmpty: true, zeroReplay: true, currentProductionProviderOff: true, freshOwnerBaseline: empty.health }, recovered,
                    sources: before, versions, binarySha256, rolldownVersion, rolldownBindingSha256, bundleSha256, bundleInputs, outboundCalls, runtimeRestarts,
                    workerdPids: group(process.pid).filter(item => item.command.includes('workerd')).map(item => item.pid) };
                returning.socket.close(1000, 'owned provider-start proof complete'); assert.equal((await returning.wait(() => false, 'provider-start recovery normal close', 0, true)).code, 1000);
                assert.equal(outboundCalls, 0); assert.equal(runtimeRestarts, 0); assert.deepEqual(sources(), before);
                for (const [path, digest] of Object.entries(bundleInputs)) assert.equal(hash(path), digest);
                await mf.dispose(); await ipc({ type: 'result', phase, nonce, proof, miniflareDisposed: true });
            }
        } else if (FANOUT_50) {
            const storageMethods = ['get', 'put', 'delete', 'list', 'getAlarm', 'setAlarm', 'deleteAlarm'];
            const storageFamilies = ['authorityMarker', 'sessionIndex', 'connectionIndex', 'mintRates', 'authoritySession', 'authorityConnection',
                'participationPolicy', 'participationRecord', 'participationAnchor', 'participationSubject', 'participationOperation', 'net', 'sessions', 'room', 'authorityOther', 'alarm', 'other'];
            const checkStorageCounters = observed => {
                const value = observed.nativeStorageCounters;
                assert.deepEqual(Object.keys(value).sort(), ['v', 'families', 'methods', 'transactions', 'overflow', 'resolverTelemetry'].sort());
                assert.equal(value.v, 1); assert.equal(value.overflow, false);
                assert.deepEqual(value.resolverTelemetry, { available: false, reason: 'frozen-captured-authority' });
                assert.deepEqual(Object.keys(value.families).sort(), [...storageFamilies].sort());
                assert.deepEqual(Object.keys(value.methods).sort(), [...storageMethods].sort());
                const count = number => assert.ok(Number.isSafeInteger(number) && number >= 0, 'fanout native counter must be a nonnegative safe integer');
                for (const family of storageFamilies) {
                    assert.deepEqual(Object.keys(value.families[family]).sort(), [...storageMethods].sort());
                    for (const method of storageMethods) count(value.families[family][method]);
                }
                let total = 0;
                for (const method of storageMethods) {
                    const row = value.methods[method];
                    assert.deepEqual(Object.keys(row).sort(), ['attempted', 'returned', 'threw']);
                    for (const number of Object.values(row)) count(number);
                    assert.ok(row.returned + row.threw <= row.attempted);
                    assert.equal(storageFamilies.reduce((sum, family) => sum + value.families[family][method], 0), row.attempted);
                    total += row.attempted;
                }
                count(observed.nativeStorageMethodCalls); assert.equal(total, observed.nativeStorageMethodCalls);
                assert.deepEqual(Object.keys(value.transactions).sort(), ['started', 'committed', 'rejected'].sort());
                for (const number of Object.values(value.transactions)) count(number);
                assert.ok(value.transactions.committed + value.transactions.rejected <= value.transactions.started);
            };
            const metrics = () => control('fanout-metrics'), summary = () => control('fanout-summary');
            const completeScan = async () => {
                let token = '', last; const pages = [];
                for (let pass = 0; pass < 14; pass++) {
                    last = await control('fanout-scan', { token });
                    assert.ok(last.rows <= 256 && last.bytes <= 8 * 1024 * 1024 && last.logicalRows <= 1024 && last.rawRows <= 2048);
                    assert.ok(last.combinedRows <= 3072 && last.combinedBytes <= 32 * 1024 * 1024 && last.ordinaryMarkerAbsent);
                    pages.push({ domain: last.domain, rows: last.rows, bytes: last.bytes });
                    if (last.complete) {
                        assert.equal(last.token, null); assert.equal(last.requiredRecordsPresent, true); assert.ok(last.logicalRows > 0 && last.rawRows > 0);
                        const { token: privateContinuation, ...result } = last; return { ...result, pages };
                    }
                    assert.match(last.token, /^[a-f0-9-]{36}$/); token = last.token;
                }
                assert.fail('fanout complete scan exceeded its fixed continuation bound');
            };
            const drain = async (all, expectedLive) => {
                const deadline = performance.now() + 6000;
                for (;;) {
                    for (const peer of all) if (peer.failure) throw peer.failure;
                    const observed = await metrics();
                    checkStorageCounters(observed);
                    assert.equal(observed.sockets.length, 50); assert.equal(observed.engineCount, expectedLive); assert.equal(observed.liveBindingCount, expectedLive);
                    if (observed.sockets.every((socket, slot) => socket.slot === slot && socket.controls === all[slot].ack.sent
                        && (!socket.live || all[slot].closed === null && all[slot].ack.pending === 0
                            && socket.sequence === all[slot].rawTransport.lastSequence && socket.acknowledged === socket.sequence && socket.pendingFrames === 0))) {
                        assert.equal(observed.sockets.filter(socket => socket.live).length, expectedLive);
                        assert.equal(observed.controlBudget.consumedControls, all.reduce((sum, peer) => sum + peer.ack.sent, 0));
                        assert.equal(observed.delivery.controlFrames, observed.controlBudget.consumedControls);
                        let reservations = 0, discardedControls = 0, remainingControls = 0;
                        for (const socket of observed.sockets) {
                            const credit = socket.controlCredits;
                            assert.deepEqual(Object.keys(credit).sort(), ['days', 'invalid', 'overflow']);
                            assert.equal(credit.invalid, false); assert.equal(credit.overflow, false);
                            assert.ok(Array.isArray(credit.days) && credit.days.length >= 1 && credit.days.length <= 2);
                            assert.deepEqual(credit.days.map(row => row.day), [...new Set(credit.days.map(row => row.day))].sort());
                            let controls = 0, remaining = 0;
                            for (const row of credit.days) {
                                assert.deepEqual(Object.keys(row).sort(), ['controls', 'day', 'discardedControls', 'openingControls', 'remainingControls', 'reservations', 'unassignedControls']);
                                assert.match(row.day, /^\d{4}-\d{2}-\d{2}$/);
                                assert.equal(new Date(row.day + 'T00:00:00Z').toISOString().slice(0, 10), row.day);
                                for (const field of ['controls', 'discardedControls', 'openingControls', 'remainingControls', 'reservations', 'unassignedControls']) assert.ok(Number.isSafeInteger(row[field]) && row[field] >= 0);
                                assert.equal(row.openingControls, 0, 'fresh fifty must not import paid credit');
                                assert.equal(row.unassignedControls, 0, 'every actual reservation must reconcile to a real grant');
                                assert.equal(row.reservations, Math.ceil(row.controls / 20));
                                assert.equal(20 * row.reservations, row.controls + row.discardedControls + row.remainingControls);
                                controls += row.controls; remaining += row.remainingControls; reservations += row.reservations;
                                discardedControls += row.discardedControls;
                            }
                            assert.equal(controls, socket.controls); assert.equal(remaining, socket.remainingControls); remainingControls += remaining;
                        }
                        assert.equal(observed.controlBudget.reservations, reservations);
                        assert.equal(observed.controlBudget.prepaidControls, observed.controlBudget.reservations * 20);
                        assert.equal(observed.controlBudget.prepaidControls, observed.controlBudget.consumedControls + discardedControls + remainingControls);
                        // Keep the original stronger lifetime oracle whenever no
                        // socket actually crossed a UTC grant day.
                        if (observed.sockets.every(socket => socket.controlCredits.days.length === 1)) {
                            assert.equal(observed.controlBudget.reservations, observed.sockets.reduce((sum, socket) => sum + Math.ceil(socket.controls / 20), 0));
                            for (const socket of observed.sockets) assert.equal(socket.remainingControls, 20 * Math.ceil(socket.controls / 20) - socket.controls);
                        }
                        for (const field of ['pressureCloses', 'failures', 'legacyCloses', 'controlCloses']) assert.equal(observed.delivery[field], 0);
                        assert.equal(observed.controlBudget.refused, 0); assert.equal(observed.delivery.pendingFrames, 0); assert.equal(observed.delivery.pendingBytes, 0);
                        for (const peer of all) assert.ok(peer.ack.minSpacingMs === null || peer.ack.minSpacingMs >= 50);
                        return observed;
                    }
                    assert.ok(performance.now() < deadline, 'fanout actual native ACK drain exceeded existing6s wait'); await delay(25);
                }
            };
            const waitSummary = async expected => {
                const deadline = performance.now() + 6000;
                for (;;) {
                    const value = await summary();
                    assert.equal(value.authorityUnavailable, false); assert.equal(value.reports, 0); assert.equal(value.held, 0);
                    if (value.bindingCount === expected && value.liveBindingCount === expected && value.storedConnections === expected && value.engineConnections === expected) return value;
                    assert.ok(performance.now() < deadline, 'fanout real binding/session convergence exceeded existing6s wait'); await delay(25);
                }
            };
            if (phase === 'visitors') {
                const missing = await call('/beta/unlock', '', { key: INVITE }); assert.equal(missing.status, 503); await missing.body?.cancel();
                assert.equal((await control('initialize')).reason, 'initialize complete');
                assert.deepEqual(await control('participation-policy'), { installed: true });
                assert.deepEqual(await control('egress-probe'), { status: 503, denied: true });
                const admissionProfiles = Array.from({ length: 50 }, () => ({}));
                const peers = [], cookies = [], admissionMs = [], started = performance.now();
                for (let index = 0; index < 50; index++) {
                    const profile = admissionProfiles[index];
                    const at = performance.now(), ip = `192.0.2.${index + 1}`, cookie = await unlock(ip, { admissionProfile: profile });
                    assert.ok(!cookies.includes(cookie), 'fanout gateway reused an issued SID cookie'); cookies.push(cookie);
                    peers.push(await connect(cookie, `NativeFan${String(index).padStart(2, '0')}`, index % 2 ? 'rad-dad' : 'stalemate', ip, true, true, profile));
                    const endedAt = performance.now(); admissionMs.push(endedAt - at);
                    profile.outerStart = at; profile.outerEnd = endedAt;
                }
                const admissionPhases = admissionProfiles.map((profile, index) => {
                    const points = [profile.outerStart, profile.unlockStart, profile.unlockParsed, profile.grantStart, profile.grantParsed,
                        profile.upgradeStart, profile.upgrade101, profile.serverHello, profile.clientHello, profile.joined, profile.outerEnd];
                    assert.ok(points.every((value, at) => Number.isFinite(value) && value >= 0 && (!at || value >= points[at - 1])), 'fanout admission phase order');
                    const row = { ordinal: index + 1, totalMs: admissionMs[index], unlockHttpMs: points[2] - points[1], c2GrantHttpMs: points[4] - points[3],
                        upgrade101Ms: points[6] - points[5], serverHelloMs: points[7] - points[6], helloJoinMs: points[9] - points[8],
                        // Add actual non-overlapping runner gaps; never clamp a
                        // negative total-minus-components difference to zero.
                        residualMs: (points[1] - points[0]) + (points[3] - points[2]) + (points[5] - points[4]) + (points[8] - points[7]) + (points[10] - points[9]) };
                    assert.equal(row.totalMs, profile.outerEnd - profile.outerStart);
                    const spans = [row.unlockHttpMs, row.c2GrantHttpMs, row.upgrade101Ms, row.serverHelloMs, row.helloJoinMs, row.residualMs];
                    const tolerance = Number.EPSILON * Math.max(1, ...points) * 16;
                    assert.ok(spans.every(value => Number.isFinite(value) && value >= 0 && value <= row.totalMs + tolerance), 'fanout admission phase bound');
                    assert.ok(Math.abs(spans.reduce((sum, value) => sum + value, 0) - row.totalMs) <= tolerance, 'fanout admission total reconciliation');
                    return row;
                });
                assert.equal(admissionPhases.length, 50);
                assert.ok(Buffer.byteLength(JSON.stringify(admissionPhases)) <= 32768, 'fanout admission metadata bound');
                assert.equal(peers.length, 50); assert.ok(peers.every(peer => peer.closed === null));
                const admitted = await waitSummary(50); await delay(200);
                const beforeMetrics = await drain(peers, 50), deliveryMs = [], resultMs = [], latenessMs = [], gapMs = [];
                const serverMessageIds = new Set();
                const trafficAt = performance.now(); let lastAt = -Infinity;
                for (let index = 0; index < 12; index++) {
                    const planned = trafficAt + index * 1100, earliest = Math.max(planned, lastAt + 1100);
                    while (performance.now() < earliest) await delay(earliest - performance.now());
                    const writer = peers[index], text = FANOUT_PREFIX + String(index).padStart(2, '0'), id = (index + 1).toString(16).padStart(32, '0');
                    const offsets = peers.map(peer => peer.frames.length), sentAt = performance.now();
                    latenessMs.push(sentAt - planned); if (index) gapMs.push(sentAt - lastAt); lastAt = sentAt;
                    writer.send({ t: 'say', ch: '#stalemate', text, clientMessageId: id });
                    const copies = await Promise.all(peers.map((peer, slot) => peer.wait(frame => frame.t === 'line' && frame.text === text, 'fifty-recipient actual line', offsets[slot])));
                    for (const copy of copies) {
                        assert.equal(typeof copy.id, 'string'); assert.ok(copy.id.length > 0, 'fanout missing authoritative message ID');
                        assert.equal(copy.ch, '#stalemate'); assert.equal(copy.from, `NativeFan${String(index).padStart(2, '0')}`);
                        assert.equal(copy.entrySource, index % 2 ? 'rad-dad' : 'stalemate');
                    }
                    assert.equal(new Set(copies.map(frame => frame.id)).size, 1);
                    assert.equal(serverMessageIds.has(copies[0].id), false, 'fanout reused a server message ID'); serverMessageIds.add(copies[0].id);
                    for (let slot = 0; slot < 50; slot++) deliveryMs.push(peers[slot].frameTimes[peers[slot].frames.indexOf(copies[slot])] - sentAt);
                    const result = await writer.wait(frame => frame.t === 'message-result' && frame.id === id, 'fanout actual sender result', offsets[index]);
                    assert.equal(result.status, 'published'); resultMs.push(writer.frameTimes[writer.frames.indexOf(result)] - sentAt);
                }
                const afterMetrics = await drain(peers, 50), raw = peers.map(peer => peer.transportSnapshot());
                for (let slot = 0; slot < 50; slot++) {
                    for (let index = 0; index < 12; index++) assert.equal(peers[slot].frames.filter(frame => frame.t === 'line' && frame.text === FANOUT_PREFIX + String(index).padStart(2, '0')).length, 1, 'fanout duplicate/missing line');
                    const results = peers[slot].frames.filter(frame => frame.t === 'message-result');
                    assert.equal(results.length, slot < 12 ? 1 : 0, 'fanout extra/missing sender result');
                }
                assert.equal(deliveryMs.length, 600); assert.equal(resultMs.length, 12); assert.equal(serverMessageIds.size, 12);
                const logout = await call('/beta/logout', cookies[0], {}, '192.0.2.1'); assert.equal(logout.status, 200); assert.deepEqual(await logout.json(), { ok: true });
                assert.equal((await peers[0].wait(() => false, 'fanout revoked native socket close', 0, true)).code, 4401);
                const denied = await call('/beta/state', cookies[0]); assert.equal(denied.status, 401); await denied.body?.cancel();
                const replay = await mf.dispatchFetch(ORIGIN + '/lobby?preview=' + PREVIEW, { headers: { ...headers(cookies[0], '192.0.2.1'), Upgrade: 'websocket' } });
                assert.equal(replay.status, 401); await replay.body?.cancel();
                const revokedFrameCount = peers[0].frames.length;
                await waitSummary(49); await peers[1].barrier(); await delay(200);
                const finalMetrics = await drain(peers, 49), preKillScan = await completeScan(), checkpoint = await waitSummary(49);
                assert.equal(peers[0].frames.length, revokedFrameCount); assert.ok(peers.slice(1).every(peer => peer.closed === null));
                for (let slot = 0; slot < 50; slot++) for (let index = 0; index < 12; index++) assert.equal(peers[slot].frames.filter(frame => frame.t === 'line' && frame.text === FANOUT_PREFIX + String(index).padStart(2, '0')).length, 1);
                proof = { checks: ['fifty-real-cookie-SID-granted-native-WebSocket-members', 'twelve-publications-exactly-six-hundred-native-deliveries', 'fifty-raw-streams-and-real-paced-ACK-prepayment-accounting', 'real-logout-replay-denial-with49-current-members', 'complete-prekill-logical-raw-no-ordinary-archive'],
                    fanout: { realGuests: 50, syntheticConsentSubjects: 50, nativeSockets: 50, publications: 12, deliveredCopies: 600, senderResults: 12, uniqueServerMessageIds: serverMessageIds.size,
                        admission: latencySummary(admissionMs), admissionPhases, publicDelivery: latencySummary(deliveryMs), senderDisposition: latencySummary(resultMs),
                        aggregateSendGap: latencySummary(gapMs), scheduleLateness: latencySummary(latenessMs), trafficDurationMs: lastAt - trafficAt,
                        totalFirstPhaseWorkMs: performance.now() - started, admitted, beforeMetrics, afterMetrics, finalMetrics, raw,
                        nativeStorageMethodCallDelta: afterMetrics.nativeStorageMethodCalls - beforeMetrics.nativeStorageMethodCalls,
                        revokedClose: 4401, revokedReplayDenied: true, checkpointMembers: 49, preKillScan,
                        scope: 'Fixed50-native local Node/Miniflare bridge workload, not production capacity/SLO, physical browser/WAN,150tier,16-reconnect storm,many-room or soak.' },
                    checkpoint, sources: before, versions, binarySha256, rolldownVersion, rolldownBindingSha256, bundleSha256, bundleInputs, outboundCalls, runtimeRestarts,
                    workerdPids: group(process.pid).filter(row => row.command.includes('workerd')).map(row => row.pid) };
                secrets = { revokedCookie: cookies[0], liveCookie: cookies[1] };
                assert.equal(outboundCalls, 1); assert.equal(runtimeRestarts, 0); assert.deepEqual(sources(), before);
                for (const [path, digest] of Object.entries(bundleInputs)) assert.equal(hash(path), digest);
                assert.ok(proof.workerdPids.length); await ipc({ type: 'checkpoint', phase, nonce, proof, secrets }); await new Promise(() => {});
            } else {
                const received = await recoveryMessage; secrets = received.secrets;
                const denied = await call('/beta/state', secrets.revokedCookie); assert.equal(denied.status, 401); await denied.body?.cancel();
                const active = await call('/beta/state', secrets.liveCookie); assert.equal(active.status, 200); await active.body?.cancel();
                const recovered = await waitSummary(0); assert.equal(recovered.domainDigest, received.checkpoint.domainDigest); assert.equal(received.checkpoint.bindingCount, 49);
                const coldScan = await completeScan();
                const returning = await connect(secrets.liveCookie, 'NativeReturn', 'rad-dad', '192.0.2.2', true);
                await returning.barrier(); assert.ok(returning.frames.every(frame => frame.t !== 'line'), 'fanout cold reconnect offered old chat');
                assert.equal((await summary()).bindingCount, 1);
                proof = { checks: ['whole-native-process-loss-prunes49-missing-sockets', 'complete-cold-logical-raw-scan-keeps-revocation-and-no-archive', 'current-same-SID-new-native-binding-without-chat-replay'], recovered, coldScan,
                    sources: before, versions, binarySha256, rolldownVersion, rolldownBindingSha256, bundleSha256, bundleInputs, outboundCalls, runtimeRestarts,
                    workerdPids: group(process.pid).filter(row => row.command.includes('workerd')).map(row => row.pid) };
                returning.socket.close(1000, 'owned fanout proof complete'); assert.equal((await returning.wait(() => false, 'fanout recovery normal close', 0, true)).code, 1000);
                assert.equal(outboundCalls, 0); assert.equal(runtimeRestarts, 0); assert.deepEqual(sources(), before);
                for (const [path, digest] of Object.entries(bundleInputs)) assert.equal(hash(path), digest);
                await mf.dispose(); await ipc({ type: 'result', phase, nonce, proof, miniflareDisposed: true });
            }
        } else if (PRESSURE_ONLY) {
            const pressureMetrics = () => control('pressure-metrics');
            const until = async (predicate, label) => {
                const deadline = performance.now() + 6000;
                while (!predicate()) {
                    for (const visitor of visitors) if (visitor.failure) throw visitor.failure;
                    assert.ok(performance.now() < deadline, label + ': existing6s wait exceeded'); await delay(10);
                }
            };
            const drainHealthy = async peers => {
                let metrics; const deadline = performance.now() + 6000;
                for (;;) {
                    for (const peer of peers) { if (peer.failure) throw peer.failure; assert.equal(peer.closed, null, 'healthy pressure peer closed'); }
                    metrics = await pressureMetrics();
                    if (peers.every(peer => peer.ack.pending === 0 && peer.ack.lastSequence === peer.rawTransport.lastSequence)
                        && metrics.sockets.filter(socket => socket.slot !== 2).every(socket => {
                            const peer = peers.find(value => value.label === ['NativeAlpha', 'NativeBravo'][socket.slot]);
                            return peer && socket.sequence === peer.rawTransport.lastSequence && socket.acknowledged === socket.sequence
                                && socket.controls === peer.ack.sent && socket.pendingFrames === 0;
                        }) && metrics.sockets.filter(socket => socket.slot !== 2).length === peers.length) return metrics;
                    assert.ok(performance.now() < deadline, 'pressure healthy native ACK drain exceeded existing6s wait'); await delay(25);
                }
            };
            const inspectBindings = async expected => {
                const deadline = performance.now() + 6000;
                for (;;) {
                    const observed = await control('inspect');
                    if (observed.bindingCount === expected && observed.liveBindingCount === expected
                        && observed.engineSessionNicks.length === expected) return observed;
                    assert.ok(performance.now() < deadline, 'pressure actual binding retirement exceeded existing6s wait'); await delay(25);
                }
            };
            const line = async (writer, recipients, number) => {
                const text = PRESSURE_PREFIX + number, id = number.toString(16).padStart(32, '0');
                const offsets = new Map(recipients.map(peer => [peer, peer.frames.length])); const at = performance.now();
                writer.send({ t: 'say', ch: '#stalemate', text, clientMessageId: id });
                const delivered = await Promise.all(recipients.map(peer => peer.wait(frame => frame.t === 'line' && frame.text === text, 'pressure healthy line', offsets.get(peer))));
                assert.equal(new Set(delivered.map(frame => frame.id)).size, 1);
                for (const peer of recipients) assert.equal(peer.frames.slice(offsets.get(peer)).filter(frame => frame.t === 'line' && frame.text === text).length, 1);
                assert.equal((await writer.wait(frame => frame.t === 'message-result' && frame.id === id, 'pressure sender result', offsets.get(writer))).status, 'published');
                return at;
            };
            const assertHealthyAccounting = (metrics, peers) => {
                assert.equal(metrics.controlBudget.refused, 0);
                assert.equal(metrics.controlBudget.consumedControls, metrics.delivery.controlFrames);
                assert.equal(metrics.delivery.controlFrames, peers.reduce((sum, peer) => sum + peer.ack.sent, 0));
                assert.equal(metrics.controlBudget.reservations, metrics.sockets.filter(socket => socket.slot !== 2).reduce((sum, socket) => sum + Math.ceil(socket.controls / 20), 0));
                assert.equal(metrics.controlBudget.prepaidControls, metrics.controlBudget.reservations * 20);
                for (const socket of metrics.sockets.filter(value => value.slot !== 2)) {
                    assert.equal(socket.remainingControls, 20 * Math.ceil(socket.controls / 20) - socket.controls);
                    assert.equal(socket.pendingFrames, 0);
                }
                for (const peer of peers) assert.ok(peer.ack.minSpacingMs === null || peer.ack.minSpacingMs >= 50);
                for (const field of ['failures', 'legacyCloses', 'controlCloses']) assert.equal(metrics.delivery[field], 0);
                assert.ok(metrics.delivery.peakPendingFrames <= 8192 && metrics.delivery.peakPendingBytes <= 32 * 1024 * 1024);
            };
            if (phase === 'visitors') {
                const missing = await call('/beta/unlock', '', { key: INVITE }); assert.equal(missing.status, 503); await missing.body?.cancel();
                assert.equal((await control('initialize')).reason, 'initialize complete');
                assert.deepEqual(await control('participation-policy'), { installed: true });
                assert.deepEqual(await control('egress-probe'), { status: 503, denied: true });
                const cookieA = await unlock('192.0.2.11'), cookieB = await unlock('192.0.2.12'), cookieC = await unlock('192.0.2.13');
                const a = await connect(cookieA, 'NativeAlpha', 'stalemate', '192.0.2.11', true);
                const b = await connect(cookieB, 'NativeBravo', 'rad-dad', '192.0.2.12', true);
                const probe = await connect(cookieC, 'NativeCharlie', '', '192.0.2.13', true, false);
                // Allow the ordinary initial presence projection to settle. No
                // clock/cap alteration, barrier command or refused-action retry.
                await delay(200);
                const contract = await control('pressure-register', { cookie: cookieC });
                assert.equal(contract.registeredCurrentGuest, true); assert.equal(contract.helpCount, 10);
                assert.equal(contract.helpDigests.length, 10); for (const digest of contract.helpDigests) assert.match(digest, /^[a-f0-9]{64}$/);
                await drainHealthy([a, b]);
                const beforeMetrics = await pressureMetrics(), initialFrames = probe.frames.length;
                assert.equal(beforeMetrics.delivery.pressureCloses, 0); assert.equal(beforeMetrics.helpAttempts.length, 0);
                const firstPublicationAt = await line(a, [a, b, probe], 1), healthyCountsBefore = [a.ack.sent, b.ack.sent];
                let commands = 0, duringPublicationAt; const pressureStarted = performance.now();
                for (let index = 0; index < 15; index++) {
                    if (probe.closed || probe.socket.readyState !== 1) break;
                    const offset = probe.frames.length;
                    probe.send({ t: 'cmd', name: 'help', args: [], ch: '#stalemate' }); commands++;
                    await until(() => probe.closed || probe.frames.slice(offset).filter(frame => frame.t === 'notice').length >= contract.helpCount, 'real HELP output or pressure close');
                    if (probe.closed || probe.socket.readyState !== 1) break;
                    if (index === 4) duringPublicationAt = await line(b, [a, b, probe], 2);
                    await delay(index < 8 ? 25 : 1100);
                }
                assert.equal((await probe.wait(() => false, 'intended native pressure close', 0, true)).code, 4413);
                const pressureDurationMs = performance.now() - pressureStarted;
                assert.ok(Number.isFinite(duringPublicationAt), 'pressure ended before healthy during-publication observation');
                const retired = await inspectBindings(2);
                const after = await drainHealthy([a, b]);
                assert.equal(after.overflow, false); assert.ok(commands >= 1);
                // Once the real refusal closes the socket, byId may exclude it
                // from later frames of that final staged response. Every earlier
                // complete command is ten accepted notices; the final attempt is
                // a valid prefix containing the actual refused envelope.
                const completeAttempts = (commands - 1) * contract.helpCount;
                assert.ok(after.helpAttempts.length > completeAttempts && after.helpAttempts.length <= commands * contract.helpCount);
                assert.ok(after.helpAttempts.slice(0, completeAttempts).every(attempt => attempt.accepted));
                assert.ok(after.helpAttempts.slice(completeAttempts).some(attempt => !attempt.accepted));
                let refused = false;
                for (let index = 0; index < after.helpAttempts.length; index++) {
                    const attempt = after.helpAttempts[index];
                    assert.equal(attempt.index, index % 10, 'refusal/non-HELP output caused pressure');
                    if (!attempt.accepted) refused = true; else assert.equal(refused, false, 'native send resumed after pressure refusal');
                }
                const receivedHelp = probe.frames.slice(initialFrames).filter(frame => frame.t === 'notice');
                for (let index = 0; index < receivedHelp.length; index++) {
                    assert.notEqual(receivedHelp[index].kind, 'error');
                    assert.equal(createHash('sha256').update(receivedHelp[index].text).digest('hex'), contract.helpDigests[index % 10]);
                }
                assert.equal(after.helpAttempts.filter(attempt => attempt.accepted).length, receivedHelp.length, 'actual HELP sends/receipts differ');
                const rawProbe = probe.pressureSnapshot(), witness = after.witness;
                assert.equal(rawProbe.count, 128); assert.equal(rawProbe.lastSequence, 128); assert.equal(rawProbe.firstSequence, 1);
                assert.equal(rawProbe.acknowledgementsSent, 0); assert.equal(rawProbe.acknowledgedSequence, 0); assert.equal(rawProbe.pendingUnhandledCredit, 128);
                assert.ok(rawProbe.bytes < 2 * 1024 * 1024);
                assert.ok(witness); assert.equal(witness.sequence, 128); assert.equal(witness.acknowledged, 0); assert.equal(witness.pendingFrames, 128); assert.equal(witness.controls, 0);
                assert.ok(witness.pendingBytes > 0 && witness.pendingBytes < 16 * 1024 * 1024);
                assert.equal(witness.refusedKind, 'notice'); assert.ok(witness.refusedHelpIndex >= 0 && witness.refusedHelpIndex < 10);
                assert.equal(witness.nativeSendCallsAfter, witness.nativeSendCallsBefore, 'refused129th envelope reached native send');
                assert.equal(after.nativeProbeSends.calls, after.nativeProbeSends.returned);
                assert.equal(after.nativeProbeSends.initialSequence + after.nativeProbeSends.calls, 128);
                assert.equal(witness.pressureClosesBefore, 0); assert.equal(witness.pressureClosesAfter, 1); assert.equal(after.delivery.pressureCloses, 1);
                assert.equal(witness.pendingFramesBefore - witness.pendingFramesAfter, 128);
                assert.equal(witness.pendingBytesBefore - witness.pendingBytesAfter, witness.pendingBytes);
                assert.equal(after.sockets.some(socket => socket.slot === 2), false);
                assert.equal(after.engineConnections, 2); assert.equal(after.liveBindingCount, 2);
                assertHealthyAccounting(after, [a, b]);
                assert.equal(retired.bindingCount, 2); assert.equal(retired.liveBindingCount, 2); assert.equal(retired.reports.length, 0);
                const continuationAt = firstPublicationAt + 3300; while (performance.now() < continuationAt) await delay(continuationAt - performance.now());
                await line(a, [a, b], 3);
                const progressed = await drainHealthy([a, b]); assertHealthyAccounting(progressed, [a, b]);
                const healthyRawProgressed = [a.transportSnapshot(), b.transportSnapshot()];
                assert.ok(a.ack.sent > healthyCountsBefore[0] && b.ack.sent > healthyCountsBefore[1]);
                const logout = await call('/beta/logout', cookieA, {}); assert.equal(logout.status, 200); assert.deepEqual(await logout.json(), { ok: true });
                assert.equal((await a.wait(() => false, 'pressure healthy guest real revocation close', 0, true)).code, 4401);
                const revoked = await call('/beta/state', cookieA); assert.equal(revoked.status, 401); await revoked.body?.cancel();
                const replay = await mf.dispatchFetch(ORIGIN + '/lobby?preview=' + PREVIEW, { headers: { ...headers(cookieA, '192.0.2.11'), Upgrade: 'websocket' } });
                assert.equal(replay.status, 401); await replay.body?.cancel();
                const revokedCount = a.frames.length, probeCount = probe.frames.length, lastHealthyAt = duringPublicationAt + 3300;
                while (performance.now() < lastHealthyAt) await delay(lastHealthyAt - performance.now());
                await inspectBindings(1); await line(b, [b], 4); await drainHealthy([b]);
                assert.equal(a.frames.length, revokedCount); assert.equal(probe.frames.length, probeCount);
                const checkpoint = await control('inspect');
                assert.equal(checkpoint.bindingCount, 1); assert.equal(checkpoint.liveBindingCount, 1); assert.deepEqual(checkpoint.durableSessionNicks, ['NativeBravo']);
                assert.equal(checkpoint.reports.length, 0); assert.equal(checkpoint.nativeRollbackWitnesses.length, 0);
                assert.deepEqual(Object.keys(checkpoint.ordinaryBodiesAbsent).sort(), EPHEMERAL_BODY_MARKERS);
                assert.deepEqual(Object.keys(checkpoint.rawScan.perChunkOrdinaryBodiesAbsent).sort(), EPHEMERAL_BODY_MARKERS);
                assert.ok(Object.values(checkpoint.ordinaryBodiesAbsent).every(Boolean) && Object.values(checkpoint.rawScan.perChunkOrdinaryBodiesAbsent).every(Boolean));
                proof = { checks: ['actual-three-current-SID-C3-transport-v1-guests', 'real-HELP-fills128-window-and-refuses129th-before-native-send', 'only-probe-pressure-close-credit-and-binding-retire', 'healthy-publication-ACK-and-real-logout-isolation', 'ordinary-bodies-absent-before-one-live-binding-process-loss'],
                    pressure: { visitors: 3, syntheticSubjects: 3, commands, pressureDurationMs, nativeStorageMethodCallDelta: after.nativeStorageMethodCalls - beforeMetrics.nativeStorageMethodCalls, helpNoticeCount: receivedHelp.length, before: beforeMetrics, after, progressed,
                        rawProbe, healthyRaw: healthyRawProgressed, survivorRaw: b.transportSnapshot(), actualRevocationClose: 4401,
                        replayDenied: true, healthyPublicationStages: 4, checkpointBindings: 1, selectedReportsCreated: 0,
                        scope: 'Probe-directed application-ACK credit window on actual local native transport; not physical TCP/browser suspension, shared-fanout capacity, WAN,150-native tier or soak.' },
                    checkpoint, sources: before, versions, binarySha256, rolldownVersion, rolldownBindingSha256, bundleSha256, bundleInputs, outboundCalls, runtimeRestarts,
                    workerdPids: group(process.pid).filter(row => row.command.includes('workerd')).map(row => row.pid) };
                secrets = { revokedCookie: cookieA, liveCookie: cookieB };
                assert.equal(outboundCalls, 1); assert.equal(runtimeRestarts, 0); assert.deepEqual(sources(), before);
                for (const [path, digest] of Object.entries(bundleInputs)) assert.equal(hash(path), digest);
                assert.ok(proof.workerdPids.length); await ipc({ type: 'checkpoint', phase, nonce, proof, secrets }); await new Promise(() => {});
            } else {
                const received = await recoveryMessage; secrets = received.secrets;
                const revoked = await call('/beta/state', secrets.revokedCookie); assert.equal(revoked.status, 401); await revoked.body?.cancel();
                const active = await call('/beta/state', secrets.liveCookie); assert.equal(active.status, 200); await active.body?.cancel();
                const recovered = await control('inspect');
                assert.equal(recovered.objectId, received.checkpoint.objectId); assert.equal(received.checkpoint.bindingCount, 1);
                assert.equal(recovered.bindingCount, 0); assert.equal(recovered.liveBindingCount, 0); assert.deepEqual(recovered.durableSessionNicks, []); assert.deepEqual(recovered.engineSessionNicks, []);
                assert.deepEqual(recovered.rooms, received.checkpoint.rooms); assert.deepEqual(recovered.reports, []);
                assert.deepEqual(Object.keys(recovered.ordinaryBodiesAbsent).sort(), EPHEMERAL_BODY_MARKERS);
                assert.deepEqual(Object.keys(recovered.rawScan.perChunkOrdinaryBodiesAbsent).sort(), EPHEMERAL_BODY_MARKERS);
                assert.ok(Object.values(recovered.ordinaryBodiesAbsent).every(Boolean) && Object.values(recovered.rawScan.perChunkOrdinaryBodiesAbsent).every(Boolean));
                const returning = await connect(secrets.liveCookie, 'NativeReturn', 'rad-dad', '192.0.2.12', true);
                await returning.barrier();
                assert.ok(returning.frames.every(frame => frame.t !== 'line'), 'pressure recovery replayed ordinary text');
                proof = { checks: ['cold-loss-retires-the-one-pressure-mode-binding', 'revoked-cookie-denied-current-SID-rejoins-under-C3', 'no-ordinary-replay-or-selected-body-archive'], recovered,
                    sources: before, versions, binarySha256, rolldownVersion, rolldownBindingSha256, bundleSha256, bundleInputs, outboundCalls, runtimeRestarts,
                    workerdPids: group(process.pid).filter(row => row.command.includes('workerd')).map(row => row.pid) };
                assert.equal(outboundCalls, 0); assert.equal(runtimeRestarts, 0); assert.deepEqual(sources(), before);
                for (const [path, digest] of Object.entries(bundleInputs)) assert.equal(hash(path), digest);
                returning.socket.close(1000, 'owned pressure proof complete'); assert.equal((await returning.wait(() => false, 'pressure recovery normal close', 0, true)).code, 1000);
                await mf.dispose(); await ipc({ type: 'result', phase, nonce, proof, miniflareDisposed: true });
            }
        } else if (phase === 'visitors') {
            let admissionDenials = 0;
            for (const requestHeaders of [{ 'X-Fixture-Nonce': nonce + 'x', 'Content-Type': 'application/json' }, { 'X-Fixture-Nonce': nonce, 'Content-Type': 'application/json', Origin: 'https://hostile.invalid' }, { 'X-Fixture-Nonce': nonce, 'Content-Type': 'text/plain' }]) {
                const response = await mf.dispatchFetch(ORIGIN + '/_fixture/inspect', { method: 'POST', headers: requestHeaders, body: '{}' });
                assert.equal(response.status, 403); await response.body?.cancel(); admissionDenials++;
            }
            const missing = await call('/beta/unlock', '', { key: INVITE }); assert.equal(missing.status, 503, 'missing marker must refuse real unlock'); await missing.body?.cancel();
            const initialized = await control('initialize'); assert.equal(initialized.reason, 'initialize complete');
            if (PARTICIPATION) {
                const empty = await control('inspect'); assert.equal(empty.participationRequired, true); assert.equal(empty.participationPolicyPresent, false);
                await denyUnknown(await unlock('192.0.2.15', { grant: false }), 'NativeUngrant');
                assert.equal((await control('inspect')).participationPolicyPresent, false, 'missing policy was initialized by an ordinary visitor');
                assert.deepEqual(await control('participation-policy'), { installed: true });
            }
            const egress = await control('egress-probe'); assert.deepEqual(egress, { status: 503, denied: true });
            const cookieA = await unlock('192.0.2.11'), cookieB = await unlock('192.0.2.12');
            const a = await connect(cookieA, 'NativeAlpha', 'stalemate', '192.0.2.11', TRAFFIC_ACKS);
            const b = await connect(cookieB, 'NativeBravo', 'rad-dad', '192.0.2.12', TRAFFIC_ACKS);
            if (PARTICIPATION) {
                const privateRoom = await mf.dispatchFetch(ORIGIN + '/room?room=' + 'a'.repeat(64), { headers: { ...headers(cookieB), Upgrade: 'websocket' } });
                assert.equal(privateRoom.status, 503); assert.match(await privateRoom.text(), /participation/);
                const turn = await call('/turn', cookieB, {}); assert.equal(turn.status, 503); assert.match(await turn.text(), /participation/);
            }
            await joinRoom(a, '#native-channel'); const joinedB = await joinRoom(b, '#native-channel');
            assert.deepEqual(joinedB.ch.names.map(({ nick, entrySource }) => ({ nick, entrySource })), [{ nick: 'NativeAlpha', entrySource: 'stalemate' }, { nick: 'NativeBravo', entrySource: 'rad-dad' }]);
            const lineAt = b.frames.length;
            a.send({ t: 'say', ch: '#native-channel', text: 'Native selected report greeting' });
            const selected = await b.wait(f => f.t === 'line' && f.text === 'Native selected report greeting', 'cross-site chat', lineAt); assert.equal(selected.entrySource, 'stalemate');
            b.send({ t: 'report', id: selected.id });
            await b.wait(f => f.t === 'report-status' && f.id === selected.id && f.submitted === true, 'accepted real report', lineAt);
            if (INCIDENT) {
                assert.deepEqual(await control('incident-initialize', { cookie: cookieB }), { initializedSyntheticIncidentAuthority: true });
                incidentSource = await control('incident-preserve', { cookie: cookieB, id: selected.id });
                assert.equal(incidentSource.digest, createHash('sha256').update(selected.text).digest('hex'));
                assert.equal(incidentSource.provenance, 'reported-public');
                for (const field of ['exactSelectedBytes', 'metadataOnlyIndex', 'noCasePlaintext']) assert.equal(incidentSource[field], true);
                assert.equal(incidentSource.sourceCount, 1); assert.equal(incidentSource.caseCount, 1);
                assert.equal(incidentSource.sourceRevision, 1); assert.equal(incidentSource.nextGeneration, 1);
            }
            const bAt = b.frames.length, aAt = a.frames.length;
            b.send({ t: 'say', ch: '#stalemate', text: 'Native Rad Dad ephemeral greeting' });
            assert.equal((await a.wait(f => f.t === 'line' && f.text === 'Native Rad Dad ephemeral greeting', 'Rad Dad badge', aAt)).entrySource, 'rad-dad');
            a.send({ t: 'say', ch: '#stalemate', text: 'Native Stalemate ephemeral greeting' });
            assert.equal((await b.wait(f => f.t === 'line' && f.text === 'Native Stalemate ephemeral greeting', 'Stalemate badge', bAt)).entrySource, 'stalemate');
            await joinRoom(b, '#art-native-canvas'); await joinRoom(a, '#art-native-canvas');
            const stroke = { id: 'native-stroke-1', color: '#009ee8', size: 4, pts: [[0.1, 0.2], [0.3, 0.4]] }, paintAt = a.frames.length;
            b.send({ t: 'act', ch: '#art-native-canvas', kind: 'stroke', stroke });
            assert.deepEqual((await a.wait(f => f.t === 'act' && f.kind === 'stroke' && f.stroke.id === stroke.id, 'cross-site canvas', paintAt)).stroke, stroke);
            const cookieC = await unlock('192.0.2.13'), c = await connect(cookieC, 'NativeCharlie', '', '192.0.2.13', TRAFFIC_ACKS);
            const newcomer = await joinRoom(c, '#native-channel');
            assert.equal(newcomer.ch.names.find(person => person.nick === 'NativeCharlie').entrySource, '');
            const canvasC = await joinRoom(c, '#art-native-canvas'); assert.deepEqual(canvasC.act.strokes, [stroke]);
            await c.barrier(); assert.ok(c.frames.every(frame => frame.t !== 'line' || !['Native selected report greeting', 'Native Rad Dad ephemeral greeting', 'Native Stalemate ephemeral greeting'].includes(frame.text)), 'new visitor received pre-join chat');
            if (TRAFFIC_ACKS) {
                const peers = [a, b, c], warmupUntil = performance.now() + 3300;
                while (performance.now() < warmupUntil) await delay(warmupUntil - performance.now());
                const before = await drainTraffic(peers), snapshots = peers.map(peer => peer.transportSnapshot());
                assertTrafficAccounting(before, snapshots);
                const started = performance.now(), firstAt = started, deliveryMs = [], senderMs = [], latenessMs = [], sendGapsMs = [];
                let lastSent = -Infinity;
                for (let index = 0; index < 22; index++) {
                    const planned = firstAt + index * 1100, earliest = Math.max(planned, lastSent + 1100);
                    while (performance.now() < earliest) await delay(earliest - performance.now());
                    const sent = await probeLine(peers[index % 3], peers, String(index).padStart(2, '0'), index + 1);
                    latenessMs.push(sent.started - planned); if (index) sendGapsMs.push(sent.started - lastSent);
                    lastSent = sent.started; deliveryMs.push(...sent.deliveries); senderMs.push(sent.disposition);
                }
                const after = await drainTraffic(peers), afterSnapshots = peers.map(peer => peer.transportSnapshot());
                const expectedLines = Array.from({ length: 22 }, (_, index) => TRAFFIC_PREFIX + String(index).padStart(2, '0'));
                for (let slot = 0; slot < 3; slot++) {
                    for (const text of expectedLines) assert.equal(peers[slot].frames.filter(frame => frame.t === 'line' && frame.text === text).length, 1);
                    assert.ok(after.sockets[slot].controls - before.sockets[slot].controls >= 21, 'same native socket did not exercise >20 new controls');
                }
                assertTrafficAccounting(after, afterSnapshots);
                assert.equal(after.transactions.rejected, before.transactions.rejected, 'native transaction rejected during healthy traffic');
                const own = await ownSharing(cookieA), beforeB = await ownSharing(cookieB), beforeC = await ownSharing(cookieC), stopAt = a.frames.length;
                assert.equal(own.revision, 2); assert.equal(own.state, 'authorized');
                const response = await call('/beta/participation/stop', cookieA, { expectedRevision: own.revision }); assert.equal(response.status, 200);
                const stop = await response.json(); assert.deepEqual(stop, { reason: 'sharing withdrawn', ok: true, state: 'withdrawn', available: false, purposes: [], revision: 3, canStop: true, cleanup: 'confirmed' });
                await a.wait(frame => frame.t === 'sharing-stopped', 'traffic actual Stop transition', stopAt); assert.equal(a.closed, null);
                const deniedAt = a.frames.length, deniedId = 'f'.repeat(32);
                a.send({ t: 'say', ch: '#stalemate', text: TRAFFIC_PREFIX + 'withdrawn-denied', clientMessageId: deniedId });
                assert.equal((await a.wait(frame => frame.t === 'message-result' && frame.id === deniedId, 'traffic withdrawn sender denial', deniedAt)).status, 'rejected');
                // B last posted in round20, C in round21. A real slow-mode
                // interval precedes the healthy continuation; never retry it.
                const continuationAt = lastSent + 3300; while (performance.now() < continuationAt) await delay(continuationAt - performance.now());
                const continued = await probeLine(b, [b, c], 'healthy-after-stop', 23);
                const final = await drainTraffic(peers), finalSnapshots = peers.map(peer => peer.transportSnapshot());
                assertTrafficAccounting(final, finalSnapshots);
                for (let slot = 0; slot < 3; slot++) assert.ok(final.sockets[slot].controls > after.sockets[slot].controls, 'native ACK continuation did not progress after Stop');
                assert.deepEqual(await ownSharing(cookieA), { reason: 'own sharing', ok: true, state: 'withdrawn', available: false, purposes: [], revision: 3, canStop: true });
                assert.deepEqual(await ownSharing(cookieB), beforeB); assert.deepEqual(await ownSharing(cookieC), beforeC);
                assert.ok(a.frames.slice(stopAt).every(frame => frame.t !== 'line'), 'withdrawn native visitor received new line');
                for (const peer of peers) assert.ok(peer.frames.every(frame => frame.t !== 'line' || frame.text !== TRAFFIC_PREFIX + 'withdrawn-denied'));
                traffic = { kind: 'small-native-local-C3-hot-room-ACK-probe', visitors: 3, messages: 22, expectedHealthyDeliveries: 66,
                    durationMs: +(lastSent - firstAt).toFixed(3), steadyAndStopMs: +(performance.now() - started).toFixed(3),
                    aggregateSendGap: latencySummary(sendGapsMs), schedulerLateness: latencySummary(latenessMs),
                    peerDelivery: latencySummary(deliveryMs), senderDisposition: latencySummary(senderMs),
                    before, after, final, rawTransportBefore: snapshots, rawTransportAfter: afterSnapshots, rawTransportFinal: finalSnapshots,
                    nativeStorageMethodCalls: after.nativeStorageMethodCalls - before.nativeStorageMethodCalls,
                    freshWithdrawalWithOriginalLaterSafetyReportUnchanged: true, withdrawnRevision: 3, deniedNewPublication: true,
                    healthyContinuation: { delivered: continued.deliveries.length, peerDelivery: latencySummary(continued.deliveries) },
                    noBodiesOrIdentitiesInMetrics: true, transportSequenceWitnessedBeforeSemanticNormalization: true,
                    scope: 'Node/Miniflare/native WebSocket bridge end-to-end on this host, not isolated workerd CPU/SQL, browser/WAN, 150 native guests, soak or hosted SLO.' };
            }
            const logout = await call('/beta/logout', cookieA, {}); assert.equal(logout.status, 200); assert.deepEqual(await logout.json(), { ok: true });
            assert.ok(/__Host-hangout-beta=; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=0/.test(logout.headers.get('Set-Cookie') || ''), 'logout cookie clearing policy was not satisfied');
            assert.equal((await a.wait(() => false, 'revoked socket close', 0, true)).code, 4401);
            const revoked = await call('/beta/state', cookieA); assert.equal(revoked.status, 401); await revoked.body?.cancel();
            const refused = await mf.dispatchFetch(ORIGIN + '/lobby?preview=' + PREVIEW, { headers: { ...headers(cookieA), Upgrade: 'websocket' } }); assert.equal(refused.status, 401); await refused.body?.cancel();
            const closedFrameCount = a.frames.length, continuedAt = b.frames.length;
            c.send({ t: 'say', ch: '#native-channel', text: 'Native remaining visitor greeting' });
            assert.equal((await b.wait(frame => frame.t === 'line' && frame.text === 'Native remaining visitor greeting', 'remaining visitor chat', continuedAt)).entrySource, '');
            await b.barrier(); await c.barrier();
            assert.equal(a.frames.length, closedFrameCount, 'revoked visitor received later frames');
            const mediaRoom = '#art-native-canvas', ids = Object.fromEntries(canvasC.ch.names.map(person => [person.nick, person.id]));
            for (const visitor of [b, c]) {
                const since = visitor.frames.length;
                visitor.send({ t: 'cam', ch: mediaRoom, on: true, adult18: true });
                await visitor.wait(frame => frame.t === 'cam' && frame.ch === mediaRoom && frame.on === true, 'synthetic media permission', since);
            }
            const rtc = { sdp: { type: 'offer', sdp: 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=native-media-control-no-body-persistence\r\n' } };
            const beforeRtc = c.frames.length;
            b.send({ t: 'act', ch: mediaRoom, kind: 'rtc', to: ids.NativeCharlie, ...rtc });
            assert.deepEqual((await c.wait(frame => frame.t === 'act' && frame.kind === 'rtc' && frame.from === ids.NativeBravo, 'unblocked synthetic RTC', beforeRtc)).sdp, rtc.sdp);
            const selectedRoom = visitor => {
                const frame = visitor.frames.findLast(frame => ['join', 'chan'].includes(frame.t) && frame.ch?.name === mediaRoom);
                assert.ok(frame, visitor.label + ': missing actual room selection metadata');
                assert.match(frame.ch.keepRef, /^[a-f0-9]{32}$/);
                return frame.ch;
            };
            const selectionB = selectedRoom(b), selectionC = selectedRoom(c);
            const selectedCharlie = selectionB.names.find(person => person.nick === 'NativeCharlie')?.id;
            const selectedBravo = selectionC.names.find(person => person.nick === 'NativeBravo')?.id;
            assert.equal(selectedCharlie, ids.NativeCharlie); assert.equal(selectedBravo, ids.NativeBravo);
            assert.match(selectedCharlie, /^c[a-f0-9]{32}$/); assert.match(selectedBravo, /^c[a-f0-9]{32}$/);
            const blockAtB = b.frames.length, blockAtC = c.frames.length;
            b.send({ t: 'cmd', ch: mediaRoom, name: 'block', args: ['NativeCharlie'], personContext: 1,
                personPeer: selectedCharlie, roomInstance: selectionB.keepRef });
            await b.wait(frame => frame.t === 'notice' && frame.text.startsWith('Blocked '), 'native device block committed', blockAtB);
            assert.deepEqual((await b.wait(frame => frame.t === 'media-policy' && frame.ch === mediaRoom, 'blocker pair policy', blockAtB)).changes, [{ id: ids.NativeCharlie, blocked: true }]);
            assert.deepEqual((await c.wait(frame => frame.t === 'media-policy' && frame.ch === mediaRoom, 'target pair policy', blockAtC)).changes, [{ id: ids.NativeBravo, blocked: true }]);
            const blockedAtB = b.frames.length, blockedAtC = c.frames.length;
            b.send({ t: 'act', ch: mediaRoom, kind: 'rtc', to: ids.NativeCharlie, ...rtc });
            c.send({ t: 'act', ch: mediaRoom, kind: 'rtc', to: ids.NativeBravo, ...rtc });
            await b.barrier(mediaRoom); await c.barrier(mediaRoom);
            for (const [visitor, since] of [[b, blockedAtB], [c, blockedAtC]])
                assert.ok(visitor.frames.slice(since).every(frame => frame.kind !== 'rtc'), 'blocked RTC reached an actual socket');
            const committedBlock = await control('inspect');
            assert.deepEqual(committedBlock.durableBlockCounts, [{ nick: 'NativeBravo', blocks: 1 }, { nick: 'NativeCharlie', blocks: 0 }]);
            assert.deepEqual(committedBlock.engineBlockCounts, committedBlock.durableBlockCounts);
            await control('fault', { record: 'sessions' });
            const rejectedAtB = b.frames.length, rejectedAtC = c.frames.length;
            c.send({ t: 'cmd', ch: mediaRoom, name: 'block', args: ['NativeBravo'], personContext: 1,
                personPeer: selectedBravo, roomInstance: selectionC.keepRef });
            await c.wait(frame => frame.t === 'notice' && frame.kind === 'error', 'native failed-block refusal', rejectedAtC);
            const rejectedBlock = await control('inspect');
            assert.deepEqual(rejectedBlock.durableBlockCounts, committedBlock.durableBlockCounts);
            assert.deepEqual(rejectedBlock.engineBlockCounts, committedBlock.engineBlockCounts);
            assert.deepEqual(rejectedBlock.fault, { tripped: true, nativeWriteCompleted: true });
            assert.deepEqual(rejectedBlock.faultHistory, ['sessions']);
            assert.equal(rejectedBlock.nativeRollbackWitnesses.length, 1);
            assertNativeRollback(rejectedBlock.nativeRollbackWitnesses[0], 'sessions');
            await b.barrier(mediaRoom); await c.barrier(mediaRoom);
            for (const [visitor, since] of [[b, rejectedAtB], [c, rejectedAtC]])
                assert.ok(visitor.frames.slice(since).every(frame => !['media-policy', 'pm-closed'].includes(frame.t)
                    && !(frame.t === 'notice' && frame.text.startsWith('Blocked '))), 'failed native block published success');
            const beforeFault = await control('inspect');
            assert.equal(beforeFault.bindingCount, 2); assert.equal(beforeFault.liveBindingCount, 2);
            assert.deepEqual(beforeFault.durableSessionNicks, ['NativeBravo', 'NativeCharlie']); assert.equal(beforeFault.reports.length, 1); assert.equal(beforeFault.reports[0].id, selected.id);
            if (TRAFFIC_ACKS) { assert.equal(beforeFault.reports[0].votes, 1); assert.equal(beforeFault.reports[0].textSha256, createHash('sha256').update(selected.text).digest('hex')); }
            assert.ok(Object.values(beforeFault.ordinaryBodiesAbsent).every(Boolean), 'ordinary chat persisted outside selected report'); assert.equal(beforeFault.sqlite, true);
            assert.deepEqual(Object.keys(beforeFault.ordinaryBodiesAbsent).sort(), EPHEMERAL_BODY_MARKERS);
            assert.deepEqual(Object.keys(beforeFault.rawScan.perChunkOrdinaryBodiesAbsent).sort(), EPHEMERAL_BODY_MARKERS);
            assert.equal(beforeFault.ordinaryBodiesAbsent['native-media-control-no-body-persistence'], true);
            assert.equal(beforeFault.logicalScan.requiredRecordsPresent, true);
            assert.ok(beforeFault.rawScan.rows > 0 && beforeFault.rawScan.bytes > 0);
            assert.equal(beforeFault.rawScan.perChunkOrdinaryBodiesAbsent['native-media-control-no-body-persistence'], true);
            assert.ok(Object.values(beforeFault.rawScan.perChunkOrdinaryBodiesAbsent).every(Boolean), 'ephemeral sentinel appeared in a physical chunk');
            await control('fault', { room: '#art-native-canvas' }); const faultAt = b.frames.length, faultAtC = c.frames.length;
            b.send({ t: 'cmd', ch: '#art-native-canvas', name: 'topic', args: ['Uncommitted native topic'] });
            await b.wait(frame => frame.t === 'notice' && frame.kind === 'error', 'actual failed-write refusal', faultAt);
            let afterFault = await control('inspect'); assert.deepEqual(afterFault.rooms, beforeFault.rooms); assert.deepEqual(afterFault.reports, beforeFault.reports);
            assert.deepEqual(afterFault.fault, { tripped: true, nativeWriteCompleted: true });
            assert.deepEqual(afterFault.faultHistory, ['sessions', 'community-room:#art-native-canvas']);
            assert.equal(afterFault.nativeRollbackWitnesses.length, 2);
            assert.deepEqual(afterFault.nativeRollbackWitnesses[0], rejectedBlock.nativeRollbackWitnesses[0]);
            assertNativeRollback(afterFault.nativeRollbackWitnesses[1], 'community-room:#art-native-canvas');
            for (const [visitor, since] of [[b, faultAt], [c, faultAtC]])
                assert.ok(visitor.frames.slice(since).every(frame => !(frame.t === 'chan' && frame.ch?.topic === 'Uncommitted native topic') && !(frame.t === 'event' && String(frame.text).includes('Uncommitted native topic'))), 'failed write published success');
            if (PARTICIPATION) {
                const cookieD = await unlock('192.0.2.14'), d = await connect(cookieD, 'NativeDelta', '', '192.0.2.14');
                await joinRoom(d, mediaRoom); const cameraAt = d.frames.length;
                d.send({ t: 'cam', ch: mediaRoom, on: true, adult18: true });
                await d.wait(frame => frame.t === 'cam' && frame.on === true, 'actual C3 camera opt-in', cameraAt);
                assert.deepEqual(await control('participation-reduce', { cookie: cookieD }), { reduced: true });
                assert.equal(d.closed, null, 'ledger reduction bypassed production alarm ordering');
                assert.deepEqual(await control('participation-alarm'), { completed: true });
                assert.equal((await d.wait(() => false, 'production C3 alarm media close', 0, true)).code, 4401);
                const pacing = await control('inspect');
                for (const visitor of [b, c]) {
                    const deadline = pacing.commandReadyAt.find(row => row.nick === visitor.label)?.at;
                    assert.ok(Number.isSafeInteger(deadline) && deadline >= 0);
                    assert.ok(deadline - Date.now() <= 1000, 'unexpected command refill deadline');
                    // The new post-alarm command must honor the actual current
                    // protocol budget before sending; no refused action retries.
                    while (Date.now() < deadline) await delay(deadline - Date.now());
                    await visitor.barrier(mediaRoom);
                }
                assert.equal(b.closed, null); assert.equal(c.closed, null);
                afterFault = await control('inspect'); assert.equal(afterFault.participationPolicyPresent, true);
            }
            if (PARTICIPATION) {
                // Separate fifth synthetic subject. Its selected report must
                // never capture the old four ordinary-body sentinel contexts.
                safetyCookie = await unlock('192.0.2.16');
                const e = await connect(safetyCookie, 'NativeEcho', '', '192.0.2.16'), socketE = e.socket;
                const safetyRoom = '#chat-native-safety';
                await joinRoom(e, safetyRoom); await waitCommandBudget(b); await joinRoom(b, safetyRoom);
                const mediaJoin = await joinRoom(e, mediaRoom), eId = mediaJoin.ch.names.find(person => person.nick === 'NativeEcho')?.id;
                assert.equal(typeof eId, 'string');
                const eCameraAt = e.frames.length; e.send({ t: 'cam', ch: mediaRoom, on: true, adult18: true });
                await e.wait(frame => frame.t === 'cam' && frame.ch === mediaRoom && frame.on === true, 'E actual camera permission opt-in', eCameraAt);
                const beforeOwn = await ownSharing(safetyCookie), beforeB = await ownSharing(cookieB), beforeC = await ownSharing(cookieC);
                assert.deepEqual(beforeOwn, { reason: 'own sharing', ok: true, state: 'authorized', available: true, purposes: OWN_PURPOSES, revision: 2, canStop: true });
                const safetyText = 'Native sharing safety report selection', eLineAt = e.frames.length;
                b.send({ t: 'say', ch: safetyRoom, text: safetyText });
                const safetyLine = await e.wait(frame => frame.t === 'line' && frame.text === safetyText, 'E actual delivered safety selection', eLineAt);
                const indexBefore = INCIDENT ? (await control('inspect')).incidentSources : null;
                if (INCIDENT) { assert.equal(indexBefore.nextGeneration, 1); assert.equal(indexBefore.entries.length, 1); assert.equal(indexBefore.entries[0].id, selected.id); }
                const stoppedAt = e.frames.length, stopped = await call('/beta/participation/stop', safetyCookie, { expectedRevision: beforeOwn.revision });
                assert.equal(stopped.status, 200); const stoppedBody = await stopped.json();
                assert.deepEqual(stoppedBody, { reason: 'sharing withdrawn', ok: true, state: 'withdrawn', available: false, purposes: [], revision: 3, canStop: true, cleanup: 'confirmed' });
                await e.wait(frame => frame.t === 'sharing-stopped', 'E actual same-socket safety transition', stoppedAt);
                assert.equal(e.socket, socketE); assert.equal(e.closed, null);
                const afterStop = await control('inspect');
                assert.equal(afterStop.bindingCount, 3); assert.equal(afterStop.liveBindingCount, 3);
                assert.deepEqual(afterStop.sharingStates.filter(row => row.safetyOnly), [{ nick: '', safetyOnly: true, channels: 0, cameras: 0 }]);
                assert.deepEqual(await ownSharing(safetyCookie), { reason: 'own sharing', ok: true, state: 'withdrawn', available: false, purposes: [], revision: 3, canStop: true });
                assert.deepEqual(await ownSharing(cookieB), beforeB); assert.deepEqual(await ownSharing(cookieC), beforeC);
                const deniedAtB = b.frames.length, deniedAtC = c.frames.length, deniedAtE = e.frames.length;
                const deniedText = 'Native withdrawn publication must remain absent', deniedSdp = 'v=0\r\nnative-withdrawn-rtc-must-not-relay';
                e.send({ t: 'say', ch: safetyRoom, text: deniedText });
                e.send({ t: 'act', ch: mediaRoom, kind: 'rtc', to: ids.NativeBravo, sdp: { type: 'offer', sdp: deniedSdp } });
                await e.wait(frame => frame.t === 'notice' && frame.kind === 'error', 'E actual post-withdrawal denial', deniedAtE);
                const reportAt = e.frames.length, reportRequestedAt = Date.now();
                e.send({ t: 'report', id: safetyLine.id, text: safetyLine.text });
                await e.wait(frame => frame.t === 'report-status' && frame.id === safetyLine.id && frame.submitted === true, 'E same-socket old-delivery report ACK', reportAt);
                const reportAcknowledgedAt = Date.now(); assert.equal(e.socket, socketE); assert.equal(e.closed, null);
                for (const visitor of [b, c]) { await waitCommandBudget(visitor); await visitor.barrier(mediaRoom); }
                for (const [visitor, offset] of [[b, deniedAtB], [c, deniedAtC]]) assert.ok(visitor.frames.slice(offset).every(frame =>
                    !(frame.t === 'line' && frame.text === deniedText) && !(frame.kind === 'rtc' && frame.from === eId) && !JSON.stringify(frame).includes(deniedSdp)), 'withdrawn E publication or RTC reached peer');
                const progressAt = c.frames.length, progressText = 'Native unaffected peer after sharing withdrawal';
                b.send({ t: 'say', ch: mediaRoom, text: progressText });
                await c.wait(frame => frame.t === 'line' && frame.text === progressText, 'unaffected real peer publication progresses', progressAt);
                assert.ok(e.frames.slice(stoppedAt).every(frame => frame.t !== 'line'), 'stopped E received a new public line');
                const reported = await control('inspect');
                assert.deepEqual(reported.reports.map(row => row.id).sort(), [selected.id, safetyLine.id].sort());
                assert.equal(reported.reports.find(row => row.id === safetyLine.id).textSha256, createHash('sha256').update(safetyText).digest('hex'));
                if (INCIDENT) {
                    assert.equal(reported.incidentSources.nextGeneration, 2); assert.equal(reported.incidentSources.entries.length, 2);
                    assert.deepEqual(reported.incidentSources.entries.find(row => row.id === selected.id), indexBefore.entries[0]);
                    const newSource = reported.incidentSources.entries.find(row => row.id === safetyLine.id);
                    assert.deepEqual(Object.keys(newSource).sort(), ['digest', 'expiresAt', 'id', 'originDigest', 'revision']);
                    assert.match(newSource.originDigest, /^[a-f0-9]{64}$/);
                    assert.equal(newSource.revision, 2); assert.equal(newSource.digest, createHash('sha256').update(safetyText).digest('hex'));
                    assert.ok(newSource.expiresAt >= reportRequestedAt + 86400000 && newSource.expiresAt <= reportAcknowledgedAt + 86400000);
                    const priorCase = incidentSource;
                    incidentSource = await control('incident-read', { cookie: cookieB, caseRef: priorCase.caseRef });
                    for (const field of ['caseRef', 'revision', 'sourceRevision', 'digest', 'provenance', 'exactSelectedBytes', 'metadataOnlyIndex', 'noCasePlaintext', 'caseCount']) assert.equal(incidentSource[field], priorCase[field]);
                    assert.equal(incidentSource.sourceCount, 2); assert.equal(incidentSource.nextGeneration, 2);
                }
                e.socket.close(1000, 'owned E safety connection complete');
                assert.equal((await e.wait(() => false, 'E real socket close', 0, true)).code, 1000);
                const closeDeadline = Date.now() + 6000; let bindingDrainReads = 0;
                for (;;) {
                    afterFault = await control('inspect'); bindingDrainReads++;
                    if (afterFault.bindingCount === 2 && afterFault.liveBindingCount === 2) break;
                    assert.ok(Date.now() < closeDeadline, 'E closed socket binding did not retire within existing6s bound'); await delay(25);
                }
                assert.deepEqual(afterFault.durableSessionNicks, ['NativeBravo', 'NativeCharlie'], DIAGNOSE_CLOSE ? 'CLOSE_DIAGNOSTIC ' + JSON.stringify(afterFault.closeDiagnostic) : undefined);
                assert.deepEqual(afterFault.sharingStates.filter(row => row.safetyOnly), []);
                assert.deepEqual(afterFault.reports.map(row => row.id).sort(), [selected.id, safetyLine.id].sort());
                sharing = { additionalRealGuest: 'E', initialRevision: 2, withdrawnRevision: 3, callerOnlyProjection: true, realStopCleanup: 'confirmed',
                    sameSocketSharingStopped: true, sameSocketReportAcknowledged: true, deniedNewPublicationAndRtc: true,
                    otherCallersUnchanged: true, otherPeerPublicationProgress: true, realSocketClosedBeforeCheckpoint: true, bindingDrainReads,
                    retainedIssuedCookieForRecovery: true, reportId: safetyLine.id,
                    ...(INCIDENT ? { nextGeneration: 2, sourceCount: 2, originalCaseAndSourceUnchanged: true } : {}) };
            }
            assert.equal(afterFault.bindingCount, 2, 'lost-socket checkpoint needs live durable bindings'); assert.equal(b.closed, null); assert.equal(c.closed, null);
            if (RETENTION_PROOF) {
                // Additional stored-boundary proof after every canonical
                // assertion. No new visitor, clock override, wait cap or mode flag.
                const original = afterFault, beforeSeedHealth = original.retentionHealth;
                assertRetentionHealth(beforeSeedHealth);
                assert.equal(beforeSeedHealth.evidenceStorage, 'ready', 'pre-seed evidence health: ' + JSON.stringify(beforeSeedHealth));
                assert.equal(beforeSeedHealth.authorityUnavailable, false, 'pre-seed authority health: ' + JSON.stringify(beforeSeedHealth));
                const seeded = await control('retention-seed', { cookie: cookieB });
                assert.deepEqual(Object.keys(seeded).sort(), ['healthyActiveSha256', 'storedSchemaBoundaryOnly', 'targetCounts', 'targetLogicalKeysPresent', 'targetRawManifestsPresent', 'targetRawPartPrefixesPresent', 'targetRecordBytes'].sort());
                assert.equal(seeded.storedSchemaBoundaryOnly, true); assert.deepEqual(seeded.targetCounts, [1, 1, 1, 1, 2]);
                assert.equal(seeded.targetLogicalKeysPresent, 9); assert.ok(seeded.targetRecordBytes > 0 && seeded.targetRecordBytes <= 65536); assert.match(seeded.healthyActiveSha256, /^[a-f0-9]{64}$/);
                assert.equal(seeded.targetRawManifestsPresent, 9); assert.equal(seeded.targetRawPartPrefixesPresent, 9);
                const seededScan = await control('inspect');
                assert.equal(seededScan.logicalScan.requiredRecordsPresent, true); assert.ok(Object.values(seededScan.ordinaryBodiesAbsent).every(Boolean));
                assert.ok(Object.values(seededScan.rawScan.perChunkOrdinaryBodiesAbsent).every(Boolean));
                let observed, alarms = 0;
                for (; alarms < 4;) {
                    assert.deepEqual(await control('participation-alarm'), { completed: true }); alarms++;
                    observed = await control('retention-read', { cookie: cookieB });
                    assert.deepEqual(Object.keys(observed).sort(), ['alarmElapsedMs', 'alarmHandlerCompleted', 'cursorValid', 'cursorWrapped', 'handlerHealthy',
                        'healthyActivePermissionPreserved', 'healthyActiveSha256', 'healthyStoredRowValid', 'onlyExpiredAncillaryRowsRemoved', 'retentionHealth',
                        'targetLogicalKeysAbsent', 'targetRawManifestsAbsent', 'targetRawPartPrefixesEmpty'].sort());
                    assert.equal(observed.healthyActiveSha256, seeded.healthyActiveSha256); assert.equal(observed.healthyStoredRowValid, true);
                    assert.equal(observed.healthyActivePermissionPreserved, true); assert.equal(observed.onlyExpiredAncillaryRowsRemoved, true);
                    assertRetentionHealth(observed.retentionHealth);
                    assert.equal(observed.handlerHealthy, true, 'alarm handler left evidence storage or authority degraded: ' + JSON.stringify(observed.retentionHealth));
                    assert.equal(observed.alarmHandlerCompleted, true); assert.ok(Number.isSafeInteger(observed.alarmElapsedMs) && observed.alarmElapsedMs >= 0);
                    assert.equal(observed.cursorValid, true);
                    if (observed.targetLogicalKeysAbsent === 9 && observed.cursorWrapped) break;
                }
                assert.equal(observed.targetLogicalKeysAbsent, 9); assert.equal(observed.targetRawManifestsAbsent, 9); assert.equal(observed.targetRawPartPrefixesEmpty, 9);
                assert.equal(observed.cursorWrapped, true); assert.ok(alarms > 0 && alarms <= 4);
                for (const peer of [b, c]) { await waitCommandBudget(peer); await peer.barrier(); }
                afterFault = await control('inspect');
                for (const key of ['rooms', 'reports', 'nativeRollbackWitnesses', 'faultHistory', 'durableSessionNicks', 'engineSessionNicks']) assert.deepEqual(afterFault[key], original[key], 'retention changed canonical ' + key);
                assert.equal(afterFault.bindingCount, 2); assert.equal(afterFault.liveBindingCount, 2); assert.equal(b.closed, null); assert.equal(c.closed, null);
                assert.equal(afterFault.logicalScan.requiredRecordsPresent, true); assert.ok(Object.values(afterFault.ordinaryBodiesAbsent).every(Boolean));
                assert.ok(Object.values(afterFault.rawScan.perChunkOrdinaryBodiesAbsent).every(Boolean));
                retention = { storedSchemaBoundaryOnly: true, actualAlarmInvocations: alarms, beforeSeedHealth, seeded, completed: observed,
                    healthyPeerBarriersCompleted: true, originalCanonicalStatePreserved: true, completePrivacyScans: true, noNewVisitorOrGrant: true, hostedSchedulerQualified: false };
            }
            secrets = { revokedCookie: cookieA, liveCookie: cookieB, ...(PARTICIPATION ? { safetyCookie } : {}) };
            proof = { admissionDenials, missingMarkerRefused: true, cookiePolicyVerified: true, actualGatewayVisitors: 3, originalGatewayVisitors: 3, totalRealAdmittedVisitors: PARTICIPATION ? 5 : 3,
                checks: ['actual-beta-unlock-and-WebSocket-admission', 'stalemate-rad-dad-shared-chat-and-canvas', 'direct-newcomer-neutral-without-prejoin-chat', 'actual-report-persisted', 'connected-logout-and-cookie-replay-denied', 'ordinary-chat-excluded-from-durable-records', 'actual-device-block-policy-and-RTC-denial-persisted', 'actual-post-native-session-write-rollback-before-block-success', 'actual-post-native-write-rollback-before-success'],
                ...(PARTICIPATION ? { participationChecks: ['actual-DO-missing-policy-denies-without-provisioning', 'real-signed-SID-principal-with-explicit-synthetic-C2-grants', 'unfenced-private-room-and-TURN-denied', 'committed-media-reduction-production-alarm-closes-only-affected-visitor'] } : {}),
                ...(PARTICIPATION ? { sharingChecks: ['actual-caller-only-GET-and-native-self-withdrawal', 'same-WebSocket-old-delivered-report-ACK-with-new-publishing-denied', 'closed-safety-socket-retires-before-original-two-live-bindings-checkpoint'], sharing } : {}),
                ...(INCIDENT ? { incidentSourceChecks: ['actual-public-report-index-and-I1-copy-share-native-transaction-domain', 'selected-only-encrypted-case-and-metadata-only-index'], incidentSource } : {}),
                ...(TRAFFIC_ACKS ? { trafficChecks: ['actual-transport-v1-raw-sequence-and-paced-ACK-accounting', 'three-current-C3-guests-rotating-public-text', 'actual-Stop-and-healthy-ACK-continuation'], traffic } : {}),
                ...(RETENTION_PROOF ? { retentionChecks: ['actual-alarm-removes-valid-stored-expired-C2-record-and-owned-native-keys', 'healthy-active-permission-preserved-with-only-expired-history-cleanup', 'bounded-cursor-wrap-with-complete-logical-and-raw-privacy-scans'], retention } : {}),
                checkpoint: afterFault, sources: before, versions, binarySha256, rolldownVersion, rolldownBindingSha256, bundleSha256, bundleInputs,
                outboundCalls, runtimeRestarts, workerdPids: group(process.pid).filter(row => row.command.includes('workerd')).map(row => row.pid) };
            assert.equal(outboundCalls, 1); assert.equal(runtimeRestarts, 0); assert.deepEqual(sources(), before);
            for (const [path, digest] of Object.entries(bundleInputs)) assert.equal(hash(path), digest); assert.equal(hash(binding), rolldownBindingSha256);
            assert.ok(proof.workerdPids.length);
            // Parent intentionally kills this entire owned process group while
            // B/C remain open. No visitor close/dispose can retire bindings first.
            await ipc({ type: 'checkpoint', phase, nonce, proof, secrets });
            await new Promise(() => {});
        } else {
            const received = recoveryInput || await recoveryMessage; secrets = received.secrets;
            assert.ok(secrets && typeof secrets.revokedCookie === 'string' && typeof secrets.liveCookie === 'string');
            const revoked = await call('/beta/state', secrets.revokedCookie); assert.equal(revoked.status, 401); await revoked.body?.cancel();
            const active = await call('/beta/state', secrets.liveCookie); assert.equal(active.status, 200); assert.equal((await active.json()).kind, 'guest');
            const recovered = await control('inspect');
            assert.equal(recovered.objectId, received.checkpoint.objectId); assert.deepEqual(recovered.rooms, received.checkpoint.rooms); assert.deepEqual(recovered.reports, received.checkpoint.reports);
            if (INCIDENT) assert.deepEqual(recovered.incidentSources, received.checkpoint.incidentSources, 'cold exact source metadata mismatch');
            assert.equal(recovered.bindingCount, 0); assert.equal(recovered.liveBindingCount, 0); assert.deepEqual(recovered.durableSessionNicks, []); assert.deepEqual(recovered.engineSessionNicks, []);
            assert.deepEqual(recovered.nativeRollbackWitnesses, []);
            assert.equal(recovered.authorityUnavailable, false); assert.equal(recovered.sqlite, true); assert.ok(Object.values(recovered.ordinaryBodiesAbsent).every(Boolean));
            assert.deepEqual(Object.keys(recovered.ordinaryBodiesAbsent).sort(), EPHEMERAL_BODY_MARKERS);
            assert.deepEqual(Object.keys(recovered.rawScan.perChunkOrdinaryBodiesAbsent).sort(), EPHEMERAL_BODY_MARKERS);
            assert.equal(recovered.ordinaryBodiesAbsent['native-media-control-no-body-persistence'], true);
            assert.equal(recovered.logicalScan.requiredRecordsPresent, true);
            assert.ok(recovered.rawScan.rows > 0 && recovered.rawScan.bytes > 0);
            assert.equal(recovered.rawScan.perChunkOrdinaryBodiesAbsent['native-media-control-no-body-persistence'], true);
            assert.ok(Object.values(recovered.rawScan.perChunkOrdinaryBodiesAbsent).every(Boolean));
            if (RETENTION_PROOF) {
                assert.ok(received.retention && received.retention.storedSchemaBoundaryOnly === true);
                const current = await control('retention-read', { cookie: secrets.liveCookie });
                assert.deepEqual(Object.keys(current).sort(), ['cursorValid', 'cursorWrapped', 'handlerHealthy', 'healthyActiveSha256', 'healthyStoredRowValid', 'retentionHealth', 'targetLogicalKeysAbsent', 'targetRawManifestsAbsent', 'targetRawPartPrefixesEmpty'].sort());
                assert.equal(current.targetLogicalKeysAbsent, 9); assert.equal(current.targetRawManifestsAbsent, 9); assert.equal(current.targetRawPartPrefixesEmpty, 9);
                assert.equal(current.cursorValid, true); assert.equal(current.cursorWrapped, true); assert.equal(current.healthyStoredRowValid, true);
                assertRetentionHealth(current.retentionHealth);
                assert.equal(current.handlerHealthy, true, 'cold retention read found degraded evidence storage or authority: ' + JSON.stringify(current.retentionHealth));
                assert.equal(current.healthyActiveSha256, received.retention.seeded.healthyActiveSha256);
                retention = { persistedTargetLogicalAndRawAbsence: true, healthyActivePermissionPreserved: true, persistedCursorWrapped: true, current,
                    actualFreshProcessAndDiskRead: true, hostedSchedulerQualified: false };
            }
            const returning = await connect(secrets.liveCookie, 'NativeReturn', 'rad-dad', '192.0.2.12');
            if (PARTICIPATION) {
                const device = returning.frames.find(frame => frame.t === 'device')?.token; assert.equal(typeof device, 'string');
                await denyUnknown(await unlock('192.0.2.12', { grant: false }), 'NativeBravo', device, '192.0.2.12');
            }
            if (PARTICIPATION) {
                assert.ok(received.sharing && typeof secrets.safetyCookie === 'string');
                const recoveredOwn = await ownSharing(secrets.safetyCookie);
                assert.deepEqual(recoveredOwn, { reason: 'own sharing', ok: true, state: 'withdrawn', available: false, purposes: [], revision: received.sharing.withdrawnRevision, canStop: true });
                await denyUnknown(secrets.safetyCookie, 'NativeEcho', '', '192.0.2.16');
                const loggedOut = await call('/beta/state', secrets.safetyCookie); assert.equal(loggedOut.status, 401); await loggedOut.body?.cancel();
                sharing = { persistedWithdrawnRevision: recoveredOwn.revision, callerOnlyProjection: true, currentIssuedSidStatusWithdrawn: true,
                    newHelloDeniedAfterRestart: true, realLogoutAndReplayDenied: true };
            }
            if (INCIDENT) {
                incidentSource = await control('incident-read', { cookie: secrets.liveCookie, caseRef: received.incidentSource.caseRef });
                for (const field of ['caseRef', 'revision', 'sourceRevision', 'digest', 'provenance', 'exactSelectedBytes', 'metadataOnlyIndex', 'noCasePlaintext', 'nextGeneration', 'sourceCount', 'caseCount'])
                    assert.equal(incidentSource[field], received.incidentSource[field], 'cold incident source/evidence mismatch: ' + field);
            }
            const canvas = await joinRoom(returning, '#art-native-canvas'); assert.equal(canvas.ch.count, 1); assert.equal(canvas.act.strokes[0].id, 'native-stroke-1');
            await returning.barrier(); assert.ok(returning.frames.every(frame => frame.t !== 'line'), 'cold newcomer received prior chat');
            proof = { checks: ['cold-process-loss-retires-missing-socket-bindings', 'committed-rooms-canvas-and-report-survive', 'revoked-cookie-stays-denied-active-cookie-reconnects'], recovered,
                ...(PARTICIPATION ? { participationChecks: ['actual-C3-reloads-partition-grant-after-process-loss', 'new-SID-cannot-inherit-grant-through-same-signed-device-IP-or-old-nickname'] } : {}),
                ...(PARTICIPATION ? { sharingChecks: ['actual-withdrawn-own-status-and-denied-new-hello-after-whole-process-loss', 'real-logout-revokes-retained-safety-cookie'], sharing } : {}),
                ...(INCIDENT ? { incidentSourceChecks: ['actual-current-SID-rebind-and-I1-encrypted-evidence-reload-after-whole-process-loss'], incidentSource } : {}),
                ...(RETENTION_PROOF ? { retentionChecks: ['expired-C2-target-does-not-resurrect-after-owned-process-loss', 'healthy-current-cookie-grant-and-cursor-survive-native-disk-reopen'], retention } : {}),
                sources: before, versions, binarySha256, rolldownVersion, rolldownBindingSha256, bundleSha256, bundleInputs, outboundCalls, runtimeRestarts,
                workerdPids: group(process.pid).filter(row => row.command.includes('workerd')).map(row => row.pid) };
            assert.equal(outboundCalls, 0); assert.equal(runtimeRestarts, 0); assert.deepEqual(sources(), before);
            for (const [path, digest] of Object.entries(bundleInputs)) assert.equal(hash(path), digest); assert.equal(hash(binding), rolldownBindingSha256);
            for (const visitor of visitors) if (!visitor.closed) visitor.socket.close(1000, 'owned proof complete');
            await mf.dispose();
            assert.deepEqual(sources(), before); assert.equal(hash(workerd.default), binarySha256);
            assert.equal(hash(binding), rolldownBindingSha256);
            await ipc({ type: 'result', phase, nonce, proof, miniflareDisposed: true });
        }
    } catch (error) {
        if (process.connected) await ipc({ type: 'failure', phase, nonce, error: String(error.stack || error).slice(0, 16384) }); throw error;
    } finally { for (const visitor of visitors) visitor.cancelAck(); await mf.dispose(); }
    process.off('disconnect', disconnected); process.disconnect();
}

async function parent() {
    assert.deepEqual(process.argv.slice(2), MODE); bindingPackage();
    const before = sources(), state = realpathSync(await mkdtemp(join(tmpdir(), 'webjam-session-native-'))), nonce = randomBytes(16).toString('hex');
    const fixtureIncidentKey = INCIDENT ? randomBytes(32).toString('hex') : null;
    let current, groupNeedsCleanup = false, interrupted;
    const interrupt = signal => { interrupted ||= Error('interrupted ' + signal); if (groupNeedsCleanup) kill(current?.pid); };
    process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
    const run = (phase, recovery) => new Promise((resolve, reject) => {
        let stdout = '', stderr = '', checkpoint, result, preKill, timer, settled = false;
        const fail = error => { if (settled) return; settled = true; clearTimeout(timer); if (groupNeedsCleanup) kill(current?.pid); reject(error); };
        current = spawn(process.execPath, [FILE, '--isolated', phase, state, nonce, ...MODE], { cwd: HERE,
            env: Object.fromEntries(ENV.filter(name => typeof process.env[name] === 'string').map(name => [name, process.env[name]])), detached: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] }); groupNeedsCleanup = true;
        const proc = current;
        const append = (value, chunk) => { const next = value + chunk; if (next.length > 262144) { fail(Error('bounded runtime logs exceeded')); return value; } return next; };
        proc.stdout.on('data', chunk => { stdout = append(stdout, chunk.toString()); }); proc.stderr.on('data', chunk => { stderr = append(stderr, chunk.toString()); });
        proc.on('error', fail); timer = setTimeout(() => fail(Error(phase + ': 60s proof timeout; no automatic retry\n' + stderr)), 60000);
        if (phase === 'visitors' && INCIDENT) proc.send({ type: 'incident-key', nonce, key: fixtureIncidentKey }, error => { if (error) fail(error); });
        if (phase === 'recover') proc.send({ type: 'recovery', nonce, checkpoint: recovery.proof.checkpoint, secrets: recovery.secrets,
            ...(INCIDENT ? { fixtureIncidentKey, incidentSource: recovery.proof.incidentSource } : {}),
            ...(RETENTION_PROOF ? { retention: recovery.proof.retention } : {}),
            ...(PARTICIPATION && !PROVIDER_START ? { sharing: recovery.proof.sharing } : {}),
            ...(PROVIDER_START ? { providerStart: recovery.proof.providerStart } : {}) }, error => { if (error) fail(error); });
        proc.on('message', message => { try {
            assert.equal(message?.nonce, nonce); assert.equal(message.phase, phase); if (message.type === 'failure') throw Error(message.error);
            assert.deepEqual(message.proof?.sources, before);
            if (phase === 'visitors') {
                assert.equal(message.type, 'checkpoint'); assert.equal(checkpoint, undefined); checkpoint = message;
                assert.ok(message.secrets && Object.values(message.secrets).every(value => typeof value === 'string' && value.startsWith('__Host-hangout-beta=')));
                preKill = group(proc.pid); assert.ok(preKill.some(row => row.pid === proc.pid && row.pgid === proc.pid)); assert.ok(preKill.some(row => row.command.includes('workerd')));
                assert.ok(message.proof.workerdPids.every(pid => preKill.some(row => row.pid === pid)));
                kill(proc.pid);
            } else { assert.equal(message.type, 'result'); assert.equal(result, undefined); assert.equal(message.miniflareDisposed, true); result = message; }
        } catch (error) { fail(error); } });
        proc.on('close', async (code, signal) => {
            clearTimeout(timer);
            try {
                await stopped(proc.pid); if (current === proc) groupNeedsCleanup = false;
                if (settled) return; if (interrupted) throw interrupted;
                if (phase === 'visitors') { assert.ok(checkpoint, 'missing visitor checkpoint'); assert.equal(signal, 'SIGKILL'); assert.equal(code, null); }
                else { assert.ok(result, 'missing recovery proof'); assert.equal(code, 0); assert.equal(signal, null); }
                settled = true; resolve({ ...(phase === 'visitors' ? checkpoint : result), childExitCode: code, childExitSignal: signal, processesBeforeIntentionalKill: preKill, noLiveOwnedProcesses: true, stdout, stderr });
            } catch (error) { fail(error); }
        });
    });
    let first, recovered;
    try {
        first = await run('visitors'); assert.deepEqual(sources(), before);
        recovered = await run('recover', first); assert.deepEqual(sources(), before);
        assert.equal(recovered.proof.binarySha256, first.proof.binarySha256); assert.equal(recovered.proof.bundleSha256, first.proof.bundleSha256);
        assert.equal(recovered.proof.rolldownVersion, first.proof.rolldownVersion);
        assert.equal(recovered.proof.rolldownBindingSha256, first.proof.rolldownBindingSha256);
        assert.deepEqual(recovered.proof.bundleInputs, first.proof.bundleInputs); assert.deepEqual(recovered.proof.versions, first.proof.versions);
        assert.ok(recovered.proof.workerdPids.every(pid => !first.proof.workerdPids.includes(pid)), 'workerd process was reused');
    } finally {
        if (groupNeedsCleanup && current?.pid) { kill(current.pid); await stopped(current.pid); groupNeedsCleanup = false; }
        assert.equal(realpathSync(state), state); await rm(state, { recursive: true });
        process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
    }
    if (interrupted) throw interrupted;
    // Private signed cookies travel only over parent/child IPC; omit them from
    // the receipt and never persist/log the invitation or HMAC values.
    delete first.secrets;
    console.log(JSON.stringify({ localGatewayWebSocketSessionAuthorityQualified: !DIAGNOSE_CLOSE,
        ...(DIAGNOSE_CLOSE ? { diagnosticCloseObservationOnly: true, diagnosticPassMeansNoReproductionOnly: true } : {}), ...(PARTICIPATION ? { productionParticipationCompositionQualified: !DIAGNOSE_CLOSE, guardianDecisionsQualified: false } : {}),
        ...(INCIDENT ? { productionIncidentSourceCompositionQualified: true, incidentAuthorityAndKeyQualified: false } : {}),
        ...(PARTICIPATION && !PRESSURE_ONLY && !FANOUT_50 && !PROVIDER_START ? { productionOwnSharingCompositionQualified: !DIAGNOSE_CLOSE } : {}),
        ...(FANOUT_50 ? { nativeLocalFiftyGuestFanoutQualified: true, originalNinePlusThreeQualifiedByThisMode: false, hostedScaleQualified: false } : {}),
        ...(PRESSURE_ONLY ? { nativeLocalNonAckPressureQualified: true, originalNinePlusThreeQualifiedByThisMode: false, hostedScaleQualified: false } : {}),
        ...(PROVIDER_START ? { nativeOwnerStartInvocationBoundaryQualified: true, zeroNetworkCallbackOnly: true, originalNinePlusThreeQualifiedByThisMode: false, providerActivationQualified: false } : {}),
        ...(TRAFFIC_ACKS ? { nativeLocalHealthyAckProbeQualified: !DIAGNOSE_CLOSE, hostedScaleQualified: false } : {}),
        ...(RETENTION_PROOF ? { nativeC2RetentionHandlerQualified: true, hostedAlarmSchedulerQualified: false } : {}),
        ...(PARTICIPATION && INCIDENT ? { combinedParticipationIncidentSourceCompositionQualified: true } : {}), first, recovered, node: process.version, platform: process.platform, architecture: process.arch,
        temporaryStateRemoved: true, scope: PROVIDER_START ? 'Separate four-real-guest native C3 original-owner/read-only-TX/start-invocation proof with zero-network callbacks. Actual Stop/revoke, callback-initiated close, held-response healthy progress and owned-process-loss cleanup. Explicit synthetic consent/provider readiness only; production AI remains off. Not canonical9+3/fault requalification, external provider activation, physical wire/crash exactly-once, hostedPITR/scale/SLO, legal/guardian or nativeaudio proof.' : DIAGNOSE_CLOSE ? 'Explicit pass-through close-order diagnostic only. A passing instrumented run means no reproduction in that run, not a retirement fix, ordinary mode qualification, hosted readiness or overall completion. All original assertions/waits remain. No production behavior is replaced.' : FANOUT_50 ? 'Separate50-real-guest native C3 fanout proof:12publications/600actualdeliveries,50pacedACKstreams,actualrevocation49livebindings thenwholeprocessloss/coldpruning/nohistory. Syntheticpolicy/grants only. Native-local Node/Miniflare bridge observations,notbrowser/WAN/150tier/reconnectstorm/many-room/soak/hostedcapacityorSLO. Doesnotrequalifycanonical9+3/fault/Stop/reportmodes.' : PRESSURE_ONLY ? 'Separate three-current-SID C3 application-ACK credit pressure proof in actual local workerd/SQLite. Real HELP output, zero-ACK probe4413 with128-frame/native-send/credit witness, healthy ACK/publication and real revocation isolation, one-binding owned-process-loss recovery and no text replay. Synthetic consent only. Does not requalify original9+3/Delta/Echo modes, physical slow TCP/browser/WAN/shared-fanout capacity/150-native/soak or hosted limits/cost.' : 'Actual betaFetch guest cookies, real local WebSocket visitors, actual HangoutLobby and SQLite authority/effect transactions. Explicit test-only known-empty bootstrap. Whole owned runtime killed with visitors connected; fresh runtime recovery. ' + (PARTICIPATION ? 'Required production C3 bridge selected; actual caller-only HTTP status/Stop narrows the existing synthetic ledger, keeps the same socket for a delivered-message report, then persists withdrawal across process loss before real logout. Only operator/guardian consent decisions are explicitly synthetic. No real enrollment/guardian or external provider qualification. ' : '') + (INCIDENT ? 'Required production I3a source bridge and existing I1 over actual records transactions; separate incident appointment/policy and privately retained test key are synthetic only. This does not qualify real incident authority, purpose-key provisioning or key recovery. ' : '') + (TRAFFIC_ACKS ? 'Optional three-visitor paced native-local ACK workload; raw envelopes validated before semantic normalization and actual serialized control grants reconciled. Latencies include Node/Miniflare native bridge; no throughput tier or public SLO claim. ' : '') + 'No browser cookie-storage, real Access OTP/staff identity, C2 guardian consent, hosted deployment/drain/limits/cost, TURN/camera, or native WebJam installation/audio qualification.' }, null, 2));
}
try { if (process.argv[2] === '--isolated' && process.argv.length === (6 + MODE.length)) await runtime(process.argv[3], process.argv[4], process.argv[5]); else await parent(); }
catch (error) { console.error(error.stack || error); process.exitCode = 1; }
