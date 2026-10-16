const { test, expect } = require('./fixtures');

test('homepage leads with tickets, songs and honest placeholders', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Stalemate/);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('#band-title')).toContainText('Stalemate');
    await expect(page.locator('#home a.button--tickets')).toHaveAttribute('href', '#shows');
    await expect(page.locator('#home a.button--listen')).toHaveAttribute('href', '#music');
    await expect(page.locator('#music')).toContainText('Better Than Now');
    await expect(page.locator('#music')).toContainText('Manic');
    await expect(page.locator('#about')).toContainText(/ska\/punk/i);
    await expect(page.locator('#about dt')).toHaveCount(0);
    await expect(page.locator('#home')).not.toContainText('[CITY NEEDED');
    await expect(page.locator('#shows')).toContainText('[DATE/VENUE/TICKET LINK NEEDED]');
    await expect(page.locator('#merch')).toContainText('[MERCH NEEDED]');
    await expect(page.locator('body')).toContainText('Not the SoCal pop-punk band');
    await expect(page.locator('body')).not.toContainText(/\bJeff\b/);
    await expect(page.locator('body')).not.toContainText(/\bChe\b/);
    await expect(page.locator('body')).not.toContainText(/\bSean\b/);
    const metadata = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent());
    expect(metadata['@type']).toBe('MusicGroup');
    expect(metadata.name).toBe('Stalemate');
    await expect(page.locator('body')).not.toContainText('4rwTyXLXW0blHBUjQdJmA7');
});

test('preview iframes stay dormant until a tap and stay local', async ({ page }) => {
    const requested = [];
    page.on('request', (request) => {
        if (/youtube|spotify|apple\.com/i.test(request.url())) requested.push(request.url());
    });
    await page.goto('/');
    const song = page.locator('#music [data-embed]').first();
    await expect(song.locator('iframe')).toHaveCount(0);
    await song.getByRole('button', { name: 'Load preview' }).click();
    await expect(song.locator('iframe')).toHaveAttribute('src', /embed-placeholder\.html/);
    expect(requested).toEqual([]);
});

for (const width of [320, 390, 768, 1440]) {
    test(`homepage remains usable without overlap at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/');
        for (const section of ['#home', '#music', '#shows', '#video', '#about', '#list', '#merch']) {
            await page.locator(section).scrollIntoViewIfNeeded();
            expect(await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) <= innerWidth + 1)).toBe(true);
        }
        const nav = page.getByRole('navigation', { name: 'Primary navigation', exact: true });
        for (const link of await nav.getByRole('link').all()) {
            expect((await link.boundingBox()).height).toBeGreaterThanOrEqual(44);
        }
        const tickets = page.locator('#home a.button--tickets');
        expect((await tickets.boundingBox()).height).toBeGreaterThanOrEqual(44);
    });
}

test.describe('homepage without JavaScript', () => {
    test.use({ javaScriptEnabled: false });
    test('keeps tickets, songs, list and merch usable', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#home a[href="#shows"]')).toBeVisible();
        await expect(page.locator('#music')).toContainText('Better Than Now');
        await expect(page.locator('[data-load-preview]:not([hidden])')).toHaveCount(0);
        await expect(page.locator('[data-share-band]:not([hidden])')).toHaveCount(0);
        await expect(page.locator('#list')).toContainText('[MAILING LIST TOOL NEEDED]');
        await expect(page.locator('#about')).toContainText(/ska\/punk/i);
        await expect(page.locator('#about dt')).toHaveCount(0);
        await expect(page.locator('#merch')).toContainText('Merch placeholder');
    });
});

test('the GitHub Pages project prefix serves the same homepage', async ({ page }) => {
    await page.goto('/StalemateSite/');
    await expect(page.locator('#band-title')).toContainText('Stalemate');
    await expect(page.locator('link[rel="stylesheet"][href="styles.css"]')).toHaveCount(1);
});
