// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PARTICIPATION_ACTIONS, PARTICIPATION_PURPOSES, PARTICIPATION_AUDIENCE, resolveParticipation,
    validParticipationPolicy, validParticipationSubject, validParticipationBinding } from '../../hangout-worker/src/participation-policy.mjs';

// Deliberately synthetic qualification/consent references. No verifier, public
// enrollment, legal determination, persistent store or provider is exercised.
const NOW = 1800000000000;
function fixture() {
    const policy = { version: 1, policyVersion: 'synthetic-policy-v1', revision: 3, communityRef: 'synthetic_community_0001',
        noticeDigest: 'a'.repeat(64), decisionRef: 'synthetic_policy_decision_0001', state: 'qualified', purposes: [...PARTICIPATION_PURPOSES],
        issuedAt: NOW - 3000, effectiveAt: NOW - 2000, expiresAt: NOW + 10000, maxSessionMs: 2000 };
    const subject = { version: 1, subjectRef: 'synthetic_subject_0001', principalRef: 'synthetic_principal_0001', communityRef: policy.communityRef,
        policyVersion: policy.policyVersion, policyRevision: policy.revision, noticeDigest: policy.noticeDigest,
        revision: 7, state: 'authorized', purposes: [...PARTICIPATION_PURPOSES], consentRefs: ['synthetic_consent_0001'],
        issuedAt: NOW - 1500, effectiveAt: NOW - 1000, expiresAt: NOW + 8000 };
    const binding = { version: 1, audience: PARTICIPATION_AUDIENCE, subjectRef: subject.subjectRef, principalRef: subject.principalRef,
        communityRef: policy.communityRef, policyVersion: policy.policyVersion, policyRevision: policy.revision, noticeDigest: policy.noticeDigest,
        subjectRevision: subject.revision, purposes: [...PARTICIPATION_PURPOSES], issuedAt: NOW - 100, effectiveAt: NOW - 100, expiresAt: NOW + 1000 };
    return { action: 'publicText', now: NOW, policy, subject, binding,
        authority: { global: true, room: true, actor: true },
        safeguards: { available: true, quota: true, content: true, provider: 'provider-ready', publicTextEligible: true } };
}
function withPeer(input) {
    const peer = fixture();
    peer.subject.subjectRef = peer.binding.subjectRef = 'synthetic_subject_0002';
    peer.subject.principalRef = peer.binding.principalRef = 'synthetic_principal_0002';
    return { ...input, peer: { subject: peer.subject, binding: peer.binding } };
}
const denied = input => expect(resolveParticipation(input).allowed).toBe(false);

