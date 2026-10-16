const { test, expect } = require('./fixtures');

test('QR is a flyer landing for the next show', async ({ page }) => {
    await page.goto('/qr/');
    await expect(page).toHaveTitle(/Stalemate/);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('#show')).toContainText('Rockin’ October');
    await expect(page.locator('#show')).toContainText('Los Amigo’s');
    await expect(page.locator('#listen')).toHaveCount(0);
    await expect(page.locator('#follow')).toHaveCount(0);
    await expect(page.locator('a[href="http://rockinoctober.com"]').first()).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/ticket/i);
    await expect(page.locator('body')).not.toContainText('4rwTyXLXW0blHBUjQdJmA7');
});

for (const width of [320, 390, 800, 1440]) {
    test(`QR remains overflow-free and reachable at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/qr/');
        for (const section of ['#show']) {
            await page.locator(section).scrollIntoViewIfNeeded();
            expect(await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) <= innerWidth + 1)).toBe(true);
        }
        const brand = page.locator('.site-header a.brand');
        const box = await brand.boundingBox();
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.width).toBeGreaterThanOrEqual(44);
    });
}

test.describe('QR without JavaScript', () => {
    test.use({ javaScriptEnabled: false });
    test('keeps the show and festival link without loading previews', async ({ page }) => {
        await page.goto('/qr/');
        await expect(page.locator('#show')).toContainText('Rockin’ October');
        await expect(page.locator('[data-load-preview]')).toHaveCount(0);
        await expect(page.locator('iframe')).toHaveCount(0);
        await expect(page.locator('body')).not.toContainText(/ticket/i);
    });
});
