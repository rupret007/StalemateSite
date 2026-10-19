const { randomUUID } = require('node:crypto');
// A replacement relay connection must recover current activity, never old chat.
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const ROOT = '/r/45662413410ed051/';
const KEY = 'local-preview-key-0001';
const FIRST = 'BtnyqIHTDMM';
const SECOND = 'Dws9G6UFyUQ';
const FAKE_YT = path.join(__dirname, 'support/fake-youtube.js');
const contexts = new Set();
const pages = new Set();

test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium covers private activity recovery');
test.afterEach(async () => {
    try {
        for (const page of pages) {
            expect(page.recoveryErrors).toEqual([]);
            if (!page.isClosed()) expect(await page.evaluate(() => window.__recoveryWire.errors)).toEqual([]);
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
        const wire = window.__recoveryWire = { sockets: 0, received: [], errors: [] };
        const descriptor = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
        const callbacks = new WeakMap();
        const generations = new WeakMap();
        Object.defineProperty(WebSocket.prototype, 'onmessage', {
            configurable: descriptor.configurable, enumerable: descriptor.enumerable,
            get() { return callbacks.get(this) || null; },
            set(callback) {
                callbacks.set(this, callback);
                if (!generations.has(this)) generations.set(this, ++wire.sockets);
                descriptor.set.call(this, typeof callback === 'function' ? async function (event) {
                    await callback.call(this, event);
                    const app = window.__hangout;
                    try {
                        const frame = JSON.parse(event.data);
                        if (!frame.c) return;
                        const message = await window.HangoutCore.open(app.key, frame);
                        if (!['snapshot', 'host', 'chat'].includes(message.type)) return;
                        wire.received.push({ message, from: frame.from, generation: generations.get(this),
                            after: { ownId: app.myId, seq: app.lastHostSeq, done: app.snapshotDone,
                                proof: app.snapshotHasSeqProof, owner: app.snapshotFrom,
                                strokes: app.state.strokes.map(stroke => stroke.id),
                                video: app.state.video, locked: app.av.locked,
                                chat: app.state.chat.map(line => line.text) } });
                    } catch (_) { wire.errors.push('recovery-wire-observation-failed'); }
                } : callback);
            }
        });
    });
    const page = await context.newPage();
    pages.add(page); page.recoveryErrors = [];
    page.on('pageerror', error => page.recoveryErrors.push(error.message));
    return page;
}

async function join(page, url, name) {
    await page.goto(url);
    await page.fill('[data-name]', name);
    await page.click('[data-enter]');
    await expect.poll(() => page.evaluate(() => window.__hangout.connected)).toBe(true);
}

async function drawLine(page, offset) {
    await page.locator('[data-canvas]').scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => window.__hangout.state.strokes.length);
    const box = await page.locator('[data-canvas]').boundingBox();
    await page.mouse.move(box.x + 30 + offset, box.y + 30);
    await page.mouse.down();
    await page.mouse.move(box.x + 100 + offset, box.y + 80, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.__hangout.state.strokes.length)).toBeGreaterThan(before);
    return page.evaluate(() => window.__hangout.state.strokes.map(window.HangoutCore.cleanStroke));
}

async function pausedVideo(host, id, pos) {
    await host.click(`[data-pick-yt="${id}"]`);
    await expect(host.locator('[data-fake-yt]')).toHaveAttribute('data-video-id', id);
    await expect(host.locator('[data-fake-yt]')).toHaveAttribute('data-state', 'playing');
    await host.evaluate(() => window.__ytLog.at(-1).pauseVideo());
    await expect.poll(() => host.evaluate(() => window.__hangout.state.video?.playing)).toBe(false);
    await host.evaluate(pos => window.__ytLog.at(-1).seekTo(pos), pos);
    await expect.poll(() => host.evaluate(() => window.__hangout.state.video?.pos)).toBe(pos);
    return host.evaluate(() => window.__hangout.state.video);
}

