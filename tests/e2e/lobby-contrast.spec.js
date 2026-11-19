// Solid-color computed-style checks, not a complete WCAG/AT or emoji/image audit.
const { randomUUID } = require('node:crypto');
const { writeFile } = require('node:fs/promises');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');
const ROOT = '/r/45662413410ed051/';

async function sample(page, { text = [], fields = [], placeholders = [] }) {
    return page.evaluate(({ text, fields, placeholders }) => {
        const rgba = value => {
            const parts = String(value).match(/^rgba?\(([^)]+)\)$/)?.[1].split(',').map(Number);
            if (!parts || parts.length < 3 || parts.some(value => !Number.isFinite(value))) throw Error('Unsupported computed color');
            return [...parts.slice(0, 3), parts[3] ?? 1];
        };
        const blend = (a, b) => [0, 1, 2].map(i => a[i] * a[3] + b[i] * (1 - a[3])).concat(1);
        const luminance = rgb => rgb.slice(0, 3).map(v => {
            v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
        }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
        const ratio = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
        function background(element) {
            const layers = [];
            for (let node = element; node; node = node.parentElement) {
                const style = getComputedStyle(node), color = rgba(style.backgroundColor);
                if (style.backgroundImage !== 'none') throw Error('Image/gradient background needs separate qualification');
                layers.push(color); if (color[3] === 1) break;
            }
            return layers.reverse().reduce((b, a) => blend(a, b), [255, 255, 255, 1]);
        }
        function target(selector) {
            const node = document.querySelector(selector);
            if (!node || !node.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true }) || node.matches(':disabled'))
                throw Error(`Requested active visible sample is missing: ${selector}`);
            for (let ancestor = node; ancestor; ancestor = ancestor.parentElement)
                if (Number(getComputedStyle(ancestor).opacity) !== 1) throw Error('Opacity group needs separate qualification');
            return node;
        }
        const results = [];
        for (const selector of text) {
            const node = target(selector), style = getComputedStyle(node), bg = background(node);
            const large = parseFloat(style.fontSize) >= 24 || parseFloat(style.fontSize) >= 18.6667 && Number(style.fontWeight) >= 700;
            results.push({ kind: 'text', selector, foreground: style.color, background: bg,
                ratio: ratio(blend(rgba(style.color), bg), bg), minimum: large ? 3 : 4.5 });
        }
        for (const selector of placeholders) {
            const node = target(selector), style = getComputedStyle(node, '::placeholder'), bg = background(node);
            if (Number(style.opacity) !== 1) throw Error('Placeholder opacity needs separate qualification');
            results.push({ kind: 'placeholder', selector, foreground: style.color, background: bg,
                ratio: ratio(blend(rgba(style.color), bg), bg), minimum: 4.5 });
        }
        for (const selector of fields) {
            const node = target(selector), style = getComputedStyle(node), outside = background(node.parentElement), inside = background(node);
            if (style.borderTopStyle === 'none' || parseFloat(style.borderTopWidth) < 1) throw Error(`Missing authored field boundary: ${selector}`);
            const color = rgba(style.borderTopColor);
            results.push({ kind: 'field-boundary', selector, foreground: style.borderTopColor, background: outside,
                ratio: Math.min(ratio(blend(color, outside), outside), ratio(blend(color, inside), inside)), minimum: 3 });
        }
        return results;
    }, { text, fields, placeholders });
}
async function check(page, testInfo, stage, samples) {
    const results = await sample(page, samples);
    const path = testInfo.outputPath(`${stage}-computed-contrast.json`);
    await writeFile(path, JSON.stringify(results, null, 2) + '\n');
    await testInfo.attach(`${stage}-computed-contrast`, { path, contentType: 'application/json' });
    expect(results.filter(result => result.ratio < result.minimum), `${stage} computed contrast`).toEqual([]);
}

