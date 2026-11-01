// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { betaFetch } from '../../hangout-worker/src/beta-entry.mjs';
import * as entryFunctions from '../../r/45662413410ed051/entry-sites.mjs';
import { BetaSessions } from '../../hangout-worker/src/beta-sessions.mjs';
import { createEntrySharing } from '../../r/45662413410ed051/lobby/entry-sharing.mjs';
import { createChatAnnouncements } from '../../r/45662413410ed051/lobby/chat-announcements.mjs';

const root = '/r/45662413410ed051/';
function env(extra = {}) {
    return { HANGOUT_BETA_MODE: 'protected', HANGOUT_HMAC_KEY: 'h'.repeat(40), HANGOUT_BETA_INVITE_KEY: 'i'.repeat(40), HANGOUT_PREVIEW_KEY: 'p'.repeat(40),
        ASSETS: { fetch: vi.fn(async () => new Response(readFileSync(new URL('../../r/45662413410ed051/entry-sites.mjs', import.meta.url), 'utf8'))) },
        LOBBY: {}, QUOTA: {}, ROOMS: {}, BETA_SESSIONS: {}, ...extra };
}
async function shell(address, config = env(), prepare) {
    const request = (path) => new Request(new URL(path, address));
    const html = await (await betaFetch(request('/'), config)).text();
    const client = await (await betaFetch(request('/beta/client.js'), config)).text();
    const dom = new JSDOM(html, { url: address, runScripts: 'outside-only' });
    dom.window.entryFunctions = entryFunctions;
    dom.window.fetch = vi.fn(async (path, options = {}) => new Response(JSON.stringify(options.method === 'POST' ? { ok: true } : { kind: 'guest', emailConfigured: true, staffConfigured: true }), { headers: { 'Content-Type': 'application/json' } }));
    if (prepare) prepare(dom.window);
    // jsdom does not execute ES modules. Supply the actual shared module exports
    // while executing the served shell client unchanged below its import line.
    dom.window.eval(client.replace(/^import \{([^}]+)\} from '[^']+';/, 'const {$1} = entryFunctions;'));
    await vi.waitFor(() => expect(dom.window.document.querySelector('#inside').hidden).toBe(false));
    return dom;
}
function click(dom, selector) {
    const link = dom.window.document.querySelector(selector);
    link.addEventListener('click', (event) => event.preventDefault());
    link.click(); return link;
}

