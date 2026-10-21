const { test, expect } = require('@playwright/test');

async function board(page) {
    return page.locator('#board .tile').evaluateAll((tiles) => tiles.map((t) => [Number(t.dataset.id), Number(t.dataset.kind), Number(t.dataset.col), Number(t.dataset.row)]).sort((a, b) => a[0] - b[0]));
}
async function popOne(page) {
    const cell = await page.evaluate(() => {
        const { state, Core } = window.__turdomania;
        for (let c = 0; c < state.board.length; c++) {
            for (let r = 0; r < state.board[c].length; r++) {
                if (Core.findGroup(state.board, c, r).length >= 2) return [c, r];
            }
        }
        return null;
    });
    if (!cell) return false;
    await page.locator(`.tile[data-col="${cell[0]}"][data-row="${cell[1]}"]`).click();
    return true;
}
async function ready(page, path = '/play/turdomania.html?daily=2026-10-21&v=1&reducedMotion=1') {
    await page.goto(path);
    await expect(page.locator('#dailyIdentity')).toContainText('2026-10-21');
    await page.waitForFunction(() => !!window.__turdomania);
}

test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-21T18:00:00Z'));
});

test('Daily Dump preserves one logical board across viewports, rotation, refresh, and the project prefix', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await ready(page);
    const original = await board(page);
    expect(original).toHaveLength(80);
    await expect(page.locator('#board')).toHaveAttribute('aria-colcount', '8');
    await expect(page.locator('#board')).toHaveAttribute('aria-rowcount', '10');
    const initialSize = page.viewportSize();
    await page.setViewportSize({ width: 844, height: 390 });
    expect(await board(page)).toEqual(original);
    await page.setViewportSize(initialSize);
    await page.goto('/StalemateSite/play/turdomania.html?daily=2026-10-21&v=1&reducedMotion=1');
    await page.waitForFunction(() => !!window.__turdomania);
    expect(await board(page)).toEqual(original);
    expect(await popOne(page)).toBe(true);
    const moved = await board(page);
    expect(moved.length).toBeLessThan(80);
    await page.reload();
    await page.waitForFunction(() => !!window.__turdomania);
    expect(await board(page)).toEqual(moved);
    await expect(page.locator('#undoBtn')).toBeDisabled();
    await page.locator('#board').focus();
    await page.keyboard.press('u');
    expect(await board(page)).toEqual(moved);
    // Crossing midnight never starts a replacement board, including on refresh.
    await page.clock.setFixedTime(new Date('2026-10-22T06:01:00Z'));
    await page.reload();
    await page.waitForFunction(() => !!window.__turdomania);
    expect(await board(page)).toEqual(moved);
    await expect(page.locator('#dailyIdentity')).toContainText('2026-10-21');
    expect(errors).toEqual([]);
});

test('a completed Daily Dump keeps its first result, offers valid sharing, and separates practice/free play', async ({ page }) => {
    await ready(page);
    for (let i = 0; i < 40 && await popOne(page); i++) { /* Play legal moves through the actual UI. */ }
    await expect(page.locator('#overlay')).toHaveClass(/show/);
    const first = await page.locator('#best').textContent();
    const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('stalemate_daily_dump_result_v1:')));
    expect(keys).toHaveLength(1);
    expect(await page.evaluate(() => localStorage.getItem('turdomania_best_v1'))).toBeNull();
    await page.evaluate(() => {
        Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: undefined });
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    });
    await page.locator('#dailyShare').click();
    const fallback = page.locator('#dailyShareFallback');
    await expect(fallback).toBeVisible();
    await expect(fallback).toHaveValue(/Stalemate Arcade · The Daily Dump\n2026-10-21/);
    const text = await fallback.inputValue();
    const link = new URL(text.split('\n').at(-1));
    expect(link.pathname).toBe('/play/turdomania.html');
    expect([...link.searchParams]).toEqual([['daily', '2026-10-21'], ['v', '1']]);
    // Canceling native share must leave the result available without invoking copy.
    await page.evaluate(() => {
        navigator.share = () => Promise.reject(new DOMException('cancel', 'AbortError'));
        navigator.canShare = () => false;
    });
    await page.locator('#dailyShare').click();
    await expect(page.locator('#dailyShareStatus')).toContainText('canceled');
    await page.evaluate(() => {
        navigator.canShare = () => true;
        navigator.share = (data) => { window.__dailyShared = data; return Promise.resolve(); };
    });
    await page.locator('#dailyShare').click();
    const shared = await page.evaluate(() => ({
        title: window.__dailyShared.title, text: window.__dailyShared.text,
        files: window.__dailyShared.files.map((f) => ({ type: f.type, size: f.size, name: f.name }))
    }));
    expect(shared.title).toContain('Stalemate Arcade');
    expect(shared.text).toContain('daily=2026-10-21&v=1');
    expect(shared.files[0].type).toBe('image/png');
    expect(shared.files[0].size).toBeGreaterThan(1000);
    await page.locator('#againBtn').click();
    await expect(page.locator('#dailyIdentity')).toContainText('PRACTICE');
    expect(await popOne(page)).toBe(true);
    await expect(page.locator('#undoBtn')).toBeEnabled();
    await page.locator('#undoBtn').click();
    expect(await board(page)).toHaveLength(80);
    await expect(page.locator('#best')).toHaveText(first);
    await page.goto('/play/');
    await expect(page.locator('#daily-hub-status')).toContainText(`${first} points`);
    await expect(page.locator('#daily-hub-play')).toContainText('See result');
    await page.goto('/play/turdomania.html');
    await expect(page.locator('body')).not.toHaveClass(/daily-dump/);
    await expect(page.locator('#levelSel')).toBeEnabled();
});

test('Daily Dump starts with denied storage, rejects malformed challenge parameters, without disrupting the hub', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => {
        Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('blocked', 'SecurityError'); } });
    });
    await ready(page);
    await expect(page.locator('#dailyStorageNote')).toContainText('Saving is unavailable');
    expect(await popOne(page)).toBe(true);
    await page.goto('/play/turdomania.html?daily=2026-02-30&v=1');
    await expect(page.locator('#dailyInfo')).toContainText('invalid');
    await expect(page.locator('body')).not.toHaveClass(/daily-dump/);
    await page.goto('/play/turdomania.html?daily=2026-10-21&v=999');
    await expect(page.locator('#dailyInfo')).toContainText('unavailable rules version');
    await page.goto('/play/');
    await expect(page.locator('#daily-hub-play')).toBeVisible();
    await expect(page.locator('.game-card')).toHaveCount(7);
    expect(errors).toEqual([]);
});


test('corrupt or stale daily saves leave existing free-play records intact', async ({ page }) => {
    await page.goto('/play/turdomania.html');
    await page.evaluate(async () => {
        const Daily = await import('/play/games/turdomania-daily.js');
        const challenge = Daily.makeChallenge('2026-10-21');
        localStorage.setItem('turdomania_best_v1', JSON.stringify({ v: 1, best: { easy: 90, normal: 120, hard: 30 } }));
        localStorage.setItem(Daily.ACTIVE_KEY, '{corrupt');
        localStorage.setItem(Daily.ACTIVE_PREFIX + challenge.id, JSON.stringify({ v: 999, challenge, practice: false, moves: [] }));
    });
    await ready(page);
    await expect(page.locator('#dailyStorageNote')).toContainText('unreadable or outdated');
    expect(await board(page)).toHaveLength(80);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('turdomania_best_v1')).best.normal)).toBe(120);
});
