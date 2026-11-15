const { test, expect } = require('@playwright/test');
const { gameNight, room } = require('./chess-phone-fixture');

const PHONE = { width: 390, height: 844 };
const CHESS = { status: '[data-chess-status]' };
const panel = page => page.locator('details', { has: page.locator(CHESS.status) });
const resultText = /^White wins · Resignation$/;
const resignation = { reason: 'Resignation', winner: 'w' };

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
    expect(acted).toEqual({ ok: true, error: null });
    await expect.poll(async () => (await fixture.record('chess')).chess.match.result).toMatchObject(resignation);
    return previousId;
}

async function expectResignation(page) {
    const status = page.locator(CHESS.status);
    await expect(status).toContainText(resultText);
    await expect(status).not.toContainText(/Draw|Checkmate/);
}

const seatOf = (fixture, nick) => fixture.view(nick, 'chess').deserializeAttachment().seat;

// The page fits the phone, and the rematch control is a full touch target on screen.
async function expectRematchOnPhone(page, name) {
    expect(page.viewportSize()).toEqual(PHONE);
    const button = panel(page).getByRole('button', { name, exact: true });
    await expect(button).toBeVisible();
    await expect(button).toBeEnabled();
    const box = await button.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(PHONE.height);
    const layout = await page.evaluate(() => {
        const status = document.querySelector('[data-chess-status]');
        return { viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth,
            statusClient: status.clientWidth, statusScroll: status.scrollWidth };
    });
    expect(layout.viewport).toBe(PHONE.width);
    expect(layout.document).toBeLessThanOrEqual(PHONE.width);
    expect(layout.statusScroll).toBeLessThanOrEqual(layout.statusClient + 1);
    return button;
}

// Ruling #557/#560: nothing sent to a watcher names a seat as theirs, a hand, or another
// person's private id. `from` skips frames this phone received while it held a seat.
function expectSpectatorFrames(fixture, nick, players, from = 0) {
    const raw = fixture.frames(nick).slice(from);
    const text = raw.join('\n');
    expect(text).not.toMatch(/"(hand|hands|privateHand|playable|seatId|betaSid|playerId)"\s*:/);
    for (const player of players) {
        const person = fixture.people.get(player);
        expect(text).not.toContain(person.sid);
        expect(text).not.toContain(person.identity.id);
    }
    const states = raw.map(frame => JSON.parse(frame)).filter(frame => frame.t === 'match-state' || frame.t === 'snapshot');
    expect(states.length).toBeGreaterThan(0);
    for (const frame of states) {
        expect(frame.yourSeat ?? null).toBeNull();
        expect(frame.state?.seat ?? null).toBeNull();
    }
    return states;
}

