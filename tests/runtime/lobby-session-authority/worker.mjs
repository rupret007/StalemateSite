// Test-only, nonce-protected Worker. This file is not an application route,
// production bootstrap, staff appointment, or C2 consent grant.
import { betaFetch, HangoutLobby, HangoutRoom, HangoutQuota, HangoutTurnBudget } from '../../../hangout-worker/src/beta-entry.mjs';
import { LOBBY_AUTHORITY_PATH } from '../../../hangout-worker/src/lobby-session-authority.mjs';
export { HangoutRoom, HangoutQuota, HangoutTurnBudget };

const ORIGIN = 'https://local-fixture.invalid';
const PREFIX = '/_fixture/';
const ordinaryNeedles = ['Native Stalemate ephemeral greeting', 'Native Rad Dad ephemeral greeting', 'Native remaining visitor greeting'];
const ensure = (condition, label) => { if (!condition) throw Error(label); };
const denied = () => new Response('local fixture admission denied', { status: 403 });
const sha = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
function logicalKey(key) {
    if (typeof key !== 'string' || !key.includes(':manifest:')) return '';
    const suffix = key.split(':manifest:')[1];
    if (!/^(?:[a-f0-9]{2})+$/.test(suffix)) return '';
    return new TextDecoder().decode(Uint8Array.from(suffix.match(/../g), pair => parseInt(pair, 16)));
}
function admitted(request, env) {
    const url = new URL(request.url);
    return url.origin === ORIGIN && request.headers.get('X-Fixture-Nonce') === env.FIXTURE_NONCE;
}
async function readControl(request) {
    if (request.method !== 'POST' || request.headers.has('Origin') || request.headers.get('Content-Type') !== 'application/json') return null;
    const data = await request.arrayBuffer(); if (data.byteLength > 2048) return null;
    try { const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)); return value && typeof value === 'object' && !Array.isArray(value) ? value : null; }
    catch { return null; }
}

