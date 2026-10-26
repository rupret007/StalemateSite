// @vitest-environment node
// Actual beta gateway + Lobby + C2/C3 on disk-backed SQLite. Synthetic policy/guardian approval only. Only
// runtime sockets/Response and remote binding transports are test doubles. The
// alarm API maps to one key inside the same SQL transaction. Staff ingress and
// private-room provenance are explicitly synthetic internal fixtures, not Access
// JWT verification or a hosted/native-media qualification.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { betaFetch } from '../src/beta-entry.mjs';
import { betaSession, signBeta } from '../src/beta-auth.mjs';
import { registryRequest } from '../src/beta-session-client.mjs';
import { HangoutLobby } from '../src/lobby-do.mjs';
import { accountId } from '../src/auth.mjs';
import { createLobbyAuthorityStorage, LOBBY_AUTHORITY_COMMUNITY } from '../src/lobby-session-authority.mjs';
import { createPartitionedParticipationConsents, PARTICIPATION_PARTITION_PREFIX, PARTICIPATION_POLICY_KEY } from '../src/participation-partitions.mjs';
import { PARTICIPATION_PURPOSES } from '../src/participation-policy.mjs';
import { privateReportRef, LIMITS as PRIVATE_LIMITS } from '../src/private-reports.mjs';
import { writeLobbyEffects } from '../src/lobby-effect-records.mjs';
import { LOG_TTL } from '../src/community-state.mjs';
import { openDurableRecordSqlite } from '../../tests/support/durable-record-sqlite.mjs';

