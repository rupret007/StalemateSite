// Opt-in private-beta authority. One native transaction contains issued session
// metadata, connection bindings and the actual Lobby effects. This is not C2
// policy/guardian qualification. Deployment/drain remains the release owner's job.
import { accountId, roleForEmail } from './auth.mjs';
import { validRoomId } from './core.mjs';
import { BETA_TTL, betaVersion } from './beta-session-client.mjs';
import { validBetaRecord } from './beta-session-state.mjs';
import { createDurableRecordStorage } from './durable-record-storage.mjs';
import { initializeLobbyEffects, readLobbyState, writeLobbyEffects, pruneLobbyEffectLogs, loadLobbyIncidentEvidence,
    personRoomProjection, validPersonRoomProjection, readPersonRoomProjection } from './lobby-effect-records.mjs';
import { lobbyIncidentSourceMode } from './lobby-incident-sources.mjs';
import { validPrivateReportState } from './private-reports.mjs';
import { createLobby } from './lobby-core.mjs';
import { accessPartitionedParticipationSelf, maintainPartitionedParticipation, PARTICIPATION_PARTITION_BOUNDS, PARTICIPATION_POLICY_KEY } from './participation-partitions.mjs';

export const LOBBY_AUTHORITY_MODE = 'lobby-v1';
export const LOBBY_AUTHORITY_MARKER = 'lobby-session-authority:v1';
export const LOBBY_AUTHORITY_PATH = '/__beta/authority/';
export const LOBBY_AUTHORITY_COMMUNITY = 'hangout_shared_community_v1';
const SESSION_INDEX = 'authority-session-index:v1', CONNECTION_INDEX = 'authority-connection-index:v1';
const SESSION = 'authority-session:', CONNECTION = 'authority-connection:', RATES = 'authority-mint-rates:v1';
const SID = /^[a-z0-9-]{16,64}$/, REF = /^[A-Za-z0-9_-]{1,128}$/, ACCOUNT = /^a_[A-Za-z0-9_-]{43}$/;
const LIMIT = 1000, CONNECTION_LIMIT = 200, ROOM_LIMIT = 16, BATCH = 16, INTERVAL = 60000;
const clone = value => structuredClone(value);
const fail = () => { throw Error('lobby-authority-unavailable'); };
const ensure = value => { if (!value) fail(); };
const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
    && Reflect.ownKeys(value).length === keys.length && keys.every(key => {
        const d = Object.getOwnPropertyDescriptor(value, key); return d?.enumerable && Object.hasOwn(d, 'value');
    });
const integer = value => Number.isSafeInteger(value) && value >= 0;
const version = value => typeof value === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(value);
export const lobbyAuthorityMode = env => env?.HANGOUT_SESSION_AUTHORITY === LOBBY_AUTHORITY_MODE;
const profileValid = value => value === null || exact(value, ['kind', 'account', 'role', 'admin', 'expiresAt'])
    && ['owner', 'staff'].includes(value.kind) && ACCOUNT.test(value.account) && integer(value.expiresAt)
    && (value.kind === 'owner' ? value.role === 'fan' && value.admin === false : ['owner', 'band', 'moderator'].includes(value.role) && value.admin === true);
const recordValid = value => exact(value, ['v', 'sid', 'version', 'generation', 'createdAt', 'exp', 'revoked', 'pending', 'attempt', 'retryAt', 'rooms', 'profile', 'closureRevision'])
    && value.v === 2 && SID.test(value.sid) && version(value.version) && integer(value.createdAt) && integer(value.exp)
    && value.exp > value.createdAt && value.exp <= value.createdAt + BETA_TTL && typeof value.revoked === 'boolean' && typeof value.pending === 'boolean'
    && (!value.pending || value.revoked) && integer(value.attempt) && value.attempt <= 20 && integer(value.retryAt) && value.retryAt <= value.exp
    && Array.isArray(value.rooms) && value.rooms.length <= ROOM_LIMIT && value.rooms.every(validRoomId) && new Set(value.rooms).size === value.rooms.length
    && Number.isSafeInteger(value.generation) && value.generation > 0 && integer(value.closureRevision) && profileValid(value.profile)
    && (!value.profile || value.profile.expiresAt <= value.exp && value.profile.expiresAt > value.createdAt);
const bindingKeys = ['id', 'betaSid', 'betaInviteVersion', 'dev', 'iph', 'account', 'role', 'admin', 'expiresAt', 'authorityRef', 'authorityRevision'];
const bindingValid = value => exact(value, bindingKeys) && [value.id, value.dev, value.iph].every(item => typeof item === 'string' && REF.test(item))
    && SID.test(value.betaSid) && version(value.betaInviteVersion) && (value.account === '' || ACCOUNT.test(value.account))
    && ['fan', 'owner', 'band', 'moderator'].includes(value.role) && typeof value.admin === 'boolean' && integer(value.expiresAt)
    && value.authorityRef === value.id && value.authorityRevision === 1;
