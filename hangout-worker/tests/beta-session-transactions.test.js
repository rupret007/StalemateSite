// @vitest-environment node
// Real lifecycle entrypoints over a serial, rollback-capable storage fixture.
// This does not qualify Cloudflare transaction retries or deployed migration.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BetaSessions, BETA_MINT_PER_IP_HOUR, BETA_SESSION_ROOM_LIMIT } from '../src/beta-sessions.mjs';
import { BETA_TTL, betaSession } from '../src/beta-auth.mjs';
import { betaFetch } from '../src/beta-entry.mjs';

const ORIGIN = 'https://transactional-beta.example';
const SID = 'transaction-session-00000001';
const IPH = 'A'.repeat(22), OTHER_IPH = 'B'.repeat(22);
const clone = value => structuredClone(value);
const sessionKey = sid => `session:${sid}`;

function transactionalState(seed = new Map()) {
    let values = clone(seed), alarm, gate = Promise.resolve(), transactions = Promise.resolve(), active = 0;
    const calls = [], deleteBatches = [];
    let fault = () => false, retryNext = null;
    const fail = operation => {
        calls.push(clone(operation));
        if (fault(operation)) throw Error('injected storage failure');
    };
    const view = (rows, readAlarm, writeAlarm, inTransaction) => ({
        async get(key) { fail({ type: 'get', key, inTransaction }); return clone(rows.get(key)); },
        async put(key, value) { fail({ type: 'put', key, value: clone(value), inTransaction }); rows.set(key, clone(value)); },
        async delete(keys) {
            const selected = Array.isArray(keys) ? [...keys] : [keys];
            if (selected.length > 128) throw Error('native delete batch exceeds 128 keys');
            if (selected.some(key => key.startsWith('session:'))) deleteBatches.push([...selected]);
            fail({ type: 'delete', keys: selected, inTransaction });
            let count = 0; for (const key of selected) if (rows.delete(key)) count++;
            return Array.isArray(keys) ? count : count > 0;
        },
        async list({ prefix = '', limit = Infinity, startAfter, end, reverse = false } = {}) {
            fail({ type: 'list', prefix, limit, inTransaction });
            return new Map([...rows].filter(([key]) => key.startsWith(prefix) && (!startAfter || key > startAfter) && (!end || key < end))
                .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0) * (reverse ? -1 : 1)).slice(0, limit).map(([key, value]) => [key, clone(value)]));
        },
        async getAlarm() { fail({ type: 'getAlarm', inTransaction }); return readAlarm(); },
        async setAlarm(value) { fail({ type: 'setAlarm', value, inTransaction }); writeAlarm(value); },
        async deleteAlarm() { fail({ type: 'deleteAlarm', inTransaction }); writeAlarm(undefined); }
    });
    // Resolve the committed map at each outer call; a transaction replaces it atomically.
    const storage = Object.fromEntries(['get', 'put', 'delete', 'list', 'getAlarm', 'setAlarm', 'deleteAlarm'].map(name => [name, (...args) =>
        view(values, () => alarm, value => { alarm = value; }, false)[name](...args)]));
    storage.transaction = callback => {
        const result = transactions.then(async () => {
            // Optional one-time conflict discards the first attempt completely.
            // This models callback replay; it does not claim a native retry occurred.
            const retry = retryNext; retryNext = null;
            for (let attempt = 0; attempt < 2; attempt++) {
                const staged = clone(values); let stagedAlarm = alarm;
                active++;
                try {
                    const result = await callback(view(staged, () => stagedAlarm, value => { stagedAlarm = value; }, true));
                    if (attempt === 0 && retry) { await retry(); continue; }
                    fail({ type: 'commit', inTransaction: true });
                    values = staged; alarm = stagedAlarm; return result;
                } finally { active--; }
            }
        });
        transactions = result.catch(() => {}); return result;
    };
    return {
        storage, calls, deleteBatches,
        blockConcurrencyWhile(callback) { const result = gate.then(callback); gate = result.catch(() => {}); return result; },
        snapshot: () => clone(values), alarm: () => alarm, active: () => active,
        failWhen(predicate) { fault = predicate; },
        clearFault() { fault = () => false; },
        retryNextTransaction(afterDiscard = () => {}) { retryNext = afterDiscard; }
    };
}

