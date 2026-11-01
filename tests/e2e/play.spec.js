const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('../helpers/media-diagnostics');

test.use({ trace: 'retain-on-failure' });

const ROOT = path.join(__dirname, '..', '..');

test('/play/ is discoverable and hosts same-origin games that remain noindex', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/play/');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index,follow');
    await expect(page.locator('iframe')).toHaveCount(0);
    const strip = page.locator('nav.stalemate-strip');
    await expect(strip.locator('a.sm-home')).toHaveAttribute('href', '../');
    await expect(strip.locator('button.sm-listen')).toContainText('Listen to Manic');
    await strip.locator('button.sm-listen').click();
    await expect.poll(() => page.evaluate(() => {
        const el = document.getElementById('stalemate-site-player');
        return el && el.src.includes('/play/stalemate/manic.m4a');
    })).toBe(true);
    await expect(strip.locator('button.sm-listen')).toHaveAttribute('aria-pressed', 'true');
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
    // The game scripts load after the title markup; tap Start once the page has finished loading.
    await page.waitForLoadState('load');
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
    expect(await page.evaluate(async () => (await window.Suite.music()).audioElement.src)).toMatch(/\/play\/assets\/stalemate\/manic\.m4a$/);
    expect(await page.evaluate(async () => (await window.Suite.music()).audioElement.loop)).toBe(false);
    await page.locator('#btnSound').dispatchEvent('click');
    await expect(page.locator('html')).toHaveAttribute('data-stalemate-music', 'paused');
    await page.locator('#btnSound').dispatchEvent('click');
    await expect(page.locator('html')).toHaveAttribute('data-stalemate-music', 'playing');
    expect(errors).toEqual([]);
});

test('shared music advances once per track, persists preferences, and pauses in hidden tabs', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/play/TurdAnoid.html');
    const html = page.locator('html');
    expect(await page.evaluate(async () => { const player = await window.Suite.music(); return { armed: player.armed, paused: player.audioElement.paused }; })).toEqual({ armed: false, paused: true });
    await page.locator('#btnStart').click();
    await expect(html).toHaveAttribute('data-stalemate-music', 'playing');
    const titles = ['Andrea', 'It’s Only Been 18', 'Wham Bam', 'Planet of the Flakes', 'Manic'];
    for (const title of titles) {
        await page.evaluate(async () => (await window.Suite.music()).audioElement.dispatchEvent(new Event('ended')));
        await expect(html).toHaveAttribute('data-stalemate-track', title);
        expect(await page.evaluate(async () => (await window.Suite.music()).audioElement.loop)).toBe(false);
    }
    await page.locator('#suite-music-toggle').click();
    await expect(html).toHaveAttribute('data-stalemate-music', 'paused');
    expect(await page.evaluate(() => localStorage.getItem('stalemate.music'))).toBe('off');
    await page.goto('/play/turdomania.html');
    await page.locator('#board').click();
    await expect(html).toHaveAttribute('data-stalemate-music', 'paused');
    await page.evaluate(async () => {
        const audio = (await Suite.music()).audioElement;
        const play = audio.play.bind(audio);
        window.__unmutePlayCalls = 0;
        window.__unmuteEvents = [];
        for (const event of ['playing', 'waiting', 'stalled', 'loadedmetadata', 'canplay', 'seeking', 'seeked', 'timeupdate', 'pause', 'error']) {
            audio.addEventListener(event, () => {
                window.__unmuteEvents.push({ event, time: audio.currentTime, paused: audio.paused, ready: audio.readyState, seeking: audio.seeking });
                if (window.__unmuteEvents.length > 64) window.__unmuteEvents.shift();
            });
        }
        audio.play = () => { window.__unmutePlayCalls++; return play(); };
    });
    await page.locator('#suite-music-toggle').click();
    await expect(html).toHaveAttribute('data-stalemate-music', 'playing');
    expect(await page.evaluate(() => window.__unmutePlayCalls)).toBe(1);
    const resumedAt = await page.evaluate(async () => (await Suite.music()).audioElement.currentTime);
    await expect.poll(() => page.evaluate(async () => (await Suite.music()).audioElement.currentTime)).toBeGreaterThan(resumedAt + 0.25);
    await expect(html).toHaveAttribute('data-stalemate-music', 'playing');
    await expect(page.locator('.suite-music-title')).not.toContainText('Loading');
    await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(html).toHaveAttribute('data-stalemate-music', 'paused');
    await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(html).toHaveAttribute('data-stalemate-music', 'playing');
    expect(await page.evaluate(() => typeof window.StalematePlaylist)).toBe('undefined');
    expect(errors).toEqual([]);
});

