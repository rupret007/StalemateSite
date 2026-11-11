import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, webkit } from 'playwright';
import { expect } from '@playwright/test';

export async function runArcadeBrowser(engine, origin, invitation, evidence) {
    const browser = await { chromium, webkit }[engine].launch({ headless: true });
    const errors = [];
    async function guest(source, name, viewport, hasTouch = false) {
        const context = await browser.newContext({ viewport, hasTouch, reducedMotion: 'reduce', serviceWorkers: 'block' });
        await context.route('**/*', route => new URL(route.request().url()).origin === origin
            ? route.continue() : route.abort('blockedbyclient'));
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        page.on('pageerror', error => errors.push(`${name}: ${error.message}`));
        await page.goto(`${origin}/beta/?via=${source}`);
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
    try {
        const a = await guest('stalemate', 'ChessHost', { width: 1280, height: 900 });
        const b = await guest('rad-dad', 'ChessGuest', { width: 375, height: 667 }, true);
        await a.getByRole('button', { name: /Game Night/ }).click();
        await a.getByRole('button', { name: 'Invite players' }).click();
        const invite = a.locator('[data-invite-dialog]');
        await invite.getByLabel('Choose a current person').selectOption({ label: 'ChessGuest' });
        await invite.getByRole('button', { name: 'Invite selected person' }).click();
        await b.getByRole('button', { name: 'Join', exact: true }).click();
        for (const page of [a, b]) await page.getByText('Royal Flush Chess', { exact: true }).click();
        await a.getByRole('button', { name: 'Open Chess match' }).click();
        await b.getByRole('button', { name: 'Join as Black' }).click();
        await expect(a.locator('[data-chess-status]')).toHaveText('You’re White · Your turn');
        await moveByKeyboard(a, 'e2', 'ArrowUp', 2);
        await expect(b.getByRole('button', { name: 'e4, White pawn' })).toBeAttached();
        await tapSquare(b, 'e7');
        await tapSquare(b, 'e5');
        await expect(a.getByRole('button', { name: 'e5, Black pawn' })).toBeAttached();
        await b.locator('[data-text]').fill('Good game from Rad Dad');
        await b.locator('[data-send]').click();
        await expect(a.locator('[data-buffer]')).toContainText('Good game from Rad Dad');
        await a.getByRole('button', { name: 'Offer draw', exact: true }).click();
        await b.getByRole('button', { name: 'Accept draw', exact: true }).click();
        await expect(a.locator('[data-chess-status]')).toContainText('Draw by agreement');
        await a.getByRole('button', { name: 'Request rematch' }).click();
        await b.getByRole('button', { name: 'Accept rematch' }).click();
        await expect(b.locator('[data-chess-status]')).toHaveText('You’re White · Your turn');
        await expect(b.getByRole('button', { name: 'e2, White pawn' })).toBeAttached();
        await expect(b.locator('[data-send]')).toBeInViewport();
        assert.equal(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        if (evidence) {
            await mkdir(evidence, { recursive: true });
            await a.screenshot({ path: join(evidence, `chess-${engine}-desktop.png`) });
            await b.screenshot({ path: join(evidence, `chess-${engine}-phone.png`) });
        }
        assert.deepEqual(errors, []);
        console.log(`Passed ${engine} protected browser entry, invitation, keyboard/touch Chess, room chat, draw and rematch.`);
    } finally { await browser.close(); }
}
