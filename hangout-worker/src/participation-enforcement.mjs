// C3 adapter, selected only by explicit server composition. Effects and
// current participation revisions MUST share one serializable transaction.
import { readParticipationPrincipals } from './participation-consents.mjs';
import { PARTICIPATION_AUDIENCE, resolveParticipation } from './participation-policy.mjs';

const enc = new TextEncoder(), clone = value => structuredClone(value);
const validIdentity = value => value && Object.keys(value).length === 3 && ['principalRef', 'communityRef', 'expiresAt'].every(key => Object.hasOwn(value, key))
    && [value.principalRef, value.communityRef].every(id => typeof id === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(id)) && Number.isSafeInteger(value.expiresAt);
const revision = binding => binding ? JSON.stringify([binding.subjectRef, binding.subjectRevision,
    binding.policyVersion, binding.policyRevision, binding.noticeDigest]) : '';
const limits = Object.freeze({ connections: 256, checks: 2048, writes: 128, bytes: 16 * 1024 * 1024 });
function selectedProviderRequest(request) {
    const value = { actorId: request?.actorId, action: request?.action,
        providerReady: request?.providerReady, publicTextEligible: request?.publicTextEligible,
        ...(request?.peerId === undefined ? {} : { peerId: request.peerId }),
        ...(request?.providerScope === undefined ? {} : { providerScope: request.providerScope }),
        ...(request?.actorRevision === undefined ? {} : { actorRevision: request.actorRevision, peerRevision: request.peerRevision }) };
    // Public-text review and explicitly consented external-provider actions
    // use the same qualified start fence. Music may bind a peer so both
    // participants' current consent is rechecked at dispatch.
    if (typeof value.actorId !== 'string' || value.providerReady !== true) return null;
    if (value.action === 'aiPublicReview' && value.publicTextEligible === true && value.peerId === undefined && value.providerScope === undefined) return Object.freeze(value);
    if (value.providerScope !== undefined && (value.providerScope !== 'music' || !value.peerId
        || typeof value.actorRevision !== 'string' || !value.actorRevision || typeof value.peerRevision !== 'string' || !value.peerRevision)) return null;
    if (value.action === 'externalProvider' && value.publicTextEligible === false
        && (value.peerId === undefined || typeof value.peerId === 'string' && value.peerId.length > 0 && value.peerId.length <= 128)) return Object.freeze(value);
    return null;
}
export function createParticipationEnforcement({ storage, resolveConnection, resolveConnections, validateConnection, writeEffects, readPrincipals = readParticipationPrincipals, readWithdrawn = null, readPreparation = null, dispatchStart = null, beforeCommit = async () => {}, providerQualified = () => false, now = () => Date.now() } = {}) {
    if (typeof storage?.transaction !== 'function' || [resolveConnection, validateConnection, writeEffects, readPrincipals, beforeCommit, providerQualified, now].some(fn => typeof fn !== 'function')
        || resolveConnections !== undefined && typeof resolveConnections !== 'function'
        || readWithdrawn !== null && typeof readWithdrawn !== 'function'
        || readPreparation !== null && typeof readPreparation !== 'function'
        || dispatchStart !== null && typeof dispatchStart !== 'function') throw new TypeError('Explicit participation transaction adapters required');
    const contexts = new WeakMap();
    const check = (state, request, current = state.snapshot, at = now()) => {
        const index = state.connections.findIndex(c => c.id === request.actorId), other = state.connections.findIndex(c => c.id === request.peerId);
        if (!current?.ok || index < 0 || !state.bindings[index] || !current.subjects[index]) return false;
        const safeguards = { available: true, quota: true, content: true, provider: request.providerReady === true && providerQualified(request.action, request.providerScope) === true
            && (request.action !== 'aiPublicReview' && request.action !== 'externalProvider' || typeof dispatchStart === 'function') ? 'provider-ready' : 'off',
            publicTextEligible: request.publicTextEligible === true };
        const allowed = resolveParticipation({ action: request.action, now: at, policy: current.policy, subject: current.subjects[index], binding: state.bindings[index],
            authority: { global: true, room: true, actor: true },
            safeguards,
            ...(['requestDirectContact', 'acceptDirectContact'].includes(request.action) ? { peer: { subject: current.subjects[other], binding: state.bindings[other] } } : {}) }).allowed;
        if (!allowed || request.action !== 'externalProvider' || request.peerId === undefined) return allowed;
        if (other < 0 || other === index || !state.bindings[other] || !current.subjects[other]) return false;
        if (request.providerScope === 'music' && (request.actorRevision !== revision(state.bindings[index])
            || request.peerRevision !== revision(state.bindings[other])
            || ![index, other].every(slot => ['sendAudio', 'receiveMedia'].every(action =>
                check(state, { actorId: state.connections[slot].id, action }, current, at))))) return false;
        const directContactAllowed = (actor, peer, action) => resolveParticipation({ action, now: at, policy: current.policy,
            subject: current.subjects[actor], binding: state.bindings[actor], authority: { global: true, room: true, actor: true },
            safeguards: { available: true, quota: true, content: true, provider: 'off', publicTextEligible: false },
            peer: { subject: current.subjects[peer], binding: state.bindings[peer] } }).allowed;
        const peerProviderAllowed = resolveParticipation({ action: 'externalProvider', now: at, policy: current.policy,
            subject: current.subjects[other], binding: state.bindings[other], authority: { global: true, room: true, actor: true },
            safeguards: { available: true, quota: true, content: true,
                provider: providerQualified('externalProvider', request.providerScope) === true && typeof dispatchStart === 'function' ? 'provider-ready' : 'off', publicTextEligible: false } }).allowed;
        return peerProviderAllowed && directContactAllowed(index, other, 'requestDirectContact')
            && directContactAllowed(other, index, 'acceptDirectContact');
    };
    const read = async (tx, identities) => {
        const current = await readPrincipals({ tx, identities: identities.filter(Boolean), now: now() });
        if (!current.ok) return current;
        let index = 0; return { ...current, subjects: identities.map(identity => identity ? current.subjects[index++] : null) };
    };
    return Object.freeze({
        async prepare(connections) {
            const context = Object.freeze({}), state = { connections: [], identities: [], bindings: [], checks: [], withdrawnChecks: [], withdrawn: [], snapshot: null };
            contexts.set(context, state);
            try {
                if (!Array.isArray(connections) || connections.length > limits.connections) return context;
                state.connections = clone(connections);
                if (resolveConnections !== undefined) {
                    const identities = await resolveConnections(clone(state.connections));
                    if (!Array.isArray(identities) || Object.getPrototypeOf(identities) !== Array.prototype
                        || identities.length !== state.connections.length || Reflect.ownKeys(identities).length !== identities.length + 1) throw Error('participation-unavailable');
                    for (let i = 0; i < identities.length; i++) {
                        const slot = Object.getOwnPropertyDescriptor(identities, String(i)), identity = slot?.value;
                        if (!slot?.enumerable || !Object.hasOwn(slot, 'value') || identity !== null && (!validIdentity(identity)
                            || Object.getPrototypeOf(identity) !== Object.prototype || Reflect.ownKeys(identity).length !== 3
                            || Object.values(Object.getOwnPropertyDescriptors(identity)).some(value => !value.enumerable || !Object.hasOwn(value, 'value')))) throw Error('participation-unavailable');
                    }
                    state.identities = identities.map(identity => identity && identity.expiresAt > now() ? clone(identity) : null);
                } else {
                    for (const connection of state.connections) {
                        let identity;
                        try { identity = await resolveConnection(clone(connection)); } catch { /* this connection receives no affirmative grant */ }
                        state.identities.push(validIdentity(identity) && identity.expiresAt > now() ? clone(identity) : null);
                    }
                }
                state.snapshot = await storage.transaction(async tx => {
                    const identities = state.identities.filter(Boolean);
                    if (readPreparation) {
                        const current = await readPreparation({ tx, identities, now: now() });
                        if (!Array.isArray(current?.withdrawn) || current.withdrawn.length !== identities.length
                            || current.withdrawn.some(value => typeof value !== 'boolean')) throw Error('participation-unavailable');
                        let index = 0;
                        state.withdrawn = state.identities.map(identity => identity ? current.withdrawn[index++] : false);
                        if (!current.ok) return current;
                        if (!Array.isArray(current.subjects) || current.subjects.length !== identities.length) throw Error('participation-unavailable');
                        index = 0;
                        return { ...current, subjects: state.identities.map(identity => identity ? current.subjects[index++] : null) };
                    }
                    const values = readWithdrawn ? await readWithdrawn({ tx, identities, now: now() }) : identities.map(() => false);
                    if (!Array.isArray(values) || values.length !== identities.length || values.some(value => typeof value !== 'boolean')) throw Error('participation-unavailable');
                    let index = 0; state.withdrawn = state.identities.map(identity => identity ? values[index++] : false);
                    return read(tx, state.identities);
                });
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
        isWithdrawn(context, actorId) {
            const state = contexts.get(context), index = state?.connections.findIndex(c => c.id === actorId);
            if (index < 0 || !state?.identities[index] || state.identities[index].expiresAt <= now() || state.withdrawn[index] !== true) return false;
            if (!state.withdrawnChecks.includes(actorId)) state.withdrawnChecks.push(actorId);
            return true;
        },
        revisionFor(context, actorId) {
            const state = contexts.get(context), index = state?.connections.findIndex(c => c.id === actorId), binding = state?.bindings[index];
            return revision(binding);
        },
        async commit(context, effects, { costsOnly = false, transaction = operation => storage.transaction(operation) } = {}) {
            try {
                const state = contexts.get(context);
                if (!state || !Array.isArray(effects) || effects.length > limits.writes || enc.encode(JSON.stringify(effects)).byteLength > limits.bytes) return { ok: false, reason: 'participation-capacity' };
                if (typeof transaction !== 'function') return { ok: false, reason: 'participation-unavailable' };
                const writes = clone(effects); await beforeCommit({ effects: clone(writes), costsOnly });
                if (!costsOnly && (state.checks.length || state.withdrawnChecks.length)) {
                    const affected = new Set([...state.withdrawnChecks, ...state.checks.flatMap(request => [request.actorId, request.peerId].filter(Boolean))]);
                    for (let i = 0; i < state.connections.length; i++) {
                        if (!affected.has(state.connections[i].id)) continue;
                        const identity = await resolveConnection(clone(state.connections[i]));
                        if (!validIdentity(identity) || identity.expiresAt <= now() || identity.principalRef !== state.identities[i]?.principalRef
                            || identity.communityRef !== state.identities[i]?.communityRef) return { ok: false, reason: 'participation-denied' };
                    }
                }
                // A trusted session fence supplies the same serializable
                // transaction wrapper rather than nesting another transaction.
                return await transaction(async tx => {
                    const authorize = async () => {
                        if (costsOnly || !state.checks.length && !state.withdrawnChecks.length) return;
                        const affected = new Set([...state.withdrawnChecks, ...state.checks.flatMap(request => [request.actorId, request.peerId].filter(Boolean))]);
                        for (const actorId of affected) {
                            const i = state.connections.findIndex(c => c.id === actorId);
                            if (i < 0 || !state.identities[i] || state.identities[i].expiresAt <= now()
                                || await validateConnection({ tx, connection: clone(state.connections[i]), identity: clone(state.identities[i]), at: now() }) !== true) throw Error('participation-denied');
                        }
                        if (state.withdrawnChecks.length) {
                            const identities = state.withdrawnChecks.map(actorId => state.identities[state.connections.findIndex(c => c.id === actorId)]);
                            if (!readWithdrawn || !(await readWithdrawn({ tx, identities, now: now() })).every(value => value === true)) throw Error('participation-denied');
                        }
                        // Preparation may need the whole roster, but these
                        // recorded checks depend only on their actors/peers.
                        // Preserve original slots, including missing peers,
                        // and re-read independently on BOTH sides of writes.
                        const current = await read(tx, state.identities.map((identity, i) => affected.has(state.connections[i].id) ? identity : null));
                        if (!state.checks.every(request => check(state, request, current))) throw Error('participation-denied');
                    };
                    await authorize(); await writeEffects({ tx, effects: clone(writes), costsOnly }); await authorize();
                    return { ok: true };
                });
            } catch (error) { return { ok: false, reason: error?.message === 'participation-denied' ? 'participation-denied' : 'participation-unavailable' }; }
        },
        async providerAllowed(context, request) {
            try {
                const state = contexts.get(context), selected = selectedProviderRequest(request); if (!state || !selected) return false;
                const index = state.connections.findIndex(c => c.id === selected.actorId); if (index < 0) return false;
                const identity = await resolveConnection(clone(state.connections[index]));
                if (!validIdentity(identity) || identity.expiresAt <= now() || identity.principalRef !== state.identities[index]?.principalRef || identity.communityRef !== state.identities[index]?.communityRef) return false;
                if (selected.peerId !== undefined) {
                    const peerIndex = state.connections.findIndex(c => c.id === selected.peerId);
                    if (peerIndex < 0 || !state.identities[peerIndex]) return false;
                    const peerIdentity = await resolveConnection(clone(state.connections[peerIndex]));
                    if (!validIdentity(peerIdentity) || peerIdentity.expiresAt <= now() || peerIdentity.principalRef !== state.identities[peerIndex].principalRef
                        || peerIdentity.communityRef !== state.identities[peerIndex].communityRef) return false;
                }
                const current = await storage.transaction(tx => read(tx, state.identities));
                return check(state, selected, current);
            } catch { return false; }
        },
        async startProvider(context, request, start) {
            const state = contexts.get(context);
            if (!state || typeof dispatchStart !== 'function' || typeof start !== 'function') throw Error('participation-denied');
            const selected = selectedProviderRequest(request); if (!selected) throw Error('participation-denied');
            const index = state.connections.findIndex(connection => connection.id === selected.actorId);
            if (index < 0 || !state.identities[index]) throw Error('participation-denied');
            const peerIndex = selected.peerId === undefined ? -1 : state.connections.findIndex(connection => connection.id === selected.peerId);
            if (selected.peerId !== undefined && (peerIndex < 0 || !state.identities[peerIndex] || peerIndex === index)) throw Error('participation-denied');
            // Derive the descriptor from the trusted prepared slot. Never
            // reread a caller-owned request after validation has awaited I/O.
            const actorId = state.connections[index].id;
            let started = false, validated = null;
            // This MUST be a non-retrying start fence sharing withdrawal/session
            // ordering. Never run irreversible HTTP in a retryable transaction.
            return dispatchStart({
                actorId,
                ...(selected.providerScope === 'music' ? { peerId: selected.peerId } : {}),
                validate: async tx => {
                    const current = await read(tx, state.identities);
                    const checked = [index, ...(peerIndex < 0 ? [] : [peerIndex])];
                    for (const slot of checked) {
                        const identity = state.identities[slot];
                        // Use the already-open transaction's validator. resolveConnection opens
                        // its own transaction and would deadlock this read-only start fence.
                        if (!validIdentity(identity) || identity.expiresAt <= now()
                            || await validateConnection({ tx, connection: clone(state.connections[slot]), identity: clone(identity), at: now() }) !== true) throw Error('participation-denied');
                    }
                    if (state.identities[index].expiresAt <= now()
                        || !check(state, selected, current)) throw Error('participation-denied');
                    validated = { current, identity: state.identities[index] };
                    return true;
                },
                start: () => {
                    if (started || !validated || validated.identity.expiresAt <= now() || !check(state, selected, validated.current)) throw Error('participation-denied');
                    started = true; return start();
                }
            });
        }
    });
}
