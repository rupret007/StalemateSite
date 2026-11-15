// Family demo walkthrough audit: desktop Game Night host (1440×900) plus phone
// players and watchers (390×844, touch, mobile) across the four graded games.
// Reuses the chess-phone-fixture harness; screenshots land under test-results/.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { test, expect } = require('@playwright/test');
const { tapHeight } = require('./fixtures');

const PHONE = { width: 390, height: 844 };
const HOST = { width: 1440, height: 900 };
const SHOT_DIR = path.join('test-results', 'family-demo-walkthrough-audit');
const WAIT_FOR_HOST = /wait(ing)? for (the )?host/i;
const RAW_OR_BLANK = /^$|^Waiting\s*$|^Waiting…$|^\{|\[object|Error:|undefined/i;

function patchedFixture() {
    const filename = path.join(__dirname, 'chess-phone-fixture.js');
    const original = fs.readFileSync(filename, 'utf8');
    const contextLine = 'const context = await browser.newContext({ viewport, hasTouch: true });';
    if (!original.includes(contextLine)) throw new Error('chess-phone-fixture.js no longer matches the audit loader');
    const source = original
        .replace(
            contextLine,
            'const mobile = viewport.width < 600;\n'
            + '        const context = await browser.newContext({ viewport, hasTouch: mobile, isMobile: mobile });'
        )
        .replace(
            "hangoutRelayWsBase(baseURL, 'family-alpha-gate')",
            "hangoutRelayWsBase(baseURL, 'family-demo-walkthrough-audit')"
        )
        + '\nmodule.exports = { PHONE, gameNight, room, invite, enter };\n';
    const compiled = new Module(filename, module);
    compiled.filename = filename;
    compiled.paths = Module._nodeModulePaths(path.dirname(filename));
    compiled._compile(source, filename);
    return compiled.exports;
}

const { gameNight, room, invite, enter } = patchedFixture();

const GAMES = {
    chess: {
        key: 'chess',
        label: 'chess',
        title: 'Chess',
        status: '[data-chess-status]',
        board: '.arcade-chess-board',
        seats: 2,
        playerNicks: ['ChessBlack'],
        watcherNick: 'ChessWatcher',
        open: host => host.getByRole('button', { name: 'Open Chess match' }).click(),
        join: guest => guest.getByRole('button', { name: 'Join as Black' }).click(),
        live: [/^You’re White · Your turn/, /^You’re Black · White to move/],
        watching: /^Watching · White to move/,
        finished: /wins · /,
        rematch: /rematch/i,
        close: 'Close waiting match',
        resignNick: 'ChessBlack',
        primary(page) {
            return page.locator('.arcade-chess-board').first();
        }
    },
    partners: {
        key: 'turdspades',
        label: 'partners-spades',
        title: 'partners Spades',
        status: '[data-spades-status]',
        board: '[data-spades-table]',
        seats: 2,
        playerNicks: ['PartnersWest'],
        watcherNick: 'PartnersWatcher',
        open: host => host.getByRole('button', { name: 'Open 2-player Spades' }).click(),
        join: guest => guest.getByRole('button', { name: 'Join West' }).click(),
        live: [/computer partner|Round 1/, /computer partner|Waiting for the host to bid|Round 1/],
        watching: /Round 1/,
        finished: / win by resignation\./,
        rematch: /Spades rematch/,
        close: 'Close table',
        resignNick: 'PartnersWest',
        primary(page) {
            const bid = page.getByRole('button', { name: 'Bid for me', exact: true });
            const card = page.locator('[data-spades-card]:enabled').first();
            return bid.or(card).first();
        }
    },
    four: {
        key: 'turdspades',
        label: 'four-spades',
        title: 'four-player Spades',
        status: '[data-spades-status]',
        board: '[data-spades-table]',
        seats: 4,
        playerNicks: ['FourWest', 'FourNorth', 'FourEast'],
        watcherNick: 'FourWatcher',
        open: host => host.getByRole('button', { name: 'Open 4-player Spades' }).click(),
        join: (guest, index) => guest.getByRole('button', { name: `Join ${['West', 'North', 'East'][index]}`, exact: true }).click(),
        live: [/^Round 1 · /, /^Round 1 · /, /^Round 1 · /, /^Round 1 · /],
        watching: /^Round 1 · /,
        finished: / win by resignation\./,
        rematch: /Spades rematch/,
        close: 'Close table',
        resignNick: 'FourEast',
        primary(page) {
            const bid = page.getByRole('button', { name: 'Bid for me', exact: true });
            const card = page.locator('[data-spades-card]:enabled').first();
            return bid.or(card).first();
        }
    },
    turdanoid: {
        key: 'turdanoid',
        label: 'turdanoid',
        title: 'Turdanoid',
        status: '[data-brick-status]',
        board: '[data-brick-match]',
        seats: 2,
        playerNicks: ['RaceGuest'],
        watcherNick: 'RaceWatcher',
        open: host => host.getByRole('button', { name: 'Open Turdanoid race' }).click(),
        join: guest => guest.getByRole('button', { name: 'Join Turdanoid race' }).click(),
        live: [/^(Fresh Tiles|Rainbow Rows|Ripple)$/, /^(Fresh Tiles|Rainbow Rows|Ripple)$/],
        watching: /^(Fresh Tiles|Rainbow Rows|Ripple)$/,
        finished: /forfeit/,
        rematch: /Turdanoid rematch/,
        close: 'Leave race',
        resignNick: 'RaceGuest',
        primary(page) {
            return page.locator('[data-brick-match]');
        }
    }
};

function panel(page, statusSel) {
    return page.locator('details', { has: page.locator(statusSel) });
}

function status(page, game) {
    return page.locator(game.status);
}

async function showTable(page, game) {
    const picker = page.getByRole('combobox', { name: 'Switch game' });
    const option = picker.locator(`option[value="${game.key}"]`);
    await expect(option).toBeEnabled();
    await picker.selectOption(game.key);
    await expect(status(page, game)).toBeVisible();
}

async function shot(page, step, name) {
    const dir = path.join(SHOT_DIR, step);
    fs.mkdirSync(dir, { recursive: true });
    const safe = name.replace(/[^\w.-]+/g, '-').slice(0, 80);
    const file = path.join(dir, `${safe}.png`);
    await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
    return file;
}

async function noHorizontalScroll(page) {
    const width = page.viewportSize()?.width ?? PHONE.width;
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
}

async function assertHumanStatus(page, game) {
    const text = (await status(page, game).innerText()).trim();
    expect(text.length).toBeGreaterThan(2);
    expect(text).not.toMatch(RAW_OR_BLANK);
    expect(text).not.toMatch(/^Waiting for the host to open/i);
}

async function assertSingleTurnCue(playerPages, game) {
    if (game.key === 'turdanoid') return;
    const lines = await Promise.all(playerPages.map(page => status(page, game).innerText()));
    const active = lines.filter(line => /Your (turn|bid)/i.test(line));
    if (!active.length) return;

    if (game.key === 'chess') {
        const turn = lines.filter(line => /Your turn/.test(line));
        expect(turn).toHaveLength(1);
        for (const line of lines) {
            if (/Your turn/.test(line)) continue;
            expect(line).not.toMatch(/Your turn/);
        }
        return;
    }
    expect(active).toHaveLength(1);
    for (const line of lines) {
        if (/Your (turn|bid)/i.test(line)) continue;
        expect(line).not.toMatch(/Your (turn|bid)/i);
    }
}

async function assertPrimaryVisible(page, game) {
    const statusText = await status(page, game).innerText();
    let primary = game.primary(page);
    if (game.key === 'turdspades' && !/Your (turn|bid)/i.test(statusText)) {
        primary = page.locator('[data-spades-table]');
    }
    await expect(primary).toBeVisible();
    await expect(primary).toBeInViewport();
    const reconnect = panel(page, game.status).locator('.arcade-reconnect');
    if (await reconnect.isVisible()) {
        const [a, b] = await Promise.all([reconnect.boundingBox(), primary.boundingBox()]);
        if (a && b) {
            const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
            expect(overlap, 'reconnect pill must not cover the primary control').toBe(false);
        }
    }
}

async function assertWatcherSpades(watcher) {
    await expect(watcher.locator('[data-spades-hand] button')).toHaveCount(0);
    await expect(watcher.locator('[data-spades-card]')).toHaveCount(0);
    const label = watcher.locator('[data-spades-hand-label]');
    if (await label.isVisible()) await expect(label).toHaveText('Watching · hands are private');
}

async function seatedGame(fixture, host, game) {
    const playerPages = [];
    for (const nick of game.playerNicks) {
        playerPages.push(await fixture.phone(nick, { viewport: PHONE }));
        await invite(host, playerPages.at(-1), nick);
    }
    const watcher = await fixture.phone(game.watcherNick, { viewport: PHONE });
    await invite(host, watcher, game.watcherNick);

    const everyone = [host, ...playerPages, watcher];
    await Promise.all(everyone.map(page => showTable(page, game)));
    await game.open(host);
    for (const [index, guest] of playerPages.entries()) await game.join(guest, index);

    for (const [index, page] of [host, ...playerPages].slice(0, game.seats).entries()) {
        await expect(page.locator(game.board)).toBeVisible();
        await expect(status(page, game)).toHaveText(game.live[index]);
    }
    await expect(watcher.locator(game.board)).toBeVisible();
    await expect(status(watcher, game)).toHaveText(game.watching);
    await expect(status(watcher, game)).not.toHaveText(WAIT_FOR_HOST);
    if (game.key === 'turdspades') await assertWatcherSpades(watcher);
    if (game.key === 'chess') {
        expect(fixture.view(game.watcherNick, game.key).deserializeAttachment().seat).toBeNull();
    }
    return { playerPages, watcher, pages: [host, ...playerPages, watcher] };
}

async function finishGame(fixture, game) {
    const record = await fixture.record(game.key);
    const saved = record[game.key];
    await fixture.act(game.resignNick, game.key, {
        action: 'resign',
        id: saved.id,
        revision: saved.match.revision ?? saved.match.state?.revision ?? 0
    });
}

async function auditGame(fixture, host, game) {
    const { playerPages, watcher, pages } = await seatedGame(fixture, host, game);
    const seatedPlayers = [host, ...playerPages].slice(0, game.seats);

    for (const page of pages) {
        await shot(page, game.label, `${page.viewportSize().width}-live`);
        await assertHumanStatus(page, game);
        await noHorizontalScroll(page);
    }
    await assertSingleTurnCue(seatedPlayers, game);
    for (const page of seatedPlayers) await assertPrimaryVisible(page, game);

    const reloadTarget = playerPages.at(-1);
    const nick = game.playerNicks.at(-1);
    const seatBefore = fixture.view(nick, game.key).deserializeAttachment().seat;
    await reloadTarget.reload();
    await expect(reloadTarget.locator('[data-nick]')).toHaveValue(nick);
    await enter(reloadTarget, nick);
    await expect(status(reloadTarget, game)).toHaveText(game.live.at(-1));
    await expect(reloadTarget.locator(game.board)).toBeVisible();
    await expect.poll(() => fixture.view(nick, game.key).deserializeAttachment().seat).toBe(seatBefore);
  await expect(panel(reloadTarget, game.status).locator('.arcade-reconnect')).toBeHidden();
    await shot(reloadTarget, game.label, 'after-reload');

    await finishGame(fixture, game);
    for (const page of [host, ...playerPages]) {
        await expect(status(page, game)).toHaveText(game.finished);
        const rematch = panel(page, game.status).getByRole('button', { name: game.rematch });
        await expect(rematch).toBeVisible();
        await expect(rematch).toBeInViewport();
        const box = await rematch.boundingBox();
        const phoneLayout = (page.viewportSize()?.width ?? PHONE.width) <= PHONE.width;
        if (phoneLayout) {
            expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
            expect(tapHeight(box)).toBeGreaterThanOrEqual(44);
        }
        await shot(page, game.label, 'game-over');
        await assertHumanStatus(page, game);
        await noHorizontalScroll(page);
    }
    await expect(panel(watcher, game.status).getByRole('button', { name: game.rematch })).toHaveCount(0);

    const close = host.getByRole('button', { name: game.close, exact: true });
    if (await close.isVisible()) await close.click();
}

test.describe.configure({ mode: 'serial' });
test.describe('family demo walkthrough audit', () => {
    for (const game of Object.values(GAMES)) {
        test(`${game.title}: phones, watcher, reload, game over`, async ({ browser, baseURL }) => {
            test.setTimeout(360_000);
            test.slow();
            const fixture = await gameNight(browser, baseURL);
            try {
                const host = await fixture.phone('DemoHost', { viewport: HOST });
                const start = host.getByRole('button', { name: /Game Night/ });
                if (!await start.isVisible()) await host.locator('.phonetabs [data-show="rooms"]').click();
                await start.click();
                await expect(host.getByRole('region', { name: /Game Night/ })).toBeVisible();
                await shot(host, 'lobby', `${game.label}-host-game-night-open`);
                await noHorizontalScroll(host);
                await auditGame(fixture, host, game);
                expect(fixture.errors()).toEqual([]);
            } finally {
                await fixture.close();
            }
        });
    }
});