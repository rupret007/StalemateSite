const { join } = require('node:path');
const { test, expect } = require('./fixtures');

test('unknown paths render the 404 page with a way home', async ({ page }) => {
    const response = await page.goto('/this-square-is-empty');
    expect(response.status()).toBe(404);
    await expect(page).toHaveTitle(/Page not found/);
    await expect(page.locator('h1')).toContainText('Wrong song.');
    const logo = page.locator('img#logo');
    await expect(logo).toHaveJSProperty('currentSrc', new URL('/assets/mark.svg', page.url()).href);
    await expect(page.locator('link[rel="icon"]')).toHaveJSProperty('href', new URL('/assets/favicon.svg', page.url()).href);
    await expect.poll(() => logo.evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
    await expect(page.locator('#about-link')).toHaveAttribute('href', './#about');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/this-square-is-empty#main-content$/);
    await expect(page.getByRole('main')).toBeFocused();
});

test('404 under the GitHub Pages prefix still loads styles from the project root', async ({ page }) => {
    const response = await page.goto('/StalemateSite/missing/nested');
    expect(response.status()).toBe(404);
    await expect(page.locator('h1')).toContainText('Wrong song.');
    const baseHref = await page.locator('base').getAttribute('href');
    expect(baseHref).toBe('/StalemateSite/');
    const logo = page.locator('img#logo');
    await expect(logo).toHaveJSProperty('currentSrc', new URL('/StalemateSite/assets/mark.svg', page.url()).href);
    await expect(page.locator('link[rel="icon"]')).toHaveJSProperty('href', new URL('/StalemateSite/assets/favicon.svg', page.url()).href);
    await expect.poll(() => logo.evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
    await expect(page.locator('link[rel="stylesheet"][href="styles.css"]')).toHaveCount(1);
    const navigation = page.getByRole('navigation', { name: 'Primary navigation' });
    await expect(navigation.getByRole('link', { name: 'Contact' })).toHaveAttribute('href', './#contact');
    await navigation.getByRole('link', { name: 'About' }).click();
    await expect(page).toHaveURL(/\/StalemateSite\/#about$/);
});

test.describe('404 without JavaScript', () => {
    test.use({ javaScriptEnabled: false });
    for (const prefix of ['', '/StalemateSite']) {
        test(`recovers from a nested missing page at ${prefix || '/'}`, async ({ page }) => {
            const home = 'https://stalemate.band/';
            const stylesheet = home + 'styles.css';
            const logoUrl = home + 'assets/mark.svg';
            const faviconUrl = home + 'assets/favicon.svg';
            await page.route(faviconUrl, route => route.fulfill({
                contentType: 'image/svg+xml',
                path: join(__dirname, '..', '..', 'assets', 'favicon.svg')
            }));
            await page.route(logoUrl, route => route.fulfill({
                contentType: 'image/svg+xml',
                path: join(__dirname, '..', '..', 'assets', 'mark.svg')
            }));
            await page.route(home, route => route.fulfill({
                contentType: 'text/html',
                body: '<title>Stalemate home</title><h1>Stalemate</h1>'
            }));
            await page.route(stylesheet, route => route.fulfill({
                contentType: 'text/css',
                body: '.lost-page-body { color: rgb(10, 20, 30); }'
            }));

            const cssResponse = page.waitForResponse(stylesheet);
            const missing = await page.goto(prefix + '/missing/nested/');
            expect(missing.status()).toBe(404);
            expect((await cssResponse).status()).toBe(200);
            const logo = page.locator('img#logo');
            await expect(logo).toHaveJSProperty('currentSrc', logoUrl);
            await expect(page.locator('link[rel="icon"]')).toHaveJSProperty('href', faviconUrl);
            await expect.poll(() => logo.evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
            await expect(page.locator('body')).toHaveCSS('color', 'rgb(10, 20, 30)');
            await expect(page.locator('#about-link')).toBeVisible();
            await expect(page.locator('#about-link')).toHaveAttribute('href', home + '#about');
            await expect(page.getByRole('link', { name: 'Open Stalemate Arcade' })).toHaveAttribute('href', home + 'play/');

            const back = page.getByRole('link', { name: 'Back home', exact: true });
            await expect(back).toBeVisible();
            await back.click();
            await expect(page).toHaveURL(home);
            await expect(page.getByRole('heading', { name: 'Stalemate' })).toBeVisible();
        });
    }
});
