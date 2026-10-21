const { test, expect } = require('@playwright/test');

test('raw arcade discovery metadata and sitemap work without JavaScript at both hosting paths', async ({ browser, request, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
    const page = await context.newPage();
    try {
        for (const prefix of ['', '/StalemateSite']) {
            const response = await page.goto(prefix + '/play/');
            expect(response.status()).toBe(200);
            expect(response.headers()['x-robots-tag'] || '').not.toMatch(/noindex/i);
            await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index,follow');
            await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://stalemate.band/play/');
            await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', 'https://stalemate.band/play/');
            await expect(page.locator('a.game-card')).toHaveCount(7);
            const sitemap = await request.get(prefix + '/sitemap.xml');
            expect(sitemap.status()).toBe(200);
            expect(sitemap.headers()['content-type']).toContain('xml');
            expect(await sitemap.text()).toContain('<loc>https://stalemate.band/play/</loc>');
            expect((await sitemap.text()).match(/<loc>/g)).toHaveLength(2);
            const robots = await request.get(prefix + '/robots.txt');
            expect(robots.status()).toBe(200);
            expect(await robots.text()).toContain('Sitemap: https://stalemate.band/sitemap.xml');
            for (const file of ['TurdAnoid', 'turdtris', 'turdomania', 'turdjack', 'crapeights', 'turdrummy', 'turdspades', 'neon-arkanoid', 'hub']) {
                const game = await request.get(`${prefix}/play/${file}.html`);
                expect(game.status()).toBe(200);
                expect(await game.text()).toContain('<meta name="robots" content="noindex,nofollow">');
            }
        }
    } finally { await context.close(); }
});
