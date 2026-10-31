// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'node:fs';
import * as entryFunctions from '../../r/45662413410ed051/entry-sites.mjs';
import { createEntrySharing } from '../../r/45662413410ed051/lobby/entry-sharing.mjs';
import { createChatAnnouncements } from '../../r/45662413410ed051/lobby/chat-announcements.mjs';
import { createLobby } from '../../hangout-worker/src/lobby-core.mjs';

const html = readFileSync(new URL('../../r/45662413410ed051/lobby/index.html', import.meta.url), 'utf8');
const client = readFileSync(new URL('../../r/45662413410ed051/lobby/lobby.js', import.meta.url), 'utf8');
const discovery = readFileSync(new URL('../../r/45662413410ed051/lobby/discovery-core.js', import.meta.url), 'utf8');
const windows = [];
afterEach(() => { for (const dom of windows.splice(0)) { dom.window.close(); expect(dom.clientErrors || []).toEqual([]); } });

async function visitor({ via = 'rad-dad', verified = false, stored = {}, returning = false, features = { entrySources: 1, roomKeep: 1 }, storageFailure = '' } = {}) {
    // jsdom cannot navigate. Its expected navigation diagnostic is suppressed;
    // the actual click handler still runs and writes the real tab storage.
    const errors = [], console = new VirtualConsole();
    console.on('jsdomError', error => { if (!/Not implemented: navigation/.test(error.message)) errors.push(error.message); });
    const dom = new JSDOM(html, { url: `http://127.0.0.1:4320/r/45662413410ed051/lobby/?preview=local-preview-key-0001&relay=ws%3A%2F%2F127.0.0.1%3A4320%2Frelay&via=${via}${returning ? '&owner=1&entry-return=1' : ''}`, runScripts: 'outside-only', virtualConsole: console });
    dom.clientErrors = errors;
    windows.push(dom);
    const { window } = dom, sockets = [];
    for (const [key, value] of Object.entries(stored)) window.sessionStorage.setItem(key, value);
    if (storageFailure) {
        const original = window.Storage.prototype[storageFailure];
        window.Storage.prototype[storageFailure] = function (key, ...args) {
            if (key === entryFunctions.KEEP_ROOM_INTENT_KEY) throw Error('tab storage unavailable');
            return original.call(this, key, ...args);
        };
    }
    window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    window.HTMLDialogElement.prototype.close = function () { this.open = false; };
    window.WebSocket = class {
        readyState = 0; sent = [];
        constructor(url) { this.url = url; sockets.push(this); }
        send(value) { this.sent.push(JSON.parse(value)); }
        open() { this.readyState = 1; this.onopen?.(); }
        receive(frame) { this.onmessage?.({ data: JSON.stringify(frame) }); }
        close(code = 1000) { this.readyState = 3; this.onclose?.({ code }); }
    };
    window.HangoutClientTestModules = { ...entryFunctions, createEntrySharing, createChatAnnouncements };
    window.eval(discovery);
    const imports = [...client.matchAll(/^import \{([^}]+)\} from '[^']+';/gm)].map(match => match[1]).join(',');
    window.eval(`const {${imports}} = window.HangoutClientTestModules;\n${client.replace(/^import .*$/gm, '')}`);
    window.document.querySelector('[data-nick]').value = 'Viewer';
    window.document.querySelector('[data-enter]').click();
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    const ws = sockets[0]; ws.open();
    ws.receive({ t: 'hello', role: 'fan', lock: 'off', budget: 'ok', features });
    ws.receive({ t: 'welcome', nick: 'Viewer', role: 'fan', verified, capabilities: {} });
    const join = (name = '#keep-me', extra = {}) => ws.receive({ t: 'join', ch: { name, kind: 'chat', title: 'Shared room', topic: '', count: 1, persistent: false,
        keepRef: 'a'.repeat(32), modes: {}, names: [{ nick: 'Viewer', prefix: '@' }], ...extra } });
    return { window, ws, join };
}

function engine(saved) {
    let at = Date.now();
    const frames = [], lobby = createLobby({ now: () => at, send: (id, frame) => frames.push({ id, ...frame }), limits: { defaultSlow: 0 } });
    if (saved) lobby.restoreRooms(saved);
    lobby.connect({ id: 'first', dev: 'first-device', iph: 'first-network', account: 'verified-first' });
    lobby.message('first', JSON.stringify({ t: 'hello', nick: 'Founder', age13: true }));
    const command = (name, args, ch = '#stalemate', roomInstance) => lobby.message('first', JSON.stringify({ t: 'cmd', name, args, ch, ...(roomInstance === undefined ? {} : { roomInstance }) }));
    return { lobby, frames, command, advance: ms => { at += ms; } };
}

