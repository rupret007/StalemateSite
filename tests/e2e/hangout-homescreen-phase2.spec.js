const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const shots = path.resolve(__dirname, '../../../hangout-homescreen-shots/p2');
const fix2 = path.resolve(__dirname, '../../../hangout-homescreen-shots/fix2');
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const MARKER = 'not-a-real-invite-value';
const ROOM = '/r/45662413410ed051/';

const VIEWPORTS = [
    { name: 'iphone-390x844', width: 390, height: 844, userAgent: IPHONE, mobile: true },
    { name: 'android-chrome', width: 390, height: 844, userAgent: ANDROID, mobile: true },
    { name: 'desktop-1440x900', width: 1440, height: 900, userAgent: undefined, mobile: false }
];

function contextOptions(item) {
    return {
        viewport: { width: item.width, height: item.height },
        userAgent: item.userAgent,
        isMobile: item.mobile,
        hasTouch: item.mobile,
        deviceScaleFactor: item.mobile ? 2 : 1,
        reducedMotion: 'reduce',
        serviceWorkers: 'allow'
    };
}

async function shot(page, name) {
    await page.screenshot({ path: path.join(shots, name), fullPage: true });
}

test.beforeAll(() => {
    fs.mkdirSync(shots, { recursive: true });
    fs.mkdirSync(fix2, { recursive: true });
});

test('manifest asks Android to open in-scope invite links and lists the shortcuts', async ({ request, baseURL }) => {
    const manifestUrl = new URL('/manifest.json', baseURL);
    const manifest = await (await request.get(manifestUrl.href)).json();
    expect(manifest.handle_links).toBe('preferred');
    expect(manifest.launch_handler.client_mode).toContain('navigate-existing');
    expect(new URL(manifest.scope, manifestUrl).pathname).toBe('/');
    expect(new URL(manifest.start_url, manifestUrl).pathname).toBe('/hangout/');
    expect(manifest.shortcuts.map((item) => item.name)).toEqual(['Game Night', 'WebJam', 'Last room']);
    for (const shortcut of manifest.shortcuts) {
        const url = new URL(shortcut.url, manifestUrl);
        expect(url.pathname).toBe('/hangout/');
        expect(url.hash).toBe('');
        expect(url.search).not.toMatch(/invite|grant|token/i);
        const icon = await request.get(new URL(shortcut.icons[0].src, manifestUrl).href);
        expect(icon.status()).toBe(200);
    }
    const join = new URL('/join/', manifestUrl);
    const guest = new URL('/beta/game-night/guest', manifestUrl);
    const scope = new URL(manifest.scope, manifestUrl).href;
    expect(join.href.startsWith(scope)).toBe(true);
    expect(guest.href.startsWith(scope)).toBe(true);
});

test.describe('entry, offline, and invite guidance', () => {
    for (const item of VIEWPORTS) {
        test(`${item.name} shows who’s here, the offline screen, and invite guidance`, async ({ browser }) => {
            const context = await browser.newContext(contextOptions(item));
            const page = await context.newPage();
            await page.goto('/hangout/');
            await expect(page.getByRole('status')).toHaveText('No open rooms right now.');
            await expect(page.locator('.choice')).toHaveCount(3);
            expect(await page.locator('body').innerText()).not.toContain(MARKER);
            await shot(page, `${item.name}.png`);

            await page.goto('/hangout/offline.html');
            await expect(page.getByRole('heading', { name: 'You’re offline, we’ll reconnect' })).toBeVisible();
            await expect(page.locator('.mark svg')).toBeVisible();
            await shot(page, `${item.name}-offline.png`);

            await page.goto(`${ROOM}#r=${MARKER}&h=${MARKER}`);
            const guide = page.getByRole('region', { name: 'Open in Hang Out' });
            await expect(guide).toBeVisible();
            await expect(guide.getByRole('link', { name: 'Go to Hang Out home' })).toBeVisible();
            await expect(guide.getByRole('button', { name: 'Jump in' })).toHaveCount(0);
            if (item.userAgent === IPHONE) await expect(guide).toContainText('Safari');
            else await expect(guide).not.toContainText('Safari');
            await expect(guide).not.toContainText('cannot tell whether the app is installed');
            expect(await page.locator('body').innerText()).not.toContain(MARKER);
            await shot(page, `${item.name}-invite.png`);
            await page.screenshot({ path: path.join(fix2, `${item.name}-invite.png`), fullPage: true });
            await context.close();
        });
    }
});

