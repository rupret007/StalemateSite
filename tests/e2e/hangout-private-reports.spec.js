// Frontend protocol fixtures only: ACKs below are simulated, not durable writes.
// Normal encrypted content, host proofs and memberships use the actual owned
// loopback relay and native browser crypto. Room/Lobby/registry storage and staff
// authorization are checked separately by the Worker integration tests.
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const ROOT = '/r/45662413410ed051/';
const KEY = 'local-preview-key-0001';
const SAVED = /^Saved for community staff review\./;
const REPORT_KEYS = ['type', 'v', 'request', 'kind', 'target', 'claimedName', 'excerpt', 'reason', 'consent'].sort();
const fixtures = new Set();

test.skip(({ browserName }) => browserName !== 'chromium', 'Private report protocol fixtures use Chromium.');
test.afterEach(async () => {
    try {
        for (const fixture of fixtures) {
            expect(fixture.pageErrors).toEqual([]);
            expect(fixture.nonlocalHttp).toEqual([]);
            expect(fixture.nonlocalSockets).toEqual([]);
            if (fixture.page && !fixture.page.isClosed()) {
                expect(await fixture.page.evaluate(() => window.__privateReportWire?.errors || [])).toEqual([]);
            }
        }
    } finally {
        for (const fixture of fixtures) fixture.closing = true;
        await Promise.all([...fixtures].map(fixture => fixture.context.close()));
        fixtures.clear();
    }
});

async function visitor(browser, baseURL) {
    const context = await browser.newContext();
    const fixture = { context, page: null, controls: [], incoming: [], sockets: [], pageErrors: [],
        nonlocalHttp: [], nonlocalSockets: [], closing: false };
    fixtures.add(fixture);
    const origin = new URL(baseURL).origin;
    await context.route('**/*', route => {
        const requested = new URL(route.request().url());
        if (requested.origin === origin) return route.continue();
        fixture.nonlocalHttp.push(requested.origin);
        return route.abort();
    });
    // Install after navigation, once routeWebSocket's injected WebSocket class
    // exists, and before Enter creates the application's first socket. A context
    // init hook would instead observe Playwright's backing native connection.
    fixture.installWire = () => fixture.page.evaluate(() => {
        const wire = window.__privateReportWire = { sockets: [], rawAcks: [], completedAcks: [], chats: [], snapshots: [], errors: [] };
        let owner = WebSocket.prototype;
        while (owner && !Object.hasOwn(owner, 'onmessage')) owner = Object.getPrototypeOf(owner);
        const descriptor = owner && Object.getOwnPropertyDescriptor(owner, 'onmessage');
        if (!descriptor?.set) throw new Error('The actual page WebSocket message setter is unavailable.');
        const callbacks = new WeakMap(), generations = new WeakMap();
        Object.defineProperty(WebSocket.prototype, 'onmessage', {
            configurable: descriptor.configurable, enumerable: descriptor.enumerable,
            get() { return callbacks.get(this) || null; },
            set(callback) {
                callbacks.set(this, callback);
                if (typeof callback === 'function' && !generations.has(this)) {
                    generations.set(this, wire.sockets.length + 1);
                    wire.sockets.push({ socket: this, callback });
                    this.addEventListener('message', event => {
                        try {
                            const frame = JSON.parse(event.data);
                            if (frame.privateReport) wire.rawAcks.push({ generation: generations.get(this), ack: frame.privateReport });
                        } catch (_) { /* the ordinary handler owns malformed data */ }
                    });
                }
                descriptor.set.call(this, typeof callback === 'function' ? async function (event) {
                    const result = await callback.call(this, event);
                    try {
                        const frame = JSON.parse(event.data), generation = generations.get(this);
                        if (frame.privateReport) wire.completedAcks.push({ generation, ack: frame.privateReport });
                        if (frame.c && window.__hangout?.key) {
                            const message = await window.HangoutCore.open(window.__hangout.key, frame);
                            if (message.type === 'chat') wire.chats.push({ generation, from: frame.from, text: message.text });
                            if (message.type === 'snapshot' && message.done) wire.snapshots.push({ generation, from: frame.from,
                                to: message.to, fresh: window.__hangout.snapshotFresh, proved: window.__hangout.snapshotHasSeqProof });
                        }
                    } catch (_) { wire.errors.push('private-report-observation-failed'); }
                    return result;
                } : callback);
            }
        });
    });
    const page = fixture.page = await context.newPage();
    page.on('pageerror', error => fixture.pageErrors.push(error.message));
    await page.routeWebSocket(() => true, client => {
        const url = new URL(client.url());
        if (url.origin.replace(/^ws/, 'http') !== origin || !url.pathname.endsWith('/room')) {
            fixture.nonlocalSockets.push(url.origin);
            return client.close({ code: 1008, reason: 'fixture only permits its owned loopback relay' });
        }
        const server = client.connectToServer();
        const socket = { client, server, generation: fixture.sockets.length + 1 };
        fixture.sockets.push(socket);
        client.onMessage(raw => {
            if (fixture.closing) return;
            const frame = JSON.parse(String(raw));
            if (frame.type === 'private-report') {
                // Consume, do not forward: this dev relay has no staff backend.
                fixture.controls.push({ payload: frame, raw: String(raw), generation: socket.generation });
                return;
            }
            server.send(raw);
        });
        server.onMessage(raw => {
            if (fixture.closing) return;
            const frame = JSON.parse(String(raw));
            fixture.incoming.push({ generation: socket.generation, frame });
            // Only advertise the candidate UI contract; all relay IDs, content
            // frames, signatures, timestamps and connection behavior stay real.
            client.send(frame.welcome ? JSON.stringify({ ...frame, privateReports: true }) : raw);
        });
    });
    fixture.publish = (generation, ack) => fixture.sockets[generation - 1].client.send(JSON.stringify({ privateReport: ack }));
    fixture.ack = (index, changes = {}) => {
        const control = fixture.controls[index];
        const ack = { request: control.payload.request, ok: true, id: 'pr' + 'R'.repeat(43), status: 'pending', ...changes };
        fixture.publish(control.generation, ack);
        return ack;
    };
    return fixture;
}

