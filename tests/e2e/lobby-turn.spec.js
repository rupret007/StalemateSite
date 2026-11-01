const { randomUUID } = require('node:crypto');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');
test.use({ permissions: ['camera'], launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });

for (const cancellation of ['camera off', 'leave room']) {
    test(`lobby TURN uses a signed device and stops late capture after ${cancellation}`, async ({ page, baseURL }) => {
        const requests = [];
        await page.route((url) => url.pathname === '/lobby-turn', async (route) => {
            requests.push(route.request().postDataJSON());
            await route.fulfill({ json: { iceServers: [{ urls: 'turn:fixture.example:3478', username: 'fixture', credential: 'fixture-password' }], ttl: 600, expiresAt: Date.now() + 600000 } });
        });
        await page.addInitScript(() => {
            window.pendingStreams = [];
            const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
            navigator.mediaDevices.getUserMedia = async (constraints) => {
                const stream = await original(constraints); window.pendingStreams.push(stream);
                await new Promise((resolve) => { window.releaseCapture = resolve; });
                return stream;
            };
        });
        const relay = hangoutRelayWsBase(baseURL, `turn-${randomUUID()}`);
        await page.goto(`/r/45662413410ed051/lobby/?preview=local-preview-key-0001&relay=${encodeURIComponent(relay)}&turn=/lobby-turn`);
        await page.fill('[data-nick]', 'CameraTester'); await page.click('[data-enter]');
        await expect(page.locator('[data-app]')).toBeVisible();
        await page.click('[data-start="art"]');
        await expect(page.locator('[data-act-canvas]')).toBeVisible();
        await page.evaluate(() => __lobby.ws.send(JSON.stringify({ t: 'cam', ch: __lobby.active, on: true, adult18: true })));
        await expect.poll(() => page.evaluate(() => window.pendingStreams.length)).toBe(1);
        expect(requests).toHaveLength(1);
        expect(requests[0].room).toMatch(/^[a-f0-9]{64}$/);
        expect(requests[0].device).toBeUndefined();
        if (cancellation === 'camera off') {
            await page.evaluate(() => __lobby.ws.send(JSON.stringify({ t: 'cam', ch: __lobby.active, on: false })));
            await expect.poll(() => page.evaluate(() => __lobbyRoom.state.camOn)).toBe(false);
        } else {
            await page.evaluate(() => __lobby.cmd('part', [__lobby.active], __lobby.active));
            await expect.poll(() => page.evaluate(() => __lobbyRoom.state.ch)).toBeNull();
        }
        await page.evaluate(() => window.releaseCapture());
        await expect.poll(() => page.evaluate(() => pendingStreams.every((s) => s.getTracks().every((t) => t.readyState === 'ended')))).toBe(true);
        expect(await page.evaluate(() => __lobbyRoom.state.stream)).toBeNull();
    });
}
