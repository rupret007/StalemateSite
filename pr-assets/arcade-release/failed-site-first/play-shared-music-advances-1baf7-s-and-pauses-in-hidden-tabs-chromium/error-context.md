# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: play.spec.js >> shared music advances once per track, persists preferences, and pauses in hidden tabs
- Location: tests/e2e/play.spec.js:49:1

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator:  locator('html')
Expected: "paused"
Received: ""
Timeout:  5000ms

Call log:
  - Expect "toHaveAttribute" locator('html') with timeout 5000ms
  - waiting for locator('html')
    13 × locator resolved to <html lang="en" data-mobile-game="turdanoid" class="suite-touch-manipulation">…</html>
       - unexpected value "null"

```

```yaml
- document:
  - status
  - img "Turdanoid playfield. Arrow keys or A and D move the seat. Space to launch. P to pause."
  - button "Mute sound": 🔊
  - button "Pause game": ⏸
  - paragraph: Midnight Porcelain Arcade
  - heading "Turdanoid" [level=1]
  - paragraph: Smash the wall. Catch the weird stuff. Don't get flushed.
  - text: Drag to move Tap to launch ← → Space
  - group "Game difficulty"
  - button "START FLUSHING"
  - button "Boss Flush"
  - button "How To Play"
  - button "Game Hub"
  - paragraph: Now with 100% more juice.
  - button "Colorblind-safe colors off, tap for high-contrast palettes and suit patterns": Clr
  - link "Back to game hub":
    - /url: ./
    - text: Hub
  - button "Stalemate music on, tap to turn music off" [pressed]: 🎵
