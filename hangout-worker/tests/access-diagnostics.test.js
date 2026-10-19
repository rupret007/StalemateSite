// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminGate, ownerGate } from '../src/lobby-do.mjs';
import { betaFetch } from '../src/beta-entry.mjs';
import { BETA_COOKIE, signBeta } from '../src/beta-auth.mjs';

const origin = 'https://diagnostics.example';
const canary = 'SYNTHETIC-DO-NOT-LOG-Bearer-private-token-user@example.invalid';
const ownerAud = 'a'.repeat(64), staffAud = 'b'.repeat(64);
let pair, jwk, warning, sequence = 0;
beforeAll(async () => {
    pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
    jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'diagnostics-test' };
});
beforeEach(() => { warning = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function config() {
    return {
        HANGOUT_BETA_MODE: 'protected', HANGOUT_BETA_INVITE_VERSION: '1',
        HANGOUT_BETA_INVITE_KEY: 'synthetic-private-invitation-'.repeat(2),
        HANGOUT_HMAC_KEY: 'synthetic-signature-secret-'.repeat(2),
        HANGOUT_PREVIEW_KEY: 'synthetic-preview-admission-'.repeat(2),
        // A different trusted URL per test avoids relying on the module's warm JWKS cache.
        HANGOUT_ACCESS_TEAM: `diagnostics-${++sequence}.cloudflareaccess.com`,
        HANGOUT_OWNER_ACCESS_AUD: ownerAud, HANGOUT_ACCESS_AUD: staffAud,
        HANGOUT_OWNER_EMAIL: 'operator@example.invalid',
        ASSETS: {}, LOBBY: {}, QUOTA: {}, ROOMS: {},
        BETA_SESSIONS: { idFromName: name => name, get: () => ({ fetch: async () => Response.json({ ok: true }) }) }
    };
}
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
async function jwt(env, { kind = 'owner', claims = {}, header = {}, signature } = {}) {
    const body = `${b64({ alg: 'RS256', kid: jwk.kid, ...header })}.${b64({ iss: `https://${env.HANGOUT_ACCESS_TEAM}`, aud: [kind === 'owner' ? ownerAud : staffAud], exp: Math.floor(Date.now() / 1000) + 600, email: 'operator@example.invalid', ...claims })}`;
    const bytes = signature || await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(body));
    return `${body}.${Buffer.from(bytes).toString('base64url')}`;
}
function request(path, token, cookie = '') {
    return new Request(`${origin}${path}?private=${encodeURIComponent(canary)}`, { headers: {
        Origin: origin, ...(token ? { 'Cf-Access-Jwt-Assertion': token } : {}), ...(cookie ? { Cookie: cookie } : {})
    } });
}
async function guestCookie(env) {
    const claims = { v: 1, sid: 'diagnostics-session-123456', scope: 'guest', version: '1', exp: Date.now() + 600000 };
    return `${BETA_COOKIE}=${await signBeta('access', claims, env.HANGOUT_HMAC_KEY)}`;
}
const keys = { fetchJwks: async () => ({ keys: [jwk] }) };
const routes = [['owner', ownerGate, '/lobby-owner/login', 'owner-signin'], ['staff', adminGate, '/lobby-admin/login', 'access']];

describe('bounded Access rejection categories', () => {
    it.each(routes)('%s distinguishes missing and malformed assertions without provider access', async (kind, gate, path, reason) => {
        const env = config(), fetchJwks = vi.fn();
        for (const [token, check] of [[undefined, 'missing'], [canary, 'malformed']]) {
            expect(await gate(request(path, token), env, { fetchJwks })).toEqual({ status: 403, reason, check });
        }
        expect(fetchJwks).not.toHaveBeenCalled();
        expect(warning).not.toHaveBeenCalled();
    });
    it.each(routes)('%s accepts a correctly signed route-specific assertion without rejection logs', async (kind, gate, path) => {
        const env = config(), token = await jwt(env, { kind });
        const result = await gate(request(path, token), env, keys);
        expect(result.ok).toBe(true);
        expect(result.identity.email).toBe('operator@example.invalid');
        if (kind === 'staff') expect(result.identity).toMatchObject({ admin: true, role: 'owner' });
        expect(warning).not.toHaveBeenCalled();
    });
    it.each([
        ['issuer', { claims: { iss: 'https://untrusted.example' } }],
        ['audience', { claims: { aud: [staffAud] } }],
        ['expired', { claims: { exp: 1 } }],
        ['not-yet', { claims: { nbf: Math.floor(Date.now() / 1000) + 3600 } }],
        ['email', { claims: { email: canary.replace('@', '-') } }],
        ['alg', { header: { alg: 'HS256' } }],
        ['kid', { header: { kid: canary } }],
        ['signature', { signature: new Uint8Array(256) }]
    ])('preserves the fixed %s category without exposing claims', async (check, options) => {
        const env = config(), token = await jwt(env, options);
        expect(await ownerGate(request('/lobby-owner/login', token), env, keys)).toEqual({ status: 403, reason: 'owner-signin', check });
        expect(warning).not.toHaveBeenCalled();
    });
    it.each(routes)('%s discards arbitrary secret-looking provider exceptions', async (kind, gate, path, reason) => {
        const env = config(), token = await jwt(env, { kind });
        const result = await gate(request(path, token), env, { fetchJwks: async () => { throw new Error(canary); } });
        expect(result).toEqual({ status: 403, reason, check: 'jwks' });
        expect(JSON.stringify(result)).not.toContain(canary);
        expect(warning).not.toHaveBeenCalled();
    });
    it.each(routes)('%s categorizes invalid provider keys without leaking key material', async (kind, gate, path, reason) => {
        const env = config(), token = await jwt(env, { kind });
        const result = await gate(request(path, token), env, { fetchJwks: async () => ({ keys: [{ kid: jwk.kid, kty: 'oct', k: canary }] }) });
        expect(result).toEqual({ status: 403, reason, check: 'crypto' });
        expect(JSON.stringify(result)).not.toContain(canary);
        expect(warning).not.toHaveBeenCalled();
    });
});

describe('actual beta callback boundary', () => {
    it.each(routes)('%s keeps responses generic while emitting only fixed route/category', async (kind, gate, path) => {
        const env = config(), cookie = await guestCookie(env), token = await jwt(env, { kind });
        const response = await betaFetch(request(path, token, cookie), env, { fetchJwks: async () => { throw new Error(canary); } });
        expect(response.status).toBe(403);
        expect(await response.text()).toBe(kind === 'owner' ? 'Verified email sign-in required.' : 'Restricted moderator sign-in required.');
        expect(response.headers.has('Set-Cookie')).toBe(false);
        expect(warning.mock.calls).toEqual([['hangout.access-denied', kind, 'jwks']]);
        const serialized = JSON.stringify(warning.mock.calls);
        expect(serialized).not.toContain(canary);
        expect(serialized).not.toContain(token);
        expect(serialized).not.toContain(cookie);
        expect(serialized).not.toContain('operator@example.invalid');
    });
    it.each(routes)('%s completes a valid callback without diagnostic output', async (kind, gate, path) => {
        const env = config(), cookie = await guestCookie(env), token = await jwt(env, { kind });
        const response = await betaFetch(request(path, token, cookie), env, keys);
        expect(response.status).toBe(303);
        expect(response.headers.has('Set-Cookie')).toBe(true);
        expect(warning).not.toHaveBeenCalled();
    });
});

describe('Workers-compatible public JWKS fetch', () => {
    it('uses manual redirect handling and accepts valid keys through the real fetch path', async () => {
        const env = config(), token = await jwt(env);
        const provider = vi.fn(async (url, init) => {
            // Model the Workers runtime discrepancy that Node's native fetch permits.
            if (init?.redirect === 'error') throw new TypeError(canary);
            expect(init?.redirect).toBe('manual');
            expect(url).toBe(`https://${env.HANGOUT_ACCESS_TEAM}/cdn-cgi/access/certs`);
            expect(init?.headers).toBeUndefined();
            expect(init?.body).toBeUndefined();
            expect(init?.signal).toBeInstanceOf(AbortSignal);
            return Response.json({ keys: [jwk] });
        });
        vi.stubGlobal('fetch', provider);
        expect((await ownerGate(request('/lobby-owner/login', token), env)).ok).toBe(true);
        expect(provider).toHaveBeenCalledTimes(1);
        expect(warning).not.toHaveBeenCalled();
    });
    it.each([301, 302, 303, 307, 308])('refuses provider HTTP %s without following Location or issuing an identity', async status => {
        const env = config(), token = await jwt(env), cookie = await guestCookie(env);
        const provider = vi.fn(async () => new Response(null, { status, headers: { Location: `https://untrusted.example/${canary}` } }));
        vi.stubGlobal('fetch', provider);
        const response = await betaFetch(request('/lobby-owner/login', token, cookie), env);
        expect(response.status).toBe(403);
        expect(await response.text()).toBe('Verified email sign-in required.');
        expect(response.headers.has('Set-Cookie')).toBe(false);
        expect(provider).toHaveBeenCalledTimes(1);
        expect(provider.mock.calls[0][1].redirect).toBe('manual');
        expect(warning.mock.calls).toEqual([['hangout.access-jwks', 'status', status], ['hangout.access-denied', 'owner', 'jwks']]);
        expect(JSON.stringify(warning.mock.calls)).not.toContain(canary);
        expect(JSON.stringify(warning.mock.calls)).not.toContain(token);
    });
    it('redacts thrown request error text and unrecognized error names', async () => {
        const env = config(), token = await jwt(env), cookie = await guestCookie(env);
        const error = new Error(canary); error.name = canary;
        vi.stubGlobal('fetch', vi.fn(async () => { throw error; }));
        const response = await betaFetch(request('/lobby-owner/login', token, cookie), env);
        expect(response.status).toBe(403);
        expect(response.headers.has('Set-Cookie')).toBe(false);
        expect(warning.mock.calls).toEqual([['hangout.access-jwks', 'request', 'Error'], ['hangout.access-denied', 'owner', 'jwks']]);
        expect(JSON.stringify(warning.mock.calls)).not.toContain(canary);
    });
    it('refuses malformed provider JSON without logging its contents', async () => {
        const env = config(), token = await jwt(env), cookie = await guestCookie(env);
        vi.stubGlobal('fetch', vi.fn(async () => new Response(canary, { headers: { 'Content-Type': 'application/json' } })));
        const response = await betaFetch(request('/lobby-owner/login', token, cookie), env);
        expect(response.status).toBe(403);
        expect(response.headers.has('Set-Cookie')).toBe(false);
        expect(warning.mock.calls).toEqual([['hangout.access-jwks', 'body', 'invalid-json'], ['hangout.access-denied', 'owner', 'jwks']]);
        expect(JSON.stringify(warning.mock.calls)).not.toContain(canary);
    });
});
