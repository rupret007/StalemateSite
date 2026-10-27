// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { betaFetch, betaAccessConfigured } from '../src/beta-entry.mjs';
import { BETA_COOKIE, BETA_IDENTITY_COOKIE, BETA_TTL, betaSession, readBeta, signBeta } from '../src/beta-auth.mjs';
import { accountId } from '../src/auth.mjs';
import { BetaSessions } from '../src/beta-sessions.mjs';

const origin = 'https://beta.example';
const invite = 'private-beta-test-invitation-'.repeat(2);
const secret = 'private-beta-test-signature-'.repeat(2);
const preview = 'private-beta-test-preview-'.repeat(2);
const team = 'beta-test.cloudflareaccess.com';
const ownerAudience = 'a'.repeat(64), staffAudience = 'b'.repeat(64);
let pair, jwk;
beforeAll(async () => {
    pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
    jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'beta-test' };
});
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
async function jwt(email, aud = ownerAudience, override = {}) {
    const body = `${b64({ alg: 'RS256', kid: jwk.kid })}.${b64({ iss: `https://${team}`, aud: [aud], exp: Date.now() / 1000 + 600, email, ...override })}`;
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(body));
    return `${body}.${Buffer.from(sig).toString('base64url')}`;
}
const deps = { fetchJwks: async () => ({ keys: [jwk] }) };
function env() {
    const config = {
        HANGOUT_BETA_MODE: 'protected', HANGOUT_BETA_INVITE_KEY: invite, HANGOUT_BETA_INVITE_VERSION: '1', HANGOUT_HMAC_KEY: secret, HANGOUT_PREVIEW_KEY: preview,
        HANGOUT_ACCESS_TEAM: team, HANGOUT_ACCESS_AUD: staffAudience, HANGOUT_OWNER_ACCESS_AUD: ownerAudience,
        HANGOUT_OWNER_EMAIL: 'admin@example.test', HANGOUT_MODERATOR_EMAILS: 'mod@example.test',
        ASSETS: { fetch: vi.fn(async () => new Response('<head><meta name="hangout-relay" content=""><meta name="hangout-turn" content=""><meta name="hangout-turnstile" content=""></head><body>Product</body>', { headers: { 'Content-Type': 'text/html' } })) },
        LOBBY: { idFromName: (name) => name, get: () => ({ fetch: vi.fn(async (request) => new Response(request.url.includes('/__beta/disconnect') ? 'disconnected' : request.headers.get('X-Hangout-Identity'))) }) },
        ROOMS: { idFromName: (name) => name, get: () => ({ fetch: async () => new Response('closed') }) },
        QUOTA: { idFromName: (name) => name, get: () => ({ fetch: async () => new Response('ok') }) }
    };
    const values = new Map();
    const storage = {
        get: async (key) => values.get(key), put: async (key, value) => values.set(key, structuredClone(value)),
        list: async ({ prefix, limit }) => new Map([...values].filter(([key]) => key.startsWith(prefix)).slice(0, limit)),
        delete: async (keys) => { for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key); },
        setAlarm: async () => {}, deleteAlarm: async () => {}
    };
    // Simple successful-auth fixture; rollback/failure behavior has its own suite.
    storage.transaction = async (fn) => fn(storage);
    const registry = new BetaSessions({ blockConcurrencyWhile: (fn) => fn(), storage }, config);
    config.BETA_SESSIONS = { idFromName: (name) => name, get: () => registry };
    return config;
}
function request(path, { method = 'GET', body, cookie, from = origin, token, upgrade } = {}) {
    return new Request(origin + path, { method, headers: { Origin: from, ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { 'Cf-Access-Jwt-Assertion': token } : {}), ...(upgrade ? { Upgrade: 'websocket' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
const cookieOf = (response) => response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
async function unlock(config = env()) {
    const response = await betaFetch(request('/beta/unlock', { method: 'POST', body: { key: invite } }), config, deps);
    expect(response.status).toBe(200);
    return cookieOf(response);
}

describe('real invitation-only beta boundary', () => {
    it('protects every product page, static asset, room, TURN and socket before lookup, including HEAD', async () => {
        const config = env();
        for (const path of ['/r/45662413410ed051/lobby/', '/r/45662413410ed051/lobby/lobby.js', '/assets/favicon.svg', '/lobby', '/lobby-owner', '/lobby-admin', '/room', '/turn', '/beta/state', '/beta/bootstrap.js']) {
            expect((await betaFetch(request(path), config, deps)).status).toBe(401);
        }
        expect((await betaFetch(request('/assets/favicon.svg', { method: 'HEAD' }), config, deps)).status).toBe(401);
        expect(config.ASSETS.fetch).not.toHaveBeenCalled();
    });
    it('fails closed for missing mode, secrets and bindings', async () => {
        for (const name of ['HANGOUT_BETA_MODE', 'HANGOUT_BETA_INVITE_KEY', 'HANGOUT_HMAC_KEY', 'HANGOUT_PREVIEW_KEY', 'ASSETS', 'LOBBY', 'QUOTA', 'ROOMS', 'BETA_SESSIONS']) {
            const config = env(); delete config[name];
            expect((await betaFetch(request('/r/45662413410ed051/lobby/'), config, deps)).status).toBe(503);
        }
    });
    it('protects Web Join assets before lookup and scopes its stricter audio policy to that page', async () => {
        const config = env();
        for (const path of ['/join/', '/join/app.js', '/%6aoin/index.html']) {
            for (const method of ['GET', 'HEAD']) expect((await betaFetch(request(path, { method }), config, deps)).status).toBe(401);
        }
        expect(config.ASSETS.fetch).not.toHaveBeenCalled();
        const cookie = await unlock(config);
        for (const path of ['/join/', '/join/app.js', '/%6aoin/index.html']) {
            const result = await betaFetch(request(path, { cookie }), config, deps);
            expect(result.status).toBe(200);
            expect(result.headers.get('Cache-Control')).toBe('no-store');
            expect(result.headers.get('X-Robots-Tag')).toContain('noindex');
            expect(result.headers.get('Content-Security-Policy')).toContain("default-src 'none'; script-src 'self'; style-src 'self'");
            expect(result.headers.get('Content-Security-Policy')).toContain('https://webjam-turn-credentials.jeffstory007.workers.dev');
            expect(result.headers.get('Content-Security-Policy')).not.toMatch(/youtube|unsafe-inline|wss:/);
            expect(result.headers.get('Permissions-Policy')).toBe('camera=(), geolocation=(), microphone=(self)');
            expect(await result.text()).not.toContain('/beta/bootstrap.js');
        }
        const lobby = await betaFetch(request('/r/45662413410ed051/lobby/', { cookie }), config, deps);
        expect(lobby.headers.get('Content-Security-Policy')).not.toContain('webjam-turn-credentials');
        expect(await lobby.text()).toContain('/beta/bootstrap.js');
    });
    it('does not accept an operator code, role selection, forged identity or a pilot cookie', async () => {
        const config = env();
        expect((await betaFetch(request('/beta/unlock', { method: 'POST', body: { key: 'wrong', role: 'owner' } }), config, deps)).status).toBe(403);
        expect((await betaFetch(request('/beta/state', { cookie: '__Host-pilot=pretend; __Host-pilot-identity=pretend' }), config, deps)).status).toBe(401);
        const auth = await unlock(config);
        expect((await betaFetch(request('/beta/identity', { method: 'POST', body: { role: 'owner', email: 'admin@example.test' }, cookie: auth }), config, deps)).status).toBe(404);
        expect(await (await betaFetch(request('/beta/state', { cookie: auth }), config, deps)).json()).toMatchObject({ kind: 'guest', role: 'fan' });
        const page = await betaFetch(request('/beta/'), config, deps);
        expect(await page.text()).not.toContain('Your test controls');
    });
    it('requires exact-origin JSON mutations and bounded valid object bodies', async () => {
        const config = env();
        expect((await betaFetch(request('/beta/unlock', { method: 'POST', body: { key: invite }, from: 'https://outsider.example' }), config, deps)).status).toBe(403);
        expect((await betaFetch(request('/beta/unlock', { method: 'POST', body: null }), config, deps)).status).toBe(400);
        expect((await betaFetch(request('/beta/unlock', { method: 'POST', body: [] }), config, deps)).status).toBe(400);
        let cancelled = false;
        const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(3000)); }, cancel() { cancelled = true; } });
        const streamed = new Request(origin + '/beta/unlock', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body, duplex: 'half' });
        expect((await betaFetch(streamed, config, deps)).status).toBe(400); expect(cancelled).toBe(true);
    });
    it('uses secure host-only cookies compatible with the Access callback and expires/invalidate versions', async () => {
        const config = env();
        const response = await betaFetch(request('/beta/unlock', { method: 'POST', body: { key: invite } }), config, deps);
        expect(response.headers.get('Set-Cookie')).toContain(`${BETA_COOKIE}=`);
        expect(response.headers.get('Set-Cookie')).toContain('Path=/; HttpOnly; Secure; SameSite=Lax');
        expect(Number(/Max-Age=(\d+)/.exec(response.headers.get('Set-Cookie'))[1])).toBeGreaterThanOrEqual(28790);
        const cookie = cookieOf(response);
        expect(await betaSession(request('/beta/state', { cookie }), config)).toBeTruthy();
        expect(await betaSession(request('/beta/state', { cookie }), { ...config, HANGOUT_BETA_INVITE_VERSION: '2' })).toBeNull();
        expect(await betaSession(request('/beta/state', { cookie }), config, Date.now() + BETA_TTL + 1)).toBeNull();
    });
    it('keeps guest socket admission unprivileged even with owner JWT, forged headers and role parameters', async () => {
        const config = env(), cookie = await unlock(config);
        const r = request(`/lobby?preview=${preview}&role=owner&admin=1`, { cookie, upgrade: true, token: await jwt('admin@example.test', staffAudience) });
        r.headers.set('X-Hangout-Identity', JSON.stringify({ role: 'owner', admin: true }));
        const who = await (await betaFetch(r, config, deps)).json();
        expect(who).toMatchObject({ role: 'fan', admin: false, email: '', account: '', betaInviteVersion: '1' });
        expect(who.betaSid).toMatch(/^[a-z0-9-]+$/); expect(who.expiresAt).toBeGreaterThan(Date.now());
    });
    it('rejects cross-origin sockets, quota failures and the emergency pause', async () => {
        const config = env(), cookie = await unlock(config);
        const socket = (path = '/lobby', from = origin) => request(`${path}?preview=${preview}`, { cookie, upgrade: true, from });
        expect((await betaFetch(socket('/lobby', 'https://outsider.example'), config, deps)).status).toBe(403);
        const unavailable = { ...config, QUOTA: { idFromName: (n) => n, get: () => ({ fetch: async () => { throw Error('offline'); } }) } };
        expect((await betaFetch(socket(), unavailable, deps)).status).toBe(503);
        for (const path of ['/lobby', '/room', '/turn']) expect((await betaFetch(socket(path), { ...config, HANGOUT_OPEN: '0' }, deps)).status).toBe(503);
        const staff = request(`/lobby-admin?preview=${preview}`, { cookie, upgrade: true, token: await jwt('mod@example.test', staffAudience) });
        expect((await betaFetch(staff, { ...config, HANGOUT_OPEN: '0' }, deps)).status).toBe(200);
    });
});

