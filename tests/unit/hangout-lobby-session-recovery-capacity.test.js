// @vitest-environment node
// Actual disk SQLite, real register/bind APIs and actual accepted engine state.
// The test caller serializes the WHOLE load, including any bounded native read
// phases. This models the required owner-held Lobby event gate, not a distributed
// snapshot or hosted-capacity qualification. Alarm storage uses one SQL key.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { openDurableRecordSqlite } from '../support/durable-record-sqlite.mjs';
import { createLobby } from '../../hangout-worker/src/lobby-core.mjs';
import { accountId } from '../../hangout-worker/src/auth.mjs';
import { writeLobbyEffects } from '../../hangout-worker/src/lobby-effect-records.mjs';
import { initializeLobbySessionAuthority, createLobbySessionAuthority } from '../../hangout-worker/src/lobby-session-authority.mjs';

const NOW = 1800000000000, ALARM = '__test_capacity_alarm__', clone = value => structuredClone(value);
const size = value => value === undefined ? 0 : value instanceof Uint8Array ? value.byteLength : Buffer.byteLength(JSON.stringify(value));
const fingerprint = driver => createHash('sha256').update(JSON.stringify([...driver.rows()].map(([key, value]) =>
    [key, value instanceof Uint8Array ? Buffer.from(value).toString('base64') : value]))).digest('hex');
let f;
beforeAll(async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lobby-recovery-capacity-')), driver = openDurableRecordSqlite(join(directory, 'capacity.sqlite'));
    const metrics = [], issued = [], bound = new Set(); let gate = Promise.resolve();
    f = { directory, driver, metrics, issued, bound };
    const storage = { transaction: async operation => {
        const measured = { calls: 0, readBytes: 0, writeBytes: 0, committed: false };
        try {
            const result = await driver.transaction(raw => {
                const invoke = async (name, ...args) => {
                    measured.calls++;
                    if (name === 'put') measured.writeBytes += size(args[1]);
                    const value = await raw[name](...args);
                    if (name === 'get') measured.readBytes += size(value);
                    if (name === 'list') for (const row of value.values()) measured.readBytes += size(row);
                    return value;
                };
                const native = Object.fromEntries(['get', 'put', 'delete', 'list'].map(name => [name, (...args) => invoke(name, ...args)]));
                Object.assign(native, { getAlarm: () => invoke('get', ALARM), setAlarm: value => invoke('put', ALARM, value), deleteAlarm: () => invoke('delete', ALARM) });
                return operation(native);
            });
            measured.committed = true; return result;
        } finally { metrics.push(measured); }
    } };
    const env = { HANGOUT_SESSION_AUTHORITY: 'lobby-v1', HANGOUT_BETA_MODE: 'protected', HANGOUT_BETA_INVITE_VERSION: '1',
        HANGOUT_HMAC_KEY: 'synthetic-recovery-capacity-key-not-a-secret', HANGOUT_OWNER_EMAIL: 'owner@example.invalid' };
    const account = await accountId(env.HANGOUT_OWNER_EMAIL, env.HANGOUT_HMAC_KEY), engine = createLobby({ now: () => NOW });
    const snapshot = () => clone({ net: engine.snapshot(), rooms: engine.roomSnapshot(), abuse: engine.abuseSnapshot(), sessions: engine.sessionSnapshot(),
        moderationQueue: { reports: [], held: [] }, aiReviews: [], modlog: engine.modlog });
    await initializeLobbySessionAuthority({ storage, env, state: snapshot(), now: NOW });
    const authority = createLobbySessionAuthority({ storage, env, now: () => NOW });
    const callerGate = operation => { const task = gate.then(operation); gate = task.catch(() => {}); return task; };
    Object.assign(f, { storage, env, engine, authority, snapshot, callerGate, account });
});
// Keep actual issuance in bounded setup phases under the existing hook timeout;
// the dataset and each native authority transaction remain unchanged.
for (const offset of [0, 250, 500, 750]) beforeAll(async () => {
    const { authority, account, issued } = f;
    for (let n = offset; n < offset + 250; n++) {
        const id = `capacity_${String(n).padStart(4, '0')}`, sid = `capacity-session-${String(n).padStart(4, '0')}`;
        const profile = n < 50 ? { kind: 'staff', account, role: 'owner', admin: true, expiresAt: NOW + 1000000 } : null;
        const iph = `capacity-ip-${String(n).padStart(10, '0')}`;
        expect((await authority.register({ sid, version: '1', exp: NOW + 1000000, iph, profile })).status).toBe(200);
        issued.push({ id, betaSid: sid, betaInviteVersion: '1', dev: `device_${n}`, iph, account: profile?.account || '',
            role: profile?.role || 'fan', admin: !!profile, expiresAt: NOW + 1000000, authorityRef: id, authorityRevision: 1 });
    }
});
beforeAll(async () => {
    const { authority, engine, issued, bound, snapshot } = f;
    const accept = async n => {
        const binding = issued[n]; expect(await authority.bind(binding)).toEqual(binding); bound.add(n);
        expect(await engine.connect(binding)).toEqual({ ok: true });
        await engine.message(binding.id, JSON.stringify({ t: 'hello', nick: `CapacityUser${n}`, age13: true }));
        expect(engine._debug.conns.get(binding.id).nick).toBe(`CapacityUser${n}`);
    };
    await accept(0);
    // Produce the actual engine's full retained moderation log before fan-out
    // grows. No manually invented log or session records enter the fixture.
    for (let n = 0; n < 2000; n++) await engine.message(issued[0].id, JSON.stringify({ t: 'cmd', ch: '#stalemate', name: 'lobby', args: ['unlock'] }));
    await engine.message(issued[0].id, JSON.stringify({ t: 'cmd', ch: '#stalemate', name: 'join', args: ['#art-capacity'] }));
    await engine.message(issued[0].id, JSON.stringify({ t: 'cmd', ch: '#art-capacity', name: 'register', args: [] }));
    const pts = Array.from({ length: 400 }, (_, n) => [(n % 100) / 100, ((n + 1) % 100) / 100]);
    for (let n = 0; n < 24; n++) await engine.message(issued[0].id, JSON.stringify({ t: 'act', kind: 'stroke', ch: '#art-capacity',
        stroke: { id: `capacity-stroke-${n}`, color: '#009ee8', size: 8, pts } }));
    for (let n = 50; n < 199; n++) await accept(n);
    const persistSnapshot = async (withLogs = false) => {
        const state = snapshot();
        await authority.records.transaction(tx => writeLobbyEffects({ tx, now: NOW, effects: [['net', state.net], ['rooms', state.rooms], ['abuse', state.abuse],
            ['sessions', state.sessions], ['moderation-queue', state.moderationQueue], ['ai-reviews', state.aiReviews]] }));
        if (withLogs) for (let offset = 0; offset < state.modlog.length; offset += 100) {
            await authority.records.transaction(tx => writeLobbyEffects({ tx, now: NOW, effects: state.modlog.slice(offset, offset + 100).map(entry => ['modlog', entry]) }));
        }
    };
    Object.assign(f, { accept, persistSnapshot }); await persistSnapshot(true);
});
afterAll(async () => { if (f) { await f.driver.close(); await rm(f.directory, { recursive: true, force: true }); } });