test('homepage Games links reach the hub, with individual games excluded from search', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Primary navigation', exact: true });
    const navLinks = nav.getByRole('link');
    await expect(navLinks.last()).toHaveText('Arcade');
    await expect(navLinks.last()).toHaveAttribute('href', 'play/#hub-games');
    const games = page.locator('#games');
    await expect(games.locator('.board-square')).toHaveText('Stalemate Arcade');
    await expect(games).toContainText('Nine free games and optional Stalemate songs.');
    await expect(games).toContainText('Pick another round.');
    await expect(games.locator('.games-card__thumb')).toBeVisible();
    const play = games.getByRole('link', { name: 'Open Stalemate Arcade' });
    await expect(play).toHaveAttribute('href', 'play/');
    await expect(games.getByRole('heading', { level: 2 })).toHaveText('Nine free arcade games. Zero dignity.');
    await expect(games.getByRole('link', { name: 'Play Turdanoid' })).toHaveAttribute('href', 'play/TurdAnoid.html');
    for (const img of await games.locator('.games-shot img').all()) {
        await img.scrollIntoViewIfNeeded();
        await expect(img).toBeVisible();
        await expect.poll(() => img.evaluate((i) => i.complete && i.naturalWidth)).toBe(480);
        await expect(img).toHaveAttribute('loading', 'lazy');
        expect(await img.evaluate((i) => i.complete && i.naturalWidth)).toBe(480);
    }
    const box = await games.locator('.games-card').boundingBox();
    // Phone limit raised 700 -> 740 (Oct 2026, PR #22): the eight game names are now real 44px
    // tap chips with 8px gaps (Karen: no overlapping hit areas), which wrap to extra rows on phones.
    // Desktop still fits the original 480.
    expect(box.height).toBeLessThan((page.viewportSize().width <= 760) ? 740 : 480);
    // Countdown, show and Manic hero stay first; Games follows, then Listen and the band.
    expect(await page.locator('main > section').evaluateAll((s) => s.map((e) => e.id))).toEqual(['home', 'games', 'listen', 'about', 'contact']);
    expect(await page.locator('a[href*="play"]').evaluateAll((a) => a.map((e) => e.getAttribute('href')))).toEqual(['play/#hub-games', 'play/TurdAnoid.html', 'play/turdomania.html', 'play/turdtris.html', 'play/turdjack.html', 'play/turdrummy.html', 'play/turdspades.html', 'play/crapeights.html', 'play/chess.html', 'play/turdrush.html', 'play/', 'play/TurdAnoid.html', 'play/TurdAnoid.html', 'play/turdomania.html']);
    await expect(page.locator('#home a[href="#games"]')).toHaveCount(0);
    await expect(page.locator('#listen .listen-games-link a')).toHaveAttribute('href', '#games');
    const pkg = fs.readFileSync(path.join(ROOT, 'scripts/package-pages.cjs'), 'utf8');
    expect(pkg).not.toMatch(/play\//);
    for (const f of fs.readdirSync(path.join(ROOT, 'play')).filter((n) => n.endsWith('.html'))) {
        expect(fs.readFileSync(path.join(ROOT, 'play', f), 'utf8'), f).toContain(`<meta name="robots" content="${f === 'index.html' ? 'index,follow' : 'noindex,nofollow'}">`);
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
    await expect(extra.getByRole('link', { name: 'Come see us live, Oct 24' })).toHaveAttribute('href', 'https://rockinoctober.com');
    const share = end.locator('.suite-result-share').getByRole('button', { name: 'Share score' });
    await expect(end.getByRole('button', { name: 'Share score' })).toHaveCount(1);
    await expect(extra.locator('#stalemateShare')).toHaveCount(0);
    await expect(share).toBeVisible();
    await extra.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)).then(() => {}));
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
    expect(shared.text).toMatch(/^Turdanoid · Classic: [\d,]+ points\./);
    expect(shared.title).toBe('Turdanoid · Stalemate Arcade');
    expect(shared.url).toBe(new URL('/play/TurdAnoid.html?mode=classic', page.url()).href);
    await page.clock.setFixedTime(new Date('2026-10-24T16:45:00-05:00'));
    await expect(extra.locator('[data-next-show]')).toBeHidden();
    await page.reload();
    await page.locator('#btnStart').click();
    await page.evaluate(() => window.gameOver(false));
    await expect(page.locator('#endScreen #btnRestart')).toBeVisible();
    await expect(page.locator('.stalemate-end [data-next-show]')).toBeHidden();
    expect(errors).toEqual([]);
});
test('Turdtris Ultra shortcut opens the actual mode and Play honors a changed selection', async ({ page }) => {
    await page.goto('/play/');
    const shortcut = page.getByRole('link', { name: 'Turdtris · 2-minute Ultra →', exact: true });
    await expect(shortcut).toHaveAttribute('href', 'turdtris.html?mode=ultra');
    expect(await shortcut.evaluate((a) => a.closest('.game-card'))).toBeNull();
    await shortcut.click();
    await expect(page.locator('#attractModeSetting')).toHaveValue('ultra');
    await expect(page.locator('.hud[data-mode="ultra"]')).toHaveCount(1);
    await page.locator('#attractModeSetting').selectOption('sprint');
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.locator('.hud[data-mode="sprint"]')).toHaveCount(1);
    await expect(page.locator('#welcomeGuide')).toBeHidden();
    await expect(page.locator('#highLabel')).toHaveText('Best time');
    await page.evaluate(() => { score = 123; showWelcomeGuide(); });
    await page.getByRole('button', { name: 'Resume run', exact: true }).click();
    expect(await page.evaluate(() => ({ mode: runMode, score }))).toEqual({ mode: 'sprint', score: 123 });
    await page.goto('/play/turdtris.html?mode=invalid');
    await expect(page.locator('#attractModeSetting')).toHaveValue('classic');
});

