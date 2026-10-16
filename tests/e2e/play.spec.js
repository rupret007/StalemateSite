const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const ROOT = path.join(__dirname, '..', '..');

test('/play/ hosts Turdanoid same-origin, hidden and noindex', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => localStorage.setItem('turdanoid_v3_coach_v1', '1'));
    await page.goto('/play/');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex,nofollow');
    await expect(page.locator('iframe')).toHaveCount(0);
    const strip = page.locator('nav.stalemate-strip');
    await expect(strip.locator('a.sm-home')).toHaveAttribute('href', '../');
    await expect(strip.locator('a.sm-listen')).toContainText('Listen to Manic');
    const card = page.locator('a.game-card[href="TurdAnoid.html"]');
    await expect(card).toBeVisible();
    await card.click();
    await expect(page).toHaveURL(/\/play\/TurdAnoid\.html$/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex,nofollow');
    const canvas = page.locator('canvas#game');
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box.width).toBeGreaterThan(200);
    const vp = page.viewportSize();
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 1);
    await page.locator('#btnStart').click();
    await expect(page.locator('#btnStart')).toBeHidden();
    if (test.info().project.use.hasTouch) {
        await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height * 0.8);
    } else {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.8);
        await page.keyboard.press('Space');
    }
    await page.waitForTimeout(600);
    // Stalemate overlay: Manic starts after the first gesture and follows the game's mute button.
    await expect(page.locator('html')).toHaveAttribute('data-stalemate-music', 'playing');
    expect(await page.evaluate(() => window.StalemateMusic.src)).toMatch(/\/play\/stalemate\/manic\.m4a$/);
    expect(await page.evaluate(() => window.StalemateMusic.loop)).toBe(true);
    await page.locator('#btnSound').dispatchEvent('click');
    await expect(page.locator('html')).toHaveAttribute('data-stalemate-music', 'paused');
    const unmute = page.locator('#btnSound');
    if (test.info().project.use.browserName === 'webkit') {
        await unmute.click({ force: true });
        await expect.poll(() => page.evaluate(() => !window.soundBlocked())).toBe(true);
    } else {
        await unmute.dispatchEvent('click');
        await expect(page.locator('html')).toHaveAttribute('data-stalemate-music', 'playing');
    }
    expect(errors).toEqual([]);
});

test('homepage Games card and nav link go to /play/, which stays noindex and out of the Pages package', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Primary navigation', exact: true });
    const navLinks = nav.getByRole('link');
    await expect(navLinks.last()).toHaveText('Games');
    await expect(navLinks.last()).toHaveAttribute('href', '#games');
    const games = page.locator('#games');
    await expect(games.locator('.board-square')).toHaveText('Games');
    await expect(games).toContainText('Turdanoid: our free arcade game. Plays in the browser, nothing to download.');
    await expect(games).toContainText('Brick-breaker, but gross.');
    await expect(games.locator('.games-card__thumb')).toBeVisible();
    const play = games.getByRole('link', { name: 'Play Turdanoid' });
    await expect(play).toHaveAttribute('href', 'play/');
    const box = await games.locator('.games-card').boundingBox();
    expect(box.height).toBeLessThan(420);
    expect(await page.locator('main > section').evaluateAll((s) => s.map((e) => e.id))).toEqual(['home', 'listen', 'about', 'games']);
    await expect(page.locator('a[href*="play"]')).toHaveCount(1);
    const pkg = fs.readFileSync(path.join(ROOT, 'scripts/package-pages.cjs'), 'utf8');
    expect(pkg).not.toMatch(/play\//);
    for (const f of fs.readdirSync(path.join(ROOT, 'play')).filter((n) => n.endsWith('.html'))) {
        expect(fs.readFileSync(path.join(ROOT, 'play', f), 'utf8'), f).toContain('<meta name="robots" content="noindex,nofollow">');
    }
});

test('/play/ has a share image', async ({ page, request }) => {
    for (const p of ['/play/', '/play/TurdAnoid.html']) {
        await page.goto(p);
        await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', 'https://stalemate.band/play/stalemate/og-play.png');
    }
    const img = await request.get('/play/stalemate/og-play.png');
    expect(img.status()).toBe(200);
    expect(img.headers()['content-type']).toContain('image/png');
});

test('game over offers Listen to Manic, the Oct 24 show and Share score next to Play again', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.clock.setFixedTime(new Date('2026-10-16T12:00:00-05:00'));
    // Returning player: first-run coach already seen, so it can't cover the end screen.
    await page.addInitScript(() => localStorage.setItem('turdanoid_v3_coach_v1', '1'));
    await page.goto('/play/TurdAnoid.html');
    await page.locator('#btnStart').click();
    await expect(page.locator('#btnCoachNext')).toBeHidden();
    await page.evaluate(() => window.gameOver(false));
    const end = page.locator('#endScreen');
    await expect(end.locator('#btnRestart')).toBeVisible();
    const extra = end.locator('.stalemate-end');
    await expect(extra.getByRole('link', { name: 'Listen to Manic' })).toHaveAttribute('href', '../#home');
    await expect(extra).toContainText('Oct 24');
    const share = extra.getByRole('button', { name: 'Share score' });
    await expect(share).toBeVisible();
    const h = await share.boundingBox();
    expect(h.height).toBeGreaterThanOrEqual(44);
    await page.evaluate(() => {
        window.__shared = null;
        navigator.canShare = () => false;
        navigator.share = (d) => {
            window.__shared = d;
            return Promise.resolve();
        };
    });
    await share.click();
    const shared = await page.evaluate(() => window.__shared);
    expect(shared.text).toMatch(/^I scored \d+ in Turdanoid/);
    expect(errors).toEqual([]);
});
