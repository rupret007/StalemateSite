// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createLobby } from '../../hangout-worker/src/lobby-core.mjs';
import { PARTICIPATION_PURPOSES } from '../../hangout-worker/src/participation-policy.mjs';
import { PARTICIPATION_LEDGER_KEY, PARTICIPATION_LEDGER_LIMITS } from '../../hangout-worker/src/participation-consents.mjs';
import { createParticipationEnforcement } from '../../hangout-worker/src/participation-enforcement.mjs';
import { createPartitionedParticipationConsents, readPartitionedParticipationPrincipals,
    PARTICIPATION_PARTITION_PREFIX as PREFIX, PARTICIPATION_POLICY_KEY, PARTICIPATION_RECORD_LIMITS } from '../../hangout-worker/src/participation-partitions.mjs';

const START = 1800000000000, clone = value => structuredClone(value), size = value => Buffer.byteLength(JSON.stringify(value));
const held = () => { let enter, release; return { entered: new Promise(resolve => enter = resolve), wait: () => { enter(); return new Promise(resolve => release = resolve); }, release: () => release() }; };
function store() {
    let committed = new Map(), tail = Promise.resolve(), fail = false, badList = false, afterPut = null;
    const metrics = [];
    const enqueue = operation => { const task = tail.then(operation); tail = task.catch(() => {}); return task; };
    return {
        transaction: operation => enqueue(async () => {
            const staged = clone(committed), metric = { reads: 0, puts: 0, deletes: 0, lists: 0, maxValue: 0 }; metrics.push(metric);
            const tx = { get: async key => { metric.reads++; return clone(staged.get(key)); },
                put: async (key, value) => { metric.puts++; metric.maxValue = Math.max(metric.maxValue, size(value)); staged.set(key, clone(value)); afterPut?.(key); },
                delete: async key => { metric.deletes++; staged.delete(key); },
                list: async ({ prefix, startAfter = '', limit }) => {
                    metric.lists++; metric.limit = limit;
                    const entries = [...staged].filter(([key]) => key.startsWith(prefix) && key > startAfter).sort(([a], [b]) => a.localeCompare(b));
                    return new Map(entries.slice(0, badList ? limit + 1 : limit));
                } };
            const result = await operation(tx); if (fail) { fail = false; throw Error('Synthetic failed commit'); }
            committed = staged; return clone(result);
        }),
        dispatchStart: ({ validate, start }) => enqueue(async () => { await validate({ get: async key => clone(committed.get(key)) }); return { response: start() }; }).then(box => box.response),
        failNext: () => fail = true, badList: () => badList = true, afterPut: fn => afterPut = fn, snapshot: () => clone(committed), metrics
    };
}
async function fixture({ short = false, capacity = 128, reviewPublicText = null } = {}) {
    let at = START, serial = 0, forced = [];
    const randomRef = () => forced.shift() || `synthetic_partition_${String(++serial).padStart(8, '0')}`;
    const storage = store(), people = new Map(), proofs = new Map(), decisions = new Map(), guardians = new Map();
    const config = { policy: { version: 1, policyVersion: 'partition-test-v1', revision: 1, communityRef: 'synthetic_partition_community',
        noticeDigest: 'a'.repeat(64), decisionRef: 'synthetic_operator_decision', state: 'qualified', purposes: [...PARTICIPATION_PURPOSES],
        issuedAt: START - 100, effectiveAt: START - 100, expiresAt: START + 1000000, maxSessionMs: 10000 },
        rules: { version: 1, verifierRef: 'synthetic_partition_verifier', pendingMs: short ? 100 : 10000, grantMs: short ? 500 : 500000,
            subjectTailMs: 100, guardianTailMs: 100, receiptTailMs: 100, callbackMs: 100, operationMs: short ? 100 : 10000 } };
    const controls = { beforeCommit: null, afterEffects: null, failAllocation: false, expireAllocation: false, maintenance: true, flood: '', reclaim: false, failRelease: false };
    const adapters = {
        qualifyPolicy: async ({ proof }) => proof === 'operator' ? { config: clone(config), expiresAt: at + 1000000 } : null,
        authenticateParticipant: async ({ proof, purpose }) => {
            const found = proofs.get(proof); if (!found) return null;
            return purpose === 'begin' ? clone(found) : { principalRef: found.principalRef, communityRef: found.communityRef, expiresAt: found.expiresAt };
        }, verifyConsent: async ({ proof }) => clone(decisions.get(proof)), authenticateGuardian: async ({ proof }) => clone(guardians.get(proof)),
        authorizeMaintenance: async ({ proof }) => proof === 'maintenance' && controls.maintenance ? { communityRef: config.policy.communityRef, expiresAt: at + 10000 } : null
    };
    const makeLedger = () => createPartitionedParticipationConsents({ storage, adapters, now: () => at, randomRef,
        admitSubject: async ({ tx }) => {
            const count = await tx.get('synthetic-allocation-count') || 0;
            if (controls.failAllocation || count >= capacity) return false;
            if (controls.flood) for (let n = 0; n < 200; n++) {
                if (controls.flood === 'reads') await tx.get('synthetic-allocation-count'); else await tx.put(`synthetic-extra-${n}`, n);
            }
            await tx.put('synthetic-allocation-count', count + 1); if (controls.expireAllocation) at += 1000000; return true;
        }, releaseSubject: async ({ tx }) => {
            if (controls.failRelease) return false;
            if (controls.reclaim) { const count = await tx.get('synthetic-allocation-count'); if (!Number.isInteger(count) || count < 1) return false; await tx.put('synthetic-allocation-count', count - 1); }
            return true;
        } });
    const ledger = makeLedger(); expect((await ledger.installPolicy('operator')).ok).toBe(true);
    const begin = async (name, extra = {}) => {
        const proof = randomRef(), principalRef = `synthetic_principal_${name}`;
        proofs.set(proof, { operationRef: randomRef(), principalRef, communityRef: config.policy.communityRef, expiresAt: at + 500000, ...extra });
        const result = await ledger.begin(proof, { expectedRevision: 0, purposes: [...PARTICIPATION_PURPOSES] }); return { proof, principalRef, result };
    };
    const complete = async (pending, extra = {}) => {
        const proof = randomRef(); decisions.set(proof, { operationRef: randomRef(), pendingRef: pending.result.pendingRef, subjectRef: pending.result.subjectRef,
            principalRef: pending.principalRef, guardianPrincipalRef: 'synthetic_shared_guardian', decisionRef: randomRef(), verifierRef: config.rules.verifierRef,
            status: 'approved', purposes: [...PARTICIPATION_PURPOSES], verifiedAt: at, expiresAt: at + 500000, ...extra });
        return { proof, result: await ledger.complete(proof) };
    };
    const enroll = async name => {
        const pending = await begin(name); expect(pending.result.ok).toBe(true);
        const done = await complete(pending); expect(done.result.state).toBe('authorized');
        const person = { id: `connection_${name}`, principalRef: pending.principalRef, communityRef: config.policy.communityRef, proof: pending.proof, decisionProof: done.proof,
            expiresAt: at + 500000, dev: `device_${name}`, iph: `ip_${name}`, account: 'a'.repeat(64), role: 'fan', admin: false, nick: `Person${name}` };
        people.set(person.id, person); await storage.transaction(tx => tx.put(`session:${person.id}`, person)); return person;
    };
    const record = person => [...storage.snapshot()].find(([key, value]) => key.startsWith(`${PREFIX}record:`) && value.subjects.some(item => item.record.principalRef === person.principalRef));
    const guardianProof = (person, extra = {}) => {
        const [, state] = record(person), subject = state.subjects[0].record, guardian = state.guardians.find(item => item.subjectRef === subject.subjectRef), proof = randomRef();
        guardians.set(proof, { operationRef: randomRef(), subjectRef: subject.subjectRef, principalRef: guardian.principalRef, guardianRef: guardian.guardianRef,
            guardianRevision: guardian.revision, expiresAt: at + 10000, ...extra }); return { proof, revision: subject.revision };
    };
    const withdraw = async person => { const auth = guardianProof(person); return ledger.change(auth.proof, { expectedRevision: auth.revision, purposes: [] }); };
    const identity = person => ({ principalRef: person.principalRef, communityRef: person.communityRef, expiresAt: person.expiresAt });
    const read = people => storage.transaction(tx => readPartitionedParticipationPrincipals({ tx, identities: people.map(identity), now: at }));
    const frames = [], closed = [], reader = vi.fn(readPartitionedParticipationPrincipals);
    const enforcement = createParticipationEnforcement({ storage, now: () => at, readPrincipals: reader,
        resolveConnection: async ({ id }) => { const p = people.get(id); return p ? identity(p) : null; },
        validateConnection: async ({ tx, connection, identity, at: time }) => {
            const session = await tx.get(`session:${connection.id}`);
            return !!session && session.expiresAt > time && session.principalRef === identity.principalRef && session.communityRef === identity.communityRef
                && ['dev', 'account', 'role', 'admin'].every(key => session[key] === connection[key]);
        }, providerQualified: () => true, dispatchStart: storage.dispatchStart,
        beforeCommit: async ({ costsOnly }) => { if (!costsOnly && controls.beforeCommit) { const gate = controls.beforeCommit; controls.beforeCommit = null; await gate.wait(); } },
        writeEffects: async ({ tx, effects, costsOnly }) => {
            for (const [kind, value] of effects) await tx.put(`lobby:${kind}`, value);
            if (!costsOnly && controls.afterEffects) { const run = controls.afterEffects; controls.afterEffects = null; await run(); }
        }
    });
    const legacyPersist = vi.fn();
    const engine = createLobby({ now: () => at, participation: enforcement, reviewPublicText, persist: legacyPersist,
        send: (id, frame) => frames.push({ recipient: id, ...clone(frame) }), close: (...args) => closed.push(args) });
    const connect = async person => { expect((await engine.connect(person)).ok).toBe(true); await engine.message(person.id, JSON.stringify({ t: 'hello', nick: person.nick, age13: true })); expect(engine._debug.conns.get(person.id).nick).toBe(person.nick); };
    const message = (person, frame) => engine.message(person.id, JSON.stringify(frame));
    const cmd = (person, name, args) => message(person, { t: 'cmd', ch: '#stalemate', name, args });
    return { storage, ledger, makeLedger, adapters, controls, config, proofs, decisions, guardians, begin, complete, enroll, record, guardianProof, withdraw, read,
        identity, engine, enforcement, reader, frames, closed, legacyPersist, connect, message, cmd, advance: ms => at += ms, force: refs => forced = [...refs], now: () => at };
}

