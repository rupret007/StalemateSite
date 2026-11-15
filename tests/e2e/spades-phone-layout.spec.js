// Family-alpha acceptance: the four graded Game Night games must have no dead
// ends for a stranger on a phone (390x844).
//
// Real lobby client in real browsers, the production lobby engine
// (lobby-core.mjs) and the production match transport (arcade-transport.mjs,
// game-night-sockets.mjs, game-night-table.mjs and each game's rules). Only the
// Durable Object shell is synthetic: storage is an in-memory map, the page's
// WebSockets are routed to those engines in this process, and the protected
// shell marker is added the same way lobby-invitation-lifecycle.spec.js adds it.
// tests/runtime/arcade-transport.mjs runs the same code inside workerd.
const { randomBytes, randomUUID } = require('node:crypto');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const PHONE = { width: 390, height: 844 };
const LOBBY = '/r/45662413410ed051/lobby/';
const PREVIEW = 'local-preview-key-0001';
const WAIT_FOR_HOST = /wait(ing)? for (the )?host/i;
const arcadeFeatures = { arcadeChess: 1, arcadeTurdSpades: 1, arcadeTurdanoid: 1 };

async function gameNight(browser, baseURL) {
    const { createLobby } = await import('../../hangout-worker/src/lobby-core.mjs');
    const { arcadeGame, arcadeRoomRequest, createArcadeTransport } = await import('../../hangout-worker/src/arcade-transport.mjs');
    const contexts = [], lobbySockets = new Map(), people = new Map(), matchSockets = [], departures = [], records = new Map();
    let at = 1800000000000, alarm = null, upgrading = null, queue = Promise.resolve();
    // A Durable Object handles one event at a time.
    const serial = task => { const run = queue.then(task); queue = run.catch(() => {}); return run; };
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
        const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true });
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
        close: () => Promise.all(contexts.map(context => context.close()))
    };
}

async function enter(page, nick) {
    const field = page.locator('[data-nick]');
    if (nick && await field.inputValue() !== nick) await field.fill(nick);
    await page.click('[data-enter]');
    await expect(page.locator('[data-connection]')).toHaveText('Connected');
}

// The host opens Game Night and each guest accepts a person-bound invitation.
async function room(fixture, nicks) {
    const pages = await Promise.all(nicks.map(nick => fixture.phone(nick)));
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


const game = { game: 'turdspades', status: '[data-spades-status]', seats: 2, board: '[data-spades-table]' };
async function ready(fixture) {
    const nicks = ['HostExample', 'GuestWest'];
    const pages = await Promise.all(nicks.map(nick => fixture.phone(nick)));
    const [host, guest] = pages;
    const start = host.getByRole('button', { name: /Game Night/ });
    if (!await start.isVisible()) await host.locator('.phonetabs [data-show="rooms"]').click();
    await start.click();
    await expect(host.getByRole('region', { name: /Game Night/ })).toBeVisible();
    await invite(host, guest, nicks[1]);
    for (const page of pages) {
        await page.getByRole('combobox', { name: 'Switch game' }).selectOption('turdspades');
        await expect(page.locator(game.status)).toBeVisible();
    }
    await host.getByRole('button', { name: 'Open 2-player Spades' }).click();
    await guest.getByRole('button', { name: 'Join West' }).click();
    for (const page of pages) {
        await expect(page.locator(game.board)).toBeVisible();
        await expect(page.locator('[data-spades-card]')).toHaveCount(13);
    }
    return pages;
}
async function boxAtLeast44(locator) {
    await expect(locator).toBeVisible();
    await expect(locator).toBeInViewport();
    const box = await locator.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect(box?.y).toBeGreaterThanOrEqual(0);
    expect(box && box.x + box.width).toBeLessThanOrEqual(PHONE.width);
    expect(box && box.y + box.height).toBeLessThanOrEqual(PHONE.height);
}

test('Chess and Turdanoid reach their playable boards on phones', async ({ browser, baseURL }) => {
    for (const entry of [
        { game: 'chess', status: '[data-chess-status]', board: '.arcade-chess-board', open: 'Open Chess match', join: 'Join as Black' },
        { game: 'turdanoid', status: '[data-brick-status]', board: '[data-brick-match]', open: 'Open Turdanoid race', join: 'Join Turdanoid race' }
    ]) {
        const fixture = await gameNight(browser, baseURL);
        try {
            const [host, guest] = await room(fixture, ['HostExample', 'GuestWest']);
            for (const page of [host, guest]) {
                await page.getByRole('combobox', { name: 'Switch game' }).selectOption(entry.game);
                await expect(page.locator(entry.status)).toBeVisible();
            }
            await host.getByRole('button', { name: entry.open, exact: true }).click();
            await guest.getByRole('button', { name: entry.join, exact: true }).click();
            for (const page of [host, guest]) await expect(page.locator(entry.board)).toBeVisible();
            expect(fixture.errors()).toEqual([]);
        } finally { await fixture.close(); }
    }
});
async function noHorizontalOverflow(page) {
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => window.innerWidth)).toBe(390);
}

