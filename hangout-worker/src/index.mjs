// Stalemate hangout relay: capped, opaque room frames and separate consented
// report controls sent only to the staff queue. Ordinary chat stays encrypted.
// One Durable Object per invite room. No video, audio, or files ever pass through here.
import { admit, createBucket, dayKey, limitsFrom, validFrame, validRoomId } from './core.mjs';
import { admitTurn, HangoutTurnBudget } from './turn.mjs';
import { adminGate, ownerGate, admitLobby, HangoutLobby } from './lobby-do.mjs';
import { activeBetaSession, registryRequest, validBetaSession } from './beta-session-client.mjs';
import { INTERNAL_HEALTH_PATH, healthJson } from './beta-ops.mjs';
import { hmacKeyOk } from './auth.mjs';
import { privateReportRef, validatePrivateReportControl } from './private-reports.mjs';

export { HangoutLobby, HangoutTurnBudget };

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname === '/turn') return admitTurn(request, env, url);
        if (url.pathname === '/lobby-owner/login' || url.pathname === '/lobby-admin/login') {
            const owner = url.pathname === '/lobby-owner/login';
            const result = await (owner ? ownerGate : adminGate)(request, env);
            if (!result.ok) return new Response(result.reason, { status: result.status, headers: { 'Cache-Control': 'no-store' } });
            const back = String(owner ? env.HANGOUT_OWNER_RETURN || '' : env.HANGOUT_ADMIN_RETURN || '');
            const target = /^https:\/\/(www\.)?stalemate\.band\/r\/[0-9a-f]{16}\/(admin|lobby)\/$/.exec(back);
            if (!target || target[2] !== (owner ? 'lobby' : 'admin')) return new Response('not configured', { status: 503 });
            return new Response(null, { status: 302, headers: { Location: owner ? `${back}?owner=1` : back, 'Cache-Control': 'no-store' } });
        }
        if (url.pathname === '/lobby' || url.pathname === '/lobby-admin' || url.pathname === '/lobby-owner') return admitLobby(request, env, url);
        if (url.pathname !== '/room') return new Response('nope', { status: 404 });
        if (request.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });
        const denied = admit({ url, origin: request.headers.get('Origin'), env, extraOrigins: env.HANGOUT_EXTRA_ORIGINS });
        if (denied) return new Response(denied.reason, { status: denied.status });
        let quota;
        try {
            const res = await env.QUOTA.get(env.QUOTA.idFromName('global')).fetch('https://quota/take', { method: 'POST' });
            quota = res.status;
        } catch (error) {
            quota = 503; // accounting unreadable: fail closed
        }
        if (quota !== 200) return new Response('room server is resting', { status: quota === 429 ? 429 : 503 });
        if (env.HANGOUT_BETA_MODE === 'protected') {
            let beta;
            try { beta = JSON.parse(request.headers.get('X-Hangout-Beta-Session')); } catch { /* refused below */ }
            if (!validBetaSession(beta, env)) return new Response('beta session required', { status: 403 });
            let registered;
            try { registered = await registryRequest(env, 'room', { sid: beta.betaSid, exp: beta.expiresAt, version: beta.betaInviteVersion, room: url.searchParams.get('room') }); }
            catch { return new Response('beta session service unavailable', { status: 503 }); }
            if (registered.status !== 200) return new Response('private room allowance unavailable', { status: registered.status });
        }
        const stub = env.ROOMS.get(env.ROOMS.idFromName(url.searchParams.get('room')));
        return stub.fetch(request);
    }
};

export class HangoutQuota {
    constructor(state, env) { this.state = state; this.env = env; this.limits = limitsFrom(env); }
    async fetch(request) {
        const key = `c:${dayKey(Date.now())}`;
        if (request && new URL(request.url).pathname === INTERNAL_HEALTH_PATH) {
            if (this.env.HANGOUT_BETA_MODE !== 'protected' || request.method !== 'GET') return new Response('not found', { status: 404 });
            try {
                const stored = await this.state.storage.get(key), used = stored === undefined ? 0 : stored;
                if (!Number.isSafeInteger(used) || used < 0) throw new Error('quota');
                return healthJson({ storage: 'ok', quota: { day: dayKey(Date.now()), used, limit: this.limits.connectionsPerDay } });
            } catch { return healthJson({ storage: 'unavailable' }, 503); }
        }
        const used = (await this.state.storage.get(key)) || 0;
        if (used >= this.limits.connectionsPerDay) return new Response('cap', { status: 429 });
        await this.state.storage.put(key, used + 1);
        return new Response('ok');
    }
}