async function observedHostSnapshot(guest, host, generation) {
    const from = await host.evaluate(() => window.__hangout.myId);
    await expect.poll(() => guest.evaluate(({ from, generation }) => window.__recoveryWire.received.some(entry =>
        entry.generation === generation && entry.from === from && entry.message.type === 'snapshot'
        && entry.message.to === window.__hangout.myId && entry.message.done === true
    ), { from, generation })).toBe(true);
}

async function connectedPair(browser, baseURL) {
    const host = await visitor(browser, baseURL);
    await join(host, ROOT + '?preview=' + KEY + '&relay=' + encodeURIComponent(hangoutRelayWsBase(baseURL, 'private-recovery-' + randomUUID())), 'RecoveryHost');
    const initialStrokes = await drawLine(host, 0);
    await pausedVideo(host, FIRST, 7);
    const guest = await visitor(browser, baseURL);
    await join(guest, host.url(), 'RecoveryGuest');
    await observedHostSnapshot(guest, host, 1);
    await expect.poll(() => guest.evaluate(() => window.__hangout.snapshotHasSeqProof)).toBe(true);
    expect(await guest.evaluate(() => window.__hangout.state.strokes)).toEqual(initialStrokes);
    await expect(guest.locator('[data-fake-yt]')).toHaveAttribute('data-video-id', FIRST);
    await host.fill('[data-text]', 'Received before the interruption');
    await host.press('[data-text]', 'Enter');
    await expect(guest.locator('[data-log]')).toContainText('Received before the interruption');
    await guest.fill('[data-text]', 'A draft across the interruption');
    return { host, guest, floor: await guest.evaluate(() => window.__hangout.lastHostSeq) };
}

async function disconnectAndHold(guest) {
    // Pause only fixture timers. The actual relay socket closes normally, and
    // the connected host continues making changes on its ordinary clock.
    await guest.clock.install();
    await guest.clock.pauseAt(await guest.evaluate(() => new Date(Date.now() + 60_000).toISOString()));
    return guest.evaluate(async () => {
        const app = window.__hangout;
        const oldId = app.myId;
        await new Promise(resolve => {
            app.ws.addEventListener('close', resolve, { once: true });
            app.ws.close(3000);
        });
        return { oldId, connected: app.connected, chat: app.state.chat };
    });
}

async function reconnect(guest, host, oldId) {
    await guest.clock.resume();
    await expect.poll(() => guest.evaluate(oldId => window.__hangout.connected && window.__hangout.myId !== oldId, oldId), { timeout: 15000 }).toBe(true);
    await observedHostSnapshot(guest, host, 2);
}

