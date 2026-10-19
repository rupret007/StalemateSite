// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { betaFetch } from '../src/beta-entry.mjs';
import main, { HangoutQuota } from '../src/index.mjs';
import { HangoutLobby } from '../src/lobby-do.mjs';
import { BetaSessions } from '../src/beta-sessions.mjs';
import { aiHealth, dailyUsage, INTERNAL_HEALTH_PATH } from '../src/beta-ops.mjs';

const origin = 'https://beta.example';
const OPS = 'ops-health-test-key-'.repeat(3), INVITE = 'invitation-test-key-'.repeat(3), SECRET = 'signing-test-key-'.repeat(3);
const today = () => new Date().toISOString().slice(0, 10);
function state(entries = []) {
    const values = new Map(entries);
    const storage = {
        get: vi.fn(async (key) => structuredClone(values.get(key))), put: vi.fn(async (key, value) => values.set(key, structuredClone(value))),
        delete: vi.fn(async (keys) => { for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key); }),
        list: async ({ prefix = '', limit = Infinity } = {}) => new Map([...values].filter(([key]) => key.startsWith(prefix)).slice(0, limit)),
        getAlarm: async () => 1, setAlarm: async () => {}, deleteAlarm: async () => {}
    };
    storage.transaction = async (fn) => fn(storage);
    return { values, storage, blockConcurrencyWhile: (fn) => fn(), getWebSockets: () => [], waitUntil: () => {} };
}
function config() {
    const env = {
        HANGOUT_BETA_MODE: 'protected', HANGOUT_BETA_OPS_KEY: OPS, HANGOUT_BETA_INVITE_KEY: INVITE, HANGOUT_HMAC_KEY: SECRET, HANGOUT_PREVIEW_KEY: 'internal-preview-key-'.repeat(2),
        HANGOUT_ACCESS_TEAM: 'ops-test.cloudflareaccess.com', HANGOUT_ACCESS_AUD: 'a'.repeat(64), HANGOUT_OWNER_ACCESS_AUD: 'b'.repeat(64),
        HANGOUT_OWNER_EMAIL: 'staff@example.test',
        HANGOUT_MODERATION_CONTACT: 'moderation@example.test', HANGOUT_AI_MODERATION: 'off', HANGOUT_AI_DAILY_LIMIT: '100', HANGOUT_TURN_ENABLED: '0',
        ASSETS: { fetch: vi.fn(async () => new Response('private asset')) }, ROOMS: { idFromName: (name) => name, get: vi.fn() }
    };
    const calls = [];
    const binding = (data) => ({ idFromName: (name) => name, get: () => ({ fetch: vi.fn(async (request) => { calls.push(request); return Response.json(data); }) }) });
    env.LOBBY = binding({ storage: 'ok', lock: 'off', shield: false, lockAuto: false, evidenceStorage: 'ready', quota: { day: today(), used: 123, limit: 40000 }, ai: aiHealth(env, { day: today(), used: 4 }) });
    env.QUOTA = binding({ storage: 'ok', quota: { day: today(), used: 7, limit: 200 } });
    env.BETA_SESSIONS = binding({ storage: 'ok', quota: { used: 2, limit: 1000 } });
    return { env, calls, binding };
}
const request = ({ method = 'GET', auth = `Bearer ${OPS}`, cookie, query = '' } = {}) => new Request(`${origin}/beta/health${query}`, { method, headers: { ...(auth ? { Authorization: auth } : {}), ...(cookie ? { Cookie: cookie } : {}) } });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('separate read-only beta operations permission', () => {
    it('fails closed with a fixed error when its dedicated ops key or protected mode is absent', async () => {
        for (const missing of ['HANGOUT_BETA_OPS_KEY', 'HANGOUT_BETA_MODE']) {
            const { env, calls } = config(); delete env[missing];
            const response = await betaFetch(request(), env);
            expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'ops-not-configured' }); expect(calls).toEqual([]);
        }
    });
    it('accepts neither guest cookies nor invitation/query/forged credentials, and does no storage work on rejection', async () => {
        const { env, calls } = config();
        for (const options of [{ auth: '' }, { auth: '', cookie: '__Host-hangout-beta=guest-cookie' }, { auth: `Bearer ${INVITE}` },
            { auth: '', query: `?key=${OPS}` }, { auth: `Basic ${OPS}` }, { auth: `Bearer ${OPS}extra` }]) {
            const response = await betaFetch(request(options), env);
            expect(response.status).toBe(401); expect(await response.json()).toEqual({ error: 'unauthorized' });
            expect(response.headers.get('Cache-Control')).toBe('no-store'); expect(response.headers.has('Set-Cookie')).toBe(false);
        }
        expect(calls).toEqual([]); expect(env.ASSETS.fetch).not.toHaveBeenCalled();
    });
    it('allows GET only and supplies neither CORS access nor a guest/staff session', async () => {
        const { env, calls } = config();
        for (const method of ['HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS']) {
            const response = await betaFetch(request({ method }), env);
            expect(response.status).toBe(405); expect(response.headers.get('Allow')).toBe('GET'); expect(response.headers.has('Set-Cookie')).toBe(false);
        }
        expect(calls).toEqual([]);
        const good = await betaFetch(request(), env);
        expect(good.headers.has('Access-Control-Allow-Origin')).toBe(false); expect(good.headers.has('Set-Cookie')).toBe(false);
        for (const path of ['/lobby-admin', '/lobby-owner', '/lobby', '/room']) expect((await betaFetch(new Request(origin + path, { headers: { Authorization: `Bearer ${OPS}` } }), env)).status).toBe(401);
    });
    it('never publicly forwards internal health paths, even with forged identity/ops headers', async () => {
        const { env, calls } = config();
        const external = new Request(origin + INTERNAL_HEALTH_PATH, { headers: { Authorization: `Bearer ${OPS}`, 'X-Hangout-Identity': '{"admin":true}' } });
        expect((await betaFetch(external, env)).status).toBe(401); expect((await main.fetch(external, env)).status).toBe(404); expect(calls).toEqual([]);
    });
});

