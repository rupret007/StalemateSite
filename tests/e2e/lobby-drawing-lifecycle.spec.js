// Real local engine/WebSockets and browser mouse/keyboard events. The browser
// clock holds the existing 80ms brush flush across navigation deterministically.
const { randomUUID } = require('node:crypto');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

test('a held brush gesture cannot follow keyboard navigation into another shared room', async ({ browser, baseURL }, testInfo) => {
    const relay = hangoutRelayWsBase(baseURL, `drawing-lifetime-${randomUUID()}`);
    const url = `/r/45662413410ed051/lobby/?preview=local-preview-key-0001&relay=${encodeURIComponent(relay)}`;
    const contexts = [], errors = [];
    async function visitor(nick) {
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }); contexts.push(context);
        const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
        await page.route(/youtube\.com|ytimg|googlevideo|goatcounter/, route => route.abort());
        await page.goto(url); await page.fill('[data-nick]', nick); await page.click('[data-enter]');
        await expect(page.locator('[data-connection]')).toHaveText('Connected'); return page;
    }
    try {
        const host = await visitor('FirstArtist'), painter = await visitor('SecondArtist');
        await host.click('[data-start="art"]'); await expect(host.locator('[data-act-canvas]')).toBeVisible();
        const first = await host.evaluate(() => __lobby.active);
        // Discovery deliberately joins an existing activity. Request a distinct
        // permitted room explicitly so this test exercises a real room change.
        await painter.fill('[data-text]', '/join #art-second-lifecycle'); await painter.press('[data-text]', 'Enter');
        await expect(painter.locator('[data-act-canvas]')).toBeVisible();
        const second = await painter.evaluate(() => __lobby.active); expect(second).not.toBe(first);
        await host.evaluate(channel => __lobby.cmd('join', [channel]), second);
        await expect(host.locator('[data-chat-context]')).toHaveText(second);
        await painter.evaluate(channel => __lobby.cmd('join', [channel]), first);
        await expect(painter.locator('[data-chat-context]')).toHaveText(first);
        await painter.locator('[data-channel-key]').filter({ hasText: first }).click();
        await expect(painter.locator('[data-channel-key][aria-selected="true"]')).toBeFocused();
        await painter.clock.install(); await painter.clock.pauseAt(new Date(Date.now() + 500));
        let box = await painter.locator('[data-act-canvas]').boundingBox();
        await painter.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.1); await painter.mouse.down();
        await painter.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
        // The tab keeps focus because drawing prevents the pointer default.
        // ArrowLeft changes room while the old mouse button is still held.
        await painter.keyboard.press('ArrowLeft');
        await expect(painter.locator('[data-chat-context]')).toHaveText(second);
        await painter.clock.runFor(100); await painter.mouse.up();
        expect(await painter.evaluate(() => __lobbyRoom.state.room.strokes.length)).toBe(0);
        expect(await host.evaluate(() => __lobbyRoom.state.room.strokes.length)).toBe(0);
        box = await painter.locator('[data-act-canvas]').boundingBox();
        await painter.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6); await painter.mouse.down();
        await painter.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.7); await painter.mouse.up();
        await expect.poll(() => host.evaluate(() => __lobbyRoom.state.room.strokes.length)).toBe(1);
        const strokes = await host.evaluate(() => __lobbyRoom.state.room.strokes);
        expect(strokes[0].pts.every(([x, y]) => x > 0.5 && y > 0.5)).toBe(true);
        await host.screenshot({ path: testInfo.outputPath('new-room-current-gesture-only.png'), fullPage: true });
        expect(errors).toEqual([]);
    } finally { await Promise.all(contexts.map(context => context.close())); }
});

