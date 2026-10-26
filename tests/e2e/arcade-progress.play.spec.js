const { readFile } = require('node:fs/promises');
const { test, expect } = require('../helpers/media-diagnostics');

test.use({ reducedMotion: 'reduce' });

async function move(page, lan, touch = false) {
    for (const square of [lan.slice(0, 2), lan.slice(2, 4)]) {
        const target = page.locator(`[data-square=${square}]`);
        if (touch) await target.tap(); else await target.click();
        await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    }
}

test('a chosen goal credits one native local game and preserves replay, history and a real result image', async ({ page }, testInfo) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/play/');
    await page.locator('.suite-progress-open').click();
    await expect(page.locator('.suite-progress-dialog')).toContainText('Only on this browser and this site');
    await page.locator('#progress-goal-chess-finish').click();
    await page.locator('.suite-progress-close').click();
    await page.locator('.game-card[href="chess.html"]').click();
    await page.locator('input[name=mode][value=local]').check();
    await page.locator('#new-game button[type=submit]').click();
    for (const lan of ['e2e4', 'e7e5', 'd1h5', 'b8c6', 'f1c4', 'g8f6', 'h5f7']) {
        await move(page, lan, !!testInfo.project.use.hasTouch);
    }
    await expect(page.locator('#result')).toBeVisible();
    await expect(page.locator('#progress-result')).toContainText('Final move');
    const first = await page.evaluate(() => SuiteProgress.snapshot());
    expect(first.history.chess).toHaveLength(1);
    expect(first.history.chess[0]).toMatchObject({ mode: 'local', local: true, assisted: false, moves: 7, winner: 'w' });
    expect(first.earned['chess-finish'].source).toBe('event');
    const downloadReady = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Save image', exact: true }).click();
    const download = await downloadReady;
    const saved = testInfo.outputPath('native-chess-result-card.png');
    await download.saveAs(saved);
    const png = await readFile(saved);
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1080, 1080]);
    await page.screenshot({ path: testInfo.outputPath('native-chess-result.png'), fullPage: true });
    await page.reload();
    await page.locator('#continue').click();
    await page.locator('#flip').click();
    expect(await page.evaluate(() => SuiteProgress.snapshot().history.chess.length)).toBe(1);
    await page.locator('#rematch').click();
    await expect(page.locator('#result')).toBeHidden();
    await expect(page.locator('.suite-result-share')).toBeHidden();
    await move(page, 'e2e4', !!testInfo.project.use.hasTouch);
    await page.locator('.chess-hub').click();
    await page.locator('.suite-progress-open').click();
    await page.getByRole('button', { name: 'Recent results', exact: true }).click();
    await expect(page.locator('.suite-progress-view')).toContainText('Local two-player');
    await expect(page.locator('.suite-progress-view')).toContainText('White wins');
    await expect(page.locator('.suite-progress-view')).toContainText('7 half-moves');
    await page.screenshot({ path: testInfo.outputPath('native-chess-history.png'), fullPage: true });
    expect(errors).toEqual([]);
});

test('denied progress storage leaves native completed play and replay available', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(window, 'localStorage', {
        get() { throw new Error('Storage denied by test fixture'); }
    }));
    await page.goto('/play/chess.html?mode=local&fen=ignored&save=ignored');
    await expect(page.locator('input[name=mode][value=local]')).toBeChecked();
    await page.locator('#new-game button[type=submit]').click();
    await move(page, 'e2e4');
    await page.locator('#game-options > summary').click();
    await page.locator('#resign').click();
    await page.locator('#confirm-yes').click();
    await expect(page.locator('#progress-result')).toContainText('cannot be saved');
    await expect(page.locator('.suite-result-share')).toBeVisible();
    await page.locator('#rematch').click();
    await expect(page.locator('#result')).toBeHidden();
});