describe('sanitized truthful operational status', () => {
    it('reports known application counters and explicitly leaves provider checks/billing unknown', async () => {
        const { env, calls } = config(), provider = vi.fn(); vi.stubGlobal('fetch', provider);
        const response = await betaFetch(request({ auth: `bearer ${OPS}` }), env), body = await response.json();
        expect(response.status).toBe(200); expect(body).toMatchObject({ version: 1, service: { state: 'ready', reasons: [] }, storageCheck: 'read-only', providerChecks: 'not-performed',
            admission: { state: 'open', lock: 'off', shield: false }, features: { email: { configured: true, provider: 'not-probed' }, ai: { enabled: false, state: 'disabled' }, turn: { enabled: false, providerUsage: 'unknown' } } });
        expect(body.usage).toEqual([
            { name: 'connections', used: 7, limit: 200, unit: 'connections', scope: 'application', period: 'day' },
            { name: 'lobbyRequests', used: 123, limit: 40000, unit: 'requests', scope: 'application', period: 'day' },
            { name: 'aiReviews', used: 4, limit: 100, unit: 'reviews', scope: 'application', period: 'day' },
            { name: 'betaSessions', used: 2, limit: 1000, unit: 'sessions', scope: 'application', period: 'active' }
        ]);
        expect(calls).toHaveLength(3); expect(calls.every((r) => new URL(r.url).pathname === INTERNAL_HEALTH_PATH && r.method === 'GET' && !r.headers.has('Authorization'))).toBe(true);
        expect(provider).not.toHaveBeenCalled();
    });
    it('redacts unrelated or malicious internal fields rather than spreading private state', async () => {
        const { env, binding } = config();
        env.LOBBY = binding({ storage: 'ok', lock: '#private-room', shield: 'private@example.test', lockAuto: true, evidenceStorage: 'ready',
            users: [{ email: 'private@example.test' }], messages: ['private message body'], secret: OPS, ai: { state: 'private message body' }, quota: { day: today(), used: -1, limit: 1 } });
        const response = await betaFetch(request(), env), text = await response.text();
        for (const secret of [OPS, INVITE, SECRET, 'staff@example.test', 'private@example.test', '#private-room', 'private message body']) expect(text).not.toContain(secret);
        const body = JSON.parse(text); expect(body.admission).toMatchObject({ lock: 'unknown', shield: null }); expect(body.service.reasons).toContain('usage-unknown');
        expect(body.usage.some((u) => u.name === 'lobbyRequests')).toBe(false);
    });
    it('marks emergency/pause and provider misconfiguration degraded without pretending providers were checked', async () => {
        const { env, binding } = config();
        Object.assign(env, { HANGOUT_OPEN: '0', HANGOUT_ACCESS_AUD: '', HANGOUT_MODERATION_CONTACT: '', HANGOUT_AI_MODERATION: 'review', HANGOUT_TURN_ENABLED: '1' });
        env.LOBBY = binding({ storage: 'ok', lock: 'readonly', shield: true, lockAuto: true, evidenceStorage: 'degraded', quota: { day: today(), used: 30, limit: 40000 }, ai: aiHealth(env, { day: today(), used: 3 }) });
        const response = await betaFetch(request(), env), body = await response.json();
        expect(response.status).toBe(200); expect(body.service.state).toBe('degraded');
        expect(body.service.reasons).toEqual(expect.arrayContaining(['admission-paused', 'lobby-readonly', 'shield-on', 'storage-degraded', 'identity-unconfigured', 'staff-unconfigured', 'contact-unconfigured', 'ai-misconfigured', 'turn-misconfigured']));
        expect(body.features.turn.providerUsage).toBe('unknown');
    });
    it('keeps owner email configuration distinct from a missing staff allowlist', async () => {
        const { env } = config(); env.HANGOUT_OWNER_EMAIL = '';
        const response = await betaFetch(request(), env), body = await response.json();
        expect(body.features.email.configured).toBe(true); expect(body.features.staffAuth.configured).toBe(false);
        expect(body.service.state).toBe('degraded'); expect(body.service.reasons).toContain('staff-unconfigured');
    });
    it('reports exhausted application admission budgets without presenting them as provider billing', async () => {
        const { env, binding } = config();
        env.QUOTA = binding({ storage: 'ok', quota: { day: today(), used: 200, limit: 200 } });
        env.BETA_SESSIONS = binding({ storage: 'ok', quota: { used: 1000, limit: 1000 } });
        env.LOBBY = binding({ storage: 'ok', lock: 'off', shield: false, lockAuto: false, evidenceStorage: 'ready', quota: { day: today(), used: 38000, limit: 40000 }, ai: aiHealth(env) });
        const response = await betaFetch(request(), env), body = await response.json();
        expect(response.status).toBe(200); expect(body.service.state).toBe('degraded');
        expect(body.service.reasons).toEqual(expect.arrayContaining(['connections-capped', 'sessions-capped', 'lobby-budget-closed']));
        expect(body.providerChecks).toBe('not-performed'); expect(body.usage.every((u) => u.scope === 'application')).toBe(true);
    });
    it('returns unavailable with fixed codes for failed/malformed storage and never copies errors or invents counters', async () => {
        const { env } = config();
        env.QUOTA.get = () => ({ fetch: async () => { throw Error('private provider token'); } });
        env.BETA_SESSIONS.get = () => ({ fetch: async () => new Response('not json: private@example.test') });
        const response = await betaFetch(request(), env), body = await response.json();
        expect(response.status).toBe(503); expect(body.service.state).toBe('unavailable'); expect(body.storage).toMatchObject({ quota: 'unavailable', registry: 'unavailable' });
        expect(body.usage.map((u) => u.name)).not.toContain('connections'); expect(JSON.stringify(body)).not.toMatch(/private@example|provider token/);
    });
    it('bounds a stalled internal read instead of leaving the monitor request pending forever', async () => {
        vi.useFakeTimers(); const { env } = config(); env.QUOTA.get = () => ({ fetch: () => new Promise(() => {}) });
        const pending = betaFetch(request(), env); await vi.advanceTimersByTimeAsync(5001);
        const response = await pending; expect(response.status).toBe(503); expect((await response.json()).storage.quota).toBe('unavailable');
    });
    it('cancels oversized internal responses without reflecting their contents', async () => {
        const { env } = config(); let cancelled = false;
        env.QUOTA.get = () => ({ fetch: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('private'.repeat(2000))); }, cancel() { cancelled = true; } })) });
        const response = await betaFetch(request(), env), body = await response.json();
        expect(response.status).toBe(503); expect(body.storage.quota).toBe('unavailable'); expect(JSON.stringify(body)).not.toContain('private'); expect(cancelled).toBe(true);
    });
});