describe('inactive participation policy foundation', () => {
    it('permits every affirmative action only with matching synthetic records and independent authority', () => {
        for (const action of PARTICIPATION_ACTIONS) expect(resolveParticipation(withPeer({ ...fixture(), action })))
            .toEqual({ allowed: true, reason: 'allowed' });
        const { policy, subject, binding } = fixture();
        expect(validParticipationPolicy(policy)).toBe(true);
        expect(validParticipationSubject(subject)).toBe(true);
        expect(validParticipationBinding(binding)).toBe(true);
    });

    it('never treats an unknown action or safety/privacy-reducing route as a participation grant', () => {
        for (const action of [undefined, null, true, ['publicText'], 'constructor', '__proto__', 'publictext', 'report', 'block',
            'appeal', 'rightsRequest', 'leave', 'quit', 'stopCamera', 'declineContact', 'withdrawConsent', 'hideEntrySource'])
            expect(resolveParticipation({ ...fixture(), action })).toEqual({ allowed: false, reason: 'unknown-action' });
        // These existing help/withdrawal routes are intentionally outside this
        // affirmative-action gate; their own authorization remains unchanged.
    });

    it('requires a qualified, current policy rather than a readiness boolean or a consent-shaped claim', () => {
        for (const state of ['unqualified', 'withdrawn', true, 'Qualified']) {
            const input = fixture(); input.policy.state = state; denied(input);
        }
        for (const key of ['policy', 'subject', 'binding', 'authority', 'safeguards']) {
            for (const value of [null, {}, true, 'qualified']) denied({ ...fixture(), [key]: value });
        }
        expect(resolveParticipation()).toEqual({ allowed: false, reason: 'invalid-input' });
        const input = fixture(); input.policy.effectiveAt = NOW + 1; input.policy.expiresAt = NOW + 10000;
        expect(resolveParticipation(input).reason).toBe('policy-inactive');
        const expired = fixture(); expired.now = expired.policy.expiresAt;
        expect(resolveParticipation(expired).reason).toBe('policy-inactive');
    });

    it('refuses all nonauthorized states, including pending/unknown and a withdrawn record carrying old grants', () => {
        for (const state of ['unknown', 'pending', 'declined', 'withdrawn', 'expired', 'policy-review-required']) {
            const input = fixture(); input.subject.state = state;
            expect(resolveParticipation(input)).toEqual({ allowed: false, reason: 'subject-not-authorized' });
        }
        for (const consentRefs of [[], ['short'], Array(17).fill('synthetic_consent_0001'), ['synthetic_consent_0001', 'synthetic_consent_0001']]) {
            const input = fixture(); input.subject.consentRefs = consentRefs; denied(input);
        }
    });

    it('binds authoritative current revisions, notice, community and authenticated principal in both directions', () => {
        for (const revision of [6, 8]) {
            const input = fixture(); input.binding.subjectRevision = revision;
            expect(resolveParticipation(input).reason).toBe('stale-revision');
        }
        for (const key of ['subjectRef', 'principalRef', 'communityRef']) {
            const input = fixture(); input.binding[key] = 'synthetic_other_reference_0001';
            expect(resolveParticipation(input).reason).toBe('binding-mismatch');
        }
        for (const record of ['subject', 'binding']) for (const [key, value] of [
            ['policyVersion', 'synthetic-other-v1'], ['policyRevision', 2], ['policyRevision', 4], ['noticeDigest', 'b'.repeat(64)]
        ]) {
            const input = fixture(); input[record][key] = value;
            expect(resolveParticipation(input).reason).toBe('policy-mismatch');
        }
        const otherCommunity = fixture(); otherCommunity.subject.communityRef = otherCommunity.binding.communityRef = 'synthetic_other_community';
        expect(resolveParticipation(otherCommunity).reason).toBe('policy-mismatch');
        const otherAudience = fixture(); otherAudience.binding.audience = 'room-owner-session'; denied(otherAudience);
    });

    it('requires exact finite validity windows and does not let a session outlive its subject or policy lease', () => {
        for (const record of ['policy', 'subject', 'binding']) for (const key of ['issuedAt', 'effectiveAt', 'expiresAt']) {
            for (const value of [NaN, Infinity, -1, Number.MAX_SAFE_INTEGER + 1, String(NOW), null]) {
                const input = fixture(); input[record][key] = value; denied(input);
            }
        }
        for (const value of [NaN, Infinity, -1, NOW + 0.5, String(NOW), null]) denied({ ...fixture(), now: value });
        for (const record of ['subject', 'binding']) {
            const input = fixture(); input[record].expiresAt = NOW; denied(input);
            const future = fixture(); future[record].effectiveAt = NOW + 1; denied(future);
            const futureIssue = fixture(); futureIssue[record].issuedAt = futureIssue[record].effectiveAt = NOW + 1; denied(futureIssue);
        }
        const longLease = fixture(); longLease.binding.expiresAt = NOW + 2000;
        expect(resolveParticipation(longLease).reason).toBe('invalid-validity');
        const subjectOverPolicy = fixture(); subjectOverPolicy.subject.expiresAt = subjectOverPolicy.policy.expiresAt + 1; denied(subjectOverPolicy);
        const sessionOverSubject = fixture(); sessionOverSubject.subject.expiresAt = NOW + 500; denied(sessionOverSubject);
        const oldGrant = fixture(); oldGrant.subject.issuedAt = oldGrant.policy.issuedAt - 1; denied(oldGrant);
        const prematureGrant = fixture(); prematureGrant.subject.issuedAt = prematureGrant.subject.effectiveAt = prematureGrant.policy.effectiveAt - 1; denied(prematureGrant);
        const prematureLease = fixture(); prematureLease.binding.issuedAt = prematureLease.subject.effectiveAt - 1; denied(prematureLease);
        for (const value of [0, -1, '2000', true, Infinity, Number.MAX_SAFE_INTEGER, 2000.5]) {
            const input = fixture(); input.policy.maxSessionMs = value; denied(input);
        }
        const boundary = fixture(); boundary.binding.expiresAt = NOW + 1;
        expect(resolveParticipation(boundary).allowed).toBe(true); boundary.now += 1; denied(boundary);
    });

    it('uses closed versioned schemas with bounded lists and rejects coercion, accessors and inherited grants', () => {
        for (const record of ['policy', 'subject', 'binding']) {
            const input = fixture(); input[record].version = 2; denied(input);
            for (const value of [0, -1, 1.5, true, '1', Number.MAX_SAFE_INTEGER + 1]) {
                const corrupt = fixture(); corrupt[record][record === 'binding' ? 'subjectRevision' : 'revision'] = value; denied(corrupt);
            }
            const extra = fixture(); extra[record].age13 = true; denied(extra);
            const oversized = fixture(); oversized[record].communityRef = 'x'.repeat(129); denied(oversized);
            const unknown = fixture(); unknown[record].purposes.push('staff-override'); denied(unknown);
            const duplicate = fixture(); duplicate[record].purposes.push('public-text'); denied(duplicate);
            const coerced = fixture(); coerced[record].purposes = { 'public-text': true, 'public-disclosure': true }; denied(coerced);
        }
        const inherited = fixture(); inherited.authority = Object.create({ global: true, room: true, actor: true }); denied(inherited);
        let readAccessor = false;
        const getter = fixture(); Object.defineProperty(getter.subject, 'state', { enumerable: true, get() { readAccessor = true; return 'authorized'; } });
        denied(getter); expect(readAccessor).toBe(false);
        const sparse = fixture(); sparse.subject.purposes = Array(2); denied(sparse);
        const symbol = fixture(); symbol.binding[Symbol('hidden')] = true; denied(symbol);
        const hidden = fixture(); Object.defineProperty(hidden.policy, 'secret', { value: 'not-public' }); denied(hidden);
    });

    it('requires separate explicit purposes and permits bindings to narrow but never widen grants', () => {
        const input = fixture(); input.policy.purposes = input.subject.purposes = input.binding.purposes = ['public-text', 'public-disclosure'];
        expect(resolveParticipation(input).allowed).toBe(true);
        for (const action of PARTICIPATION_ACTIONS.filter(action => action !== 'publicText')) denied(withPeer({ ...input, action }));
        const notPublic = fixture(); notPublic.binding.purposes = ['public-text']; denied(notPublic);
        const narrower = fixture(); narrower.binding.purposes = ['public-text', 'public-disclosure'];
        expect(resolveParticipation(narrower).allowed).toBe(true);
        const widened = fixture(); widened.subject.purposes = ['public-text', 'public-disclosure']; denied(widened);
        const removed = fixture(); removed.policy.purposes = ['public-text', 'public-disclosure']; denied(removed);
    });

    it('requires every purpose of each action even when all other purposes remain permitted', () => {
        const requirements = {
            publicText: ['public-text', 'public-disclosure'], publicArtifact: ['public-artifact', 'public-disclosure'],
            createRoom: ['room-creation', 'public-artifact', 'public-disclosure'], registerRoom: ['room-registration', 'public-disclosure'],
            requestDirectContact: ['direct-contact'], acceptDirectContact: ['direct-contact'], sendCamera: ['camera'], sendAudio: ['audio'],
            receiveMedia: ['media-reception'], externalProvider: ['external-provider'],
            aiPublicReview: ['public-text', 'public-disclosure', 'external-provider', 'ai-public-review']
        };
        for (const [action, required] of Object.entries(requirements)) for (const purpose of required) {
            const input = withPeer({ ...fixture(), action });
            input.binding.purposes = input.binding.purposes.filter(value => value !== purpose);
            expect(resolveParticipation(input)).toEqual({ allowed: false, reason: 'purpose-not-permitted' });
        }
    });

    it('intersects engine global/room/actor decisions and safety/quota/content limits without staff or age overrides', () => {
        for (const field of ['global', 'room', 'actor']) for (const value of [false, 1, 'true', undefined]) {
            const input = fixture(); input.authority[field] = value;
            expect(resolveParticipation(input).reason).toBe('authority-denied');
        }
        for (const field of ['available', 'quota', 'content']) for (const value of [false, 1, 'true', undefined]) {
            const input = fixture(); input.safeguards[field] = value;
            expect(resolveParticipation(input).reason).toBe('safeguards-denied');
        }
        for (const [key, value] of Object.entries({ role: 'owner', moderator: true, band: true, host: true, age13: true,
            adult18: true, parentalConsent: true, entrySource: 'stalemate' })) {
            const input = fixture(); input.subject.state = 'withdrawn'; input[key] = value; denied(input);
            const forgedAuthority = fixture(); forgedAuthority.authority[key] = value; denied(forgedAuthority);
        }
    });

    it('requires the other participant to remain authorized and preserves separate recipient consent/block checks', () => {
        for (const action of ['requestDirectContact', 'acceptDirectContact']) {
            denied({ ...fixture(), action });
            for (const change of [peer => { peer.subject.state = 'withdrawn'; }, peer => { peer.binding.subjectRevision -= 1; },
                peer => { peer.subject.purposes = peer.binding.purposes = ['public-text']; },
                peer => { peer.binding.expiresAt = NOW; }, peer => { peer.subject.policyRevision -= 1; }]) {
                const input = withPeer({ ...fixture(), action }); change(input.peer);
                expect(resolveParticipation(input).reason).toBe('peer-not-qualified');
            }
            const blocked = withPeer({ ...fixture(), action }); blocked.authority.actor = false; denied(blocked);
            const samePrincipal = withPeer({ ...fixture(), action }); samePrincipal.peer.subject.principalRef = samePrincipal.peer.binding.principalRef = samePrincipal.subject.principalRef; denied(samePrincipal);
            let readAccessor = false;
            const forgedPeer = withPeer({ ...fixture(), action });
            Object.defineProperty(forgedPeer.peer.subject, 'subjectRef', { enumerable: true, get() { readAccessor = true; return 'synthetic_subject_0002'; } });
            denied(forgedPeer); expect(readAccessor).toBe(false);
        }
    });

    it('requires existing provider qualification and public-text eligibility in addition to subject consent', () => {
        for (const action of ['externalProvider', 'aiPublicReview']) for (const provider of ['off', 'not-qualified', true, 'ready']) {
            const input = fixture(); input.action = action; input.safeguards.provider = provider; denied(input);
        }
        const privateText = fixture(); privateText.action = 'aiPublicReview'; privateText.safeguards.publicTextEligible = false;
        expect(resolveParticipation(privateText).reason).toBe('public-text-required');
        const missingOptionalConsent = fixture(); missingOptionalConsent.action = 'aiPublicReview';
        missingOptionalConsent.binding.purposes = ['public-text', 'public-disclosure']; denied(missingOptionalConsent);
        missingOptionalConsent.action = 'publicText'; expect(resolveParticipation(missingOptionalConsent).allowed).toBe(true);
    });

    it('returns only immutable content-free decisions, never mutates input or caches a former grant', () => {
        const input = withPeer(fixture()), before = structuredClone(input);
        const result = resolveParticipation(input);
        expect(result).toEqual({ allowed: true, reason: 'allowed' }); expect(Object.isFrozen(result)).toBe(true);
        expect(input).toEqual(before);
        expect(JSON.stringify(result)).not.toContain(input.subject.subjectRef);
        input.subject.revision += 1; expect(resolveParticipation(input).reason).toBe('stale-revision');
        input.binding.subjectRevision += 1; input.subject.state = 'withdrawn'; denied(input);
        expect(result.allowed).toBe(true); // Previously returned values are not revocable leases.
        expect(Object.isFrozen(PARTICIPATION_ACTIONS)).toBe(true); expect(Object.isFrozen(PARTICIPATION_PURPOSES)).toBe(true);
    });
});
