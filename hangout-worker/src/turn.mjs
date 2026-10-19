// Credentials never enter storage/logs. One global DO serializes reservations across rooms.
import { originAllowed, previewKeyOk, validRoomId } from './core.mjs';
import { hmacKeyOk, verifyDevice } from './auth.mjs';

export const TURN_TTL = 600;
const WINDOW = 10 * 60 * 1000;
const GB = 1e9;
const RESERVE_BYTES = 0.1 * GB; // admission estimate, NOT a provider-enforced egress cap
const MAX_PENDING = 32; // bound in-memory waiters while provider requests are outstanding
const reply = (status, reason, extra = {}) => Response.json({ iceServers: [], reason, ...extra }, { status });

export async function admitTurn(request, env) {
    const origin = request.headers.get('Origin');
    const headers = { 'Cache-Control': 'no-store', Vary: 'Origin' };
    const finish = (res) => {
        const h = new Headers(res.headers);
        for (const [k, v] of Object.entries(headers)) h.set(k, v);
        return new Response(res.body, { status: res.status, headers: h });
    };
    if (!originAllowed(origin, env.HANGOUT_EXTRA_ORIGINS)) return finish(reply(403, 'origin'));
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    if (request.method === 'OPTIONS') return finish(new Response(null, { status: 204 }));
    if (request.method !== 'POST') return finish(reply(405, 'POST required'));
    if (env.HANGOUT_TURN_ENABLED !== '1') return finish(reply(503, 'TURN disabled'));
    if (!env.TURN_BUDGET || !hmacKeyOk(env.HANGOUT_HMAC_KEY) || !previewKeyOk(env.HANGOUT_PREVIEW_KEY, env.HANGOUT_PREVIEW_KEY)) return finish(reply(503, 'not-configured'));
    try {
        // Bound the body even when Content-Length is absent or dishonest.
        const reader = request.body?.getReader();
        if (!reader) return finish(reply(400, 'request'));
        let text = ''; let size = 0;
        const decoder = new TextDecoder();
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 4096) { await reader.cancel(); return finish(reply(413, 'request too large')); }
            text += decoder.decode(value, { stream: true });
        }
        let body;
        try { body = JSON.parse(text + decoder.decode()); }
        catch { return finish(reply(400, 'request')); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return finish(reply(400, 'request'));
        if (!previewKeyOk(body.preview, env.HANGOUT_PREVIEW_KEY)) return finish(reply(403, 'preview'));
        if (!validRoomId(body.room)) return finish(reply(400, 'room'));
        const device = await verifyDevice(body.device, env.HANGOUT_HMAC_KEY);
        if (!device) return finish(reply(403, 'device'));
        const stub = env.TURN_BUDGET.get(env.TURN_BUDGET.idFromName('global'));
        return finish(await stub.fetch('https://turn/issue', { method: 'POST', body: JSON.stringify({ room: body.room, device }) }));
    } catch { return finish(reply(503, 'TURN unavailable')); }
}

