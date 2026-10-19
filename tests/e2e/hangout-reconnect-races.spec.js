const { randomUUID } = require('node:crypto');
// Valid crypto work from an obsolete relay membership must not mutate its replacement.
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const ROOT = '/r/45662413410ed051/';
const KEY = 'local-preview-key-0001';
const FIRST = 'BtnyqIHTDMM';
const SECOND = 'Dws9G6UFyUQ';
const THIRD = 'oh5p5f5_-7A';
const FAKE_YT = path.join(__dirname, 'support/fake-youtube.js');
const contexts = new Set(), pages = new Set();
test.use({ launchOptions: { args: ['--mute-audio'] } });
test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium covers native relay/crypto races');
test.afterEach(async () => {
    try {
        for (const page of pages) {
            expect(page.raceErrors).toEqual([]);
            if (!page.isClosed()) expect(await page.evaluate(() => window.__raceWire.errors)).toEqual([]);
        }
    } finally {
        await Promise.all([...contexts].map(context => context.close()));
        contexts.clear(); pages.clear();
    }
});

async function visitor(browser, baseURL) {
    const context = await browser.newContext();
    contexts.add(context);
    await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.href === 'https://www.youtube.com/iframe_api') return route.fulfill({ path: FAKE_YT, contentType: 'text/javascript' });
        return url.origin === new URL(baseURL).origin ? route.continue() : route.abort();
    });
    await context.addInitScript(() => {
        const wire = window.__raceWire = { sockets: 0, received: [], sent: [], errors: [], signs: [] };
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
                        wire.received.push({ message, from: frame.from, generation: generations.get(this) });
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
                wire.sent.push(message);
            }, () => wire.errors.push('outbound-observation-failed'));
        };
    });
    const page = await context.newPage();
    pages.add(page); page.raceErrors = [];
    page.on('pageerror', error => page.raceErrors.push(error.message));
    return page;
}

async function join(page, url, name) {
    await page.goto(url);
    await page.fill('[data-name]', name);
    await page.click('[data-enter]');
    await expect.poll(() => page.evaluate(() => window.__hangout.connected)).toBe(true);
}

async function chooseVideo(host, id) {
    await host.click(`[data-pick-yt="${id}"]`);
    await expect(host.locator('[data-fake-yt]')).toHaveAttribute('data-video-id', id);
    await expect(host.locator('[data-fake-yt]')).toHaveAttribute('data-state', 'playing');
    await host.evaluate(() => window.__ytLog.at(-1).pauseVideo());
    await expect.poll(() => host.evaluate(() => window.__hangout.state.video?.playing)).toBe(false);
    return host.evaluate(() => window.__hangout.state.video);
}

async function drawLine(page, offset = 0) {
    await page.locator('[data-canvas]').scrollIntoViewIfNeeded();
    const box = await page.locator('[data-canvas]').boundingBox();
    const before = await page.evaluate(() => window.__hangout.state.strokes.length);
    await page.mouse.move(box.x + 30 + offset, box.y + 30);
    await page.mouse.down();
    await page.mouse.move(box.x + 100 + offset, box.y + 80, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.__hangout.state.strokes.length)).toBeGreaterThan(before);
}

async function observedSnapshot(guest, host, generation) {
    const from = await host.evaluate(() => window.__hangout.myId);
    await expect.poll(() => guest.evaluate(({ from, generation }) => window.__raceWire.received.some(entry =>
        entry.from === from && entry.generation === generation && entry.message.type === 'snapshot'
        && entry.message.to === window.__hangout.myId && entry.message.done === true
    ), { from, generation })).toBe(true);
}

async function pair(browser, baseURL) {
    const host = await visitor(browser, baseURL);
    await join(host, ROOT + '?preview=' + KEY + '&relay=' + encodeURIComponent(hangoutRelayWsBase(baseURL, 'private-recovery-' + randomUUID())), 'RaceHost');
    await chooseVideo(host, FIRST);
    const guest = await visitor(browser, baseURL);
    await join(guest, host.url(), 'RaceGuest');
    await observedSnapshot(guest, host, 1);
    await expect.poll(() => guest.evaluate(() => window.__hangout.snapshotHasSeqProof)).toBe(true);
    await expect(guest.locator('[data-fake-yt]')).toHaveAttribute('data-video-id', FIRST);
    return { host, guest };
}

async function holdVerification(guest, kind, seq) {
    await guest.evaluate(({ kind, seq }) => {
        const verify = crypto.subtle.verify.bind(crypto.subtle);
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        const held = window.__raceHeld = { kind, seq, held: false, valid: null, returned: false, release };
        crypto.subtle.verify = async (...args) => {
            const valid = await verify(...args);
            let body;
            try { body = JSON.parse(new TextDecoder().decode(args[3])); } catch (_) { return valid; }
            if (!held.held && body.kind === kind && body.seq === seq) {
                held.held = true; held.valid = valid;
                await gate;
                held.returned = true;
            }
            return valid;
        };
    }, { kind, seq });
}

