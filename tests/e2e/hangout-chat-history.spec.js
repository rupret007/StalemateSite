// Private-room chat is live from join onward; drawing/watch snapshots are separate.
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const ROOT = '/r/45662413410ed051/';
const KEY = 'local-preview-key-0001';
const VIDEO = 'BtnyqIHTDMM';
const FAKE_YT = path.join(__dirname, 'support/fake-youtube.js');
const contexts = new Set();
const pages = new Set();

test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium covers encrypted private-room history');
test.afterEach(async () => {
    try {
        for (const page of pages) {
            expect(page.historyErrors).toEqual([]);
            if (!page.isClosed()) expect(await page.evaluate(() => window.__historyWire?.errors || [])).toEqual([]);
        }
    } finally {
        await Promise.all([...contexts].map(context => context.close()));
        contexts.clear();
        pages.clear();
    }
});

async function visitor(browser, baseURL) {
    const context = await browser.newContext();
    contexts.add(context);
    // The only provider script is the existing deterministic fixture. Embeds and
    // every other external HTTP request are aborted before reaching a provider.
    await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.href === 'https://www.youtube.com/iframe_api') {
            return route.fulfill({ path: FAKE_YT, contentType: 'text/javascript' });
        }
        return url.origin === new URL(baseURL).origin ? route.continue() : route.abort();
    });
    await context.addInitScript(() => {
        const wire = window.__historyWire = { sent: [], received: [], errors: [] };
        const descriptor = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
        const callbacks = new WeakMap();
        const nativeSend = WebSocket.prototype.send;
        const counters = { sent: 0, received: 0 };
        async function observe(socket, raw, direction) {
            const app = window.__hangout;
            if (!app?.key || socket !== app.ws) return;
            const order = counters[direction]++;
            try {
                const frame = JSON.parse(raw);
                if (!frame.c) return;
                const message = await window.HangoutCore.open(app.key, frame);
                if (!['snapshot', 'host', 'chat', 'hello'].includes(message.type)) return;
                const entry = { message, from: frame.from || null, order };
                if (direction === 'received') {
                    entry.after = {
                        done: app.snapshotDone, from: app.snapshotFrom, proof: app.snapshotHasSeqProof,
                        seq: app.lastHostSeq, strokes: app.state.strokes.map(stroke => stroke.id),
                        chat: app.state.chat.map(line => line.text)
                    };
                }
                wire[direction].push(entry);
            } catch (_) { wire.errors.push('wire-observation-failed'); }
        }
        Object.defineProperty(WebSocket.prototype, 'onmessage', {
            configurable: descriptor.configurable,
            enumerable: descriptor.enumerable,
            get() { return callbacks.get(this) || null; },
            set(callback) {
                callbacks.set(this, callback);
                descriptor.set.call(this, typeof callback === 'function' ? async function (event) {
                    // Record only after the application's actual async handler
                    // completes, including decrypt/verify and snapshot rendering.
                    const result = await callback.call(this, event);
                    await observe(this, event.data, 'received');
                    return result;
                } : callback);
            }
        });
        WebSocket.prototype.send = function (raw) {
            const result = nativeSend.call(this, raw);
            void observe(this, raw, 'sent');
            return result;
        };
    });
    const page = await context.newPage();
    pages.add(page);
    page.historyErrors = [];
    page.on('pageerror', error => page.historyErrors.push(error.message));
    return page;
}

async function join(page, url, name) {
    await page.goto(url);
    await page.fill('[data-name]', name);
    await page.click('[data-enter]');
    await expect(page.locator('[data-room]')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__hangout.connected)).toBe(true);
}

async function hostRoom(browser, baseURL) {
    const host = await visitor(browser, baseURL);
    await join(host, ROOT + '?preview=' + KEY + '&relay=' + encodeURIComponent(hangoutRelayWsBase(baseURL)), 'HistoryHost');
    return { host, invite: host.url() };
}

async function completedSnapshot(page, sender, requireOwnership = true) {
    const from = await sender.evaluate(() => window.__hangout.myId);
    await expect.poll(() => page.evaluate(({ from, requireOwnership }) => window.__historyWire.received.some(entry =>
        entry.message.type === 'snapshot' && entry.message.to === window.__hangout.myId
        && entry.from === from && entry.message.done === true && entry.after.done
        && (!requireOwnership || entry.after.from === from && entry.after.proof)
    ), { from, requireOwnership })).toBe(true);
}