async function join(fixture, url, nick) {
    await fixture.page.goto(url);
    await fixture.installWire();
    await fixture.page.fill('[data-name]', nick);
    await fixture.page.click('[data-enter]');
    await expect(fixture.page.locator('[data-room]')).toBeVisible();
    await expect.poll(() => fixture.page.evaluate(() => window.__hangout.connected && window.__hangout.privateReports)).toBe(true);
}

async function pair(browser, baseURL) {
    const relay = hangoutRelayWsBase(baseURL, 'private-reports-' + randomUUID());
    const host = await visitor(browser, baseURL);
    await join(host, new URL(ROOT + '?preview=' + KEY + '&relay=' + encodeURIComponent(relay), baseURL).href, 'ReportHost');
    const guest = await visitor(browser, baseURL);
    await join(guest, host.page.url(), 'ReportGuest');
    const hostId = await host.page.evaluate(() => window.__hangout.myId);
    try {
        // The handler can finish before its guarded atomic commit continuation.
        // Require the real receipt AND the eventual authenticated current state.
        await expect.poll(() => guest.page.evaluate(hostId => window.__privateReportWire.snapshots.some(entry =>
            entry.generation === 1 && entry.from === hostId && entry.to === window.__hangout.myId)
            && window.__hangout.snapshotFresh && window.__hangout.snapshotHasSeqProof && window.__hangout.snapshotFrom === hostId, hostId)).toBe(true);
    } catch (error) {
        const state = await Promise.all([host, guest].map(fixture => fixture.page.evaluate(() => {
            const app = window.__hangout, wire = window.__privateReportWire;
            return { id: app.myId, host: app.isHost, connected: app.connected, fresh: app.snapshotFresh,
                done: app.snapshotDone, proof: app.snapshotHasSeqProof, from: app.snapshotFrom,
                status: document.querySelector('[data-sync-status]').textContent,
                sockets: wire.sockets.length, snapshots: wire.snapshots, chats: wire.chats.length, errors: wire.errors };
        })));
        const statePath = test.info().outputPath('private-report-setup-state.json');
        fs.writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
        await test.info().attach('private-report-setup-state', { path: statePath, contentType: 'application/json' });
        throw error;
    }
    await expect.poll(() => guest.page.evaluate(hostId => window.__hangout.names.has(hostId), hostId)).toBe(true);
    for (const fixture of [host, guest]) {
        expect(await fixture.page.evaluate(() => ({ stream: window.__hangout.av.stream, peers: window.__hangout.av.peers.size })))
            .toEqual({ stream: null, peers: 0 });
    }
    return { host, guest, hostId };
}

