const { randomUUID } = require('node:crypto');
// A fresh multipart cut must reconcile drawing that continues while it is in flight.
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const ROOT = '/r/45662413410ed051/';
const KEY = 'local-preview-key-0001';
const contexts = new Set(), pages = new Set();

test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium covers native multipart snapshot and drawing races');
test.afterEach(async () => {
    try {
        for (const page of pages) {
            expect(page.streamErrors).toEqual([]);
            if (!page.isClosed()) expect(await page.evaluate(() => window.__streamWire.errors)).toEqual([]);
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
        const wire = window.__streamWire = { received: [], sent: [], errors: [], hold: null };
        wire.arm = (operation, part) => {
            let release;
            const gate = new Promise(resolve => { release = resolve; });
            wire.hold = { operation, part, held: false, returned: false, valid: null, body: null,
                capture: null, release, gate };
        };
        for (const operation of ['sign', 'verify']) {
            const original = crypto.subtle[operation].bind(crypto.subtle);
            crypto.subtle[operation] = async (...args) => {
                const result = await original(...args);
                let body;
                try { body = JSON.parse(new TextDecoder().decode(args[operation === 'sign' ? 2 : 3])); }
                catch (_) { return result; }
                const hold = wire.hold;
                if (hold && !hold.held && hold.operation === operation && body.kind === 'snapshot' && body.part === hold.part) {
                    hold.held = true; hold.body = body;
                    hold.valid = operation === 'verify' ? result : result.byteLength === 64;
                    const app = window.__hangout;
                    hold.capture = { seq: app.lastHostSeq, epoch: app.drawingEpoch,
                        strokes: app.state.strokes.map(window.HangoutCore.cleanSnapshotStroke) };
                    await hold.gate;
                    hold.returned = true;
                }
                return result;
            };
        }
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
                        const app = window.__hangout;
                        const message = await window.HangoutCore.open(app.key, frame);
                        wire.received.push({ message, from: frame.from,
                            after: { seq: app.lastHostSeq, epoch: app.drawingEpoch, fresh: app.snapshotFresh,
                                ids: app.state.strokes.map(stroke => stroke.id) } });
                    } catch (_) { wire.errors.push('completed-stream-handler-observation-failed'); }
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
                    wire.sent.push(message);
                }, () => wire.errors.push('outbound-stream-observation-failed'));
            } catch (_) { wire.errors.push('outbound-stream-frame-observation-failed'); }
        };
    });
    const page = await context.newPage();
    pages.add(page); page.streamErrors = [];
    page.on('pageerror', error => page.streamErrors.push(error.message));
    return page;
}

async function join(page, url, name) {
    await page.goto(url);
    await page.fill('[data-name]', name);
    await page.click('[data-enter]');
    await expect.poll(() => page.evaluate(() => window.__hangout.connected)).toBe(true);
}

async function seededHost(browser, baseURL) {
    const host = await visitor(browser, baseURL);
    await join(host, ROOT + '?preview=' + KEY + '&relay=' + encodeURIComponent(hangoutRelayWsBase(baseURL, 'private-recovery-' + randomUUID())), 'StreamHost');
    // The creator and joining visitor both know the initial epoch 0. An initial
    // clear would introduce an unknown epoch whose proof is correctly withheld
    // with the held snapshot, so its live drawing must remain invisible then.
    expect(await host.evaluate(() => window.__hangout.drawingEpoch)).toBe(0);
    const strokes = await host.evaluate(() => {
        const H = window.HangoutCore, app = window.__hangout;
        // Canonical bounded fixture strokes enter through the real state core
        // before another visitor exists. Production snapshot code must then
        // capture, chunk, sign, encrypt and relay all 105 strokes normally.
        for (let i = 0; i < 105; i++) {
            const x = Math.round(((i % 10) + 1) / 12 * 10000) / 10000;
            const y = Math.round((Math.floor(i / 10) + 1) / 15 * 10000) / 10000;
            const stroke = { id: 'stream-fixture-' + String(i).padStart(3, '0'), color: '#171410', size: 3,
                pts: [[x, y], [Math.min(1, x + 0.01), Math.min(1, y + 0.01)]] };
            if (H.apply(app.state, { type: 'stroke', epoch: app.drawingEpoch, offset: 0, stroke }) !== 'draw') {
                throw new Error('canonical-stream-fixture-rejected');
            }
        }
        return app.state.strokes.map(H.cleanSnapshotStroke);
    });
    expect(strokes).toHaveLength(105);
    expect(strokes.every(Boolean)).toBe(true);
    return host;
}

