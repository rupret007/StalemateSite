// Inactive application adapter: use ONLY the supplied C3 transaction handle.
// This is not session/guardian authority, automatic provisioning or a migration.
import { validRoom, LOG_TTL } from './community-state.mjs';
import H from '../../r/45662413410ed051/sync-core.js';
import { LOBBY_INCIDENT_SOURCE_KEY, validPublicReportOrigin, initializeLobbyIncidentSources,
    validateLobbyIncidentSources, reconcileLobbyIncidentSources, loadLobbyIncidentSource } from './lobby-incident-sources.mjs';

export const LOBBY_EFFECT_MARKER = 'lobby-effects:v1';
export const LOBBY_LOG_INDEX = 'lobby-log:v1:index';
export const LOBBY_LOG_PREFIX = 'lobby-log:v1:segment:';
const MARKER = { version: 1, format: 'indexed-rooms-segmented-log-v1' };
const enc = new TextEncoder(), DAY = 86400000, MIB = 1024 * 1024;
const fail = () => { throw Error('lobby-effects-unavailable'); };
const ensure = value => { if (!value) fail(); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const shape = (value, required, optional = []) => object(value) && required.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const number = value => Number.isFinite(value) && value >= 0;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const text = (value, max, min = 0) => typeof value === 'string' && value.length >= min && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const nick = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_\-[\]{}^`|]{2,19}$/.test(value);
const channel = value => typeof value === 'string' && /^#[a-z0-9-]{2,30}$/.test(value);
const time = (value, now) => number(value) && value <= now;
const list = (value, max, valid) => Array.isArray(value) && value.length <= max && value.every(valid);
const unique = (value, max, valid) => list(value, max, valid) && new Set(value).size === value.length;
const pair = value => Array.isArray(value) && value.length === 2;
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

// Snapshot data descriptors before any validation/property read. Never invoke
// caller getters/toJSON, inherit serializers, or silently coerce unsupported data.
function ownedJson(value) {
    let nodes = 0, characters = 0;
    const active = new Set();
    const visit = (item, depth) => {
        ensure(++nodes <= 100000 && depth <= 64);
        if (item === null || typeof item === 'boolean') return item;
        if (typeof item === 'number') { ensure(Number.isFinite(item) && !Object.is(item, -0)); return item; }
        if (typeof item === 'string') { characters += item.length; ensure(characters <= 16 * MIB); return item; }
        ensure(item && typeof item === 'object' && !active.has(item));
        const array = Array.isArray(item), prototype = Object.getPrototypeOf(item), descriptors = Object.getOwnPropertyDescriptors(item);
        const length = descriptors.length?.value;
        ensure(array ? prototype === Array.prototype && integer(length) && length <= 100000 && Reflect.ownKeys(descriptors).length === length + 1
            : prototype === Object.prototype || prototype === null);
        const result = array ? Object.setPrototypeOf([], null) : Object.create(null);
        active.add(item);
        for (const key of Reflect.ownKeys(descriptors)) {
            if (array && key === 'length') continue;
            const descriptor = descriptors[key];
            ensure(typeof key === 'string' && descriptor.enumerable && Object.hasOwn(descriptor, 'value')
                && (!array || /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < length));
            characters += key.length; ensure(characters <= 16 * MIB);
            result[key] = visit(descriptor.value, depth + 1);
        }
        active.delete(item); return result;
    };
    const json = JSON.stringify(visit(value, 0)), bytes = enc.encode(json).byteLength;
    ensure(bytes <= 16 * MIB); return { value: JSON.parse(json), bytes };
}
const bytes = value => ownedJson(value).bytes;
function validRoomRecord(room, now) {
    const required = ['name', 'kind', 'title', 'topic', 'founder', 'created', 'modes', 'ops', 'voice', 'bans', 'invites', 'kicks',
        'emptySince', 'owner', 'cohostLabels', 'cohosts', 'renewed', 'act', 'opAccounts'];
    return shape(room, required, ['transfer', 'keepRef']) && validRoom(room, now)
        && shape(room.modes, ['m', 'i', 't', 'C', 'Q', 'locked', 'k', 'l', 'S'])
        && (!room.transfer || shape(room.transfer, ['from', 'to', 'until']))
        && unique(room.ops, 150, id) && unique(room.voice, 150, id) && unique(room.invites, 150, id) && unique(room.cohosts, 150, id)
        && list(room.opAccounts, room.ops.length, row => pair(row) && row.every(id) && room.ops.includes(row[0]))
        && new Set(room.opAccounts.map(row => row[0])).size === room.opAccounts.length
        && room.bans.every(ban => shape(ban, ['mask'], ['reason', 'by', 'at', 'nick', 'until'])
            && (!Object.hasOwn(ban, 'reason') || text(ban.reason, 80)) && (!Object.hasOwn(ban, 'by') || text(ban.by, 128))
            && (!Object.hasOwn(ban, 'at') || time(ban.at, now)) && (!Object.hasOwn(ban, 'nick') || nick(ban.nick)))
        && shape(room.act, ['strokes', 'video']) && room.act.strokes.every(stroke => shape(stroke, ['id', 'color', 'size', 'pts'])
            && same(H.cleanSnapshotStroke(stroke), stroke))
        && (room.act.video === null || shape(room.act.video, ['source', 'playing', 'pos', 't'])
            && shape(room.act.video.source, ['kind', 'id']) && same(H.cleanSource(room.act.video.source), room.act.video.source)
            && typeof room.act.video.playing === 'boolean' && number(room.act.video.pos) && room.act.video.pos <= DAY / 1000 && time(room.act.video.t, now));
}
function validRooms(value, now) {
    return shape(value, ['version', 'rooms']) && value.version === 1 && list(value.rooms, 1030, room => validRoomRecord(room, now))
        && new Set(value.rooms.map(room => room.name)).size === value.rooms.length && bytes(value) <= 8 * MIB;
}
function validAbuse(value, now) {
    const tuples = (rows, check) => list(rows, 5000, row => pair(row) && check(...row)) && new Set(rows.map(row => row[0])).size === rows.length;
    return shape(value, ['version', 'buckets', 'devices', 'ips']) && value.version === 1
        && tuples(value.buckets, (key, row) => text(key, 300, 1) && shape(row, ['tokens', 'at']) && number(row.tokens) && time(row.at, now))
        && tuples(value.devices, (key, row) => id(key) && shape(row, [], ['day', 'msgs', 'lastRoom'])
            && (!Object.hasOwn(row, 'day') || /^\d{4}-\d{2}-\d{2}$/.test(row.day)) && (!Object.hasOwn(row, 'msgs') || integer(row.msgs))
            && (!Object.hasOwn(row, 'lastRoom') || time(row.lastRoom, now)))
        && tuples(value.ips, (key, row) => id(key) && list(row, 3, at => time(at, now)));
}
function validSessions(value, now) {
    const names = (rows, max, check) => unique(rows, max, check);
    const connection = row => shape(row, ['id', 'dev', 'iph', 'account', 'role', 'admin', 'nick', 'entrySource', 'channels', 'away', 'ignores', 'blocks',
        'pmOff', 'cams', 'since', 'lastNick', 'tokens', 'last', 'frames', 'lastSaid', 'actTokens', 'actLast', 'camReports'], ['safetyOnly'])
        && [row.id, row.dev, row.iph].every(id) && (row.account === '' || id(row.account)) && ['fan', 'moderator', 'band', 'owner'].includes(row.role)
        && typeof row.admin === 'boolean' && (row.safetyOnly === true ? row.nick === '' && Array.isArray(row.channels) && row.channels.length === 0 && Array.isArray(row.cams) && row.cams.length === 0 && row.away === '' && row.entrySource === '' && row.pmOff === true : !Object.hasOwn(row, 'safetyOnly') && nick(row.nick)) && (row.entrySource === '' || typeof row.entrySource === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(row.entrySource))
        && names(row.channels, 31, channel) && text(row.away, 80) && names(row.ignores, 50, nick) && names(row.blocks, 50, id) && typeof row.pmOff === 'boolean'
        && names(row.cams, 30, channel) && row.cams.every(name => row.channels.includes(name))
        && [row.since, row.lastNick, row.last, row.actLast].every(at => time(at, now)) && number(row.tokens) && row.tokens <= 5
        && number(row.actTokens) && row.actTokens <= 24 && integer(row.frames) && row.frames <= 4000 && integer(row.camReports) && row.camReports <= 150
        && object(row.lastSaid) && Object.keys(row.lastSaid).length <= 31 && Object.entries(row.lastSaid).every(([name, at]) => row.channels.includes(name) && time(at, now));
    if (!shape(value, ['version', 'connections', 'pm', 'pendingPm', 'receipts']) || value.version !== 1 || !list(value.connections, 200, connection)
        || new Set(value.connections.map(row => row.id)).size !== value.connections.length
        || new Set(value.connections.filter(row => !row.safetyOnly).map(row => row.nick.toLowerCase())).size !== value.connections.filter(row => !row.safetyOnly).length || bytes(value) > 2 * MIB) return false;
    const connections = new Map(value.connections.map(row => [row.id, row]));
    const endpoints = row => id(row.from) && id(row.fromId) && id(row.toId) && row.fromId !== row.toId
        && row.key === [row.fromId, row.toId].sort().join('|') && connections.get(row.fromId)?.dev === row.from && connections.has(row.toId)
        && !connections.get(row.fromId).safetyOnly && !connections.get(row.toId).safetyOnly;
    const reference = row => !Object.hasOwn(row, 'ref') || typeof row.ref === 'string' && /^[a-f0-9]{32}$/.test(row.ref);
    const receipt = row => shape(row, ['t', 'id', 'ch', 'from', 'to', 'prefix', 'band', 'moderator', 'me', 'ts', 'authorDev', 'digest', 'recipients'], ['publicOrigin'])
        && nick(row.from) && id(row.authorDev) && /^[a-f0-9]{64}$/.test(row.digest) && time(row.ts, now) && ['', '@', '+'].includes(row.prefix)
        && ['band', 'moderator', 'me'].every(key => typeof row[key] === 'boolean')
        && (row.t === 'line' && /^m[a-z0-9]{1,80}$/i.test(row.id) && channel(row.ch) && row.to === ''
            || row.t === 'pm' && /^p[a-z0-9]{1,80}$/i.test(row.id) && nick(row.to) && row.ch === `pm:${row.from}>${row.to}`)
        && names(row.recipients, 200, id) && row.recipients.length > 0
        && (!Object.hasOwn(row, 'publicOrigin') || row.t === 'line' && validPublicReportOrigin(row.publicOrigin, now) && row.publicOrigin.at >= row.ts);
    return list(value.pm, 2000, row => shape(row, ['key', 'from', 'fromId', 'toId', 'state'], ['ref']) && reference(row) && row.state === 'open' && endpoints(row))
        && new Set(value.pm.map(row => row.key)).size === value.pm.length
        && list(value.pendingPm, 1000, row => shape(row, ['key', 'from', 'fromId', 'toId', 'at', 'hadFirst'], ['ref']) && reference(row) && endpoints(row) && time(row.at, now) && typeof row.hadFirst === 'boolean')
        && new Set([...value.pm, ...value.pendingPm].map(row => row.key)).size === value.pm.length + value.pendingPm.length
        && new Set([...value.pm, ...value.pendingPm].filter(row => Object.hasOwn(row, 'ref')).map(row => row.ref)).size === [...value.pm, ...value.pendingPm].filter(row => Object.hasOwn(row, 'ref')).length
        && list(value.receipts, 1000, receipt) && bytes(value.receipts) <= MIB && new Set(value.receipts.map(row => row.id)).size === value.receipts.length;
}
function validNet(value, now) {
    const counts = rows => object(rows) && Object.values(rows).every(number);
    return shape(value, ['bans', 'kicks', 'mutes', 'lock', 'shield', 'shieldAuto', 'lockAuto', 'lists', 'lastBand', 'budget', 'reportsToHide', 'stats'])
        && list(value.bans, 5000, row => shape(row, ['mask', 'by', 'reason', 'at'], ['nick', 'until']) && text(row.mask, 300, 1)
            && /^(dev|iph|account|nick):/.test(row.mask) && text(row.by, 128) && text(row.reason, 80) && time(row.at, now)
            && (!Object.hasOwn(row, 'nick') || nick(row.nick)) && (!Object.hasOwn(row, 'until') || row.until === null || number(row.until)))
        && [value.kicks, value.mutes].every(rows => object(rows) && Object.entries(rows).every(([key, until]) => id(key) && number(until)))
        && ['off', 'readonly', 'closed'].includes(value.lock) && ['shield', 'shieldAuto', 'lockAuto'].every(key => typeof value[key] === 'boolean')
        && shape(value.lists, ['block', 'hold', 'allow']) && Object.values(value.lists).every(rows => list(rows, 2000, word => text(word, 40, 1)))
        && time(value.lastBand, now + 60000) && shape(value.budget, ['day', 'requests']) && (value.budget.day === '' || /^\d{4}-\d{2}-\d{2}$/.test(value.budget.day)) && number(value.budget.requests)
        && integer(value.reportsToHide) && value.reportsToHide >= 1 && value.reportsToHide <= 20
        && shape(value.stats, ['hours', 'kinds', 'rooms', 'mod', 'reports'])
        && object(value.stats.hours) && Object.entries(value.stats.hours).every(([key, row]) => /^\d{4}-\d{2}-\d{2}T\d{2}$/.test(key) && shape(row, ['joins', 'peak', 'lines']) && Object.values(row).every(number))
        && [value.stats.kinds, value.stats.rooms, value.stats.mod].every(counts)
        && shape(value.stats.reports, ['made', 'autoHidden', 'dismissed', 'actioned']) && Object.values(value.stats.reports).every(number);
}
const moderationId = value => typeof value === 'string' && /^[mp][a-z0-9]{1,80}$/i.test(value);
const moderationChannel = value => channel(value) || typeof value === 'string' && value.startsWith('pm:') && value.slice(3).split('>').length === 2 && value.slice(3).split('>').every(nick);
const commonReport = (row, now) => moderationId(row.id) && nick(row.from) && moderationChannel(row.ch) && text(row.text, 300, 1) && time(row.at ?? row.ts, now);
function validModeration(value, now) {
    return shape(value, ['reports', 'held'])
        && list(value.reports, 100, row => shape(row, ['id', 'ch', 'from', 'text', 'at', 'hidden', 'context', 'devs', 'iphs', 'authorDev'], ['publicOrigin']) && commonReport(row, now)
            && typeof row.hidden === 'boolean' && id(row.authorDev) && list(row.context, 11, line => text(line, 400, 1)) && row.context.length > 0
            && unique(row.devs, 150, id) && row.devs.length > 0 && unique(row.iphs, 150, id) && row.iphs.length > 0
            && (!Object.hasOwn(row, 'publicOrigin') || row.id.startsWith('m') && channel(row.ch) && validPublicReportOrigin(row.publicOrigin, now) && row.publicOrigin.at <= row.at))
        && list(value.held, 100, row => shape(row, ['id', 'ch', 'from', 'text', 'ts', 'prefix', 'band', 'me', 'reason', 'dev']) && commonReport(row, now)
            && row.id.startsWith('m') && channel(row.ch) && ['', '@', '+'].includes(row.prefix) && typeof row.band === 'boolean' && typeof row.me === 'boolean' && text(row.reason, 160, 1) && id(row.dev))
        && new Set(value.reports.map(row => row.id)).size === value.reports.length && new Set(value.held.map(row => row.id)).size === value.held.length;
}
const AI_CATEGORIES = new Set(['harassment', 'harassment/threatening', 'hate', 'hate/threatening', 'illicit', 'illicit/violent', 'self-harm', 'self-harm/intent',
    'self-harm/instructions', 'sexual', 'sexual/minors', 'violence', 'violence/graphic']);
const validAi = (value, now) => list(value, 100, row => shape(row, ['id', 'from', 'ch', 'text', 'at', 'model', 'categories']) && commonReport(row, now)
    && row.id.startsWith('m') && channel(row.ch) && typeof row.model === 'string' && /^[A-Za-z0-9._:-]{1,100}$/.test(row.model)
    && unique(row.categories, AI_CATEGORIES.size, category => AI_CATEGORIES.has(category)) && row.categories.length > 0) && new Set(value.map(row => row.id)).size === value.length;
// A clock correction can make an already committed log timestamp temporarily
// future-relative. Preserve it, as restoreLog does; never rewrite its source time.
const validLog = (row, _now) => shape(row, ['at', 'by', 'action', 'target', 'reason', 'ch']) && number(row.at)
    && text(row.by, 128) && text(row.action, 80, 1) && text(row.target, 300) && text(row.reason, 300) && text(row.ch, 64);
const segmentKey = first => `${LOBBY_LOG_PREFIX}${String(first).padStart(16, '0')}`;
const domainKeys = ['net', 'room-index', 'abuse', 'sessions', 'moderation-queue', 'ai-reviews', LOBBY_LOG_INDEX];
const checkTx = tx => ensure(tx && ['get', 'put', 'delete', 'list'].every(name => typeof tx[name] === 'function'));
async function requireMarker(tx) { ensure(same(await tx.get(LOBBY_EFFECT_MARKER), MARKER)); }
function validIndex(index) {
    return shape(index, ['version', 'names']) && index.version === 1 && unique(index.names, 1030, name => channel(name) && name !== '#stalemate');
}
async function readLogs(tx, now) {
    // This version has explicit segmented storage. Coexisting legacy rows need
    // reviewed migration/drain; never silently ignore or overwrite them.
    const legacy = await tx.list({ prefix: 'log:', limit: 1 }); ensure(legacy instanceof Map && legacy.size === 0);
    const index = await tx.get(LOBBY_LOG_INDEX);
    ensure(shape(index, ['version', 'next', 'segments']) && index.version === 1 && integer(index.next)
        && list(index.segments, 32, row => shape(row, ['key', 'count']) && typeof row.key === 'string' && row.key.startsWith(LOBBY_LOG_PREFIX)
            && /^\d{16}$/.test(row.key.slice(LOBBY_LOG_PREFIX.length)) && integer(row.count) && row.count >= 1 && row.count <= 64)
        && index.segments.slice(0, -1).every(row => row.count === 64)
        && new Set(index.segments.map(row => row.key)).size === index.segments.length && index.segments.reduce((sum, row) => sum + row.count, 0) <= 2000);
    const found = new Map(); let cursor = '';
    do {
        const page = await tx.list({ prefix: LOBBY_LOG_PREFIX, limit: 4, ...(cursor ? { startAfter: cursor } : {}) });
        ensure(page instanceof Map && page.size <= 4);
        for (const [key, row] of page) { ensure(key > cursor && key.startsWith(LOBBY_LOG_PREFIX) && !found.has(key) && found.size < 32); found.set(key, row); cursor = key; }
        if (page.size < 4) break;
    } while (true);
    ensure(same([...found.keys()], index.segments.map(row => row.key)));
    const entries = []; let previous = -1;
    for (const reference of index.segments) {
        const segment = found.get(reference.key);
        ensure(shape(segment, ['version', 'entries']) && segment.version === 1 && Array.isArray(segment.entries) && segment.entries.length === reference.count);
        for (const row of segment.entries) {
            ensure(shape(row, ['seq', 'entry']) && integer(row.seq) && row.seq > previous && row.seq < index.next && validLog(row.entry, now));
            previous = row.seq; entries.push(row);
        }
        ensure(reference.key === segmentKey(segment.entries[0].seq));
    }
    return { index, found, entries };
}
async function saveLogs(tx, state, additions, now) {
    let next = state.index.next;
    const entries = state.entries.filter(row => now - row.entry.at < LOG_TTL);
    for (const entry of additions) { ensure(validLog(entry, now) && next < Number.MAX_SAFE_INTEGER); entries.push({ seq: next++, entry }); }
    const retained = entries.filter(row => now - row.entry.at < LOG_TTL).slice(-2000), segments = new Map();
    for (let offset = 0; offset < retained.length; offset += 64) {
        const rows = retained.slice(offset, offset + 64); segments.set(segmentKey(rows[0].seq), { version: 1, entries: rows });
    }
    for (const key of state.found.keys()) if (!segments.has(key)) await tx.delete(key);
    for (const [key, segment] of segments) if (!same(state.found.get(key), segment)) await tx.put(key, segment);
    const index = { version: 1, next, segments: [...segments].map(([key, segment]) => ({ key, count: segment.entries.length })) };
    if (!same(index, state.index)) await tx.put(LOBBY_LOG_INDEX, index);
}
async function writeRooms(tx, value, now) {
    ensure(validRooms(value, now)); const previous = await tx.get('room-index'); ensure(validIndex(previous));
    const names = value.rooms.map(room => room.name);
    for (const room of value.rooms) {
        const key = `community-room:${room.name}`, saved = await tx.get(key);
        if (previous.names.includes(room.name)) ensure(saved && saved.name === room.name && validRoomRecord(saved, now));
        else ensure(saved === undefined);
        if (!same(saved, room)) await tx.put(key, room);
    }
    for (const name of previous.names) if (!names.includes(name)) {
        const saved = await tx.get(`community-room:${name}`); ensure(saved && saved.name === name && validRoomRecord(saved, now));
        await tx.delete(`community-room:${name}`);
    }
    await tx.put('room-index', { version: 1, names }); await tx.delete('rooms');
}
const validators = { net: validNet, abuse: validAbuse, sessions: validSessions, 'moderation-queue': validModeration, 'ai-reviews': validAi };

// Explicit known-new initialization only; caller must establish authority and
// absence of old writers. Missing state is never treated as permission to init.
export async function initializeLobbyEffects({ tx, state, now = Date.now(), incidentSources = false } = {}) {
    checkTx(tx); ensure(integer(now) && typeof incidentSources === 'boolean'); const value = ownedJson(state).value;
    ensure(shape(value, ['net', 'rooms', 'abuse', 'sessions', 'moderationQueue', 'aiReviews', 'modlog']));
    ensure(await tx.get(LOBBY_EFFECT_MARKER) === undefined && await tx.get(LOBBY_INCIDENT_SOURCE_KEY) === undefined);
    for (const key of [...domainKeys, 'rooms']) ensure(await tx.get(key) === undefined);
    for (const prefix of ['community-room:', LOBBY_LOG_PREFIX, 'log:']) ensure((await tx.list({ prefix, limit: 1 })).size === 0);
    ensure(validRooms(value.rooms, now) && list(value.modlog, 2000, row => validLog(row, now)));
    for (const [key, data] of [['net', value.net], ['abuse', value.abuse], ['sessions', value.sessions], ['moderation-queue', value.moderationQueue], ['ai-reviews', value.aiReviews]]) {
        ensure(validators[key](data, now)); await tx.put(key, data);
    }
    await tx.put('room-index', { version: 1, names: [] }); await writeRooms(tx, value.rooms, now);
    await tx.put(LOBBY_LOG_INDEX, { version: 1, next: 0, segments: [] });
    await saveLogs(tx, { index: { version: 1, next: 0, segments: [] }, found: new Map(), entries: [] }, value.modlog, now);
    if (incidentSources) await initializeLobbyIncidentSources({ tx, queue: value.moderationQueue, now });
    await tx.put(LOBBY_EFFECT_MARKER, MARKER);
}
export async function writeLobbyEffects({ tx, effects, costsOnly = false, now = Date.now(), incidentSources = false } = {}) {
    checkTx(tx); ensure(integer(now) && typeof costsOnly === 'boolean' && typeof incidentSources === 'boolean'); const snapshot = ownedJson(effects);
    ensure(Array.isArray(snapshot.value) && snapshot.value.length <= 128); await requireMarker(tx);
    const logs = [];
    for (const effect of snapshot.value) {
        ensure(pair(effect)); const [kind, value] = effect;
        ensure(typeof kind === 'string' && (kind === 'rooms' || kind === 'modlog' || Object.hasOwn(validators, kind)));
        ensure(!costsOnly || ['abuse', 'net', 'sessions'].includes(kind));
        if (kind === 'rooms') await writeRooms(tx, value, now);
        else if (kind === 'modlog') { ensure(validLog(value, now)); logs.push(value); }
        else {
            ensure(validators[kind](value, now)); const previous = await tx.get(kind);
            ensure(previous !== undefined && validators[kind](ownedJson(previous).value, now));
            await tx.put(kind, value);
            if (kind === 'moderation-queue') {
                if (incidentSources) await reconcileLobbyIncidentSources({ tx, previous: ownedJson(previous).value, current: value, now });
                else ensure(await tx.get(LOBBY_INCIDENT_SOURCE_KEY) === undefined);
            }
        }
    }
    if (logs.length) await saveLogs(tx, await readLogs(tx, now), logs, now);
}
// A trusted maintenance caller must supply its authorization/transaction fence;
// this function does not grant authority or run from a production alarm itself.
export async function pruneLobbyEffectLogs({ tx, now = Date.now() } = {}) {
    checkTx(tx); ensure(integer(now)); await requireMarker(tx);
    await saveLogs(tx, await readLogs(tx, now), [], now);
}
export async function readLobbyState({ tx, now = Date.now(), incidentSources = false } = {}) {
    checkTx(tx); ensure(integer(now) && typeof incidentSources === 'boolean'); await requireMarker(tx); const result = {};
    for (const [key, validate] of Object.entries(validators)) {
        const raw = await tx.get(key); ensure(raw !== undefined); const value = ownedJson(raw).value;
        ensure(validate(value, now)); result[key] = value;
    }
    if (incidentSources) await validateLobbyIncidentSources({ tx, queue: result['moderation-queue'], now });
    else ensure(await tx.get(LOBBY_INCIDENT_SOURCE_KEY) === undefined);
    const index = await tx.get('room-index'); ensure(validIndex(index) && await tx.get('rooms') === undefined);
    const rooms = [];
    for (const name of index.names) { const room = await tx.get(`community-room:${name}`); ensure(room && room.name === name && validRoomRecord(room, now)); rooms.push(room); }
    ensure(validRooms({ version: 1, rooms }, now));
    // Prefix enumeration catches extra room rows; no missing-index empty fallback.
    let cursor = ''; const expected = [...index.names].sort(); let seen = 0;
    do {
        const page = await tx.list({ prefix: 'community-room:', limit: 4, ...(cursor ? { startAfter: cursor } : {}) });
        ensure(page instanceof Map && page.size <= 4);
        for (const [key] of page) { ensure(key > cursor && key === `community-room:${expected[seen++]}`); cursor = key; }
        if (page.size < 4) break;
    } while (true);
    ensure(seen === expected.length);
    const logs = await readLogs(tx, now);
    return { net: result.net, rooms: { version: 1, rooms }, abuse: result.abuse, sessions: result.sessions,
        moderationQueue: result['moderation-queue'], aiReviews: result['ai-reviews'], modlog: logs.entries.filter(row => now - row.entry.at < LOG_TTL).map(row => row.entry) };
}
// I1 loadEvidence adapter. It reads only the current owned queue in I1's own
// supplied transaction; no cached report/admin state or replacement quote.
export async function loadLobbyIncidentEvidence({ tx, sourceId, now = Date.now() } = {}) {
    checkTx(tx); ensure(integer(now)); await requireMarker(tx);
    const queue = ownedJson(await tx.get('moderation-queue')).value;
    ensure(validModeration(queue, now));
    return loadLobbyIncidentSource({ tx, queue, sourceId, now });
}
