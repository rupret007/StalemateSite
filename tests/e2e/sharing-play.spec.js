const { test, expect } = require('@playwright/test');
const { readFileSync } = require('node:fs');
const pageErrors = new WeakMap();
test.beforeEach(async ({ page }) => {
    const errors = []; pageErrors.set(page, errors);
    page.on('pageerror', error => errors.push(error.message));
});
test.afterEach(async ({ page }) => { expect(pageErrors.get(page)).toEqual([]); });

async function activate(page, locator) {
    await locator.scrollIntoViewIfNeeded();
    await expect(locator).toBeVisible();
    const target = await locator.evaluate(el => {
        const b = el.getBoundingClientRect(), x = b.x + b.width / 2, y = b.y + b.height / 2;
        const hit = document.elementFromPoint(x, y);
        return { fits: b.x >= 0 && b.y >= 0 && b.right <= innerWidth && b.bottom <= innerHeight, hit: hit === el || el.contains(hit), height: b.height };
    });
    expect(target.fits).toBe(true); expect(target.hit).toBe(true); expect(target.height).toBeGreaterThanOrEqual(44);
    if (test.info().project.use.hasTouch) await locator.tap(); else await locator.click();
}
async function nativeStub(page, kind = 'file') {
    await page.addInitScript(kind => {
        window.__shares = []; window.__copies = [];
        Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => kind === 'file' });
        Object.defineProperty(navigator, 'share', { configurable: true, value: async payload => {
            window.__shares.push({ text: payload.text, url: payload.url, files: (payload.files || []).map(file => ({ name: file.name, type: file.type, size: file.size })) });
            if (kind === 'cancel') throw new DOMException('Cancelled', 'AbortError');
            if (kind === 'denied') throw new DOMException('Denied', 'NotAllowedError');
        } });
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => {
            window.__copies.push(text);
            if (kind === 'denied') throw new DOMException('Denied', 'NotAllowedError');
        } } });
    }, kind);
}
async function endTris(page, mode, completed = true) {
    await page.goto(`/StalemateSite/play/turdtris.html?mode=${mode}&seed=private&daily=old#discard`);
    await expect(page.locator('#attractPlay')).toBeEnabled();
    // Returning players correctly skip the already-seen welcome screen.
    if (await page.locator('#attractPlay').isVisible()) await activate(page, page.locator('#attractPlay'));
    await expect.poll(() => page.evaluate(() => runMode)).toBe(mode);
    await page.evaluate(({ completed, mode }) => {
        score = 12345; linesCleared = completed ? 40 : 12;
        runStats.elapsedMs = mode === 'ultra' && completed ? 120000 : 61234;
        showGameOver(completed && mode !== 'classic');
    }, { completed, mode });
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator('#gameOverOverlay .suite-result-share a')).toBeVisible();
}

