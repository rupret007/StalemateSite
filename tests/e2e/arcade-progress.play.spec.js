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
