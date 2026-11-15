// A phone opens a Game Night invite that can no longer admit anyone.
// The page clock is already past the 72-hour invite lifetime, or still inside
// it when the fixture revokes the invite. Nothing waits in real time.
// An expired invite is refused before the socket is accepted; a revoked invite
// is closed with 4401. /beta/state is 401. No hosted session is contacted.
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const PHONE = { width: 390, height: 844 };
const LOBBY = '/r/45662413410ed051/lobby/';
const PREVIEW = 'local-preview-key-0001';
const ISSUED = Date.parse('2026-11-12T21:00:00Z');
const ASK_HOST = /ask (your|the) host for a (fresh|new) (invitation|link)/i;
const SPINNER = /^(Connecting…|Reconnecting…|Still connecting to your game…|Getting you in…)$/;
const RAW = /sign in again|beta session ended|4401|TypeError|Private invitation required|expired or revoked|undefined/i;

test.describe('expired and revoked Game Night invites on a phone', () => {
    for (const kind of ['expired', 'revoked']) {
        test(`${kind === 'expired' ? 'an expired' : 'a revoked'} invite tells the guest to ask the host for a new link`, async ({ browser, baseURL }) => {
            const { DEMO_INVITE_TTL } = await import('../../hangout-worker/src/beta-auth.mjs');
            const openedAt = kind === 'expired' ? ISSUED + DEMO_INVITE_TTL + 1 : ISSUED + 60 * 60 * 1000;
            expect(openedAt > ISSUED + DEMO_INVITE_TTL).toBe(kind === 'expired');
            const seen = [];
            const context = await browser.newContext({ viewport: PHONE, hasTouch: true, serviceWorkers: 'block' });
            const pageErrors = [];
            try {
                await context.route('**/*', route => {
                    const url = new URL(route.request().url());
                    if (url.origin === new URL(baseURL).origin) return route.continue();
                    return route.abort();
                });
                await context.route(url => url.pathname === LOBBY, async route => {
                    const response = await route.fetch();
                    await route.fulfill({
                        response,
                        body: (await response.text()).replace(
                            '<head>',
                            '<head><script src="/beta/bootstrap.js?game-guest=1"></script>'
                        )
                    });
                });
                await context.route(url => url.pathname === '/beta/bootstrap.js', route => route.fulfill({
                    contentType: 'text/javascript',
                    body: `window.HangoutBootstrap=${JSON.stringify({
                        gameGuest: {
                            room: '#game-abc123x456def',
                            ref: 'a'.repeat(32),
                            game: 'chess',
                            match: 'b'.repeat(8),
                            tableId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                            sessionRef: 'c'.repeat(64)
                        }
                    })};`
                }));
                await context.route(url => url.pathname === '/beta/state', route => route.fulfill({
                    status: 401,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: 'Private invitation required.' })
                }));
                const page = await context.newPage();
                page.on('pageerror', error => pageErrors.push(error.message));
                await page.clock.install({ time: openedAt });
                // An invite that is already past 72 hours is refused before the
                // socket is accepted (the loopback upgrade 404s). A revoked
                // invite is accepted and then closed with the real 4401 reason.
                const relay = hangoutRelayWsBase(baseURL, `deadend-${kind}`);
                if (kind === 'revoked') {
                    await page.routeWebSocket(url => url.pathname.endsWith('/lobby'), socket => {
                        seen.push(new URL(socket.url()).searchParams.get('game-guest'));
                        socket.close({ code: 4401, reason: 'beta session ended' });
                    });
                }
                await page.goto(`${LOBBY}?preview=${PREVIEW}&relay=${encodeURIComponent(kind === 'expired' ? relay + '/unavailable' : relay)}`);
                const now = await page.evaluate(() => Date.now());
                if (kind === 'expired') expect(now).toBeGreaterThan(ISSUED + DEMO_INVITE_TTL);
                else expect(now).toBeLessThan(ISSUED + DEMO_INVITE_TTL);

                const message = page.getByText(ASK_HOST);
                await expect(message).toBeVisible();
                await expect(message).toBeInViewport();
                const box = await message.boundingBox();
                expect(box.y).toBeGreaterThanOrEqual(0);
                expect(box.y + box.height).toBeLessThanOrEqual(PHONE.height);
                expect(box.x).toBeGreaterThanOrEqual(0);
                expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width);

                await expect(page.locator('[role="status"]:visible').filter({ hasText: SPINNER })).toHaveCount(0);
                await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeHidden();
                await expect(page.getByRole('button', { name: 'Cancel joining', exact: true })).toBeHidden();
                await expect(page.locator('body')).not.toContainText(RAW);
                await expect(page.locator('[data-gate]')).toBeHidden();
                expect(pageErrors, pageErrors.join('\n')).toEqual([]);
                if (kind === 'revoked') expect(seen).toEqual(['1']);
            } finally {
                await context.close();
            }
        });
    }
});
