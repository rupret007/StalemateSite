// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIMITS, createPrivateReportQueue, privateReportRef, validatePrivateReportControl } from '../src/private-reports.mjs';

const NOW = Date.UTC(2026, 9, 19, 12);
const KEY = 'private-report-fixture-key-'.repeat(3);
const ref = value => String(value).padStart(43, 'R');
const request = value => String(value).padStart(24, 'N');
const control = (n = 1, extra = {}) => ({ type: 'private-report', v: 1, request: request(n), kind: 'message',
    target: 'pTarget', claimedName: 'RoomGuest', excerpt: 'A reporter-selected private quote', reason: '', consent: true, ...extra });
const provenance = (n = 1, extra = {}) => ({ reporterRef: ref(n), roomRef: ref('room'), reporterConnection: 'pReporter',
    targetConnection: 'pTarget', targetSessionRef: ref('target'), targetMembership: 'live', ...extra });
function memory() {
    const values = new Map();
    const fixture = { values, fail: null,
        get: vi.fn(async key => {
            if (fixture.fail === 'get') throw new Error('private fixture read detail');
            return structuredClone(values.get(key));
        }),
        put: vi.fn(async (key, value) => {
            if (fixture.fail === 'put-before') throw new Error('private fixture write detail');
            values.set(key, structuredClone(value));
            if (fixture.fail === 'put-after') throw new Error('private fixture lost response detail');
        }) };
    return fixture;
}
function setup() {
    const storage = memory(), clock = { time: NOW };
    const queue = createPrivateReportQueue({ storage, now: () => clock.time });
    return { storage, clock, queue, restart: () => createPrivateReportQueue({ storage, now: () => clock.time }) };
}
const state = storage => storage.values.get('private-reports-v1');
afterEach(() => vi.unstubAllGlobals());

