const { randomUUID } = require('node:crypto');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

async function enter(page, baseURL) {
    const relay = hangoutRelayWsBase(baseURL, `workspace-${randomUUID()}`);
    await page.goto(`/r/45662413410ed051/lobby/?preview=local-preview-key-0001&relay=${encodeURIComponent(relay)}`);
    await page.fill('[data-nick]', 'WorkspaceFan');
    await page.click('[data-enter]');
    await expect(page.locator('[data-connection]')).toHaveText('Connected');
}

test('chat shortcuts explain what they do and can send from the keyboard', async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await enter(page, baseURL);
    const actions = page.locator('[data-quick]');
    const horns = actions.getByRole('button', { name: 'Send rock horns and SHRED' });
    await expect(horns).toBeVisible();
    await expect(actions.getByRole('button', { name: 'Send happy little tree' })).toBeVisible();
    await expect(actions.getByRole('button', { name: 'Help with chat commands' })).toBeVisible();
    await horns.press('Enter');
    await expect(page.getByRole('log', { name: 'Conversation' })).toContainText('🤘 SHRED');
});

test('a failed chat shortcut can be retried without changing the composer draft', async ({ page, baseURL }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await enter(page, baseURL);
    const composer = page.getByRole('textbox', { name: 'Message', exact: true });
    const shortcut = page.getByRole('button', { name: 'Send rock horns and SHRED', exact: true });
    const status = page.locator('[data-toast]');
    const message = page.getByRole('log', { name: 'Conversation' }).getByRole('listitem').filter({ hasText: '🤘 SHRED' });
    await composer.fill('Keep my draft here.');
    await page.evaluate(() => {
        const socket = window.__lobby.ws;
        const send = socket.send;
        socket.send = function (data) {
            if (JSON.parse(data).t === 'say') {
                socket.send = send;
                throw new Error('Synthetic shortcut transport failure');
            }
            return send.call(this, data);
        };
    });

    await shortcut.press('Enter');
    await expect(composer).toHaveValue('Keep my draft here.');
    await expect(shortcut).toBeFocused();
    await expect(message).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('shortcut-after-failed-send.png') });
    await expect(status).toHaveText('Couldn’t send that shortcut. Try it again.');
    await expect(status).toHaveAttribute('role', 'status');

    await shortcut.press('Enter');
    await expect(message).toHaveCount(1);
    await expect(status).toBeHidden();
    await expect(composer).toHaveValue('Keep my draft here.');
    await page.screenshot({ path: testInfo.outputPath('shortcut-retried.png') });
});

for (const [width, height] of [[1440, 900], [390, 844]]) {
    test(`a chat send failure is explained and can be retried at ${width}px`, async ({ page, baseURL }, testInfo) => {
        await page.setViewportSize({ width, height });
        await enter(page, baseURL);
        const composer = page.getByRole('textbox', { name: 'Message', exact: true });
        const message = 'Keep this message until Send succeeds.';
        const log = page.getByRole('log', { name: 'Conversation' });
        const status = page.locator('[data-toast]');
        await page.evaluate(() => {
            const socket = window.__lobby.ws;
            const send = socket.send;
            socket.send = function (data) {
                if (JSON.parse(data).t === 'say') {
                    socket.send = send;
                    throw new Error('Synthetic transport failure');
                }
                return send.call(this, data);
            };
        });
        await composer.fill(message);
        await composer.press('Enter');
        await expect(composer).toHaveValue(message);
        await expect(composer).toBeFocused();
        await expect(log).not.toContainText(message);
        await expect(status).toHaveText('Couldn’t send your message. Your draft is still here. Try sending it again.');
        await expect(status).toHaveAttribute('role', 'status');
        await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeInViewport({ ratio: 1 });
        await page.screenshot({ path: testInfo.outputPath('send-failed-draft-retained.png') });
        await composer.press('Enter');
        await expect(log.getByRole('listitem').filter({ hasText: message })).toHaveCount(1);
        await expect(composer).toBeEmpty();
        await expect(status).toBeHidden();
        await page.screenshot({ path: testInfo.outputPath('send-retried.png') });
    });
}

