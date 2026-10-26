// @vitest-environment node
// Actual application codec/authority/effect writer on disk-backed SQLite. The
// native alarm API is represented by one key in that SAME SQL transaction;
// these tests do not qualify hosted alarms, ingress identity proofs or release.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { openDurableRecordSqlite } from '../support/durable-record-sqlite.mjs';
import { createLobby } from '../../hangout-worker/src/lobby-core.mjs';
import { createTransportControlBudget } from '../../hangout-worker/src/transport-budget.mjs';
import { HangoutLobby } from '../../hangout-worker/src/lobby-do.mjs';
import { accountId } from '../../hangout-worker/src/auth.mjs';
import { createParticipationEnforcement } from '../../hangout-worker/src/participation-enforcement.mjs';
import { writeLobbyEffects } from '../../hangout-worker/src/lobby-effect-records.mjs';
import { createLobbyParticipation, lobbyParticipationMode } from '../../hangout-worker/src/lobby-participation.mjs';
import { createPartitionedParticipationConsents, PARTICIPATION_POLICY_KEY } from '../../hangout-worker/src/participation-partitions.mjs';
import * as partitionMaintenance from '../../hangout-worker/src/participation-partitions.mjs';
import { validParticipationLedgerState } from '../../hangout-worker/src/participation-consents.mjs';
import { PARTICIPATION_PURPOSES } from '../../hangout-worker/src/participation-policy.mjs';
import { initializeLobbySessionAuthority, migrateLobbySessionAuthority, createLobbySessionAuthority,
    LOBBY_AUTHORITY_MARKER, LOBBY_AUTHORITY_COMMUNITY } from '../../hangout-worker/src/lobby-session-authority.mjs';

const NOW = 1800000000000, ALARM = '__test_native_alarm__', cleanups = [];
const SESSION_INDEX = 'authority-session-index:v1', CONNECTION_INDEX = 'authority-connection-index:v1';
const RATES = 'authority-mint-rates:v1', clone = value => structuredClone(value);
const logicalKey = event => event.name === 'put' && event.key.includes(':manifest:')
    ? Buffer.from(event.key.split(':manifest:')[1], 'hex').toString('ascii') : '';
const fingerprint = driver => createHash('sha256').update(JSON.stringify([...driver.rows()].map(([key, value]) =>
    [key, value instanceof Uint8Array ? Buffer.from(value).toString('base64') : value]))).digest('hex');
afterEach(async () => { for (const { directory, drivers } of cleanups.splice(0)) {
    for (const driver of drivers) await driver.close(); await rm(directory, { recursive: true, force: true });
} });
function freshState(at = NOW) {
    const lobby = createLobby({ now: () => at });
    return clone({ net: lobby.snapshot(), rooms: lobby.roomSnapshot(), abuse: lobby.abuseSnapshot(), sessions: lobby.sessionSnapshot(),
        moderationQueue: { reports: [], held: [] }, aiReviews: [], modlog: [] });
}
async function fixture({ initialize = true, participation = false } = {}) {
    let at = NOW;
    const directory = await mkdtemp(join(tmpdir(), 'lobby-session-authority-')), filename = join(directory, 'authority.sqlite'), hooks = {}, controls = {};
    const driver = openDurableRecordSqlite(filename, hooks), cleanup = { directory, drivers: [driver] }; cleanups.push(cleanup);
    const wrap = disk => ({ transaction: operation => disk.transaction(raw => operation({ ...raw,
        getAlarm: () => raw.get(ALARM), setAlarm: value => raw.put(ALARM, value), deleteAlarm: () => raw.delete(ALARM) })) });
    const storage = wrap(driver), state = freshState();
    const env = { ...(participation ? { HANGOUT_PARTICIPATION_AUTHORITY: 'c3-v1' } : {}), HANGOUT_SESSION_AUTHORITY: 'lobby-v1', HANGOUT_BETA_MODE: 'protected', HANGOUT_BETA_INVITE_VERSION: '1',
        HANGOUT_HMAC_KEY: 'synthetic-lobby-authority-test-key-not-a-secret', HANGOUT_OWNER_EMAIL: 'owner@example.invalid',
        HANGOUT_MODERATOR_EMAILS: 'reviewer@example.invalid' };
    const makeAuthority = native => createLobbySessionAuthority({ storage: native, env, now: () => at,
        writeEffects: async input => { await writeLobbyEffects(input); await controls.afterEffects?.(input); } });
    const authority = makeAuthority(storage);
    if (initialize) await initializeLobbySessionAuthority({ storage, env, state, now: at });
    const rawPut = (key, value) => storage.transaction(tx => tx.put(key, value));
    const rawGet = key => storage.transaction(tx => tx.get(key));
    const registration = (id, extra = {}) => ({ sid: `session-${id.padEnd(12, 'x')}`, version: env.HANGOUT_BETA_INVITE_VERSION,
        exp: at + 100000, iph: `mint-${id.padEnd(17, 'x')}`.slice(0, 22), ...extra });
    const enroll = async (id, profile = null) => {
        const request = registration(id, { profile }); expect((await authority.register(request)).status).toBe(200);
        const binding = { id, betaSid: request.sid, betaInviteVersion: request.version, dev: `device_${id}`, iph: request.iph,
            account: profile?.account || '', role: profile?.role || 'fan', admin: profile?.admin || false,
            expiresAt: Math.min(request.exp, profile?.expiresAt || request.exp), authorityRef: id, authorityRevision: 1 };
        expect(await authority.bind(binding)).toEqual(binding); return { request, binding };
    };
    const makeEngine = (extra = {}) => {
        const frames = [], persist = vi.fn(), engine = createLobby({ now: () => at, effectCommit: authority.effectCommit,
            send: (id, frame) => frames.push({ recipient: id, ...clone(frame) }), persist,
            limits: { defaultSlow: 0, pmMinLobbyMs: 0 }, ...extra });
        return { engine, frames, persist, message: (id, body) => engine.message(id, JSON.stringify(body)) };
    };
    return { driver, storage, hooks, controls, state, env, authority, rawPut, rawGet, registration, enroll, makeEngine,
        now: () => at, advance: amount => { at += amount; }, resetTime: () => { at = NOW; },
        async reopen() { await driver.close(); const disk = openDurableRecordSqlite(filename); cleanup.drivers.push(disk);
            return { driver: disk, authority: makeAuthority(wrap(disk)) }; } };
}
async function seedLegacy(f) {
    const state = f.state, raw = {
        'beta-initialized': true, net: state.net, abuse: state.abuse, sessions: state.sessions,
        'moderation-queue': state.moderationQueue, 'ai-reviews': state.aiReviews, 'room-index': { version: 1, names: [] },
        'private-reports-v1': { v: 1, reports: [], receipts: [] }, unrelated: { keep: true }, [ALARM]: NOW + 77
    };
    for (const [key, value] of Object.entries(raw)) await f.rawPut(key, value);
    const old = { v: 1, sid: 'legacy-expired-session', version: 'legacy-v0', createdAt: NOW - 20000, exp: NOW - 1000,
        revoked: false, pending: false, attempt: 0, retryAt: 0, rooms: [] };
    return { raw, registrySnapshot: { v: 1, sessions: [old], mintRates: { ['m'.repeat(22)]: { until: NOW + 10000, count: 3 } } } };
}

describe('explicit collocated lobby authority initialization and migration', () => {
    it('latches explicitly selected C3 before any policy exists and refuses its removal without rewriting the marker', async () => {
        const f = await fixture({ participation: true });
        const saved = await f.authority.records.transaction(tx => tx.get(LOBBY_AUTHORITY_MARKER)); expect(saved.participationMode).toBe('c3-v1');
        expect(await f.authority.records.transaction(tx => tx.get(PARTICIPATION_POLICY_KEY))).toBeUndefined();
        const before = fingerprint(f.driver); delete f.env.HANGOUT_PARTICIPATION_AUTHORITY;
        await expect(f.authority.load()).rejects.toThrow(); expect(fingerprint(f.driver)).toBe(before);
    });

    it('refuses ordinary startup initialization, preserves unrelated raw rows, and reopens the actual persisted domain', async () => {
        const f = await fixture({ initialize: false });
        await expect(f.authority.load()).rejects.toThrow();
        await f.rawPut('unrelated', { bytes: new Uint8Array([0, 255, 8]), keep: true });
        await initializeLobbySessionAuthority({ storage: f.storage, env: f.env, state: f.state, now: NOW });
        expect((await f.authority.load()).state).toEqual(f.state); expect(await f.rawGet(ALARM)).toBe(NOW + 60000);
        expect(await f.rawGet('unrelated')).toEqual({ bytes: new Uint8Array([0, 255, 8]), keep: true });
        const before = fingerprint(f.driver);
        await expect(initializeLobbySessionAuthority({ storage: f.storage, env: f.env, state: f.state, now: NOW })).rejects.toThrow();
        expect(fingerprint(f.driver)).toBe(before);
        const reopened = await f.reopen(); expect((await reopened.authority.load()).state).toEqual(f.state);
    });

    it.each(['marker', 'alarm'])('rolls back actual initializer writes after %s failure and supports explicit retry', async boundary => {
        const f = await fixture({ initialize: false }); await f.rawPut('unrelated', { keep: 'existing' }); await f.rawPut(ALARM, NOW + 77);
        const before = fingerprint(f.driver); let injected = false;
        f.hooks.after = event => {
            if (!injected && (boundary === 'marker' ? logicalKey(event) === LOBBY_AUTHORITY_MARKER : event.name === 'put' && event.key === ALARM)) {
                injected = true; throw Error('synthetic post-write initializer failure');
            }
        };
        await expect(initializeLobbySessionAuthority({ storage: f.storage, env: f.env, state: f.state, now: NOW })).rejects.toThrow();
        expect(injected).toBe(true); expect(fingerprint(f.driver)).toBe(before); expect(f.driver.stats.rollbacks).toBeGreaterThan(0);
        delete f.hooks.after; await initializeLobbySessionAuthority({ storage: f.storage, env: f.env, state: f.state, now: NOW });
        expect((await f.authority.load()).state).toEqual(f.state); expect(await f.rawGet('unrelated')).toEqual({ keep: 'existing' });
    });

    it('refuses initializing over an existing private report queue without changing it', async () => {
        const f = await fixture({ initialize: false }); await f.rawPut('private-reports-v1', { v: 1, reports: [], receipts: [] });
        const before = fingerprint(f.driver);
        await expect(initializeLobbySessionAuthority({ storage: f.storage, env: f.env, state: f.state, now: NOW })).rejects.toThrow();
        expect(fingerprint(f.driver)).toBe(before);
    });

    it('migrates validated drained legacy state without deleting original raw rows or losing mint budgets', async () => {
        const f = await fixture({ initialize: false }), old = await seedLegacy(f);
        await migrateLobbySessionAuthority({ storage: f.storage, env: f.env, registrySnapshot: old.registrySnapshot, now: NOW });
        expect((await f.authority.load()).state).toEqual(f.state);
        for (const [key, value] of Object.entries(old.raw)) if (key !== ALARM) expect(await f.rawGet(key)).toEqual(value);
        expect(await f.authority.records.transaction(tx => tx.get(RATES))).toEqual(old.registrySnapshot.mintRates);
        expect(await f.rawGet(ALARM)).toBe(NOW + 60000);
    });

    it('migrates legitimately absent legacy optional snapshots while preserving the required network budget', async () => {
        const f = await fixture({ initialize: false }), net = clone(f.state.net); net.budget = { day: '2027-01-15', requests: 4123 };
        await f.rawPut('net', net); await f.rawPut('beta-initialized', true); await f.rawPut('unrelated', { keep: 'raw legacy state' });
        const registrySnapshot = { v: 1, sessions: [], mintRates: { ['q'.repeat(22)]: { until: NOW + 10000, count: 7 } } };
        await migrateLobbySessionAuthority({ storage: f.storage, env: f.env, registrySnapshot, now: NOW });
        const loaded = (await f.authority.load()).state;
        expect(loaded).toEqual({ ...f.state, net });
        expect(await f.rawGet('net')).toEqual(net); expect(await f.rawGet('unrelated')).toEqual({ keep: 'raw legacy state' });
        expect(await f.authority.records.transaction(tx => tx.get(RATES))).toEqual(registrySnapshot.mintRates);
    });

    it('rolls back the migration after its actual final marker write, then retries without treating partial data as initialized', async () => {
        const f = await fixture({ initialize: false }), old = await seedLegacy(f), before = fingerprint(f.driver); let injected = false;
        f.hooks.after = event => { if (!injected && logicalKey(event) === LOBBY_AUTHORITY_MARKER) { injected = true; throw Error('synthetic post-marker migration failure'); } };
        await expect(migrateLobbySessionAuthority({ storage: f.storage, env: f.env, registrySnapshot: old.registrySnapshot, now: NOW })).rejects.toThrow();
        expect(injected).toBe(true); expect(fingerprint(f.driver)).toBe(before);
        delete f.hooks.after; await expect(f.authority.load()).rejects.toThrow();
        await migrateLobbySessionAuthority({ storage: f.storage, env: f.env, registrySnapshot: old.registrySnapshot, now: NOW });
        expect((await f.authority.load()).state).toEqual(f.state);
    });

    it.each(['active-session', 'pending-revocation', 'corrupt-private-queue', 'missing-room'])('refuses unsafe %s migration without destructive recovery', async damage => {
        const f = await fixture({ initialize: false }), old = await seedLegacy(f);
        if (damage === 'active-session') Object.assign(old.registrySnapshot.sessions[0], { createdAt: NOW - 1000, exp: NOW + 10000 });
        if (damage === 'pending-revocation') Object.assign(old.registrySnapshot.sessions[0], { createdAt: NOW - 1000, exp: NOW + 10000, revoked: true, pending: true });
        if (damage === 'corrupt-private-queue') await f.rawPut('private-reports-v1', { corrupt: true });
        if (damage === 'missing-room') await f.rawPut('room-index', { version: 1, names: ['#missing'] });
        const before = fingerprint(f.driver);
        await expect(migrateLobbySessionAuthority({ storage: f.storage, env: f.env, registrySnapshot: old.registrySnapshot, now: NOW })).rejects.toThrow();
        expect(fingerprint(f.driver)).toBe(before);
    });
});

