const { randomUUID } = require('node:crypto');
const { openCanvasControls } = require('./support/lobby-canvas-controls');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const sizes = [{ width: 375, height: 812 }, { width: 390, height: 844 }, { width: 1440, height: 900 }, { width: 1440, height: 900, chatPadding: true }, { width: 1440, height: 900, resize: true }];

test('canonical canvas preserves pending gestures across remote commits and cancels them on clear', async ({ page }) => {
    await page.clock.install();
    await openCanvasControls(page);
    const first = await page.evaluate(async () => {
        const f = window.canvasControls;
        f.mouse('mousedown', .123456, .234567);
        f.mouse('mousemove', .345678, .456789);
        f.incoming({ id: 'remote-first', color: '#ed2765', size: 8, pts: [[.1, .8], [.8, .1]] });
        f.mouse('mouseup', .345678, .456789);
        const live = await f.pixels(), vectors = structuredClone(window.__lobbyRoom.state.room.strokes);
        f.snapshot();
        return { live, canonical: await f.pixels(), lengths: vectors.map(stroke => stroke.pts.length), local: vectors.at(-1).pts };
    });
    expect(first.lengths).toEqual([2, 2]);
    expect(first.local).toEqual([[.1235, .2346], [.3457, .4568]]);
    expect(first.live).toBe(first.canonical);
    await page.evaluate(() => {
        const f = window.canvasControls;
        f.mouse('mousedown', .6, .7); f.mouse('mousemove', .7, .6);
    });
    await page.clock.runFor(80);
    const afterFlush = await page.evaluate(async () => {
        const f = window.canvasControls;
        f.mouse('mousemove', .812345, .512345);
        f.incoming({ id: 'remote-first', color: '#ed2765', size: 8, pts: [[.9, .9]] });
        f.mouse('mouseup', .812345, .512345);
        const live = await f.pixels(); f.snapshot();
        return { live, canonical: await f.pixels() };
    });
    expect(afterFlush.live).toBe(afterFlush.canonical);
    const sentBefore = await page.evaluate(() => window.canvasControls.sent.length);
    await page.evaluate(() => {
        const f = window.canvasControls;
        f.mouse('mousedown', .2, .2); f.mouse('mousemove', .5, .5);
        f.room.onAct({ ch: f.channel.name, from: 'remote', kind: 'clear' });
        f.mouse('mouseup', .5, .5);
    });
    await page.clock.runFor(80);
    const cleared = await page.evaluate(() => {
        const f = window.canvasControls, data = f.canvas.getContext('2d').getImageData(0, 0, f.canvas.width, f.canvas.height).data;
        return { blank: data.every(value => value === 0), strokes: window.__lobbyRoom.state.room.strokes.length, sent: f.sent.length };
    });
    expect(cleared).toEqual({ blank: true, strokes: 0, sent: sentBefore });
});

test('canonical canvas handles empty, single-point and capped gestures', async ({ page }) => {
    await openCanvasControls(page);
    const result = await page.evaluate(async () => {
        const f = window.canvasControls, limit = window.HangoutCore.LIMITS.strokeTotalPoints;
        const empty = await f.pixels(); f.snapshot();
        const emptyCanonical = await f.pixels();
        f.mouse('mousedown', .123456, .234567); f.mouse('mouseup', .123456, .234567);
        const single = await f.pixels(); f.snapshot();
        const singleCanonical = await f.pixels();
        f.mouse('mousedown', .1, .1);
        for (let index = 1; index <= limit + 1; index++) {
            f.mouse('mousemove', .1 + .7 * index / (limit + 2), .4 + .1 * Math.sin(index / 100));
        }
        f.mouse('mouseup', .8, .4);
        const count = window.__lobbyRoom.state.room.strokes.at(-1).pts.length;
        const live = await f.pixels(); f.snapshot();
        return { empty, emptyCanonical, single, singleCanonical, live, canonical: await f.pixels(), count, limit };
    });
    expect(result.empty).toBe(result.emptyCanonical);
    expect(result.single).toBe(result.singleCanonical);
    expect(result.count).toBe(result.limit);
    expect(result.live).toBe(result.canonical);
});

