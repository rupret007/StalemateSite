const { test, expect } = require('@playwright/test');
const { gameNight, room } = require('./chess-phone-fixture');

const CHESS = { game: 'chess', status: '[data-chess-status]' };
const panel = page => page.locator('details', { has: page.locator(CHESS.status) });

async function seated(fixture) {
    const pages = await room(fixture, ['PhoneHost', 'PhoneGuest']);
    for (const page of pages) {
        await page.getByRole('combobox', { name: 'Switch game' }).selectOption('chess');
        await expect(page.locator(CHESS.status)).toBeVisible();
    }
    await pages[0].getByRole('button', { name: 'Open Chess match' }).click();
    await pages[1].getByRole('button', { name: 'Join as Black' }).click();
    for (const page of pages) await expect(page.locator('.arcade-chess-board')).toBeVisible();
    return pages;
}

test('390×844 completed Chess keeps result and rematch usable through reconnect', async ({ browser, baseURL }) => {
    test.slow();
    const fixture = await gameNight(browser, baseURL);
    try {
        const pages = await seated(fixture);
        const record = await fixture.record('chess');
        const match = record.chess.match;
        await fixture.act('PhoneGuest', 'chess', {
            action: 'resign', id: record.chess.id,
            revision: match.revision ?? match.state?.revision ?? 0
        });

        for (const page of pages) {
            const reconnect = panel(page).locator('.arcade-reconnect');
            await page.context().setOffline(true);
            await expect(reconnect).toHaveText('Reconnecting…');
            const reconnectBox = await reconnect.boundingBox();
            expect(reconnectBox.x).toBeGreaterThanOrEqual(0);
            expect(reconnectBox.x + reconnectBox.width).toBeLessThanOrEqual(390);
            expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
            await page.context().setOffline(false);
            await expect(reconnect).toBeHidden();

            const status = page.locator(CHESS.status);
            const rematch = panel(page).getByRole('button', { name: /request rematch/i });
            await expect(status).toContainText(/wins ·|Checkmate|Draw ·/);
            await expect(rematch).toBeVisible();
            const box = await rematch.boundingBox();
            expect(box.height).toBeGreaterThanOrEqual(44);
            await expect(rematch).toBeInViewport();
            await expect(page.locator('.arcade-chess-board')).toBeInViewport();

            const layout = await page.evaluate(() => ({
                viewport: document.documentElement.clientWidth,
                document: document.documentElement.scrollWidth,
                status: (() => {
                    const el = document.querySelector('[data-chess-status]');
                    return { client: el.clientHeight, scroll: el.scrollHeight, text: el.innerText };
                })(),
                reconnect: (() => {
                    const el = document.querySelector('.arcade-reconnect');
                    if (!el || getComputedStyle(el).display === 'none' || !el.getClientRects().length) return null;
                    const r = el.getBoundingClientRect();
                    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
                })(),
                rematch: (() => { const r = document.querySelector('[data-chess-primary]')?.getBoundingClientRect(); return r && { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; })()
            }));
            expect(layout.document).toBeLessThanOrEqual(layout.viewport);
            expect(layout.status.scroll).toBeLessThanOrEqual(layout.status.client + 1);
            expect(layout.status.text).toMatch(/wins ·|Checkmate|Draw ·/);
            if (layout.reconnect) {
                expect(layout.reconnect.left).toBeGreaterThanOrEqual(0);
                expect(layout.reconnect.right).toBeLessThanOrEqual(layout.viewport);
                expect(layout.reconnect.bottom <= layout.rematch.top || layout.reconnect.top >= layout.rematch.bottom).toBe(true);
            }
        }
        expect(fixture.errors()).toEqual([]);
    } finally { await fixture.close(); }
});
