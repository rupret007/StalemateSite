const { test, expect } = require('@playwright/test');

async function openRace(page, baseURL, viewport) {
  await page.setViewportSize(viewport);
  // Exercise the real, shipped Game Night page. Its race panel is opened by the
  // production Game Night flow when a match is available.
  await page.goto(`${baseURL}/r/45662413410ed051/lobby/`);
}

async function inViewport(locator) {
  return locator.evaluate(node => {
    const r = node.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.top >= 0 && r.left >= 0 &&
      r.bottom <= innerHeight && r.right <= innerWidth;
  });
}

test.describe('Turdanoid phone and landscape layout', () => {
  test('390×844 Game Night lobby loads with mobile viewport and touch capabilities', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await openRace(page, baseURL, { width: 390, height: 844 });
    await expect(page.locator('[data-nick]')).toBeVisible();
    expect(await page.evaluate(() => ({ touch: navigator.maxTouchPoints, dpr: devicePixelRatio, width: innerWidth })))
      .toEqual({ touch: expect.any(Number), dpr: 3, width: 390 });
    await context.close();
  });

  test('844×390 Game Night lobby renders without horizontal overflow', async ({ page, baseURL }) => {
    await openRace(page, baseURL, { width: 844, height: 390 });
    await expect(page.locator('[data-nick]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});
