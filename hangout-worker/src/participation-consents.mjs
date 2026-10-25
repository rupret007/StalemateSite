// Inactive C2 foundation. Only injected, trusted adapters can authenticate a
// principal/guardian, qualify policy or verify consent. No public routes,
// contacts, raw verification proof, providers or current beta integration.
import { PARTICIPATION_PURPOSES, validParticipationPolicy, validParticipationSubject } from './participation-policy.mjs';

export const PARTICIPATION_LEDGER_KEY = 'participation-ledger:v1';
export const PARTICIPATION_LEDGER_LIMITS = Object.freeze({ subjects: 64, guardians: 128, receipts: 256, pending: 128, operations: 256, bytes: 1024 * 1024 });
const clone = value => JSON.parse(JSON.stringify(value));
const integer = value => Number.isSafeInteger(value) && value >= 0;
const positive = value => integer(value) && value > 0;
const ref = value => typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value);
const version = value => typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function record(value, keys) {
    return !!value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))
        && Reflect.ownKeys(value).length === keys.length && keys.every(key => {
            const property = Object.getOwnPropertyDescriptor(value, key);
            return property?.enumerable === true && Object.hasOwn(property, 'value');
        });
}
function array(value, valid, max) {
    return Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype && value.length <= max
        && Reflect.ownKeys(value).length === value.length + 1
        && Array.from({ length: value.length }, (_, i) => Object.getOwnPropertyDescriptor(value, String(i)))
            .every(property => property && Object.hasOwn(property, 'value') && valid(property.value));
}
const purposes = value => array(value, item => PARTICIPATION_PURPOSES.includes(item), PARTICIPATION_PURPOSES.length) && new Set(value).size === value.length;
const samePolicy = (a, b) => ['policyVersion', 'noticeDigest', 'communityRef'].every(key => a[key] === b[key]) && a.policyRevision === b.revision;
const stamp = policy => ({ policyVersion: policy.policyVersion, policyRevision: policy.revision, noticeDigest: policy.noticeDigest });
const subset = (a, b) => a.every(item => b.includes(item));
const at = (start, duration) => { const end = start + duration; if (!integer(end)) fail('invalid-deadline'); return end; };
const next = revision => { if (!positive(revision + 1)) fail('revision-exhausted'); return revision + 1; };
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
class LedgerFailure extends Error { constructor(reason) { super(reason); this.reason = reason; } }
const fail = reason => { throw new LedgerFailure(reason); };
const RULE_KEYS = ['version', 'verifierRef', 'pendingMs', 'grantMs', 'subjectTailMs', 'guardianTailMs', 'receiptTailMs', 'callbackMs', 'operationMs'];
function validRules(value) {
    return record(value, RULE_KEYS) && value.version === 1 && ref(value.verifierRef)
        && RULE_KEYS.slice(2).every(key => positive(value[key])) && value.pendingMs < value.grantMs;
}
const validConfig = value => record(value, ['policy', 'rules']) && validParticipationPolicy(value.policy) && validRules(value.rules)
    && RULE_KEYS.slice(2).every(key => value.rules[key] <= Number.MAX_SAFE_INTEGER - value.policy.expiresAt);
const window = value => integer(value.issuedAt) && integer(value.expiresAt) && value.issuedAt < value.expiresAt && integer(value.deleteAt) && value.deleteAt >= value.issuedAt;
const stamped = value => version(value.policyVersion) && positive(value.policyRevision) && digest(value.noticeDigest);
const guardianKeys = ['version', 'guardianRef', 'subjectRef', 'principalRef', 'decisionRef', 'verifierRef', 'revision', 'state', 'issuedAt', 'expiresAt', 'deleteAt'];
const validGuardian = value => record(value, guardianKeys) && value.version === 1 && ['guardianRef', 'subjectRef', 'principalRef', 'decisionRef', 'verifierRef'].every(key => ref(value[key]))
    && positive(value.revision) && ['verified', 'expired'].includes(value.state) && window(value) && value.deleteAt >= value.expiresAt;