async function retentionEntries(authority) {
    return authority.records.transaction(async tx => {
        const rows = new Map(); let startAfter;
        while (true) {
            const page = await tx.list({ prefix: 'participation-records:v1:', limit: 4, ...(startAfter ? { startAfter } : {}) });
            for (const [key, value] of page) { rows.set(key, value); startAfter = key; }
            if (page.size < 4) return rows;
        }
    });
}
async function shortRetentionSubjects(f, count) {
    const grants = await participationLedger(f);
    for (let index = 0; index < count; index++) {
        const person = await f.enroll('retention-' + index); await grants.grant(person.binding, { expiresIn: 100 });
    }
    f.advance(11001); return grants;
}
const retentionRecordKeys = rows => [...rows.keys()].filter(key => key.startsWith('participation-records:v1:record:'));

describe('production retention on the actual authority codec and SQLite', () => {
    it('expires a valid maximum-cardinality stored partition within unchanged logical and native transaction budgets', async () => {
        const f = await fixture({ participation: true }), grants = await participationLedger(f), person = await f.enroll('max-retention');
        await grants.grant(person.binding, { expiresIn: 100 });
        const initial = await retentionEntries(f.authority), [key, template] = [...initial].find(([name]) => name.startsWith('participation-records:v1:record:'));
        const value = clone(template), reference = (kind, index) => 'synthetic_max_' + kind + '_' + String(index).padStart(2, '0');
        // Stored schema boundary only: this does not claim that one enrollment
        // naturally produces this whole historical shape. All rows still pass
        // the real validator, codec, route/index checks and retention guards.
        value.guardians = Array.from({ length: 8 }, (_, index) => ({ ...clone(template.guardians[0]),
            guardianRef: index ? reference('guardian', index) : template.guardians[0].guardianRef,
            decisionRef: index ? reference('decision', index) : template.guardians[0].decisionRef }));
        value.receipts = Array.from({ length: 16 }, (_, index) => ({ ...clone(template.receipts[0]),
            consentRef: index ? reference('consent', index) : template.receipts[0].consentRef,
            guardianRef: value.guardians[index % 8].guardianRef, decisionRef: index ? reference('decision', index) : template.receipts[0].decisionRef,
            state: index ? 'superseded' : template.receipts[0].state }));
        value.pending = Array.from({ length: 16 }, (_, index) => ({ ...clone(template.pending[0]),
            pendingRef: index ? reference('pending', index) : template.pending[0].pendingRef }));
        value.operations = Array.from({ length: 32 }, (_, index) => {
            const operation = clone(template.operations[index % 2]);
            if (index >= 2) operation.operationRef = reference('operation', index);
            const signature = JSON.parse(operation.signature);
            if (operation.kind === 'complete') { signature.operationRef = operation.operationRef; signature.pendingRef = value.pending[index % 16].pendingRef;
                signature.decisionRef = value.receipts[index % 16].decisionRef; }
            else operation.result.pendingRef = value.pending[index % 16].pendingRef;
            operation.signature = JSON.stringify(signature); return operation;
        });
        const counts = ['subjects', 'guardians', 'receipts', 'pending', 'operations'].map(kind => value[kind].length);
        expect(counts).toEqual([1, 8, 16, 16, 32]);
        const recordBytes = Buffer.byteLength(JSON.stringify(value));
        expect(recordBytes).toBeLessThanOrEqual(65536);
        expect(validParticipationLedgerState(value, partitionMaintenance.PARTICIPATION_RECORD_LIMITS)).toBe(true);
        const prefix = 'participation-records:v1:', digest = text => createHash('sha256').update(text).digest('hex'), writes = new Map();
        const unique = (space, reference, deleteAt) => {
            const stored = [...initial.values()].find(row => row?.partitionKey === key && row.space === space); expect(stored).toBeTruthy();
            writes.set(prefix + 'unique:' + space + ':' + digest(reference), { ...clone(stored), reference, deleteAt });
        };
        for (const row of value.pending) unique('pending', row.pendingRef, row.deleteAt);
        for (const row of value.guardians) unique('guardian', row.guardianRef, row.deleteAt);
        for (const row of value.receipts) { unique('consent', row.consentRef, row.deleteAt); unique('decision', row.verifierRef + '\0' + row.decisionRef, row.deleteAt); }
        for (const row of value.operations) {
            const stored = [...initial.values()].find(item => item?.partitionKey === key && item.kind === row.kind && item.operationRef); expect(stored).toBeTruthy();
            writes.set(prefix + 'operation:' + digest(row.operationRef), { ...clone(stored), operationRef: row.operationRef, kind: row.kind, deleteAt: row.deleteAt });
        }
        writes.set(key, value); expect(writes.size).toBe(89); expect(writes.size).toBeLessThanOrEqual(160);
        await f.authority.records.transaction(async tx => { for (const [name, row] of writes) await tx.put(name, row); });
        f.advance(10000); const healthy = await f.enroll('max-healthy'); await grants.grant(healthy.binding); f.advance(1001);
        const before = await retentionEntries(f.authority), owned = [...before].filter(([name, row]) => name === key || row?.partitionKey === key);
        const other = new Map([...before].filter(([name, row]) => name !== key && (name.startsWith(prefix + 'record:') || row?.principalRef === 's_' + healthy.request.sid)));
        expect(owned).toHaveLength(91);
        expect(partitionMaintenance.PARTICIPATION_PARTITION_BOUNDS).toMatchObject({ recordReadCalls: 160, recordWriteCalls: 160 });
        const native = f.storage.transaction, samples = [], size = row => row === undefined ? 0 : row instanceof Uint8Array ? row.byteLength : Buffer.byteLength(JSON.stringify(row));
        f.storage.transaction = operation => native(async raw => {
            const start = f.driver.stats.operations.length, measured = { ...raw }; let calls = 0, readBytes = 0, writeBytes = 0;
            // Observe actual native-handle return values; no guessed preimage
            // bytes or new observer in production code. Errors still reject.
            for (const name of ['get', 'list', 'put', 'delete', 'getAlarm', 'setAlarm', 'deleteAlarm']) measured[name] = async (...args) => {
                calls++; if (name === 'put') writeBytes += size(args[1]);
                const result = await raw[name](...args);
                if (name === 'get') readBytes += size(result);
                if (name === 'list') readBytes += [...result.values()].reduce((sum, row) => sum + size(row), 0);
                return result;
            };
            const result = await operation(measured), events = f.driver.stats.operations.slice(start);
            samples.push({ calls, readBytes, writeBytes, events }); return result;
        });
        let result;
        try { result = await f.authority.maintainParticipation(); } finally { f.storage.transaction = native; }
        expect(result).toEqual({ ok: true, examined: 2, deleted: 1, wrapped: true });
        expect(samples.length).toBeLessThanOrEqual(4);
        for (const sample of samples) { expect(sample.calls).toBe(sample.events.length); expect(sample.calls).toBeLessThanOrEqual(4096); expect(sample.readBytes).toBeLessThanOrEqual(32 * 1024 * 1024); expect(sample.writeBytes).toBeLessThanOrEqual(16 * 1024 * 1024); }
        const after = await retentionEntries(f.authority);
        for (const [name] of owned) expect(after.has(name)).toBe(false);
        expect(new Map([...after].filter(([name, row]) => name.startsWith(prefix + 'record:') || row?.principalRef === 's_' + healthy.request.sid))).toEqual(other);
        const cursorKey = partitionMaintenance.PARTICIPATION_MAINTENANCE_CURSOR_KEY;
        expect((await f.authority.records.transaction(tx => tx.get(cursorKey))).after).toBe('');
        const logical = event => event.key?.includes(':manifest:') ? Buffer.from(event.key.split(':manifest:')[1], 'hex').toString('ascii') : '';
        const cleanup = samples.find(sample => sample.events.some(event => event.name === 'delete' && logical(event) === key)); expect(cleanup).toBeTruthy();
        expect(cleanup.events.findIndex(event => event.name === 'put' && logical(event) === cursorKey)).toBeGreaterThan(cleanup.events.findIndex(event => event.name === 'delete' && logical(event) === key));
        console.info('Stored maximum C2 retention boundary', JSON.stringify({ counts, recordBytes, ownedRowsDeleted: owned.length,
            nativeTransactions: samples.map(({ calls, readBytes, writeBytes }) => ({ calls, readBytes, writeBytes })), logicalReadLimit: 160, logicalWriteLimit: 160 }));
    });

    it('bounds a page to four and resumes after cold reopen, wrapping before a newly inserted earlier record', async () => {
        const f = await fixture({ participation: true }), grants = await shortRetentionSubjects(f, 5);
        const keys = retentionRecordKeys(await retentionEntries(f.authority)); expect(keys).toHaveLength(5);
        expect(await f.authority.maintainParticipation()).toEqual({ ok: true, examined: 4, deleted: 4, wrapped: false });
        const cursorKey = partitionMaintenance.PARTICIPATION_MAINTENANCE_CURSOR_KEY;
        const cursor = await f.authority.records.transaction(tx => tx.get(cursorKey)); expect(cursor.after).toBe(keys[3]);
        // Select a deterministic fixture principal whose real resulting key
        // sorts behind the persisted cursor. This is setup, not an auth claim.
        let name;
        for (let index = 0; index < 256; index++) {
            const candidate = 'late-retention-' + index, principal = 's_' + f.registration(candidate).sid;
            const key = 'participation-records:v1:record:' + createHash('sha256').update(LOBBY_AUTHORITY_COMMUNITY + '\0' + principal).digest('hex');
            if (key < cursor.after) { name = candidate; break; }
        }
        expect(name).toBeTruthy(); const late = await f.enroll(name); await grants.grant(late.binding, { expiresIn: 100 }); f.advance(11001);
        const lateKey = retentionRecordKeys(await retentionEntries(f.authority)).find(key => key !== keys[4]); expect(lateKey < cursor.after).toBe(true);
        const disk = await f.reopen();
        expect(await disk.authority.maintainParticipation()).toEqual({ ok: true, examined: 1, deleted: 1, wrapped: true });
        expect(retentionRecordKeys(await retentionEntries(disk.authority))).toEqual([lateKey]);
        expect((await disk.authority.maintainParticipation()).deleted).toBe(1);
        expect(retentionRecordKeys(await retentionEntries(disk.authority))).toEqual([]);
        expect((await disk.authority.records.transaction(tx => tx.get(cursorKey))).after).toBe('');
    });

    it.each(['partition delete', 'cursor manifest'])('rolls back an actual second-partition %s fault without losing prior committed progress', async fault => {
        const f = await fixture({ participation: true }); await shortRetentionSubjects(f, 2);
        const before = await retentionEntries(f.authority), keys = retentionRecordKeys(before), target = keys[1];
        const owned = new Map([...before].filter(([key, value]) => key === target || value?.partitionKey === target));
        const cursorKey = partitionMaintenance.PARTICIPATION_MAINTENANCE_CURSOR_KEY, rollbackCount = f.driver.stats.rollbacks;
        let deletedTarget = false, injected = false;
        f.hooks.after = event => {
            const logical = event.key?.includes(':manifest:') ? Buffer.from(event.key.split(':manifest:')[1], 'hex').toString('ascii') : '';
            if (event.name === 'delete' && logical === target) deletedTarget = true;
            if (!injected && deletedTarget && (fault === 'partition delete' ? event.name === 'delete' && logical === target : event.name === 'put' && logical === cursorKey)) {
                injected = true; throw Error('Synthetic post-native retention fault');
            }
        };
        await expect(f.authority.maintainParticipation()).rejects.toThrow();
        expect(injected).toBe(true); expect(deletedTarget).toBe(true); expect(f.driver.stats.rollbacks - rollbackCount).toBe(1);
        delete f.hooks.after;
        const after = await retentionEntries(f.authority);
        expect(after.has(keys[0])).toBe(false);
        expect(new Map([...after].filter(([key, value]) => key === target || value?.partitionKey === target))).toEqual(owned);
        expect((await f.authority.records.transaction(tx => tx.get(cursorKey))).after).toBe(keys[0]);
        expect(await f.authority.maintainParticipation()).toEqual({ ok: true, examined: 1, deleted: 1, wrapped: true });
        expect(retentionRecordKeys(await retentionEntries(f.authority))).toEqual([]);
    });

    it.each(['ordinary mode', 'removed C3', 'missing policy', 'corrupt policy'])('refuses %s without creating housekeeping or changing state', async damage => {
        const f = await fixture({ participation: damage !== 'ordinary mode' });
        if (damage !== 'ordinary mode' && damage !== 'missing policy') await participationLedger(f);
        if (damage === 'removed C3') delete f.env.HANGOUT_PARTICIPATION_AUTHORITY;
        if (damage === 'corrupt policy') await f.authority.records.transaction(tx => tx.put(PARTICIPATION_POLICY_KEY, { corrupt: true }));
        const before = fingerprint(f.driver);
        await expect(f.authority.maintainParticipation()).rejects.toThrow(); expect(fingerprint(f.driver)).toBe(before);
        expect(await f.authority.records.transaction(tx => tx.get(partitionMaintenance.PARTICIPATION_MAINTENANCE_CURSOR_KEY))).toBeUndefined();
    });
});

