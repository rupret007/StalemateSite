// Restricted, storage-injected incident primitives. No routes, appointments,
// production policy, evidence discovery, notifications or key provisioning.
const enc = new TextEncoder();
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, names) => plain(value) && Object.keys(value).length === names.length && Object.keys(value).every(name => names.includes(name));
const ref = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,96}$/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const time = value => Number.isSafeInteger(value) && value >= 0;
const revision = value => Number.isSafeInteger(value) && value >= 1;
const copy = value => structuredClone(value);
const size = value => enc.encode(JSON.stringify(value)).byteLength;
const TYPES = ['safety', 'rights', 'copyright', 'intimate-image', 'legal-process'];
const PROVENANCE = ['reported-public', 'unverified-private-allegation'];
const ACTIONS = ['preserve-selected-report', 'review', 'hold', 'access', 'read-case', 'read-evidence', 'cleanup-case', 'prune-receipts'];
// Defensive implementation ceilings, not a chosen production capacity/policy.
export const INCIDENT_CEILINGS = Object.freeze({ maxCases: 64, maxBytes: 8 * 1024 * 1024,
    maxEvidenceBytes: 256 * 1024, maxAuditEvents: 4096, maxOperations: 4096, maxTombstones: 4096, maxAccess: 20 });
const fail = code => { throw Object.assign(new Error(code), { incidentCode: code }); };
const b64 = value => {
    let result = ''; for (let i = 0; i < value.length; i += 8192) result += String.fromCharCode(...value.subarray(i, i + 8192));
    return btoa(result);
};
const unb64 = value => {
    if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) fail('storage-unavailable');
    return Uint8Array.from(atob(value), char => char.charCodeAt(0));
};
export async function incidentEvidenceDigest(bytes, cryptoImpl = globalThis.crypto) {
    if (!(bytes instanceof Uint8Array)) throw new TypeError('Evidence bytes required');
    return [...new Uint8Array(await cryptoImpl.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
}

// Only a caller-provisioned, non-extractable AES key is accepted. Key provenance,
// rotation and backup recovery remain the approved key owner's responsibility.
export function createIncidentEvidenceCipher({ keyId, key, cryptoImpl = globalThis.crypto } = {}) {
    if (!ref(keyId) || !key || key.type !== 'secret' || key.extractable !== false || key.algorithm?.name !== 'AES-GCM'
        || ![128, 192, 256].includes(key.algorithm.length) || !key.usages?.includes('encrypt') || !key.usages?.includes('decrypt')
        || !cryptoImpl?.subtle || typeof cryptoImpl.getRandomValues !== 'function') throw new TypeError('Purpose-specific incident key required');
    const aad = context => enc.encode(JSON.stringify(['hangout-incident-evidence-v1', context]));
    return Object.freeze({
        async encrypt(bytes, context) {
            if (!(bytes instanceof Uint8Array) || bytes.byteLength > INCIDENT_CEILINGS.maxEvidenceBytes) throw new TypeError('Bounded evidence required');
            const iv = cryptoImpl.getRandomValues(new Uint8Array(12));
            const ciphertext = await cryptoImpl.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(context), tagLength: 128 }, key, bytes);
            return { v: 1, keyId, iv: b64(iv), ciphertext: b64(new Uint8Array(ciphertext)) };
        },
        async decrypt(value, context) {
            if (!validCipher(value) || value.keyId !== keyId) fail('evidence-unavailable');
            try { return new Uint8Array(await cryptoImpl.subtle.decrypt({ name: 'AES-GCM', iv: unb64(value.iv), additionalData: aad(context), tagLength: 128 }, key, unb64(value.ciphertext))); }
            catch { fail('evidence-unavailable'); }
        }
    });
}
function validCipher(value) {
    return exact(value, ['v', 'keyId', 'iv', 'ciphertext']) && value.v === 1 && ref(value.keyId)
        && typeof value.iv === 'string' && value.iv.length === 16 && /^[A-Za-z0-9+/]{16}$/.test(value.iv)
        && typeof value.ciphertext === 'string' && value.ciphertext.length <= Math.ceil((INCIDENT_CEILINGS.maxEvidenceBytes + 16) / 3) * 4
        && value.ciphertext.length >= 24 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.ciphertext);
}
// Explicit provisioning only. The service never treats a missing/wiped record
// as a fresh namespace; the owner must distinguish first setup from recovery.
export const initialIncidentCaseState = () => ({ v: 1, cases: [], operations: [], audit: [], tombstones: [] });
const caseKeys = ['id', 'revision', 'type', 'review', 'hold', 'evidence', 'source', 'cipher', 'access', 'createdAt', 'updatedAt',
    'policyVersion', 'procedure', 'reviewAt', 'evidenceDeleteAt', 'caseDeleteAt', 'tombstoneUntil'];