async function activityVisitors(browser, baseURL) {
    const relay = hangoutRelayWsBase(baseURL, `drawing-background-${randomUUID()}`);
    const url = `/r/45662413410ed051/lobby/?preview=local-preview-key-0001&relay=${encodeURIComponent(relay)}`;
    const contexts = [], errors = [], received = new Map(), providerRequests = new Map();
    async function visitor(nick, { fakeVideo = false } = {}) {
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }); contexts.push(context);
        const page = await context.newPage(); received.set(page, []); providerRequests.set(page, []);
        await page.addInitScript(() => {
            window.__activityCaptureCalls = 0;
            const original = navigator.mediaDevices.getUserMedia;
            navigator.mediaDevices.getUserMedia = function (...args) { window.__activityCaptureCalls++; return original.apply(this, args); };
        });
        page.on('request', request => { if (/youtube\.com|ytimg|googlevideo/.test(request.url())) providerRequests.get(page).push(request.url()); });
        page.on('pageerror', error => errors.push(error.message));
        page.on('websocket', socket => socket.on('framereceived', event => {
            const frame = JSON.parse(String(event.payload));
            if (frame.t === 'act') received.get(page).push(frame);
        }));
        await page.route(/youtube\.com|ytimg|googlevideo|goatcounter/, route => route.abort());
        if (fakeVideo) await page.route('https://www.youtube.com/iframe_api', route => route.fulfill({ path: require('node:path').join(__dirname, 'support/fake-youtube.js'), contentType: 'text/javascript' }));
        await page.goto(url); await page.fill('[data-nick]', nick); await page.click('[data-enter]');
        await expect(page.locator('[data-connection]')).toHaveText('Connected'); return page;
    }
    async function join(page, name) {
        await page.fill('[data-text]', `/join ${name}`); await page.press('[data-text]', 'Enter');
        await expect(page.locator('[data-chat-context]')).toHaveText(name);
        if (name.startsWith('#art-')) await expect(page.locator('[data-act-canvas]')).toBeVisible();
    }
    async function paint(page, channel, start, end) {
        const before = received.get(page).length;
        const box = await page.locator('[data-act-canvas]').boundingBox(); expect(box).not.toBeNull();
        await page.mouse.move(box.x + box.width * start, box.y + box.height * start); await page.mouse.down();
        await page.mouse.move(box.x + box.width * end, box.y + box.height * end); await page.mouse.up();
        // Observe the production engine's accepted stroke, rather than only
        // the sender's optimistic local drawing or an elapsed timer.
        await expect.poll(() => received.get(page).slice(before).find(frame => frame.ch === channel && frame.kind === 'stroke')?.stroke.id).toBeTruthy();
        const stroke = received.get(page).slice(before).find(frame => frame.ch === channel && frame.kind === 'stroke').stroke;
        await expect.poll(() => page.evaluate(id => __lobbyRoom.state.room.strokes.some(item => item.id === id), stroke.id)).toBe(true);
        return stroke.id;
    }
    const state = page => page.evaluate(() => ({
        channel: __lobbyRoom.state.ch,
        strokes: structuredClone(__lobbyRoom.state.room.strokes),
        video: __lobbyRoom.state.room.video,
        camera: __lobbyRoom.state.camOn,
        stream: __lobbyRoom.state.stream !== null,
        connections: __lobbyRoom.state.pcs.size,
        videoVisible: !document.querySelector('[data-act-video]').hidden,
        captureCalls: window.__activityCaptureCalls
    }));
    return { visitor, join, paint, state, received, providerRequests, errors, close: () => Promise.all(contexts.map(context => context.close())) };
}

async function activityEvidence(testInfo, name, data) {
    const file = testInfo.outputPath(`${name}.json`);
    await require('node:fs/promises').writeFile(file, JSON.stringify(data, null, 2));
    await testInfo.attach(name, { path: file, contentType: 'application/json' });
}

test('a background art update keeps its own canvas without replacing the visible room', async ({ browser, baseURL }, testInfo) => {
    const fixture = await activityVisitors(browser, baseURL);
    const { visitor, join, paint, state, received, errors } = fixture;
    try {
        const observer = await visitor('CanvasObserver'), painter = await visitor('BackgroundArtist');
        const first = '#art-cache-first', second = '#art-cache-second';
        await join(observer, first); const firstId = await paint(observer, first, 0.1, 0.2);
        await join(painter, second); const secondId = await paint(painter, second, 0.6, 0.7);
        expect(secondId).not.toBe(firstId);
        await join(observer, second);
        expect((await state(observer)).strokes.map(stroke => stroke.id)).toEqual([secondId]);
        await observer.locator(`[data-tabs] [data-channel-key="${first}"]`).click();
        await expect(observer.locator('[data-chat-context]')).toHaveText(first);
        await expect.poll(() => observer.evaluate(() => __lobbyRoom.state.room.strokes.map(stroke => stroke.id))).toEqual([firstId]);
        const activeBefore = await state(observer);
        const thirdId = await paint(painter, second, 0.35, 0.45);
        expect(new Set([firstId, secondId, thirdId]).size).toBe(3);
        await expect.poll(() => received.get(observer).some(frame => frame.ch === second && frame.kind === 'stroke' && frame.stroke.id === thirdId)).toBe(true);
        const activeAfter = await state(observer);
        const cachedBackground = await observer.evaluate(name => structuredClone(__lobby.chans.get(name).actSnap), second);
        const expectedBackground = (await state(painter)).strokes;
        // Navigation uses the actual existing membership/cache, with no new
        // join snapshot to repair or hide a dropped background update.
        await observer.locator(`[data-tabs] [data-channel-key="${second}"]`).click();
        await expect(observer.locator('[data-chat-context]')).toHaveText(second);
        const selectedBackground = await state(observer);
        await activityEvidence(testInfo, 'background-canvas-state', { first, second, firstId, secondId, thirdId, activeBefore, activeAfter, cachedBackground, expectedBackground, selectedBackground });
        await observer.screenshot({ path: testInfo.outputPath('background-room-own-canvas.png'), fullPage: true });
        expect(activeAfter).toEqual(activeBefore);
        expect(selectedBackground.strokes.map(stroke => stroke.id)).toEqual([secondId, thirdId]);
        expect(selectedBackground.strokes).toEqual(expectedBackground);
        expect(cachedBackground.strokes).toEqual(expectedBackground);
        expect(selectedBackground.strokes.some(stroke => stroke.id === firstId)).toBe(false);
        expect(selectedBackground).toMatchObject({ channel: second, video: null, camera: false, stream: false, connections: 0, videoVisible: false });
        expect(errors).toEqual([]);
    } finally { await fixture.close(); }
});