describe('fresh author dependencies for ordinary public text', () => {
    it('uses 23 point reads regardless of an unrelated peer while preserving PM, held text and active media', async () => {
        const f = await fixture(), alice = await f.enroll('alice'), bravo = await f.enroll('bravo'); await f.connect(alice); await f.connect(bravo); f.advance(120001);
        await f.cmd(bravo, 'msg', [alice.nick, 'Synthetic pending contact']);
        await f.cmd(bravo, 'join', ['#watch-scope']); await f.cmd(alice, 'join', ['#watch-scope']);
        await f.message(bravo, { t: 'cam', ch: '#watch-scope', on: true, adult18: true });
        await f.message(bravo, { t: 'act', kind: 'video', ch: '#watch-scope', source: { kind: 'yt', id: 'dQw4w9WgXcQ' }, playing: false, pos: 0 });
        await f.message(bravo, { t: 'say', ch: '#stalemate', text: 'you are an idiot' });
        expect(f.engine._debug.pm.size).toBe(1); expect(f.engine._debug.held.size).toBe(1);
        const pm = [...f.engine._debug.pm.values()][0], queued = [...f.engine._debug.held.values()][0], room = f.engine._debug.channels.get('#watch-scope');
        expect(f.engine._debug.conns.get(bravo.id).cams.has(room.name)).toBe(true); expect(room.act.video.source.id).toBe('dQw4w9WgXcQ');
        const activity = clone(room.act), count = f.storage.metrics.length; f.reader.mockClear(); f.frames.length = 0;
        await f.message(alice, { t: 'say', ch: '#stalemate', text: 'Ordinary public message with independent state' });
        expect(f.frames.filter(frame => frame.t === 'line' && frame.text === 'Ordinary public message with independent state')).toHaveLength(2);
        expect(f.reader.mock.calls).toHaveLength(3); expect(f.reader.mock.calls.every(([arg]) => arg.identities.length === 1 && arg.identities[0].principalRef === alice.principalRef)).toBe(true);
        expect(f.storage.metrics.slice(count).reduce((n, item) => n + item.reads, 0)).toBe(23);
        expect([...f.engine._debug.pm.values()][0]).toBe(pm); expect([...f.engine._debug.held.values()][0]).toBe(queued); expect(room.act).toEqual(activity);
        expect(f.engine._debug.conns.get(bravo.id).cams.has(room.name)).toBe(true); expect(f.legacyPersist).not.toHaveBeenCalled();
        const authorOnly = await f.enforcement.prepare([{ id: alice.id, dev: alice.dev, account: alice.account, role: alice.role, admin: alice.admin }]);
        expect(f.enforcement.allows(authorOnly, { actorId: alice.id, peerId: bravo.id, action: 'requestDirectContact' })).toBe(false);
    });
    it.each(['pm-context', 'slash-command', 'rtc'])('keeps full peer preparation for %s and denies a withdrawn peer', async kind => {
        const f = await fixture(), alice = await f.enroll('alice'), bravo = await f.enroll('bravo'); await f.connect(alice); await f.connect(bravo); f.advance(120001);
        await f.cmd(alice, 'msg', [bravo.nick, 'Synthetic initial contact']); await f.cmd(bravo, 'accept', [alice.nick]);
        if (kind === 'rtc') {
            await f.cmd(alice, 'join', ['#art-scope']); await f.cmd(bravo, 'join', ['#art-scope']);
            await f.message(alice, { t: 'cam', ch: '#art-scope', on: true, adult18: true });
        }
        expect((await f.withdraw(bravo)).state).toBe('withdrawn'); f.reader.mockClear(); f.frames.length = 0;
        const frame = kind === 'pm-context' ? { t: 'say', ch: `pm:${bravo.nick}`, text: 'Withdrawn peer cannot receive this' }
            : kind === 'slash-command' ? { t: 'say', ch: '#stalemate', text: `/msg ${bravo.nick} Withdrawn peer cannot receive this` }
                : { t: 'act', kind: 'rtc', ch: '#art-scope', to: bravo.id, sdp: { type: 'offer', sdp: 'v=0\r\nm=video 9 RTP/AVP 96\r\n' } };
        expect((await f.message(alice, frame)).ok).toBe(false);
        expect(f.reader.mock.calls.length).toBeGreaterThan(0); expect(f.reader.mock.calls.every(([arg]) => arg.identities.length === 2)).toBe(true);
        expect(f.frames.some(frame => frame.t === 'pm' || frame.kind === 'rtc')).toBe(false);
    });
    it.each(['withdrawal', 'session-role', 'storage'])('refuses public output and rolls back receipts when %s changes before commit', async kind => {
        const f = await fixture(), alice = await f.enroll('alice'), bravo = await f.enroll('bravo'); await f.connect(alice); await f.connect(bravo);
        const gate = held(), before = f.engine._debug.conns.get(alice.id).frames; f.controls.beforeCommit = gate; f.frames.length = 0; f.reader.mockClear();
        const pending = f.message(alice, { t: 'say', ch: '#stalemate', text: 'No stale author publication' }); await gate.entered;
        expect(f.frames).toEqual([]);
        if (kind === 'withdrawal') expect((await f.withdraw(alice)).state).toBe('withdrawn');
        else if (kind === 'session-role') await f.storage.transaction(async tx => { const session = await tx.get(`session:${alice.id}`); await tx.put(`session:${alice.id}`, { ...session, role: 'moderator' }); });
        else f.storage.failNext();
        gate.release(); expect((await pending).ok).toBe(false);
        expect(f.frames.some(frame => frame.text === 'No stale author publication')).toBe(false); expect(JSON.stringify([...f.storage.snapshot()])).not.toContain('No stale author publication');
        expect([...f.engine._debug.lines.values()].some(line => line.text === 'No stale author publication')).toBe(false);
        expect(f.engine._debug.conns.get(alice.id).frames).toBe(before + 1); expect(f.legacyPersist).not.toHaveBeenCalled();
        expect(f.reader.mock.calls.every(([arg]) => arg.identities.length === 1 && arg.identities[0].principalRef === alice.principalRef)).toBe(true);
    });
    it('rechecks public-text expiry after awaited effect writes and denies a retained session after final subject cleanup', async () => {
        const f = await fixture({ short: true }), alice = await f.enroll('alice'), bravo = await f.enroll('bravo'); await f.connect(alice); await f.connect(bravo);
        f.controls.afterEffects = async () => f.advance(501); f.frames.length = 0;
        expect((await f.message(alice, { t: 'say', ch: '#stalemate', text: 'Expired during awaited writes' })).ok).toBe(false);
        expect(f.frames.some(frame => frame.text === 'Expired during awaited writes')).toBe(false); expect(JSON.stringify([...f.storage.snapshot()])).not.toContain('Expired during awaited writes');
        f.advance(1000); expect((await f.ledger.sweep('maintenance')).ok).toBe(true); expect(f.record(alice)).toBeUndefined();
        expect(f.engine._debug.conns.has(alice.id)).toBe(true);
        f.advance(3001); // Preserve the ordinary chat slow-mode guard before testing the missing subject.
        expect((await f.message(alice, { t: 'say', ch: '#stalemate', text: 'Old session cannot recreate a grant' })).ok).toBe(false);
        expect(f.frames.some(frame => frame.text === 'Old session cannot recreate a grant')).toBe(false);
        await f.cmd(alice, 'quit', []); expect(f.engine._debug.conns.has(alice.id)).toBe(false); expect(f.record(alice)).toBeUndefined();
    });
    it('keeps fresh same-author provider barriers after committed public text without preparing unrelated peers', async () => {
        const requests = [], start = vi.fn(() => 'synthetic-provider-no-network'), f = await fixture({ reviewPublicText: request => requests.push(request) });
        const alice = await f.enroll('alice'), bravo = await f.enroll('bravo'); await f.connect(alice); await f.connect(bravo); f.reader.mockClear();
        await f.message(alice, { t: 'say', ch: '#stalemate', text: 'Synthetic eligible public review' }); expect(requests).toHaveLength(1);
        const request = requests[0]; expect(JSON.stringify([...f.storage.snapshot()])).not.toContain(request.text);
        expect(f.frames.filter(frame => frame.text === request.text)).toHaveLength(2);
        expect(await request.beforeDispatch()).toBe(true); expect(await request.startDispatch(start)).toBe('synthetic-provider-no-network'); expect(start).toHaveBeenCalledOnce();
        expect((await f.withdraw(alice)).state).toBe('withdrawn'); expect(await request.beforeDispatch()).toBe(false);
        await expect(request.startDispatch(start)).rejects.toThrow(); expect(start).toHaveBeenCalledOnce();
        expect(f.reader.mock.calls.every(([arg]) => arg.identities.length === 1 && arg.identities[0].principalRef === alice.principalRef)).toBe(true);
        await f.engine.applyAiReview(request.id, { status: 'reviewed', flagged: true, model: 'synthetic-review', categories: ['harassment'] });
        expect(f.engine._debug.held.size).toBe(0); expect(f.legacyPersist).not.toHaveBeenCalled();
    });
});