describe('actual SQLite session issuance, binding and lobby effect fence', () => {
    it('rolls back mint/session/index/alarm writes on registration alarm failure; retry spends the mint allowance once', async () => {
        const f = await fixture(), request = f.registration('alice'), before = fingerprint(f.driver); let injected = false;
        f.hooks.after = event => { if (!injected && event.name === 'put' && event.key === ALARM) { injected = true; throw Error('synthetic post-alarm registration failure'); } };
        await expect(f.authority.register(request)).rejects.toThrow(); expect(injected).toBe(true); expect(fingerprint(f.driver)).toBe(before);
        delete f.hooks.after; expect((await f.authority.register(request)).status).toBe(200);
        const rates = await f.authority.records.transaction(tx => tx.get(RATES)); expect(rates[request.iph].count).toBe(1);
        expect((await f.authority.register(request)).status).toBe(409); expect((await f.authority.health()).used).toBe(1);
    });

    it('binds a real issued guest, fences real lobby join/text/report, and persists selected evidence without ordinary bodies', async () => {
        const f = await fixture(), alice = await f.enroll('alice'), bravo = await f.enroll('bravo'), app = f.makeEngine();
        for (const [person, nick] of [[alice, 'Alice'], [bravo, 'Bravo']]) {
            expect((await app.engine.connect(person.binding)).ok).toBe(true); await app.message(person.binding.id, { t: 'hello', nick, age13: true });
        }
        await app.message('bravo', { t: 'say', ch: '#stalemate', text: 'Selected synthetic evidence' });
        const selected = app.frames.find(frame => frame.t === 'line' && frame.recipient === 'alice'); expect(selected).toBeDefined();
        await app.message('alice', { t: 'report', id: selected.id });
        expect(app.frames.some(frame => frame.t === 'report-status' && frame.submitted)).toBe(true);
        await app.message('alice', { t: 'say', ch: '#stalemate', text: 'Unselected ordinary body stays ephemeral' });
        const saved = (await f.authority.load()).state;
        expect(saved.moderationQueue.reports[0].text).toBe('Selected synthetic evidence');
        expect(JSON.stringify(saved)).not.toContain('Unselected ordinary body stays ephemeral'); expect(app.persist).not.toHaveBeenCalled();
        expect(await f.authority.validate(alice.binding)).toBe(true);
    });

    it.each(['revoked', 'expired', 'role-change'])('denies an issued %s actor even for no-consent-check effects', async change => {
        const f = await fixture(), profile = { kind: 'staff', account: await accountId('reviewer@example.invalid', f.env.HANGOUT_HMAC_KEY), role: 'moderator', admin: true, expiresAt: NOW + 90000 };
        const person = await f.enroll('reviewer', profile);
        const context = await f.authority.effectCommit.prepare({ kind: 'message', actorId: person.binding.id, connections: [person.binding] });
        if (change === 'revoked') await f.authority.revoke(person.request);
        if (change === 'expired') f.advance(100001);
        if (change === 'role-change') f.env.HANGOUT_MODERATOR_EMAILS = '';
        const before = fingerprint(f.driver);
        const result = await f.authority.effectCommit.commit(context, [['net', { ...f.state.net, lock: 'readonly' }]]);
        expect(result.ok).toBe(false); expect(fingerprint(f.driver)).toBe(before);
    });

    it.each(['revocation', 'expiry', 'role-change'])('rechecks %s after the LAST actual effect write and rolls back all physical mutations', async change => {
        const f = await fixture(), profile = { kind: 'staff', account: await accountId('reviewer@example.invalid', f.env.HANGOUT_HMAC_KEY), role: 'moderator', admin: true, expiresAt: NOW + 90000 };
        const person = await f.enroll('reviewer', profile), before = fingerprint(f.driver);
        const context = await f.authority.effectCommit.prepare({ kind: 'message', actorId: person.binding.id, connections: [person.binding] }); let changed = false;
        f.controls.afterEffects = async ({ tx }) => {
            changed = true;
            if (change === 'expiry') f.advance(100001);
            if (change === 'role-change') f.env.HANGOUT_MODERATOR_EMAILS = '';
            if (change === 'revocation') {
                const key = `authority-session:${person.request.sid}`, row = await tx.get(key);
                await tx.put(key, { ...row, revoked: true, pending: true, attempt: 1, retryAt: NOW + 1000, closureRevision: 1 });
            }
        };
        f.driver.resetOperations();
        expect((await f.authority.effectCommit.commit(context, [['net', { ...f.state.net, lock: 'readonly' }]])).ok).toBe(false);
        expect(changed).toBe(true); expect(f.driver.stats.operations.some(event => logicalKey(event) === 'net')).toBe(true);
        expect(fingerprint(f.driver)).toBe(before);
    });

    it('retains a newer revocation closure attempt when an older success confirms late', async () => {
        const f = await fixture(), person = await f.enroll('alice');
        const first = await f.authority.revoke(person.request), second = await f.authority.revoke(person.request);
        expect(second.closureRevision).toBe(first.closureRevision + 1);
        await f.authority.confirmClosed(first);
        expect((await f.authority.records.transaction(tx => tx.get(`authority-session:${person.request.sid}`))).pending).toBe(true);
        await f.authority.confirmClosed(second);
        expect((await f.authority.records.transaction(tx => tx.get(`authority-session:${person.request.sid}`))).pending).toBe(false);
    });

    it('does not invent purpose grants while composing the real optional C3 adapter in the same transaction', async () => {
        const f = await fixture(), person = await f.enroll('alice');
        const c3 = createParticipationEnforcement({ storage: f.authority.records, now: f.now,
            resolveConnection: async () => null, validateConnection: async () => false, readPrincipals: async () => ({ ok: false }),
            writeEffects: input => writeLobbyEffects({ ...input, now: f.now() }) });
        const app = f.makeEngine({ participation: c3 });
        expect((await app.engine.connect(person.binding)).ok).toBe(true);
        expect((await app.message('alice', { t: 'hello', nick: 'Alice', age13: true })).ok).toBe(false);
        expect(app.engine._debug.conns.get('alice').nick).toBe(''); expect(app.frames.some(frame => frame.t === 'welcome')).toBe(false);
        expect(await f.authority.validate(person.binding)).toBe(true); expect(app.persist).not.toHaveBeenCalled();
    });

    it.each(['orphan-session', 'missing-session', 'duplicate-session-index', 'orphan-connection', 'missing-connection'])('refuses %s recovery instead of silently rebuilding authority', async damage => {
        const f = await fixture(), person = await f.enroll('alice');
        await f.authority.records.transaction(async tx => {
            if (damage === 'orphan-session') {
                const row = await tx.get(`authority-session:${person.request.sid}`), sid = 'unindexed-orphan-session';
                await tx.put(`authority-session:${sid}`, { ...row, sid });
            }
            if (damage === 'missing-session') await tx.delete(`authority-session:${person.request.sid}`);
            if (damage === 'duplicate-session-index') { const value = await tx.get(SESSION_INDEX); value.entries.push(clone(value.entries[0])); await tx.put(SESSION_INDEX, value); }
            if (damage === 'orphan-connection') { const id = 'unindexed_connection'; await tx.put(`authority-connection:${id}`, { ...person.binding, id, authorityRef: id }); }
            if (damage === 'missing-connection') await tx.delete(`authority-connection:${person.binding.id}`);
        });
        const before = fingerprint(f.driver); await expect(f.authority.load()).rejects.toThrow(); expect(fingerprint(f.driver)).toBe(before);
    });
});

