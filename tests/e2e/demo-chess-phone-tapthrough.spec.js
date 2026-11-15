// Game Night Chess on two phones (390×844): invite, tap legal moves, keep every
// match control fully on screen, agree a draw, then rematch with colors swapped.
const { test, expect } = require('@playwright/test');
const { gameNight } = require('./chess-phone-fixture');

const PHONE = { width: 390, height: 844 };

function mobileBrowser(browser) {
    return {
        newContext: options => browser.newContext({ ...options, viewport: options.viewport || PHONE, isMobile: true, hasTouch: true })
    };
}

const status = page => page.locator('[data-chess-status]');
const square = (page, name) => page.locator(`.arcade-chess [data-square="${name}"]`);
const chessButton = (page, name) => page.locator('.arcade-chess').getByRole('button', { name, exact: true });

async function expectFullyOnPhone(locator, label) {
    await expect(locator, label).toBeVisible();
    const box = await locator.boundingBox();
    expect(box, `${label} bounding box`).not.toBeNull();
    expect(box.x, `${label} left`).toBeGreaterThanOrEqual(0);
    expect(box.y, `${label} top`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `${label} right`).toBeLessThanOrEqual(PHONE.width);
    expect(box.y + box.height, `${label} bottom`).toBeLessThanOrEqual(PHONE.height);
    expect(box.width, `${label} width`).toBeGreaterThanOrEqual(44);
    expect(box.height, `${label} height`).toBeGreaterThanOrEqual(44);
}

async function expectPhone(page) {
    expect(page.viewportSize()).toEqual(PHONE);
    expect(await page.evaluate(() => window.innerWidth)).toBe(PHONE.width);
    expect(await page.evaluate(() => window.innerHeight)).toBe(PHONE.height);
    expect(await page.evaluate(() => navigator.maxTouchPoints)).toBeGreaterThan(0);
}

async function openGameNight(host) {
    const start = host.getByRole('button', { name: /Game Night/ });
    if (!await start.isVisible()) await host.locator('.phonetabs [data-show="rooms"]').tap();
    await start.tap();
    await expect(host.getByRole('region', { name: /Game Night/ })).toBeVisible();
}

async function inviteGuest(host, guest, nick) {
    await host.getByRole('button', { name: 'Invite players', exact: true }).tap();
    await host.getByRole('button', { name: `Invite ${nick}`, exact: true }).tap();
    await guest.locator('[data-game-offer]').getByRole('button', { name: 'Join Game Night', exact: true }).tap();
    await expect(guest.getByRole('region', { name: /Game Night/ })).toBeVisible();
    if (await host.locator('[data-invite-dialog][open]').count()) await host.keyboard.press('Escape');
}

async function showChess(page) {
    const picker = page.getByRole('combobox', { name: 'Switch game' });
    await expect(picker.locator('option[value="chess"]')).toBeEnabled();
    await picker.selectOption('chess');
    await expect(status(page)).toBeVisible();
}

async function tapMove(page, from, to) {
    await expect(status(page)).toContainText('Your turn');
    await square(page, from).tap();
    await expect(square(page, from)).toHaveAttribute('aria-pressed', 'true');
    await square(page, to).tap();
}