async function sendObsolete(host, guest, kind, nested = false) {
    const target = await guest.evaluate(() => ({ to: window.__hangout.myId, seq: window.__hangout.lastHostSeq + 1000000 }));
    await holdVerification(guest, kind, target.seq);
    if (nested) await guest.evaluate(() => {
        // Exercise the supported legacy compatibility path, addressed to this
        // membership before its nested signature begins verification.
        const app = window.__hangout;
        app.snapshotDone = false; app.snapshotFrom = null; app.snapshotHasSeqProof = false;
    });
    await host.evaluate(async ({ to, seq, kind, nested, first }) => {
        const app = window.__hangout;
        const sign = async body => {
            const bytes = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, app.hostPriv,
                new TextEncoder().encode(JSON.stringify(body))));
            let text = ''; bytes.forEach(value => { text += String.fromCharCode(value); });
            return { type: 'host', body, sig: btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') };
        };
        const body = { kind, seq };
        if (kind === 'lock') body.on = true;
        if (kind === 'video') Object.assign(body, { source: { kind: 'yt', id: first }, playing: false, pos: 13, t: Date.now() + 1000000000 });
        const action = await sign(body);
        let message = { ...action, to };
        if (nested) {
            const proof = await sign({ kind: 'seq', seq: app.lastHostSeq });
            message = { type: 'snapshot', to, first: true, done: true, chunk: false,
                strokes: [{ id: 'obsolete-legacy-before-await', color: '#000000', size: 8, pts: [[0.1, 0.1]] }],
                lastHostSeqSigned: proof, video: kind === 'video' ? { signed: action, t: body.t } : null,
                mods: kind === 'lock' ? [action] : [] };
        }
        app.ws.send(JSON.stringify(await window.HangoutCore.seal(app.key, message)));
    }, { ...target, kind, nested, first: FIRST });
    await expect.poll(() => guest.evaluate(() => window.__raceHeld.held)).toBe(true);
    expect(await guest.evaluate(() => window.__raceHeld.valid)).toBe(true);
    if (nested) expect(await guest.evaluate(() => window.__hangout.state.strokes.map(item => item.id)))
        .toContain('obsolete-legacy-before-await');
    return target;
}

async function replacement(guest, host) {
    const oldId = await guest.evaluate(async () => {
        const app = window.__hangout, id = app.myId;
        await new Promise(resolve => { app.ws.addEventListener('close', resolve, { once: true }); app.ws.close(3000); });
        return id;
    });
    await expect.poll(() => guest.evaluate(oldId => window.__hangout.connected && window.__hangout.myId !== oldId, oldId),
        { timeout: 15000 }).toBe(true);
    await observedSnapshot(guest, host, 2);
    return oldId;
}

async function releaseAndObserve(guest, target, nested = false) {
    await guest.evaluate(() => window.__raceHeld.release());
    await expect.poll(() => guest.evaluate(({ target, nested }) => window.__raceWire.received.some(entry =>
        entry.generation === 1 && entry.message.to === target.to
        && (nested ? entry.message.type === 'snapshot'
            && (entry.message.video?.signed.body.seq === target.seq || entry.message.mods?.some(mod => mod.body.seq === target.seq))
            : entry.message.type === 'host' && entry.message.body.seq === target.seq)
    ), { target, nested })).toBe(true);
    expect(await guest.evaluate(() => window.__raceHeld.returned)).toBe(true);
}

test('old-socket valid host clear cannot wipe the replacement membership after verification finishes', async ({ browser, baseURL }) => {
    const { host, guest } = await pair(browser, baseURL);
    const target = await sendObsolete(host, guest, 'clear');
    await replacement(guest, host);
    await host.click('[data-clear]');
    await drawLine(host, 40);
    const expected = await host.evaluate(() => window.__hangout.state.strokes.map(window.HangoutCore.cleanStroke));
    await expect.poll(() => guest.evaluate(() => window.__hangout.state.strokes)).toEqual(expected);
    const floor = await guest.evaluate(() => window.__hangout.lastHostSeq);
    expect(floor).toBeLessThan(target.seq);
    await releaseAndObserve(guest, target);
    expect(await guest.evaluate(() => window.__hangout.state.strokes)).toEqual(expected);
    expect(await guest.evaluate(() => window.__hangout.lastHostSeq)).toBe(floor);
    await host.click('[data-clear]');
    await expect.poll(() => guest.evaluate(() => window.__hangout.state.strokes)).toEqual([]);
    expect(await guest.evaluate(() => window.__hangout.lastHostSeq)).toBe(await host.evaluate(() => window.__hangout.lastHostSeq));
});

