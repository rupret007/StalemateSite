import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, webkit } from 'playwright';
import { expect } from '@playwright/test';

export async function runArcadeBrowser(engine, origin, invitation, evidence, entrances) {
    const browser = await { chromium, webkit }[engine].launch({ headless: true });
    const errors = [];
    async function guest(source, name, viewport, hasTouch = false) {
        const context = await browser.newContext({ viewport, hasTouch, reducedMotion: 'reduce', serviceWorkers: 'block', ignoreHTTPSErrors: true });
        const entrance = entrances?.[source];
        await context.route('**/*', route => {
            const url = route.request().url();
            if (new URL(url).origin === origin) return route.continue();
            if (url === entrance?.url && route.request().isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: entrance.html });
            return route.abort('blockedbyclient');
        });
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        page.on('pageerror', error => errors.push(`${name}: ${error.message}`));
        const protectedBoard = await context.request.get(origin + '/play/games/chess-board.js');
        assert.equal(protectedBoard.status(), 401, 'anonymous match asset stays protected');
        const destination = `${origin}/beta/?via=${source}`;
        if (entrance) {
            await page.goto(entrance.url);
            const entry = page.getByRole('link', { name: 'Play online with friends' });
            await expect(entry).toHaveAttribute('href', destination);
            await Promise.all([
                page.waitForRequest(request => request.isNavigationRequest() && request.url() === destination),
                entry.click()
            ]);
        } else await page.goto(destination);
        await page.getByLabel('Invitation code').fill(invitation);
        await page.getByRole('button', { name: 'Enter the community' }).click();
        await page.getByRole('link', { name: /Choose a nickname and join/ }).click();
        await page.getByLabel('Your nick').fill(name);
        await page.locator('[data-enter]').click();
        await expect(page.locator('[data-connection]')).toHaveText('Connected');
        const label = source === 'rad-dad' ? 'via Rad Dad' : 'via Stalemate';
        await expect(page.locator('[data-entry-label]').first()).toHaveText(label);
        return page;
    }
    async function moveByKeyboard(page, from, arrow, count) {
        await page.locator(`[data-square="${from}"]`).focus();
        await page.keyboard.press('Enter');
        for (let n = 0; n < count; n++) await page.keyboard.press(arrow);
        await page.keyboard.press('Enter');
    }
    async function tapSquare(page, square) {
        const locator = page.locator(`[data-square="${square}"]`);
        await locator.scrollIntoViewIfNeeded();
        const box = await locator.boundingBox();
        assert.ok(box?.width > 22 && box?.height > 22);
        await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    }
    async function fit(page, label) {
        try {
            await expect(page.locator('.arcade-chess-board')).toBeInViewport({ ratio: 1 });
            await expect(page.locator('[data-send]')).toBeInViewport();
        } catch (error) {
            if (evidence) {
                await mkdir(evidence, { recursive: true });
                await page.screenshot({ path: join(evidence, `fit-failure-${engine}-${label}.png`) });
            }
            console.error('Chess fit', label, await page.evaluate(() => Object.fromEntries(
                ['.titlebar', '.tabs', '.roombar', '.game-night', '.arcade-chess', '.arcade-chess-board', '.buffer', '.say', '.phonetabs']
                    .map(selector => {
                        const node = document.querySelector(selector), rect = node.getBoundingClientRect();
                        return [selector, { top: rect.top, bottom: rect.bottom, height: rect.height, scrollTop: node.scrollTop }];
                    }))));
            throw error;
        }
    }
    try {
        const a = await guest('stalemate', 'ChessHost', { width: 1280, height: 900 });
        const b = await guest('rad-dad', 'ChessGuest', { width: 375, height: 667 }, true);
        await a.getByRole('button', { name: /Game Night/ }).click();
        await a.getByRole('button', { name: 'Invite players' }).click();
        const invite = a.locator('[data-invite-dialog]');
        await invite.getByLabel('Choose a current person').selectOption({ label: 'ChessGuest' });
        await invite.getByRole('button', { name: 'Invite selected person' }).click();
        await b.getByRole('button', { name: 'Join', exact: true }).click();
        await expect(b.getByRole('link', { name: 'Open Rad Dad Arcade' })).toHaveAttribute('href', 'https://raddadband.com/play/');
        for (const page of [a, b]) await page.getByText('Royal Flush Chess', { exact: true }).click();
        await a.getByRole('button', { name: 'Open Chess match' }).click();
        await b.getByRole('button', { name: 'Join as Black' }).click();
        await expect(a.locator('[data-chess-status]')).toHaveText('You’re White · Your turn');
        await fit(a, 'desktop');
        await fit(b, 'phone');
        await moveByKeyboard(a, 'e2', 'ArrowUp', 2);
        await expect(b.getByRole('button', { name: 'e4, White pawn' })).toBeAttached();
        await tapSquare(b, 'e7');
        await tapSquare(b, 'e5');
        await expect(a.getByRole('button', { name: 'e5, Black pawn' })).toBeAttached();
        await b.locator('[data-text]').fill('Good game from Rad Dad');
        await b.locator('[data-send]').click();
        await expect(a.locator('[data-buffer]')).toContainText('Good game from Rad Dad');
        await b.reload();
        await expect(b.getByLabel('Your nick')).toHaveValue('ChessGuest');
        await b.locator('[data-enter]').click();
        await expect(b.locator('[data-chess-status]')).toHaveText('You’re Black · White to move');
        await expect(b.getByRole('button', { name: 'e5, Black pawn' })).toBeVisible();
        await expect(a.getByRole('button', { name: 'e5, Black pawn' })).toBeVisible();
        await expect(b.getByRole('link', { name: 'Back to Rad Dad' })).toBeVisible();
        await expect(b.locator('[data-buffer]')).not.toContainText('Good game from Rad Dad');
        await b.getByText('Four in a Row', { exact: true }).click();
        await expect(b.locator('[data-four]')).toHaveAttribute('open', '');
        await expect(b.locator('.arcade-chess')).not.toHaveAttribute('open', '');
        await b.getByText('Royal Flush Chess', { exact: true }).click();
        await expect(b.getByRole('button', { name: 'e5, Black pawn' })).toBeVisible();
        await expect(b.locator('[data-four]')).not.toHaveAttribute('open', '');
        await b.locator('[data-text]').fill('Back at the same board');
        await b.locator('[data-send]').click();
        await expect(a.locator('[data-buffer]')).toContainText('Back at the same board');
        await a.getByRole('button', { name: 'Offer draw', exact: true }).click();
        await b.getByRole('button', { name: 'Accept draw', exact: true }).click();
        await expect(a.locator('[data-chess-status]')).toContainText('Draw by agreement');
        await a.getByRole('button', { name: 'Request rematch' }).click();
        await b.getByRole('button', { name: 'Accept rematch' }).click();
        await expect(b.locator('[data-chess-status]')).toHaveText('You’re White · Your turn');
        await expect(b.getByRole('button', { name: 'e2, White pawn' })).toBeAttached();
        await fit(a, 'desktop-rematch');
        await fit(b, 'phone-rematch');
        assert.equal(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        if (evidence) {
            await mkdir(evidence, { recursive: true });
            await a.screenshot({ path: join(evidence, `chess-${engine}-desktop.png`) });
            await b.screenshot({ path: join(evidence, `chess-${engine}-phone.png`) });
        }
        await b.setViewportSize({ width: 390, height: 844 });
        await fit(b, 'phone-tall');
        await b.locator('[data-leave]').click();
        await expect(b.locator('[data-game-night]')).toBeHidden();
        await b.reload();
        await b.locator('[data-enter]').click();
        await expect(b.locator('[data-connection]')).toHaveText('Connected');
        await expect(b.locator('[data-game-night]')).toBeHidden();
        assert.deepEqual(errors, []);
        console.log(`Passed ${engine} ${entrances ? 'both generated arcade entry links' : 'protected entry with both brand contexts'}, invitation, keyboard/touch Chess, room chat, draw and rematch.`);
    } finally { await browser.close(); }
}
