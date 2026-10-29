// Metadata-only beta revocation registry. No messages, PMs, ICE, media or plaintext room names.
import { validRoomId } from './core.mjs';
import { BETA_TTL, betaVersion } from './beta-session-client.mjs';
import { INTERNAL_HEALTH_PATH, healthJson } from './beta-ops.mjs';
import { BETA_SESSION_LIMIT, BETA_SESSION_ROOM_LIMIT, BETA_RETRY_BATCH, validBetaRecord as validRecord,
    readBetaRecords, readBetaMintRates, pruneBetaSessions, scheduleBetaSessions, registerBetaSession } from './beta-session-state.mjs';

export { BETA_SESSION_LIMIT, BETA_SESSION_ROOM_LIMIT, BETA_RETRY_BATCH, BETA_MINT_PER_IP_HOUR } from './beta-session-state.mjs';
const INTERVAL = 60 * 1000;
const CLOSE_TIMEOUT = 8000;
const SID = /^[a-z0-9-]{16,64}$/;
const VERSION = /^[A-Za-z0-9._-]{1,64}$/;
const reply = (status, reason) => Response.json({ reason }, { status, headers: { 'Cache-Control': 'no-store' } });
// Every endpoint is reachable only through its Durable Object binding. Neither public gateway forwards it.
export class BetaSessions {
    constructor(state, env) { this.state = state; this.env = env; }
    async records() { return readBetaRecords(this.state.storage); }
    async prune(now = Date.now()) {
        return this.state.storage.transaction(tx => pruneBetaSessions(tx, now));
    }
    async mintRates(now = Date.now()) { return readBetaMintRates(this.state.storage, now); }
    async schedule(rows) {
        return scheduleBetaSessions(this.state.storage, rows);
    }
    async close(record) {
        const identity = JSON.stringify({ betaSid: record.sid });
        const controller = new AbortController();
        const request = () => new Request('https://session/__beta/disconnect', { method: 'POST', headers: { 'X-Hangout-Identity': identity }, signal: controller.signal });
        const targets = [() => this.env.LOBBY.get(this.env.LOBBY.idFromName('stalemate')).fetch(request()),
            ...record.rooms.map((room) => () => this.env.ROOMS.get(this.env.ROOMS.idFromName(room)).fetch(request()))];
        let timer;
        const deadline = new Promise((resolve) => { timer = setTimeout(() => { resolve(false); controller.abort(); }, CLOSE_TIMEOUT); });
        // Consume every late target rejection, but never attach registry writes to this continuation.
        const completed = Promise.allSettled(targets.map((call) => Promise.resolve().then(call)))
            .then((outcomes) => outcomes.every((outcome) => outcome.status === 'fulfilled' && outcome.value.ok));
        let closed;
        try { closed = await Promise.race([deadline, completed]); }
        finally { clearTimeout(timer); }
        if (!closed) return false;
        // No registry lock spans fanout. A timed-out attempt can never reach this outbox confirmation.
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
                // Handled failures must not escape this callback and reset the object.
                try {
                    const now = Date.now();
                    if (body.exp <= now || body.exp > now + BETA_TTL || body.version !== betaVersion(this.env)) return reply(403, 'expired or revoked');
                    if (operation === '/register') {
                        const registered = await this.state.storage.transaction(tx => registerBetaSession(tx, body));
                        return reply(registered.status, registered.reason);
                    }
                    const key = `session:${body.sid}`;
                    let record = await this.state.storage.get(key);
                    if (record && !validRecord(record, body.sid)) throw new Error('record');
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
                } catch { return reply(503, 'beta session registry unavailable'); }
            });
            if (result) return result;
            return await this.close(closing) ? reply(200, 'revoked and closed') : reply(503, 'session revoked; closure retry queued');
        } catch { return reply(503, 'beta session registry unavailable'); }
    }
    async alarm() {
        const rows = await this.state.blockConcurrencyWhile(async () => {
            try { return await this.prune(); }
            catch { await this.state.storage.setAlarm(Date.now() + INTERVAL); return null; }
        });
        if (!rows) return;
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