async function sentSnapshots(page, to, expectedCount = 1) {
    await expect.poll(() => page.evaluate(({ to, expectedCount }) => {
        const entries = window.__historyWire.sent.filter(entry => entry.message.type === 'snapshot' && entry.message.to === to);
        return entries.length >= expectedCount && entries.some(entry => entry.message.done === true);
    }, { to, expectedCount })).toBe(true);
    return page.evaluate(to => window.__historyWire.sent.filter(entry =>
        entry.message.type === 'snapshot' && entry.message.to === to
    ).sort((a, b) => a.order - b.order).map(entry => entry.message), to);
}

async function say(page, text) {
    await page.fill('[data-text]', text);
    await page.press('[data-text]', 'Enter');
    await expect.poll(() => page.evaluate(text => window.__historyWire.sent.some(entry =>
        entry.message.type === 'chat' && entry.message.text === text
    ), text)).toBe(true);
}

async function chatIs(page, texts) {
    await expect.poll(() => page.evaluate(() => window.__hangout.state.chat.map(line => line.text))).toEqual(texts);
    await expect(page.locator('[data-log] li')).toHaveCount(texts.length);
    for (const text of texts) await expect(page.locator('[data-log] li').filter({ hasText: text })).toHaveCount(1);
}

async function drawLine(page) {
    const box = await page.locator('[data-canvas]').boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box.x + 30, box.y + 30);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + 90, { steps: 6 });
    await page.mouse.up();
    // Local pointer samples retain raw floats until the next snapshot; peers
    // receive the protocol's validated, four-decimal coordinates.
    return page.evaluate(() => window.__hangout.state.strokes.map(window.HangoutCore.cleanStroke));
}

test('late invitees and refreshed connections receive activity state but no earlier chat', async ({ browser, baseURL }) => {
    const { host, invite } = await hostRoom(browser, baseURL);
    const strokes = await drawLine(host);
    expect(strokes.length).toBeGreaterThan(0);
    await say(host, 'before-the-invitee-joined');
    await host.click('[data-pick-yt="' + VIDEO + '"]');
    await expect(host.locator('[data-fake-yt]')).toHaveAttribute('data-state', 'playing');

    const late = await visitor(browser, baseURL);
    await join(late, invite, 'HistoryLate');
    await completedSnapshot(late, host);
    expect(await late.evaluate(() => window.__hangout.state.strokes)).toEqual(strokes);
    await expect.poll(() => late.evaluate(() => window.__hangout.state.video?.source)).toEqual({ kind: 'yt', id: VIDEO });
    await expect(late.locator('[data-fake-yt]')).toHaveAttribute('data-video-id', VIDEO);
    await chatIs(late, []);

    await say(host, 'live-after-first-join');
    await chatIs(late, ['live-after-first-join']);
    const oldId = await late.evaluate(() => window.__hangout.myId);
    await late.reload();
    await late.fill('[data-name]', 'HistoryLate');
    await late.click('[data-enter]');
    await completedSnapshot(late, host);
    expect(await late.evaluate(() => window.__hangout.myId)).not.toBe(oldId);
    expect(await late.evaluate(() => window.__hangout.state.strokes)).toEqual(strokes);
    expect(await late.evaluate(() => window.__hangout.state.video.source)).toEqual({ kind: 'yt', id: VIDEO });
    await chatIs(late, []);
    await say(host, 'live-after-refresh');
    await chatIs(late, ['live-after-refresh']);
});

