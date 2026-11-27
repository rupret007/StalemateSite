const { test, expect, tapHeight } = require('./fixtures');

for (const prefix of ['', '/StalemateSite']) {
    test(`homepage Hang Out entry stays usable at ${prefix || '/'}`, async ({ page }) => {
        const destination = 'https://stalemate-hangout-demo.jeffstory007.workers.dev/?via=stalemate';
        await page.route(url => url.href === destination, route => route.fulfill({
            contentType: 'text/html',
            body: '<!doctype html><html lang="en"><title>Hang Out</title><h1>Pick a nickname</h1></html>'
        }));
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
            destination
        );
        expect(tapHeight(await open.boundingBox())).toBeGreaterThanOrEqual(44);

        await card.getByRole('link', { name: 'Single player', exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`${prefix}/play/$`));
        await expect(page.locator('.subtitle')).toHaveText('Nine single-player games. In Royal Flush Chess, choose 2 players to share one device.');
        const online = page.getByRole('link', { name: /Multiplayer online/ });
        expect(tapHeight(await online.boundingBox())).toBeGreaterThanOrEqual(44);
        await online.click();
        await expect(page).toHaveURL(destination);
        await expect(page.getByRole('heading', { name: 'Pick a nickname' })).toBeVisible();
        await page.goBack();
        await page.getByRole('link', { name: /Royal Flush Chess/ }).click();
        await expect(page.getByRole('radio', { name: /1 player/ })).toBeChecked();
        await expect(page.getByRole('radio', { name: /2 players.*Share this device/ })).toBeVisible();
    });
}