test('two 390×844 phones tap through Chess invite, moves, draw and a color-swapped rematch', async ({ browser, baseURL }) => {
    test.slow();
    const fixture = await gameNight(mobileBrowser(browser), baseURL);
    try {
        const [host, guest] = await Promise.all([fixture.phone('PhoneHost'), fixture.phone('PhoneGuest')]);
        await expectPhone(host);
        await expectPhone(guest);

        await openGameNight(host);
        await inviteGuest(host, guest, 'PhoneGuest');
        await showChess(host);
        await showChess(guest);
        await host.getByRole('button', { name: 'Open Chess match', exact: true }).tap();
        await guest.getByRole('button', { name: 'Join as Black', exact: true }).tap();

        await expect(host.locator('.arcade-chess-board')).toBeVisible();
        await expect(guest.locator('.arcade-chess-board')).toBeVisible();
        await expect(status(host)).toHaveText('You’re White · Your turn');
        await expect(status(guest)).toHaveText('You’re Black · White to move');
        await expect(square(host, 'a8')).toBeVisible();
        await expect(host.locator('.arcade-chess-board [data-square]').first()).toHaveAttribute('data-square', 'a8');
        await expect(guest.locator('.arcade-chess-board [data-square]').first()).toHaveAttribute('data-square', 'h1');
        expect(fixture.view('PhoneHost', 'chess').deserializeAttachment().seat).toBe('w');
        expect(fixture.view('PhoneGuest', 'chess').deserializeAttachment().seat).toBe('b');
        const opening = await fixture.record('chess');
        expect(opening.chess.seats).toEqual({
            w: fixture.people.get('PhoneHost').sid,
            b: fixture.people.get('PhoneGuest').sid
        });

        await tapMove(host, 'e2', 'e4');
        await expect(square(host, 'e4')).toHaveAttribute('data-piece', 'wp');
        await expect(square(guest, 'e4')).toHaveAttribute('data-piece', 'wp');
        await expect(status(host)).toHaveText('You’re White · Black to move');
        await expect(status(guest)).toHaveText('You’re Black · Your turn');
        await tapMove(guest, 'e7', 'e5');
        await expect(square(guest, 'e5')).toHaveAttribute('data-piece', 'bp');
        await expect(square(host, 'e5')).toHaveAttribute('data-piece', 'bp');
        await expect(status(host)).toHaveText('You’re White · Your turn');
        await expect(status(guest)).toHaveText('You’re Black · White to move');

        for (const page of [host, guest]) {
            await expectFullyOnPhone(page.locator('.arcade-chess-actions').getByRole('button', { name: 'Offer draw', exact: true }), 'Offer draw');
            await expectFullyOnPhone(page.locator('.arcade-chess-actions').getByRole('button', { name: 'Resign', exact: true }), 'Resign');
        }

        await chessButton(host, 'Offer draw').tap();
        const acceptDraw = guest.locator('.arcade-chess-actions').getByRole('button', { name: 'Accept draw', exact: true });
        await expect(acceptDraw).toBeVisible();
        await acceptDraw.tap();
        await expect(status(host)).toHaveText('Draw · Draw by agreement');
        await expect(status(guest)).toHaveText('Draw · Draw by agreement');
        expect((await fixture.record('chess')).chess.match.result).toEqual({ winner: null, reason: 'Draw by agreement' });

        for (const page of [host, guest]) await expectFullyOnPhone(chessButton(page, 'Request rematch'), 'Request rematch');
        await expectFullyOnPhone(chessButton(host, 'Start now'), 'Start now');

        await chessButton(host, 'Request rematch').tap();
        const acceptRematch = chessButton(guest, 'Accept rematch');
        await expectFullyOnPhone(acceptRematch, 'Accept rematch');
        await acceptRematch.tap();

        await expect.poll(async () => (await fixture.record('chess')).chess.id).not.toBe(opening.chess.id);
        await expect(status(host)).toHaveText('You’re Black · White to move');
        await expect(status(guest)).toHaveText('You’re White · Your turn');
        expect(fixture.view('PhoneHost', 'chess').deserializeAttachment().seat).toBe('b');
        expect(fixture.view('PhoneGuest', 'chess').deserializeAttachment().seat).toBe('w');
        await expect(host.locator('.arcade-chess-board [data-square]').first()).toHaveAttribute('data-square', 'h1');
        await expect(guest.locator('.arcade-chess-board [data-square]').first()).toHaveAttribute('data-square', 'a8');
        const rematch = await fixture.record('chess');
        expect(rematch.chess.match.result).toBeNull();
        expect(rematch.chess.seats).toEqual({
            w: fixture.people.get('PhoneGuest').sid,
            b: fixture.people.get('PhoneHost').sid
        });
        const frames = ['PhoneHost', 'PhoneGuest'].flatMap(nick => fixture.frames(nick));
        expect(frames.join('\n')).not.toMatch(/"(hand|hands|privateHand|seatId)"\s*:/);

        await tapMove(guest, 'e2', 'e4');
        await expect(square(host, 'e4')).toHaveAttribute('data-piece', 'wp');
        await expect(status(host)).toHaveText('You’re Black · Your turn');
        await expect(status(guest)).toHaveText('You’re White · Black to move');
        expect(fixture.errors()).toEqual([]);
    } finally {
        await fixture.close();
    }
});
