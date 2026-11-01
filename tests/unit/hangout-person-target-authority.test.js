// @vitest-environment node
// Independent selected-person fences on the real authority/codec/effect writer
// and disk SQLite. Only the operator/guardian decisions below are synthetic.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { openDurableRecordSqlite } from '../support/durable-record-sqlite.mjs';
import { createLobby } from '../../hangout-worker/src/lobby-core.mjs';
import { accountId } from '../../hangout-worker/src/auth.mjs';
import { writeLobbyEffects, personRoomProjection } from '../../hangout-worker/src/lobby-effect-records.mjs';
import { initializeLobbySessionAuthority, createLobbySessionAuthority, LOBBY_AUTHORITY_COMMUNITY } from '../../hangout-worker/src/lobby-session-authority.mjs';
import { createLobbyParticipation } from '../../hangout-worker/src/lobby-participation.mjs';
import { createPartitionedParticipationConsents } from '../../hangout-worker/src/participation-partitions.mjs';
import { PARTICIPATION_PURPOSES } from '../../hangout-worker/src/participation-policy.mjs';

const NOW = 1800000000000, ALARM = '__person_test_native_alarm__', cleanups = [];
const clone = value => structuredClone(value);
const hashRows = driver => createHash('sha256').update(JSON.stringify([...driver.rows()].map(([key, value]) =>
    [key, value instanceof Uint8Array ? Buffer.from(value).toString('base64') : value]))).digest('hex');
afterEach(async () => { for (const { directory, driver } of cleanups.splice(0)) {
    await driver.close(); await rm(directory, { recursive: true, force: true });
} });

async function fixture({ participation = false } = {}) {
    let at = NOW;
    const directory = await mkdtemp(join(tmpdir(), 'person-authority-')), hooks = {}, controls = {};
    const driver = openDurableRecordSqlite(join(directory, 'state.sqlite'), hooks);
    cleanups.push({ directory, driver });
    const storage = { transaction: operation => driver.transaction(raw => operation({ ...raw,
        getAlarm: () => raw.get(ALARM), setAlarm: value => raw.put(ALARM, value), deleteAlarm: () => raw.delete(ALARM) })) };
    const initial = createLobby({ now: () => at });
    const state = clone({ net: initial.snapshot(), rooms: initial.roomSnapshot(), abuse: initial.abuseSnapshot(),
        sessions: initial.sessionSnapshot(), moderationQueue: { reports: [], held: [] }, aiReviews: [], modlog: [] });
    const env = { HANGOUT_SESSION_AUTHORITY: 'lobby-v1', HANGOUT_BETA_MODE: 'protected', HANGOUT_BETA_INVITE_VERSION: '1',
        HANGOUT_HMAC_KEY: 'synthetic-person-test-key-not-a-secret', HANGOUT_OWNER_EMAIL: 'owner@example.invalid',
        HANGOUT_MODERATOR_EMAILS: 'reviewer@example.invalid', ...(participation ? { HANGOUT_PARTICIPATION_AUTHORITY: 'c3-v1' } : {}) };
    await initializeLobbySessionAuthority({ storage, env, state, now: at });
    const authority = createLobbySessionAuthority({ storage, env, now: () => at,
        writeEffects: async input => { await writeLobbyEffects(input); await controls.afterEffects?.(input); } });
    const staff = async (email, role, expiresAt = NOW + 90000) => ({ kind: 'staff', account: await accountId(email, env.HANGOUT_HMAC_KEY), role, admin: true, expiresAt });
    const enroll = async (id, profile = null, sessionMs = 100000) => {
        const request = { sid: `person-session-${id}`, version: '1', exp: at + sessionMs, iph: `mint_${id.padEnd(17, 'x')}`.slice(0, 22),
            profile: profile && { ...profile, expiresAt: Math.min(profile.expiresAt, at + sessionMs) } };
        expect((await authority.register(request)).status).toBe(200);
        const binding = { id, betaSid: request.sid, betaInviteVersion: '1', dev: `device_${id}`, iph: request.iph,
            account: request.profile?.account || '', role: request.profile?.role || 'fan', admin: request.profile?.admin || false,
            expiresAt: Math.min(request.exp, request.profile?.expiresAt || request.exp), authorityRef: id, authorityRevision: 1 };
        expect(await authority.bind(binding)).toEqual(binding); return { request, binding };
    };
    const makeEngine = (extra = {}) => {
        const frames = [], persist = vi.fn(), engine = createLobby({ now: () => at, effectCommit: authority.effectCommit,
            send: (recipient, frame) => frames.push({ recipient, ...clone(frame) }), persist,
            limits: { defaultSlow: 0, pmMinLobbyMs: 0 }, ...extra });
        return { engine, frames, persist, message: (id, frame) => engine.message(id, JSON.stringify(frame)) };
    };
    return { driver, hooks, controls, storage, state, env, authority, staff, enroll, makeEngine,
        now: () => at, advance: milliseconds => { at += milliseconds; } };
}
async function admit(app, person, nick) {
    expect((await app.engine.connect(person.binding)).ok).toBe(true);
    await app.message(person.binding.id, { t: 'hello', nick, age13: true });
    expect(app.frames.some(frame => frame.recipient === person.binding.id && frame.t === 'welcome' && frame.nick === nick)).toBe(true);
}
const personFrame = (peer, room, name, args = []) => ({ t: 'cmd', ch: room.name, roomInstance: room.keepRef,
    personContext: 1, personPeer: peer.binding.id, name, args });
