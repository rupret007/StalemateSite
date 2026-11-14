// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import * as entryFunctions from '../../r/45662413410ed051/entry-sites.mjs';
import * as gameNightFunctions from '../../r/45662413410ed051/lobby/game-night.mjs';
import { createEntrySharing } from '../../r/45662413410ed051/lobby/entry-sharing.mjs';
import { createIdleHeartbeat } from '../../r/45662413410ed051/lobby/idle-heartbeat.mjs';
import { createChatAnnouncements } from '../../r/45662413410ed051/lobby/chat-announcements.mjs';

const html = readFileSync(new URL('../../r/45662413410ed051/lobby/index.html', import.meta.url), 'utf8');
const client = readFileSync(new URL('../../r/45662413410ed051/lobby/lobby.js', import.meta.url), 'utf8');
const discovery = readFileSync(new URL('../../r/45662413410ed051/lobby/discovery-core.js', import.meta.url), 'utf8');
const windows = [];
afterEach(() => { for (const dom of windows.splice(0)) dom.window.close(); });

async function visitor(via = 'stalemate', features = { entrySources: 1 }, options = {}) {
    const dom = new JSDOM(html, { url: `http://127.0.0.1:4320/r/45662413410ed051/lobby/?preview=local-preview-key-0001&relay=ws%3A%2F%2F127.0.0.1%3A4320%2Frelay&via=${encodeURIComponent(via)}`, runScripts: 'outside-only' });
    windows.push(dom);
    const { window } = dom, timers = new Map(), sockets = []; let timerId = 0, elapsed = 0;
    Object.defineProperty(window.performance, 'now', { value: () => elapsed });
    window.setTimeout = (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; };
    window.clearTimeout = (id) => timers.delete(id);
    if (options.beta) {
        const bootstrap = window.document.createElement('script');
        bootstrap.src = '/beta/bootstrap.js'; window.document.head.append(bootstrap);
        window.HangoutBootstrap = { preview: 'local-preview-key-0001', owner: options.owner === true };
    }
    window.fetch = options.fetch || vi.fn();
    const paint = () => { for (const [id, task] of [...timers]) if (task.delay === 16) { timers.delete(id); task.fn(); } };
    const flush = (delay) => { for (const [id, task] of [...timers]) if (task.delay === delay) { timers.delete(id); task.fn(); } };
    window.WebSocket = class {
        readyState = 0; sent = [];
        constructor(url) { this.url = url; sockets.push(this); }
        send(text) { this.sent.push(JSON.parse(text)); }
        open() { this.readyState = 1; this.onopen?.(); }
        receive(frame) { this.onmessage?.({ data: JSON.stringify(frame) }); }
        close(code = 1000) { this.readyState = 3; return this.onclose?.({ code }); }
    };
    window.HangoutClientTestModules = { ...entryFunctions, ...gameNightFunctions, createEntrySharing, createIdleHeartbeat,
        createChatAnnouncements: (log) => createChatAnnouncements(log, { frame: (fn) => window.setTimeout(fn, 16), cancel: (id) => window.clearTimeout(id) }) };
    window.eval(discovery);
    // Execute the actual browser client, replacing only module loading, which
    // jsdom cannot perform. Real Chromium journeys cover native ESM loading.
    const imports = [...client.matchAll(/^import \{([^}]+)\} from '[^']+';/gm)].map((match) => match[1]).join(',');
    window.eval(`const entrance = window.HangoutClientTestModules; const {${imports}} = entrance;\n${client.replace(/^import .*$/gm, '')}`);
    window.document.querySelector('[data-nick]').value = 'Viewer';
    window.document.querySelector('[data-enter]').click();
    await vi.waitFor(() => expect(sockets.length).toBe(1));
    const ws = sockets[0];
    if (options.open !== false) {
        ws.open();
        ws.receive({ t: 'hello', role: 'fan', lock: 'off', budget: 'ok', features });
    }
    const welcome = (socket = ws, seq = 1) => socket.receive({ t: 'welcome', nick: 'Viewer', role: 'fan', band: false, verified: false, capabilities: {}, transportSeq: seq });
    const join = (name = '#stalemate') => ws.receive({ t: 'join', ch: { name, kind: name === '#stalemate' ? 'lobby' : 'chat', title: 'Shared chat', topic: '', count: 1, modes: {}, names: [{ nick: 'Viewer', prefix: '', entrySource: via }] } });
    return { dom, window, ws, sockets, welcome, join, timers, paint, flush, advance: (ms) => { elapsed += ms; } };
}

