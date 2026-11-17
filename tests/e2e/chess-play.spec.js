const { test, expect } = require('@playwright/test');

async function start(page, mode = 'computer') {
    await page.goto('/play/chess.html');
    await page.getByRole('radio', { name: mode === 'local' ? /2 players/ : /1 player/ }).check();
    await page.locator('#new-game button[type=submit]').click();
}
async function move(page, from, to) {
    const activate = locator => test.info().project.use.hasTouch ? locator.tap() : locator.click();
    await activate(page.locator(`[data-square=${from}]`));
    await activate(page.locator(`[data-square=${to}]`));
}

test('the replacement board drags under Stalemate CSP, serves licensed art and resumes the same game', async ({ page }) => {
    const errors = [], failed = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) failed.push(response.url()); });
    await start(page, 'local');
    await expect(page.locator('#board')).toHaveAttribute('data-renderer', 'chessground');
    const from = await page.locator('[data-square=e2]').boundingBox(), to = await page.locator('[data-square=e4]').boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
    await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    await page.mouse.up(); await expect(page.locator('#moves button')).toHaveCount(1);
    await expect.poll(() => page.locator('cg-board piece.pawn.white').evaluateAll(pieces => pieces.some(p => p.cgKey === 'e4'))).toBe(true);
    const piece = page.locator('cg-board piece.pawn.white').first();
    expect(await piece.evaluate(el => getComputedStyle(el).backgroundImage)).toContain('spatial-wp.svg');
    const license = await page.request.get('/play/assets/chess/Spatial-LICENSE.txt');
    expect(license.status()).toBe(200); expect(await license.text()).toContain('Maurizio Monge');
    const source = await page.request.get('/play/assets/chess/chessground-10.5.0-source.tar.gz'); expect(source.status()).toBe(200);
    await page.reload(); await page.locator('#continue').click();
    await expect(page.locator('#moves button')).toHaveCount(1); await move(page, 'e7', 'e5');
    await expect(page.locator('#moves button')).toHaveCount(2);
    expect(errors).toEqual([]); expect(failed).toEqual([]);
});

for (const asset of ['pieces/spatial-wk.svg', 'chessground.js']) {
    test(`missing ${asset} keeps saved play safe and recovers deliberately`, async ({ page }) => {
        await start(page, 'local'); await move(page, 'e2', 'e4'); await expect(page.locator('#moves button')).toHaveCount(1);
        const saved = await page.evaluate(() => localStorage.getItem('arcade_chess_save_v1'));
        await page.route(`**/assets/chess/${asset}`, route => route.abort()); await page.reload();
        await expect(page.locator('#suite-load-state')).toBeVisible();
        await expect(page.locator('#new-game button[type=submit]')).toBeDisabled();
        expect(await page.evaluate(() => localStorage.getItem('arcade_chess_save_v1'))).toBe(saved);
        await page.unroute(`**/assets/chess/${asset}`); await page.getByRole('button', { name: 'Try again', exact: true }).click();
        await page.locator('#continue').click(); await expect(page.locator('#moves button')).toHaveCount(1);
        await move(page, 'e7', 'e5'); await expect(page.locator('#moves button')).toHaveCount(2);
    });
}

test('chess runs the self-hosted computer under Stalemate CSP and keeps its own save', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('turdtrisHighScore', '321'));
    await start(page);
    await move(page, 'e2', 'e4');
    await expect(page.locator('#moves button')).toHaveCount(2);
    await page.locator('#hint').click();
    await expect(page.locator('#status')).toHaveText(/^Try /);
    await page.locator('#undo').click();
    await expect(page.locator('#moves button')).toHaveCount(0);
    await move(page, 'd2', 'd4');
    await expect(page.locator('#moves button')).toHaveCount(2);
    await page.locator('#mute').click();
    await page.reload();
    await page.locator('#continue').click();
    await expect(page.locator('#moves button')).toHaveCount(2);
    expect(await page.evaluate(() => Suite.isMuted())).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem('turdtrisHighScore'))).toBe('321');
    await page.locator('.chess-hub').click();
    await expect(page.locator('.game-card[href="chess.html"] .play')).toContainText('Continue');
    await expect(page.locator('.game-card')).toHaveCount(9);
    expect(errors).toEqual([]);
});