async function monthlyUsage(env, now, fetchImpl) {
    // No key filter: includes other apps using TURN in this account, including webjam-relay.
    const date = new Date(now).toISOString().slice(0, 10);
    const query = `query HangoutUsage($account: String!, $from: Date!, $to: Date!) {
        viewer { accounts(filter: {accountTag: $account}) {
            callsTurnUsageAdaptiveGroups(limit: 1, filter: {date_geq: $from, date_leq: $to}) {
                sum { egressBytes }
            }
        } }
    }`;
    const res = await fetchImpl('https://api.cloudflare.com/client/v4/graphql', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
        headers: { Authorization: `Bearer ${env.HANGOUT_TURN_ANALYTICS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables: { account: env.HANGOUT_CF_ACCOUNT_ID, from: `${date.slice(0, 7)}-01`, to: date } })
    });
    if (!res.ok) throw new Error('analytics');
    const data = await res.json();
    const accounts = data.data?.viewer?.accounts;
    if (data.errors?.length || !Array.isArray(accounts) || accounts.length !== 1) throw new Error('analytics');
    const rows = accounts[0].callsTurnUsageAdaptiveGroups;
    if (!Array.isArray(rows) || rows.length > 1) throw new Error('analytics');
    const bytes = rows.length ? rows[0]?.sum?.egressBytes : 0;
    if (!Number.isFinite(bytes) || bytes < 0) throw new Error('analytics');
    return bytes;
}

export class HangoutTurnBudget {
    constructor(state, env) { this.state = state; this.env = env; this.queue = Promise.resolve(); this.usage = null; this.pending = 0; }
    fetch(request) {
        if (this.pending >= MAX_PENDING) return Promise.resolve(reply(429, 'rate limited', { retryAfter: 600 }));
        this.pending += 1;
        // Explicit serialization also spans external analytics/credential fetch awaits.
        const result = this.queue.then(() => this.issue(request)).finally(() => { this.pending -= 1; });
        this.queue = result.catch(() => {});
        return result.catch(() => reply(503, 'TURN unavailable'));
    }
    async issue(request) {
        const env = this.env;
        const budget = Number(env.HANGOUT_TURN_MONTHLY_GB);
        if (env.HANGOUT_TURN_ENABLED !== '1' || !env.HANGOUT_TURN_KEY_ID || !env.HANGOUT_TURN_API_TOKEN ||
            !env.HANGOUT_TURN_ANALYTICS_TOKEN || !/^[a-f0-9]{32}$/.test(env.HANGOUT_CF_ACCOUNT_ID || '') ||
            !Number.isFinite(budget) || budget <= 0 || budget > 800) return reply(503, 'not-configured');
        const { room, device } = await request.json();
        if (!validRoomId(room) || !/^[A-Za-z0-9_-]{22}$/.test(device || '')) return reply(400, 'request');
        const now = Date.now();
        const month = new Date(now).toISOString().slice(0, 7);
        const store = this.state.storage;
        const saved = await store.get('ledger');
        let ledger = saved || { month, reserved: 0, observed: 0, rates: {} };
        if (!Number.isFinite(ledger.reserved) || ledger.reserved < 0 || !Number.isFinite(ledger.observed) || ledger.observed < 0 || !ledger.rates || typeof ledger.rates !== 'object' || Array.isArray(ledger.rates) || !/^\d{4}-\d{2}$/.test(ledger.month)) throw new Error('ledger');
        if (ledger.month > month) throw new Error('clock');
        if (ledger.month !== month) ledger = { month, reserved: 0, observed: 0, rates: {} };
        for (const [key, value] of Object.entries(ledger.rates)) {
            if (!value || typeof value !== 'object' || !Number.isFinite(value.until) || !Number.isInteger(value.count) || value.count < 0) throw new Error('ledger');
            if (value.until <= now) delete ledger.rates[key];
        }
        const limits = [[`r:${room}`, 16], [`d:${device}`, 2], ['global', 60]];
        if (limits.some(([key, cap]) => (ledger.rates[key]?.count || 0) >= cap)) return reply(429, 'rate limited', { retryAfter: 600 });
        for (const [key] of limits) {
            const rate = ledger.rates[key] || { until: now + WINDOW, count: 0 };
            rate.count += 1; ledger.rates[key] = rate;
        }
        await store.put('ledger', ledger); // failures/retries spend rate allowance too
        if (!this.usage || this.usage.month !== month || now - this.usage.at >= 60000) {
            const bytes = await monthlyUsage(env, now, fetch);
            this.usage = { month, at: now, bytes };
        }
        ledger.observed = Math.max(ledger.observed, this.usage.bytes);
        // Intentionally double-count reservations already reflected by analytics: conservative headroom.
        if (ledger.observed + ledger.reserved + RESERVE_BYTES > budget * GB) {
            await store.put('ledger', ledger);
            return reply(429, 'budget used');
        }
        // Never refund: ambiguous upstream errors may still have minted usable credentials.
        ledger.reserved += RESERVE_BYTES;
        await store.put('ledger', ledger);
        const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.HANGOUT_TURN_KEY_ID)}/credentials/generate-ice-servers`, {
            method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
            headers: { Authorization: `Bearer ${env.HANGOUT_TURN_API_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ ttl: TURN_TTL })
        });
        if (!res.ok) return reply(503, 'TURN unavailable');
        const data = await res.json();
        if (!Array.isArray(data.iceServers) || !data.iceServers.length) return reply(503, 'TURN unavailable');
        const iceServers = data.iceServers.map((server) => {
            const urls = typeof server.urls === 'string' ? [server.urls] : server.urls;
            if (!Array.isArray(urls) || !urls.length || urls.some((url) => typeof url !== 'string' || !/^(stun|turn|turns):/.test(url))) throw new Error('ice');
            if (urls.some((url) => /^turns?:/.test(url)) && (typeof server.username !== 'string' || !server.username || typeof server.credential !== 'string' || !server.credential)) throw new Error('ice');
            return { urls, ...(server.username ? { username: server.username, credential: server.credential } : {}) };
        });
        return Response.json({ iceServers, ttl: TURN_TTL, expiresAt: now + TURN_TTL * 1000 });
    }
}
