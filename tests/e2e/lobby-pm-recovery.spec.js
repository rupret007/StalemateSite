// Two real clients use the production engine via an explicit WebSocket fixture.
// Recreating that engine simulates a wake with the same exact live socket identities.
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

test.skip(({ browserName }) => browserName !== 'chromium', 'PM recovery fixture uses Chromium.');

async function community(browser, baseURL) {
    const { createLobby } = await import('../../hangout-worker/src/lobby-core.mjs');
    let now = 1800000000000, engine;
    const sockets = new Map(), identities = [], contexts = [];
    const boot = () => { engine = createLobby({ now: () => now, send: (id, frame) => sockets.get(id)?.send(JSON.stringify(frame)), limits: { defaultSlow: 0 } }); };
    boot();
    const guest = async (nick) => {
        const context = await browser.newContext(); contexts.push(context); const page = await context.newPage();
        const identity = { id: `socket-${nick}`, dev: `device-${nick}`, iph: `ip-${nick}`, role: 'fan', admin: false, account: '' }; identities.push(identity);
        await page.routeWebSocket((url) => url.pathname.endsWith('/lobby'), (ws) => {
            sockets.set(identity.id, ws); ws.onMessage((raw) => { void engine.message(identity.id, String(raw)); }); engine.connect(identity);
        });
        const relay = hangoutRelayWsBase(baseURL, 'pm-wake-fixture');
        await page.goto(`/r/45662413410ed051/lobby/?preview=local-preview-key-0001&relay=${encodeURIComponent(relay)}`);
        await page.fill('[data-nick]', nick); await page.click('[data-enter]');
        await expect(page.locator('[data-connection]')).toHaveText('Connected'); return page;
    };
    return {
        guest, advance: (ms) => { now += ms; }, tick: () => engine.tick(),
        wake: () => {
            const snapshot = structuredClone({ net: engine.snapshot(), rooms: engine.roomSnapshot(), abuse: engine.abuseSnapshot(), sessions: engine.sessionSnapshot() });
            now += 61000; boot(); engine.restore(snapshot.net); engine.restoreRooms(snapshot.rooms); engine.restoreAbuse(snapshot.abuse);
            const result = engine.restoreSessions(snapshot.sessions, identities); expect(result.rejected).toEqual([]); return snapshot;
        },
        close: () => Promise.all(contexts.map((context) => context.close()))
    };
}

const send = async (page, text) => { await page.fill('[data-text]', text); await page.press('[data-text]', 'Enter'); };

test('an existing PM Accept button survives wake and explains that unsaved first text must be resent', async ({ browser, baseURL }) => {
    const fixture = await community(browser, baseURL);
    try {
        const sender = await fixture.guest('Sender'); const recipient = await fixture.guest('Recipient'); fixture.advance(180000);
        await send(sender, '/msg Recipient A first sentence not retained on the server');
        const accept = recipient.locator('[data-pmreqs]').getByRole('button', { name: 'Accept', exact: true });
        await expect(accept).toBeVisible(); await accept.evaluate((button) => { button.dataset.originalPrompt = 'yes'; });
        const snapshot = fixture.wake(); expect(JSON.stringify(snapshot.sessions)).not.toContain('A first sentence');
        await expect(accept).toHaveAttribute('data-original-prompt', 'yes'); await accept.click();
        for (const page of [sender, recipient]) {
            await expect(page.locator('[data-chat-context]')).toHaveText(page === sender ? 'PM · Recipient' : 'PM · Sender');
            await expect(page.locator('[data-buffer]')).toContainText('first message was not retained');
            await expect(page.locator('[data-buffer]')).not.toContainText('A first sentence');
            await expect(page.locator('[data-connection]')).toHaveText('Connected');
        }
        await send(sender, 'The sender explicitly resends this after acceptance');
        await expect(recipient.locator('[data-buffer]')).toContainText('explicitly resends');
    } finally { await fixture.close(); }
});

test('a pending PM expiry clears its visible prompt and offers no old message replay', async ({ browser, baseURL }) => {
    const fixture = await community(browser, baseURL);
    try {
        const sender = await fixture.guest('Sender'); const recipient = await fixture.guest('Recipient'); fixture.advance(180000);
        await send(sender, '/msg Recipient This pending sentence must remain private');
        await expect(recipient.locator('[data-pmreqs] .req')).toHaveCount(1);
        fixture.advance(10 * 60000); await fixture.tick();
        await expect(recipient.locator('[data-pmreqs] .req')).toHaveCount(0);
        await expect(sender.locator('[data-buffer]')).toContainText('PM request to Recipient cleared');
        await expect(recipient.locator('[data-buffer]')).not.toContainText('pending sentence');
    } finally { await fixture.close(); }
});
