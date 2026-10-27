// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import * as entryFunctions from '../../r/45662413410ed051/entry-sites.mjs';
import { createEntrySharing } from '../../r/45662413410ed051/lobby/entry-sharing.mjs';
import { createChatAnnouncements } from '../../r/45662413410ed051/lobby/chat-announcements.mjs';

const html = readFileSync(new URL('../../r/45662413410ed051/lobby/index.html', import.meta.url), 'utf8');
const client = readFileSync(new URL('../../r/45662413410ed051/lobby/lobby.js', import.meta.url), 'utf8');
const discovery = readFileSync(new URL('../../r/45662413410ed051/lobby/discovery-core.js', import.meta.url), 'utf8');
const activity = readFileSync(new URL('../../r/45662413410ed051/sync-core.js', import.meta.url), 'utf8');
const windows = [];
afterEach(() => { for (const dom of windows.splice(0)) dom.window.close(); });

async function visitor(via = 'stalemate', features = { entrySources: 1 }, { sharing = false, fetcher = async () => Response.json({ ok: true, state: 'unknown', available: false, purposes: [], revision: 0, canStop: false }) } = {}) {
    const dom = new JSDOM(sharing ? html.replace('<head>', '<head><script src="/beta/bootstrap.js"></script>') : html, { url: `http://127.0.0.1:4320/r/45662413410ed051/lobby/?preview=local-preview-key-0001&relay=ws%3A%2F%2F127.0.0.1%3A4320%2Frelay&via=${encodeURIComponent(via)}`, runScripts: 'outside-only' });
    windows.push(dom);
    const { window } = dom; window.HangoutParticipationControls = sharing; window.fetch = vi.fn(fetcher);
    const timers = new Map(), sockets = []; let timerId = 0, elapsed = 0;
    Object.defineProperty(window.performance, 'now', { value: () => elapsed });
    window.setTimeout = (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; };
    window.clearTimeout = (id) => timers.delete(id);
    const paint = () => { for (const [id, task] of [...timers]) if (task.delay === 16) { timers.delete(id); task.fn(); } };
    const flush = (delay) => { for (const [id, task] of [...timers]) if (task.delay === delay) { timers.delete(id); task.fn(); } };
    window.WebSocket = class {
        readyState = 0; sent = [];
        constructor(url) { this.url = url; sockets.push(this); }
        send(text) { this.sent.push(JSON.parse(text)); }
        open() { this.readyState = 1; this.onopen?.(); }
        receive(frame) { this.onmessage?.({ data: JSON.stringify(frame) }); }
        close(code = 1000) { this.readyState = 3; this.onclose?.({ code }); }
    };
    window.HangoutClientTestModules = { ...entryFunctions, createEntrySharing,
        createChatAnnouncements: (log) => createChatAnnouncements(log, { frame: (fn) => window.setTimeout(fn, 16), cancel: (id) => window.clearTimeout(id) }) };
    window.eval(discovery);
    window.eval(activity);
    // Execute the actual browser client, replacing only module loading, which
    // jsdom cannot perform. Real Chromium journeys cover native ESM loading.
    const imports = [...client.matchAll(/^import \{([^}]+)\} from '[^']+';/gm)].map((match) => match[1]).join(',');
    window.eval(`const {${imports}} = window.HangoutClientTestModules;\n${client.replace(/^import .*$/gm, '')}`);
    window.document.querySelector('[data-nick]').value = 'Viewer';
    window.document.querySelector('[data-enter]').click();
    await vi.waitFor(() => expect(sockets.length).toBe(1));
    const ws = sockets[0]; ws.open();
    ws.receive({ t: 'hello', role: 'fan', lock: 'off', budget: 'ok', features });
    const welcome = (socket = ws, seq = 1) => socket.receive({ t: 'welcome', nick: 'Viewer', role: 'fan', band: false, verified: false, capabilities: {}, transportSeq: seq });
    const join = (name = '#stalemate') => ws.receive({ t: 'join', ch: { name, kind: name === '#stalemate' ? 'lobby' : 'chat', title: 'Shared chat', topic: '', count: 1, modes: {}, names: [{ nick: 'Viewer', prefix: '', entrySource: via }] } });
    return { dom, window, ws, sockets, welcome, join, timers, paint, flush, advance: (ms) => { elapsed += ms; } };
}