describe('durable invitation generation rotation', () => {
    it('fails closed on an environment version mismatch, then rotates durably and refuses used-version resurrection', async () => {
        const f = await fixture(), before = fingerprint(f.driver); f.env.HANGOUT_BETA_INVITE_VERSION = '2';
        await expect(f.authority.load()).rejects.toThrow(); await expect(f.authority.health()).rejects.toThrow();
        await expect(f.authority.register(f.registration('before-rotate'))).rejects.toThrow(); expect(fingerprint(f.driver)).toBe(before);
        expect((await f.authority.rotate('2')).status).toBe(200);
        expect(await f.authority.records.transaction(tx => tx.get(LOBBY_AUTHORITY_MARKER))).toMatchObject({ inviteVersion: '2', generation: 2, usedVersions: ['1', '2'] });
        expect((await f.authority.register(f.registration('new-generation'))).status).toBe(200);
        const row = await f.authority.records.transaction(tx => tx.get(`authority-session:${f.registration('new-generation').sid}`)); expect(row.generation).toBe(2);
        const rotated = fingerprint(f.driver); f.env.HANGOUT_BETA_INVITE_VERSION = '1';
        await expect(f.authority.rotate('1')).rejects.toThrow(); expect(fingerprint(f.driver)).toBe(rotated);
        f.env.HANGOUT_BETA_INVITE_VERSION = '2'; const reopened = await f.reopen();
        expect(await reopened.authority.records.transaction(tx => tx.get(LOBBY_AUTHORITY_MARKER))).toMatchObject({ inviteVersion: '2', generation: 2, usedVersions: ['1', '2'] });
    });

    it.each(['active', 'pending-revocation'])('does not rotate past an %s old session or erase its required closure', async status => {
        const f = await fixture(), request = f.registration('alice'); expect((await f.authority.register(request)).status).toBe(200);
        if (status === 'pending-revocation') await f.authority.revoke(request);
        const before = fingerprint(f.driver); f.env.HANGOUT_BETA_INVITE_VERSION = '2';
        expect((await f.authority.rotate('2')).status).toBe(409); expect(fingerprint(f.driver)).toBe(before);
        expect(await f.authority.records.transaction(tx => tx.get(LOBBY_AUTHORITY_MARKER))).toMatchObject({ inviteVersion: '1', generation: 1 });
    });

    it('keeps the index and earlier closed rows unchanged when a later old session still needs closure', async () => {
        const f = await fixture(), closed = f.registration('first-closed'), active = f.registration('later-active');
        expect((await f.authority.register(closed)).status).toBe(200);
        await f.authority.confirmClosed(await f.authority.revoke(closed));
        expect((await f.authority.register(active)).status).toBe(200);
        const before = fingerprint(f.driver); f.env.HANGOUT_BETA_INVITE_VERSION = '2';
        expect((await f.authority.rotate('2')).status).toBe(409);
        expect(fingerprint(f.driver)).toBe(before);
        f.env.HANGOUT_BETA_INVITE_VERSION = '1';
        await expect(f.authority.load()).resolves.toBeTruthy();
        expect(await f.authority.check(active)).toMatchObject({ reason: 'active' });
    });

    it('bounds explicit closed-session cleanup to sixteen per call and advances generation only when drained', async () => {
        const f = await fixture();
        for (let n = 0; n < 18; n++) {
            const request = f.registration(`cleanup-${n}`); expect((await f.authority.register(request)).status).toBe(200);
            await f.authority.confirmClosed(await f.authority.revoke(request));
        }
        f.env.HANGOUT_BETA_INVITE_VERSION = '2'; f.driver.resetOperations();
        expect((await f.authority.rotate('2')).status).toBe(409);
        const deletedSessions = () => f.driver.stats.operations.filter(event => event.name === 'delete' && event.key.includes(':manifest:')
            && Buffer.from(event.key.split(':manifest:')[1], 'hex').toString('ascii').startsWith('authority-session:')).length;
        expect(deletedSessions()).toBe(16);
        expect((await f.authority.records.transaction(tx => tx.get(SESSION_INDEX))).entries).toHaveLength(2);
        expect(await f.authority.records.transaction(tx => tx.get(LOBBY_AUTHORITY_MARKER))).toMatchObject({ generation: 1, inviteVersion: '1' });
        f.driver.resetOperations(); expect((await f.authority.rotate('2')).status).toBe(200); expect(deletedSessions()).toBe(2);
        expect(await f.authority.records.transaction(tx => tx.get(LOBBY_AUTHORITY_MARKER))).toMatchObject({ generation: 2, inviteVersion: '2' });
    });

    it('does not advance the generation while a connection binding remains', async () => {
        const f = await fixture(), person = await f.enroll('alice'); await f.authority.confirmClosed(await f.authority.revoke(person.request));
        f.env.HANGOUT_BETA_INVITE_VERSION = '2'; expect((await f.authority.rotate('2')).status).toBe(409);
        expect((await f.authority.records.transaction(tx => tx.get(CONNECTION_INDEX))).ids).toEqual(['alice']);
        expect(await f.authority.records.transaction(tx => tx.get(LOBBY_AUTHORITY_MARKER))).toMatchObject({ inviteVersion: '1', generation: 1 });
    });
});

describe('tick contributor authority fences', () => {
    it('refuses an optional adapter success that skipped the mandatory guarded transaction', async () => {
        const f = await fixture(), person = await f.enroll('skipped-guard'); await f.authority.revoke(person.request);
        const context = await f.authority.effectCommit.prepare({ kind: 'message', actorId: person.binding.id, connections: [person.binding] });
        const before = fingerprint(f.driver);
        const result = await f.authority.effectCommit.commit(context, [['net', f.state.net]], {
            participation: { context: {}, adapter: { commit: async () => ({ ok: true }) } }
        });
        expect(result.ok).toBe(false); expect(fingerprint(f.driver)).toBe(before);
    });
    it.each(['owner-expiry', 'owner-revocation', 'staff-role-change'])('rolls back a %s crossing after the last actual room or net write', async change => {
        const f = await fixture(), staff = change === 'staff-role-change', email = 'owner@example.invalid';
        const profile = { kind: staff ? 'staff' : 'owner', account: await accountId(email, f.env.HANGOUT_HMAC_KEY),
            role: staff ? 'owner' : 'fan', admin: staff, expiresAt: NOW + 90000 };
        const person = await f.enroll('contributor', profile), app = f.makeEngine();
        expect((await app.engine.connect(person.binding)).ok).toBe(true);
        await app.message('contributor', { t: 'hello', nick: 'FixtureContributor', age13: true });
        if (!staff) {
            await app.message('contributor', { t: 'cmd', ch: '#stalemate', name: 'join', args: ['#chat-owned'] });
            await app.message('contributor', { t: 'cmd', ch: '#chat-owned', name: 'register', args: [] });
            expect(app.engine.roomSnapshot().rooms[0].owner).toBe(profile.account);
        }
        const originalRooms = clone(app.engine.roomSnapshot()), originalLastBand = app.engine.snapshot().lastBand;
        const beforeState = (await f.authority.load()).state;
        const beforeAuthority = await f.authority.records.transaction(tx => tx.get(`authority-session:${person.request.sid}`));
        const beforePhysical = fingerprint(f.driver), initialRollbacks = f.driver.stats.rollbacks;
        let physicalAfterRollback;
        f.hooks.before = () => {
            // Observe the exact rolled-back disk BEFORE the separate allowed
            // conservative accounting transaction performs any operation.
            if (physicalAfterRollback === undefined && f.driver.stats.rollbacks > initialRollbacks) physicalAfterRollback = fingerprint(f.driver);
        };
        f.advance(1000); let crossed = false;
        f.controls.afterEffects = async ({ tx, effects, costsOnly }) => {
            if (costsOnly) return;
            expect(effects.some(([kind]) => kind === (staff ? 'net' : 'rooms'))).toBe(true); crossed = true;
            if (change === 'owner-expiry') f.advance(100000);
            if (change === 'staff-role-change') f.env.HANGOUT_OWNER_EMAIL = '';
            if (change === 'owner-revocation') {
                const key = `authority-session:${person.request.sid}`, row = await tx.get(key);
                await tx.put(key, { ...row, revoked: true, pending: true, attempt: 1, retryAt: f.now() + 1000, closureRevision: 1 });
            }
        };
        f.driver.resetOperations();
        expect((await app.engine.tick())?.ok).toBe(false);
        expect(crossed).toBe(true);
        expect(physicalAfterRollback).toBe(beforePhysical);
        const expectedKey = staff ? 'net' : 'community-room:#chat-owned';
        expect(f.driver.stats.operations.some(event => logicalKey(event) === expectedKey)).toBe(true);
        const afterState = (await f.authority.load()).state;
        expect(afterState.rooms).toEqual(beforeState.rooms);
        expect(afterState.net.lastBand).toBe(beforeState.net.lastBand);
        expect(await f.authority.records.transaction(tx => tx.get(`authority-session:${person.request.sid}`))).toEqual(beforeAuthority);
        // Failed work may durably catch up conservative frame/request costs
        // already spent before tick; that is distinct from its refused renewal.
        expect(afterState.net.budget.requests).toBeGreaterThanOrEqual(beforeState.net.budget.requests);
        expect(app.engine.roomSnapshot()).toEqual(originalRooms); expect(app.engine.snapshot().lastBand).toBe(originalLastBand);
        expect(app.persist).not.toHaveBeenCalled();
    });

    it('permits reducing cleanup when an expired ordinary visitor contributed no owner renewal or band heartbeat', async () => {
        const f = await fixture(), person = await f.enroll('ordinary'), app = f.makeEngine();
        expect((await app.engine.connect(person.binding)).ok).toBe(true);
        await app.message('ordinary', { t: 'hello', nick: 'OrdinaryVisitor', age13: true });
        await app.message('ordinary', { t: 'cmd', ch: '#stalemate', name: 'join', args: ['#chat-empty'] });
        await app.message('ordinary', { t: 'cmd', ch: '#chat-empty', name: 'part', args: [] });
        expect(app.engine.roomSnapshot().rooms).toHaveLength(1); f.advance(10 * 60000 + 1);
        expect(await f.authority.validate(person.binding)).toBe(false);
        expect((await app.engine.tick())?.ok).not.toBe(false);
        expect(app.engine.roomSnapshot().rooms).toEqual([]); expect((await f.authority.load()).state.rooms.rooms).toEqual([]);
        expect(app.persist).not.toHaveBeenCalled();
    });
});