test('actual host and guest multipart snapshot ciphertext decrypts without any chat field', async ({ browser, baseURL }) => {
    const { host, invite } = await hostRoom(browser, baseURL);
    // Seed a bounded drawing large enough to exercise the production chunker.
    await host.evaluate(() => {
        for (let i = 0; i < 105; i += 1) window.HangoutCore.apply(window.__hangout.state, {
            type: 'stroke', stroke: { id: 'history-stroke-' + i, color: '#171410', size: 4, pts: [[0.1, 0.2], [0.2, 0.3]] }
        });
    });
    const guest = await visitor(browser, baseURL);
    await join(guest, invite, 'HistoryGuest');
    await completedSnapshot(guest, host);
    expect(await guest.evaluate(() => window.__hangout.isHost)).toBe(false);
    expect(await guest.evaluate(() => window.__hangout.state.strokes.length)).toBe(105);
    await say(host, 'host-buffer-must-stay-local');
    await say(guest, 'guest-buffer-must-stay-local');
    for (const page of [host, guest]) {
        await expect.poll(() => page.evaluate(() => window.__hangout.state.chat.length)).toBe(2);
    }

    const late = await visitor(browser, baseURL);
    await join(late, invite, 'HistoryWireLate');
    await completedSnapshot(late, host);
    const to = await late.evaluate(() => window.__hangout.myId);
    for (const sender of [host, guest]) {
        const snapshots = await sentSnapshots(sender, to, 2);
        expect(snapshots).toHaveLength(2);
        expect(snapshots.map(snapshot => snapshot.strokes.length)).toEqual([100, 5]);
        expect(snapshots.map(snapshot => [snapshot.first, snapshot.done])).toEqual([[true, false], [false, true]]);
        for (const snapshot of snapshots) expect(Object.hasOwn(snapshot, 'chat')).toBe(false);
    }
    expect(await late.evaluate(() => window.__hangout.state.strokes.length)).toBe(105);
    await chatIs(late, []);
});

async function sendObserved(sender, receiver, message, label) {
    const to = await receiver.evaluate(() => window.__hangout.myId);
    await sender.evaluate(async ({ to, message, label }) => {
        const app = window.__hangout;
        const frame = await window.HangoutCore.seal(app.key, { ...message, to, _historyProbe: label });
        app.ws.send(JSON.stringify(frame));
    }, { to, message, label });
    await expect.poll(() => receiver.evaluate(label => window.__historyWire.received.some(entry =>
        entry.message._historyProbe === label
    ), label)).toBe(true);
    return receiver.evaluate(label => window.__historyWire.received.find(entry =>
        entry.message._historyProbe === label
    ).after, label);
}

test('legacy chunks and a signed proof upgrade preserve live chat, strokes and the replay floor', async ({ browser, baseURL }) => {
    const { host, invite } = await hostRoom(browser, baseURL);
    const guest = await visitor(browser, baseURL);
    await join(guest, invite, 'HistoryLegacyGuest');
    await completedSnapshot(guest, host);
    await host.click('[data-clear]');
    await expect.poll(() => guest.evaluate(() => window.__historyWire.received.some(entry =>
        entry.message.type === 'host' && entry.message.body.kind === 'clear'
    ))).toBe(true);
    const oldClear = await guest.evaluate(() => window.__historyWire.received.find(entry =>
        entry.message.type === 'host' && entry.message.body.kind === 'clear'
    ).message);
    await drawLine(host);
    const late = await visitor(browser, baseURL);
    await join(late, invite, 'HistoryLegacyLate');
    await completedSnapshot(late, host);
    const to = await late.evaluate(() => window.__hangout.myId);
    // Drain the ordinary join responses before beginning the controlled legacy
    // stream; their delayed callbacks cannot race the test's snapshot ownership.
    await sentSnapshots(host, to);
    await sentSnapshots(guest, to);
    await completedSnapshot(late, guest, false);
    await say(host, 'keep-this-live-postjoin-line');
    await chatIs(late, ['keep-this-live-postjoin-line']);
    const guestId = await guest.evaluate(() => window.__hangout.myId);
    const hostId = await host.evaluate(() => window.__hangout.myId);
    await late.evaluate(guestId => {
        const app = window.__hangout;
        app.snapshotDone = false; app.snapshotFrom = guestId; app.snapshotHasSeqProof = false;
        app.lastHostSeq = 0; app.state.strokes = [];
    }, guestId);
    const stroke = id => ({ id, color: '#171410', size: 4, pts: [[0.1, 0.2], [0.2, 0.3]] });
    const live = ['keep-this-live-postjoin-line'];
    for (let i = 0; i < 3; i += 1) {
        const after = await sendObserved(guest, late, {
            type: 'snapshot', strokes: [stroke('legacy-' + i)],
            chat: [{ name: 'OldVisitor', text: 'must-not-import-legacy-' + i, t: 1 }],
            lastHostSeq: 9e15, chunk: true, first: i === 0, done: i === 2
        }, 'legacy-' + i);
        expect(after.chat).toEqual(live);
        expect(after.strokes).toEqual(Array.from({ length: i + 1 }, (_, n) => 'legacy-' + n));
        expect(after.done).toBe(i === 2);
        expect(after.proof).toBe(false);
        expect(after.seq).toBe(0);
    }
    const proof = await host.evaluate(async seq => {
        const body = { kind: 'seq', seq };
        const bytes = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' },
            window.__hangout.hostPriv, new TextEncoder().encode(JSON.stringify(body))));
        let binary = ''; bytes.forEach(byte => { binary += String.fromCharCode(byte); });
        return { type: 'host', body, sig: btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') };
    }, oldClear.body.seq);
    for (let i = 0; i < 2; i += 1) {
        const after = await sendObserved(host, late, {
            type: 'snapshot', strokes: [stroke('verified-' + i)],
            chat: i === 0 ? [] : [{ name: 'OldVisitor', text: 'must-not-import-proof-chat', t: 1 }],
            lastHostSeqSigned: proof, chunk: true, first: i === 0, done: i === 1
        }, 'proof-' + i);
        expect(after.chat).toEqual(live);
        expect(after.strokes).toEqual(Array.from({ length: i + 1 }, (_, n) => 'verified-' + n));
        expect(after.from).toBe(hostId);
        expect(after.proof).toBe(true);
        expect(after.seq).toBe(oldClear.body.seq);
        expect(after.done).toBe(i === 1);
    }
    const afterReplay = await sendObserved(guest, late, oldClear, 'replayed-genuine-clear');
    expect(afterReplay.strokes).toEqual(['verified-0', 'verified-1']);
    expect(afterReplay.seq).toBe(oldClear.body.seq);
    await chatIs(late, live);
    // A new authentic action still works above the floor; rejection did not
    // merely disable all host messages or leave an unprocessed replay pending.
    await host.click('[data-clear]');
    await expect.poll(() => late.evaluate(() => window.__hangout.lastHostSeq)).toBeGreaterThan(oldClear.body.seq);
    await expect.poll(() => late.evaluate(() => window.__hangout.state.strokes.length)).toBe(0);
    await chatIs(late, live);
});

