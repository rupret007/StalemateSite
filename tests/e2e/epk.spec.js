const { test, expect } = require('./fixtures');

test('EPK carries short and long bios, music, video and booking blanks', async ({ page }) => {
    await page.goto('/epk/');
    await expect(page).toHaveTitle(/press kit/i);
    await expect(page.locator('#short-bio-title')).toBeVisible();
    await expect(page.locator('#long-bio-title')).toBeVisible();
    await expect(page.locator('#bio')).toContainText(/ska\/punk/i);
    await expect(page.locator('#bio')).not.toContainText(/\bJeff\b/);
    await expect(page.locator('#bio')).not.toContainText(/\bChe\b/);
    await expect(page.locator('#bio')).not.toContainText(/\bSean\b/);
    await expect(page.locator('#music')).toContainText('Better Than Now');
    await expect(page.locator('#video')).toContainText('8 October 2026');
    await expect(page.locator('a[href="stage-plot.txt"]')).toBeVisible();
    await expect(page.locator('a[href="tech-rider.txt"]')).toBeVisible();
    await expect(page.locator('#booking')).toContainText('[BOOKING EMAIL NEEDED]');
});

test.describe('EPK without JavaScript', () => {
    test.use({ javaScriptEnabled: false });
    test('keeps downloads and home links', async ({ page }) => {
        await page.goto('/epk/');
        await expect(page.getByRole('link', { name: 'Band homepage' })).toBeVisible();
        await expect(page.locator('a[download]')).toHaveCount(6);
    });
});
