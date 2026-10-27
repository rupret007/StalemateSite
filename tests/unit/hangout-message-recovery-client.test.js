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

async function visitor(features = { messageResults: 1, privateMessageContext: 1, privateMessagePeers: 1 }) {
    const dom = new JSDOM(html, { url: 'http://127.0.0.1:4320/r/45662413410ed051/lobby/?preview=local-preview-key-0001&relay=ws%3A%2F%2F127.0.0.1%3A4320%2Frelay', runScripts: 'outside-only' });
    windows.push(dom);
    const { window } = dom, timers = new Map(), sockets = []; let timerId = 0;
    window.confirm = vi.fn(() => true);
    window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
    window.setTimeout = (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; };
    window.clearTimeout = id => timers.delete(id);
    const flush = delay => { for (const [id, task] of [...timers]) if (task.delay === delay) { timers.delete(id); task.fn(); } };
    window.WebSocket = class {
        readyState = 0; sent = [];
        constructor(url) { this.url = url; sockets.push(this); }
        send(text) { this.sent.push(JSON.parse(text)); }
        open() { this.readyState = 1; this.onopen?.(); }
        receive(frame) { this.onmessage?.({ data: JSON.stringify(frame) }); }
        close(code = 1000) { this.readyState = 3; this.onclose?.({ code }); }
    };
    window.HangoutClientTestModules = { ...entryFunctions, createEntrySharing,
        createChatAnnouncements: log => createChatAnnouncements(log, { frame: fn => window.setTimeout(fn, 16), cancel: id => window.clearTimeout(id) }) };
    window.eval(discovery);
    const imports = [...client.matchAll(/^import \{([^}]+)\} from '[^']+';/gm)].map(match => match[1]).join(',');
    window.eval(`const {${imports}} = window.HangoutClientTestModules;\n${client.replace(/^import .*$/gm, '')}`);
    const $ = selector => window.document.querySelector(selector);
    $('[data-nick]').value = 'Viewer'; $('[data-enter]').click();
    await vi.waitFor(() => expect(sockets.length).toBe(1));
    const ws = sockets[0]; ws.open();
    const welcome = (socket = ws) => { socket.receive({ t: 'hello', role: 'fan', lock: 'off', budget: 'ok', features }); socket.receive({ t: 'welcome', nick: 'Viewer', band: false }); };
    const join = (name = '#stalemate') => ws.receive({ t: 'join', ch: { name, kind: name === '#stalemate' ? 'lobby' : 'chat', title: name, topic: '', modes: {}, names: [{ nick: 'Viewer', prefix: '' }] } });
    welcome(); join();
    const input = text => { $('[data-text]').value = text; $('[data-text]').dispatchEvent(new window.Event('input')); };
    const submit = text => { if (text !== undefined) input(text); $('[data-say]').dispatchEvent(new window.Event('submit', { cancelable: true })); return ws.sent.at(-1); };
    const result = (status, frame = ws.sent.findLast(frame => frame.clientMessageId)) => ws.receive({ t: 'message-result', id: frame.clientMessageId, status });
    const rows = () => [...$('[data-message-recovery-list]').children];
    const action = name => $(`[data-message-action="${name}"]`);
    return { window, ws, $, timers, sockets, flush, welcome, join, input, submit, result, rows, action };
}

