# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: arcade-play.spec.js >> a completed Daily Dump keeps its first result, offers valid sharing, and separates practice/free play
- Location: tests/e2e/arcade-play.spec.js:64:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('#dailyShareStatus')
Expected substring: "canceled"
Received string:    "Select and copy the result text below."
Timeout: 5000ms

Call log:
  - Expect "toContainText" locator('#dailyShareStatus') with timeout 5000ms
  - waiting for locator('#dailyShareStatus')
    14 × locator resolved to <p role="status" id="dailyShareStatus" class="daily-share-status">Select and copy the result text below.</p>
       - unexpected value "Select and copy the result text below."

```

```yaml
- status: Select and copy the result text below.
```

# Test source

```ts
  1   | const { test, expect } = require('@playwright/test');
  2   | 
  3   | async function board(page) {
  4   |     return page.locator('#board .tile').evaluateAll((tiles) => tiles.map((t) => [Number(t.dataset.id), Number(t.dataset.kind), Number(t.dataset.col), Number(t.dataset.row)]).sort((a, b) => a[0] - b[0]));
  5   | }
  6   | async function popOne(page) {
  7   |     const cell = await page.evaluate(() => {
  8   |         const { state, Core } = window.__turdomania;
  9   |         for (let c = 0; c < state.board.length; c++) {
  10  |             for (let r = 0; r < state.board[c].length; r++) {
  11  |                 if (Core.findGroup(state.board, c, r).length >= 2) return [c, r];
  12  |             }
  13  |         }
  14  |         return null;
  15  |     });
  16  |     if (!cell) return false;
  17  |     await page.locator(`.tile[data-col="${cell[0]}"][data-row="${cell[1]}"]`).click();
  18  |     return true;
  19  | }
  20  | async function ready(page, path = '/play/turdomania.html?daily=2026-10-21&v=1&reducedMotion=1') {
  21  |     await page.goto(path);
  22  |     await expect(page.locator('#dailyIdentity')).toContainText('2026-10-21');
  23  |     await page.waitForFunction(() => !!window.__turdomania);
  24  | }
  25  | 
  26  | test.beforeEach(async ({ page }) => {
  27  |     await page.clock.setFixedTime(new Date('2026-10-21T18:00:00Z'));
  28  | });
  29  | 
  30  | test('Daily Dump preserves one logical board across viewports, rotation, refresh, and the project prefix', async ({ page }) => {
  31  |     const errors = [];
  32  |     page.on('pageerror', (e) => errors.push(e.message));
  33  |     await ready(page);
  34  |     const original = await board(page);
  35  |     expect(original).toHaveLength(80);
  36  |     await expect(page.locator('#board')).toHaveAttribute('aria-colcount', '8');
  37  |     await expect(page.locator('#board')).toHaveAttribute('aria-rowcount', '10');
  38  |     const initialSize = page.viewportSize();
  39  |     await page.setViewportSize({ width: 844, height: 390 });
  40  |     expect(await board(page)).toEqual(original);
  41  |     await page.setViewportSize(initialSize);
  42  |     await page.goto('/StalemateSite/play/turdomania.html?daily=2026-10-21&v=1&reducedMotion=1');
  43  |     await page.waitForFunction(() => !!window.__turdomania);
  44  |     expect(await board(page)).toEqual(original);
  45  |     expect(await popOne(page)).toBe(true);
  46  |     const moved = await board(page);
  47  |     expect(moved.length).toBeLessThan(80);
  48  |     await page.reload();
  49  |     await page.waitForFunction(() => !!window.__turdomania);
  50  |     expect(await board(page)).toEqual(moved);
  51  |     await expect(page.locator('#undoBtn')).toBeDisabled();
  52  |     await page.locator('#board').focus();
  53  |     await page.keyboard.press('u');
  54  |     expect(await board(page)).toEqual(moved);
  55  |     // Crossing midnight never starts a replacement board, including on refresh.
  56  |     await page.clock.setFixedTime(new Date('2026-10-22T06:01:00Z'));
  57  |     await page.reload();
  58  |     await page.waitForFunction(() => !!window.__turdomania);
  59  |     expect(await board(page)).toEqual(moved);
  60  |     await expect(page.locator('#dailyIdentity')).toContainText('2026-10-21');
  61  |     expect(errors).toEqual([]);
  62  | });
  63  | 
  64  | test('a completed Daily Dump keeps its first result, offers valid sharing, and separates practice/free play', async ({ page }) => {
  65  |     await ready(page);
  66  |     for (let i = 0; i < 40 && await popOne(page); i++) { /* Play legal moves through the actual UI. */ }
  67  |     await expect(page.locator('#overlay')).toHaveClass(/show/);
  68  |     const first = await page.locator('#best').textContent();
  69  |     const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('stalemate_daily_dump_result_v1:')));
  70  |     expect(keys).toHaveLength(1);
  71  |     expect(await page.evaluate(() => localStorage.getItem('turdomania_best_v1'))).toBeNull();
  72  |     await page.evaluate(() => {
  73  |         Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
  74  |         Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  75  |     });
  76  |     await page.locator('#dailyShare').click();
  77  |     const fallback = page.locator('#dailyShareFallback');
  78  |     await expect(fallback).toBeVisible();
  79  |     await expect(fallback).toHaveValue(/Stalemate Arcade · The Daily Dump\n2026-10-21/);
  80  |     const text = await fallback.inputValue();
  81  |     const link = new URL(text.split('\n').at(-1));
  82  |     expect(link.pathname).toBe('/play/turdomania.html');
  83  |     expect([...link.searchParams]).toEqual([['daily', '2026-10-21'], ['v', '1']]);
  84  |     // Canceling native share must leave the result available without invoking copy.
  85  |     await page.evaluate(() => {
  86  |         navigator.share = () => Promise.reject(new DOMException('cancel', 'AbortError'));
  87  |         navigator.canShare = () => false;
  88  |     });
  89  |     await page.locator('#dailyShare').click();
