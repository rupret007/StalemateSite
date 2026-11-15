const { test, expect } = require('@playwright/test');
const { gameNight, room } = require('./chess-phone-fixture');

const CHESS = { status: '[data-chess-status]' };
const panel = page => page.locator('details', { has: page.locator(CHESS.status) });
const resultText = /^White wins · Resignation$/;

async function seated(fixture, includeWatcher = false) {
    const pages = await room(fixture, includeWatcher
        ? ['PhoneHost', 'PhoneGuest', 'PhoneWatcher']
        : ['PhoneHost', 'PhoneGuest']);
    for (const page of pages) {
        await page.getByRole('combobox', { name: 'Switch game' }).selectOption('chess');
        await expect(page.locator(CHESS.status)).toBeVisible();
    }
    await pages[0].getByRole('button', { name: 'Open Chess match' }).click();
    await pages[1].getByRole('button', { name: 'Join as Black' }).click();
    for (const page of pages.slice(0, 2)) await expect(page.locator('.arcade-chess-board')).toBeVisible();
    return pages;
}

async function finishByGuestResignation(fixture) {
    const record = await fixture.record('chess');
    const previousId = record.chess.id;
    const match = record.chess.match;
    const acted = await fixture.act('PhoneGuest', 'chess', {
        action: 'resign', id: previousId,
        revision: match.revision ?? match.state?.revision ?? 0
    });
    expect(acted?.ok).not.toBe(false);
    await expect.poll(async () => (await fixture.record('chess')).chess.match.result).toMatchObject({ reason: 'Resignation', winner: 'w' });
    return previousId;
}

async function expectResignation(page) {
    const status = page.locator(CHESS.status);
    await expect(status).toContainText(resultText);
    await expect(status).not.toContainText(/Draw|Checkmate/);
}

test('390×844 Chess result survives deterministic reconnect and a complete rematch', async ({ browser, baseURL }) => {
    test.slow();
    const fixture = await gameNight(browser, baseURL);
    try {
        const pages = await seated(fixture);
        const [host, guest] = pages;
        const firstHostSocket = fixture.view('PhoneHost', 'chess');
        const firstGuestSocket = fixture.view('PhoneGuest', 'chess');
        const firstId = await finishByGuestResignation(fixture);

        for (const page of pages) await expectResignation(page);
        const saved = await fixture.record('chess');
        expect(saved.chess.match.result).toMatchObject({ reason: 'Resignation', winner: 'w' });
        expect(firstGuestSocket.deserializeAttachment().seat).toBe('b');
        expect(firstHostSocket.deserializeAttachment().seat).toBe('w');

        // A match transport loss must reconnect to a fresh authoritative snapshot.
        await fixture.dropMatch('PhoneGuest', 'chess');
        await expect(guest.locator(CHESS.status)).toContainText(/Reconnecting to Chess/);
        await expect.poll(() => fixture.view('PhoneGuest', 'chess')?.readyState).toBe(1);
        expect(fixture.view('PhoneGuest', 'chess')).not.toBe(firstGuestSocket);
        await expectResignation(guest);
        await expect(guest.locator('.arcade-chess-board')).toBeVisible();
        expect((await fixture.record('chess')).chess.match.result).toMatchObject({ reason: 'Resignation', winner: 'w' });

        // Keep the lobby reconnect banner visible long enough to measure its layout.
        await fixture.dropLobby('PhoneGuest');
        const reconnect = panel(guest).locator('.arcade-reconnect');
        await expect(reconnect).toHaveText('Reconnecting…');
        const layout = await guest.evaluate(() => {
            const bounds = selector => {
                const el = document.querySelector(selector);
                if (!el || !el.getClientRects().length) return null;
                const r = el.getBoundingClientRect();
                return { left: r.left, right: r.right, top: r.top, bottom: r.bottom,
                    clientWidth: el.clientWidth, scrollWidth: el.scrollWidth };
            };
            return { viewport: document.documentElement.clientWidth,
                document: document.documentElement.scrollWidth,
                status: bounds('[data-chess-status]'), reconnect: bounds('.arcade-reconnect'),
                rematch: bounds('[data-chess-primary]') };
        });
        expect(layout.viewport).toBe(390);
        expect(layout.document).toBeLessThanOrEqual(390);
        expect(layout.status.scrollWidth).toBeLessThanOrEqual(layout.status.clientWidth + 1);
        expect(layout.reconnect.left).toBeGreaterThanOrEqual(0);
        expect(layout.reconnect.right).toBeLessThanOrEqual(390);
        expect(layout.reconnect.scrollWidth).toBeLessThanOrEqual(layout.reconnect.clientWidth + 1);
        expect(layout.rematch).not.toBeNull();
        expect(layout.reconnect.bottom <= layout.rematch.top || layout.reconnect.top >= layout.rematch.bottom).toBe(true);
        await expect(reconnect).toBeHidden();
        await expect.poll(() => fixture.view('PhoneGuest', 'chess')?.readyState).toBe(1);
        await expectResignation(guest);
        expect((await fixture.record('chess')).chess.match.result).toMatchObject({ reason: 'Resignation', winner: 'w' });

        // The actual action works and exposes an accept action to the opponent.
        const hostRematch = panel(host).getByRole('button', { name: 'Request rematch', exact: true });
        await expect(hostRematch).toBeVisible();
        await expect(hostRematch).toBeEnabled();
        await hostRematch.click();
        const accept = panel(guest).getByRole('button', { name: 'Accept rematch', exact: true });
        await expect(accept).toBeVisible();
        await expect(accept).toBeEnabled();
        await accept.click();

        await expect.poll(async () => (await fixture.record('chess')).chess.id).not.toBe(firstId);
        const next = await fixture.record('chess');
        expect(next.chess.match.result).toBeNull();
        for (const [index, page] of pages.entries()) {
            await expect(page.locator('.arcade-chess-board')).toBeVisible();
            await expect(page.locator(CHESS.status)).not.toContainText(/wins ·|Draw ·|Checkmate/);
            await expect(page.locator(CHESS.status)).toContainText(index === 0 ? /You’re White/ : /You’re Black/);
        }
        expect(fixture.view('PhoneHost', 'chess')).not.toBe(firstHostSocket);
        expect(fixture.view('PhoneGuest', 'chess')).not.toBe(firstGuestSocket);
        expect(fixture.view('PhoneHost', 'chess').deserializeAttachment().seat).toBe('w');
        expect(fixture.view('PhoneGuest', 'chess').deserializeAttachment().seat).toBe('b');
        expect(fixture.errors()).toEqual([]);
    } finally { await fixture.close(); }
});

