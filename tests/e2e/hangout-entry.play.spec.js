const { test, expect, tapHeight } = require('./fixtures');

for (const prefix of ['', '/StalemateSite']) {
    test(`homepage Hang Out entry stays usable at ${prefix || '/'}`, async ({ page }) => {
        await page.goto(`${prefix}/`);

        const menu = page.getByRole('navigation', { name: 'Primary navigation' });
        const entry = menu.getByRole('link', { name: 'Hang Out', exact: true });
        await entry.click();
        await expect(page).toHaveURL(/#hang-out$/);

        const card = page.getByRole('region', { name: 'Hang Out' });
        await expect(card.getByRole('heading', { name: 'Hang Out' })).toBeInViewport();
        await expect(card).toContainText('New on the site');
        const open = card.getByRole('link', { name: 'Open Hang Out' });
        await expect(open).toHaveAttribute(
            'href',
            'https://stalemate-hangout-demo.jeffstory007.workers.dev/?via=stalemate'
        );
        expect(tapHeight(await open.boundingBox())).toBeGreaterThanOrEqual(44);

        await card.getByRole('link', { name: 'Play solo' }).click();
        await expect(page).toHaveURL(new RegExp(`${prefix}/play/$`));
        await expect(page.locator('.subtitle')).toContainText('choose 2 players in Royal Flush Chess to share one device');
        const online = page.getByRole('link', { name: /Hang Out online/ });
        expect(tapHeight(await online.boundingBox())).toBeGreaterThanOrEqual(44);
        await online.click();
        await expect(page).toHaveURL(new RegExp(`${prefix}/#hang-out$`));
        await card.getByRole('link', { name: 'Play solo' }).click();
        await page.getByRole('link', { name: /Royal Flush Chess/ }).click();
        await expect(page.getByRole('radio', { name: /1 player/ })).toBeChecked();
        await expect(page.getByRole('radio', { name: /2 players.*Share this device/ })).toBeVisible();
    });
}
