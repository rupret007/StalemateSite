const { test, expect } = require('./fixtures');

test('EPK carries short and long bios, hometown and tech docs', async ({ page }) => {
    await page.goto('/epk/');
    await expect(page).toHaveTitle(/press kit/i);
    await expect(page.locator('#short-bio-title')).toBeVisible();
    await expect(page.locator('#long-bio-title')).toBeVisible();
    await expect(page.locator('#bio')).toContainText(/punk rock/i);
    await expect(page.locator('#bio')).toContainText('Lewisville');
    await expect(page.locator('#bio')).toContainText('Flower Mound');
    await expect(page.locator('#bio')).toContainText('Better Than Now');
    await expect(page.locator('#bio')).not.toContainText(/\bJeff\b/);
    await expect(page.locator('#bio')).not.toContainText(/\bChe\b/);
    await expect(page.locator('#bio')).not.toContainText(/\bSean\b/);
    await expect(page.locator('#booking')).toHaveCount(0);
    await expect(page.locator('#music')).toHaveCount(0);
    await expect(page.locator('#video')).toHaveCount(0);
    await expect(page.locator('a[href="stage-plot.txt"]')).toBeVisible();
    await expect(page.locator('a[href="tech-rider.txt"]')).toBeVisible();
});

test.describe('EPK without JavaScript', () => {
    test.use({ javaScriptEnabled: false });
    test('keeps downloads and home links', async ({ page }) => {
        await page.goto('/epk/');
        await expect(page.getByRole('link', { name: 'Band homepage' })).toBeVisible();
        await expect(page.locator('a[download]')).toHaveCount(6);
    });
});
