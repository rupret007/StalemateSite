// Stalemate hangout relay: a dumb, capped, encrypted-frame broadcaster.
// One Durable Object per invite room. No video, audio, or files ever pass through here.
import { admit, bucketStateFromAttachment, createBucket, dayKey, limitsFrom, previewKeyFromProtocols, takeConnectionQuota, validFrame } from './core.mjs';

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname !== '/room') return new Response('nope', { status: 404 });
        if (request.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });
        const previewKey = previewKeyFromProtocols(request.headers.get('Sec-WebSocket-Protocol'));
        const denied = await admit({ url, origin: request.headers.get('Origin'), env, extraOrigins: env.HANGOUT_EXTRA_ORIGINS, previewKey });
        if (denied) return new Response(denied.reason, { status: denied.status });
        const stub = env.ROOMS.get(env.ROOMS.idFromName(url.searchParams.get('room')));
        return stub.fetch(request);
    }
};

export class HangoutQuota {
    constructor(state, env) { this.state = state; this.limits = limitsFrom(env); }
    async fetch() {
        const key = `c:${dayKey(Date.now())}`;
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
        this.seq = 0;
    }

    async fetch(request) {
        const sockets = this.state.getWebSockets();
        if (sockets.length >= this.limits.maxPeers) return new Response('room full', { status: 429 });
        const quota = await takeConnectionQuota(this.env);
        if (quota !== 200) return new Response('room server is resting', { status: quota === 429 ? 429 : 503 });
        const pair = new WebSocketPair();
        const id = `p${Date.now().toString(36)}${(this.seq += 1)}`;
        this.state.acceptWebSocket(pair[1], [id]);
        pair[1].send(JSON.stringify({ welcome: true, id, t: Date.now(), peers: sockets.length + 1, max: this.limits.maxPeers }));
        this.broadcast({ peers: sockets.length + 1, t: Date.now() }, pair[1]);
        const offered = previewKeyFromProtocols(request?.headers?.get('Sec-WebSocket-Protocol'));
        const headers = offered ? { 'Sec-WebSocket-Protocol': offered } : undefined;
        return new Response(null, { status: 101, webSocket: pair[0], headers });
    }

    tagOf(ws) { return this.state.getTags(ws)[0]; }

    bucket(ws) {
        const tag = this.tagOf(ws);
        if (!this.buckets.has(tag)) {
            const initial = typeof ws.deserializeAttachment === 'function'
                ? bucketStateFromAttachment(ws.deserializeAttachment())
                : null;
            this.buckets.set(tag, createBucket(this.limits, undefined, initial));
        }
        return this.buckets.get(tag);
    }

    persistBucket(ws) {
        const tag = this.tagOf(ws);
        const bucket = this.buckets.get(tag);
        if (bucket && typeof ws.serializeAttachment === 'function') {
            ws.serializeAttachment(bucket.snapshot());
        }
    }

    broadcast(payload, except) {
        const text = JSON.stringify(payload);
        for (const ws of this.state.getWebSockets()) {
            if (ws !== except) {
                try { ws.send(text); } catch (error) { /* closed */ }
            }
        }
    }

    async webSocketMessage(ws, raw) {
        const verdict = this.bucket(ws).take();
        this.persistBucket(ws);
        if (verdict === 'spent') { ws.close(4429, 'message cap'); return; }
        if (verdict === 'slow') { ws.send(JSON.stringify({ slow: true })); return; }
        const frame = validFrame(raw, this.limits);
        if (!frame) { ws.close(4400, 'bad frame'); return; }
        this.broadcast({ t: Date.now(), from: this.tagOf(ws), iv: frame.iv, c: frame.c }, ws);
    }

    async webSocketClose(ws) {
        this.buckets.delete(this.tagOf(ws));
        const left = this.state.getWebSockets().filter((s) => s !== ws).length;
        this.broadcast({ peers: left, left: this.tagOf(ws), t: Date.now() }, ws);
    }

    async webSocketError(ws) { return this.webSocketClose(ws); }
}