describe('entry context through the private beta shell', () => {
    it('carries the selected entrance through invitation unlock and a deliberate join without keeping it in the address', async () => {
        const dom = await shell('https://beta.example/?via=rad-dad#invite=private-fixture');
        try {
            expect(dom.window.location.href).toBe('https://beta.example/');
            expect(dom.window.fetch.mock.calls[0][0]).toBe('/beta/unlock');
            const link = click(dom, '#inside .button');
            expect(link.href).toBe(`https://beta.example${root}lobby/?entry-return=1`);
            const handoff = entryFunctions.readEntryHandoff(dom.window.sessionStorage.getItem(entryFunctions.ENTRY_HANDOFF_KEY));
            expect(handoff).toEqual({ source: 'rad-dad', share: true });
        } finally { dom.window.close(); }
    });
    it('uses the same bounded handoff for owner sign-in while a direct visit erases stale attribution', async () => {
        const dom = await shell('https://beta.example/?via=stalemate');
        try {
            expect(click(dom, '#owner').href).toBe('https://beta.example/lobby-owner/login?entry-return=1');
            expect(entryFunctions.readEntryHandoff(dom.window.sessionStorage.getItem(entryFunctions.ENTRY_HANDOFF_KEY)).source).toBe('stalemate');
        } finally { dom.window.close(); }
        const direct = await shell('https://beta.example/');
        try {
            direct.window.sessionStorage.setItem(entryFunctions.ENTRY_HANDOFF_KEY, entryFunctions.entryHandoff('rad-dad', true));
            click(direct, '#inside .button');
            expect(entryFunctions.readEntryHandoff(direct.window.sessionStorage.getItem(entryFunctions.ENTRY_HANDOFF_KEY))).toBeNull();
        } finally { direct.window.close(); }
    });
    it('accepts only reviewed future partners and preserves literal dollar characters in their public labels', async () => {
        const config = env({ HANGOUT_ENTRY_SITES: JSON.stringify([{ id: 'community-demo', label: 'Demo $& club' }]) });
        const dom = await shell('https://beta.example/?via=community-demo', config);
        try {
            click(dom, '#inside .button');
            const registry = entryFunctions.entrySitesFromConfig(config.HANGOUT_ENTRY_SITES);
            expect(entryFunctions.readEntryHandoff(dom.window.sessionStorage.getItem(entryFunctions.ENTRY_HANDOFF_KEY), Date.now(), registry)).toEqual({ source: 'community-demo', share: true });
        } finally { dom.window.close(); }
    });
    it('exposes only the fixed public entry module before invitation, keeping application pages protected', async () => {
        const config = env();
        const response = await betaFetch(new Request('https://beta.example/beta/entry-sites.mjs?path=/admin'), config);
        expect(response.status).toBe(200); expect(response.headers.get('Content-Type')).toBe('text/javascript');
        expect(config.ASSETS.fetch.mock.calls[0][0].url).toBe(`https://beta.example${root}entry-sites.mjs`);
        expect((await response.text())).not.toContain(config.HANGOUT_PREVIEW_KEY);
        const shellResponse = await betaFetch(new Request('https://beta.example/'), config);
        expect(await shellResponse.text()).toContain('<script type="module" src="/beta/client.js">');
        expect((await betaFetch(new Request(`https://beta.example${root}lobby/`), config)).status).toBe(401);
    });
});