async function say(fixture, text) {
    await fixture.page.fill('[data-text]', text);
    await fixture.page.press('[data-text]', 'Enter');
}

async function selectedReport(host, guest, text = 'Selected private line for human review') {
    await say(host, text);
    await expect(guest.page.locator('[data-log]')).toContainText(text);
    await guest.page.locator('[data-log] li').filter({ hasText: text }).locator('[data-message-report]').click();
    await expect(guest.page.locator('[data-report-dialog]')).toBeVisible();
    await expect(guest.page.locator('[data-report-excerpt]')).toHaveValue(text);
    return text;
}

async function submit(fixture, reason) {
    if (reason !== undefined) await fixture.page.fill('[data-report-reason]', reason);
    await fixture.page.check('[data-report-consent]');
    await fixture.page.click('[data-report-send]');
}

async function completedAck(fixture, ack, generation = fixture.sockets.length) {
    try {
        await expect.poll(() => fixture.page.evaluate(({ ack, generation }) => window.__privateReportWire.completedAcks.some(entry =>
            entry.generation === generation && JSON.stringify(entry.ack) === JSON.stringify(ack)), { ack, generation })).toBe(true);
    } catch (error) {
        const state = await fixture.page.evaluate(() => ({ raw: window.__privateReportWire.rawAcks, completed: window.__privateReportWire.completedAcks,
            errors: window.__privateReportWire.errors, connected: window.__hangout.connected,
            currentId: window.__hangout.myId, sockets: window.__privateReportWire.sockets.length,
            readyState: window.__hangout.ws.readyState, callback: typeof window.__hangout.ws.onmessage,
            status: document.querySelector('[data-report-status]').textContent }));
        const statePath = test.info().outputPath('private-report-ack-state.json');
        fs.writeFileSync(statePath, JSON.stringify({ expected: { ack, generation }, state }, null, 2), { mode: 0o600 });
        await test.info().attach('private-report-ack-state', { path: statePath, contentType: 'application/json' });
        throw error;
    }
}

async function closeOwnSocket(fixture, code) {
    return fixture.page.evaluate(async code => {
        const app = window.__hangout, socket = app.ws;
        window.__privateReportWire.retired = { socket, callback: socket.onmessage };
        const id = app.myId;
        await new Promise(resolve => {
            socket.addEventListener('close', resolve, { once: true });
            socket.close(code);
        });
        return { id, connected: app.connected, ended: app.ended, chat: app.state.chat.map(line => line.text),
            reportSendDisabled: document.querySelector('[data-report-send]').disabled };
    }, code);
}

async function invokeOldAck(fixture, ack) {
    await fixture.page.evaluate(async ack => {
        const { socket, callback } = window.__privateReportWire.retired;
        await callback.call(socket, new MessageEvent('message', { data: JSON.stringify({ privateReport: ack }) }));
        window.__privateReportWire.oldAckCompleted = true;
    }, ack);
    expect(await fixture.page.evaluate(() => window.__privateReportWire.oldAckCompleted)).toBe(true);
}

