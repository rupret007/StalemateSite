const { test, expect } = require('@playwright/test');
const { readFileSync } = require('node:fs');

test('confirmed show calendar downloads at the correct instant and directions use the verified venue', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-21T23:00:00Z') });
    await page.goto('/StalemateSite/');
    const calendar = page.getByRole('link', { name: 'Save to calendar' });
    const directions = page.getByRole('link', { name: /Directions to Los Amigo/ });
    await expect(calendar).toBeVisible(); await expect(directions).toBeVisible();
    for (const control of [calendar, directions]) {
        const box = await control.boundingBox(); expect(box.height).toBeGreaterThanOrEqual(44);
    }
    const response = await page.request.get(await calendar.getAttribute('href'));
    expect(response.status()).toBe(200); expect(response.headers()['content-type']).toContain('text/calendar');
    const pending = page.waitForEvent('download'); await calendar.click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe('stalemate-rockin-october-2026.ics');
    const ics = readFileSync(await download.path(), 'utf8');
    expect(ics).toContain('DTSTART:20261024T214500Z\r\n');
    expect(ics).toContain('8604 Preston Rd Suite 100');
    expect(ics).not.toMatch(/^DTEND:|^DURATION:/m);
    const maps = new URL(await directions.getAttribute('href'));
    expect(maps.searchParams.get('destination')).toContain('8604 Preston Rd Suite 100, Plano TX 75024');
});

test('expired show actions disappear with the existing show cutoff', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-24T21:45:01Z') });
    await page.goto('/');
    await expect(page.locator('[data-track="show-calendar"]')).toBeHidden();
    await expect(page.locator('[data-track="show-directions"]')).toBeHidden();
    await expect(page.locator('.header-cta')).toHaveText('Follow the band');
});