it('keeps the external Arcade note description-only in the ordinary lobby', async () => {
    const { window } = await visitor('rad-dad');
    const link = window.document.querySelector('[data-game-arcade-external]');
    const note = window.document.getElementById(link.getAttribute('aria-describedby'));
    expect(link.hidden).toBe(false);
    expect(link.textContent).toContain('Open Rad Dad Arcade');
    expect(new URL(link.href).pathname).toBe('/play/');
    expect(link.target).toBe('_blank');
    expect(note.hidden).toBe(true);
    expect(note.textContent).toBe('Opens in a new tab');
});

it('rewrites a saved Game Night hint with only navigation fields', async () => {
    const { window, welcome } = await visitor('stalemate', { gameNight: 1 }, { beta: true });
    const key = 'hangout-game-return';
    const hint = { room: '#game-1acbefx23acbe', ref: 'c'.repeat(32), until: Date.now() + 60_000, game: 'chess' };
    window.sessionStorage.setItem(key, JSON.stringify({ ...hint, seat: 'b', ticket: 'placeholder', grant: 'placeholder' }));
    welcome();
    expect(JSON.parse(window.sessionStorage.getItem(key))).toEqual(hint);
    expect(window.document.querySelector('[data-game-offer]').textContent).toContain('Back to my seat');
});

