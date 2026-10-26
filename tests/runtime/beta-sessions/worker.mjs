// Test-only fault/inspection routes around the actual imported BetaSessions.
// Every injected exception follows an awaited REAL native storage operation.
import { BetaSessions } from '../../../hangout-worker/src/beta-sessions.mjs';
const SID = 'native-registry-session-0001', LIVE = 'native-still-live-session-0001';
const IP = 'A'.repeat(22), OTHER_IP = 'B'.repeat(22);
const guarded = (request, env) => !request.headers.has('Origin') && request.headers.get('X-Fixture-Nonce') === env.FIXTURE_NONCE;
const denied = () => new Response('local fixture denied', { status: 403 });
function wrapStorage(storage, control, scope = 'storage') {
    return new Proxy(storage, { get(target, key) {
        if (key === 'transaction') return operation => target.transaction(tx => operation(wrapStorage(tx, control, 'transaction')));
        const value = Reflect.get(target, key, target);
        if (typeof value !== 'function') return value;
        if (!['put', 'delete', 'setAlarm', 'deleteAlarm'].includes(key)) return value.bind(target);
        return async (...args) => {
            const result = await value.apply(target, args);
            const event = { scope, operation: key, key: typeof args[0] === 'string' ? args[0] : '', batch: Array.isArray(args[0]) ? args[0].length : 0 };
            control.events.push(event);
            if (key === 'delete' && Array.isArray(args[0])) control.deleteCalls++;
            const trip = control.mode === 'budget' && key === 'put' && args[0] === 'mint-rates' && args[1]?.[IP]?.count > 0
                || control.mode === 'session' && key === 'put' && args[0] === `session:${SID}`
                || control.mode === 'alarm' && key === 'setAlarm'
                || control.mode === 'second-delete' && key === 'delete' && Array.isArray(args[0]) && control.deleteCalls === 2;
            if (trip) { const mode = control.mode; control.mode = null; control.tripped = { mode, ...event }; throw Error(`owned-native-fault-after-${mode}`); }
            return result;
        };
    } });
}
class InspectBeta extends BetaSessions {
    constructor(state, env) {
        const control = { mode: null, events: [], deleteCalls: 0, tripped: null };
        super({ storage: wrapStorage(state.storage, control), blockConcurrencyWhile: state.blockConcurrencyWhile.bind(state) }, env);
        this.nativeState = state; this.control = control;
    }
    async inspect() {
        let sql = false;
        try { sql = [...this.nativeState.storage.sql.exec('SELECT 1 AS probe')][0].probe === 1; } catch { /* expected legacy denial */ }
        return { objectId: this.nativeState.id.toString(), sqlite: sql, records: [...await this.nativeState.storage.list({ prefix: 'session:', limit: 1001 })],
            rates: await this.nativeState.storage.get('mint-rates') ?? null, alarm: await this.nativeState.storage.getAlarm(), control: structuredClone(this.control) };
    }
    async fetch(request) {
        if (!guarded(request, this.env) || request.method !== 'POST') return denied();
        let command;
        try { command = await request.json(); } catch { return denied(); }
        if (!command || Object.keys(command).sort().join(',') !== 'phase' || typeof command.phase !== 'string') return denied();
        const phase = command.phase;
        if (phase === 'inspect') return Response.json(await this.inspect());
        if (phase === 'seed-prune') return this.nativeState.blockConcurrencyWhile(async () => {
            const at = Date.now(), rows = [];
            for (let index = 0; index < 271; index++) {
                const sid = `expired-session-${String(index).padStart(16, '0')}`;
                rows.push([`session:${sid}`, { v: 1, sid, version: '1', createdAt: at - 7200000, exp: at - 3600000,
                    revoked: true, pending: true, attempt: 1, retryAt: at - 3600000, rooms: [] }]);
            }
            rows.push([`session:${LIVE}`, { v: 1, sid: LIVE, version: '1', createdAt: at, exp: at + 3600000,
                revoked: false, pending: false, attempt: 0, retryAt: 0, rooms: [] }]);
            for (let index = 0; index < rows.length; index += 128) await this.nativeState.storage.put(Object.fromEntries(rows.slice(index, index + 128)));
            await this.nativeState.storage.put('mint-rates', { [IP]: { until: at - 1000, count: 2 }, [OTHER_IP]: { until: at + 3600000, count: 3 } });
            await this.nativeState.storage.setAlarm(at + 7200000);
            return Response.json(await this.inspect());
        });
        if (phase === 'seed-alarm') { await this.nativeState.storage.setAlarm(Date.now() + 7200000); return Response.json(await this.inspect()); }
        const modes = { 'fail-budget': 'budget', 'fail-session': 'session', 'fail-alarm': 'alarm', 'fail-prune': 'second-delete', 'fail-direct-prune': 'second-delete' };
        if (Object.hasOwn(modes, phase)) { this.control.mode = modes[phase]; this.control.events = []; this.control.deleteCalls = 0; this.control.tripped = null; }
        if (phase === 'fail-direct-prune' || phase === 'direct-prune') return this.nativeState.blockConcurrencyWhile(async () => {
            try { const rows = await this.prune(); return Response.json({ reason: 'pruned', remaining: rows.size }); }
            catch { return Response.json({ reason: 'owned direct-prune failure' }, { status: 503 }); }
        });
        if (!Object.hasOwn(modes, phase) && phase !== 'register') return denied();
        return super.fetch(new Request('https://local-registry/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sid: SID, version: '1', exp: Date.now() + 3600000, iph: IP }) }));
    }
}
export class SqliteBeta extends InspectBeta {}
export class LegacyBeta extends InspectBeta {}
export default { async fetch(request, env) {
    if (!guarded(request, env) || request.method !== 'POST' || request.headers.get('Content-Type') !== 'application/json') return denied();
    const [binding, name] = new URL(request.url).pathname.slice(1).split('/');
    if (!['SQLITE', 'LEGACY'].includes(binding) || !['budget', 'session', 'alarm', 'prune-register', 'prune-direct'].includes(name)) return denied();
    const bytes = await request.arrayBuffer(); if (bytes.byteLength > 128) return denied();
    return env[binding].get(env[binding].idFromName(name)).fetch(new Request('https://local-fixture/', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Fixture-Nonce': env.FIXTURE_NONCE }, body: bytes
    }));
} };