describe('private caller sharing controls in the actual browser client', () => {
    it('leaves ordinary beta UI and network behavior unchanged', async () => {
        const { window } = await visitor();
        expect(window.document.querySelector('[data-sharing-controls]').hidden).toBe(true); expect(window.fetch).not.toHaveBeenCalled();
    });
    it('shows unknown/expired status without implying email grants permission or collecting private fields', async () => {
        const { window } = await visitor('stalemate', { entrySources: 1 }, { sharing: true, fetcher: async () => Response.json({ ok: true, state: 'expired', available: false, purposes: [], revision: 2, canStop: true }) });
        await vi.waitFor(() => expect(window.document.querySelector('[data-sharing-status]').textContent).toContain('expired'));
        expect(window.document.querySelector('[data-sharing-controls]').textContent).toContain('Email verifies your account, not permission to share');
        expect(window.document.querySelectorAll('[data-sharing-controls] input')).toHaveLength(0);
        expect(window.fetch).toHaveBeenCalledOnce();
    });
    it('requires deliberate confirmation and retains focus and unconfirmed server state while pending', async () => {
        let release; const held = new Promise(resolve => release = resolve), requests = [];
        const { window, ws, welcome, join } = await visitor('stalemate', { entrySources: 1 }, { sharing: true, fetcher: async (url, options) => {
            requests.push({ url, options }); return url.endsWith('/stop') ? held : Response.json({ ok: true, state: 'authorized', available: true, purposes: ['public-text', 'camera'], revision: 2, canStop: true });
        } }); welcome(); join();
        ws.receive({ t: 'line', id: 'mreceived', ch: '#stalemate', from: 'Friend', text: 'A selected received line', ts: 1 });
        const section = window.document.querySelector('[data-sharing-controls]'); section.open = true;
        await vi.waitFor(() => expect(window.document.querySelector('[data-sharing-stop]').disabled).toBe(false));
        window.document.querySelector('[data-sharing-stop]').click(); expect(requests).toHaveLength(1);
        window.document.querySelector('[data-sharing-accept]').click();
        expect(window.document.activeElement).toBe(window.document.querySelector('[data-sharing-region]'));
        expect(window.document.querySelector('[data-sharing-accept]').disabled).toBe(true);
        expect(window.__lobby.sharingStopped).not.toBe(true);
        release(Response.json({ ok: true, state: 'withdrawn', available: false, purposes: [], revision: 3, canStop: true, cleanup: 'confirmed' }));
        await vi.waitFor(() => expect(window.__lobby.sharingStopped).toBe(true));
        expect(JSON.parse(requests[1].options.body)).toEqual({ expectedRevision: 2 });
        expect(window.document.querySelector('[data-buffer]').textContent).toContain('A selected received line');
        expect(window.document.querySelector('[data-text]').disabled).toBe(true);
        expect(window.document.activeElement).toBe(window.document.querySelector('[data-sharing-check]'));
        window.document.querySelector('[data-buffer] .flag').click();
        expect(ws.sent.some(frame => frame.t === 'report' && frame.id === 'mreceived')).toBe(true);
    });
    it('cancels without a write and does not steal focus after a deliberate move', async () => {
        let release; const held = new Promise(resolve => release = resolve);
        const { window, welcome } = await visitor('stalemate', { entrySources: 1 }, { sharing: true, fetcher: async url => url.endsWith('/stop') ? held : Response.json({ ok: true, state: 'authorized', available: true, purposes: ['public-text'], revision: 2, canStop: true }) });
        welcome(); window.document.querySelector('[data-sharing-controls]').open = true;
        await vi.waitFor(() => expect(window.document.querySelector('[data-sharing-stop]').disabled).toBe(false));
        window.document.querySelector('[data-sharing-stop]').click(); window.document.querySelector('[data-sharing-cancel]').click();
        expect(window.fetch).toHaveBeenCalledOnce(); expect(window.document.activeElement).toBe(window.document.querySelector('[data-sharing-stop]'));
        window.document.querySelector('[data-sharing-stop]').click(); window.document.querySelector('[data-sharing-accept]').click();
        window.document.querySelector('[data-sharing-leave]').focus();
        release(Response.json({ ok: true, state: 'withdrawn', available: false, purposes: [], revision: 3, canStop: true }));
        await vi.waitFor(() => expect(window.__lobby.sharingStopped).toBe(true));
        // Leave remains enabled during pending Stop, so a deliberate move
        // to that safety control must not be stolen by the acknowledgement.
        expect(window.document.activeElement).toBe(window.document.querySelector('[data-sharing-leave]'));
    });
    it('keeps a failed write unconfirmed, and labels committed cleanup failure accurately', async () => {
        let fail = true;
        const { window } = await visitor('stalemate', { entrySources: 1 }, { sharing: true, fetcher: async url => {
            if (url.endsWith('/stop')) { if (fail) throw Error('synthetic dropped acknowledgement'); return Response.json({ ok: true, state: 'withdrawn', available: false, purposes: [], revision: 3, canStop: true, cleanup: 'unconfirmed' }); }
            return Response.json({ ok: true, state: 'authorized', available: true, purposes: ['public-text'], revision: 2, canStop: true });
        } });
        window.document.querySelector('[data-sharing-controls]').open = true;
        await vi.waitFor(() => expect(window.document.querySelector('[data-sharing-stop]').disabled).toBe(false));
        window.document.querySelector('[data-sharing-stop]').click(); window.document.querySelector('[data-sharing-accept]').click();
        await vi.waitFor(() => expect(window.document.querySelector('[data-sharing-status]').textContent).toContain('could not be confirmed'));
        expect(window.__lobby.sharingStopped).not.toBe(true);
        fail = false; window.document.querySelector('[data-sharing-check]').click();
        await vi.waitFor(() => expect(window.document.querySelector('[data-sharing-stop]').disabled).toBe(false));
        window.document.querySelector('[data-sharing-stop]').click(); window.document.querySelector('[data-sharing-accept]').click();
        await vi.waitFor(() => expect(window.document.querySelector('[data-sharing-status]').textContent).toContain('withdrawal is saved'));
        expect(window.document.querySelector('[data-sharing-status]').textContent).toContain('cleanup is unconfirmed');
    });
    it('keeps controls reachable before joining and recovers a lost acknowledgement with an explicit withdrawn read', async () => {
        let withdrawn = false;
        const { window } = await visitor('stalemate', { entrySources: 1 }, { sharing: true, fetcher: async () => Response.json(withdrawn
            ? { ok: true, state: 'withdrawn', available: false, purposes: [], revision: 3, canStop: true }
            : { ok: true, state: 'authorized', available: true, purposes: ['camera'], revision: 2, canStop: true }) });
        await vi.waitFor(() => expect(window.document.querySelector('[data-sharing-stop]').disabled).toBe(false));
        expect(window.document.querySelector('.gate-card [data-sharing-controls]')).not.toBeNull();
        withdrawn = true; window.document.querySelector('[data-sharing-check]').click();
        await vi.waitFor(() => expect(window.__lobby.sharingStopped).toBe(true));
        expect(window.document.querySelector('[data-sharing-status]').textContent).toContain('No new sharing');
    });

    it('keeps cleanup uncertainty across a plain GET and offers only an idempotent Stop retry', async () => {
        const writes = []; let withdrawn = false;
        const { window } = await visitor('stalemate', { entrySources: 1 }, { sharing: true, fetcher: async (url, options) => {
            if (url.endsWith('/stop')) { writes.push(JSON.parse(options.body)); withdrawn = true; return Response.json({ ok: true, state: 'withdrawn', available: false, purposes: [], revision: 3, canStop: true, cleanup: writes.length === 1 ? 'unconfirmed' : 'confirmed' }); }
            return Response.json(withdrawn ? { ok: true, state: 'withdrawn', available: false, purposes: [], revision: 3, canStop: true } : { ok: true, state: 'authorized', available: true, purposes: ['camera'], revision: 2, canStop: true });
        } });
        const get = selector => window.document.querySelector(selector);
        await vi.waitFor(() => expect(get('[data-sharing-stop]').disabled).toBe(false));
        get('[data-sharing-stop]').click(); get('[data-sharing-accept]').click();
        await vi.waitFor(() => expect(get('[data-sharing-status]').textContent).toContain('server cleanup is unconfirmed'));
        expect(get('[data-sharing-stop]').textContent).toContain('Retry'); expect(get('[data-sharing-stop]').disabled).toBe(false);
        get('[data-sharing-check]').click(); await vi.waitFor(() => expect(get('[data-sharing-check]').disabled).toBe(false));
        expect(get('[data-sharing-status]').textContent).toContain('server cleanup is unconfirmed');
        expect(window.__lobby.sharingStopped).toBe(true);
        get('[data-sharing-stop]').click(); get('[data-sharing-accept]').click();
        await vi.waitFor(() => expect(get('[data-sharing-stop]').disabled).toBe(true));
        expect(get('[data-sharing-status]').textContent).not.toContain('cleanup is unconfirmed');
        expect(writes).toEqual([{ expectedRevision: 2 }, { expectedRevision: 3 }]);
    });
    it('does not infer cleanup from a missing field, but accepts the committed socket control', async () => {
        const { window, ws, welcome } = await visitor('stalemate', { entrySources: 1 }, { sharing: true, fetcher: async url => Response.json(url.endsWith('/stop')
            ? { ok: true, state: 'withdrawn', available: false, purposes: [], revision: 3, canStop: true }
            : { ok: true, state: 'authorized', available: true, purposes: ['camera'], revision: 2, canStop: true }) }); welcome();
        const get = selector => window.document.querySelector(selector);
        await vi.waitFor(() => expect(get('[data-sharing-stop]').disabled).toBe(false)); get('[data-sharing-stop]').click(); get('[data-sharing-accept]').click();
        await vi.waitFor(() => expect(get('[data-sharing-status]').textContent).toContain('server cleanup is unconfirmed'));
        ws.receive({ t: 'sharing-stopped' });
        expect(get('[data-sharing-status]').textContent).not.toContain('cleanup is unconfirmed'); expect(get('[data-sharing-stop]').disabled).toBe(true);
    });
    it('keeps a committed socket confirmation when its HTTP acknowledgement is lost', async () => {
        let reject; const pending = new Promise((_, fail) => reject = fail);
        const { window, ws, welcome } = await visitor('stalemate', { entrySources: 1 }, { sharing: true, fetcher: async url => url.endsWith('/stop') ? pending
            : Response.json({ ok: true, state: 'authorized', available: true, purposes: ['camera'], revision: 2, canStop: true }) }); welcome();
        const get = selector => window.document.querySelector(selector);
        await vi.waitFor(() => expect(get('[data-sharing-stop]').disabled).toBe(false)); get('[data-sharing-stop]').click(); get('[data-sharing-accept]').click();
        ws.receive({ t: 'sharing-stopped' }); reject(Error('Synthetic lost HTTP acknowledgement'));
        await vi.waitFor(() => expect(get('[data-sharing-check]').disabled).toBe(false));
        expect(get('[data-sharing-status]').textContent).toContain('Sharing is stopped'); expect(get('[data-sharing-status]').textContent).not.toContain('could not be confirmed');
        expect(get('[data-sharing-stop]').disabled).toBe(true);
    });

    it('immediately leaves local media on deliberate Stop while HTTP is pending, and fences late media after failure or authorized reread', async () => {
        let reject; const pending = new Promise((_, fail) => reject = fail), calls = { join: 0, chan: 0, act: 0, cam: 0, leave: 0 };
        const { window, ws, welcome, join } = await visitor('stalemate', { entrySources: 1 }, { sharing: true, fetcher: async url => url.endsWith('/stop') ? pending
            : Response.json({ ok: true, state: 'authorized', available: true, purposes: ['camera', 'public-text'], revision: 2, canStop: true }) }); welcome(); join();
        window.LobbyRoom = { attach: () => ({ onJoin: () => calls.join++, onChan: () => calls.chan++, onAct: () => calls.act++, onCam: () => calls.cam++, onLeave: () => calls.leave++ }) };
        const channel = { name: '#art-paused', kind: 'art', title: 'Art', topic: '', count: 1, modes: { C: true }, names: [{ nick: 'Viewer', prefix: '@' }] };
        ws.receive({ t: 'join', ch: channel }); ws.receive({ t: 'line', id: 'mpaused', ch: channel.name, from: 'Friend', text: 'Still reportable while Stop is pending', ts: 1 });
        expect(calls.join).toBe(1);
        const beforeActivity = structuredClone(window.__lobby.chans.get(channel.name).actSnap);
        const get = selector => window.document.querySelector(selector);
        await vi.waitFor(() => expect(get('[data-sharing-stop]').disabled).toBe(false)); get('[data-sharing-stop]').click(); get('[data-sharing-accept]').click();
        expect(calls.leave).toBe(1); expect(window.__lobby.localMediaPaused).toBe(true); expect(window.__lobby.sharingStopped).not.toBe(true);
        const before = { ...calls };
        ws.receive({ t: 'chan', ch: channel }); ws.receive({ t: 'cam', ch: channel.name, on: true }); ws.receive({ t: 'act', ch: channel.name, kind: 'rtc', sdp: { type: 'offer', sdp: 'synthetic' } }); ws.receive({ t: 'cam-gate' });
        ws.receive({ t: 'act', ch: channel.name, kind: 'stroke', stroke: { id: 'late-after-stop', color: '#009ee8', size: 4, pts: [[0.2, 0.3]] }, ts: 2 });
        expect(window.__lobby.chans.get(channel.name).actSnap).toEqual(beforeActivity);
        expect(calls).toEqual(before); expect(get('[data-cam-gate]').open).not.toBe(true); expect(get('[data-activity]').hidden).toBe(true);
        get('[data-buffer] .flag').click(); expect(ws.sent.some(frame => frame.t === 'report' && frame.id === 'mpaused')).toBe(true);
        reject(Error('Synthetic Stop HTTP failure')); await vi.waitFor(() => expect(get('[data-sharing-check]').disabled).toBe(false));
        get('[data-sharing-check]').click(); await vi.waitFor(() => expect(get('[data-sharing-status]').textContent).toContain('Local media remains off'));
        expect(window.__lobby.sharingStopped).not.toBe(true); expect(window.__lobby.localMediaPaused).toBe(true); expect(calls).toEqual(before);
    });

    it('makes safety actions reachable during pending Stop and leaves the actual socket once without logout or reconnect', async () => {
        let release; const pending = new Promise(resolve => release = resolve);
        const { window, ws, sockets, welcome, join, flush } = await visitor('stalemate', { entrySources: 1 }, { sharing: true, fetcher: async url => url.endsWith('/stop') ? pending
            : Response.json({ ok: true, state: 'authorized', available: true, purposes: ['camera', 'public-text'], revision: 2, canStop: true }) }); welcome(); join();
        window.HTMLDialogElement.prototype.showModal = function () { this.open = true; }; window.HTMLDialogElement.prototype.close = function () { this.open = false; };
        ws.receive({ t: 'line', id: 'mleave', ch: '#stalemate', from: 'Friend', text: 'Received line for safety', ts: 1 });
        const close = ws.close.bind(ws), closes = []; ws.close = (...args) => { closes.push(args); close(...args); };
        const get = selector => window.document.querySelector(selector);
        await vi.waitFor(() => expect(get('[data-sharing-stop]').disabled).toBe(false)); get('[data-sharing-stop]').click(); get('[data-sharing-accept]').click();
        expect(get('[data-sharing-leave]').disabled).toBe(false); expect(get('[data-quick]').hidden).toBe(true); expect(get('[data-lobby-welcome]').hidden).toBe(true);
        expect([...window.document.querySelectorAll('[data-start]')].every(button => button.disabled)).toBe(true);
        expect(get('[data-text]').disabled).toBe(true); expect(get('[data-send]').disabled).toBe(true);
        get('[data-buffer] .flag').click(); expect(ws.sent.some(frame => frame.t === 'report' && frame.id === 'mleave')).toBe(true);
        get('[data-buffer] .who').click(); expect([...window.document.querySelectorAll('[data-sheet-buttons] button')].map(button => button.textContent)).toEqual(['Ignore', 'Block']);
        [...window.document.querySelectorAll('[data-sheet-buttons] button')].find(button => button.textContent === 'Block').click();
        expect(ws.sent.some(frame => frame.t === 'cmd' && frame.name === 'block')).toBe(true);
        get('[data-sharing-leave]').click(); get('[data-sharing-leave]').click();
        expect(closes).toEqual([[1000, 'Left chat']]); expect(ws.onclose).toBeNull(); expect(ws.onmessage).toBeNull();
        expect(window.__lobby.chans.size).toBe(0); expect(window.__lobby.pms.size).toBe(0); expect(get('[data-buffer]').children).toHaveLength(0);
        expect(get('[data-session-reason]').textContent).toContain('You left this chat'); expect(get('[data-session-reason]').textContent).not.toContain('expired');
        release(Response.json({ error: 'Synthetic pending request ended' }, { status: 503 }));
        await vi.waitFor(() => expect(get('[data-sharing-check]').disabled).toBe(false)); flush(1000);
        expect(sockets).toHaveLength(1); expect(window.fetch.mock.calls.some(([url]) => url.includes('logout'))).toBe(false); expect(closes).toHaveLength(1);
    });

});