async function readableResult(page) {
    expect(await page.locator('#endOverlayCard').evaluate(card => {
        const bounds = card.getBoundingClientRect();
        return [...card.querySelectorAll('.overlay-stat .k, .overlay-kicker, [role=status]')].filter(el => {
            const r = el.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
            if (!r.width || !r.height || y < bounds.top || y > bounds.bottom || x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false;
            const top = document.elementFromPoint(x, y);
            return top !== el && !el.contains(top);
        }).map(el => el.textContent);
    })).toEqual([]);
}

test('Turdtris shares actual Classic, Sprint and Ultra results without old query data and preserves replay', async ({ page }) => {
    await nativeStub(page);
    for (const mode of ['classic', 'sprint', 'ultra']) {
        await endTris(page, mode);
        await readableResult(page);
        const share = page.locator('#gameOverOverlay .suite-result-share');
        const download = await page.locator('#gameOverOverlay .suite-result-share a').getAttribute('href');
        expect(await page.evaluate(async href => {
            // Decode through img-src (blob: is allowed); CSP intentionally forbids blob fetches.
            const img = new Image(); img.src = href; await img.decode();
            return { width: img.naturalWidth, height: img.naturalHeight };
        }, download)).toEqual({ width: 1080, height: 1080 });
        if (mode === 'classic') {
            const pending = page.waitForEvent('download');
            await activate(page, share.getByRole('link', { name: 'Save image' }));
            const saved = await pending;
            expect(saved.suggestedFilename()).toBe('turdtris-score.png');
            expect([...readFileSync(await saved.path()).subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
        }
        await activate(page, share.getByRole('button', { name: 'Share score' }));
        await expect(share.getByRole('status')).toHaveText('Shared.');
        await readableResult(page);
        const payload = await page.evaluate(() => window.__shares.at(-1));
        expect(payload.text).toContain(mode === 'sprint' ? '1:01.23' : '12,345 points');
        expect(payload.text).toContain(`turdtris.html?mode=${mode}`);
        expect(payload.text).not.toMatch(/seed=|daily=|#discard/);
        expect(payload.files[0]).toMatchObject({ name: 'turdtris-score.png', type: 'image/png' });
        expect(payload.files[0].size).toBeGreaterThan(1000);
        await share.getByRole('button', { name: 'Share score' }).focus();
        await page.keyboard.press('Enter');
        await expect(share.getByRole('status')).toHaveText('Shared.');
        expect(await page.evaluate(() => gameOver)).toBe(true);
        await activate(page, page.getByRole('button', { name: 'Play Again', exact: true }));
        await expect(share).toBeHidden();
        expect(await page.evaluate(() => gameOver)).toBe(false);
    }
});

test('cancelled and unfinished Sprint shares preserve the result without copying or claiming a time', async ({ page }) => {
    await nativeStub(page, 'cancel'); await endTris(page, 'sprint', false);
    const share = page.locator('#gameOverOverlay .suite-result-share');
    await activate(page, share.getByRole('button', { name: 'Share score' }));
    await expect(share.getByRole('status')).toHaveText('Sharing cancelled.');
    expect(await page.evaluate(() => window.__copies)).toEqual([]);
    const result = await page.evaluate(() => window.__shares[0]);
    expect(result.text).toContain('Sprint unfinished'); expect(result.text).toContain('12,345 points');
    expect(result.files).toEqual([]);
    expect(result.url).toContain('?mode=sprint');
    expect(await page.evaluate(() => gameOver)).toBe(true);
});

test('Turdomania shares a real completed board, allows Undo, clears stale output and keeps New board', async ({ page }) => {
    await nativeStub(page, 'denied');
    await page.goto('/play/turdomania.html?level=normal&seed=1937471283&reducedMotion=1');
    await page.waitForFunction(() => window.__turdomania);
    for (let turn = 0; turn < 60; turn++) {
        const move = await page.evaluate(() => {
            const { state, Core } = window.__turdomania;
            if (state.over) return null;
            let chosen = null, largest = 1;
            for (let c = 0; c < state.board.length; c++) for (let r = 0; r < state.board[c].length; r++) {
                const size = Core.findGroup(state.board, c, r).length;
                if (size > largest) { largest = size; chosen = [c, r]; }
            }
            return chosen;
        });
        if (!move) break;
        const tile = page.locator(`.tile[data-col="${move[0]}"][data-row="${move[1]}"]`);
        if (test.info().project.use.hasTouch) await tile.tap(); else await tile.click();
    }
    await expect(page.locator('#overlay')).toHaveClass(/show/);
    await page.evaluate(() => document.fonts.ready);
    const result = await page.evaluate(() => ({ score: window.__turdomania.state.score, level: window.__turdomania.state.level, board: window.__turdomania.state.board }));
    const share = page.locator('#overlay .suite-result-share');
    await expect(share.locator('a')).toBeVisible();
    await page.setViewportSize({ width: 568, height: 320 });
    await activate(page, share.getByRole('button', { name: 'Share score' }));
    const fallback = share.getByRole('textbox');
    await expect(fallback).toBeVisible();
    await expect(fallback).toHaveValue(new RegExp(`${result.score.toLocaleString('en-US')} points`));
    await expect(fallback).toHaveValue(/turdomania\.html\?level=normal/);
    expect(await page.evaluate(() => window.__turdomania.state.board)).toEqual(result.board);
    await activate(page, page.getByRole('button', { name: 'Undo last pop', exact: true }));
    await expect(share).toBeHidden();
    await expect(page.locator('#overlay')).not.toHaveClass(/show/);
    await activate(page, page.getByRole('button', { name: 'New board', exact: true }));
    expect(await page.evaluate(() => window.__turdomania.state.moves)).toBe(0);
    await expect(share).toBeHidden();
});
