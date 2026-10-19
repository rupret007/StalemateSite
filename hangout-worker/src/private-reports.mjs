// Consent-only private-room allegations. This module does not authenticate
// membership, verify a quote, inspect ordinary chat, call AI or impose sanctions.
export const LIMITS = Object.freeze({ controlBytes: 4096, excerptChars: 400, reasonChars: 400, nameChars: 24,
    entries: 100, receipts: 200, ttlMs: 86400000, perMinute: 5, perSidDay: 20, globalDay: 100, stateBytes: 512 * 1024 });
const enc = new TextEncoder();
const nonce = value => typeof value === 'string' && /^[A-Za-z0-9_-]{24}$/.test(value);
const ref = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const peer = value => typeof value === 'string' && /^p[A-Za-z0-9_-]{1,63}$/.test(value);
const id = value => typeof value === 'string' && /^pr[A-Za-z0-9_-]{43}$/.test(value);
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const keys = (value, allowed) => plain(value) && Object.keys(value).length === allowed.length
    && Object.keys(value).every(key => allowed.includes(key));
const text = (value, max, multiline = false) => typeof value === 'string' && value.length <= max
    && !(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(value);
const newlines = value => value.replace(/\r\n?/g, '\n');
const clone = value => JSON.parse(JSON.stringify(value));
const bytes = value => enc.encode(JSON.stringify(value)).byteLength;
const failure = (error, status, retryAfter) => ({ ok: false, error, status, ...(retryAfter ? { retryAfter } : {}) });
const day = value => new Date(value).toISOString().slice(0, 10);
const b64u = value => btoa(String.fromCharCode(...value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const digest = async value => b64u(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(JSON.stringify(value)))));
const controlKeys = ['type', 'v', 'request', 'kind', 'target', 'claimedName', 'excerpt', 'reason', 'consent'];
const provenanceKeys = ['reporterRef', 'roomRef', 'reporterConnection', 'targetConnection', 'targetSessionRef', 'targetMembership'];
const receiptKeys = ['id', 'at', 'reporterRef', 'request', 'digest', 'status'];
const recordKeys = ['id', 'at', 'kind', 'claimedName', 'excerpt', 'reason', 'roomRef',
    'reporterConnection', 'targetConnection', 'targetSessionRef', 'targetMembership'];
function unsafeContent(value) {
    let decoded = value;
    for (let pass = 0; pass < 3; pass += 1) {
        if (/\bwebjam:\/\/|\bwebjam-signal\s*:|(?:\/#|#)invite\s*=|[?#&]preview\s*=|#r=[A-Za-z0-9_-]{24}(?:[&\s]|$)|authorization\s*:\s*bearer\s+\S+/i.test(decoded)) return true;
        try {
            const next = decodeURIComponent(decoded);
            if (next === decoded) break;
            decoded = next;
        } catch { break; }
    }
    return false;
}

export async function privateReportRef(kind, value, key) {
    if (!['reporter', 'room', 'target'].includes(kind) || typeof value !== 'string'
        || !/^[A-Za-z0-9_-]{1,128}$/.test(value) || typeof key !== 'string' || key.length < 32 || key.length > 4096) {
        throw new TypeError('Invalid private report reference');
    }
    const imported = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return b64u(new Uint8Array(await crypto.subtle.sign('HMAC', imported,
        enc.encode(`hangout-private-report:v1:${kind}:${value}`))));
}

export function validatePrivateReportControl(raw) {
    try {
        if (typeof raw === 'string') {
            if (enc.encode(raw).byteLength > LIMITS.controlBytes) return failure('report-too-large', 400);
            raw = JSON.parse(raw);
        }
        if (!keys(raw, controlKeys) || bytes(raw) > LIMITS.controlBytes || raw.type !== 'private-report'
            || raw.v !== 1 || raw.consent !== true || !nonce(raw.request) || !['message', 'member'].includes(raw.kind)
            || raw.target !== null && !peer(raw.target) || !text(raw.claimedName, LIMITS.nameChars)
            || !text(raw.excerpt, LIMITS.excerptChars, true) || !text(raw.reason, LIMITS.reasonChars, true)) return failure('invalid-report', 400);
        const report = { type: 'private-report', v: 1, request: raw.request, kind: raw.kind,
            target: raw.target, claimedName: raw.claimedName.trim(), excerpt: newlines(raw.excerpt),
            reason: newlines(raw.reason).trim(), consent: true };
        if (report.kind === 'message' ? !report.excerpt.trim() : !report.reason) return failure('invalid-report', 400);
        if ([report.claimedName, report.excerpt, report.reason].some(unsafeContent)) return failure('unsafe-content', 400);
        return { ok: true, report };
    } catch { return failure('invalid-report', 400); }
}

function provenance(value, report) {
    if (!keys(value, provenanceKeys) || !ref(value.reporterRef) || !ref(value.roomRef)
        || !peer(value.reporterConnection) || value.targetConnection !== report.target
        || !['live', 'unverified'].includes(value.targetMembership)) return null;
    if (value.targetMembership === 'live'
        ? !peer(value.targetConnection) || !ref(value.targetSessionRef)
        : value.targetSessionRef !== null) return null;
    return clone(value);
}
const reportDigest = (report, roomRef) => digest({ roomRef, report });
const reportId = async (reporterRef, request) => 'pr' + await digest({ reporterRef, request });
const controlFrom = (record, request) => ({ type: 'private-report', v: 1, request, kind: record.kind,
    target: record.targetConnection, claimedName: record.claimedName, excerpt: record.excerpt, reason: record.reason, consent: true });
const alive = (item, now) => now - item.at < LIMITS.ttlMs;
function pruned(state, now) {
    return { v: 1, reports: state.reports.filter(item => alive(item, now)).map(clone),
        receipts: state.receipts.filter(item => alive(item, now)).map(clone) };
}

async function validState(value, now) {
    if (!keys(value, ['v', 'reports', 'receipts']) || value.v !== 1 || bytes(value) > LIMITS.stateBytes
        || !Array.isArray(value.reports) || value.reports.length > LIMITS.entries
        || !Array.isArray(value.receipts) || value.receipts.length > LIMITS.receipts) return false;
    const ids = new Map(), requests = new Set(), perDay = new Map(), perSidDay = new Map(), perSid = new Map();
    for (const r of value.receipts) {
        if (!keys(r, receiptKeys) || !id(r.id) || !ref(r.reporterRef) || !nonce(r.request) || !ref(r.digest)
            || !Number.isSafeInteger(r.at) || r.at < 0 || r.at > now || !['pending', 'resolved', 'dismissed'].includes(r.status)
            || ids.has(r.id) || requests.has(r.reporterRef + ':' + r.request)
            || r.id !== await reportId(r.reporterRef, r.request)) return false;
        ids.set(r.id, r); requests.add(r.reporterRef + ':' + r.request);
        const date = day(r.at), sidDay = r.reporterRef + ':' + date;
        perDay.set(date, (perDay.get(date) || 0) + 1);
        perSidDay.set(sidDay, (perSidDay.get(sidDay) || 0) + 1);
        if (perDay.get(date) > LIMITS.globalDay || perSidDay.get(sidDay) > LIMITS.perSidDay) return false;
        if (!perSid.has(r.reporterRef)) perSid.set(r.reporterRef, []);
        perSid.get(r.reporterRef).push(r.at);
    }
    for (const times of perSid.values()) {
        times.sort((a, b) => a - b);
        for (let i = LIMITS.perMinute; i < times.length; i += 1) if (times[i] - times[i - LIMITS.perMinute] < 60000) return false;
    }
    const records = new Set();
    for (const r of value.reports) {
        const receipt = ids.get(r?.id);
        if (!keys(r, recordKeys) || records.has(r.id) || !receipt || receipt.status !== 'pending' || r.at !== receipt.at) return false;
        const parsed = validatePrivateReportControl(controlFrom(r, receipt.request));
        const proof = { reporterRef: receipt.reporterRef, roomRef: r.roomRef, reporterConnection: r.reporterConnection,
            targetConnection: r.targetConnection, targetSessionRef: r.targetSessionRef, targetMembership: r.targetMembership };
        if (!parsed.ok || !provenance(proof, parsed.report)
            || receipt.digest !== await reportDigest(parsed.report, r.roomRef)) return false;
        records.add(r.id);
    }
    return [...ids.values()].every(r => r.status === 'pending' ? records.has(r.id) : !records.has(r.id));
}

export function createPrivateReportQueue({ storage, now = () => Date.now(), key = 'private-reports-v1' } = {}) {
    if (!storage || typeof storage.get !== 'function' || typeof storage.put !== 'function'
        || typeof now !== 'function' || typeof key !== 'string' || !/^[a-z0-9-]{1,80}$/.test(key)) throw new TypeError('Private report storage is required');
    let state = null, storageState = 'loading', reloadNeeded = false;
    const ready = (async () => {
        try {
            const stored = await storage.get(key), time = now();
            if (!Number.isSafeInteger(time) || time < 0) throw new Error('clock');
            if (stored === undefined) state = { v: 1, reports: [], receipts: [] };
            else {
                if (!await validState(stored, time)) throw new Error('state');
                state = clone(stored);
            }
            storageState = 'ready';
        } catch { storageState = 'unavailable'; }
    })();
    let tail = ready;
    function run(work) {
        const task = tail.then(async () => {
            if (!state) return failure('private-report-storage-unavailable', 503);
            try {
                const time = now();
                if (!Number.isSafeInteger(time) || time < 0) throw new Error('clock');
                if (reloadNeeded) {
                    // A failed put may have committed before its response was
                    // lost. Read the authoritative object before another write
                    // can overwrite that uncertain outcome with stale memory.
                    const stored = await storage.get(key);
                    if (stored === undefined) {
                        if (state.receipts.length) throw new Error('missing state');
                        state = { v: 1, reports: [], receipts: [] };
                    } else {
                        if (!await validState(stored, time)) throw new Error('state');
                        state = clone(stored);
                    }
                    reloadNeeded = false;
                }
                return await work(time);
            } catch { storageState = 'unavailable'; return failure('private-report-storage-unavailable', 503); }
        });
        tail = task.then(() => undefined, () => undefined);
        return task;
    }
    async function commit(next) {
        if (bytes(next) > LIMITS.stateBytes) return failure('private-report-capacity', 429);
        try { await storage.put(key, clone(next)); }
        catch { storageState = 'unavailable'; reloadNeeded = true; return failure('private-report-storage-unavailable', 503); }
        state = next; storageState = 'ready';
        return null;
    }
    function status() {
        const time = now();
        return { storage: storageState, pending: state?.reports.filter(r => alive(r, time)).length || 0,
            receipts: state?.receipts.filter(r => alive(r, time)).length || 0, limit: LIMITS.entries };
    }
    function submit(raw, proof) {
        const parsed = validatePrivateReportControl(raw);
        if (!parsed.ok) return Promise.resolve(parsed);
        let source;
        try { source = provenance(proof, parsed.report); } catch { /* refused below */ }
        if (!source) return Promise.resolve(failure('invalid-report-provenance', 400));
        const report = parsed.report;
        return run(async time => {
            const next = pruned(state, time), hash = await reportDigest(report, source.roomRef);
            const previous = next.receipts.find(r => r.reporterRef === source.reporterRef && r.request === report.request);
            if (previous) {
                if (previous.digest !== hash) return failure('private-report-request-conflict', 409);
                // Recommit on retry: only a completed required write earns an acknowledgement.
                const error = await commit(next);
                return error || { ok: true, id: previous.id, duplicate: true, status: previous.status };
            }
            const minute = next.receipts.filter(r => r.reporterRef === source.reporterRef && time - r.at < 60000);
            if (minute.length >= LIMITS.perMinute) return failure('private-report-rate-limit', 429,
                Math.max(1, Math.ceil((Math.min(...minute.map(r => r.at)) + 60000 - time) / 1000)));
            const daily = next.receipts.filter(r => day(r.at) === day(time));
            if (daily.length >= LIMITS.globalDay || daily.filter(r => r.reporterRef === source.reporterRef).length >= LIMITS.perSidDay) {
                return failure('private-report-daily-limit', 429, Math.max(1, Math.ceil((Date.parse(day(time)) + 86400000 - time) / 1000)));
            }
            if (next.reports.length >= LIMITS.entries || next.receipts.length >= LIMITS.receipts) return failure('private-report-capacity', 429);
            const generated = await reportId(source.reporterRef, report.request);
            next.receipts.push({ id: generated, at: time, reporterRef: source.reporterRef, request: report.request, digest: hash, status: 'pending' });
            next.reports.push({ id: generated, at: time, kind: report.kind, claimedName: report.claimedName,
                excerpt: report.excerpt, reason: report.reason, roomRef: source.roomRef,
                reporterConnection: source.reporterConnection, targetConnection: source.targetConnection,
                targetSessionRef: source.targetSessionRef, targetMembership: source.targetMembership });
            const error = await commit(next);
            return error || { ok: true, id: generated, duplicate: false, status: 'pending' };
        });
    }
    function resolve(reportId, action) {
        if (!id(reportId) || !['resolve', 'dismiss'].includes(action)) return Promise.resolve(failure('invalid-private-report-action', 400));
        return run(async time => {
            const next = pruned(state, time), receipt = next.receipts.find(r => r.id === reportId);
            if (!receipt) return failure('private-report-not-found', 409);
            const duplicate = receipt.status !== 'pending';
            if (!duplicate) {
                receipt.status = action === 'resolve' ? 'resolved' : 'dismissed';
                next.reports = next.reports.filter(r => r.id !== reportId);
            }
            const error = await commit(next);
            return error || { ok: true, id: reportId, duplicate, status: receipt.status };
        });
    }
    function snapshot() {
        return run(time => ({ ok: true, storage: storageState, reports: state.reports.filter(r => alive(r, time)).map(r => {
            const { targetSessionRef: _target, ...safe } = r;
            return { ...clone(safe), quoteVerified: false };
        }) }));
    }
    function prune() {
        return run(async time => {
            const next = pruned(state, time), removed = state.reports.length + state.receipts.length - next.reports.length - next.receipts.length;
            const error = removed ? await commit(next) : null;
            return error || { ok: true, removed };
        });
    }
    return { submit, resolve, snapshot, prune, status };
}
