// Test-only, nonce-protected Worker. This file is not an application route,
// production bootstrap, staff appointment, or real guardian consent grant.
import { betaFetch, HangoutLobby, HangoutRoom, HangoutQuota, HangoutTurnBudget } from '../../../hangout-worker/src/beta-entry.mjs';
import { LOBBY_AUTHORITY_PATH, LOBBY_AUTHORITY_COMMUNITY } from '../../../hangout-worker/src/lobby-session-authority.mjs';
import { readBeta } from '../../../hangout-worker/src/beta-auth.mjs';
import { createPartitionedParticipationConsents, PARTICIPATION_POLICY_KEY, PARTICIPATION_RECORD_LIMITS, PARTICIPATION_MAINTENANCE_CURSOR_KEY } from '../../../hangout-worker/src/participation-partitions.mjs';
import { validParticipationLedgerState } from '../../../hangout-worker/src/participation-consents.mjs';
import { HELP } from '../../../hangout-worker/src/lobby-core.mjs';
import { PARTICIPATION_PURPOSES } from '../../../hangout-worker/src/participation-policy.mjs';
import { createIncidentCases, createIncidentEvidenceCipher, incidentEvidenceDigest, initialIncidentCaseState } from '../../../hangout-worker/src/incident-cases.mjs';
import { LOBBY_INCIDENT_SOURCE_KEY } from '../../../hangout-worker/src/lobby-incident-sources.mjs';
export { HangoutRoom, HangoutQuota, HangoutTurnBudget };

const ORIGIN = 'https://local-fixture.invalid';
const PREFIX = '/_fixture/';
const INCIDENT_CASES = 'restricted-incident-cases-v1', INCIDENT_APPOINTMENT = 'fixture-incident-appointment', INCIDENT_POLICY = 'fixture-incident-policy';
const SELECTED_REPORT = 'Native selected report greeting';
const TRAFFIC_PREFIX = 'ACK probe ephemeral marker ';
const PRESSURE_PREFIX = 'Pressure probe ephemeral marker ';
const FANOUT_PREFIX = 'Fanout fifty ephemeral marker ';
const RETENTION = Object.freeze({ principal: 'synthetic_native_retention_principal', subject: 'synthetic_native_retention_subject',
    guardian: 'synthetic_native_retention_guardian', consent: 'synthetic_native_retention_consent', pending: 'synthetic_native_retention_pending',
    decision: 'synthetic_native_retention_decision', begin: 'synthetic_native_retention_begin', complete: 'synthetic_native_retention_complete' });
const TRAFFIC_LABELS = ['NativeAlpha', 'NativeBravo', 'NativeCharlie'];
const ordinaryNeedles = ['Native Stalemate ephemeral greeting', 'Native Rad Dad ephemeral greeting', 'Native remaining visitor greeting', 'native-media-control-no-body-persistence'];
const NATIVE_METHODS = ['get', 'put', 'delete', 'list', 'getAlarm', 'setAlarm', 'deleteAlarm'];
const NATIVE_FAMILIES = ['authorityMarker', 'sessionIndex', 'connectionIndex', 'mintRates', 'authoritySession', 'authorityConnection',
    'participationPolicy', 'participationRecord', 'participationAnchor', 'participationSubject', 'participationOperation', 'net', 'sessions', 'room', 'authorityOther', 'alarm', 'other'];
const FAMILY_ROUTES = [
    ['authorityMarker', 'lobby-session-authority:v1', true], ['sessionIndex', 'authority-session-index:v1', true],
    ['connectionIndex', 'authority-connection-index:v1', true], ['mintRates', 'authority-mint-rates:v1', true],
    ['authoritySession', 'authority-session:', false], ['authorityConnection', 'authority-connection:', false],
    ['participationPolicy', 'participation-records:v1:policy', true], ['participationRecord', 'participation-records:v1:record:', false],
    ['participationAnchor', 'participation-records:v1:anchor:', false], ['participationSubject', 'participation-records:v1:subject:', false],
    ['participationOperation', 'participation-records:v1:operation:', false], ['net', 'net', true], ['sessions', 'sessions', true], ['room', 'community-room:', false]
].map(([family, prefix, exact]) => ({ family, hex: [...prefix].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(''), exact }));
function nativeFamily(method, args) {
    if (method.endsWith('Alarm')) return 'alarm';
    try {
        const key = method === 'list' ? Object.getOwnPropertyDescriptor(args[0], 'prefix')?.value : args[0];
        if (typeof key !== 'string' || !key.startsWith('durable-record:v1:lobby-authority-v1:')) return 'other';
        const tail = key.slice('durable-record:v1:lobby-authority-v1:'.length), part = tail.startsWith('part:');
        const route = part ? tail.slice(5) : tail.startsWith('manifest:') ? tail.slice(9) : '';
        // Compare only fixed encoded prefixes. Never decode or retain the
        // dynamic record suffix, and never export a key or key fragment.
        return FAMILY_ROUTES.find(rule => route.startsWith(rule.hex) && (!rule.exact
            || route.length === rule.hex.length || part && route[rule.hex.length] === ':'))?.family || 'authorityOther';
    } catch { return 'other'; } // Classification cannot alter a native call.
}
function nativeCounters() {
    return { families: Object.fromEntries(NATIVE_FAMILIES.map(family => [family, Object.fromEntries(NATIVE_METHODS.map(method => [method, 0]))])),
        methods: Object.fromEntries(NATIVE_METHODS.map(method => [method, { attempted: 0, returned: 0, threw: 0 }])),
        transactions: { started: 0, committed: 0, rejected: 0 }, overflow: false };
}
function bumpNative(meter, object, key) {
    if (object[key] === Number.MAX_SAFE_INTEGER) meter.overflow = true;
    else object[key]++;
}
function beginNative(meter, method, args) {
    if (!meter) return null;
    bumpNative(meter, meter.families[nativeFamily(method, args)], method);
    const counts = meter.methods[method]; bumpNative(meter, counts, 'attempted'); return counts;
}
function snapshotNative(meter) {
    return { v: 1, families: Object.fromEntries(NATIVE_FAMILIES.map(family => [family, { ...meter.families[family] }])),
        methods: Object.fromEntries(NATIVE_METHODS.map(method => [method, { ...meter.methods[method] }])),
        transactions: { ...meter.transactions }, overflow: meter.overflow,
        resolverTelemetry: { available: false, reason: 'frozen-captured-authority' } };
}
// Diagnostic-only, fixed vocabulary. No error message, key or argument is exported.
const RETENTION_HEALTH_REASONS = new Set(['none', 'other', 'storage-corrupt', 'storage-unavailable', 'record-capacity', 'record-format',
    'record-key', 'record-list', 'policy-unavailable', 'invalid-policy', 'invalid-cursor', 'partition-read-capacity',
    'partition-write-capacity', 'not-authorized', 'participation-unavailable', 'participation-capacity', 'session-unavailable',
    'maintenance-unavailable', 'policy-not-active', 'reference-conflict', 'invalid-storage-key', 'capacity-or-invalid-state',
    'lobby-authority-unavailable', 'Invalid participation storage']);
