// Stalemate hangout relay: a dumb, capped, encrypted-frame broadcaster.
// One Durable Object per invite room. No video, audio, or files ever pass through here.
import { admit, createBucket, dayKey, limitsFrom, validFrame } from './core.mjs';

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
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
        this.limits = limitsFrom(env);
        this.buckets = new Map();
        this.seq = 0;
    }

    async fetch() {
        const sockets = this.state.getWebSockets();
        if (sockets.length >= this.limits.maxPeers) return new Response('room full', { status: 429 });
        const pair = new WebSocketPair();
        const id = `p${Date.now().toString(36)}${(this.seq += 1)}`;
        this.state.acceptWebSocket(pair[1], [id]);
        pair[1].send(JSON.stringify({ welcome: true, id, t: Date.now(), peers: sockets.length + 1, max: this.limits.maxPeers }));
        this.broadcast({ peers: sockets.length + 1, t: Date.now() }, pair[1]);
        return new Response(null, { status: 101, webSocket: pair[0] });
    }

    tagOf(ws) { return this.state.getTags(ws)[0]; }

    bucket(ws) {
        const tag = this.tagOf(ws);
        if (!this.buckets.has(tag)) this.buckets.set(tag, createBucket(this.limits));
        return this.buckets.get(tag);
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
        if (verdict === 'spent') { ws.close(4429, 'message cap'); return; }
        if (verdict === 'slow') { ws.send(JSON.stringify({ slow: true })); return; }
        const frame = validFrame(raw, this.limits);
        if (!frame) { ws.close(4400, 'bad frame'); return; }
        this.broadcast({ t: Date.now(), from: this.tagOf(ws), iv: frame.iv, c: frame.c }, ws);
    }

    async webSocketClose(ws) {
        this.buckets.delete(this.tagOf(ws));
        const left = this.state.getWebSockets().filter((s) => s !== ws).length;
        this.broadcast({ peers: left, t: Date.now() }, ws);
    }

    async webSocketError(ws) { return this.webSocketClose(ws); }
}
