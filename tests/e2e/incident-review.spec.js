// Dedicated loopback-only fixture, real browser assets/fetch stream and actual
// lobby report persistence/I1. No hosted identity, production policy or TTL proof.
const { test, expect } = require('@playwright/test');

for (const width of [375, 390]) test(`restricted local incident launcher at ${width}px`, async ({ page }, testInfo) => {
    const { startIncidentReviewPreview } = await import('../../scripts/preview-incident-review.mjs');
    const preview = await startIncidentReviewPreview({ port: 0 }), errors = [], external = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin === new URL(preview.url).origin) return route.continue();
        external.push(url.origin); return route.abort();
    });
    try {
        await page.setViewportSize({ width, height: 844 }); await page.goto(preview.url);
        await page.getByRole('button', { name: 'Open local session', exact: true }).click();
        await expect(page.locator('main h1')).toHaveText('Restricted incident review · local fixture');
        await page.getByRole('button', { name: /^Flag benign sample: Benign local acceptance/ }).first().click();
        await page.locator('[data-source]').first().check(); await page.locator('[data-confirm-selection]').check();
        await page.getByRole('button', { name: 'Preserve selected report', exact: true }).click();
        await page.getByRole('button', { name: 'Open selected evidence', exact: true }).click();
        await expect(page.locator('[data-evidence]')).toContainText('shared drawing worked');
        await expect(page.locator('[data-evidence]')).not.toContainText('green pencil');
        await expect(page.locator('[data-evidence]')).toBeFocused();
        const geometry = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
            buttons: [...document.querySelectorAll('button')].map(node => ({ right: node.getBoundingClientRect().right, name: node.textContent })) }));
        await testInfo.attach('geometry', { body: JSON.stringify(geometry, null, 2), contentType: 'application/json' });
        await page.screenshot({ path: testInfo.outputPath(`incident-review-${width}.png`), fullPage: true });
        expect(geometry.scroll).toBeLessThanOrEqual(width); expect(geometry.buttons.every(button => button.right <= width)).toBe(true);
        await page.getByRole('button', { name: 'Mark triaged', exact: true }).click();
        await page.getByRole('button', { name: 'Close review', exact: true }).click();
        await expect(page.getByRole('region', { name: 'Current restricted case' })).toContainText('Preservation: active');
        await page.getByRole('button', { name: 'Release under approved local decision', exact: true }).click();
        await expect(page.getByRole('region', { name: 'Current restricted case' })).toContainText('Preservation: released');
        await page.getByRole('button', { name: 'Disconnect and clear', exact: true }).click();
        await expect(page.locator('main')).toContainText('Disconnected. Case details are cleared'); await expect(page.locator('[data-evidence]')).toHaveCount(0);
        await page.selectOption('#profile', 'moderator'); await page.getByRole('button', { name: 'Open local session', exact: true }).click();
        await expect(page.locator('main')).toContainText('no incident appointment'); await expect(page.locator('[data-open-case]')).toHaveCount(0);
        expect(errors).toEqual([]); expect(external).toEqual([]);
    } finally { await preview.close(); }
});
