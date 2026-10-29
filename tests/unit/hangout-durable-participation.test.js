// @vitest-environment node
// Synthetic authority adapters; actual C2/C3 engines and SQLite rollback domain.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDurableRecordSqlite } from '../support/durable-record-sqlite.mjs';
import { createDurableRecordStorage } from '../../hangout-worker/src/durable-record-storage.mjs';
import { createLobby } from '../../hangout-worker/src/lobby-core.mjs';
import { PARTICIPATION_PURPOSES } from '../../hangout-worker/src/participation-policy.mjs';
import { createParticipationEnforcement } from '../../hangout-worker/src/participation-enforcement.mjs';
import { createPartitionedParticipationConsents, readPartitionedParticipationPrincipals,
    PARTICIPATION_PARTITION_PREFIX as PREFIX, PARTICIPATION_POLICY_KEY } from '../../hangout-worker/src/participation-partitions.mjs';

const START = 1800000000000, clone = value => structuredClone(value), cleanups = [];
const sessionKey = person => `synthetic:session:${person.id}`;
const logicalKey = event => event.name === 'put' && event.key.includes(':manifest:')
    ? Buffer.from(event.key.split(':manifest:')[1], 'hex').toString('ascii') : '';
afterEach(async () => {
    for (const { directory, drivers } of cleanups.splice(0)) {
        for (const driver of drivers) await driver.close();
        await rm(directory, { recursive: true, force: true });
    }
});

