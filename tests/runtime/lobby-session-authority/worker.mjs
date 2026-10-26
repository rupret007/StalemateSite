// Test-only, nonce-protected Worker. This file is not an application route,
// production bootstrap, staff appointment, or real guardian consent grant.
import { betaFetch, HangoutLobby, HangoutRoom, HangoutQuota, HangoutTurnBudget } from '../../../hangout-worker/src/beta-entry.mjs';
import { LOBBY_AUTHORITY_PATH, LOBBY_AUTHORITY_COMMUNITY } from '../../../hangout-worker/src/lobby-session-authority.mjs';
import { readBeta } from '../../../hangout-worker/src/beta-auth.mjs';
import { createPartitionedParticipationConsents, PARTICIPATION_POLICY_KEY } from '../../../hangout-worker/src/participation-partitions.mjs';
import { PARTICIPATION_PURPOSES } from '../../../hangout-worker/src/participation-policy.mjs';
export { HangoutRoom, HangoutQuota, HangoutTurnBudget };

const ORIGIN = 'https://local-fixture.invalid';
const PREFIX = '/_fixture/';
const ordinaryNeedles = ['Native Stalemate ephemeral greeting', 'Native Rad Dad ephemeral greeting', 'Native remaining visitor greeting', 'native-media-control-no-body-persistence'];
const ensure = (condition, label) => { if (!condition) throw Error(label); };
const denied = () => new Response('local fixture admission denied', { status: 403 });
const sha = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
function logicalKey(key) {
    if (typeof key !== 'string' || !key.includes(':manifest:')) return '';
    const suffix = key.split(':manifest:')[1];
    if (!/^(?:[a-f0-9]{2})+$/.test(suffix)) return '';
    return new TextDecoder().decode(Uint8Array.from(suffix.match(/../g), pair => parseInt(pair, 16)));
}
function admitted(request, env) {
    const url = new URL(request.url);
    return url.origin === ORIGIN && request.headers.get('X-Fixture-Nonce') === env.FIXTURE_NONCE;
}
async function readControl(request) {
    if (request.method !== 'POST' || request.headers.has('Origin') || request.headers.get('Content-Type') !== 'application/json') return null;
    const data = await request.arrayBuffer(); if (data.byteLength > 2048) return null;
    try { const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)); return value && typeof value === 'object' && !Array.isArray(value) ? value : null; }
    catch { return null; }
}