function harness(seed) {
    const state = transactionalState(seed), fanout = [];
    const env = {
        HANGOUT_BETA_MODE: 'protected', HANGOUT_BETA_INVITE_VERSION: '1',
        HANGOUT_BETA_INVITE_KEY: 'transactional-beta-private-invite-'.repeat(2),
        HANGOUT_HMAC_KEY: 'transactional-beta-signing-key-'.repeat(2), HANGOUT_PREVIEW_KEY: 'transactional-beta-preview-key-'.repeat(2),
        ASSETS: { fetch: async () => new Response('fixture asset') },
        QUOTA: { idFromName: name => name, get: () => ({ fetch: async () => new Response('ok') }) }
    };
    const close = async request => {
        const sid = JSON.parse(request.headers.get('X-Hangout-Identity')).betaSid;
        fanout.push({ sid, saved: state.snapshot().get(sessionKey(sid)), activeTransactions: state.active() });
        return new Response('closed');
    };
    env.LOBBY = { idFromName: name => name, get: () => ({ fetch: close }) };
    env.ROOMS = { idFromName: name => name, get: () => ({ fetch: close }) };
    const registry = new BetaSessions(state, env);
    env.BETA_SESSIONS = { idFromName: name => name, get: () => registry };
    const operation = (path, overrides = {}) => registry.fetch(new Request(`https://beta-sessions/${path}`, {
        method: 'POST', body: JSON.stringify({ sid: SID, version: '1', exp: Date.now() + BETA_TTL, ...overrides })
    }));
    const unlock = () => betaFetch(new Request(`${ORIGIN}/beta/unlock`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: env.HANGOUT_BETA_INVITE_KEY }) }), env);
    return { state, env, registry, fanout, operation, unlock };
}