describe('optional storage in the actual private beta client', () => {
    for (const failure of ['getter', 'setItem', 'removeItem']) {
        it(`keeps entry and successful server logout usable with sessionStorage ${failure} failure`, async () => {
            const errors = [], attempts = [];
            const dom = await shell('https://beta.example/?via=rad-dad', env(), window => {
                window.addEventListener('error', event => errors.push(event.error?.message || event.message));
                const fail = () => { attempts.push(failure); throw new window.DOMException('Optional tab storage unavailable', 'SecurityError'); };
                if (failure === 'getter') Object.defineProperty(window, 'sessionStorage', { get: fail });
                else {
                    const store = window.sessionStorage, original = window.Storage.prototype[failure];
                    window.Storage.prototype[failure] = function (...args) { return this === store ? fail() : original.apply(this, args); };
                }
            });
            try {
                expect(click(dom, '#inside .button').href).toBe(`https://beta.example${root}lobby/?entry-return=1`);
                click(dom, '#owner');
                expect(dom.window.document.querySelector('#status').textContent).toBe('Invitation accepted.');
                dom.window.fetch.mockClear();
                dom.window.fetch.mockImplementation(async path => path === '/beta/logout'
                    ? new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } })
                    : new Response('{"error":"Private invitation required."}', { status: 401, headers: { 'Content-Type': 'application/json' } }));
                dom.window.document.querySelector('#logout').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
                await vi.waitFor(() => expect(dom.window.document.querySelector('#status').textContent).toBe('A private invitation is required.'));
                expect(dom.window.document.querySelector('#inside').hidden).toBe(true);
                expect(dom.window.fetch.mock.calls.map(call => call[0])).toEqual(['/beta/logout', '/beta/state']);
                expect(dom.window.document.querySelector('#status').textContent).toBe('A private invitation is required.');
                expect(attempts.length).toBeGreaterThan(0); expect(errors).toEqual([]);
            } finally { dom.window.close(); }
        });
    }

    for (const failure of ['getter', 'setItem']) {
        it(`consumes an authenticated gateway bootstrap and joins without browser storage (${failure})`, async () => {
            const page = readFileSync(new URL('../../r/45662413410ed051/lobby/index.html', import.meta.url), 'utf8');
            const client = readFileSync(new URL('../../r/45662413410ed051/lobby/lobby.js', import.meta.url), 'utf8');
            const discovery = readFileSync(new URL('../../r/45662413410ed051/lobby/discovery-core.js', import.meta.url), 'utf8');
            const config = env({ HANGOUT_ENTRY_SITES: JSON.stringify([{ id: 'makers', label: 'Makers' }]),
                ASSETS: { fetch: async () => new Response(page, { headers: { 'Content-Type': 'text/html' } }) } });
            const values = new Map();
            const storage = {
                get: async key => structuredClone(values.get(key)), put: async (key, value) => values.set(key, structuredClone(value)),
                delete: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key); },
                list: async ({ prefix = '', limit = 1000 } = {}) => new Map([...values].filter(([key]) => key.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b)).slice(0, limit)),
                setAlarm: async () => {}, deleteAlarm: async () => {}
            };
            // Actual production invitation/signature/registry path. This success-only
            // memory adapter does not claim native SQLite or socket admission proof.
            storage.transaction = callback => callback(storage);
            const registry = new BetaSessions({ storage, blockConcurrencyWhile: callback => callback() }, config);
            config.BETA_SESSIONS = { idFromName: name => name, get: () => registry };
            const request = (path, cookie) => new Request(`https://beta.example${path}`, { headers: { ...(cookie ? { Cookie: cookie } : {}) } });
            expect((await betaFetch(request('/beta/bootstrap.js'), config)).status).toBe(401);
            const unlocked = await betaFetch(new Request('https://beta.example/beta/unlock', { method: 'POST',
                headers: { Origin: 'https://beta.example', 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.5' },
                body: JSON.stringify({ key: config.HANGOUT_BETA_INVITE_KEY }) }), config);
            expect(unlocked.status).toBe(200);
            const cookie = unlocked.headers.get('Set-Cookie').split(';')[0];
            const bootstrap = await betaFetch(request('/beta/bootstrap.js', cookie), config);
            const shell = await betaFetch(request(`${root}lobby/`, cookie), config);
            expect(bootstrap.status).toBe(200); expect(shell.status).toBe(200);
            const dom = new JSDOM(await shell.text(), { url: `https://beta.example${root}lobby/`, runScripts: 'outside-only', pretendToBeVisual: true });
            try {
                const { window } = dom, sockets = [], failures = [], errors = [];
                window.addEventListener('error', event => errors.push(event.error?.message || event.message));
                for (const name of ['localStorage', 'sessionStorage']) {
                    if (failure === 'getter') Object.defineProperty(window, name, { get() { failures.push(name); throw new window.DOMException('Browser storage blocked', 'SecurityError'); } });
                }
                if (failure === 'setItem') {
                    window.sessionStorage.setItem('hangout-owner', '1'); // A failed write must not reuse this stale hint.
                    window.Storage.prototype.setItem = function () { failures.push('setItem'); throw new window.DOMException('Browser storage full', 'QuotaExceededError'); };
                }
                window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
                window.HTMLDialogElement.prototype.close = function () { this.open = false; };
                window.WebSocket = class {
                    readyState = 0; sent = [];
                    constructor(url) { this.url = url; sockets.push(this); }
                    send(value) { this.sent.push(JSON.parse(value)); }
                    close() { this.readyState = 3; }
                    receive(frame) { this.onmessage?.({ data: JSON.stringify(frame) }); }
                };
                window.eval(await bootstrap.text());
                expect(window.HangoutEntrySites).toContainEqual({ id: 'makers', label: 'Makers' });
                window.HangoutClientTestModules = { ...entryFunctions, createEntrySharing, createChatAnnouncements };
                window.eval(discovery);
                const imports = [...client.matchAll(/^import \{([^}]+)\} from '[^']+';/gm)].map(match => match[1]).join(',');
                window.eval(`const {${imports}} = window.HangoutClientTestModules;\n${client.replace(/^import .*$/gm, '')}`);
                const $ = selector => window.document.querySelector(selector);
                expect($('[data-enter]').hidden).toBe(false);
                $('[data-nick]').value = 'BootstrapGuest'; $('[data-enter]').click();
                await vi.waitFor(() => expect(sockets).toHaveLength(1));
                const ws = sockets[0], target = new URL(ws.url);
                expect(target.pathname).toBe('/lobby'); expect(target.searchParams.get('preview')).toBe(config.HANGOUT_PREVIEW_KEY);
                expect(window.location.search).toBe('');
                ws.readyState = 1; ws.onopen?.(); ws.receive({ t: 'device', token: 'unit-device-token' });
                ws.receive({ t: 'hello', role: 'fan', lock: 'off', budget: 'ok', features: { entrySources: 1 } });
                expect(ws.sent).toContainEqual(expect.objectContaining({ t: 'hello', nick: 'BootstrapGuest', age13: true }));
                ws.receive({ t: 'welcome', nick: 'BootstrapGuest', band: false, capabilities: {} });
                ws.receive({ t: 'join', ch: { name: '#stalemate', kind: 'lobby', title: 'Lobby', topic: '', count: 1, modes: {}, names: [{ id: 'unit-peer', nick: 'BootstrapGuest', prefix: '' }] } });
                expect($('[data-connection]').textContent).toBe('Connected'); expect($('[data-app]').hidden).toBe(false);
                expect($('[data-self-role]').textContent).toBe('Guest access');
                $('[data-text]').value = 'Not stored anywhere by the optional hints';
                $('[data-say]').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
                expect(ws.sent).toContainEqual(expect.objectContaining({ t: 'say', text: 'Not stored anywhere by the optional hints' }));
                expect(failures.length).toBeGreaterThan(0); expect(errors).toEqual([]);
            } finally { dom.window.close(); }
        });
    }
});