export class FixtureLobby extends HangoutLobby {
    constructor(state, env) {
        const control = { faultKey: '', tripped: false, nativeWriteCompleted: false, nativeCalls: 0, history: [], rollbackWitnesses: [] };
        const manifestDigest = async (storage, key) => {
            control.nativeCalls++;
            const value = await storage.get(key);
            ensure(value !== undefined, 'fixture-manifest-observation-missing');
            const encoded = JSON.stringify(value);
            ensure(typeof encoded === 'string' && new TextEncoder().encode(encoded).byteLength <= 65536, 'fixture-manifest-observation-cap');
            return sha(encoded);
        };
        const wrap = (target, transactionWitness = null) => new Proxy(target, { get(raw, key) {
            const method = Reflect.get(raw, key, raw);
            if (typeof method !== 'function') return method;
            if (key === 'transaction') return async operation => {
                // Only an outer native transaction can establish the point
                // before engine recovery/conservative accounting writes begin.
                // Unexpected nesting must fail rather than replace a witness.
                ensure(transactionWitness === null, 'fixture-nested-native-transaction');
                const witness = { fault: null };
                try { return await method.call(raw, tx => operation(wrap(tx, witness))); }
                catch (error) {
                    if (witness.fault) {
                        const { physicalKey, ...observation } = witness.fault;
                        observation.restoredSha256 = await manifestDigest(raw, physicalKey);
                        observation.nativeTransactionRejected = true;
                        observation.restoredBeforeEngineRecovery = observation.restoredSha256 === observation.originalSha256;
                        ensure(control.rollbackWitnesses.length < 2
                            && !control.rollbackWitnesses.some(item => item.record === observation.record), 'fixture-rollback-witness-cap');
                        control.rollbackWitnesses.push(observation);
                        ensure(observation.stagedChanged && observation.restoredBeforeEngineRecovery, 'fixture-native-rollback-not-observed');
                    }
                    throw error;
                }
            };
            if (!['get', 'put', 'delete', 'list', 'getAlarm', 'setAlarm', 'deleteAlarm'].includes(key)) return method.bind(raw);
            return async (...args) => {
                const armed = key === 'put' && control.faultKey && logicalKey(args[0]) === control.faultKey;
                let originalSha256;
                if (armed) {
                    ensure(transactionWitness && !transactionWitness.fault, 'fixture-fault-needs-owned-native-transaction');
                    ensure(['sessions', 'community-room:#art-native-canvas'].includes(control.faultKey), 'fixture-fault-record-not-allowed');
                    originalSha256 = await manifestDigest(raw, args[0]);
                }
                control.nativeCalls++;
                const result = await method.apply(raw, args);
                // Fault only after the actual native SQLite write resolved.
                if (armed) {
                    ensure(!transactionWitness.fault, 'fixture-duplicate-native-fault');
                    const observation = { physicalKey: args[0], record: control.faultKey, originalSha256,
                        stagedSha256: '', nativeWriteCompleted: true, stagedChanged: false };
                    transactionWitness.fault = observation;
                    control.history.push(control.faultKey);
                    control.faultKey = ''; control.tripped = true; control.nativeWriteCompleted = true;
                    observation.stagedSha256 = await manifestDigest(raw, args[0]);
                    observation.stagedChanged = observation.stagedSha256 !== originalSha256;
                    ensure(observation.stagedChanged, 'fixture-native-put-not-observable-change');
                    throw Error('owned-native-post-write-fault');
                }
                return result;
            };
        } });
        const storage = wrap(state.storage);
        const wrappedState = new Proxy(state, { get(target, key) {
            if (key === 'storage') return storage;
            const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
        } });
        super(wrappedState, env);
        this.fixtureControl = control;
    }
    async fixtureParticipant(cookie) {
        ensure(typeof cookie === 'string' && cookie.startsWith('__Host-hangout-beta=') && cookie.length <= 2048, 'fixture-cookie-shape');
        const claims = await readBeta('access', cookie.slice('__Host-hangout-beta='.length), this.env.HANGOUT_HMAC_KEY);
        ensure(claims?.scope === 'guest' && claims.version === String(this.env.HANGOUT_BETA_INVITE_VERSION || '1'), 'fixture-cookie-invalid');
        const checked = await this.authority.check({ sid: claims.sid, version: claims.version, exp: claims.exp });
        ensure(checked?.reason === 'active' && checked.profile === null, 'fixture-session-not-current-guest');
        return { principalRef: `s_${claims.sid}`, communityRef: LOBBY_AUTHORITY_COMMUNITY, expiresAt: claims.exp };
    }
    fixtureConsentLedger() {
        if (this.fixtureLedger) return this.fixtureLedger;
        const proofs = new Map(), decisions = new Map(), guardians = new Map(), now = Date.now();
        // Explicit, synthetic operator/guardian decisions only. Session identity
        // and the production C3 bridge are not overridden by this fixture.
        const config = { policy: { version: 1, policyVersion: 'synthetic-native-composition-v1', revision: 1,
            communityRef: LOBBY_AUTHORITY_COMMUNITY, noticeDigest: 'c'.repeat(64), decisionRef: 'synthetic_fixture_operator', state: 'qualified',
            purposes: [...PARTICIPATION_PURPOSES], issuedAt: now, effectiveAt: now, expiresAt: now + 3600000, maxSessionMs: 300000 },
            rules: { version: 1, verifierRef: 'synthetic_fixture_verifier', pendingMs: 10000, grantMs: 3600000,
                subjectTailMs: 10000, guardianTailMs: 10000, receiptTailMs: 10000, callbackMs: 10000, operationMs: 10000 } };
        const ledger = createPartitionedParticipationConsents({ storage: this.authority.records,
            admitSubject: async ({ tx }) => { const n = await tx.get('fixture-participation-allocation') || 0; if (n >= 4) return false; await tx.put('fixture-participation-allocation', n + 1); return true; },
            adapters: {
                qualifyPolicy: async () => ({ config, expiresAt: Date.now() + 10000 }),
                authenticateParticipant: async ({ proof, purpose }) => {
                    const p = proofs.get(proof); return !p ? null : purpose === 'begin' ? p : { principalRef: p.principalRef, communityRef: p.communityRef, expiresAt: p.expiresAt };
                },
                verifyConsent: async ({ proof }) => decisions.get(proof), authenticateGuardian: async ({ proof }) => guardians.get(proof),
                authorizeMaintenance: async () => null
            } });
        return this.fixtureLedger = { ledger, proofs, decisions, guardians, config };
    }
    async fixtureParticipation(operation, body) {
        ensure(this.participationMode === true, 'fixture-participation-mode-required');
        const f = this.fixtureConsentLedger();
        if (operation === 'participation-policy' && Object.keys(body).length === 0) {
            const result = await f.ledger.installPolicy('synthetic-operator'); ensure(result.ok, 'fixture-policy-install'); return { installed: true };
        }
        ensure(Object.keys(body).join(',') === 'cookie', 'fixture-participation-request');
        const identity = await this.fixtureParticipant(body.cookie);
        if (operation === 'participation-grant') {
            const proof = crypto.randomUUID(); f.proofs.set(proof, { ...identity, operationRef: crypto.randomUUID() });
            const pending = await f.ledger.begin(proof, { expectedRevision: 0, purposes: [...PARTICIPATION_PURPOSES] }); f.proofs.delete(proof);
            ensure(pending.ok, 'fixture-pending-refused'); const decision = crypto.randomUUID();
            f.decisions.set(decision, { operationRef: crypto.randomUUID(), pendingRef: pending.pendingRef, subjectRef: pending.subjectRef,
                principalRef: identity.principalRef, guardianPrincipalRef: 'synthetic_fixture_guardian', decisionRef: crypto.randomUUID(),
                verifierRef: f.config.rules.verifierRef, status: 'approved', purposes: [...PARTICIPATION_PURPOSES], verifiedAt: Date.now(), expiresAt: Date.now() + 3600000 });
            const result = await f.ledger.complete(decision); f.decisions.delete(decision); ensure(result.state === 'authorized', 'fixture-grant-refused');
            return { authorizedSyntheticGrant: true };
        }
        ensure(operation === 'participation-reduce', 'fixture-participation-operation');
        const rows = await this.authority.records.transaction(tx => tx.list({ prefix: 'participation-records:v1:record:', limit: 4 }));
        const state = [...rows.values()].find(row => row.subjects[0].record.principalRef === identity.principalRef);
        ensure(state, 'fixture-subject-missing'); const subject = state.subjects[0].record, guardian = state.guardians.find(row => row.subjectRef === subject.subjectRef), proof = crypto.randomUUID();
        f.guardians.set(proof, { operationRef: crypto.randomUUID(), subjectRef: subject.subjectRef, principalRef: guardian.principalRef,
            guardianRef: guardian.guardianRef, guardianRevision: guardian.revision, expiresAt: Date.now() + 10000 });
        const result = await f.ledger.change(proof, { expectedRevision: subject.revision, purposes: subject.purposes.filter(purpose => purpose !== 'camera') });
        f.guardians.delete(proof); ensure(result.state === 'authorized', 'fixture-reduction-refused'); return { reduced: true };
    }
    async fixtureInspect() {
        const saved = await this.authority.load();
        let commandReadyAt;
        if (this.participationMode) {
            const current = this.engine.sessionSnapshot().connections, buckets = new Map(this.engine.abuseSnapshot().buckets), at = Date.now();
            ensure(current.length <= 4 && current.every(person => !person.account), 'fixture-command-guest-bound');
            // Read the actual unchanged 10-token/1-per-second command budget.
            // Export deadlines only, never device/account keys or raw buckets.
            commandReadyAt = current.map(person => {
                const bucket = buckets.get('command:dev:' + person.dev);
                return { nick: person.nick, at: bucket ? Math.max(at, bucket.at + Math.ceil(Math.max(0, 1 - bucket.tokens) * 1000)) : at };
            });
        }
        const rooms = saved.state.rooms.rooms.map(room => ({ name: room.name, kind: room.kind, title: room.title, topic: room.topic, act: room.act }));
        const reportSummaries = await Promise.all(saved.state.moderationQueue.reports.map(async report => ({
            id: report.id, ch: report.ch, from: report.from, textSha256: await sha(report.text),
            contextSha256: await Promise.all(report.context.map(sha)), votes: report.devs.length, hidden: report.hidden
        })));
        const absent = Object.fromEntries(ordinaryNeedles.map(needle => [needle, true]));
        const logicalScan = await this.authority.records.transaction(async tx => {
            let cursor, rows = 0, bytes = 0; const known = new Set();
            for (;;) {
                const page = await tx.list({ prefix: '', ...(cursor ? { startAfter: cursor } : {}), limit: 4 });
                ensure(page instanceof Map && page.size <= 4, 'logical-scan-not-bounded');
                if (!page.size) break;
                for (const [key, value] of page) {
                    ensure(++rows <= 256, 'logical-scan-row-cap');
                    const text = JSON.stringify(value); bytes += new TextEncoder().encode(text).byteLength;
                    ensure(bytes <= 8 * 1024 * 1024, 'logical-scan-byte-cap');
                    for (const needle of ordinaryNeedles) if (text.includes(needle)) absent[needle] = false;
                    known.add(key); cursor = key;
                }
            }
            // A missing/wrong namespace must never make absence vacuously pass.
            for (const key of ['net', 'room-index', 'moderation-queue', 'private-reports-v1', 'authority-session-index:v1', 'authority-connection-index:v1'])
                ensure(known.has(key), 'logical-scan-required-record-missing');
            return { rows, bytes, requiredRecordsPresent: true };
        });
        let cursor, rows = 0, bytes = 0;
        const rawAbsent = Object.fromEntries(ordinaryNeedles.map(needle => [needle, true]));
        // Own fresh fixture keyspace only. This does not inventory production
        // raw keys or establish an old-writer drain/migration prerequisite.
        for (;;) {
            const page = await this.state.storage.list({ prefix: 'durable-record:v1:lobby-authority-v1:', ...(cursor ? { startAfter: cursor } : {}), limit: 4 });
            ensure(page instanceof Map && page.size <= 4, 'raw-scan-not-bounded');
            if (!page.size) break;
            for (const [key, value] of page) {
                ensure(++rows <= 256, 'raw-scan-row-cap');
                const text = value instanceof Uint8Array ? new TextDecoder().decode(value) : value instanceof ArrayBuffer ? new TextDecoder().decode(value) : JSON.stringify(value);
                bytes += new TextEncoder().encode(text).byteLength; ensure(bytes <= 8 * 1024 * 1024, 'raw-scan-byte-cap');
                for (const needle of ordinaryNeedles) if (text.includes(needle)) rawAbsent[needle] = false;
                cursor = key;
            }
        }
        ensure(rows > 0 && bytes > 0, 'raw-scan-empty');
        return { objectId: this.state.id.toString(), sqlite: [...this.state.storage.sql.exec('SELECT 1 AS fixture_sql')][0]?.fixture_sql === 1,
            authorityUnavailable: !!this.authorityUnavailable, bindingCount: saved.bindings.length, liveBindingCount: this.liveBindings.size,
            ...(this.participationMode ? { participationRequired: true, participationPolicyPresent: await this.authority.records.transaction(async tx => (await tx.get(PARTICIPATION_POLICY_KEY)) !== undefined), commandReadyAt } : {}),
            durableSessionNicks: saved.state.sessions.connections.map(person => person.nick).sort(),
            engineSessionNicks: this.engine.sessionSnapshot().connections.map(person => person.nick).sort(),
            durableBlockCounts: saved.state.sessions.connections.map(person => ({ nick: person.nick, blocks: person.blocks.length })).sort((a, b) => a.nick.localeCompare(b.nick)),
            engineBlockCounts: this.engine.sessionSnapshot().connections.map(person => ({ nick: person.nick, blocks: person.blocks.length })).sort((a, b) => a.nick.localeCompare(b.nick)),
            rooms, reports: reportSummaries, ordinaryBodiesAbsent: absent,
            logicalScan, rawScan: { rows, bytes, perChunkOrdinaryBodiesAbsent: rawAbsent },
            faultHistory: [...this.fixtureControl.history],
            nativeRollbackWitnesses: this.fixtureControl.rollbackWitnesses.map(item => ({ ...item })),
            fault: { tripped: this.fixtureControl.tripped, nativeWriteCompleted: this.fixtureControl.nativeWriteCompleted } };
    }
    async fetch(request) {
        const path = new URL(request.url).pathname;
        if (!path.startsWith(PREFIX)) return super.fetch(request);
        if (!admitted(request, this.env)) return denied();
        const body = await readControl(request); if (!body) return denied();
        await this.ready;
        if (path === PREFIX + 'participation-alarm' && this.participationMode && Object.keys(body).length === 0) {
            await this.alarm(); return Response.json({ completed: true });
        }
        return this.state.blockConcurrencyWhile(async () => {
            try {
                if (['participation-policy', 'participation-grant', 'participation-reduce'].includes(path.slice(PREFIX.length))) return Response.json(await this.fixtureParticipation(path.slice(PREFIX.length), body));
                if (path === PREFIX + 'inspect' && Object.keys(body).length === 0) return Response.json(await this.fixtureInspect());
                if (path === PREFIX + 'fault' && (Object.keys(body).join(',') === 'room' && body.room === '#art-native-canvas'
                    || Object.keys(body).join(',') === 'record' && body.record === 'sessions')) {
                    const key = body.record === 'sessions' ? 'sessions' : 'community-room:' + body.room;
                    ensure(!this.fixtureControl.faultKey && this.fixtureControl.history.length < 2
                        && !this.fixtureControl.history.includes(key), 'fault-already-used');
                    this.fixtureControl.tripped = false; this.fixtureControl.nativeWriteCompleted = false;
                    this.fixtureControl.faultKey = key;
                    return Response.json({ armed: true });
                }
                return denied();
            } catch (error) { return Response.json({ error: String(error.message).slice(0, 512) }, { status: 500 }); }
        });
    }
}