// Synthetic stale-cache fixture: only obsolete bare JavaScript URLs are
// replaced. Versioned requests pass through to the real local imported files.
test('content versions bypass stale arcade scripts through a native completed chess game', async ({ page }, testInfo) => {
    const { createHash } = require('node:crypto');
    const path = require('node:path');
    const changedScripts = [
        'assets/suite-progress.js', 'assets/suite-share.js',
        'games/suite-progress-core.js', 'games/table-continue-core.js',
        'games/chess-core.js', 'games/chess-engine.js', 'games/chess-ui.js'
    ];
    const sha = body => createHash('sha256').update(body).digest('hex');
    const expected = new Map(await Promise.all(changedScripts.map(async asset =>
        [asset, sha(await readFile(path.join(__dirname, '../../play', asset))).slice(0, 16)]
    )));
    const staleRequests = [], errors = [], responseTasks = [];
    const requests = new Map(), responses = new Map();
    const assetFor = value => {
        const url = new URL(value);
        const asset = url.pathname.match(/\/play\/(.+)$/)?.[1];
        return expected.has(asset) ? { url, asset } : null;
    };
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
        const hit = assetFor(route.request().url());
        if (!hit) return route.fallback();
        if (!hit.url.searchParams.has('v')) {
            staleRequests.push(hit.url.href);
            return route.fulfill({
                contentType: 'application/javascript',
                body: 'globalThis.__staleArcadeExecutions = (globalThis.__staleArcadeExecutions || []).concat("old-asset"); throw new Error("Synthetic stale arcade script executed");'
            });
        }
        requests.set(hit.asset, [...(requests.get(hit.asset) || []), hit.url.href]);
        return route.fallback();
    });
    page.on('response', response => {
        const hit = assetFor(response.url());
        if (hit && hit.url.searchParams.has('v')) {
            responseTasks.push(response.body().then(body => responses.set(hit.asset,
                { url: response.url(), status: response.status(), body, sha256: sha(body) })));
        }
    });
    await page.goto('/play/chess.html?mode=local');
    await expect.poll(() => requests.has('games/chess-ui.js')).toBe(true);
    await page.locator('input[name=mode][value=local]').check();
    await page.locator('#new-game button[type=submit]').click();
    for (const lan of ['e2e4', 'e7e5', 'd1h5', 'b8c6', 'f1c4', 'g8f6', 'h5f7']) {
        await move(page, lan, !!testInfo.project.use.hasTouch);
    }
    await expect(page.locator('#result')).toBeVisible();
    await expect(page.locator('#progress-result')).toContainText('Final move');
    const result = await page.evaluate(() => SuiteProgress.snapshot());
    expect(result.history.chess).toHaveLength(1);
    expect(result.history.chess[0]).toMatchObject({ mode: 'local', local: true, assisted: false, moves: 7, winner: 'w' });
    expect(result.earned['chess-finish'].source).toBe('event');
    const nativeShareAvailable = await page.evaluate(() => typeof navigator.share === 'function');
    await page.locator('.suite-result-share button').click();
    if (nativeShareAvailable) await expect(page.locator('.suite-result-share-status')).toHaveText('Shared.');
    else await expect(page.locator('.suite-result-share-status')).toContainText(/copied|Select and copy/);
    await Promise.all(responseTasks);
    for (const asset of changedScripts) {
        expect(requests.get(asset), asset + ' loads once at its content version').toHaveLength(1);
        const url = new URL(requests.get(asset)[0]);
        expect(url.searchParams.get('v'), asset).toBe(expected.get(asset));
        expect(responses.get(asset).status, asset).toBe(200);
        expect(responses.get(asset).sha256.slice(0, 16), asset + ' delivers current bytes').toBe(expected.get(asset));
    }
    const coreUrl = requests.get('games/chess-core.js')[0];
    const engineUrl = requests.get('games/chess-engine.js')[0];
    const uiUrl = requests.get('games/chess-ui.js')[0];
    const engineBody = responses.get('games/chess-engine.js').body.toString('utf8');
    const uiBody = responses.get('games/chess-ui.js').body.toString('utf8');
    const specifier = (body, name) => body.match(new RegExp("from\\s*['\"]([^'\"]*" + name + "\\.js\\?[^'\"]+)['\"]"))?.[1];
    expect(new URL(specifier(engineBody, 'chess-core'), engineUrl).href).toBe(coreUrl);
    expect(new URL(specifier(uiBody, 'chess-core'), uiUrl).href).toBe(coreUrl);
    expect(new URL(specifier(uiBody, 'chess-engine'), uiUrl).href).toBe(engineUrl);
    expect(staleRequests).toEqual([]);
    expect(await page.evaluate(() => globalThis.__staleArcadeExecutions || [])).toEqual([]);
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('stale-cache-fixture-native-mate.png'), fullPage: true });
    await testInfo.attach('stale-cache-fixture-network', {
        body: JSON.stringify({ method: 'Synthetic old bare-script responses; real versioned responses and natural native seven-move mate.',
            requests: Object.fromEntries(requests), staleRequests, errors,
            responses: Object.fromEntries([...responses].map(([asset, response]) =>
                [asset, { url: response.url, status: response.status, sha256: response.sha256 }])) }, null, 2),
        contentType: 'application/json'
    });
});
