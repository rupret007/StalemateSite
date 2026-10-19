// Metadata-only beta revocation registry. No messages, PMs, ICE, media or plaintext room names.
import { validRoomId } from './core.mjs';
import { BETA_TTL, betaVersion } from './beta-session-client.mjs';
import { INTERNAL_HEALTH_PATH, healthJson } from './beta-ops.mjs';

export const BETA_SESSION_LIMIT = 1000;
export const BETA_SESSION_ROOM_LIMIT = 16;
export const BETA_RETRY_BATCH = 16;
export const BETA_MINT_PER_IP_HOUR = 20;
const INTERVAL = 60 * 1000;
const MINT_WINDOW = 3600000;
const SID = /^[a-z0-9-]{16,64}$/;
const VERSION = /^[A-Za-z0-9._-]{1,64}$/;
const reply = (status, reason) => Response.json({ reason }, { status, headers: { 'Cache-Control': 'no-store' } });
function validRecord(record, sid) {
    return record?.v === 1 && record.sid === sid && SID.test(sid) && VERSION.test(record.version || '') &&
        Number.isFinite(record.createdAt) && Number.isFinite(record.exp) && record.exp > record.createdAt && record.exp <= record.createdAt + BETA_TTL &&
        typeof record.revoked === 'boolean' && typeof record.pending === 'boolean' && (!record.pending || record.revoked) &&
        Number.isInteger(record.attempt) && record.attempt >= 0 && record.attempt <= 20 && Number.isFinite(record.retryAt) && record.retryAt >= 0 && record.retryAt <= record.exp &&
        Array.isArray(record.rooms) && record.rooms.length <= BETA_SESSION_ROOM_LIMIT && record.rooms.every(validRoomId) && new Set(record.rooms).size === record.rooms.length;
}