export class HangoutRoom {
    constructor(state, env) {
        this.state = state;
        this.env = env;
        this.limits = limitsFrom(env);
        this.buckets = new Map();
        this.ready = state.blockConcurrencyWhile(async () => {
            const checks = new Map();
            for (const ws of this.state.getWebSockets()) {
                const a = this.attachment(ws);
                if (!this.validAttachment(a)) { this.end(ws, 4401, 'room session unavailable'); continue; }
                if (env.HANGOUT_BETA_MODE === 'protected') {
                    if (!checks.has(a.betaSid)) checks.set(a.betaSid, activeBetaSession(env, a));
                    if (!await checks.get(a.betaSid)) { this.end(ws, 4401, 'beta session ended'); continue; }
                }
                try { this.buckets.set(a.id, createBucket(this.limits, () => Date.now(), a.bucket)); }
                catch { this.end(ws, 4401, 'room limits unavailable'); }
            }
            await this.schedule();
        });
    }

    async fetch(request) {
        await this.ready;
        return this.state.blockConcurrencyWhile(async () => {
            const path = new URL(request.url).pathname;
            if (this.env.HANGOUT_BETA_MODE === 'protected' && path === '/__beta/disconnect' && request.method === 'POST') {
                let identity;
                try { identity = JSON.parse(request.headers.get('X-Hangout-Identity')); } catch { return new Response('request', { status: 400 }); }
                if (!/^[a-z0-9-]{16,64}$/.test(identity?.betaSid || '')) return new Response('request', { status: 400 });
                for (const ws of this.state.getWebSockets()) if (this.attachment(ws).betaSid === identity.betaSid) this.end(ws, 4401, 'beta session ended');
                await this.schedule();
                return new Response('closed');
            }
            let beta;
            if (this.env.HANGOUT_BETA_MODE === 'protected') {
                try { beta = JSON.parse(request.headers.get('X-Hangout-Beta-Session')); } catch { /* refused below */ }
                if (!validBetaSession(beta, this.env) || !await activeBetaSession(this.env, beta)) return new Response('beta session required', { status: 403 });
            }
            for (const ws of this.liveSockets()) if (!this.validAttachment(this.attachment(ws))) this.end(ws, 4401, 'room session ended');
            const sockets = this.liveSockets();
            if (this.state.getWebSockets().filter((ws) => ws.readyState === undefined || ws.readyState === 1).length >= this.limits.maxPeers) return new Response('room full', { status: 429 });
            const pair = new WebSocketPair();
            const id = `p${crypto.randomUUID().replace(/-/g, '')}`;
            const bucket = createBucket(this.limits);
            const roomId = new URL(request.url).searchParams.get('room');
            this.state.acceptWebSocket(pair[1], [id]);
            pair[1].serializeAttachment({ v: 1, id, bucket: bucket.snapshot(), ...(beta || {}),
                ...(beta && validRoomId(roomId) ? { roomId } : {}) });
            this.buckets.set(id, bucket);
            pair[1].send(JSON.stringify({ welcome: true, id, t: Date.now(), peers: sockets.length + 1, max: this.limits.maxPeers,
                ...(this.privateReportsConfigured() && validRoomId(roomId) ? { privateReports: true } : {}) }));
            this.broadcast({ peers: sockets.length + 1, t: Date.now() }, pair[1]);
            await this.schedule();
            return new Response(null, { status: 101, webSocket: pair[0] });
        });
    }

    attachment(ws) { try { return ws.deserializeAttachment() || {}; } catch { return {}; } }
    validAttachment(a) {
        return a?.v === 1 && typeof a.id === 'string' && a.id.length <= 64 && !a.ended && a.bucket &&
            (this.env.HANGOUT_BETA_MODE !== 'protected' || validBetaSession(a, this.env));
    }
    liveSockets() {
        const live = [];
        for (const ws of this.state.getWebSockets()) {
            if (ws.readyState !== undefined && ws.readyState !== 1) continue;
            const a = this.attachment(ws);
            if (!this.validAttachment(a)) {
                ws.serializeAttachment({ ...a, ended: true }); this.buckets.delete(this.tagOf(ws));
                ws.close(4401, 'room session ended'); continue;
            }
            live.push(ws);
        }
        return live;
    }
    tagOf(ws) { return this.state.getTags(ws)[0]; }

    bucket(ws) {
        const tag = this.tagOf(ws);
        if (!this.buckets.has(tag)) this.buckets.set(tag, createBucket(this.limits, () => Date.now(), this.attachment(ws).bucket));
        return this.buckets.get(tag);
    }