test('old-socket legacy nested video cannot replace current video after verification finishes', async ({ browser, baseURL }) => {
    const { host, guest } = await pair(browser, baseURL);
    const target = await sendObsolete(host, guest, 'video', true);
    await replacement(guest, host);
    const expected = await chooseVideo(host, SECOND);
    await expect.poll(() => guest.evaluate(() => window.__hangout.state.video)).toEqual(expected);
    const floor = await guest.evaluate(() => window.__hangout.lastHostSeq);
    expect(floor).toBeLessThan(target.seq);
    expect(expected.t).toBeLessThan(await guest.evaluate(() => Date.now() + 1000000000));
    await releaseAndObserve(guest, target, true);
    expect(await guest.evaluate(() => window.__hangout.state.video)).toEqual(expected);
    expect(await guest.evaluate(() => window.__hangout.lastHostSeq)).toBe(floor);
    await chooseVideo(host, THIRD);
    await expect.poll(() => guest.evaluate(() => window.__hangout.state.video?.source.id)).toBe(THIRD);
    expect(await guest.evaluate(() => window.__hangout.lastHostSeq)).toBe(await host.evaluate(() => window.__hangout.lastHostSeq));
});

test('old-socket legacy nested lock cannot lock the replacement membership after verification finishes', async ({ browser, baseURL }) => {
    const { host, guest } = await pair(browser, baseURL);
    const target = await sendObsolete(host, guest, 'lock', true);
    await replacement(guest, host);
    await host.click('[data-lock]');
    await expect.poll(() => guest.evaluate(() => window.__hangout.av.locked)).toBe(true);
    await host.click('[data-lock]');
    await expect.poll(() => guest.evaluate(() => window.__hangout.av.locked)).toBe(false);
    const floor = await guest.evaluate(() => window.__hangout.lastHostSeq);
    expect(floor).toBeLessThan(target.seq);
    await releaseAndObserve(guest, target, true);
    expect(await guest.evaluate(() => window.__hangout.av.locked)).toBe(false);
    expect(await guest.evaluate(() => window.__hangout.lastHostSeq)).toBe(floor);
    await host.click('[data-lock]');
    await expect.poll(() => guest.evaluate(() => window.__hangout.av.locked)).toBe(true);
    expect(await guest.evaluate(() => window.__hangout.lastHostSeq)).toBe(await host.evaluate(() => window.__hangout.lastHostSeq));
});

test('late join snapshot waits for a reserved host video signature to commit its state', async ({ browser, baseURL }) => {
    const host = await visitor(browser, baseURL);
    await join(host, ROOT + '?preview=' + KEY + '&relay=' + encodeURIComponent(hangoutRelayWsBase(baseURL, 'private-recovery-' + randomUUID())), 'PublicationHost');
    await chooseVideo(host, FIRST);
    await host.evaluate(second => {
        const sign = crypto.subtle.sign.bind(crypto.subtle);
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        const held = window.__racePublication = { held: false, release, seq: null };
        crypto.subtle.sign = async (...args) => {
            const body = JSON.parse(new TextDecoder().decode(args[2]));
            window.__raceWire.signs.push(structuredClone(body));
            const result = await sign(...args);
            if (!held.held && body.kind === 'video' && body.source.id === second) {
                held.held = true; held.seq = body.seq;
                await gate;
            }
            return result;
        };
    }, SECOND);
    await host.click(`[data-pick-yt="${SECOND}"]`);
    await expect.poll(() => host.evaluate(() => window.__racePublication.held)).toBe(true);
    const reserved = await host.evaluate(() => window.__racePublication.seq);
    expect(await host.evaluate(() => window.__hangout.lastHostSeq)).toBe(reserved);
    expect(await host.evaluate(() => window.__hangout.lastVideoSigned.signed.body.source.id)).toBe(FIRST);
    const guest = await visitor(browser, baseURL);
    await join(guest, host.url(), 'PublicationGuest');
    const guestId = await guest.evaluate(() => window.__hangout.myId);
    await expect.poll(() => host.evaluate(id => window.__raceWire.received.some(entry =>
        entry.from === id && entry.message.type === 'hello' && !entry.message.reply
    ), guestId)).toBe(true);
    // Observe the completed actual hello handler, then let its scheduled job
    // start through two task turns. There is no arbitrary wall-clock sleep.
    await host.evaluate(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
        await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(await host.evaluate(() => window.__raceWire.signs.filter(body => ['seq', 'snapshot'].includes(body.kind)))).toEqual([]);
    expect(await host.evaluate(to => window.__raceWire.sent.filter(message => message.type === 'snapshot' && message.to === to), guestId)).toEqual([]);
    await host.evaluate(() => window.__racePublication.release());
    await observedSnapshot(guest, host, 1);
    const first = await host.evaluate(to => window.__raceWire.sent.find(message => message.type === 'snapshot' && message.to === to), guestId);
    expect(first.video.signed.body.source.id).toBe(SECOND);
    expect(first.video.signed.body.seq).toBe(reserved);
    expect(first.lastHostSeqSigned.body.seq).toBeGreaterThanOrEqual(reserved);
    expect(await guest.evaluate(() => window.__hangout.state.video.source.id)).toBe(SECOND);
});