// Only operator/guardian decisions are synthetic here. Production principal
// resolution, current binding checks, partition reads and effect writes are real.
async function participationLedger(f) {
    expect(f.env.HANGOUT_PARTICIPATION_AUTHORITY).toBe('c3-v1');
    const participant = new Map(), decisions = new Map(), guardians = new Map();
    const config = { policy: { version: 1, policyVersion: 'synthetic-production-composition-v1', revision: 1,
        communityRef: LOBBY_AUTHORITY_COMMUNITY, noticeDigest: 'b'.repeat(64), decisionRef: 'synthetic_operator_decision', state: 'qualified',
        purposes: [...PARTICIPATION_PURPOSES], issuedAt: NOW - 1, effectiveAt: NOW - 1, expiresAt: NOW + 900000, maxSessionMs: 60000 },
        rules: { version: 1, verifierRef: 'synthetic_guardian_verifier', pendingMs: 10000, grantMs: 100000,
            subjectTailMs: 1000, guardianTailMs: 1000, receiptTailMs: 1000, callbackMs: 1000, operationMs: 10000 } };
    const ledger = createPartitionedParticipationConsents({ storage: f.authority.records, now: f.now,
        admitSubject: async ({ tx }) => { const n = await tx.get('synthetic-allocation-count') || 0; if (n >= 8) return false; await tx.put('synthetic-allocation-count', n + 1); return true; },
        adapters: {
            qualifyPolicy: async () => ({ config, expiresAt: f.now() + 1000 }),
            authenticateParticipant: async ({ proof, purpose }) => {
                const identity = participant.get(proof); if (!identity) return null;
                return purpose === 'begin' ? identity : Object.fromEntries(Object.entries(identity).filter(([key]) => key !== 'operationRef'));
            },
            verifyConsent: async ({ proof }) => decisions.get(proof), authenticateGuardian: async ({ proof }) => guardians.get(proof),
            authorizeMaintenance: async () => ({ communityRef: LOBBY_AUTHORITY_COMMUNITY, expiresAt: f.now() + 1000 })
        } });
    expect((await ledger.installPolicy('synthetic-operator')).ok).toBe(true);
    return { ledger, async grant(binding, { expiresIn = 100000 } = {}) {
        const identity = await f.authority.resolveParticipationConnection(binding), proof = crypto.randomUUID(); expect(identity).not.toBeNull();
        participant.set(proof, { ...identity, operationRef: crypto.randomUUID() });
        const pending = await ledger.begin(proof, { expectedRevision: 0, purposes: [...PARTICIPATION_PURPOSES] }); expect(pending.ok).toBe(true);
        const decision = crypto.randomUUID(); decisions.set(decision, { operationRef: crypto.randomUUID(), pendingRef: pending.pendingRef,
            subjectRef: pending.subjectRef, principalRef: identity.principalRef, guardianPrincipalRef: 'synthetic_guardian_principal',
            decisionRef: crypto.randomUUID(), verifierRef: config.rules.verifierRef, status: 'approved', purposes: [...PARTICIPATION_PURPOSES],
            verifiedAt: f.now(), expiresAt: f.now() + expiresIn });
        const result = await ledger.complete(decision); expect(result.state).toBe('authorized'); return { ...pending, identity };
    }, async withdraw(binding, purposes = []) {
        const identity = await f.authority.resolveParticipationConnection(binding);
        const rows = await f.authority.records.transaction(tx => tx.list({ prefix: 'participation-records:v1:record:', limit: 4 }));
        const state = [...rows.values()].find(row => row.subjects[0].record.principalRef === identity.principalRef);
        const subject = state.subjects[0].record, guardian = state.guardians.find(row => row.subjectRef === subject.subjectRef), proof = crypto.randomUUID();
        guardians.set(proof, { operationRef: crypto.randomUUID(), subjectRef: subject.subjectRef, principalRef: guardian.principalRef,
            guardianRef: guardian.guardianRef, guardianRevision: guardian.revision, expiresAt: f.now() + 1000 });
        return ledger.change(proof, { expectedRevision: subject.revision, purposes });
    } };
}
const productionParticipation = f => {
    expect(f.env.HANGOUT_PARTICIPATION_AUTHORITY).toBe('c3-v1');
    return createLobbyParticipation({ env: f.env, authority: f.authority, now: f.now });
};

describe('production participation session/partition/effect composition', () => {
    it('requires one explicit compatible opt-in and never constructs a default grant adapter', async () => {
        expect(lobbyParticipationMode({})).toBe(false); expect(createLobbyParticipation({ env: {} })).toBeNull();
        for (const extra of [{ HANGOUT_PARTICIPATION_AUTHORITY: '' }, { HANGOUT_PARTICIPATION_AUTHORITY: 'future' },
            { HANGOUT_PARTICIPATION_AUTHORITY: 'c3-v1' }, { HANGOUT_PARTICIPATION_AUTHORITY: 'c3-v1', HANGOUT_BETA_MODE: 'protected' }]) expect(() => lobbyParticipationMode(extra)).toThrow();
        const f = await fixture({ participation: true }); expect(lobbyParticipationMode({ ...f.env, HANGOUT_PARTICIPATION_AUTHORITY: 'c3-v1' })).toBe(true);
    });
    it.each(['missing', 'corrupt'])('denies publishing with a %s partition policy, without provisioning it', async condition => {
        const f = await fixture({ participation: true }), person = await f.enroll('c3missing');
        if (condition === 'corrupt') await f.authority.records.transaction(tx => tx.put(PARTICIPATION_POLICY_KEY, { forged: true }));
        const before = await f.authority.records.transaction(tx => tx.get(PARTICIPATION_POLICY_KEY));
        const app = f.makeEngine({ participation: productionParticipation(f) }); expect((await app.engine.connect(person.binding)).ok).toBe(true);
        expect((await app.message(person.binding.id, { t: 'hello', nick: 'MissingGrant', age13: true, subjectRef: 'forged_subject', principalRef: 'forged_principal' })).ok).toBe(false);
        expect(app.frames.some(frame => frame.t === 'welcome' || frame.t === 'join')).toBe(false);
        expect(await f.authority.records.transaction(tx => tx.get(PARTICIPATION_POLICY_KEY))).toEqual(before); expect(app.persist).not.toHaveBeenCalled();
    });
    it('binds guest principals to the saved SID and refuses copied device/account/identity fields', async () => {
        const f = await fixture({ participation: true }), a = await f.enroll('guestalpha'), b = await f.enroll('guestbravo');
        const identity = await f.authority.resolveParticipationConnection(a.binding);
        expect(identity.principalRef).toBe(`s_${a.request.sid}`); expect(identity.communityRef).toBe(LOBBY_AUTHORITY_COMMUNITY);
        for (const changes of [{ betaSid: b.request.sid }, { account: 'a_' + 'q'.repeat(43) }, { role: 'moderator', admin: true }, { dev: b.binding.dev }, { expiresAt: a.binding.expiresAt + 1 }]) {
            expect(await f.authority.resolveParticipationConnection({ ...a.binding, ...changes })).toBeNull();
            expect(await f.authority.records.transaction(tx => f.authority.validateParticipationConnection({ tx, connection: { ...a.binding, ...changes }, identity }))).toBe(false);
        }
        const c = await f.enroll('same-device');
        await f.authority.records.transaction(async tx => {
            const row = await tx.get('authority-connection:' + c.binding.id); c.binding.dev = a.binding.dev; c.binding.iph = a.binding.iph;
            await tx.put('authority-connection:' + c.binding.id, { ...row, dev: c.binding.dev, iph: c.binding.iph });
        });
        expect((await f.authority.resolveParticipationConnection(c.binding)).principalRef).not.toBe(identity.principalRef);
    });
    it('uses verified account identity without transferring an earlier guest grant', async () => {
        const f = await fixture({ participation: true }), guest = await f.enroll('guestowner'), ledger = await participationLedger(f); await ledger.grant(guest.binding);
        const profile = { kind: 'owner', account: await accountId('holder@example.invalid', f.env.HANGOUT_HMAC_KEY), role: 'fan', admin: false, expiresAt: NOW + 90000 };
        const owner = await f.enroll('verifiedowner', profile); expect((await f.authority.resolveParticipationConnection(owner.binding)).principalRef).toBe(profile.account);
        const app = f.makeEngine({ participation: productionParticipation(f) }); expect((await app.engine.connect(owner.binding)).ok).toBe(true);
        expect((await app.message(owner.binding.id, { t: 'hello', nick: 'NoInheritedGrant', age13: true })).ok).toBe(false);
        expect(app.frames.some(frame => frame.t === 'welcome')).toBe(false);
    });
    it('publishes only after the actual partition and session/effect transaction and reloads that grant on disk reopen', async () => {
        const f = await fixture({ participation: true }), person = await f.enroll('realcompose'); await (await participationLedger(f)).grant(person.binding);
        const app = f.makeEngine({ participation: productionParticipation(f) }); expect((await app.engine.connect(person.binding)).ok).toBe(true);
        expect((await app.message(person.binding.id, { t: 'hello', nick: 'RealCompose', age13: true }))?.ok).not.toBe(false);
        expect(app.frames.some(frame => frame.t === 'welcome')).toBe(true);
        await app.message(person.binding.id, { t: 'cmd', ch: '#stalemate', name: 'join', args: ['#art-composed'] });
        expect((await f.authority.load()).state.rooms.rooms.map(room => room.name)).toContain('#art-composed');
        const reopened = await f.reopen(), identity = await reopened.authority.resolveParticipationConnection(person.binding); expect(identity).not.toBeNull();
        const fresh = createLobbyParticipation({ env: f.env, authority: reopened.authority, now: f.now });
        const context = await fresh.prepare([person.binding]); expect(fresh.allows(context, { actorId: person.binding.id, action: 'publicText' })).toBe(true);
        expect(fresh.allows(context, { actorId: person.binding.id, action: 'aiPublicReview', providerReady: true, publicTextEligible: true })).toBe(false);
    });
    it.each(['expiry', 'revocation', 'role removal', 'subject expiry', 'policy change', 'subject revision', 'SID replacement'])('rolls back real room effects when %s occurs after the native effect writes', async change => {
        const f = await fixture({ participation: true }), profile = { kind: 'staff', account: await accountId('reviewer@example.invalid', f.env.HANGOUT_HMAC_KEY), role: 'moderator', admin: true, expiresAt: NOW + 90000 };
        const person = await f.enroll('latecheck', profile); await (await participationLedger(f)).grant(person.binding,
            change === 'subject expiry' ? { expiresIn: 1000 } : {});
        const replacement = change === 'SID replacement' ? await f.enroll('newsession', profile) : null;
        const policyBefore = await f.authority.records.transaction(tx => tx.get(PARTICIPATION_POLICY_KEY));
        const bindingBefore = await f.authority.records.transaction(tx => tx.get('authority-connection:' + person.binding.id));
        const subjectBefore = await f.authority.records.transaction(async tx => [...(await tx.list({ prefix: 'participation-records:v1:record:', limit: 4 }))][0]);
        const app = f.makeEngine({ participation: productionParticipation(f) }); await app.engine.connect(person.binding); await app.message(person.binding.id, { t: 'hello', nick: 'LateCheck', age13: true }); app.frames.length = 0;
        let reached = false; f.controls.afterEffects = async ({ tx, costsOnly }) => {
            if (costsOnly || reached) return; reached = true;
            if (change === 'expiry') f.advance(100001);
            else if (change === 'subject expiry') f.advance(1001); // Session/profile remain valid.
            else if (change === 'role removal') f.env.HANGOUT_MODERATOR_EMAILS = '';
            else if (change === 'policy change') {
                const value = await tx.get(PARTICIPATION_POLICY_KEY);
                value.config.policy = { ...value.config.policy, revision: value.config.policy.revision + 1,
                    policyVersion: 'synthetic-production-composition-v2', noticeDigest: 'c'.repeat(64), decisionRef: 'synthetic_operator_update' };
                await tx.put(PARTICIPATION_POLICY_KEY, value);
            } else if (change === 'subject revision') {
                const [key] = subjectBefore, value = await tx.get(key);
                value.subjects[0].record.revision++; await tx.put(key, value);
            } else if (change === 'SID replacement') {
                await tx.put('authority-connection:' + person.binding.id, { ...bindingBefore, betaSid: replacement.request.sid });
            }
            else { const key = 'authority-session:' + person.request.sid, row = await tx.get(key); await tx.put(key, { ...row, revoked: true }); }
        };
        expect((await app.message(person.binding.id, { t: 'cmd', ch: '#stalemate', name: 'join', args: ['#late-denied'] })).ok).toBe(false);
        expect(reached).toBe(true); expect(app.engine.roomSnapshot().rooms.some(room => room.name === '#late-denied')).toBe(false);
        expect(app.frames.some(frame => frame.t === 'join' && frame.ch.name === '#late-denied')).toBe(false);
        expect(await f.authority.records.transaction(tx => tx.get('community-room:#late-denied'))).toBeUndefined(); expect(f.driver.stats.rollbacks).toBeGreaterThan(0);
        if (['subject expiry', 'policy change', 'subject revision', 'SID replacement'].includes(change)) {
            expect(await f.authority.validate(person.binding)).toBe(true);
            expect(await f.authority.records.transaction(tx => tx.get(PARTICIPATION_POLICY_KEY))).toEqual(policyBefore);
            expect(await f.authority.records.transaction(tx => tx.get('authority-connection:' + person.binding.id))).toEqual(bindingBefore);
            expect(await f.authority.records.transaction(tx => tx.get(subjectBefore[0]))).toEqual(subjectBefore[1]);
        }
    });
    it('retains a separately committed C2 withdrawal and denies queued room publication while the real session remains valid', async () => {
        const f = await fixture({ participation: true }), person = await f.enroll('withdrawn'), ledger = await participationLedger(f); await ledger.grant(person.binding);
        let reduceBeforeCommit = false;
        const fence = { prepare: (...args) => f.authority.effectCommit.prepare(...args), commit: async (...args) => {
            if (reduceBeforeCommit && !args[2]?.costsOnly) { reduceBeforeCommit = false; expect((await ledger.withdraw(person.binding)).state).toBe('withdrawn'); }
            return f.authority.effectCommit.commit(...args);
        } };
        const app = f.makeEngine({ participation: productionParticipation(f), effectCommit: fence });
        await app.engine.connect(person.binding); await app.message(person.binding.id, { t: 'hello', nick: 'Withdrawn', age13: true }); app.frames.length = 0;
        reduceBeforeCommit = true;
        expect((await app.message(person.binding.id, { t: 'cmd', ch: '#stalemate', name: 'join', args: ['#withdraw-denied'] })).ok).toBe(false);
        expect(await f.authority.validate(person.binding)).toBe(true); expect(app.engine.roomSnapshot().rooms).toEqual([]);
        expect(app.frames.some(frame => frame.t === 'join' && frame.ch.name === '#withdraw-denied')).toBe(false);
        const fresh = productionParticipation(f), context = await fresh.prepare([person.binding]);
        expect(fresh.allows(context, { actorId: person.binding.id, action: 'publicArtifact' })).toBe(false);
        expect((await app.message(person.binding.id, { t: 'cmd', ch: '#stalemate', name: 'block', args: ['MissingNick'] }))?.ok).not.toBe(false);
        const rows = await f.authority.records.transaction(tx => tx.list({ prefix: 'participation-records:v1:record:', limit: 4 }));
        expect([...rows.values()][0].subjects[0].record.state).toBe('withdrawn');
    });
});

