// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index.mjs';
import { HangoutTurnBudget, TURN_TTL } from '../src/turn.mjs';
import { newDeviceId, signDevice } from '../src/auth.mjs';

const ROOM = 'a'.repeat(64);
const env = {
    HANGOUT_TURN_ENABLED: '1', HANGOUT_TURN_MONTHLY_GB: '800',
    HANGOUT_TURN_KEY_ID: 'test-key', HANGOUT_TURN_API_TOKEN: 'test-token',
    HANGOUT_TURN_ANALYTICS_TOKEN: 'test-analytics', HANGOUT_CF_ACCOUNT_ID: 'a'.repeat(32),
    HANGOUT_PREVIEW_KEY: 'p'.repeat(24), HANGOUT_HMAC_KEY: 'h'.repeat(40)
};
const ice = [{ urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username: 'test-user', credential: 'test-credential' }];
const usage = (bytes = 0) => Response.json({ data: { viewer: { accounts: [{ callsTurnUsageAdaptiveGroups: [{ sum: { egressBytes: bytes } }] }] } } });
let store, state, budget, upstream;
function issue(room = ROOM, device = newDeviceId(), target = budget) {
    return target.fetch(new Request('https://turn/issue', { method: 'POST', body: JSON.stringify({ room, device }) }));
}
async function request(body = {}, options = {}, e = env) {
    const device = await signDevice(newDeviceId(), e.HANGOUT_HMAC_KEY);
    const binding = { idFromName: (name) => name, get: () => ({ fetch: (url, init) => budget.fetch(new Request(url, init)) }) };
    return worker.fetch(new Request('https://relay.example/turn', {
        method: 'POST', headers: { Origin: 'https://stalemate.band' },
        body: JSON.stringify({ room: ROOM, preview: e.HANGOUT_PREVIEW_KEY, device, ...body }), ...options
    }), { ...e, TURN_BUDGET: binding });
}
beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-16T12:00:00Z'));
    store = new Map();
    state = { storage: {
        get: vi.fn(async (k) => structuredClone(store.get(k))),
        put: vi.fn(async (k, v) => { store.set(k, structuredClone(v)); })
    } };
    budget = new HangoutTurnBudget(state, env);
    upstream = vi.fn(async (url) => url.includes('/graphql') ? usage() : Response.json({ iceServers: ice }));
    vi.stubGlobal('fetch', upstream);
});
afterEach(() => vi.unstubAllGlobals());

describe('TURN public endpoint', () => {
    it('issues short-lived ICE config with no-store and exact-origin CORS', async () => {
        const res = await request();
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ iceServers: ice, ttl: TURN_TTL, expiresAt: Date.now() + 600000 });
        expect(res.headers.get('Cache-Control')).toBe('no-store');
        expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://stalemate.band');
        const [url, init] = upstream.mock.calls[1];
        expect(url).toBe('https://rtc.live.cloudflare.com/v1/turn/keys/test-key/credentials/generate-ice-servers');
        expect(init.headers.Authorization).toBe('Bearer test-token');
        expect(init.redirect).toBe('manual');
        expect(upstream.mock.calls[0][1].redirect).toBe('manual');
        expect(JSON.parse(init.body)).toEqual({ ttl: 600 });
        expect(JSON.parse(upstream.mock.calls[0][1].body).variables).toEqual({ account: env.HANGOUT_CF_ACCOUNT_ID, from: '2026-10-01', to: '2026-10-16' });
        expect(JSON.stringify([...store.values()])).not.toContain('test-credential');
    });
    it.each(['analytics', 'credentials'])('refuses a %s redirect without following it or returning credentials', async (stage) => {
        upstream.mockImplementation(async (url, options) => {
            if (options.redirect === 'error') throw new TypeError('Unsupported redirect mode');
            if (url.includes('/graphql') && stage !== 'analytics') return usage();
            return new Response('private provider diagnostic', { status: 307, headers: { Location: 'https://untrusted.example/collect' } });
        });
        const result = await request();
        expect(result.status).toBe(503);
        expect(await result.json()).toEqual({ iceServers: [], reason: 'TURN unavailable' });
        expect(upstream).toHaveBeenCalledTimes(stage === 'analytics' ? 1 : 2);
        for (const [url, options] of upstream.mock.calls) {
            expect(url).not.toContain('untrusted.example');
            expect(options.redirect).toBe('manual');
        }
        expect(store.get('ledger').reserved).toBe(stage === 'analytics' ? 0 : 0.1 * 1e9);
    });
    it.each([
        ['preview', { preview: 'wrong' }, 403], ['room', { room: 'invalid' }, 400],
        ['device', { device: 'forged' }, 403], ['missing device', { device: undefined }, 403]
    ])('rejects %s without an upstream request', async (_, body, status) => {
        expect((await request(body)).status).toBe(status);
        expect(upstream).not.toHaveBeenCalled();
    });
    it('denies foreign origins, handles preflight, and refuses GET', async () => {
        const bad = await request({}, { headers: { Origin: 'https://evil.example' } });
        expect(bad.status).toBe(403);
        expect(bad.headers.has('Access-Control-Allow-Origin')).toBe(false);
        expect((await request({}, { method: 'OPTIONS', body: undefined })).status).toBe(204);
        expect((await request({}, { method: 'GET', body: undefined })).status).toBe(405);
        expect(upstream).not.toHaveBeenCalled();
    });
    it('defaults off and fails closed when accounting is unavailable', async () => {
        expect((await request({}, {}, { ...env, HANGOUT_TURN_ENABLED: undefined })).status).toBe(503);
        state.storage.get.mockRejectedValue(new Error('private diagnostic'));
        const res = await request();
        expect(res.status).toBe(503);
        expect(await res.text()).not.toContain('private diagnostic');
        expect(upstream).not.toHaveBeenCalled();
    });
    it('bounds body size before parsing', async () => {
        expect((await request({}, { body: 'x'.repeat(4097) })).status).toBe(413);
        expect(upstream).not.toHaveBeenCalled();
    });
    it.each(['invalid json', 'null', '[]'])('rejects malformed request shape without upstream access: %s', async (body) => {
        expect((await request({}, { body })).status).toBe(400);
        expect(upstream).not.toHaveBeenCalled();
    });
});