for (const width of [375, 390, 1280]) test(`active lobby text and authored field boundaries at ${width}px`, async ({ browser, baseURL }, testInfo) => {
    const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.route(/youtube\.com|ytimg|googlevideo|goatcounter/, route => route.abort());
    const relay = hangoutRelayWsBase(baseURL, `contrast-${randomUUID()}`);
    try {
        await page.goto(`${ROOT}lobby/?preview=local-preview-key-0001&via=stalemate&relay=${encodeURIComponent(relay)}`);
        await expect(page.locator('[data-nick]')).toBeVisible();
        await page.locator('[data-nick]').fill('ContrastVisitor');
        await page.locator('[data-nick]').blur();
        await check(page, testInfo, 'entry', {
            text: ['.gate-card h2', '.nickrow', '.rules', '[data-enter]', '.gate-card [data-entry-label]'], fields: ['[data-nick]'], placeholders: ['[data-nick]']
        });
        await page.click('[data-enter]'); await expect(page.locator('[data-connection]')).toHaveText('Connected');
        await page.fill('[data-text]', 'Readable local chat in the shared community'); await page.press('[data-text]', 'Enter');
        await expect(page.locator('[data-buffer]')).toContainText('Readable local chat');
        // Check the informational author text and an actionable author from a live peer.
        await expect(page.locator('[data-buffer] span.who')).toHaveText('<ContrastVisitor>');
        const peer = await context.newPage();
        await peer.route(/youtube\.com|ytimg|googlevideo|goatcounter/, route => route.abort());
        await peer.goto(`${ROOT}lobby/?preview=local-preview-key-0001&via=rad-dad&relay=${encodeURIComponent(relay)}`);
        await peer.fill('[data-nick]', 'ContrastPeer'); await peer.click('[data-enter]');
        await expect(peer.locator('[data-connection]')).toHaveText('Connected');
        await peer.fill('[data-text]', 'Readable peer chat has an active author control'); await peer.press('[data-text]', 'Enter');
        await expect(page.locator('[data-buffer]')).toContainText('Readable peer chat has an active author control');
        await expect(page.getByRole('button', { name: '<ContrastPeer>', exact: true })).toBeEnabled();
        await page.locator('[data-text]').blur();
        await check(page, testInfo, 'chat', {
            text: ['[data-topic]', '[data-buffer] .ts', '[data-buffer] .who', '[data-buffer] .entry-badge', '[data-connection]', '[data-send]', '.chat-status'],
            fields: ['[data-say]'], placeholders: ['[data-text]']
        });
        await page.screenshot({ path: testInfo.outputPath(`chat-${width}.png`), fullPage: true });
        if (width < 1024) await page.click('nav [data-show="rooms"]');
        await check(page, testInfo, 'discovery', { text: ['.channel-home b', '.channel-home span', '.creation-hint'], fields: ['[data-room-filter]', '[data-room-search]'], placeholders: ['[data-room-search]'] });
        await page.click('[data-start="chat"]'); await expect(page.locator('[data-channel-dialog]')).toBeVisible();
        await page.locator('[data-channel-name]').blur();
        await check(page, testInfo, 'room-dialog', { text: ['#channel-dialog-title', '[data-channel-dialog] .small'], fields: ['[data-channel-name]'], placeholders: ['[data-channel-name]'] });
        await page.screenshot({ path: testInfo.outputPath(`field-boundaries-${width}.png`), fullPage: true });
        await page.click('[data-channel-cancel]');
        await page.click('[data-start="jam"]');
        await expect(page.locator('[data-jam-link]')).toBeVisible();
        await page.locator('[data-jam-link]').blur();
        await check(page, testInfo, 'webjam-invitation', { text: ['[data-jam] p', '[data-jam] p.small', '[data-jam-form] button'], fields: ['[data-jam-link]'], placeholders: ['[data-jam-link]'] });
        await page.locator('[data-jam-link]').focus();
        await expect(page.locator('[data-jam-link]')).toHaveCSS('outline-color', 'rgb(209, 250, 120)');
        await expect(page.locator('[data-jam-link]')).toHaveCSS('outline-width', '2px');
        await expect(page.locator('[data-jam-link]')).toHaveCSS('font-size', '16px');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const successScreenshot = testInfo.outputPath(`webjam-${width}.png`);
        await page.screenshot({ path: successScreenshot, fullPage: true });
        if (width === 375 || width === 390) await testInfo.attach(`contrast-success-${width}`, { path: successScreenshot, contentType: 'image/png' });
    } finally { await context.close(); }
});

test('staff sign-in fields have the same readable boundary without broadening staff access', async ({ page }, testInfo) => {
    await page.goto(`${ROOT}admin/?preview=local-preview-key-0001`);
    await expect(page.locator('[data-nick]')).toBeVisible(); await page.locator('[data-nick]').blur();
    await check(page, testInfo, 'staff-entry', { text: ['.gate-card h1', '.gate-card .lede', '[data-signin]', '[data-enter]'], fields: ['[data-nick]'] });
});

for (const viewport of [{ width: 375, height: 667 }, { width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    test(`creative room and Paint Along composers remain readable at ${viewport.width}px`, async ({ browser, baseURL }, testInfo) => {
        const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
        try {
            const page = await context.newPage();
            const origin = new URL(baseURL).origin;
            await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
            const relay = hangoutRelayWsBase(baseURL, `room-contrast-${randomUUID()}`);
            await page.goto(`${ROOT}?preview=local-preview-key-0001&relay=${encodeURIComponent(relay)}`);
            await page.locator('[data-name]').fill('ContrastHost');
            await page.locator('[data-enter]').click();
            await expect(page.locator('[data-room]')).toBeVisible();
            const field = '.chat [data-text]';
            const composer = page.getByRole('textbox', { name: 'Message', exact: true });
            const samples = { fields: [field], placeholders: [field] };
            await expect(composer).toBeVisible();
            await check(page, testInfo, 'creative-room-composer', samples);

            await page.locator('[data-bob-toggle]').click();
            await expect(page.locator('body')).toHaveAttribute('data-shared-layout', 'paint');
            await page.locator('[data-consent-skip]').click();
            const chat = page.locator('[data-chat-toggle]');
            if (viewport.width <= 820) await chat.click();
            await expect(composer).toBeVisible();
            await expect(composer).toBeInViewport({ ratio: 1 });
            const send = page.getByRole('button', { name: 'Send', exact: true });
            await expect(send).toBeInViewport({ ratio: 1 });
            const stage = page.locator('.watch .screen');
            if (viewport.width <= 820) {
                await expect(stage).toBeInViewport({ ratio: 1 });
                const dock = page.getByRole('group', { name: 'Call controls', exact: true });
                await expect.poll(async () => {
                    const [button, controls] = await Promise.all([send.boundingBox(), dock.boundingBox()]);
                    return controls.y - button.y - button.height;
                }).toBeGreaterThanOrEqual(0);
            }
            await check(page, testInfo, 'paint-along-composer', samples);
            await page.screenshot({ path: testInfo.outputPath(`paint-chat-contrast-${viewport.width}.png`) });
            await composer.fill('Ready to paint');
            await send.click();
            await expect(page.locator('[data-log]')).toContainText('Ready to paint');
            if (viewport.width <= 820) {
                await chat.click();
                await expect(composer).toBeHidden();
                await expect(stage).toBeInViewport({ ratio: 1 });
            }
        } finally {
            await context.close();
        }
    });
}