> 90  |     await expect(page.locator('#dailyShareStatus')).toContainText('canceled');
      |                                                     ^ Error: expect(locator).toContainText(expected) failed
  91  |     await page.evaluate(() => {
  92  |         navigator.canShare = () => true;
  93  |         navigator.share = (data) => { window.__dailyShared = data; return Promise.resolve(); };
  94  |     });
  95  |     await page.locator('#dailyShare').click();
  96  |     const shared = await page.evaluate(() => ({
  97  |         title: window.__dailyShared.title, text: window.__dailyShared.text,
  98  |         files: window.__dailyShared.files.map((f) => ({ type: f.type, size: f.size, name: f.name }))
  99  |     }));
  100 |     expect(shared.title).toContain('Stalemate Arcade');
  101 |     expect(shared.text).toContain('daily=2026-10-21&v=1');
  102 |     expect(shared.files[0].type).toBe('image/png');
  103 |     expect(shared.files[0].size).toBeGreaterThan(1000);
  104 |     await page.locator('#againBtn').click();
  105 |     await expect(page.locator('#dailyIdentity')).toContainText('PRACTICE');
  106 |     expect(await popOne(page)).toBe(true);
  107 |     await expect(page.locator('#undoBtn')).toBeEnabled();
  108 |     await page.locator('#undoBtn').click();
  109 |     expect(await board(page)).toHaveLength(80);
  110 |     await expect(page.locator('#best')).toHaveText(first);
  111 |     await page.goto('/play/');
  112 |     await expect(page.locator('#daily-hub-status')).toContainText(`${first} points`);
  113 |     await expect(page.locator('#daily-hub-play')).toContainText('See result');
  114 |     await page.goto('/play/turdomania.html');
  115 |     await expect(page.locator('body')).not.toHaveClass(/daily-dump/);
  116 |     await expect(page.locator('#levelSel')).toBeEnabled();
  117 | });
  118 | 
  119 | test('Daily Dump starts with denied storage, rejects malformed challenge parameters, without disrupting the hub', async ({ page }) => {
  120 |     const errors = [];
  121 |     page.on('pageerror', (e) => errors.push(e.message));
  122 |     await page.addInitScript(() => {
  123 |         Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('blocked', 'SecurityError'); } });
  124 |     });
  125 |     await ready(page);
  126 |     await expect(page.locator('#dailyStorageNote')).toContainText('Saving is unavailable');
  127 |     expect(await popOne(page)).toBe(true);
  128 |     await page.goto('/play/turdomania.html?daily=2026-02-30&v=1');
  129 |     await expect(page.locator('#dailyInfo')).toContainText('invalid');
  130 |     await expect(page.locator('body')).not.toHaveClass(/daily-dump/);
  131 |     await page.goto('/play/turdomania.html?daily=2026-10-21&v=999');
  132 |     await expect(page.locator('#dailyInfo')).toContainText('unavailable rules version');
  133 |     await page.goto('/play/');
  134 |     await expect(page.locator('#daily-hub-play')).toBeVisible();
  135 |     await expect(page.locator('.game-card')).toHaveCount(7);
  136 |     expect(errors).toEqual([]);
  137 | });
  138 | 
  139 | 
  140 | test('corrupt or stale daily saves leave existing free-play records intact', async ({ page }) => {
  141 |     await page.goto('/play/turdomania.html');
  142 |     await page.evaluate(async () => {
  143 |         const Daily = await import('/play/games/turdomania-daily.js');
  144 |         const challenge = Daily.makeChallenge('2026-10-21');
  145 |         localStorage.setItem('turdomania_best_v1', JSON.stringify({ v: 1, best: { easy: 90, normal: 120, hard: 30 } }));
  146 |         localStorage.setItem(Daily.ACTIVE_KEY, '{corrupt');
  147 |         localStorage.setItem(Daily.ACTIVE_PREFIX + challenge.id, JSON.stringify({ v: 999, challenge, practice: false, moves: [] }));
  148 |     });
  149 |     await ready(page);
  150 |     await expect(page.locator('#dailyStorageNote')).toContainText('unreadable or outdated');
  151 |     expect(await board(page)).toHaveLength(80);
  152 |     expect(await page.evaluate(() => JSON.parse(localStorage.getItem('turdomania_best_v1')).best.normal)).toBe(120);
  153 | });
  154 | 
```