async function fixture({ short = false, policyExpiresIn = 1000000 } = {}) {
    let at = START, serial = 0;
    const directory = await mkdtemp(join(tmpdir(), 'hangout-durable-participation-'));
    const filename = join(directory, 'participation.sqlite'), hooks = {};
    const driver = openDurableRecordSqlite(filename, hooks), cleanup = { directory, drivers: [driver] };
    cleanups.push(cleanup);
    const wrap = raw => createDurableRecordStorage({ storage: raw, namespace: 'participation-test', maxRecordBytes: 4 * 1024 * 1024 });
    const storage = wrap(driver), randomRef = () => `synthetic_disk_ref_${String(++serial).padStart(8, '0')}`;
    const proofs = new Map(), decisions = new Map(), guardians = new Map(), people = new Map();
    const config = { policy: { version: 1, policyVersion: 'synthetic-disk-policy-v1', revision: 1,
        communityRef: 'synthetic_disk_community', noticeDigest: 'a'.repeat(64), decisionRef: 'synthetic_disk_operator', state: 'qualified',
        purposes: [...PARTICIPATION_PURPOSES], issuedAt: START - 100, effectiveAt: START - 100, expiresAt: START + policyExpiresIn, maxSessionMs: 10000 },
        rules: { version: 1, verifierRef: 'synthetic_disk_verifier', pendingMs: short ? 100 : 10000, grantMs: short ? 500 : 500000,
            subjectTailMs: 100, guardianTailMs: 100, receiptTailMs: 100, callbackMs: 100, operationMs: short ? 100 : 10000 } };
    const adapters = {
        qualifyPolicy: async ({ proof }) => proof === 'synthetic-operator' ? { config: clone(config), expiresAt: at + 1000000 } : null,
        authenticateParticipant: async ({ proof, purpose }) => {
            const auth = proofs.get(proof);
            return !auth ? null : purpose === 'begin' ? clone(auth)
                : { principalRef: auth.principalRef, communityRef: auth.communityRef, expiresAt: auth.expiresAt };
        },
        verifyConsent: async ({ proof }) => clone(decisions.get(proof)),
        authenticateGuardian: async ({ proof }) => clone(guardians.get(proof)),
        authorizeMaintenance: async ({ proof }) => proof === 'synthetic-maintenance' ? { communityRef: config.policy.communityRef, expiresAt: at + 10000 } : null
    };
    const makeLedger = store => createPartitionedParticipationConsents({ storage: store, adapters, now: () => at, randomRef,
        admitSubject: async ({ tx }) => { const count = await tx.get('synthetic:allocated') || 0; await tx.put('synthetic:allocated', count + 1); return count < 8; } });
    const ledger = makeLedger(storage);
    expect((await ledger.installPolicy('synthetic-operator')).ok).toBe(true);
    const enroll = async name => {
        const proof = randomRef(), principalRef = `synthetic_disk_principal_${name}`;
        proofs.set(proof, { operationRef: randomRef(), principalRef, communityRef: config.policy.communityRef, expiresAt: at + 500000 });
        const pending = await ledger.begin(proof, { expectedRevision: 0, purposes: [...PARTICIPATION_PURPOSES] });
        expect(pending.ok).toBe(true);
        const decision = randomRef();
        decisions.set(decision, { operationRef: randomRef(), pendingRef: pending.pendingRef, subjectRef: pending.subjectRef, principalRef,
            guardianPrincipalRef: 'synthetic_disk_guardian', decisionRef: randomRef(), verifierRef: config.rules.verifierRef,
            status: 'approved', purposes: [...PARTICIPATION_PURPOSES], verifiedAt: at, expiresAt: at + 500000 });
        expect((await ledger.complete(decision)).state).toBe('authorized');
        const person = { id: `socket_${name}`, principalRef, communityRef: config.policy.communityRef, proof, expiresAt: at + 500000,
            dev: `device_${name}`, iph: `ip_${name}`, account: 'a'.repeat(64), role: 'fan', admin: false, nick: `Guest${name}` };
        people.set(person.id, person);
        await storage.transaction(tx => tx.put(sessionKey(person), person));
        return person;
    };
    const identity = p => ({ principalRef: p.principalRef, communityRef: p.communityRef, expiresAt: p.expiresAt });
    const read = (persons, store = storage) => store.transaction(tx => readPartitionedParticipationPrincipals({ tx, identities: persons.map(identity), now: at }));
    const records = () => storage.transaction(tx => tx.list({ prefix: `${PREFIX}record:`, limit: 4 }));
    const withdraw = async person => {
        const state = [...(await records()).values()].find(value => value.subjects[0].record.principalRef === person.principalRef);
        const subject = state.subjects[0].record, guardian = state.guardians.find(item => item.subjectRef === subject.subjectRef), proof = randomRef();
        guardians.set(proof, { operationRef: randomRef(), subjectRef: subject.subjectRef, principalRef: guardian.principalRef,
            guardianRef: guardian.guardianRef, guardianRevision: guardian.revision, expiresAt: at + 10000 });
        return ledger.change(proof, { expectedRevision: subject.revision, purposes: [] });
    };
    const frames = [], controls = { finalWrite: null, commits: [] }, legacyPersist = vi.fn();
    const enforcement = createParticipationEnforcement({ storage, now: () => at, readPrincipals: readPartitionedParticipationPrincipals,
        resolveConnection: async ({ id }) => people.has(id) ? identity(people.get(id)) : null,
        validateConnection: async ({ tx, connection, identity: id, at: time }) => {
            const session = await tx.get(sessionKey(connection));
            return !!session && session.expiresAt > time && session.principalRef === id.principalRef && session.communityRef === id.communityRef
                && ['dev', 'account', 'role', 'admin'].every(key => session[key] === connection[key]);
        },
        writeEffects: async ({ tx, effects, costsOnly }) => {
            for (const [kind, value] of effects) await tx.put(`lobby:${kind}`, value);
            if (!costsOnly && controls.finalWrite) {
                const action = controls.finalWrite; controls.finalWrite = null;
                await action(tx);
                // Last physical manifest write remains inside the same SQLite
                // transaction; authorize() must run again before publication.
                await tx.put('synthetic:final-effect-fence', { attempted: true });
            }
        }
    });
    const engine = createLobby({ now: () => at, participation: enforcement, persist: legacyPersist,
        send: (id, frame) => { frames.push({ recipient: id, ...clone(frame) }); controls.commits.push(driver.stats.commits); } });
    const message = (person, frame) => engine.message(person.id, JSON.stringify(frame));
    const cmd = (person, name, args = []) => message(person, { t: 'cmd', ch: '#stalemate', name, args });
    const connect = async person => {
        expect((await engine.connect(person)).ok).toBe(true);
        await message(person, { t: 'hello', nick: person.nick, age13: true });
        expect(engine._debug.conns.get(person.id).nick).toBe(person.nick);
    };
    const reopen = async () => {
        await driver.close();
        const raw = openDurableRecordSqlite(filename); cleanup.drivers.push(raw);
        return { driver: raw, storage: wrap(raw) };
    };
    return { driver, storage, hooks, controls, config, ledger, makeLedger, enroll, identity, read, records, withdraw, frames, engine,
        legacyPersist, message, cmd, connect, reopen, now: () => at, advance: ms => at += ms };
}