    broadcast(payload, except) {
        const text = JSON.stringify(payload);
        for (const ws of this.liveSockets()) {
            if (ws !== except) {
                try { ws.send(text); } catch (error) { /* closed */ }
            }
        }
    }

    privateReportsConfigured() {
        return this.env.HANGOUT_BETA_MODE === 'protected' && typeof this.env.LOBBY?.get === 'function'
            && typeof this.env.LOBBY?.idFromName === 'function' && hmacKeyOk(this.env.HANGOUT_HMAC_KEY)
            && this.env.HANGOUT_HMAC_KEY.length <= 4096;
    }
    sameReportSocket(ws, original) {
        const current = this.attachment(ws);
        return (ws.readyState === undefined || ws.readyState === 1) && this.state.getWebSockets().includes(ws)
            && this.validAttachment(current) && this.tagOf(ws) === original.id
            && ['id', 'betaSid', 'betaInviteVersion', 'expiresAt', 'roomId'].every(key => current[key] === original[key]);
    }
    reportReply(ws, original, request, result) {
        if (!this.sameReportSocket(ws, original)) return;
        try { ws.send(JSON.stringify({ privateReport: { request, ...result } })); } catch { /* closed */ }
    }
    async privateReport(ws, original, raw, request) {
        const unavailable = { ok: false, error: 'unavailable', status: 503 };
        const unconfirmed = { ok: false, error: 'unconfirmed', status: 503 };
        if (!this.privateReportsConfigured() || !validRoomId(original.roomId)) {
            this.reportReply(ws, original, request, unavailable); return;
        }
        const parsed = validatePrivateReportControl(raw);
        if (!parsed.ok) { this.reportReply(ws, original, request, { ok: false, error: 'invalid-report', status: 400 }); return; }
        const report = parsed.report;
        const secrets = ['HANGOUT_BETA_INVITE_KEY', 'HANGOUT_PREVIEW_KEY', 'HANGOUT_HMAC_KEY']
            .map(key => this.env[key]).filter(value => typeof value === 'string' && value.length >= 16);
        if (Object.values(report).some(value => typeof value === 'string' && secrets.some(secret => value.includes(secret)))) {
            this.reportReply(ws, original, request, { ok: false, error: 'invalid-report', status: 400 }); return;
        }
        let timer;
        const controller = new AbortController();
        const current = () => !controller.signal.aborted && this.sameReportSocket(ws, original);
        const work = (async () => {
            if (!current()) return null;
            const active = await activeBetaSession(this.env, original);
            if (!current()) return null;
            if (!active) { this.end(ws, 4401, 'beta session ended'); return null; }
            const [reporterRef, roomRef] = await Promise.all([
                privateReportRef('reporter', original.betaSid, this.env.HANGOUT_HMAC_KEY),
                privateReportRef('room', original.roomId, this.env.HANGOUT_HMAC_KEY)
            ]);
            if (!current()) return null;
            const target = report.target && this.liveSockets().find(peer => {
                const a = this.attachment(peer);
                return a.id === report.target && a.roomId === original.roomId;
            });
            const targetIdentity = target ? this.attachment(target) : null;
            let targetSessionRef = targetIdentity
                ? await privateReportRef('target', targetIdentity.betaSid, this.env.HANGOUT_HMAC_KEY) : null;
            if (!current()) return null;
            const targetLive = Boolean(target && this.sameReportSocket(target, targetIdentity));
            if (!targetLive) targetSessionRef = null;
            const provenance = { reporterRef, roomRef, reporterConnection: original.id,
                targetConnection: report.target, targetSessionRef, targetMembership: targetLive ? 'live' : 'unverified' };
            const response = await this.env.LOBBY.get(this.env.LOBBY.idFromName('stalemate')).fetch(new Request('https://lobby/__beta/private-report', {
                method: 'POST', signal: controller.signal, redirect: 'manual',
                headers: { 'Content-Type': 'application/json', 'X-Hangout-Private-Room': original.roomId,
                    'X-Hangout-Beta-Session': JSON.stringify({ betaSid: original.betaSid,
                        betaInviteVersion: original.betaInviteVersion, expiresAt: original.expiresAt }) },
                body: JSON.stringify({ report, provenance })
            }));
            if (!current()) return null;
            const result = await this.privateReportResult(response);
            if (!current()) return null;
            const stillActive = await activeBetaSession(this.env, original);
            if (!current()) return null;
            if (!stillActive) { this.end(ws, 4401, 'beta session ended'); return null; }
            return result;
        })().catch(() => unconfirmed);
        const deadline = new Promise(resolve => {
            timer = setTimeout(() => { controller.abort(); resolve(unconfirmed); }, 8000);
        });
        try {
            const result = await Promise.race([work, deadline]);
            if (result) this.reportReply(ws, original, report.request, result);
        } finally { clearTimeout(timer); }
    }
    async privateReportResult(response) {
        const fallback = { ok: false, error: 'unconfirmed', status: 503 };
        const errors = new Map([[400, 'invalid-report'], [409, 'conflict'], [429, 'rate-limit'], [503, 'unavailable']]);
        try {
            const text = await response.text();
            if (new TextEncoder().encode(text).byteLength > 4096) return fallback;
            const result = JSON.parse(text);
            if (response.status === 200 && result?.ok === true && /^pr[A-Za-z0-9_-]{43}$/.test(result.id)
                && ['pending', 'resolved', 'dismissed'].includes(result.status) && typeof result.duplicate === 'boolean') {
                return { ok: true, id: result.id, duplicate: result.duplicate, status: result.status };
            }
            if (result?.ok === false && errors.has(response.status) && result.status === response.status) {
                return { ok: false, error: errors.get(response.status), status: response.status,
                    ...(Number.isSafeInteger(result.retryAfter) && result.retryAfter > 0 && result.retryAfter <= 86400 ? { retryAfter: result.retryAfter } : {}) };
            }
            return fallback;
        } catch { return fallback; }
    }