describe('real email and staff authorization', () => {
    it('requires different configured owner and staff audiences', async () => {
        const config = env(), cookie = await unlock(config);
        expect(betaAccessConfigured(config)).toBe(true);
        for (const changed of [{ HANGOUT_OWNER_ACCESS_AUD: staffAudience }, { HANGOUT_OWNER_ACCESS_AUD: '' }, { HANGOUT_ACCESS_AUD: '' }, { HANGOUT_ACCESS_TEAM: '' }]) {
            const incomplete = { ...config, ...changed };
            expect(betaAccessConfigured(incomplete)).toBe(false);
            expect((await betaFetch(request('/lobby-owner/login', { cookie }), incomplete, deps)).status).toBe(503);
        }
    });
    it('verifies real email, recovers the same account on a new guest device, and does not grant staff powers', async () => {
        const config = env(), cookie = await unlock(config), token = await jwt('Visitor@Example.Test');
        const login = await betaFetch(request('/lobby-owner/login', { cookie, token }), config, deps);
        expect(login.status).toBe(303); expect(login.headers.get('Location')).toContain('/lobby/?owner=1');
        const signedIn = cookieOf(login);
        expect((await betaSession(request('/beta/state', { cookie: signedIn }), config)).identity).toMatchObject({ kind: 'owner', role: 'fan', email: 'visitor@example.test' });
        const owners = [];
        for (const auth of [signedIn, await unlock(config)]) {
            const result = await betaFetch(request(`/lobby-owner?preview=${preview}`, { cookie: auth, token, upgrade: true }), config, deps);
            owners.push(await result.json());
        }
        expect(owners[0].account).toBe(await accountId('visitor@example.test', secret)); expect(owners[1].account).toBe(owners[0].account);
        expect(owners[0]).toMatchObject({ role: 'fan', admin: false }); expect(owners[0].dev).not.toBe(owners[1].dev);
        expect((await betaFetch(request(`/lobby-admin?preview=${preview}`, { cookie: signedIn, token, upgrade: true }), config, deps)).status).toBe(403);
    });
    it('rejects missing, forged, expired and wrong-audience JWTs without setting an identity cookie', async () => {
        const config = env(), cookie = await unlock(config);
        for (const token of ['', 'forged.header.signature', await jwt('visitor@example.test', staffAudience), await jwt('visitor@example.test', ownerAudience, { exp: Date.now() / 1000 - 1 })]) {
            const result = await betaFetch(request('/lobby-owner/login', { cookie, token }), config, deps);
            expect(result.status).toBe(403); expect(result.headers.has('Set-Cookie')).toBe(false);
        }
        const valid = await jwt('visitor@example.test');
        expect((await betaFetch(request('/lobby-owner/login', { cookie, token: valid }), config, { fetchJwks: async () => { throw Error('provider offline'); } })).status).toBe(403);
    });
    it('allows only allowlisted staff and keeps moderator permissions distinct from site administrator', async () => {
        const config = env();
        for (const [email, role] of [['mod@example.test', 'moderator'], ['admin@example.test', 'owner']]) {
            const cookie = await unlock(config);
            const token = await jwt(email, staffAudience);
            const login = await betaFetch(request('/lobby-admin/login', { cookie, token }), config, deps);
            expect(login.status).toBe(303);
            const both = cookieOf(login);
            expect((await betaSession(request('/beta/state', { cookie: both }), config)).identity).toMatchObject({ kind: 'staff', role });
            const socket = await betaFetch(request(`/lobby-admin?preview=${preview}`, { cookie: both, token, upgrade: true }), config, deps);
            expect(await socket.json()).toMatchObject({ role, email, admin: true });
            const noStaff = { ...config, HANGOUT_OWNER_EMAIL: '', HANGOUT_MODERATOR_EMAILS: '' };
            expect((await betaSession(request('/beta/state', { cookie: both }), noStaff)).identity).toBeNull();
        }
        expect((await betaFetch(request('/lobby-admin/login', { cookie: await unlock(config), token: await jwt('unknown@example.test', staffAudience) }), config, deps)).status).toBe(403);
    });
    it('continues an accepted staff callback into the panel without putting credentials in its URL', async () => {
        const config = env(), cookie = await unlock(config);
        const login = await betaFetch(request('/lobby-admin/login', { cookie, token: await jwt('admin@example.test', staffAudience) }), config, deps);
        expect(login.status).toBe(303);
        expect(login.headers.get('Location')).toBe('/r/45662413410ed051/admin/?signed-in=1');
        expect(login.headers.get('Cache-Control')).toBe('no-store');
        const signedIn = cookieOf(login);
        expect((await betaFetch(request('/r/45662413410ed051/admin/?signed-in=1', { cookie: signedIn }), config, deps)).status).toBe(200);
        // The hint grants neither the protected page nor the staff socket.
        expect((await betaFetch(request('/r/45662413410ed051/admin/?signed-in=1', { cookie: await unlock(config) }), config, deps)).status).toBe(403);
        expect((await betaFetch(request(`/lobby-admin?preview=${preview}&signed-in=1`, { cookie: signedIn, upgrade: true }), config, deps)).status).toBe(403);
    });
    it('binds identity cookies to their invitation session and rejects wrong-purpose and pilot signatures', async () => {
        const config = env(), cookie = await unlock(config), other = await unlock(config);
        const login = await betaFetch(request('/lobby-admin/login', { cookie, token: await jwt('admin@example.test', staffAudience) }), config, deps);
        const identity = login.headers.getSetCookie().find((value) => value.startsWith(`${BETA_IDENTITY_COOKIE}=`)).split(';')[0];
        expect((await betaSession(request('/beta/state', { cookie: `${other}; ${identity}` }), config)).identity).toBeNull();
        const claims = { v: 1, sid: 'test-session-1234567890', exp: Date.now() + 60000, scope: 'guest', version: '1' };
        const token = await signBeta('identity', claims, secret);
        expect(await readBeta('access', token, secret)).toBeNull();
        expect(await betaSession(request('/beta/state', { cookie: `${BETA_COOKIE}=${token}` }), config)).toBeNull();
        expect((await betaFetch(request('/r/45662413410ed051/admin/', { cookie: `${other}; ${identity}` }), config, deps)).status).toBe(403);
        expect((await betaFetch(request('/r/45662413410ed051/%61dmin/admin.js', { cookie: other }), config, deps)).status).toBe(403);
    });
    it('re-verifies staff JWT even with an authentic identity cookie', async () => {
        const config = env(), cookie = await unlock(config), token = await jwt('mod@example.test', staffAudience);
        const login = await betaFetch(request('/lobby-admin/login', { cookie, token }), config, deps);
        const both = cookieOf(login);
        expect((await betaFetch(request(`/lobby-admin?preview=${preview}`, { cookie: both, upgrade: true }), config, deps)).status).toBe(403);
        expect((await betaFetch(request('/r/45662413410ed051/admin/', { cookie: both }), config, deps)).status).toBe(200);
    });
    it('disconnects live sockets before logout and refuses to claim success when persistence is unavailable', async () => {
        const config = env(), cookie = await unlock(config), fetch = vi.fn(async () => new Response('closed'));
        config.LOBBY.get = () => ({ fetch });
        const result = await betaFetch(request('/beta/logout', { cookie, method: 'POST', body: {} }), config, deps);
        expect(result.status).toBe(200); expect(result.headers.get('Set-Cookie')).toContain('Max-Age=0');
        expect(fetch).toHaveBeenCalledOnce(); expect(fetch.mock.calls[0][0].url).toBe('https://session/__beta/disconnect');
        config.LOBBY.get = () => ({ fetch: async () => new Response('unavailable', { status: 503 }) });
        const failed = await betaFetch(request('/beta/logout', { cookie, method: 'POST', body: {} }), config, deps);
        expect(failed.status).toBe(503); expect(failed.headers.has('Set-Cookie')).toBe(false);
    });
});