const bindingFrom = value => Object.fromEntries(bindingKeys.map(key => [key, value[key]]));

// The codec is attached to the already-open native transaction, not to a nested
// transaction. Alarm operations use that SAME supplied native handle.
export function createLobbyAuthorityStorage(storage) {
    ensure(typeof storage?.transaction === 'function');
    return Object.freeze({ transaction: operation => storage.transaction(native => {
        let calls = 0, readBytes = 0, writeBytes = 0;
        const size = value => value === undefined ? 0 : value instanceof Uint8Array ? value.byteLength : new TextEncoder().encode(JSON.stringify(value)).byteLength;
        const counted = async (name, ...args) => {
            ensure(++calls <= 4096);
            if (name === 'put') { writeBytes += size(args[1]); ensure(writeBytes <= 16 * 1024 * 1024); }
            const result = await native[name](...args);
            if (name === 'get' || name === 'list') { readBytes += name === 'list' ? [...result.values()].reduce((total, row) => total + size(row), 0) : size(result); ensure(readBytes <= 32 * 1024 * 1024); }
            return result;
        };
        const raw = Object.fromEntries(['get', 'put', 'delete', 'list', 'getAlarm', 'setAlarm', 'deleteAlarm'].map(name => [name, (...args) => counted(name, ...args)]));
        const records = createDurableRecordStorage({ storage: { transaction: work => work(raw) }, namespace: 'lobby-authority-v1', maxRecordBytes: 8 * 1024 * 1024 });
        return records.transaction(tx => operation(tx, raw));
    }) });
}
async function marker(tx) {
    const saved = await tx.get(LOBBY_AUTHORITY_MARKER);
    const keys = ['version', 'communityRef', 'initializedAt', 'inviteVersion', 'generation', 'usedVersions'];
    const requiredMode = saved && Object.hasOwn(saved, 'participationMode');
    ensure(exact(saved, requiredMode ? [...keys, 'participationMode'] : keys) && (!requiredMode || saved.participationMode === 'c3-v1') && saved.version === 1
        && saved.communityRef === LOBBY_AUTHORITY_COMMUNITY && integer(saved.initializedAt) && version(saved.inviteVersion)
        && Number.isSafeInteger(saved.generation) && saved.generation > 0 && Array.isArray(saved.usedVersions) && saved.usedVersions.length <= 128
        && saved.usedVersions.length === saved.generation && saved.usedVersions.every(version) && new Set(saved.usedVersions).size === saved.usedVersions.length
        && saved.usedVersions.at(-1) === saved.inviteVersion); return saved;
}
async function index(tx) {
    const saved = await tx.get(SESSION_INDEX);
    ensure(exact(saved, ['version', 'entries']) && saved.version === 1 && Array.isArray(saved.entries) && saved.entries.length <= LIMIT
        && saved.entries.every(item => exact(item, ['sid', 'exp']) && SID.test(item.sid) && integer(item.exp))
        && new Set(saved.entries.map(item => item.sid)).size === saved.entries.length); return saved;
}
async function connections(tx) {
    const saved = await tx.get(CONNECTION_INDEX);
    ensure(exact(saved, ['version', 'ids']) && saved.version === 1 && Array.isArray(saved.ids) && saved.ids.length <= CONNECTION_LIMIT
        && saved.ids.every(id => typeof id === 'string' && REF.test(id)) && new Set(saved.ids).size === saved.ids.length); return saved;
}
async function session(tx, sid, knownIndex) {
    ensure(SID.test(sid || '')); const rows = knownIndex || await index(tx), entry = rows.entries.find(row => row.sid === sid);
    const saved = await tx.get(SESSION + sid); ensure(saved === undefined || recordValid(saved));
    ensure(entry ? saved && saved.exp === entry.exp : saved === undefined); return saved;
}
async function rates(tx) {
    const value = await tx.get(RATES);
    ensure(value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length <= LIMIT
        && Object.entries(value).every(([key, rate]) => /^[A-Za-z0-9_-]{22}$/.test(key) && exact(rate, ['until', 'count'])
            && integer(rate.until) && Number.isSafeInteger(rate.count) && rate.count >= 1 && rate.count <= 20)); return value;
}
async function initialized(tx) { await marker(tx); await index(tx); await connections(tx); await rates(tx); }

