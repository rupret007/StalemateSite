const { test, expect } = require('./fixtures');

test('unknown paths render the 404 page with a way home', async ({ page }) => {
    const response = await page.goto('/this-square-is-empty');
    expect(response.status()).toBe(404);
    await expect(page).toHaveTitle(/Page not found/);
    await expect(page.locator('h1')).toContainText('Wrong song.');
    await expect(page.locator('#about-link')).toHaveAttribute('href', './#about');
});

test('404 under the GitHub Pages prefix still loads styles from the project root', async ({ page }) => {
    const response = await page.goto('/StalemateSite/missing/nested');
    expect(response.status()).toBe(404);
    await expect(page.locator('h1')).toContainText('Wrong song.');
    const baseHref = await page.locator('base').getAttribute('href');
    expect(baseHref).toBe('/StalemateSite/');
    await expect(page.locator('link[rel="stylesheet"][href="styles.css"]')).toHaveCount(1);
});

test.describe('404 without JavaScript', () => {
    test.use({ javaScriptEnabled: false });
    test('still offers homepage and about links', async ({ page }) => {
        await page.goto('/missing');
        await expect(page.getByRole('link', { name: 'Back home' })).toBeVisible();
        await expect(page.locator('#about-link')).toBeVisible();
    });
});