export default { async fetch(request, env) {
    if (!admitted(request, env)) return denied();
    const url = new URL(request.url), stub = env.LOBBY.get(env.LOBBY.idFromName('stalemate'));
    if (url.pathname.startsWith(PREFIX)) {
        const body = await readControl(request); if (!body) return denied();
        if (url.pathname === PREFIX + 'initialize' && Object.keys(body).length === 0) {
            // Explicit fixture lifecycle action; betaFetch never forwards it.
            return stub.fetch(new Request(ORIGIN + LOBBY_AUTHORITY_PATH + 'initialize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
        }
        if (['inspect', 'fault', 'participation-policy', 'participation-grant', 'participation-reduce', 'participation-alarm'].includes(url.pathname.slice(PREFIX.length))) return stub.fetch(new Request(request.url, {
            method: 'POST', headers: request.headers, body: JSON.stringify(body)
        }));
        if (url.pathname === PREFIX + 'egress-probe' && Object.keys(body).length === 0) {
            const response = await fetch('https://outbound-denied.invalid/fixture');
            return Response.json({ status: response.status, denied: response.headers.get('X-WebJam-Test-Egress') === 'denied' });
        }
        return denied();
    }
    if (!['/beta/unlock', '/beta/logout', '/beta/state', '/lobby', '/room', '/turn'].includes(url.pathname)) return denied();
    if (request.headers.get('Origin') !== ORIGIN) return denied();
    const appEnv = { ...env, ASSETS: { fetch: () => new Response('no fixture page requested', { status: 404 }) } };
    return betaFetch(request, appEnv);
} };
