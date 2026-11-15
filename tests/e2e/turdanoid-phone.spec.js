const { test, expect } = require('@playwright/test');

const PANEL = `
<details class="arcade-card-table arcade-brick-race" open>
  <summary>Turdanoid Brick Race</summary>
  <p class="small arcade-card-status brick-race-status" data-brick-status role="status">Race in progress</p>
  <div class="arcade-card-actions brick-race-actions">
    <button class="btn btn--small btn--ghost" type="button" data-brick-leave>Leave race</button>
    <button class="btn btn--small" type="button" data-brick-back>Back to lobby</button>
  </div>
  <div data-card-table data-brick-match>
    <div class="brick-race-layout">
      <div class="brick-race-board" data-brick-board><canvas width="480" height="400"></canvas></div>
      <div class="brick-race-rail">
        <time role="timer" data-brick-clock>01:23</time>
        <div data-brick-score="a"><b>Player 1</b><span>120</span><small>2 balls</small></div>
        <div data-brick-score="b"><b>Player 2</b><span>90</span><small>3 balls</small></div>
        <button type="button" class="btn btn--small" data-brick-serve>Launch ball</button>
        <span class="small" data-brick-power>Wide Load</span>
      </div>
    </div>
    <p class="small brick-race-help">Drag to move. Tap the stuck ball, press Launch, or press Space.</p>
  </div>
</details>`;

async function openRace(page, baseURL, viewport) {
  await page.setViewportSize(viewport);
  await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
    <link rel="stylesheet" href="${baseURL}/r/45662413410ed051/lobby/lobby.css"></head>
    <body><main class="game-night">${PANEL}</main></body></html>`);
  await expect(page.locator('[data-brick-match]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector('.arcade-brick-race')).position)).toBe('fixed');
}

async function inViewport(locator) {
  return locator.evaluate(node => {
    const r = node.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.top >= 0 && r.left >= 0 &&
      r.bottom <= innerHeight && r.right <= innerWidth;
  });
}

test.describe('Turdanoid phone and landscape layout', () => {
  test.use({ hasTouch: true });

  test('390×844 keeps return controls, status, Launch and the full rail in the viewport', async ({ page, baseURL }) => {
    await openRace(page, baseURL, { width: 390, height: 844 });
    const panel = page.locator('.arcade-brick-race');
    for (const selector of ['[data-brick-back]', '[data-brick-leave]', '[data-brick-serve]', '[data-brick-status]', '.brick-race-rail']) {
      await expect(page.locator(selector)).toBeVisible();
      expect(await inViewport(page.locator(selector))).toBe(true);
    }
    const dimensions = await panel.evaluate(node => ({
      height: node.getBoundingClientRect().height,
      contentHeight: node.scrollHeight,
      viewportHeight: innerHeight
    }));
    expect(dimensions.height).toBeLessThanOrEqual(dimensions.viewportHeight);
    expect(dimensions.contentHeight).toBeLessThanOrEqual(dimensions.viewportHeight);
    // Back remains untouched; this layout check never strands a seated player.
  });

  test('844×390 keeps the board and side rail beside one another with Launch and score visible', async ({ page, baseURL }) => {
    await openRace(page, baseURL, { width: 844, height: 390 });
    const board = page.locator('.brick-race-board');
    const rail = page.locator('.brick-race-rail');
    const launch = page.locator('[data-brick-serve]');
    const score = page.locator('[data-brick-score="a"]');
    for (const locator of [board, rail, launch, score]) expect(await inViewport(locator)).toBe(true);
    const boxes = await Promise.all([board, rail].map(locator => locator.boundingBox()));
    expect(boxes[0].x + boxes[0].width).toBeLessThanOrEqual(boxes[1].x);
    expect(await page.locator('.brick-race-layout').evaluate(node => getComputedStyle(node).gridTemplateColumns)).toMatch(/\s/);
  });
});
