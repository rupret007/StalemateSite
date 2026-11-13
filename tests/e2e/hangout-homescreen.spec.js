const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const shots = path.resolve(__dirname, '../../../hangout-homescreen-shots');
const fix2 = path.resolve(__dirname, '../../../hangout-homescreen-shots/fix2');
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

function pngSize(buffer) {
    const bytes = Buffer.from(buffer);
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function settle(page) {
    await page.goto('/hangout/');
    await page.evaluate(() => Promise.race([
        document.fonts.ready,
        new Promise((resolve) => setTimeout(resolve, 3000))
    ]));
    await expect.poll(() => page.locator('.brand-mark').evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
}

async function offerInstall(page) {
    await page.evaluate(() => {
        const event = new Event('beforeinstallprompt', { cancelable: true });
        event.prompt = () => {
            window.__hangoutInstallPrompts = (window.__hangoutInstallPrompts || 0) + 1;
            return Promise.resolve();
        };
        event.userChoice = Promise.resolve({ outcome: 'dismissed', platform: 'web' });
        window.dispatchEvent(event);
    });
}

test.beforeAll(() => {
    fs.mkdirSync(shots, { recursive: true });
    fs.mkdirSync(fix2, { recursive: true });
});

test('manifest is valid and every icon loads', async ({ request, baseURL }) => {
    const manifestUrl = new URL('/manifest.json', baseURL);
    const response = await request.get(manifestUrl.href);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('json');
    const manifest = await response.json();
    expect(manifest.name).toBe('Hang Out');
    expect(manifest.short_name).toBe('Hang Out');
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toBe('#171410');
    expect(manifest.background_color).toBe('#171410');
    expect(new URL(manifest.start_url, manifestUrl).pathname).toBe('/hangout/');
    expect(new URL(manifest.scope, manifestUrl).pathname).toBe('/');

    const sizes = new Map();
    for (const icon of manifest.icons) {
        const iconUrl = new URL(icon.src, manifestUrl);
        const iconResponse = await request.get(iconUrl.href);
        expect(iconResponse.status(), icon.src).toBe(200);
        expect(iconResponse.headers()['content-type'], icon.src).toContain('image/png');
        const actual = pngSize(await iconResponse.body());
        expect(`${actual.width}x${actual.height}`, icon.src).toBe(icon.sizes);
        sizes.set(`${icon.sizes}:${icon.purpose}`, true);
    }
    expect(sizes.get('192x192:any')).toBe(true);
    expect(sizes.get('512x512:any')).toBe(true);
    expect(sizes.get('192x192:maskable')).toBe(true);
    expect(sizes.get('512x512:maskable')).toBe(true);
    expect(sizes.get('180x180:any')).toBe(true);

    const touch = await request.get(new URL('/assets/hangout-app/apple-touch-icon.png', baseURL).href);
    expect(touch.status()).toBe(200);
    expect(pngSize(await touch.body())).toEqual({ width: 180, height: 180 });
    const mark = await request.get(new URL('/assets/hangout-app/webjam-mark.svg', baseURL).href);
    expect(mark.status()).toBe(200);
    expect(mark.headers()['content-type']).toContain('svg');
});

test('iPhone shows the share hint, and dismissing it sticks', async ({ browser }) => {
    const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        userAgent: IPHONE,
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
        reducedMotion: 'reduce',
        serviceWorkers: 'allow'
    });
    const page = await context.newPage();
    await settle(page);

    const card = page.locator('[data-install-card]');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Tap Share, then Add to Home Screen.');
    await expect(card.getByRole('button', { name: 'Install' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Hang Out/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Game Night/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /WebJam/ })).toBeVisible();

    const choice = page.locator('.choice');
    await expect(choice).toHaveCount(3);
    for (const link of await choice.all()) {
        const box = await link.boundingBox();
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.width).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: path.join(shots, 'iphone-390x844.png'), fullPage: true });
    await page.screenshot({ path: path.join(fix2, 'iphone-390x844.png'), fullPage: true });

    await card.getByRole('button', { name: 'Not now' }).click();
    await expect(card).toBeHidden();
    await page.reload();
    await expect(card).toBeHidden();
    await context.close();
});

