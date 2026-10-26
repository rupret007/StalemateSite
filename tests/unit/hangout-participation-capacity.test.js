// @vitest-environment node
// Real SQLite + production gateway/session/C2/C3/effect adapters. Only the
// transport extension and explicit operator/guardian decisions are synthetic.
// No production caps, clocks, dates or hook timeouts are changed.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { openDurableRecordSqlite } from '../support/durable-record-sqlite.mjs';
import { betaFetch } from '../../hangout-worker/src/beta-entry.mjs';
import { betaSession } from '../../hangout-worker/src/beta-auth.mjs';
import { HangoutLobby } from '../../hangout-worker/src/lobby-do.mjs';
import { createLobbyAuthorityStorage, LOBBY_AUTHORITY_COMMUNITY } from '../../hangout-worker/src/lobby-session-authority.mjs';
import { createPartitionedParticipationConsents } from '../../hangout-worker/src/participation-partitions.mjs';
import { PARTICIPATION_PURPOSES } from '../../hangout-worker/src/participation-policy.mjs';
import { LOBBY_LIMITS } from '../../hangout-worker/src/lobby-core.mjs';

const ORIGIN = 'https://capacity.fixture.invalid', ALARM = '__test_capacity_alarm__';
const INVITE = 'synthetic-capacity-invite-'.repeat(3), PREVIEW = 'synthetic-capacity-preview-'.repeat(3);
const bytes = value => value === undefined ? 0 : value instanceof Uint8Array ? value.byteLength : Buffer.byteLength(JSON.stringify(value));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let f;

class Socket {
    readyState = 1; lastSeq = 0; acked = 0; lastAck = -Infinity; events = []; sentFrames = 0; welcomed = '';
    send(raw) {
        if (this.readyState !== 1) throw Error('transport closed');
        const frame = JSON.parse(raw); this.sentFrames++;
        if (Number.isSafeInteger(frame.transportSeq)) this.lastSeq = frame.transportSeq;
        if (frame.t === 'welcome') this.welcomed = frame.nick;
        this.events.push({ t: frame.t, ...(frame.kind ? { kind: frame.kind } : {}),
            ...(typeof frame.text === 'string' ? { text: frame.text.slice(0, 120) } : {}) });
        if (this.events.length > 8) this.events.shift();
    }
    close(code) { this.readyState = 3; this.closeCode = code; }
    serializeAttachment(value) { this.saved = structuredClone(value); }
    deserializeAttachment() { return structuredClone(this.saved); }
}
const family = key => {
    if (typeof key !== 'string' || !key.includes(':manifest:')) return null;
    const name = Buffer.from(key.split(':manifest:')[1], 'hex').toString('ascii');
    for (const [prefix, label] of [['participation-records:v1:policy', 'policy'], ['participation-records:v1:record:', 'principal'],
        ['participation-records:v1:anchor:', 'anchor'], ['participation-records:v1:subject:', 'subject-index'],
        ['participation-records:v1:unique:guardian:', 'guardian-reference'], ['participation-records:v1:unique:consent:', 'consent-reference'],
        ['participation-records:v1:unique:decision:', 'decision-reference'], ['authority-session-index:', 'session-index'],
        ['authority-connection-index:', 'connection-index'], ['authority-session:', 'session'], ['authority-connection:', 'connection']])
        if (name.startsWith(prefix)) return label;
    return 'other';
};
const compact = metric => ({ phase: metric.phase, transaction: metric.transaction, calls: metric.calls,
    readBytes: metric.readBytes, writeBytes: metric.writeBytes, committed: metric.committed,
    elapsedMs: metric.elapsedMs, error: metric.error, manifestReads: metric.manifestReads });

