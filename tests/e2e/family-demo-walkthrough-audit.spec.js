// Family demo walkthrough audit: desktop Game Night host (1440×900) plus phone
// players and watchers (390×844, touch, mobile) across the four graded games.
// Reuses the chess-phone-fixture harness. Screenshots land under test-results/
// as game-page-role so one phone cannot overwrite another.
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
const WALL_NAME = /^(Fresh Tiles|Rainbow Rows|Ripple)$/;
const WAITING_COPY = /Waiting for an opponent\.|Waiting for a second player\.|Black is open\. Join to play\.|An opponent is ready\.|Watching · [\w ]+ to move|(?:^|· )(?:You’re [\w]+ · )?(?:[\w]+(?: \(CPU\))? to (?:move|bid|play))|\d+\/\d+ seated · .+/;
const TURN_COPY = /Your (?:turn|bid)(?: · tap (?:Bid for me|Lock bid|a card))?/;
const RESULT_COPY = /^(?:White|Black) wins · Resignation$|^Game over · (?:South \+ North(?: CPU)?|West \+ East(?: CPU)?) win by resignation\.(?: \d+\/\d+ ready for a rematch\. Tap (?:Start now to play again|Request Spades rematch)\.)?$|^(?:You win|Rival wins|Player [12] wins) · forfeit$/;
const PILL_COPY = 'Reconnecting…';
const RECOVERY = {
    chess: [
        'Connecting to Chess…',
        'Reconnecting to Chess…',
        'Reconnecting to Chess… The clocks keep running.'
    ],
    turdspades: [
        'Connecting to the table…',
        'Reconnecting to the table…',
        'Reconnecting to the table… Your hand is paused.'
    ],
    turdanoid: [
        'Connecting to the race…',
        'Reconnecting to the race…',
        'Reconnecting · race clock keeps running'
    ]
};
const writtenShots = new Set();

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
        waiting: {
            host: 'You’re White · Waiting for an opponent.',
            other: 'Black is open. Join to play.'
        },
        live: {
            host: 'You’re White · Your turn',
            players: ['You’re Black · White to move'],
            watcher: 'Watching · White to move'
        },
        finished: {
            host: 'White wins · Resignation',
            player: 'White wins · Resignation',
            watcher: 'White wins · Resignation'
        },
        recovery: RECOVERY.chess,
        rematch: 'Request rematch',
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
        waiting: {
            host: '1/2 seated · You’re South · South + North CPU vs West + East CPU',
            other: '1/2 seated · South + North CPU vs West + East CPU'
        },
        live: {
            host: 'Round 1 · West to bid',
            players: ['Round 1 · Your bid · tap Bid for me'],
            watcher: 'Round 1 · West to bid'
        },
        finished: {
            host: 'Game over · South + North CPU win by resignation. 0/2 ready for a rematch. Tap Start now to play again.',
            player: 'Game over · South + North CPU win by resignation. 0/2 ready for a rematch. Tap Request Spades rematch.',
            watcher: 'Game over · South + North CPU win by resignation.'
        },
        recovery: RECOVERY.turdspades,
        rematch: 'Request Spades rematch',
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
        waiting: {
            host: '1/4 seated · You’re South · South + North vs West + East',
            other: '1/4 seated · South + North vs West + East'
        },
        live: {
            host: 'Round 1 · West to bid',
            players: [
                'Round 1 · Your bid · tap Bid for me',
                'Round 1 · West to bid',
                'Round 1 · West to bid'
            ],
            watcher: 'Round 1 · West to bid'
        },
        finished: {
            host: 'Game over · South + North win by resignation. 0/4 ready for a rematch. Tap Start now to play again.',
            player: 'Game over · South + North win by resignation. 0/4 ready for a rematch. Tap Request Spades rematch.',
            watcher: 'Game over · South + North win by resignation.'
        },
        recovery: RECOVERY.turdspades,
        rematch: 'Request Spades rematch',
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
        waiting: {
            host: 'Waiting for a second player.',
            other: 'An opponent is ready.'
        },
        live: {
            host: null,
            players: [null],
            watcher: null
        },
        finished: {
            host: 'You win · forfeit',
            player: 'Rival wins · forfeit',
            watcher: 'Player 1 wins · forfeit'
        },
        recovery: RECOVERY.turdanoid,
        rematch: 'Request Turdanoid rematch',
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