test('a background canvas clears and receives new paint while the lobby stays visible', async ({ browser, baseURL }, testInfo) => {
    const fixture = await activityVisitors(browser, baseURL);
    const { visitor, join, paint, state, received, errors } = fixture;
    try {
        const observer = await visitor('LobbyArtist'), painter = await visitor('ClearArtist');
        const first = '#art-lobby-first', second = '#art-lobby-second';
        await join(observer, first); const firstId = await paint(observer, first, 0.1, 0.2);
        await join(painter, second); const oldId = await paint(painter, second, 0.6, 0.7);
        await join(observer, second);
        expect((await state(observer)).strokes.map(stroke => stroke.id)).toEqual([oldId]);
        await observer.locator('[data-tabs] [data-channel-key="#stalemate"]').click();
        await expect(observer.locator('[data-chat-context]')).toHaveText('#stalemate');
        const lobbyBefore = await state(observer), beforeClear = received.get(observer).length;
        await painter.locator('[data-act-clear]').click();
        await expect.poll(() => received.get(observer).slice(beforeClear).some(frame => frame.ch === second && frame.kind === 'clear')).toBe(true);
        await expect.poll(() => painter.evaluate(() => __lobbyRoom.state.room.strokes.length)).toBe(0);
        expect(await observer.evaluate(name => __lobby.chans.get(name).actSnap.strokes, second)).toEqual([]);
        const newId = await paint(painter, second, 0.35, 0.45);
        await expect.poll(() => received.get(observer).some(frame => frame.ch === second && frame.kind === 'stroke' && frame.stroke.id === newId)).toBe(true);
        const lobbyAfter = await state(observer);
        const background = await observer.evaluate(name => structuredClone(__lobby.chans.get(name).actSnap), second);
        await observer.locator(`[data-tabs] [data-channel-key="${second}"]`).click();
        const selected = await state(observer);
        await activityEvidence(testInfo, 'background-clear-and-lobby', { firstId, oldId, newId, lobbyBefore, lobbyAfter, background, selected });
        expect(lobbyAfter).toEqual(lobbyBefore);
        expect(selected.strokes.map(stroke => stroke.id)).toEqual([newId]);
        expect(background.strokes).toEqual(selected.strokes);
        expect(selected).toMatchObject({ camera: false, stream: false, connections: 0, captureCalls: 0, video: null });
        // A real part removes membership/cache. A later live update cannot
        // recreate it, and only an explicit rejoin obtains a fresh snapshot.
        await observer.locator('[data-leave]').click();
        await expect(observer.locator('[data-chat-context]')).toHaveText('#stalemate');
        const departedId = await paint(painter, second, 0.8, 0.9);
        expect(received.get(observer).some(frame => frame.ch === second && frame.kind === 'stroke' && frame.stroke.id === departedId)).toBe(false);
        expect(await observer.evaluate(name => __lobby.chans.has(name), second)).toBe(false);
        await join(observer, second);
        expect((await state(observer)).strokes.map(stroke => stroke.id)).toEqual([newId, departedId]);
        await observer.locator(`[data-tabs] [data-channel-key="${first}"]`).click();
        expect((await state(observer)).strokes.map(stroke => stroke.id)).toEqual([firstId]);
        expect(errors).toEqual([]);
    } finally { await fixture.close(); }
});

