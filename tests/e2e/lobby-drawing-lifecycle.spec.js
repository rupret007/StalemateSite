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
