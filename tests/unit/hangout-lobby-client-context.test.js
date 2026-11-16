// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createHangoutClientTestModules } from './hangout-lobby-client-stub.mjs';

const html = readFileSync(new URL('../../r/45662413410ed051/lobby/index.html', import.meta.url), 'utf8');
const client = readFileSync(new URL('../../r/45662413410ed051/lobby/lobby.js', import.meta.url), 'utf8');
const discovery = readFileSync(new URL('../../r/45662413410ed051/lobby/discovery-core.js', import.meta.url), 'utf8');
const invitationRoomInstance = 'a'.repeat(32);
const windows = [];
afterEach(() => { for (const dom of windows.splice(0)) dom.window.close(); });

async function visitor(via = 'stalemate', features = { entrySources: 1 }, options = {}) {
    const dom = new JSDOM(html, { url: `${options.secureOrigin ? 'https' : 'http'}://127.0.0.1:4320/r/45662413410ed051/lobby/?preview=local-preview-key-0001&relay=ws%3A%2F%2F127.0.0.1%3A4320%2Frelay&via=${encodeURIComponent(via)}`, runScripts: 'outside-only' });
    windows.push(dom);
    const { window } = dom, timers = new Map(), sockets = []; let timerId = 0, elapsed = 0;
    let socketCreated;
    const firstSocket = new Promise(resolve => { socketCreated = resolve; });
    Object.defineProperty(window.performance, 'now', { value: () => elapsed });
    window.setTimeout = (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; };
    window.clearTimeout = (id) => timers.delete(id);
    if (options.beta) {
        const bootstrap = window.document.createElement('script');
        bootstrap.src = '/beta/bootstrap.js'; window.document.head.append(bootstrap);
        window.HangoutBootstrap = { preview: 'local-preview-key-0001', owner: options.owner === true };
        if (options.participation === true) window.HangoutParticipationControls = true;
    }
    window.fetch = options.fetch || vi.fn();
    const paint = () => { for (const [id, task] of [...timers]) if (task.delay === 16) { timers.delete(id); task.fn(); } };
    const flush = (delay) => { for (const [id, task] of [...timers]) if (task.delay === delay) { timers.delete(id); task.fn(); } };
    window.WebSocket = class {
        readyState = 0; sent = [];
        constructor(url) {
            this.url = url;
            sockets.push(this);
            if (sockets.length === 1) socketCreated(this);
        }
        send(text) { this.sent.push(JSON.parse(text)); }
        open() { this.readyState = 1; this.onopen?.(); }
        receive(frame) { this.onmessage?.({ data: JSON.stringify(frame) }); }
        close(code = 1000) { this.readyState = 3; return this.onclose?.({ code }); }
    };
    window.HangoutClientTestModules = createHangoutClientTestModules(window);
    window.eval(discovery);
    // Execute the actual browser client, replacing only module loading, which
    // jsdom cannot perform. Real Chromium journeys cover native ESM loading.
    const imports = [...client.matchAll(/^import \{([^}]+)\} from '[^']+';/gm)].map((match) => match[1]).join(',');
    window.eval(`const entrance = window.HangoutClientTestModules; const {${imports}} = entrance;\n${client.replace(/^import .*$/gm, '')}`);
    window.document.querySelector('[data-nick]').value = 'Viewer';
    window.document.querySelector('[data-enter]').click();
    const ws = await firstSocket;
    expect(sockets).toHaveLength(1);
    if (options.open !== false) {
        ws.open();
        ws.receive({ t: 'hello', role: 'fan', lock: 'off', budget: 'ok', features });
    }
    const welcome = (socket = ws, seq = 1) => socket.receive({ t: 'welcome', nick: 'Viewer', role: 'fan', band: false, verified: false, capabilities: {}, transportSeq: seq });
    const join = (name = '#stalemate') => ws.receive({ t: 'join', ch: { name, kind: name === '#stalemate' ? 'lobby' : 'chat', title: 'Shared chat', topic: '', count: 1, modes: {}, names: [{ nick: 'Viewer', prefix: '', entrySource: via }] } });
    return { dom, window, ws, sockets, welcome, join, timers, paint, flush, advance: (ms) => { elapsed += ms; } };
}

it('keeps the guest’s Join action after the notice timer and unrelated chat feedback', async () => {
    const { window, ws, welcome, join, flush } = await visitor();
    welcome(); join();
    const { document } = window;
    ws.receive({ t: 'invite', ch: '#invitation-studio', by: 'InvitationHost', roomInstance: invitationRoomInstance });
    const invitation = document.querySelector('[data-room-invite]');
    expect(invitation.hidden).toBe(false);
    flush(12000);
    expect(invitation.hidden).toBe(false);
    ws.receive({ t: 'rate-limit', scope: 'chat', text: 'Please wait before sending another line.' });
    expect(invitation.querySelector('button')?.textContent).toBe('Join');
    expect(invitation.textContent).toContain('InvitationHost invited you to #invitation-studio');
    ws.close(4400);
    expect(invitation.hidden).toBe(true);
    expect(document.querySelector('[data-room-invite-announcement]').textContent).toBe('');
});

