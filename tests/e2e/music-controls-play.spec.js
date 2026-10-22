const { test, expect } = require('../helpers/media-diagnostics');

test.use({ trace: 'retain-on-failure' });

async function activate(page, target) {
    if (!test.info().project.use.hasTouch) return target.click();
    await target.scrollIntoViewIfNeeded();
    let point;
    await expect.poll(async () => {
        point = await target.evaluate(el => {
            const r = el.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
            const hit = document.elementFromPoint(x, y);
            return { x, y, ready: r.width >= 44 && r.height >= 44 && r.x >= 0 && r.y >= 0
                && r.right <= innerWidth && r.bottom <= innerHeight && (hit === el || el.contains(hit)) };
        });
        return point.ready;
    }).toBe(true);
    await page.touchscreen.tap(point.x, point.y);
}

test('music selection, next, saved position and mute work across game navigation', async ({ page }) => {
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('/play/turdomania.html?seed=42');
    await page.locator('#newBtn').click();
    const label = page.locator('.suite-music-title');
    await expect(label).toHaveText('Now playing: Manic');
    await page.getByRole('button', { name: 'Next song', exact: true }).click();
    await expect(label).toHaveText('Now playing: Andrea');
    await page.getByRole('button', { name: 'Songs', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Choose a Stalemate song' });
    await expect(picker).toBeVisible();
    const select = picker.getByLabel('Choose a song');
    await expect(select.locator('option')).toHaveCount(5);
    await select.selectOption('3');
    await expect(label).toHaveText('Now playing: Wham Bam');
    await select.press('Escape'); await expect(picker).toBeHidden();
    await expect.poll(() => page.evaluate(async () => Number.isFinite((await Suite.music()).audioElement.duration))).toBe(true);
    await page.evaluate(async () => { const p = await Suite.music(); p.audioElement.currentTime = 20; p.savePosition(); });
    await page.goto('/StalemateSite/play/turdtris.html');
    expect(await page.evaluate(async () => (await Suite.music()).trackTitle)).toBe('Wham Bam');
    expect(await page.evaluate(async () => (await Suite.music()).armed)).toBe(false);
    await expect(page.locator('#attractPlay')).toBeEnabled();
    if (await page.locator('#attractPlay').isVisible()) await page.locator('#attractPlay').click();
    await expect.poll(() => page.evaluate(async () => (await Suite.music()).audioElement.currentTime)).toBeGreaterThanOrEqual(19.5);
    await page.locator('#suite-music-toggle').click();
    await expect(label).toHaveText('Music off');
    await page.getByRole('button', { name: 'Next song', exact: true }).click();
    expect(await page.evaluate(async () => ({ title: (await Suite.music()).trackTitle, paused: (await Suite.music()).audioElement.paused }))).toEqual({ title: 'Planet of the Flakes', paused: true });
    await page.reload(); await expect(label).toHaveText('Music off');
    expect(errors).toEqual([]);
});

test('failed audio has honest feedback and an explicit Retry restores decoded playback', async ({ page, mediaDiagnostics }) => {
    let fail = true, requests = 0;
    await page.route('**/assets/stalemate/manic.m4a', route => { requests++; return fail ? route.abort() : route.continue(); });
    await page.goto('/play/turdomania.html?seed=42');
    await page.evaluate(() => document.fonts.ready);
    await activate(page, page.locator('#newBtn'));
    const label = page.locator('.suite-music-title');
    await expect(label).toHaveText('Can’t load: Manic');
    const diagnostics = await mediaDiagnostics.read();
    expect(diagnostics.current.events.some(event => event.event === 'error' && event.error?.code)).toBe(true);
    expect(diagnostics.network.some(event => event.event === 'request-failed' && event.url.includes('manic.m4a'))).toBe(true);
    const before = await page.evaluate(() => window.__turdomania.state.board.map(col => col.map(tile => tile.id)));
    const count = requests;
    await page.evaluate(async () => { const player = await Suite.music(); for (let i = 0; i < 8; i++) player.sync(); });
    expect(requests).toBe(count);
    await activate(page, page.getByRole('button', { name: 'Songs', exact: true }));
    const retry = page.getByRole('button', { name: 'Retry song', exact: true });
    await expect(retry).toBeVisible(); fail = false;
    await activate(page, retry);
    await expect(label).toHaveText('Now playing: Manic');
    await expect.poll(() => page.evaluate(async () => (await Suite.music()).audioElement.currentTime)).toBeGreaterThan(0.25);
    await expect(retry).toBeHidden();
    await expect(page.locator('#suite-song-select')).toBeFocused();
    await page.locator('#suite-song-select').press('Escape');
    expect(await page.evaluate(() => window.__turdomania.state.board.map(col => col.map(tile => tile.id)))).toEqual(before);
});

test('a failed track can be skipped and muted music never starts from recovery controls', async ({ page }) => {
    await page.route('**/assets/stalemate/manic.m4a', route => route.abort());
    await page.goto('/StalemateSite/play/turdomania.html?seed=42');
    await page.evaluate(() => document.fonts.ready);
    await activate(page, page.locator('#newBtn'));
    const label = page.locator('.suite-music-title');
    await expect(label).toHaveText('Can’t load: Manic');
    await activate(page, page.locator('#suite-music-toggle'));
    await expect(label).toHaveText('Music off');
    await activate(page, page.getByRole('button', { name: 'Next song', exact: true }));
    expect(await page.evaluate(async () => ({ title: (await Suite.music()).trackTitle, paused: (await Suite.music()).audioElement.paused }))).toEqual({ title: 'Andrea', paused: true });
    await activate(page, page.locator('#suite-music-toggle'));
    await expect(label).toHaveText('Now playing: Andrea');
    await expect.poll(() => page.evaluate(async () => (await Suite.music()).audioElement.currentTime)).toBeGreaterThan(0.25);
});

test('slow audio reports Loading until it actually starts', async ({ page }) => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/assets/stalemate/manic.m4a', async route => { await gate; await route.continue(); });
    try {
        await page.goto('/play/turdomania.html?seed=42');
        await page.evaluate(() => document.fonts.ready);
        await activate(page, page.locator('#newBtn'));
        await expect(page.locator('.suite-music-title')).toHaveText('Loading: Manic');
        release();
        await expect(page.locator('.suite-music-title')).toHaveText('Now playing: Manic');
        await expect.poll(() => page.evaluate(async () => (await Suite.music()).audioElement.currentTime)).toBeGreaterThan(0.25);
    } finally { release(); }
});