async function beginStroke(page, shift = 0) {
    await page.locator('[data-canvas]').scrollIntoViewIfNeeded();
    const box = await page.locator('[data-canvas]').boundingBox();
    const before = await page.evaluate(() => window.__hangout.state.strokes.length);
    await page.mouse.move(box.x + 30 + shift, box.y + 35);
    await page.mouse.down();
    await page.mouse.move(box.x + 80 + shift, box.y + 60, { steps: 4 });
    await expect.poll(() => page.evaluate(() => window.__hangout.state.strokes.length)).toBe(before + 1);
    const id = await page.evaluate(() => window.__hangout.state.strokes.at(-1).id);
    return { box, id, shift };
}

async function continueStroke(page, stroke, end = true) {
    await page.mouse.move(stroke.box.x + 140 + stroke.shift, stroke.box.y + 105, { steps: 5 });
    if (end) await page.mouse.up();
}

async function drawLine(page, shift = 0) {
    const stroke = await beginStroke(page, shift);
    await page.mouse.up();
    return stroke;
}

async function strokeAt(page, id) {
    return page.evaluate(id => window.HangoutCore.cleanSnapshotStroke(window.__hangout.state.strokes.find(stroke => stroke.id === id)), id);
}

async function observedStroke(page, id, end) {
    await expect.poll(() => page.evaluate(({ id, end }) => window.__streamWire.received.some(entry =>
        entry.message.type === 'stroke' && entry.message.stroke.id === id
        && entry.message.offset + entry.message.stroke.pts.length === end
    ), { id, end })).toBe(true);
}

async function completedBatch(guest, body) {
    await expect.poll(() => guest.evaluate(body => {
        const entries = window.__streamWire.received.filter(entry => entry.message.type === 'snapshot'
            && entry.message.batch === body.batch && entry.message.request === body.request);
        return entries.length === body.parts && entries.some(entry => entry.after.fresh);
    }, body)).toBe(true);
    expect(await guest.evaluate(() => window.__hangout.snapshotFresh)).toBe(true);
    expect(await guest.evaluate(() => window.__hangout.snapshotHasSeqProof)).toBe(true);
    expect(await guest.evaluate(() => window.HangoutCore.strokeRangeStatus(window.__hangout.state))).toEqual({
        pendingStrokes: 0, pendingRanges: 0, pendingPoints: 0, exhausted: false, conflicted: false
    });
}

test('multipart fresh recovery preserves a pointer stroke across capture and drawing from both visitors during the hold', async ({ browser, baseURL }) => {
    const host = await seededHost(browser, baseURL);
    const ongoing = await beginStroke(host);
    await expect.poll(() => host.evaluate(id => window.__streamWire.sent.some(message =>
        message.type === 'stroke' && message.stroke.id === id && message.offset === 0), ongoing.id)).toBe(true);
    const capturedPrefix = await strokeAt(host, ongoing.id);
    await host.evaluate(() => window.__streamWire.arm('sign', 0));
    const guest = await visitor(browser, baseURL);
    await join(guest, host.url(), 'StreamGuest');
    await expect.poll(() => host.evaluate(() => window.__streamWire.hold.held)).toBe(true);
    const capture = await host.evaluate(() => ({ body: window.__streamWire.hold.body, state: window.__streamWire.hold.capture,
        valid: window.__streamWire.hold.valid }));
    expect(capture.valid).toBe(true);
    expect(capture.body.parts).toBe(2);
    expect(capture.state.strokes).toHaveLength(106);
    expect(capture.state.strokes.at(-1)).toEqual(capturedPrefix);
    expect(await guest.evaluate(() => window.__hangout.snapshotFresh)).toBe(false);

    await continueStroke(host, ongoing);
    const completedHostStroke = await strokeAt(host, ongoing.id);
    expect(completedHostStroke.pts.length).toBeGreaterThan(capturedPrefix.pts.length);
    await observedStroke(guest, ongoing.id, completedHostStroke.pts.length);
    const added = await drawLine(host, 45);
    const addedStroke = await strokeAt(host, added.id);
    await observedStroke(guest, added.id, addedStroke.pts.length);
    const whileHeld = await guest.evaluate(() => ({ ids: window.__hangout.state.strokes.map(stroke => stroke.id),
        ranges: window.HangoutCore.strokeRangeStatus(window.__hangout.state) }));
    expect(whileHeld.ids).toEqual([added.id]);
    expect(whileHeld.ranges.pendingPoints).toBeGreaterThan(0);

    // Keep this genuine local pointer stroke down across the atomic replacement.
    // Its next movement must continue the same stroke in the replacement state.
    const local = await beginStroke(guest, 90);
    const localPrefix = await strokeAt(guest, local.id);
    await observedStroke(host, local.id, localPrefix.pts.length);
    await host.evaluate(() => window.__streamWire.hold.release());
    await completedBatch(guest, capture.body);
    expect(await host.evaluate(() => window.__streamWire.hold.returned)).toBe(true);
    await expect.poll(() => host.evaluate(body => window.__streamWire.sent.filter(message => message.type === 'snapshot'
        && message.batch === body.batch && message.request === body.request).length, capture.body)).toBe(capture.body.parts);
    const transmittedCut = await host.evaluate(({ batch, id }) => window.__streamWire.sent
        .filter(message => message.type === 'snapshot' && message.batch === batch)
        .flatMap(message => message.strokes).find(stroke => stroke.id === id), { batch: capture.body.batch, id: ongoing.id });
    expect(transmittedCut).toEqual(capturedPrefix);
    await continueStroke(guest, local);
    const completeLocal = await strokeAt(guest, local.id);
    expect(completeLocal.pts.length).toBeGreaterThan(localPrefix.pts.length);
    await observedStroke(host, local.id, completeLocal.pts.length);

    const expected = await host.evaluate(() => window.__hangout.state.strokes.map(window.HangoutCore.cleanSnapshotStroke));
    expect(expected).toHaveLength(108);
    expect(await guest.evaluate(() => window.__hangout.state.strokes)).toEqual(expected);
    const ranges = await host.evaluate(id => window.__streamWire.sent.filter(message => message.type === 'stroke'
        && message.stroke.id === id).map(message => ({ offset: message.offset, pts: message.stroke.pts })), ongoing.id);
    expect(ranges.some(range => range.offset > 0)).toBe(true);
    for (const range of ranges) expect(range.pts).toEqual(completedHostStroke.pts.slice(range.offset, range.offset + range.pts.length));
    expect(await guest.evaluate(() => window.__hangout.lastHostSeq)).toBeGreaterThanOrEqual(capture.body.seq);
    expect(await guest.evaluate(() => window.__hangout.drawingEpoch)).toBe(capture.state.epoch);
    expect(await guest.evaluate(() => window.__hangout.lastSnapshotProof.body.request)).toBe(capture.body.request);
});

