const { expect } = require('@playwright/test');

async function readyRunner(page, test, path) {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(path);
    await page.waitForFunction(() => window.__turdrush);
    if (!await page.evaluate(() => __turdrush.diagnostics.available)) {
        await expect(page.locator('#rush-unavailable')).toBeVisible();
        await expect(page.locator('#rush-reload')).toBeEnabled();
        test.skip(true, 'This browser environment has no WebGL2; recovery UI verified. Native gameplay is exercised in GPU-capable browser checks.');
    }
    await expect(page.locator('#rush-start')).toBeEnabled();
    await page.locator('#rush-start').click();
    await expect(page.locator('body')).toHaveAttribute('data-rush-phase', 'running');
    return errors;
}

async function runnerFlow(page, test, path) {
    const errors = await readyRunner(page, test, path);
    await page.locator('#rush-canvas').focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => page.evaluate(() => __turdrush.state.player.lane)).toBe(2);
    await expect.poll(() => page.evaluate(() => __turdrush.state.player.x)).toBe(2.4);
    await page.locator('[data-rush-action=left]').click();
    await expect.poll(() => page.evaluate(() => __turdrush.state.player.lane)).toBe(1);
    await page.locator('[data-rush-action=jump]').click();
    await expect.poll(() => page.evaluate(() => __turdrush.state.player.y)).toBeGreaterThan(0);
    await page.locator('#rush-pause').click();
    await expect(page.locator('#rush-paused')).toBeVisible();
    const paused = await page.evaluate(() => __turdrush.state);
    await page.waitForTimeout(180);
    expect(await page.evaluate(() => __turdrush.state)).toEqual(paused);
    await page.locator('#rush-help').click();
    await expect(page.locator('#rush-guide')).toBeVisible();
    await page.locator('#rush-close-help').click();
    await expect(page.locator('#rush-paused')).toBeVisible();
    await page.locator('#rush-resume').click();
    await expect.poll(() => page.evaluate(() => __turdrush.state.distance)).toBeGreaterThan(paused.distance);
    await page.locator('#rush-pause').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(await page.evaluate(() => innerWidth));
    expect(errors).toEqual([]);
}
module.exports = { readyRunner, runnerFlow };