for (const [width, height] of [[1024, 768], [1440, 900], [1920, 1080], [375, 812], [390, 844]]) {
    test(`workspace fills ${width}x${height} and keeps the composer visible`, async ({ page, baseURL }, testInfo) => {
        await page.setViewportSize({ width, height });
        await enter(page, baseURL);
        const app = await page.locator('[data-app]').boundingBox();
        expect(app.x).toBe(0);
        expect(Math.abs(app.width - width)).toBeLessThanOrEqual(1);
        expect(Math.abs(app.y + app.height - height)).toBeLessThanOrEqual(1);
        const send = await page.locator('[data-send]').boundingBox();
        expect(send.x).toBeGreaterThanOrEqual(0);
        expect(send.x + send.width).toBeLessThanOrEqual(width);
        expect(send.y + send.height).toBeLessThanOrEqual(height);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        if (width > 900) {
            await expect(page.locator('[data-pane="rooms"]')).toBeVisible();
            await expect(page.locator('[data-pane="people"]')).toBeVisible();
            const chat = await page.locator('[data-pane="chat"]').boundingBox();
            const buffer = await page.locator('[data-buffer]').boundingBox();
            expect(chat.width).toBeGreaterThan(width * 0.58);
            expect(buffer.height).toBeGreaterThan(height * 0.35);
        } else {
            expect(await page.locator('[data-text]').evaluate(el => getComputedStyle(el).fontSize)).toBe('16px');
            const starters = page.locator('.conversation-starters');
            for (const name of ['Say hello', 'What are you making?', 'Find a collaborator']) {
                await expect(starters.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
            }
            expect(await starters.evaluate(el => el.scrollWidth)).toBeLessThanOrEqual(
                await starters.evaluate(el => el.clientWidth)
            );
        }
        await page.screenshot({ path: testInfo.outputPath(`workspace-${width}x${height}.png`), animations: 'disabled' });
    });
}

test('fullscreen rejection gives recovery and preserves the unsent message', async ({ page, baseURL }) => {
    await page.addInitScript(() => {
        Object.defineProperty(document, 'fullscreenEnabled', { value: true });
        // Init scripts run before documentElement exists. Patch the prototype
        // so this fixture actually exercises denial instead of entering fullscreen.
        Element.prototype.requestFullscreen = async () => { throw new DOMException('Denied by browser policy', 'NotAllowedError'); };
    });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await enter(page, baseURL);
    await page.fill('[data-text]', 'An unsent draft');
    await page.locator('[data-fullscreen]').click();
    await expect(page.locator('[data-toast]')).toContainText('Maximize this browser window');
    await expect(page.locator('[data-fullscreen]')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('[data-text]')).toHaveValue('An unsent draft');
    await expect(page.locator('[data-connection]')).toHaveText('Connected');
    expect(errors).toEqual([]);
});

test('fullscreen uses the browser API when available and reflects exit', async ({ page, baseURL }) => {
    await enter(page, baseURL);
    const supported = await page.evaluate(() => Boolean(document.fullscreenEnabled && document.documentElement.requestFullscreen));
    const button = page.locator('[data-fullscreen]');
    if (!supported) {
        await expect(button).toBeHidden();
        return; // Qualifies the unsupported UI, not a fullscreen success.
    }
    await page.fill('[data-text]', 'Keep this draft through fullscreen');
    await button.click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === document.documentElement)).toBe(true);
    await expect(button).toHaveText('Exit full screen');
    await button.click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
    await expect(button).toHaveText('Full screen');
    await expect(page.locator('[data-text]')).toHaveValue('Keep this draft through fullscreen');
});

for (const width of [375, 390]) {
    test(`paint starter icon, lesson picks and materials fit ${width}px`, async ({ page, baseURL }, testInfo) => {
        await page.setViewportSize({ width, height: 844 });
        await page.route(/youtube\.com|ytimg|googlevideo/, route => route.abort());
        await page.route('https://www.youtube.com/iframe_api', route => route.fulfill({
            path: require('node:path').join(__dirname, 'support/fake-youtube.js'), contentType: 'text/javascript'
        }));
        await enter(page, baseURL);
        await page.click('[data-show="rooms"]');
        const icon = page.locator('[data-start="bobross"] img');
        await icon.scrollIntoViewIfNeeded();
        await expect.poll(() => icon.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`paint-entry-${width}.png`), animations: 'disabled' });
        await page.click('[data-start="bobross"]');
        await expect(page.locator('[data-bob-picks] button')).toHaveCount(4);
        await expect(page.locator('[data-bob-picks] button').first()).toContainText('The Grandeur of Summer');
        const guide = page.locator('[data-paint-start]');
        await guide.locator('summary').click();
        await guide.scrollIntoViewIfNeeded();
        await expect(guide).toContainText('kit is optional');
        const link = guide.locator('a').first();
        await link.focus();
        await expect(link).toBeFocused();
        await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        const send = await page.locator('[data-send]').boundingBox();
        expect(send.x + send.width).toBeLessThanOrEqual(width);
        expect(send.y + send.height).toBeLessThanOrEqual(844);
        expect(await page.locator('[data-text]').evaluate(input => getComputedStyle(input).fontSize)).toBe('16px');
        await page.screenshot({ path: testInfo.outputPath(`paint-materials-${width}.png`), animations: 'disabled' });
        const lesson = page.getByRole('textbox', { name: 'YouTube URL' });
        await lesson.fill('not a YouTube link');
        await lesson.press('Enter');
        const error = page.locator('[data-act-load-status]');
        await expect(error).toHaveText('Enter a YouTube video link or video ID.');
        await page.screenshot({ path: testInfo.outputPath(`paint-error-${width}.png`), animations: 'disabled' });
        await expect(lesson).toBeFocused();
        await expect(error).toBeInViewport({ ratio: 1 });
        await expect(lesson).toBeInViewport({ ratio: 1 });
        await expect(page.locator('[data-send]')).toBeInViewport({ ratio: 1 });
    });
}