test('canonical canvas reports realistic and retained-bound redraw cost', async ({ page }, testInfo) => {
    await openCanvasControls(page);
    const results = await page.evaluate(async () => {
        const f = window.canvasControls, H = window.HangoutCore, measurements = [];
        for (const [count, points] of [[128, 64], [H.LIMITS.strokesKept, H.LIMITS.strokeTotalPoints]]) {
            const strokes = Array.from({ length: count }, (_, stroke) => ({
                id: 'cost-' + stroke, color: H.COLORS[stroke % H.COLORS.length], size: 2,
                pts: Array.from({ length: stroke === count - 1 ? points - 16 : points }, (_, point) =>
                    [point / points, .5 + .1 * Math.sin(point / 80 + stroke)])
            }));
            const begin = performance.now();
            f.room.onJoin(f.channel, { strokes }); await f.pixels();
            const snapshotMs = performance.now() - begin, before = performance.now();
            f.incoming({ ...strokes.at(-1), pts: Array.from({ length: 16 }, (_, point) => [.9 + point / 200, .5]) });
            const live = await f.pixels(), continuingMs = performance.now() - before;
            const length = window.__lobbyRoom.state.room.strokes.at(-1).pts.length;
            f.snapshot();
            measurements.push({ count, points, snapshotMs, continuingMs, length, equal: live === await f.pixels() });
        }
        return measurements;
    });
    for (const result of results) {
        expect(result.equal).toBe(true);
        expect(result.length).toBe(result.points);
        expect(result.continuingMs).toBeLessThan(result.snapshotMs);
    }
    await testInfo.attach('canonical-canvas-cost', { body: JSON.stringify(results), contentType: 'application/json' });
});

async function checkControls(page) {
    const controls = page.getByRole('group', { name: 'Call controls' });
    await expect(controls).toBeInViewport();
    for (const selector of ['[data-mic]', '[data-cam]', '[data-room-chat-open]']) {
        await expect(controls.locator(selector)).toBeInViewport({ ratio: 1 });
    }
    const geometry = await page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        top: document.querySelector('#room-call-controls').getBoundingClientRect().top,
        bottom: document.querySelector('#room-call-controls').getBoundingClientRect().bottom
    }));
    expect(geometry.width).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
    return geometry;
}