describe('beta product bootstrapping', () => {
    it('sets only guest admission UI state, rewrites relay/TURN/Turnstile and suppresses indexing', async () => {
        const config = env(), cookie = await unlock(config);
        const boot = await betaFetch(request('/beta/bootstrap.js', { cookie }), config, deps);
        expect(boot.status).toBe(200);
        const browser = {}, remembered = new Map([['hangout-owner', '1']]);
        const writeHint = vi.fn((key, value) => {
            // Current authenticated hints and the display registry must already
            // be available before any optional browser storage is touched.
            expect(browser.HangoutBootstrap?.preview).toBe(preview);
            expect(browser.HangoutBootstrap?.owner).toBe(false);
            expect(Array.isArray(browser.HangoutEntrySites)).toBe(true);
            remembered.set(key, String(value));
        });
        runInNewContext(await boot.text(), { window: browser, sessionStorage: { setItem: writeHint } }, { timeout: 250 });
        expect(Object.keys(browser.HangoutBootstrap).sort()).toEqual(['owner', 'preview']);
        expect(browser.HangoutBootstrap.preview).toBe(preview);
        expect(browser.HangoutBootstrap.owner).toBe(false);
        expect(Array.from(browser.HangoutEntrySites, site => site.id)).toEqual(expect.arrayContaining(['stalemate', 'rad-dad']));
        expect(writeHint).toHaveBeenCalledTimes(2);
        expect(remembered.get('hangout-preview')).toBe(preview);
        expect(remembered.get('hangout-owner')).toBe('0');
        const page = await betaFetch(request('/r/45662413410ed051/lobby/', { cookie }), { ...config, HANGOUT_TURN_ENABLED: '1', HANGOUT_TURNSTILE_SITEKEY: 'public-site-key' }, deps);
        const html = await page.text();
        expect(html).toContain('wss://beta.example'); expect(html).toContain('https://beta.example/turn'); expect(html).toContain('public-site-key'); expect(html).toContain('/beta/bootstrap.js');
        expect(page.headers.get('Cache-Control')).toBe('no-store'); expect(page.headers.get('X-Robots-Tag')).toContain('noindex');
    });
    it('checks a configured Turnstile proof and its hostname before guest admission', async () => {
        const config = { ...env(), HANGOUT_TURNSTILE_SITEKEY: 'public-site-key', HANGOUT_TURNSTILE_SECRET: 'turnstile-secret' }, cookie = await unlock(config);
        const req = request(`/lobby?preview=${preview}&ts=proof`, { cookie, upgrade: true });
        expect((await betaFetch(req, config, { ...deps, fetch: async () => Response.json({ success: true, hostname: 'outsider.example' }) })).status).toBe(403);
        expect((await betaFetch(req, config, { ...deps, fetch: async () => Response.json({ success: true, hostname: 'beta.example' }) })).status).toBe(200);
        expect((await betaFetch(request(`/lobby?preview=${preview}`, { cookie, upgrade: true }), config, deps)).status).toBe(403);
    });
    it('makes privacy read-only and public while rendering only a validated moderation address', async () => {
        const config = env(), cookie = await unlock(config);
        config.ASSETS.fetch = async () => new Response('<head></head><body><b data-contact>[CONTACT EMAIL]</b></body>', { headers: { 'Content-Type': 'text/html' } });
        expect((await betaFetch(request('/beta/privacy'), config, deps)).status).toBe(303);
        const redirect = await betaFetch(request('/beta/privacy', { cookie }), config, deps);
        expect(redirect.status).toBe(303); expect(redirect.headers.get('Location')).toContain('/terms/');
        const page = await betaFetch(request('/r/45662413410ed051/terms/', { cookie }), { ...config, HANGOUT_MODERATION_CONTACT: 'moderation@example.test' }, deps);
        const publicHtml = await page.text();
        expect(publicHtml).toContain('href="mailto:moderation@example.test"');
        expect(publicHtml).not.toContain('/beta/bootstrap.js');
        expect(page.headers.get('Set-Cookie')).toBeNull();
        const invalid = await betaFetch(request('/r/45662413410ed051/terms/', { cookie }), { ...config, HANGOUT_MODERATION_CONTACT: 'bad" onclick="alert(1)' }, deps);
        const html = await invalid.text(); expect(html).toContain('Moderation contact is not configured.'); expect(html).not.toContain('onclick=');
    });
    it('ships a separate guarded beta configuration with no provider secrets or synthetic identity controls', () => {
        const config = readFileSync(new URL('../wrangler.beta.toml', import.meta.url), 'utf8');
        expect(config).toContain('name = "stalemate-hangout-beta"'); expect(config).toContain('main = "src/beta-entry.mjs"');
        expect(config).toContain('run_worker_first = true'); expect(config).toContain('HANGOUT_BETA_MODE = "protected"');
        expect(config).toContain('HANGOUT_TURN_ENABLED = "0"'); expect(config).toContain('HANGOUT_AI_MODERATION = "off"');
        expect(config).not.toMatch(/^PILOT_MODE\s*=/m);
        expect(config).not.toMatch(/^\s*(PILOT_OPERATOR_KEY|HANGOUT_BETA_INVITE_KEY|HANGOUT_HMAC_KEY|HANGOUT_PREVIEW_KEY|OPENAI_API_KEY)\s*=/m);
    });
});

