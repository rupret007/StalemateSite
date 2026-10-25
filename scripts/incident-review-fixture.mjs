// Explicit synthetic local fixture. Never imported by product routes/Workers.
import { createLobby } from '../hangout-worker/src/lobby-core.mjs';
import { createBoundedSerialQueue } from '../hangout-worker/src/socket-delivery.mjs';
import { createIncidentCases, createIncidentEvidenceCipher, incidentEvidenceDigest, initialIncidentCaseState } from '../hangout-worker/src/incident-cases.mjs';

const DAY = 86400000, CASES = 'restricted-incident-cases-v1', SOURCES = 'local-incident-source-index', SESSIONS = 'local-incident-session-index';
const enc = new TextEncoder(), dec = new TextDecoder(), copy = value => structuredClone(value);
const opaque = prefix => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
const SAMPLES = ['Benign local acceptance report: the shared drawing worked.', 'Unrelated benign sample: bring a green pencil.'];
const bad = error => ({ ok: false, error });
export function createIncidentFixtureStore() {
    let values = new Map([[CASES, initialIncidentCaseState()], [SOURCES, []], [SESSIONS, []]]), tail = Promise.resolve(), failure = false, pending = 0;
    return {
        transaction(fn) {
            if (pending >= 64) return Promise.reject(Error('Local transaction capacity')); pending++;
            const task = tail.then(async () => {
                const staged = copy(values);
                const result = await fn({ get: async key => copy(staged.get(key)), put: async (key, value) => staged.set(key, copy(value)), delete: async key => staged.delete(key) });
                if (failure) { failure = false; throw Error('Synthetic commit failure'); }
                values = staged; return copy(result);
            }).finally(() => { pending--; });
            tail = task.catch(() => {}); return task;
        },
        failNextCommit() { failure = true; },
        snapshot: () => copy(values)
    };
}