it('announces a room invitation in an existing live region and describes its Join action', async () => {
    const { window, ws, welcome, join } = await visitor();
    const { document } = window;
    welcome(); join();
    const announcement = document.querySelector('[data-room-invite-announcement]');
    const notice = document.querySelector('[data-room-invite]');
    const composer = document.querySelector('[data-text]');
    expect(announcement?.getAttribute('role')).toBe('status');
    expect(announcement.closest('[hidden], [aria-hidden="true"]')).toBeNull();
    expect(announcement.textContent).toBe('');
    expect(notice.hidden).toBe(true);
    composer.focus();

    ws.receive({ t: 'invite', ch: '#invitation-studio', by: 'InvitationHost', roomInstance: invitationRoomInstance });

    const message = 'InvitationHost invited you to #invitation-studio';
    expect(document.querySelector('[data-room-invite-announcement]')).toBe(announcement);
    expect(announcement.textContent).toBe(message);
    expect(notice.hidden).toBe(false);
    expect(notice.hasAttribute('role')).toBe(false);
    const action = notice.querySelector('button');
    expect(action.textContent).toBe('Join');
    expect(document.getElementById(action.getAttribute('aria-describedby'))?.textContent).toBe(message);
    expect(document.activeElement).toBe(composer);

    const dismiss = notice.querySelector('[data-room-invite-dismiss]');
    const before = ws.sent.length;
    dismiss.focus();
    dismiss.click();
    expect(ws.sent).toHaveLength(before);
    expect(notice.hidden).toBe(true);
    expect(document.activeElement.dataset.channelKey).toBe('#stalemate');
    expect(announcement.closest('[hidden], [aria-hidden="true"]')).toBeNull();
    expect(announcement.textContent).toBe('');
});

it('keeps the original Join action when another room invitation arrives', async () => {
    const { window, ws, welcome, join } = await visitor();
    welcome(); join();
    const { document } = window;
    const first = { t: 'invite', ch: '#first-studio', by: 'FirstHost', roomInstance: invitationRoomInstance };
    const second = { t: 'invite', ch: '#second-studio', by: 'SecondHost', roomInstance: 'b'.repeat(32) };
    const panel = document.querySelector('[data-room-invite]');
    const action = panel.querySelector('[data-room-invite-join]');
    ws.receive(first);
    action.focus();
    ws.receive(second);
    expect(document.activeElement).toBe(action);
    expect(panel.textContent).toContain('FirstHost invited you to #first-studio');
    ws.receive(first);
    expect(panel.textContent).toContain('1 more invitation');

    action.click();
    expect(ws.sent.at(-1)).toMatchObject({ t: 'cmd', name: 'join', args: ['#first-studio'], roomInstance: first.roomInstance });
    join('#first-studio');
    expect(document.activeElement.dataset.channelKey).toBe('#first-studio');
    expect(panel.textContent).toContain('SecondHost invited you to #second-studio');
    expect(panel.textContent).not.toContain('more invitation');
    panel.querySelector('[data-room-invite-dismiss]').click();
    expect(panel.hidden).toBe(true);
});

it('limits pending room invites and clears them on disconnect', async () => {
    const { window, ws, welcome, join } = await visitor();
    welcome(); join();
    const panel = window.document.querySelector('[data-room-invite]');
    const dismiss = panel.querySelector('[data-room-invite-dismiss]');
    for (let number = 1; number <= 6; number++) {
        ws.receive({ t: 'invite', ch: `#studio-${number}`, by: 'InvitationHost', roomInstance: String(number).repeat(32) });
    }
    expect(panel.textContent).toContain('#studio-1 · 4 more invitations');
    for (let number = 1; number < 5; number++) dismiss.click();
    expect(panel.textContent).toContain('#studio-5');
    ws.close(4400);
    expect(panel.hidden).toBe(true);
    expect(panel.querySelector('[data-room-invite-status]').textContent).toBe('');
});

describe('keyboard room invitation acceptance', () => {
    it.each([false, true])('retains a meaningful focus target while joining (guest moved focus: %s)', async (moved) => {
        const { window, ws, welcome, join } = await visitor();
        const { document } = window;
        welcome(); join();
        const room = '#invitation-studio';
        const notice = document.querySelector('[data-room-invite]');
        ws.receive({ t: 'invite', ch: room, by: 'InvitationHost', roomInstance: invitationRoomInstance });
        const action = notice.querySelector('button');
        action.focus();
        action.click();
        expect(ws.sent.at(-1)).toMatchObject({ t: 'cmd', name: 'join', args: [room], roomInstance: invitationRoomInstance });
        expect(document.activeElement).toBe(document.querySelector('#chat-pane'));
        expect(notice.hidden).toBe(true);
        const composer = document.querySelector('[data-text]');
        if (moved) composer.focus();

        join(room);

        const tab = document.querySelector('[data-channel-key="#invitation-studio"]');
        expect(tab.getAttribute('aria-selected')).toBe('true');
        expect(document.activeElement).toBe(moved ? composer : tab);
    });

    it('keeps Join available with an explanation when the invitation request could not be sent', async () => {
        const { window, ws, welcome, join } = await visitor();
        const { document } = window;
        welcome(); join();
        ws.receive({ t: 'invite', ch: '#invitation-studio', by: 'InvitationHost', roomInstance: invitationRoomInstance });
        const notice = document.querySelector('[data-room-invite]');
        const action = notice.querySelector('button');
        const send = ws.send;
        ws.send = vi.fn(() => { throw new Error('socket closed during send'); });
        action.focus();
        action.click();

        expect(notice.hidden).toBe(false);
        expect(notice.textContent).toContain('Couldn’t send the request to join #invitation-studio.');
        const retry = notice.querySelector('button');
        expect(retry?.textContent).toBe('Retry join');
        expect(document.activeElement).toBe(retry);

        ws.send = send;
        retry.focus();
        retry.click();
        expect(ws.sent.at(-1).roomInstance).toBe(invitationRoomInstance);
        join('#invitation-studio');
        expect(document.activeElement.dataset.channelKey).toBe('#invitation-studio');
        expect(notice.hidden).toBe(true);
    });

    it('offers recovery without a blind join when an older server sends an invitation without a room reference', async () => {
        const { window, ws, welcome, join } = await visitor();
        welcome(); join();
        const { document } = window;
        const before = ws.sent.length;
        ws.receive({ t: 'invite', ch: '#invitation-studio', by: 'InvitationHost' });

        expect(document.querySelector('[data-toast]').textContent).toContain('Ask the host for a new invitation or find the room in Rooms.');
        expect(document.querySelector('[data-toast] button')).toBeNull();
        expect(ws.sent).toHaveLength(before);
    });
});