test('chess local checkmate, result review and PGN export work without a server opponent', async ({ page }) => {
    await start(page, 'local');
    for (const [from, to] of [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']]) await move(page, from, to);
    await expect(page.locator('#turn')).toHaveText('Black wins!');
    await expect(page.locator('#status')).toHaveText('Checkmate');
    await page.reload();
    await expect(page.locator('#continue')).toHaveText('Review last game');
    await page.locator('#continue').click();
    await page.locator('#game-options > summary').click();
    const download = page.waitForEvent('download');
    await page.locator('#export').click();
    expect((await download).suggestedFilename()).toBe('royal-flush-chess.pgn');
    const stats = await page.evaluate(() => JSON.parse(localStorage.getItem('arcade_chess_results_v1')));
    expect(stats.local).toBe(1);
    await page.locator('.chess-hub').click();
    await expect(page.locator('.game-card[href="chess.html"] .play')).not.toContainText('Continue');
    await expect(page.locator('.game-card[href="chess.html"] .suite-hub-stat')).toContainText('1 completed');
});

for (const mime of ['', 'application/octet-stream']) {
    test(`the real computer streams its unchanged binary with ${mime || 'empty'} server MIME metadata`, async ({ page }) => {
        let downloads = 0;
        await page.context().route('**/stockfish-19-lite-single.wasm', async route => {
            downloads++;
            const response = await route.fetch();
            await route.fulfill({ response, headers: { ...response.headers(), 'content-type': mime } });
        });
        await start(page);
        await move(page, 'e2', 'e4'); await expect(page.locator('#moves button')).toHaveCount(2);
        await move(page, 'g1', 'f3'); await expect(page.locator('#moves button')).toHaveCount(4);
        await expect(page.locator('#engine-recovery')).toBeHidden();
        expect(downloads).toBe(1);
    });
}

test('phone visitors can select two players immediately without downloading the computer', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    const engine = [];
    page.on('request', request => { if (/stockfish.*\.(js|wasm)/.test(request.url())) engine.push(request.url()); });
    await page.goto('/play/chess.html');
    await expect(page.getByRole('radio', { name: /1 player/ })).toBeVisible();
    await page.getByRole('radio', { name: /2 players/ }).check();
    await expect(page.locator('#computer-options')).toBeHidden();
    const play = page.getByRole('button', { name: 'Play 2-player chess →' });
    const box = await play.boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(568);
    await play.click(); await move(page, 'e2', 'e4'); await move(page, 'e7', 'e5');
    await expect(page.locator('#moves button')).toHaveCount(2);
    await page.reload(); await page.locator('#continue').click();
    await expect(page.locator('#game-label')).toContainText('PASS & PLAY');
    await expect(page.locator('#moves button')).toHaveCount(2);
    expect(engine).toEqual([]);
});

test('the optional visual guide starts at the heading and closes without changing the board', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await start(page, 'local'); await move(page, 'e2', 'e4');
    await page.locator('#game-options > summary').click(); await page.locator('#help').click();
    expect(await page.locator('#guide').evaluate(el => el.scrollTop)).toBe(0);
    await page.locator('#piece-guide summary').click();
    await expect(page.locator('#piece-reference dt')).toHaveCount(6);
    await page.getByRole('button', { name: 'Close how to play' }).click();
    await expect(page.locator('#guide')).not.toBeVisible();
    await expect(page.locator('#moves button')).toHaveCount(1);
    await move(page, 'e7', 'e5'); await expect(page.locator('#moves button')).toHaveCount(2);
});