test('a directory read shows open rooms and tables and hides personal fields', async ({ browser }) => {
    const context = await browser.newContext(contextOptions(VIEWPORTS[0]));
    const page = await context.newPage();
    await page.route('**/beta/state', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                kind: 'guest',
                role: 'fan',
                email: 'hidden@example.test',
                rooms: [
                    { name: '#art-live', kind: 'art', title: 'Drawing room', count: 2, max: 8, locked: false, key: false, nick: 'SecretNick' },
                    { name: '#watch-live', kind: 'watch', title: 'Watch party', count: 3, max: 8, locked: false, key: false },
                    { name: '#game-abc123xdef456', kind: 'game', title: 'Royal Flush Chess', count: 2, max: 8, locked: true, key: false },
                    { name: '#art-empty', kind: 'art', title: 'Empty room', count: 0, max: 8, locked: false, key: false },
                    { name: '#chat-private', kind: 'chat', title: 'Private chat', count: 3, max: 8, locked: true, key: false }
                ]
            })
        });
    });
    await page.goto('/hangout/');
    await expect(page.getByRole('link', { name: /Drawing room/ })).toHaveAttribute('href', /kind=draw&title=Drawing\+room/);
    await expect(page.getByRole('link', { name: /Watch party/ })).toHaveAttribute('href', /kind=watch&title=Watch\+party/);
    await expect(page.getByRole('link', { name: /Royal Flush Chess/ })).toHaveAttribute('href', /kind=game-night&title=Royal\+Flush\+Chess&game-night=1/);
    const text = await page.locator('#whos-here').innerText();
    expect(text).not.toContain('SecretNick');
    expect(text).not.toContain('hidden@example.test');
    expect(text).not.toContain('#game-');
    expect(text).not.toContain('Private chat');
    expect(text).not.toContain('Empty room');
    await shot(page, 'iphone-whos-here.png');
    await context.close();
});