describe('bounded tab-only composer recovery', () => {
    it('keeps a pending copy until its own committed result, ignoring unrelated notices and tokens', async () => {
        const f = await visitor(), frame = f.submit('One exact local copy');
        expect(frame.clientMessageId).toMatch(/^[a-f0-9]{32}$/); expect(f.$('[data-text]').value).toBe('');
        expect(f.rows()).toHaveLength(1); expect(f.action('restore').disabled).toBe(true);
        f.ws.receive({ t: 'notice', kind: 'error', text: 'An unrelated error' });
        f.ws.receive({ t: 'message-result', id: 'f'.repeat(32), status: 'published' });
        expect(f.rows()).toHaveLength(1);
        f.result('published', frame); expect(f.rows()).toHaveLength(0);
        expect(f.ws.sent.filter(frame => frame.t === 'say')).toHaveLength(1);
    });

    it('restores a refused draft only on request without sending it or replacing newer text', async () => {
        const f = await visitor(), frame = f.submit('Refused exact text'); f.result('rejected', frame);
        expect(f.action('restore').disabled).toBe(false);
        f.input('A newer draft'); expect(f.action('restore').disabled).toBe(true);
        f.action('restore').click(); expect(f.$('[data-text]').value).toBe('A newer draft');
        f.input(''); expect(f.action('restore').disabled).toBe(true); // Even a deliberately cleared newer draft is newer.
        expect(f.ws.sent.filter(frame => frame.t === 'say')).toHaveLength(1);
        const g = await visitor(); g.submit('Restore this refusal'); g.result('rejected'); g.action('restore').click();
        expect(g.$('[data-text]').value).toBe('Restore this refusal'); expect(g.rows()).toHaveLength(0);
        expect(g.ws.sent.filter(frame => frame.t === 'say')).toHaveLength(1);
        expect(g.window.document.activeElement).toBe(g.$('[data-text]'));
    });

    it.each(['held', 'pending'])('retains a %s copy without claiming publication or automatically resending it', async status => {
        const f = await visitor(); f.submit('Still pending original'); f.result(status);
        expect(f.rows()[0].textContent).toContain(status === 'held' ? 'instead of publishing' : 'instead of delivering');
        f.window.confirm.mockReturnValueOnce(false); f.action('restore').click(); expect(f.rows()).toHaveLength(1);
        f.action('restore').click(); expect(f.window.confirm).toHaveBeenCalledWith(expect.stringContaining('duplicate'));
        expect(f.$('[data-text]').value).toBe('Still pending original');
        expect(f.ws.sent.filter(frame => frame.t === 'say')).toHaveLength(1);
    });

    it('does not restore across room replacement, different tabs or a closed PM context', async () => {
        const f = await visitor(); f.submit('Original room copy'); f.result('rejected');
        f.join('#other-room'); expect(f.action('restore').disabled).toBe(true);
        expect(f.rows()[0].querySelector('.saved-message-text')).toBeNull();
        f.join('#stalemate'); expect(f.action('restore').disabled).toBe(true); // New membership object with the same name.
        f.action('discard').click(); const ref = 'c'.repeat(32); f.ws.receive({ t: 'pm-open', with: 'Friend', peer: 'friend-connection', ref });
        const pm = f.submit('Private exact body'); expect(pm).toMatchObject({ t: 'say', ch: `pm:${ref}`, pmPeer: 'friend-connection', pmRef: ref, text: 'Private exact body' });
        f.result('rejected', pm); expect(f.action('restore').disabled).toBe(false);
        f.ws.receive({ t: 'pm-closed', with: 'Friend', peer: 'friend-connection', ref }); expect(f.action('restore').disabled).toBe(true);
    });

    it.each([undefined, true, '1', 2])('uses honest legacy uncertainty for capability %s without putting a token on the wire', async feature => {
        const f = await visitor(feature === undefined ? {} : { messageResults: feature });
        const frame = f.submit('Legacy local copy'); expect(frame).not.toHaveProperty('clientMessageId');
        expect(f.rows()[0].textContent).toContain('cannot confirm');
        f.ws.receive({ t: 'message-result', id: 'f'.repeat(32), status: 'published' });
        expect(f.rows()).toHaveLength(1); expect(f.action('restore').disabled).toBe(false);
    });

    it('never silently evicts a copy when count or conservative UTF-8 byte limits are reached', async () => {
        const f = await visitor();
        for (let index = 0; index < 8; index++) f.submit(`Waiting copy ${index}`);
        f.submit('Keep the ninth in the composer'); expect(f.rows()).toHaveLength(8);
        expect(f.ws.sent.filter(frame => frame.t === 'say')).toHaveLength(8);
        expect(f.$('[data-text]').value).toBe('Keep the ninth in the composer');
        f.action('discard').click(); f.submit(); expect(f.rows()).toHaveLength(8);
        const g = await visitor(); const text = '\u0800'.repeat(300);
        for (let index = 0; index < 8; index++) g.submit(text);
        // Max 300 UTF-16 characters means each record is < 1.3KiB; count is
        // the tighter bound in this protocol. The explicit byte guard remains.
        expect(g.rows()).toHaveLength(8); expect(g.$('[data-message-recovery-list]').textContent.length).toBeLessThan(12000);
    });

    it('treats timeout and later results as uncertain rather than inventing a success', async () => {
        const f = await visitor(), frame = f.submit('Maybe arrived'); f.flush(10000);
        expect(f.rows()[0].textContent).toContain('unconfirmed'); f.result('published', frame);
        expect(f.rows()).toHaveLength(1); expect(f.ws.sent.filter(frame => frame.t === 'say')).toHaveLength(1);
    });

    it('returns focus to a live control when a timeout/result replaced the manual-copy opener', async () => {
        const f = await visitor(); f.submit('Copy during a pending result');
        f.action('copy').focus(); f.action('copy').click();
        await vi.waitFor(() => expect(f.$('[data-message-copy]').open).toBe(true));
        const oldOpener = f.action('copy'); f.flush(10000); expect(oldOpener.isConnected).toBe(false);
        f.$('[data-message-copy-close]').click(); expect(f.window.document.activeElement).toBe(f.action('copy'));
        f.action('discard').click();
        f.submit('Published while copying'); f.action('copy').click();
        await vi.waitFor(() => expect(f.$('[data-message-copy]').open).toBe(true));
        f.result('published'); expect(f.$('[data-message-copy]').open).toBe(false);
        expect(f.window.document.activeElement).toBe(f.$('[data-text]'));
    });

    it('restores focus after native close with a detached opener and ignores an old close event after reopening', async () => {
        const f = await visitor(); f.submit('Copy survives stale close events');
        f.action('copy').focus(); f.action('copy').click();
        await vi.waitFor(() => expect(f.$('[data-message-copy]').open).toBe(true));
        const old = f.action('copy'); f.flush(10000); expect(old.isConnected).toBe(false);
        f.$('[data-message-copy-text]').blur(); expect(f.window.document.activeElement).toBe(f.window.document.body);
        f.$('[data-message-copy]').close();
        expect(f.window.document.activeElement).toBe(f.action('copy'));
        f.action('copy').click(); await vi.waitFor(() => expect(f.$('[data-message-copy]').open).toBe(true));
        f.$('[data-message-copy]').dispatchEvent(new f.window.Event('close'));
        expect(f.$('[data-message-copy]').open).toBe(true);
        expect(f.$('[data-message-copy-text]').value).toBe('Copy survives stale close events');
    });

    it('pauses reconnect with reachable Copy/Discard and deliberate warning, then rejects old-epoch results', async () => {
        const f = await visitor(), frame = f.submit('Private maybe-arrived copy'); f.ws.close(1006);
        expect(f.$('[data-reconnect]').hidden).toBe(false);
        expect(f.$('[data-message-recovery-status]').textContent).toContain('may have arrived');
        expect([...f.timers.values()].some(task => task.delay >= 750 && task.delay < 10000)).toBe(false);
        f.action('copy').click(); await vi.waitFor(() => expect(f.$('[data-message-copy]').open).toBe(true));
        expect(f.$('[data-message-copy-text]').value).toBe('Private maybe-arrived copy');
        f.$('[data-message-copy-close]').click();
        f.window.confirm.mockReturnValueOnce(false); f.$('[data-reconnect]').click(); expect(f.sockets).toHaveLength(1);
        f.$('[data-reconnect]').click(); await vi.waitFor(() => expect(f.sockets).toHaveLength(2));
        expect(f.window.confirm).toHaveBeenCalledWith(expect.stringContaining('clears every saved copy'));
        const replacement = f.sockets[1]; replacement.open(); f.welcome(replacement);
        replacement.receive({ t: 'message-result', id: frame.clientMessageId, status: 'rejected' });
        expect(f.rows()).toHaveLength(0); expect(f.$('[data-message-copy-text]').value).toBe('');
    });

    it.each(['revoked', 'pagehide', 'signout', 'quit'])('clears sensitive copies and late clipboard fallback on %s', async action => {
        const f = await visitor(); let rejectClipboard;
        Object.defineProperty(f.window.navigator, 'clipboard', { value: { writeText: () => new Promise((_done, reject) => { rejectClipboard = reject; }) } });
        f.submit('Private tab copy'); f.result('rejected'); f.action('copy').click();
        if (action === 'revoked') f.ws.close(4401);
        else if (action === 'pagehide') f.window.dispatchEvent(new f.window.Event('pagehide'));
        else if (action === 'signout') f.$('[data-owner-signout]').click();
        else f.submit('/quit');
        rejectClipboard(Error('synthetic denied clipboard')); await Promise.resolve(); await Promise.resolve();
        expect(f.rows()).toHaveLength(0); expect(f.$('[data-message-copy]').open).toBe(false);
        expect(f.$('[data-message-copy-text]').value).toBe('');
        expect(JSON.stringify([...Array(f.window.sessionStorage.length)].map((_value, index) => f.window.sessionStorage.getItem(f.window.sessionStorage.key(index))))).not.toContain('Private tab copy');
    });

    it('does not tag slash commands, quick actions or local transport failures', async () => {
        const f = await visitor(); f.submit('/help'); expect(f.ws.sent.at(-1)).not.toHaveProperty('clientMessageId'); expect(f.rows()).toHaveLength(0);
        f.ws.send = () => { throw Error('synthetic closed transport'); };
        f.submit('Keep this unsent draft'); expect(f.rows()).toHaveLength(0); expect(f.$('[data-text]').value).toBe('Keep this unsent draft');
    });
});