describe('actual DO health reads do not spend or reset application state', () => {
    it('leaves admitted-session records, connection allowances, reports and abuse unchanged after normal wake', async () => {
        const { env } = config();
        const lobbyState = state([['beta-initialized', true], ['net', { lock: 'off', budget: { day: today(), requests: 17 } }], ['ai-usage', { day: today(), used: 4 }]]);
        const quotaState = state([[`c:${today()}`, 9]]), registryState = state();
        const record = { v: 1, sid: 'session-health-12345678', createdAt: Date.now(), exp: Date.now() + 3600000, version: '1', revoked: false, pending: false, attempt: 0, retryAt: 0, rooms: [] };
        registryState.values.set(`session:${record.sid}`, record);
        const lobby = new HangoutLobby(lobbyState, env), quota = new HangoutQuota(quotaState, env), registry = new BetaSessions(registryState, env);
        await lobby.ready;
        const namespace = (object) => ({ idFromName: (name) => name, get: () => object });
        env.LOBBY = namespace(lobby); env.QUOTA = namespace(quota); env.BETA_SESSIONS = namespace(registry);
        lobbyState.values.set('abuse', { marker: 'existing daily allowance' });
        const stores = [lobbyState, quotaState, registryState], before = stores.map((s) => structuredClone(s.values));
        stores.forEach((s) => { s.storage.put.mockClear(); s.storage.delete.mockClear(); });
        for (let i = 0; i < 3; i++) expect((await betaFetch(request(), env)).status).toBe(200);
        stores.forEach((s, i) => { expect(s.values).toEqual(before[i]); expect(s.storage.put).not.toHaveBeenCalled(); expect(s.storage.delete).not.toHaveBeenCalled(); });
        expect(lobby.engine._debug.conns.size).toBe(0); expect(lobby.engine._debug.channels.size).toBe(1); expect(registryState.values.size).toBe(1); expect(quotaState.values.get(`c:${today()}`)).toBe(9);
    });
    it('reports corrupt quota/registry storage as unavailable without resetting it', async () => {
        const { env } = config(), quotaState = state([[`c:${today()}`, 'broken']]), registryState = state([['session:invalid', { private: 'message' }]]);
        const quota = new HangoutQuota(quotaState, env), registry = new BetaSessions(registryState, env);
        const internal = new Request('https://ops' + INTERNAL_HEALTH_PATH);
        expect((await quota.fetch(internal)).status).toBe(503); expect((await registry.fetch(internal)).status).toBe(503);
        expect(quotaState.values.get(`c:${today()}`)).toBe('broken'); expect(registryState.values.size).toBe(1);
        expect(quotaState.storage.put).not.toHaveBeenCalled(); expect(registryState.storage.put).not.toHaveBeenCalled();
    });
    it('describes old-day allowances as a new period without mutating or resetting the stored record', () => {
        const stored = { day: '2025-01-01', used: 99 }; expect(dailyUsage(stored, 'used')).toEqual({ day: today(), used: 0 }); expect(stored.used).toBe(99);
        expect(aiHealth({ HANGOUT_AI_MODERATION: 'review', OPENAI_API_KEY: 'configured', HANGOUT_AI_DAILY_LIMIT: '10' }, { day: today(), used: 10 })).toMatchObject({ state: 'capped', quota: { used: 10, limit: 10 } });
        expect(aiHealth({ HANGOUT_AI_MODERATION: 'review', OPENAI_API_KEY: 'configured' }, { day: '2099-01-01', used: 1 }).quota).toBeNull();
    });
});
