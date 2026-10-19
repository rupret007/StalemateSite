// Explicit protocol fixtures verify report feedback; storage/wake authorization is
// covered separately against the real engine and Durable Object adapter.
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

test.skip(({ browserName }) => browserName !== 'chromium', 'Report protocol fixture uses Chromium.');
const LINE = { t: 'line', id: 'mreportfixture', ch: '#stalemate', from: 'OtherGuest', prefix: '',
    band: false, moderator: false, me: false, text: 'An exact received line for a report', ts: 1800000000000 };

async function openFixture(page, baseURL) {
    let socket; const reports = [];
    await page.routeWebSocket((url) => url.pathname.endsWith('/lobby'), (ws) => {
        socket = ws;
        ws.onMessage((raw) => {
            const frame = JSON.parse(String(raw));
            if (frame.t === 'hello') {
                ws.send(JSON.stringify({ t: 'welcome', nick: 'Witness', band: false, verified: false }));
                ws.send(JSON.stringify({ t: 'join', ch: { name: '#stalemate', kind: 'lobby', title: 'The lobby', topic: '', count: 2,
                    modes: { m: false, i: false, k: false, l: 150, t: true, S: 0, C: false, Q: false, locked: false },
                    names: [{ id: 'witness', nick: 'Witness', prefix: '' }, { id: 'author', nick: 'OtherGuest', prefix: '' }] } }));
                ws.send(JSON.stringify(LINE));
            } else if (frame.t === 'report') reports.push(frame);
        });
        ws.send(JSON.stringify({ t: 'hello', role: 'fan', lock: 'off', shield: false, budget: 'ok', needNick: true }));
    });
    const relay = hangoutRelayWsBase(baseURL, 'report-ui-fixture');
    await page.goto(`/r/45662413410ed051/lobby/?preview=local-preview-key-0001&relay=${encodeURIComponent(relay)}`);
    await page.fill('[data-nick]', 'Witness'); await page.click('[data-enter]');
    await expect(page.locator('[data-connection]')).toHaveText('Connected');
    return { reports, publish: (frame) => socket.send(JSON.stringify(frame)) };
}

test('reports send exact received text and confirm only on server acknowledgement', async ({ page, baseURL }) => {
    const fixture = await openFixture(page, baseURL);
    const flag = page.locator('[data-id="mreportfixture"] .flag');
    await flag.click(); await expect(flag).toHaveText('…'); await expect(flag).toBeDisabled();
    await expect.poll(() => fixture.reports).toEqual([{ t: 'report', id: LINE.id, text: LINE.text }]);
    fixture.publish({ t: 'report-status', id: LINE.id, submitted: true });
    await expect(flag).toHaveText('✓'); await expect(flag).toBeDisabled();
    await page.locator('[data-tabs] [data-channel-key="#stalemate"]').click();
    await expect(flag).toHaveText('✓'); await expect(flag).toBeDisabled();
});

test('storage errors and report limits restore the report button for a truthful retry', async ({ page, baseURL }) => {
    const fixture = await openFixture(page, baseURL);
    const flag = page.locator('[data-id="mreportfixture"] .flag');
    await flag.click();
    fixture.publish({ t: 'notice', from: 'StaleBot', kind: 'error', text: 'Storage is unavailable. Changes are not confirmed; reconnect after administrator recovery.' });
    await expect(flag).toBeEnabled(); await expect(flag).toHaveText('🚩');
    await expect(page.locator('[data-buffer]')).toContainText('Changes are not confirmed');
    await flag.click();
    fixture.publish({ t: 'rate-limit', scope: 'report', retryAfter: 1, text: 'Please wait 1s before trying again.' });
    await expect(flag).toBeEnabled(); await expect(flag).toHaveText('🚩');
    await flag.click();
    fixture.publish({ t: 'report-status', id: LINE.id, submitted: true });
    await expect(flag).toHaveText('✓');
    await expect.poll(() => fixture.reports.length).toBe(3);
});
