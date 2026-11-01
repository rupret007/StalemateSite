const { randomUUID } = require('node:crypto');
// Native encryption and identity proofs must not outrun recovery/action commits.
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const ROOT = '/r/45662413410ed051/';
const KEY = 'local-preview-key-0001';
const contexts = new Set(), pages = new Set();
test.use({ launchOptions: { args: ['--mute-audio'] } });
test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium covers native relay/crypto recovery');
test.afterEach(async () => {
    try {
        for (const page of pages) {
            expect(page.inflightErrors).toEqual([]);
            if (!page.isClosed()) expect(await page.evaluate(() => window.__inflightWire.errors)).toEqual([]);
        }
    } finally {
        await Promise.all([...contexts].map(context => context.close()));
        contexts.clear(); pages.clear();
    }
});

async function visitor(browser, baseURL) {
    const context = await browser.newContext();
    contexts.add(context);
    // Neither case needs a media provider or capture permissions.
    await context.route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL).origin
        ? route.continue() : route.abort());
    await context.addInitScript(() => {
        const wire = window.__inflightWire = { sockets: 0, received: [], sent: [], errors: [] };
        const descriptor = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
        const callbacks = new WeakMap(), generations = new WeakMap();
        Object.defineProperty(WebSocket.prototype, 'onmessage', {
            configurable: descriptor.configurable, enumerable: descriptor.enumerable,
            get() { return callbacks.get(this) || null; },
            set(callback) {
                callbacks.set(this, callback);
                if (!generations.has(this)) generations.set(this, ++wire.sockets);
                descriptor.set.call(this, typeof callback === 'function' ? async function (event) {
                    await callback.call(this, event);
                    try {
                        const frame = JSON.parse(event.data);
                        if (!frame.c) return;
                        const message = await window.HangoutCore.open(window.__hangout.key, frame);
                        wire.received.push({ message, cipher: frame.c, from: frame.from, generation: generations.get(this) });
                    } catch (_) { wire.errors.push('completed-handler-observation-failed'); }
                } : callback);
            }
        });
        const send = WebSocket.prototype.send;
        WebSocket.prototype.send = function (data) {
            send.call(this, data);
            const frame = JSON.parse(data);
            if (!frame.c) return;
            void window.HangoutCore.open(window.__hangout.key, frame).then(message => {
                wire.sent.push({ message, cipher: frame.c });
            }, () => wire.errors.push('outbound-observation-failed'));
        };
    });
    const page = await context.newPage();
    pages.add(page); page.inflightErrors = [];
    page.on('pageerror', error => page.inflightErrors.push(error.message));
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
    await join(host, ROOT + '?preview=' + KEY + '&relay=' + encodeURIComponent(hangoutRelayWsBase(baseURL, 'private-recovery-' + randomUUID())), 'InflightHost');
    const guest = await visitor(browser, baseURL);
    await join(guest, host.url(), 'InflightGuest');
    await expect.poll(() => guest.evaluate(() => window.__hangout.snapshotFresh)).toBe(true);
    return { host, guest };
}

async function shortStroke(page) {
    await page.locator('[data-canvas]').scrollIntoViewIfNeeded();
    // A valid single-point brush mark flushes only on pointerup. There is no
    // assumption that a series of mouse moves completes before the 120ms timer.
    await page.locator('[data-canvas]').click({ position: { x: 30, y: 30 } });
}

test('a stroke whose native encryption spans reconnect survives the fresh snapshot and arrives exactly once', async ({ browser, baseURL }) => {
    const { host, guest } = await pair(browser, baseURL);
    await guest.evaluate(() => {
        const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        const held = window.__inflightStroke = { held: false, returned: false, message: null, cipher: null, release };
        crypto.subtle.encrypt = async (...args) => {
            let message;
            try { message = JSON.parse(new TextDecoder().decode(args[2])); } catch (_) { return encrypt(...args); }
            const result = await encrypt(...args);
            if (!held.held && args[0].name === 'AES-GCM' && message.type === 'stroke') {
                held.held = true; held.message = structuredClone(message);
                let text = ''; new Uint8Array(result).forEach(value => { text += String.fromCharCode(value); });
                held.cipher = btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
                await gate;
                held.returned = true;
            }
            return result;
        };
    });
    await shortStroke(guest);
    await expect.poll(() => guest.evaluate(() => window.__inflightStroke.held)).toBe(true);
    const held = await guest.evaluate(() => ({ message: window.__inflightStroke.message, cipher: window.__inflightStroke.cipher }));
    const expected = await guest.evaluate(() => window.__hangout.state.strokes.map(window.HangoutCore.cleanSnapshotStroke));
    expect(expected).toHaveLength(1);
    expect(expected[0]).toEqual(held.message.stroke);
    expect(await host.evaluate(() => window.__hangout.state.strokes)).toEqual([]);
    const oldId = await guest.evaluate(async () => {
        const app = window.__hangout, id = app.myId;
        await new Promise(resolve => { app.ws.addEventListener('close', resolve, { once: true }); app.ws.close(3000); });
        return id;
    });
    await expect.poll(() => guest.evaluate(oldId => window.__hangout.connected && window.__hangout.myId !== oldId, oldId),
        { timeout: 15000 }).toBe(true);
    // The actual new host snapshot has committed before the original native
    // encryption promise returns. It contains no copy of the held local stroke.
    await expect.poll(() => guest.evaluate(() => window.__hangout.snapshotFresh && window.__inflightWire.received.some(entry =>
        entry.generation === 2 && entry.message.type === 'snapshot' && entry.message.done === true
        && entry.message.to === window.__hangout.myId && entry.message.request === window.__hangout.snapshotRequest
    ))).toBe(true);
    const fresh = await guest.evaluate(() => window.__inflightWire.received.find(entry => entry.generation === 2
        && entry.message.type === 'snapshot' && entry.message.done === true && entry.message.to === window.__hangout.myId));
    expect(fresh.message.strokes).toEqual([]);
    expect(await guest.evaluate(() => window.__inflightStroke.returned)).toBe(false);
    expect(await guest.evaluate(() => window.__hangout.state.strokes)).toEqual(expected);
    await guest.evaluate(() => window.__inflightStroke.release());
    await expect.poll(() => host.evaluate(id => window.__inflightWire.received.filter(entry =>
        entry.message.type === 'stroke' && entry.message.stroke.id === id).length, held.message.stroke.id)).toBe(1);
    await expect.poll(() => guest.evaluate(cipher => window.__inflightWire.sent.some(entry => entry.cipher === cipher), held.cipher)).toBe(true);
    expect(await guest.evaluate(() => window.__inflightStroke.returned)).toBe(true);
    // A normal chat message is an ordered egress fence behind the delivered
    // original ciphertext, rather than an arbitrary time delay for duplicates.
    await guest.fill('[data-text]', 'After the pending drawing');
    await guest.press('[data-text]', 'Enter');
    await expect.poll(() => host.evaluate(() => window.__inflightWire.received.some(entry =>
        entry.message.type === 'chat' && entry.message.text === 'After the pending drawing'))).toBe(true);
    await expect.poll(() => guest.evaluate(() => window.__hangoutPace.queue.length)).toBe(0);
    const receipts = await host.evaluate(id => window.__inflightWire.received.filter(entry =>
        entry.message.type === 'stroke' && entry.message.stroke.id === id), held.message.stroke.id);
    expect(receipts).toHaveLength(1);
    expect(receipts[0].cipher).toBe(held.cipher);
    expect(await guest.evaluate(() => window.__hangout.state.strokes)).toEqual(expected);
    expect(await host.evaluate(() => window.__hangout.state.strokes)).toEqual(expected);
});

