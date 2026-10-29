// Test-only native domain proof. Actual engine supplies metadata/effects, but
// there is no C3/session/guardian authority or production route in this fixture.
import { createLobby } from '../../../hangout-worker/src/lobby-core.mjs';
import { createDurableRecordStorage } from '../../../hangout-worker/src/durable-record-storage.mjs';
import { initializeLobbyEffects, writeLobbyEffects, readLobbyState, LOBBY_LOG_INDEX } from '../../../hangout-worker/src/lobby-effect-records.mjs';
const ensure = (value, reason) => { if (!value) throw Error(reason); };
const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))].map(n => n.toString(16).padStart(2, '0')).join('');
const guarded = (request, env) => !request.headers.has('Origin') && request.headers.get('X-Fixture-Nonce') === env.FIXTURE_NONCE;
const denied = () => new Response('owned fixture denied', { status: 403 });
const logicalKey = key => typeof key === 'string' && key.includes(':manifest:') ? String.fromCharCode(...key.split(':manifest:')[1].match(/../g).map(value => parseInt(value, 16))) : '';
function sourceEngine(at) {
    const effects = [], frames = [];
    const engine = createLobby({ now: () => at, persist: (kind, value) => { effects.push([kind, structuredClone(value)]); },
        send: (id, frame) => frames.push({ id, ...structuredClone(frame) }) });
    const initial = { net: engine.snapshot(), rooms: engine.roomSnapshot(), abuse: engine.abuseSnapshot(), sessions: engine.sessionSnapshot(),
        moderationQueue: { reports: [], held: [] }, aiReviews: [], modlog: [] };
    return { engine, initial, effects, frames };
}
export class LobbyProof {
    constructor(state, env) {
        this.state = state; this.env = env; this.control = { calls: 0, faultKey: '', tripped: false };
        const storage = { transaction: operation => state.storage.transaction(raw => operation(new Proxy(raw, { get: (target, key) => {
            const method = Reflect.get(target, key, target);
            if (typeof method !== 'function') return method;
            if (!['get', 'put', 'delete', 'list'].includes(key)) return method.bind(target);
            return async (...args) => {
                this.control.calls++;
                const result = await method.apply(target, args);
                if (key === 'put' && this.control.faultKey && logicalKey(args[0]) === this.control.faultKey) {
                    this.control.faultKey = ''; this.control.tripped = true;
                    throw Error('owned-after-actual-native-manifest-write');
                }
                return result;
            };
        } }))) };
        this.records = createDurableRecordStorage({ storage, namespace: 'lobby-native-proof', maxRecordBytes: 8 * 1024 * 1024 });
    }
    async load(at) { return this.records.transaction(tx => readLobbyState({ tx, now: at })); }
    async main(at) {
        const source = sourceEngine(at);
        await this.records.transaction(tx => initializeLobbyEffects({ tx, now: at, state: source.initial }));
        const visitor = { id: 'native_socket', dev: 'native_device', iph: 'native_ip', account: 'a'.repeat(64), role: 'fan', admin: false };
        await source.engine.connect(visitor);
        await source.engine.message(visitor.id, JSON.stringify({ t: 'hello', nick: 'NativeGuest', age13: true }));
        await source.engine.message(visitor.id, JSON.stringify({ t: 'cmd', ch: '#stalemate', name: 'join', args: ['#native-durable'] }));
        await source.engine.message(visitor.id, JSON.stringify({ t: 'cmd', ch: '#native-durable', name: 'register', args: [] }));
        await source.engine.message(visitor.id, JSON.stringify({ t: 'say', ch: '#stalemate', text: 'Ordinary native greeting remains ephemeral' }));
        ensure(source.engine.roomSnapshot().rooms[0]?.owner === visitor.account, 'actual-engine-room-ownership-not-generated');
        ensure(source.effects.some(([kind]) => kind === 'rooms') && source.effects.some(([kind]) => kind === 'sessions') && source.effects.some(([kind]) => kind === 'modlog'), 'actual-engine-effects-not-generated');
        await this.records.transaction(tx => writeLobbyEffects({ tx, effects: source.effects, now: at }));
        const committedEffectKinds = [...new Set(source.effects.map(([kind]) => kind))];
        const saved = await this.load(at), baseline = await digest(saved);
        ensure(saved.rooms.rooms[0].owner === visitor.account && saved.sessions.connections[0].nick === 'NativeGuest', 'native-domain-write-mismatch');
        ensure(!JSON.stringify(saved).includes('Ordinary native greeting remains ephemeral'), 'ordinary-body-retained');
        // Generate another real engine room effect. There is deliberately no
        // claim that pure engine output staging constitutes a C3 commit proof.
        source.effects.length = 0;
        await source.engine.message(visitor.id, JSON.stringify({ t: 'cmd', ch: '#native-durable', name: 'topic', args: ['Owned native rollback artifact'] }));
        ensure(source.effects.some(([kind, value]) => kind === 'rooms' && value.rooms[0].topic === 'Owned native rollback artifact'), 'actual-topic-effect-not-generated');
        this.control.faultKey = 'community-room:#native-durable'; this.control.tripped = false;
        let failed = false;
        try { await this.records.transaction(tx => writeLobbyEffects({ tx, effects: source.effects, now: at })); }
        catch (error) { failed = error.message === 'owned-after-actual-native-manifest-write'; }
        ensure(failed && this.control.tripped, 'native-room-fault-not-observed');
        ensure(await digest(await this.load(at)) === baseline, 'native-room-fault-did-not-roll-back');
        const template = saved.modlog.find(row => row.action === 'room-register'); ensure(template, 'actual-log-template-missing');
        return { objectId: this.state.id.toString(), digest: baseline, room: saved.rooms.rooms[0].name, owner: saved.rooms.rooms[0].owner,
            sessionNick: saved.sessions.connections[0].nick, effectKinds: committedEffectKinds, sourceLogTemplate: template,
            roomFaultAfterNativeWrite: true, checks: [{ name: 'actual-engine-effects-native-commit', pass: true }, { name: 'actual-native-room-manifest-fault-rolls-back', pass: true }] };
    }
    async logs(at, template) {
        const source = sourceEngine(at), entries = Array.from({ length: 2000 }, (_, index) => ({ ...template, target: `#native-log-${index}` }));
        source.initial.modlog = entries;
        this.control.calls = 0;
        await this.records.transaction(tx => initializeLobbyEffects({ tx, now: at, state: source.initial }));
        const initializeCalls = this.control.calls;
        this.control.calls = 0; const before = await this.load(at), readCalls = this.control.calls;
        ensure(before.modlog.length === 2000 && initializeCalls < 4096 && readCalls < 4096, 'native-log-capacity');
        const beforeDigest = await digest(before), additions = [2000, 2001].map(index => ['modlog', { ...template, target: `#native-log-${index}` }]);
        this.control.faultKey = LOBBY_LOG_INDEX; this.control.tripped = false;
        let failed = false;
        try { await this.records.transaction(tx => writeLobbyEffects({ tx, effects: additions, now: at })); }
        catch (error) { failed = error.message === 'owned-after-actual-native-manifest-write'; }
        ensure(failed && this.control.tripped && await digest(await this.load(at)) === beforeDigest, 'native-log-index-fault-rollback');
        this.control.calls = 0; await this.records.transaction(tx => writeLobbyEffects({ tx, effects: additions, now: at }));
        const appendCalls = this.control.calls, saved = await this.load(at), index = await this.records.transaction(tx => tx.get(LOBBY_LOG_INDEX));
        ensure(appendCalls < 4096 && saved.modlog.length === 2000 && saved.modlog[0].target === '#native-log-2' && saved.modlog.at(-1).target === '#native-log-2001'
            && index.segments.length === 32 && index.next === 2002, 'native-log-append-trim-mismatch');
        return { objectId: this.state.id.toString(), digest: await digest(saved), logs: saved.modlog.length, segments: index.segments.length, next: index.next,
            physicalCalls: { initialize2000: initializeCalls, read2000: readCalls, appendTwoTrim2000: appendCalls }, logIndexFaultAfterNativeWrite: true,
            checks: [{ name: 'native-2000-log-segments-read-rollback-append', pass: true }] };
    }
    async fetch(request) {
        if (!guarded(request, this.env) || request.method !== 'POST') return denied();
        let body; try { body = await request.json(); } catch { return denied(); }
        if (!body || !['main', 'logs', 'recover'].includes(body.phase) || !Number.isSafeInteger(body.at) || Math.abs(Date.now() - body.at) > 300000) return denied();
        return this.state.blockConcurrencyWhile(async () => {
            try {
                const sql = [...this.state.storage.sql.exec('SELECT 1 AS fixture_sql')]; ensure(sql[0].fixture_sql === 1, 'SQLite-not-enabled');
                if (body.phase === 'main') return Response.json(await this.main(body.at));
                if (body.phase === 'logs') return Response.json(await this.logs(body.at, body.template));
                this.control.calls = 0; const saved = await this.load(body.at), calls = this.control.calls;
                return Response.json({ objectId: this.state.id.toString(), digest: await digest(saved), physicalReadCalls: calls,
                    rooms: saved.rooms.rooms.length, logs: saved.modlog.length });
            } catch (error) { return Response.json({ error: String(error.stack || error).slice(0, 8192) }, { status: 500 }); }
        });
    }
}
export default { async fetch(request, env) {
    if (!guarded(request, env) || request.method !== 'POST' || request.headers.get('Content-Type') !== 'application/json') return denied();
    const bytes = await request.arrayBuffer(); if (bytes.byteLength > 512) return denied();
    let body; try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return denied(); }
    if (!body || Object.keys(body).sort().join(',') !== 'at,phase' || !Number.isSafeInteger(body.at) || !['qualify', 'recover'].includes(body.phase)) return denied();
    const call = async (name, value) => {
        const response = await env.RECORDS.get(env.RECORDS.idFromName(name)).fetch(new Request('https://owned-proof/', { method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Fixture-Nonce': env.FIXTURE_NONCE }, body: JSON.stringify(value) }));
        const result = await response.json(); ensure(response.status === 200, JSON.stringify(result)); return result;
    };
    if (body.phase === 'recover') return Response.json({ main: await call('main', { phase: 'recover', at: body.at }), logs: await call('logs', { phase: 'recover', at: body.at }) });
    const main = await call('main', { phase: 'main', at: body.at });
    return Response.json({ main, logs: await call('logs', { phase: 'logs', at: body.at, template: main.sourceLogTemplate }) });
} };