export async function createIncidentReviewFixture({ now = () => Date.now(), schedule = (fn, delay) => setTimeout(fn, delay), cancel = id => clearTimeout(id), limits = {} } = {}) {
    const started = now(), storage = createIncidentFixtureStore(), frames = new Map(), watches = new Map(), acknowledgements = new Map();
    let stopped = false, timer = null, model, lobby, running = null, cleanupStatus = { at: null, errors: [] };
    const engineWork = createBoundedSerialQueue({ maxPending: 32, maxBytes: 65536 });
    const policy = { qualified: true, version: 'local_synthetic_v1', procedure: 'local_selected_report', authority: 'local_synthetic_decision', reason: 'selected_report',
        validFrom: started, validUntil: started + 3 * DAY, reviewAt: started + DAY + 1000, holdUntil: started + DAY + 2000,
        evidenceDeleteAt: started + DAY + 3000, caseDeleteAt: started + DAY + 4000, tombstoneUntil: started + DAY + 5000,
        receiptUntil: started + DAY + 6000, auditUntil: started + DAY + 7000,
        limits: { maxCases: 4, maxBytes: 100000, maxEvidenceBytes: 1000, maxAuditEvents: 200, maxOperations: 200, maxTombstones: 20, ...limits } };
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const cipher = createIncidentEvidenceCipher({ keyId: 'local_ephemeral_incident_key', key });
    await storage.transaction(async tx => {
        for (const actorRef of ['local_handler', 'local_other_handler']) await tx.put(`appointment:${actorRef}`, { actorRef, incidentReviewer: true, active: true,
            revision: 1, expiresAt: policy.validUntil, canOpen: true, canMaintain: actorRef === 'local_handler' });
    });
    const authority = async ({ tx, principal, at }) => {
        const session = typeof principal === 'string' && await tx.get(`session:${principal}`);
        const appointment = session?.active && session.actorRef && await tx.get(`appointment:${session.actorRef}`);
        return appointment?.active && appointment.expiresAt > at && session.appointmentRevision === appointment.revision ? appointment : null;
    };
    const makeModel = () => createIncidentCases({ storage, cipher, now, newRef: opaque,
        resolveAuthority: authority, resolveReviewer: ({ tx, actorRef }) => tx.get(`appointment:${actorRef}`),
        policyFor: ({ action, request, at }) => ({ ...copy(policy),
            ...(action === 'hold' && request.state === 'released' ? { holdUntil: null, authority: 'local_release_decision', reason: 'explicit_release' } : {}),
            ...(action === 'prune-receipts' ? { receiptUntil: at + 1000, auditUntil: at + 1000, holdUntil: null } : {}) }),
        loadEvidence: ({ tx, sourceId }) => tx.get(`source:${sourceId}`) });
    model = makeModel();
    const emit = (type, sessionId) => { for (const [id, listeners] of watches) if (!sessionId || id === sessionId) for (const fn of listeners) fn({ type }); };
    async function persist(kind, value) {
        await storage.transaction(async tx => {
            await tx.put(`lobby:${kind}`, value);
            if (kind !== 'moderation-queue') return;
            const previous = await tx.get(SOURCES), next = [];
            for (const report of value.reports) {
                const bytes = enc.encode(report.text), digest = await incidentEvidenceDigest(bytes), old = await tx.get(`source:${report.id}`);
                next.push(report.id);
                await tx.put(`source:${report.id}`, { id: report.id, revision: old ? old.revision + (old.digest === digest ? 0 : 1) : 1,
                    digest, bytes, expiresAt: report.at + DAY, provenance: 'reported-public' });
            }
            for (const id of previous) if (!next.includes(id)) await tx.delete(`source:${id}`);
            await tx.put(SOURCES, next);
        });
    }
    lobby = createLobby({ now, persist, limits: { defaultSlow: 0 }, send: (id, message) => {
        if (message.t === 'report-status') acknowledgements.set(id, { id: message.id, sequence: (acknowledgements.get(id)?.sequence || 0) + 1 });
        if (!frames.has(id)) frames.set(id, []); const queue = frames.get(id); queue.push(copy(message)); if (queue.length > 128) queue.shift();
    } });
    async function join(id, nick, role = 'fan') {
        await engineWork.enqueue(async () => {
            lobby.connect({ id, dev: opaque('dev'), iph: opaque('iph'), role, admin: role === 'moderator' });
            await lobby.message(id, JSON.stringify({ t: 'hello', nick, age13: true }));
        });
    }
    await join('ordinary_moderator', 'OrdinaryModerator', 'moderator');
    const maintenance = opaque('maintenance');
    await storage.transaction(tx => tx.put(`session:${maintenance}`, { active: true, profile: 'maintenance', actorRef: 'local_handler', appointmentRevision: 1 }));
    async function session(id) { return storage.transaction(tx => tx.get(`session:${id}`)); }
    async function active(id) { return storage.transaction(async tx => !!await authority({ tx, principal: id, at: now() })); }
    function arm() {
        if (stopped) return; if (timer !== null) cancel(timer);
        const state = storage.snapshot(), times = [policy.receiptUntil, policy.auditUntil, policy.tombstoneUntil];
        for (const id of state.get(SOURCES) || []) times.push(state.get(`source:${id}`).expiresAt);
        for (const record of state.get(CASES).cases) times.push(record.reviewAt, record.evidenceDeleteAt, record.caseDeleteAt, record.hold.until);
        const future = times.filter(value => Number.isFinite(value) && value > now());
        timer = future.length ? schedule(() => { timer = null; return cleanup(); }, Math.max(1, Math.min(...future) - now())) : null;
        timer?.unref?.();
    }
    async function cleanup() {
        if (running) return running;
        running = (async () => {
            const failures = [];
            try {
                await engineWork.enqueue(() => lobby.tick());
                for (const record of storage.snapshot().get(CASES).cases) if (record.hold.state !== 'active' && now() >= record.evidenceDeleteAt
                    && (record.evidence.state !== 'deleted' || record.review === 'closed' && now() >= record.caseDeleteAt)) {
                    const result = await model.cleanupCase({ principal: maintenance, operationId: opaque('scheduled_cleanup'), caseRef: record.id, expectedRevision: record.revision });
                    if (!result.ok) failures.push(result.error);
                }
                if (now() >= policy.receiptUntil) {
                    const result = await model.pruneReceipts({ principal: maintenance, operationId: opaque('scheduled_receipts') });
                    if (!result.ok) failures.push(result.error);
                }
            } catch { failures.push('storage-unavailable'); }
            cleanupStatus = { at: now(), errors: failures }; emit('update'); return { ok: failures.length === 0, errors: failures };
        })().finally(() => { running = null; arm(); });
        return running;
    }
    async function status(id) {
        const own = await session(id); if (!own?.active) return bad('forbidden');
        return { ok: true, profile: own.profile, appointed: await active(id) };
    }
    const calls = {
        async status(id) { return status(id); },
        async messages(id) { const own = await session(id); return own?.active ? { ok: true, messages: (frames.get(own.connection) || []).filter(frame => frame.t === 'line').map(({ id, text }) => ({ id, text })) } : bad('forbidden'); },
        async report(id, args) {
            const own = await session(id); if (!own?.active || typeof args?.id !== 'string' || Object.keys(args).length !== 1) return bad('forbidden');
            const before = acknowledgements.get(own.connection)?.sequence || 0;
            await engineWork.enqueue(() => lobby.message(own.connection, JSON.stringify({ t: 'report', id: args.id })));
            const acknowledgement = acknowledgements.get(own.connection), acknowledged = acknowledgement?.sequence > before && acknowledgement.id === args.id;
            if (!acknowledged) return bad('report-unconfirmed'); emit('update'); arm(); return { ok: true };
        },
        async overview(id) {
            const selection = await storage.transaction(async tx => {
                if (!await authority({ tx, principal: id, at: now() })) return null;
                const ids = await tx.get(SOURCES), reports = [];
                for (const sourceId of ids) { const source = await tx.get(`source:${sourceId}`); if (source?.expiresAt > now()) { const { bytes, ...metadata } = source; reports.push(metadata); } }
                const own = await authority({ tx, principal: id, at: now() });
                return { reports, refs: (await tx.get(CASES)).cases.filter(record => record.access.includes(own.actorRef)).map(record => record.id) };
            });
            if (!selection) return bad('forbidden');
            const cases = [];
            for (const caseRef of selection.refs) { const result = await model.readCase({ principal: id, operationId: opaque('read_case'), caseRef }); if (!result.ok) return result; cases.push(result.case); }
            return { ok: true, reports: selection.reports, cases, maintenance: copy(cleanupStatus), policy: { reason: 'selected_report', authority: policy.authority, reviewAt: policy.reviewAt,
                releaseAvailable: now() < policy.reviewAt && now() <= policy.evidenceDeleteAt,
                holdUntil: policy.holdUntil, evidenceDeleteAt: policy.evidenceDeleteAt, caseDeleteAt: policy.caseDeleteAt } };
        },
        async preserve(id, args) {
            if (args?.reason !== 'selected_report' || args?.type !== 'safety') return bad('policy-unqualified');
            const { reason, ...request } = args; const result = await model.preserveSelectedReport({ principal: id, ...request });
            if (result.ok) { emit('update'); arm(); } return result;
        },
        async evidence(id, args) {
            const result = await model.readEvidence({ principal: id, ...args }); if (!result.ok) return result;
            const text = dec.decode(result.evidence.bytes); result.evidence.bytes.fill(0);
            return { ok: true, text, provenance: result.evidence.provenance };
        },
        async triage(id, args) { return model.transitionReview({ principal: id, ...args, status: 'triaged' }); },
        async closeReview(id, args) { return model.transitionReview({ principal: id, ...args, status: 'closed' }); },
        async release(id, args) { const result = await model.changeHold({ principal: id, ...args, state: 'released' }); if (result.ok) arm(); return result; },
        async cleanup(id, args) { return model.cleanupCase({ principal: id, ...args }); }
    };
    const argumentKeys = { status: [], messages: [], overview: [], report: ['id'],
        preserve: ['operationId', 'sourceId', 'sourceRevision', 'sourceDigest', 'type', 'reason'],
        evidence: ['operationId', 'caseRef', 'expectedRevision'], triage: ['operationId', 'caseRef', 'expectedRevision'],
        closeReview: ['operationId', 'caseRef', 'expectedRevision'], release: ['operationId', 'caseRef', 'expectedRevision'], cleanup: ['operationId', 'caseRef', 'expectedRevision'] };
    const api = {
        async open(profile) {
            if (!['handler', 'unassigned', 'moderator', 'guest'].includes(profile) || stopped) throw Error('Choose an explicit local profile.');
            const id = opaque('session'), connection = opaque('connection'), actorRef = profile === 'handler' ? 'local_handler' : profile === 'unassigned' ? 'local_other_handler' : null;
            await storage.transaction(async tx => {
                const sessions = await tx.get(SESSIONS); if (sessions.length >= 16) throw Error('Local session capacity reached.');
                await tx.put(`session:${id}`, { active: true, profile, actorRef, appointmentRevision: actorRef ? 1 : null, connection });
                await tx.put(SESSIONS, [...sessions, id]);
            });
            await join(connection, `Visitor${id.slice(-6)}`, profile === 'moderator' ? 'moderator' : 'fan');
            const author = opaque('author'); await join(author, `Author${id.slice(-6)}`);
            for (const text of SAMPLES) await engineWork.enqueue(() => lobby.message(author, JSON.stringify({ t: 'say', ch: '#stalemate', text })));
            return id;
        },
        async call(id, method, args = {}) {
            if (!Object.hasOwn(calls, method) || stopped) return bad('forbidden');
            if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length !== argumentKeys[method].length
                || Object.keys(args).some(key => !argumentKeys[method].includes(key))) return bad('invalid-request');
            try { return await calls[method](id, args); } catch { return bad('storage-unavailable'); }
        },
        subscribe(id, fn) { if (!watches.has(id)) watches.set(id, new Set()); watches.get(id).add(fn); return () => watches.get(id)?.delete(fn); },
        async disconnect(id) { await storage.transaction(async tx => { const own = await tx.get(`session:${id}`); if (own) { own.active = false; await tx.put(`session:${id}`, own); } }); emit('disconnect', id); },
        async revoke(actorRef = 'local_handler') {
            await storage.transaction(async tx => { const appointment = await tx.get(`appointment:${actorRef}`); appointment.active = false; appointment.revision += 1; await tx.put(`appointment:${actorRef}`, appointment); });
            for (const [id] of watches) if ((await session(id))?.actorRef === actorRef) emit('disconnect', id);
        },
        async dismiss(sourceId) { await engineWork.enqueue(() => lobby.message('ordinary_moderator', JSON.stringify({ t: 'cmd', name: 'dismiss', args: [sourceId], ch: '#stalemate' }))); emit('update'); arm(); },
        async restart() {
            await storage.transaction(async tx => { for (const name of storage.snapshot().keys()) if (name.startsWith('session:') && name !== `session:${maintenance}`) { const own = await tx.get(name); own.active = false; await tx.put(name, own); } });
            model = makeModel(); emit('disconnect');
        },
        async stop() { stopped = true; if (timer !== null) cancel(timer); emit('disconnect'); watches.clear(); frames.clear(); },
        cleanup, storage, policy: copy(policy), generalStaffState: () => lobby.adminState()
    };
    arm(); return Object.freeze(api);
}