function validCase(record) {
    if (!exact(record, caseKeys) || !ref(record.id) || !revision(record.revision) || !TYPES.includes(record.type)
        || !['open', 'triaged', 'closed'].includes(record.review) || !Array.isArray(record.access) || !record.access.length
        || record.access.length > INCIDENT_CEILINGS.maxAccess || record.access.some(id => !ref(id)) || new Set(record.access).size !== record.access.length
        || !['createdAt', 'updatedAt', 'reviewAt', 'evidenceDeleteAt', 'caseDeleteAt', 'tombstoneUntil'].every(key => time(record[key]))
        || record.updatedAt < record.createdAt || record.caseDeleteAt < record.evidenceDeleteAt || record.tombstoneUntil < record.caseDeleteAt
        || !ref(record.policyVersion) || !ref(record.procedure)
        || !exact(record.hold, ['state', 'until', 'authority', 'reason']) || !['none', 'active', 'released'].includes(record.hold.state)
        || !ref(record.hold.authority) || !ref(record.hold.reason)
        || (record.hold.state === 'active' ? !time(record.hold.until) || !ref(record.hold.authority) || !ref(record.hold.reason) : record.hold.until !== null)) return false;
    if (record.evidence?.state === 'deleted') return exact(record.evidence, ['state', 'deletedAt']) && time(record.evidence.deletedAt) && record.source === null && record.cipher === null;
    return exact(record.evidence, ['state', 'id', 'digest', 'bytes', 'provenance', 'collectedAt']) && record.evidence.state === 'present'
        && ref(record.evidence.id) && digest(record.evidence.digest) && Number.isSafeInteger(record.evidence.bytes) && record.evidence.bytes >= 1
        && record.evidence.bytes <= INCIDENT_CEILINGS.maxEvidenceBytes && PROVENANCE.includes(record.evidence.provenance) && time(record.evidence.collectedAt)
        && exact(record.source, ['id', 'revision', 'digest', 'expiresAt']) && ref(record.source.id) && revision(record.source.revision)
        && digest(record.source.digest) && record.source.digest === record.evidence.digest && time(record.source.expiresAt)
        && record.tombstoneUntil >= record.source.expiresAt && validCipher(record.cipher);
}
function validDeadlines(value) {
    return exact(value, ['reviewAt', 'holdUntil', 'evidenceDeleteAt', 'caseDeleteAt', 'tombstoneUntil'])
        && ['reviewAt', 'evidenceDeleteAt', 'caseDeleteAt', 'tombstoneUntil'].every(key => time(value[key]))
        && (value.holdUntil === null || time(value.holdUntil)) && value.caseDeleteAt >= value.evidenceDeleteAt && value.tombstoneUntil >= value.caseDeleteAt;
}
function validState(value) {
    if (!exact(value, ['v', 'cases', 'operations', 'audit', 'tombstones']) || value.v !== 1 || size(value) > INCIDENT_CEILINGS.maxBytes
        || !['cases', 'operations', 'audit', 'tombstones'].every(name => Array.isArray(value[name]))
        || value.cases.length > INCIDENT_CEILINGS.maxCases || value.operations.length > INCIDENT_CEILINGS.maxOperations
        || value.audit.length > INCIDENT_CEILINGS.maxAuditEvents || value.tombstones.length > INCIDENT_CEILINGS.maxTombstones
        || !value.cases.every(validCase)) return false;
    const ids = array => new Set(array).size === array.length;
    if (!ids([...value.cases.map(c => c.id), ...value.tombstones.map(t => t.caseRef)]) || !ids(value.operations.map(o => o.id)) || !ids(value.audit.map(a => a.id))) return false;
    return value.tombstones.every(t => exact(t, ['caseRef', 'revision', 'at', 'until']) && ref(t.caseRef) && revision(t.revision) && time(t.at) && time(t.until) && t.until >= t.at)
        && value.operations.every(o => exact(o, ['id', 'actorRef', 'caseRef', 'action', 'fingerprint', 'receipt', 'until']) && ref(o.id) && ref(o.actorRef)
            && (o.caseRef === null || ref(o.caseRef)) && ACTIONS.includes(o.action) && digest(o.fingerprint) && time(o.until)
            && exact(o.receipt, ['ok', 'caseRef', 'revision', 'action', 'at']) && o.receipt.ok === true && o.receipt.caseRef === o.caseRef
            && (o.receipt.revision === null || revision(o.receipt.revision)) && o.receipt.action === o.action && time(o.receipt.at) && o.until >= o.receipt.at)
        && value.audit.every(a => exact(a, ['id', 'caseRef', 'actorRef', 'appointmentRevision', 'action', 'reason', 'authority', 'policyVersion', 'at', 'before', 'after', 'deadlines', 'outcome', 'until'])
            && ref(a.id) && (a.caseRef === null || ref(a.caseRef)) && ref(a.actorRef) && revision(a.appointmentRevision) && ACTIONS.includes(a.action)
            && ref(a.reason) && ref(a.authority) && ref(a.policyVersion) && time(a.at) && time(a.until) && a.until >= a.at
            && (a.before === null || revision(a.before)) && (a.after === null || revision(a.after))
            && (a.caseRef === null ? a.deadlines === null : validDeadlines(a.deadlines)) && a.outcome === 'committed');
}
function validPolicy(policy, at) {
    return exact(policy, ['qualified', 'version', 'procedure', 'authority', 'reason', 'validFrom', 'validUntil', 'reviewAt', 'holdUntil',
        'evidenceDeleteAt', 'caseDeleteAt', 'tombstoneUntil', 'receiptUntil', 'auditUntil', 'limits']) && policy.qualified === true
        && ['version', 'procedure', 'authority', 'reason'].every(key => ref(policy[key])) && time(policy.validFrom) && policy.validFrom <= at
        && time(policy.validUntil) && policy.validUntil > at
        && ['reviewAt', 'evidenceDeleteAt', 'caseDeleteAt', 'tombstoneUntil', 'receiptUntil', 'auditUntil'].every(key => time(policy[key]))
        && policy.receiptUntil > at && policy.auditUntil > at && policy.caseDeleteAt >= policy.evidenceDeleteAt && policy.tombstoneUntil >= policy.caseDeleteAt
        && (policy.holdUntil === null || time(policy.holdUntil) && policy.evidenceDeleteAt >= policy.holdUntil)
        && exact(policy.limits, Object.keys(INCIDENT_CEILINGS).filter(key => key !== 'maxAccess'))
        && Object.entries(policy.limits).every(([key, value]) => Number.isSafeInteger(value) && value >= 1 && value <= INCIDENT_CEILINGS[key]);
}
function validAuthority(value, at) {
    return plain(value) && value.incidentReviewer === true && value.active === true && ref(value.actorRef)
        && revision(value.revision) && time(value.expiresAt) && value.expiresAt > at;
}
const context = record => ({ caseRef: record.id, evidenceRef: record.evidence.id, source: record.source,
    provenance: record.evidence.provenance, collectedAt: record.evidence.collectedAt });