test('selected text-only chat needs consent and a matching ACK; report plaintext never reaches the other guest', async ({ browser, baseURL }) => {
    const { host, guest, hostId } = await pair(browser, baseURL);
    const unrelated = 'Nearby context must never be attached to this report';
    await say(host, unrelated);
    await expect(guest.page.locator('[data-log]')).toContainText(unrelated);
    const selected = await selectedReport(host, guest);
    const reason = 'A specific reporter-supplied concern, not an automatic transcript';
    await guest.page.fill('[data-report-reason]', reason);
    await expect(guest.page.locator('[data-report-send]')).toBeDisabled();
    expect(guest.controls).toEqual([]);
    await guest.page.press('[data-report-reason]', 'Tab');
    expect(guest.controls).toEqual([]);
    await submit(guest);
    await expect.poll(() => guest.controls.length).toBe(1);
    const control = guest.controls[0].payload;
    expect(Object.keys(control).sort()).toEqual(REPORT_KEYS);
    expect(control).toMatchObject({ type: 'private-report', v: 1, kind: 'message', target: hostId,
        claimedName: 'ReportHost', excerpt: selected, reason, consent: true });
    expect(control.request).toMatch(/^[A-Za-z0-9_-]{24}$/);
    const privateMaterial = await guest.page.evaluate(() => ({ room: window.__hangout.roomId,
        secret: new URLSearchParams(location.hash.slice(1)).get('r'), hostKey: new URLSearchParams(location.hash.slice(1)).get('h'), url: location.href }));
    for (const excluded of [unrelated, KEY, ...Object.values(privateMaterial)]) expect(guest.controls[0].raw).not.toContain(excluded);
    expect(await guest.page.evaluate(text => window.__privateReportWire.chats.find(entry => entry.text === text)?.from, selected)).toBe(hostId);
    await expect(guest.page.locator('[data-report-status]')).not.toHaveText(SAVED);
    const wrong = guest.ack(0, { request: 'W'.repeat(24) });
    await completedAck(guest, wrong);
    await expect(guest.page.locator('[data-report-status]')).not.toHaveText(SAVED);
    const matching = guest.ack(0);
    await completedAck(guest, matching);
    await expect(guest.page.locator('[data-report-status]')).toHaveText(SAVED);
    expect(host.controls).toEqual([]);
    expect(host.incoming.some(entry => entry.frame.type === 'private-report' || entry.frame.privateReport)).toBe(false);
    await guest.page.click('[data-report-close]');
    await say(host, 'Normal encrypted chat still arrives after staff reporting');
    await expect(guest.page.locator('[data-log]')).toContainText('Normal encrypted chat still arrives after staff reporting');
    await say(guest, 'The peer still receives ordinary encrypted chat');
    await expect(host.page.locator('[data-log]')).toContainText('The peer still receives ordinary encrypted chat');
});

test('storage failure retries the identical request and payload; edited uncertain details create a new report', async ({ browser, baseURL }) => {
    const { host, guest } = await pair(browser, baseURL);
    await selectedReport(host, guest);
    await submit(guest, 'First owned fixture report');
    await expect.poll(() => guest.controls.length).toBe(1);
    const original = structuredClone(guest.controls[0].payload);
    const failed = guest.ack(0, { ok: false, error: 'unavailable', status: 503 });
    await completedAck(guest, failed);
    await expect(guest.page.locator('[data-report-status]')).toContainText('Not confirmed');
    await expect(guest.page.locator('[data-report-status]')).not.toHaveText(SAVED);
    await guest.page.click('[data-report-retry]');
    await expect.poll(() => guest.controls.length).toBe(2);
    expect(guest.controls[1].payload).toEqual(original);
    await expect(guest.page.locator('[data-report-status]')).not.toHaveText(SAVED);
    const saved = guest.ack(1); await completedAck(guest, saved);
    await expect(guest.page.locator('[data-report-status]')).toHaveText(SAVED);
    await guest.page.click('[data-report-new]');
    await guest.page.fill('[data-report-name]', 'DepartedGuest');
    await submit(guest, 'An uncertain member report');
    await expect.poll(() => guest.controls.length).toBe(3);
    const uncertain = structuredClone(guest.controls[2].payload);
    const failure = guest.ack(2, { ok: false, error: 'unconfirmed', status: 503 });
    await completedAck(guest, failure);
    await guest.page.fill('[data-report-reason]', 'Edited details explicitly form a new report');
    await expect(guest.page.locator('[data-report-status]')).toContainText('earlier report was not confirmed');
    // A fill emits only one input event. Real continued typing must retain the
    // uncertain prior submission warning after its attempt object is cleared.
    await guest.page.locator('[data-report-reason]').pressSequentially('!');
    await expect(guest.page.locator('[data-report-status]')).toContainText('it may have been saved');
    await expect(guest.page.locator('[data-report-status]')).toContainText('creates a new report');
    await guest.page.locator('[data-report-reason]').pressSequentially(' More typed details');
    await expect(guest.page.locator('[data-report-status]')).toContainText('it may have been saved');
    await expect(guest.page.locator('[data-report-status]')).toContainText('creates a new report');
    await expect(guest.page.locator('[data-report-consent]')).not.toBeChecked();
    expect(guest.controls.length).toBe(3);
    await submit(guest);
    await expect.poll(() => guest.controls.length).toBe(4);
    expect(guest.controls[3].payload.request).not.toBe(uncertain.request);
    expect(guest.controls[3].payload.reason).toBe('Edited details explicitly form a new report! More typed details');
    await expect(guest.page.locator('[data-report-status]')).toContainText('Waiting for confirmation');
    const obsolete = guest.ack(2); await completedAck(guest, obsolete);
    await expect(guest.page.locator('[data-report-status]')).not.toHaveText(SAVED);
    const current = guest.ack(3); await completedAck(guest, current);
    await expect(guest.page.locator('[data-report-status]')).toHaveText(SAVED);
});