describe('truthful invitation and service state in the actual private beta shell', () => {
    it('distinguishes a real registry service failure from a genuinely missing invitation without posting or minting', async () => {
        const config = env(), values = new Map();
        const storage = {
            get: async key => structuredClone(values.get(key)),
            put: async (key, value) => values.set(key, structuredClone(value)),
            delete: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key); },
            list: async ({ prefix = '', limit = 1000 } = {}) => new Map([...values]
                .filter(([key]) => key.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b)).slice(0, limit)),
            setAlarm: async () => {}, deleteAlarm: async () => {}
        };
        // Real production signature/registry requests over a success-only memory
        // adapter; this is neither native storage nor hosted browser-cookie proof.
        storage.transaction = callback => callback(storage);
        const registry = new BetaSessions({ storage, blockConcurrencyWhile: callback => callback() }, config);
        config.BETA_SESSIONS = { idFromName: name => name, get: () => registry };
        const unlocked = await betaFetch(new Request('https://beta.example/beta/unlock', {
            method: 'POST', headers: { Origin: 'https://beta.example', 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.44' },
            body: JSON.stringify({ key: config.HANGOUT_BETA_INVITE_KEY })
        }), config);
        expect(unlocked.status).toBe(200);
        const cookie = unlocked.headers.get('Set-Cookie').split(';')[0];
        const html = await (await betaFetch(new Request('https://beta.example/'), config)).text();
        const client = await (await betaFetch(new Request('https://beta.example/beta/client.js'), config)).text();
        const createPortal = async cookieHeader => {
            const dom = new JSDOM(html, { url: 'https://beta.example/', runScripts: 'outside-only' });
            const calls = [];
            dom.window.entryFunctions = entryFunctions;
            dom.window.fetch = vi.fn(async (path, options = {}) => {
                const method = options.method || 'GET';
                const response = await betaFetch(new Request(new URL(path, 'https://beta.example'), {
                    method, headers: { Origin: 'https://beta.example', ...(cookieHeader ? { Cookie: cookieHeader } : {}),
                        ...(options.headers || {}) }, ...(options.body ? { body: options.body } : {})
                }), config);
                calls.push({ path, method, status: response.status, setsCookie: response.headers.has('Set-Cookie') });
                return response;
            });
            dom.window.eval(client.replace(/^import \{([^}]+)\} from '[^']+';/, 'const {$1} = entryFunctions;'));
            await vi.waitFor(() => expect(dom.window.document.querySelector('#code').disabled).toBe(false));
            return { dom, calls };
        };
        const missing = await createPortal('');
        try {
            expect(missing.calls).toEqual([{ path: '/beta/state', method: 'GET', status: 401, setsCookie: false }]);
            expect(missing.dom.window.document.querySelector('#status').textContent).toBe('A private invitation is required.');
            expect(missing.dom.window.document.querySelector('#login').hidden).toBe(false);
            expect(missing.dom.window.document.querySelector('#inside').hidden).toBe(true);
        } finally { missing.dom.window.close(); }
        const beforeFailure = structuredClone([...values]);
        config.BETA_SESSIONS.get = () => { throw Error('private synthetic registry detail must not reach portal'); };
        const unavailable = await createPortal(cookie);
        try {
            // Establish actual gateway503 and lack of mutation BEFORE the UI
            // oracle; no test-selected503Response substitutes for the gateway.
            expect(unavailable.calls).toEqual([{ path: '/beta/state', method: 'GET', status: 503, setsCookie: false }]);
            expect([...values]).toEqual(beforeFailure);
            const doc = unavailable.dom.window.document;
            expect(doc.querySelector('#inside').hidden).toBe(true);
            expect(doc.querySelector('a[href="/beta/privacy"]')).not.toBeNull();
            expect(doc.querySelector('#status').textContent).not.toContain('private synthetic registry detail');
            expect(doc.querySelector('#status').textContent).not.toBe('A private invitation is required.');
            expect(doc.querySelector('#status').textContent).toMatch(/temporarily unavailable/i);
            expect(doc.querySelector('#login').hidden).toBe(true);
            expect(unavailable.calls.every(call => call.method === 'GET')).toBe(true);
            config.BETA_SESSIONS.get = () => registry;
            const retry = doc.querySelector('#retry');
            expect(retry.hidden).toBe(false);
            retry.click(); retry.click(); // The second native click is disabled.
            expect(retry.disabled).toBe(true);
            await vi.waitFor(() => expect(doc.querySelector('#inside').hidden).toBe(false));
            expect(doc.querySelector('#status').textContent).toBe('Invitation accepted.');
            expect(unavailable.calls).toEqual([
                { path: '/beta/state', method: 'GET', status: 503, setsCookie: false },
                { path: '/beta/state', method: 'GET', status: 200, setsCookie: false }
            ]);
            expect([...values]).toEqual(beforeFailure); // Same actual SID/expiry; no mint.
        } finally { unavailable.dom.window.close(); }
    });
});


