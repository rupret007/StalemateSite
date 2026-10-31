const { expect } = require('@playwright/test');

const activate = (locator, touch) => touch ? locator.tap() : locator.click();

async function rummyWithoutStorage(page, url, touch) {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
        Object.defineProperty(window, 'localStorage', { configurable: true, get() {
            throw new DOMException('Storage denied for regression check', 'SecurityError');
        } });
    });
    await page.goto(url);
    await activate(page.locator('#startRoundBtn'), touch);
    if (await page.locator('#coachSkipBtn').isVisible()) await activate(page.locator('#coachSkipBtn'), touch);
    await expect(page.locator('#drawStockBtn')).toBeEnabled();
    await activate(page.locator('#drawStockBtn'), touch);
    await expect(page.locator('#playerHand [data-hand-id]')).toHaveCount(11);
    await activate(page.locator('#playerHand button[data-card-id]:visible').first(), touch);
    await activate(page.locator('#discardBtn'), touch);
    await expect(page.locator('#playerHand [data-hand-id]')).toHaveCount(10);
    const hard = page.locator('.suite-difficulty-btn[data-level="hard"]');
    // On phones the existing Table menu contains the difficulty controls.
    if (!await hard.isVisible()) await activate(page.locator('.mobile-settings summary'), touch);
    await activate(hard, touch);
    await expect(page.locator('.suite-difficulty-btn[data-level="hard"]')).toHaveAttribute('aria-pressed', 'true');
    expect(errors).toEqual([]);
}

async function qrDownloadRetry(page, url, touch) {
    let fail = true, restoredRequests = 0;
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/play/stalemate/manic.m4a', route => {
        if (fail) return route.abort();
        restoredRequests++; return route.continue();
    });
    await page.goto(url);
    const button = page.locator('[data-qr-play]');
    await expect(button).toHaveText('↻ Retry Manic');
    await expect(page.locator('[data-qr-status]')).toContainText('Check your connection');
    fail = false;
    await activate(button, touch);
    await expect.poll(() => page.locator('[data-qr-audio]').evaluate(audio => audio.currentTime)).toBeGreaterThan(0.25);
    expect(restoredRequests).toBeGreaterThan(0);
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-qr-status]')).toBeEmpty();
    await activate(button, touch);
    await expect.poll(() => page.locator('[data-qr-audio]').evaluate(audio => audio.paused)).toBe(true);
    expect(errors).toEqual([]);
}

module.exports = { rummyWithoutStorage, qrDownloadRetry };