it('keeps unrelated moderation reports pending until each selected message gets its own result', async () => {
    const { window, ws, welcome, join, flush } = await visitor();
    window.requestAnimationFrame = (callback) => window.setTimeout(callback, 16);
    welcome(); join();
    const { document } = window;
    for (const id of ['mfirst', 'msecond']) {
        ws.receive({ t: 'line', ch: '#stalemate', id, from: 'EarlierGuest', text: 'Synthetic report fixture' });
    }
    const first = document.querySelector('[data-id=mfirst] .flag');
    const second = document.querySelector('[data-id=msecond] .flag');
    first.click();
    second.focus();
    second.click();
    ws.receive({ t: 'notice', from: 'StaleBot', kind: 'error', text: 'An unrelated command failed.' });
    ws.receive({ t: 'rate-limit', scope: 'chat', text: 'Please wait before sending another message.' });
    expect(first.getAttribute('aria-disabled')).toBe('true');
    expect(second.getAttribute('aria-disabled')).toBe('true');

    ws.receive({ t: 'notice', from: 'StaleBot', kind: 'error', text: 'That message is gone already.' });
    ws.receive({ t: 'report-status', id: 'msecond', submitted: false });
    expect(first.getAttribute('aria-disabled')).toBe('true');
    expect(second.getAttribute('aria-disabled')).toBeNull();
    expect(second.textContent).toBe('🚩');
    expect(document.activeElement).toBe(second);
    expect(document.querySelector('[data-toast]').textContent).toContain('That message is gone already.');

    ws.receive({ t: 'report-status', id: 'mfirst', submitted: true });
    flush(10000);
    expect(first.textContent).toBe('✓');
    expect(document.querySelector('[data-toast]').textContent).toContain('That message is gone already.');
});

it.each([false, true])('keeps focus usable when moderation removes a message (flag focused: %s)', async (focusedFlag) => {
    const { window, ws, welcome, join } = await visitor();
    window.requestAnimationFrame = (callback) => window.setTimeout(callback, 16);
    welcome(); join();
    const { document } = window;
    ws.receive({ t: 'line', ch: '#stalemate', id: 'mremoved', from: 'EarlierGuest', text: 'Synthetic removed message' });
    ws.receive({ t: 'line', ch: '#stalemate', id: 'mretained', from: 'EarlierGuest', text: 'Synthetic retained message' });
    const flag = document.querySelector('[data-id=mremoved] .flag');
    const retained = document.querySelector('[data-id=mretained] .flag');
    const composer = document.querySelector('[data-text]');
    composer.value = 'Keep this draft';
    (focusedFlag ? flag : retained).focus();

    ws.receive({ t: 'delete', ids: ['mremoved'] });

    expect(flag.isConnected).toBe(false);
    expect(document.activeElement).toBe(focusedFlag ? document.querySelector('[data-say]') : retained);
    expect(composer.value).toBe('Keep this draft');
});

describe('opening a room from the directory', () => {
    const room = '#directory-room';
    const instance = 'd'.repeat(32);
    async function directory({ key = false, roomInstance = instance } = {}) {
        const { window, ws, welcome, join } = await visitor();
        welcome(); join();
        ws.receive({ t: 'list', rooms: [{ name: room, title: 'Directory Room', kind: 'chat', count: 1, max: 8, key, locked: false, roomInstance }] });
        const button = window.document.querySelector(`[data-room="${room}"]`);
        button.focus();
        return { window, ws, join, button };
    }

    it.each([false, true])('moves from the directory to the confirmed room tab unless focus moved (%s)', async (moved) => {
        const { window, ws, join, button } = await directory();
        const { document } = window;
        button.click();
        expect(ws.sent.at(-1)).toMatchObject({ t: 'cmd', name: 'join', args: [room], roomInstance: instance });
        const input = document.querySelector('[data-text]');
        if (moved) input.focus();
        join(room);
        expect(document.activeElement).toBe(moved ? input : document.querySelector(`[data-channel-key="${room}"]`));

        document.querySelector('[data-channel-key="#stalemate"]').click();
        button.focus();
        const before = ws.sent.length;
        button.click();
        expect(ws.sent).toHaveLength(before);
        expect(document.activeElement.dataset.channelKey).toBe(room);
    });

    it('leaves focus in Rooms and sends nothing when the room key prompt is canceled', async () => {
        const { window, ws, button } = await directory({ key: true });
        window.prompt = vi.fn(() => null);
        const before = ws.sent.length;
        button.click();
        expect(window.prompt).toHaveBeenCalledOnce();
        expect(ws.sent).toHaveLength(before);
        expect(window.document.activeElement).toBe(button);
    });

    it('keeps legacy rows usable when a relay sends no room reference', async () => {
        const { ws, button } = await directory({ roomInstance: null });
        button.click();
        expect(ws.sent.at(-1)).toEqual({ t: 'cmd', name: 'join', args: [room], ch: '#stalemate' });
    });
});