test('Android Chrome shows a one-tap Install button', async ({ browser }) => {
    const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        userAgent: ANDROID,
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
        reducedMotion: 'reduce',
        serviceWorkers: 'allow'
    });
    const page = await context.newPage();
    await settle(page);

    const card = page.locator('[data-install-card]');
    await expect(card).toBeVisible();
    await expect(card).not.toContainText('Tap Share, then Add to Home Screen.');
    await expect(card).toContainText('Tap ⋮, then Add to Home screen or Install app.');
    await expect(card.getByRole('button', { name: 'Install' })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: path.join(fix2, 'android-chrome.png'), fullPage: true });
    await offerInstall(page);
    const install = card.getByRole('button', { name: 'Install' });
    await expect(install).toBeEnabled();
    await expect(card).toContainText('One tap puts Hang Out on your home screen.');
    await page.screenshot({ path: path.join(shots, 'android-chrome.png'), fullPage: true });
    await install.click();
    await expect.poll(() => page.evaluate(() => window.__hangoutInstallPrompts || 0)).toBe(1);
    await context.close();
});

test('desktop 1440 shows an install hint until Chrome offers install', async ({ browser }) => {
    const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        reducedMotion: 'reduce',
        serviceWorkers: 'allow'
    });
    const page = await context.newPage();
    await settle(page);

    const card = page.locator('[data-install-card]');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Use the install icon in the address bar, or the browser menu.');
    await expect(card.getByRole('button', { name: 'Install' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Hang Out', exact: true })).toBeVisible();
    await expect(page.locator('.choice')).toHaveCount(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: path.join(shots, 'desktop-1440x900.png'), fullPage: true });
    await page.screenshot({ path: path.join(fix2, 'desktop-1440x900.png'), fullPage: true });

    await offerInstall(page);
    await expect(card.getByRole('button', { name: 'Install' })).toBeEnabled();
    await expect(card).not.toContainText('Tap Share, then Add to Home Screen.');
    await page.screenshot({ path: path.join(shots, 'desktop-1440x900-install.png'), fullPage: true });
    await context.close();
});

test('an installed app and a standalone window hide the card', async ({ browser }) => {
    const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        userAgent: IPHONE,
        isMobile: true,
        hasTouch: true,
        serviceWorkers: 'allow'
    });
    await context.addInitScript(() => {
        Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
        const original = window.matchMedia.bind(window);
        window.matchMedia = (query) => (
            String(query).includes('display-mode')
                ? { matches: true, media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; }, onchange: null }
                : original(query)
        );
    });
    const page = await context.newPage();
    await settle(page);
    await expect(page.locator('[data-install-card]')).toBeHidden();
    await expect(page.locator('.choice')).toHaveCount(3);
    await page.screenshot({ path: path.join(shots, 'iphone-standalone.png'), fullPage: true });
    await context.close();
});

test('choices open the existing pages and the worker does not cache sensitive responses', async ({ browser, request, baseURL }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' });
    const page = await context.newPage();
    await settle(page);
    await page.evaluate(() => navigator.serviceWorker.ready);
    if (!await page.evaluate(() => navigator.serviceWorker.controller)) {
        await page.reload();
        await page.waitForFunction(() => navigator.serviceWorker.controller);
    }

    const hrefs = await page.locator('.choice').evaluateAll((links) => links.map((link) => link.href));
    expect(hrefs.map((href) => new URL(href).pathname + new URL(href).search)).toEqual([
        '/r/45662413410ed051/',
        '/r/45662413410ed051/lobby/?game-night=1',
        '/join/'
    ]);
    for (const href of hrefs) {
        const response = await request.get(href);
        expect(response.status(), href).toBe(200);
    }

    const cached = await page.evaluate(async () => {
        await fetch('/beta/state');
        await fetch('/beta/game-night/invitation/issue');
        await fetch('/join/?invite=secret');
        await fetch('/beta/participation/grant');
        const urls = [];
        for (const name of await caches.keys()) {
            const cache = await caches.open(name);
            for (const item of await cache.keys()) urls.push(new URL(item.url).pathname);
        }
        return urls;
    });
    expect(cached.sort()).toEqual(['/hangout/offline-retry.mjs', '/hangout/offline.html'].sort());

    const client = await context.newCDPSession(page);
    const installability = await client.send('Page.getInstallabilityErrors');
    expect(installability.installabilityErrors, JSON.stringify(installability)).toEqual([]);

    await context.setOffline(true);
    await page.goto('/hangout/no-such-page');
    await expect(page.getByRole('heading', { name: 'You’re offline' })).toBeVisible();
    await context.close();
    expect(baseURL).toBeTruthy();
});
