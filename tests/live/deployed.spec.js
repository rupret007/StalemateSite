const { test, expect } = require('../helpers/media-diagnostics');

const games = ['TurdAnoid', 'turdomania', 'turdtris', 'turdjack', 'crapeights', 'turdrummy', 'turdspades'];
const target = (base, relative) => new URL(relative, base).href;

test.beforeEach(async ({ context, page, baseURL }, info) => {
    const errors = [];
    await context.route('**/*goatcounter.com/**', route => route.abort());
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
        if (response.url().startsWith(baseURL) && response.status() >= 400) errors.push(`HTTP${response.status()} ${response.url()}`);
    });
    page.on('requestfailed', request => {
        const message = request.failure()?.errorText || '';
        if (/goatcounter\.com/.test(request.url()) || /ERR_ABORTED|cancelled/i.test(message)) return;
        if (info.title.startsWith('a failed song') && /\/manic\.m4a$/.test(request.url())) return;
        errors.push(`${message} ${request.url()}`);
    });
    info._liveErrors = errors;
});

test.afterEach(async ({ page }, info) => {
    const errors = info._liveErrors || [];
    if (errors.length) await info.attach('live-page-errors', { body: JSON.stringify(errors), contentType: 'application/json' });
    expect(errors, 'No live page errors or failed HTTP responses').toEqual([]);
});

async function activate(page, locator, touch) {
    if (!touch) return locator.click();
    let point;
    await expect.poll(async () => {
        point = await locator.evaluate(el => {
            const r = el.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
            const hit = document.elementFromPoint(x, y);
            return { x, y, ready: r.width > 0 && r.height > 0 && r.x >= 0 && r.y >= 0
                && r.right <= innerWidth && r.bottom <= innerHeight && (hit === el || el.contains(hit)) };
        });
        return point.ready;
    }).toBe(true);
    await page.touchscreen.tap(point.x, point.y);
}

async function assertAdvancing(page) {
    const from = await page.evaluate(async () => (await Suite.music()).audioElement.currentTime);
    await expect.poll(() => page.evaluate(async () => (await Suite.music()).audioElement.currentTime)).toBeGreaterThan(from + 0.25);
    await expect(page.locator('.suite-music-title')).toContainText('Now playing:');
}

test('homepage and hub expose seven playable same-origin games', async ({ page, baseURL }) => {
    await page.goto(baseURL);
    await expect(page.locator('.booking-contact a')).toHaveAttribute('href', 'mailto:stalemate.punk@gmail.com');
    await expect(page.locator('#games a[href="play/"]')).toBeVisible();
    await page.goto(target(baseURL, 'play/'));
    const links = page.locator('.game-card');
    await expect(links).toHaveCount(7);
    const paths = await links.evaluateAll(elements => elements.map(el => new URL(el.href).pathname.split('/').pop()));
    expect(paths.sort()).toEqual(games.map(game => game + '.html').sort());
    for (const href of await links.evaluateAll(elements => elements.map(el => el.href))) {
        expect(href.startsWith(target(baseURL, 'play/'))).toBe(true);
    }
    await expect(page.locator('.daily-feature, #daily-hub-play')).toHaveCount(0);
});

for (const game of games) test(`${game} loads with its shared controls`, async ({ page, baseURL }) => {
    expect((await page.goto(target(baseURL, `play/${game}.html`))).status()).toBe(200);
    await expect(page.locator('#suite-music-status')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Songs', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next song', exact: true })).toBeVisible();
});

test('a real puzzle move and Undo preserve the board', async ({ page, baseURL, hasTouch }) => {
    await page.goto(target(baseURL, 'play/turdomania.html?seed=42&reducedMotion=1'));
    await page.waitForFunction(() => Boolean(window.__turdomania?.state));
    const snapshot = () => page.evaluate(() => __turdomania.state.board.map(col => col.map(tile => [tile.id, tile.kind])));
    const before = await snapshot();
    const move = await page.evaluate(() => {
        const { state, Core } = __turdomania;
        for (let c = 0; c < state.board.length; c++) for (let r = 0; r < state.board[c].length; r++) {
            if (Core.findGroup(state.board, c, r).length >= 2) return { c, r };
        }
    });
    expect(move).toBeTruthy();
    await activate(page, page.locator(`.tile[data-col="${move.c}"][data-row="${move.r}"]`), hasTouch);
    await expect.poll(() => page.evaluate(() => __turdomania.state.moves)).toBe(1);
    expect(await snapshot()).not.toEqual(before);
    await activate(page, page.locator('#undoBtn'), hasTouch);
    await expect.poll(() => page.evaluate(() => __turdomania.state.moves)).toBe(0);
    expect(await snapshot()).toEqual(before);
});

test('muted navigation resumes one native stream and Next advances the playlist', async ({ page, baseURL, hasTouch, mediaDiagnostics }) => {
    await page.goto(target(baseURL, 'play/turdomania.html?seed=42'));
    await activate(page, page.locator('#suite-music-toggle'), hasTouch);
    await expect(page.locator('.suite-music-title')).toHaveText('Music off');
    await activate(page, page.locator('#newBtn'), hasTouch);
    await page.goto(target(baseURL, 'play/turdtris.html'));
    await expect(page.locator('#attractPlay')).toBeEnabled();
    if (await page.locator('#attractPlay').isVisible()) await activate(page, page.locator('#attractPlay'), hasTouch);
    await expect(page.locator('.suite-music-title')).toHaveText('Music off');
    await activate(page, page.locator('#suite-music-toggle'), hasTouch);
    await expect(page.locator('.suite-music-title')).toHaveText('Now playing: Manic');
    await assertAdvancing(page);
    const first = (await mediaDiagnostics.read()).current.players.filter(audio => audio.src.includes('manic.m4a'));
    expect(first).toHaveLength(1); expect(first[0].playCalls).toBe(1);
    await activate(page, page.getByRole('button', { name: 'Next song', exact: true }), hasTouch);
    await expect(page.locator('.suite-music-title')).toHaveText('Now playing: Andrea');
    await assertAdvancing(page);
});

test('a failed song reports an error and Retry restores real playback', async ({ page, baseURL, hasTouch }) => {
    let fail = true;
    await page.route('**/assets/stalemate/manic.m4a', route => fail ? route.abort() : route.continue());
    await page.goto(target(baseURL, 'play/turdomania.html?seed=42'));
    await activate(page, page.locator('#newBtn'), hasTouch);
    await expect(page.locator('.suite-music-title')).toHaveText('Can’t load: Manic');
    const before = await page.evaluate(() => __turdomania.state.board.map(col => col.map(tile => tile.id)));
    await activate(page, page.getByRole('button', { name: 'Songs', exact: true }), hasTouch);
    fail = false;
    await activate(page, page.getByRole('button', { name: 'Retry song', exact: true }), hasTouch);
    await expect(page.locator('.suite-music-title')).toHaveText('Now playing: Manic');
    await assertAdvancing(page);
    expect(await page.evaluate(() => __turdomania.state.board.map(col => col.map(tile => tile.id)))).toEqual(before);
});