const receiptKeys = ['version', 'consentRef', 'subjectRef', 'guardianRef', 'decisionRef', 'verifierRef', 'policyVersion', 'policyRevision', 'noticeDigest', 'revision', 'state', 'purposes', 'issuedAt', 'expiresAt', 'deleteAt'];
const validReceipt = value => record(value, receiptKeys) && value.version === 1 && ['consentRef', 'subjectRef', 'guardianRef', 'decisionRef', 'verifierRef'].every(key => ref(value[key]))
    && stamped(value) && positive(value.revision) && ['active', 'withdrawn', 'superseded', 'expired', 'policy-review-required'].includes(value.state)
    && purposes(value.purposes) && value.purposes.length > 0 && window(value) && (value.state !== 'active' || value.deleteAt >= value.expiresAt);
const pendingKeys = ['version', 'pendingRef', 'subjectRef', 'principalRef', 'subjectRevision', 'policyVersion', 'policyRevision', 'noticeDigest', 'verifierRef', 'purposes', 'issuedAt', 'expiresAt', 'grantExpiresAt', 'deleteAt', 'state'];
const validPending = value => record(value, pendingKeys) && value.version === 1 && ['pendingRef', 'subjectRef', 'principalRef', 'verifierRef'].every(key => ref(value[key]))
    && positive(value.subjectRevision) && stamped(value) && purposes(value.purposes) && value.purposes.length > 0 && window(value)
    && integer(value.grantExpiresAt) && value.grantExpiresAt >= value.expiresAt && value.deleteAt >= value.expiresAt
    && ['pending', 'approved', 'declined', 'cancelled', 'expired', 'policy-review-required'].includes(value.state);
const resultKeys = ['subjectRef', 'revision', 'state', 'pendingRef'];
const validResult = value => record(value, resultKeys) && ref(value.subjectRef) && positive(value.revision)
    && ['pending', 'authorized', 'declined', 'withdrawn'].includes(value.state) && (value.pendingRef === '' || ref(value.pendingRef));
const operationKeys = ['operationRef', 'kind', 'signature', 'result', 'issuedAt', 'deleteAt'];
const validOperation = value => record(value, operationKeys) && ref(value.operationRef) && ['begin', 'complete'].includes(value.kind)
    && typeof value.signature === 'string' && value.signature.length <= 4096 && validResult(value.result)
    && integer(value.issuedAt) && integer(value.deleteAt) && value.deleteAt > value.issuedAt;
