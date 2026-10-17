// @vitest-environment node
// Admin auth (Cloudflare Access JWT), signed device ids, IP hashing, and the Worker-side lobby gate.
import { describe, expect, it } from 'vitest';
import { verifyAccessJwt, roleForEmail, signDevice, verifyDevice, ipHash, newDeviceId, accessConfigured } from '../../hangout-worker/src/auth.mjs';
import { lobbyGate, lobbyConfigured } from '../../hangout-worker/src/lobby-do.mjs';

const TEAM = 'stalemate.cloudflareaccess.com';
const AUD = 'a'.repeat(64);
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
async function keys() {
    const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
    const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1' };
    return { pair, jwks: { keys: [jwk] } };
}
async function token(pair, claims, header = { alg: 'RS256', kid: 'k1' }) {
    const body = `${b64(header)}.${b64(claims)}`;
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(body));
    return `${body}.${Buffer.from(sig).toString('base64url')}`;
}
const now = Date.now();
const good = { iss: `https://${TEAM}`, aud: [AUD], exp: Math.floor(now / 1000) + 600, email: 'Jeff@Example.com' };

describe('Cloudflare Access JWT', async () => {
    const { pair, jwks } = await keys();
    const other = await keys();
    const opts = { team: TEAM, aud: AUD, now, fetchJwks: async () => jwks };
    it('accepts a valid token and lowercases the email', async () => {
        expect(await verifyAccessJwt(await token(pair, good), opts)).toEqual({ email: 'jeff@example.com' });
    });
    it.each([
        ['missing', async () => ''],
        ['bad aud', async () => token(pair, { ...good, aud: ['nope'] })],
        ['expired', async () => token(pair, { ...good, exp: Math.floor(now / 1000) - 1 })],
        ['wrong issuer', async () => token(pair, { ...good, iss: 'https://evil.cloudflareaccess.com' })],
        ['wrong key', async () => token(other.pair, good)],
        ['alg none', async () => `${b64({ alg: 'none', kid: 'k1' })}.${b64(good)}.`],
        ['HS256 confusion', async () => token(pair, good, { alg: 'HS256', kid: 'k1' })],
        ['unknown kid', async () => token(pair, good, { alg: 'RS256', kid: 'zz' })],
        ['no email', async () => token(pair, { ...good, email: undefined })],
        ['tampered', async () => { const t = await token(pair, good); const [h, , s] = t.split('.'); return `${h}.${b64({ ...good, email: 'evil@x.com' })}.${s}`; }]
    ])('rejects %s', async (_name, make) => {
        await expect(verifyAccessJwt(await make(), opts)).rejects.toThrow();
    });
    it('maps emails to owner / band from env, refuses everyone else', () => {
        const env = { HANGOUT_OWNER_EMAIL: 'jeff@example.com', HANGOUT_BAND_EMAILS: 'drums@example.com, bass@example.com' };
        expect(roleForEmail('jeff@example.com', env)).toBe('owner');
        expect(roleForEmail('bass@example.com', env)).toBe('band');
        expect(roleForEmail('fan@example.com', env)).toBeNull();
        expect(roleForEmail('x@y.z', {})).toBeNull();
    });
    it('only treats Access as configured with real-looking public ids', () => {
        expect(accessConfigured({})).toBe(false);
        expect(accessConfigured({ HANGOUT_ACCESS_TEAM: TEAM, HANGOUT_ACCESS_AUD: AUD })).toBe(true);
        expect(accessConfigured({ HANGOUT_ACCESS_TEAM: 'evil.com', HANGOUT_ACCESS_AUD: AUD })).toBe(false);
    });
});

describe('device ids and IP hashing', () => {
    const KEY = 'k'.repeat(40);
    it('signed device ids verify; forged or re-signed ones do not', async () => {
        const id = newDeviceId();
        const tok = await signDevice(id, KEY);
        expect(await verifyDevice(tok, KEY)).toBe(id);
        expect(await verifyDevice(tok, 'x'.repeat(40))).toBeNull();
        expect(await verifyDevice(`${newDeviceId()}.${tok.split('.')[1]}`, KEY)).toBeNull();
        expect(await verifyDevice('garbage', KEY)).toBeNull();
    });
    it('IP hash is daily, keyed and never contains the IP', async () => {
        const a = await ipHash('203.0.113.9', KEY, now);
        expect(a).not.toContain('203');
        expect(await ipHash('203.0.113.9', KEY, now)).toBe(a);
        expect(await ipHash('203.0.113.9', KEY, now + 86400000)).not.toBe(a);
    });
});

