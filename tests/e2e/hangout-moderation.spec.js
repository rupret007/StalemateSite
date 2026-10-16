const path = require('node:path');
const { test, expect } = require('@playwright/test');

const KEY = 'local-preview-key-0001';
let relay;
test.beforeAll(async ({ baseURL }) => {
    const { startRelay } = await import('../../scripts/hangout-relay-dev.mjs');
    relay = await startRelay({ previewKey: KEY, origins: new URL(baseURL).origin });
});
test.afterAll(async () => { if (relay) await relay.close(); });

async function join(page, url, name) {
    await page.route(/youtube\.com|ytimg|googlevideo/, (route) => route.abort());
    await page.route('https://www.youtube.com/iframe_api', (route) => route.fulfill({
        path: path.join(__dirname, 'support/fake-youtube.js'), contentType: 'text/javascript'
    }));
    await page.goto(url);
    await page.fill('[data-name]', name);
    await page.click('[data-enter]');
    await expect(page.locator('[data-room]')).toBeVisible();
}

test('late joiners reject replayed host actions older than their moderation snapshot', async ({ browser, page }) => {
    await join(page, `/r/45662413410ed051/?preview=${KEY}&relay=ws://127.0.0.1:${relay.port}`, 'Host');
    await page.click('[data-lock]');
    await expect(page.locator('[data-lock]')).toHaveText('Unlock faces');
    await page.click('[data-lock]');
    await expect(page.locator('[data-lock]')).toHaveText('Lock faces');
    const oldUnlock = await page.evaluate(() => window.__hangout.av.mods.lock);
    await page.click('[data-lock]');
    await expect(page.locator('[data-lock]')).toHaveText('Unlock faces');
    const currentSeq = await page.evaluate(() => window.__hangout.av.mods.lock.body.seq);

    const guestContext = await browser.newContext();
    try {
        const guest = await guestContext.newPage();
        await join(guest, page.url(), 'Late guest');
        await expect.poll(() => guest.evaluate(() => window.__hangout.av.locked)).toBe(true);
        // A room member can copy a genuine old signature; snapshot state must establish
        // the replay floor just as a live host command does.
        await guest.evaluate((signed) => window.__hangoutSend(signed), oldUnlock);
        await page.evaluate((signed) => window.__hangoutSend(signed), oldUnlock);
        await expect.poll(() => guest.evaluate(() => window.__hangout.lastHostSeq)).toBeGreaterThanOrEqual(currentSeq);
        await expect.poll(() => guest.evaluate(() => window.__hangout.av.locked)).toBe(true);
        expect(await page.evaluate(() => window.__hangout.av.locked)).toBe(true);
    } finally {
        await guestContext.close();
    }
});