test.describe('partners Spades at 390×844', () => {
    test.beforeEach(() => test.slow());
    test('bid, play, reconnect, rematch and watcher privacy fit the phone', async ({ browser, baseURL }) => {
        const fixture = await gameNight(browser, baseURL);
        try {
            const [host, west] = await ready(fixture);
            for (const page of [host, west]) await noHorizontalOverflow(page);
            const bid = west.getByRole('button', { name: 'Bid for me', exact: true });
            await boxAtLeast44(bid);
            await west.getByLabel('Your bid').selectOption('0');
            const bidBeforeReconnect = await west.getByLabel('Your bid').inputValue();
            const handBeforeReconnect = await west.locator('[data-spades-card]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-spades-card')));
            const lock = west.getByRole('button', { name: 'Lock bid', exact: true });
            await boxAtLeast44(lock);

            const reconnect = west.locator('.arcade-spades .arcade-reconnect');
            await expect(reconnect).toHaveCount(1);
            await west.context().setOffline(true);
            await expect(reconnect).toBeVisible();
            await expect(reconnect).toHaveText('Reconnecting…');
            const pillBox = await reconnect.boundingBox();
            const primaryBox = await lock.boundingBox();
            expect(pillBox && primaryBox && (pillBox.x + pillBox.width <= primaryBox.x || primaryBox.x + primaryBox.width <= pillBox.x || pillBox.y + pillBox.height <= primaryBox.y || primaryBox.y + primaryBox.height <= pillBox.y)).toBeTruthy();
            await noHorizontalOverflow(west);
            await west.context().setOffline(false);
            await expect(reconnect).toBeHidden();
            await expect(west.locator('[data-spades-card]')).toHaveCount(13);
            await expect(west.getByLabel('Your bid')).toHaveValue(bidBeforeReconnect);
            await expect.poll(() => west.locator('[data-spades-card]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-spades-card')))).toEqual(handBeforeReconnect);
            await west.getByRole('button', { name: 'Lock bid', exact: true }).click();
            await host.getByRole('button', { name: 'Bid for me', exact: true }).click();
            await expect(west.locator('[data-spades-status]')).toContainText('Your turn');
            const card = west.locator('[data-spades-card]:enabled').first();
            await boxAtLeast44(card);
            await card.click();
            await expect(west.locator('[data-spades-card]')).toHaveCount(12);
            await noHorizontalOverflow(west);

            const privateIds = await west.locator('[data-spades-card]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-spades-card')));
            await west.locator('[data-spades-action="resign"]').click();
            await west.getByRole('dialog', { name: 'Resign for your team?' }).getByRole('button', { name: 'Resign', exact: true }).click();
            await expect(west.locator('[data-spades-status]')).toContainText('win by resignation');
            const rematch = west.getByRole('button', { name: 'Request Spades rematch' });
            await boxAtLeast44(rematch);
            await noHorizontalOverflow(west);
            await rematch.click();
            const acceptRematch = host.getByRole('button', { name: 'Accept Spades rematch' });
            await expect(acceptRematch).toBeVisible();
            await acceptRematch.click();
            await expect(west.locator('[data-spades-status]')).not.toContainText('win by resignation');
            await expect(west.locator('[data-spades-card]')).toHaveCount(13);
            await expect(west.getByLabel('Your bid')).toBeEnabled();
            await expect(west.getByRole('button', { name: 'Bid for me', exact: true })).toBeEnabled();
            privateIds.push(...await west.locator('[data-spades-card]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-spades-card'))));

            // Join the queued watcher after rematch so the two-seat table
            // cannot admit it into West's seat before privacy assertions.
            const watcher = await fixture.phone('LateWatcher');
            await invite(host, watcher, 'LateWatcher');
            await watcher.getByRole('combobox', { name: 'Switch game' }).selectOption('turdspades');
            await expect(watcher.locator('[data-spades-table]')).toBeVisible();
            await expect(watcher.locator('[data-spades-seat]')).toHaveText('Watching · hands are private');
            await expect(watcher.locator('[data-spades-hand] button')).toHaveCount(0);
            await expect(watcher.locator('[data-spades-card]')).toHaveCount(0);
            const watcherDom = await watcher.locator('body').evaluate(node => ({
                text: node.innerText,
                attributes: [...node.querySelectorAll('*')].flatMap(element => [...element.attributes].map(attribute => attribute.value))
            }));
            const watcherFrames = fixture.frames('LateWatcher').map(raw => JSON.parse(raw));
            const handsIn = value => Array.isArray(value) ? value.flatMap(handsIn) : value && typeof value === 'object'
                ? Object.entries(value).flatMap(([key, child]) => key.toLowerCase() === 'hand' ? [child] : handsIn(child)) : [];
            expect(watcherFrames.length).toBeGreaterThan(0);
            const watcherHands = watcherFrames.flatMap(handsIn);
            expect(watcherHands.length).toBeGreaterThan(0);
            for (const hand of watcherHands) expect(hand).toEqual([]);
            for (const id of privateIds) {
                expect(watcherDom.attributes).not.toContain(id);
                expect(watcherDom.text).not.toContain(id);
            }
            await noHorizontalOverflow(watcher);
            expect(fixture.errors()).toEqual([]);
        } finally { await fixture.close(); }
    });
});