async function roomFixture() {
    const f = await fixture(), actor = await f.enroll('room-actor'), target = await f.enroll('room-target'), app = f.makeEngine();
    await admit(app, actor, 'RoomActor'); await admit(app, target, 'RoomTarget');
    await app.message(actor.binding.id, { t: 'cmd', name: 'join', ch: '#stalemate', args: ['#chat-person-fence'] });
    await app.message(target.binding.id, { t: 'cmd', name: 'join', ch: '#stalemate', args: ['#chat-person-fence'] });
    const room = app.engine.roomSnapshot().rooms.find(row => row.name === '#chat-person-fence');
    expect(room.ops).toContain(actor.binding.dev); expect(room.keepRef).toMatch(/^[a-f0-9]{32}$/);
    return { f, actor, target, app, room };
}

const identityChanges = ['revocation', 'session expiry', 'profile change', 'profile expiry', 'role removal', 'SID rebind', 'SID generation'];
describe('actual authority selected-person identity checks on both sides of native writes', () => {
    it.each(['actor', 'peer'].flatMap(party => identityChanges.flatMap(change => ['before', 'after'].map(phase => [party, change, phase]))))(
        'refuses %s %s %s the real write without committing the selected effect', async (party, change, phase) => {
            const f = await fixture();
            const actor = await f.enroll('race-actor', await f.staff('owner@example.invalid', 'owner'), party === 'actor' && change === 'session expiry' ? 1000 : 100000);
            const peer = await f.enroll('race-peer', await f.staff('reviewer@example.invalid', 'moderator'), party === 'peer' && change === 'session expiry' ? 1000 : 100000);
            const selected = party === 'actor' ? actor : peer;
            const alternate = change === 'SID rebind' ? await f.enroll('race-spare', clone(selected.request.profile)) : null;
            const context = await f.authority.effectCommit.prepare({ kind: 'message', actorId: actor.binding.id, connections: [actor.binding, peer.binding] });
            let crossed = false, writtenTx;
            const mutate = async tx => {
                crossed = true;
                if (change === 'session expiry') { f.advance(1001); return; }
                if (change === 'role removal') {
                    if (party === 'actor') f.env.HANGOUT_OWNER_EMAIL = ''; else f.env.HANGOUT_MODERATOR_EMAILS = '';
                    return;
                }
                const apply = async records => {
                    if (change === 'SID rebind') {
                        const key = `authority-connection:${selected.binding.id}`, row = await records.get(key);
                        await records.put(key, { ...row, betaSid: alternate.request.sid }); return;
                    }
                    const key = `authority-session:${selected.request.sid}`, row = await records.get(key);
                    if (change === 'revocation') await records.put(key, { ...row, revoked: true, pending: true, attempt: 1,
                        retryAt: f.now() + 1000, closureRevision: row.closureRevision + 1 });
                    if (change === 'SID generation') await records.put(key, { ...row, generation: row.generation + 1 });
                    if (change === 'profile change') await records.put(key, { ...row, profile: { ...row.profile, kind: 'owner', role: 'fan', admin: false } });
                    if (change === 'profile expiry') {
                        // A changed current profile expires while the original transport descriptor remains long-lived.
                        await records.put(key, { ...row, profile: { ...row.profile, expiresAt: NOW + 1 } }); f.advance(2);
                    }
                };
                if (tx) await apply(tx); else await f.authority.records.transaction(apply);
            };
            if (phase === 'before') await mutate();
            const before = hashRows(f.driver), transactions = f.driver.stats.transactions, rollbacks = f.driver.stats.rollbacks;
            f.controls.afterEffects = async ({ tx, effects, costsOnly }) => {
                expect(costsOnly).toBe(false); expect(effects.map(([kind]) => kind)).toEqual(['net']); writtenTx = tx;
                if (phase === 'after') await mutate(tx);
            };
            const next = clone(f.state.net); next.shield = true;
            const result = await f.authority.effectCommit.commit(context, [['net', next]], { personDependencies: { peerIds: [peer.binding.id] } });
            expect(result.ok).toBe(false); if (party === 'peer') expect(result.reason).toBe('person-target-stale');
            expect(crossed).toBe(true); expect(f.driver.stats.transactions - transactions).toBe(1);
            expect(f.driver.stats.rollbacks - rollbacks).toBe(1); expect(hashRows(f.driver)).toBe(before);
            expect(writtenTx !== undefined).toBe(phase === 'after');
            delete f.controls.afterEffects;
            expect((await f.authority.records.transaction(tx => tx.get('net'))).shield).toBe(false);
            // The before-write generation fault deliberately remains committed: the
            // session no longer agrees with the authority marker, so cold recovery
            // must refuse it even though the selected effect was rolled back.
            if (change === 'SID generation' && phase === 'before') await expect(f.authority.load()).rejects.toThrow('lobby-authority-unavailable');
            else expect((await f.authority.load()).state.net.shield).toBe(false);
        });

    it('keeps a selected binding with malformed stored shape a real storage failure', async () => {
        const f = await fixture(), actor = await f.enroll('valid-actor'), peer = await f.enroll('bad-peer');
        const context = await f.authority.effectCommit.prepare({ kind: 'message', actorId: actor.binding.id, connections: [actor.binding, peer.binding] });
        await f.authority.records.transaction(async tx => {
            const key = `authority-connection:${peer.binding.id}`, row = await tx.get(key);
            await tx.put(key, { ...row, authorityRevision: 2 }); // Existing validator allows only 1: deliberately corrupt, not stale.
        });
        const before = hashRows(f.driver);
        expect(await f.authority.effectCommit.commit(context, [['net', f.state.net]], { personDependencies: { peerIds: [peer.binding.id] } }))
            .toEqual({ ok: false, reason: 'session-unavailable' });
        expect(hashRows(f.driver)).toBe(before);
    });
});

