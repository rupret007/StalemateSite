// Server-only C2 record partitions in ONE serializable rollback transaction
// domain. No production route, migration, remote guardian or provider adapter.
import { createParticipationConsents, PARTICIPATION_LEDGER_KEY, readParticipationPrincipals,
    validParticipationLedgerState, alignParticipationLedgerPolicy, accessParticipationSelf } from './participation-consents.mjs';

export const PARTICIPATION_PARTITION_PREFIX = 'participation-records:v1:';
export const PARTICIPATION_POLICY_KEY = `${PARTICIPATION_PARTITION_PREFIX}policy`;
export const PARTICIPATION_RECORD_LIMITS = Object.freeze({ subjects: 1, guardians: 8, receipts: 16, pending: 16, operations: 32, bytes: 65536 });
export const PARTICIPATION_PARTITION_BOUNDS = Object.freeze({ identities: 256, maintenancePage: 4, recordReadCalls: 160, recordWriteCalls: 160 });
const PARTS = `${PARTICIPATION_PARTITION_PREFIX}record:`, ANCHORS = `${PARTICIPATION_PARTITION_PREFIX}anchor:`;
const SUBJECTS = `${PARTICIPATION_PARTITION_PREFIX}subject:`, OPERATIONS = `${PARTICIPATION_PARTITION_PREFIX}operation:`;
const UNIQUE = `${PARTICIPATION_PARTITION_PREFIX}unique:`;
const kinds = ['subjects', 'guardians', 'receipts', 'pending', 'operations'];
const clone = value => structuredClone(value), ref = value => typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const integer = value => Number.isSafeInteger(value) && value >= 0;
const exact = (value, keys) => value && [Object.prototype, null].includes(Object.getPrototypeOf(value))
    && Reflect.ownKeys(value).length === keys.length && keys.every(key => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key); return descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
    });
const fail = reason => { throw Object.assign(new Error(reason), { partitionReason: reason }); };
const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(n => n.toString(16).padStart(2, '0')).join('');
const indexKey = async (prefix, value) => `${prefix}${await digest(value)}`;
async function routeFor(principalRef, communityRef) {
    if (!ref(principalRef) || !ref(communityRef)) fail('not-authorized');
    const hash = await digest(`${communityRef}\0${principalRef}`);
    return { principalRef, communityRef, partitionKey: `${PARTS}${hash}`, anchorKey: `${ANCHORS}${hash}` };
}
const matchesRoute = (value, route) => value.principalRef === route.principalRef && value.communityRef === route.communityRef && value.partitionKey === route.partitionKey;
const validPartitionKey = key => typeof key === 'string' && key.startsWith(PARTS) && /^[a-f0-9]{64}$/.test(key.slice(PARTS.length));
const validAnchor = (value, route) => exact(value, ['version', 'principalRef', 'communityRef', 'partitionKey', 'subjectRef'])
    && value.version === 1 && ref(value.subjectRef) && matchesRoute(value, route);
const validOperation = value => exact(value, ['version', 'operationRef', 'kind', 'principalRef', 'communityRef', 'partitionKey', 'deleteAt'])
    && value.version === 1 && ref(value.operationRef) && ['begin', 'complete'].includes(value.kind)
    && ref(value.principalRef) && ref(value.communityRef) && validPartitionKey(value.partitionKey) && integer(value.deleteAt);
const validReference = value => exact(value, ['version', 'space', 'reference', 'principalRef', 'communityRef', 'partitionKey', 'deleteAt'])
    && value.version === 1 && ['pending', 'guardian', 'consent', 'decision'].includes(value.space)
    && (value.space === 'decision' ? typeof value.reference === 'string' && value.reference.split('\0').length === 2 && value.reference.split('\0').every(ref) : ref(value.reference))
    && ref(value.principalRef) && ref(value.communityRef) && validPartitionKey(value.partitionKey) && integer(value.deleteAt);
function boundedRecordTransaction(tx) {
    let reads = 0, writes = 0;
    return {
        get: key => { if (++reads > PARTICIPATION_PARTITION_BOUNDS.recordReadCalls) fail('partition-read-capacity'); return tx.get(key); },
        put: (key, value) => { if (++writes > PARTICIPATION_PARTITION_BOUNDS.recordWriteCalls) fail('partition-write-capacity'); return tx.put(key, value); },
        delete: key => { if (++writes > PARTICIPATION_PARTITION_BOUNDS.recordWriteCalls) fail('partition-write-capacity'); return tx.delete(key); }
    };
}
const referenceKey = (space, reference) => indexKey(`${UNIQUE}${space}:`, reference);
const referenceValue = (space, reference, deleteAt, route) => ({ version: 1, space, reference, principalRef: route.principalRef,
    communityRef: route.communityRef, partitionKey: route.partitionKey, deleteAt });
