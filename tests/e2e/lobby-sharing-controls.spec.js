// Actual Chromium client/loopback chat, with explicit synthetic own-status HTTP
// replies. Server identity/C2/native ordering is separately exercised by the
// SQLite gateway composition. These routes do not approve consent or test OTP.
const { randomUUID } = require('node:crypto');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');
const ROOT = '/r/45662413410ed051/lobby/';
const PREVIEW = 'local-preview-key-0001';
test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium client-only sharing status fixture');

async function scenario(browser, baseURL, width, { failure = false, camera = false } = {}) {
    const contexts = [], errors = [], relay = hangoutRelayWsBase(baseURL, `sharing-ui-${randomUUID()}`);
    const requests = []; let release, acknowledged = false, failed = failure;
    const pending = new Promise(resolve => release = resolve);
    async function guest(nick, controls = false) {
        const context = await browser.newContext({ viewport: { width, height: 667 }, permissions: ['local-network-access', ...(camera ? ['camera'] : [])] }); contexts.push(context);
        await context.route('**/*', route => new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort());
        if (controls) {
            await context.route(url => url.pathname === ROOT, async route => {
                const response = await route.fetch(); const html = await response.text();
                await route.fulfill({ response, body: html.replace('<head>', '<head><script src="/beta/bootstrap.js"></script>') });
            });
            await context.route('**/beta/bootstrap.js', route => route.fulfill({ contentType: 'text/javascript', body: 'window.HangoutParticipationControls=true;' }));
            await context.route('**/beta/participation', route => route.fulfill({ json: acknowledged
                ? { ok: true, state: 'withdrawn', available: false, purposes: [], revision: 3, canStop: true }
                : { ok: true, state: 'authorized', available: true, purposes: ['public-text', 'camera'], revision: 2, canStop: true } }));
            await context.route('**/beta/participation/stop', async route => {
                requests.push(route.request().postDataJSON());
                let timer; try { await Promise.race([pending, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Bounded sharing HTTP hold expired')), 7000); })]); } finally { clearTimeout(timer); }
                if (failed) return route.fulfill({ status: 503, json: { error: 'Synthetic unconfirmed write' } });
                acknowledged = true;
                await route.fulfill({ json: { ok: true, state: 'withdrawn', available: false, purposes: [], revision: 3, canStop: true, cleanup: 'confirmed' } });
            });
        }
        await context.addInitScript(({ camera }) => {
            window.__sharingSends = []; window.__sharingSocketCount = 0; window.__sharingCaptureCalls = 0;
            const NativeSocket = window.WebSocket;
            window.WebSocket = class extends NativeSocket {
                constructor(...args) { super(...args); this.sharingFixtureId = ++window.__sharingSocketCount; }
                send(raw) {
                    const value = JSON.parse(raw);
                    if (window.__sharingSends.length >= 128) throw Error('Sharing fixture metadata bound exceeded');
                    window.__sharingSends.push({ socket: this.sharingFixtureId, t: value.t, ...(value.name ? { name: value.name } : {}), ...(value.t === 'report' ? { id: value.id } : {}) });
                    return super.send(raw);
                }
            };
            if (navigator.mediaDevices?.getUserMedia) {
                const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
                navigator.mediaDevices.getUserMedia = (...args) => {
                    window.__sharingCaptureCalls++;
                    const native = capture(...args);
                    if (!camera) return native;
                    return native.then(stream => {
                        if (window.__sharingCapturedTracks.length + stream.getTracks().length > 8) throw Error('Sharing capture fixture bound exceeded');
                        window.__sharingCapturedTracks.push(...stream.getTracks()); return stream;
                    });
                };
            }
            if (camera) {
                window.__sharingCapturedTracks = []; window.__sharingPcs = [];
                const NativePeer = window.RTCPeerConnection;
                window.RTCPeerConnection = class extends NativePeer {
                    constructor(...args) {
                        super(...args);
                        if (window.__sharingPcs.length >= 8) throw Error('Sharing native peer fixture bound exceeded');
                        window.__sharingPcs.push(this);
                    }
                };
            }
        }, { camera });
        const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
        const diagnostics = []; page.on('console', message => { if (message.type() === 'error') diagnostics.push(message.text()); });
        page.on('websocket', socket => socket.on('socketerror', error => diagnostics.push(String(error))));
        const url = new URL(ROOT, baseURL); url.searchParams.set('preview', PREVIEW); url.searchParams.set('relay', relay);
        await page.goto(url.href); await page.fill('[data-nick]', nick); await page.click('[data-enter]');
        try { await expect(page.locator('[data-connection]')).toHaveText('Connected'); } catch (error) {
            console.log('SHARING_BROWSER_DIAGNOSTIC', JSON.stringify(await page.evaluate(() => ({ socket: window.__lobby?.ws?.url, sent: window.__sharingSends, gate: document.querySelector('[data-gate-status]').textContent, status: document.querySelector('[data-sharing-status]').textContent }))), errors, diagnostics);
            await Promise.allSettled(contexts.map(context => context.close())); throw error;
        }
        return page;
    }
    const host = await guest(`Sharing${width}`, true), other = await guest(`Other${width}`);
    return { host, other, requests, release, recover: () => { acknowledged = true; failed = false; }, errors,
        async close() { release(); await Promise.allSettled(contexts.map(context => context.close())); expect(errors).toEqual([]); } };
}
async function say(page, text) { await page.fill('[data-text]', text); await page.press('[data-text]', 'Enter'); }
async function geometry(page, width) {
    const result = await page.evaluate(() => {
        const bounds = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, bottom: r.bottom, top: r.top }; };
        return { viewport: innerWidth, page: document.documentElement.scrollWidth, input: bounds(document.querySelector('[data-text]')), send: bounds(document.querySelector('[data-send]')), height: innerHeight };
    });
    expect(result.viewport).toBe(width); expect(result.page).toBeLessThanOrEqual(width);
    expect(result.input.left).toBeGreaterThanOrEqual(0); expect(result.send.right).toBeLessThanOrEqual(width);
    expect(result.send.bottom).toBeLessThanOrEqual(result.height); expect(result.input.bottom).toBeLessThanOrEqual(result.height);
}
for (const width of [375, 390]) test(`own sharing confirmation preserves received reporting and phone layout at ${width}px`, async ({ browser, baseURL }, testInfo) => {
    testInfo.annotations.push({ type: 'scope', description: 'Actual client/loopback chat; synthetic own-status HTTP responses only. Server withdrawal/identity/SQLite proof is separate.' });
    const app = await scenario(browser, baseURL, width);
    try {
        await say(app.other, 'Received line kept for selected reporting'); await expect(app.host.locator('[data-buffer]')).toContainText('Received line kept for selected reporting');
        await app.host.locator('[data-sharing-controls] summary').click();
        await expect(app.host.locator('[data-sharing-status]')).toContainText('Sharing is available');
        await app.host.click('[data-sharing-stop]'); await app.host.click('[data-sharing-cancel]');
        await expect(app.host.locator('[data-sharing-stop]')).toBeFocused(); expect(app.requests).toEqual([]);
        await app.host.click('[data-sharing-stop]'); await app.host.click('[data-sharing-accept]');
        await expect(app.host.locator('[data-sharing-region]')).toBeFocused(); await expect(app.host.locator('[data-sharing-accept]')).toBeDisabled();
        expect(await app.host.evaluate(() => window.__lobby.sharingStopped)).not.toBe(true);
        app.release(); await expect(app.host.locator('[data-sharing-status]')).toContainText('Sharing is stopped');
        await expect(app.host.locator('[data-sharing-check]')).toBeFocused(); await expect(app.host.locator('[data-text]')).toBeDisabled();
        expect(app.requests).toEqual([{ expectedRevision: 2 }]);
        await expect(app.host.locator('[data-buffer]')).toContainText('Received line kept for selected reporting');
        const before = await app.host.evaluate(() => ({ count: window.__sharingSends.length, socket: window.__lobby.ws.sharingFixtureId }));
        await app.host.locator('[data-buffer] .flag').last().click(); await expect(app.host.locator('[data-buffer] .flag').last()).toHaveText('✓');
        const after = await app.host.evaluate(count => ({ sends: window.__sharingSends.slice(count), sockets: window.__sharingSocketCount, capture: window.__sharingCaptureCalls, socket: window.__lobby.ws.sharingFixtureId }), before.count);
        expect(after.sends.filter(frame => frame.t === 'report')).toHaveLength(1); expect(after.sends.every(frame => ['report', 'transport-ack'].includes(frame.t))).toBe(true);
        expect(after.socket).toBe(before.socket); expect(after.sockets).toBe(1); expect(after.capture).toBe(0);
        await geometry(app.host, width);
        await app.host.screenshot({ path: testInfo.outputPath(`sharing-stopped-${width}.png`) });
    } finally { await app.close(); }
});
test('unconfirmed Stop preserves unknown status and explicit reread recovers a saved withdrawal', async ({ browser, baseURL }) => {
    const app = await scenario(browser, baseURL, 390, { failure: true });
    try {
        await app.host.locator('[data-sharing-controls] summary').click(); await app.host.click('[data-sharing-stop]'); await app.host.click('[data-sharing-accept]');
        app.release(); await expect(app.host.locator('[data-sharing-status]')).toContainText('could not be confirmed');
        expect(await app.host.evaluate(() => window.__lobby.sharingStopped)).not.toBe(true);
        app.recover(); await app.host.click('[data-sharing-check]'); await expect(app.host.locator('[data-sharing-status]')).toContainText('Sharing is stopped');
        expect(await app.host.evaluate(() => window.__lobby.sharingStopped)).toBe(true);
    } finally { await app.close(); }
});

test.describe('active camera shutdown after own sharing confirmation', () => {
    test('Stop ends decoded camera capture and native peers while the same socket can report a received line', async ({ playwright, baseURL }, testInfo) => {
        testInfo.annotations.push({ type: 'scope', description: 'Actual client, loopback engine, native WebRTC and synthetic camera; only own-status HTTP replies are simulated. No backend withdrawal, remote-roster, hosted identity or WAN claim.' });
        const cameraBrowser = await playwright.chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
        const app = await scenario(cameraBrowser, baseURL, 390, { camera: true }).catch(async error => { await cameraBrowser.close(); throw error; });
        const decoded = page => page.evaluate(async () => {
            const state = window.__lobbyRoom?.state;
            if (!state) return { capture: window.__sharingCaptureCalls, localLive: false, peers: [] };
            return { capture: window.__sharingCaptureCalls, localLive: !!state.stream?.getVideoTracks().some(track => track.readyState === 'live'),
                peers: await Promise.all([...state.pcs.values()].map(async entry => {
                    const stats = await entry.pc.getStats(); let frames = 0;
                    stats.forEach(row => { if (row.type === 'inbound-rtp' && (row.kind === 'video' || row.mediaType === 'video')) frames += row.framesDecoded || 0; });
                    return { signaling: entry.pc.signalingState, connected: entry.pc.connectionState, frames,
                        liveTracks: entry.stream.getVideoTracks().filter(track => track.readyState === 'live').length };
                })), videoPixels: [...document.querySelectorAll('[data-act-tiles] video')].filter(video => video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0).length };
        });
        const requestCamera = async page => {
            await page.click('nav [data-show="chat"]'); await page.click('[data-cam]');
            await page.locator('[data-cam-gate] [data-adult]').check(); await page.locator('[data-cam-gate] [data-cam-yes]').click();
        };
        try {
            await say(app.host, '/join #art-sharing-camera'); await expect(app.host.locator('[data-chat-context]')).toHaveText('#art-sharing-camera');
            await say(app.other, '/join #art-sharing-camera'); await expect(app.other.locator('[data-chat-context]')).toHaveText('#art-sharing-camera');
            await requestCamera(app.host); await requestCamera(app.other);
            for (const page of [app.host, app.other]) await expect.poll(async () => {
                const state = await decoded(page);
                return state.capture === 1 && state.localLive && state.videoPixels === 2 && state.peers.length === 1
                    && state.peers.every(peer => peer.signaling === 'stable' && peer.connected === 'connected' && peer.frames > 0 && peer.liveTracks > 0);
            }).toBe(true);
            const beforeMedia = await Promise.all([decoded(app.host), decoded(app.other)]);
            await say(app.other, 'Received camera-room line kept after Stop');
            const selected = app.host.locator('[data-buffer] [data-id]').filter({ hasText: 'Received camera-room line kept after Stop' });
            await expect(selected).toBeVisible();
            await app.host.evaluate(() => {
                window.__sharingBeforeStop = { state: window.__lobbyRoom.state,
                    entries: [...window.__lobbyRoom.state.pcs.values()], videos: [...document.querySelectorAll('[data-act-tiles] video')] };
            });
            await app.host.locator('[data-sharing-controls] summary').click();
            const activePanelGeometry = await app.host.evaluate(() => {
                const bounds = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
                return { width: innerWidth, height: innerHeight, page: document.documentElement.scrollWidth,
                    input: bounds(document.querySelector('[data-text]')), send: bounds(document.querySelector('[data-send]')) };
            });
            await app.host.screenshot({ path: testInfo.outputPath('sharing-open-active-camera-390.png') });
            await app.host.click('[data-sharing-stop]'); await app.host.click('[data-sharing-accept]');
            await expect(app.host.locator('[data-sharing-accept]')).toBeDisabled();
            await expect.poll(() => app.requests.length).toBe(1);
            const pendingOptOut = await app.host.evaluate(() => ({
                capturedTracks: window.__sharingCapturedTracks.map(track => ({ kind: track.kind, state: track.readyState })),
                nativePeers: window.__sharingPcs.map(pc => pc.connectionState), roomPeers: window.__lobbyRoom.state.pcs.size,
                localStreamCleared: window.__lobbyRoom.state.stream === null, socketReady: window.__lobby.ws.readyState,
                savedPermissionConfirmed: window.__lobby.sharingStopped === true
            }));
            const otherWhilePending = await decoded(app.other);
            console.log('SHARING_PENDING_OPT_OUT_PROOF', JSON.stringify({ pendingOptOut, otherWhilePending, heldRequestCount: app.requests.length }));
            expect(pendingOptOut.capturedTracks).toEqual([{ kind: 'video', state: 'ended' }]);
            expect(pendingOptOut.roomPeers).toBe(0); expect(pendingOptOut.localStreamCleared).toBe(true);
            expect(pendingOptOut.nativePeers.every(state => state === 'closed')).toBe(true); expect(pendingOptOut.socketReady).toBe(1);
            expect(otherWhilePending.capture).toBe(1); expect(otherWhilePending.localLive).toBe(true);
            app.release(); await expect(app.host.locator('[data-sharing-status]')).toContainText('Sharing is stopped');
            const stopped = await app.host.evaluate(() => {
                const before = window.__sharingBeforeStop, state = window.__lobbyRoom.state;
                return { captureCalls: window.__sharingCaptureCalls, capturedTracks: window.__sharingCapturedTracks.map(track => ({ kind: track.kind, state: track.readyState })),
                    nativePeers: window.__sharingPcs.map(pc => pc.connectionState), retainedPeers: before.entries.map(entry => ({ state: entry.pc.connectionState,
                        liveTracks: entry.stream.getTracks().filter(track => track.readyState === 'live').length, pendingIce: entry.pendingIce.length })),
                    state: { channel: state.ch, stream: state.stream === null, peers: state.pcs.size, advertised: state.peers.size, camOn: state.camOn },
                    detachedVideos: before.videos.every(video => !video.isConnected && video.srcObject === null), tiles: document.querySelectorAll('[data-act-tiles] video').length,
                    socket: window.__lobby.ws.sharingFixtureId, readyState: window.__lobby.ws.readyState, socketCount: window.__sharingSocketCount, sends: window.__sharingSends.length };
            });
            expect(stopped.captureCalls).toBe(1); expect(stopped.capturedTracks).toEqual([{ kind: 'video', state: 'ended' }]);
            expect(stopped.nativePeers.length).toBeGreaterThan(0); expect(stopped.nativePeers.every(state => state === 'closed')).toBe(true);
            expect(stopped.retainedPeers).toEqual([{ state: 'closed', liveTracks: 0, pendingIce: 0 }]);
            expect(stopped.state).toEqual({ channel: null, stream: true, peers: 0, advertised: 0, camOn: false });
            expect(stopped.detachedVideos).toBe(true); expect(stopped.tiles).toBe(0); expect(stopped.readyState).toBe(1); expect(stopped.socketCount).toBe(1);
            const otherAfterStop = await decoded(app.other);
            expect(otherAfterStop.capture).toBe(1); expect(otherAfterStop.localLive).toBe(true);
            await expect(app.host.locator('[data-activity]')).toBeHidden(); await expect(app.host.locator('[data-text]')).toBeDisabled();
            await selected.locator('.flag').click(); await expect(selected.locator('.flag')).toHaveText('✓');
            const afterReport = await app.host.evaluate(offset => ({ sent: window.__sharingSends.slice(offset), capture: window.__sharingCaptureCalls,
                socket: window.__lobby.ws.sharingFixtureId, socketCount: window.__sharingSocketCount }), stopped.sends);
            expect(afterReport.sent.filter(frame => frame.t === 'report')).toHaveLength(1);
            expect(afterReport.sent.every(frame => ['report', 'transport-ack'].includes(frame.t))).toBe(true);
            expect(afterReport.capture).toBe(1); expect(afterReport.socket).toBe(stopped.socket); expect(afterReport.socketCount).toBe(1);
            expect(app.requests).toEqual([{ expectedRevision: 2 }]); await geometry(app.host, 390);
            console.log('SHARING_ACTIVE_CAMERA_PROOF', JSON.stringify({ beforeMedia, activePanelGeometry, pendingOptOut, otherWhilePending, stopped, otherAfterStop, afterReport }));
            await app.host.screenshot({ path: testInfo.outputPath('sharing-stopped-active-camera-390.png') });
            expect(activePanelGeometry.page).toBeLessThanOrEqual(activePanelGeometry.width);
            for (const box of [activePanelGeometry.input, activePanelGeometry.send]) {
                expect(box.left).toBeGreaterThanOrEqual(0); expect(box.right).toBeLessThanOrEqual(activePanelGeometry.width);
                expect(box.top).toBeGreaterThanOrEqual(0); expect(box.bottom).toBeLessThanOrEqual(activePanelGeometry.height);
            }
        } finally { try { await app.close(); } finally { await cameraBrowser.close(); } }
    });
});