async function changeRoom(tx, room, change) {
    const key = `community-room:${room.name}`, row = await tx.get(key);
    if (change === 'deletion') {
        const index = await tx.get('room-index'); await tx.delete(key);
        await tx.put('room-index', { ...index, names: index.names.filter(name => name !== room.name) }); return;
    }
    if (change === 'recreation') {
        row.keepRef = row.keepRef === 'c'.repeat(32) ? 'd'.repeat(32) : 'c'.repeat(32);
        row.founder = 'replacement_founder'; row.ops = ['replacement_founder']; row.opAccounts = []; row.voice = [];
        row.owner = ''; row.cohosts = []; row.cohostLabels = {}; row.act = { strokes: [], video: null };
    }
    if (change === 'keepRef') row.keepRef = row.keepRef === 'a'.repeat(32) ? 'b'.repeat(32) : 'a'.repeat(32);
    if (change === 'owner') row.owner = 'a_' + 'o'.repeat(43);
    if (change === 'ops') { row.ops = []; row.opAccounts = []; }
    if (change === 'opAccounts') row.opAccounts = [[room.ops[0], 'a_' + 'p'.repeat(43)]];
    if (change === 'cohosts') { const id = 'a_' + 'c'.repeat(43); row.cohosts = [id]; row.cohostLabels = { [id]: 'Changed cohost' }; }
    if (change === 'voice') row.voice = [];
    if (change === 'modes') row.modes.Q = true;
    await tx.put(key, row);
}
describe('actual selected original room and command-relevant permission projections', () => {
    it.each(['deletion', 'recreation', 'keepRef', 'owner', 'ops', 'opAccounts', 'cohosts'].flatMap(change => ['before', 'after'].map(phase => [change, phase])))(
        'refuses original-room %s %s the native effect write', async (change, phase) => {
            const { f, actor, target, room } = await roomFixture();
            const context = await f.authority.effectCommit.prepare({ kind: 'message', actorId: actor.binding.id, connections: [actor.binding, target.binding] });
            const permission = personRoomProjection(room), dependency = { peerIds: [target.binding.id], room: {
                name: room.name, keepRef: room.keepRef, before: clone(permission), after: clone(permission) } };
            if (phase === 'before') await f.authority.records.transaction(tx => changeRoom(tx, room, change));
            const before = hashRows(f.driver), transactions = f.driver.stats.transactions; let wrote = false;
            f.controls.afterEffects = async ({ tx, costsOnly }) => {
                expect(costsOnly).toBe(false); wrote = true;
                if (phase === 'after') await changeRoom(tx, room, change);
            };
            const next = clone(f.state.net); next.shield = true;
            const result = await f.authority.effectCommit.commit(context, [['net', next]], { personDependencies: dependency });
            expect(result).toEqual({ ok: false, reason: 'person-target-stale' });
            expect(f.driver.stats.transactions - transactions).toBe(1); expect(wrote).toBe(phase === 'after');
            expect(hashRows(f.driver)).toBe(before);
        });

    it('commits a real authorized Kick although the target is no longer a member after the write', async () => {
        const { f, actor, target, app, room } = await roomFixture(); app.frames.length = 0;
        await app.message(actor.binding.id, personFrame(target, room, 'kick', ['RoomTarget', 'test reason']));
        expect(app.frames.some(frame => frame.recipient === target.binding.id && frame.t === 'kicked' && frame.ch === room.name)).toBe(true);
        expect(app.engine._debug.conns.get(target.binding.id).channels.has(room.name)).toBe(false);
        expect(await f.authority.validate(target.binding)).toBe(true);
        const loaded = await f.authority.load();
        expect(loaded.state.sessions.connections.find(person => person.id === target.binding.id).channels).not.toContain(room.name);
        expect(app.persist).not.toHaveBeenCalled();
    });

    it('rolls back a normal selected-peer revocation refusal without quarantining an unrelated healthy actor command', async () => {
        const { f, actor, target, app, room } = await roomFixture(); let armed = true;
        const actualCommit = f.authority.effectCommit.commit;
        const fence = { prepare: (...args) => f.authority.effectCommit.prepare(...args), commit: async (...args) => {
            if (armed && !args[2]?.costsOnly && args[2]?.personDependencies?.peerIds.includes(target.binding.id)) {
                armed = false; await f.authority.revoke(target.request);
            }
            return actualCommit(...args);
        } };
        // Restore the real current session/room state into a second real engine using the same authority.
        const restored = f.makeEngine({ effectCommit: fence });
        await restored.engine.restoreRooms(app.engine.roomSnapshot());
        const resumed = restored.engine.restoreSessions(app.engine.sessionSnapshot(), [actor.binding, target.binding]);
        expect(resumed.rejected).toEqual([]); expect(resumed.resumed).toHaveLength(2);
        restored.frames.length = 0;
        expect(await restored.message(actor.binding.id, personFrame(target, room, 'kick', ['RoomTarget', 'test reason'])))
            .toMatchObject({ ok: false, reason: 'person-target-stale' });
        expect(armed).toBe(false); expect(restored.frames.some(frame => frame.t === 'kicked')).toBe(false);
        expect(restored.engine._debug.conns.get(target.binding.id).channels.has(room.name)).toBe(true);
        expect(restored.engine.snapshot()).toMatchObject({ lock: 'off', lockAuto: false });
        await restored.message(actor.binding.id, { t: 'cmd', ch: room.name, name: 'topic', args: ['Healthy actor still controls this room'] });
        expect(restored.engine.roomSnapshot().rooms.find(row => row.name === room.name).topic).toBe('Healthy actor still controls this room');
        expect((await f.authority.load()).state.rooms.rooms.find(row => row.name === room.name).topic).toBe('Healthy actor still controls this room');
        expect(restored.frames.some(frame => frame.t === 'denied' || frame.t === 'kicked')).toBe(false);
        expect(restored.persist).not.toHaveBeenCalled();
    });

    it.each(['before', 'after'])('withholds an actual Kick when the target becomes protected staff %s the native write', async phase => {
        const { f, actor, target, app, room } = await roomFixture();
        const profile = await f.staff('reviewer@example.invalid', 'moderator', target.request.exp);
        const promote = async tx => {
            const sidKey = `authority-session:${target.request.sid}`, sid = await tx.get(sidKey);
            const bindingKey = `authority-connection:${target.binding.id}`, binding = await tx.get(bindingKey);
            await tx.put(sidKey, { ...sid, profile });
            await tx.put(bindingKey, { ...binding, account: profile.account, role: profile.role, admin: true });
        };
        let armed = false, reached = false;
        const fence = { prepare: (...args) => f.authority.effectCommit.prepare(...args), commit: async (...args) => {
            if (phase === 'before' && armed && !args[2]?.costsOnly) {
                armed = false; reached = true; await f.authority.records.transaction(promote);
            }
            return f.authority.effectCommit.commit(...args);
        } };
        const restored = f.makeEngine({ effectCommit: fence });
        await restored.engine.restoreRooms(app.engine.roomSnapshot());
        const resumed = restored.engine.restoreSessions(app.engine.sessionSnapshot(), [actor.binding, target.binding]);
        expect(resumed.rejected).toEqual([]);
        f.controls.afterEffects = async ({ tx, costsOnly }) => {
            if (phase === 'after' && armed && !costsOnly) { armed = false; reached = true; await promote(tx); }
        };
        // Arm only after setup/restore; the user action is the actual permission-sensitive boundary.
        armed = true; restored.frames.length = 0;
        expect(await restored.message(actor.binding.id, personFrame(target, room, 'kick', ['RoomTarget', 'test reason'])))
            .toMatchObject({ ok: false, reason: 'person-target-stale' });
        expect(reached).toBe(true); expect(restored.frames.some(frame => frame.t === 'kicked')).toBe(false);
        expect(restored.engine._debug.conns.get(target.binding.id).channels.has(room.name)).toBe(true);
        expect(restored.engine.snapshot()).toMatchObject({ lock: 'off', lockAuto: false });
        const saved = await f.authority.records.transaction(tx => tx.get(`authority-connection:${target.binding.id}`));
        expect(saved.role).toBe(phase === 'before' ? 'moderator' : 'fan');
    });

    it.each(['voice', 'modes'].flatMap(change => ['before', 'after'].map(phase => [change, phase])))(
        'withholds a bound public Slap when %s is restricted %s its actual publication write', async (change, phase) => {
            const f = await fixture(), actor = await f.enroll('speaker'), target = await f.enroll('operator');
            let armed = false, crossed = false, room;
            const alter = async tx => { crossed = true; await changeRoom(tx, room, change); };
            const fence = { prepare: (...args) => f.authority.effectCommit.prepare(...args), commit: async (...args) => {
                if (phase === 'before' && armed && !args[2]?.costsOnly) { armed = false; await f.authority.records.transaction(alter); }
                return f.authority.effectCommit.commit(...args);
            } };
            const app = f.makeEngine({ effectCommit: fence }); await admit(app, actor, 'Speaker'); await admit(app, target, 'Operator');
            await app.message(target.binding.id, { t: 'cmd', ch: '#stalemate', name: 'join', args: ['#chat-voice-fence'] });
            await app.message(actor.binding.id, { t: 'cmd', ch: '#stalemate', name: 'join', args: ['#chat-voice-fence'] });
            // Intentional named operator setup remains supported through actual typed commands.
            await app.message(target.binding.id, { t: 'say', ch: '#chat-voice-fence', text: '/voice Speaker' });
            await app.message(target.binding.id, { t: 'say', ch: '#chat-voice-fence', text: '/mode +m' });
            room = app.engine.roomSnapshot().rooms.find(row => row.name === '#chat-voice-fence');
            expect(room.voice).toContain(actor.binding.dev); expect(room.ops).not.toContain(actor.binding.dev); expect(room.modes.m).toBe(true);
            f.controls.afterEffects = async ({ tx, effects, costsOnly }) => {
                if (phase === 'after' && armed && !costsOnly) { armed = false; expect(effects.some(([kind]) => kind === 'sessions')).toBe(true); await alter(tx); }
            };
            app.frames.length = 0; armed = true;
            expect(await app.message(actor.binding.id, personFrame(target, room, 'slap', ['Operator'])))
                .toMatchObject({ ok: false, reason: 'person-target-stale' });
            expect(crossed).toBe(true); expect(app.frames.some(frame => frame.t === 'line' && frame.me)).toBe(false);
            expect(app.engine.snapshot()).toMatchObject({ lock: 'off', lockAuto: false });
        });
});