describe('durable TURN accounting', () => {
    it('bounds outstanding requests while a provider call is stalled', async () => {
        let release;
        const stalled = new Promise((resolve) => { release = resolve; });
        upstream.mockImplementation(async (url) => {
            if (url.includes('/graphql')) { await stalled; return usage(); }
            return Response.json({ iceServers: ice });
        });
        const requests = Array.from({ length: 32 }, () => issue());
        expect(await (await issue()).json()).toMatchObject({ reason: 'rate limited' });
        release();
        await Promise.all(requests);
        expect(budget.pending).toBe(0);
    });
    it('limits devices across rooms, and rooms across devices; windows expire', async () => {
        const device = newDeviceId();
        expect((await issue(ROOM, device)).status).toBe(200);
        expect((await issue('b'.repeat(64), device)).status).toBe(200);
        expect((await issue('c'.repeat(64), device)).status).toBe(429);
        for (let i = 0; i < 15; i++) expect((await issue()).status).toBe(200);
        expect(await (await issue()).json()).toMatchObject({ reason: 'rate limited' });
        vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 600001);
        expect((await issue(ROOM, device)).status).toBe(200);
    });
    it('serializes simultaneous requests and persists the monthly allowance across restart', async () => {
        const config = { ...env, HANGOUT_TURN_MONTHLY_GB: '0.2' };
        budget = new HangoutTurnBudget(state, config);
        const results = await Promise.all([issue(), issue(), issue()]);
        expect(results.map((r) => r.status)).toEqual([200, 200, 429]);
        expect(await results[2].json()).toEqual({ iceServers: [], reason: 'budget used' });
        budget = new HangoutTurnBudget(state, config);
        expect((await issue()).status).toBe(429);
        vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-01T00:00:00Z'));
        expect((await issue()).status).toBe(200);
        expect(store.get('ledger')).toMatchObject({ month: '2026-11', reserved: 100000000 });
    });
    it('refuses measured account usage plus reservations at the threshold', async () => {
        upstream.mockImplementation(async () => usage(800e9));
        const res = await issue();
        expect(await res.json()).toEqual({ iceServers: [], reason: 'budget used' });
        expect(upstream).toHaveBeenCalledTimes(1);
    });
    it('refreshes cached usage after a minute and never lowers the observed high water mark', async () => {
        await issue();
        vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60001);
        upstream.mockImplementation(async () => usage(800e9));
        expect((await issue()).status).toBe(429);
        vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60001);
        upstream.mockImplementation(async () => usage(0));
        expect((await issue()).status).toBe(429);
    });
    it.each([
        () => Response.json({ errors: [{ message: 'unauthorized' }] }),
        () => Response.json({ data: { viewer: { accounts: [] } } }),
        () => usage(-1), () => usage('0'), () => new Response('upstream details', { status: 500 }),
        () => { throw new Error('network'); }
    ])('fails closed on invalid/unavailable analytics', async (response) => {
        upstream.mockImplementation(response);
        expect((await issue()).status).toBe(503);
        expect(upstream).toHaveBeenCalledTimes(1);
    });
    it('keeps a reservation after upstream failure and hides upstream error bodies', async () => {
        upstream.mockImplementation(async (url) => url.includes('/graphql') ? usage() : new Response('private diagnostic', { status: 401 }));
        const res = await issue();
        expect(res.status).toBe(503);
        expect(await res.text()).not.toContain('private diagnostic');
        expect(store.get('ledger').reserved).toBe(100000000);
    });
    it('refuses missing configuration, malformed ICE and corrupt durable state', async () => {
        for (const key of ['HANGOUT_TURN_KEY_ID', 'HANGOUT_TURN_API_TOKEN', 'HANGOUT_TURN_ANALYTICS_TOKEN', 'HANGOUT_CF_ACCOUNT_ID', 'HANGOUT_TURN_MONTHLY_GB']) {
            expect((await issue(ROOM, newDeviceId(), new HangoutTurnBudget(state, { ...env, [key]: '' }))).status).toBe(503);
        }
        upstream.mockImplementation(async (url) => url.includes('/graphql') ? usage() : Response.json({ iceServers: [{ urls: ['turn:test'] }] }));
        expect((await issue()).status).toBe(503);
        store.set('ledger', { month: '2026-10', reserved: -1, observed: 0, rates: {} });
        expect((await issue()).status).toBe(503);
    });
});
