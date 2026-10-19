const { randomUUID } = require('node:crypto');
// A departed peer's authentic hello must not supersede the returned host.
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const ROOT = '/r/45662413410ed051/';
const KEY = 'local-preview-key-0001';
const contexts = new Set(), pages = new Set();

test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium covers native host presence verification races');
test.afterEach(async () => {
    try {
        for (const page of pages) {
            expect(page.presenceErrors).toEqual([]);
            if (!page.isClosed()) expect(await page.evaluate(() => window.__presenceWire.errors)).toEqual([]);
        }
    } finally {
        await Promise.all([...contexts].map(context => context.close()));
        contexts.clear(); pages.clear();
    }
});

async function visitor(browser, baseURL) {
    const context = await browser.newContext();
    contexts.add(context);
    await context.route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL).origin
        ? route.continue() : route.abort());
    await context.addInitScript(() => {
        const wire = window.__presenceWire = { started: [], completed: [], sent: [], errors: [], hold: null };
        wire.arm = (from, request) => {
            let release;
            const gate = new Promise(resolve => { release = resolve; });
            wire.hold = { from, request, held: false, valid: null, returned: false, release, gate };
        };
        const verify = crypto.subtle.verify.bind(crypto.subtle);
        crypto.subtle.verify = async (...args) => {
            const valid = await verify(...args);
            let body;
            try { body = JSON.parse(new TextDecoder().decode(args[3])); }
            catch (_) { return valid; }
            const hold = wire.hold;
            if (hold && !hold.held && body.kind === 'hello' && body.from === hold.from && body.request === hold.request) {
                hold.held = true; hold.valid = valid;
                await hold.gate;
                hold.returned = true;
            }
            return valid;
        };
        const descriptor = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
        const callbacks = new WeakMap();
        Object.defineProperty(WebSocket.prototype, 'onmessage', {
            configurable: descriptor.configurable, enumerable: descriptor.enumerable,
            get() { return callbacks.get(this) || null; },
            set(callback) {
                callbacks.set(this, callback);
                descriptor.set.call(this, typeof callback === 'function' ? async function (event) {
                    let frame;
                    try { frame = JSON.parse(event.data); }
                    catch (_) { wire.errors.push('presence-envelope-observation-failed'); }
                    if (frame) wire.started.push({ iv: frame.iv, from: frame.from, left: frame.left });
                    await callback.call(this, event);
                    if (!frame) return;
                    try {
                        const app = window.__hangout;
                        const message = frame.c ? await window.HangoutCore.open(app.key, frame) : null;
                        wire.completed.push({ iv: frame.iv, from: frame.from, left: frame.left, message,
                            after: { host: app.knownHostId, request: app.snapshotRequest, fresh: app.snapshotFresh } });
                    } catch (_) { wire.errors.push('completed-presence-handler-observation-failed'); }
                } : callback);
            }
        });
        const send = WebSocket.prototype.send;
        WebSocket.prototype.send = function (data) {
            send.call(this, data);
            try {
                const frame = JSON.parse(data);
                if (!frame.c) return;
                void window.HangoutCore.open(window.__hangout.key, frame).then(message => {
                    wire.sent.push({ iv: frame.iv, message });
                }, () => wire.errors.push('outbound-presence-observation-failed'));
            } catch (_) { wire.errors.push('outbound-presence-envelope-observation-failed'); }
        };
    });
    const page = await context.newPage();
    pages.add(page); page.presenceErrors = [];
    page.on('pageerror', error => page.presenceErrors.push(error.message));
    return page;
}

async function join(page, url, name) {
    await page.goto(url);
    await page.fill('[data-name]', name);
    await page.click('[data-enter]');
    await expect.poll(() => page.evaluate(() => window.__hangout.connected)).toBe(true);
}

async function freshHostCut(guest, from) {
    await expect.poll(() => guest.evaluate(from => window.__presenceWire.completed.some(entry => entry.from === from
        && entry.message?.type === 'snapshot' && entry.message.to === window.__hangout.myId
        && entry.message.request === window.__hangout.snapshotRequest
        && entry.message.lastHostSeqSigned?.body.kind === 'snapshot' && entry.after.fresh), from)).toBe(true);
    expect(await guest.evaluate(from => window.__hangout.knownHostId === from && window.__hangout.snapshotFresh, from)).toBe(true);
}