function liveKind(game, line) {
    if (game.key === 'turdanoid') return 'race';
    return /Your (?:turn|bid)/.test(line) ? 'turn' : 'waiting';
}

function seatedCopy(game, wall) {
    if (game.key === 'turdanoid') return Array(game.seats).fill(wall);
    return [game.live.host, ...game.live.players];
}

async function showTable(page, game) {
    const picker = page.getByRole('combobox', { name: 'Switch game' });
    const option = picker.locator(`option[value="${game.key}"]`);
    await expect(option).toBeEnabled();
    await picker.selectOption(game.key);
    await expect(status(page, game)).toBeVisible();
}

async function shot(page, gameLabel, pageName, role) {
    const safe = `${gameLabel}-${pageName}-${role}`.replace(/[^\w.-]+/g, '-').slice(0, 120);
    const file = path.join(SHOT_DIR, `${safe}.png`);
    expect(writtenShots.has(file), `screenshot name collided: ${safe}.png`).toBe(false);
    writtenShots.add(file);
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
    return file;
}

async function noHorizontalScroll(page) {
    const width = page.viewportSize()?.width ?? PHONE.width;
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
}

async function readStatus(page, game) {
    return (await status(page, game).innerText()).replace(/\s+/g, ' ').trim();
}

async function assertHumanStatus(page, game, expected, kind) {
    const node = status(page, game);
    await expect(node).toBeVisible();
    await expect(node).toHaveText(expected);
    const text = await readStatus(page, game);
    expect(text).toBe(expected);
    expect(text.length).toBeGreaterThan(2);
    expect(text).not.toMatch(RAW_OR_BLANK);
    expect(text).not.toMatch(/^Waiting for the host to open/i);
    if (kind === 'waiting') {
        const waiting = text.match(WAITING_COPY);
        expect(waiting, `waiting copy was not read from "${text}"`).not.toBeNull();
        expect(text).toContain(waiting[0].trim());
        expect(text).not.toMatch(/Your (?:turn|bid)/);
    } else if (kind === 'turn') {
        const turn = text.match(TURN_COPY);
        expect(turn, `turn copy was not read from "${text}"`).not.toBeNull();
        expect(turn[0].length).toBeGreaterThan('Your bid'.length - 1);
        expect(text).toContain(turn[0]);
    } else if (kind === 'finished') {
        expect(text).toMatch(RESULT_COPY);
        expect(RESULT_COPY.exec(text)[0]).toBe(text);
        expect(text).not.toMatch(/^(?:forfeit|wins · | win by resignation\.)$/);
        expect(text).not.toMatch(/Your (?:turn|bid)/);
    } else if (kind === 'race') {
        expect(text).toMatch(WALL_NAME);
        expect(text).not.toMatch(/Your (?:turn|bid)|Waiting for the host/);
    } else {
        throw new Error(`unknown status kind ${kind}`);
    }
}