describe('private entry recovery after a rejected socket admission', () => {
    it('offers normal private entry only after the same-origin access check returns 401', async () => {
        const fetch = vi.fn(async () => ({ status: 401 }));
        const { window, ws, sockets } = await visitor('rad-dad', undefined, { beta: true, open: false, fetch });
        await ws.close(1006);
        const link = window.document.querySelector('[data-gate-private-entry]');
        expect(link?.hidden).toBe(false);
        expect(link.getAttribute('href')).toBe('/beta/');
        expect(window.document.querySelector('[data-gate-status]').textContent).toContain('private access');
        expect(window.document.querySelector('[data-nick]').value).toBe('Viewer');
        expect(window.document.querySelector('[data-gate]').hidden).toBe(false);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(fetch.mock.calls[0][0]).toBe('/beta/state');
        expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin', cache: 'no-store' });
        expect(sockets).toHaveLength(1);
    });
    it.each([200, 403, 429, 503])('does not diagnose missing access from status %s', async status => {
        const { window, ws } = await visitor('', undefined, { beta: true, open: false, fetch: vi.fn(async () => ({ status })) });
        await ws.close(1006);
        expect(window.document.querySelector('[data-gate-private-entry]')?.hidden).toBe(true);
        const message = window.document.querySelector('[data-gate-status]').textContent;
        expect(message).toContain('Couldn’t connect');
        expect(message).not.toMatch(/private access|got the boot|locked|full/i);
    });
    it('keeps public admission failures independent of the private access service', async () => {
        const fetch = vi.fn();
        const { window, ws } = await visitor('', undefined, { open: false, fetch });
        await ws.close(1006);
        expect(fetch).not.toHaveBeenCalled();
        expect(window.document.querySelector('[data-gate-private-entry]')?.hidden).toBe(true);
    });
    it('keeps network errors truthful and bounds an unresponsive check', async () => {
        const failed = await visitor('', undefined, { beta: true, open: false, fetch: vi.fn(async () => { throw Error('synthetic network failure'); }) });
        await failed.ws.close(1006);
        expect(failed.window.document.querySelector('[data-gate-private-entry]')?.hidden).toBe(true);
        const fetch = vi.fn(() => new Promise(() => {}));
        const stalled = await visitor('', undefined, { beta: true, open: false, fetch });
        const closing = stalled.ws.close(1006);
        expect(fetch).toHaveBeenCalledTimes(1);
        stalled.flush(3000); await closing;
        expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
        expect(stalled.window.document.querySelector('[data-gate-private-entry]')?.hidden).toBe(true);
        expect(stalled.sockets).toHaveLength(1);
    });
    it('cancels the old check and ignores its late denial after a newer successful join', async () => {
        let complete;
        const fetch = vi.fn(() => new Promise(resolve => { complete = resolve; }));
        const { window, ws, sockets, welcome } = await visitor('', undefined, { beta: true, open: false, fetch });
        const closing = ws.close(1006);
        window.document.querySelector('[data-enter]').click();
        await vi.waitFor(() => expect(sockets).toHaveLength(2));
        const current = sockets[1]; current.open(); welcome(current);
        complete({ status: 401 }); await closing;
        expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
        expect(window.document.querySelector('[data-connection]').textContent).toBe('Connected');
        expect(window.document.querySelector('[data-gate-private-entry]')?.hidden).toBe(true);
    });
    it('cancels on page departure and never probes an ordinary successful connection', async () => {
        const fetch = vi.fn(() => new Promise(() => {}));
        const { window, ws } = await visitor('', undefined, { beta: true, open: false, fetch });
        const closing = ws.close(1006);
        window.dispatchEvent(new window.Event('pagehide')); await closing;
        expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
        expect(window.document.querySelector('[data-gate-private-entry]')?.hidden).toBe(true);
        const healthyFetch = vi.fn();
        const healthy = await visitor('', undefined, { beta: true, fetch: healthyFetch });
        healthy.welcome(); healthy.join(); await healthy.ws.close(4401);
        expect(healthyFetch).not.toHaveBeenCalled();
    });
    it('distinguishes private access renewal from verified-email recovery', async () => {
        const missing = await visitor('', undefined, { beta: true, owner: true, open: false, fetch: vi.fn(async () => ({ status: 401 })) });
        await missing.ws.close(1006);
        expect(missing.window.document.querySelector('[data-gate-status]').textContent).toContain('private access');
        const email = await visitor('', undefined, { beta: true, owner: true, open: false, fetch: vi.fn(async () => ({ status: 200 })) });
        await email.ws.close(1006);
        expect(email.window.document.querySelector('[data-gate-status]').textContent).toContain('Email sign-in');
        expect(email.window.document.querySelector('[data-gate-guest]').hidden).toBe(false);
    });
    it('ends an expired private reconnect without losing its unsent draft', async () => {
        const fetch = vi.fn(async () => ({ status: 401 }));
        const { window, ws, sockets, welcome, join } = await visitor('', undefined, { beta: true, fetch });
        welcome(); join();
        window.document.querySelector('[data-text]').value = 'Keep this unsent rehearsal note';
        await ws.close(4429);
        window.document.querySelector('[data-reconnect]').click();
        await vi.waitFor(() => expect(sockets).toHaveLength(2));
        await sockets[1].close(1006);
        expect(window.document.querySelector('[data-session-ended]').hidden).toBe(false);
        expect(window.document.querySelector('[data-session-reason]').textContent).toContain('private community access needs renewal');
        expect(window.document.querySelector('[data-session-reentry]').hidden).toBe(false);
        expect(window.document.querySelector('[data-text]').value).toBe('Keep this unsent rehearsal note');
        expect(window.document.querySelector('[data-text]').readOnly).toBe(true);
        expect(fetch).toHaveBeenCalledTimes(1);
    });
});

