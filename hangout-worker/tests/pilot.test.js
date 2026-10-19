// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import pilot from '../src/pilot-entry.mjs';
import { PILOT_TTL, signPilot, readPilot, pilotSession } from '../src/pilot-auth.mjs';
const origin = 'https://pilot.example';
const op = 'operator-test-key-'.repeat(3);
const guest = 'guest-test-key-'.repeat(3);
const secret = 'signing-test-key-'.repeat(3);
function env() { return { PILOT_MODE: 'protected', PILOT_OPERATOR_KEY: op, HANGOUT_PREVIEW_KEY: guest, HANGOUT_HMAC_KEY: secret, ASSETS: { fetch: vi.fn(async () => new Response('<head><meta name="hangout-relay" content=""></head><body>Private room</body>', { headers: { 'Content-Type': 'text/html' } })) }, LOBBY: { idFromName: (n) => n, get: () => ({ fetch: async () => new Response('socket') }) }, QUOTA: { idFromName: (n) => n, get: () => ({ fetch: async () => new Response('ok') }) } }; }
const request = (path, { method = 'GET', body, cookie, from = origin } = {}) => new Request(origin + path, { method, headers: { Origin: from, ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
const cookie = (response) => response.headers.get('Set-Cookie').split(';')[0];
async function unlock(config, key) { return cookie(await pilot.fetch(request('/pilot/unlock', { method: 'POST', body: { key } }), config)); }

describe('separate protected hosted pilot', () => {
    it('protects every product asset and state, including JS and HEAD, before asset lookup', async () => {
        const config = env();
        for (const path of ['/r/45662413410ed051/lobby/', '/r/45662413410ed051/lobby/lobby.js', '/assets/favicon.svg', '/pilot/state', '/pilot/bootstrap.js']) {
            const result = await pilot.fetch(request(path), config); expect(result.status).toBe(401);
            expect(result.headers.get('X-Robots-Tag')).toContain('noindex');
        }
        expect((await pilot.fetch(request('/assets/favicon.svg', { method: 'HEAD' }), config)).status).toBe(401);
        expect(config.ASSETS.fetch).not.toHaveBeenCalled();
    });
    it('fails closed before serving assets if a pilot secret or binding is missing', async () => {
        for (const missing of ['PILOT_MODE', 'PILOT_OPERATOR_KEY', 'HANGOUT_PREVIEW_KEY', 'HANGOUT_HMAC_KEY', 'ASSETS', 'LOBBY', 'QUOTA']) {
            const config = env(); delete config[missing];
            expect((await pilot.fetch(request('/r/45662413410ed051/lobby/'), config)).status).toBe(503);
        }
    });
    it('requires exact-origin JSON admission and refuses invalid invitation codes', async () => {
        const config = env();
        expect((await pilot.fetch(request('/pilot/unlock', { method: 'POST', body: { key: op }, from: 'https://outside.example' }), config)).status).toBe(403);
        expect((await pilot.fetch(request('/pilot/unlock', { method: 'POST', body: { key: 'wrong' } }), config)).status).toBe(403);
        const response = await pilot.fetch(request('/pilot/unlock', { method: 'POST', body: { key: op } }), config);
        expect(response.headers.get('Set-Cookie')).toContain('HttpOnly; Secure; SameSite=Strict');
    });
    it('guest invitation grants real guest access without role escalation or operator invite disclosure', async () => {
        const config = env(); const auth = await unlock(config, guest);
        const result = await pilot.fetch(request('/pilot/state', { cookie: auth }), config);
        expect(await result.json()).toMatchObject({ role: 'fan', operator: false });
        expect((await pilot.fetch(request('/pilot/identity', { method: 'POST', cookie: auth, body: { role: 'owner', label: 'Impersonator' } }), config)).status).toBe(403);
        const page = await pilot.fetch(request('/r/45662413410ed051/lobby/', { cookie: auth }), config);
        expect(await page.text()).toContain('Private Stalemate pilot');
        expect(page.headers.get('Cache-Control')).toBe('no-store');
    });
    it('operator can explicitly select a room-owner stand-in, bound to its invitation session', async () => {
        const config = env(); const auth = await unlock(config, op);
        const response = await pilot.fetch(request('/pilot/identity', { method: 'POST', cookie: auth, body: { role: 'room-owner', label: 'JeffTest' } }), config);
        const identity = cookie(response); const combined = `${auth}; ${identity}`;
        expect((await pilotSession(request('/pilot/state', { cookie: combined }), config)).identity).toMatchObject({ role: 'room-owner', label: 'JeffTest' });
        const other = await unlock(config, op);
        expect((await pilotSession(request('/pilot/state', { cookie: `${other}; ${identity}` }), config)).identity.role).toBe('fan');
        const page = await pilot.fetch(request('/pilot/bootstrap.js', { cookie: combined }), config);
        expect(await page.text()).toContain("sessionStorage.setItem('hangout-owner',\"1\")");
    });
    it('rejects tampered, expired and wrong-purpose cookie signatures', async () => {
        const claims = { v: 1, exp: Date.now() + PILOT_TTL - 100, sid: 'test-session-1234567890', scope: 'operator' };
        const token = await signPilot('access', claims, secret);
        expect(await readPilot('access', token + 'x', secret)).toBeNull();
        expect(await readPilot('identity', token, secret)).toBeNull();
        expect(await readPilot('access', token, secret, claims.exp + 1)).toBeNull();
    });
    it('does not accept staff or owner socket requests through guest access', async () => {
        const config = env(); const auth = await unlock(config, guest);
        for (const path of ['/lobby-admin', '/lobby-owner']) {
            const r = new Request(`${origin}${path}?preview=${guest}`, { headers: { Cookie: auth, Origin: origin, Upgrade: 'websocket' } });
            expect((await pilot.fetch(r, config)).status).toBe(403);
        }
    });
});

it('bounds chunked POST bodies and rejects JSON null without throwing', async () => {
    const config = env();
    const malformed = new Request(origin + '/pilot/unlock', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: 'null' });
    expect((await pilot.fetch(malformed, config)).status).toBe(400);
    let cancelled = false;
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(4096)); }, cancel() { cancelled = true; } });
    const request = new Request(origin + '/pilot/unlock', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body, duplex: 'half' });
    expect((await pilot.fetch(request, config)).status).toBe(400);
    expect(cancelled).toBe(true);
});