test('390×844 Chess result survives a match drop, a lobby drop and a complete rematch', async ({ browser, baseURL }) => {
    test.slow();
    const fixture = await gameNight(browser, baseURL);
    try {
        const pages = await seated(fixture);
        const [host, guest] = pages;
        const firstHostSocket = fixture.view('PhoneHost', 'chess');
        const firstGuestSocket = fixture.view('PhoneGuest', 'chess');
        const firstId = await finishByGuestResignation(fixture);

        for (const page of pages) {
            await expectResignation(page);
            await expectRematchOnPhone(page, 'Request rematch');
            await expect(page.locator('.arcade-chess-board')).toBeInViewport();
        }
        expect((await fixture.record('chess')).chess.match.result).toMatchObject(resignation);
        expect(firstGuestSocket.deserializeAttachment().seat).toBe('b');
        expect(firstHostSocket.deserializeAttachment().seat).toBe('w');

        // A match transport loss shows the reconnect banner. Holding the next ticket keeps
        // it on screen to measure, then the phone reconnects to a fresh authoritative snapshot.
        const reconnect = panel(guest).locator('.arcade-reconnect');
        await expect(reconnect).toBeHidden();
        const releaseTicket = fixture.holdTickets('PhoneGuest');
        await fixture.dropMatch('PhoneGuest', 'chess');
        await expect(reconnect).toBeVisible();
        await expect(reconnect).toHaveText('Reconnecting…');
        await expect(guest.locator(CHESS.status)).toHaveText('Reconnecting to Chess… The clocks keep running.');
        // No rematch can be asked for while the match connection is down.
        await expect(panel(guest).getByRole('button', { name: /rematch/i })).toHaveCount(0);
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
                status: bounds('[data-chess-status]'), reconnect: bounds('.arcade-reconnect') };
        });
        expect(layout.viewport).toBe(PHONE.width);
        expect(layout.document).toBeLessThanOrEqual(PHONE.width);
        expect(layout.status).not.toBeNull();
        expect(layout.reconnect).not.toBeNull();
        expect(layout.status.scrollWidth).toBeLessThanOrEqual(layout.status.clientWidth + 1);
        expect(layout.reconnect.left).toBeGreaterThanOrEqual(0);
        expect(layout.reconnect.right).toBeLessThanOrEqual(PHONE.width);
        expect(layout.reconnect.top).toBeGreaterThanOrEqual(0);
        expect(layout.reconnect.bottom).toBeLessThanOrEqual(PHONE.height);
        expect(layout.reconnect.scrollWidth).toBeLessThanOrEqual(layout.reconnect.clientWidth + 1);
        expect(layout.reconnect.bottom <= layout.status.top || layout.reconnect.top >= layout.status.bottom).toBe(true);
        releaseTicket();
        await expect(reconnect).toBeHidden();
        await expect.poll(() => fixture.view('PhoneGuest', 'chess')?.readyState).toBe(1);
        const secondGuestSocket = fixture.view('PhoneGuest', 'chess');
        expect(secondGuestSocket).not.toBe(firstGuestSocket);
        await expectResignation(guest);
        await expect(guest.locator('.arcade-chess-board')).toBeVisible();
        await expectRematchOnPhone(guest, 'Request rematch');
        expect(secondGuestSocket.deserializeAttachment().seat).toBe('b');
        expect((await fixture.record('chess')).chess.match.result).toMatchObject(resignation);

        // Losing the lobby ends room membership, so the server closes the match socket with
        // 4403. That is final for the match client: Chess shows no reconnect banner and opens
        // no new match socket on its own. The lobby reconnects and offers the seat back.
        await fixture.dropLobby('PhoneGuest');
        expect(secondGuestSocket.closed).toMatchObject({ code: 4403 });
        await expect(guest.locator('[data-connection]')).toHaveText('Reconnecting…');
        await expect(reconnect).toBeHidden();
        const offer = guest.locator('[data-game-offer]');
        await expect(offer.locator('[data-game-offer-status]')).toHaveText('You disconnected. Return to your game to check your seat.');
        await expect(guest.locator('[data-connection]')).toHaveText('Connected');
        await expect(reconnect).toBeHidden();
        await expect(guest.locator(CHESS.status)).toBeHidden();
        expect(fixture.view('PhoneGuest', 'chess')).toBe(secondGuestSocket);
        // The finished game and both seats are still held on the server while the guest is away.
        const held = await fixture.record('chess');
        expect(held.chess.id).toBe(firstId);
        expect(held.chess.match.result).toMatchObject(resignation);
        await expectResignation(host);
        expect(fixture.view('PhoneHost', 'chess')).toBe(firstHostSocket);

        await offer.getByRole('button', { name: 'Back to my seat', exact: true }).click();
        await expect(guest.getByRole('region', { name: /Game Night/ })).toBeVisible();
        await expect.poll(() => fixture.view('PhoneGuest', 'chess')?.readyState).toBe(1);
        const thirdGuestSocket = fixture.view('PhoneGuest', 'chess');
        expect(thirdGuestSocket).not.toBe(secondGuestSocket);
        await expectResignation(guest);
        await expect(guest.locator('.arcade-chess-board')).toBeVisible();
        await expect(reconnect).toBeHidden();
        expect(thirdGuestSocket.deserializeAttachment().seat).toBe('b');
        const returned = await fixture.record('chess');
        expect(returned.chess.id).toBe(firstId);
        expect(returned.chess.match.result).toMatchObject(resignation);

        // The actual action works and exposes an accept action to the opponent.
        const hostRematch = await expectRematchOnPhone(host, 'Request rematch');
        await hostRematch.click();
        const accept = await expectRematchOnPhone(guest, 'Accept rematch');
        await accept.click();

        await expect.poll(async () => (await fixture.record('chess')).chess.id).not.toBe(firstId);
        const next = await fixture.record('chess');
        expect(next.chess.match.result).toBeNull();
        for (const [index, page] of pages.entries()) {
            await expect(page.locator('.arcade-chess-board')).toBeVisible();
            await expect(page.locator(CHESS.status)).not.toContainText(/wins ·|Draw ·|Checkmate/);
            await expect(page.locator(CHESS.status)).toContainText(index === 0 ? /You’re White/ : /You’re Black/);
        }
        // A rematch is announced on the sockets that are already open. Nobody reconnects for it,
        // and each player keeps the seat they had.
        const hostSocket = fixture.view('PhoneHost', 'chess'), guestSocket = fixture.view('PhoneGuest', 'chess');
        expect(hostSocket).toBe(firstHostSocket);
        expect(guestSocket).toBe(thirdGuestSocket);
        expect(hostSocket.readyState).toBe(1);
        expect(guestSocket.readyState).toBe(1);
        for (const nick of ['PhoneHost', 'PhoneGuest']) {
            const announced = fixture.frames(nick).map(frame => JSON.parse(frame)).filter(frame => frame.t === 'rematch');
            expect(announced.map(frame => frame.matchId)).toEqual([next.chess.id]);
        }
        expect(hostSocket.deserializeAttachment().seat).toBe('w');
        expect(guestSocket.deserializeAttachment().seat).toBe('b');
        expect(fixture.errors()).toEqual([]);
    } finally { await fixture.close(); }
});

