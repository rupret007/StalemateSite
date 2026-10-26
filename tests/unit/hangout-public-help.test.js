// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { betaFetch } from '../../hangout-worker/src/beta-entry.mjs';
import { BETA_COOKIE, signBeta } from '../../hangout-worker/src/beta-auth.mjs';

const origin = 'https://help.fixture.test';
const root = '/r/45662413410ed051/';
const terms = readFileSync(new URL(`../../r/45662413410ed051/terms/index.html`, import.meta.url), 'utf8');
function fixture(configured = true, contact = 'moderator@example.test') {
    const unavailable = vi.fn(() => { throw Error('Public help must not call community services'); });
    const binding = { idFromName: unavailable, get: unavailable };
    const assets = vi.fn(async request => {
        expect(request.method).toBe('GET');
        expect(request.headers.get('Cookie')).toBeNull();
        expect(new URL(request.url).pathname).toBe(`${root}terms/index.html`);
        expect(new URL(request.url).search).toBe('');
        return new Response(terms, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    });
    const env = { HANGOUT_MODERATION_CONTACT: contact, ASSETS: { fetch: assets },
        LOBBY: binding, QUOTA: binding, ROOMS: binding, BETA_SESSIONS: binding,
        ...(configured ? { HANGOUT_BETA_MODE: 'protected', HANGOUT_BETA_INVITE_KEY: 'help-test-invitation-'.repeat(3),
            HANGOUT_HMAC_KEY: 'help-test-signing-key-'.repeat(3), HANGOUT_PREVIEW_KEY: 'help-test-preview-'.repeat(3) } : {}) };
    const call = (path, method = 'GET', cookie = '__Host-hangout-beta=invalid-or-expired') => betaFetch(new Request(origin + path, { method,
        headers: { Cookie: cookie, 'Cf-Access-Jwt-Assertion': 'untrusted',
            'X-Hangout-Identity': '{"role":"owner","admin":true}' } }), env, { fetchJwks: unavailable, fetch: unavailable });
    return { call, assets, unavailable, env };
}

describe('public read-only rules, privacy and safety contact', () => {
    it('lets an uninvited or logged-out visitor follow privacy to the existing policy without a session lookup', async () => {
        const f = fixture();
        const redirect = await f.call('/beta/privacy');
        expect(redirect.status).toBe(303);
        expect(redirect.headers.get('Location')).toBe(`${root}terms/`);
        const response = await f.call(redirect.headers.get('Location'));
        expect(response.status).toBe(200);
        const html = await response.text();
        expect(html).toContain('mailto:moderator@example.test');
        expect(html).toContain('You do not need a chat account to email us.');
        expect(html).toContain('13+ only.');
        expect(html).toContain('Draft v0.1, October 2026.');
        expect(html).not.toMatch(/bootstrap|<script\b|goatcounter|invalid-or-expired|untrusted/);
        expect(response.headers.get('Set-Cookie')).toBeNull();
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(response.headers.get('Content-Security-Policy')).toContain("script-src 'none'");
        expect(response.headers.get('Content-Security-Policy')).toContain("connect-src 'none'");
        expect(f.unavailable).not.toHaveBeenCalled();
    });
    it('keeps policy and its single public stylesheet available during configuration/session-service failure, including HEAD', async () => {
        const f = fixture(false);
        for (const path of [`${root}terms/`, `${root}terms/index.html`]) {
            const response = await f.call(path);
            expect(response.status).toBe(200);
            const html = await response.text();
            expect([...html.matchAll(/<link\b[^>]*href="([^"]+)"/g)].map(match => match[1])).toEqual(['/beta/help.css']);
            expect(html).toContain('href="/"');
            const head = await f.call(path, 'HEAD');
            expect(head.status).toBe(200); expect(await head.text()).toBe('');
            expect(head.headers.get('Content-Type')).toContain('text/html');
        }
        const css = await f.call('/beta/help.css');
        expect(css.status).toBe(200); expect(css.headers.get('Content-Type')).toContain('text/css');
        expect(await css.text()).toContain('overflow-wrap:anywhere');
        expect(await (await f.call('/beta/help.css', 'HEAD')).text()).toBe('');
        expect((await f.call('/beta/privacy', 'HEAD')).status).toBe(303);
        expect(f.unavailable).not.toHaveBeenCalled();
    });
    it('allows no public mutation, asset prefix or encoded path alias', async () => {
        const f = fixture();
        for (const path of ['/beta/privacy', '/beta/help.css', `${root}terms`, `${root}terms/`, `${root}terms/index.html`]) {
            for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
                const response = await f.call(path, method);
                expect(response.status).toBe(405); expect(response.headers.get('Allow')).toBe('GET, HEAD');
            }
        }
        expect(f.assets).not.toHaveBeenCalled();
        for (const path of [`${root}terms/private.html`, `${root}terms/terms.css`, `${root}lobby/lobby.css`,
            `${root}lobby/`, `${root}admin/`, '/assets/favicon.svg', '/beta/bootstrap.js', '/beta/help.css/extra', '/beta/%70rivacy', `${root}%74erms/`]) {
            expect((await f.call(path)).status).toBe(401);
        }
        expect(f.assets).not.toHaveBeenCalled(); expect(f.unavailable).not.toHaveBeenCalled();
    });
    it('does not turn an invalid contact configuration or request parameters into markup', async () => {
        const f = fixture(false, '"><img src=x onerror=alert(1)>');
        const response = await f.call(`${root}terms/?email=visitor@example.test&invite=not-public`);
        expect(response.status).toBe(200);
        const html = await response.text();
        expect(html).not.toMatch(/onerror|visitor@example|not-public|mailto:/);
        expect(html).toContain('Moderation contact is not configured');
        expect(html).not.toContain('Use the in-chat Report action');
        expect(f.unavailable).not.toHaveBeenCalled();
    });
    it('ignores even a well-signed cookie when its registry is unavailable, and truthfully retains contact if the policy asset fails', async () => {
        const f = fixture();
        const token = await signBeta('access', { v: 1, sid: '12345678-1234-1234-1234-123456789abc',
            exp: Date.now() + 60000, scope: 'guest', version: '1' }, f.env.HANGOUT_HMAC_KEY);
        const response = await f.call(`${root}terms/`, 'GET', `${BETA_COOKIE}=${token}`);
        expect(response.status).toBe(200); expect(f.unavailable).not.toHaveBeenCalled();
        f.assets.mockRejectedValueOnce(Error('asset binding unavailable'));
        const failed = await f.call(`${root}terms/`);
        expect(failed.status).toBe(503);
        const html = await failed.text();
        expect(html).toContain('temporarily unavailable'); expect(html).toContain('mailto:moderator@example.test');
        expect(html).not.toMatch(/bootstrap|asset binding unavailable|<script\b/);
        delete f.env.ASSETS; delete f.env.HANGOUT_MODERATION_CONTACT;
        f.env.HANGOUT_OWNER_EMAIL = 'private-owner@example.test';
        const missing = await f.call(`${root}terms/`, 'HEAD');
        expect(missing.status).toBe(503); expect(await missing.text()).toBe('');
        const missingHtml = await (await f.call(`${root}terms/`)).text();
        expect(missingHtml).toContain('Moderation contact is not configured');
        expect(missingHtml).not.toContain('private-owner@example.test');
        expect(f.unavailable).not.toHaveBeenCalled();
    });
    it('bounds the configured address and encodes literal percent characters in mailto without changing its displayed address', async () => {
        const f = fixture(false, 'person%0a@example.test');
        const html = await (await f.call(`${root}terms/`)).text();
        expect(html).toContain('href="mailto:person%250a@example.test">person%0a@example.test</a>');
        expect(html).not.toContain('href="mailto:person%0a@');
        f.env.HANGOUT_MODERATION_CONTACT = `${'a'.repeat(242)}@example.test`;
        const oversized = await (await f.call(`${root}terms/`)).text();
        expect(oversized).toContain('Moderation contact is not configured.');
        expect(oversized).not.toContain('mailto:');
        expect(f.unavailable).not.toHaveBeenCalled();
    });
});