it('keeps browser audio guidance and actions off under the protected participation policy', async () => {
    const { window, ws, welcome, join } = await visitor('rad-dad', {}, { beta: true, participation: true });
    const { document } = window;
    window.open = vi.fn();
    welcome(); join();
    const room = '#jam-policy-room', href = 'https://audio.example.test/join/';
    ws.receive({ t: 'join', ch: {
        name: room, kind: 'jam', keepRef: 'd'.repeat(32), modes: { i: true },
        names: [{ nick: 'Viewer', prefix: '@' }],
        jam: { web: href, webReady: true, desktop: 'webjam://fixture-host/', invitation: 'webjam://fixture-host/' },
    } });
    const web = document.querySelector('[data-jam-web]');
    expect(web.hidden).toBe(true);
    expect(web.disabled).toBe(true);
    expect(document.querySelector('[data-jam-invite-copy]').hidden).toBe(true);
    expect(document.querySelector('[data-jam-invite-qr-toggle]').hidden).toBe(true);
    expect(document.querySelector('[data-jam-desktop]').hidden).toBe(false);
    expect(document.querySelector('[data-jam-browser-note]').textContent).toContain('Browser audio is unavailable');
    web.click();
    expect(window.open).not.toHaveBeenCalled();
    const input = document.querySelector('[data-jam-link]');
    const form = document.querySelector('[data-jam-form]');
    input.value = href;
    form.dispatchEvent(new window.Event('submit', { cancelable: true }));
    expect(ws.sent.some(frame => frame.name === 'jamlink')).toBe(false);
    expect(document.querySelector('[data-jam-share-status]').textContent).toContain('Paste a full desktop invitation');
    expect(input.value).toBe(href);
    input.value = 'webjam://fixture-host/';
    form.dispatchEvent(new window.Event('submit', { cancelable: true }));
    expect(ws.sent.at(-1)).toMatchObject({ t: 'cmd', name: 'jamlink', args: ['invitation', input.value], ch: room });
});

describe('targeted Music invitation', () => {
    async function setup(features = { directMusicInvites: 1 }) {
        const { window, ws, welcome, join, flush } = await visitor('rad-dad', features);
        const { document } = window;
        window.open = vi.fn();
        welcome(); join();
        const room = '#jam-rehearsal', instance = 'a'.repeat(32);
        const expires = (Math.floor(Date.now() / 1000) + 60) * 1000;
        const offer = { t: 'music-invite', id: 'b'.repeat(32), ch: room, roomInstance: instance, by: 'GuitarHost', expires };
        const href = `https://music.example.test/join/#k=${'A'.repeat(43)}&s=${'0'.repeat(64)}&g=1&e=${expires / 1000}`;
        const accepted = { ...offer, t: 'music-invite-accepted', href };
        const joinJam = () => ws.receive({ t: 'join', ch: {
            name: room, keepRef: instance, kind: 'jam', title: 'Rehearsal', topic: '', modes: { i: true }, count: 1,
            names: [{ nick: 'Viewer', prefix: '', entrySource: 'rad-dad' }],
        } });
        return { window, ws, flush, offer, accepted, href, joinJam,
            panel: document.querySelector('[data-music-invite]'),
            action: document.querySelector('[data-music-invite-action]'),
            status: document.querySelector('[data-music-invite-status]'),
            dismiss: document.querySelector('[data-music-invite-dismiss]'),
        };
    }

    it('accepts into the Jam room, then opens Web Join only on a second user gesture', async () => {
        const { window, ws, offer, accepted, href, joinJam, panel, action } = await setup();
        ws.receive(offer);
        expect(panel.hidden).toBe(false);
        expect(action.textContent).toBe('Accept and join');
        action.focus();
        action.click();
        expect(ws.sent.at(-1)).toEqual({ t: 'music-invite-accept', ch: offer.ch, roomInstance: offer.roomInstance, id: offer.id });
        expect(action.getAttribute('aria-disabled')).toBe('true');
        joinJam();
        ws.receive(accepted);
        expect(window.__lobby.active).toBe(offer.ch);
        expect(action.textContent).toBe('Open WebJam in browser');
        expect(window.open).not.toHaveBeenCalled();
        action.click();
        expect(window.open).toHaveBeenCalledWith(href, '_blank', 'noopener,noreferrer');
        expect(JSON.stringify({ ...window.sessionStorage, ...window.localStorage })).not.toContain(href);
        ws.receive({ t: 'part', ch: offer.ch });
        expect(action.hidden).toBe(true);
        action.click();
        expect(window.open).toHaveBeenCalledTimes(1);
    });

    it('explains an unconfirmed response and still accepts a delayed confirmation', async () => {
        const { ws, offer, accepted, joinJam, action, status, flush } = await setup();
        ws.receive(offer);
        action.click();
        flush(10000);
        expect(action.hidden).toBe(true);
        expect(status.textContent).toMatch(/hasn’t confirmed/);
        joinJam();
        ws.receive(accepted);
        expect(action.textContent).toBe('Open WebJam in browser');
        expect(action.hidden).toBe(false);
    });

    it('announces Music invite updates without revealing the private browser link', async () => {
        const { window, ws, offer, accepted, href, joinJam, panel, action, dismiss } = await setup();
        const { document } = window;
        const live = document.querySelector('[data-music-invite-announcement]');
        const composer = document.querySelector('[data-text]');
        expect(panel.hidden).toBe(true);
        expect(live?.getAttribute('role')).toBe('status');
        expect(live.closest('[hidden], [aria-hidden="true"]')).toBeNull();
        expect(live.textContent).toBe('');
        composer.focus();

        ws.receive(offer);
        expect(live.textContent).toBe('GuitarHost invited you to join Music.');
        expect(document.activeElement).toBe(composer);
        action.focus();
        action.click();
        expect(live.textContent).toBe('Waiting for the room to confirm you joined.');
        joinJam();
        ws.receive(accepted);
        expect(live.textContent).toContain('You’re in the Jam room.');
        expect(document.body.innerHTML).not.toContain(href);

        ws.receive({ t: 'music-invite-ended', id: offer.id });
        expect(live.textContent).toBe('This Music invitation ended. Ask the host for a new one.');
        expect(document.activeElement).toBe(dismiss);
        dismiss.click();
        expect(panel.hidden).toBe(true);
        expect(live.textContent).toBe('');
        expect(live.closest('[hidden], [aria-hidden="true"]')).toBeNull();
    });

    it('ignores offers without the negotiated capability and declines without opening audio', async () => {
        const old = await setup({});
        old.ws.receive(old.offer);
        expect(old.panel.hidden).toBe(true);
        const { window, ws, offer, panel, dismiss } = await setup();
        ws.receive(offer);
        dismiss.click();
        expect(panel.hidden).toBe(true);
        expect(ws.sent.at(-1)).toEqual({ t: 'music-invite-decline', ch: offer.ch, roomInstance: offer.roomInstance, id: offer.id });
        expect(window.open).not.toHaveBeenCalled();
    });
});