async function productionDo(f) {
    expect(f.env.HANGOUT_PARTICIPATION_AUTHORITY).toBe('c3-v1');
    const sockets = [], background = [], originalResponse = globalThis.Response;
    class Socket {
        frames = []; readyState = 1;
        send(raw) { this.frames.push(JSON.parse(raw)); }
        close(code, reason) { this.readyState = 3; this.closed = { code, reason }; }
        serializeAttachment(value) { this.attachment = value; }
        deserializeAttachment() { return this.attachment; }
    }
    vi.stubGlobal('WebSocketPair', class { constructor() { this[0] = new Socket(); this[1] = new Socket(); } });
    vi.stubGlobal('Response', class extends originalResponse {
        constructor(body, init) { super(body, init?.status === 101 ? { ...init, status: 200 } : init);
            if (init?.status === 101) Object.defineProperty(this, 'status', { value: 101 }); this.webSocket = init?.webSocket; }
    });
    const clock = vi.spyOn(Date, 'now').mockImplementation(f.now);
    const storage = { ...f.storage,
        get: key => f.storage.transaction(tx => tx.get(key)), put: (key, value) => f.storage.transaction(tx => tx.put(key, value)),
        list: options => f.storage.transaction(tx => tx.list(options)), delete: key => f.storage.transaction(tx => tx.delete(key)),
        getAlarm: () => f.storage.transaction(tx => tx.getAlarm()), setAlarm: value => f.storage.transaction(tx => tx.setAlarm(value)) };
    const state = { storage, blockConcurrencyWhile: fn => fn(), waitUntil: task => background.push(task),
        getWebSockets: id => sockets.filter(ws => !id || ws.tags.includes(id)), getTags: ws => ws.tags,
        acceptWebSocket: (ws, tags) => { ws.tags = tags; sockets.push(ws); } };
    const lobby = new HangoutLobby(state, f.env); await lobby.ready;
    expect(lobby.authorityUnavailable).toBe(false);
    return { lobby, sockets, async connect(person, nick) {
        // The actual gateway has no connection ID before the DO admits it.
        // Its previous test binding was correctly retired at cold recovery.
        const { id, authorityRef, authorityRevision, ...identity } = person.binding;
        const response = await lobby.fetch(new Request('https://owned/lobby', { headers: { 'X-Hangout-Identity': JSON.stringify(identity) } }));
        const refusal = response.status === 101 ? '' : await response.text();
        expect(response.status, refusal).toBe(101); const socket = sockets.at(-1);
        await lobby.webSocketMessage(socket, JSON.stringify({ t: 'hello', nick, age13: true })); return socket;
    }, message: (socket, frame) => lobby.webSocketMessage(socket, JSON.stringify(frame)),
    async dispose() { lobby.presence.dispose(); await Promise.all(background); clock.mockRestore(); vi.unstubAllGlobals(); } };
}

describe('actual HangoutLobby constructs the required participation bridge', () => {
    it('does not publish an unknown guest nickname when the actual DO has no C2 policy', async () => {
        const f = await fixture({ participation: true }), person = await f.enroll('missingpolicy'), app = await productionDo(f);
        try {
            const ws = await app.connect(person, 'NotEnrolled');
            expect(ws.frames.some(frame => frame.t === 'hello')).toBe(true);
            expect(ws.frames.some(frame => frame.t === 'welcome' || frame.t === 'join')).toBe(false);
            expect(ws.frames.some(frame => frame.t === 'notice' && frame.kind === 'error')).toBe(true);
            expect(await app.lobby.authority.records.transaction(tx => tx.get(PARTICIPATION_POLICY_KEY))).toBeUndefined();
        } finally { await app.dispose(); }
    });
    it('uses its actual composed alarm to retire lost media permission while keeping another current peer', async () => {
        const f = await fixture({ participation: true }), a = await f.enroll('alarmalpha'), b = await f.enroll('alarmbravo'), ledger = await participationLedger(f);
        await ledger.grant(a.binding); await ledger.grant(b.binding); const app = await productionDo(f);
        try {
            const wa = await app.connect(a, 'AlarmAlpha'), wb = await app.connect(b, 'AlarmBravo');
            for (const ws of [wa, wb]) {
                await app.message(ws, { t: 'cmd', ch: '#stalemate', name: 'join', args: ['#art-alarm'] });
                await app.message(ws, { t: 'cam', ch: '#art-alarm', on: true, adult18: true });
                expect(ws.frames.some(frame => frame.t === 'cam' && frame.on === true)).toBe(true);
            }
            // Production session principals survive ordinary reconnect, not new
            // SID/account claims. This reduction uses synthetic guardian proof.
            expect((await ledger.withdraw(wa.attachment, PARTICIPATION_PURPOSES.filter(purpose => purpose !== 'camera'))).state).toBe('authorized');
            expect(wa.closed).toBeUndefined(); await app.lobby.alarm();
            expect(wa.closed?.code).toBe(4401); expect(wb.closed).toBeUndefined();
            expect(app.lobby.engine._debug.conns.has(wb.attachment.id)).toBe(true);
            expect(app.lobby.engine._debug.conns.get(wb.attachment.id).cams.has('#art-alarm')).toBe(true);
            const subject = await app.lobby.authority.resolveParticipationConnection({ ...a.binding, id: wa.attachment.id, authorityRef: wa.attachment.id });
            expect(subject?.principalRef).toBe(`s_${a.request.sid}`);
        } finally { await app.dispose(); }
    });
});

// Compare observable identities with the existing resolver, not a reimplementation
// of its binding/profile rules. Per-descriptor denial/exception means no identity.
async function individualCohortIdentities(authority, descriptors) {
    const identities = [];
    for (const descriptor of descriptors) {
        try { identities.push(await authority.resolveParticipationConnection(descriptor)); }
        catch { identities.push(null); }
    }
    return identities;
}