describe('private report control and reference boundary', () => {
    it('produces stable 43-character HMAC references separated by purpose, value and key', async () => {
        const value = 'a-normal-private-session-id';
        const reporter = await privateReportRef('reporter', value, KEY);
        expect(reporter).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(await privateReportRef('reporter', value, KEY)).toBe(reporter);
        expect(new Set(await Promise.all(['reporter', 'room', 'target'].map(kind => privateReportRef(kind, value, KEY)))).size).toBe(3);
        expect(await privateReportRef('reporter', value + '2', KEY)).not.toBe(reporter);
        expect(await privateReportRef('reporter', value, KEY + '2')).not.toBe(reporter);
        expect(reporter).not.toContain(value);
        await expect(privateReportRef('account', value, KEY)).rejects.toThrow('Invalid private report reference');
        await expect(privateReportRef('reporter', value, 'short')).rejects.toThrow('Invalid private report reference');
    });

    it('requires explicit consent, owns normalized fields and preserves the selected quote exactly', () => {
        const raw = control(1, { claimedName: ' Guest ', excerpt: ' Exact quoted spaces ', reason: ' A chosen reason ' });
        const parsed = validatePrivateReportControl(JSON.stringify(raw));
        expect(parsed).toEqual({ ok: true, report: { ...raw, claimedName: 'Guest', reason: 'A chosen reason' } });
        expect(raw.claimedName).toBe(' Guest ');
        for (const consent of [false, undefined, 'true', 1]) expect(validatePrivateReportControl({ ...raw, consent }).ok).toBe(false);
        for (const secretField of ['roomKey', 'invite', 'url', 'cookie', 'sid', 'role', 'context']) {
            expect(validatePrivateReportControl({ ...raw, [secretField]: 'must not be accepted' })).toEqual({ ok: false, error: 'invalid-report', status: 400 });
        }
    });

    it('bounds UTF-8 envelopes, text and IDs without rejecting normal sensitive abuse evidence', () => {
        for (const bad of [control(1, { request: 'bad' }), control(1, { target: 'not-a-relay-peer' }),
            control(1, { excerpt: 'x'.repeat(401) }), control(1, { reason: 'x'.repeat(401) }),
            control(1, { claimedName: 'x'.repeat(25) }), control(1, { excerpt: 'bad\u0000text' }),
            control(1, { kind: 'other' }), { ...control(), v: 2 }]) expect(validatePrivateReportControl(bad).ok).toBe(false);
        expect(validatePrivateReportControl(' '.repeat(LIMITS.controlBytes) + JSON.stringify(control())))
            .toEqual({ ok: false, error: 'report-too-large', status: 400 });
        expect(validatePrivateReportControl(control(1, { excerpt: 'Reported doxxing: victim@example.test, 555-123-4567. A24characterWordIsOrdinary' })).ok).toBe(true);
        expect(validatePrivateReportControl(control(1, { excerpt: '界'.repeat(400), reason: '界'.repeat(400) })).ok).toBe(true);
    });

    it('rejects recognizable invitation and credential material, including percent-encoded variants', () => {
        const sensitive = ['webjam://join?v=3', 'webjam-signal:sealed-reply', '/beta/#invite=private-code',
            '?preview=private-preview', '&preview=private-preview', '#preview=private-preview',
            '#r=' + 'r'.repeat(24) + '&h=host-key', 'Authorization: Bearer fixture-access-token',
            encodeURIComponent('webjam://join?v=3'), encodeURIComponent(encodeURIComponent('/beta/#invite=private-code'))];
        for (const excerpt of sensitive) expect(validatePrivateReportControl(control(1, { excerpt })))
            .toEqual({ ok: false, error: 'unsafe-content', status: 400 });
        expect(validatePrivateReportControl(control(1, { reason: sensitive[0] })).error).toBe('unsafe-content');
        expect(validatePrivateReportControl(control(1, { claimedName: 'webjam://host' })).error).toBe('unsafe-content');
    });

    it('allows a member allegation without a quote, including a claimed departed participant', () => {
        expect(validatePrivateReportControl(control(1, { kind: 'member', excerpt: '', reason: 'Reported conduct', target: null })).ok).toBe(true);
        expect(validatePrivateReportControl(control(1, { kind: 'member', excerpt: '', reason: ' ' })).ok).toBe(false);
        expect(validatePrivateReportControl(control(1, { kind: 'member', reason: '' })).ok).toBe(false);
    });

    it('retains an explicitly consented optional member quote while enforcing consent, size and secret exclusions', async () => {
        const selected = control(1, { kind: 'member', reason: 'Conduct to review', excerpt: ' Exact optional member quote ' });
        const parsed = validatePrivateReportControl(selected);
        expect(parsed).toEqual({ ok: true, report: selected });
        const { queue } = setup();
        expect((await queue.submit(selected, provenance())).ok).toBe(true);
        expect((await queue.snapshot()).reports[0]).toMatchObject({ kind: 'member', excerpt: selected.excerpt, quoteVerified: false });
        expect(validatePrivateReportControl({ ...selected, consent: false }).ok).toBe(false);
        expect(validatePrivateReportControl({ ...selected, excerpt: 'x'.repeat(401) }).ok).toBe(false);
        expect(validatePrivateReportControl({ ...selected, excerpt: 'webjam://join?v=3' }))
            .toEqual({ ok: false, error: 'unsafe-content', status: 400 });
    });

    it('roundtrips multiline evidence and explanations with canonical line endings while refusing other controls and multiline names', async () => {
        const selected = control(1, { kind: 'member', excerpt: 'Quoted line\r\nSecond line\tcontext\rThird line',
            reason: 'First reason\r\nSecond reason\tcontext' });
        const expected = { ...selected, excerpt: 'Quoted line\nSecond line\tcontext\nThird line', reason: 'First reason\nSecond reason\tcontext' };
        expect(validatePrivateReportControl(selected)).toEqual({ ok: true, report: expected });
        const { queue, restart } = setup();
        expect((await queue.submit(selected, provenance())).ok).toBe(true);
        expect((await restart().snapshot()).reports[0]).toMatchObject({ excerpt: expected.excerpt, reason: expected.reason, quoteVerified: false });
        expect((await queue.submit(expected, provenance())).duplicate).toBe(true);
        for (const bad of [{ ...selected, excerpt: 'Bad\u0000quote' }, { ...selected, reason: 'Bad\u0001reason' },
            { ...selected, claimedName: 'Guest\nName' }, { ...selected, claimedName: 'Guest\tName' }]) {
            expect(validatePrivateReportControl(bad)).toEqual({ ok: false, error: 'invalid-report', status: 400 });
        }
        expect(validatePrivateReportControl({ ...selected, excerpt: 'First line\nwebjam://join?v=3' }))
            .toEqual({ ok: false, error: 'unsafe-content', status: 400 });
    });
});

