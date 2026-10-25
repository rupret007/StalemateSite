// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { betaFetch } from '../../hangout-worker/src/beta-entry.mjs';
import * as entryFunctions from '../../r/45662413410ed051/entry-sites.mjs';

const root = '/r/45662413410ed051/';
function env(extra = {}) {
    return { HANGOUT_BETA_MODE: 'protected', HANGOUT_HMAC_KEY: 'h'.repeat(40), HANGOUT_BETA_INVITE_KEY: 'i'.repeat(40), HANGOUT_PREVIEW_KEY: 'p'.repeat(40),
        ASSETS: { fetch: vi.fn(async () => new Response(readFileSync(new URL('../../r/45662413410ed051/entry-sites.mjs', import.meta.url), 'utf8'))) },
        LOBBY: {}, QUOTA: {}, ROOMS: {}, BETA_SESSIONS: {}, ...extra };
}
async function shell(address, config = env()) {
    const request = (path) => new Request(new URL(path, address));
    const html = await (await betaFetch(request('/'), config)).text();
    const client = await (await betaFetch(request('/beta/client.js'), config)).text();
    const dom = new JSDOM(html, { url: address, runScripts: 'outside-only' });
    dom.window.entryFunctions = entryFunctions;
    dom.window.fetch = vi.fn(async () => new Response(JSON.stringify({ kind: 'guest', emailConfigured: true, staffConfigured: true }), { headers: { 'Content-Type': 'application/json' } }));
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
