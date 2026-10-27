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
    dom.window.fetch = vi.fn(async () => new Response(JSON.stringify({ kind: 'guest', emailConfigured: true, staffConfigured: true }), { headers: { 'Content-Type': 'application/json' } }));
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
                await vi.waitFor(() => expect(dom.window.document.querySelector('#inside').hidden).toBe(true));
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