test('hub records remain complete and accessible with mode and difficulty context', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.addInitScript(() => {
        localStorage.setItem('turdtrisHighScore', '1234567');
        localStorage.setItem('turdtrisSprint40BestMs_v1', '61234');
        localStorage.setItem('turdtrisUltra120Best_v1', '98765');
        localStorage.setItem('turdomania_best_v1', JSON.stringify({ v: 1, best: { easy: 7777, normal: 123456, hard: 99 } }));
    });
    await page.goto('/play/');
    for (const [href, text] of [
        ['turdtris.html', 'Classic best 1,234,567 · Sprint best 1:01.2 · Ultra best 98,765'],
        ['turdomania.html', 'Easy best 7,777 · Normal best 123,456 · Hard best 99']
    ]) {
        const card = page.locator(`.game-card[href="${href}"]`);
        await card.evaluate(el => el.scrollIntoView({ block: 'center' }));
        await expect(card.locator('.suite-hub-stat')).toHaveText(text);
        await expect(card).toHaveAccessibleName(new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        const fits = await card.locator('.suite-hub-stat').evaluate((el) => ({ width: el.scrollWidth <= el.clientWidth + 1, height: el.scrollHeight <= el.clientHeight + 1, overflow: getComputedStyle(el).textOverflow }));
        expect(fits).toEqual({ width: true, height: true, overflow: 'clip' });
        const badge = await card.locator('.suite-hub-stat').boundingBox();
        const footer = await page.locator('.stalemate-strip').boundingBox();
        expect(badge.y).toBeGreaterThanOrEqual(0);
        expect(badge.y + badge.height).toBeLessThanOrEqual(footer.y);
    }
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('turdomania_best_v1')).best.normal)).toBe(123456);
});