function view(record, at) {
    const result = copy(record); delete result.cipher;
    result.reviewDue = record.review !== 'closed' && at >= record.reviewAt;
    result.holdOverdue = record.hold.state === 'active' && at >= record.hold.until;
    if (result.evidence.state === 'present' && record.hold.state !== 'active' && at >= record.evidenceDeleteAt) result.evidence.state = 'deletion-due';
    return result;
}
const requestKeys = {
    'preserve-selected-report': ['principal', 'operationId', 'sourceId', 'sourceRevision', 'sourceDigest', 'type'],
    review: ['principal', 'operationId', 'caseRef', 'expectedRevision', 'status'],
    hold: ['principal', 'operationId', 'caseRef', 'expectedRevision', 'state'],
    access: ['principal', 'operationId', 'caseRef', 'expectedRevision', 'actorRefs'],
    'read-case': ['principal', 'operationId', 'caseRef'],
    'read-evidence': ['principal', 'operationId', 'caseRef', 'expectedRevision'],
    'cleanup-case': ['principal', 'operationId', 'caseRef', 'expectedRevision'],
    'prune-receipts': ['principal', 'operationId']
};

export function createIncidentCases({ storage, resolveAuthority, resolveReviewer, policyFor, loadEvidence, cipher,
    now = () => Date.now(), newRef = kind => `${kind}_${crypto.randomUUID().replaceAll('-', '')}`, key = 'restricted-incident-cases-v1' } = {}) {
    if (!storage || typeof storage.transaction !== 'function' || [resolveAuthority, resolveReviewer, policyFor, loadEvidence, now, newRef].some(fn => typeof fn !== 'function')
        || typeof cipher?.encrypt !== 'function' || typeof cipher?.decrypt !== 'function' || !ref(key)) throw new TypeError('Explicit incident adapters required');
    async function run(action, raw) {
        try {
            if (!exact(raw, requestKeys[action]) || !ref(raw.operationId)) fail('invalid-request');
            // Retain only bounded command identifiers. In particular no caller
            // can supply replacement evidence, deadlines, roles or audit text.
            const { principal, ...request } = raw;
            if (action === 'preserve-selected-report') {
                if (!ref(request.sourceId) || !revision(request.sourceRevision) || !digest(request.sourceDigest) || !TYPES.includes(request.type)) fail('invalid-request');
            } else if (action !== 'prune-receipts' && (!ref(request.caseRef) || action !== 'read-case' && !revision(request.expectedRevision))) fail('invalid-request');
            if (action === 'review' && !['triaged', 'closed'].includes(request.status) || action === 'hold' && !['active', 'released'].includes(request.state)
                || action === 'access' && (!Array.isArray(request.actorRefs) || request.actorRefs.length < 1 || request.actorRefs.length > INCIDENT_CEILINGS.maxAccess
                    || request.actorRefs.some(id => !ref(id)) || new Set(request.actorRefs).size !== request.actorRefs.length)) fail('invalid-request');
            const command = Object.fromEntries(requestKeys[action].filter(name => name !== 'principal').map(name => [name, copy(request[name])]));
            if (action === 'access') command.actorRefs.sort();
            const fingerprint = await incidentEvidenceDigest(enc.encode(JSON.stringify([action, command])));
            return await storage.transaction(async tx => {
                const at = now(); if (!time(at)) fail('unavailable');
                const authority = await resolveAuthority({ tx, principal, at });
                if (!validAuthority(authority, at)) fail('forbidden');
                let state = await tx.get(key);
                if (!validState(state)) fail('storage-unavailable');
                state = copy(state);
                let record = state.cases.find(c => c.id === command.caseRef), before = record?.revision ?? null;
                const assignees = [];
                const prior = state.operations.find(o => o.id === command.operationId);
                if (prior && (prior.actorRef !== authority.actorRef || prior.fingerprint !== fingerprint)) fail('operation-conflict');
                if (prior && prior.until <= at) fail('operation-expired');
                const creating = action === 'preserve-selected-report', maintenance = action === 'prune-receipts';
                if (creating ? authority.canOpen !== true : maintenance ? authority.canMaintain !== true : !record || !record.access.includes(authority.actorRef)) {
                    // Once retired, only the original appointed actor can replay
                    // its content-free historical receipt; never evidence/ACLs.
                    if (!prior || creating || maintenance || ['read-case', 'read-evidence'].includes(action)
                        || !state.tombstones.some(t => t.caseRef === prior.caseRef)) fail('forbidden');
                }
                const policyCase = record ? view(record, at) : null;
                const policy = await policyFor({ tx, action, at, request: copy(command), case: copy(policyCase) });
                if (!validPolicy(policy, at)) fail('policy-unqualified');
                const policyStamp = JSON.stringify(policy);
                let payload;
                if (prior && !['read-case', 'read-evidence'].includes(action)) {
                    const current = state.cases.find(c => c.id === prior.caseRef);
                    if (current && !current.access.includes(authority.actorRef)) fail('forbidden');
                    (await recheck())(); return { ...copy(prior.receipt), replayed: true };
                }
                if (record && command.expectedRevision !== undefined && command.expectedRevision !== record.revision) fail('revision-conflict');
                if (prior && ['read-case', 'read-evidence'].includes(action) && prior.receipt.revision !== record.revision) fail('revision-conflict');
                if (creating) {
                    const loaded = await loadEvidence({ tx, sourceId: command.sourceId });
                    if (!loaded) fail('source-unavailable');
                    const source = copy(loaded);
                    if (!exact(source, ['id', 'revision', 'digest', 'bytes', 'expiresAt', 'provenance']) || source.id !== command.sourceId
                        || source.revision !== command.sourceRevision || source.digest !== command.sourceDigest || !(source.bytes instanceof Uint8Array)
                        || !time(source.expiresAt) || source.expiresAt <= at || !PROVENANCE.includes(source.provenance)) fail('source-conflict');
                    const bytes = new Uint8Array(source.bytes);
                    if (!bytes.byteLength || bytes.byteLength > policy.limits.maxEvidenceBytes) fail('capacity');
                    if (await incidentEvidenceDigest(bytes) !== command.sourceDigest) fail('source-conflict');
                    if (policy.reviewAt <= at || policy.evidenceDeleteAt <= at || policy.holdUntil !== null && policy.holdUntil <= at
                        || policy.receiptUntil < source.expiresAt || policy.tombstoneUntil < source.expiresAt) fail('policy-unqualified');
                    const id = newRef('case'), evidenceId = newRef('evidence');
                    if (!ref(id) || !ref(evidenceId) || state.cases.some(c => c.id === id || c.evidence.id === evidenceId)
                        || state.tombstones.some(t => t.caseRef === id)) fail('reference-conflict');
                    record = { id, revision: 1, type: command.type, review: 'open',
                        hold: { state: policy.holdUntil === null ? 'none' : 'active', until: policy.holdUntil, authority: policy.authority, reason: policy.reason },
                        evidence: { state: 'present', id: evidenceId, digest: source.digest, bytes: bytes.byteLength, provenance: source.provenance, collectedAt: at },
                        source: { id: source.id, revision: source.revision, digest: source.digest, expiresAt: source.expiresAt }, cipher: null,
                        access: [authority.actorRef], createdAt: at, updatedAt: at, policyVersion: policy.version, procedure: policy.procedure,
                        reviewAt: policy.reviewAt, evidenceDeleteAt: policy.evidenceDeleteAt, caseDeleteAt: policy.caseDeleteAt, tombstoneUntil: policy.tombstoneUntil };
                    record.cipher = await cipher.encrypt(bytes, context(record));
                    if (!validCipher(record.cipher)) fail('evidence-unavailable');
                    state.cases.push(record);
                } else if (action === 'review') {
                    if (!(record.review === 'open' && command.status === 'triaged' || record.review === 'triaged' && command.status === 'closed')) fail('invalid-transition');
                    record.review = command.status; record.revision += 1;
                } else if (action === 'hold') {
                    if (command.state === 'active') {
                        if (policy.holdUntil === null || policy.holdUntil <= at || record.evidence.state !== 'present' || record.hold.state === 'active' && policy.holdUntil <= record.hold.until
                            || policy.evidenceDeleteAt < record.evidenceDeleteAt || policy.caseDeleteAt < record.caseDeleteAt) fail('invalid-transition');
                        record.hold = { state: 'active', until: policy.holdUntil, authority: policy.authority, reason: policy.reason };
                    } else {
                        if (record.hold.state !== 'active' || policy.holdUntil !== null) fail('invalid-transition');
                        record.hold = { state: 'released', until: null, authority: policy.authority, reason: policy.reason };
                    }
                    if (policy.evidenceDeleteAt < at || policy.reviewAt <= at) fail('policy-unqualified');
                    record.reviewAt = policy.reviewAt; record.evidenceDeleteAt = policy.evidenceDeleteAt; record.caseDeleteAt = policy.caseDeleteAt;
                    record.tombstoneUntil = Math.max(record.tombstoneUntil, policy.tombstoneUntil); record.revision += 1;
                } else if (action === 'access') {
                    if (!command.actorRefs.includes(authority.actorRef)) fail('invalid-transition');
                    for (const actorRef of command.actorRefs) {
                        const appointed = await resolveReviewer({ tx, actorRef, at });
                        if (!validAuthority(appointed, at) || appointed.actorRef !== actorRef) fail('forbidden');
                        assignees.push({ actorRef, revision: appointed.revision });
                    }
                    record.access = [...command.actorRefs]; record.revision += 1;
                } else if (action === 'read-case') payload = { case: view(record, prior ? prior.receipt.at : at) };
                else if (action === 'read-evidence') {
                    if (record.evidence.state !== 'present') fail('evidence-unavailable');
                    if (!evidenceReadable(record, at)) fail('evidence-retention-due');
                    const bytes = await cipher.decrypt(record.cipher, context(record));
                    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== record.evidence.bytes || await incidentEvidenceDigest(bytes) !== record.evidence.digest) fail('evidence-unavailable');
                    payload = { evidence: { id: record.evidence.id, provenance: record.evidence.provenance, digest: record.evidence.digest, bytes: new Uint8Array(bytes) } };
                } else if (action === 'cleanup-case') {
                    if (record.hold.state === 'active') fail('hold-active');
                    if (at < record.evidenceDeleteAt) fail('not-due');
                    if (record.evidence.state === 'deleted' && (at < record.caseDeleteAt || record.review !== 'closed')) fail(record.review === 'closed' ? 'not-due' : 'review-required');
                    if (record.evidence.state === 'present') { record.evidence = { state: 'deleted', deletedAt: at }; record.cipher = null; record.source = null; }
                    record.revision += 1;
                    if (at >= record.caseDeleteAt && record.review === 'closed') {
                        state.cases = state.cases.filter(c => c !== record);
                        state.tombstones.push({ caseRef: record.id, revision: record.revision, at, until: Math.max(at, record.tombstoneUntil) });
                    }
                } else if (maintenance) {
                    state.operations = state.operations.filter(o => o.until > at);
                    state.audit = state.audit.filter(a => a.until > at);
                    state.tombstones = state.tombstones.filter(t => t.until > at);
                }
                if (record && !['read-case', 'read-evidence'].includes(action)) { record.updatedAt = at; record.policyVersion = policy.version; record.procedure = policy.procedure; }
                const receipt = { ok: true, caseRef: record?.id ?? null, revision: record?.revision ?? null, action, at };
                if (!prior) {
                    state.audit.push({ id: command.operationId, caseRef: receipt.caseRef, actorRef: authority.actorRef, appointmentRevision: authority.revision,
                        action, reason: policy.reason, authority: policy.authority, policyVersion: policy.version, at, before, after: receipt.revision,
                        deadlines: record ? { reviewAt: record.reviewAt, holdUntil: record.hold.until, evidenceDeleteAt: record.evidenceDeleteAt,
                            caseDeleteAt: record.caseDeleteAt, tombstoneUntil: record.tombstoneUntil } : null,
                        outcome: 'committed', until: policy.auditUntil });
                    state.operations.push({ id: command.operationId, actorRef: authority.actorRef, caseRef: receipt.caseRef, action, fingerprint,
                        receipt, until: policy.receiptUntil });
                }
                const L = policy.limits;
                if (state.cases.length > L.maxCases || state.audit.length > L.maxAuditEvents || state.operations.length > L.maxOperations
                    || state.tombstones.length > L.maxTombstones || size(state) > L.maxBytes) fail('capacity');
                if (!validState(state)) fail('storage-unavailable');
                (await recheck())();
                if (!prior) {
                    await tx.put(key, state);
                    // A final awaited write can cross expiry or observe changed
                    // authority. Throwing here rolls the whole transaction back.
                    // No state write follows this final authorization barrier.
                    (await recheck())();
                }
                return { ...(prior ? { ...copy(prior.receipt), replayed: true } : receipt), ...copy(payload || {}) };

                async function recheck() {
                    const lookupAt = now(); if (!time(lookupAt) || lookupAt < at) fail('unavailable');
                    if (prior && prior.until <= lookupAt) fail('operation-expired');
                    const current = await resolveAuthority({ tx, principal, at: lookupAt });
                    const authorityAt = now(); if (!time(authorityAt) || authorityAt < lookupAt) fail('unavailable');
                    let checkedAt = authorityAt;
                    if (!validAuthority(current, authorityAt) || current.actorRef !== authority.actorRef || current.revision !== authority.revision
                        || creating && current.canOpen !== true || maintenance && current.canMaintain !== true) fail('forbidden');
                    const currentAssignees = [];
                    for (const assigned of assignees) {
                        const currentAssignee = await resolveReviewer({ tx, actorRef: assigned.actorRef, at: lookupAt });
                        const assigneeAt = now(); if (!time(assigneeAt) || assigneeAt < checkedAt) fail('unavailable');
                        checkedAt = assigneeAt;
                        if (!validAuthority(currentAssignee, assigneeAt) || currentAssignee.actorRef !== assigned.actorRef || currentAssignee.revision !== assigned.revision) fail('forbidden');
                        currentAssignees.push(currentAssignee);
                    }
                    const currentPolicy = await policyFor({ tx, action, at: lookupAt, request: copy(command), case: copy(policyCase) });
                    // The caller invokes this synchronously AFTER awaiting the
                    // fresh views. No pre-await timestamp can grant a late read,
                    // replay or write, including expiry during policy lookup.
                    return () => {
                        const finish = now(); if (!time(finish) || finish < checkedAt) fail('unavailable');
                        if (prior && prior.until <= finish) fail('operation-expired');
                        if (!validAuthority(current, finish) || current.actorRef !== authority.actorRef || current.revision !== authority.revision
                            || creating && current.canOpen !== true || maintenance && current.canMaintain !== true) fail('forbidden');
                        for (const [index, assigned] of assignees.entries()) {
                            const currentAssignee = currentAssignees[index];
                            if (!validAuthority(currentAssignee, finish) || currentAssignee.actorRef !== assigned.actorRef || currentAssignee.revision !== assigned.revision) fail('forbidden');
                        }
                        if (!validPolicy(currentPolicy, finish) || JSON.stringify(currentPolicy) !== policyStamp) fail('policy-unqualified');
                        if (creating && !prior && record.source.expiresAt <= finish) fail('source-unavailable');
                        if (creating && !prior && record.evidenceDeleteAt <= finish) fail('policy-unqualified');
                        if (action === 'read-evidence' && !evidenceReadable(record, finish)) fail('evidence-retention-due');
                    };
                }
            });
        } catch (error) { return { ok: false, error: error?.incidentCode || 'storage-unavailable' }; }
    }
    return Object.freeze({ preserveSelectedReport: request => run('preserve-selected-report', request),
        transitionReview: request => run('review', request), changeHold: request => run('hold', request), setAccess: request => run('access', request),
        readCase: request => run('read-case', request), readEvidence: request => run('read-evidence', request),
        cleanupCase: request => run('cleanup-case', request), pruneReceipts: request => run('prune-receipts', request) });
}
function evidenceReadable(record, at) {
    return at < record.evidenceDeleteAt || record.hold.state === 'active' && record.hold.until > at;
}
