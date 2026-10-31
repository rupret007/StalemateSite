const { test, expect } = require('@playwright/test');
const { runnerFlow, readyRunner } = require('../helpers/runner-flows');

for (const path of ['/play/turdrush.html', '/StalemateSite/play/turdrush.html']) test('Turd Rush native controls, deliberate resume and imported modules at ' + path, async ({ page }) => {
    await runnerFlow(page, test, path);
});

test('Turd Rush handles denied storage without losing its controls', async ({ page }) => {
    await page.addInitScript(() => { Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('Denied', 'SecurityError'); } }); });
    const errors = await readyRunner(page, test, '/play/turdrush.html');
    await page.locator('[data-rush-action=right]').click();
    await expect.poll(() => page.evaluate(() => __turdrush.state.player.lane)).toBe(2);
    expect(errors).toEqual([]);
});