describe('verify email to keep the intended room', () => {
    it('preserves the hidden entry choice when Keep initiates the actual sign-in navigation', async () => {
        const { window, ws, join } = await visitor(); join();
        window.document.querySelector('[data-entry-share]').click();
        ws.receive({ t: 'entry-source', source: '', accepted: true });
        window.document.querySelector('[data-roomtools]').click();
        [...window.document.querySelectorAll('[data-palette] button')].find(button => button.textContent === 'Keep this room').click();
        expect(entryFunctions.readEntryHandoff(window.sessionStorage.getItem(entryFunctions.ENTRY_HANDOFF_KEY))).toEqual({ source: 'rad-dad', share: false });
    });

    it('does not treat a legacy unbounded return-room string as a current Keep intent', async () => {
        const { ws } = await visitor({ verified: true, stored: { 'hangout-return-room': '#old-room' } });
        expect(ws.sent.filter(frame => frame.t === 'cmd' && frame.name === 'join')).toEqual([]);
    });

    it('never recreates a missing room when a return carries an instance precondition', () => {
        const { lobby, command } = engine();
        command('join', ['#gone-room'], '#stalemate', 'a'.repeat(32));
        expect(lobby._debug.channels.has('#gone-room')).toBe(false);
    });

    it('refuses registration when the confirmed room instance has changed', () => {
        const { lobby, command } = engine();
        command('join', ['#keep-me']);
        command('register', [], '#keep-me', 'a'.repeat(32));
        expect(lobby._debug.channels.get('#keep-me').owner).toBe('');
    });
});

describe('live verified co-host controls in an open host palette', () => {
    const ref = 'a'.repeat(32), account = 'account-offline-friend';
    async function owner(cohosts) {
        const value = await visitor({ verified: true, features: { entrySources: 1, roomKeep: 1, personTargets: 1 } });
        value.window.confirm = vi.fn(() => true);
        value.join('#keep-me', { persistent: true, names: [{ id: 'viewer', nick: 'Viewer', prefix: '@', owner: true }] });
        if (cohosts) value.ws.receive({ t: 'ownership', ch: '#keep-me', cohosts });
        value.window.document.querySelector('[data-roomtools]').click();
        return { ...value, palette: value.window.document.querySelector('[data-palette]'),
            buttons: () => [...value.window.document.querySelectorAll('[data-palette-buttons] button')] };
    }
    const ownership = (ws, cohosts) => ws.receive({ t: 'ownership', ch: '#keep-me', cohosts });

    it('adds delayed offline co-host controls without reopening the menu or replacing a focused action', async () => {
        const { window, ws, palette, buttons } = await owner();
        const action = buttons().find(button => button.textContent === 'Transfer ownership'); action.focus();
        const waitingText = window.document.querySelector('[data-palette-status]')?.textContent;
        ownership(ws, [{ id: account, label: 'OfflineFriend' }]);
        expect(palette.open).toBe(true);
        expect(window.document.activeElement).toBe(action);
        const removal = buttons().find(button => button.textContent === 'Remove verified co-host: OfflineFriend');
        expect(removal).toBeDefined();
        expect(waitingText).toContain('Checking verified co-hosts');
        removal.click();
        expect(ws.sent.at(-1)).toEqual({ t: 'cmd', name: 'cohost', args: ['remove', account], ch: '#keep-me', roomInstance: ref, cohostAccount: true });
        expect(palette.open).toBe(false);
    });

    it('retains an unchanged focused co-host button and retires a removed account even when another uses the same label', async () => {
        const { window, ws, palette, buttons } = await owner([{ id: account, label: 'Friend' }]);
        const original = buttons().find(button => button.textContent === 'Remove verified co-host: Friend');
        expect(original).toBeDefined(); original.focus();
        ownership(ws, [{ id: account, label: 'RenamedFriend' }]);
        expect(window.document.activeElement).toBe(original);
        expect(original.textContent).toBe('Remove verified co-host: RenamedFriend');
        ownership(ws, [{ id: 'different-account', label: 'Friend' }]);
        expect(palette.open).toBe(true);
        expect(original.isConnected).toBe(false);
        expect(window.document.activeElement).toBe(window.document.querySelector('[data-palette-close]'));
        const count = ws.sent.length; original.click();
        expect(ws.sent).toHaveLength(count);
        expect(window.confirm).not.toHaveBeenCalled();
        buttons().find(button => button.textContent === 'Remove verified co-host: Friend').click();
        expect(ws.sent.at(-1).args).toEqual(['remove', 'different-account']);
    });

    it.each(['room-switch', 'instance-change', 'same-name-rejoin', 'owner-lost', 'disconnect', 'sharing-stopped'])(
        'retires open host controls after %s and never revives them on a later ownership frame', async boundary => {
            const { window, ws, join, palette, buttons } = await owner([{ id: account, label: 'OfflineFriend' }]);
            const removal = buttons().find(button => button.textContent === 'Remove verified co-host: OfflineFriend');
            expect(removal).toBeDefined();
            if (boundary === 'room-switch') join('#another-room');
            if (boundary === 'instance-change') ws.receive({ t: 'chan', ch: { name: '#keep-me', keepRef: 'b'.repeat(32) } });
            if (boundary === 'same-name-rejoin') join('#keep-me', { persistent: true, names: [{ id: 'viewer', nick: 'Viewer', prefix: '@', owner: true }] });
            if (boundary === 'owner-lost') ws.receive({ t: 'chan', ch: { name: '#keep-me', names: [{ id: 'viewer', nick: 'Viewer', prefix: '@', owner: false }] } });
            if (boundary === 'disconnect') ws.close(4003);
            if (boundary === 'sharing-stopped') ws.receive({ t: 'sharing-stopped' });
            expect(palette.open).toBe(false);
            const count = ws.sent.length; removal.click();
            ownership(ws, [{ id: account, label: 'OfflineFriend' }]);
            expect(ws.sent).toHaveLength(count);
            expect(window.confirm).not.toHaveBeenCalled();
            expect(palette.open).toBe(false);
        }
    );

    it('does not turn the ordinary command palette into host controls on an ownership update', async () => {
        const { window, ws, palette, buttons } = await owner();
        palette.close(); window.document.querySelector('[data-palette-open]').click();
        const action = buttons().find(button => button.textContent === '/help'); action.focus();
        ownership(ws, [{ id: account, label: 'OfflineFriend' }]);
        expect(palette.open).toBe(true); expect(window.document.activeElement).toBe(action);
        expect(buttons().some(button => button.textContent.startsWith('Remove verified co-host:'))).toBe(false);
    });
});