it.each(['on time', 'late receipt', 'late rejection', 'outcome before receipt'])('uses the shared roster and native return without pasting (%s)', async (receipt) => {
    const { window, ws, flush } = await visitor('stalemate', { directMusicInvites: 1, personTargets: 1 }, { secureOrigin: true });
    const { document } = window;
    const request = 'c'.repeat(32), keepRef = 'd'.repeat(32);
    const timedOutRequest = 'b'.repeat(32), leftBeforeSubmit = 'e'.repeat(32);
    Object.defineProperty(window.crypto, 'randomUUID', { value: vi.fn().mockReturnValueOnce(timedOutRequest)
        .mockReturnValueOnce(leftBeforeSubmit).mockReturnValue(request) });
    window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
    const launch = vi.fn();
    window.HTMLAnchorElement.prototype.click = function () { launch(this.href); };
    const channels = [];
    window.BroadcastChannel = class {
        constructor(name) { this.name = name; this.postMessage = vi.fn(); this.close = vi.fn(); channels.push(this); }
        receive(data) { this.onmessage({ data }); }
    };
    const self = { id: 'host-peer', nick: 'Viewer', prefix: '@' };
    const guest = { id: 'rad-dad-peer', nick: 'DrumGuest', prefix: '', entrySource: 'rad-dad' };
    ws.receive({ t: 'welcome', id: self.id, nick: self.nick, role: 'fan', capabilities: {} });
    ws.receive({ t: 'join', ch: { name: '#stalemate', kind: 'lobby', modes: {}, names: [self, guest] } });
    ws.receive({ t: 'join', ch: { name: '#jam-rehearsal', kind: 'jam', keepRef, modes: { i: true }, names: [self] } });
    const invite = document.querySelector('[data-jam-invite-music]');
    expect(invite.hidden).toBe(false);
    const chooseGuest = () => {
        invite.click();
        const people = document.querySelector('[data-invite-options]');
        expect([...people.options].map(option => option.value)).toEqual(['', guest.id]);
        people.value = guest.id;
        document.querySelector('[data-invite-person-send]').click();
    };
    const status = document.querySelector('[data-music-handoff-status]');
    const selectChannel = name => document.querySelector(`[data-channel-key="${name}"]`).click();
    const expiry = Math.floor(Date.now() / 1000) + 60;
    const href = `${window.location.origin}/join/#k=${'A'.repeat(43)}&s=${'0'.repeat(64)}&g=1&e=${expiry}`;

    chooseGuest();
    expect(launch).toHaveBeenLastCalledWith(`webjam-beta://hangout-music/${timedOutRequest}`);
    flush(90000);
    expect(status.textContent).toContain('Check that your private rehearsal build is open and hosting Music');
    expect(document.querySelector('[data-music-handoff-manual]').hidden).toBe(false);
    expect(channels[0].close).toHaveBeenCalledOnce();
    channels[0].receive({ href });
    expect(ws.sent.some(frame => frame.t === 'music-invite-offer')).toBe(false);

    chooseGuest();
    selectChannel('#stalemate');
    expect(channels[1].postMessage).toHaveBeenCalledWith({ returned: false });
    expect(channels[1].close).toHaveBeenCalledOnce();
    channels[1].receive({ href });
    expect(ws.sent.some(frame => frame.t === 'music-invite-offer')).toBe(false);
    selectChannel('#jam-rehearsal');

    chooseGuest();
    expect(launch).toHaveBeenLastCalledWith(`webjam-beta://hangout-music/${request}`);
    expect(channels[2].name).toBe(`webjam-music-${request}`);
    channels[2].receive({ href });
    channels[2].receive({ href });
    expect(ws.sent.filter(frame => frame.t === 'music-invite-offer')).toEqual([
        { t: 'music-invite-offer', request, ch: '#jam-rehearsal', roomInstance: keepRef, peer: guest.id, href },
    ]);
    selectChannel('#stalemate');
    expect(channels[2].close).not.toHaveBeenCalled();
    const late = receipt !== 'on time';
    if (late) {
        flush(90000);
        selectChannel('#jam-rehearsal');
        expect(status.textContent).toContain('Hang Out did not confirm delivery');
        ws.receive({ t: 'music-invite-result', request: timedOutRequest, status: 'sent' });
        expect(status.textContent).toContain('Hang Out did not confirm delivery');
        selectChannel('#stalemate');
    }
    if (receipt === 'outcome before receipt') ws.receive({ t: 'music-invite-outcome', request, status: 'accepted' });
    ws.receive({ t: 'music-invite-result', request, status: receipt === 'late rejection' ? 'unavailable' : 'sent' });
    if (late) expect(channels[2].postMessage).not.toHaveBeenCalled();
    else expect(channels[2].postMessage).toHaveBeenCalledWith({ returned: true });
    expect(channels[2].close).toHaveBeenCalledOnce();
    selectChannel('#jam-rehearsal');
    if (receipt === 'late rejection') {
        expect(status.textContent).toContain('couldn’t be sent');
        expect(document.querySelector('[data-music-handoff-manual]').hidden).toBe(false);
        return;
    }
    if (receipt === 'outcome before receipt') expect(status.textContent).toBe('DrumGuest accepted and joined the Jam room.');
    else expect(status.textContent).toContain('sent to DrumGuest');
    selectChannel('#stalemate');
    ws.receive({ t: 'music-invite-outcome', request, status: 'accepted' });
    expect(status.textContent).toBe('');
    selectChannel('#jam-rehearsal');
    expect(document.querySelector('[data-music-handoff-status]').textContent).toBe('DrumGuest accepted and joined the Jam room.');
    expect(document.querySelector('[data-jam-link]').value).toBe('');
    expect(JSON.stringify({ ...window.sessionStorage, ...window.localStorage })).not.toContain(href);
});