test('a held valid hello from the departed host cannot replace its fresh returned identity', async ({ browser, baseURL }) => {
    const host = await visitor(browser, baseURL);
    await join(host, ROOT + '?preview=' + KEY + '&relay=' + encodeURIComponent(hangoutRelayWsBase(baseURL, 'private-recovery-' + randomUUID())), 'PresenceHost');
    const guest = await visitor(browser, baseURL);
    await join(guest, host.url(), 'PresenceGuest');
    const original = await host.evaluate(() => ({ from: window.__hangout.myId, request: window.__hangout.snapshotRequest }));
    await freshHostCut(guest, original.from);
    const guestId = await guest.evaluate(() => window.__hangout.myId);
    const priorRequest = await guest.evaluate(() => window.__hangout.snapshotRequest);
    await expect.poll(() => host.evaluate(({ original, guestId }) => window.__presenceWire.sent.some(entry =>
        entry.message.type === 'hello' && entry.message.to === guestId
        && entry.message.hostHello?.body.from === original.from
        && entry.message.hostHello.body.request === original.request
    ), { original, guestId })).toBe(true);
    const hello = await host.evaluate(({ original, guestId }) => window.__presenceWire.sent.find(entry =>
        entry.message.type === 'hello' && entry.message.to === guestId
        && entry.message.hostHello?.body.from === original.from
        && entry.message.hostHello.body.request === original.request).message, { original, guestId });
    expect(hello.reply).toBe(true);
    await guest.evaluate(original => window.__presenceWire.arm(original.from, original.request), original);
    const sentBefore = await host.evaluate(() => window.__presenceWire.sent.length);
    // Resend the real source-generated hello through its ordinary encryption
    // and pacing path. Only native verification of this original identity waits;
    // the returned host's different relay ID and nonce remain unrestricted.
    await host.evaluate(hello => window.__hangoutSend(hello), hello);
    await expect.poll(() => guest.evaluate(() => window.__presenceWire.hold.held)).toBe(true);
    expect(await guest.evaluate(() => window.__presenceWire.hold.valid)).toBe(true);
    await expect.poll(() => host.evaluate(({ sentBefore, original }) => window.__presenceWire.sent.slice(sentBefore).some(entry =>
        entry.message.type === 'hello' && entry.message.hostHello?.body.from === original.from
        && entry.message.hostHello.body.request === original.request
    ), { sentBefore, original })).toBe(true);
    const heldIv = await host.evaluate(({ sentBefore, original }) => window.__presenceWire.sent.slice(sentBefore).find(entry =>
        entry.message.type === 'hello' && entry.message.hostHello?.body.from === original.from
        && entry.message.hostHello.body.request === original.request).iv, { sentBefore, original });
    expect(await guest.evaluate(iv => window.__presenceWire.started.some(entry => entry.iv === iv), heldIv)).toBe(true);
    expect(await guest.evaluate(iv => window.__presenceWire.completed.some(entry => entry.iv === iv), heldIv)).toBe(false);

    await host.evaluate(async () => {
        const ws = window.__hangout.ws;
        await new Promise(resolve => { ws.addEventListener('close', resolve, { once: true }); ws.close(3000); });
    });
    await expect.poll(() => guest.evaluate(from => window.__presenceWire.completed.some(entry => entry.left === from), original.from)).toBe(true);
    await expect.poll(() => host.evaluate(from => window.__hangout.connected && window.__hangout.myId !== from, original.from),
        { timeout: 15000 }).toBe(true);
    const returnedId = await host.evaluate(() => window.__hangout.myId);
    await freshHostCut(guest, returnedId);
    const returnedRequest = await guest.evaluate(() => window.__hangout.snapshotRequest);
    expect(returnedRequest).not.toBe(priorRequest);
    expect(await guest.evaluate(() => window.__hangout.myId)).toBe(guestId);

    await guest.evaluate(() => window.__presenceWire.hold.release());
    // This observes completion of that exact ciphertext's original async
    // websocket handler, after native verification has actually returned.
    await expect.poll(() => guest.evaluate(iv => window.__presenceWire.completed.some(entry => entry.iv === iv), heldIv)).toBe(true);
    expect(await guest.evaluate(() => window.__presenceWire.hold.returned)).toBe(true);
    const after = await guest.evaluate(iv => window.__presenceWire.completed.find(entry => entry.iv === iv).after, heldIv);
    expect(after).toEqual({ host: returnedId, request: returnedRequest, fresh: true });
    expect(await guest.evaluate(() => ({ host: window.__hangout.knownHostId, request: window.__hangout.snapshotRequest,
        fresh: window.__hangout.snapshotFresh }))).toEqual(after);

    await host.fill('[data-text]', 'The returned host is still here');
    await host.press('[data-text]', 'Enter');
    await expect(guest.locator('[data-log]')).toContainText('The returned host is still here');
    await guest.fill('[data-text]', 'The existing guest is still here too');
    await guest.press('[data-text]', 'Enter');
    await expect(host.locator('[data-log]')).toContainText('The existing guest is still here too');
    await host.locator('[data-canvas]').scrollIntoViewIfNeeded();
    const box = await host.locator('[data-canvas]').boundingBox();
    await host.mouse.move(box.x + 35, box.y + 35);
    await host.mouse.down();
    await host.mouse.move(box.x + 125, box.y + 90, { steps: 6 });
    await host.mouse.up();
    const strokes = await host.evaluate(() => window.__hangout.state.strokes.map(window.HangoutCore.cleanSnapshotStroke));
    expect(strokes).toHaveLength(1);
    await expect.poll(() => guest.evaluate(() => window.__hangout.state.strokes)).toEqual(strokes);
    expect(await guest.evaluate(() => window.__hangout.knownHostId)).toBe(returnedId);
    expect(await guest.evaluate(() => window.__hangout.snapshotRequest)).toBe(returnedRequest);
});
