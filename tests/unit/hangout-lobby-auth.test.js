// @vitest-environment node
// Admin auth (Cloudflare Access JWT), signed device ids, IP hashing, and the Worker-side lobby gate.
import { describe, expect, it } from 'vitest';
import { verifyAccessJwt, roleForEmail, signDevice, verifyDevice, deviceFromCookie, deviceCookie, DEVICE_TOKEN_TTL_MS, ipHash, newDeviceId, accessConfigured } from '../../hangout-worker/src/auth.mjs';
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
        expect(await verifyAccessJwt(await token(pair, good), opts)).toEqual({ email: 'jeff@example.com', expiresAt: good.exp * 1000 });
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
        expect(await verifyDevice(`${newDeviceId()}.${tok.split('.').slice(1).join('.')}`, KEY)).toBeNull();
        expect(await verifyDevice('garbage', KEY)).toBeNull();
    });
    it('rejects expired and legacy two-part device tokens', async () => {
        const id = newDeviceId();
        const tok = await signDevice(id, KEY, now);
        expect(await verifyDevice(tok, KEY, now + DEVICE_TOKEN_TTL_MS + 1)).toBeNull();
        expect(await verifyDevice(`${id}.${'x'.repeat(32)}`, KEY)).toBeNull();
    });
    it('reads device tokens from the HttpOnly cookie name', async () => {
        const id = newDeviceId();
        const tok = await signDevice(id, KEY);
        const req = new Request('https://w.example/lobby', { headers: { Cookie: `${deviceCookie(tok).split(';')[0]}` } });
        expect(deviceFromCookie(req)).toBe(tok);
        expect(deviceFromCookie(new Request('https://w.example/lobby'))).toBeNull();
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
    it('separates public owner authentication from moderator authorization', async () => {
        const ownerAud = 'b'.repeat(64);
        const config = { ...env, HANGOUT_OWNER_ACCESS_AUD: ownerAud, HANGOUT_MODERATOR_EMAILS: 'helper@example.com' };
        const jwt = await token(pair, { ...good, email: 'helper@example.com', aud: [ownerAud] });
        const [ownerReq, ownerUrl] = req('/lobby-owner', { 'Cf-Access-Jwt-Assertion': jwt });
        const result = await lobbyGate(ownerReq, config, ownerUrl, deps);
        expect(result.identity).toMatchObject({ role: 'fan', admin: false, email: '' });
        expect(result.identity.account).toMatch(/^a_/);
        const [staffReq, staffUrl] = req('/lobby-admin', { 'Cf-Access-Jwt-Assertion': jwt });
        expect((await lobbyGate(staffReq, config, staffUrl, deps)).status).toBe(403);
        const staffJwt = await token(pair, { ...good, email: 'helper@example.com' });
        const [verified, verifiedUrl] = req('/lobby-admin', { 'Cf-Access-Jwt-Assertion': staffJwt });
        expect((await lobbyGate(verified, config, verifiedUrl, deps)).identity.role).toBe('moderator');
    });
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
    it('device auth uses HttpOnly cookie only and ignores query or subprotocol tokens', async () => {
        const id = newDeviceId();
        const tok = await signDevice(id, env.HANGOUT_HMAC_KEY, Date.now() - 1000);
        const q = `preview=${'p'.repeat(24)}&ts=tok&dev=${encodeURIComponent(tok)}`;
        const [rUrl, uUrl] = req('/lobby', {}, q);
        const viaUrl = await lobbyGate(rUrl, env, uUrl, deps);
        expect(viaUrl.ok).toBe(true);
        expect(viaUrl.identity.dev).not.toBe(id);
        const [rProto, uProto] = req('/lobby', { 'Sec-WebSocket-Protocol': `hangout, dev.${tok}` });
        const viaProto = await lobbyGate(rProto, env, uProto, deps);
        expect(viaProto.ok).toBe(true);
        expect(viaProto.identity.dev).not.toBe(id);
        const [rCookie, uCookie] = req('/lobby', { Cookie: `${deviceCookie(tok).split(';')[0]}` });
        const viaCookie = await lobbyGate(rCookie, env, uCookie, deps);
        expect(viaCookie.ok).toBe(true);
        expect(viaCookie.identity.dev).toBe(id);
        expect(viaCookie.identity.devToken).toMatch(/\./);
        expect(viaCookie.identity.devToken).not.toBe(tok);
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
