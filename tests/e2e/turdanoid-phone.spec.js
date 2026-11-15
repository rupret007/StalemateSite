const { randomBytes, randomUUID } = require('node:crypto');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');
const LOBBY = '/r/45662413410ed051/lobby/';
const PREVIEW = 'local-preview-key-0001';
const PHONE = { width: 390, height: 844 };
const arcadeFeatures = { arcadeChess: 1, arcadeTurdSpades: 1, arcadeTurdanoid: 1 };
async function gameNight(browser, baseURL) {
    const { createLobby } = await import('../../hangout-worker/src/lobby-core.mjs');
    const { arcadeGame, arcadeRoomRequest, createArcadeTransport } = await import('../../hangout-worker/src/arcade-transport.mjs');
    const contexts = [], lobbySockets = new Map(), people = new Map(), matchSockets = [], departures = [], records = new Map(), harnessErrors = [];
    let at = 1800000000000, alarm = null, upgrading = null, queue = Promise.resolve();
    // A Durable Object handles one event at a time.
    const serial = task => {
        const run = queue.then(task);
        queue = run.catch(error => { harnessErrors.push(error.stack || error.message || String(error)); });
        return run;
    };
    const storage = {
        getAlarm: async () => alarm, setAlarm: async value => { alarm = value; },
        get: async key => structuredClone(records.get(key)),
        put: async (key, value) => { for (const [name, record] of typeof key === 'string' ? [[key, value]] : Object.entries(key)) records.set(name, structuredClone(record)); },
        delete: async key => { for (const name of [key].flat()) records.delete(name); },
        list: async ({ prefix = '', limit = Infinity } = {}) => new Map([...records].filter(([key]) => key.startsWith(prefix)).slice(0, limit))
    };
    const state = { storage, getWebSockets: () => matchSockets, acceptWebSocket: socket => { matchSockets.push(socket); } };
    const connection = id => [...people.values()].find(person => person.identity?.id === id);
    const engine = createLobby({ gameNight: true, now: () => at, limits: { defaultSlow: 0, roomPerDevice: 1 }, send: (id, frame) => {
        const person = connection(id);
        // lobby-do.mjs retires a match seat when its player parts the room.
        if (frame.t === 'part' && person) {
            const ref = engine.arcadeRoomRef(frame.ch, false);
            if (ref) departures.push({ scope: { room: frame.ch, ref }, subject: person.sid });
        }
        const sent = frame.t === 'hello' ? { ...frame, features: { ...frame.features, ...arcadeFeatures } } : frame;
        lobbySockets.get(id)?.send(JSON.stringify(sent));
    } });
    const names = ['chess', 'turdspades', 'turdanoid'];
    const transports = new Map(names.map(name => [name, createArcadeTransport({
        name, state,
        current: scope => {
            const person = connection(scope.actor);
            if (!person || !lobbySockets.has(scope.actor)) return null;
            const member = engine.arcadeActor(scope, false);
            return member ? { ...person.identity, ...member, socket: person } : null;
        },
        active: async () => true, charge: async () => true, allowed: () => true,
        approve: async actor => (await engine.approveArcade(actor))?.ok === true
    })]));
    // lobby-do.mjs reconcileArcade(): runs after every lobby event.
    async function reconcile() {
        for (const departure of departures.splice(0)) for (const transport of transports.values()) await transport.revoke(departure.scope, departure.subject);
        for (const transport of transports.values()) transport.reconcile();
    }
    // arcade-transport.mjs is written for workerd. The upgrade accepts this pair's
    // server end, then builds a 101 response that only workerd can construct.
    globalThis.WebSocketPair = class { constructor() { this[0] = {}; this[1] = upgrading; } };
    const retire = async (socket, transport) => {
        if (socket.readyState !== 1) return;
        const scope = socket.deserializeAttachment();
        socket.serializeAttachment({ ...scope, retired: true });
        socket.readyState = 3;
        await transport.presenceChanged(scope);
    };

    async function phone(nick, { viewport = PHONE } = {}) {
        const sid = randomUUID(), session = { betaSid: sid, betaInviteVersion: '1' };
        const person = { nick, sid, identity: null, matches: new Map() };
        people.set(nick, person);
        const context = await browser.newContext({ viewport, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
        contexts.push(context);
        await context.route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL).origin ? route.continue() : route.abort());
        await context.route(url => url.pathname === LOBBY, async route => {
            const response = await route.fetch();
            await route.fulfill({ response, body: (await response.text()).replace('<head>', '<head><script src="/beta/bootstrap.js"></script>') });
        });
        await context.route('**/beta/bootstrap.js', route => route.fulfill({ contentType: 'text/javascript', body: 'window.HangoutBootstrap={};' }));
        await context.route(url => /-ticket$/.test(url.pathname) && !!arcadeGame(url.pathname), async route => {
            const game = arcadeGame(new URL(route.request().url()).pathname), scope = arcadeRoomRequest(route.request().postDataJSON());
            if (!transports.has(game) || !scope) return route.fulfill({ status: 404, json: { error: 'not found' } });
            const response = await serial(() => transports.get(game).issue(scope, session));
            await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() });
        });
        const page = await context.newPage();
        person.page = page;
        person.frames = [];
        person.errors = [];
        page.on('pageerror', error => person.errors.push(error.message));
        await page.routeWebSocket(url => url.pathname.endsWith('/lobby'), socket => {
            const identity = { id: 'c' + randomBytes(16).toString('hex'), dev: `device-${nick}`, iph: `ip-${nick}`, role: 'fan', account: '', admin: false, ...session };
            person.identity = identity;
            lobbySockets.set(identity.id, socket);
            socket.onMessage(raw => { at += 5000; void serial(async () => { await engine.message(identity.id, String(raw)); await reconcile(); }); });
            socket.onClose(() => { lobbySockets.delete(identity.id); void serial(async () => { await engine.disconnect(identity.id); await reconcile(); }); });
            engine.connect(identity);
        });
        await page.routeWebSocket(url => /-match$/.test(url.pathname) && transports.has(arcadeGame(url.pathname)), route => {
            const game = arcadeGame(new URL(route.url()).pathname), transport = transports.get(game);
            let attachment = null;
            const socket = { readyState: 1, serializeAttachment: value => { attachment = value; }, deserializeAttachment: () => attachment,
                // Routed sockets do not emit page websocket events. These are the bytes the browser receives.
                send: raw => { if (socket.readyState !== 1) return; person.frames.push(String(raw)); route.send(raw); },
                close: (code = 1000, reason = '') => { if (socket.readyState !== 1) return; socket.readyState = 3; void route.close({ code, reason }); } };
            route.onMessage(raw => void serial(() => transport.receive(socket, String(raw))));
            route.onClose(() => void serial(() => retire(socket, transport)));
            void serial(async () => {
                upgrading = socket;
                try {
                    const refused = await transport.upgrade(route.protocols().join(', '), session);
                    socket.readyState = 3;
                    await route.close({ code: 1008, reason: `upgrade refused ${refused.status}` });
                } catch (error) {
                    if (!(error instanceof RangeError) || !matchSockets.includes(socket)) throw error;
                    person.matches.set(game, socket);
                } finally { upgrading = null; }
            });
        });
        await page.goto(`${LOBBY}?preview=${PREVIEW}&relay=${encodeURIComponent(hangoutRelayWsBase(baseURL, 'family-alpha-gate'))}`);
        await enter(page, nick);
        return page;
    }
    const table = name => transports.get(name);
    return {
        phone, people,
        // The live table as the server sees it for one phone.
        view: (nick, game) => people.get(nick).matches.get(game),
        // Send one match command as this phone's seat, exactly as its socket would.
        act: (nick, game, frame) => serial(() => table(game).receive(people.get(nick).matches.get(game), JSON.stringify({ version: 1, ...frame }))),
        // The network takes the match socket without a goodbye.
        dropMatch: (nick, game) => serial(async () => {
            const socket = people.get(nick).matches.get(game);
            const scope = socket.deserializeAttachment();
            socket.serializeAttachment({ ...scope, retired: true });
            socket.close(1012, 'Synthetic network loss');
            await table(game).presenceChanged(scope);
        }),
        // The network takes the lobby socket too.
        dropLobby: (nick, code = 1012) => serial(async () => {
            const { id } = people.get(nick).identity, socket = lobbySockets.get(id);
            lobbySockets.delete(id);
            await engine.disconnect(id);
            await socket.close({ code, reason: 'Synthetic network loss' });
            await reconcile();
        }),
        record: async game => [...(await storage.list({ prefix: game === 'chess' ? 'game-night-match:' : `game-night-${game}:` })).values()][0],
        errors: () => [...people.values()].flatMap(person => person.errors.map(error => `${person.nick}: ${error}`)),
        frames: nick => people.get(nick).frames,
        close: async () => {
            await serial(() => undefined);
            await Promise.all(contexts.map(context => context.close()));
            const errors = [...harnessErrors, ...[...people.values()].flatMap(person => person.errors.map(error => `${person.nick}: ${error}`))];
            expect(errors, 'harness callbacks and browser pages should not report errors').toEqual([]);
        }
    };
}