for (const lockBeforeVideo of [false, true]) {
    test(`reconnect recovers missed drawing, watch state and ${lockBeforeVideo ? 'a lock older than the latest video action' : 'the latest lock'} without chat replay`, async ({ browser, baseURL }) => {
        const { host, guest, floor } = await connectedPair(browser, baseURL);
        const disconnected = await disconnectAndHold(guest);
        expect(disconnected.connected).toBe(false);
        expect(disconnected.chat).toEqual([]);
        await host.click('[data-clear]');
        const replacement = await drawLine(host, 90);
        if (lockBeforeVideo) await host.click('[data-lock]');
        const video = await pausedVideo(host, SECOND, 21);
        if (!lockBeforeVideo) await host.click('[data-lock]');
        await expect.poll(() => host.evaluate(() => window.__hangout.av.locked)).toBe(true);
        const expectedFloor = await host.evaluate(() => window.__hangout.lastHostSeq);
        expect(expectedFloor).toBeGreaterThan(floor);
        const lockSeq = await host.evaluate(() => window.__hangout.av.mods.lock.body.seq);
        if (lockBeforeVideo) expect(lockSeq).toBeLessThan(expectedFloor);
        else expect(lockSeq).toBe(expectedFloor);
        await host.fill('[data-text]', 'Sent while the guest was offline');
        await host.press('[data-text]', 'Enter');
        await expect(host.locator('[data-log]')).toContainText('Sent while the guest was offline');
        await reconnect(guest, host, disconnected.oldId);
        // The barrier observes completion of the real replacement connection's
        // host snapshot even on old code that discards it. No timer fallback can
        // satisfy this observation.
        if (lockBeforeVideo) expect(await guest.evaluate(() => window.__hangout.av.locked)).toBe(true);
        expect(await guest.evaluate(() => window.__hangout.state.strokes)).toEqual(replacement);
        expect(await guest.evaluate(() => window.__hangout.state.video)).toEqual(video);
        expect(await guest.evaluate(() => window.__hangout.av.locked)).toBe(true);
        expect(await guest.evaluate(() => window.__hangout.lastHostSeq)).toBeGreaterThanOrEqual(expectedFloor);
        await expect(guest.locator('[data-fake-yt]')).toHaveAttribute('data-video-id', SECOND);
        await expect(guest.locator('[data-fake-yt]')).toHaveAttribute('data-state', 'paused');
        await expect(guest.locator('[data-log]')).toBeEmpty();
        await expect(guest.locator('[data-text]')).toHaveValue('A draft across the interruption');
        await host.fill('[data-text]', 'New live chat after recovery');
        await host.press('[data-text]', 'Enter');
        await expect(guest.locator('[data-log] li')).toHaveCount(1);
        await expect(guest.locator('[data-log]')).toContainText('New live chat after recovery');
        expect(await guest.evaluate(() => window.__hangout.state.chat.map(line => line.text))).toEqual(['New live chat after recovery']);
    });
}

async function holdOutgoingSnapshots(page) {
    await page.evaluate(() => {
        const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        const held = window.__heldSnapshots = { release, messages: [] };
        held.send = async message => {
            // Send a controlled packet through real native AES and the relay,
            // bypassing only this fixture's outbound hold.
            const cryptoImpl = { getRandomValues: crypto.getRandomValues.bind(crypto), subtle: { encrypt } };
            window.__hangout.ws.send(JSON.stringify(await window.HangoutCore.seal(window.__hangout.key, message, cryptoImpl)));
        };
        crypto.subtle.encrypt = async (...args) => {
            const result = await encrypt(...args);
            const message = JSON.parse(new TextDecoder().decode(args[2]));
            if (message.type === 'snapshot') { held.messages.push(message); await gate; }
            return result;
        };
    });
}

test('a returning creator keeps known drawing when an uninitialized newcomer answers first', async ({ browser, baseURL }) => {
    const { host, guest } = await connectedPair(browser, baseURL);
    const expected = await host.evaluate(() => window.__hangout.state.strokes.map(window.HangoutCore.cleanStroke));
    expect(expected.length).toBeGreaterThan(0);
    await expect.poll(() => guest.evaluate(() => window.__hangout.state.strokes)).toEqual(expected);
    await holdOutgoingSnapshots(guest);
    const disconnected = await disconnectAndHold(host);
    const newcomer = await visitor(browser, baseURL);
    await join(newcomer, host.url(), 'UninitializedNewcomer');
    const newId = await newcomer.evaluate(() => window.__hangout.myId);
    await expect.poll(() => guest.evaluate(id => window.__heldSnapshots.messages.some(message => message.to === id), newId)).toBe(true);
    expect(await newcomer.evaluate(() => window.__hangout.state.strokes)).toEqual([]);
    await host.clock.resume();
    await expect.poll(() => host.evaluate(oldId => window.__hangout.connected && window.__hangout.myId !== oldId, disconnected.oldId), { timeout: 15000 }).toBe(true);
    await expect.poll(() => host.evaluate(id => window.__recoveryWire.received.some(entry =>
        entry.from === id && entry.generation === 2 && entry.message.type === 'snapshot'
        && entry.message.request === window.__hangout.snapshotRequest && entry.message.done
    ), newId)).toBe(true);
    expect(await host.evaluate(() => window.__hangout.snapshotFresh)).toBe(true);
    expect(await host.evaluate(() => window.__hangout.snapshotFrom)).toBe(newId);
    expect(await host.evaluate(() => window.__hangout.state.strokes)).toEqual(expected);
    await guest.evaluate(() => window.__heldSnapshots.release());
    await expect.poll(() => newcomer.evaluate(() => window.__hangout.snapshotFresh)).toBe(true);
    expect(await newcomer.evaluate(() => window.__hangout.state.strokes)).toEqual(expected);
    await drawLine(guest, 130);
    const completed = await guest.evaluate(() => window.__hangout.state.strokes.map(window.HangoutCore.cleanStroke));
    await expect.poll(() => host.evaluate(() => window.__hangout.state.strokes)).toEqual(completed);
    await expect.poll(() => newcomer.evaluate(() => window.__hangout.state.strokes)).toEqual(completed);
    expect(await host.evaluate(() => window.__hangout.state.chat)).toEqual([]);
});

