// Stalemate hangout relay: a dumb, capped, encrypted-frame broadcaster.
// One Durable Object per invite room. No video, audio, or files ever pass through here.
import { admit, createBucket, dayKey, limitsFrom, validFrame } from './core.mjs';
import { admitTurn, HangoutTurnBudget } from './turn.mjs';
import { adminGate, ownerGate, admitLobby, HangoutLobby } from './lobby-do.mjs';
import { activeBetaSession, registryRequest, validBetaSession } from './beta-session-client.mjs';
import { INTERNAL_HEALTH_PATH, healthJson } from './beta-ops.mjs';

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
            this.state.acceptWebSocket(pair[1], [id]);
            pair[1].serializeAttachment({ v: 1, id, bucket: bucket.snapshot(), ...(beta || {}) });
            this.buckets.set(id, bucket);
            pair[1].send(JSON.stringify({ welcome: true, id, t: Date.now(), peers: sockets.length + 1, max: this.limits.maxPeers }));
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