describe('Worker lobby gate fails closed', async () => {
    const { pair, jwks } = await keys();
    const env = { LOBBY: {}, QUOTA: {}, HANGOUT_HMAC_KEY: 'h'.repeat(40), HANGOUT_PREVIEW_KEY: 'p'.repeat(24), HANGOUT_TURNSTILE_SECRET: 'ts', HANGOUT_ACCESS_TEAM: TEAM, HANGOUT_ACCESS_AUD: AUD, HANGOUT_OWNER_EMAIL: 'jeff@example.com' };
    const req = (path, headers = {}, q = `preview=${'p'.repeat(24)}&ts=tok`) => {
        const url = new URL(`https://w.example${path}?${q}`);
        return [new Request(url, { headers: { Upgrade: 'websocket', Origin: 'https://stalemate.band', ...headers } }), url];
    };
    const deps = { turnstile: async (t) => t === 'tok', fetchJwks: async () => jwks };
    it('503 when any secret or binding is missing, or the kill switch is set', async () => {
        for (const drop of ['LOBBY', 'QUOTA', 'HANGOUT_HMAC_KEY', 'HANGOUT_PREVIEW_KEY', 'HANGOUT_TURNSTILE_SECRET']) {
            const e = { ...env }; delete e[drop];
            expect(lobbyConfigured(e)).toBe(false);
            expect((await lobbyGate(req('/lobby')[0], e, req('/lobby')[1], deps)).status).toBe(503);
        }
        expect((await lobbyGate(req('/lobby')[0], { ...env, HANGOUT_OPEN: '0' }, req('/lobby')[1], deps)).reason).toBe('back-soon');
        expect((await lobbyGate(req('/lobby')[0], { ...env, HANGOUT_HMAC_KEY: 'short' }, req('/lobby')[1], deps)).status).toBe(503);
    });
    it('fans need origin, preview key and a Turnstile pass', async () => {
        const [r0, u0] = req('/lobby', { Origin: 'https://evil.com' });
        expect((await lobbyGate(r0, env, u0, deps)).reason).toBe('origin');
        const [r1, u1] = req('/lobby', {}, 'preview=wrong&ts=tok');
        expect((await lobbyGate(r1, env, u1, deps)).reason).toBe('preview');
        const [r2, u2] = req('/lobby', {}, `preview=${'p'.repeat(24)}&ts=bad`);
        expect((await lobbyGate(r2, env, u2, deps)).reason).toBe('bot-check');
        const [r3, u3] = req('/lobby');
        const ok = await lobbyGate(r3, env, u3, deps);
        expect(ok.ok).toBe(true);
        expect(ok.identity.role).toBe('fan');
        expect(ok.identity.devToken).toMatch(/\./);
    });
    it('a fan cannot become band by asking: /lobby ignores role params, /lobby-admin needs a valid Access JWT', async () => {
        const [r, u] = req('/lobby', { 'Cf-Access-Jwt-Assertion': await token(pair, good) }, `preview=${'p'.repeat(24)}&ts=tok&role=owner&admin=1`);
        expect((await lobbyGate(r, env, u, deps)).identity.role).toBe('fan');
        const [r2, u2] = req('/lobby-admin');
        expect((await lobbyGate(r2, env, u2, deps)).reason).toBe('access');
        const [r3, u3] = req('/lobby-admin', { 'Cf-Access-Jwt-Assertion': await token(pair, { ...good, email: 'fan@x.com' }) });
        expect((await lobbyGate(r3, env, u3, deps)).reason).toBe('not-band');
        const [r4, u4] = req('/lobby-admin', { 'Cf-Access-Jwt-Assertion': await token(pair, good) });
        const g = await lobbyGate(r4, env, u4, deps);
        expect(g.identity).toMatchObject({ role: 'owner', admin: true });
        const e2 = { ...env, HANGOUT_ACCESS_AUD: '' };
        expect((await lobbyGate(r4, e2, u4, deps)).status).toBe(503);
    });
});
