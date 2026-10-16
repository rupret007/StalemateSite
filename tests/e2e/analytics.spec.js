const { test, expect } = require('@playwright/test');

const GC_HOST = 'stalemate.goatcounter.com';

function pathsFromUrl(url) {
  try {
    const u = new URL(url);
    const p = u.searchParams.get('p');
    return p ? [decodeURIComponent(p)] : [];
  } catch {
    return [];
  }
}

test.describe('GoatCounter analytics', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.goatcounter = { allow_local: true };
    });
  });

  test('home: no CSP violations; clicks emit expected events', async ({ page }) => {
    const violations = [];
    const eventPaths = [];

    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) => {
        window.__cspViolations = window.__cspViolations || [];
        window.__cspViolations.push(e.violatedDirective);
      });
    });

    await page.route(`**/*${GC_HOST}/**`, async (route) => {
      const url = route.request().url();
      eventPaths.push(...pathsFromUrl(url));
      await route.fulfill({ status: 204, body: '' });
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.locator('#listen a[href*="spotify.com"]').first().click();
    await page.locator('.social-link[href*="instagram"]').first().click();
    await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Listen' }).click();

    await expect.poll(() => eventPaths.filter((p) => p === 'music-spotify').length).toBeGreaterThan(0);
    await expect.poll(() => eventPaths.filter((p) => p === 'social-instagram').length).toBeGreaterThan(0);
    await expect.poll(() => eventPaths.filter((p) => p === 'nav-listen').length).toBeGreaterThan(0);

    const v = await page.evaluate(() => window.__cspViolations || []);
    expect(violations.concat(v)).toEqual([]);
  });

  test('play Turdanoid: no CSP violations; start emits play-turdanoid-start', async ({ page }) => {
    const eventPaths = [];

    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) => {
        window.__cspViolations = window.__cspViolations || [];
        window.__cspViolations.push(e.violatedDirective);
      });
    });

    await page.route(`**/*${GC_HOST}/**`, async (route) => {
      eventPaths.push(...pathsFromUrl(route.request().url()));
      await route.fulfill({ status: 204, body: '' });
    });

    await page.addInitScript(() => localStorage.setItem('turdanoid_v3_coach_v1', '1'));
    await page.goto('/play/TurdAnoid.html');
    await page.locator('#btnStart').click();

    await expect.poll(() => eventPaths.includes('play-turdanoid-start')).toBe(true);

    const v = await page.evaluate(() => window.__cspViolations || []);
    expect(v).toEqual([]);
  });
});
