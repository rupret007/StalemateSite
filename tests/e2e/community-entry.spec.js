// Real loopback sockets and three separate website origins. Registry, identity
// and website pages are explicit fixtures, not hosted-domain/Access evidence.
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

async function entrySite(href, label) {
    const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
        res.end(`<!doctype html><html lang="en"><title>${label} entry fixture</title><h1>${label}</h1><a href="${href.replace(/&/g, '&amp;')}">Hang Out</a></html>`);
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    return { url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((resolve) => { server.closeIdleConnections(); server.close(resolve); }) };
}

for (const width of [375, 390]) test(`three website entrances share chat, source choices and creative rooms at ${width}px`, async ({ browser, baseURL }, testInfo) => {
    const { communityIntegration, communityJoinLink } = await import('../../hangout-worker/src/community-integration.mjs');
    const integration = communityIntegration({ version: 1, communityAddress: `${baseURL}/r/45662413410ed051/lobby/`, sites: [
        { id: 'stalemate', label: 'Stalemate', origins: ['https://stalemate.band'], returnUrl: 'https://stalemate.band/', permissions: ['link', 'badge', 'return'], enabled: true, domainVerified: true },
        { id: 'rad-dad', label: 'Rad Dad', origins: ['https://raddadband.com'], returnUrl: 'https://raddadband.com/', permissions: ['link', 'badge', 'return'], enabled: true, domainVerified: true },
        { id: 'makers', label: 'Makers & Friends', origins: ['https://makers.example.test'], permissions: ['link', 'badge'], enabled: true, domainVerified: true }
    ] }, { allowLoopback: true });
    const relay = hangoutRelayWsBase(baseURL, `shared-community-${randomUUID()}`);
    const websites = []; const contexts = []; const pages = []; const errors = []; let firstLineObservedAt = 0;
    try {
        for (const [index, site] of integration.sites.entries()) {
            const target = new URL(communityJoinLink(integration, site.id).href);
            target.searchParams.set('preview', 'local-preview-key-0001');
            target.searchParams.set('relay', relay);
            const website = await entrySite(target.href, site.label); websites.push(website);
            const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: 'reduce' }); contexts.push(context);
            await context.addInitScript(() => { window.HangoutEntrySites = [{ id: 'makers', label: 'Makers & Friends' }]; });
            const page = await context.newPage(); pages.push(page);
            page.on('pageerror', (error) => errors.push(error.message));
            await page.route(/youtube\.com|ytimg|googlevideo|goatcounter/, (route) => route.abort());
            await page.goto(website.url);
            await page.getByRole('link', { name: 'Hang Out', exact: true }).click();
            await expect(page.locator('[data-entry-label]').first()).toHaveText(`via ${site.label}`);
            if (index === 1) await page.locator('[data-entry-share]').first().uncheck();
            await page.fill('[data-nick]', ['StaleVisitor', 'RadVisitor', 'MakerVisitor'][index]);
            await page.click('[data-enter]');
            await expect(page.locator('[data-app]')).toBeVisible();
            expect(new URL(page.url()).origin).toBe(new URL(baseURL).origin);
            if (index === 0) {
                await page.fill('[data-text]', 'A line sent before the other sites arrive'); await page.press('[data-text]', 'Enter');
                await expect(page.locator('[data-buffer]')).toContainText('A line sent before the other sites arrive');
                firstLineObservedAt = Date.now();
            } else await expect(page.locator('[data-buffer]')).not.toContainText('A line sent before the other sites arrive');
        }
        expect(new Set(websites.map((site) => new URL(site.url).origin)).size).toBe(3);
        // Respect the actual lobby's 3-second per-author slow mode; this is a
        // protocol deadline, not a render/connection-settling sleep.
        await new Promise((resolve) => setTimeout(resolve, Math.max(0, 3000 - (Date.now() - firstLineObservedAt))));
        await pages[0].fill('[data-text]', 'Hello everyone, from the shared lobby'); await pages[0].press('[data-text]', 'Enter');
        for (const page of pages) {
            const line = page.locator('[data-buffer] li').filter({ hasText: 'Hello everyone, from the shared lobby' });
            await expect(line).toContainText('via Stalemate');
        }
        await pages[1].fill('[data-text]', 'My entry badge is hidden'); await pages[1].press('[data-text]', 'Enter');
        const hiddenLine = pages[0].locator('[data-buffer] li').filter({ hasText: 'My entry badge is hidden' });
        await expect(hiddenLine).toContainText('RadVisitor'); await expect(hiddenLine.locator('.entry-badge')).toHaveCount(0);
        await pages[2].fill('[data-text]', 'A third website is here too'); await pages[2].press('[data-text]', 'Enter');
        await expect(pages[0].locator('[data-buffer] li').filter({ hasText: 'A third website is here too' })).toContainText('via Makers & Friends');
        await pages[0].screenshot({ path: testInfo.outputPath(`shared-chat-badges-${width}.png`), fullPage: true });
        await pages[0].click('nav [data-show="people"]');
        const people = pages[0].locator('[data-pane="people"]');
        await expect(people.locator('.entry-badge')).toHaveText(['via Makers & Friends', 'via Stalemate']);
        await expect(people).not.toContainText('via Rad Dad');
        await pages[1].click('nav [data-show="people"]');
        await pages[1].locator('[data-pane="people"] [data-entry-share]').check();
        await expect(people).toContainText('via Rad Dad');
        await pages[1].locator('[data-pane="people"] [data-entry-share]').uncheck();
        await expect(people).not.toContainText('via Rad Dad');
        await pages[0].locator('[data-chat-announcements]').uncheck();
        await pages[0].screenshot({ path: testInfo.outputPath(`shared-people-badges-${width}.png`), fullPage: true });
        await pages[0].click('nav [data-show="chat"]');
        await expect(pages[0].locator('[data-buffer]')).toHaveAttribute('aria-live', 'off');
        await pages[0].click('[data-show="rooms"].startroom');
        await pages[0].click('[data-start="art"]');
        await expect(pages[0].locator('[data-act-canvas]')).toBeVisible();
        const room = await pages[0].evaluate(() => __lobby.active);
        for (const page of pages.slice(1)) {
            await page.evaluate((name) => __lobby.cmd('join', [name]), room);
            await expect(page.locator('[data-act-canvas]')).toBeVisible();
            await expect(page.locator('[data-chat-context]')).toHaveText(room);
        }
        const renderedBefore = await pages[2].locator('[data-act-canvas]').evaluate((canvas) => canvas.toDataURL());
        const canvas = await pages[1].locator('[data-act-canvas]').boundingBox();
        await pages[1].click('nav [data-show="chat"]');
        await pages[1].mouse.move(canvas.x + canvas.width / 3, canvas.y + canvas.height / 3);
        await pages[1].mouse.down();
        await pages[1].mouse.move(canvas.x + canvas.width * 2 / 3, canvas.y + canvas.height * 2 / 3, { steps: 5 });
        await pages[1].mouse.up();
        await expect.poll(() => pages[2].evaluate(() => __lobbyRoom.state.room.strokes.length)).toBeGreaterThan(0);
        await expect.poll(() => pages[2].locator('[data-act-canvas]').evaluate((canvas) => canvas.toDataURL())).not.toBe(renderedBefore);
        const geometry = await pages[1].evaluate(() => {
            const input = document.querySelector('[data-text]'); const send = document.querySelector('[data-say] button[type="submit"]');
            return { page: document.documentElement.scrollWidth, viewport: innerWidth, input: input.getBoundingClientRect().right, send: send.getBoundingClientRect().right,
                fontSize: getComputedStyle(input).fontSize };
        });
        expect(geometry.page).toBeLessThanOrEqual(geometry.viewport);
        expect(geometry.input).toBeLessThanOrEqual(width); expect(geometry.send).toBeLessThanOrEqual(width); expect(geometry.fontSize).toBe('16px');
        await pages[1].screenshot({ path: testInfo.outputPath(`shared-community-${width}.png`), fullPage: true });
        expect(errors).toEqual([]);
    } finally {
        await Promise.all(contexts.map((context) => context.close()));
        await Promise.all(websites.map((website) => website.close()));
    }
});