for (const viewport of sizes) {
    test(`private room stage, chat and controls at ${viewport.width}x${viewport.height}${viewport.chatPadding ? " with compact chat padding" : ""}${viewport.resize ? " with phone and short-window resize" : ""}`, async ({ page, baseURL }, testInfo) => {
        await page.route(/youtube\.com|ytimg|googlevideo/, (route) => route.abort());
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        if (viewport.chatPadding) await page.addInitScript(() => {
            document.addEventListener("DOMContentLoaded", () => {
                const style = document.createElement("style");
                style.textContent = "#room-chat { padding-bottom: 0; }";
                document.head.append(style);
            });
        });
        await page.addInitScript(() => {
            window.roomCaptureRequests = 0;
            navigator.mediaDevices.getUserMedia = () => {
                window.roomCaptureRequests += 1;
                return Promise.reject(new DOMException('Fixture blocks capture', 'NotAllowedError'));
            };
        });
        const relay = hangoutRelayWsBase(baseURL, `room-workspace-${randomUUID()}`);
        await page.goto(`/r/45662413410ed051/?preview=local-preview-key-0001&relay=${encodeURIComponent(relay)}`);
        await page.locator('[data-name]').fill('RoomHost');
        await page.locator('[data-enter]').click();

        const start = page.getByRole('button', { name: 'Start video', exact: true });
        await expect(start).toBeVisible();
        await checkControls(page);
        await expect(page.locator('[data-mic]')).toHaveAccessibleName('Turn on my mic');
        await expect(page.locator('[data-cam]')).toHaveAccessibleName('Turn on my camera');
        await page.screenshot({ path: testInfo.outputPath('01-idle-stage.png') });

        await start.click();
        const prompt = page.getByRole('dialog', { name: 'Turn on your camera?' });
        await expect(prompt).toContainText('18+');
        expect(await page.evaluate(() => window.roomCaptureRequests)).toBe(0);
        await page.screenshot({ path: testInfo.outputPath('02-consent-before-capture.png') });
        await prompt.getByRole('button', { name: 'Not now' }).click();

        // Seed stand-in participants, then use the view control to render them without capture.
        await page.evaluate(() => {
            document.body.classList.add('faces-on');
            const { av, names } = window.__hangout;
            for (const [id, label] of [['speaker-fixture', 'Speaker'], ['guest-one', 'Guest one'], ['guest-two', 'Guest two']]) {
                names.set(id, label);
                av.peers.add(id);
            }
            document.querySelector('[data-view-toggle]').click();
        });
        const stage = page.locator('.tile--big');
        const strip = page.locator('[data-tiles] > .tile:not(.tile--big)').first();
        await expect(page.getByRole('button', { name: 'Grid view', exact: true })).toBeVisible();
        await expect(stage).toBeVisible();
        await expect(strip).toBeVisible();
        const stageBox = await stage.boundingBox();
        const tileBox = await strip.boundingBox();
        expect(stageBox.width).toBeGreaterThan(tileBox.width * 2);
        expect(tileBox.y).toBeGreaterThan(stageBox.y + stageBox.height);
        const call = await checkControls(page);
        if (viewport.width > 820) {
            const toolbar = page.getByRole('group', { name: 'Call controls' });
            await expect(toolbar.getByRole('button', { name: 'Show my real canvas', exact: true })).toBeInViewport({ ratio: 1 });
            expect(await toolbar.evaluate(bar => bar.scrollWidth)).toBeLessThanOrEqual(call.viewportWidth);
        }
        expect(tileBox.y + tileBox.height).toBeLessThanOrEqual(call.top);
        if (viewport.width <= 820) expect(call.height).toBeLessThanOrEqual(call.viewportHeight + 2);
        await page.screenshot({ path: testInfo.outputPath('03-speaker-stage-and-filmstrip.png') });

        const chat = page.getByRole('region', { name: 'Chat', exact: true });
        const open = page.getByRole('button', { name: 'Chat', exact: true });
        await open.click();
        await expect(chat.getByRole('heading', { name: 'Chat' })).toBeFocused();
        const message = chat.getByRole('textbox', { name: 'Message' });
        await message.fill('An unsent message stays here');
        if (viewport.resize) {
            await page.setViewportSize({ width: 390, height: 844 });
            await expect.poll(() => page.locator('[data-room-workspace]').evaluate(room => room.style.getPropertyValue('--workspace-chat-height'))).toBe('');
            await expect.poll(() => page.locator('[data-room-workspace]').evaluate(room => room.style.getPropertyValue('--workspace-stage-height'))).toBe('');
            await expect(message).toHaveValue('An unsent message stays here');
            await page.setViewportSize({ width: 1440, height: 700 });
            await expect(message).toHaveValue('An unsent message stays here');
        }
        if (viewport.width > 820) {
            const footer = page.locator('#room-call-controls');
            const hostControls = page.locator('.host-call button');
            await expect(hostControls).toHaveCount(2);
            await expect.poll(() => page.evaluate(() => {
                const footerTop = document.querySelector('#room-call-controls').getBoundingClientRect().top;
                return [...document.querySelectorAll('.host-call button, #room-chat .say > *')].every(control => {
                    const rect = control.getBoundingClientRect();
                    return rect.height > 0 && rect.top >= 0 && rect.bottom <= footerTop;
                });
            })).toBe(true);
            for (const control of await hostControls.all()) {
                await control.focus();
                await expect(control).toBeFocused();
                await control.click({ trial: true });
            }
            await expect(footer).toBeInViewport();
            await message.focus();
        }
        await page.screenshot({ path: testInfo.outputPath('04-chat-drawer.png') });

        await chat.getByRole('button', { name: 'Close chat' }).click();
        await expect(open).toBeFocused();
        await expect(chat).toBeHidden();
        await open.click();
        await expect(message).toHaveValue('An unsent message stays here');
        await expect(chat.getByRole('button', { name: 'Send' })).toBeInViewport({ ratio: 1 });
        expect(await page.evaluate(() => window.roomCaptureRequests)).toBe(0);
    });
}