test('a non-participating Chess watcher receives no seat or private hand state', async ({ browser, baseURL }) => {
    test.slow();
    const fixture = await gameNight(browser, baseURL);
    const players = ['PhoneHost', 'PhoneGuest'];
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
        expectSpectatorFrames(fixture, 'PhoneWatcher', players);

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
        expectSpectatorFrames(fixture, 'PhoneWatcher', players);
        expect((await fixture.record('chess')).chess.id).toBe(firstId);

        // The table is full, so the server lines the watcher up for the next game. Queued is
        // still unseated: no seat, no rematch vote, nothing private, while a rematch is asked for.
        await panel(host).getByRole('button', { name: 'Request rematch', exact: true }).click();
        await expect(panel(guest).getByRole('button', { name: 'Accept rematch', exact: true })).toBeVisible();
        await expect(watcher.locator(CHESS.status)).toHaveText(resultText);
        await expect(panel(watcher).getByRole('button', { name: /rematch/i })).toHaveCount(0);
        const queued = expectSpectatorFrames(fixture, 'PhoneWatcher', players).at(-1);
        expect(queued.state).toMatchObject({ id: firstId, upNext: true, rematch: 'w' });
        expect(seatOf(fixture, 'PhoneWatcher')).toBeNull();

        // Game Night seats the waiting phone at the next game and the last guest sits it out
        // (game-night-table.mjs #admitNext). The host keeps White. From here the guest is the
        // watcher, so the same privacy rules now apply to the guest's phone.
        const guestSeatedFrames = fixture.frames('PhoneGuest').length;
        await panel(guest).getByRole('button', { name: 'Accept rematch', exact: true }).click();
        await expect.poll(async () => (await fixture.record('chess')).chess.id).not.toBe(firstId);
        const next = await fixture.record('chess');
        expect(next.chess.match.result).toBeNull();
        await expect(host.locator(CHESS.status)).toHaveText(/^You’re White · White to move$/);
        await expect(watcher.locator(CHESS.status)).toHaveText(/^You’re Black · White to move$/);
        await expect(guest.locator(CHESS.status)).toHaveText(/^Watching · White to move$/);
        for (const page of [host, guest, watcher]) await expect(page.locator('.arcade-chess-board')).toBeVisible();
        expect(seatOf(fixture, 'PhoneHost')).toBe('w');
        expect(seatOf(fixture, 'PhoneWatcher')).toBe('b');
        const displaced = fixture.view('PhoneGuest', 'chess').deserializeAttachment();
        expect(displaced.seat).toBeNull();
        expect(displaced).not.toHaveProperty('hand');
        expect(displaced).not.toHaveProperty('hands');
        await expect(panel(guest).getByRole('button', { name: /rematch|resign|draw|leave/i })).toHaveCount(0);
        const guestStates = expectSpectatorFrames(fixture, 'PhoneGuest', ['PhoneHost', 'PhoneWatcher'], guestSeatedFrames);
        expect(guestStates.at(-1).state.id).toBe(next.chess.id);

        // The sat-out guest reconnects and is still only watching the new game.
        await fixture.dropMatch('PhoneGuest', 'chess');
        await expect(guest.locator(CHESS.status)).toContainText(/Reconnecting to Chess/);
        await expect.poll(() => fixture.view('PhoneGuest', 'chess')?.readyState).toBe(1);
        await expect(guest.locator(CHESS.status)).toHaveText(/^Watching · White to move$/);
        expect(seatOf(fixture, 'PhoneGuest')).toBeNull();
        expectSpectatorFrames(fixture, 'PhoneGuest', ['PhoneHost', 'PhoneWatcher'], guestSeatedFrames);
        expect((await fixture.record('chess')).chess.id).toBe(next.chess.id);
        expect(fixture.errors()).toEqual([]);
    } finally { await fixture.close(); }
});
