// Metadata-only lifecycle operations on a supplied storage/transaction handle.
// Callers own the transaction boundary; no network work belongs in this module.
import { validRoomId } from './core.mjs';
import { BETA_TTL } from './beta-session-client.mjs';

export const BETA_SESSION_LIMIT = 1000;
export const BETA_SESSION_ROOM_LIMIT = 16;
export const BETA_RETRY_BATCH = 16;
export const BETA_MINT_PER_IP_HOUR = 20;
const DELETE_BATCH = 128;
const INTERVAL = 60 * 1000;
const MINT_WINDOW = 3600000;
const SID = /^[a-z0-9-]{16,64}$/;
const VERSION = /^[A-Za-z0-9._-]{1,64}$/;

export function validBetaRecord(record, sid) {
    return record?.v === 1 && record.sid === sid && SID.test(sid) && VERSION.test(record.version || '') &&
        Number.isFinite(record.createdAt) && Number.isFinite(record.exp) && record.exp > record.createdAt && record.exp <= record.createdAt + BETA_TTL &&
        typeof record.revoked === 'boolean' && typeof record.pending === 'boolean' && (!record.pending || record.revoked) &&
        Number.isInteger(record.attempt) && record.attempt >= 0 && record.attempt <= 20 && Number.isFinite(record.retryAt) && record.retryAt >= 0 && record.retryAt <= record.exp &&
        Array.isArray(record.rooms) && record.rooms.length <= BETA_SESSION_ROOM_LIMIT && record.rooms.every(validRoomId) && new Set(record.rooms).size === record.rooms.length;
}

export async function readBetaRecords(storage) {
    const rows = await storage.list({ prefix: 'session:', limit: BETA_SESSION_LIMIT + 1 });
    if (rows.size > BETA_SESSION_LIMIT) throw new Error('Beta session registry exceeds its bound.');
    for (const [key, value] of rows) if (!validBetaRecord(value, key.slice(8))) throw new Error('Beta session registry is unreadable.');
    return rows;
}

export async function readBetaMintRates(storage, now = Date.now()) {
    const saved = await storage.get('mint-rates');
    if (saved === undefined) return {};
    if (!saved || typeof saved !== 'object' || Array.isArray(saved) || Object.keys(saved).length > BETA_SESSION_LIMIT) throw new Error('mint budget');
    const active = {};
    for (const [iph, rate] of Object.entries(saved)) {
        if (!/^[A-Za-z0-9_-]{22}$/.test(iph) || !Number.isFinite(rate?.until) || !Number.isInteger(rate.count) || rate.count < 1 || rate.count > BETA_MINT_PER_IP_HOUR) throw new Error('mint budget');
        if (rate.until > now) active[iph] = rate;
    }
    return active;
}

export async function pruneBetaSessions(tx, now = Date.now()) {
    const rows = await readBetaRecords(tx);
    const expired = [...rows].filter(([, record]) => record.exp <= now).map(([key]) => key);
    for (let offset = 0; offset < expired.length; offset += DELETE_BATCH) await tx.delete(expired.slice(offset, offset + DELETE_BATCH));
    for (const key of expired) rows.delete(key);
    const rates = await readBetaMintRates(tx, now);
    if (Object.keys(rates).length) await tx.put('mint-rates', rates); else await tx.delete('mint-rates');
    return rows;
}

export async function scheduleBetaSessions(storage, rows, now = Date.now()) {
    const rates = Object.values(await readBetaMintRates(storage, now));
    if (!rows.size && !rates.length) { await storage.deleteAlarm(); return; }
    const nextExpiry = Math.min(...[...rows.values()].map((record) => record.exp), ...rates.map((rate) => rate.until));
    await storage.setAlarm(Math.min(nextExpiry, now + INTERVAL));
}

// Requires a rollback-capable transaction, including its alarm operations.
// Returning a result does not publish a session: the caller must await commit.
export async function registerBetaSession(tx, body, now = Date.now()) {
    if (!SID.test(body.sid || '') || !VERSION.test(body.version || '') || !Number.isFinite(body.exp)) throw new Error('session request');
    if (body.exp <= now || body.exp > now + BETA_TTL) return { status: 403, reason: 'expired or revoked' };
    const key = `session:${body.sid}`, previous = await tx.get(key);
    if (previous && !validBetaRecord(previous, body.sid)) throw new Error('record');
    if (previous) return { status: 409, reason: 'session already exists' };
    if (!/^[A-Za-z0-9_-]{22}$/.test(body.iph || '')) return { status: 400, reason: 'mint identity' };
    const rows = await pruneBetaSessions(tx, now);
    if (rows.size >= BETA_SESSION_LIMIT) return { status: 429, reason: 'beta session allowance reached' };
    const rates = await readBetaMintRates(tx, now), rate = rates[body.iph] || { until: now + MINT_WINDOW, count: 0 };
    if (rate.count >= BETA_MINT_PER_IP_HOUR || !rates[body.iph] && Object.keys(rates).length >= BETA_SESSION_LIMIT) return { status: 429, reason: 'beta invitation mint allowance reached' };
    rates[body.iph] = { ...rate, count: rate.count + 1 };
    await tx.put('mint-rates', rates);
    const record = { v: 1, sid: body.sid, version: body.version, createdAt: now, exp: body.exp, revoked: false, pending: false, attempt: 0, retryAt: 0, rooms: [] };
    await tx.put(key, record);
    rows.set(key, record);
    await scheduleBetaSessions(tx, rows, now);
    return { status: 200, reason: 'registered' };
}
