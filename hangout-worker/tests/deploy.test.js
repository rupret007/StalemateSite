// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import worker from '../src/index.mjs';
import { createLobby, BOT, LOBBY_LIMITS } from '../src/lobby-core.mjs';

const TEAM = 'deploy-test.cloudflareaccess.com';
const env = { HANGOUT_ACCESS_TEAM: TEAM, HANGOUT_ACCESS_AUD: 'a'.repeat(64), HANGOUT_OWNER_EMAIL: 'jeff@example.test', HANGOUT_BAND_EMAILS: 'band@example.test', HANGOUT_ADMIN_RETURN: 'https://stalemate.band/r/0000000000000000/admin/' };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
async function signed(email, overrides = {}) {
    const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
    const jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'deploy-test' };
    const body = `${b64({ alg: 'RS256', kid: jwk.kid })}.${b64({ iss: `https://${TEAM}`, aud: [env.HANGOUT_ACCESS_AUD], exp: Date.now() / 1000 + 600, email, ...overrides })}`;
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(body));
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ keys: [jwk] })));
    return `${body}.${Buffer.from(sig).toString('base64url')}`;
}
afterEach(() => vi.unstubAllGlobals());
const login = (token, config = env) => worker.fetch(new Request('https://relay.example/lobby-admin/login', { headers: token ? { 'Cf-Access-Jwt-Assertion': token } : {} }), config);

describe('Access login is fail closed at the Worker', () => {
    it('denies missing and invalid JWTs even with a valid redirect target', async () => {
        for (const jwt of ['', 'forged.header.signature', `${b64({ alg: 'none' })}.${b64({ email: env.HANGOUT_OWNER_EMAIL })}.`]) {
            const res = await login(jwt);
            expect(res.status).toBe(403);
            expect(res.headers.has('Location')).toBe(false);
        }
        expect((await login('invalid', { ...env, HANGOUT_ACCESS_AUD: '' })).status).toBe(503);
    });
    it('allows a signed Jeff/band JWT, rejects unknown email and wrong audience', async () => {
        // Change team per case so this also tests URL-keyed JWKS caching.
        for (const [email, aud, status] of [[env.HANGOUT_OWNER_EMAIL, env.HANGOUT_ACCESS_AUD, 302], [env.HANGOUT_BAND_EMAILS, env.HANGOUT_ACCESS_AUD, 302], ['outsider@example.test', env.HANGOUT_ACCESS_AUD, 403], [env.HANGOUT_OWNER_EMAIL, 'wrong', 403]]) {
            const team = `case-${status}-${email.split('@')[0]}-${aud.slice(0, 2)}.cloudflareaccess.com`;
            const jwt = await signed(email, { aud: [aud], iss: `https://${team}` });
            const res = await login(jwt, { ...env, HANGOUT_ACCESS_TEAM: team });
            expect(res.status).toBe(status);
            if (status === 302) expect(res.headers.get('Location')).toBe(env.HANGOUT_ADMIN_RETURN);
        }
    });
});

describe('approved deployment decisions', () => {
    it('keeps StaleBot and an open lobby, then auto-locks exactly at 24h without band', () => {
        let now = 1800000000000;
        const lobby = createLobby({ now: () => now });
        expect(BOT).toBe('StaleBot');
        expect(LOBBY_LIMITS.noBandShield).toBe(86400000);
        expect(lobby.snapshot().lock).toBe('off');
        now += 86400000 - 1; lobby.tick();
        expect(lobby.snapshot().lock).toBe('off');
        now += 1; lobby.tick();
        expect(lobby.snapshot()).toMatchObject({ lock: 'readonly', lockAuto: true });
    });
    it('keeps lobby cameras off until explicit 18+ consent', () => {
        const lobby = createLobby();
        lobby.connect({ id: 'fan', dev: 'test-device', iph: 'test-ip' });
        const send = (body) => lobby.message('fan', JSON.stringify(body));
        send({ t: 'hello', nick: 'TestFan', age13: true });
        send({ t: 'cmd', name: 'join', args: ['#art-cams'], ch: '#stalemate' });
        const cameras = lobby._debug.conns.get('fan').cams;
        expect(cameras.size).toBe(0);
        send({ t: 'cam', ch: '#art-cams', on: true });
        expect(cameras.size).toBe(0);
        send({ t: 'cam', ch: '#art-cams', on: true, adult18: true });
        expect(cameras.has('#art-cams')).toBe(true);
    });
    it('ships empty public Access/account placeholders, an open lobby and disabled TURN', () => {
        const config = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
        for (const name of ['HANGOUT_ACCESS_TEAM', 'HANGOUT_ACCESS_AUD', 'HANGOUT_CF_ACCOUNT_ID']) expect(config).toContain(`${name} = ""`);
        expect(config).toContain('HANGOUT_OPEN = "1"');
        expect(config).toContain('HANGOUT_TURN_ENABLED = "0"');
        expect(config).not.toMatch(/^HANGOUT_(HMAC_KEY|TURN_KEY_ID|TURN_API_TOKEN|TURN_ANALYTICS_TOKEN|TURNSTILE_SECRET)\s*=/m);
    });
    it('vault dry-run works without a vault and emits item/binding names only', () => {
        const script = new URL('../../scripts/hangout-secrets-from-vault.sh', import.meta.url);
        const output = execFileSync('bash', [script.pathname, '--dry-run'], { env: { PATH: process.env.PATH, HOME: '/nonexistent-vault' }, encoding: 'utf8' });
        expect(output.trim().split('\n')).toEqual([
            'Hangout HMAC Key -> HANGOUT_HMAC_KEY',
            'Hangout Turnstile Secret -> HANGOUT_TURNSTILE_SECRET',
            'Hangout TURN Key ID -> HANGOUT_TURN_KEY_ID',
            'Hangout TURN API Token -> HANGOUT_TURN_API_TOKEN',
            'Hangout TURN Analytics Token -> HANGOUT_TURN_ANALYTICS_TOKEN'
        ]);
    });
});