test('the 15-second UI deadline remains unconfirmed until an explicit identical retry is acknowledged', async ({ browser, baseURL }) => {
    const { host, guest } = await pair(browser, baseURL);
    await selectedReport(host, guest);
    await guest.page.clock.install();
    await submit(guest, 'Controlled deadline fixture');
    await expect.poll(() => guest.controls.length).toBe(1);
    const original = structuredClone(guest.controls[0].payload);
    await guest.page.clock.fastForward(15001);
    await expect(guest.page.locator('[data-report-status]')).toContainText('Not confirmed');
    await expect(guest.page.locator('[data-report-retry]')).toBeEnabled();
    const late = guest.ack(0); await completedAck(guest, late);
    await expect(guest.page.locator('[data-report-status]')).not.toHaveText(SAVED);
    expect(guest.controls.length).toBe(1);
    await guest.page.click('[data-report-retry]');
    await expect.poll(() => guest.controls.length).toBe(2);
    expect(guest.controls[1].payload).toEqual(original);
    const retried = guest.ack(1, { duplicate: true }); await completedAck(guest, retried);
    await expect(guest.page.locator('[data-report-status]')).toHaveText(SAVED);
});

test('real reconnect keeps the explicit report draft, clears delivered chat and ignores the old socket callback', async ({ browser, baseURL }) => {
    const { host, guest } = await pair(browser, baseURL);
    await guest.page.fill('[data-text]', 'An unsent ordinary composer draft');
    const selected = await selectedReport(host, guest, 'A received line before the real socket closes');
    const reason = 'Keep only this explicitly chosen report draft';
    await submit(guest, reason);
    await expect.poll(() => guest.controls.length).toBe(1);
    const original = structuredClone(guest.controls[0].payload);
    const disconnected = await closeOwnSocket(guest, 3000);
    expect(disconnected).toMatchObject({ connected: false, ended: false, chat: [] });
    expect(disconnected.reportSendDisabled).toBe(true);
    await expect(guest.page.locator('[data-report-excerpt]')).toHaveValue(selected);
    await expect(guest.page.locator('[data-report-reason]')).toHaveValue(reason);
    await expect.poll(() => guest.page.evaluate(id => window.__hangout.connected && window.__hangout.myId !== id, disconnected.id), { timeout: 15000 }).toBe(true);
    await expect.poll(() => guest.sockets.length).toBe(2);
    await expect(guest.page.locator('[data-text]')).toHaveValue('An unsent ordinary composer draft');
    await expect(guest.page.locator('[data-log]')).not.toContainText(selected);
    expect(guest.controls.length).toBe(1);
    await invokeOldAck(guest, { request: original.request, ok: true, id: 'pr' + 'O'.repeat(43), status: 'pending' });
    await expect(guest.page.locator('[data-report-status]')).toContainText('Not confirmed');
    await expect(guest.page.locator('[data-report-status]')).not.toHaveText(SAVED);
    await guest.page.click('[data-report-retry]');
    await expect.poll(() => guest.controls.length).toBe(2);
    expect(guest.controls[1]).toMatchObject({ generation: 2, payload: original });
    const saved = guest.ack(1); await completedAck(guest, saved, 2);
    await expect(guest.page.locator('[data-report-status]')).toHaveText(SAVED);
});