// Explicitly invoked only for a known-new, owner-drained application domain.
// Missing state in ordinary startup NEVER invokes either initializer.
export async function initializeLobbySessionAuthority({ storage, env, state, privateReports = { v: 1, reports: [], receipts: [] }, now = Date.now() } = {}) {
    const records = createLobbyAuthorityStorage(storage), incidentSources = !!lobbyIncidentSourceMode(env);
    return records.transaction(async (tx, raw) => {
        ensure(integer(now) && await tx.get(LOBBY_AUTHORITY_MARKER) === undefined);
        // Refuse an old initialized Lobby: migration must read and validate it.
        for (const key of ['net', 'room-index', 'rooms', 'abuse', 'sessions', 'moderation-queue', 'ai-reviews', 'beta-initialized', 'private-reports-v1', 'ai-usage', 'mint-rates']) ensure(await raw.get(key) === undefined);
        for (const prefix of ['community-room:', 'log:']) ensure((await raw.list({ prefix, limit: 1 })).size === 0);
        await seed(tx, state, privateReports, now, betaVersion(env), {}, { incidentSources, participationMode: env.HANGOUT_PARTICIPATION_AUTHORITY }); await raw.setAlarm(now + INTERVAL);
    });
}
async function seed(tx, state, privateReports, now, inviteVersion, mintRates = {}, { incidentSources = false, participationMode } = {}) {
    ensure(version(inviteVersion) && (participationMode === undefined || participationMode === 'c3-v1'));
    if (participationMode === undefined) ensure(await tx.get(PARTICIPATION_POLICY_KEY) === undefined);
    for (const key of [LOBBY_AUTHORITY_MARKER, SESSION_INDEX, CONNECTION_INDEX, RATES, 'private-reports-v1']) ensure(await tx.get(key) === undefined);
    for (const prefix of [SESSION, CONNECTION]) ensure((await tx.list({ prefix, limit: 1 })).size === 0);
    await initializeLobbyEffects({ tx, state, now, incidentSources });
    ensure(await validPrivateReportState(privateReports, now));
    await tx.put('private-reports-v1', privateReports);
    await tx.put(SESSION_INDEX, { version: 1, entries: [] }); await tx.put(CONNECTION_INDEX, { version: 1, ids: [] }); await tx.put(RATES, mintRates); await rates(tx);
    await tx.put(LOBBY_AUTHORITY_MARKER, { version: 1, communityRef: LOBBY_AUTHORITY_COMMUNITY, initializedAt: now, inviteVersion, generation: 1, usedVersions: [inviteVersion], ...(participationMode ? { participationMode } : {}) });
}
// Owner must independently drain old writers and expire/invalidate old beta
// generations before invoking this bound-only migration. No request boolean
// establishes that operational precondition. Original raw rows are retained.
export async function migrateLobbySessionAuthority({ storage, env, registrySnapshot, now = Date.now() } = {}) {
    const records = createLobbyAuthorityStorage(storage), incidentSources = !!lobbyIncidentSourceMode(env);
    return records.transaction(async (tx, raw) => {
        ensure(integer(now) && await tx.get(LOBBY_AUTHORITY_MARKER) === undefined && await raw.get('beta-initialized') === true);
        ensure(exact(registrySnapshot, ['v', 'sessions', 'mintRates']) && registrySnapshot.v === 1 && Array.isArray(registrySnapshot.sessions)
            && registrySnapshot.sessions.length <= LIMIT && registrySnapshot.sessions.every(row => validBetaRecord(row, row.sid)
                && (row.exp <= now || row.revoked && !row.pending)) && new Set(registrySnapshot.sessions.map(row => row.sid)).size === registrySnapshot.sessions.length);
        const fresh = createLobby({ now: () => now }), net = await raw.get('net'); ensure(net !== undefined);
        // The original beta loader explicitly treated absent optional snapshots
        // as empty. Preserve that legacy contract ONLY during owner migration;
        // a present malformed row and any missing new-format row still refuse.
        const optional = async (key, fallback) => { const value = await raw.get(key); return value === undefined ? fallback : value; };
        const abuse = await optional('abuse', fresh.abuseSnapshot()), sessions = await optional('sessions', fresh.sessionSnapshot());
        const moderationQueue = await optional('moderation-queue', { reports: [], held: [] }), aiReviews = await optional('ai-reviews', []);
        const roomIndex = await raw.get('room-index'), legacyRooms = await raw.get('rooms'); let rooms;
        if (roomIndex !== undefined) {
            ensure(exact(roomIndex, ['version', 'names']) && roomIndex.version === 1 && Array.isArray(roomIndex.names) && roomIndex.names.length <= 1030
                && roomIndex.names.every(name => /^#[a-z0-9-]{2,30}$/.test(name)) && new Set(roomIndex.names).size === roomIndex.names.length && legacyRooms === undefined);
            rooms = { version: 1, rooms: [] }; for (const name of roomIndex.names) { const value = await raw.get('community-room:' + name); ensure(value && value.name === name); rooms.rooms.push(value); }
        } else rooms = legacyRooms === undefined ? fresh.roomSnapshot() : legacyRooms;
        const expectedRooms = roomIndex ? [...roomIndex.names].sort().map(name => 'community-room:' + name) : [];
        const foundRooms = []; let roomCursor;
        do {
            const page = await raw.list({ prefix: 'community-room:', limit: 4, ...(roomCursor ? { startAfter: roomCursor } : {}) });
            for (const [key] of page) { ensure(key > (roomCursor || '') && foundRooms.length < 1030); foundRooms.push(key); roomCursor = key; }
            if (page.size < 4) break;
        } while (true);
        ensure(JSON.stringify(foundRooms) === JSON.stringify(expectedRooms));
        const logRows = new Map(); let cursor;
        do {
            const page = await raw.list({ prefix: 'log:', limit: 4, ...(cursor ? { startAfter: cursor } : {}) });
            for (const [key, value] of page) { ensure(/^log:\d{15}:[a-f0-9-]{36}$/.test(key) && key > (cursor || '') && logRows.size < 2000); logRows.set(key, value); cursor = key; }
            if (page.size < 4) break;
        } while (true);
        const privateReports = await optional('private-reports-v1', { v: 1, reports: [], receipts: [] });
        await seed(tx, { net, abuse, sessions, rooms, moderationQueue, aiReviews, modlog: [...logRows.values()] }, privateReports, now, betaVersion(env), registrySnapshot.mintRates, { incidentSources, participationMode: env.HANGOUT_PARTICIPATION_AUTHORITY });
        await raw.setAlarm(now + INTERVAL);
    });
}

export function createLobbySessionAuthority({ storage, env, now = () => Date.now(), writeEffects = writeLobbyEffects } = {}) {
    const records = createLobbyAuthorityStorage(storage), contexts = new WeakMap(), incidentSources = !!lobbyIncidentSourceMode(env);
    const commitEffects = input => writeEffects({ ...input, now: now(), incidentSources });
    let roleSignature, roleMap;
    async function currentRoles() {
        const signature = JSON.stringify([env.HANGOUT_HMAC_KEY, env.HANGOUT_OWNER_EMAIL, env.HANGOUT_BAND_EMAILS, env.HANGOUT_MODERATOR_EMAILS]);
        if (signature !== roleSignature) {
            const emails = [...new Set([env.HANGOUT_OWNER_EMAIL, env.HANGOUT_BAND_EMAILS, env.HANGOUT_MODERATOR_EMAILS].flatMap(value => String(value || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean)))];
            ensure(emails.length <= CONNECTION_LIMIT); const map = new Map();
            for (const email of emails) map.set(await accountId(email, env.HANGOUT_HMAC_KEY), roleForEmail(email, env));
            roleMap = map; roleSignature = signature;
        }
        return roleMap;
    }
    const active = record => !!record && record.exp > now() && record.version === betaVersion(env) && !record.revoked;
    async function configuredMarker(tx) {
        const current = await marker(tx), mode = env.HANGOUT_PARTICIPATION_AUTHORITY;
        ensure(mode === undefined || mode === 'c3-v1');
        ensure((current.participationMode === 'c3-v1') === (mode === 'c3-v1'));
        // Old unlatched domains containing C2 are never silently treated as
        // ordinary beta, nor automatically upgraded to the required mode.
        if (mode === undefined) ensure(await tx.get(PARTICIPATION_POLICY_KEY) === undefined);
        return current;
    }
    async function validateBinding(tx, candidate) {
        if (!bindingValid(candidate) || candidate.expiresAt <= now()) return false;
        const modeMarker = await configuredMarker(tx);
        const ids = await connections(tx), saved = await tx.get(CONNECTION + candidate.id); ensure(saved === undefined || bindingValid(saved));
        ensure(ids.ids.includes(candidate.id) ? saved !== undefined : saved === undefined);
        if (!saved || bindingKeys.some(key => saved[key] !== candidate[key])) return false;
        const record = await session(tx, saved.betaSid);
        if (!active(record) || record.generation !== modeMarker.generation || saved.betaInviteVersion !== record.version || saved.expiresAt > record.exp) return false;
        if (!saved.account) return saved.role === 'fan' && saved.admin === false;
        const profile = record.profile;
        return !!profile && profile.expiresAt > now() && saved.expiresAt <= profile.expiresAt && saved.account === profile.account
            && saved.role === profile.role && saved.admin === profile.admin && (!profile.admin || (await currentRoles()).get(profile.account) === profile.role);
    }
    // A principal identifies an authenticated session/account, never a consent
    // grant. Guest principals do not survive a different issued beta SID.
    // Consent identity and room/staff role are separate. A profiled SID uses
    // its verified account even on the ordinary fan socket; expired profiles
    // never fall back to an unrelated guest grant.
    async function participationIdentity(tx, sid, expiresAt) {
        const record = await session(tx, sid);
        if (!active(record) || record.generation !== (await configuredMarker(tx)).generation || expiresAt > record.exp) return null;
        const profile = record.profile;
        if (profile && (profile.expiresAt <= now() || profile.admin && (await currentRoles()).get(profile.account) !== profile.role)) return null;
        return { principalRef: profile?.account || `s_${sid}`, communityRef: LOBBY_AUTHORITY_COMMUNITY,
            expiresAt: Math.min(expiresAt, profile?.expiresAt ?? expiresAt) };
    }
    async function prune(tx, at) {
        const rows = await index(tx); let removed = 0;
        for (const item of [...rows.entries]) if (item.exp <= at && removed < BATCH) {
            const old = await session(tx, item.sid, rows); ensure(old && old.exp === item.exp);
            await tx.delete(SESSION + item.sid); rows.entries = rows.entries.filter(row => row.sid !== item.sid); removed++;
        }
        if (removed) await tx.put(SESSION_INDEX, rows);
        const oldRates = await rates(tx), kept = Object.fromEntries(Object.entries(oldRates).filter(([, rate]) => rate.until > at));
        if (Object.keys(kept).length !== Object.keys(oldRates).length) await tx.put(RATES, kept);
        return rows;
    }
    async function schedule(tx, raw, at) {
        const rows = await index(tx), budgets = await rates(tx);
        // Lobby tick/log/private-report maintenance always requires a future
        // alarm, even when the SID registry and mint rates are empty.
        await raw.setAlarm(Math.min(at + INTERVAL, ...rows.entries.map(row => Math.max(at + 1, row.exp)), ...Object.values(budgets).map(row => Math.max(at + 1, row.until))));
    }
    const transact = operation => records.transaction(async (tx, raw) => {
        await initialized(tx); ensure((await configuredMarker(tx)).inviteVersion === betaVersion(env));
        const result = await operation(tx, raw); await configuredMarker(tx); return result;
    });
    return Object.freeze({
        records,
        resolveParticipationConnection: value => transact(async tx => {
            const binding = bindingFrom(value);
            return await validateBinding(tx, binding) ? participationIdentity(tx, binding.betaSid, binding.expiresAt) : null;
        }),
        async resolveParticipationConnections(values) {
            ensure(Array.isArray(values) && values.length <= CONNECTION_LIMIT);
            const descriptors = clone(values);
            return records.transaction(async tx => {
                // Preparation only: native reads are shared inside this one
                // read-only transaction, never across actions or commit fences.
                // Each validator still sees an independent row and checks its
                // own descriptor, current role and live clock on every call.
                const rows = new Map();
                const current = Object.freeze({ get: async key => {
                    if (!rows.has(key)) rows.set(key, await tx.get(key));
                    return clone(rows.get(key));
                } });
                await initialized(current); ensure((await configuredMarker(current)).inviteVersion === betaVersion(env));
                const identities = [];
                for (const value of descriptors) {
                    let identity = null;
                    try {
                        const binding = bindingFrom(value);
                        if (await validateBinding(current, binding)) identity = await participationIdentity(current, binding.betaSid, binding.expiresAt);
                    } catch { /* This descriptor receives no affirmative grant. */ }
                    identities.push(identity);
                }
                await configuredMarker(current);
                return identities;
            });
        },
        async validateParticipationConnection({ tx, connection, identity } = {}) {
            try {
                const binding = bindingFrom(connection);
                if (!exact(identity, ['principalRef', 'communityRef', 'expiresAt']) || !await validateBinding(tx, binding)) return false;
                const current = await participationIdentity(tx, binding.betaSid, binding.expiresAt);
                return !!current && Object.keys(current).every(key => current[key] === identity[key]);
            } catch { return false; }
        },
        writeParticipationEffects: commitEffects,
        loadIncidentEvidence: input => { ensure(incidentSources); return loadLobbyIncidentEvidence({ ...input, now: now() }); },
        ownParticipation: value => transact(async tx => {
            ensure(env.HANGOUT_PARTICIPATION_AUTHORITY === 'c3-v1' && exact(value, value.request === undefined ? ['sid', 'version', 'exp'] : ['sid', 'version', 'exp', 'request']));
            const authorize = async () => {
                const record = await session(tx, value.sid);
                ensure(active(record) && value.version === record.version && value.exp <= record.exp && value.exp > now());
                const identity = await participationIdentity(tx, value.sid, value.exp); ensure(identity); return identity;
            };
            const identity = await authorize();
            const result = await accessPartitionedParticipationSelf({ tx, identity, now: now(), ...(value.request === undefined ? {} : { request: value.request }) });
            const after = await authorize(); ensure(JSON.stringify(identity) === JSON.stringify(after));
            return result;
        }),

        // TRUSTED CALLER-GATED recovery: the actual Lobby holds its event gate
        // for this entire read, so no app mutator or output may interleave. A
        // snapshot/flag alone does not establish that exclusion. Every native
        // read transaction remains bounded; semantic writes still use ONE tx.
        async load() {
            const config = () => JSON.stringify([betaVersion(env), env.HANGOUT_HMAC_KEY, env.HANGOUT_OWNER_EMAIL, env.HANGOUT_BAND_EMAILS, env.HANGOUT_MODERATOR_EMAILS, env.HANGOUT_INCIDENT_SOURCE_BRIDGE, env.HANGOUT_PARTICIPATION_AUTHORITY]);
            const configBefore = config(), at = now();
            const capture = () => transact(async tx => ({ marker: await marker(tx), sessions: await index(tx), connections: await connections(tx), rates: await rates(tx) }));
            const before = await capture(), serialized = JSON.stringify(before);
            const scan = async (prefix, expected, valid, keyOf) => {
                const found = new Map(); let cursor, ended = false;
                while (!ended) {
                    const batch = await records.transaction(async tx => {
                        const rows = []; let next = cursor, done = false;
                        // Four pages of four logical items per native tx.
                        for (let pageNumber = 0; pageNumber < 4; pageNumber++) {
                            const page = await tx.list({ prefix, limit: 4, ...(next ? { startAfter: next } : {}) });
                            for (const [key, value] of page) { ensure(key > (next || '')); rows.push([key, value]); next = key; }
                            if (page.size < 4) { done = true; break; }
                        }
                        return { rows, next, done };
                    });
                    for (const [key, value] of batch.rows) {
                        ensure(valid(value) && key === prefix + keyOf(value) && !found.has(keyOf(value)));
                        ensure(expected.includes(keyOf(value))); found.set(keyOf(value), value);
                    }
                    cursor = batch.next; ended = batch.done;
                }
                ensure(found.size === expected.length); return found;
            };
            const issued = await scan(SESSION, before.sessions.entries.map(row => row.sid), recordValid, row => row.sid);
            for (const item of before.sessions.entries) {
                const row = issued.get(item.sid); ensure(row.exp === item.exp && row.generation === before.marker.generation && row.version === before.marker.inviteVersion);
            }
            const savedBindings = await scan(CONNECTION, before.connections.ids, bindingValid, row => row.id);
            // Domain validation is read-only and can traverse the full bounded
            // room/log layout without packing every room into one native tx.
            const reader = Object.freeze({
                get: key => records.transaction(tx => tx.get(key)),
                list: options => records.transaction(tx => tx.list(options)),
                put: () => { throw Error('read-only-recovery'); }, delete: () => { throw Error('read-only-recovery'); }
            });
            ensure(await validPrivateReportState(await reader.get('private-reports-v1'), at));
            const state = await readLobbyState({ tx: reader, now: at, incidentSources }), bindings = [];
            const ids = [...savedBindings.keys()];
            for (let offset = 0; offset < ids.length; offset += BATCH) {
                const batch = await records.transaction(async tx => {
                    const result = [];
                    for (const id of ids.slice(offset, offset + BATCH)) {
                        const binding = savedBindings.get(id); result.push({ binding, active: await validateBinding(tx, binding) });
                    }
                    return result;
                });
                bindings.push(...batch);
            }
            ensure(config() === configBefore && JSON.stringify(await capture()) === serialized);
            return { state, bindings };
        },
        validate: value => transact(tx => validateBinding(tx, bindingFrom(value))),
        check: value => transact(async tx => {
            const record = await session(tx, value.sid);
            return record && record.exp > now() && record.generation === (await marker(tx)).generation && record.version === value.version && value.version === betaVersion(env) && value.exp <= record.exp
                && (!record.revoked || value.allowRevoked === true) ? { reason: record.revoked ? 'revoked' : 'active', profile: clone(record.profile) } : null;
        }),
        async register(body) {
            return transact(async (tx, raw) => {
                const at = now(); ensure(SID.test(body.sid || '') && version(body.version) && integer(body.exp));
                if (body.version !== betaVersion(env) || body.exp <= at || body.exp > at + BETA_TTL) return { status: 403, reason: 'expired or revoked' };
                if (await session(tx, body.sid)) return { status: 409, reason: 'session already exists' };
                ensure(/^[A-Za-z0-9_-]{22}$/.test(body.iph || '') && profileValid(body.profile ?? null));
                const profile = body.profile ?? null;
                if (profile && (profile.expiresAt > body.exp || profile.expiresAt <= at || profile.admin && (await currentRoles()).get(profile.account) !== profile.role)) return { status: 403, reason: 'identity denied' };
                const rows = await prune(tx, at), budgets = await rates(tx), rate = budgets[body.iph] || { until: at + 3600000, count: 0 };
                if (rows.entries.length >= LIMIT || rate.count >= 20 || !budgets[body.iph] && Object.keys(budgets).length >= LIMIT) return { status: 429, reason: 'beta session allowance reached' };
                budgets[body.iph] = { ...rate, count: rate.count + 1 }; await tx.put(RATES, budgets);
                const record = { v: 2, sid: body.sid, version: body.version, generation: (await marker(tx)).generation, createdAt: at, exp: body.exp, revoked: false, pending: false, attempt: 0, retryAt: 0, rooms: [], profile: clone(profile), closureRevision: 0 };
                await tx.put(SESSION + body.sid, record); rows.entries.push({ sid: body.sid, exp: body.exp }); await tx.put(SESSION_INDEX, rows); await schedule(tx, raw, at);
                return { status: 200, reason: 'registered' };
            });
        },
        bind: value => transact(async tx => {
            const binding = bindingFrom(value); ensure(bindingValid(binding)); const ids = await connections(tx);
            ensure(!ids.ids.includes(binding.id) && ids.ids.length < CONNECTION_LIMIT && await tx.get(CONNECTION + binding.id) === undefined);
            await tx.put(CONNECTION + binding.id, binding); ids.ids.push(binding.id); await tx.put(CONNECTION_INDEX, ids);
            ensure(await validateBinding(tx, binding)); return binding;
        }),
        unbind: id => transact(async tx => {
            const ids = await connections(tx); if (!ids.ids.includes(id)) return;
            await tx.delete(CONNECTION + id); ids.ids = ids.ids.filter(value => value !== id); await tx.put(CONNECTION_INDEX, ids);
        }),
        room: body => transact(async tx => {
            const record = await session(tx, body.sid); if (!active(record) || record.version !== body.version || body.exp > record.exp) return { status: 403, reason: 'revoked' };
            if (!validRoomId(body.room)) return { status: 400, reason: 'room' };
            if (!record.rooms.includes(body.room)) {
                if (record.rooms.length >= ROOM_LIMIT) return { status: 429, reason: 'private room allowance reached' };
                await tx.put(SESSION + record.sid, { ...record, rooms: [...record.rooms, body.room] });
            }
            return { status: 200, reason: 'registered' };
        }),
        revoke: body => transact(async tx => {
            const record = await session(tx, body.sid); if (!record || record.exp <= now() || record.version !== body.version || body.exp > record.exp) return null;
            ensure(Number.isSafeInteger(record.closureRevision + 1));
            const attempt = Math.min(20, record.attempt + 1), changed = { ...record, revoked: true, pending: true, attempt, closureRevision: record.closureRevision + 1,
                retryAt: Math.min(record.exp, now() + Math.min(3600000, INTERVAL * 2 ** (attempt - 1))) };
            // Deliberate durable tombstone before any later schedule/fanout.
            await tx.put(SESSION + record.sid, changed); return changed;
        }),
        confirmClosed: attempt => transact(async tx => {
            const record = await session(tx, attempt.sid);
            if (record?.revoked && record.closureRevision === attempt.closureRevision) await tx.put(SESSION + record.sid, { ...record, pending: false });
        }),
        schedule: () => transact((tx, raw) => schedule(tx, raw, now())),
        due: () => transact(async tx => {
            const rows = await prune(tx, now()), due = [];
            for (const item of rows.entries) {
                const record = await session(tx, item.sid, rows); ensure(record && record.exp === item.exp);
                if (record.pending && record.retryAt <= now()) due.push(record);
            }
            return due.sort((a, b) => a.retryAt - b.retryAt || a.sid.localeCompare(b.sid)).slice(0, BATCH);
        }),
        retry: sid => transact(async tx => {
            const record = await session(tx, sid); if (!record?.pending || record.retryAt > now()) return null;
            ensure(Number.isSafeInteger(record.closureRevision + 1));
            const attempt = Math.min(20, record.attempt + 1), next = { ...record, attempt, closureRevision: record.closureRevision + 1,
                retryAt: Math.min(record.exp, now() + Math.min(3600000, INTERVAL * 2 ** (attempt - 1))) };
            await tx.put(SESSION + sid, next); return next;
        }),
        health: () => transact(async tx => ({ used: (await index(tx)).entries.filter(row => row.exp > now()).length, limit: LIMIT })),
        rotate: nextVersion => records.transaction(async (tx, raw) => {
            await initialized(tx); const current = await configuredMarker(tx);
            const finish = async value => { await configuredMarker(tx); return value; };
            ensure(version(nextVersion) && nextVersion === betaVersion(env) && nextVersion !== current.inviteVersion && !current.usedVersions.includes(nextVersion)
                && current.usedVersions.length < 128 && Number.isSafeInteger(current.generation + 1));
            const rows = await index(tx), batch = rows.entries.slice(0, BATCH);
            // Refusal must not commit an earlier deletion without its index.
            // Preflight this bounded batch before touching any rows.
            for (const item of batch) {
                const record = await session(tx, item.sid, rows);
                if (record.exp > now() && (!record.revoked || record.pending)) return finish({ status: 409, reason: 'old sessions require confirmed closure' });
            }
            for (const item of batch) await tx.delete(SESSION + item.sid);
            if (batch.length) { rows.entries = rows.entries.slice(batch.length); await tx.put(SESSION_INDEX, rows); }
            if (rows.entries.length || (await connections(tx)).ids.length) return finish({ status: 409, reason: 'old session metadata cleanup remains' });
            await tx.put(LOBBY_AUTHORITY_MARKER, { ...current, inviteVersion: nextVersion, generation: current.generation + 1, usedVersions: [...current.usedVersions, nextVersion] });
            await schedule(tx, raw, now()); return finish({ status: 200, reason: 'rotated' });
        }),
        maintenance: () => transact(async tx => { await pruneLobbyEffectLogs({ tx, now: now() }); }),
        async maintainParticipation() {
            const configured = () => env.HANGOUT_BETA_MODE === 'protected' && lobbyAuthorityMode(env) && env.HANGOUT_PARTICIPATION_AUTHORITY === 'c3-v1';
            ensure(configured());
            const page = { ok: true, examined: 0, deleted: 0, wrapped: false };
            for (let i = 0; i < PARTICIPATION_PARTITION_BOUNDS.maintenancePage; i++) {
                const result = await transact(async tx => {
                    ensure(configured()); const current = await configuredMarker(tx);
                    ensure(current.participationMode === 'c3-v1');
                    return maintainPartitionedParticipation({ tx, now: now(), communityRef: current.communityRef });
                });
                page.examined += result.examined; page.deleted += result.deleted; page.wrapped = result.wrapped;
                if (result.wrapped) break;
            }
            return Object.freeze(page);
        },
        // Queue writes are fenced in this same domain; the queue commits its
        // memory only after this promise resolves. No unrelated transaction.
        privateStorage: (actor = () => null) => ({
            get: key => transact(async tx => { ensure(key === 'private-reports-v1'); const value = await tx.get(key); ensure(value !== undefined); return value; }),
            put: (key, value) => transact(async tx => {
                ensure(key === 'private-reports-v1'); const who = actor();
                const authorize = async () => {
                    if (who?.kind === 'maintenance') return;
                    if (who?.binding) ensure(await validateBinding(tx, bindingFrom(who.binding)));
                    else { const record = await session(tx, who?.sid); ensure(active(record)); }
                };
                await authorize(); await tx.put(key, value); await authorize();
            })
        }),
        effectCommit: Object.freeze({
            async prepare(operation) { const context = Object.freeze({}); contexts.set(context, clone(operation)); return context; },
            async commit(context, effects, { costsOnly = false, participation = null, personDependencies = null } = {}) {
                let personTargetStale = false;
                try {
                    const operation = contexts.get(context); ensure(operation && typeof operation.kind === 'string');
                    const dependencies = personDependencies === null ? null : clone(personDependencies);
                    if (dependencies) {
                        ensure(exact(dependencies, Object.hasOwn(dependencies, 'room') ? ['peerIds', 'room'] : ['peerIds'])
                            && Array.isArray(dependencies.peerIds) && dependencies.peerIds.length <= CONNECTION_LIMIT
                            && dependencies.peerIds.every(id => typeof id === 'string' && id.length > 0 && id.length <= 160)
                            && new Set(dependencies.peerIds).size === dependencies.peerIds.length);
                        if (dependencies.room) ensure(exact(dependencies.room, ['name', 'keepRef', 'before', 'after'])
                            && /^#[a-z0-9-]{2,30}$/.test(dependencies.room.name) && dependencies.room.name !== '#stalemate'
                            && /^[a-f0-9]{32}$/.test(dependencies.room.keepRef)
                            && validPersonRoomProjection(dependencies.room.before) && validPersonRoomProjection(dependencies.room.after));
                    }
                    const confirmTarget = value => {
                        if (!value) { personTargetStale = true; throw Error('person-target-stale'); }
                    };
                    let guardedCompleted = false;
                    const guarded = async work => {
                        const result = await transact(async tx => {
                        const authorize = async phase => {
                            const client = ['connect', 'message', 'control', 'private-report-complete'].includes(operation.kind);
                            if (client && !costsOnly) {
                                const actor = operation.connections.find(value => value.id === operation.actorId);
                                ensure(actor && await validateBinding(tx, bindingFrom(actor)));
                            } else {
                                ensure(['connect', 'message', 'control', 'private-report-complete', 'disconnect', 'tick', 'restore-rooms', 'restore-moderation', 'restore-ai', 'apply-ai', 'refresh'].includes(operation.kind));
                                // Tick may renew registered ownership and staff
                                // heartbeat. Its exact contributors are selected
                                // by the engine independently of C2 purposes.
                                if (operation.kind === 'tick' && !costsOnly) for (const contributor of operation.connections) ensure(await validateBinding(tx, bindingFrom(contributor)));
                            }
                            if (dependencies && !costsOnly) {
                                for (const id of dependencies.peerIds) {
                                    const selected = operation.connections.find(value => value.id === id);
                                    confirmTarget(selected && await validateBinding(tx, bindingFrom(selected)));
                                }
                                if (dependencies.room) {
                                    const room = dependencies.room;
                                    const current = await readPersonRoomProjection({ tx, name: room.name, keepRef: room.keepRef, now: now() });
                                    confirmTarget(current && JSON.stringify(current) === JSON.stringify(personRoomProjection(room[phase])));
                                }
                            }
                        };
                        await authorize('before'); const result = await work(tx); await authorize('after'); return result;
                        });
                        guardedCompleted = true; return result;
                    };
                    if (participation) {
                        const result = await participation.adapter.commit(participation.context, effects, { costsOnly, transaction: guarded });
                        ensure(result?.ok && guardedCompleted); return result;
                    }
                    await guarded(tx => commitEffects({ tx, effects, costsOnly })); return { ok: true };
                } catch { return { ok: false, reason: personTargetStale ? 'person-target-stale' : 'session-unavailable' }; }
            }
        })
    });
}
