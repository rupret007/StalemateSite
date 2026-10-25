// Controlled C3 adapter. Not provisioned by any production route. Effects and
// current participation revisions MUST share one serializable transaction.
import { readParticipationPrincipals } from './participation-consents.mjs';
import { PARTICIPATION_AUDIENCE, resolveParticipation } from './participation-policy.mjs';

const enc = new TextEncoder(), clone = value => structuredClone(value);
const validIdentity = value => value && Object.keys(value).length === 3 && ['principalRef', 'communityRef', 'expiresAt'].every(key => Object.hasOwn(value, key))
    && [value.principalRef, value.communityRef].every(id => typeof id === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(id)) && Number.isSafeInteger(value.expiresAt);
const limits = Object.freeze({ connections: 256, checks: 2048, writes: 128, bytes: 16 * 1024 * 1024 });
export function createParticipationEnforcement({ storage, resolveConnection, validateConnection, writeEffects, dispatchStart = null, beforeCommit = async () => {}, providerQualified = () => false, now = () => Date.now() } = {}) {
    if (typeof storage?.transaction !== 'function' || [resolveConnection, validateConnection, writeEffects, beforeCommit, providerQualified, now].some(fn => typeof fn !== 'function')
        || dispatchStart !== null && typeof dispatchStart !== 'function') throw new TypeError('Explicit participation transaction adapters required');
    const contexts = new WeakMap();
    const check = (state, request, current = state.snapshot, at = now()) => {
        const index = state.connections.findIndex(c => c.id === request.actorId), other = state.connections.findIndex(c => c.id === request.peerId);
        if (!current?.ok || index < 0 || !state.bindings[index] || !current.subjects[index]) return false;
        return resolveParticipation({ action: request.action, now: at, policy: current.policy, subject: current.subjects[index], binding: state.bindings[index],
            authority: { global: true, room: true, actor: true },
            safeguards: { available: true, quota: true, content: true, provider: request.providerReady === true && providerQualified(request.action) === true
                && (request.action !== 'aiPublicReview' || typeof dispatchStart === 'function') ? 'provider-ready' : 'off', publicTextEligible: request.publicTextEligible === true },
            ...(['requestDirectContact', 'acceptDirectContact'].includes(request.action) ? { peer: { subject: current.subjects[other], binding: state.bindings[other] } } : {}) }).allowed;
    };
    const read = async (tx, identities) => {
        const current = await readParticipationPrincipals({ tx, identities: identities.filter(Boolean), now: now() });
        if (!current.ok) return current;
        let index = 0; return { ...current, subjects: identities.map(identity => identity ? current.subjects[index++] : null) };
    };
    return Object.freeze({
        async prepare(connections) {
            const context = Object.freeze({}), state = { connections: [], identities: [], bindings: [], checks: [], snapshot: null };
            contexts.set(context, state);
            try {
                if (!Array.isArray(connections) || connections.length > limits.connections) return context;
                state.connections = clone(connections);
                for (const connection of state.connections) {
                    let identity;
                    try { identity = await resolveConnection(clone(connection)); } catch { /* this connection receives no affirmative grant */ }
                    state.identities.push(validIdentity(identity) && identity.expiresAt > now() ? clone(identity) : null);
                }
                state.snapshot = await storage.transaction(tx => read(tx, state.identities));
                if (!state.snapshot.ok) return context;
                const at = now();
                state.bindings = state.snapshot.subjects.map((subject, index) => subject ? {
                    version: 1, audience: PARTICIPATION_AUDIENCE, subjectRef: subject.subjectRef, principalRef: subject.principalRef,
                    communityRef: subject.communityRef, policyVersion: subject.policyVersion, policyRevision: subject.policyRevision, noticeDigest: subject.noticeDigest,
                    subjectRevision: subject.revision, purposes: [...subject.purposes], issuedAt: at, effectiveAt: at,
                    expiresAt: Math.min(subject.expiresAt, state.identities[index].expiresAt, at + state.snapshot.policy.maxSessionMs)
                } : null);
            } catch { state.snapshot = null; }
            return context;
        },
        allows(context, request, record = true) {
            const state = contexts.get(context);
            if (!state || !check(state, request) || record && state.checks.length >= limits.checks) return false;
            if (record && !state.checks.some(item => JSON.stringify(item) === JSON.stringify(request))) state.checks.push(clone(request));
            return true;
        },
        revisionFor(context, actorId) {
            const state = contexts.get(context), index = state?.connections.findIndex(c => c.id === actorId), binding = state?.bindings[index];
            return binding ? JSON.stringify([binding.subjectRef, binding.subjectRevision, binding.policyVersion, binding.policyRevision, binding.noticeDigest]) : '';
        },
        async commit(context, effects, { costsOnly = false } = {}) {
            try {
                const state = contexts.get(context);
                if (!state || !Array.isArray(effects) || effects.length > limits.writes || enc.encode(JSON.stringify(effects)).byteLength > limits.bytes) return { ok: false, reason: 'participation-capacity' };
                const writes = clone(effects); await beforeCommit({ effects: clone(writes), costsOnly });
                if (!costsOnly && state.checks.length) {
                    const affected = new Set(state.checks.flatMap(request => [request.actorId, request.peerId].filter(Boolean)));
                    for (let i = 0; i < state.connections.length; i++) {
                        if (!affected.has(state.connections[i].id)) continue;
                        const identity = await resolveConnection(clone(state.connections[i]));
                        if (!validIdentity(identity) || identity.expiresAt <= now() || identity.principalRef !== state.identities[i]?.principalRef
                            || identity.communityRef !== state.identities[i]?.communityRef) return { ok: false, reason: 'participation-denied' };
                    }
                }
                return await storage.transaction(async tx => {
                    const authorize = async () => {
                        if (costsOnly || !state.checks.length) return;
                        for (const actorId of new Set(state.checks.flatMap(request => [request.actorId, request.peerId].filter(Boolean)))) {
                            const i = state.connections.findIndex(c => c.id === actorId);
                            if (i < 0 || !state.identities[i] || state.identities[i].expiresAt <= now()
                                || await validateConnection({ tx, connection: clone(state.connections[i]), identity: clone(state.identities[i]), at: now() }) !== true) throw Error('participation-denied');
                        }
                        const current = await read(tx, state.identities);
                        if (!state.checks.every(request => check(state, request, current))) throw Error('participation-denied');
                    };
                    await authorize(); await writeEffects({ tx, effects: clone(writes), costsOnly }); await authorize();
                    return { ok: true };
                });
            } catch (error) { return { ok: false, reason: error?.message === 'participation-denied' ? 'participation-denied' : 'participation-unavailable' }; }
        },
        async providerAllowed(context, request) {
            try {
                const state = contexts.get(context); if (!state) return false;
                const index = state.connections.findIndex(c => c.id === request.actorId); if (index < 0) return false;
                const identity = await resolveConnection(clone(state.connections[index]));
                if (!validIdentity(identity) || identity.expiresAt <= now() || identity.principalRef !== state.identities[index]?.principalRef || identity.communityRef !== state.identities[index]?.communityRef) return false;
                const current = await storage.transaction(tx => read(tx, state.identities));
                return check(state, request, current);
            } catch { return false; }
        },
        async startProvider(context, request, start) {
            const state = contexts.get(context);
            if (!state || typeof dispatchStart !== 'function' || typeof start !== 'function') throw Error('participation-denied');
            let started = false, validated = null;
            // This MUST be a non-retrying start fence sharing withdrawal/session
            // ordering. Never run irreversible HTTP in a retryable transaction.
            return dispatchStart({
                validate: async tx => {
                    const index = state.connections.findIndex(c => c.id === request.actorId);
                    const current = await read(tx, state.identities);
                    if (index < 0 || !state.identities[index] || state.identities[index].expiresAt <= now()
                        || await validateConnection({ tx, connection: clone(state.connections[index]), identity: clone(state.identities[index]), at: now() }) !== true
                        || !check(state, request, current)) throw Error('participation-denied');
                    validated = { current, identity: state.identities[index] };
                    return true;
                },
                start: () => {
                    if (started || !validated || validated.identity.expiresAt <= now() || !check(state, request, validated.current)) throw Error('participation-denied');
                    started = true; return start();
                }
            });
        }
    });
}
