const { randomUUID } = require('node:crypto');
// A later root action must not overtake an earlier action's signature/commit.
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const ROOT = '/r/45662413410ed051/';
const KEY = 'local-preview-key-0001';
const contexts = new Set(), pages = new Set();
test.use({ launchOptions: { args: ['--mute-audio'] } });
test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium covers native root action ordering');
test.afterEach(async () => {
    try {
        for (const page of pages) {
            expect(page.authorityErrors).toEqual([]);
            if (!page.isClosed()) expect(await page.evaluate(() => window.__authorityWire.errors)).toEqual([]);
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
        const wire = window.__authorityWire = { received: [], errors: [], signs: [], lockClicks: 0 };
        const descriptor = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
        const callbacks = new WeakMap();
        Object.defineProperty(WebSocket.prototype, 'onmessage', {
            configurable: descriptor.configurable, enumerable: descriptor.enumerable,
            get() { return callbacks.get(this) || null; },
            set(callback) {
                callbacks.set(this, callback);
                descriptor.set.call(this, typeof callback === 'function' ? async function (event) {
                    await callback.call(this, event);
                    try {
                        const frame = JSON.parse(event.data);
                        if (!frame.c) return;
                        const message = await window.HangoutCore.open(window.__hangout.key, frame);
                        wire.received.push({ message, from: frame.from, seqAfter: window.__hangout.lastHostSeq });
                    } catch (_) { wire.errors.push('completed-handler-observation-failed'); }
                } : callback);
            }
        });
    });
    const page = await context.newPage();
    pages.add(page); page.authorityErrors = [];
    page.on('pageerror', error => page.authorityErrors.push(error.message));
    return page;
}

async function join(page, url, name) {
    await page.goto(url);
    await page.fill('[data-name]', name);
    await page.click('[data-enter]');
    await expect.poll(() => page.evaluate(() => window.__hangout.connected)).toBe(true);
}

async function brushMark(page, x) {
    await page.locator('[data-canvas]').click({ position: { x, y: 40 } });
}

test('a held clear signature commits before a later UI lock action begins signing', async ({ browser, baseURL }) => {
    const host = await visitor(browser, baseURL);
    await join(host, ROOT + '?preview=' + KEY + '&relay=' + encodeURIComponent(hangoutRelayWsBase(baseURL, 'private-recovery-' + randomUUID())), 'OrderHost');
    await brushMark(host, 40);
    const original = await host.evaluate(() => window.__hangout.state.strokes.map(window.HangoutCore.cleanStroke));
    expect(original).toHaveLength(1);
    const guest = await visitor(browser, baseURL);
    await join(guest, host.url(), 'OrderGuest');
    const hostId = await host.evaluate(() => window.__hangout.myId);
    await expect.poll(() => guest.evaluate(from => window.__authorityWire.received.some(entry => entry.from === from
        && entry.message.type === 'snapshot' && entry.message.to === window.__hangout.myId && entry.message.done === true), hostId)).toBe(true);
    expect(await guest.evaluate(() => window.__hangout.state.strokes)).toEqual(original);
    await host.evaluate(() => {
        const sign = crypto.subtle.sign.bind(crypto.subtle);
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        const held = window.__authorityHeld = { held: false, seq: null, release };
        crypto.subtle.sign = async (...args) => {
            const body = JSON.parse(new TextDecoder().decode(args[2]));
            window.__authorityWire.signs.push(structuredClone(body));
            const result = await sign(...args);
            if (!held.held && body.kind === 'clear') {
                held.held = true; held.seq = body.seq;
                await gate;
            }
            return result;
        };
        // The document listener runs after the product's button listener. It
        // proves the ordinary visible lock request was actually dispatched.
        document.addEventListener('click', event => {
            if (event.target.closest('[data-lock]')) window.__authorityWire.lockClicks += 1;
        });
    });
    await host.click('[data-clear]');
    await expect.poll(() => host.evaluate(() => window.__authorityHeld.held)).toBe(true);
    const clearSeq = await host.evaluate(() => window.__authorityHeld.seq);
    expect(await guest.evaluate(() => window.__hangout.state.strokes)).toEqual(original);
    await host.click('[data-lock]');
    expect(await host.evaluate(() => window.__authorityWire.lockClicks)).toBe(1);
    await host.evaluate(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
        await new Promise(resolve => setTimeout(resolve, 0));
    });
    // Recording precedes the first native sign await. This detects overtaking
    // before crypto completion or relay timing could hide the ordering defect.
    expect(await host.evaluate(() => window.__authorityWire.signs.filter(body => body.kind === 'lock'))).toEqual([]);
    expect(await guest.evaluate(() => window.__hangout.av.locked)).toBe(false);
    await host.evaluate(() => window.__authorityHeld.release());
    await expect.poll(() => guest.evaluate(() => window.__hangout.av.locked)).toBe(true);
    await expect.poll(() => guest.evaluate(() => window.__hangout.state.strokes)).toEqual([]);
    await expect.poll(() => guest.evaluate(() => window.__authorityWire.received.filter(entry => entry.message.type === 'host'
        && ['clear', 'lock'].includes(entry.message.body.kind)).length)).toBe(2);
    const actions = await guest.evaluate(() => window.__authorityWire.received.filter(entry => entry.message.type === 'host'
        && ['clear', 'lock'].includes(entry.message.body.kind)).map(entry => ({ kind: entry.message.body.kind, seq: entry.message.body.seq })));
    expect(actions.map(action => action.kind)).toEqual(['clear', 'lock']);
    expect(actions[0].seq).toBe(clearSeq);
    expect(actions[1].seq).toBeGreaterThan(clearSeq);
    expect(await guest.evaluate(() => window.__hangout.lastHostSeq)).toBe(actions[1].seq);
    expect(await host.evaluate(() => window.__hangout.lastHostSeq)).toBe(actions[1].seq);
    await brushMark(host, 80);
    const fresh = await host.evaluate(() => window.__hangout.state.strokes.map(window.HangoutCore.cleanStroke));
    expect(fresh).toHaveLength(1);
    expect(fresh[0].id).not.toBe(original[0].id);
    await expect.poll(() => guest.evaluate(() => window.__hangout.state.strokes)).toEqual(fresh);
});