test('an identity hello cannot consume the sequence of a pending genuine host action', async ({ browser, baseURL }) => {
    const { host, guest } = await pair(browser, baseURL);
    await host.evaluate(() => {
        const sign = crypto.subtle.sign.bind(crypto.subtle);
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        const held = window.__inflightLock = { held: false, seq: null, release };
        crypto.subtle.sign = async (...args) => {
            const body = JSON.parse(new TextDecoder().decode(args[2]));
            const result = await sign(...args);
            if (!held.held && body.kind === 'lock') {
                held.held = true; held.seq = body.seq;
                await gate;
            }
            return result;
        };
    });
    const floor = await guest.evaluate(() => window.__hangout.lastHostSeq);
    await host.click('[data-lock]');
    await expect.poll(() => host.evaluate(() => window.__inflightLock.held)).toBe(true);
    const reserved = await host.evaluate(() => window.__inflightLock.seq);
    expect(reserved).toBeGreaterThan(floor);
    expect(await host.evaluate(() => window.__hangout.lastHostSeq)).toBe(reserved);
    expect(await guest.evaluate(() => window.__hangout.av.locked)).toBe(false);
    const before = await guest.evaluate(() => window.__inflightWire.received.length);
    await guest.evaluate(async () => {
        const app = window.__hangout;
        app.ws.send(JSON.stringify(await window.HangoutCore.seal(app.key, { type: 'hello', name: app.name,
            av: { mic: false, cam: false }, protocol: 2, snapshotRequest: app.snapshotRequest })));
    });
    await expect.poll(() => guest.evaluate(before => window.__inflightWire.received.slice(before).some(entry =>
        entry.message.type === 'hello' && entry.message.hostHello?.body.kind === 'hello'), before)).toBe(true);
    const identity = await guest.evaluate(before => window.__inflightWire.received.slice(before).find(entry =>
        entry.message.type === 'hello' && entry.message.hostHello?.body.kind === 'hello').message.hostHello, before);
    expect(identity.body).not.toHaveProperty('seq');
    expect(await guest.evaluate(() => window.__hangout.lastHostSeq)).toBe(floor);
    const to = await guest.evaluate(() => window.__hangout.myId);
    const valid = await host.evaluate(async ({ identity, reserved, to }) => {
        const app = window.__hangout;
        // A legacy identity proof is genuinely signed, but is not a host action.
        // Signing it must not reserve or advance another application sequence.
        const body = { ...identity.body, seq: reserved };
        const data = new TextEncoder().encode(JSON.stringify(body));
        const bytes = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, app.hostPriv, data));
        const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, app.hostPub, bytes, data);
        let text = ''; bytes.forEach(value => { text += String.fromCharCode(value); });
        const action = { type: 'host', to, body, sig: btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') };
        app.ws.send(JSON.stringify(await window.HangoutCore.seal(app.key, action)));
        return valid;
    }, { identity, reserved, to });
    expect(valid).toBe(true);
    expect(await host.evaluate(() => window.__hangout.lastHostSeq)).toBe(reserved);
    await expect.poll(() => guest.evaluate(reserved => window.__inflightWire.received.some(entry =>
        entry.message.type === 'host' && entry.message.body.kind === 'hello' && entry.message.body.seq === reserved), reserved)).toBe(true);
    expect(await guest.evaluate(() => window.__hangout.lastHostSeq)).toBe(floor);
    expect(await guest.evaluate(() => window.__hangout.av.locked)).toBe(false);
    await host.evaluate(() => window.__inflightLock.release());
    await expect.poll(() => guest.evaluate(() => window.__hangout.av.locked)).toBe(true);
    expect(await guest.evaluate(() => window.__hangout.lastHostSeq)).toBe(reserved);
    expect(await guest.evaluate(() => window.__hangout.av.mods.lock.body.seq)).toBe(reserved);
});