it('explains an empty Music invite roster and focuses Cancel', async () => {
    const { window, ws } = await visitor('rad-dad', { directMusicInvites: 1, personTargets: 1 }, { secureOrigin: true });
    const { document } = window;
    window.BroadcastChannel = class {};
    window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    const self = { id: 'host-peer', nick: 'Viewer', prefix: '@' };
    ws.receive({ t: 'welcome', id: self.id, nick: self.nick, role: 'fan', capabilities: {} });
    ws.receive({ t: 'join', ch: { name: '#stalemate', kind: 'lobby', modes: {}, names: [self] } });
    ws.receive({ t: 'join', ch: { name: '#jam-rehearsal', kind: 'jam', keepRef: 'd'.repeat(32), modes: { i: true }, names: [self] } });

    document.querySelector('[data-jam-invite-music]').click();
    const dialog = document.querySelector('[data-invite-dialog]');
    expect(dialog.open).toBe(true);
    const hint = document.getElementById(dialog.getAttribute('aria-describedby'));
    expect(hint?.textContent).toContain('Ask your guest to open Hang Out and choose a nickname');
    expect(dialog.querySelector('[data-invite-options]').disabled).toBe(true);
    expect(dialog.querySelector('[data-invite-person-send]').disabled).toBe(true);
    expect(document.activeElement).toBe(dialog.querySelector('[data-invite-cancel]'));
});

describe('focus after private guest entry', () => {
    it('takes a guest to Chat when the nickname gate disappears', async () => {
        const { window, welcome, join } = await visitor();
        const { document } = window;
        const nick = document.querySelector('[data-nick]');
        nick.focus();
        expect(document.activeElement).toBe(nick);

        welcome();
        join();

        const chat = document.querySelector('[data-pane="chat"]');
        expect(document.querySelector('[data-gate]').hidden).toBe(true);
        expect(document.querySelector('[data-app]').hidden).toBe(false);
        expect(document.activeElement).toBe(chat);
    });

    it('does not interrupt a guest who moved focus outside the gate while waiting', async () => {
        const { window, welcome, join } = await visitor();
        const { document } = window;
        const otherControl = document.createElement('button');
        document.body.prepend(otherControl);
        otherControl.focus();

        welcome();
        join();

        expect(document.activeElement).toBe(otherControl);
    });
});

it('identifies emoji shortcuts as actions that send the named message', async () => {
    const { window, ws, welcome, join } = await visitor();
    welcome(); join();
    const quickReplies = window.document.querySelectorAll('[data-quick-line]');
    expect([...quickReplies].map(button => button.getAttribute('aria-label'))).toEqual([
        'Send 🤘 SHRED', 'Send happy little tree 🌲',
    ]);
    quickReplies[1].click();
    expect(ws.sent.at(-1)).toEqual({ t: 'say', ch: '#stalemate', text: 'happy little tree 🌲' });
});