test('WebJam join navigations get Open in Hang Out from the worker', async ({ browser }) => {
    const context = await browser.newContext(contextOptions(VIEWPORTS[1]));
    const page = await context.newPage();
    await page.goto('/hangout/');
    await page.evaluate(() => navigator.serviceWorker.ready);
    if (!await page.evaluate(() => navigator.serviceWorker.controller)) {
        await page.reload();
        await page.waitForFunction(() => navigator.serviceWorker.controller);
    }
    await page.goto('/join/');
    const guide = page.getByRole('region', { name: 'Open in Hang Out' });
    await expect(guide).toBeVisible();
    await expect(guide.locator('.hoa__lead')).toHaveText('Ask your host to send the invite; tap it and you\'re in.');
    await expect(guide.locator('.hoa__go')).toHaveCount(0);
    await expect(guide.getByRole('link', { name: 'Go to Hang Out home' })).toBeVisible();
    await expect(page.locator('#status')).toHaveText('Ask your host to send the invite; tap it and you\'re in.');
    await expect(page.locator('body')).not.toContainText('Invalid Web Join invite');
    await expect(guide).toContainText('Ask your host to send the invite; tap it and you\'re in.');
    await expect(guide).not.toContainText('cannot tell whether the app is installed');
    expect(await page.locator('[data-open-in-app]').innerText()).not.toMatch(/[?#]/);
    await shot(page, 'android-join-invite.png');
    await context.close();
});

test('shortcuts open Game Night, ask for a WebJam invite, and repeat the stored last place', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' });
    const page = await context.newPage();
    const gameNightNavigation = (req) => {
        if (!req.isNavigationRequest()) return false;
        const url = new URL(req.url());
        return url.pathname.endsWith('/door.html') && url.searchParams.get('kind') === 'game-night' && url.searchParams.get('game-night') === '1';
    };
    const joined = [];
    page.on('request', (req) => {
        if (new URL(req.url()).pathname.endsWith('/join/') || new URL(req.url()).pathname.endsWith('/join')) joined.push(req.url());
    });
    await page.goto('/hangout/?go=webjam');
    const guide = page.getByRole('region', { name: 'Open in Hang Out' });
    await expect(guide).toBeVisible();
    await expect(guide.locator('.hoa__lead')).toHaveText('Ask your host to send the invite; tap it and you\'re in.');
    await expect(guide.getByRole('link', { name: 'Go to Hang Out home' })).toHaveCount(0);
    await expect(guide.locator('.hoa__go')).toHaveCount(0);
    await expect(guide).toContainText('Ask your host to send the invite; tap it and you\'re in.');
    await expect(page).toHaveURL(/\/hangout\/\?go=webjam$/);
    expect(page.url()).not.toMatch(/invite|grant|token/i);
    expect(joined).toEqual([]);
    await page.screenshot({ path: path.join(fix2, 'webjam-ask-390x844.png'), fullPage: true });
    await page.goto('/hangout/');
    joined.length = 0;
    await page.locator('.choice', { hasText: 'WebJam' }).click();
    await expect(page).toHaveURL(/\/hangout\/\?go=webjam$/);
    await expect(page.getByRole('region', { name: 'Open in Hang Out' })).toContainText('Ask your host to send the invite; tap it and you\'re in.');
    expect(joined).toEqual([]);
    await page.goto('/hangout/', { waitUntil: 'domcontentloaded' });
    const openedGameNight = page.waitForRequest(gameNightNavigation);
    await page.locator('.choice', { hasText: 'Game Night' }).click();
    const gameNight = await openedGameNight;
    expect(new URL(gameNight.url()).pathname).toMatch(/\/door\.html$/);
    expect(new URL(gameNight.url()).searchParams.get('game-night')).toBe('1');
    expect(gameNight.url()).not.toMatch(/invite|grant|token/i);
    await expect(page.locator('h1')).toHaveText('Game Night');
    await expect(page.locator('[data-name]')).toBeVisible();
    await expect(page.locator('[data-enter]')).toBeVisible();
    await page.evaluate(() => history.replaceState(null, '', location.pathname));
    await expect.poll(() => new URL(page.url()).searchParams.get('game-night')).toBe('1');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('hangout-last-room'))).toBe('game-night');
    const openedLast = page.waitForRequest(gameNightNavigation);
    await page.goto('/hangout/?go=last', { waitUntil: 'commit' });
    const last = await openedLast;
    expect(new URL(last.url()).pathname).toMatch(/\/door\.html$/);
    expect(last.url()).not.toMatch(/invite|grant|token/i);
    await context.close();
});

test('a valid room link leads with Jump in', async ({ browser }) => {
    const context = await browser.newContext(contextOptions(VIEWPORTS[0]));
    const page = await context.newPage();
    const secret = 'c'.repeat(24);
    const host = 'd'.repeat(80);
    await page.goto(`${ROOM}#r=${secret}&h=${host}`);
    const guide = page.getByRole('region', { name: 'Open in Hang Out' });
    await expect(guide.getByRole('button', { name: 'Jump in' })).toBeVisible();
    await expect(guide).toContainText('iPhone opens this link in Safari.');
    const text = await page.locator('body').innerText();
    expect(text).not.toContain(secret);
    expect(text).not.toContain(host);
    await page.screenshot({ path: path.join(fix2, 'iphone-390x844-jump.png'), fullPage: true });
    await context.close();
});

test('the offline screen retries when the network returns', async ({ browser }) => {
    const context = await browser.newContext(contextOptions(VIEWPORTS[0]));
    const page = await context.newPage();
    await page.goto('/hangout/');
    await page.evaluate(() => navigator.serviceWorker.ready);
    if (!await page.evaluate(() => navigator.serviceWorker.controller)) {
        await page.reload();
        await page.waitForFunction(() => navigator.serviceWorker.controller);
    }
    await context.setOffline(true);
    await page.goto('/hangout/does-not-exist');
    await expect(page.getByRole('heading', { name: 'You’re offline, we’ll reconnect' })).toBeVisible();
    await expect(page.locator('.mark svg')).toBeVisible();
    expect(await page.locator('body').innerText()).not.toContain(MARKER);
    await context.setOffline(false);
    await expect(page.getByRole('heading', { name: 'Wrong song.' })).toBeVisible({ timeout: 12000 });
    await context.close();
});