describe('bounded explicit Keep return', () => {
    const room = '#keep-me', ref = 'a'.repeat(32);
    const intent = (at = Date.now()) => entryFunctions.keepRoomIntent({ name: room, keepRef: ref }, at);
    const returned = (extra = {}) => visitor({ verified: true, returning: true, stored: { [entryFunctions.KEEP_ROOM_INTENT_KEY]: intent() }, ...extra });
    it('conditionally rejoins but sends no registration until explicit confirmation of the matching room', async () => {
        const { window, ws, join } = await returned();
        expect(window.sessionStorage.getItem(entryFunctions.KEEP_ROOM_INTENT_KEY)).toBeNull();
        expect(ws.sent.filter(f => f.name === 'join')).toEqual([{ t: 'cmd', name: 'join', args: [room], ch: '#stalemate', roomInstance: ref }]);
        expect(ws.sent.some(f => f.name === 'register')).toBe(false);
        expect(window.document.querySelector('[data-keep-prompt]').hidden).toBe(true);
        join();
        expect(window.document.querySelector('[data-keep-prompt]').hidden).toBe(false);
        window.document.querySelector('[data-keep-accept]').click();
        expect(ws.sent.at(-1)).toEqual({ t: 'cmd', name: 'register', args: [], ch: room, roomInstance: ref });
        expect(window.document.querySelector('[data-keep-accept]').disabled).toBe(true);
    });
    it('lets the visitor decline without sending registration', async () => {
        const { window, ws, join } = await returned(); join();
        window.document.querySelector('[data-keep-cancel]').click();
        expect(window.document.querySelector('[data-keep-prompt]').hidden).toBe(true);
        expect(ws.sent.some(f => f.name === 'register')).toBe(false);
    });
    it.each(['changed', 'post-join-change', 'host-lost', 'session-ended', 'expired'])('refuses a %s return before registration', async reason => {
        const { window, ws, join } = await returned();
        join('#keep-me', reason === 'changed' ? { keepRef: 'b'.repeat(32) } : reason === 'host-lost' ? { names: [{ nick: 'Viewer', prefix: '' }] } : {});
        if (reason === 'post-join-change') ws.receive({ t: 'chan', ch: { name: '#keep-me', keepRef: 'b'.repeat(32) } });
        if (reason === 'session-ended') ws.close(4401);
        if (reason === 'expired') window.Date.now = () => Date.now() + entryFunctions.KEEP_ROOM_INTENT_TTL;
        window.document.querySelector('[data-keep-accept]').click();
        expect(window.document.querySelector('[data-keep-prompt]').hidden).toBe(true);
        expect(ws.sent.some(f => f.name === 'register')).toBe(false);
    });
    it.each([{}, { roomKeep: true }, { roomKeep: '1' }, { roomKeep: 2 }])('does not send create-on-missing Join to a server without numeric roomKeep1: %j', async features => {
        const { ws } = await returned({ features });
        expect(ws.sent.some(f => f.name === 'join' || f.name === 'register')).toBe(false);
    });
    it.each(['getItem', 'removeItem'])('keeps ordinary verified chat usable when intent storage %s fails', async storageFailure => {
        const { window, ws } = await returned({ storageFailure });
        expect(window.__lobby.me).toBe('Viewer');
        expect(window.document.querySelector('[data-connection]').textContent).toBe('Connected');
        expect(ws.sent.some(f => f.name === 'join' || f.name === 'register')).toBe(false);
    });
    it('keeps guest chat usable and explains a failed Keep-intent write', async () => {
        const { window, ws, join } = await visitor({ storageFailure: 'setItem' }); join();
        window.document.querySelector('[data-roomtools]').click();
        [...window.document.querySelectorAll('[data-palette] button')].find(b => b.textContent === 'Keep this room').click();
        expect(window.__lobby.me).toBe('Viewer');
        expect(window.document.querySelector('[data-toast]').textContent).toContain('cannot save');
        expect(ws.sent.some(f => f.name === 'register')).toBe(false);
    });
    it.each(['host', 'instance'])('reports unconfirmed rather than not kept when %s changes after submission', async change => {
        const { window, ws, join } = await returned(); join();
        window.document.querySelector('[data-keep-accept]').click();
        ws.receive({ t: 'chan', ch: { name: '#keep-me', ...(change === 'host' ? { names: [{ nick: 'Viewer', prefix: '' }] } : { keepRef: 'b'.repeat(32) }) } });
        expect(window.document.querySelector('[data-toast]').textContent).toContain('before confirmation');
        expect(window.document.querySelector('[data-toast]').textContent).not.toContain('Nothing was kept');
        expect(ws.sent.filter(frame => frame.name === 'register')).toHaveLength(1);
    });
    it('returns focused cancellation to Host tools, and holds submitted focus in the labelled region until confirmation', async () => {
        const first = await returned(); first.join();
        first.window.document.querySelector('[data-keep-cancel]').focus();
        first.window.document.querySelector('[data-keep-cancel]').click();
        expect(first.window.document.activeElement).toBe(first.window.document.querySelector('[data-roomtools]'));
        const next = await returned(); next.join();
        next.window.document.querySelector('[data-keep-accept]').focus();
        next.window.document.querySelector('[data-keep-accept]').click();
        expect(next.window.document.activeElement).toBe(next.window.document.querySelector('[data-keep-prompt]'));
        next.ws.receive({ t: 'chan', ch: { name: '#keep-me', persistent: true } });
        expect(next.window.document.activeElement).toBe(next.window.document.querySelector('[data-roomtools]'));
    });
    it('does not move focus back when the visitor moved to the composer before acknowledgement', async () => {
        const { window, ws, join } = await returned(); join();
        window.document.querySelector('[data-keep-accept]').focus(); window.document.querySelector('[data-keep-accept]').click();
        window.document.querySelector('[data-text]').focus();
        ws.receive({ t: 'chan', ch: { name: '#keep-me', persistent: true } });
        expect(window.document.activeElement).toBe(window.document.querySelector('[data-text]'));
    });
    it('rejects expired, future, oversized, malformed and privilege-bearing intents and consumes once', () => {
        const now = Date.now(), valid = intent(now);
        for (const raw of ['#legacy', '{}', valid + 'x', 'x'.repeat(257), intent(now - entryFunctions.KEEP_ROOM_INTENT_TTL), intent(now + 1), JSON.stringify({ ...JSON.parse(valid), role: 'owner' })])
            expect(entryFunctions.readKeepRoomIntent(raw, now)).toBeNull();
        const map = new Map([[entryFunctions.KEEP_ROOM_INTENT_KEY, valid]]), storage = { getItem: key => map.get(key) ?? null, removeItem: key => map.delete(key) };
        expect(entryFunctions.consumeKeepRoomIntent(storage, now).intent).toMatchObject({ room, ref });
        expect(entryFunctions.consumeKeepRoomIntent(storage, now).intent).toBeNull();
    });
});