test('chat decryption finishing after socket close cannot refill the disconnected buffer', async ({ browser, baseURL }) => {
    const { host, invite } = await hostRoom(browser, baseURL);
    const guest = await visitor(browser, baseURL);
    await join(guest, invite, 'HistoryDecryptGuest');
    await completedSnapshot(guest, host);
    await say(host, 'received-before-disconnect');
    await chatIs(guest, ['received-before-disconnect']);
    await guest.clock.install({ time: new Date('2026-10-19T00:00:00Z') });
    await guest.clock.pauseAt(await guest.evaluate(() => new Date(Date.now() + 60_000).toISOString()));
    await guest.evaluate(() => {
        const open = window.HangoutCore.open;
        window.__historyHeld = { waiting: false, released: false };
        window.HangoutCore.open = async (...args) => {
            const message = await open(...args);
            if (message.type === 'chat' && message.text === 'decrypt-finishes-after-close' && !window.__historyHeld.waiting) {
                window.__historyHeld.waiting = true;
                await new Promise(resolve => {
                    window.__releaseHistoryDecrypt = () => { window.__historyHeld.released = true; resolve(); };
                });
            }
            return message;
        };
    });
    await say(host, 'decrypt-finishes-after-close');
    await expect.poll(() => guest.evaluate(() => window.__historyHeld.waiting)).toBe(true);
    const oldId = await guest.evaluate(() => window.__hangout.myId);
    await guest.evaluate(() => window.__hangout.ws.close());
    await expect.poll(() => guest.evaluate(() => window.__hangout.connected)).toBe(false);
    await chatIs(guest, []);
    await guest.evaluate(() => window.__releaseHistoryDecrypt());
    await expect.poll(() => guest.evaluate(() => window.__historyWire.received.some(entry =>
        entry.message.type === 'chat' && entry.message.text === 'decrypt-finishes-after-close'
    ))).toBe(true);
    expect(await guest.evaluate(() => window.__historyHeld.released)).toBe(true);
    expect(await guest.evaluate(() => window.__hangout.connected)).toBe(false);
    await chatIs(guest, []);
    await guest.clock.resume();
    await expect.poll(() => guest.evaluate(oldId => window.__hangout.connected && window.__hangout.myId !== oldId, oldId)).toBe(true);
    await say(host, 'live-on-the-new-connection');
    await chatIs(guest, ['live-on-the-new-connection']);
});