describe('read-only preparation cohort on the actual SQLite authority', () => {
    it('preserves order and independently validates duplicate IDs, shared SIDs and changed claims', async () => {
        const f = await fixture({ participation: true }), guest = await f.enroll('cohort-guest');
        const profile = { kind: 'owner', account: await accountId('cohort-holder@example.invalid', f.env.HANGOUT_HMAC_KEY),
            role: 'fan', admin: false, expiresAt: NOW + 50000 };
        const owner = await f.enroll('cohort-owner', profile);
        const fan = { ...owner.binding, id: 'cohort-owner-fan', authorityRef: 'cohort-owner-fan',
            account: '', role: 'fan', admin: false, expiresAt: owner.request.exp };
        await f.authority.bind(fan);
        const descriptors = [guest.binding, { ...guest.binding, role: 'owner', admin: true }, guest.binding,
            { ...guest.binding, dev: 'copied-wrong-device' }, owner.binding, fan,
            { ...guest.binding, principalRef: 'client_forged_principal', subjectRef: 'client_forged_subject' }, null];
        const original = clone(descriptors), expected = await individualCohortIdentities(f.authority, descriptors), before = fingerprint(f.driver);
        f.driver.resetOperations();
        const result = await f.authority.resolveParticipationConnections(descriptors);
        expect(result).toEqual(expected); expect(descriptors).toEqual(original);
        expect(result.map(value => value?.principalRef ?? null)).toEqual([
            's_' + guest.request.sid, null, 's_' + guest.request.sid, null,
            profile.account, profile.account, 's_' + guest.request.sid, null
        ]);
        expect(result[0]).not.toBe(result[2]);
        result[0].principalRef = 'mutated_result_only';
        expect(result[2].principalRef).toBe('s_' + guest.request.sid);
        expect((await f.authority.resolveParticipationConnections([guest.binding]))[0]).toEqual(expected[0]);
        expect(fingerprint(f.driver)).toBe(before);
        expect(f.driver.stats.operations.every(event => ['get', 'list'].includes(event.name))).toBe(true);
    });

    it.each(['logical corruption', 'connection index removal', 'session index removal', 'revocation', 'SID replacement'])(
        'matches individual denial for %s without granting a different slot', async damage => {
            const f = await fixture({ participation: true }), target = await f.enroll('cohort-target'), healthy = await f.enroll('cohort-healthy');
            const key = 'authority-connection:' + target.binding.id;
            if (damage === 'logical corruption') await f.authority.records.transaction(tx => tx.put(key, { corrupt: true }));
            if (damage === 'connection index removal') await f.authority.records.transaction(async tx => {
                const index = await tx.get(CONNECTION_INDEX); index.ids = index.ids.filter(id => id !== target.binding.id); await tx.put(CONNECTION_INDEX, index);
            });
            if (damage === 'session index removal') await f.authority.records.transaction(async tx => {
                const index = await tx.get(SESSION_INDEX); index.entries = index.entries.filter(row => row.sid !== target.request.sid); await tx.put(SESSION_INDEX, index);
            });
            if (damage === 'revocation') await f.authority.revoke(target.request);
            if (damage === 'SID replacement') await f.authority.records.transaction(async tx => {
                const binding = await tx.get(key); await tx.put(key, { ...binding, betaSid: healthy.request.sid });
            });
            const descriptors = [target.binding, healthy.binding, target.binding], before = fingerprint(f.driver);
            const expected = await individualCohortIdentities(f.authority, descriptors);
            expect(expected[0]).toBeNull(); expect(expected[1]?.principalRef).toBe('s_' + healthy.request.sid);
            expect(await f.authority.resolveParticipationConnections(descriptors)).toEqual(expected);
            expect(fingerprint(f.driver)).toBe(before);
        });

    it('rechecks profile expiry and current staff roles without falling back to a SID principal', async () => {
        const f = await fixture({ participation: true }), healthy = await f.enroll('cohort-other');
        const account = await accountId('reviewer@example.invalid', f.env.HANGOUT_HMAC_KEY);
        const staff = await f.enroll('cohort-staff', { kind: 'staff', account, role: 'moderator', admin: true, expiresAt: NOW + 50000 });
        const fan = { ...staff.binding, id: 'cohort-profile-fan', authorityRef: 'cohort-profile-fan',
            account: '', role: 'fan', admin: false, expiresAt: staff.request.exp };
        await f.authority.bind(fan);
        expect((await f.authority.resolveParticipationConnections([staff.binding, fan])).map(value => value?.principalRef)).toEqual([account, account]);
        f.env.HANGOUT_MODERATOR_EMAILS = '';
        expect(await f.authority.resolveParticipationConnections([staff.binding, fan, healthy.binding]))
            .toEqual(await individualCohortIdentities(f.authority, [staff.binding, fan, healthy.binding]));
        expect((await f.authority.resolveParticipationConnections([staff.binding, fan])).every(value => value === null)).toBe(true);
        f.env.HANGOUT_MODERATOR_EMAILS = 'reviewer@example.invalid'; f.advance(50001);
        const result = await f.authority.resolveParticipationConnections([fan, healthy.binding]);
        expect(result[0]).toBeNull(); expect(result[1]?.principalRef).toBe('s_' + healthy.request.sid);
    });

    it('does not freeze the clock for a later duplicate descriptor using cached raw rows', async () => {
        const f = await fixture({ participation: true }), person = await f.enroll('cohort-clock');
        let calls = 0, expireAfter = Infinity;
        const authority = createLobbySessionAuthority({ storage: f.storage, env: f.env,
            now: () => ++calls <= expireAfter ? NOW : NOW + 100001, writeEffects: writeLobbyEffects });
        expect(await authority.resolveParticipationConnection(person.binding)).not.toBeNull();
        // Calibrate with the existing single resolver rather than bake its
        // current number of clock reads into this regression.
        expireAfter = calls; calls = 0;
        const result = await authority.resolveParticipationConnections([person.binding, person.binding]);
        expect(result[0]?.principalRef).toBe('s_' + person.request.sid); expect(result[1]).toBeNull();
        expect(calls).toBeGreaterThan(expireAfter);
    });

    it('keeps caches transaction-local and rejects real codec/native failure for the whole cohort', async () => {
        const f = await fixture({ participation: true }), first = await f.enroll('cohort-fresh'), second = await f.enroll('cohort-revoke');
        expect((await f.authority.resolveParticipationConnections([first.binding, second.binding])).every(Boolean)).toBe(true);
        await f.authority.revoke(second.request);
        expect((await f.authority.resolveParticipationConnections([first.binding, second.binding])).map(value => value?.principalRef ?? null))
            .toEqual(['s_' + first.request.sid, null]);
        const hex = Buffer.from('authority-connection:' + first.binding.id).toString('hex');
        const physical = [...f.driver.rows().keys()].find(key => key.includes(':part:' + hex + ':'));
        expect(physical).toBeDefined(); await f.rawPut(physical, new Uint8Array([255]));
        const before = fingerprint(f.driver);
        await expect(f.authority.resolveParticipationConnections([first.binding, second.binding])).rejects.toThrow();
        expect(fingerprint(f.driver)).toBe(before);
    });

    it('fails a missing initialized marker globally without provisioning or repairing it', async () => {
        const f = await fixture({ participation: true }), person = await f.enroll('cohort-marker');
        await f.authority.records.transaction(tx => tx.delete(LOBBY_AUTHORITY_MARKER));
        const before = fingerprint(f.driver);
        await expect(f.authority.resolveParticipationConnections([person.binding])).rejects.toThrow();
        expect(fingerprint(f.driver)).toBe(before);
    });

    it('does not convert a real native read refusal into per-slot denial or fallback', async () => {
        const f = await fixture({ participation: true }), person = await f.enroll('cohort-native');
        const suffix = Buffer.from('authority-connection:' + person.binding.id).toString('hex'), before = fingerprint(f.driver);
        let refused = false;
        f.hooks.before = event => {
            if (event.name === 'get' && event.key.endsWith(':manifest:' + suffix)) {
                refused = true; throw Error('Synthetic native read refusal inside actual SQLite transaction');
            }
        };
        await expect(f.authority.resolveParticipationConnections([person.binding])).rejects.toThrow();
        expect(refused).toBe(true); expect(fingerprint(f.driver)).toBe(before);
    });

    it('wires the optional authority method only when present and otherwise preserves real individual preparation', async () => {
        const f = await fixture({ participation: true }), person = await f.enroll('cohort-factory'), grants = await participationLedger(f);
        await grants.grant(person.binding);
        const { resolveParticipationConnections, ...legacy } = f.authority;
        const single = vi.fn(connection => f.authority.resolveParticipationConnection(connection));
        const bulk = vi.fn(values => resolveParticipationConnections(values));
        const old = createLobbyParticipation({ env: f.env, authority: { ...legacy, resolveParticipationConnection: single }, now: f.now });
        const oldContext = await old.prepare([person.binding]);
        expect(old.allows(oldContext, { actorId: person.binding.id, action: 'publicText' })).toBe(true);
        expect(single).toHaveBeenCalledTimes(1);
        single.mockClear();
        const current = createLobbyParticipation({ env: f.env, authority: { ...legacy, resolveParticipationConnection: single,
            resolveParticipationConnections: bulk }, now: f.now });
        const context = await current.prepare([person.binding]);
        expect(current.allows(context, { actorId: person.binding.id, action: 'publicText' })).toBe(true);
        expect(bulk).toHaveBeenCalledTimes(1); expect(single).not.toHaveBeenCalled();
        for (const value of [null, {}, true]) expect(() => createLobbyParticipation({ env: f.env,
            authority: { ...legacy, resolveParticipationConnections: value }, now: f.now })).toThrow('participation-authority-unavailable');
    });

    it('reads 200 stored authority bindings in one bounded native transaction with less amplification', async () => {
        const f = await fixture({ participation: true }), descriptors = [];
        // This tests stored authority reads, not 200 ordinary admissions/mints.
        // One real enrollment supplies the current guest record schema. The
        // remaining fixture rows use the real codec/SQLite, with at most 16
        // logical writes per batch and both indices committed atomically.
        const template = await f.enroll('cohort-000'); descriptors.push(template.binding);
        const record = await f.authority.records.transaction(tx => tx.get('authority-session:' + template.request.sid));
        for (let start = 1; start < 200; start += 7) await f.authority.records.transaction(async tx => {
            const sessions = await tx.get(SESSION_INDEX), connections = await tx.get(CONNECTION_INDEX);
            for (let index = start; index < Math.min(start + 7, 200); index++) {
                const id = 'cohort-' + String(index).padStart(3, '0'), request = f.registration(id);
                const binding = { ...template.binding, id, authorityRef: id, betaSid: request.sid, dev: 'device_' + id, iph: request.iph };
                await tx.put('authority-session:' + request.sid, { ...record, sid: request.sid });
                await tx.put('authority-connection:' + id, binding);
                sessions.entries.push({ sid: request.sid, exp: record.exp }); connections.ids.push(id); descriptors.push(binding);
            }
            await tx.put(SESSION_INDEX, sessions); await tx.put(CONNECTION_INDEX, connections);
        });
        const before = fingerprint(f.driver);
        f.driver.resetOperations();
        const expected = await individualCohortIdentities(f.authority, descriptors), singleReads = f.driver.stats.operations.length;
        const transactions = f.driver.stats.transactions; f.driver.resetOperations();
        const result = await f.authority.resolveParticipationConnections(descriptors), events = [...f.driver.stats.operations];
        expect(result).toEqual(expected); expect(result).toHaveLength(200); expect(result.every(Boolean)).toBe(true);
        expect(f.driver.stats.transactions - transactions).toBe(1);
        expect(events.length).toBeLessThanOrEqual(4096); expect(events.length).toBeLessThan(singleReads / 2);
        expect(events.every(event => ['get', 'list'].includes(event.name))).toBe(true);
        const physical = f.driver.rows(), size = value => value === undefined ? 0 : value instanceof Uint8Array
            ? value.byteLength : new TextEncoder().encode(JSON.stringify(value)).byteLength;
        const readBytes = events.reduce((sum, event) => {
            if (event.name === 'get') return sum + size(physical.get(event.key));
            const rows = [...physical].filter(([key]) => key.startsWith(event.value.prefix)
                && (!event.value.startAfter || key > event.value.startAfter)).slice(0, event.value.limit);
            return sum + rows.reduce((bytes, [, value]) => bytes + size(value), 0);
        }, 0);
        expect(readBytes).toBeLessThanOrEqual(32 * 1024 * 1024); expect(fingerprint(f.driver)).toBe(before);
        await expect(f.authority.resolveParticipationConnections([...descriptors, descriptors[0]])).rejects.toThrow();
    });
});