describe('reference-bound PM view and draft lifetime', () => {
    it('updates a live peer label without replacing its draft or routing delayed own echoes by a previous self nickname', async () => {
        const f = await visitor(), ref = 'd'.repeat(32), peer = 'original-peer';
        f.ws.receive({ t: 'pm-open', with: 'Friend', peer, ref });
        f.input('An ordinary unsent draft for this exact peer');
        f.ws.receive({ t: 'welcome', nick: 'RenamedViewer', band: false });
        f.ws.receive({ t: 'pm', id: 'pdelayed', with: 'Friend', peer, ref, from: 'Viewer', to: 'Friend', text: 'An earlier own echo keeps its historical author' });
        f.ws.receive({ t: 'pm-peer', with: 'RenamedFriend', peer, ref });
        expect([...f.window.__lobby.pms.keys()]).toEqual([ref]);
        expect(f.$('[data-chat-context]').textContent).toBe('PM · RenamedFriend');
        expect(f.$('[data-buffer]').textContent).toContain('An earlier own echo keeps its historical author');
        expect(f.$('[data-text]').value).toBe('An ordinary unsent draft for this exact peer');
        const sent = f.submit();
        expect(sent).toMatchObject({ t: 'say', ch: `pm:${ref}`, pmPeer: peer, pmRef: ref, text: 'An ordinary unsent draft for this exact peer' });
    });

    it('keeps a closed ordinary draft separate from a replacement peer and ignores a delayed old close for the new view', async () => {
        const f = await visitor(), oldRef = 'd'.repeat(32), newRef = 'e'.repeat(32);
        f.ws.receive({ t: 'pm-open', with: 'Friend', peer: 'old-peer', ref: oldRef });
        f.input('An ordinary draft for only the original endpoint');
        f.ws.receive({ t: 'pm-closed', with: 'Friend', peer: 'old-peer', ref: oldRef });
        let before = f.ws.sent.length; f.submit();
        expect(f.ws.sent).toHaveLength(before); expect(f.$('[data-text]').value).toBe('An ordinary draft for only the original endpoint');
        f.ws.receive({ t: 'pm-open', with: 'Friend', peer: 'new-peer', ref: newRef });
        expect(f.$('[data-text]').value).toBe('');
        f.ws.receive({ t: 'pm-closed', with: 'Friend', peer: 'old-peer', ref: oldRef });
        expect(f.window.__lobby.active).toBe(`pm:${newRef}`);
        expect(f.window.__lobby.pms.get(newRef).open).toBe(true);
        expect(f.submit('A deliberately fresh reply')).toMatchObject({ pmPeer: 'new-peer', pmRef: newRef });
        f.$(`[data-channel-key="pm:${oldRef}"]`).click();
        expect(f.$('[data-text]').value).toBe('An ordinary draft for only the original endpoint');
        before = f.ws.sent.length; f.submit(); expect(f.ws.sent).toHaveLength(before);
    });

    it('keeps request controls on their original endpoint across a label update and refuses unbound request widgets', async () => {
        const f = await visitor(), ref = 'd'.repeat(32);
        f.ws.receive({ t: 'pm-request', from: 'Friend', band: false, peer: 'original-peer', ref });
        f.ws.receive({ t: 'pm-request-ended', from: 'Friend', peer: 'original-peer', ref });
        f.ws.receive({ t: 'pm-request', from: 'RenamedFriend', band: false, peer: 'original-peer', ref });
        const request = f.$('[data-pmreqs] .req'); expect(request.textContent).toContain('RenamedFriend');
        request.querySelector('button').click();
        expect(f.ws.sent.at(-1)).toMatchObject({ t: 'cmd', name: 'accept', args: ['RenamedFriend'], pmPeer: 'original-peer', pmRef: ref });
        f.ws.receive({ t: 'pm-request', from: 'UnboundFriend', band: false });
        const before = f.ws.sent.length; f.$('[data-pmreqs] .req button').click();
        expect(f.ws.sent).toHaveLength(before);
        expect(f.$('[data-toast]').textContent).toContain('cannot confirm the request');
    });
});