async function references(state, route) {
    const rows = new Map(), add = async (space, reference, deleteAt) => {
        const key = await referenceKey(space, reference); if (rows.has(key)) fail('reference-conflict'); rows.set(key, referenceValue(space, reference, deleteAt, route));
    };
    for (const row of state?.pending || []) await add('pending', row.pendingRef, row.deleteAt);
    for (const row of state?.guardians || []) await add('guardian', row.guardianRef, row.deleteAt);
    for (const row of state?.receipts || []) { await add('consent', row.consentRef, row.deleteAt); await add('decision', `${row.verifierRef}\0${row.decisionRef}`, row.deleteAt); }
    return rows;
}
async function syncReferences(tx, previous, next, route, at) {
    const old = await references(previous, route), current = await references(next, route);
    for (const key of new Set([...old.keys(), ...current.keys()])) {
        const before = old.get(key), after = current.get(key), unchanged = JSON.stringify(before) === JSON.stringify(after);
        if (unchanged && before.deleteAt <= at) continue;
        const saved = await tx.get(key), expected = before || after;
        if (saved !== undefined && (!validReference(saved) || saved.space !== expected.space || saved.reference !== expected.reference)) fail('storage-corrupt');
        if (before?.deleteAt > at && (!saved || !matchesRoute(saved, route) || saved.deleteAt !== before.deleteAt)) fail('storage-corrupt');
        if (unchanged) continue;
        if (after) {
            if (saved?.deleteAt > at && (!before || !matchesRoute(saved, route))) fail('reference-conflict');
            await tx.put(key, after);
        } else if (saved && matchesRoute(saved, route) && saved.deleteAt === before.deleteAt) await tx.delete(key);
    }
}
async function root(tx) {
    const value = await tx.get(PARTICIPATION_POLICY_KEY);
    if (!validParticipationLedgerState(value, PARTICIPATION_RECORD_LIMITS) || kinds.some(kind => value[kind].length)) fail('policy-unavailable');
    return value;
}
async function loadPartition(tx, route, policy, at) {
    if (route.communityRef !== policy.config.policy.communityRef) fail('not-authorized');
    const state = await tx.get(route.partitionKey), anchor = await tx.get(route.anchorKey);
    if (state === undefined && anchor === undefined) return { state, anchor };
    if (!validAnchor(anchor, route) || !validParticipationLedgerState(state, PARTICIPATION_RECORD_LIMITS)
        || state.config.policy.communityRef !== route.communityRef
        || state.subjects.some(item => item.record.principalRef !== route.principalRef || item.record.subjectRef !== anchor.subjectRef)) fail('storage-corrupt');
    if (state.subjects.length) {
        const index = await tx.get(await indexKey(SUBJECTS, anchor.subjectRef));
        if (!validAnchor(index, route) || index.subjectRef !== anchor.subjectRef) fail('storage-corrupt');
        const subject = state.subjects[0].record, receipt = state.receipts.find(item => item.consentRef === subject.consentRefs[0]);
        const guardian = state.guardians.find(item => item.guardianRef === receipt?.guardianRef);
        if (subject.state === 'authorized' && subject.expiresAt > at && receipt?.state === 'active' && guardian?.state === 'verified') {
            for (const [space, reference, deleteAt] of [['guardian', guardian.guardianRef, guardian.deleteAt], ['consent', receipt.consentRef, receipt.deleteAt],
                ['decision', `${receipt.verifierRef}\0${receipt.decisionRef}`, receipt.deleteAt]]) {
                const saved = await tx.get(await referenceKey(space, reference));
                if (!validReference(saved) || saved.space !== space || saved.reference !== reference || saved.deleteAt !== deleteAt || !matchesRoute(saved, route)) fail('storage-corrupt');
            }
        }
    }
    return { state, anchor };
}

