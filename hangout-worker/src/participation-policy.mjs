// Inactive foundation: trusted server records only, with no enrollment, storage,
// provider calls or connection to the current beta's admission/media paths.
// A qualified policy is an externally established decision, not a determination
// this module can make. A true result never replaces the existing engine checks.
const PURPOSES = Object.freeze(['public-text', 'public-artifact', 'public-disclosure', 'room-creation',
    'room-registration', 'direct-contact', 'camera', 'audio', 'media-reception', 'external-provider', 'ai-public-review']);
const ACTION_PURPOSES = Object.freeze(Object.fromEntries(Object.entries({
    publicText: ['public-text', 'public-disclosure'],
    publicArtifact: ['public-artifact', 'public-disclosure'],
    createRoom: ['room-creation', 'public-artifact', 'public-disclosure'],
    registerRoom: ['room-registration', 'public-disclosure'],
    requestDirectContact: ['direct-contact'], acceptDirectContact: ['direct-contact'],
    sendCamera: ['camera'], sendAudio: ['audio'], receiveMedia: ['media-reception'],
    externalProvider: ['external-provider'],
    aiPublicReview: ['public-text', 'public-disclosure', 'external-provider', 'ai-public-review']
}).map(([action, purposes]) => [action, Object.freeze(purposes)])));
export const PARTICIPATION_ACTIONS = Object.freeze(Object.keys(ACTION_PURPOSES));
export const PARTICIPATION_PURPOSES = PURPOSES;
export const PARTICIPATION_AUDIENCE = 'hangout-participation';
const STATES = new Set(['unknown', 'pending', 'authorized', 'declined', 'withdrawn', 'expired', 'policy-review-required']);
const POLICY_KEYS = ['version', 'policyVersion', 'revision', 'communityRef', 'noticeDigest', 'decisionRef',
    'state', 'purposes', 'issuedAt', 'effectiveAt', 'expiresAt', 'maxSessionMs'];
const SUBJECT_KEYS = ['version', 'subjectRef', 'principalRef', 'communityRef', 'policyVersion', 'policyRevision',
    'noticeDigest', 'revision', 'state', 'purposes', 'consentRefs', 'issuedAt', 'effectiveAt', 'expiresAt'];
const BINDING_KEYS = ['version', 'audience', 'subjectRef', 'principalRef', 'communityRef', 'policyVersion',
    'policyRevision', 'noticeDigest', 'subjectRevision', 'purposes', 'issuedAt', 'effectiveAt', 'expiresAt'];

// JSON-shaped records only. Unknown fields, inherited grants, accessors and
// symbol/nonenumerable additions are refused rather than silently discarded.
function record(value, required, optional = []) {
    if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
    const keys = Reflect.ownKeys(value);
    return required.every(key => Object.hasOwn(value, key)) && keys.every(key => typeof key === 'string'
        && (required.includes(key) || optional.includes(key)) && Object.getOwnPropertyDescriptor(value, key)?.enumerable === true
        && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
}
const ref = value => typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value);
const policyVersion = value => typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const revision = value => integer(value) && value > 0;
function list(value, valid, max) {
    return Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype && value.length <= max
        && Reflect.ownKeys(value).length === value.length + 1
        && Array.from({ length: value.length }, (_, i) => Object.getOwnPropertyDescriptor(value, String(i)))
            .every(entry => entry && Object.hasOwn(entry, 'value') && valid(entry.value))
        && new Set(value).size === value.length;
}
const purposes = value => list(value, purpose => PURPOSES.includes(purpose), PURPOSES.length);
const windowValid = value => integer(value.issuedAt) && integer(value.effectiveAt) && integer(value.expiresAt)
    && value.issuedAt <= value.effectiveAt && value.effectiveAt < value.expiresAt;
const current = (value, now) => value.issuedAt <= now && value.effectiveAt <= now && now < value.expiresAt;
const decision = (allowed, reason) => Object.freeze({ allowed, reason });