// Scoped synthetic decisions only: all principal resolution, grants, withdrawal,
// effect writes and final checks use the actual production ledger and authority.
async function consentFixture(f) {
    const participants = new Map(), decisions = new Map(), guardians = new Map();
    const config = { policy: { version: 1, policyVersion: 'person-fixture-v1', revision: 1,
        communityRef: LOBBY_AUTHORITY_COMMUNITY, noticeDigest: 'c'.repeat(64), decisionRef: 'fixture_operator_decision', state: 'qualified',
        purposes: [...PARTICIPATION_PURPOSES], issuedAt: NOW - 1, effectiveAt: NOW - 1, expiresAt: NOW + 900000, maxSessionMs: 60000 },
        rules: { version: 1, verifierRef: 'fixture_guardian_verifier', pendingMs: 10000, grantMs: 100000,
            subjectTailMs: 1000, guardianTailMs: 1000, receiptTailMs: 1000, callbackMs: 1000, operationMs: 10000 } };
    const make = storage => createPartitionedParticipationConsents({ storage, now: f.now,
        admitSubject: async ({ tx }) => { const n = await tx.get('person-fixture-allocation') || 0; if (n >= 4) return false; await tx.put('person-fixture-allocation', n + 1); return true; },
        adapters: {
            qualifyPolicy: async ({ proof }) => proof === 'person-fixture-operator' ? { config, expiresAt: f.now() + 1000 } : null,
            authenticateParticipant: async ({ proof, purpose }) => { const identity = participants.get(proof); if (!identity) return null;
                return purpose === 'begin' ? identity : Object.fromEntries(Object.entries(identity).filter(([key]) => key !== 'operationRef')); },
            verifyConsent: async ({ proof }) => decisions.get(proof) || null,
            authenticateGuardian: async ({ proof }) => guardians.get(proof) || null,
            authorizeMaintenance: async () => null
        } });
    const ledger = make(f.authority.records); expect((await ledger.installPolicy('person-fixture-operator')).ok).toBe(true);
    const readSubject = async person => {
        const identity = await f.authority.resolveParticipationConnection(person.binding);
        const rows = await f.authority.records.transaction(tx => tx.list({ prefix: 'participation-records:v1:record:', limit: 4 }));
        return clone([...rows.values()].find(row => row.subjects[0].record.principalRef === identity.principalRef).subjects[0].record);
    };
    return { readSubject, async grant(person) {
        const identity = await f.authority.resolveParticipationConnection(person.binding); expect(identity).not.toBeNull();
        const proof = randomUUID(); participants.set(proof, { ...identity, operationRef: randomUUID() });
        const pending = await ledger.begin(proof, { expectedRevision: 0, purposes: [...PARTICIPATION_PURPOSES] }); expect(pending.ok).toBe(true);
        const decision = randomUUID(); decisions.set(decision, { operationRef: randomUUID(), pendingRef: pending.pendingRef,
            subjectRef: pending.subjectRef, principalRef: identity.principalRef, guardianPrincipalRef: 'person_fixture_guardian',
            decisionRef: randomUUID(), verifierRef: config.rules.verifierRef, status: 'approved', purposes: [...PARTICIPATION_PURPOSES], verifiedAt: f.now(), expiresAt: f.now() + 90000 });
        expect((await ledger.complete(decision)).state).toBe('authorized');
    }, async withdrawal(person) {
        const identity = await f.authority.resolveParticipationConnection(person.binding);
        const rows = await f.authority.records.transaction(tx => tx.list({ prefix: 'participation-records:v1:record:', limit: 4 }));
        const state = [...rows.values()].find(row => row.subjects[0].record.principalRef === identity.principalRef);
        const subject = state.subjects[0].record, guardian = state.guardians.find(row => row.subjectRef === subject.subjectRef), proof = randomUUID();
        guardians.set(proof, { operationRef: randomUUID(), subjectRef: subject.subjectRef, principalRef: guardian.principalRef,
            guardianRef: guardian.guardianRef, guardianRevision: guardian.revision, expiresAt: f.now() + 1000 });
        return async tx => {
            // Same supplied codec/native transaction after an effect write: no nested SQLite transaction.
            const current = tx ? make({ transaction: operation => operation(tx) }) : ledger;
            const result = await current.change(proof, { expectedRevision: subject.revision, purposes: [] });
            expect(result.state).toBe('withdrawn');
        };
    } };
}
describe('real C3 contact withdrawal and independent safety through selected-person authority', () => {
    it.each(['actor', 'peer'].flatMap(party => ['before', 'after'].map(phase => [party, phase])))(
        'does not create a contact grant when %s withdraws %s the actual PM-request write', async (party, phase) => {
            const f = await fixture({ participation: true }), consent = await consentFixture(f);
            const actor = await f.enroll('contact-actor'), peer = await f.enroll('contact-peer');
            await consent.grant(actor); await consent.grant(peer); const withdraw = await consent.withdrawal(party === 'actor' ? actor : peer);
            let armed = false, crossed = false;
            const fence = { prepare: (...args) => f.authority.effectCommit.prepare(...args), commit: async (...args) => {
                if (phase === 'before' && armed && !args[2]?.costsOnly) { armed = false; crossed = true; await withdraw(); }
                return f.authority.effectCommit.commit(...args);
            } };
            const app = f.makeEngine({ effectCommit: fence, participation: createLobbyParticipation({ env: f.env, authority: f.authority, now: f.now }) });
            await admit(app, actor, 'ContactActor'); await admit(app, peer, 'ContactPeer');
            const room = app.frames.find(frame => frame.recipient === actor.binding.id && frame.t === 'join' && frame.ch.name === '#stalemate').ch;
            f.controls.afterEffects = async ({ tx, effects, costsOnly }) => {
                if (phase === 'after' && armed && !costsOnly) { armed = false; crossed = true;
                    expect(effects.some(([kind]) => kind === 'sessions')).toBe(true); await withdraw(tx); }
            };
            const subjectBefore = await consent.readSubject(party === 'actor' ? actor : peer);
            const before = hashRows(f.driver), rollbackCount = f.driver.stats.rollbacks; let physicalAfterRollback;
            if (phase === 'after') f.hooks.before = () => {
                if (physicalAfterRollback === undefined && f.driver.stats.rollbacks > rollbackCount) physicalAfterRollback = hashRows(f.driver);
            };
            app.frames.length = 0; armed = true;
            expect((await app.message(actor.binding.id, personFrame(peer, room, 'query', ['ContactPeer']))).ok).toBe(false);
            expect(crossed).toBe(true); expect(app.frames.some(frame => frame.t === 'pm-request' || frame.t === 'pm-open' || frame.t === 'pm')).toBe(false);
            expect(app.engine.sessionSnapshot().pendingPm).toEqual([]);
            // The after-write withdrawal is part of the rolled-back native transaction,
            // not falsely described as an externally committed parental decision.
            if (phase === 'after') {
                expect(f.driver.stats.rollbacks).toBeGreaterThan(rollbackCount);
                expect(physicalAfterRollback).toBe(before);
            }
            delete f.hooks.before;
            const subjectAfter = await consent.readSubject(party === 'actor' ? actor : peer);
            if (phase === 'after') expect(subjectAfter).toEqual(subjectBefore);
            else { expect(subjectAfter.state).toBe('withdrawn'); expect(subjectAfter.revision).toBe(subjectBefore.revision + 1); }
            expect(await f.authority.validate(actor.binding)).toBe(true); expect(await f.authority.validate(peer.binding)).toBe(true);
            expect(app.persist).not.toHaveBeenCalled();
        });

    it('keeps exact delivered reporting and bound device Block available after both real principals withdraw', async () => {
        const f = await fixture({ participation: true }), consent = await consentFixture(f);
        const actor = await f.enroll('safety-actor'), peer = await f.enroll('safety-peer');
        await consent.grant(actor); await consent.grant(peer);
        const app = f.makeEngine({ participation: createLobbyParticipation({ env: f.env, authority: f.authority, now: f.now }) });
        await admit(app, actor, 'SafetyActor'); await admit(app, peer, 'SafetyPeer');
        const room = app.frames.find(frame => frame.recipient === actor.binding.id && frame.t === 'join' && frame.ch.name === '#stalemate').ch;
        await app.message(peer.binding.id, { t: 'say', ch: '#stalemate', text: 'A real delivered safety witness' });
        const delivered = app.frames.find(frame => frame.recipient === actor.binding.id && frame.t === 'line' && frame.text === 'A real delivered safety witness');
        expect(delivered).toBeDefined();
        await (await consent.withdrawal(actor))(); await (await consent.withdrawal(peer))();
        await app.engine.refreshParticipation();
        expect(app.engine._debug.conns.get(actor.binding.id).safetyOnly).toBe(true); app.frames.length = 0;
        await app.message(actor.binding.id, { t: 'report', id: delivered.id, text: delivered.text });
        expect(app.frames.some(frame => frame.recipient === actor.binding.id && frame.t === 'report-status' && frame.id === delivered.id && frame.submitted === true)).toBe(true);
        await app.message(actor.binding.id, personFrame(peer, room, 'block', ['SafetyPeer']));
        expect(app.engine._debug.conns.get(actor.binding.id).blocks.has(peer.binding.dev)).toBe(true);
        await app.message(actor.binding.id, personFrame(peer, room, 'query', ['SafetyPeer']));
        expect(app.frames.some(frame => frame.t === 'pm-request' || frame.t === 'pm-open' || frame.t === 'pm')).toBe(false);
        expect(app.engine.sessionSnapshot().pendingPm).toEqual([]); expect(app.persist).not.toHaveBeenCalled();
    });
});