// Every endpoint is reachable only through its Durable Object binding. Neither public gateway forwards it.
export class BetaSessions {
    constructor(state, env) { this.state = state; this.env = env; }
    async records() {
        const rows = await this.state.storage.list({ prefix: 'session:', limit: BETA_SESSION_LIMIT + 1 });
        if (rows.size > BETA_SESSION_LIMIT) throw new Error('Beta session registry exceeds its bound.');
        for (const [key, value] of rows) if (!validRecord(value, key.slice(8))) throw new Error('Beta session registry is unreadable.');
        return rows;
    }
    async prune(now = Date.now()) {
        const rows = await this.records();
        const expired = [...rows].filter(([, record]) => record.exp <= now).map(([key]) => key);
        if (expired.length) await this.state.storage.delete(expired);
        for (const key of expired) rows.delete(key);
        const rates = await this.mintRates(now);
        if (Object.keys(rates).length) await this.state.storage.put('mint-rates', rates); else await this.state.storage.delete('mint-rates');
        return rows;
    }
    async mintRates(now = Date.now()) {
        const saved = await this.state.storage.get('mint-rates');
        if (saved === undefined) return {};
        if (!saved || typeof saved !== 'object' || Array.isArray(saved) || Object.keys(saved).length > BETA_SESSION_LIMIT) throw new Error('mint budget');
        const active = {};
        for (const [iph, rate] of Object.entries(saved)) {
            if (!/^[A-Za-z0-9_-]{22}$/.test(iph) || !Number.isFinite(rate?.until) || !Number.isInteger(rate.count) || rate.count < 1 || rate.count > BETA_MINT_PER_IP_HOUR) throw new Error('mint budget');
            if (rate.until > now) active[iph] = rate;
        }
        return active;
    }
    async schedule(rows) {
        const rates = Object.values(await this.mintRates());
        if (!rows.size && !rates.length) { await this.state.storage.deleteAlarm(); return; }
        const nextExpiry = Math.min(...[...rows.values()].map((record) => record.exp), ...rates.map((rate) => rate.until));
        await this.state.storage.setAlarm(Math.min(nextExpiry, Date.now() + INTERVAL));
    }
    async close(record) {
        const identity = JSON.stringify({ betaSid: record.sid });
        const request = () => new Request('https://session/__beta/disconnect', { method: 'POST', headers: { 'X-Hangout-Identity': identity } });
        const targets = [() => this.env.LOBBY.get(this.env.LOBBY.idFromName('stalemate')).fetch(request()),
            ...record.rooms.map((room) => () => this.env.ROOMS.get(this.env.ROOMS.idFromName(room)).fetch(request()))];
        const outcomes = await Promise.allSettled(targets.map((call) => Promise.resolve().then(call)));
        if (outcomes.some((outcome) => outcome.status === 'rejected' || !outcome.value.ok)) return false;
        // No registry lock spans the network fanout: target DOs may check revocation while waking.
        await this.state.blockConcurrencyWhile(async () => {
            const current = await this.state.storage.get(`session:${record.sid}`);
            if (current && validRecord(current, record.sid) && current.revoked) await this.state.storage.put(`session:${record.sid}`, { ...current, pending: false });
        });
        return true;
    }
    async fetch(request) {
        if (new URL(request.url).pathname === INTERNAL_HEALTH_PATH) {
            if (this.env.HANGOUT_BETA_MODE !== 'protected' || request.method !== 'GET') return new Response('not found', { status: 404 });
            return this.state.blockConcurrencyWhile(async () => {
                try {
                    const rows = await this.records(); await this.mintRates();
                    return healthJson({ storage: 'ok', quota: { used: [...rows.values()].filter((record) => record.exp > Date.now()).length, limit: BETA_SESSION_LIMIT } });
                } catch { return healthJson({ storage: 'unavailable' }, 503); }
            });
        }
        if (this.env.HANGOUT_BETA_MODE !== 'protected' || request.method !== 'POST') return reply(404, 'not found');
        let body;
        try {
            const text = await request.text();
            if (text.length > 2048) return reply(413, 'request too large');
            body = JSON.parse(text);
        } catch { return reply(400, 'request'); }
        if (!body || typeof body !== 'object' || !SID.test(body.sid || '') || !VERSION.test(body.version || '') || !Number.isFinite(body.exp)) return reply(400, 'request');
        const operation = new URL(request.url).pathname;
        let closing;
        try {
            const result = await this.state.blockConcurrencyWhile(async () => {
                const now = Date.now();
                if (body.exp <= now || body.exp > now + BETA_TTL || body.version !== betaVersion(this.env)) return reply(403, 'expired or revoked');
                const key = `session:${body.sid}`;
                let record = await this.state.storage.get(key);
                if (record && !validRecord(record, body.sid)) throw new Error('record');
                if (operation === '/register') {
                    if (record) return reply(409, 'session already exists');
                    if (!/^[A-Za-z0-9_-]{22}$/.test(body.iph || '')) return reply(400, 'mint identity');
                    const rows = await this.prune(now);
                    if (rows.size >= BETA_SESSION_LIMIT) return reply(429, 'beta session allowance reached');
                    const rates = await this.mintRates(now), rate = rates[body.iph] || { until: now + MINT_WINDOW, count: 0 };
                    if (rate.count >= BETA_MINT_PER_IP_HOUR || !rates[body.iph] && Object.keys(rates).length >= BETA_SESSION_LIMIT) return reply(429, 'beta invitation mint allowance reached');
                    rates[body.iph] = { ...rate, count: rate.count + 1 }; await this.state.storage.put('mint-rates', rates);
                    record = { v: 1, sid: body.sid, version: body.version, createdAt: now, exp: body.exp, revoked: false, pending: false, attempt: 0, retryAt: 0, rooms: [] };
                    await this.state.storage.put(key, record); rows.set(key, record); await this.schedule(rows);
                    return reply(200, 'registered');
                }
                if (!record || record.exp <= now || record.version !== body.version || body.exp > record.exp) return reply(403, 'expired or revoked');
                if (operation === '/check') return reply(!record.revoked || body.allowRevoked === true ? 200 : 403, record.revoked ? 'revoked' : 'active');
                if (operation === '/room') {
                    if (record.revoked) return reply(403, 'revoked');
                    if (!validRoomId(body.room)) return reply(400, 'room');
                    if (!record.rooms.includes(body.room)) {
                        if (record.rooms.length >= BETA_SESSION_ROOM_LIMIT) return reply(429, 'private room allowance reached');
                        record = { ...record, rooms: [...record.rooms, body.room] }; await this.state.storage.put(key, record);
                    }
                    return reply(200, 'registered');
                }
                if (operation === '/revoke') {
                    const attempt = Math.min(20, record.attempt + 1);
                    record = { ...record, revoked: true, pending: true, attempt, retryAt: Math.min(record.exp, now + Math.min(3600000, INTERVAL * 2 ** (attempt - 1))) };
                    await this.state.storage.put(key, record);
                    await this.state.storage.setAlarm(Math.min(record.exp, now + INTERVAL));
                    closing = record;
                    return null;
                }
                return reply(404, 'not found');
            });
            if (result) return result;
            return await this.close(closing) ? reply(200, 'revoked and closed') : reply(503, 'session revoked; closure retry queued');
        } catch { return reply(503, 'beta session registry unavailable'); }
    }
    async alarm() {
        let rows;
        try { rows = await this.state.blockConcurrencyWhile(() => this.prune()); }
        catch { await this.state.storage.setAlarm(Date.now() + INTERVAL); return; }
        // Bound each alarm and back off unavailable targets; never multiply WS frames into regular RPCs.
        const due = [...rows.values()].filter((record) => record.revoked && record.pending && record.retryAt <= Date.now())
            .sort((a, b) => a.retryAt - b.retryAt || a.sid.localeCompare(b.sid)).slice(0, BETA_RETRY_BATCH);
        for (const record of due) {
            const next = await this.state.blockConcurrencyWhile(async () => {
                const current = await this.state.storage.get(`session:${record.sid}`);
                if (!current || !current.pending || current.retryAt > Date.now()) return null;
                const attempt = Math.min(20, current.attempt + 1);
                const changed = { ...current, attempt, retryAt: Math.min(current.exp, Date.now() + Math.min(3600000, INTERVAL * 2 ** (attempt - 1))) };
                await this.state.storage.put(`session:${record.sid}`, changed); return changed;
            });
            if (next) await this.close(next).catch(() => false);
        }
        await this.state.blockConcurrencyWhile(async () => { await this.schedule(await this.prune()); });
    }
}