export function validParticipationPolicy(value) {
    try {
        return record(value, POLICY_KEYS) && value.version === 1 && policyVersion(value.policyVersion) && revision(value.revision)
            && ref(value.communityRef) && digest(value.noticeDigest) && ref(value.decisionRef)
            && ['qualified', 'unqualified', 'withdrawn'].includes(value.state) && purposes(value.purposes)
            && windowValid(value) && revision(value.maxSessionMs) && value.maxSessionMs <= value.expiresAt - value.effectiveAt;
    } catch { return false; }
}
export function validParticipationSubject(value) {
    try {
        return record(value, SUBJECT_KEYS) && value.version === 1 && ref(value.subjectRef) && ref(value.principalRef)
            && ref(value.communityRef) && policyVersion(value.policyVersion) && revision(value.policyRevision) && digest(value.noticeDigest)
            && revision(value.revision) && STATES.has(value.state) && purposes(value.purposes)
            && list(value.consentRefs, ref, 16) && windowValid(value)
            && (value.state !== 'authorized' || value.purposes.length > 0 && value.consentRefs.length > 0);
    } catch { return false; }
}
export function validParticipationBinding(value) {
    try {
        return record(value, BINDING_KEYS) && value.version === 1 && value.audience === PARTICIPATION_AUDIENCE
            && ref(value.subjectRef) && ref(value.principalRef) && ref(value.communityRef) && policyVersion(value.policyVersion)
            && revision(value.policyRevision) && digest(value.noticeDigest) && revision(value.subjectRevision)
            && purposes(value.purposes) && windowValid(value);
    } catch { return false; }
}
function participantReason(policy, subject, binding, action, now) {
    if (!validParticipationSubject(subject)) return 'invalid-subject';
    if (subject.state !== 'authorized') return 'subject-not-authorized';
    if (!current(subject, now)) return 'subject-inactive';
    if (!validParticipationBinding(binding)) return 'invalid-binding';
    if (!current(binding, now)) return 'binding-inactive';
    if (['subjectRef', 'principalRef', 'communityRef'].some(key => binding[key] !== subject[key])) return 'binding-mismatch';
    if (binding.subjectRevision !== subject.revision) return 'stale-revision';
    if (subject.communityRef !== policy.communityRef || [subject, binding].some(value => value.policyVersion !== policy.policyVersion
        || value.policyRevision !== policy.revision || value.noticeDigest !== policy.noticeDigest)) return 'policy-mismatch';
    if (subject.issuedAt < policy.issuedAt || subject.effectiveAt < policy.effectiveAt || subject.expiresAt > policy.expiresAt || binding.issuedAt < subject.effectiveAt
        || binding.expiresAt > subject.expiresAt || binding.expiresAt - binding.issuedAt > policy.maxSessionMs) return 'invalid-validity';
    if (!subject.purposes.every(purpose => policy.purposes.includes(purpose))
        || !binding.purposes.every(purpose => subject.purposes.includes(purpose))
        || !ACTION_PURPOSES[action].every(purpose => binding.purposes.includes(purpose))) return 'purpose-not-permitted';
    return null;
}

// authority = current engine's per-action global/room/actor decisions, including
// its real staff exemptions. safeguards = current availability/quota/content
// checks and independently qualified provider/public-text decisions. They are
// ceilings, not grants; never populate them from request/age/role/badge booleans.
export function resolveParticipation(input) {
    try {
        if (!record(input, ['action', 'now', 'policy', 'subject', 'binding', 'authority', 'safeguards'], ['peer'])) return decision(false, 'invalid-input');
        const { action, now, policy, subject, binding, authority, safeguards, peer } = input;
        if (typeof action !== 'string' || !Object.hasOwn(ACTION_PURPOSES, action)) return decision(false, 'unknown-action');
        if (!integer(now)) return decision(false, 'invalid-time');
        if (!validParticipationPolicy(policy)) return decision(false, 'invalid-policy');
        if (policy.state !== 'qualified') return decision(false, 'policy-not-qualified');
        if (!current(policy, now)) return decision(false, 'policy-inactive');
        const reason = participantReason(policy, subject, binding, action, now);
        if (reason) return decision(false, reason);
        if (!record(authority, ['global', 'room', 'actor']) || !Object.values(authority).every(value => value === true)) return decision(false, 'authority-denied');
        if (!record(safeguards, ['available', 'quota', 'content', 'provider', 'publicTextEligible'])
            || !['available', 'quota', 'content'].every(key => safeguards[key] === true)
            || !['off', 'not-qualified', 'provider-ready'].includes(safeguards.provider)
            || typeof safeguards.publicTextEligible !== 'boolean') return decision(false, 'safeguards-denied');
        if (action === 'requestDirectContact' || action === 'acceptDirectContact') {
            if (!record(peer, ['subject', 'binding']) || participantReason(policy, peer.subject, peer.binding, action, now)
                || peer.subject.subjectRef === subject.subjectRef || peer.subject.principalRef === subject.principalRef) return decision(false, 'peer-not-qualified');
        }
        if ((action === 'externalProvider' || action === 'aiPublicReview') && safeguards.provider !== 'provider-ready') return decision(false, 'provider-not-qualified');
        if (action === 'aiPublicReview' && !safeguards.publicTextEligible) return decision(false, 'public-text-required');
        return decision(true, 'allowed');
    } catch { return decision(false, 'invalid-input'); }
}