describe('room instance continuity and authority', () => {
    it('preserves the actual room ref in snapshots and refuses missing or recreated rooms after restart', () => {
        const first = engine(); first.command('join', ['#keep-me']);
        const ref = first.lobby._debug.channels.get('#keep-me').keepRef;
        expect(ref).toMatch(/^[a-f0-9]{32}$/);
        const restored = engine(first.lobby.roomSnapshot());
        expect(restored.lobby._debug.channels.get('#keep-me').keepRef).toBe(ref);
        restored.command('join', ['#keep-me'], '#stalemate', ref);
        restored.command('register', [], '#keep-me', ref);
        expect(restored.lobby._debug.channels.get('#keep-me').owner).toBe('verified-first');
        const fresh = engine(); fresh.command('join', ['#keep-me'], '#stalemate', ref);
        expect(fresh.lobby._debug.channels.has('#keep-me')).toBe(false);
        fresh.command('join', ['#keep-me']);
        expect(fresh.lobby._debug.channels.get('#keep-me').keepRef).not.toBe(ref);
        fresh.command('register', [], '#keep-me', ref);
        expect(fresh.lobby._debug.channels.get('#keep-me').owner).toBe('');
    });
    it('rechecks the instance after a successful conditional rejoin and same-device recreation', () => {
        const { lobby, frames, command, advance } = engine();
        command('join', ['#keep-me']);
        const original = lobby._debug.channels.get('#keep-me').keepRef;
        command('part', [], '#keep-me');
        command('join', ['#keep-me'], '#stalemate', original);
        expect(frames.filter(frame => frame.t === 'join').at(-1).ch.keepRef).toBe(original);
        command('close', [], '#keep-me'); advance(10 * 60 * 1000 + 1);
        command('join', ['#keep-me']);
        expect(lobby._debug.channels.get('#keep-me').keepRef).not.toBe(original);
        command('register', [], '#keep-me', original);
        expect(lobby._debug.channels.get('#keep-me').owner).toBe('');
        command('register', [], '#keep-me');
        expect(lobby._debug.channels.get('#keep-me').owner).toBe('verified-first');
    });
    it('gives legacy rooms a new ref and fails closed on a corrupted supplied ref', () => {
        const first = engine(); first.command('join', ['#keep-me']);
        const saved = first.lobby.roomSnapshot(), prior = saved.rooms[0].keepRef; delete saved.rooms[0].keepRef;
        const legacy = engine(saved); expect(legacy.lobby._debug.channels.get('#keep-me').keepRef).not.toBe(prior);
        const bad = structuredClone(saved); bad.rooms[0].keepRef = 'corrupt';
        const rejected = engine(bad); expect(rejected.lobby._debug.net.lock).toBe('readonly');
        expect(rejected.lobby._debug.channels.has('#keep-me')).toBe(false);
    });
    it('requires the original founder even with an exact observed room reference', () => {
        const first = engine(); first.command('join', ['#keep-me']);
        const ref = first.lobby._debug.channels.get('#keep-me').keepRef;
        first.lobby.connect({ id: 'other', dev: 'other-device', iph: 'other-network', account: 'other-verified' });
        first.lobby.message('other', JSON.stringify({ t: 'hello', nick: 'Visitor', age13: true }));
        first.lobby.message('other', JSON.stringify({ t: 'cmd', name: 'join', args: ['#keep-me'], ch: '#stalemate', roomInstance: ref }));
        first.lobby.message('other', JSON.stringify({ t: 'cmd', name: 'register', args: [], ch: '#keep-me', roomInstance: ref }));
        expect(first.lobby._debug.channels.get('#keep-me').owner).toBe('');
        first.command('register', [], '#keep-me');
        expect(first.lobby._debug.channels.get('#keep-me').owner).toBe('verified-first');
    });
});