function validState(value, limits) {
    if (!record(value, ['version', 'revision', 'config', 'subjects', 'guardians', 'receipts', 'pending', 'operations'])
        || value.version !== 1 || !positive(value.revision) || !validConfig(value.config)) return false;
    const kinds = { subjects: [item => record(item, ['record', 'deleteAt']) && validParticipationSubject(item.record) && integer(item.deleteAt)
        && item.deleteAt >= item.record.issuedAt && (!['pending', 'authorized'].includes(item.record.state) || item.deleteAt >= item.record.expiresAt), item => item.record.subjectRef],
    guardians: [validGuardian, item => item.guardianRef], receipts: [validReceipt, item => item.consentRef],
    pending: [validPending, item => item.pendingRef], operations: [validOperation, item => item.operationRef] };
    for (const [kind, [valid, key]] of Object.entries(kinds)) if (!array(value[kind], valid, limits[kind]) || new Set(value[kind].map(key)).size !== value[kind].length) return false;
    if (new Set(value.subjects.map(item => item.record.principalRef)).size !== value.subjects.length) return false;
    if (value.subjects.some(item => item.record.communityRef !== value.config.policy.communityRef)) return false;
    return new TextEncoder().encode(JSON.stringify(value)).byteLength <= limits.bytes;
}
const currentPolicy = (state, now) => {
    const policy = state.config.policy;
    if (policy.state !== 'qualified' || policy.issuedAt > now || policy.effectiveAt > now || policy.expiresAt <= now) fail('policy-not-active');
    return policy;
};
function retireSubject(subject, state) { subject.record = { ...subject.record, state, revision: next(subject.record.revision), purposes: [], consentRefs: [] }; }
function expire(state, now) {
    for (const pending of state.pending) if (pending.state === 'pending' && pending.expiresAt <= now) pending.state = 'expired';
    for (const subject of state.subjects) if (['pending', 'authorized'].includes(subject.record.state) && subject.record.expiresAt <= now) retireSubject(subject, 'expired');
    for (const guardian of state.guardians) if (guardian.state === 'verified' && guardian.expiresAt <= now) { guardian.state = 'expired'; guardian.revision = next(guardian.revision); }
    for (const receipt of state.receipts) if (receipt.state === 'active' && receipt.expiresAt <= now) { receipt.state = 'expired'; receipt.revision = next(receipt.revision); }
    for (const kind of ['subjects', 'guardians', 'receipts', 'pending', 'operations']) state[kind] = state[kind].filter(item => item.deleteAt > now);
}
function activeGrant(state, subject, now) {
    const { policy, rules } = state.config;
    if (subject.state !== 'authorized' || subject.expiresAt <= now || subject.consentRefs.length !== 1 || subject.communityRef !== policy.communityRef || !samePolicy(subject, policy)) return false;
    const receipt = state.receipts.find(item => item.consentRef === subject.consentRefs[0]);
    const guardian = state.guardians.find(item => item.guardianRef === receipt?.guardianRef);
    return !!receipt && !!guardian && receipt.state === 'active' && receipt.subjectRef === subject.subjectRef && samePolicy({ ...receipt, communityRef: subject.communityRef }, policy)
        && receipt.verifierRef === rules.verifierRef && subset(subject.purposes, receipt.purposes) && subject.expiresAt <= receipt.expiresAt
        && guardian.subjectRef === subject.subjectRef && guardian.state === 'verified' && guardian.expiresAt > now && subject.expiresAt <= guardian.expiresAt
        && guardian.decisionRef === receipt.decisionRef && guardian.verifierRef === receipt.verifierRef;
}
function invalidatePending(state, subjectRef, status) { for (const pending of state.pending) if (pending.subjectRef === subjectRef && pending.state === 'pending') pending.state = status; }
function retireReceipts(state, subjectRef, status, now, shorten = false) {
    for (const receipt of state.receipts) if (receipt.subjectRef === subjectRef && receipt.state === 'active') {
        receipt.state = status; receipt.revision = next(receipt.revision);
        if (shorten) receipt.deleteAt = Math.min(receipt.deleteAt, at(now, state.config.rules.receiptTailMs));
    }
}
function replay(state, operationRef, kind, signature, now) {
    const existing = state.operations.find(item => item.operationRef === operationRef);
    if (!existing) return null;
    if (existing.kind !== kind || existing.signature !== signature) fail('idempotency-conflict');
    const current = state.subjects.find(item => item.record.subjectRef === existing.result.subjectRef)?.record;
    if (!current || current.revision !== existing.result.revision || current.state !== existing.result.state
        || current.state === 'authorized' && !activeGrant(state, current, now)) fail('superseded');
    return { ok: true, ...existing.result };
}
function remember(state, operationRef, kind, signature, subject, now, pendingRef = '') {
    const result = { subjectRef: subject.subjectRef, revision: subject.revision, state: subject.state, pendingRef };
    state.operations.push({ operationRef, kind, signature, result, issuedAt: now, deleteAt: at(now, state.config.rules.operationMs) });
    return { ok: true, ...result };
}

