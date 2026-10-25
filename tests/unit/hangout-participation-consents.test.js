// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createParticipationConsents, PARTICIPATION_LEDGER_KEY } from '../../hangout-worker/src/participation-consents.mjs';
import { PARTICIPATION_PURPOSES, PARTICIPATION_AUDIENCE, resolveParticipation } from '../../hangout-worker/src/participation-policy.mjs';

// A serializable staged-commit store shared by independent ledger instances.
// This proves the injected transaction contract, not hosted storage durability.
function transactionStore() {
    let committed = new Map(), tail = Promise.resolve(), gate = null, failure = '';
    const copy = value => structuredClone(value);
    return {
        transaction(operation) {
            const run = tail.then(async () => {
                const staged = copy(committed);
                const result = await operation({ get: async key => copy(staged.get(key)), put: async (key, value) => staged.set(key, copy(value)) });
                if (gate) { const held = gate; gate = null; held.enter(); await held.promise; }
                const mode = failure; failure = '';
                if (mode === 'before') throw Error('Synthetic commit failure');
                committed = staged;
                if (mode === 'after') throw Error('Synthetic lost commit acknowledgement');
                return result;
            });
            tail = run.catch(() => {}); return run;
        },
        snapshot: () => copy(committed.get(PARTICIPATION_LEDGER_KEY)),
        corrupt: fn => { const state = copy(committed.get(PARTICIPATION_LEDGER_KEY)); fn(state); committed.set(PARTICIPATION_LEDGER_KEY, state); },
        failNext: mode => { failure = mode; },
        holdNext() {
            let enter, release; const entered = new Promise(resolve => { enter = resolve; }), promise = new Promise(resolve => { release = resolve; });
            gate = { enter, promise }; return { entered, release };
        }
    };
}
const START = 1800000000000;
function setup(limits) {
    let time = START, serial = 0;
    const reference = () => `synthetic_reference_${String(++serial).padStart(6, '0')}`;
    const storage = transactionStore(), participants = new Map(), decisions = new Map(), guardians = new Map(), policies = new Map();
    const config = { policy: { version: 1, policyVersion: 'synthetic-policy-v1', revision: 1, communityRef: 'synthetic_shared_community',
        noticeDigest: 'a'.repeat(64), decisionRef: 'synthetic_operator_decision', state: 'qualified', purposes: [...PARTICIPATION_PURPOSES],
        issuedAt: START - 100, effectiveAt: START - 100, expiresAt: START + 100000, maxSessionMs: 1000 },
    rules: { version: 1, verifierRef: 'synthetic_verified_adapter', pendingMs: 1000, grantMs: 5000,
        subjectTailMs: 10000, guardianTailMs: 10000, receiptTailMs: 10000, callbackMs: 1000, operationMs: 2000 } };
    policies.set('private-operator-proof', config);
    const adapters = {
        qualifyPolicy: async ({ proof }) => ({ config: policies.get(proof), expiresAt: time + 100000 }),
        authenticateParticipant: async ({ proof, purpose }) => {
            const identity = participants.get(proof); if (!identity) return null;
            return purpose === 'begin' ? identity : { principalRef: identity.principalRef, communityRef: identity.communityRef, expiresAt: identity.expiresAt };
        },
        verifyConsent: async ({ proof }) => decisions.get(proof),
        authenticateGuardian: async ({ proof }) => guardians.get(proof)
    };
    const instance = (overrideLimits = limits) => createParticipationConsents({ storage, adapters, now: () => time, randomRef: reference, limits: overrideLimits });
    const ledger = instance();
    const participant = (principalRef = 'synthetic_child_principal') => {
        const proof = `private-participant-proof-${++serial}`;
        participants.set(proof, { operationRef: reference(), principalRef, communityRef: config.policy.communityRef, expiresAt: time + 100000 }); return proof;
    };
    const verifier = (pending, changes = {}) => {
        const item = storage.snapshot().pending.find(item => item.pendingRef === pending.pendingRef);
        const proof = `private-verifier-proof-${++serial}`;
        decisions.set(proof, { operationRef: reference(), pendingRef: item.pendingRef, subjectRef: item.subjectRef, principalRef: item.principalRef,
            guardianPrincipalRef: 'synthetic_guardian_principal', decisionRef: reference(), verifierRef: item.verifierRef,
            status: 'approved', purposes: [...item.purposes], verifiedAt: time, expiresAt: time + 5000, ...changes }); return proof;
    };
    const guardian = (changes = {}) => {
        const item = storage.snapshot().guardians.at(-1), proof = `private-guardian-proof-${++serial}`;
        guardians.set(proof, { operationRef: reference(), subjectRef: item.subjectRef, principalRef: item.principalRef,
            guardianRef: item.guardianRef, guardianRevision: item.revision, expiresAt: time + 1000, ...changes }); return proof;
    };
    const enroll = async (purposes = [...PARTICIPATION_PURPOSES], principal) => {
        const proof = participant(principal), pending = await ledger.begin(proof, { expectedRevision: 0, purposes });
        const verification = verifier(pending), result = await ledger.complete(verification);
        return { proof, pending, verification, result };
    };
    return { storage, adapters, ledger, instance, config, policies, decisions, guardians, participants, participant, verifier, guardian, enroll,
        initialize: () => ledger.installPolicy('private-operator-proof'), advance: ms => { time += ms; }, now: () => time };
}
function evaluate(lookup, now, bindingRevision = lookup.subject.revision) {
    const { subject, policy } = lookup;
    const binding = { version: 1, audience: PARTICIPATION_AUDIENCE, subjectRef: subject.subjectRef, principalRef: subject.principalRef,
        communityRef: subject.communityRef, policyVersion: subject.policyVersion, policyRevision: subject.policyRevision, noticeDigest: subject.noticeDigest,
        subjectRevision: bindingRevision, purposes: [...subject.purposes], issuedAt: now, effectiveAt: now, expiresAt: Math.min(subject.expiresAt, now + 1000) };
    return resolveParticipation({ action: 'publicText', now, policy, subject, binding, authority: { global: true, room: true, actor: true },
        safeguards: { available: true, quota: true, content: true, provider: 'off', publicTextEligible: false } });
}

