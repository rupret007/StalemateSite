// I3a source metadata only. Text remains in the authoritative ordinary report
// queue until a separately authorized I1 transaction copies one selection.
import { incidentEvidenceDigest } from './incident-cases.mjs';

export const LOBBY_INCIDENT_SOURCE_MODE = 'i3a-v1';
export const LOBBY_INCIDENT_SOURCE_KEY = 'lobby-incident-sources:v1';
const DAY = 86400000, enc = new TextEncoder();
const exact = (value, keys) => value && [Object.prototype, null].includes(Object.getPrototypeOf(value))
    && Reflect.ownKeys(value).length === keys.length && keys.every(key => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
    });
const integer = value => Number.isSafeInteger(value) && value >= 0;
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const id = value => typeof value === 'string' && /^m[a-z0-9]{1,80}$/i.test(value);
const fail = () => { throw Error('incident-source-unavailable'); };
const ensure = value => { if (!value) fail(); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function lobbyIncidentSourceMode(env = {}) {
    if (!Object.hasOwn(env, 'HANGOUT_INCIDENT_SOURCE_BRIDGE')) return '';
    if (env.HANGOUT_INCIDENT_SOURCE_BRIDGE !== LOBBY_INCIDENT_SOURCE_MODE
        || env.HANGOUT_BETA_MODE !== 'protected' || env.HANGOUT_SESSION_AUTHORITY !== 'lobby-v1') fail();
    return LOBBY_INCIDENT_SOURCE_MODE;
}
export function incidentSourceConfigurationValid(env) {
    try { lobbyIncidentSourceMode(env); return true; } catch { return false; }
}
// Implies public visibility at ORIGINAL delivery. Never synthesize it from the
// current room, a browser quote, the report timestamp or an old unstamped row.
export const validPublicReportOrigin = (value, now) => exact(value, ['v', 'at'])
    && value.v === 1 && integer(value.at) && value.at <= now;

function validState(value) {
    return exact(value, ['v', 'nextGeneration', 'entries']) && value.v === 1 && integer(value.nextGeneration)
        && Array.isArray(value.entries) && value.entries.length <= 100
        && value.entries.every(entry => exact(entry, ['id', 'revision', 'digest', 'originDigest', 'expiresAt']) && id(entry.id)
            && Number.isSafeInteger(entry.revision) && entry.revision >= 1 && entry.revision <= value.nextGeneration
            && digest(entry.digest) && digest(entry.originDigest) && integer(entry.expiresAt))
        && new Set(value.entries.map(entry => entry.id)).size === value.entries.length
        && new Set(value.entries.map(entry => entry.revision)).size === value.entries.length;
}
// Queues are owned/strictly validated by lobby-effect-records before reaching
// these internal transaction helpers. No reporter/context/device values are
// retained here; the immutable-origin fingerprint is not an identity lookup.
async function projections(queue, now) {
    ensure(queue && Array.isArray(queue.reports) && queue.reports.length <= 100 && integer(now));
    const result = [];
    for (const report of queue.reports) {
        if (!Object.hasOwn(report, 'publicOrigin')) continue;
        ensure(id(report.id) && /^#[a-z0-9-]{2,30}$/.test(report.ch) && validPublicReportOrigin(report.publicOrigin, now));
        ensure(integer(report.at) && integer(report.at + DAY));
        const selectedDigest = await incidentEvidenceDigest(enc.encode(report.text));
        const originDigest = await incidentEvidenceDigest(enc.encode(JSON.stringify([
            'hangout-public-report-origin-v1', report.id, report.ch, report.from, report.authorDev,
            report.at, report.publicOrigin.at, selectedDigest
        ])));
        result.push({ id: report.id, digest: selectedDigest, originDigest, expiresAt: report.at + DAY });
    }
    return result;
}
async function checkedState(tx, queue, now) {
    const state = await tx.get(LOBBY_INCIDENT_SOURCE_KEY); ensure(validState(state));
    const expected = await projections(queue, now); ensure(state.entries.length === expected.length);
    for (const row of expected) {
        const entry = state.entries.find(candidate => candidate.id === row.id);
        ensure(entry && same({ id: entry.id, digest: entry.digest, originDigest: entry.originDigest, expiresAt: entry.expiresAt }, row));
    }
    return state;
}
// Explicit only: the caller has established a known-new source namespace and a
// validated ordinary queue. Startup and normal writes never call this helper.
export async function initializeLobbyIncidentSources({ tx, queue, now = Date.now() } = {}) {
    ensure(await tx.get(LOBBY_INCIDENT_SOURCE_KEY) === undefined && same(await tx.get('moderation-queue'), queue));
    const rows = await projections(queue, now); ensure(rows.length === 0);
    await tx.put(LOBBY_INCIDENT_SOURCE_KEY, { v: 1, nextGeneration: 0, entries: [] });
}
export async function validateLobbyIncidentSources({ tx, queue, now = Date.now() } = {}) {
    await checkedState(tx, queue, now);
}
export async function reconcileLobbyIncidentSources({ tx, previous, current, now = Date.now() } = {}) {
    const saved = await checkedState(tx, previous, now), projected = await projections(current, now);
    let nextGeneration = saved.nextGeneration;
    const entries = projected.map(row => {
        const old = saved.entries.find(entry => entry.id === row.id);
        if (old && same({ id: old.id, digest: old.digest, originDigest: old.originDigest, expiresAt: old.expiresAt }, row)) return old;
        ensure(Number.isSafeInteger(nextGeneration + 1));
        return { id: row.id, revision: ++nextGeneration, digest: row.digest, originDigest: row.originDigest, expiresAt: row.expiresAt };
    });
    const next = { v: 1, nextGeneration, entries }; ensure(validState(next));
    if (!same(saved, next)) await tx.put(LOBBY_INCIDENT_SOURCE_KEY, next);
}
export async function loadLobbyIncidentSource({ tx, queue, sourceId, now = Date.now() } = {}) {
    const saved = await checkedState(tx, queue, now);
    if (!id(sourceId)) return null;
    const entry = saved.entries.find(row => row.id === sourceId);
    if (!entry || entry.expiresAt <= now) return null;
    const report = queue.reports.find(row => row.id === sourceId);
    return { id: entry.id, revision: entry.revision, digest: entry.digest, bytes: enc.encode(report.text),
        expiresAt: entry.expiresAt, provenance: 'reported-public' };
}
