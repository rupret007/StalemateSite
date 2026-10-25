// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createIncidentCases, createIncidentEvidenceCipher, incidentEvidenceDigest, initialIncidentCaseState } from '../../hangout-worker/src/incident-cases.mjs';

const STORE = 'restricted-incident-cases-v1';
const enc = new TextEncoder(), dec = new TextDecoder();
const clone = value => structuredClone(value);
function storageFixture(initial) {
    let values = new Map(initial), tail = Promise.resolve(), failPut = false, failAfterCommit = false, commitGate = null;
    return {
        snapshot: () => clone(values), failPut: value => { failPut = value; }, failAfterCommit: value => { failAfterCommit = value; },
        gate: value => { commitGate = value; },
        transaction(fn) {
            const task = tail.then(async () => {
                const staged = clone(values);
                const result = await fn({ get: async key => clone(staged.get(key)),
                    put: async (key, value) => { if (failPut) throw Error('synthetic failure'); staged.set(key, clone(value)); },
                    delete: async key => staged.delete(key) });
                if (commitGate) await commitGate;
                values = staged;
                if (failAfterCommit) throw Error('synthetic lost acknowledgement');
                return clone(result);
            });
            tail = task.catch(() => {}); return task;
        }
    };
}
async function fixture({ limits = {}, hold = false, provenance = 'reported-public' } = {}) {
    let at = 1800000000000, sequence = 0, op = 0;
    const bytes = enc.encode('Benign selected synthetic report only');
    const report = { id: 'report_alpha', revision: 1, bytes, digest: await incidentEvidenceDigest(bytes), expiresAt: at + 500, provenance };
    const storage = storageFixture([[STORE, initialIncidentCaseState()], ['source:report_alpha', report]]);
    const reviewers = new Map(['alice', 'bravo'].map(actorRef => [actorRef, { actorRef, incidentReviewer: true, active: true, revision: 1,
        expiresAt: at + 100000, canOpen: true, canMaintain: actorRef === 'alice' }]));
    const base = at;
    let policy = { qualified: true, version: 'synthetic_v1', procedure: 'synthetic_only', authority: 'synthetic_authority', reason: 'selected_report',
        validFrom: at, validUntil: at + 100000, reviewAt: at + 1000, holdUntil: hold ? at + 2000 : null,
        evidenceDeleteAt: at + 3000, caseDeleteAt: at + 4000, tombstoneUntil: at + 6000, receiptUntil: at + 7000, auditUntil: at + 8000,
        limits: { maxCases: 2, maxBytes: 100000, maxEvidenceBytes: 1000, maxAuditEvents: 100, maxOperations: 100, maxTombstones: 10, ...limits } };
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const realCipher = createIncidentEvidenceCipher({ keyId: 'synthetic_ephemeral_key', key });
    const controls = { cipher: realCipher, load: ({ tx, sourceId }) => tx.get(`source:${sourceId}`), authority: ({ principal }) => reviewers.get(principal) };
    const create = () => createIncidentCases({ storage, now: () => at, newRef: kind => `${kind}_${++sequence}`,
        resolveAuthority: async args => clone(await controls.authority(args)), resolveReviewer: async ({ actorRef }) => clone(reviewers.get(actorRef)),
        policyFor: async () => clone(policy), loadEvidence: args => controls.load(args),
        cipher: { encrypt: (...args) => controls.cipher.encrypt(...args), decrypt: (...args) => controls.cipher.decrypt(...args) } });
    const model = create();
    const preserveInput = extra => ({ principal: 'alice', operationId: `op_${++op}`, sourceId: report.id, sourceRevision: report.revision, sourceDigest: report.digest, type: 'safety', ...extra });
    const request = (caseRef, expectedRevision, extra = {}) => ({ principal: 'alice', operationId: `op_${++op}`, caseRef, expectedRevision, ...extra });
    const read = (caseRef, principal = 'alice') => model.readCase({ principal, operationId: `read_${++op}`, caseRef });
    return { model, storage, reviewers, controls, realCipher, report, create, preserveInput, request, read, base,
        time: value => { at = value; }, policy: change => { policy = { ...policy, ...clone(change) }; }, getPolicy: () => clone(policy),
        state: () => storage.snapshot().get(STORE), source: () => storage.snapshot().get(`source:${report.id}`) };
}