export function createParticipationConsents({ storage, adapters, now = () => Date.now(), randomRef = () => crypto.randomUUID(), limits: supplied = {} } = {}) {
    if (typeof storage?.transaction !== 'function' || !adapters || ['qualifyPolicy', 'authenticateParticipant', 'verifyConsent', 'authenticateGuardian'].some(key => typeof adapters[key] !== 'function')
        || typeof now !== 'function' || typeof randomRef !== 'function' || !record(supplied, Object.keys(supplied)) || Object.keys(supplied).some(key => !Object.hasOwn(PARTICIPATION_LEDGER_LIMITS, key))) throw new Error('Explicit transactional storage and trusted adapters are required.');
    const limits = { ...PARTICIPATION_LEDGER_LIMITS, ...supplied };
    if (Object.keys(limits).some(key => !positive(limits[key]) || limits[key] > PARTICIPATION_LEDGER_LIMITS[key])) throw new Error('Invalid bounded ledger limits.');
    const identifier = () => { const value = randomRef(); if (!ref(value)) fail('invalid-reference'); return value; };
    // The adapter must resolve only after atomic durable commit. A rejected or
    // ambiguous transaction is never acknowledged as success here.
    const transact = async (operation, initialize = false, reducing = false) => {
        try {
            const result = await storage.transaction(async tx => {
                const stored = await tx.get(PARTICIPATION_LEDGER_KEY);
                if (stored === undefined && !initialize) fail('not-initialized');
                if (stored !== undefined && !validState(stored, limits)) fail('storage-corrupt');
                const state = stored === undefined ? null : clone(stored), time = now();
                if (!integer(time)) fail('invalid-time');
                const before = state && JSON.stringify(state);
                if (state) expire(state, time);
                const { result, updated = state } = await operation(state, time);
                if (updated && JSON.stringify(updated) !== before) {
                    updated.revision = updated.revision ? next(updated.revision) : 1;
                    if (!validState(updated, limits)) fail('capacity-or-invalid-state');
                    // Small per-subject headroom is reserved before growth for
                    // bounded withdrawal status/revision changes. No intake or
                    // callback log slot is required by a rights withdrawal.
                    if (!reducing && new TextEncoder().encode(JSON.stringify(updated)).byteLength + updated.subjects.length * 64 > limits.bytes) fail('capacity-or-invalid-state');
                    await tx.put(PARTICIPATION_LEDGER_KEY, clone(updated));
                }
                return result;
            });
            return freeze(clone(result));
        } catch (error) { return Object.freeze({ ok: false, reason: error instanceof LedgerFailure ? error.reason : 'unavailable' }); }
    };
    const authenticate = async (method, data, valid) => {
        try { const value = await adapters[method](data); if (!valid(value)) fail('not-authorized'); return clone(value); }
        catch (error) { fail(error instanceof LedgerFailure ? error.reason : 'not-authorized'); }
    };
    const guarded = operation => async (...args) => { try { return await operation(...args); } catch (error) { return Object.freeze({ ok: false, reason: error instanceof LedgerFailure ? error.reason : 'unavailable' }); } };
    return Object.freeze({
        installPolicy: guarded(async proof => {
            const authorization = await authenticate('qualifyPolicy', { proof }, value => record(value, ['config', 'expiresAt']) && validConfig(value.config) && integer(value.expiresAt));
            const config = authorization.config;
            return transact((state, time) => {
                if (authorization.expiresAt <= time) fail('not-authorized');
                if (config.policy.issuedAt > time) fail('invalid-policy');
                if (state) {
                    if (state.config.policy.communityRef !== config.policy.communityRef || config.policy.revision < state.config.policy.revision) fail('stale-policy');
                    if (config.policy.revision === state.config.policy.revision) {
                        if (JSON.stringify(state.config) !== JSON.stringify(config)) fail('policy-conflict');
                        return { result: { ok: true, policyRevision: config.policy.revision } };
                    }
                    for (const subject of state.subjects) if (['authorized', 'pending'].includes(subject.record.state)) { retireSubject(subject, 'policy-review-required'); invalidatePending(state, subject.record.subjectRef, 'policy-review-required'); retireReceipts(state, subject.record.subjectRef, 'policy-review-required', time); }
                    state.config = config;
                } else state = { version: 1, revision: 0, config, subjects: [], guardians: [], receipts: [], pending: [], operations: [] };
                return { result: { ok: true, policyRevision: config.policy.revision }, updated: state };
            }, true, true);
        }),
        begin: guarded(async (proof, request) => {
            if (!record(request, ['expectedRevision', 'purposes']) || !integer(request.expectedRevision) || !purposes(request.purposes) || !request.purposes.length) fail('invalid-request');
            request = freeze(clone(request));
            const identity = await authenticate('authenticateParticipant', { proof, purpose: 'begin', request }, value => record(value, ['operationRef', 'principalRef', 'communityRef', 'expiresAt'])
                && ['operationRef', 'principalRef', 'communityRef'].every(key => ref(value[key])) && integer(value.expiresAt));
            const subjectRef = identifier(), pendingRef = identifier(), signature = JSON.stringify({ principalRef: identity.principalRef, communityRef: identity.communityRef, request });
            return transact((state, time) => {
                if (identity.expiresAt <= time) fail('not-authorized');
                const previous = replay(state, identity.operationRef, 'begin', signature, time); if (previous) return { result: previous };
                const policy = currentPolicy(state, time), rules = state.config.rules;
                if (identity.communityRef !== policy.communityRef || !subset(request.purposes, policy.purposes)) fail('not-authorized');
                const existing = state.subjects.find(item => item.record.principalRef === identity.principalRef);
                if ((existing?.record.revision || 0) !== request.expectedRevision) fail('revision-conflict');
                if (state.subjects.some(item => item.record.subjectRef === subjectRef) || state.pending.some(item => item.pendingRef === pendingRef)) fail('reference-conflict');
                const issuedAt = time, expiresAt = Math.min(at(time, rules.pendingMs), policy.expiresAt), grantExpiresAt = Math.min(at(time, rules.grantMs), policy.expiresAt);
                const subject = { version: 1, subjectRef: existing?.record.subjectRef || subjectRef, principalRef: identity.principalRef, communityRef: policy.communityRef,
                    ...stamp(policy), revision: existing ? next(existing.record.revision) : 1, state: 'pending', purposes: [], consentRefs: [], issuedAt, effectiveAt: issuedAt, expiresAt };
                invalidatePending(state, subject.subjectRef, 'cancelled'); retireReceipts(state, subject.subjectRef, 'superseded', time);
                const wrapper = { record: subject, deleteAt: at(expiresAt, rules.subjectTailMs) };
                if (existing) state.subjects[state.subjects.indexOf(existing)] = wrapper; else state.subjects.push(wrapper);
                state.pending.push({ version: 1, pendingRef, subjectRef: subject.subjectRef, principalRef: subject.principalRef, subjectRevision: subject.revision,
                    ...stamp(policy), verifierRef: rules.verifierRef, purposes: [...request.purposes].sort(), issuedAt, expiresAt, grantExpiresAt, deleteAt: at(expiresAt, rules.callbackMs), state: 'pending' });
                return { result: remember(state, identity.operationRef, 'begin', signature, subject, time, pendingRef) };
            });
        }),
        complete: guarded(async proof => {
            const keys = ['operationRef', 'pendingRef', 'subjectRef', 'principalRef', 'guardianPrincipalRef', 'decisionRef', 'verifierRef', 'status', 'purposes', 'verifiedAt', 'expiresAt'];
            const decision = await authenticate('verifyConsent', { proof }, value => record(value, keys) && keys.slice(0, 7).every(key => ref(value[key]))
                && ['approved', 'declined'].includes(value.status) && purposes(value.purposes) && integer(value.verifiedAt) && integer(value.expiresAt) && value.verifiedAt < value.expiresAt
                && (value.status !== 'approved' || value.purposes.length > 0));
            const guardianRef = identifier(), consentRef = identifier(), signature = JSON.stringify(decision);
            return transact((state, time) => {
                const previous = replay(state, decision.operationRef, 'complete', signature, time); if (previous) return { result: previous };
                const policy = currentPolicy(state, time), rules = state.config.rules;
                const pending = state.pending.find(item => item.pendingRef === decision.pendingRef), wrapper = state.subjects.find(item => item.record.subjectRef === decision.subjectRef), subject = wrapper?.record;
                if (!pending || pending.state !== 'pending' || !subject || subject.state !== 'pending' || pending.subjectRevision !== subject.revision
                    || pending.subjectRef !== subject.subjectRef || pending.principalRef !== decision.principalRef || subject.principalRef !== decision.principalRef
                    || !samePolicy({ ...pending, communityRef: subject.communityRef }, policy) || decision.verifierRef !== pending.verifierRef
                    || decision.verifiedAt < pending.issuedAt || decision.verifiedAt > time || decision.expiresAt <= time || !subset(decision.purposes, pending.purposes)) fail('stale-or-unmatched-decision');
                pending.state = decision.status;
                subject.revision = next(subject.revision);
                if (decision.status === 'declined') {
                    subject.state = 'declined'; subject.purposes = []; subject.consentRefs = [];
                    wrapper.deleteAt = Math.min(wrapper.deleteAt, at(time, rules.subjectTailMs));
                } else {
                    if (state.guardians.some(item => item.guardianRef === guardianRef) || state.receipts.some(item => item.consentRef === consentRef)) fail('reference-conflict');
                    if (state.receipts.some(item => item.verifierRef === decision.verifierRef && item.decisionRef === decision.decisionRef)) fail('reused-decision');
                    const expiresAt = Math.min(pending.grantExpiresAt, decision.expiresAt, policy.expiresAt);
                    if (expiresAt <= time) fail('expired-decision');
                    state.guardians.push({ version: 1, guardianRef, subjectRef: subject.subjectRef, principalRef: decision.guardianPrincipalRef, decisionRef: decision.decisionRef,
                        verifierRef: decision.verifierRef, revision: 1, state: 'verified', issuedAt: decision.verifiedAt, expiresAt, deleteAt: at(expiresAt, rules.guardianTailMs) });
                    state.receipts.push({ version: 1, consentRef, subjectRef: subject.subjectRef, guardianRef, decisionRef: decision.decisionRef, verifierRef: decision.verifierRef,
                        ...stamp(policy), revision: 1, state: 'active', purposes: [...decision.purposes].sort(), issuedAt: time, expiresAt, deleteAt: at(expiresAt, rules.receiptTailMs) });
                    Object.assign(subject, { state: 'authorized', purposes: [...decision.purposes].sort(), consentRefs: [consentRef], issuedAt: time, effectiveAt: time, expiresAt });
                    wrapper.deleteAt = at(expiresAt, rules.subjectTailMs);
                }
                return { result: remember(state, decision.operationRef, 'complete', signature, subject, time) };
            });
        }),
        change: guarded(async (proof, request) => {
            if (!record(request, ['expectedRevision', 'purposes']) || !positive(request.expectedRevision) || !purposes(request.purposes)) fail('invalid-request');
            request = freeze(clone(request));
            const authority = await authenticate('authenticateGuardian', { proof, request }, value => record(value, ['operationRef', 'subjectRef', 'principalRef', 'guardianRef', 'guardianRevision', 'expiresAt'])
                && ['operationRef', 'subjectRef', 'principalRef', 'guardianRef'].every(key => ref(value[key])) && positive(value.guardianRevision) && integer(value.expiresAt));
            return transact((state, time) => {
                if (authority.expiresAt <= time) fail('not-authorized');
                const guardian = state.guardians.find(item => item.guardianRef === authority.guardianRef), wrapper = state.subjects.find(item => item.record.subjectRef === authority.subjectRef), subject = wrapper?.record;
                if (!guardian || !subject || guardian.subjectRef !== subject.subjectRef || guardian.principalRef !== authority.principalRef
                    || guardian.revision !== authority.guardianRevision || guardian.state !== 'verified' || guardian.expiresAt <= time) fail('not-authorized');
                // A repeat reduction may acknowledge only the current matching
                // state. An old wider request can never restore a purpose. This
                // requires no extra log slot when intake capacity is exhausted.
                const identical = JSON.stringify([...subject.purposes].sort()) === JSON.stringify([...request.purposes].sort())
                    && (request.purposes.length > 0 && subject.state === 'authorized' || request.purposes.length === 0 && subject.state === 'withdrawn');
                if (identical && request.expectedRevision <= subject.revision) {
                    if (request.purposes.length && !activeGrant(state, subject, time)) fail('not-authorized');
                    return { result: { ok: true, subjectRef: subject.subjectRef, revision: subject.revision, state: subject.state, pendingRef: '' } };
                }
                if (subject.revision !== request.expectedRevision) fail('revision-conflict');
                if (!subset(request.purposes, subject.purposes) || request.purposes.length && !activeGrant(state, subject, time)) fail('purpose-widening');
                const withdrawn = request.purposes.length === 0;
                if (!(withdrawn && subject.state === 'withdrawn')) {
                    subject.revision = next(subject.revision); subject.purposes = [...request.purposes].sort();
                    if (withdrawn) {
                        subject.state = 'withdrawn'; subject.consentRefs = [];
                        wrapper.deleteAt = Math.min(wrapper.deleteAt, at(time, state.config.rules.subjectTailMs));
                        invalidatePending(state, subject.subjectRef, 'cancelled'); retireReceipts(state, subject.subjectRef, 'withdrawn', time, true);
                    }
                }
                return { result: { ok: true, subjectRef: subject.subjectRef, revision: subject.revision, state: subject.state, pendingRef: '' } };
            }, false, true);
        }),
        lookup: guarded(async proof => {
            const identity = await authenticate('authenticateParticipant', { proof, purpose: 'lookup' }, value => record(value, ['principalRef', 'communityRef', 'expiresAt'])
                && ['principalRef', 'communityRef'].every(key => ref(value[key])) && integer(value.expiresAt));
            return transact((state, time) => {
                if (identity.expiresAt <= time) fail('not-authorized');
                const policy = currentPolicy(state, time);
                if (identity.communityRef !== policy.communityRef) fail('not-authorized');
                const subject = state.subjects.find(item => item.record.principalRef === identity.principalRef)?.record;
                if (!subject) fail('not-found');
                if (subject.state === 'authorized' && !activeGrant(state, subject, time)) fail('not-authorized');
                return { result: { ok: true, policy, subject } };
            });
        }),
        sweep: () => transact(state => ({ result: { ok: true, counts: Object.fromEntries(['subjects', 'guardians', 'receipts', 'pending', 'operations'].map(kind => [kind, state[kind].length])) } }))
    });
}
