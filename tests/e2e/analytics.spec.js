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

  test('keeps page reports useful without tracking raw query, fragment, or missing URL', async ({ page, baseURL }) => {
    const hits = [];
    await page.route(`**/*${GC_HOST}/**`, async (route) => {
      hits.push(new URL(route.request().url()).searchParams);
      await route.fulfill({ status: 204, body: '' });
    });

    const referer = new URL('/room/private-referral?key=private-query#private-fragment', baseURL).href;
    await page.goto('/play/?name=private-value#private-hash', { referer });
    await expect.poll(() => hits.some(hit => hit.get('p') === '/play/')).toBe(true);

    const missing = await page.goto('/missing-private-path?person=private-value#private-hash', { referer });
    expect(missing.status()).toBe(404);
    await expect.poll(() => hits.some(hit => hit.get('p') === '/404.html')).toBe(true);
    for (const hit of hits) {
      expect(hit.get('r')).toBe(new URL(baseURL).origin);
      expect(hit.has('q')).toBe(false);
      expect(hit.toString()).not.toContain('private-');
    }
  });

  test('reports the homepage and Arcade foreground milestones to the correct site', async ({ page }) => {
    const paths = [];
    await page.route(`**/*${GC_HOST}/**`, async (route) => {
      paths.push(...pathsFromUrl(route.request().url()));
      await route.fulfill({ status: 204, body: '' });
    });
    await page.clock.install({ time: new Date('2026-11-24T16:00:00Z') });

    for (const [path, section] of [['/', 'home'], ['/StalemateSite/play/', 'arcade']]) {
      await page.goto(path);
      await page.clock.fastForward(31_000);
      await expect.poll(() => paths.filter(event => event === `engagement-${section}-30s`)).toHaveLength(1);
      expect(paths).not.toContain(`engagement-${section}-120s`);
      await page.clock.fastForward(269_000);
      const sectionPaths = () => paths.filter(event => event.startsWith(`engagement-${section}-`)).sort();
      await expect.poll(sectionPaths).toEqual([
        `engagement-${section}-120s`, `engagement-${section}-300s`, `engagement-${section}-30s`
      ]);
    }
  });
});
