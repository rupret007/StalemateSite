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
import { accountId } from '../../hangout-worker/src/auth.mjs';
import { createParticipationEnforcement } from '../../hangout-worker/src/participation-enforcement.mjs';
import { writeLobbyEffects } from '../../hangout-worker/src/lobby-effect-records.mjs';
import { initializeLobbySessionAuthority, migrateLobbySessionAuthority, createLobbySessionAuthority,
    LOBBY_AUTHORITY_MARKER } from '../../hangout-worker/src/lobby-session-authority.mjs';

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
async function fixture({ initialize = true } = {}) {
    let at = NOW;
    const directory = await mkdtemp(join(tmpdir(), 'lobby-session-authority-')), filename = join(directory, 'authority.sqlite'), hooks = {}, controls = {};
    const driver = openDurableRecordSqlite(filename, hooks), cleanup = { directory, drivers: [driver] }; cleanups.push(cleanup);
    const wrap = disk => ({ transaction: operation => disk.transaction(raw => operation({ ...raw,
        getAlarm: () => raw.get(ALARM), setAlarm: value => raw.put(ALARM, value), deleteAlarm: () => raw.delete(ALARM) })) });
    const storage = wrap(driver), state = freshState();
    const env = { HANGOUT_SESSION_AUTHORITY: 'lobby-v1', HANGOUT_BETA_MODE: 'protected', HANGOUT_BETA_INVITE_VERSION: '1',
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
