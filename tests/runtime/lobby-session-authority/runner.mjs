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
const PARTICIPATION = process.argv.includes('--participation');
const EPHEMERAL_BODY_MARKERS = ['Native Stalemate ephemeral greeting', 'Native Rad Dad ephemeral greeting', 'Native remaining visitor greeting', 'native-media-control-no-body-persistence'].sort();
function assertNativeRollback(witness, record) {
    assert.deepEqual(Object.keys(witness).sort(), ['record', 'originalSha256', 'stagedSha256', 'restoredSha256', 'nativeWriteCompleted', 'stagedChanged', 'nativeTransactionRejected', 'restoredBeforeEngineRecovery'].sort());
    assert.equal(witness.record, record);
    for (const key of ['originalSha256', 'stagedSha256', 'restoredSha256']) assert.match(witness[key], /^[a-f0-9]{64}$/);
    assert.notEqual(witness.stagedSha256, witness.originalSha256);
    assert.equal(witness.restoredSha256, witness.originalSha256);
    for (const key of ['nativeWriteCompleted', 'stagedChanged', 'nativeTransactionRejected', 'restoredBeforeEngineRecovery']) assert.equal(witness[key], true);
}
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const sources = () => Object.fromEntries([
    ['fixture/runner.mjs', FILE], ['fixture/worker.mjs', join(HERE, 'worker.mjs')], ['fixture/README.md', join(HERE, 'README.md')],
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
    constructor(socket, label) {
        this.socket = socket; this.label = label; this.frames = []; this.bytes = 0; this.waiters = new Set(); this.closed = null; this.failure = null;
        this.commandCount = 0; this.barrierSequence = 0; this.lastCommand = null;
        socket.addEventListener('message', event => {
            try {
                assert.equal(typeof event.data, 'string', label + ': text frame required');
                this.bytes += event.data.length; assert.ok(this.bytes <= 2 * 1024 * 1024 && this.frames.length < 2000, label + ': output cap');
                const frame = JSON.parse(event.data); assert.equal(typeof frame?.t, 'string'); this.frames.push(frame);
                for (const check of [...this.waiters]) check();
            } catch (error) { this.failure = error; for (const check of [...this.waiters]) check(); }
        });
        socket.addEventListener('close', event => { this.closed = { code: event.code, reason: event.reason }; for (const check of [...this.waiters]) check(); });
        socket.addEventListener('error', () => { this.failure = Error(label + ': websocket error'); for (const check of [...this.waiters]) check(); });
        socket.accept();
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
    for (const suffix of ['/beta-entry.mjs', '/lobby-do.mjs', '/lobby-session-authority.mjs', '/lobby-core.mjs', '/lobby-effect-records.mjs', '/durable-record-storage.mjs'])
        assert.ok(Object.keys(bundleInputs).some(path => path.endsWith(suffix)), 'missing actual source ' + suffix);
    if (PARTICIPATION) for (const suffix of ['/lobby-participation.mjs', '/participation-enforcement.mjs', '/participation-partitions.mjs', '/participation-policy.mjs'])
        assert.ok(Object.keys(bundleInputs).some(path => path.endsWith(suffix)), 'missing actual participation source ' + suffix);
    let outboundCalls = 0, runtimeRestarts = 0;
    const options = convertV4MiniflareOptions({
        name: 'webjam-local-session-authority', rootPath: state, modulesRoot: state,
        modules: [{ type: 'ESModule', path: join(state, 'bundle.mjs'), contents: bundleCode }],
        compatibilityDate: '2026-10-01', compatibilityFlags: [], host: '127.0.0.1', port: 0, inspectorHost: '127.0.0.1', inspectorPort: 0,
        resourcePersistencePath: join(state, 'persist'), resourceTmpPath: join(state, 'runtime-' + phase),
        durableObjects: { LOBBY: { className: 'FixtureLobby', useSQLite: true }, ROOMS: { className: 'HangoutRoom', useSQLite: true }, QUOTA: { className: 'HangoutQuota', useSQLite: true } },
        bindings: { FIXTURE_NONCE: nonce, HANGOUT_SESSION_AUTHORITY: 'lobby-v1', HANGOUT_BETA_MODE: 'protected',
            ...(PARTICIPATION ? { HANGOUT_PARTICIPATION_AUTHORITY: 'c3-v1' } : {}),
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
    const unlock = async (ip, { grant = true } = {}) => {
        const response = await call('/beta/unlock', '', { key: INVITE }, ip); assert.equal(response.status, 200, 'real guest unlock refused');
        assert.deepEqual(await response.json(), { ok: true });
        const value = response.headers.get('Set-Cookie'); assert.equal(typeof value, 'string', 'missing real signed cookie');
        assert.ok(/^__Host-hangout-beta=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=[1-9][0-9]*$/.test(value), 'signed guest cookie policy was not satisfied');
        const cookie = value.split(';', 1)[0];
        if (PARTICIPATION && grant) assert.deepEqual(await control('participation-grant', { cookie }), { authorizedSyntheticGrant: true });
        return cookie;
    };
    const connect = async (cookie, label, source, ip) => {
        const response = await mf.dispatchFetch(ORIGIN + '/lobby?preview=' + PREVIEW, { headers: { ...headers(cookie, ip), Upgrade: 'websocket' } });
        assert.equal(response.status, 101, label + ': actual gateway upgrade refused'); assert.ok(response.webSocket, label + ': missing WebSocket');
        const visitor = new Visitor(response.webSocket, label); visitors.push(visitor);
        const hello = await visitor.wait(f => f.t === 'hello', 'actual hello'); assert.deepEqual(hello.features, { entrySources: 1, privateMessageContext: 1, roomKeep: 1 }); assert.equal(hello.role, 'fan');
        visitor.send({ t: 'hello', nick: label, age13: true, entrySource: source });
        await visitor.wait(f => f.t === 'join' && f.ch.name === '#stalemate', 'lobby membership');
        return visitor;
    };
    const joinRoom = (visitor, room) => visitor.command('join', [room], '#stalemate', f => f.t === 'join' && f.ch.name === room, 'join ' + room);
    const denyUnknown = async (cookie, label, dev = '') => {
        const query = new URLSearchParams({ preview: PREVIEW }); if (dev) query.set('dev', dev);
        const response = await mf.dispatchFetch(ORIGIN + '/lobby?' + query, { headers: { ...headers(cookie, '192.0.2.12'), Upgrade: 'websocket',
            'X-Hangout-Identity': JSON.stringify({ account: 'a_' + 'x'.repeat(43), role: 'owner', admin: true, principalRef: 'forged_principal_ref' }) } });
        assert.equal(response.status, 101); const visitor = new Visitor(response.webSocket, label); visitors.push(visitor);
        assert.equal((await visitor.wait(frame => frame.t === 'hello', 'actual ungranted hello')).role, 'fan');
        visitor.send({ t: 'hello', nick: label, age13: true, subjectRef: 'forged_subject_ref', principalRef: 'forged_principal_ref' });
        await visitor.wait(frame => frame.t === 'notice' && frame.kind === 'error' && /participation/.test(frame.text), 'actual ungranted refusal');
        assert.ok(visitor.frames.every(frame => frame.t !== 'welcome' && frame.t !== 'join'));
        const logout = await call('/beta/logout', cookie, {}); assert.equal(logout.status, 200); await logout.body?.cancel();
        assert.equal((await visitor.wait(() => false, 'ungranted session logout', 0, true)).code, 4401);
    };
    let proof, secrets;
    try {
        assert.equal((await mf.ready).hostname, '127.0.0.1');
        if (phase === 'visitors') {
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
            const a = await connect(cookieA, 'NativeAlpha', 'stalemate', '192.0.2.11');
            const b = await connect(cookieB, 'NativeBravo', 'rad-dad', '192.0.2.12');
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
            const bAt = b.frames.length, aAt = a.frames.length;
            b.send({ t: 'say', ch: '#stalemate', text: 'Native Rad Dad ephemeral greeting' });
            assert.equal((await a.wait(f => f.t === 'line' && f.text === 'Native Rad Dad ephemeral greeting', 'Rad Dad badge', aAt)).entrySource, 'rad-dad');
            a.send({ t: 'say', ch: '#stalemate', text: 'Native Stalemate ephemeral greeting' });
            assert.equal((await b.wait(f => f.t === 'line' && f.text === 'Native Stalemate ephemeral greeting', 'Stalemate badge', bAt)).entrySource, 'stalemate');
            await joinRoom(b, '#art-native-canvas'); await joinRoom(a, '#art-native-canvas');
            const stroke = { id: 'native-stroke-1', color: '#009ee8', size: 4, pts: [[0.1, 0.2], [0.3, 0.4]] }, paintAt = a.frames.length;
            b.send({ t: 'act', ch: '#art-native-canvas', kind: 'stroke', stroke });
            assert.deepEqual((await a.wait(f => f.t === 'act' && f.kind === 'stroke' && f.stroke.id === stroke.id, 'cross-site canvas', paintAt)).stroke, stroke);
            const cookieC = await unlock('192.0.2.13'), c = await connect(cookieC, 'NativeCharlie', '', '192.0.2.13');
            const newcomer = await joinRoom(c, '#native-channel');
            assert.equal(newcomer.ch.names.find(person => person.nick === 'NativeCharlie').entrySource, '');
            const canvasC = await joinRoom(c, '#art-native-canvas'); assert.deepEqual(canvasC.act.strokes, [stroke]);
            await c.barrier(); assert.ok(c.frames.every(frame => frame.t !== 'line' || !['Native selected report greeting', 'Native Rad Dad ephemeral greeting', 'Native Stalemate ephemeral greeting'].includes(frame.text)), 'new visitor received pre-join chat');
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
            const blockAtB = b.frames.length, blockAtC = c.frames.length;
            await b.command('block', ['NativeCharlie'], mediaRoom, frame => frame.t === 'notice' && frame.text.startsWith('Blocked '), 'native device block committed');
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
            c.send({ t: 'cmd', ch: mediaRoom, name: 'block', args: ['NativeBravo'] });
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
            assert.equal(afterFault.bindingCount, 2, 'lost-socket checkpoint needs live durable bindings'); assert.equal(b.closed, null); assert.equal(c.closed, null);
            secrets = { revokedCookie: cookieA, liveCookie: cookieB };
            proof = { admissionDenials, missingMarkerRefused: true, cookiePolicyVerified: true, actualGatewayVisitors: 3,
                checks: ['actual-beta-unlock-and-WebSocket-admission', 'stalemate-rad-dad-shared-chat-and-canvas', 'direct-newcomer-neutral-without-prejoin-chat', 'actual-report-persisted', 'connected-logout-and-cookie-replay-denied', 'ordinary-chat-excluded-from-durable-records', 'actual-device-block-policy-and-RTC-denial-persisted', 'actual-post-native-session-write-rollback-before-block-success', 'actual-post-native-write-rollback-before-success'],
                ...(PARTICIPATION ? { participationChecks: ['actual-DO-missing-policy-denies-without-provisioning', 'real-signed-SID-principal-with-explicit-synthetic-C2-grants', 'unfenced-private-room-and-TURN-denied', 'committed-media-reduction-production-alarm-closes-only-affected-visitor'] } : {}),
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
            const received = await recoveryMessage; secrets = received.secrets;
            assert.ok(secrets && typeof secrets.revokedCookie === 'string' && typeof secrets.liveCookie === 'string');
            const revoked = await call('/beta/state', secrets.revokedCookie); assert.equal(revoked.status, 401); await revoked.body?.cancel();
            const active = await call('/beta/state', secrets.liveCookie); assert.equal(active.status, 200); assert.equal((await active.json()).kind, 'guest');
            const recovered = await control('inspect');
            assert.equal(recovered.objectId, received.checkpoint.objectId); assert.deepEqual(recovered.rooms, received.checkpoint.rooms); assert.deepEqual(recovered.reports, received.checkpoint.reports);
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
            const returning = await connect(secrets.liveCookie, 'NativeReturn', 'rad-dad', '192.0.2.12');
            if (PARTICIPATION) {
                const device = returning.frames.find(frame => frame.t === 'device')?.token; assert.equal(typeof device, 'string');
                await denyUnknown(await unlock('192.0.2.12', { grant: false }), 'NativeBravo', device);
            }
            const canvas = await joinRoom(returning, '#art-native-canvas'); assert.equal(canvas.ch.count, 1); assert.equal(canvas.act.strokes[0].id, 'native-stroke-1');
            await returning.barrier(); assert.ok(returning.frames.every(frame => frame.t !== 'line'), 'cold newcomer received prior chat');
            proof = { checks: ['cold-process-loss-retires-missing-socket-bindings', 'committed-rooms-canvas-and-report-survive', 'revoked-cookie-stays-denied-active-cookie-reconnects'], recovered,
                ...(PARTICIPATION ? { participationChecks: ['actual-C3-reloads-partition-grant-after-process-loss', 'new-SID-cannot-inherit-grant-through-same-signed-device-IP-or-old-nickname'] } : {}),
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
    } finally { await mf.dispose(); }
    process.off('disconnect', disconnected); process.disconnect();
}

async function parent() {
    assert.deepEqual(process.argv.slice(2), PARTICIPATION ? ['--participation'] : []); bindingPackage();
    const before = sources(), state = realpathSync(await mkdtemp(join(tmpdir(), 'webjam-session-native-'))), nonce = randomBytes(16).toString('hex');
    let current, groupNeedsCleanup = false, interrupted;
    const interrupt = signal => { interrupted ||= Error('interrupted ' + signal); if (groupNeedsCleanup) kill(current?.pid); };
    process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
    const run = (phase, recovery) => new Promise((resolve, reject) => {
        let stdout = '', stderr = '', checkpoint, result, preKill, timer, settled = false;
        const fail = error => { if (settled) return; settled = true; clearTimeout(timer); if (groupNeedsCleanup) kill(current?.pid); reject(error); };
        current = spawn(process.execPath, [FILE, '--isolated', phase, state, nonce, ...(PARTICIPATION ? ['--participation'] : [])], { cwd: HERE,
            env: Object.fromEntries(ENV.filter(name => typeof process.env[name] === 'string').map(name => [name, process.env[name]])), detached: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] }); groupNeedsCleanup = true;
        const proc = current;
        const append = (value, chunk) => { const next = value + chunk; if (next.length > 262144) { fail(Error('bounded runtime logs exceeded')); return value; } return next; };
        proc.stdout.on('data', chunk => { stdout = append(stdout, chunk.toString()); }); proc.stderr.on('data', chunk => { stderr = append(stderr, chunk.toString()); });
        proc.on('error', fail); timer = setTimeout(() => fail(Error(phase + ': 60s proof timeout; no automatic retry\n' + stderr)), 60000);
        if (phase === 'recover') proc.send({ type: 'recovery', nonce, checkpoint: recovery.proof.checkpoint, secrets: recovery.secrets }, error => { if (error) fail(error); });
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
    console.log(JSON.stringify({ localGatewayWebSocketSessionAuthorityQualified: true, ...(PARTICIPATION ? { productionParticipationCompositionQualified: true, guardianDecisionsQualified: false } : {}), first, recovered, node: process.version, platform: process.platform, architecture: process.arch,
        temporaryStateRemoved: true, scope: 'Actual betaFetch guest cookies, real local WebSocket visitors, actual HangoutLobby and SQLite authority/effect transactions. Explicit test-only known-empty bootstrap. Whole owned runtime killed with visitors connected; fresh runtime recovery. ' + (PARTICIPATION ? 'Required production C3 bridge selected; only operator/guardian consent decisions are explicitly synthetic. No real enrollment/guardian or external provider qualification. ' : '') + 'No browser cookie-storage, real Access OTP/staff identity, C2 guardian consent, hosted deployment/drain/limits/cost, TURN/camera, or native WebJam installation/audio qualification.' }, null, 2));
}
try { if (process.argv[2] === '--isolated' && process.argv.length === (PARTICIPATION ? 7 : 6)) await runtime(process.argv[3], process.argv[4], process.argv[5]); else await parent(); }
catch (error) { console.error(error.stack || error); process.exitCode = 1; }
