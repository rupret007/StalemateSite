// Desktop host acceptance: Jeff at 1440×900 runs the four graded Game Night games
// while family phones join through the shared synthetic harness.
const { test, expect } = require('@playwright/test');
const { gameNight, invite } = require('./chess-phone-fixture');

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

const GAMES = {
    chess: {
        label: 'Chess',
        game: 'chess',
        status: '[data-chess-status]',
        board: '.arcade-chess-board',
        primary: '.arcade-chess-actions [data-action="resign"]',
        seats: 2,
        open: host => host.getByRole('button', { name: 'Open Chess match' }).click(),
        join: guest => guest.getByRole('button', { name: 'Join as Black' }).click(),
        hostStatus: /^You’re White · Your turn/
    },
    partners: {
        label: 'partners Spades',
        game: 'turdspades',
        status: '[data-spades-status]',
        board: '[data-spades-table]',
        primary: '[data-spades-hand] [data-spades-card]',
        seats: 2,
        open: host => host.getByRole('button', { name: 'Open 2-player Spades' }).click(),
        join: guest => guest.getByRole('button', { name: 'Join West' }).click(),
        hostStatus: /Round 1 ·|computer partner|Your bid/
    },
    four: {
        label: 'four-player Spades',
        game: 'turdspades',
        status: '[data-spades-status]',
        board: '[data-spades-table]',
        primary: '[data-spades-hand] [data-spades-card]',
        seats: 4,
        open: host => host.getByRole('button', { name: 'Open 4-player Spades' }).click(),
        join: (guest, index) => guest.getByRole('button', { name: `Join ${['West', 'North', 'East'][index]}` }).click(),
        hostStatus: /^Round 1 · /
    },
    turdanoid: {
        label: 'Turdanoid',
        game: 'turdanoid',
        status: '[data-brick-status]',
        board: '.brick-race-board',
        primary: '[data-brick-serve]',
        seats: 2,
        open: host => host.getByRole('button', { name: 'Open Turdanoid race' }).click(),
        join: guest => guest.getByRole('button', { name: 'Join Turdanoid race' }).click(),
        hostStatus: /\S/
    }
};

async function enterGameNight(host, guests, guestNicks) {
    const start = host.getByRole('button', { name: /Game Night/ });
    if (!await start.isVisible()) await host.locator('.phonetabs [data-show="rooms"]').click();
    await start.click();
    await expect(host.getByRole('region', { name: /Game Night/ })).toBeVisible();
    for (const [index, guest] of guests.entries()) await invite(host, guest, guestNicks[index]);
}

async function hostAndPhones(fixture, nicks) {
    const host = await fixture.phone(nicks[0], { viewport: DESKTOP });
    const guests = await Promise.all(nicks.slice(1).map(nick => fixture.phone(nick, { viewport: PHONE })));
    await enterGameNight(host, guests, nicks.slice(1));
    return [host, ...guests];
}

async function showTable(page, game) {
    const picker = page.getByRole('combobox', { name: 'Switch game' });
    await expect(picker.locator(`option[value="${game.game}"]`)).toBeEnabled();
    await picker.selectOption(game.game);
    await expect(page.locator(game.status)).toBeVisible();
}

async function seatHostGame(fixture, game) {
    const nicks = ['JeffHost', 'GuestWest', 'GuestNorth', 'GuestEast'].slice(0, game.seats);
    const pages = await hostAndPhones(fixture, nicks);
    const [host, ...guests] = pages;
    for (const page of pages) await showTable(page, game);
    await game.open(host);
    for (const [index, guest] of guests.entries()) await game.join(guest, index);
    await expect(host.locator(game.board)).toBeVisible();
    await expect(host.locator(game.status)).toHaveText(game.hostStatus);
    return { host, guests };
}

function boxesDisjoint(a, b) {
    if (!a || !b) return true;
    return a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
}

async function assertDesktopHostLayout(host, game) {
    const board = host.locator(game.board);
    const status = host.locator(game.status);
    const primary = host.locator(game.primary).first();
    await expect(board).toBeVisible();
    await expect(board).toBeInViewport();
    await expect(status).toBeVisible();
    await expect(status).toBeInViewport();
    await expect(status).not.toHaveText(/^$/);
    await expect(primary).toBeVisible();
    await expect(primary).toBeInViewport();

    const layout = await host.evaluate(({ boardSel, statusSel, primarySel }) => {
        const box = selector => {
            const el = document.querySelector(selector);
            if (!el || el.hidden || !el.getClientRects().length) return null;
            const r = el.getBoundingClientRect();
            if (!(r.width > 0 && r.height > 0)) return null;
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom,
                clientWidth: el.clientWidth, scrollWidth: el.scrollWidth };
        };
        const scroll = document.scrollingElement;
        const reconnectEl = document.querySelector('.arcade-reconnect');
        const reconnect = reconnectEl && !reconnectEl.hidden && reconnectEl.getClientRects().length
            ? box('.arcade-reconnect') : null;
        return {
            innerWidth: window.innerWidth,
            scrollWidth: scroll ? scroll.scrollWidth : document.documentElement.scrollWidth,
            board: box(boardSel),
            status: box(statusSel),
            primary: box(primarySel),
            reconnect
        };
    }, { boardSel: game.board, statusSel: game.status, primarySel: game.primary });

    expect(layout.scrollWidth, 'document should not scroll horizontally').toBeLessThanOrEqual(layout.innerWidth);
    expect(layout.innerWidth).toBe(DESKTOP.width);
    expect(layout.status.scrollWidth).toBeLessThanOrEqual(layout.status.clientWidth + 1);
    expect(boxesDisjoint(layout.board, layout.status), 'turn cue must not overlap the board').toBe(true);
    expect(boxesDisjoint(layout.primary, layout.status), 'turn cue must not overlap primary control').toBe(true);
    if (layout.reconnect) {
        expect(boxesDisjoint(layout.reconnect, layout.board), 'reconnect pill must not overlap the board').toBe(true);
        expect(boxesDisjoint(layout.reconnect, layout.primary), 'reconnect pill must not overlap primary control').toBe(true);
        expect(boxesDisjoint(layout.reconnect, layout.status), 'reconnect pill must not overlap turn cue').toBe(true);
    }
}

for (const game of Object.values(GAMES)) {
    test.describe(`${game.label} desktop host at 1440×900`, () => {
        test.beforeEach(() => test.slow());

        test('board, primary controls and turn cue fit without horizontal scroll', async ({ browser, baseURL }) => {
            const fixture = await gameNight(browser, baseURL);
            try {
                const { host } = await seatHostGame(fixture, game);
                await assertDesktopHostLayout(host, game);
                expect(fixture.errors()).toEqual([]);
            } finally { await fixture.close(); }
        });

        test('reconnect pill stays off the board, primary controls and turn cue', async ({ browser, baseURL }) => {
            const fixture = await gameNight(browser, baseURL);
            try {
                const { host } = await seatHostGame(fixture, game);
                const panel = host.locator('details', { has: host.locator(game.status) });
                const reconnect = panel.locator('.arcade-reconnect');
                await host.context().setOffline(true);
                await expect(reconnect).toBeVisible();
                await expect(reconnect).toHaveText('Reconnecting…');
                await assertDesktopHostLayout(host, game);
                await host.context().setOffline(false);
                await expect(reconnect).toBeHidden();
                expect(fixture.errors()).toEqual([]);
            } finally { await fixture.close(); }
        });
    });
}