```

# Test source

```ts
  1   | const fs = require('node:fs');
  2   | const path = require('node:path');
  3   | const { test, expect } = require('@playwright/test');
  4   | 
  5   | const ROOT = path.join(__dirname, '..', '..');
  6   | 
  7   | test('/play/ hosts Turdanoid same-origin, hidden and noindex', async ({ page }) => {
  8   |     const errors = [];
  9   |     page.on('pageerror', (e) => errors.push(e.message));
  10  |     await page.goto('/play/');
  11  |     await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex,nofollow');
  12  |     await expect(page.locator('iframe')).toHaveCount(0);
  13  |     const strip = page.locator('nav.stalemate-strip');
  14  |     await expect(strip.locator('a.sm-home')).toHaveAttribute('href', '../');
  15  |     await expect(strip.locator('a.sm-listen')).toContainText('Listen to Manic');
  16  |     const card = page.locator('a.game-card[href="TurdAnoid.html"]');
  17  |     await expect(card).toBeVisible();
  18  |     await card.click();
  19  |     await expect(page).toHaveURL(/\/play\/TurdAnoid\.html$/);
  20  |     await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex,nofollow');
  21  |     const canvas = page.locator('canvas#game');
  22  |     await expect(canvas).toBeVisible();
  23  |     const box = await canvas.boundingBox();
  24  |     expect(box.width).toBeGreaterThan(200);
  25  |     const vp = page.viewportSize();
  26  |     expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 1);
  27  |     // The game scripts load after the title markup; tap Start once the page has finished loading.
  28  |     await page.waitForLoadState('load');
  29  |     await page.locator('#btnStart').click();
  30  |     await expect(page.locator('#btnStart')).toBeHidden();
  31  |     if (test.info().project.use.hasTouch) {
  32  |         await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height * 0.8);
  33  |     } else {
  34  |         await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.8);
  35  |         await page.keyboard.press('Space');
  36  |     }
  37  |     await page.waitForTimeout(600);
  38  |     // Stalemate overlay: Manic starts after the first gesture and follows the game's mute button.
  39  |     await expect(page.locator('html')).toHaveAttribute('data-stalemate-music', 'playing');
  40  |     expect(await page.evaluate(async () => (await window.Suite.music()).audioElement.src)).toMatch(/\/play\/assets\/stalemate\/manic\.m4a$/);
  41  |     expect(await page.evaluate(async () => (await window.Suite.music()).audioElement.loop)).toBe(false);
  42  |     await page.locator('#btnSound').dispatchEvent('click');
  43  |     await expect(page.locator('html')).toHaveAttribute('data-stalemate-music', 'paused');
  44  |     await page.locator('#btnSound').dispatchEvent('click');
  45  |     await expect(page.locator('html')).toHaveAttribute('data-stalemate-music', 'playing');
  46  |     expect(errors).toEqual([]);
  47  | });
  48  | 
  49  | test('shared music advances once per track, persists preferences, and pauses in hidden tabs', async ({ page }) => {
  50  |     const errors = [];
  51  |     page.on('pageerror', (e) => errors.push(e.message));
  52  |     await page.goto('/play/TurdAnoid.html');
  53  |     const html = page.locator('html');
> 54  |     await expect(html).toHaveAttribute('data-stalemate-music', 'paused');
      |                        ^ Error: expect(locator).toHaveAttribute(expected) failed
  55  |     await page.locator('#btnStart').click();
  56  |     await expect(html).toHaveAttribute('data-stalemate-music', 'playing');
  57  |     const titles = ['Andrea', 'It’s Only Been 18', 'Wham Bam', 'Planet of the Flakes', 'Manic'];
  58  |     for (const title of titles) {
  59  |         await page.evaluate(async () => (await window.Suite.music()).audioElement.dispatchEvent(new Event('ended')));
  60  |         await expect(html).toHaveAttribute('data-stalemate-track', title);
  61  |         expect(await page.evaluate(async () => (await window.Suite.music()).audioElement.loop)).toBe(false);
  62  |     }
  63  |     await page.locator('#suite-music-toggle').click();
  64  |     await expect(html).toHaveAttribute('data-stalemate-music', 'paused');
  65  |     expect(await page.evaluate(() => localStorage.getItem('stalemate.music'))).toBe('off');
  66  |     await page.goto('/play/turdomania.html');
  67  |     await page.locator('#board').click();
  68  |     await expect(html).toHaveAttribute('data-stalemate-music', 'paused');
  69  |     await page.locator('#suite-music-toggle').click();
  70  |     await expect(html).toHaveAttribute('data-stalemate-music', 'playing');
  71  |     await page.evaluate(() => {
  72  |         Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  73  |         document.dispatchEvent(new Event('visibilitychange'));
  74  |     });
  75  |     await expect(html).toHaveAttribute('data-stalemate-music', 'paused');
  76  |     await page.evaluate(() => {
  77  |         Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  78  |         document.dispatchEvent(new Event('visibilitychange'));
  79  |     });
  80  |     await expect(html).toHaveAttribute('data-stalemate-music', 'playing');
  81  |     expect(await page.evaluate(() => typeof window.StalematePlaylist)).toBe('undefined');
  82  |     expect(errors).toEqual([]);
  83  | });
  84  | 
  85  | test('homepage Games card and nav link go to /play/, which stays noindex and out of the Pages package', async ({ page }) => {
  86  |     await page.goto('/');
  87  |     const nav = page.getByRole('navigation', { name: 'Primary navigation', exact: true });
  88  |     const navLinks = nav.getByRole('link');
  89  |     await expect(navLinks.last()).toHaveText('Games');
  90  |     await expect(navLinks.last()).toHaveAttribute('href', 'play/#hub-games');
  91  |     const games = page.locator('#games');
  92  |     await expect(games.locator('.board-square')).toHaveText('Stalemate Arcade');
  93  |     await expect(games).toContainText('A fresh Daily Dump puzzle, seven free games, and optional Stalemate songs.');
  94  |     await expect(games).toContainText('Make every pop count.');
  95  |     await expect(games.locator('.games-card__thumb')).toBeVisible();
  96  |     const play = games.getByRole('link', { name: 'Play The Daily Dump' });
  97  |     await expect(play).toHaveAttribute('href', 'play/turdomania.html?daily=today');
  98  |     await expect(games.getByRole('heading', { level: 2 })).toHaveText('Seven free arcade games. Zero dignity.');
  99  |     await expect(games.getByRole('link', { name: 'All seven games' })).toHaveAttribute('href', 'play/');
  100 |     for (const img of await games.locator('.games-shot img').all()) {
  101 |         await img.scrollIntoViewIfNeeded();
  102 |         await expect(img).toBeVisible();
  103 |         await expect.poll(() => img.evaluate((i) => i.complete && i.naturalWidth)).toBe(480);
  104 |         await expect(img).toHaveAttribute('loading', 'lazy');
  105 |         expect(await img.evaluate((i) => i.complete && i.naturalWidth)).toBe(480);
  106 |     }
  107 |     const box = await games.locator('.games-card').boundingBox();
  108 |     // Phone limit raised 700 -> 740 (Oct 2026, PR #22): the seven game names are now real 44px
  109 |     // tap chips with 8px gaps (Karen: no overlapping hit areas), which wrap to extra rows on phones.
  110 |     // Desktop still fits the original 480.
  111 |     expect(box.height).toBeLessThan((page.viewportSize().width <= 760) ? 740 : 480);
  112 |     // Countdown, show and Manic hero stay first; Games follows, then Listen and the band.
  113 |     expect(await page.locator('main > section').evaluateAll((s) => s.map((e) => e.id))).toEqual(['home', 'games', 'listen', 'about']);
  114 |     expect(await page.locator('a[href*="play"]').evaluateAll((a) => a.map((e) => e.getAttribute('href')))).toEqual(['play/#hub-games', 'play/TurdAnoid.html', 'play/turdomania.html', 'play/turdtris.html', 'play/turdjack.html', 'play/turdrummy.html', 'play/turdspades.html', 'play/crapeights.html', 'play/turdomania.html?daily=today', 'play/', 'play/TurdAnoid.html', 'play/turdomania.html']);
  115 |     await expect(page.locator('#home a[href="#games"]')).toHaveCount(0);
  116 |     await expect(page.locator('#listen .listen-games-link a')).toHaveAttribute('href', '#games');
  117 |     const pkg = fs.readFileSync(path.join(ROOT, 'scripts/package-pages.cjs'), 'utf8');
  118 |     expect(pkg).not.toMatch(/play\//);
  119 |     for (const f of fs.readdirSync(path.join(ROOT, 'play')).filter((n) => n.endsWith('.html'))) {
  120 |         expect(fs.readFileSync(path.join(ROOT, 'play', f), 'utf8'), f).toContain('<meta name="robots" content="noindex,nofollow">');
  121 |     }
  122 | });
  123 | 
  124 | test('/play/ has a share image', async ({ page, request }) => {
  125 |     for (const p of ['/play/', '/play/TurdAnoid.html']) {
  126 |         await page.goto(p);
  127 |         await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', 'https://rupret007.github.io/StalemateSite/play/stalemate/og-play.png');
  128 |     }
  129 |     const img = await request.get('/play/stalemate/og-play.png');
  130 |     expect(img.status()).toBe(200);
  131 |     expect(img.headers()['content-type']).toContain('image/png');
  132 | });
  133 | 
  134 | test('game over offers Listen to Manic, the Oct 24 show and Share score next to Play again', async ({ page }) => {
  135 |     const errors = [];
  136 |     page.on('pageerror', (e) => errors.push(e.message));
  137 |     await page.clock.setFixedTime(new Date('2026-10-16T12:00:00-05:00'));
  138 |     // Returning player: first-run coach already seen, so it can't cover the end screen.
  139 |     await page.addInitScript(() => localStorage.setItem('turdanoid_v3_coach_v1', '1'));
  140 |     await page.goto('/play/TurdAnoid.html');
  141 |     await page.locator('#btnStart').click();
  142 |     await expect(page.locator('#btnCoachNext')).toBeHidden();
  143 |     await page.evaluate(() => window.gameOver(false));
  144 |     const end = page.locator('#endScreen');
  145 |     await expect(end.locator('#btnRestart')).toBeVisible();
  146 |     const extra = end.locator('.stalemate-end');
  147 |     await expect(extra.getByRole('link', { name: 'Listen to Manic' })).toHaveAttribute('href', '../#home');
  148 |     await expect(extra).toContainText('Oct 24');
  149 |     await expect(extra.getByRole('link', { name: 'Come see us live, Oct 24' })).toHaveAttribute('href', 'https://rockinoctober.com');
  150 |     const share = extra.getByRole('button', { name: 'Share score' });
  151 |     await expect(share).toBeVisible();
  152 |     const h = await share.boundingBox();
  153 |     expect(h.height).toBeGreaterThanOrEqual(44);
  154 |     await page.evaluate(() => {
```