const { test, expect } = require('@playwright/test');

async function board(page) {
    return page.locator('#board .tile').evaluateAll((tiles) => tiles.map((t) => [Number(t.dataset.id), Number(t.dataset.kind), Number(t.dataset.col), Number(t.dataset.row)]).sort((a, b) => a[0] - b[0]));
}

async function activate(page, target) {
    if (!test.info().project.use.hasTouch) {
        await target.click();
        return;
    }
    await expect(target).toBeVisible();
    const inspect = () => target.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const x = rect.x + rect.width / 2;
        const y = rect.y + rect.height / 2;
        const hit = document.elementFromPoint(x, y);
        return {
            x, y,
            onScreen: rect.width > 0 && rect.height > 0 && rect.x >= 0 && rect.y >= 0
                && rect.right <= innerWidth && rect.bottom <= innerHeight,
            receivesTouch: hit === el || el.contains(hit),
            boardTile: el.matches('#board .tile')
        };
    });
    let point = await inspect();
    // Game tiles must fit without scrolling; tall homepage links may need it.
    if (!point.onScreen && !point.boardTile) {
        await target.scrollIntoViewIfNeeded();
        point = await inspect();
    }
    expect(point.onScreen, 'The control must fit on screen').toBe(true);
    expect(point.receivesTouch, 'The control must receive the touch').toBe(true);
    await page.touchscreen.tap(point.x, point.y);
}

async function popOne(page) {
    const move = await page.evaluate(() => {
        const { state, Core } = window.__turdomania;
        if (state.over) return null;
        const seen = new Set();
        let move = null;
        let largest = 1;
        for (let c = 0; c < state.board.length; c++) {
            for (let r = 0; r < state.board[c].length; r++) {
                if (seen.has(`${c},${r}`)) continue;
                const group = Core.findGroup(state.board, c, r);
                for (const [col, row] of group) seen.add(`${col},${row}`);
                if (group.length > largest) {
                    largest = group.length;
                    move = { cell: [c, r], previousMoves: state.moves };
                }
            }
        }
        return move;
    });
    if (!move) return false;
    await activate(page, page.locator(`.tile[data-col="${move.cell[0]}"][data-row="${move.cell[1]}"]`));
    await expect.poll(() => page.evaluate(() => window.__turdomania.state.moves), {
        message: 'A real input must complete exactly one legal pop'
    }).toBe(move.previousMoves + 1);
    return true;
}

async function ready(page, path) {
    await page.goto(path);
    await page.waitForFunction(() => !!window.__turdomania);
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveTitle('Turdomania');
    await expect(page.locator('#newBtn')).toHaveText(/New board/);
    await expect(page.locator('#levelSel')).toBeEnabled();
}

test('homepage and hub offer seven ordinary games at root and project paths', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    for (const prefix of ['', '/StalemateSite']) {
        await page.goto(prefix + '/');
        await expect(page.locator('body')).not.toContainText('Daily Dump');
        const open = page.getByRole('link', { name: 'Open Stalemate Arcade', exact: true });
        await expect(open).toHaveAttribute('href', 'play/');
        await activate(page, open);
        await expect(page).toHaveURL(new RegExp(prefix + '/play/$'));
        await expect(page.locator('h1')).toHaveText('Stalemate Arcade');
        await expect(page.locator('body')).not.toContainText('Daily Dump');
        await expect(page.locator('a[href*="daily="]')).toHaveCount(0);
        await expect(page.locator('.game-card')).toHaveCount(7);
        const turdomania = page.locator('a.game-card[href="turdomania.html"]');
        await activate(page, turdomania);
        await expect(page).toHaveURL(new RegExp(prefix + '/play/turdomania\\.html$'));
        await page.waitForFunction(() => !!window.__turdomania);
        await expect(page).toHaveTitle('Turdomania');
        await expect(page.locator('#newBtn')).toBeEnabled();
    }
    expect(errors).toEqual([]);
});

test('former daily links open seeded free play with working undo at either base path', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    for (const [prefix, legacy] of [['', 'daily=2026-10-21&v=1'], ['/StalemateSite', 'daily=not-a-date&v=999']]) {
        const game = prefix + '/play/turdomania.html';
        const options = 'seed=12345&level=easy&reducedMotion=1';
        await ready(page, game + '?' + options);
        const ordinary = await board(page);
        await ready(page, game + '?' + legacy + '&' + options);
        await expect(page.locator('body')).not.toHaveClass(/daily-dump/);
        await expect(page.locator('body')).not.toContainText('Daily Dump');
        expect(await board(page)).toEqual(ordinary);
        expect(await popOne(page)).toBe(true);
        expect((await board(page)).length).toBeLessThan(ordinary.length);
        await expect(page.locator('#undoBtn')).toBeEnabled();
        await activate(page, page.locator('#undoBtn'));
        expect(await board(page)).toEqual(ordinary);
        await expect(page.locator('#newBtn')).toBeEnabled();
    }
    expect(errors).toEqual([]);
});

test('ordinary Turdomania completes and preserves existing preferences and records', async ({ page }) => {
    await page.goto('/play/turdomania.html');
    const saved = await page.evaluate(() => {
        const fixture = {
            turdomania_best_v1: JSON.stringify({ v: 1, best: { easy: 90, normal: 120, hard: 30 } }),
            turdomania_prefs_v1: JSON.stringify({ v: 1, level: 'normal' }),
            stalemate_daily_dump_active_v1: '{"v":1,"moves":[[0,0]]}',
            'stalemate_daily_dump_result_v1:legacy': '{"score":77}'
        };
        for (const [key, value] of Object.entries(fixture)) localStorage.setItem(key, value);
        return fixture;
    });
    await ready(page, '/StalemateSite/play/turdomania.html?daily=today&v=1&seed=1937471283&level=normal&reducedMotion=1');
    for (let count = 0; count < 60 && await popOne(page); count++) { /* Complete using real game input. */ }
    await expect(page.locator('#overlay')).toHaveClass(/show/);
    const score = await page.evaluate(() => window.__turdomania.state.score);
    const stored = await page.evaluate((keys) => Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)])), Object.keys(saved));
    expect(JSON.parse(stored.turdomania_best_v1)).toEqual({ v: 1, best: { easy: 90, normal: Math.max(120, score), hard: 30 } });
    expect(stored.turdomania_prefs_v1).toBe(saved.turdomania_prefs_v1);
    expect(stored.stalemate_daily_dump_active_v1).toBe(saved.stalemate_daily_dump_active_v1);
    expect(stored['stalemate_daily_dump_result_v1:legacy']).toBe(saved['stalemate_daily_dump_result_v1:legacy']);
    await page.reload();
    await page.waitForFunction(() => !!window.__turdomania);
    await expect(page.locator('#best')).toHaveText(String(Math.max(120, score)));
});

test('free play and the arcade hub remain usable when storage is unavailable', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
        Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('blocked', 'SecurityError'); } });
    });
    await ready(page, '/play/turdomania.html?daily=2026-10-21&v=1&seed=12345&level=easy&reducedMotion=1');
    const initial = await board(page);
    expect(await popOne(page)).toBe(true);
    await activate(page, page.locator('#undoBtn'));
    expect(await board(page)).toEqual(initial);
    await page.goto('/StalemateSite/play/');
    await expect(page.locator('.game-card')).toHaveCount(7);
    await expect(page.locator('body')).not.toContainText('Daily Dump');
    expect(errors).toEqual([]);
});