test('a non-participating Chess watcher receives no seat or private hand state', async ({ browser, baseURL }) => {
    const fixture = await gameNight(browser, baseURL);
    try {
        const [host, guest, watcher] = await seated(fixture, true);
        await watcher.getByRole('combobox', { name: 'Switch game' }).selectOption('chess');
        await expect(watcher.locator('.arcade-chess-board')).toBeVisible();
        await expect(watcher.locator(CHESS.status)).toHaveText(/^Watching · White to move$/);
        const watched = fixture.view('PhoneWatcher', 'chess').deserializeAttachment();
        expect(watched.seat).toBeNull();
        expect(watched).not.toHaveProperty('hand');
        expect(watched).not.toHaveProperty('hands');
        const watcherFrames = fixture.frames('PhoneWatcher').join('\n');
        expect(watcherFrames).not.toMatch(/"(hand|hands|privateHand|seatId|betaSid)"\s*:/);

        const firstId = await finishByGuestResignation(fixture);
        await expectResignation(host);
        await expectResignation(guest);
        await expect(watcher.locator(CHESS.status)).toContainText(resultText);
        await expect(panel(watcher).getByRole('button', { name: /rematch/i })).toHaveCount(0);

        // Reconnect the watcher and verify the authoritative spectator projection stays private.
        await fixture.dropMatch('PhoneWatcher', 'chess');
        await expect(watcher.locator(CHESS.status)).toContainText(/Reconnecting to Chess/);
        await expect.poll(() => fixture.view('PhoneWatcher', 'chess')?.readyState).toBe(1);
        const restored = fixture.view('PhoneWatcher', 'chess').deserializeAttachment();
        expect(restored.seat).toBeNull();
        expect(restored).not.toHaveProperty('hand');
        expect(restored).not.toHaveProperty('hands');
        await expectResignation(watcher);
        expect(fixture.frames('PhoneWatcher').join('\n')).not.toMatch(/"(hand|hands|privateHand|seatId|betaSid)"\s*:/);
        expect((await fixture.record('chess')).chess.id).toBe(firstId);
        expect(fixture.errors()).toEqual([]);
    } finally { await fixture.close(); }
});