async function enter(page, nick) {
    const field = page.locator('[data-nick]');
    if (nick && await field.inputValue() !== nick) await field.fill(nick);
    await page.click('[data-enter]');
    await expect(page.locator('[data-connection]')).toHaveText('Connected');
}

// The host opens Game Night and each guest accepts a person-bound invitation.
async function room(fixture, nicks, viewport) {
    const pages = await Promise.all(nicks.map(nick => fixture.phone(nick, { viewport })));
    const [host, ...guests] = pages;
    const start = host.getByRole('button', { name: /Game Night/ });
    if (!await start.isVisible()) await host.locator('.phonetabs [data-show="rooms"]').click();
    await start.click();
    await expect(host.getByRole('region', { name: /Game Night/ })).toBeVisible();
    for (const [index, guest] of guests.entries()) await invite(host, guest, nicks[index + 1]);
    return pages;
}
async function invite(host, guest, nick) {
    await host.getByRole('button', { name: 'Invite players' }).click();
    await host.getByRole('button', { name: `Invite ${nick}`, exact: true }).click();
    await guest.locator('[data-game-offer]').getByRole('button', { name: 'Join Game Night' }).click();
    await expect(guest.getByRole('region', { name: /Game Night/ })).toBeVisible();
    if (await host.locator('[data-invite-dialog][open]').count()) await host.keyboard.press('Escape');
}