describe('browser client privacy and bounded delivery wiring', () => {
    async function ownerPalette(cohosts = []) {
        const view = await visitor('stalemate', { entrySources: 1, personTargets: 1 });
        const { window, ws, welcome } = view;
        // Only the dialog surface is substituted; the real client receives
        // ordered socket frames and builds/sends its own Host tools commands.
        window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
        window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
        window.confirm = vi.fn(() => true);
        welcome();
        const channel = { name: '#owned', kind: 'chat', persistent: true, keepRef: 'a'.repeat(32), modes: {}, count: 1, cohosts,
            names: [{ nick: 'Viewer', prefix: '@', owner: true }] };
        ws.receive({ t: 'join', ch: channel });
        window.document.querySelector('[data-roomtools]').click();
        const palette = window.document.querySelector('[data-palette]');
        return { ...view, channel, palette, buttons: () => [...palette.querySelectorAll('button')],
            ownership: cohosts => ws.receive({ t: 'ownership', ch: channel.name, cohosts }) };
    }
    it('reconciles named co-host actions without replacing focused controls or leaking them into slash commands', async () => {
        const { window, ws, palette, buttons, ownership } = await ownerPalette();
        const invite = buttons().find(button => button.textContent === 'Invite guest'); invite.focus();
        ownership([{ id: 'account-one', label: 'FirstCoHost' }]);
        const remove = buttons().find(button => button.textContent === 'Remove verified co-host: FirstCoHost');
        expect(remove).toBeDefined(); expect(window.document.activeElement).toBe(invite);
        remove.focus();
        ownership([{ id: 'account-one', label: 'RenamedCoHost' }]);
        expect(buttons().find(button => button.textContent === 'Remove verified co-host: RenamedCoHost')).toBe(remove);
        expect(window.document.activeElement).toBe(remove);
        ownership([]);
        expect(remove.isConnected).toBe(false); expect(window.document.activeElement).toBe(invite);
        const sent = ws.sent.length; remove.click(); expect(ws.sent).toHaveLength(sent);
        palette.close();
        window.document.querySelector('[data-palette-open]').click();
        ownership([{ id: 'account-two', label: 'OtherCoHost' }]);
        expect(buttons().some(button => button.textContent.startsWith('Remove verified co-host'))).toBe(false);
    });
    it.each(['owner revoked', 'room replaced', 'disconnected'])('retires open named co-host controls when %s', async reason => {
        const { ws, channel, buttons } = await ownerPalette([{ id: 'account-one', label: 'FirstCoHost' }]);
        const remove = buttons().find(button => button.textContent === 'Remove verified co-host: FirstCoHost');
        expect(remove).toBeDefined();
        if (reason === 'disconnected') ws.close(1000);
        else ws.receive({ t: 'chan', ch: { ...channel, ...(reason === 'room replaced' ? { keepRef: 'b'.repeat(32) }
            : { names: [{ nick: 'Viewer', prefix: '', owner: false }] }) } });
        expect(remove.isConnected).toBe(false);
        const sent = ws.sent.length; remove.click(); expect(ws.sent).toHaveLength(sent);
    });
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
    it('shows Session ended after a beta revocation close instead of a reconnectable offline state', async () => {
        const { window, ws, welcome, join } = await visitor(); welcome(); join();
        ws.close(4401);
        expect(window.document.querySelector('[data-connection]').textContent).toBe('Session ended');
        expect(window.document.querySelector('[data-connection]').getAttribute('data-state')).toBe('ended');
        expect(window.document.querySelector('[data-session-ended]').hidden).toBe(false);
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
    it('bounds and clears messages without removing their list or the live-region preference', async () => {
        const { window, ws, welcome, join, paint } = await visitor(); welcome(); join(); paint(); paint();
        const log = window.document.querySelector('[data-buffer]');
        const messages = log.querySelector('[role="list"][aria-label="Messages"]');
        expect(messages).not.toBeNull();
        for (let index = 0; index < 305; index++)
            ws.receive({ t: 'line', id: `bounded-${index}`, ch: '#stalemate', from: 'Friend', text: `Bounded line ${index}` });
        expect(messages.children).toHaveLength(300);
        expect(messages.firstElementChild.textContent).toContain('Bounded line 5');
        expect(messages.lastElementChild.textContent).toContain('Bounded line 304');
        expect([...messages.children].every(item => item.tagName === 'LI')).toBe(true);
        window.document.querySelector('[data-chat-announcements]').click();
        join('#another-room'); paint(); paint();
        expect(log.querySelector('[role="list"]')).toBe(messages);
        expect(messages.children).toHaveLength(0);
        expect(log.getAttribute('aria-live')).toBe('off');
        ws.close(4401);
        expect(log.querySelector('[role="list"]')).toBe(messages);
        expect(messages.children).toHaveLength(0);
        expect(log.getAttribute('aria-live')).toBe('off');
    });
});