// Caller-only controls composed inside the actual native authority transaction.
// No partition allocation, verifier/guardian adapter or nested transaction.
export async function accessPartitionedParticipationSelf({ tx, identity, now, request } = {}) {
    const bounded = boundedRecordTransaction(tx), policy = await root(bounded), route = await routeFor(identity?.principalRef, identity?.communityRef);
    const loaded = await loadPartition(bounded, route, policy, now);
    let value = loaded.state === undefined ? undefined : alignParticipationLedgerPolicy(loaded.state, policy.config, now, PARTICIPATION_RECORD_LIMITS);
    const result = await accessParticipationSelf({ tx: { get: async () => clone(value), put: async (_, next) => { value = clone(next); } },
        identity, now, request, limits: PARTICIPATION_RECORD_LIMITS });
    if (request !== undefined && loaded.state !== undefined && JSON.stringify(value) !== JSON.stringify(loaded.state)) {
        await syncReferences(bounded, loaded.state, value, route, now);
        await bounded.put(route.partitionKey, value);
    }
    return result;
}

export async function readPartitionedParticipationWithdrawals({ tx, identities, now } = {}) {
    if (!integer(now) || !Array.isArray(identities) || identities.length > PARTICIPATION_PARTITION_BOUNDS.identities) fail('not-authorized');
    const policy = await root(tx), withdrawn = [], cache = new Map();
    for (const identity of identities) {
        if (!exact(identity, ['principalRef', 'communityRef', 'expiresAt']) || !integer(identity.expiresAt) || identity.expiresAt <= now) fail('not-authorized');
        const route = await routeFor(identity.principalRef, identity.communityRef);
        if (!cache.has(route.partitionKey)) {
            const { state } = await loadPartition(tx, route, policy, now);
            cache.set(route.partitionKey, !!state?.subjects.some(row => row.record.state === 'withdrawn' && row.deleteAt > now));
        }
        withdrawn.push(cache.get(route.partitionKey));
    }
    return withdrawn;
}

// Passed directly to createParticipationEnforcement({readPrincipals: ...}).
// Every prepare/commit/provider fence sees the current policy and peer rows in
// its existing transaction; never nest lookup() or trust a requested principal.
async function projectParticipation({ tx, identities, now } = {}, includeWithdrawn = false) {
    try {
        if (typeof tx?.get !== 'function' || !integer(now) || !Array.isArray(identities) || identities.length > PARTICIPATION_PARTITION_BOUNDS.identities) fail('not-authorized');
        const policy = await root(tx), subjects = [], withdrawn = [], cache = new Map();
        let denial = '';
        for (const identity of identities) {
            if (!exact(identity, ['principalRef', 'communityRef', 'expiresAt']) || !integer(identity.expiresAt) || identity.expiresAt <= now) fail('not-authorized');
            const route = await routeFor(identity.principalRef, identity.communityRef);
            if (!cache.has(route.partitionKey)) {
                const { state } = await loadPartition(tx, route, policy, now);
                const aligned = alignParticipationLedgerPolicy(state, policy.config, now, PARTICIPATION_RECORD_LIMITS);
                const result = await readParticipationPrincipals({ tx: { get: async () => clone(aligned) }, identities: [identity], now, limits: PARTICIPATION_RECORD_LIMITS });
                if (!result.ok) {
                    if (!includeWithdrawn) fail(result.reason);
                    denial ||= result.reason;
                }
                cache.set(route.partitionKey, { subject: result.ok ? result.subjects[0] : null,
                    withdrawn: !!state?.subjects.some(row => row.record.state === 'withdrawn' && row.deleteAt > now) });
            }
            const current = cache.get(route.partitionKey);
            subjects.push(clone(current.subject)); withdrawn.push(current.withdrawn);
        }
        // Empty reads must also reject an inactive policy, without initializing it.
        const checked = await readParticipationPrincipals({ tx: { get: async () => clone(policy) }, identities: [], now, limits: PARTICIPATION_RECORD_LIMITS });
        if (!checked.ok) {
            if (!includeWithdrawn) fail(checked.reason);
            denial ||= checked.reason;
        }
        // A valid retained withdrawal still narrows sharing when affirmative
        // policy eligibility has expired. Corrupt/incomplete raw reads above
        // never provide such a projection, matching the separate readers.
        if (denial) return freeze({ ok: false, reason: denial, withdrawn });
        return freeze({ ok: true, policy: checked.policy, subjects, ...(includeWithdrawn ? { withdrawn } : {}) });
    } catch (error) { return Object.freeze({ ok: false, reason: error.partitionReason || 'unavailable' }); }
}

export const readPartitionedParticipationPrincipals = input => projectParticipation(input);