test('shared music displays the actual track, confirmed links, mute and visibility state', async ({ page }) => {
    await page.goto('/play/turdomania.html?seed=42');
    const toggle = page.locator('#suite-music-toggle');
    await toggle.click();
    await expect(page.locator('.suite-music-title')).toHaveText('Music off');
    await toggle.click();
    await page.evaluate(async () => { const player = await Suite.music(); player.playTrackAt(1); });
    const status = page.locator('#suite-music-status');
    const title = status.locator('.suite-music-title');
    await expect(status).toContainText('Now playing: Andrea');
    await expect(status.getByRole('link')).toHaveAttribute('href', 'https://music.apple.com/us/album/andrea/1718463871?i=1718463872');
    await page.evaluate(async () => { (await Suite.music()).advanceForTest(); });
    await expect(status).toContainText('Now playing: It’s Only Been 18');
    await expect(status.getByRole('link')).toHaveAttribute('href', 'https://music.apple.com/us/album/its-been-only-18/1718464113?i=1718464114');
    // Controlled visibility transition exercises the real shared player callback.
    await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(status).toContainText('Paused: It’s Only Been 18');
    await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(status).toContainText('Now playing: It’s Only Been 18');
    await page.evaluate(async () => { (await Suite.music()).advanceForTest(); });
    await expect(title).toHaveText('Now playing: Wham Bam');
    await expect(status.getByRole('link')).toHaveCount(0);
    await toggle.click();
    await expect(title).toHaveText('Music off');
    await page.reload();
    await expect(title).toHaveText('Music off');
    expect(await page.evaluate(() => localStorage.getItem('stalemate.music'))).toBe('off');
});

test('Turdomania first-play hint clears landscape controls and persists after a real pop', async ({ page, isMobile }) => {
    await page.goto('/play/turdomania.html?seed=42&reducedMotion=1');
    await expect(page.locator('#startHint')).toBeVisible();
    await page.setViewportSize({ width: 568, height: 320 });
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(() => page.evaluate(() => {
        const hint = document.getElementById('startHint').getBoundingClientRect();
        return [...document.querySelectorAll('#board, header.hud .stat, .dock button, .dock summary')].filter(el => {
            if (!el.getClientRects().length) return false;
            const b = el.getBoundingClientRect();
            return hint.left < b.right && hint.right > b.left && hint.top < b.bottom && hint.bottom > b.top;
        }).map(el => el.id || el.textContent);
    })).toEqual([]);
    await page.setViewportSize({ width: 320, height: 568 });
    const move = await page.evaluate(() => {
        const { state, Core } = window.__turdomania;
        for (let c = 0; c < state.board.length; c++) for (let r = 0; r < state.board[c].length; r++) {
            if (Core.findGroup(state.board, c, r).length >= 2) return [c, r];
        }
    });
    const tile = page.locator(`.tile[data-col="${move[0]}"][data-row="${move[1]}"]`);
    if (isMobile) {
        const box = await tile.boundingBox();
        await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    } else await tile.click();
    await expect.poll(() => page.evaluate(() => window.__turdomania.state.moves)).toBe(1);
    await expect(page.locator('#startHint')).toBeHidden();
    await page.locator('#undoBtn').click();
    await page.reload();
    await expect(page.locator('#startHint')).toBeHidden();
});