describe('actor-only control preparation on the actual SQLite authority', () => {
    const partitionPrefix = 'participation-records:v1:record:';
    const controlsFor = (f, app) => {
        const grants = new WeakMap(), socket = {};
        const budget = createTransportControlBudget({ now: f.now,
            available: id => app.engine.transportControlReady(id), reserve: id => app.engine.reserveTransportControl(id),
            readState: ws => grants.get(ws), writeState: (ws, value) => grants.set(ws, clone(value)) });
        return { budget, grants, socket };
    };
    const admit = async (f, ledger, app, id, nick) => {
        const person = await f.enroll(id); await ledger.grant(person.binding);
        expect((await app.engine.connect(person.binding)).ok).toBe(true);
        expect((await app.message(id, { t: 'hello', nick, age13: true }))?.ok).not.toBe(false);
        return person;
    };

    it('keeps real reservation reads independent of unrelated admitted peers and still prepays 21 controls in two blocks', async () => {
        const f = await fixture({ participation: true }), ledger = await participationLedger(f);
        const app = f.makeEngine({ participation: productionParticipation(f) });
        const actor = await admit(f, ledger, app, 'credit-actor', 'ControlActor');
        f.driver.resetOperations();
        expect(await app.engine.reserveTransportControl(actor.binding.id)).toMatchObject({ ok: true, controls: 20 });
        const soloReads = f.driver.stats.operations.filter(event => ['get', 'list'].includes(event.name)).length;
        const peers = [];
        for (let i = 0; i < 3; i++) peers.push(await admit(f, ledger, app, `credit-peer${i}`, `ControlPeer${i}`));
        const records = await f.authority.records.transaction(tx => tx.list({ prefix: partitionPrefix, limit: 4 }));
        const peerKeys = peers.flatMap(peer => ['authority-session:' + peer.request.sid, 'authority-connection:' + peer.binding.id,
            [...records].find(([, state]) => state.subjects[0].record.principalRef === `s_${peer.request.sid}`)[0]]);
        const requests = app.engine.snapshot().budget.requests;
        f.driver.resetOperations();
        expect(await app.engine.reserveTransportControl(actor.binding.id)).toMatchObject({ ok: true, controls: 20 });
        const events = [...f.driver.stats.operations], wideReads = events.filter(event => ['get', 'list'].includes(event.name)).length;
        expect(soloReads).toBeGreaterThan(0); expect(wideReads).toBeLessThanOrEqual(soloReads);
        expect(events.some(event => logicalKey(event) === 'net')).toBe(true);
        for (const key of peerKeys) {
            const encoded = ':' + Buffer.from(key, 'ascii').toString('hex');
            expect(events.some(event => typeof event.key === 'string' && event.key.includes(encoded))).toBe(false);
        }
        expect(app.engine.snapshot().budget.requests).toBe(requests + 1);
        expect((await f.authority.records.transaction(tx => tx.get('net'))).budget.requests).toBe(requests + 1);
        const { budget, grants, socket } = controlsFor(f, app), prepaidAt = app.engine.snapshot().budget.requests;
        for (let i = 0; i < 21; i++) expect(await budget.take(socket, actor.binding.id)).toBe(true);
        expect(budget.snapshot()).toEqual({ reservations: 2, prepaidControls: 40, consumedControls: 21, refused: 0 });
        expect(grants.get(socket)).toEqual({ v: 1, day: new Date(f.now()).toISOString().slice(0, 10), remaining: 19 });
        expect(app.engine.snapshot().budget.requests).toBe(prepaidAt + 2);
        expect((await f.authority.records.transaction(tx => tx.get('net'))).budget.requests).toBe(prepaidAt + 2);
        expect(app.persist).not.toHaveBeenCalled();
    });

    it('does not mint missing-actor credit or turn a withdrawn actor control into a new sharing grant', async () => {
        const f = await fixture({ participation: true }), ledger = await participationLedger(f);
        const app = f.makeEngine({ participation: productionParticipation(f) });
        const actor = await admit(f, ledger, app, 'credit-withdrawn', 'ControlWithdrawn');
        const beforeMissing = app.engine.snapshot().budget.requests;
        expect((await app.engine.reserveTransportControl('missing-actor')).ok).toBe(false);
        expect(app.engine.snapshot().budget.requests).toBe(beforeMissing);
        expect((await ledger.withdraw(actor.binding)).state).toBe('withdrawn');
        expect((await app.engine.refreshParticipation())?.ok).not.toBe(false);
        const before = await f.authority.records.transaction(tx => tx.list({ prefix: partitionPrefix, limit: 4 }));
        const { budget, socket } = controlsFor(f, app);
        expect(await budget.take(socket, actor.binding.id)).toBe(true);
        expect(budget.snapshot()).toEqual({ reservations: 1, prepaidControls: 20, consumedControls: 1, refused: 0 });
        expect(await f.authority.validate(actor.binding)).toBe(true);
        expect(app.engine._debug.conns.get(actor.binding.id).safetyOnly).toBe(true);
        app.frames.length = 0;
        await app.message(actor.binding.id, { t: 'say', ch: '#stalemate', text: 'Control credit must not restore sharing' });
        expect(app.frames.some(frame => frame.t === 'line')).toBe(false);
        expect(await f.authority.records.transaction(tx => tx.list({ prefix: partitionPrefix, limit: 4 }))).toEqual(before);
    });

    it('keeps the actual peer purpose check on PM commands after a successful actor-only reservation', async () => {
        const f = await fixture({ participation: true }), ledger = await participationLedger(f);
        const app = f.makeEngine({ participation: productionParticipation(f) });
        const actor = await admit(f, ledger, app, 'credit-pmactor', 'ControlPmActor');
        const peer = await admit(f, ledger, app, 'credit-pmpeer', 'ControlPmPeer');
        expect((await app.engine.reserveTransportControl(actor.binding.id)).ok).toBe(true);
        await app.message(actor.binding.id, { t: 'cmd', ch: '#stalemate', name: 'query', args: ['ControlPmPeer'] });
        expect(app.frames.some(frame => frame.t === 'pm-request' && frame.recipient === peer.binding.id)).toBe(true);
        expect((await ledger.withdraw(peer.binding)).state).toBe('withdrawn');
        expect((await app.engine.reserveTransportControl(actor.binding.id)).ok).toBe(true);
        app.frames.length = 0;
        expect((await app.message(actor.binding.id, { t: 'cmd', ch: '#stalemate', name: 'query', args: ['ControlPmPeer'] })).ok).toBe(false);
        expect(app.frames.some(frame => ['pm-request', 'pm-open', 'pm-line'].includes(frame.t))).toBe(false);
        expect(await f.authority.validate(peer.binding)).toBe(true);
    });

    it.each(['revocation', 'session expiry', 'profile expiry', 'role removal'].flatMap(change =>
        ['before', 'after'].map(phase => [change, phase])))('keeps control credit unminted when %s occurs %s the actual effect write', async (change, phase) => {
        const f = await fixture({ participation: true }), ledger = await participationLedger(f);
        let actor;
        if (change === 'session expiry') {
            const request = f.registration('credit-fenced', { exp: NOW + 1000 });
            expect((await f.authority.register(request)).status).toBe(200);
            const binding = { id: 'credit-fenced', betaSid: request.sid, betaInviteVersion: request.version, dev: 'device_credit-fenced', iph: request.iph,
                account: '', role: 'fan', admin: false, expiresAt: request.exp, authorityRef: 'credit-fenced', authorityRevision: 1 };
            expect(await f.authority.bind(binding)).toEqual(binding); actor = { request, binding };
        } else actor = await f.enroll('credit-fenced', { kind: 'staff', account: await accountId('reviewer@example.invalid', f.env.HANGOUT_HMAC_KEY),
            role: 'moderator', admin: true, expiresAt: NOW + (change === 'profile expiry' ? 1000 : 90000) });
        await ledger.grant(actor.binding);
        let armed = false, reached = false, physicalAfterRollback;
        const mutate = async tx => {
            reached = true;
            if (change.endsWith('expiry')) f.advance(1001);
            else if (change === 'role removal') f.env.HANGOUT_MODERATOR_EMAILS = '';
            else if (tx) {
                const key = 'authority-session:' + actor.request.sid, row = await tx.get(key);
                await tx.put(key, { ...row, revoked: true });
            } else await f.authority.revoke(actor.request);
        };
        const fence = { prepare: (...args) => f.authority.effectCommit.prepare(...args), commit: async (...args) => {
            if (phase === 'before' && armed && !args[2]?.costsOnly) { armed = false; await mutate(); }
            return f.authority.effectCommit.commit(...args);
        } };
        const app = f.makeEngine({ participation: productionParticipation(f), effectCommit: fence });
        expect((await app.engine.connect(actor.binding)).ok).toBe(true);
        await app.message(actor.binding.id, { t: 'hello', nick: 'ControlFenced', age13: true });
        const healthy = await admit(f, ledger, app, 'credit-healthy', 'ControlHealthy');
        const original = fingerprint(f.driver), rollbacks = f.driver.stats.rollbacks;
        f.controls.afterEffects = async ({ tx, effects, costsOnly }) => {
            if (phase !== 'after' || !armed || costsOnly) return;
            armed = false; expect(effects.some(([kind]) => kind === 'net')).toBe(true); await mutate(tx);
        };
        if (phase === 'after') f.hooks.before = () => {
            // Observe native rollback before the permitted conservative-cost
            // recovery write. This injected revocation is not an external commit.
            if (physicalAfterRollback === undefined && f.driver.stats.rollbacks > rollbacks) physicalAfterRollback = fingerprint(f.driver);
        };
        const { budget, grants, socket } = controlsFor(f, app); armed = true;
        expect(await budget.take(socket, actor.binding.id)).toBe(false);
        expect(reached).toBe(true); expect(grants.has(socket)).toBe(false);
        expect(budget.snapshot()).toEqual({ reservations: 0, prepaidControls: 0, consumedControls: 0, refused: 1 });
        if (phase === 'after') expect(physicalAfterRollback).toBe(original);
        if (change === 'revocation') {
            const saved = await f.authority.records.transaction(tx => tx.get('authority-session:' + actor.request.sid));
            expect(saved.revoked).toBe(phase === 'before');
        }
        delete f.hooks.before; delete f.controls.afterEffects;
        expect(await f.authority.validate(healthy.binding)).toBe(true);
        expect((await app.engine.reserveTransportControl(healthy.binding.id)).ok).toBe(true);
        expect(app.persist).not.toHaveBeenCalled();
    });
});
