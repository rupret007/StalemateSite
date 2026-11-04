const { test, expect } = require('@playwright/test');

test('the website serves Web Join with its complete module graph and no capture without consent', async ({ page, baseURL }) => {
    const external = [];
    await page.route('**/*', route => {
        if (new URL(route.request().url()).origin === baseURL) return route.continue();
        external.push(route.request().url()); return route.abort();
    });
    await page.goto('/join/');
    await expect(page.locator('#status')).toContainText('Invalid Web Join invite');
    await expect(page.getByRole('button', { name: 'Join with microphone', exact: true })).toBeDisabled();
    await expect(page.locator('#prejoin')).toBeHidden();
    await expect(page.locator('#retry')).toBeHidden();
    expect(external).toEqual([]);
});

for (const width of [375, 390]) {
    test(`the website preserves fragment privacy and recovers provider failure at ${width}px`, async ({ page, baseURL }, testInfo) => {
        const external = [], requests = [];
        await page.setViewportSize({ width, height: 844 });
        await page.addInitScript(() => {
            window.captureTracks = []; window.captureCount = 0;
            Object.defineProperty(Object.getPrototypeOf(navigator.mediaDevices), 'getUserMedia', {
                configurable: true, value: async () => {
                    window.captureCount++;
                    const context = new AudioContext();
                    const stream = context.createMediaStreamDestination().stream;
                    for (const track of stream.getTracks()) {
                        const stop = track.stop.bind(track);
                        track.stop = () => { stop(); context.close().catch(() => {}); };
                        window.captureTracks.push(track);
                    }
                    return stream;
                }
            });
        });
        page.on('request', request => requests.push(request.url()));
        await page.route('**/*', route => {
            const address = new URL(route.request().url());
            if (address.origin === baseURL) return route.continue();
            external.push(address.href);
            if (address.origin === 'https://webjam-turn-credentials.jeffstory007.workers.dev') return route.fulfill({ status: 503, body: 'unavailable' });
            return route.abort();
        });
        const capability = Buffer.alloc(32, 17).toString('base64url'), session = '22'.repeat(32);
        await page.goto(`/join/#k=${capability}&s=${session}&g=1&e=${Math.floor(Date.now() / 1000) + 300}`);
        await expect(page.locator('#status')).toContainText('Your host invited you');
        expect(await page.evaluate(() => window.captureCount)).toBe(0);
        expect(external).toEqual([]);
        await page.getByRole('button', { name: 'Skip check', exact: true }).click();
        await page.getByRole('checkbox').check();
        const join = page.getByRole('button', { name: 'Join with microphone', exact: true });
        await expect(join).toBeEnabled();
        expect(await page.evaluate(() => window.captureCount)).toBe(0);
        await join.click();
        await expect(page.locator('#status')).toContainText('Web Join is unavailable');
        await expect(join).toBeHidden();
        await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Leave session', exact: true })).toBeHidden();
        expect(await page.evaluate(() => captureTracks.length > 0 && captureTracks.every(track => track.readyState === 'ended'))).toBe(true);
        expect(external).toHaveLength(1);
        await page.getByRole('button', { name: 'Retry', exact: true }).click();
        await expect(page.locator('#status')).toContainText('Web Join is unavailable');
        await expect.poll(() => page.evaluate(() => window.captureCount)).toBe(2);
        expect(await page.evaluate(() => captureTracks.every(track => track.readyState === 'ended'))).toBe(true);
        expect(external).toHaveLength(2);
        for (const address of requests) { expect(address).not.toContain(capability); expect(address).not.toContain(session); }
        expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).not.toContain(capability);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`webjam-join-${width}.png`) });
    });
}

for (const width of [375, 390]) {
    for (const name of ['NotAllowedError', 'NotFoundError']) {
        test(`packaged microphone check recovers ${name} at ${width}px without connecting`, async ({ page }) => {
            await page.setViewportSize({ width, height: 844 });
            await page.addInitScript(({ name }) => {
                window.captureCount = 0;
                Object.defineProperty(Object.getPrototypeOf(navigator.mediaDevices), 'getUserMedia', {
                    configurable: true,
                    value: async () => { window.captureCount++; throw new DOMException('Fixture microphone failure', name); }
                });
            }, { name });
            const external = [];
            await page.route('https://webjam-turn-credentials.jeffstory007.workers.dev/**', route => {
                external.push(route.request().url()); return route.abort();
            });
            const capability = Buffer.alloc(32, 17).toString('base64url');
            await page.goto(`/join/#k=${capability}&s=${'22'.repeat(32)}&g=1&e=${Math.floor(Date.now() / 1000) + 300}`);
            expect(await page.evaluate(() => window.captureCount)).toBe(0);
            await page.getByRole('button', { name: 'Check microphone', exact: true }).click();
            await expect(page.locator('#mic-error')).toContainText(name === 'NotAllowedError' ? 'Microphone access was blocked' : 'No microphone found');
            await expect(page.locator('#join')).toBeDisabled();
            await page.getByRole('button', { name: 'Try again', exact: true }).click();
            await expect.poll(() => page.evaluate(() => window.captureCount)).toBe(2);
            await expect(page.locator('#mic-retry')).toBeVisible();
            expect(external).toEqual([]);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        });
    }
}