describe('explicit recovery and lifecycle fencing in the served invitation portal', () => {
    async function portal(responder, prepare) {
        const config = env();
        const html = await (await betaFetch(new Request('https://beta.example/'), config)).text();
        const client = await (await betaFetch(new Request('https://beta.example/beta/client.js'), config)).text();
        const dom = new JSDOM(html, { url: 'https://beta.example/', runScripts: 'outside-only' });
        dom.window.entryFunctions = entryFunctions;
        const calls = [];
        // Explicit HTTP/network seams around the actual served client. These
        // cases do not claim a real browser cookie jar or actual server revoke.
        dom.window.fetch = vi.fn(async (path, options = {}) => {
            calls.push({ path, method: options.method || 'GET' });
            return responder(path, options, calls.length);
        });
        if (prepare) prepare(dom.window);
        dom.window.eval(client.replace(/^import \{([^}]+)\} from '[^']+';/, 'const {$1} = entryFunctions;'));
        return { dom, calls };
    }
    const state = () => Response.json({ kind: 'guest', role: 'fan', emailConfigured: true, staffConfigured: true });

    for (const operation of ['state', 'unlock', 'logout']) for (const stalledAt of ['headers', 'body']) {
        it(`recovers explicitly from stalled ${operation} ${stalledAt} and ignores its late result`, async () => {
            let release, bodyRead = false, recovering = false, nextTimer = 0;
            const pending = new Promise(resolve => { release = resolve; });
            const timers = new Map(), target = '/beta/' + operation;
            const h = await portal((path, options) => {
                if (path === target && !recovering) {
                    expect(options.signal.aborted).toBe(false);
                    if (stalledAt === 'headers') return pending;
                    const response = Response.json({});
                    response.json = () => { bodyRead = true; return pending; };
                    return response;
                }
                if (path === '/beta/state') return (operation === 'unlock' && !recovering) || (operation === 'logout' && recovering)
                    ? Response.json({ error: 'Private invitation required.' }, { status: 401 }) : state();
                expect(path).toBe('/beta/logout');
                return Response.json({ ok: true });
            }, window => {
                window.sessionStorage.setItem('hangout-owner', 'existing optional hint');
                // Deterministic request-deadline seam around the actual served
                // client, not a browser/network or actual server-revoke proof.
                window.setTimeout = (callback, delay) => {
                    expect(delay).toBe(10000);
                    timers.set(++nextTimer, callback); return nextTimer;
                };
                window.clearTimeout = timer => timers.delete(timer);
            });
            try {
                const { window } = h.dom, doc = window.document;
                if (operation !== 'state') {
                    await vi.waitFor(() => expect(doc.querySelector(operation === 'unlock' ? '#login' : '#inside').hidden).toBe(false));
                    doc.querySelector('#code').value = 'unsent invitation draft';
                    doc.querySelector(operation === 'unlock' ? '#unlock' : '#logout')
                        .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
                }
                if (stalledAt === 'body') await vi.waitFor(() => expect(bodyRead).toBe(true));
                expect(timers.size).toBe(1);
                const request = window.fetch.mock.calls.find(call => call[0] === target);
                const [, fire] = [...timers][0];
                fire();
                const retry = doc.querySelector(operation === 'logout' ? '#retry-leave' : '#retry');
                await vi.waitFor(() => expect(retry.hidden).toBe(false));
                expect(retry.disabled).toBe(false);
                expect(request[1].signal.aborted).toBe(true);
                expect(doc.querySelector('#inside').hidden).toBe(true);
                expect(doc.querySelector('#status').textContent).toMatch(operation === 'logout' ? /Leaving was not confirmed/ : /temporarily unavailable/i);
                expect(window.sessionStorage.getItem('hangout-owner')).toBe('existing optional hint');
                if (operation === 'unlock') expect(doc.querySelector('#code').value).toBe('unsent invitation draft');
                const beforeRetry = h.calls.length;
                await new Promise(resolve => setTimeout(resolve, 0));
                expect(h.calls).toHaveLength(beforeRetry); // No automatic POST replay.
                recovering = true;
                retry.click(); retry.click();
                await vi.waitFor(() => expect(doc.querySelector('#status').textContent).toBe(operation === 'logout'
                    ? 'A private invitation is required.' : 'Invitation accepted.'));
                expect(h.calls.slice(beforeRetry)).toEqual(operation === 'logout'
                    ? [{ path: '/beta/logout', method: 'POST' }, { path: '/beta/state', method: 'GET' }]
                    : [{ path: '/beta/state', method: 'GET' }]);
                expect(window.sessionStorage.getItem('hangout-owner')).toBe(operation === 'logout' ? null : 'existing optional hint');
                const settledStatus = doc.querySelector('#status').textContent, settledCalls = h.calls.length;
                const late = { ok: true, kind: 'staff', role: 'owner', emailConfigured: true, staffConfigured: true };
                release(stalledAt === 'headers' ? Response.json(late) : late);
                await new Promise(resolve => setTimeout(resolve, 0));
                expect(doc.querySelector('#status').textContent).toBe(settledStatus);
                expect(doc.querySelector('#moderation').hidden).toBe(true);
                expect(h.calls).toHaveLength(settledCalls);
                expect(timers.size).toBe(0);
            } finally { release(Response.json({ ok: true })); h.dom.window.close(); }
        });
    }

    it('recovers only on explicit GET after network or malformed state without discarding an invitation draft', async () => {
        const replies = [
            () => { throw Error('private network fixture detail'); },
            () => new Response('private non-json fixture detail', { headers: { 'Content-Type': 'application/json' } }),
            () => Response.json({ kind: 'staff', role: 'private-invalid-role', emailConfigured: true, staffConfigured: true }),
            () => Response.json({ error: 'Private invitation required.' }, { status: 401 })
        ];
        const h = await portal((path, options) => {
            expect(path).toBe('/beta/state'); expect(options.method || 'GET').toBe('GET');
            return replies.shift()();
        }, window => { window.document.querySelector('#code').value = 'unsent invitation draft'; });
        try {
            const doc = h.dom.window.document, retry = doc.querySelector('#retry');
            for (let failedReads = 1; failedReads <= 3; failedReads += 1) {
                await vi.waitFor(() => expect(doc.querySelector('#status').textContent).toMatch(/temporarily unavailable/i));
                expect(h.calls).toHaveLength(failedReads);
                expect(doc.querySelector('#login').hidden).toBe(true);
                expect(doc.querySelector('#inside').hidden).toBe(true);
                expect(doc.querySelector('#code').value).toBe('unsent invitation draft');
                expect(doc.body.textContent).not.toMatch(/private network fixture detail|private non-json fixture detail|private-invalid-role/);
                expect(doc.querySelector('a[href="/beta/privacy"]')).not.toBeNull();
                expect(retry.hidden).toBe(false); expect(retry.disabled).toBe(false);
                retry.click(); retry.click();
                expect(retry.disabled).toBe(true);
            }
            await vi.waitFor(() => expect(doc.querySelector('#login').hidden).toBe(false));
            expect(doc.querySelector('#status').textContent).toBe('A private invitation is required.');
            expect(doc.querySelector('#code').value).toBe('unsent invitation draft');
            expect(retry.hidden).toBe(true);
            expect(h.calls).toEqual(Array.from({ length: 4 }, () => ({ path: '/beta/state', method: 'GET' })));
        } finally { h.dom.window.close(); }
    });

    it('presents a refusal as denied access rather than missing credentials and retries only when chosen', async () => {
        let release;
        const later = new Promise(resolve => { release = resolve; });
        const h = await portal((path, options, count) => count === 1
            ? Response.json({ error: 'private refusal fixture detail' }, { status: 403 }) : later);
        try {
            const doc = h.dom.window.document, retry = doc.querySelector('#retry');
            await vi.waitFor(() => expect(doc.querySelector('#status').textContent).toMatch(/Access was denied/));
            expect(doc.querySelector('#status').textContent).not.toContain('invitation is required');
            expect(doc.querySelector('#status').textContent).not.toContain('private refusal fixture detail');
            expect(doc.querySelector('#login').hidden).toBe(true);
            expect(doc.querySelector('#inside').hidden).toBe(true);
            expect(doc.querySelector('a[href="/beta/privacy"]')).not.toBeNull();
            expect(h.calls).toEqual([{ path: '/beta/state', method: 'GET' }]);
            retry.click(); retry.click();
            expect(retry.disabled).toBe(true);
            expect(doc.querySelector('#code').disabled).toBe(true);
            expect(h.calls).toHaveLength(2);
            release(state());
            await vi.waitFor(() => expect(doc.querySelector('#inside').hidden).toBe(false));
            expect(doc.querySelector('#status').textContent).toBe('Invitation accepted.');
            expect(h.calls.every(call => call.method === 'GET')).toBe(true);
        } finally { release(state()); h.dom.window.close(); }
    });

    it('keeps failed leaving unconfirmed and ignores a held older identity read after confirmed retry', async () => {
        let releaseRead, releaseLeave, posts = 0, reads = 0;
        const olderRead = new Promise(resolve => { releaseRead = resolve; });
        const confirmedLeave = new Promise(resolve => { releaseLeave = resolve; });
        const hintKeys = ['hangout-owner', 'hangout-preview', entryFunctions.ENTRY_HANDOFF_KEY];
        const h = await portal((path, options) => {
            if (path === '/beta/state') return ++reads === 1 ? olderRead : Response.json({ error: 'Private invitation required.' }, { status: 401 });
            expect(path).toBe('/beta/logout'); expect(options.method).toBe('POST');
            return ++posts === 1 ? Response.json({ error: 'private closing fixture detail' }, { status: 503 }) : confirmedLeave;
        }, window => { for (const key of hintKeys) window.sessionStorage.setItem(key, 'existing optional hint'); });
        try {
            const { window } = h.dom, doc = window.document;
            expect(doc.querySelector('#code').disabled).toBe(true);
            // Model a queued form activation while the preceding read is held.
            // The served client must fence it even if aborting fetch is ineffective.
            doc.querySelector('#logout').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
            await vi.waitFor(() => expect(doc.querySelector('#retry-leave').hidden).toBe(false));
            expect(doc.querySelector('#status').textContent).toMatch(/Leaving was not confirmed/);
            expect(doc.querySelector('#status').textContent).not.toContain('private closing fixture detail');
            expect(doc.querySelector('#login').hidden).toBe(true);
            expect(doc.querySelector('#inside').hidden).toBe(true);
            expect(doc.querySelector('#retry').hidden).toBe(true);
            for (const key of hintKeys) expect(window.sessionStorage.getItem(key)).toBe('existing optional hint');
            expect(h.calls).toEqual([{ path: '/beta/state', method: 'GET' }, { path: '/beta/logout', method: 'POST' }]);
            doc.querySelector('#retry-leave').click(); doc.querySelector('#retry-leave').click();
            doc.querySelector('#logout').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
            expect(posts).toBe(2); expect(doc.querySelector('#retry-leave').disabled).toBe(true);
            for (const key of hintKeys) expect(window.sessionStorage.getItem(key)).toBe('existing optional hint');
            releaseLeave(Response.json({ ok: true }));
            await vi.waitFor(() => expect(doc.querySelector('#status').textContent).toBe('A private invitation is required.'));
            for (const key of hintKeys) expect(window.sessionStorage.getItem(key)).toBeNull();
            releaseRead(Response.json({ kind: 'staff', role: 'owner', emailConfigured: true, staffConfigured: true }));
            await window.fetch.mock.results[0].value;
            await new Promise(resolve => window.setTimeout(resolve, 0)); // One event turn, no fake clock or wait-cap change.
            expect(doc.querySelector('#status').textContent).toBe('A private invitation is required.');
            expect(doc.querySelector('#inside').hidden).toBe(true);
            expect(doc.querySelector('#moderation').hidden).toBe(true);
            expect(h.calls).toEqual([
                { path: '/beta/state', method: 'GET' }, { path: '/beta/logout', method: 'POST' },
                { path: '/beta/logout', method: 'POST' }, { path: '/beta/state', method: 'GET' }
            ]);
        } finally {
            releaseRead(Response.json({ error: 'Private invitation required.' }, { status: 401 }));
            releaseLeave(Response.json({ ok: true }));
            h.dom.window.close();
        }
    });
});