it('names the channel tab group and describes the conversation with the selected room', async () => {
    const { window, welcome, join } = await visitor();
    welcome(); join(); join('#writing-room');
    const { document } = window;
    const tabs = document.querySelector('[role="tablist"]');
    const log = document.querySelector('[role="log"]');
    const context = document.querySelector('[data-chat-context]');
    expect(tabs.getAttribute('aria-label')).toBe('Channels and direct messages');
    expect(document.getElementById(log.getAttribute('aria-describedby'))).toBe(context);
    expect(context.textContent).toBe('#writing-room');
    expect(tabs.querySelector('[aria-selected="true"]').dataset.channelKey).toBe('#writing-room');

    tabs.querySelector('[data-channel-key="#stalemate"]').click();

    expect(context.textContent).toBe('#stalemate');
    expect(tabs.querySelector('[aria-selected="true"]').dataset.channelKey).toBe('#stalemate');
    expect(log.getAttribute('aria-label')).toBe('Conversation');
});

it('renders informational chat names as text and keeps live person actions available', async () => {
    const { window, ws, join } = await visitor('stalemate', { personTargets: 1 });
    ws.receive({ t: 'welcome', id: 'self-peer', nick: 'Viewer', role: 'fan', capabilities: {}, transportSeq: 1 });
    join();
    const ch = '#stalemate';
    const roomInstance = 'a'.repeat(32);
    ws.receive({ t: 'line', ch, from: 'Viewer', text: 'Own message', personSelf: true, personPeer: 'self-peer', roomInstance });
    ws.receive({ t: 'line', ch, from: 'EarlierGuest', text: 'Earlier message without a person target', id: 'earlier-message' });
    ws.receive({ t: 'line', ch, from: 'CurrentGuest', text: 'Current message', personSelf: false, personPeer: 'current-peer', roomInstance });

    const { document } = window;
    const authors = [...document.querySelectorAll('[data-chat-lines] .who')];
    expect(authors.map(author => [author.tagName, author.textContent])).toEqual([
        ['SPAN', '<Viewer>'],
        ['SPAN', '<EarlierGuest>'],
        ['BUTTON', '<CurrentGuest>'],
    ]);
    expect(authors[2].disabled).toBe(false);
    expect(document.querySelector('[data-id="earlier-message"] button.flag')).toBeTruthy();
});

it('renders the guest name as roster text and preserves focus on a current peer during updates', async () => {
    const { window, ws } = await visitor('stalemate', { personTargets: 1 });
    const self = { id: 'self-peer', nick: 'Viewer', prefix: '' };
    const peer = { id: 'current-peer', nick: 'CurrentGuest', prefix: '' };
    const channel = { name: '#stalemate', kind: 'lobby', title: 'Shared chat', keepRef: 'a'.repeat(32),
        count: 2, modes: {}, names: [self, peer] };
    ws.receive({ t: 'welcome', id: self.id, nick: self.nick, role: 'fan', capabilities: {}, transportSeq: 1 });
    ws.receive({ t: 'join', ch: channel });
    const { document } = window;
    const roster = document.querySelector('[data-nicks]');
    const ownName = roster.querySelector('.nick[data-self="true"]');
    const peerButton = roster.querySelector('button.nick[data-self="false"]');
    expect(ownName.tagName).toBe('SPAN');
    expect(ownName.textContent).toBe('Viewer');
    peerButton.focus();

    ws.receive({ t: 'chan', ch: { ...channel, names: [self, { ...peer, nick: 'RenamedGuest' }] } });

    expect(roster.querySelector('button.nick[data-self="false"]')).toBe(peerButton);
    expect(peerButton.textContent).toBe('RenamedGuest');
    expect(document.activeElement).toBe(peerButton);
});

describe('channel tab focus after a room closes', () => {
    it.each(['room tab', 'message composer'])('keeps keyboard focus usable from the %s', async (start) => {
        const { window, ws, welcome, join } = await visitor();
        welcome(); join(); join('#temporary');
        const { document } = window;
        const tab = document.querySelector('[data-channel-key="#temporary"]');
        const composer = document.querySelector('[data-text]');
        const focused = start === 'room tab' ? tab : composer;
        focused.focus();
        expect(document.activeElement).toBe(focused);

        ws.receive({ t: 'closed', ch: '#temporary', reason: 'closed by the host' });

        const lobby = document.querySelector('[data-channel-key="#stalemate"]');
        expect(tab.isConnected).toBe(false);
        expect(lobby.getAttribute('aria-selected')).toBe('true');
        expect(document.activeElement).toBe(start === 'room tab' ? lobby : composer);
    });
});

describe('nickname rejection recovery', () => {
    it('returns keyboard focus to the rejected nickname and identifies its error', async () => {
        const { window, ws } = await visitor();
        const { document } = window;
        const submit = document.querySelector('[data-enter]');
        const nickname = document.querySelector('[data-nick]');
        nickname.focus();
        nickname.blur();
        expect(document.activeElement).toBe(document.body);

        ws.receive({ t: 'nick-error', text: 'That nick is taken right now.' });

        expect(document.activeElement).toBe(nickname);
        expect(nickname.value).toBe('Viewer');
        const description = document.getElementById(nickname.getAttribute('aria-describedby'));
        expect(description.textContent).toBe('That nick is taken right now.');
        expect(submit.disabled).toBe(false);

        nickname.value = 'AnotherName';
        submit.click();

        expect(nickname.hasAttribute('aria-describedby')).toBe(false);
        expect(description.textContent).toBe('Getting you in…');
    });
});