export class FixtureLobby extends HangoutLobby {
    constructor(state, env) {
        const control = { faultKey: '', tripped: false, nativeWriteCompleted: false, nativeCalls: 0 };
        const wrap = target => new Proxy(target, { get(raw, key) {
            const method = Reflect.get(raw, key, raw);
            if (typeof method !== 'function') return method;
            if (key === 'transaction') return operation => method.call(raw, tx => operation(wrap(tx)));
            if (!['get', 'put', 'delete', 'list', 'getAlarm', 'setAlarm', 'deleteAlarm'].includes(key)) return method.bind(raw);
            return async (...args) => {
                control.nativeCalls++;
                const result = await method.apply(raw, args);
                // Fault only after the actual native SQLite write resolved.
                if (key === 'put' && control.faultKey && logicalKey(args[0]) === control.faultKey) {
                    control.faultKey = ''; control.tripped = true; control.nativeWriteCompleted = true;
                    throw Error('owned-native-post-write-fault');
                }
                return result;
            };
        } });
        const storage = wrap(state.storage);
        const wrappedState = new Proxy(state, { get(target, key) {
            if (key === 'storage') return storage;
            const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
        } });
        super(wrappedState, env);
        this.fixtureControl = control;
    }
    async fixtureInspect() {
        const saved = await this.authority.load();
        const rooms = saved.state.rooms.rooms.map(room => ({ name: room.name, kind: room.kind, title: room.title, topic: room.topic, act: room.act }));
        const reportSummaries = await Promise.all(saved.state.moderationQueue.reports.map(async report => ({
            id: report.id, ch: report.ch, from: report.from, textSha256: await sha(report.text),
            contextSha256: await Promise.all(report.context.map(sha)), votes: report.devs.length, hidden: report.hidden
        })));
        const absent = Object.fromEntries(ordinaryNeedles.map(needle => [needle, true]));
        const logicalScan = await this.authority.records.transaction(async tx => {
            let cursor, rows = 0, bytes = 0; const known = new Set();
            for (;;) {
                const page = await tx.list({ prefix: '', ...(cursor ? { startAfter: cursor } : {}), limit: 4 });
                ensure(page instanceof Map && page.size <= 4, 'logical-scan-not-bounded');
                if (!page.size) break;
                for (const [key, value] of page) {
                    ensure(++rows <= 256, 'logical-scan-row-cap');
                    const text = JSON.stringify(value); bytes += new TextEncoder().encode(text).byteLength;
                    ensure(bytes <= 8 * 1024 * 1024, 'logical-scan-byte-cap');
                    for (const needle of ordinaryNeedles) if (text.includes(needle)) absent[needle] = false;
                    known.add(key); cursor = key;
                }
            }
            // A missing/wrong namespace must never make absence vacuously pass.
            for (const key of ['net', 'room-index', 'moderation-queue', 'private-reports-v1', 'authority-session-index:v1', 'authority-connection-index:v1'])
                ensure(known.has(key), 'logical-scan-required-record-missing');
            return { rows, bytes, requiredRecordsPresent: true };
        });
        let cursor, rows = 0, bytes = 0;
        const rawAbsent = Object.fromEntries(ordinaryNeedles.map(needle => [needle, true]));
        // Own fresh fixture keyspace only. This does not inventory production
        // raw keys or establish an old-writer drain/migration prerequisite.
        for (;;) {
            const page = await this.state.storage.list({ prefix: 'durable-record:v1:lobby-authority-v1:', ...(cursor ? { startAfter: cursor } : {}), limit: 4 });
            ensure(page instanceof Map && page.size <= 4, 'raw-scan-not-bounded');
            if (!page.size) break;
            for (const [key, value] of page) {
                ensure(++rows <= 256, 'raw-scan-row-cap');
                const text = value instanceof Uint8Array ? new TextDecoder().decode(value) : value instanceof ArrayBuffer ? new TextDecoder().decode(value) : JSON.stringify(value);
                bytes += new TextEncoder().encode(text).byteLength; ensure(bytes <= 8 * 1024 * 1024, 'raw-scan-byte-cap');
                for (const needle of ordinaryNeedles) if (text.includes(needle)) rawAbsent[needle] = false;
                cursor = key;
            }
        }
        ensure(rows > 0 && bytes > 0, 'raw-scan-empty');
        return { objectId: this.state.id.toString(), sqlite: [...this.state.storage.sql.exec('SELECT 1 AS fixture_sql')][0]?.fixture_sql === 1,
            authorityUnavailable: !!this.authorityUnavailable, bindingCount: saved.bindings.length, liveBindingCount: this.liveBindings.size,
            durableSessionNicks: saved.state.sessions.connections.map(person => person.nick).sort(),
            engineSessionNicks: this.engine.sessionSnapshot().connections.map(person => person.nick).sort(),
            rooms, reports: reportSummaries, ordinaryBodiesAbsent: absent,
            logicalScan, rawScan: { rows, bytes, perChunkOrdinaryBodiesAbsent: rawAbsent },
            fault: { tripped: this.fixtureControl.tripped, nativeWriteCompleted: this.fixtureControl.nativeWriteCompleted } };
    }
    async fetch(request) {
        const path = new URL(request.url).pathname;
        if (!path.startsWith(PREFIX)) return super.fetch(request);
        if (!admitted(request, this.env)) return denied();
        const body = await readControl(request); if (!body) return denied();
        await this.ready;
        return this.state.blockConcurrencyWhile(async () => {
            try {
                if (path === PREFIX + 'inspect' && Object.keys(body).length === 0) return Response.json(await this.fixtureInspect());
                if (path === PREFIX + 'fault' && Object.keys(body).join(',') === 'room' && body.room === '#art-native-canvas') {
                    ensure(!this.fixtureControl.faultKey && !this.fixtureControl.tripped, 'fault-already-used');
                    this.fixtureControl.faultKey = 'community-room:' + body.room;
                    return Response.json({ armed: true });
                }
                return denied();
            } catch (error) { return Response.json({ error: String(error.message).slice(0, 512) }, { status: 500 }); }
        });
    }
}

export default { async fetch(request, env) {
    if (!admitted(request, env)) return denied();
    const url = new URL(request.url), stub = env.LOBBY.get(env.LOBBY.idFromName('stalemate'));
    if (url.pathname.startsWith(PREFIX)) {
        const body = await readControl(request); if (!body) return denied();
        if (url.pathname === PREFIX + 'initialize' && Object.keys(body).length === 0) {
            // Explicit fixture lifecycle action; betaFetch never forwards it.
            return stub.fetch(new Request(ORIGIN + LOBBY_AUTHORITY_PATH + 'initialize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
        }
        if (['inspect', 'fault'].includes(url.pathname.slice(PREFIX.length))) return stub.fetch(new Request(request.url, {
            method: 'POST', headers: request.headers, body: JSON.stringify(body)
        }));
        if (url.pathname === PREFIX + 'egress-probe' && Object.keys(body).length === 0) {
            const response = await fetch('https://outbound-denied.invalid/fixture');
            return Response.json({ status: response.status, denied: response.headers.get('X-WebJam-Test-Egress') === 'denied' });
        }
        return denied();
    }
    if (!['/beta/unlock', '/beta/logout', '/beta/state', '/lobby'].includes(url.pathname)) return denied();
    if (request.headers.get('Origin') !== ORIGIN) return denied();
    const appEnv = { ...env, ASSETS: { fetch: () => new Response('no fixture page requested', { status: 404 }) } };
    return betaFetch(request, appEnv);
} };