describe('inactive durable participation ledger', () => {
    it('requires explicit trusted adapters/qualified policy and creates only a pending record on authenticated entry', async () => {
        const f = setup(), proof = f.participant();
        expect(() => createParticipationConsents({ storage: f.storage })).toThrow();
        expect(await f.ledger.lookup(proof)).toEqual({ ok: false, reason: 'not-initialized' });
        expect(await f.ledger.installPolicy({ qualified: true })).toEqual({ ok: false, reason: 'not-authorized' });
        expect(await f.initialize()).toEqual({ ok: true, policyRevision: 1 });
        expect((await f.ledger.begin(proof, { expectedRevision: 0, purposes: ['public-text', 'public-disclosure'] })).state).toBe('pending');
        const lookup = await f.ledger.lookup(proof);
        expect(evaluate(lookup, f.now()).allowed).toBe(false);
        expect(f.storage.snapshot().receipts).toEqual([]); expect(f.storage.snapshot().guardians).toEqual([]);
    });

    it('commits subject, guardian, receipt and callback idempotency together before returning success', async () => {
        const f = setup(); await f.initialize(); const proof = f.participant();
        const pending = await f.ledger.begin(proof, { expectedRevision: 0, purposes: [...PARTICIPATION_PURPOSES] });
        const verification = f.verifier(pending), hold = f.storage.holdNext(); let settled = false;
        const completion = f.ledger.complete(verification).then(result => { settled = true; return result; });
        await hold.entered;
        expect(settled).toBe(false); expect(f.storage.snapshot().subjects[0].record.state).toBe('pending');
        expect(f.storage.snapshot().receipts).toEqual([]); expect(f.storage.snapshot().operations.filter(item => item.kind === 'complete')).toEqual([]);
        hold.release(); expect((await completion).state).toBe('authorized');
        const saved = f.storage.snapshot(); expect(saved.receipts).toHaveLength(1); expect(saved.guardians).toHaveLength(1);
        expect(saved.operations.filter(item => item.kind === 'complete')).toHaveLength(1);
        expect(evaluate(await f.ledger.lookup(proof), f.now())).toEqual({ allowed: true, reason: 'allowed' });
    });

    it.each(['before', 'after'])('handles %s-commit failure without a false acknowledgement or duplicate authorization', async mode => {
        const f = setup(); await f.initialize(); const proof = f.participant();
        const pending = await f.ledger.begin(proof, { expectedRevision: 0, purposes: [...PARTICIPATION_PURPOSES] }), verification = f.verifier(pending);
        f.storage.failNext(mode);
        expect(await f.ledger.complete(verification)).toEqual({ ok: false, reason: 'unavailable' });
        expect(f.storage.snapshot().receipts).toHaveLength(mode === 'before' ? 0 : 1);
        expect((await f.instance().complete(verification)).state).toBe('authorized');
        expect(f.storage.snapshot().subjects[0].record.revision).toBe(2); expect(f.storage.snapshot().receipts).toHaveLength(1);
    });

    it('serializes duplicate and competing callbacks across independent instances', async () => {
        const f = setup(); await f.initialize(); const proof = f.participant();
        const pending = await f.ledger.begin(proof, { expectedRevision: 0, purposes: [...PARTICIPATION_PURPOSES] }), a = f.verifier(pending), b = f.verifier(pending);
        const results = await Promise.all([f.ledger.complete(a), f.instance().complete(a), f.instance().complete(b)]);
        expect(results.filter(result => result.ok)).toHaveLength(2); expect(results[0]).toEqual(results[1]);
        expect(results[2]).toEqual({ ok: false, reason: 'stale-or-unmatched-decision' });
        expect(f.storage.snapshot().receipts).toHaveLength(1); expect(f.storage.snapshot().guardians).toHaveLength(1);
    });

    it('rejects request-selected identity, verifier/guardian booleans, raw proof and extra collection fields', async () => {
        const f = setup(); await f.initialize(); const proof = f.participant();
        for (const extra of [{ subjectRef: 'synthetic_someone_else' }, { age13: true }, { guardianVerified: true }, { email: 'must-not-collect@example.invalid' }])
            expect(await f.ledger.begin(proof, { expectedRevision: 0, purposes: ['public-text'], ...extra })).toEqual({ ok: false, reason: 'invalid-request' });
        const pending = await f.ledger.begin(proof, { expectedRevision: 0, purposes: ['public-text', 'public-disclosure'] });
        expect(await f.ledger.complete({ pendingRef: pending.pendingRef, approved: true })).toEqual({ ok: false, reason: 'not-authorized' });
        const verification = f.verifier(pending, { rawProof: 'private verification transcript' });
        expect(await f.ledger.complete(verification)).toEqual({ ok: false, reason: 'not-authorized' });
        expect(f.storage.snapshot().subjects[0].record.state).toBe('pending'); expect(f.storage.snapshot().receipts).toEqual([]);
    });

    it('rejects mismatched, late, widened and out-of-order verifier decisions', async () => {
        const f = setup(); await f.initialize(); const proof = f.participant();
        const pending = await f.ledger.begin(proof, { expectedRevision: 0, purposes: ['public-text', 'public-disclosure'] });
        for (const changes of [{ subjectRef: 'synthetic_someone_else' }, { principalRef: 'synthetic_someone_else' }, { verifierRef: 'synthetic_other_verifier' },
            { verifiedAt: f.now() - 1 }, { verifiedAt: f.now() + 1 }, { expiresAt: f.now() }, { purposes: ['direct-contact'] }]) {
            expect((await f.ledger.complete(f.verifier(pending, changes))).ok).toBe(false);
        }
        const oldCallback = f.verifier(pending), replacement = await f.ledger.begin(f.participant(), { expectedRevision: 1, purposes: ['public-text', 'public-disclosure'] });
        expect(await f.ledger.complete(oldCallback)).toEqual({ ok: false, reason: 'stale-or-unmatched-decision' });
        expect((await f.ledger.complete(f.verifier(replacement)))).toMatchObject({ ok: true, revision: 3, state: 'authorized' });
        expect(f.storage.snapshot().receipts).toHaveLength(1);
    });

    it('makes withdrawal durable/idempotent, stops old callbacks and does not cache authority across restart', async () => {
        const f = setup(); await f.initialize(); const enrolled = await f.enroll(), original = await f.ledger.lookup(enrolled.proof), right = f.guardian();
        const request = { expectedRevision: 2, purposes: [] };
        expect(await f.ledger.change(right, request)).toMatchObject({ ok: true, state: 'withdrawn', revision: 3 });
        const deleteAt = f.storage.snapshot().subjects[0].deleteAt; f.advance(100);
        expect(await f.instance().change(right, request)).toMatchObject({ ok: true, state: 'withdrawn', revision: 3 });
        expect(f.storage.snapshot().subjects[0].deleteAt).toBe(deleteAt);
        expect(await f.instance().complete(enrolled.verification)).toEqual({ ok: false, reason: 'superseded' });
        for (const ledger of [f.ledger, f.instance()]) {
            const lookup = await ledger.lookup(enrolled.proof); expect(lookup.subject.state).toBe('withdrawn');
            expect(evaluate(lookup, f.now(), original.subject.revision).allowed).toBe(false);
        }
        expect(f.storage.snapshot().receipts[0].state).toBe('withdrawn');
    });

    it('withdraws a replacement pending transaction before its delayed approval can run', async () => {
        const f = setup(); await f.initialize(); await f.enroll(); const right = f.guardian();
        const pending = await f.ledger.begin(f.participant(), { expectedRevision: 2, purposes: [...PARTICIPATION_PURPOSES] }), callback = f.verifier(pending);
        expect(await f.instance().change(right, { expectedRevision: 3, purposes: [] })).toMatchObject({ ok: true, state: 'withdrawn', revision: 4 });
        expect(await f.ledger.complete(callback)).toEqual({ ok: false, reason: 'stale-or-unmatched-decision' });
        expect(f.storage.snapshot().receipts.filter(item => item.state === 'active')).toEqual([]);
    });

    it('rechecks ledger withdrawal after verifier authentication has already started', async () => {
        const f = setup(); await f.initialize(); await f.enroll(); const right = f.guardian();
        const pending = await f.ledger.begin(f.participant(), { expectedRevision: 2, purposes: [...PARTICIPATION_PURPOSES] }), callback = f.verifier(pending);
        let release, entered;
        const authenticated = new Promise(resolve => { entered = resolve; }), held = new Promise(resolve => { release = resolve; });
        f.adapters.verifyConsent = async ({ proof }) => { const decision = structuredClone(f.decisions.get(proof)); entered(); await held; return decision; };
        const completion = f.ledger.complete(callback); await authenticated;
        expect((await f.instance().change(right, { expectedRevision: 3, purposes: [] })).state).toBe('withdrawn');
        release(); expect(await completion).toEqual({ ok: false, reason: 'stale-or-unmatched-decision' });
    });

    it('checks authentication expiry inside the storage queue rather than trusting an earlier adapter response', async () => {
        const f = setup(); await f.initialize(); const proof = f.participant();
        f.participants.get(proof).expiresAt = f.now() + 50;
        const hold = f.storage.holdNext(), blocker = f.ledger.sweep(); await hold.entered;
        const pending = f.ledger.begin(proof, { expectedRevision: 0, purposes: ['public-text', 'public-disclosure'] });
        f.advance(50); hold.release(); await blocker;
        expect(await pending).toEqual({ ok: false, reason: 'not-authorized' }); expect(f.storage.snapshot().subjects).toEqual([]);
        await f.enroll([...PARTICIPATION_PURPOSES], 'synthetic_other_principal');
        const right = f.guardian({ expiresAt: f.now() + 50 }), secondHold = f.storage.holdNext(), secondBlocker = f.ledger.sweep(); await secondHold.entered;
        const withdrawal = f.ledger.change(right, { expectedRevision: 2, purposes: [] }); f.advance(50); secondHold.release(); await secondBlocker;
        expect(await withdrawal).toEqual({ ok: false, reason: 'not-authorized' });
        expect(f.storage.snapshot().subjects[0].record.state).toBe('authorized');
    });

    it('does not reuse the same verified consent decision for another pending transaction', async () => {
        const f = setup(); await f.initialize(); const first = await f.enroll();
        const oldDecision = f.decisions.get(first.verification).decisionRef;
        const pending = await f.ledger.begin(f.participant(), { expectedRevision: 2, purposes: [...PARTICIPATION_PURPOSES] });
        expect(await f.ledger.complete(f.verifier(pending, { decisionRef: oldDecision }))).toEqual({ ok: false, reason: 'reused-decision' });
        expect(f.storage.snapshot().subjects[0].record.state).toBe('pending'); expect(f.storage.snapshot().receipts).toHaveLength(1);
    });

    it('does not acknowledge a failed withdrawal commit and can retry the exact reduction', async () => {
        const f = setup(); await f.initialize(); await f.enroll(); const right = f.guardian(), request = { expectedRevision: 2, purposes: [] };
        f.storage.failNext('before'); expect(await f.ledger.change(right, request)).toEqual({ ok: false, reason: 'unavailable' });
        expect(f.storage.snapshot().subjects[0].record.state).toBe('authorized');
        expect(await f.instance().change(right, request)).toMatchObject({ ok: true, state: 'withdrawn', revision: 3 });
    });

    it('narrows purposes with revision checks while refusing a different guardian, stale changes or widening', async () => {
        const f = setup(); await f.initialize(); const enrolled = await f.enroll(), right = f.guardian();
        const narrow = { expectedRevision: 2, purposes: ['public-text', 'public-disclosure'] };
        expect(await f.ledger.change(f.guardian({ principalRef: 'synthetic_someone_else' }), narrow)).toEqual({ ok: false, reason: 'not-authorized' });
        expect(await f.ledger.change(right, narrow)).toMatchObject({ ok: true, state: 'authorized', revision: 3 });
        expect(await f.ledger.change(right, narrow)).toMatchObject({ ok: true, revision: 3 });
        expect(await f.ledger.change(f.guardian(), { expectedRevision: 3, purposes: [...PARTICIPATION_PURPOSES] })).toEqual({ ok: false, reason: 'purpose-widening' });
        expect(await f.ledger.change(f.guardian(), { expectedRevision: 2, purposes: [] })).toEqual({ ok: false, reason: 'revision-conflict' });
        expect(evaluate(await f.ledger.lookup(enrolled.proof), f.now()).allowed).toBe(true);
        expect(f.storage.snapshot().receipts[0].purposes).toContain('direct-contact'); // Original consent is not rewritten as a new approval.
    });

    it('atomically invalidates grants and pending callbacks on policy change and rejects stale/conflicting installs', async () => {
        const f = setup(); await f.initialize(); const enrolled = await f.enroll();
        const second = await f.ledger.begin(f.participant('synthetic_second_principal'), { expectedRevision: 0, purposes: ['public-text', 'public-disclosure'] }), callback = f.verifier(second);
        const changed = structuredClone(f.config); changed.policy.revision = 2; changed.policy.policyVersion = 'synthetic-policy-v2'; changed.policy.noticeDigest = 'b'.repeat(64);
        f.policies.set('private-new-policy-proof', changed);
        expect(await f.instance().installPolicy('private-new-policy-proof')).toEqual({ ok: true, policyRevision: 2 });
        expect((await f.ledger.lookup(enrolled.proof)).subject.state).toBe('policy-review-required');
        expect(await f.ledger.complete(callback)).toEqual({ ok: false, reason: 'stale-or-unmatched-decision' });
        expect(await f.ledger.installPolicy('private-operator-proof')).toEqual({ ok: false, reason: 'stale-policy' });
        const conflict = structuredClone(changed); conflict.policy.noticeDigest = 'c'.repeat(64); f.policies.set('private-conflict-proof', conflict);
        expect(await f.ledger.installPolicy('private-conflict-proof')).toEqual({ ok: false, reason: 'policy-conflict' });
        expect(f.storage.snapshot().receipts[0].state).toBe('policy-review-required');
    });

    it('allows an authenticated withdrawal while the service policy is inactive', async () => {
        const f = setup(); await f.initialize(); await f.enroll(); const right = f.guardian(), stopped = structuredClone(f.config);
        stopped.policy.state = 'withdrawn'; stopped.policy.revision = 2; f.policies.set('private-stopped-policy', stopped);
        await f.ledger.installPolicy('private-stopped-policy');
        expect(await f.ledger.change(right, { expectedRevision: 3, purposes: [] })).toMatchObject({ ok: true, state: 'withdrawn' });
    });

    it('expires pending work at its exact deadline and deletes only under explicit finite retention deadlines', async () => {
        const f = setup(); await f.initialize(); const proof = f.participant();
        const pending = await f.ledger.begin(proof, { expectedRevision: 0, purposes: ['public-text', 'public-disclosure'] }), callback = f.verifier(pending);
        f.advance(1000); await f.ledger.sweep();
        expect(f.storage.snapshot().pending[0].state).toBe('expired'); expect(f.storage.snapshot().subjects[0].record.state).toBe('expired');
        expect(await f.ledger.complete(callback)).toEqual({ ok: false, reason: 'stale-or-unmatched-decision' });
        f.advance(1000); await f.ledger.sweep(); expect(f.storage.snapshot().pending).toEqual([]); expect(f.storage.snapshot().operations).toEqual([]);
        expect(f.storage.snapshot().subjects).toHaveLength(1);
        f.advance(9000); await f.ledger.sweep(); expect(f.storage.snapshot().subjects).toEqual([]);
        expect(await f.ledger.lookup(proof)).toEqual({ ok: false, reason: 'not-found' });
    });

    it('expires active grants/guardians and cannot revive them with a replay after cleanup', async () => {
        const f = setup(); await f.initialize(); const enrolled = await f.enroll();
        f.advance(5000); const lookup = await f.instance().lookup(enrolled.proof);
        expect(lookup.subject.state).toBe('expired'); expect(evaluate(lookup, f.now()).allowed).toBe(false);
        expect(f.storage.snapshot().receipts[0].state).toBe('expired'); expect(f.storage.snapshot().guardians[0].state).toBe('expired');
        f.advance(10000); await f.ledger.sweep();
        for (const kind of ['subjects', 'receipts', 'guardians', 'pending', 'operations']) expect(f.storage.snapshot()[kind]).toEqual([]);
        expect((await f.ledger.complete(enrolled.verification)).ok).toBe(false);
    });

    it('preserves accepted records on capacity failure and allows withdrawal even when operation slots are full', async () => {
        const f = setup({ receipts: 1, operations: 3 }); await f.initialize(); const first = await f.enroll(), originalReceipt = f.storage.snapshot().receipts[0];
        const second = await f.ledger.begin(f.participant('synthetic_second_principal'), { expectedRevision: 0, purposes: ['public-text', 'public-disclosure'] });
        expect(second.ok).toBe(true); expect(f.storage.snapshot().operations).toHaveLength(3);
        expect(await f.ledger.complete(f.verifier(second))).toEqual({ ok: false, reason: 'capacity-or-invalid-state' });
        expect(f.storage.snapshot().receipts).toEqual([originalReceipt]); expect(f.storage.snapshot().subjects[1].record.state).toBe('pending');
        expect(await f.ledger.change(f.guardian(), { expectedRevision: first.result.revision, purposes: [] })).toMatchObject({ ok: true, state: 'withdrawn' });
        expect(f.storage.snapshot().operations).toHaveLength(3);
        f.advance(15000); await f.ledger.sweep();
        const next = await f.enroll(['public-text', 'public-disclosure'], 'synthetic_third_principal'); expect(next.result.ok).toBe(true);
    });

    it('refuses byte growth without consuming the headroom needed for a rights reduction', async () => {
        const f = setup(); await f.initialize(); await f.enroll();
        const bytes = new TextEncoder().encode(JSON.stringify(f.storage.snapshot())).byteLength;
        const bounded = f.instance({ bytes: bytes + 64 }), before = f.storage.snapshot();
        expect(await bounded.begin(f.participant('synthetic_other_principal'), { expectedRevision: 0, purposes: ['public-text'] }))
            .toEqual({ ok: false, reason: 'capacity-or-invalid-state' });
        expect(f.storage.snapshot()).toEqual(before);
        expect(await bounded.change(f.guardian(), { expectedRevision: 2, purposes: [] })).toMatchObject({ ok: true, state: 'withdrawn' });
    });

    it('isolates input/output aliases, stores no proof/contact/chat and fails closed on corrupt persisted state', async () => {
        const f = setup(); await f.initialize(); const proof = f.participant(), request = { expectedRevision: 0, purposes: ['public-text', 'public-disclosure'] };
        const beginning = f.ledger.begin(proof, request); request.purposes.push('direct-contact'); const pending = await beginning;
        expect(f.storage.snapshot().pending[0].purposes).not.toContain('direct-contact');
        const verification = f.verifier(pending); await f.ledger.complete(verification); const lookup = await f.ledger.lookup(proof);
        expect(Object.isFrozen(lookup.subject.purposes)).toBe(true); expect(() => lookup.subject.purposes.push('camera')).toThrow();
        const serialized = JSON.stringify(f.storage.snapshot());
        for (const privateValue of [proof, verification, 'private-operator-proof', '@', 'rawProof', 'chat', 'email', 'dateOfBirth']) expect(serialized).not.toContain(privateValue);
        f.storage.corrupt(state => { state.receipts[0].email = 'must-not-collect@example.invalid'; });
        expect(await f.ledger.lookup(proof)).toEqual({ ok: false, reason: 'storage-corrupt' });
        expect(await f.ledger.sweep()).toEqual({ ok: false, reason: 'storage-corrupt' });
        expect(f.storage.snapshot().receipts[0].email).toBe('must-not-collect@example.invalid'); // No silent reset/repair.
    });

    it('rejects missing/nonfinite retention rules and refuses an unauthorized lookup of another principal', async () => {
        const f = setup();
        for (const value of [undefined, 0, -1, Infinity, NaN, Number.MAX_SAFE_INTEGER, true, '1000']) {
            const config = structuredClone(f.config); config.rules.receiptTailMs = value; f.policies.set('private-invalid-policy', config);
            expect(await f.ledger.installPolicy('private-invalid-policy')).toEqual({ ok: false, reason: 'not-authorized' });
        }
        await f.initialize(); await f.enroll();
        expect(await f.ledger.lookup(f.participant('synthetic_someone_else'))).toEqual({ ok: false, reason: 'not-found' });
        expect(await f.ledger.lookup({ principalRef: 'synthetic_child_principal' })).toEqual({ ok: false, reason: 'not-authorized' });
    });
});