describe('newcomer navigation and closed sessions', () => {
    it('reveals the first chat action on a room change without disturbing the current room', async () => {
        const { window, welcome, join } = await visitor();
        welcome(); join();
        const actions = window.document.querySelector('[data-quick]');
        actions.scrollLeft = 120;

        join('#other-room');

        expect(actions.scrollLeft).toBe(0);
        actions.scrollLeft = 85;
        window.document.querySelector('[data-channel-key="#other-room"]').click();
        expect(actions.scrollLeft).toBe(85);
    });

    it.each([
        ['hides', '   ', true],
        ['shows', 'Keep this draft', false],
    ])('%s draft copy guidance after a session ends', async (_label, text, hidden) => {
        const { window, ws, welcome, join } = await visitor();
        welcome(); join();
        const { document } = window;
        const composer = document.querySelector('[data-text]');
        composer.value = text;

        ws.close(4401);

        expect(document.querySelector('[data-session-ended]').hidden).toBe(false);
        expect(document.querySelector('[data-session-ended] p.small').hidden).toBe(hidden);
        expect(document.querySelector('[data-network-note]').hidden).toBe(hidden);
        expect(composer.value).toBe(text);
        expect(composer.readOnly).toBe(true);
    }, 15000);
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
    it('keeps both branded private lobby entrances inside the beta', async () => {
        for (const [brand, label] of [['stalemate', 'via Stalemate'], ['rad-dad', 'via Rad Dad']]) {
            const { window, welcome, join } = await visitor(brand, { entrySources: 1 }, { beta: true });
            welcome();
            join();
            const badges = [...window.document.querySelectorAll('[data-entry-label]')];
            expect(badges.length).toBeGreaterThan(0);
            expect(badges.map(badge => badge.textContent)).toEqual(badges.map(() => label));
            for (const link of window.document.querySelectorAll('[data-entry-return]')) {
                expect(link.hidden).toBe(true);
                expect(link.hasAttribute('href')).toBe(false);
            }
        }
    });

    it('updates Game Night guidance when the room host goes offline', async () => {
        const { window, ws } = await visitor('stalemate', { gameNight: 1 }, { beta: true });
        const player = { id: 'c' + 'a'.repeat(32), nick: 'Viewer', prefix: '' };
        const host = { id: 'c' + 'b'.repeat(32), nick: 'Host', prefix: '@' };
        const room = { name: '#game-1acbefx23acbe', kind: 'game', keepRef: 'c'.repeat(32),
            title: 'Game Night', topic: '', count: 2, modes: { i: true }, names: [player, host] };
        ws.receive({ t: 'welcome', nick: player.nick, id: player.id, role: 'fan', band: false });
        ws.receive({ t: 'join', ch: room });
        const status = window.document.querySelector('[data-game-waiting]');
        expect(status.hidden).toBe(false);
        expect(status.textContent).toBe('Choose a game to see whether a table is open.');
        ws.receive({ t: 'chan', ch: { ...room, names: [player], count: 1 } });
        expect(status.textContent).toBe('No room host is online. You can check the games or wait here.');
    });

    it('drops unsupported saved games when the lobby offers to reopen a private room', async () => {
        const { window, welcome, join } = await visitor('stalemate', { entrySources: 1, gameNight: 1 }, { beta: true });
        const key = 'hangout-game-return';
        const hint = { room: '#game-1acbefx23acbe', ref: 'a'.repeat(32), until: Date.now() + 60_000 };
        window.sessionStorage.setItem(key, JSON.stringify({ ...hint, game: 'unsupported-game', session: 'unrelated' }));
        welcome();
        join();
        expect(JSON.parse(window.sessionStorage.getItem(key))).toEqual(hint);
        const offer = window.document.querySelector('[data-game-offer]');
        expect(offer.hidden).toBe(false);
        expect(offer.querySelector('[data-game-offer-join]').textContent).toBe('Return to room');
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
        window.requestAnimationFrame = (callback) => window.setTimeout(callback, 16);
        const log = window.document.querySelector('[data-buffer]');
        const messages = log.querySelector('[role="list"][aria-label="Messages"]');
        expect(messages).not.toBeNull();
        ws.receive({ t: 'line', ch: '#stalemate', id: 'moldest', from: 'Friend', text: 'Bounded line 0' });
        const oldest = messages.querySelector('[data-id=moldest] .flag');
        oldest.focus();
        for (let index = 1; index <= 300; index++)
            ws.receive({ t: 'line', ch: '#stalemate', from: 'Friend', text: `Bounded line ${index}` });
        expect(messages.children).toHaveLength(300);
        expect(oldest.isConnected).toBe(false);
        expect(window.document.activeElement).toBe(window.document.querySelector('[data-say]'));
        expect(messages.firstElementChild.textContent).toMatch(/Bounded line 1$/);
        expect(messages.lastElementChild.textContent).toContain('Bounded line 300');
        expect([...messages.children].every(item => item.tagName === 'LI')).toBe(true);
        window.document.querySelector('[data-chat-announcements]').click();
        join('#another-room'); paint(); paint();
        expect(log.querySelector('[role="list"]')).toBe(messages);
        expect(messages.children).toHaveLength(0);
        expect(log.getAttribute('aria-live')).toBe('off');
        ws.receive({ t: 'line', ch: '#another-room', from: 'Friend', text: 'Clear this when the session ends' });
        expect(messages.children).toHaveLength(1);
        ws.close(4401);
        expect(log.querySelector('[role="list"]')).toBe(messages);
        expect(messages.children).toHaveLength(0);
        expect(log.getAttribute('aria-live')).toBe('off');
    }, 15000);
});