function expiredRows(count) {
    const rows = new Map();
    for (let i = 0; i < count; i++) {
        const sid = `expired-session-${String(i).padStart(16, '0')}`, exp = Date.now() - 1;
        rows.set(sessionKey(sid), { v: 1, sid, version: '1', createdAt: exp - BETA_TTL, exp, revoked: false, pending: false, attempt: 0, retryAt: 0, rooms: [] });
    }
    rows.set('mint-rates', { [OTHER_IPH]: { count: 3, until: Date.now() - 1 } });
    return rows;
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-25T12:00:00Z')); });
afterEach(() => { vi.useRealTimers(); });

describe('transactional beta lifecycle through existing endpoints', () => {
    it('does not consume the mint allowance or issue a cookie when the session write fails', async () => {
        const h = harness(), before = h.state.snapshot();
        h.state.failWhen(op => op.type === 'put' && op.key.startsWith('session:'));
        const result = await h.unlock();
        expect(result.status).toBe(503); expect(result.headers.has('Set-Cookie')).toBe(false);
        expect(h.state.calls.some(op => op.type === 'put' && op.key === 'mint-rates')).toBe(true);
        expect(h.state.snapshot()).toEqual(before); expect(h.state.alarm()).toBeUndefined(); expect(h.fanout).toEqual([]);
        h.state.clearFault();
        const retry = await h.unlock(); expect(retry.status).toBe(200);
        expect(Object.values(h.state.snapshot().get('mint-rates'))).toEqual([{ count: 1, until: Date.now() + 3600000 }]);
        const cookie = retry.headers.get('Set-Cookie').split(';')[0];
        expect((await betaSession(new Request(`${ORIGIN}/beta/state`, { headers: { Cookie: cookie } }), h.env)).access.sid).toBeTruthy();
    });

    it('rolls back the session and mint allowance when scheduling registration fails', async () => {
        const h = harness(), before = h.state.snapshot();
        h.state.failWhen(op => op.type === 'setAlarm');
        const result = await h.operation('register', { iph: IPH });
        expect(result.status).toBe(503);
        expect(h.state.calls.some(op => op.type === 'put' && op.key === sessionKey(SID))).toBe(true);
        expect(h.state.snapshot()).toEqual(before); expect(h.state.alarm()).toBeUndefined();
        h.state.clearFault(); expect((await h.operation('check')).status).toBe(403);
        expect((await h.operation('register', { iph: IPH })).status).toBe(200);
        expect(h.state.snapshot().get('mint-rates')[IPH].count).toBe(1);
    });

    it('does not publish a successful registration when transaction commit fails', async () => {
        const h = harness();
        h.state.failWhen(op => op.type === 'commit');
        expect((await h.operation('register', { iph: IPH })).status).toBe(503);
        expect(h.state.snapshot().size).toBe(0); expect(h.state.alarm()).toBeUndefined();
        h.state.clearFault(); expect((await h.operation('check')).status).toBe(403);
    });

    it('commits only one session and mint charge when the storage driver retries registration', async () => {
        const h = harness(); h.state.retryNextTransaction();
        expect((await h.operation('register', { iph: IPH })).status).toBe(200);
        expect(h.state.calls.filter(op => op.type === 'put' && op.key === sessionKey(SID))).toHaveLength(2);
        expect(h.state.snapshot().get('mint-rates')).toEqual({ [IPH]: { count: 1, until: Date.now() + 3600000 } });
        expect([...h.state.snapshot().keys()].filter(key => key.startsWith('session:'))).toEqual([sessionKey(SID)]);
        expect(h.state.alarm()).toBe(Date.now() + 60000);
        expect(h.fanout).toEqual([]); expect(h.state.active()).toBe(0);
    });

    it('rechecks expiry on a retried registration and never issues the discarded attempt cookie', async () => {
        const h = harness(); h.state.retryNextTransaction(() => vi.setSystemTime(Date.now() + BETA_TTL));
        const response = await h.unlock();
        expect(response.status).toBe(503); expect(response.headers.has('Set-Cookie')).toBe(false);
        // The first callback completed its staged write, then the replay denied it.
        expect(h.state.calls.filter(op => op.type === 'put' && op.key.startsWith('session:'))).toHaveLength(1);
        expect(h.state.snapshot().size).toBe(0); expect(h.state.alarm()).toBeUndefined();
        expect(h.fanout).toEqual([]); expect(h.state.active()).toBe(0);
        const fresh = await h.unlock(); expect(fresh.status).toBe(200);
        expect(Object.values(h.state.snapshot().get('mint-rates'))).toEqual([{ count: 1, until: Date.now() + 3600000 }]);
    });

    it('commits expiry cleanup and replacement registration together in bounded native delete batches', async () => {
        const h = harness(expiredRows(271));
        expect((await h.operation('register', { iph: IPH })).status).toBe(200);
        const rows = h.state.snapshot();
        expect([...rows.keys()].filter(key => key.startsWith('session:'))).toEqual([sessionKey(SID)]);
        expect(rows.get('mint-rates')).toEqual({ [IPH]: { count: 1, until: Date.now() + 3600000 } });
        expect(h.state.deleteBatches.length).toBeGreaterThanOrEqual(3);
        expect(h.state.deleteBatches.every(keys => keys.length > 0 && keys.length <= 128)).toBe(true);
        expect(h.state.alarm()).toBe(Date.now() + 60000);
    });

    it('rolls back every earlier expiry batch when a later delete fails, then recovers after restart', async () => {
        const seed = expiredRows(271), h = harness(seed);
        let batches = 0;
        h.state.failWhen(op => op.type === 'delete' && op.keys.some(key => key.startsWith('session:')) && ++batches === 2);
        expect((await h.operation('register', { iph: IPH })).status).toBe(503);
        expect(batches).toBe(2); expect(h.state.snapshot()).toEqual(seed); expect(h.state.alarm()).toBeUndefined();
        h.state.clearFault();
        const reopened = new BetaSessions(h.state, h.env);
        expect((await reopened.records()).size).toBe(271);
        await reopened.alarm();
        expect(h.state.snapshot().size).toBe(0); expect(h.state.alarm()).toBeUndefined();
    });

    it('rolls back expiry cleanup when validation discovers a corrupt mint budget', async () => {
        const seed = expiredRows(2); seed.set('mint-rates', { malformed: { count: 1, until: Date.now() + 1 } });
        const h = harness(seed);
        expect((await h.operation('register', { iph: IPH })).status).toBe(503);
        expect(h.state.snapshot()).toEqual(seed);
    });

    it('preserves denial, duplicate, active-check and bounded room-registration semantics', async () => {
        const h = harness();
        expect((await h.operation('register', { version: 'old', iph: IPH })).status).toBe(403);
        expect((await h.operation('register', { iph: 'raw-ip-address' })).status).toBe(400);
        expect(h.state.snapshot().size).toBe(0);
        expect((await h.operation('register', { iph: IPH })).status).toBe(200);
        const initial = h.state.snapshot();
        expect((await h.operation('register', { iph: IPH })).status).toBe(409);
        expect((await h.operation('check')).status).toBe(200); expect(h.state.snapshot()).toEqual(initial);
        for (let i = 0; i < BETA_SESSION_ROOM_LIMIT; i++) expect((await h.operation('room', { room: i.toString(16).padStart(64, '0') })).status).toBe(200);
        const saved = h.state.snapshot();
        expect((await h.operation('room', { room: '0'.repeat(64) })).status).toBe(200);
        expect((await h.operation('room', { room: 'f'.repeat(64) })).status).toBe(429);
        expect(h.state.snapshot()).toEqual(saved);
        expect((await h.operation('unknown')).status).toBe(404);
    });

    it('does not refund or increment a full mint budget on denied additional registrations', async () => {
        const h = harness();
        for (let i = 0; i < BETA_MINT_PER_IP_HOUR; i++) expect((await h.operation('register', { sid: `mint-session-${String(i).padStart(16, '0')}`, iph: IPH })).status).toBe(200);
        const before = h.state.snapshot();
        expect((await h.operation('register', { iph: IPH })).status).toBe(429);
        expect(h.state.snapshot()).toEqual(before);
        expect((await h.operation('register', { iph: OTHER_IPH })).status).toBe(200);
        expect(h.state.snapshot().get('mint-rates')[IPH].count).toBe(BETA_MINT_PER_IP_HOUR);
    });

    it('durably commits revocation and pending closure before any external fanout', async () => {
        const h = harness();
        expect((await h.operation('register', { iph: IPH })).status).toBe(200);
        expect((await h.operation('room', { room: 'a'.repeat(64) })).status).toBe(200);
        expect((await h.operation('revoke')).status).toBe(200);
        expect(h.fanout).toHaveLength(2);
        for (const observed of h.fanout) expect(observed).toMatchObject({ sid: SID, saved: { revoked: true, pending: true, rooms: ['a'.repeat(64)] }, activeTransactions: 0 });
        expect(h.state.snapshot().get(sessionKey(SID))).toMatchObject({ revoked: true, pending: false });
        expect((await h.operation('check')).status).toBe(403);
        expect((await h.operation('check', { allowRevoked: true })).status).toBe(200);
        expect((await h.operation('room', { room: 'b'.repeat(64) })).status).toBe(403);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('keeps revocation durable when later alarm scheduling fails and retries through the same endpoint', async () => {
        const h = harness();
        expect((await h.operation('register', { iph: IPH })).status).toBe(200);
        const previousAlarm = h.state.alarm();
        h.state.failWhen(op => op.type === 'setAlarm');
        expect((await h.operation('revoke')).status).toBe(503);
        expect(h.state.snapshot().get(sessionKey(SID))).toMatchObject({ revoked: true, pending: true, attempt: 1 });
        expect(h.state.alarm()).toBe(previousAlarm); expect(h.fanout).toEqual([]);
        expect((await h.operation('check')).status).toBe(403);
        h.state.clearFault();
        expect((await h.operation('revoke')).status).toBe(200);
        expect(h.state.snapshot().get(sessionKey(SID))).toMatchObject({ revoked: true, pending: false, attempt: 2 });
    });

    it('does not fan out or claim revocation when storing the initial revoked record fails', async () => {
        const h = harness(); expect((await h.operation('register', { iph: IPH })).status).toBe(200);
        const before = h.state.snapshot();
        h.state.failWhen(op => op.type === 'put' && op.key === sessionKey(SID) && op.value.revoked === true);
        expect((await h.operation('revoke')).status).toBe(503);
        expect(h.state.snapshot()).toEqual(before); expect(h.fanout).toEqual([]);
        h.state.clearFault(); expect((await h.operation('check')).status).toBe(200);
    });
});