it('starts a fresh received PM transcript on a new socket while preserving only a closed original unsent draft', async () => {
    const f = await visitor(), ref = 'd'.repeat(32), nextRef = 'e'.repeat(32);
    f.ws.receive({ t: 'pm-open', with: 'Friend', peer: 'old-peer', ref });
    f.ws.receive({ t: 'pm', id: 'preconnect', with: 'Friend', peer: 'old-peer', ref, from: 'Friend', to: 'Viewer', text: 'An old received private transcript' });
    f.input('An ordinary unsent draft survives only in its closed original view');
    f.ws.close(1006); f.$('[data-reconnect]').click();
    await vi.waitFor(() => expect(f.sockets).toHaveLength(2));
    const replacement = f.sockets[1]; replacement.open(); f.welcome(replacement);
    replacement.receive({ t: 'join', ch: { name: '#stalemate', kind: 'lobby', title: '#stalemate', topic: '', modes: {}, names: [{ nick: 'Viewer', prefix: '' }] } });
    const old = f.window.__lobby.pms.get(ref); expect(old.open).toBe(false); expect(old.lines).toEqual([]);
    f.$(`[data-channel-key="pm:${ref}"]`).click();
    expect(f.$('[data-text]').value).toBe('An ordinary unsent draft survives only in its closed original view');
    const before = replacement.sent.length; f.$('[data-say]').dispatchEvent(new f.window.Event('submit', { cancelable: true }));
    expect(replacement.sent).toHaveLength(before);
    replacement.receive({ t: 'pm-open', with: 'Friend', peer: 'new-peer', ref: nextRef });
    expect(f.$('[data-text]').value).toBe(''); expect(f.$('[data-buffer]').textContent).not.toContain('An old received private transcript');
});
