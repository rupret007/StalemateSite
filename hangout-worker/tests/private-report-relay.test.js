// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HangoutRoom } from '../src/index.mjs';
import { createPrivateReportQueue, privateReportRef } from '../src/private-reports.mjs';

const ROOM = 'a'.repeat(64), OTHER_ROOM = 'b'.repeat(64);
const FRAME = JSON.stringify({ iv: 'A'.repeat(16), c: 'ordinary_ciphertext_only' });
const report = (extra = {}) => ({ type: 'private-report', v: 1, request: 'R'.repeat(24), kind: 'message',
    target: null, claimedName: 'Claimed nick', excerpt: 'Synthetic quotation chosen by the reporter', reason: 'Synthetic report', consent: true, ...extra });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
class Socket {
    readyState = 1; frames = [];
    send(raw) { if (this.readyState !== 1) throw Error('closed'); this.frames.push(JSON.parse(raw)); }
    close(code, reason) { this.readyState = 3; this.closed = { code, reason }; }
    serializeAttachment(value) { this.saved = structuredClone(value); }
    deserializeAttachment() { return structuredClone(this.saved); }
}
function state() {
    const values = new Map(), sockets = new Map();
    const storage = { get: vi.fn(async key => structuredClone(values.get(key))),
        put: vi.fn(async (key, value) => { values.set(key, structuredClone(value)); }),
        deleteAlarm: vi.fn(async () => {}), setAlarm: vi.fn(async () => {}) };
    return { values, sockets, storage, blockConcurrencyWhile: fn => fn(),
        getWebSockets: () => [...sockets.keys()].filter(ws => ws.readyState === 1),
        getTags: ws => sockets.get(ws) || [], acceptWebSocket: (ws, tags) => sockets.set(ws, tags) };
}
function runtime() {
    vi.stubGlobal('WebSocketPair', class { constructor() { this[0] = new Socket(); this[1] = new Socket(); } });
    const NativeResponse = globalThis.Response;
    vi.stubGlobal('Response', class extends NativeResponse {
        constructor(body, init) {
            super(body, init?.status === 101 ? { status: 200 } : init);
            if (init?.status === 101) Object.defineProperty(this, 'status', { value: 101 });
            this.webSocket = init?.webSocket;
        }
    });
}
function harness(extra = {}) {
    const roomState = state(), queueState = state(), sessions = new Map();
    const env = { HANGOUT_BETA_MODE: 'protected', HANGOUT_BETA_INVITE_VERSION: '1',
        HANGOUT_HMAC_KEY: 'fixture-private-report-hmac-key-'.repeat(2),
        HANGOUT_BETA_INVITE_KEY: 'fixture-private-report-invitation-'.repeat(2),
        HANGOUT_PREVIEW_KEY: 'fixture-private-report-preview-'.repeat(2), ...extra };
    const check = vi.fn(async request => {
        const body = await request.json(), entry = sessions.get(body.sid);
        return new Response('fixture registry result', { status: entry && !entry.revoked
            && entry.expiresAt >= body.exp && entry.expiresAt > Date.now() && entry.betaInviteVersion === body.version ? 200 : 403 });
    });
    env.BETA_SESSIONS = { idFromName: name => name, get: () => ({ fetch: check }) };
    const queue = createPrivateReportQueue({ storage: queueState.storage });
    const forward = async request => {
        const body = await request.json(), result = await queue.submit(body.report, body.provenance);
        return new Response(JSON.stringify(result), { status: result.ok ? 200 : result.status });
    };
    const lobbyFetch = vi.fn(request => forward(request.clone()));
    if (!Object.hasOwn(extra, 'LOBBY')) env.LOBBY = { idFromName: name => name, get: () => ({ fetch: lobbyFetch }) };
    let room = new HangoutRoom(roomState, env), next = 0;
    return { env, roomState, queueState, sessions, check, queue, forward, lobbyFetch,
        get room() { return room; },
        async wake() { room = new HangoutRoom(roomState, env); await room.ready; return room; },
        async join({ roomId = ROOM, missingRoom = false, extraHeaders = {} } = {}) {
            const identity = { betaSid: `fixture-beta-session-${++next}-123456`, betaInviteVersion: '1', expiresAt: Date.now() + 3600000 };
            sessions.set(identity.betaSid, identity);
            const response = await room.fetch(new Request('https://internal/room' + (missingRoom ? '' : '?room=' + roomId), {
                headers: { 'X-Hangout-Beta-Session': JSON.stringify(identity), ...extraHeaders }
            }));
            expect(response.status).toBe(101);
            const socket = [...roomState.sockets.keys()].at(-1);
            return { socket, identity };
        },
        async send(socket, control = report()) { await room.webSocketMessage(socket, typeof control === 'string' ? control : JSON.stringify(control)); },
        revoke(identity) { sessions.set(identity.betaSid, { ...identity, revoked: true }); }
    };
}
const replies = ws => ws.frames.filter(frame => frame.privateReport).map(frame => frame.privateReport);
const lastReply = ws => replies(ws).at(-1);
const submitted = async h => JSON.parse(await h.lobbyFetch.mock.calls.at(-1)[0].clone().text());

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-19T11:00:00Z')); runtime(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('consented private-room report relay', () => {
    it('advertises configured protected rooms and binds their original validated room ID', async () => {
        const h = harness();
        const { socket } = await h.join({ extraHeaders: { 'X-Hangout-Private-Room': OTHER_ROOM } });
        expect(socket.frames[0]).toMatchObject({ welcome: true, privateReports: true });
        expect(socket.deserializeAttachment().roomId).toBe(ROOM);
        expect(h.lobbyFetch).not.toHaveBeenCalled();
    });

    it('does not advertise or forward reports without protected report configuration', async () => {
        for (const config of [{ LOBBY: null }, { LOBBY: {} }, { HANGOUT_HMAC_KEY: 'short' }, { HANGOUT_BETA_MODE: 'unprotected' }]) {
            const h = harness(config), { socket } = await h.join();
            expect(socket.frames[0]).not.toHaveProperty('privateReports');
            await h.send(socket);
            expect(lastReply(socket)).toEqual({ request: 'R'.repeat(24), ok: false, error: 'unavailable', status: 503 });
            expect(h.lobbyFetch).not.toHaveBeenCalled();
            expect(socket.readyState).toBe(1);
        }
    });

    it('keeps legacy attachments without room IDs valid for ordinary ciphertext but report-unavailable', async () => {
        const h = harness(), { socket } = await h.join({ missingRoom: true }), peer = await h.join();
        expect(socket.frames[0]).not.toHaveProperty('privateReports');
        await h.wake(); peer.socket.frames = [];
        await h.send(socket, FRAME);
        expect(peer.socket.frames).toEqual([expect.objectContaining({ from: socket.deserializeAttachment().id, c: 'ordinary_ciphertext_only' })]);
        await h.send(socket);
        expect(lastReply(socket)).toMatchObject({ ok: false, error: 'unavailable', status: 503 });
        expect(socket.readyState).toBe(1);
        expect(h.lobbyFetch).not.toHaveBeenCalled();
    });

    it('forwards only explicit consent, uses server provenance, and never broadcasts the allegation', async () => {
        const h = harness(), a = await h.join(), b = await h.join();
        a.socket.frames = []; b.socket.frames = [];
        const control = report({ target: b.socket.deserializeAttachment().id });
        await h.send(a.socket, control);
        const request = h.lobbyFetch.mock.calls[0][0], body = await submitted(h);
        expect(new URL(request.url).pathname).toBe('/__beta/private-report');
        expect(request.method).toBe('POST');
        expect(request.headers.get('Content-Type')).toBe('application/json');
        expect(request.headers.get('X-Hangout-Private-Room')).toBe(ROOM);
        expect(JSON.parse(request.headers.get('X-Hangout-Beta-Session'))).toEqual(a.identity);
        expect(body.report).toEqual(control);
        expect(body.provenance).toEqual({
            reporterRef: await privateReportRef('reporter', a.identity.betaSid, h.env.HANGOUT_HMAC_KEY),
            roomRef: await privateReportRef('room', ROOM, h.env.HANGOUT_HMAC_KEY),
            reporterConnection: a.socket.deserializeAttachment().id, targetConnection: b.socket.deserializeAttachment().id,
            targetSessionRef: await privateReportRef('target', b.identity.betaSid, h.env.HANGOUT_HMAC_KEY), targetMembership: 'live'
        });
        expect(lastReply(a.socket)).toMatchObject({ request: control.request, ok: true, status: 'pending', duplicate: false });
        expect(lastReply(a.socket).id).toMatch(/^pr[A-Za-z0-9_-]{43}$/);
        expect(b.socket.frames).toEqual([]);
        const saved = JSON.stringify([...h.queueState.values]);
        for (const secret of [a.identity.betaSid, b.identity.betaSid, ROOM, h.env.HANGOUT_HMAC_KEY, 'betaInviteVersion', 'expiresAt', 'ordinary_ciphertext_only']) {
            expect(saved).not.toContain(secret);
        }
        expect(h.roomState.values.size).toBe(0);
    });

    it('accepts a member report with a reason and leaves unknown target membership unverified', async () => {
        const h = harness(), { socket } = await h.join();
        await h.send(socket, report({ kind: 'member', target: 'pdeparted123', excerpt: '', reason: 'Synthetic conduct report' }));
        const body = await submitted(h);
        expect(body.provenance).toMatchObject({ targetConnection: 'pdeparted123', targetMembership: 'unverified', targetSessionRef: null });
        expect(lastReply(socket).ok).toBe(true);
    });

    it('rejects spoofed provenance, non-consent, missing evidence and oversized UTF-8 controls locally', async () => {
        const h = harness(), { socket } = await h.join();
        const bad = [report({ provenance: { reporterRef: 'forged' } }), report({ betaSid: 'forged-beta-session' }),
            report({ consent: false }), report({ excerpt: ' ' }), report({ kind: 'member', excerpt: '', reason: '' }),
            report({ reason: 'x'.repeat(401) }), JSON.stringify(report()) + ' '.repeat(4096),
            JSON.stringify(report({ excerpt: '😀'.repeat(200), reason: '界'.repeat(400), claimedName: '界'.repeat(24) })) + ' '.repeat(2200)];
        for (const control of bad) {
            await h.send(socket, control);
            expect(lastReply(socket)).toMatchObject({ ok: false, error: 'invalid-report', status: 400 });
        }
        expect(h.lobbyFetch).not.toHaveBeenCalled();
        expect(h.queueState.values.size).toBe(0);
        expect(socket.readyState).toBe(1);
    });

    it('rejects exact configured invitation, preview and HMAC values before any RPC or storage', async () => {
        const h = harness(), { socket } = await h.join();
        h.check.mockClear();
        for (const key of ['HANGOUT_BETA_INVITE_KEY', 'HANGOUT_PREVIEW_KEY', 'HANGOUT_HMAC_KEY']) {
            await h.send(socket, report({ excerpt: 'Accidental paste: ' + h.env[key] }));
            expect(lastReply(socket)).toMatchObject({ ok: false, error: 'invalid-report', status: 400 });
            expect(JSON.stringify(socket.frames)).not.toContain(h.env[key]);
        }
        expect(h.check).not.toHaveBeenCalled(); expect(h.lobbyFetch).not.toHaveBeenCalled();
    });

    it('keeps ordinary encrypted frames out of the report RPC and storage path', async () => {
        const h = harness(), a = await h.join(), b = await h.join();
        h.check.mockClear(); b.socket.frames = [];
        await h.send(a.socket, FRAME);
        expect(b.socket.frames).toEqual([expect.objectContaining({ c: 'ordinary_ciphertext_only' })]);
        expect(h.check).not.toHaveBeenCalled(); expect(h.lobbyFetch).not.toHaveBeenCalled();
        expect(h.queueState.values.size).toBe(0);
        await h.send(a.socket, JSON.stringify({ type: 'chat', text: 'Unrecognized plaintext is still a bad frame' }));
        expect(a.socket.closed.code).toBe(4400);
        expect(h.lobbyFetch).not.toHaveBeenCalled();
    });

    it('spends the existing connection bucket before handling any report control', async () => {
        for (const mode of ['slow', 'spent']) {
            const h = harness(), { socket } = await h.join();
            const a = socket.deserializeAttachment();
            socket.serializeAttachment({ ...a, bucket: { ...a.bucket, tokens: mode === 'slow' ? 0 : a.bucket.tokens,
                total: mode === 'spent' ? h.room.limits.messagesPerConnection : 0 } });
            await h.wake(); h.check.mockClear(); socket.frames = [];
            await h.send(socket);
            if (mode === 'slow') expect(socket.frames).toEqual([{ slow: true }]);
            else expect(socket.closed.code).toBe(4429);
            expect(replies(socket)).toEqual([]);
            expect(h.check).not.toHaveBeenCalled(); expect(h.lobbyFetch).not.toHaveBeenCalled();
        }
    });

    it('rejects expired and version-changed reporters locally before a fresh registry request', async () => {
        for (const mode of ['expired', 'version']) {
            const h = harness(), { socket, identity } = await h.join();
            if (mode === 'expired') vi.setSystemTime(identity.expiresAt + 1);
            else h.env.HANGOUT_BETA_INVITE_VERSION = '2';
            h.check.mockClear(); await h.send(socket);
            expect(socket.closed.code).toBe(4401);
            expect(h.check).not.toHaveBeenCalled(); expect(h.lobbyFetch).not.toHaveBeenCalled();
            expect(replies(socket)).toEqual([]);
        }
    });

    it('rechecks revocation and fails closed when the registry is unavailable', async () => {
        for (const mode of ['revoked', 'unavailable']) {
            const h = harness(), a = await h.join();
            if (mode === 'revoked') h.revoke(a.identity); else h.check.mockRejectedValue(Error('fixture secret must not escape'));
            await h.send(a.socket);
            expect(a.socket.closed.code).toBe(4401);
            expect(h.lobbyFetch).not.toHaveBeenCalled(); expect(replies(a.socket)).toEqual([]);
        }
    });

    it('fences a reporter that closes or changes attachment during the fresh session check', async () => {
        for (const mode of ['close', 'replace']) {
            const h = harness(), { socket } = await h.join(), reached = deferred(), release = deferred();
            h.check.mockImplementationOnce(async () => { reached.resolve(); await release.promise; return new Response('active'); });
            const pending = h.send(socket); await reached.promise;
            if (mode === 'close') socket.close(1000, 'fixture close');
            else socket.serializeAttachment({ ...socket.deserializeAttachment(), id: 'preplacement' });
            release.resolve(); await pending;
            expect(h.lobbyFetch).not.toHaveBeenCalled(); expect(replies(socket)).toEqual([]);
        }
    });

    it('does not claim live provenance for departed, expired or cross-room targets', async () => {
        for (const mode of ['departed', 'expired', 'other-room']) {
            const h = harness(), a = await h.join(), b = await h.join(), reached = deferred(), release = deferred();
            h.check.mockImplementationOnce(async () => { reached.resolve(); await release.promise; return new Response('active'); });
            const target = b.socket.deserializeAttachment().id;
            const pending = h.send(a.socket, report({ target })); await reached.promise;
            if (mode === 'departed') b.socket.close(1000, 'fixture departure');
            else b.socket.serializeAttachment({ ...b.socket.deserializeAttachment(),
                ...(mode === 'expired' ? { expiresAt: Date.now() - 1 } : { roomId: OTHER_ROOM }) });
            release.resolve(); await pending;
            expect((await submitted(h)).provenance).toMatchObject({ targetConnection: target, targetMembership: 'unverified', targetSessionRef: null });
            expect(lastReply(a.socket).ok).toBe(true);
        }
    });

    it('acknowledges only after the required queue write and returns a fixed storage failure', async () => {
        const h = harness(), { socket } = await h.join(), reached = deferred(), release = deferred();
        const put = h.queueState.storage.put.getMockImplementation();
        h.queueState.storage.put.mockImplementationOnce(async (...args) => { reached.resolve(); await release.promise; return put(...args); });
        const pending = h.send(socket); await reached.promise;
        expect(replies(socket)).toEqual([]); expect(h.queueState.values.size).toBe(0);
        release.resolve(); await pending;
        expect(lastReply(socket)).toMatchObject({ ok: true, duplicate: false, status: 'pending' });
        h.queueState.storage.put.mockRejectedValueOnce(Error('sensitive storage error'));
        await h.send(socket, report({ request: 'S'.repeat(24) }));
        expect(lastReply(socket)).toEqual({ request: 'S'.repeat(24), ok: false, error: 'unavailable', status: 503 });
        expect(JSON.stringify(socket.frames)).not.toContain('sensitive');
    });

    it('preserves idempotent receipts and normalizes request conflicts and report limits', async () => {
        const h = harness(), { socket } = await h.join();
        await h.send(socket); const first = lastReply(socket);
        await h.send(socket);
        expect(lastReply(socket)).toEqual({ ...first, duplicate: true });
        await h.send(socket, report({ reason: 'Different content with the same request' }));
        expect(lastReply(socket)).toEqual({ request: 'R'.repeat(24), ok: false, error: 'conflict', status: 409 });
        for (const request of ['S', 'T', 'U', 'V', 'W']) await h.send(socket, report({ request: request.repeat(24) }));
        expect(lastReply(socket)).toMatchObject({ ok: false, error: 'rate-limit', status: 429, retryAfter: 60 });
        expect((await h.queue.snapshot()).reports).toHaveLength(5);
    });

    it('sends no acknowledgement after close, replacement, expiry or revocation during the Lobby RPC', async () => {
        for (const mode of ['close', 'replace', 'expired', 'revoked']) {
            const h = harness(), a = await h.join(), reached = deferred(), release = deferred();
            h.lobbyFetch.mockImplementationOnce(async request => {
                const response = await h.forward(request); reached.resolve(); await release.promise; return response;
            });
            const pending = h.send(a.socket); await reached.promise;
            if (mode === 'close') a.socket.close(1000, 'fixture close');
            else if (mode === 'replace') a.socket.serializeAttachment({ ...a.socket.deserializeAttachment(), id: 'preplacement' });
            else if (mode === 'expired') vi.setSystemTime(a.identity.expiresAt + 1);
            else h.revoke(a.identity);
            release.resolve(); await pending;
            expect(replies(a.socket)).toEqual([]);
            if (mode === 'revoked') expect(a.socket.closed.code).toBe(4401);
        }
    });

    it('returns an unconfirmed timeout and safely retries a write that was already accepted', async () => {
        const h = harness(), { socket } = await h.join(), reached = deferred(), release = deferred();
        h.lobbyFetch.mockImplementationOnce(async request => {
            const response = await h.forward(request); reached.resolve(); await release.promise; return response;
        });
        const pending = h.send(socket); await reached.promise;
        expect((await h.queue.snapshot()).reports).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(8000); await pending;
        expect(lastReply(socket)).toEqual({ request: 'R'.repeat(24), ok: false, error: 'unconfirmed', status: 503 });
        expect(h.lobbyFetch.mock.calls[0][0].signal.aborted).toBe(true);
        const count = replies(socket).length;
        release.resolve(); await Promise.resolve(); await Promise.resolve();
        expect(replies(socket)).toHaveLength(count);
        await h.send(socket);
        expect(lastReply(socket)).toMatchObject({ ok: true, duplicate: true, status: 'pending' });
        expect(replies(socket)).toHaveLength(count + 1);
        expect((await h.queue.snapshot()).reports).toHaveLength(1);
    });

    it('never treats malformed success, arbitrary exceptions or arbitrary error text as a durable acknowledgement', async () => {
        const h = harness(), { socket } = await h.join();
        for (const value of [{ ok: true, id: 'not-a-private-report', duplicate: false, status: 'pending' },
            { ok: true, id: 'pr' + 'A'.repeat(43), duplicate: false, status: 'unknown' },
            { ok: false, error: 'arbitrary sensitive server text', status: 500 }]) {
            h.lobbyFetch.mockResolvedValueOnce(new Response(JSON.stringify(value), { status: value.ok ? 200 : 500 }));
            await h.send(socket);
            expect(lastReply(socket)).toMatchObject({ ok: false, error: 'unconfirmed', status: 503 });
        }
        h.lobbyFetch.mockRejectedValueOnce(Error('arbitrary sensitive exception'));
        await h.send(socket);
        expect(lastReply(socket)).toMatchObject({ ok: false, error: 'unconfirmed', status: 503 });
        expect(JSON.stringify(socket.frames)).not.toContain('sensitive');
    });
});
