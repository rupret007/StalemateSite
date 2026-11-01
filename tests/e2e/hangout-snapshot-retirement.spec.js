const { randomUUID } = require('node:crypto');
// A barrier that already includes live presence must wake when that identity retires.
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const ROOT = '/r/45662413410ed051/';
const KEY = 'local-preview-key-0001';
const contexts = new Set(), pages = new Set();
test.use({ launchOptions: { args: ['--mute-audio'] } });
test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium covers native snapshot retirement');
test.afterEach(async () => {
    try {
        for (const page of pages) {
            expect(page.retirementErrors).toEqual([]);
            if (!page.isClosed()) expect(await page.evaluate(() => window.__retirementWire.errors)).toEqual([]);
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
        const wire = window.__retirementWire = { received: [], left: [], errors: [], captureIdentity: false,
            identityTask: null, identityCompleted: false, barrierStarted: false };
        const settled = Promise.allSettled.bind(Promise);
        Promise.allSettled = iterable => {
            const tasks = [...iterable];
            // Pass through the real native combinator. Record the actual
            // snapshot barrier consuming this exact held onRelay task.
            if (wire.identityTask && tasks.includes(wire.identityTask)) wire.barrierStarted = true;
            return settled(tasks);
        };
        const descriptor = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
        const callbacks = new WeakMap();
        Object.defineProperty(WebSocket.prototype, 'onmessage', {
            configurable: descriptor.configurable, enumerable: descriptor.enumerable,
            get() { return callbacks.get(this) || null; },
            set(callback) {
                callbacks.set(this, callback);
                descriptor.set.call(this, typeof callback === 'function' ? async function (event) {
                    const task = callback.call(this, event);
                    const frame = JSON.parse(event.data);
                    if (frame.c) {
                        void window.HangoutCore.open(window.__hangout.key, frame).then(message => {
                            if (wire.captureIdentity && !wire.identityTask && message.type === 'hello' && message.hostHello?.body.kind === 'hello') {
                                wire.identityTask = task;
                            }
                        }, () => wire.errors.push('pending-handler-observation-failed'));
                    }
                    await task;
                    if (task === wire.identityTask) wire.identityCompleted = true;
                    try {
                        if (frame.left) wire.left.push(frame.left);
                        if (!frame.c) return;
                        const message = await window.HangoutCore.open(window.__hangout.key, frame);
                        wire.received.push({ message, from: frame.from });
                    } catch (_) { wire.errors.push('completed-handler-observation-failed'); }
                } : callback);
            }
        });
    });
    const page = await context.newPage();
    pages.add(page); page.retirementErrors = [];
    page.on('pageerror', error => page.retirementErrors.push(error.message));
    return page;
}

async function join(page, url, name) {
    await page.goto(url);
    await page.fill('[data-name]', name);
    await page.click('[data-enter]');
    await expect.poll(() => page.evaluate(() => window.__hangout.connected)).toBe(true);
}

test('an already waiting snapshot barrier releases retired presence while its native verification stays held', async ({ browser, baseURL }) => {
    const host = await visitor(browser, baseURL);
    await join(host, ROOT + '?preview=' + KEY + '&relay=' + encodeURIComponent(hangoutRelayWsBase(baseURL, 'private-recovery-' + randomUUID())), 'RetirementHost');
    await host.locator('[data-canvas]').click({ position: { x: 40, y: 40 } });
    const drawing = await host.evaluate(() => window.__hangout.state.strokes.map(window.HangoutCore.cleanSnapshotStroke));
    expect(drawing).toHaveLength(1);
    const invite = host.url();
    const hostId = await host.evaluate(() => window.__hangout.myId);
    const observer = await visitor(browser, baseURL);
    await join(observer, invite, 'RetirementObserver');
    await expect.poll(() => observer.evaluate(() => window.__hangout.snapshotFresh)).toBe(true);
    expect(await observer.evaluate(() => window.__hangout.state.strokes)).toEqual(drawing);
    const observerId = await observer.evaluate(() => window.__hangout.myId);
    await observer.clock.install();
    await observer.clock.pauseAt(await observer.evaluate(() => new Date(Date.now() + 1000).toISOString()));
    await observer.evaluate(hostId => {
        const verify = crypto.subtle.verify.bind(crypto.subtle);
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        const held = window.__retirementHeld = { held: false, valid: null, returned: false, release };
        window.__retirementWire.captureIdentity = true;
        crypto.subtle.verify = async (...args) => {
            const valid = await verify(...args);
            let body;
            try { body = JSON.parse(new TextDecoder().decode(args[3])); } catch (_) { return valid; }
            if (!held.held && body.kind === 'hello' && body.from === hostId) {
                held.held = true; held.valid = valid;
                await gate;
                held.returned = true;
            }
            return valid;
        };
    }, hostId);
    await observer.evaluate(async () => {
        const app = window.__hangout;
        app.ws.send(JSON.stringify(await window.HangoutCore.seal(app.key, { type: 'hello', name: app.name,
            av: { mic: false, cam: false }, protocol: 2, snapshotRequest: app.snapshotRequest })));
    });
    await expect.poll(() => observer.evaluate(() => window.__retirementHeld.held && Boolean(window.__retirementWire.identityTask))).toBe(true);
    expect(await observer.evaluate(() => window.__retirementHeld.valid)).toBe(true);
    await host.evaluate(observerId => {
        const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        const held = window.__retirementSnapshot = { held: false, to: null, release };
        crypto.subtle.encrypt = async (...args) => {
            const message = JSON.parse(new TextDecoder().decode(args[2]));
            const result = await encrypt(...args);
            if (message.type === 'snapshot' && message.to !== observerId) {
                held.held = true; held.to = message.to;
                await gate;
            }
            return result;
        };
    }, observerId);
    const third = await visitor(browser, baseURL);
    await join(third, invite, 'RetirementThird');
    const thirdId = await third.evaluate(() => window.__hangout.myId);
    await expect.poll(() => observer.evaluate(thirdId => window.__retirementWire.received.some(entry =>
        entry.from === thirdId && entry.message.type === 'hello' && !entry.message.reply), thirdId)).toBe(true);
    await expect.poll(() => host.evaluate(thirdId => window.__retirementSnapshot.held && window.__retirementSnapshot.to === thirdId, thirdId)).toBe(true);
    // Run the real peer snapshot's 150–550ms scheduling window, then require
    // the exact live old-hello task to be inside the actual native barrier.
    await observer.clock.runFor(600);
    await expect.poll(() => observer.evaluate(() => window.__retirementWire.barrierStarted)).toBe(true);
    expect(await observer.evaluate(() => window.__retirementWire.left)).not.toContain(hostId);
    expect(await observer.evaluate(() => window.__retirementHeld.returned)).toBe(false);
    expect(await third.evaluate(() => window.__hangout.state.strokes)).toEqual([]);
    // Closing the owned host page prevents automatic relay reconnect. Its
    // fresh response was never sent, so only the observer's fallback can help.
    await host.close();
    await expect.poll(() => observer.evaluate(hostId => window.__retirementWire.left.includes(hostId), hostId)).toBe(true);
    await expect.poll(() => third.evaluate(from => window.__retirementWire.received.some(entry => entry.from === from
        && entry.message.type === 'snapshot' && entry.message.to === window.__hangout.myId
        && entry.message.request === window.__hangout.snapshotRequest && entry.message.done === true), observerId)).toBe(true);
    expect(await observer.evaluate(() => window.__retirementHeld.returned)).toBe(false);
    expect(await third.evaluate(() => window.__hangout.state.strokes)).toEqual(drawing);
    expect(await third.evaluate(() => window.__hangout.snapshotFresh)).toBe(false);
    // Complete the obsolete valid work and its real handler as a final fence;
    // it must not undo the already delivered peer fallback.
    await observer.evaluate(() => window.__retirementHeld.release());
    await expect.poll(() => observer.evaluate(() => window.__retirementHeld.returned)).toBe(true);
    await expect.poll(() => observer.evaluate(() => window.__retirementWire.identityCompleted)).toBe(true);
    expect(await third.evaluate(() => window.__hangout.state.strokes)).toEqual(drawing);
});