test.describe('four-player Spades at 390×844', () => {
    test.beforeEach(() => test.slow());
    test('bidding and play fit the phone and a watcher never sees cards', async ({ browser, baseURL }) => {
        const fixture = await gameNight(browser, baseURL);
        try {
            const nicks = ['HostExample', 'GuestWest', 'GuestNorth', 'GuestEast'];
            const pages = await room(fixture, nicks);
            const [south, west, north, east] = pages;
            for (const page of pages) {
                await page.getByRole('combobox', { name: 'Switch game' }).selectOption('turdspades');
                await expect(page.locator('[data-spades-status]')).toBeVisible();
            }
            await south.getByRole('button', { name: 'Open 4-player Spades', exact: true }).click();
            for (const [index, [page, seat]] of [[west, 'West'], [north, 'North'], [east, 'East']].entries()) {
                await page.getByRole('button', { name: `Join ${seat}`, exact: true }).click();
                if (index < 2) await expect(south.locator('[data-spades-status]')).toContainText(`${index + 2}/4 seated`);
            }
            for (const page of pages) {
                await expect(page.locator('[data-spades-table]')).toBeVisible();
                await expect(page.locator('[data-spades-card]')).toHaveCount(13);
                await noHorizontalOverflow(page);
            }

            await expect(west.locator('[data-spades-status]')).toHaveText('Round 1 · Your bid · tap Bid for me');
            await expect(south.locator('[data-spades-trick-summary]')).toHaveText('Bids · no cards played yet');
            const bid = west.getByRole('button', { name: 'Bid for me', exact: true });
            await boxAtLeast44(bid);

            // South deals. Bidding starts with West, then North, East, and
            // South; West leads the first trick.
            await bid.click();
            for (const page of [north, east, south]) {
                const bidForMe = page.getByRole('button', { name: 'Bid for me', exact: true });
                await expect(bidForMe).toBeVisible();
                await bidForMe.click();
            }
            await expect(west.locator('[data-spades-status]')).toHaveText('Round 1 · Your turn · tap a card');
            await expect(west.locator('[data-spades-trick-summary]')).not.toHaveText('Bids · no cards played yet');
            const card = west.locator('[data-spades-card]:enabled').first();
            await boxAtLeast44(card);
            await card.click();
            await expect(west.locator('[data-spades-card]')).toHaveCount(12);

            const watcher = await fixture.phone('LateWatcher');
            await invite(south, watcher, 'LateWatcher');
            await watcher.getByRole('combobox', { name: 'Switch game' }).selectOption('turdspades');
            await expect(watcher.locator('[data-spades-table]')).toBeVisible();
            await expect(watcher.locator('[data-spades-seat]')).toHaveText('Watching · hands are private');
            await expect(watcher.locator('[data-spades-hand] button')).toHaveCount(0);
            await expect(watcher.locator('[data-spades-card]')).toHaveCount(0);
            const watcherFrames = fixture.frames('LateWatcher').map(raw => JSON.parse(raw));
            const handsIn = value => Array.isArray(value) ? value.flatMap(handsIn) : value && typeof value === 'object'
                ? Object.entries(value).flatMap(([key, child]) => key.toLowerCase() === 'hand' ? [child] : handsIn(child)) : [];
            expect(watcherFrames.length).toBeGreaterThan(0);
            const watcherHands = watcherFrames.flatMap(handsIn);
            expect(watcherHands.length).toBeGreaterThan(0);
            for (const hand of watcherHands) expect(hand).toEqual([]);
            await noHorizontalOverflow(watcher);
            expect(fixture.errors()).toEqual([]);
        } finally { await fixture.close(); }
    });
});
