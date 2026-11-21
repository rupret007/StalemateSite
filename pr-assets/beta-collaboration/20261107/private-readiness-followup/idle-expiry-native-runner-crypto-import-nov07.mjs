import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, realpathSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const ROOT = dirname(new URL(import.meta.url).pathname), ORIGIN = 'https://local-fixture.invalid';
const sha = body => createHash('sha256').update(body).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const toolRequire = createRequire(join(ROOT, 'tools/package.json'));
const { Miniflare, convertV4MiniflareOptions, Log, LogLevel } = await import(pathToFileURL(toolRequire.resolve('miniflare')).href);
const INVITE = 'synthetic-fixture-invite-not-real-20261107', PREVIEW = 'synthetic-fixture-preview-not-real-20261107';
const results = { state: 'RUNNING_CONTROLLED_NATIVE_ALARM_FIXTURE', productionTtlMs: 28800000, syntheticAccessMs: 10000,
    shortenedProductionTtl: false, manualAlarmCalls: 0, clockAdvances: 0, providerCredentials: false, physicalCapture: false,
    hostedEightHourQualification: false, cases: [] };
const save = () => writeFileSync(join(ROOT, 'native-alarm-crypto-import-result.json'), JSON.stringify(results, null, 2) + '\n', { mode: 0o600 });
class Visitor {
    constructor(socket) {
        this.socket = socket; this.frames = []; this.closed = null; this.failure = false;
        socket.addEventListener('message', event => { try { this.frames.push(JSON.parse(event.data)); assert.ok(this.frames.length <= 200); } catch { this.failure = true; } });
        socket.addEventListener('close', event => { this.closed = { code: event.code, at: Date.now() }; });
        socket.addEventListener('error', () => { this.failure = true; }); socket.accept();
    }
    async frame(predicate, since = 0) {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
            assert.equal(this.failure, false, 'client parse/socket failure');
            const frame = this.frames.slice(since).find(predicate); if (frame) return frame;
            assert.equal(this.closed, null, 'closed before expected frame'); await sleep(10);
        }
        throw Error('expected fixture frame not received');
    }
    send(body) { assert.equal(this.socket.readyState, 1); this.socket.send(JSON.stringify(body)); }
}
save();
try {
    for (const label of ['before', 'after']) {
        const app = join(ROOT, label), nonce = randomBytes(16).toString('hex'), state = join(ROOT, 'runtime-crypto-import-' + label);
        mkdirSync(state, { mode: 0o700 });
        const appRequire = createRequire(join(app, 'package.json'));
        const { rolldown } = await import(pathToFileURL(appRequire.resolve('rolldown')).href), inputs = {};
        const bundler = await rolldown({ input: join(app, 'fixture-worker.mjs'), platform: 'neutral', plugins: [{ name: 'frozen-inputs', transform(code, id) {
            if (id.startsWith('\0')) return null;
            const path = realpathSync(id); assert.equal(sha(code), sha(readFileSync(path))); inputs[path] = sha(code); return null;
        } }] });
        let generated; try { generated = await bundler.generate({ format: 'esm', codeSplitting: false, sourcemap: false }); } finally { await bundler.close(); }
        assert.equal(generated.output.length, 1); const bundle = generated.output[0]; assert.equal(bundle.type, 'chunk'); assert.deepEqual(bundle.imports, ['node:crypto']);
        let outbound = 0, restarts = 0;
        const options = convertV4MiniflareOptions({ name: 'owned-native-idle-' + label, rootPath: state, modulesRoot: state,
            modules: [{ type: 'ESModule', path: join(state, 'bundle.mjs'), contents: bundle.code }],
            compatibilityDate: '2026-10-01', compatibilityFlags: [], host: '127.0.0.1', port: 0, inspectorHost: '127.0.0.1', inspectorPort: 0,
            resourcePersistencePath: join(state, 'persist'), resourceTmpPath: join(state, 'tmp'),
            durableObjects: { LOBBY: { className: 'FixtureLobby', useSQLite: true }, BETA_SESSIONS: { className: 'BetaSessions', useSQLite: true },
                ROOMS: { className: 'HangoutRoom', useSQLite: true }, QUOTA: { className: 'HangoutQuota', useSQLite: true } },
            bindings: { FIXTURE_NONCE: nonce, HANGOUT_BETA_MODE: 'protected', HANGOUT_BETA_INVITE_VERSION: '1', HANGOUT_OPEN: '1',
                HANGOUT_AI_ENABLED: '0', HANGOUT_TURN_ENABLED: '0', HANGOUT_HMAC_KEY: 'synthetic-fixture-hmac-never-production-20261107',
                HANGOUT_BETA_INVITE_KEY: INVITE, HANGOUT_PREVIEW_KEY: PREVIEW },
            outboundService: () => { outbound++; return new Response('denied', { status: 503 }); },
            cf: false, telemetry: { enabled: false }, unsafeRegisterWorker: false, unsafeRuntimeEnv: {},
            unsafeHandleRuntimeRestart: () => { restarts++; }, log: new Log(LogLevel.ERROR), logRequests: false });
        options.unsafeEnableSharedStorage = false;
        const mf = new Miniflare(options), clients = [], proof = { label, bundleSha256: sha(bundle.code), sourceInputs: inputs };
        results.cases.push(proof); save();
        try {
            await mf.ready;
            const headers = cookie => ({ Origin: ORIGIN, 'X-Fixture-Nonce': nonce, 'CF-Connecting-IP': '192.0.2.44', ...(cookie ? { Cookie: cookie } : {}) });
            const call = (path, cookie, body) => mf.dispatchFetch(ORIGIN + path, { headers: { ...headers(cookie), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
                ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
            const connect = async (cookie, nick) => {
                const response = await mf.dispatchFetch(ORIGIN + '/lobby?preview=' + PREVIEW, { headers: { ...headers(cookie), Upgrade: 'websocket' } });
                assert.equal(response.status, 101); const visitor = new Visitor(response.webSocket); clients.push(visitor);
                assert.equal((await visitor.frame(f => f.t === 'hello')).role, 'fan');
                visitor.send({ t: 'hello', nick, age13: true }); await visitor.frame(f => f.t === 'join' && f.ch.name === '#stalemate'); return visitor;
            };
            const ordinary = await call('/beta/unlock', '', { key: INVITE }); assert.equal(ordinary.status, 200); await ordinary.body?.cancel();
            const healthyCookie = ordinary.headers.get('Set-Cookie').split(';', 1)[0];
            const healthy = await connect(healthyCookie, 'Healthy' + label);
            const issued = await call('/_fixture/short-access', '', {}); assert.equal(issued.status, 200);
            const access = await issued.json(); assert.equal(access.productionTtlMs, 28800000); proof.expiresAt = access.expiresAt;
            const signedCookie = issued.headers.get('Set-Cookie').split(';', 1)[0];
            const quiet = await connect(signedCookie, 'Quiet' + label);
            const inspection = await call('/_fixture/alarm', healthyCookie); assert.equal(inspection.status, 200);
            proof.scheduledAlarm = (await inspection.json()).alarm; proof.alarmOffsetFromExpiryMs = proof.scheduledAlarm - proof.expiresAt;
            if (label === 'before') assert.ok(proof.alarmOffsetFromExpiryMs > 40000, 'old minute alarm must reproduce late deadline');
            else assert.equal(proof.scheduledAlarm, proof.expiresAt, 'fix must schedule actual expiry');
            assert.ok(Date.now() < proof.expiresAt - 5000, 'join/pre-expiry setup overran bounded window');
            proof.quietStartedAt = Date.now(); save();
            // No requests, client frames, clock changes, or manual alarm calls until this checkpoint.
            await sleep(proof.expiresAt + 3000 - Date.now());
            proof.checkedAt = Date.now(); proof.quietSocketClose = quiet.closed; proof.quietSocketReadyState = quiet.socket.readyState;
            if (label === 'before') { assert.equal(quiet.closed, null); assert.equal(quiet.socket.readyState, 1); }
            else { assert.equal(quiet.closed?.code, 4401); assert.ok(quiet.closed.at >= proof.expiresAt && quiet.closed.at - proof.expiresAt < 3000); }
            // Replay the identical RAM-only signed cookie beyond its expiry; no cookie rewrite/reissue.
            proof.replayStatuses = {};
            for (const path of ['/beta/state', '/join/app.js']) { const r = await call(path, signedCookie); proof.replayStatuses[path] = r.status; await r.body?.cancel(); assert.equal(r.status, 401); }
            const since = healthy.frames.length; healthy.send({ t: 'cmd', name: 'help', args: [], ch: '#stalemate' });
            await healthy.frame(f => f.t === 'notice', since); proof.healthyGuestStillResponds = true;
            const logout = await call('/beta/logout', healthyCookie, {}); assert.equal(logout.status, 200); await logout.body?.cancel();
            proof.outboundCalls = outbound; proof.runtimeRestarts = restarts; assert.equal(outbound, 0); assert.equal(restarts, 0);
            proof.state = label === 'before' ? 'EXPECTED_OLD_SOURCE_QUIET_EXPIRY_FAILURE_REPRODUCED' : 'FIXED_SOURCE_NATIVE_AUTOMATIC_4401_AND_EXPIRED_COOKIE_REFUSAL';
        } finally {
            for (const client of clients) if (!client.closed) { try { client.socket.close(1000, 'owned fixture cleanup'); } catch {} }
            await mf.dispose(); proof.runtimeDisposed = true;
            for (const [path, expected] of Object.entries(inputs)) assert.equal(sha(readFileSync(path)), expected);
            proof.sourceUnchangedAfter = true; save();
        }
    }
    results.state = 'CONTROLLED_NATIVE_BEFORE_AFTER_ALARM_CHECK_PASSED_NOT_HOSTED_EIGHT_HOUR_PROOF';
} catch (error) { results.state = 'NATIVE_FIXTURE_STOPPED_INSPECT_ORIGINAL_NO_RETRY'; results.failure = { name: error.name, message: error.message.slice(0, 500) }; process.exitCode = 1; }
finally { results.completedAt = new Date().toISOString(); save(); console.log(JSON.stringify(results)); }