// One current read-only preparation projection. Withdrawal and grant state
// come from the same validated partition, without a second native traversal.
// This result is never reused for either effect-commit authorization fence.
export const readPartitionedParticipationPreparation = input => projectParticipation(input, true);

export function createPartitionedParticipationConsents({ storage, adapters, admitSubject, releaseSubject = null, now = () => Date.now(), randomRef = () => crypto.randomUUID() } = {}) {
    if (typeof storage?.transaction !== 'function' || typeof admitSubject !== 'function' || typeof now !== 'function' || typeof randomRef !== 'function'
        || releaseSubject !== null && typeof releaseSubject !== 'function'
        || !adapters || ['qualifyPolicy', 'authenticateParticipant', 'verifyConsent', 'authenticateGuardian', 'authorizeMaintenance'].some(name => typeof adapters[name] !== 'function')) throw TypeError('Explicit partition storage, allocation and trusted adapters required');
    const guarded = fn => async (...args) => {
        try { return await fn(...args); } catch (error) { return Object.freeze({ ok: false, reason: error.partitionReason || 'unavailable' }); }
    };
    const authenticate = async (name, data) => { try { return clone(await adapters[name](data)); } catch { fail('not-authorized'); } };
    const fresh = authorization => { if (!integer(authorization?.expiresAt) || authorization.expiresAt <= now()) fail('not-authorized'); };
    const subjectRoute = async auth => {
        if (!ref(auth?.subjectRef)) fail('not-authorized');
        const key = await indexKey(SUBJECTS, auth.subjectRef), index = await storage.transaction(tx => tx.get(key));
        const route = await routeFor(index?.principalRef, index?.communityRef);
        if (!validAnchor(index, route) || index.subjectRef !== auth.subjectRef) fail('storage-corrupt');
        return { ...route, subjectIndex: key };
    };
    const ledgerFor = (route, authorization, authMethod, operation = null, maintenance = false) => {
        const partitionStorage = { transaction: fn => storage.transaction(async originalTx => {
            const tx = boundedRecordTransaction(originalTx);
            const policy = await root(tx), loaded = await loadPartition(tx, route, policy, now()); fresh(authorization);
            if (route.subjectIndex) {
                const index = await tx.get(route.subjectIndex);
                if (!validAnchor(index, route) || index.subjectRef !== authorization.subjectRef) fail('storage-corrupt');
            }
            let value = alignParticipationLedgerPolicy(loaded.state, policy.config, now(), PARTICIPATION_RECORD_LIMITS);
            for (const old of loaded.state?.operations || []) if (old.deleteAt > now()) {
                const saved = await tx.get(await indexKey(OPERATIONS, old.operationRef));
                if (!validOperation(saved) || saved.operationRef !== old.operationRef || saved.kind !== old.kind
                    || saved.deleteAt !== old.deleteAt || !matchesRoute(saved, route)) fail('storage-corrupt');
            }
            const operationKey = operation && await indexKey(OPERATIONS, authorization.operationRef);
            if (operation) {
                const existing = await tx.get(operationKey);
                if (existing !== undefined && (!validOperation(existing) || existing.operationRef !== authorization.operationRef)) fail('storage-corrupt');
                if (existing && existing.deleteAt > now() && (!matchesRoute(existing, route) || existing.kind !== operation)) fail('idempotency-conflict');
                const local = loaded.state?.operations.find(item => item.operationRef === authorization.operationRef && item.deleteAt > now());
                if (local && (!existing || !matchesRoute(existing, route) || existing.deleteAt !== local.deleteAt || existing.kind !== local.kind)) fail('storage-corrupt');
            }
            if (operation === 'complete' && authorization.status === 'approved') {
                const reference = `${authorization.verifierRef}\0${authorization.decisionRef}`, key = await referenceKey('decision', reference), saved = await tx.get(key);
                if (saved !== undefined && (!validReference(saved) || saved.reference !== reference || saved.space !== 'decision')) fail('storage-corrupt');
                if (saved?.deleteAt > now() && !matchesRoute(saved, route)) fail('reused-decision');
            }
            const result = await fn({
                get: async key => { if (key !== PARTICIPATION_LEDGER_KEY) fail('invalid-storage-key'); return clone(value); },
                put: async (key, next) => {
                    if (key !== PARTICIPATION_LEDGER_KEY || !validParticipationLedgerState(next, PARTICIPATION_RECORD_LIMITS)) fail('storage-corrupt'); value = clone(next);
                }
            });
            fresh(authorization);
            const currentTime = () => {
                fresh(authorization);
                if (maintenance || !['begin', 'complete', 'lookup'].includes(authMethod)) return;
                const current = policy.config.policy;
                if (current.state !== 'qualified' || current.effectiveAt > now() || current.expiresAt <= now()) fail('policy-not-active');
                if (value.subjects.some(item => ['pending', 'authorized'].includes(item.record.state) && item.record.expiresAt <= now())) fail('subject-not-active');
            };
            currentTime();
            const changed = JSON.stringify(value) !== JSON.stringify(loaded.state);
            if (!changed) { await syncReferences(tx, loaded.state, value, route, now()); currentTime(); return result; }
            const subject = value.subjects[0]?.record, oldSubject = loaded.state?.subjects[0]?.record;
            if (subject && (subject.principalRef !== route.principalRef || subject.communityRef !== route.communityRef)) fail('storage-corrupt');
            if (!loaded.state && kinds.some(kind => value[kind].length)) {
                if (!subject || await admitSubject({ tx, principalRef: route.principalRef, communityRef: route.communityRef, partitionKey: route.partitionKey, at: now() }) !== true) fail('allocation-refused');
            }
            await syncReferences(tx, loaded.state, value, route, now());
            if (oldSubject && oldSubject.subjectRef !== subject?.subjectRef) {
                const key = await indexKey(SUBJECTS, oldSubject.subjectRef), previous = await tx.get(key);
                if (!validAnchor(previous, route) || previous.subjectRef !== oldSubject.subjectRef) fail('storage-corrupt'); await tx.delete(key);
            }
            if (subject) {
                const key = await indexKey(SUBJECTS, subject.subjectRef), previous = await tx.get(key);
                if (previous !== undefined && (!validAnchor(previous, route) || previous.subjectRef !== subject.subjectRef)) fail('reference-conflict');
                const anchor = { version: 1, principalRef: route.principalRef, communityRef: route.communityRef, partitionKey: route.partitionKey, subjectRef: subject.subjectRef };
                await tx.put(key, anchor); await tx.put(route.anchorKey, anchor);
            }
            for (const old of loaded.state?.operations || []) if (!value.operations.some(item => item.operationRef === old.operationRef)) {
                const key = await indexKey(OPERATIONS, old.operationRef), previous = await tx.get(key);
                if (previous === undefined) { if (old.deleteAt > now()) fail('storage-corrupt'); continue; }
                if (!validOperation(previous) || previous.operationRef !== old.operationRef) fail('storage-corrupt');
                if (matchesRoute(previous, route) && previous.deleteAt === old.deleteAt) await tx.delete(key);
                else if (old.deleteAt > now()) fail('storage-corrupt'); // Expired refs may legitimately have been reused elsewhere.
            }
            if (operation) {
                const receipt = value.operations.find(item => item.operationRef === authorization.operationRef);
                if (receipt) await tx.put(operationKey, { version: 1, operationRef: receipt.operationRef, kind: receipt.kind,
                    principalRef: route.principalRef, communityRef: route.communityRef, partitionKey: route.partitionKey, deleteAt: receipt.deleteAt });
            }
            if (kinds.every(kind => !value[kind].length)) {
                if (loaded.state && releaseSubject && await releaseSubject({ tx, principalRef: route.principalRef, communityRef: route.communityRef,
                    partitionKey: route.partitionKey, at: now() }) !== true) fail('allocation-release-refused');
                await tx.delete(route.partitionKey); await tx.delete(route.anchorKey);
            } else await tx.put(route.partitionKey, value);
            currentTime(); return result;
        }) };
        const cached = { ...adapters, [['begin', 'lookup', 'selfWithdraw'].includes(authMethod) ? 'authenticateParticipant' : authMethod === 'complete' ? 'verifyConsent' : 'authenticateGuardian']: async () => clone(authorization) };
        return createParticipationConsents({ storage: partitionStorage, adapters: cached, now, randomRef, limits: PARTICIPATION_RECORD_LIMITS });
    };
    return Object.freeze({
        installPolicy: guarded(async proof => {
            const authorization = await authenticate('qualifyPolicy', { proof });
            const policyStorage = { transaction: fn => storage.transaction(async tx => {
                const result = await fn({ get: key => { if (key !== PARTICIPATION_LEDGER_KEY) fail('invalid-storage-key'); return tx.get(PARTICIPATION_POLICY_KEY); },
                    put: (key, value) => { if (key !== PARTICIPATION_LEDGER_KEY || kinds.some(kind => value[kind].length)) fail('invalid-policy'); return tx.put(PARTICIPATION_POLICY_KEY, value); } });
                fresh(authorization); return result;
            }) };
            return createParticipationConsents({ storage: policyStorage, adapters: { ...adapters, qualifyPolicy: async () => clone(authorization) }, now, randomRef,
                limits: PARTICIPATION_RECORD_LIMITS }).installPolicy(proof);
        }),
        begin: guarded(async (proof, request) => {
            const auth = await authenticate('authenticateParticipant', { proof, purpose: 'begin', request });
            const route = await routeFor(auth?.principalRef, auth?.communityRef);
            if (!ref(auth?.operationRef)) fail('not-authorized');
            return ledgerFor(route, auth, 'begin', 'begin').begin(proof, request);
        }),
        complete: guarded(async proof => {
            const auth = await authenticate('verifyConsent', { proof }), route = await subjectRoute(auth);
            if (auth.principalRef !== route.principalRef) fail('not-authorized');
            if (!ref(auth?.operationRef)) fail('not-authorized');
            return ledgerFor(route, auth, 'complete', 'complete').complete(proof);
        }),
        lookup: guarded(async proof => {
            const auth = await authenticate('authenticateParticipant', { proof, purpose: 'lookup' }), route = await routeFor(auth?.principalRef, auth?.communityRef);
            return ledgerFor(route, auth, 'lookup').lookup(proof);
        }),
        selfWithdraw: guarded(async (proof, request) => {
            const auth = await authenticate('authenticateParticipant', { proof, purpose: 'self-withdraw', request });
            const route = await routeFor(auth?.principalRef, auth?.communityRef);
            return ledgerFor(route, auth, 'selfWithdraw').selfWithdraw(proof, request);
        }),
        change: guarded(async (proof, request) => {
            const auth = await authenticate('authenticateGuardian', { proof, request });
            const route = await subjectRoute(auth);
            return ledgerFor(route, auth, 'change').change(proof, request);
        }),
        sweep: guarded(async (proof, { cursor = '', limit = PARTICIPATION_PARTITION_BOUNDS.maintenancePage } = {}) => {
            if (!Number.isInteger(limit) || limit < 1 || limit > PARTICIPATION_PARTITION_BOUNDS.maintenancePage || typeof cursor !== 'string'
                || cursor && !(cursor.startsWith(PARTS) && /^[a-f0-9]{64}$/.test(cursor.slice(PARTS.length)))) fail('invalid-cursor');
            const auth = await authenticate('authorizeMaintenance', { proof });
            if (!exact(auth, ['communityRef', 'expiresAt']) || !ref(auth.communityRef)) fail('not-authorized'); fresh(auth);
            const keys = await storage.transaction(async tx => {
                const policy = await root(tx); if (auth.communityRef !== policy.config.policy.communityRef || typeof tx.list !== 'function') fail('not-authorized');
                const found = await tx.list({ prefix: PARTS, ...(cursor ? { startAfter: cursor } : {}), limit });
                if (!(found instanceof Map) || found.size > limit) fail('maintenance-unavailable');
                const names = [...found.keys()];
                if (names.some((key, i) => typeof key !== 'string' || !key.startsWith(PARTS) || !/^[a-f0-9]{64}$/.test(key.slice(PARTS.length)) || key <= (names[i - 1] || cursor))) fail('maintenance-unavailable');
                fresh(auth); return names;
            });
            const results = [];
            for (const key of keys) {
                const state = await storage.transaction(tx => tx.get(key));
                if (state === undefined) { results.push({ ok: true, absent: true }); continue; }
                if (!validParticipationLedgerState(state, PARTICIPATION_RECORD_LIMITS)) fail('storage-corrupt');
                const principalRef = state.subjects[0]?.record.principalRef;
                const anchor = principalRef ? null : await storage.transaction(tx => tx.get(`${ANCHORS}${key.slice(PARTS.length)}`));
                const route = await routeFor(principalRef || anchor?.principalRef, state.config.policy.communityRef);
                if (route.partitionKey !== key || auth.communityRef !== route.communityRef) fail('storage-corrupt');
                results.push(await ledgerFor(route, auth, 'maintenance', null, true).sweep());
            }
            return { ok: results.every(result => result.ok), examined: keys.length, results, nextCursor: keys.length === limit ? keys.at(-1) : '' };
        })
    });
}