async function assertSingleTurnCue(playerPages, game, expectedLines) {
    const lines = [];
    for (const page of playerPages) lines.push(await readStatus(page, game));
    expect(lines[0], `${game.title} host cue`).toBe(expectedLines[0]);
    expect(lines, `${game.title} seat status`).toEqual(expectedLines);
    if (game.key === 'turdanoid') {
        expect(lines).toHaveLength(game.seats);
        expect(new Set(lines).size, 'Turdanoid phones must show the same wall').toBe(1);
        expect(lines[0]).toMatch(WALL_NAME);
        for (const line of lines) expect(line).not.toMatch(/Your (?:turn|bid)/);
        return;
    }
    const turn = lines.filter(line => /Your (?:turn|bid)/.test(line));
    const waiting = lines.filter(line => !/Your (?:turn|bid)/.test(line));
    expect(turn, `${game.title} needs one visible turn or bid cue`).toHaveLength(1);
    expect(waiting).toHaveLength(lines.length - 1);
    for (const line of waiting) {
        expect(line).toMatch(WAITING_COPY);
        expect(line).not.toMatch(/Your (?:turn|bid)/);
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

async function armRecoveryLog(page) {
    await page.addInitScript(() => {
        const seen = [];
        let observer;
        const push = (kind, text, visible) => {
            const value = String(text || '').replace(/\s+/g, ' ').trim();
            if (!value || seen.length >= 100) return;
            const last = seen[seen.length - 1];
            if (last && last.kind === kind && last.text === value && last.visible === visible) return;
            seen.push({ kind, text: value, visible });
        };
        const shown = node => {
            if (!node || node.nodeType !== 1) return false;
            for (let el = node; el; el = el.parentElement) {
                if (el.hidden) return false;
                if (el.tagName === 'DETAILS' && !el.open) return false;
            }
            const style = getComputedStyle(node);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            return node.getClientRects().length > 0;
        };
        const scan = () => {
            for (const node of document.querySelectorAll('[data-chess-status], [data-spades-status], [data-brick-status]')) {
                push('status', node.textContent, shown(node));
            }
            for (const node of document.querySelectorAll('.arcade-reconnect')) {
                push('pill', node.textContent, shown(node));
            }
            const connection = document.querySelector('[data-connection]');
            if (connection) push('connection', connection.textContent, shown(connection));
        };
        const boot = () => {
            scan();
            observer = new MutationObserver(() => scan());
            observer.observe(document.documentElement, {
                subtree: true,
                childList: true,
                characterData: true,
                attributes: true,
                attributeFilter: ['hidden', 'open']
            });
        };
        window.__familyDemoRecovery = seen;
        window.__familyDemoRecoveryStop = () => { if (observer) observer.disconnect(); };
        if (document.documentElement) boot();
        else document.addEventListener('DOMContentLoaded', boot, { once: true });
    });
}

function assertRecoveryObserved(seen, game) {
    const entries = Array.isArray(seen) ? seen : [];
    const visibleStatus = entries.filter(entry => entry.visible && entry.kind === 'status' && game.recovery.includes(entry.text));
    const visiblePills = entries.filter(entry => entry.visible && entry.kind === 'pill');
    const proof = visibleStatus.length + visiblePills.filter(entry => entry.text === PILL_COPY).length;
    expect(proof, `reload never showed reconnect or connecting copy: ${JSON.stringify(entries)}`).toBeGreaterThan(0);
    for (const entry of visiblePills) expect(entry.text).toBe(PILL_COPY);
    for (const entry of visibleStatus) expect(game.recovery).toContain(entry.text);
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
    const waitingPages = [
        [host, 'host', game.waiting.host],
        ...playerPages.map((page, index) => [page, game.playerNicks[index], game.waiting.other]),
        [watcher, game.watcherNick, game.waiting.other]
    ];
    for (const [page, role, expected] of waitingPages) {
        await assertHumanStatus(page, game, expected, 'waiting');
        await shot(page, game.label, 'waiting', role);
    }
    for (const [index, guest] of playerPages.entries()) await game.join(guest, index);

    let wall = '';
    if (game.key === 'turdanoid') {
        await expect(host.locator(game.board)).toBeVisible();
        await expect(status(host, game)).toHaveText(WALL_NAME);
        wall = await readStatus(host, game);
        expect(wall).toMatch(WALL_NAME);
    }
    const lines = seatedCopy(game, wall);
    for (const [index, page] of [host, ...playerPages].slice(0, game.seats).entries()) {
        await expect(page.locator(game.board)).toBeVisible();
        await assertHumanStatus(page, game, lines[index], liveKind(game, lines[index]));
    }
    const watching = game.key === 'turdanoid' ? wall : game.live.watcher;
    await expect(watcher.locator(game.board)).toBeVisible();
    await assertHumanStatus(watcher, game, watching, liveKind(game, watching));
    expect(watching).not.toMatch(WAIT_FOR_HOST);
    if (game.key === 'turdspades') await assertWatcherSpades(watcher);
    if (game.key === 'chess') {
        expect(fixture.view(game.watcherNick, game.key).deserializeAttachment().seat).toBeNull();
    }
    return { playerPages, watcher, pages: [host, ...playerPages, watcher], lines, watching };
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
    const { playerPages, watcher, pages, lines, watching } = await seatedGame(fixture, host, game);
    const seatedPlayers = [host, ...playerPages].slice(0, game.seats);
    const roles = ['host', ...game.playerNicks, game.watcherNick];
    const liveExpected = [...lines, watching];

    for (const [index, page] of pages.entries()) {
        await assertHumanStatus(page, game, liveExpected[index], liveKind(game, liveExpected[index]));
        await shot(page, game.label, 'live', roles[index]);
        await noHorizontalScroll(page);
    }
    await assertSingleTurnCue(seatedPlayers, game, lines);
    for (const page of seatedPlayers) await assertPrimaryVisible(page, game);

    const reloadTarget = playerPages.at(-1);
    const nick = game.playerNicks.at(-1);
    const seatBefore = fixture.view(nick, game.key).deserializeAttachment().seat;
    await armRecoveryLog(reloadTarget);
    await reloadTarget.reload();
    await expect(reloadTarget.locator('[data-nick]')).toHaveValue(nick);
    await enter(reloadTarget, nick);
    const restored = lines.at(-1);
    await assertHumanStatus(reloadTarget, game, restored, liveKind(game, restored));
    await expect(reloadTarget.locator(game.board)).toBeVisible();
    await expect.poll(() => fixture.view(nick, game.key).deserializeAttachment().seat).toBe(seatBefore);
    const seen = await reloadTarget.evaluate(() => {
        const log = window.__familyDemoRecovery || null;
        if (window.__familyDemoRecoveryStop) window.__familyDemoRecoveryStop();
        return log;
    });
    assertRecoveryObserved(seen, game);
    await expect(panel(reloadTarget, game.status).locator('.arcade-reconnect')).toBeHidden();
    await shot(reloadTarget, game.label, 'after-reload', nick);

    await finishGame(fixture, game);
    for (const [index, page] of [host, ...playerPages].entries()) {
        const expected = index === 0 ? game.finished.host : game.finished.player;
        const role = index === 0 ? 'host' : game.playerNicks[index - 1];
        await assertHumanStatus(page, game, expected, 'finished');
        const rematch = panel(page, game.status).getByRole('button', { name: game.rematch, exact: true });
        await expect(rematch).toBeVisible();
        await expect(rematch).toBeInViewport();
        await expect(rematch).toHaveText(game.rematch);
        const box = await rematch.boundingBox();
        const phoneLayout = (page.viewportSize()?.width ?? PHONE.width) <= PHONE.width;
        if (phoneLayout) {
            expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
            expect(tapHeight(box)).toBeGreaterThanOrEqual(44);
        }
        await shot(page, game.label, 'game-over', role);
        await noHorizontalScroll(page);
    }
    if (game.key === 'turdspades') await assertWatcherSpades(watcher);
    await assertHumanStatus(watcher, game, game.finished.watcher, 'finished');
    await shot(watcher, game.label, 'game-over', game.watcherNick);
    await expect(panel(watcher, game.status).getByRole('button', { name: game.rematch, exact: true })).toHaveCount(0);

    const close = host.getByRole('button', { name: game.close, exact: true });
    if (await close.isVisible()) await close.click();
}

test.describe.configure({ mode: 'serial' });
test.describe('family demo walkthrough audit', () => {
    test.beforeAll(() => {
        writtenShots.clear();
        fs.rmSync(SHOT_DIR, { recursive: true, force: true });
    });

    for (const game of Object.values(GAMES)) {
        test(`${game.title}: phones, watcher, reload, game over`, async ({ browser, baseURL }) => {
            test.setTimeout(360_000);
            test.slow();
            const shotPrefix = path.join(SHOT_DIR, `${game.label}-`);
            for (const file of [...writtenShots]) {
                if (file.startsWith(shotPrefix)) writtenShots.delete(file);
            }
            const fixture = await gameNight(browser, baseURL);
            try {
                const host = await fixture.phone('DemoHost', { viewport: HOST });
                const start = host.getByRole('button', { name: /Game Night/ });
                if (!await start.isVisible()) await host.locator('.phonetabs [data-show="rooms"]').click();
                await start.click();
                await expect(host.getByRole('region', { name: /Game Night/ })).toBeVisible();
                await shot(host, game.label, 'lobby', 'host');
                await noHorizontalScroll(host);
                await auditGame(fixture, host, game);
                expect(fixture.errors()).toEqual([]);
            } finally {
                await fixture.close();
            }
        });
    }
});