test('signed clear during multipart intake keeps the new epoch and its drawing when the older cut completes', async ({ browser, baseURL }) => {
    const host = await seededHost(browser, baseURL);
    const guest = await visitor(browser, baseURL);
    // Arm before joining, while imports and ordinary host hello verification use
    // their real native implementations. Only the second valid snapshot proof waits.
    await guest.goto(host.url());
    await guest.evaluate(() => window.__streamWire.arm('verify', 1));
    await guest.fill('[data-name]', 'ClearDuringIntake');
    await guest.click('[data-enter]');
    await expect.poll(() => guest.evaluate(() => window.__streamWire.hold.held)).toBe(true);
    const held = await guest.evaluate(() => ({ body: window.__streamWire.hold.body, valid: window.__streamWire.hold.valid }));
    expect(held.valid).toBe(true);
    expect(held.body.parts).toBe(2);
    await expect.poll(() => guest.evaluate(batch => window.__streamWire.received.some(entry =>
        entry.message.type === 'snapshot' && entry.message.batch === batch && entry.message.part === 0), held.body.batch)).toBe(true);
    // Completion of part 0's actual handler cannot expose a partial old canvas.
    expect(await guest.evaluate(() => window.__hangout.state.strokes)).toEqual([]);
    expect(await guest.evaluate(() => window.__hangout.snapshotFresh)).toBe(false);

    await host.click('[data-clear]');
    await expect.poll(() => host.evaluate(() => window.__hangout.lastClearSigned?.body.seq === window.__hangout.drawingEpoch)).toBe(true);
    const epoch = await host.evaluate(() => window.__hangout.drawingEpoch);
    expect(epoch).toBeGreaterThan(held.body.seq);
    await expect.poll(() => guest.evaluate(epoch => window.__streamWire.received.some(entry =>
        entry.message.type === 'host' && entry.message.body.kind === 'clear' && entry.message.body.seq === epoch), epoch)).toBe(true);
    const added = await drawLine(host, 70);
    const stroke = await strokeAt(host, added.id);
    await observedStroke(guest, added.id, stroke.pts.length);
    expect(await guest.evaluate(() => window.__hangout.state.strokes)).toEqual([stroke]);
    expect(await guest.evaluate(() => window.__hangout.drawingEpoch)).toBe(epoch);

    await guest.evaluate(() => window.__streamWire.hold.release());
    await completedBatch(guest, held.body);
    expect(await guest.evaluate(() => window.__streamWire.hold.returned)).toBe(true);
    expect(await guest.evaluate(() => window.__hangout.state.strokes)).toEqual([stroke]);
    expect(await guest.evaluate(() => window.__hangout.drawingEpoch)).toBe(epoch);
    expect(await guest.evaluate(() => window.__hangout.lastHostSeq)).toBe(epoch);
    expect(await guest.evaluate(() => window.__hangout.lastClearSigned)).toEqual(await host.evaluate(() => window.__hangout.lastClearSigned));
    // The completed fresh proof is an authentic older cut; it cannot lower the
    // host floor or make any of its 105 pre-clear strokes reappear.
    expect(await guest.evaluate(() => window.__hangout.lastSnapshotProof.body.seq)).toBe(held.body.seq);
});