test('ending the real socket session clears the report and a later captured callback cannot restore success', async ({ browser, baseURL }) => {
    const { host, guest } = await pair(browser, baseURL);
    await selectedReport(host, guest, 'Owned quote cleared when the session ends');
    await submit(guest, 'Owned reason cleared when the session ends');
    await expect.poll(() => guest.controls.length).toBe(1);
    const original = structuredClone(guest.controls[0].payload);
    const ended = await closeOwnSocket(guest, 4401);
    expect(ended).toMatchObject({ connected: false, ended: true, chat: [] });
    await expect(guest.page.locator('[data-report-dialog]')).not.toBeVisible();
    await expect(guest.page.locator('[data-report-excerpt]')).toHaveValue('');
    await expect(guest.page.locator('[data-report-reason]')).toHaveValue('');
    await expect(guest.page.locator('[data-report-name]')).toHaveValue('');
    await expect(guest.page.locator('[data-report-consent]')).not.toBeChecked();
    await expect(guest.page.locator('[data-private-report]')).not.toBeVisible();
    await expect(guest.page.locator('[data-gate-status]')).toContainText('expired');
    await invokeOldAck(guest, { request: original.request, ok: true, id: 'pr' + 'E'.repeat(43), status: 'pending' });
    await expect(guest.page.locator('[data-report-status]')).not.toHaveText(SAVED);
    await expect(guest.page.locator('[data-report-excerpt]')).toHaveValue('');
    expect(guest.controls.length).toBe(1);
});

test('credential guards send nothing; a consented multiline member concern works with phone-width report controls', async ({ browser, baseURL }) => {
    const { host, guest, hostId } = await pair(browser, baseURL);
    await guest.page.click('[data-private-report]');
    // The known member list is independent of camera/microphone participation.
    await expect(guest.page.locator('[data-report-target] option[value="' + hostId + '"]')).toHaveText('ReportHost');
    await guest.page.click('[data-report-close]');
    const hostEnded = await closeOwnSocket(host, 4401);
    expect(hostEnded.ended).toBe(true);
    await expect.poll(() => guest.page.evaluate(hostId => window.__hangout.names.has(hostId), hostId)).toBe(false);
    await guest.page.click('[data-private-report]');
    await guest.page.fill('[data-report-name]', 'A departed host');
    await guest.page.fill('[data-report-reason]', 'A brief owned fixture concern');
    for (const width of [375, 390]) {
        await guest.page.setViewportSize({ width, height: 700 });
        const metrics = await guest.page.locator('[data-report-dialog]').evaluate(dialog => ({
            left: dialog.getBoundingClientRect().left, right: dialog.getBoundingClientRect().right,
            width: innerWidth, scroll: dialog.scrollWidth, client: dialog.clientWidth,
            sizes: [...dialog.querySelectorAll('input, textarea, select')].map(input => getComputedStyle(input).fontSize)
        }));
        expect(metrics.left).toBeGreaterThanOrEqual(0);
        expect(metrics.right).toBeLessThanOrEqual(metrics.width + 1);
        expect(metrics.scroll).toBeLessThanOrEqual(metrics.client + 1);
        expect(metrics.sizes.every(size => size === '16px')).toBe(true);
        await guest.page.locator('[data-report-send]').scrollIntoViewIfNeeded();
        const bounds = await guest.page.locator('[data-report-send]').boundingBox();
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
    }
    const secret = await guest.page.evaluate(() => new URLSearchParams(location.hash.slice(1)).get('r'));
    for (const unsafe of ['https://example.test/beta/#invite=fixture-only-code', secret, KEY]) {
        await guest.page.fill('[data-report-excerpt]', unsafe);
        await guest.page.check('[data-report-consent]');
        await guest.page.click('[data-report-send]');
        await expect(guest.page.locator('[data-report-status]')).toContainText('Remove invitation links');
        expect(guest.controls).toEqual([]);
    }
    const excerpt = 'An optional member quote\nA second short line';
    const reason = 'I could not reach the host.\nPlease review this concern.';
    await guest.page.fill('[data-report-excerpt]', excerpt);
    await submit(guest, reason);
    await expect.poll(() => guest.controls.length).toBe(1);
    expect(guest.controls[0].payload).toMatchObject({ kind: 'member', target: null, claimedName: 'A departed host', excerpt, reason, consent: true });
    const saved = guest.ack(0); await completedAck(guest, saved);
    await expect(guest.page.locator('[data-report-status]')).toHaveText(SAVED);
});