function retentionHealthDenied(value) {
    try { return !!value && typeof value === 'object' && Object.getOwnPropertyDescriptor(value, 'ok')?.value === false; }
    catch { return false; } // Observation must not change an original result.
}
function retentionHealthReason(value, thrown = false) {
    try {
        for (const key of thrown ? ['partitionReason', 'recordReason', 'reason', 'message'] : ['reason']) {
            const reason = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
            if (typeof reason === 'string' && RETENTION_HEALTH_REASONS.has(reason)) return reason;
        }
        return thrown || retentionHealthDenied(value) ? 'other' : 'none';
    } catch { return 'other'; } // Never replace an original thrown error.
}
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
        const control = { faultKey: '', tripped: false, nativeWriteCompleted: false, nativeCalls: 0, nativeMutations: 0, history: [], rollbackWitnesses: [],
            traffic: env.FIXTURE_TRAFFIC_ACKS === 'ack-v1' ? { slots: new Map(), transactionsStarted: 0, transactionsCommitted: 0, transactionsRejected: 0 } : null,
            pressure: env.FIXTURE_PRESSURE_ONLY === 'pressure-v1' ? { slots: new Map(), probeSocket: null, helpAttempts: [], overflow: false, witness: null, nativeSendCalls: 0, nativeSendReturned: 0, initialSequence: 0 } : null,
            fanout: env.FIXTURE_FANOUT_50 === 'fanout-v1' ? { slots: new Map(), scan: null, scanStarted: false, storageCounters: nativeCounters() } : null };
        const manifestDigest = async (storage, key) => {
            control.nativeCalls++;
            const meter = control.fanout?.storageCounters, counts = beginNative(meter, 'get', [key]);
            let value;
            try { value = await storage.get(key); if (counts) bumpNative(meter, counts, 'returned'); }
            catch (error) { if (counts) bumpNative(meter, counts, 'threw'); throw error; }
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
                if (control.traffic) control.traffic.transactionsStarted++;
                const meter = control.fanout?.storageCounters;
                if (meter) bumpNative(meter, meter.transactions, 'started');
                try {
                    const result = await method.call(raw, tx => operation(wrap(tx, witness)));
                    if (control.traffic) control.traffic.transactionsCommitted++;
                    if (meter) bumpNative(meter, meter.transactions, 'committed');
                    return result;
                } catch (error) {
                    if (control.traffic) control.traffic.transactionsRejected++;
                    if (meter) bumpNative(meter, meter.transactions, 'rejected');
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
                const meter = control.fanout?.storageCounters, counts = beginNative(meter, key, args);
                let result;
                try { result = await method.apply(raw, args); if (counts) bumpNative(meter, counts, 'returned'); }
                catch (error) { if (counts) bumpNative(meter, counts, 'threw'); throw error; }
                if (['put', 'delete', 'setAlarm', 'deleteAlarm'].includes(key)) control.nativeMutations++;
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
        if (control.pressure) {
            // Observe, then delegate unchanged to the actual production sender.
            // No injected frames, attachment edits or replacement allowances.
            const nativeSend = this.delivery.send.bind(this.delivery);
            this.delivery.send = (socket, payload) => {
                const meter = control.pressure, selected = socket === meter.probeSocket;
                const saved = selected ? socket.deserializeAttachment()?.delivery : null;
                const atCapacity = saved?.enabled === true && saved.sizes.length === 128;
                const prior = selected ? this.delivery.snapshot() : null, nativeCallsBefore = meter.nativeSendCalls;
                const accepted = nativeSend(socket, payload);
                if (selected && payload.t === 'notice') {
                    if (meter.helpAttempts.length < 151) meter.helpAttempts.push({ index: HELP.indexOf(payload.text), accepted: accepted === true });
                    else meter.overflow = true;
                }
                const after = selected ? this.delivery.snapshot() : null;
                if (selected && !meter.witness && atCapacity && accepted === false && after.pressureCloses === prior.pressureCloses + 1) {
                    meter.witness = { sequence: saved.seq, acknowledged: saved.ack, pendingFrames: saved.sizes.length,
                        pendingBytes: saved.sizes.reduce((sum, bytes) => sum + bytes, 0), controls: saved.control.count,
                        refusedKind: payload.t, refusedHelpIndex: payload.t === 'notice' ? HELP.indexOf(payload.text) : -1,
                        pressureClosesBefore: prior.pressureCloses, pressureClosesAfter: after.pressureCloses,
                        nativeSendCallsBefore: nativeCallsBefore, nativeSendCallsAfter: meter.nativeSendCalls,
                        pendingFramesBefore: prior.pendingFrames, pendingFramesAfter: after.pendingFrames,
                        pendingBytesBefore: prior.pendingBytes, pendingBytesAfter: after.pendingBytes };
                }
                return accepted;
            };
        }
    }
    fixtureRetentionHealthEvent(stage, outcome, reason = 'none') {
        try {
            if (this.env.FIXTURE_RETENTION_PROOF !== 'retention-v1') return;
            const trace = this.fixtureRetentionHealthTrace ||= { storageFailedCount: 0, overflow: false, events: [] };
            if (trace.events.length < 128) trace.events.push({ stage, outcome, reason });
            else trace.overflow = true;
        } catch { /* Diagnostic recording cannot alter a production call. */ }
    }
    fixtureRetentionHealth() {
        if (this.env.FIXTURE_RETENTION_PROOF !== 'retention-v1') return undefined;
        const trace = this.fixtureRetentionHealthTrace ||= { storageFailedCount: 0, overflow: false, events: [] };
        return { evidenceStorage: ['ready', 'degraded'].includes(this.evidenceStorage) ? this.evidenceStorage : 'other',
            authorityUnavailable: !!this.authorityUnavailable, storageFailedCount: trace.storageFailedCount,
            overflow: trace.overflow, events: trace.events.map(event => ({ ...event })) };
    }
    storageFailed(...args) {
        try {
            if (this.env.FIXTURE_RETENTION_PROOF === 'retention-v1') {
                const trace = this.fixtureRetentionHealthTrace ||= { storageFailedCount: 0, overflow: false, events: [] };
                if (trace.storageFailedCount < 65535) trace.storageFailedCount++; else trace.overflow = true;
                this.fixtureRetentionHealthEvent('storage-failed', 'called');
            }
        } catch { /* Always delegate even if diagnostic recording fails. */ }
        return super.storageFailed(...args);
    }
    async start(...args) {
        this.fixtureRetentionHealthEvent('start', 'called');
        let result;
        try { result = await super.start(...args); }
        catch (error) {
            // Also observe the constructor's known-empty pre-initialize load.
            // The real constructor catch and every later caller remain intact.
            this.fixtureRetentionHealthEvent('start', 'threw', retentionHealthReason(error, true));
            throw error;
        }
        if (this.env.FIXTURE_RETENTION_PROOF !== 'retention-v1') return result;
        const observe = (original, receiver, stage) => async (...values) => {
            this.fixtureRetentionHealthEvent(stage, 'called');
            try {
                const value = await Reflect.apply(original, receiver, values);
                const denied = retentionHealthDenied(value);
                this.fixtureRetentionHealthEvent(stage, denied ? 'returned-denied' : 'returned', retentionHealthReason(value));
                return value;
            } catch (error) {
                this.fixtureRetentionHealthEvent(stage, 'threw', retentionHealthReason(error, true));
                throw error;
            }
        };
        // The real authority is frozen. A new frozen facade preserves every
        // other own descriptor/prototype/reference; selected originals receive
        // the ORIGINAL authority receiver, not a proxy or the facade.
        if (this.authority) {
            const original = this.authority, descriptors = Object.getOwnPropertyDescriptors(original);
            for (const [name, stage] of [['maintainParticipation', 'authority-maintain'], ['due', 'authority-due'], ['schedule', 'authority-schedule']]) {
                ensure(typeof descriptors[name]?.value === 'function', 'fixture-retention-diagnostic-authority-shape');
                descriptors[name] = { ...descriptors[name], value: observe(descriptors[name].value, original, stage) };
            }
            this.authority = Object.freeze(Object.create(Object.getPrototypeOf(original), descriptors));
        }
        if (this.engine) for (const [name, stage] of [['refreshParticipation', 'engine-refresh'], ['tick', 'engine-tick']]) {
            ensure(typeof this.engine[name] === 'function', 'fixture-retention-diagnostic-engine-shape');
            this.engine[name] = observe(this.engine[name], this.engine, stage);
        }
        for (const [name, stage] of [['pruneLogs', 'prune-logs'], ['refreshPrivateReports', 'private-reports']])
            this[name] = observe(this[name], this, stage);
        this.fixtureRetentionHealthEvent('start', 'returned');
        return result;
    }
    async fixtureIncidentActor(cookie) {
        ensure(!!this.incidentSourceMode, 'fixture-incident-mode-required');
        const identity = await this.fixtureParticipant(cookie);
        const candidates = [...this.liveBindings.values()].filter(binding => `s_${binding.betaSid}` === identity.principalRef);
        ensure(candidates.length === 1 && !candidates[0].account, 'fixture-incident-current-guest-required');
        const binding = candidates[0];
        return { binding, identity: { ...identity, expiresAt: binding.expiresAt } };
    }
    async fixtureIncidentModel(actor) {
        if (!this.fixtureIncidentCipher) {
            // Synthetic test purpose key only, delivered privately by the
            // parent and never exported. No production key provisioning.
            const hex = this.env.FIXTURE_INCIDENT_KEY; ensure(typeof hex === 'string' && /^[a-f0-9]{64}$/.test(hex), 'fixture-incident-key-required');
            const raw = Uint8Array.from(hex.match(/../g), part => parseInt(part, 16));
            const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']); raw.fill(0);
            this.fixtureIncidentCipher = createIncidentEvidenceCipher({ keyId: 'synthetic_native_incident_key', key });
        }
        return createIncidentCases({ storage: this.authority.records, cipher: this.fixtureIncidentCipher,
            resolveAuthority: async ({ tx, principal }) => {
                if (principal !== actor.identity.principalRef || !await this.authority.validateParticipationConnection({ tx, connection: actor.binding, identity: actor.identity })) return null;
                const appointment = await tx.get(INCIDENT_APPOINTMENT);
                return appointment?.principalRef === principal ? appointment : null;
            },
            resolveReviewer: ({ tx }) => tx.get(INCIDENT_APPOINTMENT), policyFor: ({ tx }) => tx.get(INCIDENT_POLICY),
            loadEvidence: input => this.authority.loadIncidentEvidence(input) });
    }
    async fixtureIncident(operation, body) {
        const keys = operation === 'incident-initialize' ? ['cookie'] : operation === 'incident-preserve' ? ['cookie', 'id'] : ['cookie', 'caseRef'];
        ensure(Object.keys(body).length === keys.length && keys.every(key => Object.hasOwn(body, key)), 'fixture-incident-shape');
        const actor = await this.fixtureIncidentActor(body.cookie), at = Date.now(), day = 86400000;
        if (operation === 'incident-initialize') {
            await this.authority.records.transaction(async tx => {
                ensure(await tx.get(INCIDENT_CASES) === undefined && await tx.get(INCIDENT_APPOINTMENT) === undefined && await tx.get(INCIDENT_POLICY) === undefined, 'fixture-incident-already-initialized');
                ensure(await this.authority.validateParticipationConnection({ tx, connection: actor.binding, identity: actor.identity }), 'fixture-incident-current-binding');
                await tx.put(INCIDENT_CASES, initialIncidentCaseState());
                await tx.put(INCIDENT_APPOINTMENT, { actorRef: 'synthetic_native_handler', principalRef: actor.identity.principalRef,
                    incidentReviewer: true, active: true, revision: 1, expiresAt: actor.identity.expiresAt, canOpen: true, canMaintain: true });
                await tx.put(INCIDENT_POLICY, { qualified: true, version: 'synthetic_native_v1', procedure: 'synthetic_only', authority: 'synthetic_decision', reason: 'selected_report',
                    validFrom: at, validUntil: actor.identity.expiresAt, reviewAt: at + day + 1000, holdUntil: null,
                    evidenceDeleteAt: at + day + 2000, caseDeleteAt: at + day + 3000, tombstoneUntil: at + 2 * day,
                    receiptUntil: at + 2 * day, auditUntil: at + 2 * day,
                    limits: { maxCases: 4, maxBytes: 100000, maxEvidenceBytes: 1200, maxAuditEvents: 100, maxOperations: 100, maxTombstones: 10 } });
            });
            return { initializedSyntheticIncidentAuthority: true };
        }
        const model = await this.fixtureIncidentModel(actor), principal = actor.identity.principalRef;
        let receipt;
        if (operation === 'incident-preserve') {
            ensure(typeof body.id === 'string' && /^m[a-z0-9]{1,80}$/i.test(body.id), 'fixture-incident-source-id');
            const source = await this.authority.records.transaction(tx => this.authority.loadIncidentEvidence({ tx, sourceId: body.id }));
            ensure(source && new TextDecoder().decode(source.bytes) === SELECTED_REPORT, 'fixture-incident-fixed-selected-source');
            receipt = await model.preserveSelectedReport({ principal, operationId: 'native_preserve_' + crypto.randomUUID().replaceAll('-', ''),
                sourceId: source.id, sourceRevision: source.revision, sourceDigest: source.digest, type: 'safety' });
        } else {
            ensure(typeof body.caseRef === 'string' && /^[A-Za-z0-9_-]{1,96}$/.test(body.caseRef), 'fixture-incident-case-id');
            const found = await model.readCase({ principal, operationId: 'native_metadata_' + crypto.randomUUID().replaceAll('-', ''), caseRef: body.caseRef });
            ensure(found.ok, 'fixture-incident-recovered-case'); receipt = { ok: true, caseRef: found.caseRef, revision: found.revision };
        }
        ensure(receipt.ok === true, 'fixture-incident-preservation-unconfirmed');
        const evidence = await model.readEvidence({ principal, operationId: 'native_evidence_' + crypto.randomUUID().replaceAll('-', ''), caseRef: receipt.caseRef, expectedRevision: receipt.revision });
        ensure(evidence.ok && new TextDecoder().decode(evidence.evidence.bytes) === SELECTED_REPORT && evidence.evidence.provenance === 'reported-public', 'fixture-incident-exact-evidence');
        const digest = await incidentEvidenceDigest(evidence.evidence.bytes); evidence.evidence.bytes.fill(0);
        return this.authority.records.transaction(async tx => {
            const index = await tx.get(LOBBY_INCIDENT_SOURCE_KEY), cases = await tx.get(INCIDENT_CASES), record = cases.cases.find(row => row.id === receipt.caseRef);
            ensure(record && !JSON.stringify(cases).includes(SELECTED_REPORT), 'fixture-incident-plaintext-copy');
            ensure(Object.keys(index).sort().join(',') === 'entries,nextGeneration,v'
                && index.entries.every(row => Object.keys(row).sort().join(',') === 'digest,expiresAt,id,originDigest,revision'), 'fixture-incident-index-metadata-only');
            return { caseRef: receipt.caseRef, revision: receipt.revision, sourceRevision: record.source.revision, digest,
                provenance: 'reported-public', exactSelectedBytes: true, metadataOnlyIndex: true, noCasePlaintext: true,
                nextGeneration: index.nextGeneration, sourceCount: index.entries.length, caseCount: cases.cases.length };
        });
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
            // Five lifetime synthetic subjects A/B/C/D/E for the new real
            // self-withdrawal journey; no production capacity is changed.
            admitSubject: async ({ tx }) => { const n = await tx.get('fixture-participation-allocation') || 0; if (n >= (this.env.FIXTURE_FANOUT_50 === 'fanout-v1' ? 50 : 5)) return false; await tx.put('fixture-participation-allocation', n + 1); return true; },
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
    fixtureRetentionMode() {
        ensure(this.env.FIXTURE_RETENTION_PROOF === 'retention-v1' && this.participationMode && !this.incidentSourceMode
            && this.env.FIXTURE_TRAFFIC_ACKS === undefined && this.env.FIXTURE_PRESSURE_ONLY === undefined && this.env.FIXTURE_FANOUT_50 === undefined, 'fixture-retention-plain-mode');
    }
    async fixtureRetention(operation, body) {
        this.fixtureRetentionMode(); ensure(Object.keys(body).join(',') === 'cookie', 'fixture-retention-body');
        const identity = await this.fixtureParticipant(body.cookie), prefix = 'participation-records:v1:';
        const route = async principal => prefix + 'record:' + await sha(LOBBY_AUTHORITY_COMMUNITY + '\0' + principal);
        const targetKey = await route(RETENTION.principal), healthyKey = await route(identity.principalRef);
        const targetKeys = [targetKey, prefix + 'anchor:' + targetKey.split(':').at(-1), prefix + 'subject:' + await sha(RETENTION.subject),
            ...await Promise.all([['pending', RETENTION.pending], ['guardian', RETENTION.guardian], ['consent', RETENTION.consent],
                ['decision', 'synthetic_fixture_verifier\0' + RETENTION.decision]].map(async ([space, ref]) => prefix + 'unique:' + space + ':' + await sha(ref))),
            prefix + 'operation:' + await sha(RETENTION.begin), prefix + 'operation:' + await sha(RETENTION.complete)];
        ensure(new Set(targetKeys).size === 9, 'fixture-retention-nine-owned-keys');
        const active = state => ({ version: state.version, config: state.config,
            subjects: state.subjects, guardians: state.guardians, receipts: state.receipts });
        let baseline;
        const result = await this.authority.records.transaction(async (tx, raw) => {
            const policy = await tx.get(PARTICIPATION_POLICY_KEY), healthy = await tx.get(healthyKey), at = Date.now();
            ensure(validParticipationLedgerState(policy, PARTICIPATION_RECORD_LIMITS) && policy.config.policy.communityRef === identity.communityRef
                && validParticipationLedgerState(healthy, PARTICIPATION_RECORD_LIMITS), 'fixture-retention-current-policy-and-healthy');
            const subject = healthy.subjects[0]?.record, receipt = healthy.receipts.find(row => row.consentRef === subject?.consentRefs[0]), guardian = healthy.guardians.find(row => row.guardianRef === receipt?.guardianRef);
            ensure(subject?.principalRef === identity.principalRef && subject.state === 'authorized' && subject.expiresAt > at
                && receipt?.state === 'active' && receipt.expiresAt > at && guardian?.state === 'verified' && guardian.expiresAt > at, 'fixture-retention-healthy-active-grant');
            const healthyActiveSha256 = await sha(JSON.stringify(active(healthy)));
            if (operation === 'retention-seed') {
                ensure(!this.fixtureRetentionBaseline, 'fixture-retention-one-seed');
                for (const key of targetKeys) ensure(await tx.get(key) === undefined, 'fixture-retention-target-already-present');
                const candidates = []; let startAfter;
                for (let pageNumber = 0; pageNumber < 2; pageNumber++) {
                    const page = await tx.list({ prefix: prefix + 'record:', limit: 4, ...(startAfter ? { startAfter } : {}) });
                    for (const [key, value] of page) { candidates.push([key, value]); startAfter = key; }
                    if (page.size < 4) break;
                }
                ensure(candidates.length === 5, 'fixture-retention-five-existing-subjects');
                const source = candidates.find(([, value]) => validParticipationLedgerState(value, PARTICIPATION_RECORD_LIMITS)
                    && value.subjects.length === 1 && value.guardians.length && value.receipts.length && value.pending.length
                    && value.operations.some(row => row.kind === 'begin') && value.operations.some(row => row.kind === 'complete'));
                ensure(source, 'fixture-retention-real-stored-template');
                const [sourceKey, template] = source, value = structuredClone(template), rules = policy.config.rules;
                const expiresAt = at - Math.max(...Object.entries(rules).filter(([key]) => key.endsWith('Ms')).map(([, duration]) => duration)) - 1000, issuedAt = expiresAt - 1000;
                ensure(Number.isSafeInteger(issuedAt) && issuedAt > 0, 'fixture-retention-past-window');
                value.config = structuredClone(policy.config);
                value.subjects = [{ record: { ...structuredClone(template.subjects[0].record), subjectRef: RETENTION.subject, principalRef: RETENTION.principal,
                    communityRef: identity.communityRef, state: 'expired', purposes: [], consentRefs: [], issuedAt, effectiveAt: issuedAt, expiresAt }, deleteAt: expiresAt + rules.subjectTailMs }];
                value.guardians = [{ ...structuredClone(template.guardians[0]), guardianRef: RETENTION.guardian, subjectRef: RETENTION.subject,
                    decisionRef: RETENTION.decision, state: 'expired', issuedAt, expiresAt, deleteAt: expiresAt + rules.guardianTailMs }];
                value.receipts = [{ ...structuredClone(template.receipts[0]), consentRef: RETENTION.consent, guardianRef: RETENTION.guardian,
                    subjectRef: RETENTION.subject, decisionRef: RETENTION.decision, state: 'expired', issuedAt, expiresAt, deleteAt: expiresAt + rules.receiptTailMs }];
                ensure(value.receipts[0].verifierRef === 'synthetic_fixture_verifier', 'fixture-retention-current-verifier');
                value.pending = [{ ...structuredClone(template.pending[0]), pendingRef: RETENTION.pending, subjectRef: RETENTION.subject, principalRef: RETENTION.principal,
                    state: 'expired', issuedAt, expiresAt, grantExpiresAt: expiresAt, deleteAt: expiresAt + rules.callbackMs }];
                value.operations = ['begin', 'complete'].map(kind => {
                    const row = structuredClone(template.operations.find(item => item.kind === kind)), signature = JSON.parse(row.signature);
                    row.operationRef = RETENTION[kind]; row.issuedAt = issuedAt; row.deleteAt = issuedAt + rules.operationMs;
                    row.result.subjectRef = RETENTION.subject; if (row.result.pendingRef) row.result.pendingRef = RETENTION.pending;
                    signature.principalRef = RETENTION.principal;
                    if (kind === 'begin') signature.communityRef = identity.communityRef;
                    else Object.assign(signature, { operationRef: row.operationRef, pendingRef: RETENTION.pending, subjectRef: RETENTION.subject,
                        guardianPrincipalRef: value.guardians[0].principalRef, decisionRef: RETENTION.decision, verifiedAt: issuedAt, expiresAt });
                    row.signature = JSON.stringify(signature); return row;
                });
                ensure(validParticipationLedgerState(value, PARTICIPATION_RECORD_LIMITS)
                    && ['subjects', 'guardians', 'receipts', 'pending', 'operations'].every(kind => value[kind].every(row => row.deleteAt <= at)), 'fixture-retention-valid-expired-record');
                const anchor = await tx.get(prefix + 'anchor:' + sourceKey.split(':').at(-1));
                ensure(anchor?.partitionKey === sourceKey, 'fixture-retention-real-anchor');
                const own = { ...structuredClone(anchor), principalRef: RETENTION.principal, communityRef: identity.communityRef, partitionKey: targetKey, subjectRef: RETENTION.subject };
                await tx.put(targetKeys[0], value); await tx.put(targetKeys[1], own); await tx.put(targetKeys[2], own);
                const refs = [['pending', value.pending[0].pendingRef, value.pending[0].deleteAt], ['guardian', value.guardians[0].guardianRef, value.guardians[0].deleteAt],
                    ['consent', value.receipts[0].consentRef, value.receipts[0].deleteAt], ['decision', value.receipts[0].verifierRef + '\0' + value.receipts[0].decisionRef, value.receipts[0].deleteAt]];
                for (let i = 0; i < refs.length; i++) {
                    const [space, reference, deleteAt] = refs[i], original = space === 'pending' ? template.pending[0].pendingRef : space === 'guardian' ? template.guardians[0].guardianRef
                        : space === 'consent' ? template.receipts[0].consentRef : template.receipts[0].verifierRef + '\0' + template.receipts[0].decisionRef;
                    const stored = await tx.get(prefix + 'unique:' + space + ':' + await sha(original));
                    ensure(stored?.partitionKey === sourceKey && stored.space === space, 'fixture-retention-real-global-reference');
                    await tx.put(targetKeys[3 + i], { ...stored, reference, deleteAt, principalRef: RETENTION.principal, communityRef: identity.communityRef, partitionKey: targetKey });
                }
                for (let i = 0; i < value.operations.length; i++) {
                    const row = value.operations[i], original = template.operations.find(item => item.kind === row.kind), stored = await tx.get(prefix + 'operation:' + await sha(original.operationRef));
                    ensure(stored?.partitionKey === sourceKey, 'fixture-retention-real-operation-reference');
                    await tx.put(targetKeys[7 + i], { ...stored, operationRef: row.operationRef, deleteAt: row.deleteAt, principalRef: RETENTION.principal, communityRef: identity.communityRef, partitionKey: targetKey });
                }
                let manifestsPresent = 0, partPrefixesPresent = 0;
                for (const key of targetKeys) {
                    ensure(await tx.get(key) !== undefined, 'fixture-retention-native-seed-unconfirmed');
                    const encoded = [...new TextEncoder().encode(key)].map(byte => byte.toString(16).padStart(2, '0')).join(''), base = 'durable-record:v1:lobby-authority-v1:';
                    ensure(await raw.get(base + 'manifest:' + encoded) !== undefined, 'fixture-retention-seed-raw-manifest-missing'); manifestsPresent++;
                    const parts = await raw.list({ prefix: base + 'part:' + encoded + ':', limit: 1 });
                    ensure(parts instanceof Map && parts.size === 1, 'fixture-retention-seed-raw-part-missing'); partPrefixesPresent++;
                }
                baseline = structuredClone(healthy);
                return { storedSchemaBoundaryOnly: true, targetCounts: [1, 1, 1, 1, 2], targetLogicalKeysPresent: targetKeys.length,
                    targetRawManifestsPresent: manifestsPresent, targetRawPartPrefixesPresent: partPrefixesPresent,
                    targetRecordBytes: new TextEncoder().encode(JSON.stringify(value)).byteLength, healthyActiveSha256 };
            }
            ensure(operation === 'retention-read', 'fixture-retention-operation');
            let logicalAbsent = 0, manifestAbsent = 0, partsAbsent = 0;
            for (const key of targetKeys) {
                if (await tx.get(key) === undefined) logicalAbsent++;
                const encoded = [...new TextEncoder().encode(key)].map(byte => byte.toString(16).padStart(2, '0')).join(''), base = 'durable-record:v1:lobby-authority-v1:';
                if (await raw.get(base + 'manifest:' + encoded) === undefined) manifestAbsent++;
                const parts = await raw.list({ prefix: base + 'part:' + encoded + ':', limit: 1 }); if (!parts.size) partsAbsent++;
            }
            const cursor = await tx.get(PARTICIPATION_MAINTENANCE_CURSOR_KEY);
            ensure(cursor && Object.keys(cursor).sort().join(',') === 'after,communityRef,version' && cursor.version === 1 && cursor.communityRef === identity.communityRef
                && (cursor.after === '' || /^participation-records:v1:record:[a-f0-9]{64}$/.test(cursor.after)), 'fixture-retention-current-cursor');
            let history;
            if (this.fixtureRetentionBaseline) {
                const before = this.fixtureRetentionBaseline, completedAt = this.fixtureRetentionAlarm?.completedAt;
                ensure(Number.isSafeInteger(completedAt) && completedAt >= this.fixtureRetentionAlarm.startedAt, 'fixture-retention-actual-alarm-boundary');
                ensure(JSON.stringify(active(before)) === JSON.stringify(active(healthy)), 'fixture-retention-active-grant-changed');
                let removed = 0;
                for (const [kind, ref] of [['pending', 'pendingRef'], ['operations', 'operationRef']]) {
                    for (const row of healthy[kind]) ensure(before[kind].some(old => old[ref] === row[ref] && JSON.stringify(old) === JSON.stringify(row)), 'fixture-retention-unexpected-history-change');
                    for (const row of before[kind]) if (!healthy[kind].some(current => current[ref] === row[ref])) { ensure(row.deleteAt <= completedAt, 'fixture-retention-unexpired-history-removed'); removed++; }
                }
                ensure(removed ? healthy.revision > before.revision && healthy.revision <= before.revision + removed : healthy.revision === before.revision, 'fixture-retention-unrelated-ledger-revision-change');
                history = { healthyActivePermissionPreserved: true, onlyExpiredAncillaryRowsRemoved: true, alarmHandlerCompleted: true,
                    alarmElapsedMs: completedAt - this.fixtureRetentionAlarm.startedAt };
            }
            return { targetLogicalKeysAbsent: logicalAbsent, targetRawManifestsAbsent: manifestAbsent, targetRawPartPrefixesEmpty: partsAbsent,
                cursorValid: true, cursorWrapped: cursor.after === '', healthyActiveSha256, healthyStoredRowValid: true,
                handlerHealthy: this.evidenceStorage === 'ready' && !this.authorityUnavailable, retentionHealth: this.fixtureRetentionHealth(), ...history };
        });
        if (baseline) this.fixtureRetentionBaseline = baseline;
        return result;
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
    fixtureFanoutMode() {
        ensure(this.env.FIXTURE_FANOUT_50 === 'fanout-v1' && this.fixtureControl.fanout && this.participationMode && !this.incidentSourceMode,
            'fixture-fanout-mode-required'); return this.fixtureControl.fanout;
    }
    fixtureFanoutMetrics() {
        const meter = this.fixtureFanoutMode(), current = this.engine.sessionSnapshot().connections;
        ensure(current.length <= 50 && current.every(person => !person.account && person.role === 'fan'), 'fixture-fanout-current-guests-required');
        if (!meter.slots.size) {
            ensure(current.length === 50 && Array.from({ length: 50 }, (_, index) => `NativeFan${String(index).padStart(2, '0')}`)
                .every(label => current.filter(person => person.nick === label).length === 1), 'fixture-fifty-real-members-required');
            for (const person of current) {
                ensure(this.liveBindings.has(person.id), 'fixture-fanout-live-binding-required');
                const selected = this.state.getWebSockets().filter(socket => socket.readyState === 1 && socket.deserializeAttachment()?.id === person.id);
                ensure(selected.length === 1, 'fixture-fanout-native-socket-required');
                meter.slots.set(person.id, { slot: Number(person.nick.slice(-2)), socket: selected[0] });
            }
        }
        ensure(meter.slots.size === 50 && current.every(person => meter.slots.has(person.id)), 'fixture-fanout-fixed-fifty-required');
        const sockets = [...meter.slots].map(([id, entry]) => {
            const { delivery, controlGrant } = entry.socket.deserializeAttachment();
            ensure(delivery?.enabled === true && delivery.negotiated === true && Array.isArray(delivery.sizes), 'fixture-fanout-native-transport-required');
            return { slot: entry.slot, live: current.some(person => person.id === id) && this.liveBindings.has(id) && entry.socket.readyState === 1,
                sequence: delivery.seq, acknowledged: delivery.ack, controls: delivery.control.count, pendingFrames: delivery.sizes.length,
                remainingControls: controlGrant?.remaining ?? 0 };
        }).sort((a, b) => a.slot - b.slot);
        return { sockets, engineCount: current.length, liveBindingCount: this.liveBindings.size,
            delivery: this.delivery.snapshot(), controlBudget: this.controlBudget.snapshot(), nativeStorageMethodCalls: this.fixtureControl.nativeCalls,
            nativeMutations: this.fixtureControl.nativeMutations, nativeStorageCounters: snapshotNative(meter.storageCounters) };
    }
    async fixtureFanoutSummary() {
        this.fixtureFanoutMode(); const saved = await this.authority.load(), current = this.engine.sessionSnapshot().connections;
        ensure(saved.bindings.length <= 50 && saved.state.sessions.connections.length <= 50 && current.length <= 50
            && saved.bindings.every(({ binding }) => !binding.account && binding.role === 'fan'), 'fixture-fanout-summary-bound');
        return { domainDigest: await sha(this.state.id.toString()), authorityUnavailable: !!this.authorityUnavailable,
            bindingCount: saved.bindings.length, liveBindingCount: this.liveBindings.size, storedConnections: saved.state.sessions.connections.length,
            engineConnections: current.length, reports: saved.state.moderationQueue.reports.length, held: saved.state.moderationQueue.held.length,
            rooms: saved.state.rooms.rooms.length };
    }
    async fixtureFanoutScan(body) {
        const meter = this.fixtureFanoutMode();
        ensure(Object.keys(body).join(',') === 'token' && typeof body.token === 'string', 'fixture-fanout-scan-request');
        if (!meter.scanStarted) {
            ensure(body.token === '', 'fixture-fanout-scan-start'); meter.scanStarted = true;
            meter.scan = { token: '', domain: 'logical', cursor: '', logicalRows: 0, rawRows: 0, bytes: 0, passes: 0,
                mutations: this.fixtureControl.nativeMutations, required: new Set(), absent: true, complete: false, failed: false };
        }
        const scan = meter.scan;
        ensure(scan && !scan.failed && !scan.complete && body.token === scan.token && ++scan.passes <= 14, 'fixture-fanout-scan-token-or-bound');
        scan.token = null; // Consume continuation before any awaited native read.
        try {
            ensure(this.fixtureControl.nativeMutations === scan.mutations, 'fixture-fanout-scan-mutated');
            const domain = scan.domain; let rows = 0, bytes = 0, ended = false;
            while (rows < 256 && !ended) {
                const page = domain === 'logical' ? await this.authority.records.transaction(tx => tx.list({ prefix: '', ...(scan.cursor ? { startAfter: scan.cursor } : {}), limit: 4 }))
                    : await this.state.storage.list({ prefix: 'durable-record:v1:lobby-authority-v1:', ...(scan.cursor ? { startAfter: scan.cursor } : {}), limit: 4 });
                ensure(page instanceof Map && page.size <= 4, 'fixture-fanout-scan-page');
                for (const [key, value] of page) {
                    ensure(key > scan.cursor && ++rows <= 256, 'fixture-fanout-scan-order-or-page-bound');
                    const text = domain === 'logical' ? JSON.stringify(value) : value instanceof Uint8Array ? new TextDecoder().decode(value)
                        : value instanceof ArrayBuffer ? new TextDecoder().decode(value) : JSON.stringify(value);
                    const length = new TextEncoder().encode(text).byteLength; bytes += length; scan.bytes += length;
                    ensure(bytes <= 8 * 1024 * 1024 && scan.bytes <= 32 * 1024 * 1024, 'fixture-fanout-scan-byte-bound');
                    if (text.includes(FANOUT_PREFIX)) scan.absent = false;
                    if (domain === 'logical') {
                        ensure(++scan.logicalRows <= 1024, 'fixture-fanout-logical-row-bound');
                        if (['net', 'room-index', 'moderation-queue', 'private-reports-v1', 'authority-session-index:v1', 'authority-connection-index:v1'].includes(key)) scan.required.add(key);
                    } else ensure(++scan.rawRows <= 2048, 'fixture-fanout-raw-row-bound');
                    ensure(scan.logicalRows + scan.rawRows <= 3072, 'fixture-fanout-combined-row-bound'); scan.cursor = key;
                }
                ended = page.size < 4;
            }
            ensure(this.fixtureControl.nativeMutations === scan.mutations, 'fixture-fanout-scan-mutated');
            if (ended) {
                if (domain === 'logical') { ensure(scan.logicalRows > 0 && scan.required.size === 6, 'fixture-fanout-required-records'); scan.domain = 'raw'; scan.cursor = ''; }
                else { ensure(scan.rawRows > 0, 'fixture-fanout-raw-nonempty'); scan.complete = true; }
            }
            ensure(scan.absent, 'fixture-fanout-ordinary-body-persisted');
            scan.token = scan.complete ? null : crypto.randomUUID();
            return { domain, rows, bytes, logicalRows: scan.logicalRows, rawRows: scan.rawRows, combinedRows: scan.logicalRows + scan.rawRows,
                combinedBytes: scan.bytes, passes: scan.passes, ordinaryMarkerAbsent: scan.absent, requiredRecordsPresent: scan.required.size === 6,
                complete: scan.complete, token: scan.token };
        } catch (error) { scan.failed = true; throw error; }
    }
    async fixturePressureRegister(cookie) {
        const meter = this.fixtureControl.pressure;
        ensure(this.env.FIXTURE_PRESSURE_ONLY === 'pressure-v1' && meter && this.participationMode && !this.incidentSourceMode, 'fixture-pressure-mode-required');
        ensure(!meter.probeSocket && meter.slots.size === 0, 'fixture-pressure-registration-once');
        const identity = await this.fixtureParticipant(cookie), current = this.engine.sessionSnapshot().connections;
        ensure(current.length === 3 && current.every(person => !person.account)
            && TRAFFIC_LABELS.every(label => current.filter(person => person.nick === label).length === 1), 'fixture-pressure-three-guests-required');
        const candidates = [...this.liveBindings.values()].filter(binding => `s_${binding.betaSid}` === identity.principalRef);
        ensure(candidates.length === 1 && current.find(person => person.id === candidates[0].id)?.nick === 'NativeCharlie', 'fixture-pressure-probe-current-SID-required');
        const sockets = this.state.getWebSockets().filter(socket => socket.readyState === 1 && socket.deserializeAttachment()?.id === candidates[0].id);
        ensure(sockets.length === 1, 'fixture-pressure-probe-one-socket');
        for (const person of current) meter.slots.set(person.id, TRAFFIC_LABELS.indexOf(person.nick));
        meter.probeSocket = sockets[0];
        const nativeSocketSend = meter.probeSocket.send.bind(meter.probeSocket);
        meter.initialSequence = meter.probeSocket.deserializeAttachment().delivery.seq;
        const observedSend = raw => { meter.nativeSendCalls++; const result = nativeSocketSend(raw); meter.nativeSendReturned++; return result; };
        // Exact pass-through observation on this one native socket. A runtime
        // that refuses this instrumentation must fail, never fake the witness.
        meter.probeSocket.send = observedSend;
        ensure(meter.probeSocket.send === observedSend, 'fixture-native-send-observation-unavailable');
        return { registeredCurrentGuest: true, helpCount: HELP.length, helpDigests: await Promise.all(HELP.map(sha)) };
    }
    fixturePressureMetrics() {
        const meter = this.fixtureControl.pressure;
        ensure(this.env.FIXTURE_PRESSURE_ONLY === 'pressure-v1' && meter?.probeSocket && meter.slots.size === 3
            && this.participationMode && !this.incidentSourceMode, 'fixture-pressure-mode-required');
        const current = this.engine.sessionSnapshot().connections;
        ensure(current.length <= 3 && current.every(person => !person.account && meter.slots.has(person.id) && this.liveBindings.has(person.id)), 'fixture-pressure-current-guests-required');
        const sockets = current.map(person => {
            const selected = this.state.getWebSockets().filter(socket => socket.readyState === 1 && socket.deserializeAttachment()?.id === person.id);
            ensure(selected.length === 1, 'fixture-pressure-current-socket-required');
            const { delivery, controlGrant } = selected[0].deserializeAttachment();
            ensure(delivery?.enabled === true && delivery.negotiated === true && Array.isArray(delivery.sizes), 'fixture-pressure-native-state-required');
            return { slot: meter.slots.get(person.id), sequence: delivery.seq, acknowledged: delivery.ack, pendingFrames: delivery.sizes.length,
                pendingBytes: delivery.sizes.reduce((sum, bytes) => sum + bytes, 0), controls: delivery.control.count,
                remainingControls: controlGrant?.remaining ?? 0 };
        }).sort((a, b) => a.slot - b.slot);
        return { sockets, liveBindingCount: this.liveBindings.size, engineConnections: current.length,
            delivery: this.delivery.snapshot(), controlBudget: this.controlBudget.snapshot(), nativeStorageMethodCalls: this.fixtureControl.nativeCalls,
            helpAttempts: meter.helpAttempts.map(value => ({ ...value })), overflow: meter.overflow,
            nativeProbeSends: { initialSequence: meter.initialSequence, calls: meter.nativeSendCalls, returned: meter.nativeSendReturned },
            witness: meter.witness ? { ...meter.witness } : null };
    }
    fixtureInstallCloseDiagnostic() {
        const meter = this.fixtureControl.traffic;
        if (this.env.FIXTURE_CLOSE_DIAGNOSTIC !== 'close-v1' || !meter || meter.closeDiagnostic) return;
        const diagnostic = meter.closeDiagnostic = { ordinal: 0, events: [], overflow: false };
        const observe = (phase, id, result, threw = false) => {
            try {
                const people = this.engine.sessionSnapshot().connections;
                const known = ['participation-busy', 'participation-capacity', 'participation-denied', 'participation-unavailable', 'session-unavailable'];
                const event = { ordinal: Math.min(33, diagnostic.ordinal + 1), phase, slot: meter.slots.get(id) ?? -1,
                    engineCount: people.length, emptyNickCount: people.filter(person => person.nick === '').length,
                    targetPresent: people.some(person => person.id === id), liveBindingCount: this.liveBindings.size,
                    targetLive: this.liveBindings.has(id), threw, resultObserved: phase.endsWith('-end') || threw,
                    returnedUndefined: result === undefined, resultOk: typeof result?.ok === 'boolean' ? result.ok : null,
                    reason: typeof result?.reason !== 'string' ? 'absent' : known.includes(result.reason) ? result.reason : 'unclassified' };
                diagnostic.ordinal = event.ordinal;
                if (diagnostic.events.length < 32) diagnostic.events.push(event); else diagnostic.overflow = true;
            } catch { diagnostic.overflow = true; } // Observation must never replace actual behavior/results.
        };
        const disconnect = this.engine.disconnect.bind(this.engine);
        this.engine.disconnect = async (...args) => {
            observe('disconnect-start', args[0]);
            try { const result = await disconnect(...args); observe('disconnect-end', args[0], result); return result; }
            catch (error) { observe('disconnect-throw', args[0], undefined, true); throw error; }
        };
        const original = this.authority;
        // The actual authority is frozen: a get-proxy cannot override its
        // nonconfigurable data methods. This fixture-only facade retains every
        // original value/closure and delegates the one observed method exactly.
        this.authority = Object.freeze({ ...original, unbind: async (...args) => {
            observe('unbind-start', args[0]);
            try { const result = await original.unbind(...args); observe('unbind-end', args[0], result); return result; }
            catch (error) { observe('unbind-throw', args[0], undefined, true); throw error; }
        } });
    }
    fixtureCloseDiagnosticMark() {
        const diagnostic = this.fixtureControl.traffic?.closeDiagnostic;
        if (!diagnostic || this.env.FIXTURE_CLOSE_DIAGNOSTIC !== 'close-v1') return null;
        try {
            const people = this.engine.sessionSnapshot().connections;
            return { ordinal: diagnostic.ordinal, engineCount: people.length,
                emptyNickCount: people.filter(person => person.nick === '').length, liveBindingCount: this.liveBindings.size };
        } catch { return { ordinal: diagnostic.ordinal, observationUnavailable: true }; }
    }
    fixtureTrafficMetrics() {
        const meter = this.fixtureControl.traffic;
        ensure(this.env.FIXTURE_TRAFFIC_ACKS === 'ack-v1' && meter && this.participationMode && !this.incidentSourceMode, 'fixture-traffic-mode-required');
        const current = this.engine.sessionSnapshot().connections;
        ensure(current.length === 3 && current.every(person => !person.account), 'fixture-three-traffic-guests-required');
        // Ephemeral slot mapping derives only from real current engine/binding
        // identities. It survives Alpha's empty safety-only nickname locally,
        // but never writes a fixture ID/metric into the authority namespace.
        if (!meter.slots.size) {
            ensure(TRAFFIC_LABELS.every(label => current.filter(person => person.nick === label).length === 1), 'fixture-traffic-labels-required');
            for (const person of current) meter.slots.set(person.id, TRAFFIC_LABELS.indexOf(person.nick));
        }
        ensure(meter.slots.size === 3 && current.every(person => meter.slots.has(person.id) && this.liveBindings.has(person.id)), 'fixture-traffic-current-bindings-required');
        this.fixtureInstallCloseDiagnostic();
        const sockets = current.map(person => {
            const matches = this.state.getWebSockets().filter(socket => socket.readyState === 1 && socket.deserializeAttachment()?.id === person.id);
            ensure(matches.length === 1, 'fixture-traffic-current-socket-required');
            const attachment = matches[0].deserializeAttachment(), delivery = attachment.delivery, grant = attachment.controlGrant;
            ensure(delivery?.enabled === true && delivery.negotiated === true && Array.isArray(delivery.sizes)
                && (grant === undefined && delivery.control.count === 0 || grant?.v === 1 && Number.isSafeInteger(grant.remaining) && grant.remaining >= 0 && grant.remaining < 20), 'fixture-traffic-native-transport-state-required');
            return { slot: meter.slots.get(person.id), enabled: delivery.enabled, sequence: delivery.seq, acknowledged: delivery.ack,
                controls: delivery.control.count, pendingFrames: delivery.sizes.length, remainingControls: grant?.remaining ?? 0 };
        }).sort((a, b) => a.slot - b.slot);
        const requestUnits = this.engine.snapshot().budget.requests;
        ensure(Number.isFinite(requestUnits) && requestUnits >= 0, 'fixture-traffic-request-counter-required');
        return { sockets, delivery: this.delivery.snapshot(), controlBudget: this.controlBudget.snapshot(), requestUnits,
            nativeStorageMethodCalls: this.fixtureControl.nativeCalls,
            transactions: { started: meter.transactionsStarted, committed: meter.transactionsCommitted, rejected: meter.transactionsRejected } };
    }
    async fixtureInspect() {
        const needles = [...ordinaryNeedles, ...(this.env.FIXTURE_TRAFFIC_ACKS === 'ack-v1' ? [TRAFFIC_PREFIX] : []),
            ...(this.env.FIXTURE_PRESSURE_ONLY === 'pressure-v1' ? [PRESSURE_PREFIX] : [])];
        const beforeLoad = this.fixtureCloseDiagnosticMark();
        const saved = await this.authority.load();
        const afterLoad = this.fixtureCloseDiagnosticMark();
        let commandReadyAt, sharingStates, incidentSources;
        if (this.participationMode) {
            const current = this.engine.sessionSnapshot().connections, buckets = new Map(this.engine.abuseSnapshot().buckets), at = Date.now();
            ensure(current.length <= 4 && current.every(person => !person.account), 'fixture-command-guest-bound');
            // Read the actual unchanged 10-token/1-per-second command budget.
            // Export deadlines only, never device/account keys or raw buckets.
            sharingStates = current.map(person => ({ nick: person.nick, safetyOnly: person.safetyOnly === true,
                channels: person.channels.length, cameras: person.cams.length })).sort((a, b) => a.nick.localeCompare(b.nick));
            commandReadyAt = current.map(person => {
                const bucket = buckets.get('command:dev:' + person.dev);
                return { nick: person.nick, at: bucket ? Math.max(at, bucket.at + Math.ceil(Math.max(0, 1 - bucket.tokens) * 1000)) : at };
            });
        }
        if (this.incidentSourceMode) {
            const sourceState = await this.authority.records.transaction(tx => tx.get(LOBBY_INCIDENT_SOURCE_KEY));
            ensure(sourceState && sourceState.entries.length <= 100, 'fixture-source-summary-cap');
            incidentSources = { nextGeneration: sourceState.nextGeneration, entries: sourceState.entries.map(({ id, revision, digest, originDigest, expiresAt }) => ({ id, revision, digest, originDigest, expiresAt })) };
        }
        const rooms = saved.state.rooms.rooms.map(room => ({ name: room.name, kind: room.kind, title: room.title, topic: room.topic, act: room.act }));
        const reportSummaries = await Promise.all(saved.state.moderationQueue.reports.map(async report => ({
            id: report.id, ch: report.ch, from: report.from, textSha256: await sha(report.text),
            contextSha256: await Promise.all(report.context.map(sha)), votes: report.devs.length, hidden: report.hidden
        })));
        const absent = Object.fromEntries(needles.map(needle => [needle, true]));
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
                    for (const needle of needles) if (text.includes(needle)) absent[needle] = false;
                    known.add(key); cursor = key;
                }
            }
            // A missing/wrong namespace must never make absence vacuously pass.
            for (const key of ['net', 'room-index', 'moderation-queue', 'private-reports-v1', 'authority-session-index:v1', 'authority-connection-index:v1'])
                ensure(known.has(key), 'logical-scan-required-record-missing');
            return { rows, bytes, requiredRecordsPresent: true };
        });
        let cursor, rows = 0, bytes = 0;
        const rawAbsent = Object.fromEntries(needles.map(needle => [needle, true]));
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
                for (const needle of needles) if (text.includes(needle)) rawAbsent[needle] = false;
                cursor = key;
            }
        }
        ensure(rows > 0 && bytes > 0, 'raw-scan-empty');
        return { objectId: this.state.id.toString(), sqlite: [...this.state.storage.sql.exec('SELECT 1 AS fixture_sql')][0]?.fixture_sql === 1,
            authorityUnavailable: !!this.authorityUnavailable, bindingCount: saved.bindings.length, liveBindingCount: this.liveBindings.size,
            ...(this.participationMode ? { participationRequired: true, participationPolicyPresent: await this.authority.records.transaction(async tx => (await tx.get(PARTICIPATION_POLICY_KEY)) !== undefined), commandReadyAt, sharingStates } : {}),
            ...(this.incidentSourceMode ? { incidentSources } : {}),
            ...(this.env.FIXTURE_RETENTION_PROOF === 'retention-v1' ? { retentionHealth: this.fixtureRetentionHealth() } : {}),
            durableSessionNicks: saved.state.sessions.connections.map(person => person.nick).sort(),
            engineSessionNicks: this.engine.sessionSnapshot().connections.map(person => person.nick).sort(),
            durableBlockCounts: saved.state.sessions.connections.map(person => ({ nick: person.nick, blocks: person.blocks.length })).sort((a, b) => a.nick.localeCompare(b.nick)),
            engineBlockCounts: this.engine.sessionSnapshot().connections.map(person => ({ nick: person.nick, blocks: person.blocks.length })).sort((a, b) => a.nick.localeCompare(b.nick)),
            rooms, reports: reportSummaries, ordinaryBodiesAbsent: absent,
            logicalScan, rawScan: { rows, bytes, perChunkOrdinaryBodiesAbsent: rawAbsent },
            faultHistory: [...this.fixtureControl.history],
            nativeRollbackWitnesses: this.fixtureControl.rollbackWitnesses.map(item => ({ ...item })),
            fault: { tripped: this.fixtureControl.tripped, nativeWriteCompleted: this.fixtureControl.nativeWriteCompleted },
            ...(beforeLoad ? { closeDiagnostic: { beforeLoad, afterLoad, beforeReturn: this.fixtureCloseDiagnosticMark(),
                loadedSessionCount: saved.state.sessions.connections.length,
                loadedEmptyNickCount: saved.state.sessions.connections.filter(person => person.nick === '').length,
                loadedBindingCount: saved.bindings.length, overflow: this.fixtureControl.traffic.closeDiagnostic.overflow,
                events: this.fixtureControl.traffic.closeDiagnostic.events.map(event => ({ ...event })) } } : {}) };
    }
    async fetch(request) {
        const path = new URL(request.url).pathname;
        if (!path.startsWith(PREFIX)) return super.fetch(request);
        if (!admitted(request, this.env)) return denied();
        const body = await readControl(request); if (!body) return denied();
        await this.ready;
        if (path.startsWith(PREFIX + 'fanout-') && this.env.FIXTURE_FANOUT_50 !== 'fanout-v1') return denied();
        if (path === PREFIX + 'traffic-metrics' && this.env.FIXTURE_TRAFFIC_ACKS !== 'ack-v1') return denied();
        if (path.startsWith(PREFIX + 'retention-') && this.env.FIXTURE_RETENTION_PROOF !== 'retention-v1') return denied();
        if (['pressure-register', 'pressure-metrics'].includes(path.slice(PREFIX.length)) && this.env.FIXTURE_PRESSURE_ONLY !== 'pressure-v1') return denied();
        if (path === PREFIX + 'participation-alarm' && this.participationMode && Object.keys(body).length === 0) {
            const startedAt = Date.now(); await this.alarm();
            if (this.fixtureRetentionBaseline) this.fixtureRetentionAlarm = { startedAt: this.fixtureRetentionAlarm?.startedAt ?? startedAt, completedAt: Date.now() };
            return Response.json({ completed: true });
        }
        return this.state.blockConcurrencyWhile(async () => {
            try {
                if (['incident-initialize', 'incident-preserve', 'incident-read'].includes(path.slice(PREFIX.length))) return Response.json(await this.fixtureIncident(path.slice(PREFIX.length), body));
                if (['participation-policy', 'participation-grant', 'participation-reduce'].includes(path.slice(PREFIX.length))) return Response.json(await this.fixtureParticipation(path.slice(PREFIX.length), body));
                if (['retention-seed', 'retention-read'].includes(path.slice(PREFIX.length))) return Response.json(await this.fixtureRetention(path.slice(PREFIX.length), body));
                if (path === PREFIX + 'fanout-metrics' && Object.keys(body).length === 0) return Response.json(this.fixtureFanoutMetrics());
                if (path === PREFIX + 'fanout-summary' && Object.keys(body).length === 0) return Response.json(await this.fixtureFanoutSummary());
                if (path === PREFIX + 'fanout-scan') return Response.json(await this.fixtureFanoutScan(body));
                if (path === PREFIX + 'inspect' && Object.keys(body).length === 0) return Response.json(await this.fixtureInspect());
                if (path === PREFIX + 'pressure-register' && Object.keys(body).join(',') === 'cookie') return Response.json(await this.fixturePressureRegister(body.cookie));
                if (path === PREFIX + 'pressure-metrics' && Object.keys(body).length === 0) return Response.json(this.fixturePressureMetrics());
                if (path === PREFIX + 'traffic-metrics' && Object.keys(body).length === 0) return Response.json(this.fixtureTrafficMetrics());
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
        if (url.pathname.startsWith(PREFIX + 'fanout-') && env.FIXTURE_FANOUT_50 !== 'fanout-v1') return denied();
        if (url.pathname === PREFIX + 'traffic-metrics' && env.FIXTURE_TRAFFIC_ACKS !== 'ack-v1') return denied();
        if (url.pathname.startsWith(PREFIX + 'retention-') && env.FIXTURE_RETENTION_PROOF !== 'retention-v1') return denied();
        if (['pressure-register', 'pressure-metrics'].includes(url.pathname.slice(PREFIX.length)) && env.FIXTURE_PRESSURE_ONLY !== 'pressure-v1') return denied();
        if (url.pathname === PREFIX + 'initialize' && Object.keys(body).length === 0) {
            // Explicit fixture lifecycle action; betaFetch never forwards it.
            return stub.fetch(new Request(ORIGIN + LOBBY_AUTHORITY_PATH + 'initialize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
        }
        if (['fanout-metrics', 'fanout-summary', 'fanout-scan', 'pressure-register', 'pressure-metrics', 'traffic-metrics', 'inspect', 'fault', 'participation-policy', 'participation-grant', 'participation-reduce', 'participation-alarm', 'retention-seed', 'retention-read', 'incident-initialize', 'incident-preserve', 'incident-read'].includes(url.pathname.slice(PREFIX.length))) return stub.fetch(new Request(request.url, {
            method: 'POST', headers: request.headers, body: JSON.stringify(body)
        }));
        if (url.pathname === PREFIX + 'egress-probe' && Object.keys(body).length === 0) {
            const response = await fetch('https://outbound-denied.invalid/fixture');
            return Response.json({ status: response.status, denied: response.headers.get('X-WebJam-Test-Egress') === 'denied' });
        }
        return denied();
    }
    if (!['/beta/unlock', '/beta/logout', '/beta/state', '/beta/participation', '/beta/participation/stop', '/lobby', '/room', '/turn'].includes(url.pathname)) return denied();
    if (request.headers.get('Origin') !== ORIGIN) return denied();
    const appEnv = { ...env, ASSETS: { fetch: () => new Response('no fixture page requested', { status: 404 }) } };
    return betaFetch(request, appEnv);
} };