test('phone screens show each home-screen fix', async ({ browser }) => {
    const fixShots = path.resolve(__dirname, '../../../shots');
    fs.mkdirSync(fixShots, { recursive: true });
    const phone = {
        viewport: { width: 390, height: 844 },
        userAgent: IPHONE,
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 1,
        reducedMotion: 'reduce',
        serviceWorkers: 'allow'
    };
    async function snap(page, name) {
        const file = path.join(fixShots, name);
        await page.screenshot({ path: file });
        const bytes = fs.readFileSync(file);
        expect(bytes.readUInt32BE(16)).toBe(390);
        expect(bytes.readUInt32BE(20)).toBe(844);
    }

    const cold = await browser.newContext(phone);
    const join = await cold.newPage();
    await join.goto('/join/');
    expect(await join.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
    await expect(join.locator('#status')).toHaveText('Ask your host to send the invite; tap it and you\'re in.');
    await expect(join.locator('body')).not.toContainText('Invalid Web Join invite');
    await expect(join.locator('.hoa__lead')).toHaveText('Ask your host to send the invite; tap it and you\'re in.');
    await snap(join, 'iphone-join-absent.png');
    await cold.close();

    const context = await browser.newContext(phone);
    const page = await context.newPage();
    await page.goto('/hangout/?go=last');
    await expect(page.getByText('No last room saved on this device.')).toBeVisible();
    await expect(page).toHaveURL(/\/hangout\/\?go=last$/);
    await snap(page, 'iphone-last-empty.png');

    await page.goto('/hangout/?go=webjam');
    await expect(page.locator('.hoa__lead')).toHaveText('Ask your host to send the invite; tap it and you\'re in.');
    await expect(page.getByRole('link', { name: 'Go to Hang Out home' })).toHaveCount(0);
    await snap(page, 'iphone-webjam-ask.png');

    await page.goto('/hangout/door.html?kind=hangout');
    await expect(page.locator('h1')).toHaveText('Hang Out');
    await expect(page.locator('[data-door-step]')).toHaveText('Pick a name and jump in.');
    await expect(page.locator('[data-name]')).toBeVisible();
    await expect(page.locator('[data-enter]')).toBeVisible();
    await snap(page, 'iphone-door-hangout.png');

    await page.goto('/hangout/door.html?kind=game-night&game-night=1');
    await expect(page.locator('h1')).toHaveText('Game Night');
    await page.evaluate(() => history.replaceState(null, '', location.pathname));
    await expect.poll(() => new URL(page.url()).searchParams.get('game-night')).toBe('1');
    await expect(page.locator('[data-name]')).toBeVisible();
    await expect(page.locator('[data-enter]')).toBeVisible();
    await snap(page, 'iphone-door-game-night.png');

    await page.route('**/beta/state', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                rooms: [
                    { kind: 'art', title: 'Drawing room', count: 2, max: 8, locked: false, key: false },
                    { kind: 'watch', title: 'Watch party', count: 3, max: 8, locked: false, key: false },
                    { kind: 'game', title: 'Royal Flush Chess', count: 2, max: 8, locked: true, key: false }
                ]
            })
        });
    });
    await page.goto('/hangout/');
    await page.getByRole('link', { name: /Drawing room/ }).click();
    await expect(page.locator('h1')).toHaveText('Drawing room');
    await expect(page.locator('[data-door-step]')).toHaveText('Pick a name and draw together.');
    await expect(page.locator('[data-name]')).toBeVisible();
    await expect(page.locator('[data-enter]')).toBeVisible();
    await snap(page, 'iphone-door-draw.png');
    await page.goto('/hangout/');
    await page.getByRole('link', { name: /Watch party/ }).click();
    await expect(page.locator('h1')).toHaveText('Watch party');
    await expect(page.locator('[data-door-step]')).toHaveText('Pick a name and watch together.');
    await snap(page, 'iphone-door-watch.png');
    await page.goto('/hangout/');
    await page.getByRole('link', { name: /Royal Flush Chess/ }).click();
    await expect(page.locator('h1')).toHaveText('Royal Flush Chess');
    await page.evaluate(() => history.replaceState(null, '', location.pathname));
    await expect.poll(() => new URL(page.url()).searchParams.get('game-night')).toBe('1');
    await expect(page.locator('[data-name]')).toBeVisible();
    await expect(page.locator('[data-enter]')).toBeVisible();
    await snap(page, 'iphone-door-game.png');
    await context.close();
});