describe('actual account-only cohost removal has a native room fence with no selected CID', () => {
    it.each(['positive', 'before', 'after'])('preserves original verified-account intent and room authority at the %s boundary', async phase => {
        const f = await fixture();
        const ownerProfile = { kind: 'owner', account: await accountId('registered-owner@example.invalid', f.env.HANGOUT_HMAC_KEY),
            role: 'fan', admin: false, expiresAt: NOW + 90000 };
        const cohostProfile = { ...ownerProfile, account: await accountId('registered-cohost@example.invalid', f.env.HANGOUT_HMAC_KEY) };
        const replacementProfile = { ...ownerProfile, account: await accountId('replacement-owner@example.invalid', f.env.HANGOUT_HMAC_KEY) };
        const owner = await f.enroll('account-owner', ownerProfile), cohost = await f.enroll('account-cohost', cohostProfile);
        let armed = false, changed = false, room, actualDependencies, nativeAfterWrite;
        const changeOwner = async tx => {
            changed = true; const key = `community-room:${room.name}`, saved = await tx.get(key);
            // The replacement is a real, separately registered verified identity.
            // Both records remain well formed: this is a permission change, not corruption.
            await tx.put(key, { ...saved, owner: replacementProfile.account });
        };
        const fence = { prepare: (...args) => f.authority.effectCommit.prepare(...args), commit: async (...args) => {
            if (armed && !args[2]?.costsOnly) {
                actualDependencies = clone(args[2]?.personDependencies);
                expect(actualDependencies).not.toBeNull();
                expect(actualDependencies.peerIds).toEqual([]);
                expect(actualDependencies.room).toMatchObject({ name: room.name, keepRef: room.keepRef,
                    before: { owner: ownerProfile.account, cohosts: [cohostProfile.account] },
                    after: { owner: ownerProfile.account, cohosts: [] } });
                if (phase === 'before') { armed = false; await f.authority.records.transaction(changeOwner); }
            }
            return f.authority.effectCommit.commit(...args);
        } };
        const app = f.makeEngine({ effectCommit: fence });
        await admit(app, owner, 'RegisteredOwner'); await admit(app, cohost, 'VerifiedCohost');
        await app.message(owner.binding.id, { t: 'cmd', ch: '#stalemate', name: 'join', args: ['#chat-account-fence'] });
        await app.message(cohost.binding.id, { t: 'cmd', ch: '#stalemate', name: 'join', args: ['#chat-account-fence'] });
        await app.message(owner.binding.id, { t: 'say', ch: '#chat-account-fence', text: '/register' });
        await app.message(owner.binding.id, { t: 'say', ch: '#chat-account-fence', text: '/cohost add VerifiedCohost' });
        room = app.engine.roomSnapshot().rooms.find(value => value.name === '#chat-account-fence');
        expect(room.owner).toBe(ownerProfile.account); expect(room.cohosts).toEqual([cohostProfile.account]);
        // A legitimate persisted grant remains removable after its original
        // holder disconnects, even when a different verified account reuses the label.
        await app.engine.disconnect(cohost.binding.id);
        expect(app.engine._debug.conns.has(cohost.binding.id)).toBe(false);
        const replacement = await f.enroll('account-replacement', replacementProfile);
        await admit(app, replacement, 'VerifiedCohost');
        expect(app.engine.roomSnapshot().rooms.find(value => value.name === room.name).cohosts).toEqual([cohostProfile.account]);
        const before = hashRows(f.driver), rollbackCount = f.driver.stats.rollbacks; let physicalAfterRollback;
        if (phase === 'after') f.hooks.before = () => {
            if (physicalAfterRollback === undefined && f.driver.stats.rollbacks > rollbackCount) physicalAfterRollback = hashRows(f.driver);
        };
        f.controls.afterEffects = async ({ tx, effects, costsOnly }) => {
            if (phase === 'after' && armed && !costsOnly) {
                armed = false; nativeAfterWrite = tx;
                expect(effects.some(([kind]) => kind === 'rooms')).toBe(true);
                expect((await tx.get(`community-room:${room.name}`)).cohosts).toEqual([]);
                await changeOwner(tx);
            }
        };
        app.frames.length = 0; armed = true;
        const result = await app.message(owner.binding.id, { t: 'cmd', ch: room.name, roomInstance: room.keepRef,
            name: 'cohost', args: ['remove', cohostProfile.account], cohostAccount: true });
        expect(actualDependencies.peerIds).toEqual([]);
        expect(app.engine._debug.conns.get(replacement.binding.id).account).toBe(replacementProfile.account);
        expect(app.engine._debug.conns.get(replacement.binding.id).blocks.size).toBe(0);
        if (phase === 'positive') {
            expect(changed).toBe(false);
            expect(app.engine.roomSnapshot().rooms.find(value => value.name === room.name).cohosts).toEqual([]);
            expect(app.frames.some(frame => frame.recipient === owner.binding.id && frame.t === 'ownership'
                && frame.ch === room.name && frame.cohosts.length === 0)).toBe(true);
        } else {
            expect(result).toMatchObject({ ok: false, reason: 'person-target-stale' });
            expect(changed).toBe(true);
            expect(app.engine.roomSnapshot().rooms.find(value => value.name === room.name).cohosts).toEqual([cohostProfile.account]);
            expect(app.frames.some(frame => frame.t === 'ownership' && frame.ch === room.name && frame.cohosts.length === 0)).toBe(false);
            expect(app.engine.snapshot()).toMatchObject({ lock: 'off', lockAuto: false });
            if (phase === 'after') {
                expect(nativeAfterWrite).toBeDefined(); expect(f.driver.stats.rollbacks).toBeGreaterThan(rollbackCount);
                expect(physicalAfterRollback).toBe(before);
            }
        }
        delete f.hooks.before; delete f.controls.afterEffects; armed = false;
        const saved = (await f.authority.load()).state.rooms.rooms.find(value => value.name === room.name);
        expect(saved.owner).toBe(phase === 'before' ? replacementProfile.account : ownerProfile.account);
        expect(saved.cohosts).toEqual(phase === 'positive' ? [] : [cohostProfile.account]);
        if (phase !== 'positive') {
            const text = 'Public chat still works after the refused owner action';
            await app.message(owner.binding.id, { t: 'say', ch: '#stalemate', text });
            expect(app.frames.some(frame => frame.recipient === owner.binding.id && frame.t === 'line' && frame.text === text)).toBe(true);
        }
        expect(app.persist).not.toHaveBeenCalled();
    });
});