    async webSocketMessage(ws, raw) {
        await this.ready;
        const a = this.attachment(ws);
        if (!this.validAttachment(a)) { this.end(ws, 4401, 'room session ended'); return; }
        let bucket;
        try { bucket = this.bucket(ws); } catch { this.end(ws, 4401, 'room limits unavailable'); return; }
        const verdict = bucket.take();
        // WebSocket attachments survive hibernation; no ciphertext is persisted.
        ws.serializeAttachment({ ...a, bucket: bucket.snapshot() });
        if (verdict === 'spent') { this.end(ws, 4429, 'message cap'); return; }
        if (verdict === 'slow') { ws.send(JSON.stringify({ slow: true })); return; }
        let control;
        if (typeof raw === 'string' && raw.length <= this.limits.maxFrameBytes) {
            try { control = JSON.parse(raw); } catch { /* ordinary frame validation below */ }
        }
        if (control?.type === 'private-report') {
            const request = typeof control.request === 'string' && /^[A-Za-z0-9_-]{24}$/.test(control.request) ? control.request : null;
            await this.privateReport(ws, this.attachment(ws), raw, request);
            return;
        }
        const frame = validFrame(raw, this.limits);
        if (!frame) { this.end(ws, 4400, 'bad frame'); return; }
        this.broadcast({ t: Date.now(), from: this.tagOf(ws), iv: frame.iv, c: frame.c }, ws);
    }

    end(ws, code, reason) {
        const a = this.attachment(ws);
        ws.serializeAttachment({ ...a, ended: true });
        this.buckets.delete(this.tagOf(ws));
        if (ws.readyState === undefined || ws.readyState === 1) ws.close(code, reason);
        if (!a.ended) this.broadcast({ peers: this.liveSockets().length, left: this.tagOf(ws), t: Date.now() }, ws);
    }
    async schedule() {
        if (this.env.HANGOUT_BETA_MODE !== 'protected') return;
        const live = this.liveSockets();
        if (!live.length) { await this.state.storage.deleteAlarm(); return; }
        const next = Math.min(...live.map((ws) => this.attachment(ws).expiresAt || Date.now()));
        await this.state.storage.setAlarm(Math.min(next, Date.now() + 60000));
    }
    async alarm() {
        await this.ready;
        return this.state.blockConcurrencyWhile(async () => {
            const checks = new Map();
            for (const ws of this.liveSockets()) {
                const a = this.attachment(ws);
                if (!this.validAttachment(a)) { this.end(ws, 4401, 'room session ended'); continue; }
                if (this.env.HANGOUT_BETA_MODE === 'protected') {
                    if (!checks.has(a.betaSid)) checks.set(a.betaSid, activeBetaSession(this.env, a));
                    if (!await checks.get(a.betaSid)) this.end(ws, 4401, 'beta session ended');
                }
            }
            await this.schedule();
        });
    }
    async webSocketClose(ws) {
        await this.ready;
        const a = this.attachment(ws);
        this.buckets.delete(this.tagOf(ws));
        if (!a.ended) {
            ws.serializeAttachment({ ...a, ended: true });
            this.broadcast({ peers: this.liveSockets().length, left: this.tagOf(ws), t: Date.now() }, ws);
        }
        await this.schedule();
    }

    async webSocketError(ws) { return this.webSocketClose(ws); }
}