describe('bounded per-principal C2 partitions', () => {
    it('enrolls 96 actual subjects and uses distant records in the actual C3 lobby without a larger aggregate', async () => {
        const f = await fixture(), people = [];
        for (let n = 0; n < 96; n++) people.push(await f.enroll(String(n).padStart(3, '0')));
        expect(PARTICIPATION_LEDGER_LIMITS.subjects).toBe(64); expect(f.storage.snapshot().has(PARTICIPATION_LEDGER_KEY)).toBe(false);
        const records = [...f.storage.snapshot()].filter(([key]) => key.startsWith(`${PREFIX}record:`)); expect(records).toHaveLength(96);
        expect(records.every(([, state]) => state.subjects.length === 1 && size(state) <= PARTICIPATION_RECORD_LIMITS.bytes)).toBe(true);
        expect(f.storage.metrics.every(metric => metric.reads < 45 && metric.puts < 10 && metric.maxValue <= 65536)).toBe(true);
        await f.connect(people[0]); await f.connect(people[95]);
        await f.message(people[0], { t: 'say', ch: '#stalemate', text: 'Actual partitioned community message' });
        expect(f.frames.filter(frame => frame.t === 'line' && frame.text === 'Actual partitioned community message')).toHaveLength(2);
        expect((await f.read([people[0], people[95]])).subjects.every(subject => subject.state === 'authorized')).toBe(true);
        const resumed = f.makeLedger(); expect((await resumed.lookup(people[95].proof)).subject.principalRef).toBe(people[95].principalRef);
    });
    it('blocks a queued peer PM when withdrawal commits in a different partition', async () => {
        const f = await fixture(), alice = await f.enroll('alice'), bravo = await f.enroll('bravo'); await f.connect(alice); await f.connect(bravo); f.advance(120001);
        await f.cmd(alice, 'msg', [bravo.nick, 'Benign pending private message']); await f.cmd(bravo, 'accept', [alice.nick]);
        expect(f.frames.some(frame => frame.t === 'pm' && frame.text === 'Benign pending private message')).toBe(true);
        f.frames.length = 0; const gate = held(); f.controls.beforeCommit = gate;
        const pending = f.cmd(alice, 'msg', [bravo.nick, 'Withdrawn peer never receives this']); await gate.entered;
        expect((await f.withdraw(bravo)).state).toBe('withdrawn'); gate.release(); expect((await pending).ok).toBe(false);
        expect(f.frames.some(frame => frame.t === 'pm')).toBe(false); expect(JSON.stringify([...f.storage.snapshot()])).not.toContain('Withdrawn peer never receives this');
        await f.engine.refreshParticipation(); expect(f.engine._debug.pm.size).toBe(0);
    });
    it('revokes untouched partitions atomically through policy and rejects pre-change effects/provider starts', async () => {
        const f = await fixture(), alice = await f.enroll('alice'), bravo = await f.enroll('bravo'); await f.connect(alice); await f.connect(bravo);
        const connection = p => ({ id: p.id, dev: p.dev, account: p.account, role: p.role, admin: p.admin });
        const context = await f.enforcement.prepare([connection(alice)]), request = { actorId: alice.id, action: 'aiPublicReview', providerReady: true, publicTextEligible: true };
        expect(await f.enforcement.providerAllowed(context, request)).toBe(true); const start = vi.fn(() => Promise.resolve('synthetic-no-network'));
        expect(await f.enforcement.startProvider(context, request, start)).toBe('synthetic-no-network'); expect(start).toHaveBeenCalledOnce();
        const original = clone(f.record(alice)[1]), gate = held(); f.controls.beforeCommit = gate;
        const pending = f.message(alice, { t: 'say', ch: '#stalemate', text: 'Old policy cannot authorize effects' }); await gate.entered;
        f.config.policy = { ...f.config.policy, revision: 2, policyVersion: 'partition-test-v2', noticeDigest: 'b'.repeat(64) };
        expect((await f.ledger.installPolicy('operator')).ok).toBe(true); expect(f.record(alice)[1]).toEqual(original);
        gate.release(); expect((await pending).ok).toBe(false);
        expect(f.frames.some(frame => frame.text === 'Old policy cannot authorize effects')).toBe(false);
        expect((await f.read([alice, bravo])).subjects).toEqual([null, null]); expect(await f.enforcement.providerAllowed(context, request)).toBe(false);
        await expect(f.enforcement.startProvider(context, request, start)).rejects.toThrow(); expect(start).toHaveBeenCalledOnce();
        expect(f.reader.mock.calls.length).toBeGreaterThan(6);
        const before = f.record(bravo)[1].subjects[0].record.revision;
        // Just as an eager aggregate policy update advances the revision, lazy
        // alignment refuses an old client revision; obtain the current record.
        expect((await f.withdraw(bravo)).ok).toBe(false);
        expect((await f.ledger.lookup(bravo.proof)).subject.state).toBe('policy-review-required');
        expect((await f.withdraw(bravo)).state).toBe('withdrawn');
        const reviewed = await f.ledger.lookup(bravo.proof); expect(reviewed.subject.state).toBe('withdrawn'); expect(reviewed.subject.purposes).toEqual([]);
        expect(reviewed.subject.revision).toBeGreaterThan(before);
    });
    it('keeps global operation replay scope across partitions and separate authority for a shared guardian', async () => {
        const f = await fixture(), alice = await f.enroll('alice');
        const firstAuth = f.proofs.get(alice.proof), conflicting = await f.begin('bravo', { operationRef: firstAuth.operationRef });
        expect(conflicting.result.ok).toBe(false); expect([...f.storage.snapshot().keys()].filter(key => key.startsWith(`${PREFIX}record:`))).toHaveLength(1);
        const bravo = await f.enroll('bravo');
        const replay = await f.ledger.complete(alice.decisionProof); expect(replay.ok).toBe(true);
        const pending = await f.begin('charlie'); const reused = await f.complete(pending, { operationRef: f.decisions.get(alice.decisionProof).operationRef }); expect(reused.result.ok).toBe(false);
        const reusedDecision = await f.complete(pending, { decisionRef: f.decisions.get(alice.decisionProof).decisionRef }); expect(reusedDecision.result.ok).toBe(false);
        const aliceAuth = f.guardianProof(alice), bravoSubject = f.record(bravo)[1].subjects[0].record;
        f.guardians.get(aliceAuth.proof).subjectRef = bravoSubject.subjectRef;
        expect((await f.ledger.change(aliceAuth.proof, { expectedRevision: bravoSubject.revision, purposes: [] })).ok).toBe(false);
        expect((await f.read([alice, bravo])).subjects.every(subject => subject.state === 'authorized')).toBe(true);
    });
    it.each(['pending', 'guardian', 'consent'])('preserves global %s reference collision refusal across separate records', async kind => {
        const f = await fixture(), alice = await f.enroll('alice'), state = f.record(alice)[1], proof = 'synthetic_collision_authority';
        if (kind === 'pending') {
            f.proofs.set(proof, { operationRef: 'synthetic_unique_operation', principalRef: 'synthetic_principal_collision', communityRef: f.config.policy.communityRef, expiresAt: f.now() + 10000 });
            f.force(['synthetic_unique_subject', state.pending[0].pendingRef]); const before = f.storage.snapshot();
            expect((await f.ledger.begin(proof, { expectedRevision: 0, purposes: [...PARTICIPATION_PURPOSES] })).ok).toBe(false); expect(f.storage.snapshot()).toEqual(before);
        } else {
            const pending = await f.begin('bravo');
            f.force(kind === 'guardian' ? [state.guardians[0].guardianRef] : ['synthetic_unique_guardian', state.receipts[0].consentRef]);
            // Supply the fixed decision proof directly so forced refs belong to
            // the real C2 identifier calls, not this fixture's proof generator.
            f.decisions.set(proof, { operationRef: 'synthetic_unique_operation', pendingRef: pending.result.pendingRef, subjectRef: pending.result.subjectRef,
                principalRef: pending.principalRef, guardianPrincipalRef: 'synthetic_shared_guardian', decisionRef: 'synthetic_unique_decision', verifierRef: f.config.rules.verifierRef,
                status: 'approved', purposes: [...PARTICIPATION_PURPOSES], verifiedAt: f.now(), expiresAt: f.now() + 10000 });
            const before = f.storage.snapshot(); expect((await f.ledger.complete(proof)).ok).toBe(false); expect(f.storage.snapshot()).toEqual(before);
        }
    });
    it('fails closed on hash-key/index mismatches, missing grant indices and corrupt operation deadlines', async () => {
        for (const damage of ['subject', 'decision', 'operation']) {
            const f = await fixture(), alice = await f.enroll('alice');
            const [key, index] = [...f.storage.snapshot()].find(([key]) => key.startsWith(`${PREFIX}${damage === 'decision' ? 'unique:decision' : damage}:`));
            await f.storage.transaction(tx => damage === 'operation' ? tx.put(key, { ...index, deleteAt: index.deleteAt + 1 }) : tx.put(key,
                damage === 'subject' ? { ...index, subjectRef: 'synthetic_different_subject' } : { ...index, reference: 'synthetic_other_verifier\0synthetic_other_decision' }));
            if (damage === 'operation') expect((await f.ledger.begin(alice.proof, { expectedRevision: 0, purposes: [...PARTICIPATION_PURPOSES] })).ok).toBe(false);
            else expect((await f.read([alice])).ok).toBe(false);
        }
        const missing = await fixture(), person = await missing.enroll('missing');
        const key = [...missing.storage.snapshot().keys()].find(key => key.startsWith(`${PREFIX}unique:consent:`)); await missing.storage.transaction(tx => tx.delete(key));
        expect((await missing.read([person])).ok).toBe(false); expect((await missing.ledger.lookup(person.proof)).ok).toBe(false);
        const pending = await fixture(), waiting = await pending.begin('missingpending');
        const pendingKey = [...pending.storage.snapshot().keys()].find(key => key.startsWith(`${PREFIX}unique:pending:`));
        await pending.storage.transaction(tx => tx.delete(pendingKey)); const before = pending.storage.snapshot();
        expect((await pending.complete(waiting)).result.ok).toBe(false); expect(pending.storage.snapshot()).toEqual(before);
    });
    it('refuses missing/corrupt routing, subject-reference collisions and allocation/storage failures without replacement grants', async () => {
        const f = await fixture(), alice = await f.enroll('alice'); const before = f.storage.snapshot();
        f.storage.failNext(); expect((await f.begin('failed')).result.ok).toBe(false); expect(f.storage.snapshot()).toEqual(before);
        f.controls.failAllocation = true; expect((await f.begin('quota')).result.ok).toBe(false); expect(f.storage.snapshot()).toEqual(before); f.controls.failAllocation = false;
        // Force only the actual subject identifier, not any raw client field.
        const proof = 'synthetic_collision_proof'; f.proofs.set(proof, { operationRef: 'synthetic_collision_operation', principalRef: 'synthetic_principal_collision', communityRef: f.config.policy.communityRef, expiresAt: f.now() + 10000 });
        f.force([f.record(alice)[1].subjects[0].record.subjectRef]);
        expect((await f.ledger.begin(proof, { expectedRevision: 0, purposes: [...PARTICIPATION_PURPOSES] })).ok).toBe(false); expect(f.storage.snapshot()).toEqual(before);
        const [key] = f.record(alice); await f.storage.transaction(tx => tx.delete(key));
        expect((await f.read([alice])).ok).toBe(false);
        const rebegin = f.proofs.get(alice.proof); rebegin.operationRef = 'synthetic_rebegin_operation';
        expect((await f.ledger.begin(alice.proof, { expectedRevision: 0, purposes: [...PARTICIPATION_PURPOSES] })).ok).toBe(false);
        expect(f.storage.snapshot().has(key)).toBe(false);
    });
    it('rolls back C3 effects on transaction failure and validates session roles in the same domain', async () => {
        const f = await fixture(), alice = await f.enroll('alice'); await f.connect(alice); f.frames.length = 0;
        const gate = held(); f.controls.beforeCommit = gate;
        const pending = f.message(alice, { t: 'say', ch: '#stalemate', text: 'Failed transaction cannot publish' }); await gate.entered;
        await f.storage.transaction(async tx => { const session = await tx.get(`session:${alice.id}`); session.role = 'moderator'; await tx.put(`session:${alice.id}`, session); });
        gate.release(); expect((await pending).ok).toBe(false); expect(f.frames.some(frame => frame.t === 'line')).toBe(false);
        expect(JSON.stringify([...f.storage.snapshot()])).not.toContain('Failed transaction cannot publish');
    });
    it('sweeps bounded pages only after finite retention, atomically removes indices and rejects unauthorized/corrupt pages', async () => {
        const f = await fixture({ short: true }), people = [];
        for (let n = 0; n < 5; n++) people.push(await f.enroll(`short${n}`));
        const records = () => [...f.storage.snapshot().keys()].filter(key => key.startsWith(`${PREFIX}record:`));
        f.advance(400); expect((await f.ledger.sweep('maintenance', { limit: 2 })).examined).toBe(2); expect(records()).toHaveLength(5);
        f.controls.maintenance = false; expect((await f.ledger.sweep('maintenance')).ok).toBe(false); expect(records()).toHaveLength(5); f.controls.maintenance = true;
        expect((await f.ledger.sweep('maintenance', { limit: 5 })).ok).toBe(false);
        f.advance(1000); let cursor = '', examined = 0;
        do { const result = await f.ledger.sweep('maintenance', { cursor, limit: 2 }); expect(result.ok).toBe(true); examined += result.examined; cursor = result.nextCursor; } while (cursor);
        expect(examined).toBe(5); expect(records()).toEqual([]);
        expect([...f.storage.snapshot().keys()].filter(key => key.startsWith(PREFIX) && key !== PARTICIPATION_POLICY_KEY)).toEqual([]);
        expect(f.storage.metrics.filter(metric => metric.lists).every(metric => metric.limit <= 4)).toBe(true);
        const corrupt = await fixture({ short: true }); for (let n = 0; n < 3; n++) await corrupt.enroll(`bad${n}`);
        const before = corrupt.storage.snapshot(); corrupt.storage.badList(); expect((await corrupt.ledger.sweep('maintenance', { limit: 2 })).ok).toBe(false); expect(corrupt.storage.snapshot()).toEqual(before);
    });
    it('rechecks authority expiry after awaited transactional allocation without acknowledging a late grant', async () => {
        const f = await fixture(); f.controls.expireAllocation = true; const before = f.storage.snapshot();
        expect((await f.begin('expired')).result.ok).toBe(false); expect(f.storage.snapshot()).toEqual(before);
    });
    it.each(['policy', 'grant'])('refuses %s expiry during final storage writes even while authentication is current', async kind => {
        const f = await fixture();
        if (kind === 'policy') {
            f.config.policy = { ...f.config.policy, revision: 2, policyVersion: 'short-policy-v2', expiresAt: START + 100, maxSessionMs: 100 };
            expect((await f.ledger.installPolicy('operator')).ok).toBe(true);
            const proof = 'synthetic_long_lived_auth'; f.proofs.set(proof, { operationRef: 'synthetic_expiry_operation', principalRef: 'synthetic_principal_expiry', communityRef: f.config.policy.communityRef, expiresAt: START + 2000000 });
            const before = f.storage.snapshot(); f.storage.afterPut(key => { if (key.startsWith(`${PREFIX}record:`)) f.advance(101); });
            expect((await f.ledger.begin(proof, { expectedRevision: 0, purposes: [...PARTICIPATION_PURPOSES] })).ok).toBe(false);
            expect(f.proofs.get(proof).expiresAt).toBeGreaterThan(f.now()); expect(f.storage.snapshot()).toEqual(before);
        } else {
            const pending = await f.begin('expiry'), before = f.storage.snapshot();
            f.storage.afterPut(key => { if (key.startsWith(`${PREFIX}record:`)) f.advance(500001); });
            const completed = await f.complete(pending, { expiresAt: START + 2000000 });
            expect(completed.result.ok).toBe(false); expect(f.decisions.get(completed.proof).expiresAt).toBeGreaterThan(f.now());
            expect(f.config.policy.expiresAt).toBeGreaterThan(f.now()); expect(f.storage.snapshot()).toEqual(before);
        }
    });
    it.each(['reads', 'writes'])('bounds allocation-hook %s within the record transaction and rolls back excess', async flood => {
        const f = await fixture(); f.controls.flood = flood; const before = f.storage.snapshot();
        expect((await f.begin('flood')).result.ok).toBe(false); expect(f.storage.snapshot()).toEqual(before);
        expect(f.storage.metrics.every(metric => metric.reads <= 160 && metric.puts + metric.deletes <= 160)).toBe(true);
    });
    it('does not recreate or widen withdrawn records while lazily aligning a newer policy', async () => {
        const f = await fixture(), alice = await f.enroll('alice'); expect((await f.withdraw(alice)).state).toBe('withdrawn');
        const subject = clone(f.record(alice)[1].subjects[0].record);
        f.config.policy = { ...f.config.policy, revision: 2, policyVersion: 'partition-test-v2' }; expect((await f.ledger.installPolicy('operator')).ok).toBe(true);
        const current = await f.ledger.lookup(alice.proof); expect(current.subject).toEqual(subject); expect((await f.read([alice])).subjects).toEqual([null]);
    });
    it('reclaims qualified active-record allocation only with final retained-data deletion, atomically and once', async () => {
        const f = await fixture({ short: true, capacity: 2 }); f.controls.reclaim = true;
        const alice = await f.enroll('alice'); await f.enroll('bravo'); expect((await f.begin('third')).result.ok).toBe(false);
        expect((await f.withdraw(alice)).state).toBe('withdrawn'); f.advance(150);
        expect((await f.ledger.sweep('maintenance')).ok).toBe(true);
        expect(f.storage.snapshot().get('synthetic-allocation-count')).toBe(2); expect((await f.begin('thirdAgain')).result.ok).toBe(false);
        f.advance(500); f.controls.failRelease = true; const before = f.storage.snapshot();
        expect((await f.ledger.sweep('maintenance')).ok).toBe(false); expect(f.storage.snapshot()).toEqual(before);
        f.controls.failRelease = false; expect((await f.ledger.sweep('maintenance')).ok).toBe(true); expect(f.storage.snapshot().get('synthetic-allocation-count')).toBe(0);
        expect((await f.ledger.sweep('maintenance')).ok).toBe(true); expect(f.storage.snapshot().get('synthetic-allocation-count')).toBe(0);
        expect((await f.begin('newAfterCleanup')).result.ok).toBe(true); expect(f.storage.snapshot().get('synthetic-allocation-count')).toBe(1);
    });
    it('allows expired operation references to be reused without old-partition cleanup deleting the new owner', async () => {
        const f = await fixture({ short: true }), alice = await f.enroll('alice'), operationRef = f.proofs.get(alice.proof).operationRef;
        f.advance(150); const bravo = await f.begin('bravo', { operationRef }); expect(bravo.result.ok).toBe(true);
        const [key] = [...f.storage.snapshot()].find(([key, value]) => key.startsWith(`${PREFIX}operation:`) && value.operationRef === operationRef);
        const owned = clone(f.storage.snapshot().get(key)); expect(owned.principalRef).toBe(bravo.principalRef);
        expect((await f.ledger.lookup(alice.proof)).ok).toBe(true); expect(f.storage.snapshot().get(key)).toEqual(owned);
        expect((await f.complete(bravo)).result.state).toBe('authorized');
    });
});