for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }, { width: 568, height: 320 }, { width: 667, height: 375 }]) {
    test(`chess board stays square and its controls remain reachable at ${viewport.width}px`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await start(page, 'local');
        const board = await page.locator('#board').boundingBox();
        expect(Math.abs(board.height - board.width)).toBeLessThan(1);
        if (viewport.width > viewport.height) {
            expect(board.y).toBeGreaterThanOrEqual(0);
            expect(board.y + board.height).toBeLessThanOrEqual(viewport.height);
            const table = await page.locator('.chess-table').boundingBox();
            expect(table.y).toBeGreaterThanOrEqual(0);
            expect(table.y + table.height).toBeLessThanOrEqual(viewport.height);
        }
        const square = await page.locator('[data-square=e2]').boundingBox();
        expect(Math.abs(square.height - square.width)).toBeLessThan(1);
        await page.locator('[data-square=e2]').focus();
        await page.keyboard.press('Enter');
        await page.keyboard.press('ArrowUp');
        await page.keyboard.press('ArrowUp');
        await page.keyboard.press('Enter');
        await expect(page.locator('#moves button')).toHaveCount(1);
        await page.locator('#game-options > summary').click();
        await page.locator('#suite-arcade-a11y-toggle').click();
        await expect(page.locator('#suite-arcade-a11y-toggle')).toHaveText('Contrast on');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
}

test('computer play keeps both player strips and board visible through rotation and flipping', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await start(page); await move(page, 'e2', 'e4'); await expect(page.locator('#moves button')).toHaveCount(2);
    for (const viewport of [{ width: 568, height: 320 }, { width: 667, height: 375 }, { width: 844, height: 390 }]) {
        await page.setViewportSize(viewport);
        for (const flip of [false, true]) {
            if (flip) await page.locator('#flip').click();
            const table = await page.locator('.chess-table').boundingBox();
            expect(table.y).toBeGreaterThanOrEqual(0); expect(table.y + table.height).toBeLessThanOrEqual(viewport.height);
        }
    }
});

test('chess exposes intentional retry when its computer request fails', async ({ page }) => {
    let blocked = 0;
    await page.context().route('**/stockfish-19-lite-single.wasm', route => { blocked++; return route.abort(); });
    await start(page);
    await move(page, 'e2', 'e4');
    await expect(page.locator('#engine-recovery')).toBeVisible({ timeout: 20000 });
    expect(blocked).toBeGreaterThan(0);
    await expect(page.locator('#moves button')).toHaveCount(1);
    await page.context().unroute('**/stockfish-19-lite-single.wasm');
    await page.locator('#retry').click();
    await expect(page.locator('#moves button')).toHaveCount(2);
    await expect(page.locator('#engine-recovery')).toBeHidden();
});

test('a delayed engine reply cannot survive undo or restart', async ({ page }) => {
    let release;
    const ready = new Promise(resolve => { release = resolve; });
    let blocked = 0;
    await page.context().route('**/stockfish-19-lite-single.wasm', async route => {
        blocked++;
        await ready;
        await route.continue().catch(() => {});
    });
    try {
        await start(page);
        await move(page, 'e2', 'e4');
        await expect.poll(() => blocked).toBeGreaterThan(0);
        await page.locator('#undo').click();
        await expect(page.locator('#moves button')).toHaveCount(0);
        release();
        await page.waitForTimeout(800);
        await expect(page.locator('#moves button')).toHaveCount(0);
        await page.context().unroute('**/stockfish-19-lite-single.wasm');
        await move(page, 'd2', 'd4');
        await expect(page.locator('#moves button')).toHaveCount(2);
    } finally { release(); }
});

test('local play works offline and computer failure preserves the position for retry', async ({ page }) => {
    await start(page, 'local');
    await page.context().setOffline(true);
    await move(page, 'e2', 'e4');
    await expect(page.locator('#moves button')).toHaveCount(1);
    await page.context().setOffline(false);
    await page.locator('#game-options > summary').click();
    await page.locator('#new').click();
    await page.locator('input[name=mode][value=computer]').check();
    await page.locator('#new-game button[type=submit]').click();
    await page.locator('#confirm-yes').click();
    await page.context().setOffline(true);
    await move(page, 'd2', 'd4');
    await expect(page.locator('#engine-recovery')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('#moves button')).toHaveCount(1);
    await page.context().setOffline(false);
    await page.locator('#retry').click();
    await expect(page.locator('#moves button')).toHaveCount(2);
});