beforeAll(async () => {
    const directory = await mkdtemp(join(tmpdir(), 'participation-capacity-'));
    const driver = openDurableRecordSqlite(join(directory, 'capacity.sqlite'));
    f = { directory, driver, metrics: [], sockets: new Map(), visitors: [], background: [], firstFailure: null, baseline50: null, phase: 'bootstrap' };
    let gate = Promise.resolve(), serial = 0, transaction = 0;
    vi.stubGlobal('WebSocketPair', class { constructor() { this[0] = new Socket(); this[1] = new Socket(); } });
    const NativeResponse = globalThis.Response;
    vi.stubGlobal('Response', class extends NativeResponse {
        constructor(body, init) { super(body, init?.status === 101 ? { status: 200 } : init);
            if (init?.status === 101) Object.defineProperty(this, 'status', { value: 101 }); this.webSocket = init?.webSocket; }
    });
    vi.stubGlobal('fetch', vi.fn(async () => { throw Error('External network forbidden in capacity fixture'); }));
    const storage = { transaction: async operation => {
        const metric = { phase: f.phase, transaction: ++transaction, calls: 0, readBytes: 0, writeBytes: 0,
            committed: false, manifestReads: {} }, began = performance.now();
        try {
            const result = await driver.transaction(raw => {
                const invoke = async (name, ...args) => {
                    metric.calls++; const label = name === 'get' && family(args[0]);
                    if (label) metric.manifestReads[label] = (metric.manifestReads[label] || 0) + 1;
                    if (name === 'put') metric.writeBytes += bytes(args[1]);
                    const result = await raw[name](...args);
                    if (name === 'get') metric.readBytes += bytes(result);
                    if (name === 'list') for (const value of result.values()) metric.readBytes += bytes(value);
                    return result;
                };
                const native = Object.fromEntries(['get', 'put', 'delete', 'list'].map(name => [name, (...args) => invoke(name, ...args)]));
                Object.assign(native, { getAlarm: () => invoke('get', ALARM), setAlarm: value => invoke('put', ALARM, value), deleteAlarm: () => invoke('delete', ALARM) });
                return operation(native);
            });
            metric.committed = true; return result;
        } catch (error) { metric.error = String(error.message).slice(0, 128); throw error; }
        finally { metric.elapsedMs = Math.round((performance.now() - began) * 1000) / 1000;
            f.metrics.push(metric); driver.resetOperations(); }
    } };
    for (const name of ['get', 'put', 'delete', 'list', 'getAlarm', 'setAlarm', 'deleteAlarm']) storage[name] = (...args) => storage.transaction(tx => tx[name](...args));
    const state = { storage, waitUntil: task => f.background.push(task),
        blockConcurrencyWhile(fn) { const task = gate.then(fn); gate = task.catch(() => {}); return task; },
        getWebSockets: tag => [...f.sockets].filter(([ws, tags]) => ws.readyState === 1 && (!tag || tags.includes(tag))).map(([ws]) => ws),
        getTags: ws => f.sockets.get(ws) || [], acceptWebSocket: (ws, tags) => f.sockets.set(ws, tags) };
    const env = { HANGOUT_BETA_MODE: 'protected', HANGOUT_SESSION_AUTHORITY: 'lobby-v1', HANGOUT_PARTICIPATION_AUTHORITY: 'c3-v1',
        HANGOUT_BETA_INVITE_VERSION: '1', HANGOUT_BETA_INVITE_KEY: INVITE, HANGOUT_PREVIEW_KEY: PREVIEW,
        HANGOUT_HMAC_KEY: 'synthetic-capacity-signing-key-'.repeat(2), HANGOUT_OWNER_EMAIL: 'owner@example.invalid',
        ASSETS: { fetch: async () => new Response('fixture asset') },
        QUOTA: { idFromName: name => name, get: () => ({ fetch: async () => new Response('ok') }) },
        ROOMS: { idFromName: name => name, get: () => ({ fetch: async () => { throw Error('No private room dispatch'); } }) } };
    const lobby = new HangoutLobby(state, env); env.LOBBY = { idFromName: name => name, get: () => ({ fetch: request => lobby.fetch(request) }) };
    const request = (path, { index, cookie, body, upgrade = false } = {}) => new Request(ORIGIN + path, {
        method: body === undefined ? 'GET' : 'POST', headers: { Origin: ORIGIN, 'CF-Connecting-IP': `192.0.2.${index + 1}`,
            ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(upgrade ? { Upgrade: 'websocket' } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    expect((await lobby.fetch(new Request('https://internal/__beta/authority/initialize', { method: 'POST', body: '{}' }))).status).toBe(200);
    const records = createLobbyAuthorityStorage(storage), proofs = new Map(), decisions = new Map(), at = Date.now();
    const reference = () => `synthetic_capacity_${String(++serial).padStart(10, '0')}`;
    const config = { policy: { version: 1, policyVersion: 'capacity-fixture-v1', revision: 1, communityRef: LOBBY_AUTHORITY_COMMUNITY,
        noticeDigest: 'a'.repeat(64), decisionRef: 'synthetic_capacity_operator', state: 'qualified', purposes: [...PARTICIPATION_PURPOSES],
        issuedAt: at - 100, effectiveAt: at - 100, expiresAt: at + 1000000, maxSessionMs: 10000 },
        rules: { version: 1, verifierRef: 'synthetic_capacity_verifier', pendingMs: 10000, grantMs: 500000, subjectTailMs: 10000,
            guardianTailMs: 10000, receiptTailMs: 10000, callbackMs: 10000, operationMs: 10000 } };
    const ledger = createPartitionedParticipationConsents({ storage: records, randomRef: reference,
        // A bounded synthetic authority decision, not production enrollment or
        // a raised app limit. Actual ledger state/indices and writes are used.
        admitSubject: async ({ tx }) => { const used = await tx.get('synthetic-capacity-allocation') || 0;
            if (used >= LOBBY_LIMITS.lobbyMax) return false; await tx.put('synthetic-capacity-allocation', used + 1); return true; },
        adapters: { qualifyPolicy: async () => ({ config, expiresAt: at + 1000000 }),
            authenticateParticipant: async ({ proof, purpose }) => { const value = proofs.get(proof); return purpose === 'begin' ? value
                : value && { principalRef: value.principalRef, communityRef: value.communityRef, expiresAt: value.expiresAt }; },
            verifyConsent: async ({ proof }) => decisions.get(proof), authenticateGuardian: async () => null, authorizeMaintenance: async () => null } });
    expect((await ledger.installPolicy('synthetic-fixture-only')).ok).toBe(true);
    const settle = async () => { await lobby.presence.flush(); for (let n = 0; n < 12; n++) {
        const tasks = f.background.splice(0); if (!tasks.length) return; await Promise.all(tasks);
    } throw Error('Background queue did not settle'); };
    const healthyAcks = async () => {
        for (const visitor of f.visitors) {
            const ws = visitor.socket;
            if (ws.readyState !== 1 || ws.lastSeq - ws.acked < 8) continue;
            const wait = 50 - (performance.now() - ws.lastAck); if (wait > 0) await sleep(wait);
            const seq = ws.lastSeq; await lobby.webSocketMessage(ws, JSON.stringify({ t: 'transport-ack', seq }));
            ws.acked = seq; ws.lastAck = performance.now();
        }
    };
    Object.assign(f, { state, env, lobby, request, records, settle, healthyAcks });
    f.admit = async index => {
        const began = performance.now(), phaseStart = f.metrics.length, nick = `CapacityGuest${String(index).padStart(3, '0')}`;
        const refuse = (phase, details) => { const metrics = f.metrics.slice(phaseStart); f.firstFailure = { index, phase, admittedBefore: f.visitors.length,
            elapsedMs: Math.round((performance.now() - began) * 1000) / 1000, ...details,
            failedTransactions: metrics.filter(m => !m.committed).slice(0, 8).map(compact),
            maxPhysicalCalls: Math.max(0, ...metrics.map(m => m.calls)),
            transactionCount: metrics.length, transactionsTruncated: metrics.length > 512,
            phaseTransactions: metrics.slice(0, 512).map(compact),
            currentPolicyReadTransactions: metrics.filter(m => m.manifestReads.policy && m.manifestReads.principal).map(compact).slice(-3) }; };
        f.phase = `guest-${index}:unlock`;
        const unlocked = await betaFetch(request('/beta/unlock', { index, body: { key: INVITE } }), env);
        if (unlocked.status !== 200) return refuse('unlock', { status: unlocked.status });
        const cookie = unlocked.headers.get('Set-Cookie').split(';')[0], session = await betaSession(request('/beta/state', { index, cookie }), env);
        expect(session).not.toBeNull(); f.phase = `guest-${index}:synthetic-grant`;
        const principalRef = `s_${session.access.sid}`, proof = reference(), now = Date.now();
        proofs.set(proof, { operationRef: reference(), principalRef, communityRef: LOBBY_AUTHORITY_COMMUNITY, expiresAt: now + 500000 });
        const pending = await ledger.begin(proof, { expectedRevision: 0, purposes: [...PARTICIPATION_PURPOSES] }); expect(pending.ok).toBe(true);
        const decision = reference(); decisions.set(decision, { operationRef: reference(), pendingRef: pending.pendingRef, subjectRef: pending.subjectRef,
            principalRef, guardianPrincipalRef: 'synthetic_capacity_guardian', decisionRef: reference(), verifierRef: config.rules.verifierRef,
            status: 'approved', purposes: [...PARTICIPATION_PURPOSES], verifiedAt: Date.now(), expiresAt: now + 500000 });
        expect((await ledger.complete(decision)).state).toBe('authorized');
        f.phase = `guest-${index}:upgrade`;
        const upgrade = await betaFetch(request(`/lobby?preview=${PREVIEW}`, { index, cookie, upgrade: true }), env);
        if (upgrade.status !== 101) return refuse('upgrade', { status: upgrade.status });
        const socket = state.getWebSockets().at(-1); f.phase = `guest-${index}:hello`;
        const result = await lobby.webSocketMessage(socket, JSON.stringify({ t: 'hello', nick, age13: true, transport: 1 }));
        await settle();
        if (socket.welcomed !== nick) {
            refuse('hello', { result: result ?? null, socketCode: socket.closeCode ?? null, recent: socket.events });
            f.phase = 'refusal-read-only-own-status';
            const own = await betaFetch(request('/beta/participation', { index, cookie }), env);
            f.firstFailure.currentOwnStatus = { status: own.status, projection: await own.json() };
            return;
        }
        f.visitors.push({ socket }); f.phase = `guest-${index}:healthy-acks`; await healthyAcks(); await settle();
        const closed = f.visitors.find(visitor => visitor.socket.readyState !== 1);
        if (closed) refuse('healthy-transport', { socketCode: closed.socket.closeCode, recent: closed.socket.events });
        if ((index === 49 || index === LOBBY_LIMITS.lobbyMax - 1) && !f.firstFailure) {
            const metrics = f.metrics.slice(phaseStart), sample = { admitted: index + 1,
                maxPhysicalCalls: Math.max(...metrics.map(m => m.calls)), elapsedMs: Math.round((performance.now() - began) * 1000) / 1000,
                transactionCount: metrics.length, transactionsTruncated: metrics.length > 512,
                phaseTransactions: metrics.slice(0, 512).map(compact),
                currentPolicyReadTransactions: metrics.filter(m => m.manifestReads.policy && m.manifestReads.principal).map(compact) };
            if (index === 49) f.baseline50 = sample; else f.final150 = sample;
        }
    };
});

// One genuine admission per unchanged hook deadline, in the same order. A
// five-person batch could exhaust a test-runner hook without any single
// application action failing. Never retry a refused admission or extend its
// deadline; later hooks stop after the first actual refusal.
for (let index = 0; index < LOBBY_LIMITS.lobbyMax; index++) beforeAll(async () => {
    if (!f.firstFailure) await f.admit(index);
});
afterAll(async () => {
    if (f) { f.lobby?.presence.dispose(); await Promise.allSettled(f.background.splice(0)); await f.driver.close(); await rm(f.directory, { recursive: true, force: true }); }
    vi.unstubAllGlobals();
});

describe('actual production C3 admission capacity', () => {
    it('admits the unchanged150 ordinary guests with eligible current grants and healthy transport', () => {
        const measurement = { scope: 'actual-SQLite-gateway-C3-capacity-only', baseline50: f.baseline50,
            final150: f.final150,
            admitted: f.visitors.length, firstFailure: f.firstFailure, limitsUnchanged: true, clocksReal: true,
            guardianAndOperatorDecisionsSynthetic: true };
        console.log(JSON.stringify(measurement));
        expect(f.firstFailure, JSON.stringify(measurement)).toBeNull();
        expect(f.visitors).toHaveLength(LOBBY_LIMITS.lobbyMax);
    });
});