describe('durable consent-only private report queue', () => {
    it('saves only approved evidence and safe provenance, always labels quotes unverified, and hides internal references', async () => {
        const { queue, storage } = setup();
        const result = await queue.submit(control(), provenance());
        expect(result).toMatchObject({ ok: true, duplicate: false, status: 'pending' });
        expect(result.id).toMatch(/^pr[A-Za-z0-9_-]{43}$/);
        expect(storage.put).toHaveBeenCalledTimes(1);
        const snapshot = await queue.snapshot();
        expect(snapshot).toMatchObject({ ok: true, storage: 'ready', reports: [{ id: result.id, quoteVerified: false,
            targetMembership: 'live', excerpt: control().excerpt }] });
        expect(JSON.stringify(snapshot)).not.toContain(provenance().reporterRef);
        expect(JSON.stringify(snapshot)).not.toContain(provenance().targetSessionRef);
        expect(snapshot.reports[0]).not.toHaveProperty('targetSessionRef');
        expect(snapshot.reports[0]).not.toHaveProperty('reporterRef');
        expect(state(storage).receipts).toHaveLength(1);
    });

    it('requires strict server-created HMAC provenance and accepts honest unverified/departed targets', async () => {
        const { queue, storage } = setup();
        for (const invalid of [provenance(1, { reporterRef: 'raw-sid' }), provenance(1, { roomRef: 'raw-room-name' }),
            provenance(1, { targetConnection: 'pSomeoneElse' }), provenance(1, { targetSessionRef: null }),
            provenance(1, { email: 'must-not-be-stored@example.test' })]) {
            expect(await queue.submit(control(), invalid)).toEqual({ ok: false, error: 'invalid-report-provenance', status: 400 });
        }
        expect(storage.put).not.toHaveBeenCalled();
        const selected = control(1, { target: null });
        expect((await queue.submit(selected, provenance(1, { targetConnection: null, targetMembership: 'unverified', targetSessionRef: null }))).ok).toBe(true);
        expect((await queue.snapshot()).reports[0]).toMatchObject({ targetMembership: 'unverified', targetConnection: null, quoteVerified: false });
    });

    it('does not acknowledge or expose a new in-memory report before its required write completes', async () => {
        const { queue, storage } = setup();
        await queue.snapshot();
        let release, started;
        const gate = new Promise(resolve => { release = resolve; });
        const entered = new Promise(resolve => { started = resolve; });
        const nativePut = storage.put;
        storage.put = async (...args) => { started(); await gate; return nativePut(...args); };
        let acknowledged = false;
        const pending = queue.submit(control(), provenance()).then(value => { acknowledged = true; return value; });
        await entered;
        expect(acknowledged).toBe(false);
        expect(queue.status().pending).toBe(0);
        expect(state(storage)).toBeUndefined();
        release();
        expect((await pending).ok).toBe(true);
        expect(queue.status().pending).toBe(1);
    });

    it('serializes simultaneous submissions without losing accepted entries or bypassing the per-session limit', async () => {
        const { queue } = setup();
        const results = await Promise.all(Array.from({ length: 12 }, (_, i) => queue.submit(control(i), provenance())));
        expect(results.filter(result => result.ok)).toHaveLength(LIMITS.perMinute);
        expect(results.filter(result => result.error === 'private-report-rate-limit')).toHaveLength(12 - LIMITS.perMinute);
        expect((await queue.snapshot()).reports).toHaveLength(LIMITS.perMinute);
        expect(queue.status().receipts).toBe(LIMITS.perMinute);
    });

    it('deduplicates concurrent and reconnect/restart retries without charging quota again', async () => {
        const { queue, restart, storage } = setup();
        const results = await Promise.all(Array.from({ length: 5 }, () => queue.submit(control(), provenance())));
        expect(new Set(results.map(result => result.id)).size).toBe(1);
        expect(results.filter(result => result.duplicate)).toHaveLength(4);
        const reconnected = provenance(1, { reporterConnection: 'pReplacement', targetMembership: 'unverified', targetSessionRef: null });
        const retry = await restart().submit(control(), reconnected);
        expect(retry).toEqual({ ...results[0], duplicate: true });
        expect(state(storage).receipts).toHaveLength(1);
        expect(state(storage).reports[0].reporterConnection).toBe('pReporter');
        expect(state(storage).reports[0].targetMembership).toBe('live');
    });

    it('binds a request nonce to its original room and normalized quote, not the replacement connection', async () => {
        const { queue, storage } = setup();
        await queue.submit(control(1, { reason: ' reason ' }), provenance());
        expect((await queue.submit(control(1, { reason: 'reason' }), provenance(1, { reporterConnection: 'pNew' }))).duplicate).toBe(true);
        for (const [report, source] of [[control(1, { reason: 'different reason' }), provenance()],
            [control(1, { reason: 'reason' }), provenance(1, { roomRef: ref('other-room') })]]) {
            expect(await queue.submit(report, source)).toEqual({ ok: false, error: 'private-report-request-conflict', status: 409 });
        }
        expect(state(storage).reports).toHaveLength(1);
    });

    it('returns a fixed storage error without a memory ghost and permits a durably confirmed retry', async () => {
        const { queue, storage } = setup();
        storage.fail = 'put-before';
        expect(await queue.submit(control(), provenance())).toEqual({ ok: false, error: 'private-report-storage-unavailable', status: 503 });
        expect(queue.status()).toMatchObject({ storage: 'unavailable', pending: 0, receipts: 0 });
        expect(state(storage)).toBeUndefined();
        storage.fail = null;
        expect((await queue.snapshot()).reports).toEqual([]);
        expect((await queue.submit(control(), provenance())).ok).toBe(true);
        expect(queue.status()).toMatchObject({ storage: 'ready', pending: 1, receipts: 1 });
    });

    it('reloads a possibly committed failed write before another submission can overwrite it', async () => {
        const { queue, storage, restart } = setup();
        storage.fail = 'put-after';
        expect((await queue.submit(control(1), provenance())).status).toBe(503);
        expect(queue.status().pending).toBe(0);
        expect(state(storage).reports).toHaveLength(1);
        storage.fail = null;
        expect((await queue.submit(control(2), provenance())).ok).toBe(true);
        expect((await restart().snapshot()).reports).toHaveLength(2);
        expect(state(storage).receipts).toHaveLength(2);
    });

    it.each(['resolve', 'dismiss'])('wipes quote text only after a durable %s and retains a restart-safe idempotency tombstone', async action => {
        const { queue, storage, restart } = setup();
        const report = control(1, { reason: 'A unique reason that must be wiped' });
        const saved = await queue.submit(report, provenance());
        storage.fail = 'put-before';
        expect((await queue.resolve(saved.id, action)).status).toBe(503);
        expect(state(storage).reports[0].excerpt).toBe(report.excerpt);
        expect(queue.status().pending).toBe(1);
        storage.fail = null;
        const result = await queue.resolve(saved.id, action);
        expect(result).toMatchObject({ ok: true, status: action === 'resolve' ? 'resolved' : 'dismissed' });
        expect(state(storage).reports).toEqual([]);
        expect(JSON.stringify(state(storage))).not.toContain(report.excerpt);
        expect(JSON.stringify(state(storage))).not.toContain(report.reason);
        const retry = await restart().submit(report, provenance());
        expect(retry).toMatchObject({ ok: true, duplicate: true, status: result.status });
        expect(state(storage).reports).toEqual([]);
        expect(state(storage).receipts).toHaveLength(1);
    });

    it('does not accept delete/punishment actions, and repeated review cannot resurrect plaintext', async () => {
        const { queue, storage } = setup();
        const saved = await queue.submit(control(), provenance());
        for (const action of ['delete', 'ban', 'mute', 'approve', 'camoff']) expect((await queue.resolve(saved.id, action)).status).toBe(400);
        expect((await queue.resolve(saved.id, 'dismiss')).ok).toBe(true);
        expect(await queue.resolve(saved.id, 'resolve')).toMatchObject({ ok: true, duplicate: true, status: 'dismissed' });
        expect(state(storage).reports).toEqual([]);
    });

    it('expires evidence and receipts at 24 hours without creating chat replay or writing during a read', async () => {
        const { queue, clock, storage } = setup();
        await queue.submit(control(), provenance());
        const writes = storage.put.mock.calls.length;
        clock.time += LIMITS.ttlMs;
        expect((await queue.snapshot()).reports).toEqual([]);
        expect(queue.status()).toMatchObject({ pending: 0, receipts: 0 });
        expect(storage.put).toHaveBeenCalledTimes(writes);
        expect(await queue.prune()).toEqual({ ok: true, removed: 2 });
        expect(state(storage)).toEqual({ v: 1, reports: [], receipts: [] });
    });

    it('retains failed-expiry cleanup truthfully until the next confirmed write', async () => {
        const { queue, clock, storage } = setup();
        await queue.submit(control(), provenance()); clock.time += LIMITS.ttlMs;
        storage.fail = 'put-before';
        expect((await queue.prune()).status).toBe(503);
        expect(state(storage).reports).toHaveLength(1);
        storage.fail = null;
        expect((await queue.prune()).ok).toBe(true);
        expect(state(storage).reports).toEqual([]);
    });

    it('retains per-session minute/day budgets through review, restart and UTC rollover', async () => {
        const { queue, clock, restart } = setup();
        let n = 0;
        for (let batch = 0; batch < LIMITS.perSidDay / LIMITS.perMinute; batch += 1) {
            for (let i = 0; i < LIMITS.perMinute; i += 1) {
                const saved = await queue.submit(control(n++), provenance());
                expect(saved.ok).toBe(true); await queue.resolve(saved.id, 'dismiss');
            }
            if (batch === 0) expect(await restart().submit(control(999), provenance())).toMatchObject({ ok: false, error: 'private-report-rate-limit', status: 429, retryAfter: 60 });
            clock.time += 60000;
        }
        expect(await restart().submit(control(999), provenance())).toMatchObject({ ok: false, error: 'private-report-daily-limit', status: 429 });
        clock.time = Date.UTC(2026, 9, 20);
        expect((await restart().submit(control(999), provenance())).ok).toBe(true);
    });

    it('retains the global daily budget even when every report was reviewed and the queue restarted', async () => {
        const { queue, clock, restart, storage } = setup();
        for (let n = 0; n < LIMITS.globalDay; n += 1) {
            const saved = await queue.submit(control(n), provenance(n));
            expect(saved.ok).toBe(true); await queue.resolve(saved.id, 'resolve');
        }
        expect(state(storage).reports).toHaveLength(0);
        expect(await restart().submit(control(999), provenance(999))).toMatchObject({ ok: false, error: 'private-report-daily-limit', status: 429 });
        clock.time = Date.UTC(2026, 9, 20);
        expect((await restart().submit(control(999), provenance(999))).ok).toBe(true);
        expect(state(storage).receipts).toHaveLength(101);
    });

    it('rejects a full queue without evicting evidence and keeps its largest envelopes within 512 KiB', async () => {
        const { queue, clock, storage } = setup();
        for (let n = 0; n < LIMITS.entries; n += 1) expect((await queue.submit(control(n,
            { excerpt: '界'.repeat(400), reason: '界'.repeat(400), claimedName: '界'.repeat(24) }), provenance(n))).ok).toBe(true);
        const original = structuredClone(state(storage));
        expect(new TextEncoder().encode(JSON.stringify(original)).byteLength).toBeLessThan(LIMITS.stateBytes);
        clock.time = Date.UTC(2026, 9, 20); // next daily budget; all 100 cases remain younger than 24h
        expect(await queue.submit(control(999), provenance(999))).toMatchObject({ ok: false, error: 'private-report-capacity', status: 429 });
        expect(state(storage)).toEqual(original);
    });

    it('fails closed on corrupt storage rather than dropping malformed evidence or resetting budgets', async () => {
        const valid = setup(); await valid.queue.submit(control(), provenance());
        const original = structuredClone(state(valid.storage));
        const variants = [null, { v: 1, reports: [], receipts: original.receipts },
            { ...original, reports: [{ ...original.reports[0], excerpt: 'Tampered but superficially valid text' }] },
            { ...original, receipts: [{ ...original.receipts[0], digest: 'not-a-digest' }] },
            { ...original, extra: 'unknown storage field' }, { v: 1, reports: [], receipts: 'x'.repeat(LIMITS.stateBytes) }];
        for (const corrupt of variants) {
            const storage = memory(); storage.values.set('private-reports-v1', corrupt);
            const queue = createPrivateReportQueue({ storage, now: () => NOW });
            expect((await queue.snapshot()).status).toBe(503);
            expect((await queue.submit(control(2), provenance())).status).toBe(503);
            expect(queue.status().storage).toBe('unavailable'); expect(storage.put).not.toHaveBeenCalled();
        }
    });

    it('fails closed on an unreadable initial object without silently initializing an empty queue', async () => {
        const storage = memory(); storage.fail = 'get';
        const queue = createPrivateReportQueue({ storage, now: () => NOW });
        expect((await queue.submit(control(), provenance())).status).toBe(503);
        expect(storage.put).not.toHaveBeenCalled();
    });

    it('owns submitted/staff-view clones, exposes content-free status and never calls a provider', async () => {
        const provider = vi.fn(); vi.stubGlobal('fetch', provider);
        const { queue } = setup();
        const raw = control(), source = provenance();
        const pending = queue.submit(raw, source);
        raw.excerpt = 'Changed after consent'; source.roomRef = ref('changed');
        expect((await pending).ok).toBe(true);
        const first = await queue.snapshot();
        first.reports[0].excerpt = 'Mutated staff view';
        expect((await queue.snapshot()).reports[0].excerpt).toBe(control().excerpt);
        expect(queue.status()).toEqual({ storage: 'ready', pending: 1, receipts: 1, limit: 100 });
        expect(provider).not.toHaveBeenCalled();
    });
});