// Apply actual gateway response cookies in a fixed-origin host-cookie jar.
// RSA verification and the BetaSessions registry are real application code;
// the existing binding/storage adapters are fixtures, not a browser or SQLite.
describe('verified beta logout removes browser identity data', () => {
    const identities = [
        { path: '/lobby-owner/login', email: 'visitor@example.test', audience: ownerAudience, kind: 'owner', role: 'fan' },
        { path: '/lobby-admin/login', email: 'mod@example.test', audience: staffAudience, kind: 'staff', role: 'moderator' }
    ];
    function hostCookieJar() {
        const values = new Map();
        return {
            apply(response) {
                for (const header of response.headers.getSetCookie()) {
                    const [cookie, ...attributes] = header.split(';');
                    const equals = cookie.indexOf('='), name = cookie.slice(0, equals);
                    if (attributes.some(attribute => /^Max-Age=0$/i.test(attribute.trim()))) values.delete(name);
                    else values.set(name, cookie.slice(equals + 1));
                }
            },
            header: () => [...values].map(([name, value]) => `${name}=${value}`).join('; '),
            names: () => [...values.keys()].sort()
        };
    }
    async function signIn(config, identity) {
        const jar = hostCookieJar();
        const invited = await betaFetch(request('/beta/unlock', { method: 'POST', body: { key: invite } }), config, deps);
        expect(invited.status).toBe(200); jar.apply(invited);
        const login = await betaFetch(request(identity.path, { cookie: jar.header(), token: await jwt(identity.email, identity.audience) }), config, deps);
        expect(login.status).toBe(303); jar.apply(login);
        expect(jar.names()).toEqual([BETA_COOKIE, BETA_IDENTITY_COOKIE].sort());
        expect((await betaSession(request('/beta/state', { cookie: jar.header() }), config)).identity)
            .toMatchObject({ kind: identity.kind, role: identity.role, email: identity.email });
        return jar;
    }
    function expectBothCookieDeletions(response) {
        const cookies = response.headers.getSetCookie();
        expect(cookies).toHaveLength(2);
        expect(cookies.map(cookie => cookie.slice(0, cookie.indexOf('='))).sort()).toEqual([BETA_COOKIE, BETA_IDENTITY_COOKIE].sort());
        for (const cookie of cookies) {
            expect(cookie.split(';')[0]).toMatch(/^[^=]+=$/);
            const attributes = cookie.split(';').slice(1).map(value => value.trim().toLowerCase());
            expect(attributes).toEqual(expect.arrayContaining(['path=/', 'httponly', 'secure', 'samesite=lax', 'max-age=0']));
            expect(attributes.some(attribute => attribute.startsWith('domain='))).toBe(false);
        }
    }
    it.each(identities)('clears both cookies for $kind logout and keeps a new invitation unprivileged', async identity => {
        const config = env(), jar = await signIn(config, identity), signedIn = jar.header();
        const oldIdentity = signedIn.split('; ').find(cookie => cookie.startsWith(`${BETA_IDENTITY_COOKIE}=`));
        const result = await betaFetch(request('/beta/logout', { cookie: signedIn, method: 'POST', body: {} }), config, deps);
        expect(result.status).toBe(200); expectBothCookieDeletions(result); jar.apply(result);
        expect(jar.names()).toEqual([]);
        expect((await betaFetch(request('/beta/state', { cookie: jar.header() }), config, deps)).status).toBe(401);
        expect((await betaFetch(request('/beta/state', { cookie: signedIn }), config, deps)).status).toBe(401);

        const fresh = await betaFetch(request('/beta/unlock', { cookie: jar.header(), method: 'POST', body: { key: invite } }), config, deps);
        expect(fresh.status).toBe(200); jar.apply(fresh); expect(jar.names()).toEqual([BETA_COOKIE]);
        const replay = `${jar.header()}; ${oldIdentity}`;
        expect((await betaSession(request('/beta/state', { cookie: replay }), config)).identity).toBeNull();
        expect(await (await betaFetch(request('/beta/state', { cookie: replay }), config, deps)).json()).toMatchObject({ kind: 'guest', role: 'fan' });
        expect((await betaFetch(request('/r/45662413410ed051/admin/', { cookie: replay }), config, deps)).status).toBe(403);
    });
    it.each(identities)('preserves $kind cookies for closure retry and clears them only after it succeeds', async identity => {
        const config = env(), jar = await signIn(config, identity), signedIn = jar.header();
        config.LOBBY.get = () => ({ fetch: async () => new Response('unavailable', { status: 503 }) });
        const failed = await betaFetch(request('/beta/logout', { cookie: signedIn, method: 'POST', body: {} }), config, deps);
        expect(failed.status).toBe(503); expect(failed.headers.getSetCookie()).toEqual([]); jar.apply(failed);
        expect(jar.header()).toBe(signedIn); expect(jar.names()).toEqual([BETA_COOKIE, BETA_IDENTITY_COOKIE].sort());
        // Revocation was recorded even though closure still needs a retry.
        expect((await betaFetch(request('/beta/state', { cookie: jar.header() }), config, deps)).status).toBe(401);

        config.LOBBY.get = () => ({ fetch: async () => new Response('closed') });
        const retried = await betaFetch(request('/beta/logout', { cookie: jar.header(), method: 'POST', body: {} }), config, deps);
        expect(retried.status).toBe(200); expectBothCookieDeletions(retried); jar.apply(retried);
        expect(jar.names()).toEqual([]);
    });
});
