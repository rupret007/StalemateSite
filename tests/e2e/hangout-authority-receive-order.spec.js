const { randomUUID } = require('node:crypto');
// Relay arrival order must survive native decryption and signature verification.
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const ROOT = '/r/45662413410ed051/';
const KEY = 'local-preview-key-0001';
const contexts = new Set(), pages = new Set();
test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium covers native authority receive ordering');
test.afterEach(async () => {
    try {
        for (const page of pages) {
            expect(page.receiveErrors).toEqual([]);
            if (!page.isClosed()) expect(await page.evaluate(() => window.__receiveWire.errors)).toEqual([]);
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
        const wire = window.__receiveWire = { arrived: [], completed: [], errors: [] };
        const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
        const bytes = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
        const descriptor = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
        const callbacks = new WeakMap();
        Object.defineProperty(WebSocket.prototype, 'onmessage', {
            configurable: descriptor.configurable, enumerable: descriptor.enumerable,
            get() { return callbacks.get(this) || null; },
            set(callback) {
                callbacks.set(this, callback);
                descriptor.set.call(this, typeof callback === 'function' ? async function (event) {
                    const frame = JSON.parse(event.data);
                    // This independent native observer does not wait on the app's
                    // held crypto continuation or change the frame it receives.
                    const observation = frame.c ? decrypt({ name: 'AES-GCM', iv: bytes(frame.iv) },
                        window.__hangout.key, bytes(frame.c)).then(data => {
                        const message = JSON.parse(new TextDecoder().decode(data));
                        wire.arrived.push({ message, from: frame.from });
                        return message;
                    }, () => { wire.errors.push('native-arrival-observation-failed'); return null; }) : null;
                    await callback.call(this, event);
                    if (observation) {
                        const message = await observation;
                        if (message) wire.completed.push({ message, from: frame.from });
                    }
                } : callback);
            }
        });
    });
    const page = await context.newPage();
    pages.add(page); page.receiveErrors = [];
    page.on('pageerror', error => page.receiveErrors.push(error.message));
    return page;
}

async function join(page, url, name) {
    await page.goto(url);
    await page.fill('[data-name]', name);
    await page.click('[data-enter]');
    await expect.poll(() => page.evaluate(() => window.__hangout.connected)).toBe(true);
}

async function pair(browser, baseURL) {
    const host = await visitor(browser, baseURL);
    await join(host, ROOT + '?preview=' + KEY + '&relay=' + encodeURIComponent(hangoutRelayWsBase(baseURL, 'private-recovery-' + randomUUID())), 'ReceiveHost');
    const guest = await visitor(browser, baseURL);
    await join(guest, host.url(), 'ReceiveGuest');
    const from = await host.evaluate(() => window.__hangout.myId);
    await expect.poll(() => guest.evaluate(from => window.__receiveWire.completed.some(entry => entry.from === from
        && entry.message.type === 'snapshot' && entry.message.to === window.__hangout.myId
        && entry.message.done === true), from)).toBe(true);
    await expect.poll(() => guest.evaluate(() => window.__hangout.snapshotHasSeqProof)).toBe(true);
    return { host, guest };
}

async function shortStroke(page, x) {
    await page.locator('[data-canvas]').scrollIntoViewIfNeeded();
    await page.locator('[data-canvas]').click({ position: { x, y: 30 } });
}

async function holdClear(guest, stage) {
    await guest.evaluate(stage => {
        const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
        const verify = crypto.subtle.verify.bind(crypto.subtle);
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        const held = window.__receiveHeld = { stage, held: false, valid: null, seq: null,
            returned: false, decrypted: [], applied: [], release };
        const parse = data => { try { return JSON.parse(new TextDecoder().decode(data)); } catch (_) { return null; } };
        crypto.subtle.decrypt = async (...args) => {
            const data = await decrypt(...args), message = parse(data);
            if (message?.type === 'host') {
                held.decrypted.push({ kind: message.body.kind, seq: message.body.seq });
                if (stage === 'decrypt' && !held.held && message.body.kind === 'clear') {
                    held.valid = await verify({ name: 'ECDSA', hash: 'SHA-256' }, window.__hangout.hostPub,
                        Uint8Array.from(atob(message.sig.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)),
                        new TextEncoder().encode(JSON.stringify(message.body)));
                    held.held = true; held.seq = message.body.seq;
                    await gate;
                    held.returned = true;
                }
            }
            return data;
        };
        crypto.subtle.verify = async (...args) => {
            const valid = await verify(...args), body = parse(args[3]);
            if (stage === 'verify' && !held.held && body?.kind === 'clear') {
                held.held = true; held.valid = valid; held.seq = body.seq;
                await gate;
                held.returned = true;
            }
            return valid;
        };
        const apply = window.HangoutCore.apply;
        window.HangoutCore.apply = function (state, message, ...rest) {
            const result = apply.call(this, state, message, ...rest);
            if (state === window.__hangout.state && message.type === 'clear') {
                held.applied.push({ kind: 'clear', epoch: window.__hangout.drawingEpoch });
            }
            return result;
        };
        const lock = document.querySelector('[data-lock]'), setAttribute = lock.setAttribute;
        lock.setAttribute = function (name, value) {
            const result = setAttribute.call(this, name, value);
            if (name === 'aria-pressed') held.applied.push({ kind: 'lock', on: value === 'true',
                epoch: window.__hangout.drawingEpoch });
            return result;
        };
    }, stage);
}

for (const stage of ['verify', 'decrypt']) {
    test(`a held native clear ${stage} cannot let a later lock overtake it`, async ({ browser, baseURL }) => {
        const { host, guest } = await pair(browser, baseURL);
        await shortStroke(host, 30);
        const before = await host.evaluate(() => structuredClone(window.__hangout.state.strokes));
        expect(before).toHaveLength(1);
        await expect.poll(() => guest.evaluate(() => window.__hangout.state.strokes)).toEqual(before);
        await holdClear(guest, stage);
        try {
            await host.click('[data-clear]');
            await expect.poll(() => guest.evaluate(() => window.__receiveHeld.held)).toBe(true);
            expect(await guest.evaluate(() => window.__receiveHeld.valid)).toBe(true);
            await host.click('[data-lock]');
            await expect.poll(() => host.evaluate(() => window.__hangout.av.locked)).toBe(true);
            const lockSeq = await host.evaluate(() => window.__hangout.av.mods.lock.body.seq);
            const clearSeq = await guest.evaluate(() => window.__receiveHeld.seq);
            expect(lockSeq).toBeGreaterThan(clearSeq);
            await expect.poll(() => guest.evaluate(seq => window.__receiveWire.arrived.some(entry =>
                entry.message.type === 'host' && entry.message.body.kind === 'lock' && entry.message.body.seq === seq), lockSeq)).toBe(true);
            // The later frame's actual application decrypt has completed too.
            // A receive queue installed only after H.open misses the second case.
            await expect.poll(() => guest.evaluate(seq => window.__receiveHeld.decrypted.some(item =>
                item.kind === 'lock' && item.seq === seq), lockSeq)).toBe(true);
            await shortStroke(host, 90);
            const after = await host.evaluate(() => structuredClone(window.__hangout.state.strokes));
            expect(after).toHaveLength(1);
            expect(after[0].id).not.toBe(before[0].id);
            await host.fill('[data-text]', 'Chat stays live while authority waits');
            await host.press('[data-text]', 'Enter');
            await expect.poll(() => guest.evaluate(() => window.__hangout.state.chat.some(item =>
                item.text === 'Chat stays live while authority waits'))).toBe(true);
            expect(await guest.evaluate(() => window.__receiveHeld.returned)).toBe(false);
            expect(await guest.evaluate(() => window.__hangout.av.locked)).toBe(false);
            expect(await guest.evaluate(() => window.__receiveHeld.applied)).toEqual([]);
            expect(await guest.evaluate(() => window.__hangout.state.strokes)).toEqual(before);
        } finally {
            await guest.evaluate(() => window.__receiveHeld.release());
        }
        await expect.poll(() => guest.evaluate(() => window.__receiveHeld.returned)).toBe(true);
        await expect.poll(() => guest.evaluate(() => window.__hangout.av.locked)).toBe(true);
        const expected = await host.evaluate(() => structuredClone(window.__hangout.state.strokes));
        await expect.poll(() => guest.evaluate(() => window.__hangout.state.strokes)).toEqual(expected);
        const clearSeq = await guest.evaluate(() => window.__receiveHeld.seq);
        expect(await guest.evaluate(() => window.__receiveHeld.applied))
            .toEqual([{ kind: 'clear', epoch: clearSeq }, { kind: 'lock', on: true, epoch: clearSeq }]);
        expect(await guest.evaluate(() => window.__hangout.drawingEpoch)).toBe(clearSeq);
        expect(await guest.evaluate(() => window.__hangout.lastHostSeq))
            .toBe(await host.evaluate(() => window.__hangout.lastHostSeq));
    });
}