describe('isolated incident evidence encryption', () => {
    it('requires a non-extractable AES key and binds ciphertext to case/provenance context', async () => {
        const extractable = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
        expect(() => createIncidentEvidenceCipher({ keyId: 'wrong', key: extractable })).toThrow('Purpose-specific');
        const signing = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
        expect(() => createIncidentEvidenceCipher({ keyId: 'signing', key: signing })).toThrow('Purpose-specific');
        const f = await fixture(), bytes = enc.encode('Synthetic fixture'), context = { caseRef: 'case_a', source: 'source_a' };
        const encrypted = await f.realCipher.encrypt(bytes, context);
        expect(dec.decode(await f.realCipher.decrypt(encrypted, context))).toBe('Synthetic fixture');
        await expect(f.realCipher.decrypt(encrypted, { ...context, caseRef: 'case_b' })).rejects.toThrow();
        await expect(f.realCipher.decrypt({ ...encrypted, keyId: 'other' }, context)).rejects.toThrow();
        const altered = { ...encrypted, ciphertext: `${encrypted.ciphertext[0] === 'A' ? 'B' : 'A'}${encrypted.ciphertext.slice(1)}` };
        await expect(f.realCipher.decrypt(altered, context)).rejects.toThrow();
    });
});

describe('restricted selected-report case model', () => {
    it('copies exact selected evidence atomically, separates metadata access, and retains no plaintext in case/audit storage', async () => {
        const f = await fixture({ provenance: 'unverified-private-allegation' }), input = f.preserveInput();
        const receipt = await f.model.preserveSelectedReport(input); expect(receipt).toMatchObject({ ok: true, revision: 1, action: 'preserve-selected-report' });
        const state = f.state(); expect(state.cases).toHaveLength(1); expect(state.audit).toHaveLength(1); expect(state.operations).toHaveLength(1);
        expect(JSON.stringify(state)).not.toContain(dec.decode(f.report.bytes));
        expect(state.audit[0]).toEqual({ id: input.operationId, caseRef: receipt.caseRef, actorRef: 'alice', appointmentRevision: 1, action: 'preserve-selected-report',
            reason: 'selected_report', authority: 'synthetic_authority', policyVersion: 'synthetic_v1', at: f.base, before: null, after: 1,
            deadlines: { reviewAt: f.base + 1000, holdUntil: null, evidenceDeleteAt: f.base + 3000, caseDeleteAt: f.base + 4000, tombstoneUntil: f.base + 6000 },
            outcome: 'committed', until: f.base + 8000 });
        const info = await f.read(receipt.caseRef); expect(info.case.cipher).toBeUndefined(); expect(info.case.evidence.provenance).toBe('unverified-private-allegation');
        const evidence = await f.model.readEvidence(f.request(receipt.caseRef, 1)); expect(evidence.ok).toBe(true);
        expect(dec.decode(evidence.evidence.bytes)).toBe(dec.decode(f.report.bytes));
        evidence.evidence.bytes.fill(0); info.case.access.push('unappointed');
        expect(dec.decode((await f.model.readEvidence(f.request(receipt.caseRef, 1))).evidence.bytes)).toBe(dec.decode(f.report.bytes));
        expect(f.state().cases[0].access).toEqual(['alice']); expect(f.source()).toEqual(f.report);
    });
    it('denies ordinary moderators, room hosts, site badges, forged booleans and appointed reviewers without the case ACL', async () => {
        const f = await fixture();
        for (const principal of ['moderator', 'host', 'stalemate', { actorRef: 'alice', incidentReviewer: true }, null]) {
            expect(await f.model.preserveSelectedReport(f.preserveInput({ principal }))).toEqual({ ok: false, error: 'forbidden' });
        }
        const saved = await f.model.preserveSelectedReport(f.preserveInput());
        expect(await f.read(saved.caseRef, 'bravo')).toEqual({ ok: false, error: 'forbidden' });
        expect(await f.read('case_unknown', 'bravo')).toEqual({ ok: false, error: 'forbidden' });
        expect(await f.model.readEvidence(f.request(saved.caseRef, 1, { principal: 'bravo' }))).toEqual({ ok: false, error: 'forbidden' });
        expect(await f.model.transitionReview(f.request(saved.caseRef, 1, { principal: 'bravo', status: 'triaged' }))).toEqual({ ok: false, error: 'forbidden' });
        expect(await f.model.changeHold(f.request(saved.caseRef, 1, { principal: 'bravo', state: 'active' }))).toEqual({ ok: false, error: 'forbidden' });
        expect(await f.model.setAccess(f.request(saved.caseRef, 1, { principal: 'bravo', actorRefs: ['alice', 'bravo'] }))).toEqual({ ok: false, error: 'forbidden' });
        expect(await f.model.cleanupCase(f.request(saved.caseRef, 1, { principal: 'bravo' }))).toEqual({ ok: false, error: 'forbidden' });
        expect(f.state().audit).toHaveLength(1); expect(f.model.listCases).toBeUndefined();
    });
    it('checks source revision, digest and exact bytes, rejects client evidence/deadlines, and never rewrites the source', async () => {
        const f = await fixture();
        for (const extra of [{ sourceRevision: 2 }, { sourceDigest: 'a'.repeat(64) }, { bytes: enc.encode('replacement') }, { evidenceDeleteAt: Number.MAX_SAFE_INTEGER }]) {
            expect((await f.model.preserveSelectedReport(f.preserveInput(extra))).ok).toBe(false);
        }
        f.controls.load = async ({ tx, sourceId }) => ({ ...await tx.get(`source:${sourceId}`), bytes: enc.encode('Changed benign bytes') });
        expect(await f.model.preserveSelectedReport(f.preserveInput())).toEqual({ ok: false, error: 'source-conflict' });
        expect(f.source()).toEqual(f.report); expect(f.state()).toEqual(initialIncidentCaseState());
    });
    it('returns no acknowledgement before the whole transaction commits and recovers an ambiguous commit by operation identity after restart', async () => {
        const f = await fixture(); let release, finished = false;
        f.storage.gate(new Promise(resolve => { release = resolve; }));
        const input = f.preserveInput(), pending = f.model.preserveSelectedReport(input).then(value => { finished = true; return value; });
        for (let i = 0; i < 30; i++) await new Promise(resolve => setTimeout(resolve, 1));
        expect(finished).toBe(false); expect(f.state()).toEqual(initialIncidentCaseState());
        release(); const saved = await pending; expect(saved.ok).toBe(true); f.storage.gate(null);
        const before = f.state(); expect(await f.create().preserveSelectedReport(input)).toEqual({ ...saved, replayed: true }); expect(f.state()).toEqual(before);
        const input2 = f.preserveInput(); f.storage.failAfterCommit(true);
        expect(await f.model.preserveSelectedReport(input2)).toEqual({ ok: false, error: 'storage-unavailable' });
        expect(f.state().cases).toHaveLength(2); f.storage.failAfterCommit(false);
        expect(await f.create().preserveSelectedReport(input2)).toMatchObject({ ok: true, replayed: true }); expect(f.state().cases).toHaveLength(2);
    });
    it('fails quota or storage truthfully without evicting accepted cases or altering source evidence', async () => {
        const f = await fixture({ limits: { maxCases: 1 } });
        const saved = await f.model.preserveSelectedReport(f.preserveInput()), before = f.state(); expect(saved.ok).toBe(true);
        expect(await f.model.preserveSelectedReport(f.preserveInput())).toEqual({ ok: false, error: 'capacity' }); expect(f.state()).toEqual(before);
        f.storage.failPut(true); expect(await f.model.transitionReview(f.request(saved.caseRef, 1, { status: 'triaged' }))).toEqual({ ok: false, error: 'storage-unavailable' });
        expect(f.state()).toEqual(before); expect(f.source()).toEqual(f.report);
        const small = await fixture({ limits: { maxEvidenceBytes: 1 } });
        expect(await small.model.preserveSelectedReport(small.preserveInput())).toEqual({ ok: false, error: 'capacity' }); expect(small.state()).toEqual(initialIncidentCaseState());
    });
    it('bounds audit and total bytes without returning unaudited evidence or evicting prior entries', async () => {
        const f = await fixture({ limits: { maxAuditEvents: 1 } }), saved = await f.model.preserveSelectedReport(f.preserveInput()), before = f.state();
        expect(await f.model.readEvidence(f.request(saved.caseRef, 1))).toEqual({ ok: false, error: 'capacity' }); expect(f.state()).toEqual(before);
        const tiny = await fixture({ limits: { maxBytes: 100 } });
        expect(await tiny.model.preserveSelectedReport(tiny.preserveInput())).toEqual({ ok: false, error: 'capacity' }); expect(tiny.state()).toEqual(initialIncidentCaseState());
        const broken = await fixture(); broken.controls.cipher = { ...broken.realCipher, encrypt: async () => { throw Error('synthetic key unavailable'); } };
        expect(await broken.model.preserveSelectedReport(broken.preserveInput())).toEqual({ ok: false, error: 'storage-unavailable' }); expect(broken.source()).toEqual(broken.report);
    });
    it('canonicalizes request field order, binds idempotency to actor and parameters, and refuses conflicting reuse', async () => {
        const f = await fixture(), input = f.preserveInput(), saved = await f.model.preserveSelectedReport(input), before = f.state();
        const reversed = Object.fromEntries(Object.entries(input).reverse());
        expect(await f.model.preserveSelectedReport(reversed)).toEqual({ ...saved, replayed: true });
        expect(await f.model.preserveSelectedReport({ ...input, type: 'rights' })).toEqual({ ok: false, error: 'operation-conflict' });
        expect(await f.model.preserveSelectedReport({ ...input, principal: 'bravo' })).toEqual({ ok: false, error: 'operation-conflict' });
        expect(f.state()).toEqual(before);
    });
    it('refuses missing/malformed/unqualified policy and missing/corrupt storage rather than initializing or deleting it', async () => {
        for (const change of [{ qualified: false }, { reviewAt: Infinity }, { evidenceDeleteAt: null }, { receiptUntil: 1800000000010 }, { extra: 'unrecognized' }]) {
            const f = await fixture(); f.policy(change);
            expect(await f.model.preserveSelectedReport(f.preserveInput())).toEqual({ ok: false, error: 'policy-unqualified' }); expect(f.state()).toEqual(initialIncidentCaseState());
        }
        const f = await fixture(); await f.storage.transaction(tx => tx.delete(STORE));
        expect(await f.model.preserveSelectedReport(f.preserveInput())).toEqual({ ok: false, error: 'storage-unavailable' });
        await f.storage.transaction(tx => tx.put(STORE, { v: 1, cases: [] }));
        expect(await f.model.preserveSelectedReport(f.preserveInput())).toEqual({ ok: false, error: 'storage-unavailable' });
    });
    it('does not delete existing due evidence when policy qualification is lost', async () => {
        const f = await fixture(), saved = await f.model.preserveSelectedReport(f.preserveInput()); f.time(f.base + 3500);
        const before = f.state(); f.policy({ qualified: false });
        expect(await f.model.cleanupCase(f.request(saved.caseRef, 1))).toEqual({ ok: false, error: 'policy-unqualified' });
        expect(f.state()).toEqual(before); expect(f.source()).toEqual(f.report);
    });
    it('denies plaintext at its retention deadline while metadata and authorized cleanup remain available', async () => {
        const f = await fixture(), saved = await f.model.preserveSelectedReport(f.preserveInput()); f.time(f.base + 3000);
        const before = f.state();
        expect(await f.model.readEvidence(f.request(saved.caseRef, 1))).toEqual({ ok: false, error: 'evidence-retention-due' }); expect(f.state()).toEqual(before);
        const metadata = await f.read(saved.caseRef); expect(metadata.case.evidence.state).toBe('deletion-due');
        expect(await f.model.cleanupCase(f.request(saved.caseRef, 1))).toMatchObject({ ok: true, revision: 2 });
        expect(f.state().cases[0]).toMatchObject({ evidence: { state: 'deleted' }, cipher: null, source: null });
        const held = await fixture({ hold: true }), h = await held.model.preserveSelectedReport(held.preserveInput()); held.time(held.base + 3500);
        expect(await held.model.readEvidence(held.request(h.caseRef, 1))).toEqual({ ok: false, error: 'evidence-retention-due' });
        expect((await held.read(h.caseRef)).case.holdOverdue).toBe(true);
        expect(await held.model.cleanupCase(held.request(h.caseRef, 1))).toEqual({ ok: false, error: 'hold-active' });
    });
    it('does not let asynchronous decryption cross the evidence retention deadline', async () => {
        const f = await fixture(), saved = await f.model.preserveSelectedReport(f.preserveInput()); let release, entered;
        const inside = new Promise(resolve => { entered = resolve; });
        f.controls.cipher = { ...f.realCipher, decrypt: async (...args) => { const bytes = await f.realCipher.decrypt(...args); entered(); await new Promise(resolve => { release = resolve; }); return bytes; } };
        f.time(f.base + 2999); const before = f.state(), pending = f.model.readEvidence(f.request(saved.caseRef, 1)); await inside;
        f.time(f.base + 3000); release(); expect(await pending).toEqual({ ok: false, error: 'evidence-retention-due' }); expect(f.state()).toEqual(before);
    });
    it('limits read retries to an unexpired receipt and unchanged revision, requiring fresh audit for current state', async () => {
        const f = await fixture(), saved = await f.model.preserveSelectedReport(f.preserveInput());
        const metadataRequest = { principal: 'alice', operationId: 'read_metadata_retry', caseRef: saved.caseRef };
        const evidenceRequest = f.request(saved.caseRef, 1), metadata = await f.model.readCase(metadataRequest), evidence = await f.model.readEvidence(evidenceRequest), before = f.state();
        f.time(f.base + 1500);
        expect(await f.model.readCase(metadataRequest)).toEqual({ ...metadata, replayed: true });
        const repeated = await f.model.readEvidence(evidenceRequest); expect(repeated).toEqual({ ...evidence, replayed: true }); expect(f.state()).toEqual(before);
        const current = await f.read(saved.caseRef); expect(current.case.reviewDue).toBe(true); expect(current.at).toBe(f.base + 1500);
        expect(f.state().audit.at(-1)).toMatchObject({ action: 'read-case', at: f.base + 1500 });
        await f.model.transitionReview(f.request(saved.caseRef, 1, { status: 'triaged' }));
        expect(await f.model.readCase(metadataRequest)).toEqual({ ok: false, error: 'revision-conflict' });
        expect(await f.model.readEvidence(evidenceRequest)).toEqual({ ok: false, error: 'revision-conflict' });
        const current2 = await f.read(saved.caseRef); expect(current2.case.revision).toBe(2);
        const expired = await fixture(), e = await expired.model.preserveSelectedReport(expired.preserveInput());
        const oldRead = { principal: 'alice', operationId: 'expired_read', caseRef: e.caseRef }; await expired.model.readCase(oldRead);
        expired.time(expired.base + 7000); expired.policy({ receiptUntil: expired.base + 12000, auditUntil: expired.base + 13000 });
        const expiredState = expired.state(); expect(await expired.model.readCase(oldRead)).toEqual({ ok: false, error: 'operation-expired' }); expect(expired.state()).toEqual(expiredState);
        expect((await expired.read(e.caseRef)).ok).toBe(true);
    });
    it('reauthorizes after asynchronous encryption and refuses an expired source or changed policy before commit', async () => {
        for (const invalidation of ['revoked', 'revision', 'expired-source', 'policy']) {
            const f = await fixture(); let release, entered;
            const inside = new Promise(resolve => { entered = resolve; });
            f.controls.cipher = { ...f.realCipher, encrypt: async (...args) => { entered(); await new Promise(resolve => { release = resolve; }); return f.realCipher.encrypt(...args); } };
            const pending = f.model.preserveSelectedReport(f.preserveInput()); await inside;
            if (invalidation === 'revoked') f.reviewers.get('alice').active = false;
            if (invalidation === 'revision') f.reviewers.get('alice').revision += 1;
            if (invalidation === 'expired-source') f.time(f.base + 501);
            if (invalidation === 'policy') f.policy({ version: 'synthetic_v2' });
            release(); expect((await pending).ok).toBe(false); expect(f.state()).toEqual(initialIncidentCaseState());
        }
    });
    it('allows only explicit appointed ACL members and enforces later revocation on metadata, plaintext and receipt replay', async () => {
        const f = await fixture(), input = f.preserveInput(), saved = await f.model.preserveSelectedReport(input);
        expect(await f.model.setAccess(f.request(saved.caseRef, 1, { actorRefs: ['alice', 'moderator'] }))).toEqual({ ok: false, error: 'forbidden' });
        expect(await f.model.setAccess(f.request(saved.caseRef, 1, { actorRefs: ['alice', 'bravo'] }))).toMatchObject({ ok: true, revision: 2 });
        expect((await f.read(saved.caseRef, 'bravo')).ok).toBe(true);
        expect(await f.model.setAccess(f.request(saved.caseRef, 2, { actorRefs: ['alice'] }))).toMatchObject({ ok: true, revision: 3 });
        expect(await f.read(saved.caseRef, 'bravo')).toEqual({ ok: false, error: 'forbidden' });
        f.reviewers.get('alice').active = false;
        expect(await f.read(saved.caseRef)).toEqual({ ok: false, error: 'forbidden' });
        expect(await f.model.readEvidence(f.request(saved.caseRef, 3))).toEqual({ ok: false, error: 'forbidden' });
        expect(await f.model.preserveSelectedReport(input)).toEqual({ ok: false, error: 'forbidden' });
    });
    it('keeps review closure separate from holds and requires explicit release before due evidence deletion', async () => {
        const f = await fixture({ hold: true }), saved = await f.model.preserveSelectedReport(f.preserveInput());
        expect(await f.model.transitionReview(f.request(saved.caseRef, 1, { status: 'triaged' }))).toMatchObject({ ok: true, revision: 2 });
        expect(await f.model.transitionReview(f.request(saved.caseRef, 2, { status: 'closed' }))).toMatchObject({ ok: true, revision: 3 });
        f.time(f.base + 3500); const info = await f.read(saved.caseRef);
        expect(info.case).toMatchObject({ review: 'closed', hold: { state: 'active' }, holdOverdue: true, evidence: { state: 'present' } });
        expect(await f.model.cleanupCase(f.request(saved.caseRef, 3))).toEqual({ ok: false, error: 'hold-active' });
        f.policy({ holdUntil: null, reviewAt: f.base + 9000, evidenceDeleteAt: f.base + 3500, caseDeleteAt: f.base + 4000 });
        expect(await f.model.changeHold(f.request(saved.caseRef, 3, { state: 'released' }))).toMatchObject({ ok: true, revision: 4 });
        expect((await f.read(saved.caseRef)).case.evidence.state).toBe('deletion-due');
        expect(await f.model.cleanupCase(f.request(saved.caseRef, 4))).toMatchObject({ ok: true, revision: 5 });
        expect(f.state().cases[0]).toMatchObject({ evidence: { state: 'deleted' }, source: null, cipher: null, hold: { state: 'released' } });
        expect(await f.model.readEvidence(f.request(saved.caseRef, 5))).toEqual({ ok: false, error: 'evidence-unavailable' });
    });
    it('records a separately authorized finite hold extension with revision guards and never silently shortens it', async () => {
        const f = await fixture({ hold: true }), saved = await f.model.preserveSelectedReport(f.preserveInput());
        expect(await f.model.changeHold(f.request(saved.caseRef, 1, { state: 'active' }))).toEqual({ ok: false, error: 'invalid-transition' });
        f.policy({ reason: 'synthetic_extension', authority: 'synthetic_new_authority', holdUntil: f.base + 4500, evidenceDeleteAt: f.base + 5000, caseDeleteAt: f.base + 5500 });
        expect(await f.model.changeHold(f.request(saved.caseRef, 1, { state: 'active' }))).toMatchObject({ ok: true, revision: 2 });
        expect(f.state().audit.at(-1)).toMatchObject({ before: 1, after: 2, reason: 'synthetic_extension', authority: 'synthetic_new_authority' });
        expect(f.state().audit[0].deadlines.holdUntil).toBe(f.base + 2000);
        expect(f.state().audit.at(-1).deadlines).toMatchObject({ holdUntil: f.base + 4500, evidenceDeleteAt: f.base + 5000, caseDeleteAt: f.base + 5500 });
        expect(await f.model.changeHold(f.request(saved.caseRef, 1, { state: 'released' }))).toEqual({ ok: false, error: 'revision-conflict' });
    });
    it('serializes racing copy versus source dismissal and preserves an already copied selection through source expiry and restart', async () => {
        const f = await fixture(); let release, entered;
        const inside = new Promise(resolve => { entered = resolve; });
        f.controls.load = async ({ tx, sourceId }) => { const source = await tx.get(`source:${sourceId}`); entered(); await new Promise(resolve => { release = resolve; }); return source; };
        const pending = f.model.preserveSelectedReport(f.preserveInput()); await inside;
        const dismiss = f.storage.transaction(tx => tx.delete(`source:${f.report.id}`)); release(); const saved = await pending; await dismiss;
        expect(saved.ok).toBe(true); expect(f.source()).toBeUndefined();
        f.controls.load = ({ tx, sourceId }) => tx.get(`source:${sourceId}`);
        f.time(f.base + 1000);
        const evidence = await f.create().readEvidence(f.request(saved.caseRef, 1)); expect(dec.decode(evidence.evidence.bytes)).toBe(dec.decode(f.report.bytes));
        expect(await f.create().preserveSelectedReport(f.preserveInput())).toEqual({ ok: false, error: 'source-unavailable' });
        const first = await fixture(); await first.storage.transaction(tx => tx.delete(`source:${first.report.id}`));
        expect(await first.model.preserveSelectedReport(first.preserveInput())).toEqual({ ok: false, error: 'source-unavailable' });
    });
    it('rejects stale concurrent mutations, retires evidence/ACLs, and cannot resurrect a case by replaying its original copy request', async () => {
        const f = await fixture(), input = f.preserveInput(), saved = await f.model.preserveSelectedReport(input);
        const results = await Promise.all([f.model.transitionReview(f.request(saved.caseRef, 1, { status: 'triaged' })), f.model.transitionReview(f.request(saved.caseRef, 1, { status: 'triaged' }))]);
        expect(results.filter(r => r.ok)).toHaveLength(1); expect(results.find(r => !r.ok).error).toBe('revision-conflict');
        await f.model.transitionReview(f.request(saved.caseRef, 2, { status: 'closed' })); f.time(f.base + 4500);
        const cleanup = f.request(saved.caseRef, 3); expect(await f.model.cleanupCase(cleanup)).toMatchObject({ ok: true, revision: 4 });
        expect(f.state().cases).toEqual([]); expect(f.state().tombstones).toEqual([{ caseRef: saved.caseRef, revision: 4, at: f.base + 4500, until: f.base + 6000 }]);
        expect(await f.create().cleanupCase(cleanup)).toMatchObject({ ok: true, replayed: true });
        expect(await f.create().preserveSelectedReport(input)).toEqual({ ...saved, replayed: true }); expect(f.state().cases).toEqual([]);
        expect(await f.read(saved.caseRef)).toEqual({ ok: false, error: 'forbidden' });
        f.time(f.base + 9000); f.policy({ receiptUntil: f.base + 12000, auditUntil: f.base + 13000 });
        const prune = await f.create().pruneReceipts({ principal: 'alice', operationId: 'prune_final' }); expect(prune.ok).toBe(true);
        expect(f.state().tombstones).toEqual([]); expect(f.state().operations).toHaveLength(1); expect(f.state().audit).toHaveLength(1);
        expect(await f.create().preserveSelectedReport(input)).toEqual({ ok: false, error: 'source-conflict' }); expect(f.state().cases).toEqual([]);
    });
    it('rejects ciphertext tampering and rechecks authority after decryption before returning bytes', async () => {
        const f = await fixture(), saved = await f.model.preserveSelectedReport(f.preserveInput()); let release, entered;
        const inside = new Promise(resolve => { entered = resolve; });
        f.controls.cipher = { ...f.realCipher, decrypt: async (...args) => { const bytes = await f.realCipher.decrypt(...args); entered(); await new Promise(resolve => { release = resolve; }); return bytes; } };
        const pending = f.model.readEvidence(f.request(saved.caseRef, 1)); await inside; f.reviewers.get('alice').revision += 1; release();
        expect(await pending).toEqual({ ok: false, error: 'forbidden' });
        f.controls.cipher = f.realCipher;
        await f.storage.transaction(async tx => { const state = await tx.get(STORE); const c = state.cases[0].cipher; c.ciphertext = `${c.ciphertext[0] === 'A' ? 'B' : 'A'}${c.ciphertext.slice(1)}`; await tx.put(STORE, state); });
        expect(await f.model.readEvidence(f.request(saved.caseRef, 1))).toEqual({ ok: false, error: 'evidence-unavailable' });
    });
});
