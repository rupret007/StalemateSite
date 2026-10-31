# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: arcade-play.spec.js >> a completed Daily Dump keeps its first result, offers valid sharing, and separates practice/free play
- Location: tests/e2e/arcade-play.spec.js:64:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for locator('.tile[data-col="1"][data-row="0"]')
    - locator resolved to <div class="tile" id="tile-19" data-id="19" data-col="1" data-row="0" data-kind="3" role="gridcell" aria-colindex="2" aria-label="paper roll, column 2, row 1">…</div>
  - attempting click action
    - waiting for element to be visible, enabled and stable

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [aria-hidden]:
    - generic [aria-hidden]: 🐀
    - generic [aria-hidden]: 🦆
  - banner [ref=e2]:
    - generic [ref=e3]:
      - text: Score
      - generic [ref=e4]: "26"
    - generic [ref=e5]:
      - text: First result
      - generic [ref=e6]: —
    - generic [ref=e7]:
      - text: Left
      - generic [ref=e8]: "54"
    - generic [ref=e9]:
      - paragraph [ref=e10]: The Daily Dump · 2026-10-21 · FIRST RUN · resumed
      - group [ref=e11]:
        - generic "▸ Rules, saving & reset" [ref=e12] [cursor=pointer]
      - link "Free play" [ref=e14]:
        - /url: http://127.0.0.1:4320/play/turdomania.html
  - main "Turdomania" [ref=e15]:
    - grid "Daily Dump 2026-10-21 board. Arrows move, Enter pops. No undo in the first daily run." [ref=e17]:
      - row [ref=e18]:
        - gridcell "paper roll, column 7, row 10" [ref=e19] [cursor=pointer]
        - gridcell "classic swirl, column 8, row 10" [ref=e20] [cursor=pointer]
      - row [ref=e21]:
        - gridcell "green splat, column 7, row 9" [ref=e22] [cursor=pointer]
        - gridcell "classic swirl, column 8, row 9" [ref=e23] [cursor=pointer]
        - gridcell "classic swirl, column 4, row 9" [ref=e24] [cursor=pointer]
        - gridcell "green splat, column 6, row 9" [ref=e25] [cursor=pointer]
      - row [ref=e26]:
        - gridcell "classic swirl, column 7, row 8" [ref=e27] [cursor=pointer]
        - gridcell "green splat, column 8, row 8" [ref=e28] [cursor=pointer]
        - gridcell "corn nugget, column 4, row 8" [ref=e29] [cursor=pointer]
        - gridcell "classic swirl, column 5, row 8" [ref=e30] [cursor=pointer]
        - gridcell "corn nugget, column 6, row 8" [ref=e31] [cursor=pointer]
      - row [ref=e32]:
        - gridcell "classic swirl, column 7, row 7" [ref=e33] [cursor=pointer]
        - gridcell "paper roll, column 8, row 7" [ref=e34] [cursor=pointer]
        - gridcell "corn nugget, column 4, row 7" [ref=e35] [cursor=pointer]
        - gridcell "paper roll, column 5, row 7" [ref=e36] [cursor=pointer]
        - gridcell "corn nugget, column 6, row 7" [ref=e37] [cursor=pointer]
      - row [ref=e38]:
        - gridcell "classic swirl, column 7, row 6" [ref=e39] [cursor=pointer]
        - gridcell "corn nugget, column 8, row 6" [ref=e40] [cursor=pointer]
        - gridcell "classic swirl, column 3, row 6" [ref=e41] [cursor=pointer]
        - gridcell "green splat, column 4, row 6" [ref=e42] [cursor=pointer]
        - gridcell "corn nugget, column 5, row 6" [ref=e43] [cursor=pointer]
        - gridcell "corn nugget, column 6, row 6" [ref=e44] [cursor=pointer]
      - row [ref=e45]:
        - gridcell "classic swirl, column 7, row 5" [ref=e46] [cursor=pointer]
        - gridcell "green splat, column 8, row 5" [ref=e47] [cursor=pointer]
        - gridcell "paper roll, column 3, row 5" [ref=e48] [cursor=pointer]
        - gridcell "corn nugget, column 4, row 5" [ref=e49] [cursor=pointer]
        - gridcell "classic swirl, column 5, row 5" [ref=e50] [cursor=pointer]
        - gridcell "green splat, column 6, row 5" [ref=e51] [cursor=pointer]
      - row [ref=e52]:
        - gridcell "classic swirl, column 7, row 4" [ref=e53] [cursor=pointer]
        - gridcell "paper roll, column 8, row 4" [ref=e54] [cursor=pointer]
        - gridcell "corn nugget, column 3, row 4" [ref=e55] [cursor=pointer]
        - gridcell "paper roll, column 4, row 4" [ref=e56] [cursor=pointer]
        - gridcell "corn nugget, column 5, row 4" [ref=e57] [cursor=pointer]
        - gridcell "corn nugget, column 6, row 4" [ref=e58] [cursor=pointer]
      - row [ref=e59]:
        - gridcell "classic swirl, column 7, row 3" [ref=e60] [cursor=pointer]
        - gridcell "green splat, column 8, row 3" [ref=e61] [cursor=pointer]
        - gridcell "green splat, column 3, row 3" [ref=e62] [cursor=pointer]
        - gridcell "green splat, column 4, row 3" [ref=e63] [cursor=pointer]
        - gridcell "paper roll, column 5, row 3" [ref=e64] [cursor=pointer]
        - gridcell "paper roll, column 6, row 3" [ref=e65] [cursor=pointer]
      - row [ref=e66]:
        - gridcell "paper roll, column 6, row 2" [ref=e67] [cursor=pointer]
        - gridcell "classic swirl, column 7, row 2" [ref=e68] [cursor=pointer]
        - gridcell "green splat, column 8, row 2" [ref=e69] [cursor=pointer]
        - gridcell "classic swirl, column 3, row 2" [ref=e70] [cursor=pointer]
        - gridcell "green splat, column 4, row 2" [ref=e71] [cursor=pointer]
        - gridcell "classic swirl, column 5, row 2" [ref=e72] [cursor=pointer]
      - row [ref=e73]:
        - gridcell "paper roll, column 3, row 1" [ref=e74] [cursor=pointer]
        - gridcell "green splat, column 4, row 1" [ref=e75] [cursor=pointer]
        - gridcell "classic swirl, column 5, row 1" [ref=e76] [cursor=pointer]
        - gridcell "corn nugget, column 6, row 1" [ref=e77] [cursor=pointer]
        - gridcell "corn nugget, column 7, row 1" [ref=e78] [cursor=pointer]
        - gridcell "paper roll, column 8, row 1" [ref=e79] [cursor=pointer]
        - gridcell "corn nugget, column 1, row 1" [ref=e80] [cursor=pointer]
        - gridcell "paper roll, column 2, row 1" [ref=e81] [cursor=pointer]
    - toolbar "Game controls" [ref=e82]:
      - button "No daily undo" [disabled] [ref=e83]
      - button "Practice after finish" [disabled] [ref=e84]
      - group [ref=e85]:
        - generic "Aim" [ref=e86] [cursor=pointer]
      - generic [ref=e87]: Difficulty
  - generic [ref=e88]: Popped 3, +1. Score 26.
  - link "Back to game hub" [ref=e89]:
    - /url: ./
    - generic [aria-hidden] [ref=e90]: ←
    - generic [ref=e91]: Hub
  - button "Stalemate music on, tap to turn music off" [pressed] [ref=e92] [cursor=pointer]: 🎵
  - button "Colorblind-safe colors off, tap for high-contrast palettes and suit patterns" [ref=e94] [cursor=pointer]: Clr
  - status [ref=e95]: Popped 3, +1. Score 26.
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
> 17  |     await page.locator(`.tile[data-col="${cell[0]}"][data-row="${cell[1]}"]`).click();
      |                                                                               ^ Error: locator.click: Test timeout of 30000ms exceeded.
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
  73  |         Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: undefined });
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
  90  |     await expect(page.locator('#dailyShareStatus')).toContainText('canceled');
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
```