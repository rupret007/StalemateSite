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
const windows = [];
afterEach(() => { for (const dom of windows.splice(0)) dom.window.close(); });

async function visitor(via = 'stalemate', features = { entrySources: 1 }) {
    const dom = new JSDOM(html, { url: `http://127.0.0.1:4320/r/45662413410ed051/lobby/?preview=local-preview-key-0001&relay=ws%3A%2F%2F127.0.0.1%3A4320%2Frelay&via=${encodeURIComponent(via)}`, runScripts: 'outside-only' });
    windows.push(dom);
    const { window } = dom, timers = new Map(), sockets = []; let timerId = 0, elapsed = 0;
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

describe('browser client privacy and bounded delivery wiring', () => {
    it('waits for confirmation of the latest privacy choice before any post-welcome user message', async () => {
        const { window, ws, welcome, join } = await visitor('rad-dad');
        expect(ws.sent[0]).toMatchObject({ t: 'hello', entrySource: 'rad-dad', transport: 1 });
        window.document.querySelector('[data-entry-share]').click();
        expect(ws.sent).toHaveLength(1);
        welcome(); join();
        window.document.querySelector('[data-text]').value = 'A new message';
        window.document.querySelector('[data-say]').dispatchEvent(new window.Event('submit', { cancelable: true }));
        expect(ws.sent.slice(1)).toEqual([{ t: 'entry-source', source: '' }]);
        expect(window.document.querySelector('[data-text]').value).toBe('A new message');
        expect(window.document.querySelector('[data-entry-status]').textContent).toContain('confirmation');
        ws.receive({ t: 'entry-source', source: '', accepted: true });
        window.document.querySelector('[data-say]').dispatchEvent(new window.Event('submit', { cancelable: true }));
        expect(ws.sent.slice(1, 3)).toEqual([{ t: 'entry-source', source: '' }, { t: 'say', ch: '#stalemate', text: 'A new message' }]);
        expect([...window.document.querySelectorAll('[data-entry-share]')].every((input) => !input.checked)).toBe(true);
    });
    it('keeps messages and quick actions unsent after a rejected hide while reports remain usable', async () => {
        const { window, ws, welcome, join } = await visitor(); welcome(); join();
        window.document.querySelector('[data-entry-share]').click();
        ws.receive({ t: 'entry-source', source: 'stalemate', accepted: false });
        expect(window.document.querySelector('[data-entry-status]').textContent).toContain('still shared');
        const input = window.document.querySelector('[data-text]'); input.value = 'Keep this private choice';
        window.document.querySelector('[data-say]').dispatchEvent(new window.Event('submit', { cancelable: true }));
        window.document.querySelector('[data-quick-line]').click();
        window.document.querySelector('[data-quick-me]').click();
        expect(ws.sent.some(frame => frame.t === 'say' || frame.t === 'cmd' && frame.name === 'me')).toBe(false);
        expect(input.value).toBe('Keep this private choice');
        window.__lobby.cmd('report', ['Troublemaker']);
        expect(ws.sent.at(-1)).toMatchObject({ t: 'cmd', name: 'report' });
        const choice = window.document.querySelector('[data-entry-share]');
        choice.checked = false; choice.dispatchEvent(new window.Event('change'));
        expect(ws.sent.at(-1)).toEqual({ t: 'entry-source', source: '' });
        ws.receive({ t: 'entry-source', source: '', accepted: true });
        expect(window.document.querySelector('[data-entry-status]').textContent).toContain('Entrance hidden');
        window.document.querySelector('[data-say]').dispatchEvent(new window.Event('submit', { cancelable: true }));
        expect(ws.sent.at(-1)).toMatchObject({ t: 'say', text: 'Keep this private choice' });
    });
    it('waits for a later clear when sharing is enabled and then hidden before the first update returns', async () => {
        const { window, ws, welcome, join } = await visitor(); welcome(); join();
        const choice = window.document.querySelector('[data-entry-share]');
        choice.click(); ws.receive({ t: 'entry-source', source: '', accepted: true });
        choice.click(); choice.click();
        const input = window.document.querySelector('[data-text]'); input.value = 'Wait for my hidden badge';
        const submit = () => window.document.querySelector('[data-say]').dispatchEvent(new window.Event('submit', { cancelable: true }));
        submit();
        expect(ws.sent.filter(frame => frame.t === 'say')).toEqual([]);
        expect(ws.sent.filter(frame => frame.t === 'entry-source')).toEqual([
            { t: 'entry-source', source: '' }, { t: 'entry-source', source: 'stalemate' }
        ]);
        ws.receive({ t: 'entry-source', source: 'stalemate', accepted: true });
        expect(ws.sent.at(-1)).toEqual({ t: 'entry-source', source: '' });
        submit(); expect(ws.sent.filter(frame => frame.t === 'say')).toEqual([]);
        expect(input.value).toBe('Wait for my hidden badge');
        ws.receive({ t: 'entry-source', source: '', accepted: true }); submit();
        expect(ws.sent.at(-1)).toMatchObject({ t: 'say', text: 'Wait for my hidden badge' });
    });
    it('keeps a rollback server usable without unsupported sharing frames or a false badge promise', async () => {
        const { window, ws, welcome, flush, join } = await visitor('rad-dad', null);
        const choice = window.document.querySelector('[data-entry-share]');
        expect(choice.disabled).toBe(true);
        expect([...window.document.querySelectorAll('[data-entry-context]')].every((element) => element.hidden)).toBe(true);
        expect(window.document.querySelector('[data-entry-unavailable]').hidden).toBe(false);
        expect(window.document.querySelector('[data-entry-return]').href).toBe('https://raddadband.com/');
        // A pending/programmatic change must remain harmless even if a legacy
        // server is selected between the initial form choice and welcome.
        choice.checked = false; choice.dispatchEvent(new window.Event('change'));
        welcome(ws, null); join(); flush(50);
        window.document.querySelector('[data-text]').value = 'Still connected';
        window.document.querySelector('[data-say]').dispatchEvent(new window.Event('submit', { cancelable: true }));
        expect(ws.sent.filter((frame) => frame.t === 'entry-source' || frame.t === 'transport-ack')).toEqual([]);
        expect(ws.sent.at(-1)).toMatchObject({ t: 'say', text: 'Still connected' });
    });
    it('requires exact numeric capability version one before enabling sharing controls', async () => {
        for (const feature of [{ entrySources: true }, { entrySources: '1' }, { entrySources: 2 }, {}]) {
            const { window, ws, welcome } = await visitor('stalemate', feature);
            expect(window.document.querySelector('[data-entry-share]').disabled).toBe(true);
            welcome(ws, null);
            expect(ws.sent.filter((frame) => frame.t === 'entry-source')).toEqual([]);
        }
    });
    it('batches handled-frame acknowledgements and cancels a pending acknowledgement on disconnect', async () => {
        const { ws, welcome, flush } = await visitor(); welcome();
        for (let seq = 2; seq <= 8; seq++) ws.receive({ t: 'entry-source', source: 'stalemate', transportSeq: seq });
        expect(ws.sent.filter((frame) => frame.t === 'transport-ack')).toEqual([{ t: 'transport-ack', seq: 8 }]);
        ws.receive({ t: 'entry-source', source: 'stalemate', transportSeq: 9 });
        ws.close(1000); flush(50);
        expect(ws.sent.filter((frame) => frame.t === 'transport-ack')).toHaveLength(1);
    });
    it('never acknowledges an old socket from a replacement connection', async () => {
        const { window, ws, sockets, welcome, flush } = await visitor(); welcome();
        const staleMessage = ws.onmessage;
        window.document.querySelector('[data-reconnect]').click();
        await vi.waitFor(() => expect(sockets.length).toBe(2));
        const replacement = sockets[1]; replacement.open(); replacement.receive({ t: 'hello', role: 'fan', lock: 'off', budget: 'ok' }); welcome(replacement);
        staleMessage({ data: JSON.stringify({ t: 'entry-source', transportSeq: 100 }) }); flush(50);
        expect(ws.sent.filter((frame) => frame.t === 'transport-ack')).toEqual([]);
        expect(replacement.sent.filter((frame) => frame.t === 'transport-ack')).toEqual([{ t: 'transport-ack', seq: 1 }]);
    });
    it('coalesces join bursts into at most one acknowledgement per 50ms', async () => {
        const { ws, welcome, flush, advance } = await visitor(); welcome();
        for (let seq = 2; seq <= 32; seq++) ws.receive({ t: 'entry-source', transportSeq: seq });
        expect(ws.sent.filter((frame) => frame.t === 'transport-ack')).toEqual([{ t: 'transport-ack', seq: 8 }]);
        advance(50); flush(50);
        expect(ws.sent.filter((frame) => frame.t === 'transport-ack')).toEqual([{ t: 'transport-ack', seq: 8 }, { t: 'transport-ack', seq: 32 }]);
        for (let seq = 33; seq <= 48; seq++) ws.receive({ t: 'entry-source', transportSeq: seq });
        expect(ws.sent.filter((frame) => frame.t === 'transport-ack')).toHaveLength(2);
        advance(50); flush(50);
        expect(ws.sent.filter((frame) => frame.t === 'transport-ack').at(-1)).toEqual({ t: 'transport-ack', seq: 48 });
    });
    it('keeps unknown sources neutral and renders allowlisted badges as text', async () => {
        const { window, ws, welcome, join } = await visitor('constructor'); welcome(); join();
        expect(ws.sent[0].entrySource).toBe('');
        expect(window.document.querySelector('[data-entry-context]').hidden).toBe(true);
        ws.receive({ t: 'line', id: 'm1', ch: '#stalemate', from: 'Friend', text: 'Hello', entrySource: '<img onerror=alert(1)>' });
        expect(window.document.querySelector('[data-buffer] .entry-badge')).toBeNull();
        ws.receive({ t: 'line', id: 'm2', ch: '#stalemate', from: 'Friend', text: 'Again', entrySource: 'rad-dad' });
        expect(window.document.querySelector('[data-buffer] .entry-badge').textContent).toBe('via Rad Dad');
        expect(window.document.querySelector('[data-buffer] img')).toBeNull();
    });
    it.each([1009, 4400, 4413, 4429])('pauses resource/protocol close %s instead of spending repeated admission attempts', async (code) => {
        const { window, ws, welcome, join, timers, sockets } = await visitor(); welcome(); join();
        ws.close(code);
        expect(window.document.querySelector('[data-connection]').textContent).toBe('Offline');
        expect(window.document.querySelector('[data-reconnect]').hidden).toBe(false);
        expect(window.document.querySelector('[data-buffer]').textContent).toContain('Connection paused');
        expect([...timers.values()].some((timer) => timer.delay >= 750)).toBe(false);
        expect(sockets).toHaveLength(1);
    });
    it('retains an unsent draft when the actual browser send buffer is full', async () => {
        const { window, ws, welcome, join } = await visitor(); welcome(); join();
        ws.bufferedAmount = 2 * 1024 * 1024;
        const input = window.document.querySelector('[data-text]'); input.value = 'Keep this unsent draft';
        window.document.querySelector('[data-say]').dispatchEvent(new window.Event('submit', { cancelable: true }));
        expect(ws.sent.some((frame) => frame.t === 'say')).toBe(false);
        expect(input.value).toBe('Keep this unsent draft');
        expect(window.document.querySelector('[data-connection]').textContent).toBe('Offline');
    });
    it('starts with polite announcements and preserves an accessible pause across channel repaint', async () => {
        const { window, welcome, join, paint } = await visitor(); welcome(); join();
        const log = window.document.querySelector('[data-buffer]');
        expect(log.getAttribute('aria-live')).toBe('off'); paint(); paint(); expect(log.getAttribute('aria-live')).toBe('polite');
        const choice = window.document.querySelector('[data-chat-announcements]');
        expect(choice.checked).toBe(true); expect(choice.closest('label').textContent).toContain('Announce new chat messages');
        choice.click(); join('#our-room'); paint(); paint(); expect(log.getAttribute('aria-live')).toBe('off');
        expect(log.getAttribute('role')).toBe('log'); expect(log.getAttribute('aria-label')).toBe('Conversation');
    });
});