test('peer drawing recovery retains controls accepted after its request without trusting peer sequence claims', async ({ browser, baseURL }) => {
    const { host, guest } = await connectedPair(browser, baseURL);
    const drawing = await host.evaluate(() => window.__hangout.state.strokes.map(window.HangoutCore.cleanStroke));
    await holdOutgoingSnapshots(host);
    await holdOutgoingSnapshots(guest);
    const newcomer = await visitor(browser, baseURL);
    await join(newcomer, host.url(), 'PeerFallbackVisitor');
    const target = await newcomer.evaluate(() => ({ id: window.__hangout.myId, request: window.__hangout.snapshotRequest }));
    for (const page of [host, guest]) await expect.poll(() => page.evaluate(target =>
        window.__heldSnapshots.messages.some(message => message.to === target.id && message.request === target.request), target)).toBe(true);
    await host.click('[data-lock]');
    await expect.poll(() => newcomer.evaluate(() => window.__hangout.av.locked)).toBe(true);
    const floor = await newcomer.evaluate(() => window.__hangout.lastHostSeq);
    expect(floor).toBeGreaterThan(await guest.evaluate(target => window.__heldSnapshots.messages.find(message => message.to === target.id).seq, target));
    await guest.evaluate(() => window.__heldSnapshots.release());
    const peerId = await guest.evaluate(() => window.__hangout.myId);
    await expect.poll(() => newcomer.evaluate(id => window.__recoveryWire.received.some(entry =>
        entry.from === id && entry.message.type === 'snapshot' && entry.message.to === window.__hangout.myId && entry.message.done
    ), peerId)).toBe(true);
    expect(await newcomer.evaluate(() => window.__hangout.state.strokes)).toEqual(drawing);
    expect(await newcomer.evaluate(() => window.__hangout.snapshotFrom)).toBe(peerId);
    expect(await newcomer.evaluate(() => window.__hangout.snapshotFresh)).toBe(false);
    expect(await newcomer.evaluate(() => window.__hangout.lastHostSeq)).toBe(floor);
    expect(await newcomer.evaluate(() => window.__hangout.av.locked)).toBe(true);
    await expect(newcomer.locator('[data-sync-retry]')).toBeHidden();
    await host.evaluate(() => window.__heldSnapshots.release());
    await expect.poll(() => newcomer.evaluate(() => window.__hangout.snapshotFresh)).toBe(true);
    expect(await newcomer.evaluate(() => window.__hangout.state.strokes)).toEqual(drawing);
    expect(await newcomer.evaluate(() => window.__hangout.av.locked)).toBe(true);
    expect(await newcomer.evaluate(() => window.__hangout.lastHostSeq)).toBe(floor);
});