test('a background playing video advances relay time while a private tab stays active', async ({ browser, baseURL }, testInfo) => {
    const fixture = await activityVisitors(browser, baseURL);
    const { visitor, join, state, received, providerRequests, errors } = fixture;
    try {
        const observer = await visitor('ClockObserver', { fakeVideo: true });
        const connectedAt = performance.now(); // After the actual server welcome/Connected UI witness.
        const host = await visitor('ClockHost', { fakeVideo: true });
        const art = '#art-clock-view', watch = '#watch-clock-background';
        await join(observer, art); await join(host, watch); await join(observer, watch);
        // The normal local relay retains its existing 1500ms PM eligibility
        // policy. Measure elapsed real time; do not retry a refused request.
        const fixtureMinimumMs = 1500;
        await expect.poll(() => performance.now() - connectedAt).toBeGreaterThanOrEqual(fixtureMinimumMs);
        await observer.fill('[data-text]', '/query ClockHost');
        const requestAt = performance.now();
        const pmEligibility = { clock: 'Node performance.now', connectedAt, requestAt, elapsedMs: requestAt - connectedAt, fixtureMinimumMs };
        await observer.press('[data-text]', 'Enter');
        await activityEvidence(testInfo, 'background-video-pm-eligibility', pmEligibility);
        await host.locator('[data-pmreqs]').getByRole('button', { name: 'Accept', exact: true }).click();
        await expect(observer.locator('[data-chat-context]')).toHaveText('PM · ClockHost');
        await host.locator(`[data-tabs] [data-channel-key="${watch}"]`).click();
        // Only the observer's browser clock is offset. The real relay's video
        // timestamp and all command/permission checks remain unchanged.
        await observer.clock.install({ time: Date.now() - 120000 });
        await host.fill('[data-act-url]', 'https://youtu.be/oh5p5f5_-7A'); await host.press('[data-act-url]', 'Enter');
        await expect.poll(() => host.evaluate(() => window.__ytLog?.length || 0)).toBe(1);
        await host.evaluate(() => { __ytLog[0].pauseVideo(); __ytLog[0].seekTo(37); __ytLog[0].playVideo(); });
        await expect.poll(() => received.get(observer).some(frame => frame.ch === watch && frame.kind === 'video' && frame.video.playing && frame.video.pos >= 37)).toBe(true);
        const before = await observer.evaluate(name => ({
            active: __lobby.active, room: __lobbyRoom.state.ch, video: structuredClone(__lobby.chans.get(name).actSnap.video),
            offset: __lobbyRoom.state.clock.offset, relayNow: __lobbyRoom.state.clock.relayNow(),
            players: window.__ytLog?.length || 0, captures: window.__activityCaptureCalls,
            stream: __lobbyRoom.state.stream !== null, connections: __lobbyRoom.state.pcs.size
        }), watch);
        expect(before.active).toMatch(/^pm:/); expect(before.room).toBeNull();
        expect(before.offset).toBeGreaterThan(110000);
        expect(before).toMatchObject({ players: 0, captures: 0, stream: false, connections: 0 });
        expect(providerRequests.get(observer)).toHaveLength(0);
        await observer.clock.pauseAt(new Date(await observer.evaluate(() => Date.now()) + 100));
        const expectedBefore = await observer.evaluate(name => HangoutCore.expectedPosition(__lobby.chans.get(name).actSnap.video, __lobbyRoom.state.clock.relayNow()), watch);
        await observer.clock.runFor(5000);
        const afterWait = await observer.evaluate(name => ({
            video: structuredClone(__lobby.chans.get(name).actSnap.video),
            expected: HangoutCore.expectedPosition(__lobby.chans.get(name).actSnap.video, __lobbyRoom.state.clock.relayNow()),
            players: window.__ytLog?.length || 0, captures: window.__activityCaptureCalls
        }), watch);
        expect(afterWait.video).toEqual(before.video);
        expect(afterWait.expected - expectedBefore).toBeCloseTo(5, 3);
        expect(afterWait).toMatchObject({ players: 0, captures: 0 });
        expect(providerRequests.get(observer)).toHaveLength(0);
        await observer.clock.resume();
        await observer.locator(`[data-tabs] [data-channel-key="${watch}"]`).click();
        await expect.poll(() => observer.evaluate(() => window.__ytLog?.length || 0)).toBe(1);
        await expect.poll(() => observer.evaluate(() => __lobbyRoom.player.yt?.getPlayerState())).toBe(1);
        const selected = await observer.evaluate(() => ({
            video: structuredClone(__lobbyRoom.state.room.video), offset: __lobbyRoom.state.clock.offset,
            expected: HangoutCore.expectedPosition(__lobbyRoom.state.room.video, __lobbyRoom.state.clock.relayNow()),
            actual: __lobbyRoom.player.yt.getCurrentTime(), captures: window.__activityCaptureCalls,
            stream: __lobbyRoom.state.stream !== null, connections: __lobbyRoom.state.pcs.size
        }));
        await activityEvidence(testInfo, 'background-playing-clock', { pmEligibility, before, expectedBefore, afterWait, selected, state: await state(observer), providerRequestsBeforeSelection: 0 });
        expect(selected.video).toEqual(before.video);
        expect(selected.expected).toBeGreaterThanOrEqual(before.video.pos + 5);
        expect(Math.abs(selected.actual - selected.expected)).toBeLessThan(1);
        expect(selected.offset).toBe(before.offset);
        expect(selected).toMatchObject({ captures: 0, stream: false, connections: 0 });
        expect(errors).toEqual([]);
    } finally { await fixture.close(); }
});