describe('bounded recovery of the existing maximum session and connection allowances', () => {
    const verify = async count => {
        const expected = f.snapshot(); expect(expected.sessions.connections).toHaveLength(count); expect(expected.modlog).toHaveLength(2000);
        expect(expected.rooms.rooms[0].act.strokes).toHaveLength(24); expect(Buffer.byteLength(JSON.stringify(expected.rooms.rooms[0]))).toBeGreaterThan(65536);
        const before = fingerprint(f.driver), first = f.metrics.length;
        const loaded = await f.callerGate(() => f.authority.load());
        expect(loaded.state).toEqual(expected); expect(loaded.bindings).toHaveLength(count); expect(loaded.bindings.every(value => value.active)).toBe(true);
        expect(fingerprint(f.driver)).toBe(before);
        const measurements = f.metrics.slice(first); expect(measurements.length).toBeGreaterThan(0);
        for (const measurement of measurements) {
            expect(measurement.committed).toBe(true); expect(measurement.calls).toBeLessThanOrEqual(4096);
            expect(measurement.readBytes).toBeLessThanOrEqual(32 * 1024 * 1024); expect(measurement.writeBytes).toBe(0);
        }
        console.log(JSON.stringify({ sessions: f.issued.length, bindings: count, transactions: measurements.length,
            maxPhysicalCalls: Math.max(...measurements.map(value => value.calls)), maxReadBytes: Math.max(...measurements.map(value => value.readBytes)),
            maxWriteBytes: Math.max(...measurements.map(value => value.writeBytes)), totalCalls: measurements.reduce((total, value) => total + value.calls, 0) }));
    };
    it('restores 1000 real issued sessions, 150 admitted connections, 2000 actual log entries and a multi-chunk canvas', async () => {
        expect(f.bound.size).toBe(150); await verify(150);
    });
    it('restores the same 1000 issued sessions with the full 200 admitted connections within every native transaction budget', async () => {
        await f.accept(199); for (let n = 1; n < 50; n++) await f.accept(n); await f.persistSnapshot();
        expect(f.bound.size).toBe(200); await verify(200);
    });
});