describe('actual durable C2/C3 participation domain', () => {
    it('exchanges guest chat only after SQLite commit and recovers the authorized records from disk', async () => {
        const f = await fixture(), alice = await f.enroll('alice'), bravo = await f.enroll('bravo');
        await f.connect(alice); await f.connect(bravo); f.frames.length = 0; f.controls.commits.length = 0;
        let earlyOutput = false;
        f.hooks.after = event => { if (event.name === 'put' && f.frames.some(frame => frame.text === 'Durable guest greeting')) earlyOutput = true; };
        const committed = f.driver.stats.commits;
        await f.message(alice, { t: 'say', ch: '#stalemate', text: 'Durable guest greeting' });
        expect(f.frames.filter(frame => frame.t === 'line' && frame.text === 'Durable guest greeting').map(frame => frame.recipient).sort()).toEqual([alice.id, bravo.id].sort());
        expect(earlyOutput).toBe(false); expect(f.controls.commits.every(count => count > committed)).toBe(true);
        f.hooks.after = undefined;
        await f.message(bravo, { t: 'say', ch: '#stalemate', text: 'Durable guest reply' });
        expect(f.frames.filter(frame => frame.t === 'line' && frame.text === 'Durable guest reply')).toHaveLength(2);
        const storedParts = [...f.driver.rows().values()].filter(value => value instanceof Uint8Array).map(value => Buffer.from(value).toString('utf8')).join('');
        expect(storedParts).not.toContain('Durable guest greeting'); expect(storedParts).not.toContain('Durable guest reply');
        expect(f.legacyPersist).not.toHaveBeenCalled();
        const recovered = await f.reopen(), current = await f.read([alice, bravo], recovered.storage);
        expect(current.ok).toBe(true); expect(current.subjects.map(subject => subject.state)).toEqual(['authorized', 'authorized']);
        expect((await f.makeLedger(recovered.storage).lookup(alice.proof)).subject.principalRef).toBe(alice.principalRef);
    });

    it('persists a guardian withdrawal that blocks future real lobby effects and survives reopening', async () => {
        const f = await fixture(), alice = await f.enroll('alice'), bravo = await f.enroll('bravo');
        await f.connect(alice); await f.connect(bravo);
        expect((await f.withdraw(alice)).state).toBe('withdrawn'); f.frames.length = 0;
        expect((await f.message(alice, { t: 'say', ch: '#stalemate', text: 'Withdrawn guest cannot publish' })).ok).toBe(false);
        expect(f.frames.some(frame => frame.text === 'Withdrawn guest cannot publish')).toBe(false);
        expect([...f.engine._debug.lines.values()].some(line => line.text === 'Withdrawn guest cannot publish')).toBe(false);
        await f.cmd(alice, 'block', [bravo.nick]);
        expect(f.engine._debug.conns.get(alice.id).blocks.has(bravo.dev)).toBe(true);
        await f.cmd(alice, 'quit'); expect(f.engine._debug.conns.has(alice.id)).toBe(false);
        expect(f.engine._debug.conns.has(bravo.id)).toBe(true); expect(f.legacyPersist).not.toHaveBeenCalled();
        const recovered = await f.reopen();
        expect((await f.makeLedger(recovered.storage).lookup(alice.proof)).subject.state).toBe('withdrawn');
        expect((await f.read([alice, bravo], recovered.storage)).subjects.map(subject => subject?.state ?? null)).toEqual([null, 'authorized']);
    });

    it.each(['stored-session-revocation', 'stored-role-change', 'policy-expiry'])('rolls back staged room/receipt state when %s is detected after the last durable write', async kind => {
        const f = await fixture(kind === 'policy-expiry' ? { policyExpiresIn: 10000 } : {}), alice = await f.enroll('alice'); await f.connect(alice); f.frames.length = 0;
        const beforeSession = await f.storage.transaction(tx => tx.get(sessionKey(alice))), beforeRooms = f.engine.roomSnapshot();
        const beforeReceipts = f.engine.sessionSnapshot().receipts;
        const beforeFrames = f.engine._debug.conns.get(alice.id).frames, beforeRollbacks = f.driver.stats.rollbacks;
        let sawFinalWrite = false, earlyOutput = false;
        f.hooks.after = event => {
            if (logicalKey(event) === 'synthetic:final-effect-fence') {
                sawFinalWrite = true; earlyOutput = f.frames.length !== 0;
                if (kind === 'policy-expiry') f.advance(f.config.policy.expiresAt - f.now() + 1);
            }
        };
        // Authority mutations are explicitly staged by a trusted fixture in
        // this SAME serializable domain, not a claimed concurrent remote edit.
        f.controls.finalWrite = async tx => {
            if (kind === 'stored-session-revocation') await tx.delete(sessionKey(alice));
            if (kind === 'stored-role-change') await tx.put(sessionKey(alice), { ...beforeSession, role: 'moderator', admin: true });
        };
        expect(await f.cmd(alice, 'join', ['#art-durable-denied'])).toMatchObject({ ok: false, reason: 'participation-denied' });
        expect(sawFinalWrite).toBe(true); expect(earlyOutput).toBe(false); expect(f.driver.stats.rollbacks).toBe(beforeRollbacks + 1);
        expect(f.engine.roomSnapshot()).toEqual(beforeRooms);
        expect(f.engine.sessionSnapshot().receipts).toEqual(beforeReceipts);
        expect(f.frames.some(frame => frame.t === 'join' && frame.ch?.name === '#art-durable-denied')).toBe(false);
        expect(f.engine._debug.conns.get(alice.id).frames).toBe(beforeFrames + 1);
        expect(await f.storage.transaction(tx => tx.get('synthetic:final-effect-fence'))).toBeUndefined();
        expect(await f.storage.transaction(tx => tx.get(sessionKey(alice)))).toEqual(beforeSession);
        expect(beforeSession.expiresAt).toBeGreaterThan(f.now());
        const sessions = await f.storage.transaction(tx => tx.get('lobby:sessions'));
        expect(JSON.stringify(sessions)).not.toContain('#art-durable-denied');
        expect(f.legacyPersist).not.toHaveBeenCalled();
    });

    it('maintains actual four-record prefix pages and reopens the swept C2 reader without restoring expired grants', async () => {
        const f = await fixture({ short: true }), people = [];
        for (let n = 0; n < 5; n++) people.push(await f.enroll(`page${n}`));
        f.driver.resetOperations();
        const first = await f.ledger.sweep('synthetic-maintenance', { limit: 4 });
        expect(first).toMatchObject({ ok: true, examined: 4 }); expect(first.nextCursor).not.toBe('');
        const second = await f.ledger.sweep('synthetic-maintenance', { cursor: first.nextCursor, limit: 4 });
        expect(second).toMatchObject({ ok: true, examined: 1, nextCursor: '' });
        expect((await f.read([people[0], people[4]])).subjects.every(subject => subject.state === 'authorized')).toBe(true);
        f.advance(1501);
        let cursor = '', total = 0;
        do { const page = await f.ledger.sweep('synthetic-maintenance', { cursor, limit: 4 }); expect(page.ok).toBe(true); total += page.examined; cursor = page.nextCursor; } while (cursor);
        expect(total).toBe(5);
        const listed = f.driver.stats.operations.filter(event => event.name === 'list');
        expect(listed.length).toBeGreaterThan(0); expect(listed.every(event => event.value.limit <= 4)).toBe(true);
        expect(listed.some(event => event.value.limit === 4 && event.key.includes(':manifest:')
            && event.key.endsWith(Buffer.from(`${PREFIX}record:`).toString('hex')))).toBe(true);
        const recovered = await f.reopen();
        expect(await recovered.storage.transaction(tx => tx.list({ prefix: PREFIX, limit: 4 }))).toEqual(new Map([[PARTICIPATION_POLICY_KEY,
            await recovered.storage.transaction(tx => tx.get(PARTICIPATION_POLICY_KEY))]]));
        const read = await f.read([people[0], people[4]], recovered.storage);
        expect(read.ok).toBe(true); expect(read.subjects).toEqual([null, null]);
    });
});