const game = {
    game: 'turdanoid', status: '[data-brick-status]', board: '[data-brick-match]',
    open: page => page.getByRole('button', { name: 'Open Turdanoid race' }).click(),
    join: page => page.getByRole('button', { name: 'Join Turdanoid race' }).click()
};
const showTable = async page => {
    const picker = page.getByRole('combobox', { name: 'Switch game' });
    await expect(picker.locator('option[value="turdanoid"]')).toBeEnabled();
    await picker.selectOption('turdanoid');
    await expect(page.locator(game.status)).toBeVisible();
};
async function openRace(fixture, viewport, { watcher = false } = {}) {
    const nicks = watcher ? ['RaceHost', 'RaceGuest', 'RaceWatcher'] : ['RaceHost', 'RaceGuest'];
    const pages = await room(fixture, nicks, viewport);
    const [host, guest, observer] = pages;
    for (const page of pages) await showTable(page);
    await game.open(host);
    await game.join(guest);
    await expect(host.locator(game.board)).toBeVisible();
    return { host, guest, observer };
}
async function inViewport(locator) {
    return locator.evaluate(node => {
        const r = node.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth;
    });
}
async function expectContained(page, selectors) {
    for (const selector of selectors) {
        const locator = page.locator(selector);
        await expect(locator).toBeVisible();
        expect(await inViewport(locator), `${selector} should fit in the viewport`).toBe(true);
    }
}
async function expectPanelContained(page, selectors) {
    const panel = page.locator('.arcade-brick-race');
    const bounds = await panel.evaluate(node => {
        const r = node.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, height: r.height, clientHeight: node.clientHeight, scrollHeight: node.scrollHeight };
    });
    expect(bounds.top, 'race panel should start within the viewport').toBeGreaterThanOrEqual(0);
    expect(bounds.bottom, 'race panel should end within the viewport').toBeLessThanOrEqual(await page.evaluate(() => innerHeight));
    expect(bounds.height, 'race panel should fit within the viewport height').toBeLessThanOrEqual(await page.evaluate(() => innerHeight));
    expect(bounds.scrollHeight, 'race panel content should not be clipped vertically').toBeLessThanOrEqual(bounds.clientHeight);
    for (const selector of selectors) {
        const locator = page.locator(selector);
        await expect(locator).toBeVisible();
        const contained = await locator.evaluate((node, panelBounds) => {
            const r = node.getBoundingClientRect();
            if (!(r.width > 0 && r.height > 0 && r.left >= panelBounds.left && r.right <= panelBounds.right && r.top >= panelBounds.top && r.bottom <= panelBounds.bottom)) return false;
            // Check each clipping ancestor, including the game panel itself.
            for (let parent = node.parentElement; parent; parent = parent.parentElement) {
                const style = getComputedStyle(parent);
                const clipX = /hidden|clip|auto|scroll/.test(style.overflowX);
                const clipY = /hidden|clip|auto|scroll/.test(style.overflowY);
                if (!clipX && !clipY) continue;
                const p = parent.getBoundingClientRect();
                if (clipX && (r.left < p.left || r.right > p.right)) return false;
                if (clipY && (r.top < p.top || r.bottom > p.bottom)) return false;
                if (parent.matches('.arcade-brick-race')) break;
            }
            return true;
        }, bounds);
        expect(contained, `${selector} should fit inside the race panel`).toBe(true);
    }
}
const phoneRaceParts = ['.brick-race-board', '.brick-race-rail', '[data-brick-score="a"]', '[data-brick-score="b"]', '[data-brick-serve]', '[data-brick-leave]'];
async function expectWatcherHasNoPrivateRace(fixture, observer) {
    await expect(observer.locator(game.board)).toBeHidden();
    await expect.poll(() => fixture.frames('RaceWatcher'), { timeout: 1500, intervals: [100, 250, 500] }).toEqual([]);
    await observer.waitForTimeout(400);
    expect(fixture.frames('RaceWatcher'), 'watcher must not receive race frames after the room settles').toEqual([]);
    const privateDom = await observer.locator('body').evaluate(body => {
        const match = body.querySelector('[data-brick-match]');
        const scores = [...body.querySelectorAll('[data-brick-score]')];
        const payloadNodes = [...body.querySelectorAll('[data-brick-hand], [data-brick-seat], [data-private-hand], [data-private-seat], [data-paddle], [data-stuck]')];
        return {
            boardHidden: !match || match.hidden,
            scoreText: scores.map(row => row.textContent.trim()),
            payloadNodes: payloadNodes.length,
            html: body.innerHTML
        };
    });
    expect(privateDom.boardHidden, 'watcher board must stay unavailable').toBe(true);
    expect(privateDom.scoreText.every(text => text === ''), 'watcher DOM must not contain private scores').toBe(true);
    expect(privateDom.payloadNodes, 'watcher DOM must not contain private hand, seat, or board state').toBe(0);
    expect(privateDom.html).not.toMatch(/private[-_ ]?hand|private[-_ ]?seat|"(?:hand|seat|paddle|score|players)"\s*:/i);
    expect(fixture.view('RaceWatcher', 'turdanoid')).toBeUndefined();
}
test.describe('Turdanoid phone and landscape layout', () => {
    test('390×844 private race fits, exposes controls, and supports touch', async ({ browser, baseURL }) => {
        const fixture = await gameNight(browser, baseURL);
        try {
            const { host: page, guest, observer } = await openRace(fixture, { width: 390, height: 844 }, { watcher: true });
            await expectContained(page, ['[data-brick-match]', ...phoneRaceParts, '[data-brick-status]', '[data-brick-back]']);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
            await expectPanelContained(page, ['[data-brick-match]', ...phoneRaceParts, '[data-brick-status]', '[data-brick-back]']);
            await expectContained(guest, ['[data-brick-match]', ...phoneRaceParts, '[data-brick-status]', '[data-brick-back]']);
            await expectPanelContained(guest, ['[data-brick-match]', ...phoneRaceParts, '[data-brick-status]', '[data-brick-back]']);
            expect(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
            await expect(observer.locator(game.status)).toBeVisible();
            await expectWatcherHasNoPrivateRace(fixture, observer);
            expect(await page.evaluate(() => navigator.maxTouchPoints)).toBeGreaterThan(0);
            const serve = page.locator('[data-brick-serve]');
            await expect(serve).toBeVisible();
            await expect(serve).toBeEnabled();
            await page.locator('[data-brick-serve]').tap();
            await expect(page.locator('[data-brick-match]')).toBeVisible();
            await expect(page.locator('[data-brick-match]')).toHaveAttribute('data-stuck', 'false');
            await expectContained(page, ['[data-brick-match]', ...phoneRaceParts, '[data-brick-status]', '[data-brick-back]']);
            await expectPanelContained(page, ['[data-brick-match]', ...phoneRaceParts, '[data-brick-status]', '[data-brick-back]']);
            await expectContained(guest, ['[data-brick-match]', ...phoneRaceParts, '[data-brick-status]', '[data-brick-back]']);
            await expectPanelContained(guest, ['[data-brick-match]', ...phoneRaceParts, '[data-brick-status]', '[data-brick-back]']);
            await page.locator('.brick-race-board').focus();
            await page.keyboard.press('ArrowLeft');
            await page.waitForTimeout(150);
            await expectWatcherHasNoPrivateRace(fixture, observer);
            expect(new URL(page.url()).pathname).toBe(LOBBY);
        } finally { await fixture.close(); }
    });

    test('844×390 private race keeps board, rail, launch, and scores in landscape', async ({ browser, baseURL }) => {
        const fixture = await gameNight(browser, baseURL);
        try {
            const { host: page, guest } = await openRace(fixture, { width: 844, height: 390 });
            await expect(page.locator('[data-brick-match]')).toBeVisible();
            const board = page.locator('.brick-race-board'), rail = page.locator('.brick-race-rail');
            await expectContained(page, ['.brick-race-board', '.brick-race-rail', '[data-brick-serve]', '[data-brick-score="a"]', '[data-brick-score="b"]']);
            const boardRight = await board.evaluate(node => { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? r.right : NaN; });
            const railLeft = await rail.evaluate(node => { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? r.left : NaN; });
            expect(boardRight).toBeLessThanOrEqual(railLeft);
            const metrics = await page.locator('.arcade-brick-race').evaluate(node => ({ scrollHeight: node.scrollHeight, clientHeight: node.clientHeight }));
            expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight);
            await expectPanelContained(page, ['.brick-race-board', '.brick-race-rail', '[data-brick-serve]', '[data-brick-score="a"]', '[data-brick-score="b"]']);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
            await expect(guest.locator(game.board)).toBeVisible();
            await expectContained(guest, ['.brick-race-board', '.brick-race-rail', '[data-brick-serve]', '[data-brick-score="a"]', '[data-brick-score="b"]']);
            const guestBoardRight = await guest.locator('.brick-race-board').evaluate(node => node.getBoundingClientRect().right);
            const guestRailLeft = await guest.locator('.brick-race-rail').evaluate(node => node.getBoundingClientRect().left);
            expect(guestBoardRight).toBeLessThanOrEqual(guestRailLeft);
            await expectPanelContained(guest, ['.brick-race-board', '.brick-race-rail', '[data-brick-serve]', '[data-brick-score="a"]', '[data-brick-score="b"]']);
            expect(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        } finally { await fixture.close(); }
    });
});