test('invalid fresh proofs cannot fall back to legacy state or cross a new recovery request', async ({ browser, baseURL }) => {
    const host = await visitor(browser, baseURL);
    await join(host, ROOT + '?preview=' + KEY + '&relay=' + encodeURIComponent(hangoutRelayWsBase(baseURL, 'private-recovery-' + randomUUID())), 'ProofHost');
    const drawing = await drawLine(host, 20);
    await host.click('[data-lock]');
    await expect.poll(() => host.evaluate(() => window.__hangout.av.locked)).toBe(true);
    await holdOutgoingSnapshots(host);
    const guest = await visitor(browser, baseURL);
    await join(guest, host.url(), 'ProofGuest');
    const target = await guest.evaluate(() => ({ id: window.__hangout.myId, request: window.__hangout.snapshotRequest }));
    await expect.poll(() => host.evaluate(target => window.__heldSnapshots.messages.some(message =>
        message.to === target.id && message.request === target.request && message.done), target)).toBe(true);
    const original = await host.evaluate(target => window.__heldSnapshots.messages.find(message =>
        message.to === target.id && message.request === target.request && message.done), target);
    expect(original.lastHostSeqSigned.body.kind).toBe('snapshot');
    const floor = await guest.evaluate(() => window.__hangout.lastHostSeq);
    for (const attack of ['changed-drawing', 'changed-control', 'changed-proof']) {
        const packet = structuredClone(original);
        packet.probe = attack;
        if (attack === 'changed-drawing') packet.strokes = [{ id: 'forged-state', color: '#000000', size: 8, pts: [[0.9, 0.9]] }];
        if (attack === 'changed-control') packet.mods[0].body.on = false;
        if (attack === 'changed-proof') packet.lastHostSeqSigned.sig = packet.lastHostSeqSigned.sig[0] === 'A'
            ? 'B' + packet.lastHostSeqSigned.sig.slice(1) : 'A' + packet.lastHostSeqSigned.sig.slice(1);
        await host.evaluate(packet => window.__heldSnapshots.send(packet), packet);
        await expect.poll(() => guest.evaluate(label => window.__recoveryWire.received.some(entry => entry.message.probe === label), attack)).toBe(true);
        expect(await guest.evaluate(() => window.__hangout.state.strokes)).toEqual([]);
        expect(await guest.evaluate(() => window.__hangout.av.locked)).toBe(false);
        expect(await guest.evaluate(() => window.__hangout.lastHostSeq)).toBe(floor);
        expect(await guest.evaluate(() => window.__hangout.snapshotFrom)).toBeNull();
        expect(await guest.evaluate(() => window.__hangout.snapshotFresh)).toBe(false);
    }
    await expect(guest.locator('[data-sync-retry]')).toBeVisible({ timeout: 17000 });
    await guest.click('[data-sync-retry]');
    const request = await guest.evaluate(() => window.__hangout.snapshotRequest);
    expect(request).not.toBe(target.request);
    await host.evaluate(packet => window.__heldSnapshots.send({ ...packet, probe: 'stale-request' }), original);
    await expect.poll(() => guest.evaluate(() => window.__recoveryWire.received.some(entry => entry.message.probe === 'stale-request'))).toBe(true);
    expect(await guest.evaluate(() => window.__hangout.state.strokes)).toEqual([]);
    expect(await guest.evaluate(() => window.__hangout.lastHostSeq)).toBe(floor);
    await expect.poll(() => host.evaluate(({ id, request }) => window.__heldSnapshots.messages.some(message =>
        message.to === id && message.request === request && message.done), { id: target.id, request })).toBe(true);
    await host.evaluate(() => window.__heldSnapshots.release());
    await expect.poll(() => guest.evaluate(() => window.__hangout.snapshotFresh)).toBe(true);
    expect(await guest.evaluate(() => window.__hangout.state.strokes)).toEqual(drawing);
    expect(await guest.evaluate(() => window.__hangout.av.locked)).toBe(true);
    expect(await guest.evaluate(() => window.__hangout.snapshotRequest)).toBe(request);
    await expect(guest.locator('[data-log]')).toBeEmpty();
});