const ORIGIN = 'https://collocated-beta.fixture.test', NOW = Date.UTC(2026, 9, 25, 12);
const INVITE = 'synthetic-collocated-private-invite-'.repeat(2), PREVIEW = 'synthetic-collocated-preview-'.repeat(2);
const ALARM = '__test_native_alarm__', ROOM = 'a'.repeat(64), QUOTE = 'Selected private allegation fixture 9de12';
const cleanups = [], clone = value => structuredClone(value);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
class Socket {
    readyState = 1; frames = [];
    send(raw) { if (this.readyState !== 1) throw Error('closed'); this.frames.push(JSON.parse(raw)); }
    close(code, reason) { this.closed = { code, reason }; this.readyState = 3; }
    serializeAttachment(value) { this.saved = clone(value); }
    deserializeAttachment() { return clone(this.saved); }
}
beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] }); vi.setSystemTime(NOW);
    vi.stubGlobal('WebSocketPair', class { constructor() { this[0] = new Socket(); this[1] = new Socket(); } });
    const NativeResponse = globalThis.Response;
    vi.stubGlobal('Response', class extends NativeResponse {
        constructor(body, init) { super(body, init?.status === 101 ? { status: 200 } : init);
            if (init?.status === 101) Object.defineProperty(this, 'status', { value: 101 }); this.webSocket = init?.webSocket; }
    });
    vi.stubGlobal('fetch', vi.fn(async () => { throw Error('External network forbidden in integration fixture'); }));
});
afterEach(async () => {
    for (const item of cleanups.splice(0)) {
        for (const release of item.releases) release(new Response('fixture cleanup', { status: 503 }));
        for (const lobby of item.lobbies) lobby.presence.dispose();
        await Promise.allSettled(item.background.splice(0)); await item.driver.close(); await rm(item.directory, { recursive: true, force: true });
    }
    vi.useRealTimers(); vi.unstubAllGlobals();
});
function request(path, { cookie, body, upgrade = false, method = body === undefined ? 'GET' : 'POST', headers = {} } = {}) {
    return new Request(ORIGIN + path, { method, headers: { Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(upgrade ? { Upgrade: 'websocket' } : {}), ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function harness({ initialize = true, mode = 'lobby-v1', participation = true } = {}) {
    const directory = await mkdtemp(join(tmpdir(), 'lobby-session-integration-')), driver = openDurableRecordSqlite(join(directory, 'lobby.sqlite'));
    const background = [], sockets = new Map(), lobbies = [], releases = []; let queue = Promise.resolve(), lobby;
    const transaction = operation => driver.transaction(raw => operation({ ...raw,
        getAlarm: () => raw.get(ALARM), setAlarm: value => raw.put(ALARM, value), deleteAlarm: () => raw.delete(ALARM) }));
    const storage = { transaction };
    for (const name of ['get', 'put', 'delete', 'list', 'getAlarm', 'setAlarm', 'deleteAlarm']) storage[name] = (...args) => transaction(tx => tx[name](...args));
    const state = { storage, sockets, background,
        blockConcurrencyWhile(fn) { const task = queue.then(fn); queue = task.catch(() => {}); return task; },
        getWebSockets: tag => [...sockets].filter(([ws, tags]) => ws.readyState === 1 && (!tag || tags.includes(tag))).map(([ws]) => ws),
        getTags: ws => sockets.get(ws) || [], acceptWebSocket: (ws, tags) => sockets.set(ws, tags), waitUntil: task => background.push(task) };
    const env = { HANGOUT_BETA_MODE: 'protected', HANGOUT_SESSION_AUTHORITY: mode, HANGOUT_BETA_INVITE_VERSION: '1',
        ...(participation ? { HANGOUT_PARTICIPATION_AUTHORITY: 'c3-v1' } : {}), HANGOUT_BETA_INVITE_KEY: INVITE, HANGOUT_PREVIEW_KEY: PREVIEW, HANGOUT_HMAC_KEY: 'synthetic-collocated-signing-key-'.repeat(2),
        HANGOUT_MODERATOR_EMAILS: 'reviewer@example.invalid', HANGOUT_OWNER_EMAIL: 'owner@example.invalid',
        ASSETS: { fetch: async () => new Response('fixture asset', { headers: { 'Content-Type': 'text/plain' } }) },
        QUOTA: { idFromName: name => name, get: () => ({ fetch: async () => new Response('ok') }) },
        ROOMS: { idFromName: name => name, get: () => ({ fetch: async () => new Response('ok') }) },
        BETA_SESSIONS: { idFromName: vi.fn(() => { throw Error('Legacy registry must not be used'); }), get: vi.fn(() => { throw Error('Legacy registry must not be used'); }) }
    };
    const getLobby = () => { if (!lobby) { lobby = new HangoutLobby(state, env); lobbies.push(lobby); } return lobby; };
    env.LOBBY = { idFromName: name => name, get: () => ({ fetch: incoming => getLobby().fetch(incoming) }) };
    cleanups.push({ directory, driver, background, lobbies, releases });
    const bound = (operation, body = {}) => getLobby().fetch(new Request(`https://internal/__beta/authority/${operation}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
    const settle = async () => {
        for (let round = 0; round < 12; round++) {
            await Promise.all(background.splice(0)); await Promise.resolve();
            if (!background.length) return;
        }
        throw Error('Integration background work did not settle');
    };
    const guest = async () => {
        const response = await betaFetch(request('/beta/unlock', { body: { key: INVITE } }), env); expect(response.status).toBe(200);
        const cookie = response.headers.get('Set-Cookie').split(';')[0], session = await betaSession(request('/beta/state', { cookie }), env);
        expect(session).not.toBeNull(); return { cookie, ...session };
    };
    // Explicit synthetic policy/guardian grants only. Public requests cannot
    // install policy, approve a relationship or choose any principal.
    const records = createLobbyAuthorityStorage(storage), proofs = new Map(), decisions = new Map(); let serial = 0;
    const reference = () => `synthetic_sharing_${String(++serial).padStart(10, '0')}`;
    const policy = { policy: { version: 1, policyVersion: 'sharing-fixture-v1', revision: 1, communityRef: LOBBY_AUTHORITY_COMMUNITY, noticeDigest: 'a'.repeat(64),
        decisionRef: 'synthetic_sharing_operator', state: 'qualified', purposes: [...PARTICIPATION_PURPOSES], issuedAt: NOW - 100, effectiveAt: NOW - 100, expiresAt: NOW + 1000000, maxSessionMs: 10000 },
        rules: { version: 1, verifierRef: 'synthetic_sharing_verifier', pendingMs: 10000, grantMs: 500000, subjectTailMs: 10000, guardianTailMs: 10000, receiptTailMs: 10000, callbackMs: 10000, operationMs: 10000 } };
    const ledger = createPartitionedParticipationConsents({ storage: records, now: () => Date.now(), randomRef: reference, admitSubject: async () => true,
        adapters: { qualifyPolicy: async () => ({ config: policy, expiresAt: NOW + 1000000 }),
            authenticateParticipant: async ({ proof, purpose }) => { const value = proofs.get(proof); return purpose === 'begin' ? value : value && { principalRef: value.principalRef, communityRef: value.communityRef, expiresAt: value.expiresAt }; },
            verifyConsent: async ({ proof }) => decisions.get(proof), authenticateGuardian: async () => null, authorizeMaintenance: async () => null } });
    if (participation) expect((await ledger.installPolicy('synthetic-fixture')).ok).toBe(true);
    const grant = async principalRef => {
        const proof = reference(); proofs.set(proof, { operationRef: reference(), principalRef, communityRef: LOBBY_AUTHORITY_COMMUNITY, expiresAt: NOW + 500000 });
        const pending = await ledger.begin(proof, { expectedRevision: 0, purposes: [...PARTICIPATION_PURPOSES] }); expect(pending.ok).toBe(true);
        const decision = reference(); decisions.set(decision, { operationRef: reference(), pendingRef: pending.pendingRef, subjectRef: pending.subjectRef, principalRef,
            guardianPrincipalRef: 'synthetic_sharing_guardian', decisionRef: reference(), verifierRef: policy.rules.verifierRef, status: 'approved', purposes: [...PARTICIPATION_PURPOSES], verifiedAt: NOW, expiresAt: NOW + 500000 });
        expect((await ledger.complete(decision)).state).toBe('authorized'); return { proof, pending };
    };
    const visitor = async (nick, extra = {}) => {
        const who = await guest(); if (participation) await grant(`s_${who.access.sid}`); const response = await betaFetch(request(`/lobby?preview=${PREVIEW}`, { cookie: who.cookie, upgrade: true }), env);
        expect(response.status).toBe(101); const socket = state.getWebSockets().at(-1);
        await getLobby().webSocketMessage(socket, JSON.stringify({ t: 'hello', nick, age13: true, ...extra })); await settle();
        expect(socket.frames.some(frame => frame.t === 'welcome' && frame.nick === nick)).toBe(true); return { ...who, socket };
    };
    const message = async (who, frame) => { await getLobby().webSocketMessage(who.socket, JSON.stringify(frame)); await settle(); };
    const cmd = (who, name, args = [], ch = '#stalemate') => message(who, { t: 'cmd', name, args, ch });
    if (initialize) expect((await bound('initialize')).status).toBe(200);
    return { driver, state, env, background, sockets, releases, records, ledger, grant, policy, lobby: getLobby, bound, settle, guest, visitor, message, cmd,
        async wake({ dropSockets = false } = {}) {
            getLobby().presence.dispose(); if (dropSockets) sockets.clear();
            lobby = new HangoutLobby(state, env); lobbies.push(lobby); await lobby.ready; await settle(); return lobby;
        } };
}

const own = (h, who, options = {}) => betaFetch(request('/beta/participation', { cookie: who.cookie, ...options }), h.env);
const logoutSharing = (h, who) => betaFetch(request('/beta/logout', { cookie: who.cookie, body: {} }), h.env);
const stop = (h, who, revision, options = {}) => betaFetch(request('/beta/participation/stop', { cookie: who.cookie, body: { expectedRevision: revision }, ...options }), h.env);

describe('caller-only sharing controls through betaFetch and actual SQLite-backed Lobby', () => {
    it('withdraws the actual guest, immediately removes sharing, and retains selected-line reporting on the same socket', async () => {
        const h = await harness(), alice = await h.visitor('Alice'), bravo = await h.visitor('Bravo');
        await h.message(bravo, { t: 'say', ch: '#stalemate', text: 'Selected received sharing-safety fixture' });
        const received = alice.socket.frames.find(frame => frame.t === 'line' && frame.text === 'Selected received sharing-safety fixture'); expect(received).toBeTruthy();
        const before = await (await own(h, alice)).json(); expect(before).toMatchObject({ ok: true, state: 'authorized', available: true, revision: 2, canStop: true });
        expect(Object.keys(before).sort()).toEqual(['available', 'canStop', 'ok', 'purposes', 'reason', 'revision', 'state']);
        const result = await stop(h, alice, before.revision); expect(result.status).toBe(200); expect(await result.json()).toMatchObject({ state: 'withdrawn', available: false, cleanup: 'confirmed' });
        expect(alice.socket.readyState).toBe(1); expect(alice.socket.frames.some(frame => frame.t === 'sharing-stopped')).toBe(true);
        expect(h.lobby().engine._debug.conns.get(alice.socket.saved.id)).toMatchObject({ safetyOnly: true, nick: '' });
        const offset = bravo.socket.frames.length; await h.message(alice, { t: 'say', ch: '#stalemate', text: 'Must never share after withdrawal' });
        expect(JSON.stringify(bravo.socket.frames.slice(offset))).not.toContain('Must never share after withdrawal');
        await h.message(alice, { t: 'report', id: received.id, text: received.text });
        expect(alice.socket.frames.some(frame => frame.t === 'report-status' && frame.id === received.id && frame.submitted === true)).toBe(true);
        await h.message(bravo, { t: 'say', ch: '#stalemate', text: 'Other visitors still progress' });
        expect(bravo.socket.readyState).toBe(1); expect(JSON.stringify(alice.socket.frames)).not.toContain('Other visitors still progress');
        const repeated = await (await stop(h, alice, before.revision)).json(); expect(repeated).toMatchObject({ state: 'withdrawn', revision: 3 });
        await h.wake(); expect(await (await own(h, alice)).json()).toMatchObject({ state: 'withdrawn', revision: 3 });
    });
    it('rejects target selectors and missing/null/cross-origin Stop requests before changing either caller', async () => {
        const h = await harness(), alice = await h.visitor('Alice'), bravo = await h.visitor('Bravo');
        for (const origin of ['', 'null', 'https://other.invalid']) {
            expect((await stop(h, alice, 2, { headers: { Origin: origin } })).status).toBe(403);
        }
        expect((await stop(h, alice, 2, { body: { expectedRevision: 2, principalRef: `s_${bravo.access.sid}` } })).status).toBe(400);
        expect((await betaFetch(request('/beta/participation?principal=other', { cookie: alice.cookie }), h.env)).status).toBe(400);
        const forged = { 'X-Hangout-Identity': JSON.stringify({ betaSid: bravo.access.sid, role: 'owner' }), 'X-Hangout-Beta-Session': JSON.stringify({ betaSid: bravo.access.sid }), 'X-Hangout-Principal': `s_${bravo.access.sid}` };
        expect((await stop(h, alice, 2, { headers: forged })).status).toBe(200);
        expect(await (await own(h, bravo)).json()).toMatchObject({ state: 'authorized', available: true });
        expect(await (await own(h, alice)).json()).toMatchObject({ state: 'withdrawn', available: false });
    });
    it('uses the registry verified account for consent on an ordinary fan socket, without inheriting a SID grant or staff role', async () => {
        const h = await harness(), sid = 'synthetic-profile-session-1111', exp = NOW + 500000;
        const account = await accountId('owner@example.invalid', h.env.HANGOUT_HMAC_KEY);
        const profile = { kind: 'owner', account, role: 'fan', admin: false, expiresAt: NOW + 300000 };
        expect((await h.bound('register', { sid, exp, version: '1', iph: 'S'.repeat(22), profile })).status).toBe(200);
        const token = await signBeta('access', { v: 1, sid, exp, scope: 'guest', version: '1' }, h.env.HANGOUT_HMAC_KEY), who = { cookie: '__Host-hangout-beta=' + token };
        await h.grant(`s_${sid}`);
        expect(await (await own(h, who)).json()).toMatchObject({ state: 'unknown', available: false });
        await h.grant(account);
        expect((await betaFetch(request(`/lobby?preview=${PREVIEW}`, { cookie: who.cookie, upgrade: true }), h.env)).status).toBe(101);
        who.socket = h.state.getWebSockets().at(-1); await h.message(who, { t: 'hello', nick: 'VerifiedFan', age13: true });
        expect(who.socket.frames.some(frame => frame.t === 'welcome')).toBe(true);
        expect(who.socket.saved).toMatchObject({ account: '', role: 'fan', admin: false });
        expect((await stop(h, who, 2)).status).toBe(200);
        expect(h.lobby().engine._debug.conns.get(who.socket.saved.id)).toMatchObject({ safetyOnly: true });
        vi.setSystemTime(profile.expiresAt + 1);
        expect((await own(h, who)).status).toBe(503);
        expect(await h.lobby().authority.resolveParticipationConnection(who.socket.saved)).toBeNull();
    });
    it('does not allocate missing records, and leaves default beta routes and bootstrap unchanged', async () => {
        const h = await harness(), guest = await h.guest();
        const before = await h.records.transaction(tx => tx.list({ prefix: PARTICIPATION_PARTITION_PREFIX + 'record:', limit: 4 }));
        expect(await (await own(h, guest)).json()).toMatchObject({ state: 'unknown', canStop: false, revision: 0 });
        expect(await (await stop(h, guest, 0)).json()).toMatchObject({ state: 'unknown', canStop: false });
        expect(await h.records.transaction(tx => tx.list({ prefix: PARTICIPATION_PARTITION_PREFIX + 'record:', limit: 4 }))).toEqual(before);
        const ordinary = await harness({ participation: false }), who = await ordinary.guest();
        expect((await own(ordinary, who)).status).toBe(404); expect((await stop(ordinary, who, 0)).status).toBe(404);
        expect(await (await betaFetch(request('/beta/bootstrap.js', { cookie: who.cookie }), ordinary.env)).text()).not.toContain('HangoutParticipationControls');
    });
    it('withholds acknowledgement and rolls back a failed native withdrawal, then repeats after a lost HTTP acknowledgement', async () => {
        const h = await harness(), alice = await h.visitor('Alice'); const original = h.state.storage.transaction; let fail = true;
        h.state.storage.transaction = fn => original(async (...args) => { const result = await fn(...args); if (fail && result?.state === 'withdrawn') { fail = false; throw Error('Synthetic native withdrawal commit failure'); } return result; });
        expect((await stop(h, alice, 2)).status).toBe(503);
        expect(await (await own(h, alice)).json()).toMatchObject({ state: 'authorized', revision: 2 });
        expect(alice.socket.frames.some(frame => frame.t === 'sharing-stopped')).toBe(false);
        // Commit succeeds; the caller deliberately discards the HTTP reply.
        await stop(h, alice, 2);
        expect(await (await own(h, alice)).json()).toMatchObject({ state: 'withdrawn', revision: 3 });
        expect(await (await stop(h, alice, 2)).json()).toMatchObject({ state: 'withdrawn', revision: 3 });
    });
    it('keeps a committed withdrawal truthful when local cleanup fails, then recovers on repeat', async () => {
        const h = await harness(), alice = await h.visitor('Alice');
        const refresh = h.lobby().engine.refreshParticipation; h.lobby().engine.refreshParticipation = async () => ({ ok: false, reason: 'synthetic-cleanup-failure' });
        expect(await (await stop(h, alice, 2)).json()).toMatchObject({ state: 'withdrawn', revision: 3, cleanup: 'unconfirmed' });
        expect(await (await own(h, alice)).json()).toMatchObject({ state: 'withdrawn', available: false });
        h.lobby().engine.refreshParticipation = refresh;
        expect(await (await stop(h, alice, 2)).json()).toMatchObject({ state: 'withdrawn', revision: 3, cleanup: 'confirmed' });
        expect(alice.socket.frames.some(frame => frame.t === 'sharing-stopped')).toBe(true);
    });
    it('rechecks session expiry after the actual staged partition write and rolls it back', async () => {
        const h = await harness(), alice = await h.visitor('Alice'), original = h.state.storage.transaction; let tripped = false;
        const keyNeedle = Buffer.from(PARTICIPATION_PARTITION_PREFIX + 'record:').toString('hex');
        h.state.storage.transaction = fn => original(raw => fn({ ...raw, put: async (key, value) => {
            await raw.put(key, value);
            if (!tripped && key.includes(':manifest:') && key.includes(keyNeedle)) { tripped = true; vi.setSystemTime(alice.access.exp + 1); }
        } }));
        expect((await stop(h, alice, 2)).status).toBe(503); expect(tripped).toBe(true);
        vi.setSystemTime(NOW); h.state.storage.transaction = original;
        expect(await (await own(h, alice)).json()).toMatchObject({ state: 'authorized', revision: 2, available: true });
        expect(alice.socket.frames.some(frame => frame.t === 'sharing-stopped')).toBe(false);
        expect((await logoutSharing(h, alice)).status).toBe(200);
        expect((await stop(h, alice, 2)).status).toBe(401);
    });
    it('refreshes two active fan-path SIDs for one verified account without stopping an unrelated guest', async () => {
        const h = await harness(), third = await h.visitor('Third');
        const account = await accountId('owner@example.invalid', h.env.HANGOUT_HMAC_KEY); await h.grant(account); const people = [];
        for (const [suffix, nick] of [['one', 'OneFan'], ['two', 'TwoFan']]) {
            const sid = `synthetic-shared-profile-${suffix}`, exp = NOW + 500000, profile = { kind: 'owner', account, role: 'fan', admin: false, expiresAt: exp };
            expect((await h.bound('register', { sid, exp, version: '1', iph: 'S'.repeat(22), profile })).status).toBe(200);
            const token = await signBeta('access', { v: 1, sid, exp, scope: 'guest', version: '1' }, h.env.HANGOUT_HMAC_KEY), person = { cookie: '__Host-hangout-beta=' + token };
            expect((await betaFetch(request(`/lobby?preview=${PREVIEW}`, { cookie: person.cookie, upgrade: true }), h.env)).status).toBe(101);
            person.socket = h.state.getWebSockets().at(-1); await h.message(person, { t: 'hello', nick, age13: true }); people.push(person);
        }
        expect((await stop(h, people[0], 2)).status).toBe(200);
        for (const person of people) { expect(await (await own(h, person)).json()).toMatchObject({ state: 'withdrawn' }); expect(h.lobby().engine._debug.conns.get(person.socket.saved.id)).toMatchObject({ safetyOnly: true }); }
        expect(h.lobby().engine._debug.conns.get(third.socket.saved.id).safetyOnly).not.toBe(true);
    });

    it('withholds direct private-admin dispatch on the same restricted privileged socket', async () => {
        const h = await harness(), sid = 'synthetic-staff-sharing-1111', exp = NOW + 500000, email = 'reviewer@example.invalid';
        const account = await accountId(email, h.env.HANGOUT_HMAC_KEY), profile = { kind: 'staff', account, role: 'moderator', admin: true, expiresAt: exp };
        expect((await h.bound('register', { sid, exp, version: '1', iph: 'S'.repeat(22), profile })).status).toBe(200); await h.grant(account);
        const identity = { betaSid: sid, betaInviteVersion: '1', expiresAt: exp, dev: 'fixture-sharing-staff', iph: 'S'.repeat(22), role: profile.role, admin: true, account, email };
        // Explicit synthetic verified internal ingress; actual registry/binding,
        // own HTTP route and native transactions. This is not Access OTP.
        expect((await h.lobby().fetch(new Request('https://internal/lobby-admin', { headers: { 'X-Hangout-Identity': JSON.stringify(identity) } }))).status).toBe(101);
        const token = await signBeta('access', { v: 1, sid, exp, scope: 'guest', version: '1' }, h.env.HANGOUT_HMAC_KEY);
        const staff = { cookie: '__Host-hangout-beta=' + token, socket: h.state.getWebSockets().at(-1) }; await h.message(staff, { t: 'hello', nick: 'StaffSharing', age13: true });
        const id = staff.socket.saved.id, control = { t: 'admin', state: { fixtureMarker: 'private-admin-sharing-canary' } };
        await h.lobby().sendPrivateAdmin(staff.socket, id, control); await h.settle();
        expect(staff.socket.frames.some(frame => frame.state?.fixtureMarker === control.state.fixtureMarker)).toBe(true);
        expect((await stop(h, staff, 2)).status).toBe(200); staff.socket.frames.length = 0;
        await h.lobby().sendPrivateAdmin(staff.socket, id, control); await h.settle();
        expect(staff.socket.frames.some(frame => frame.t === 'admin')).toBe(false);
        expect(staff.socket.saved).toMatchObject({ role: 'moderator', admin: true, account });
        expect(staff.socket.readyState).toBe(1);
    });

    it.each([false, true])('refuses initialized participation state after its C3 flag is removed (also remove authority=%s)', async removeAuthority => {
        const h = await harness(), alice = await h.visitor('Alice'); expect((await stop(h, alice, 2)).status).toBe(200);
        const before = [...h.driver.rows()]; delete h.env.HANGOUT_PARTICIPATION_AUTHORITY;
        if (removeAuthority) delete h.env.HANGOUT_SESSION_AUTHORITY;
        await h.wake();
        expect(h.lobby().authorityUnavailable).toBe(true); expect(h.lobby().engine).toBeUndefined();
        expect((await h.lobby().fetch(new Request('https://internal/lobby', { headers: { 'X-Hangout-Identity': JSON.stringify({ betaSid: alice.access.sid }) } }))).status).toBe(503);
        expect((await betaFetch(request('/beta/unlock', { body: { key: INVITE } }), h.env)).status).toBe(503);
        expect([...h.driver.rows()]).toEqual(before);
        h.env.HANGOUT_PARTICIPATION_AUTHORITY = 'c3-v1'; h.env.HANGOUT_SESSION_AUTHORITY = 'lobby-v1'; await h.wake();
        expect(h.lobby().authorityUnavailable).toBe(false);
        expect(await (await own(h, alice)).json()).toMatchObject({ state: 'withdrawn', available: false });
    });

    it('does not resurface legacy state when only a strict authority marker exists and its mode is removed', async () => {
        const h = await harness({ participation: false }), alice = await h.visitor('Alice'); const before = [...h.driver.rows()];
        delete h.env.HANGOUT_SESSION_AUTHORITY; await h.wake();
        expect(h.lobby().authorityUnavailable).toBe(true); expect(h.lobby().engine).toBeUndefined(); expect([...h.driver.rows()]).toEqual(before);
        h.env.HANGOUT_SESSION_AUTHORITY = 'lobby-v1'; await h.wake();
        expect(h.lobby().authorityUnavailable).toBe(false);
        expect((await betaFetch(request('/beta/state', { cookie: alice.cookie }), h.env)).status).toBe(200);
    });

    it('keeps the required C3 mode latched after policy loss and refuses mode removal without repairing records', async () => {
        const h = await harness(), alice = await h.visitor('Alice'), identity = await h.lobby().authority.resolveParticipationConnection(alice.socket.saved);
        await h.records.transaction(tx => tx.delete(PARTICIPATION_POLICY_KEY)); const before = [...h.driver.rows()];
        delete h.env.HANGOUT_PARTICIPATION_AUTHORITY;
        expect(await h.records.transaction(tx => h.lobby().authority.validateParticipationConnection({ tx, connection: alice.socket.saved, identity }))).toBe(false);
        h.env.HANGOUT_BETA_INVITE_VERSION = '2'; await expect(h.lobby().authority.rotate('2')).rejects.toThrow(); h.env.HANGOUT_BETA_INVITE_VERSION = '1';
        await h.wake(); expect(h.lobby().authorityUnavailable).toBe(true); expect(h.lobby().engine).toBeUndefined();
        expect((await betaFetch(request('/beta/unlock', { body: { key: INVITE } }), h.env)).status).toBe(503);
        expect([...h.driver.rows()]).toEqual(before);
    });
    it('does not silently upgrade an unlatched initialized strict domain when C3 is selected', async () => {
        const h = await harness({ participation: false }), alice = await h.visitor('Alice'), before = [...h.driver.rows()];
        h.env.HANGOUT_PARTICIPATION_AUTHORITY = 'c3-v1'; await h.wake();
        expect(h.lobby().authorityUnavailable).toBe(true); expect(h.lobby().engine).toBeUndefined(); expect([...h.driver.rows()]).toEqual(before);
        delete h.env.HANGOUT_PARTICIPATION_AUTHORITY; await h.wake();
        expect(h.lobby().authorityUnavailable).toBe(false); expect((await betaFetch(request('/beta/state', { cookie: alice.cookie }), h.env)).status).toBe(200);
    });

    it('refuses all three mode flags removed without resurfacing retained raw legacy rows', async () => {
        const h = await harness(), alice = await h.visitor('Alice'); await h.state.storage.put('net', { lock: 'off' }); const before = [...h.driver.rows()];
        delete h.env.HANGOUT_PARTICIPATION_AUTHORITY; delete h.env.HANGOUT_SESSION_AUTHORITY; delete h.env.HANGOUT_BETA_MODE;
        await h.wake(); expect(h.lobby().authorityUnavailable).toBe(true); expect(h.lobby().engine).toBeUndefined();
        expect((await h.lobby().fetch(new Request('https://internal/lobby'))).status).toBe(503); expect([...h.driver.rows()]).toEqual(before);
    });
    it('keeps a genuinely new default legacy domain available without initializing a strict marker', async () => {
        const h = await harness({ participation: false, mode: null, initialize: false });
        delete h.env.HANGOUT_SESSION_AUTHORITY;
        // Legacy list() may omit a limit. Page the actual SQLite fixture API in
        // its bounded fours; this does not relax the strict-domain driver.
        h.state.storage.list = options => h.state.storage.transaction(async tx => {
            const result = new Map(); let after = options?.startAfter;
            for (;;) { const rows = await tx.list({ prefix: options?.prefix || '', limit: 4, ...(after ? { startAfter: after } : {}) });
                for (const [key, value] of rows) { result.set(key, value); after = key; } if (rows.size < 4) return result; }
        });
        await h.lobby().ready; expect(h.lobby().authorityUnavailable).toBe(false); expect(h.lobby().engine).toBeTruthy();
        expect(await h.records.transaction(tx => tx.get('lobby-session-authority:v1'))).toBeUndefined();
        expect(await h.records.transaction(tx => tx.get(PARTICIPATION_POLICY_KEY))).toBeUndefined();
    });

});
