// Game Night reconnect-to-seat on 390×844 phones (private StalemateSite family demo).
// Reuses shared harness patterns from family-alpha-gate and chess-phone-fixture when
// present; hangout-reconnect-state-style offline/online recovery for match sockets.
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const PHONE = { width: 390, height: 844 };
const LOBBY = '/r/45662413410ed051/lobby/';
const PREVIEW = 'local-preview-key-0001';
const arcadeFeatures = { arcadeChess: 1, arcadeTurdSpades: 1, arcadeTurdanoid: 1 };

const chessFixturePath = path.join(__dirname, 'chess-phone-fixture.js');
const sharedFixture = fs.existsSync(chessFixturePath) ? require(chessFixturePath) : null;

async function enter(page, nick) {
    const field = page.locator('[data-nick]');
    if (nick && await field.inputValue() !== nick) await field.fill(nick);
    await page.click('[data-enter]');
    await expect(page.locator('[data-connection]')).toHaveText('Connected');
}

async function gameNight(browser, baseURL) {
    if (sharedFixture) return sharedFixture.gameNight(browser, baseURL);
    const { createLobby } = await import('../../hangout-worker/src/lobby-core.mjs');
    const { arcadeGame, arcadeRoomRequest, createArcadeTransport } = await import('../../hangout-worker/src/arcade-transport.mjs');
    const contexts = [], lobbySockets = new Map(), people = new Map(), matchSockets = [], departures = [], records = new Map();
    let at = 1800000000000, alarm = null, upgrading = null, queue = Promise.resolve();
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
    async function reconcile() {
        for (const departure of departures.splice(0)) for (const transport of transports.values()) await transport.revoke(departure.scope, departure.subject);
        for (const transport of transports.values()) transport.reconcile();
    }
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
        const person = { nick, sid, identity: null, matches: new Map(), matchFrames: [] };
        people.set(nick, person);
        const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
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
                send: raw => {
                    if (socket.readyState !== 1) return;
                    route.send(raw);
                    person.matchFrames.push(String(raw));
                },
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
        await page.goto(`${LOBBY}?preview=${PREVIEW}&relay=${encodeURIComponent(hangoutRelayWsBase(baseURL, 'reconnect-seat-phone'))}`);
        await enter(page, nick);
        return page;
    }
  return {
        phone, people,
        view: (nick, game) => people.get(nick).matches.get(game),
        act: (nick, game, frame) => serial(() => transports.get(game).receive(people.get(nick).matches.get(game), JSON.stringify({ version: 1, ...frame }))),
        dropMatch: (nick, game) => serial(async () => {
            const socket = people.get(nick).matches.get(game);
            const scope = socket.deserializeAttachment();
            socket.serializeAttachment({ ...scope, retired: true });
            socket.close(1012, 'Synthetic network loss');
            await transports.get(game).presenceChanged(scope);
        }),
        close: () => Promise.all(contexts.map(context => context.close())),
        errors: () => [...people.values()].flatMap(person => person.errors.map(error => `${person.nick}: ${error}`))
    };
}

async function room(fixture, nicks) {
    if (sharedFixture) return sharedFixture.room(fixture, nicks);
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
    if (sharedFixture?.invite) return sharedFixture.invite(host, guest, nick);
    await host.getByRole('button', { name: 'Invite players' }).click();
    await host.getByRole('button', { name: `Invite ${nick}`, exact: true }).click();
    await guest.locator('[data-game-offer]').getByRole('button', { name: 'Join Game Night' }).click();
    await expect(guest.getByRole('region', { name: /Game Night/ })).toBeVisible();
    if (await host.locator('[data-invite-dialog][open]').count()) await host.keyboard.press('Escape');
}

const GAMES = {
    chess: {
        label: 'Chess', game: 'chess', status: '[data-chess-status]', seats: 2,
        open: host => host.getByRole('button', { name: 'Open Chess match' }).click(),
        join: guest => guest.getByRole('button', { name: 'Join as Black' }).click(),
        live: [/^You’re White · Your turn/, /^You’re Black · White to move/, /^You’re Black · Your turn/],
        board: '.arcade-chess-board'
    },
    partners: {
        label: 'partners Spades', game: 'turdspades', status: '[data-spades-status]', seats: 2,
        open: host => host.getByRole('button', { name: 'Open 2-player Spades' }).click(),
        join: guest => guest.getByRole('button', { name: 'Join West' }).click(),
        live: [/computer partner|Round 1/, /computer partner|Waiting for the host to bid|Round 1/],
        board: '[data-spades-table]'
    },
    four: {
        label: 'four-player Spades', game: 'turdspades', status: '[data-spades-status]', seats: 4,
        open: host => host.getByRole('button', { name: 'Open 4-player Spades' }).click(),
        join: (guest, index) => guest.getByRole('button', { name: `Join ${['West', 'North', 'East'][index]}` }).click(),
        live: [/^Round 1 · /, /^Round 1 · /, /^Round 1 · /, /^Round 1 · /],
        board: '[data-spades-table]'
    },
    turdanoid: {
        label: 'Turdanoid', game: 'turdanoid', status: '[data-brick-status]', seats: 2,
        open: host => host.getByRole('button', { name: 'Open Turdanoid race' }).click(),
        join: guest => guest.getByRole('button', { name: 'Join Turdanoid race' }).click(),
        live: [/\S/, /\S/],
        board: '[data-brick-match]'
    }
};

const status = (page, game) => page.locator(game.status);
const panel = (page, game) => page.locator('details', { has: page.locator(game.status) });
const showTable = async (page, game) => {
    const picker = page.getByRole('combobox', { name: 'Switch game' });
    await expect(picker.locator(`option[value="${game.game}"]`)).toBeEnabled();
    await picker.selectOption(game.game);
    await expect(status(page, game)).toBeVisible();
};

async function seated(fixture, game, nicks) {
    const pages = await room(fixture, nicks);
    await Promise.all(pages.map(page => showTable(page, game)));
    await game.open(pages[0]);
    for (const [index, guest] of pages.slice(1, game.seats).entries()) await game.join(guest, index);
    for (const page of pages.slice(0, game.seats)) await expect(page.locator(game.board)).toBeVisible();
    return pages;
}

async function midMatch(game, pages) {
    const host = pages[0], guest = pages.at(-1);
    if (game.game === 'chess') {
        if (await status(host, game).textContent().then(text => /Your turn/.test(text))) {
            await host.locator('[data-square="e2"]').tap();
            await host.locator('[data-square="e4"]').tap();
        }
        await expect(status(host, game)).not.toHaveText(/^You’re White · Your turn$/);
    }
    if (game.game === 'turdspades') {
        const seated = pages.slice(0, game.seats);
        for (let round = 0; round < game.seats; round++) {
            for (const page of seated) {
                const bid = page.getByRole('button', { name: /Bid for me/i });
                try {
                    await expect(bid).toBeVisible({ timeout: 2_000 });
                    await bid.tap();
                    break;
                } catch { /* another seat bids next */ }
            }
        }
        await expect(guest.locator('[data-spades-hand] button')).not.toHaveCount(0, { timeout: 20_000 });
    }
    if (game.game === 'turdanoid') {
        const serve = guest.getByRole('button', { name: 'Launch ball' });
        await expect(serve).toBeEnabled({ timeout: 20_000 });
        await serve.tap();
        await expect(guest.locator('[data-brick-match]')).toBeVisible();
    }
}

function primaryControl(page, game) {
    if (game.game === 'chess') return page.locator('.arcade-chess-actions button:visible').first();
    if (game.game === 'turdspades') {
        const bid = page.locator('[data-spades-bid]:not([hidden])').getByRole('button', { name: /Bid for me/i });
        const playable = page.locator('[data-spades-hand] button:not([disabled])').first();
        const hand = page.locator('[data-spades-hand] button').first();
        return bid.or(playable).or(hand);
    }
    return page.getByRole('button', { name: 'Launch ball' });
}

function currentMatchId(fixture, nick, gameName) {
    const frames = fixture.people.get(nick).matchFrames;
    for (let i = frames.length - 1; i >= 0; i--) {
        try {
            const frame = JSON.parse(frames[i]);
            if (frame.t === 'snapshot' && frame.currentMatchId) return frame.currentMatchId;
            if (frame.t === 'match-state' && frame.state?.id) return frame.state.id;
        } catch { /* ignore non-json frames */ }
    }
    return null;
}

async function expectUncovered(control) {
    await expect(control).toBeInViewport({ ratio: 1 });
    await expect.poll(async () => control.evaluate(button => {
        const rect = button.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return button.contains(hit);
    })).toBe(true);
}

async function spadesHandLabels(page) {
    return page.locator('[data-spades-hand] button').allTextContents();
}

function assertWatcherPrivacy(fixture, watcherNick, gameName, privilegedLabels = [], { privateHands = false } = {}) {
    const frames = fixture.people.get(watcherNick).matchFrames;
    const blob = frames.join('\n');
    for (const label of privilegedLabels) if (label) expect(blob).not.toContain(label);
    const views = frames.map(raw => { try { return JSON.parse(raw); } catch { return null; } }).filter(frame => frame?.state?.match);
    expect(views.length).toBeGreaterThan(0);
    if (privateHands) {
        for (const view of views) {
            expect(view.state.match.hand).toEqual([]);
            expect(view.state.match.hands).toBeUndefined();
        }
        expect(blob).not.toMatch(/"playable"/);
    }
    expect(fixture.view(watcherNick, gameName).deserializeAttachment().seat).toBeNull();
}

for (const game of Object.values(GAMES)) {
    const nicks = ['HostExample', 'GuestWest', 'GuestNorth', 'GuestEast'].slice(0, game.seats);
    const absentNick = nicks.at(-1);

    test.describe(`${game.label} reconnect seat (390×844)`, () => {
        test.slow();

        test('offline within grace returns to the same seat with reconnect UI', async ({ browser, baseURL }) => {
            const fixture = await gameNight(browser, baseURL);
            try {
                const pages = await seated(fixture, game, nicks);
                await midMatch(game, pages);
                const guest = pages.at(-1), host = pages[0];
                const seatBefore = fixture.view(absentNick, game.game).deserializeAttachment().seat;
                expect(seatBefore).toBeTruthy();
                const handBefore = game.game === 'turdspades' ? await spadesHandLabels(guest) : null;
                const pill = panel(guest, game).locator('.arcade-reconnect');
                const control = primaryControl(guest, game);
                await guest.context().setOffline(true);
                await expect(pill).toBeVisible();
                await expect(pill).toHaveText('Reconnecting…');
                await expect(control).toBeVisible();
                await expectUncovered(control);
                await expect(status(host, game)).toContainText('link still works');
                await guest.context().setOffline(false);
                await expect(pill).toBeHidden();
                await expect.poll(() => fixture.view(absentNick, game.game).deserializeAttachment().seat).toBe(seatBefore);
                await expect(guest.locator(game.board)).toBeVisible();
                if (handBefore?.length) {
                    const handAfter = await spadesHandLabels(guest);
                    expect(handAfter).toEqual(handBefore);
                }
                expect(fixture.errors()).toEqual([]);
            } finally { await fixture.close(); }
        });

        test('match socket loss returns on the same seat within grace', async ({ browser, baseURL }) => {
            const fixture = await gameNight(browser, baseURL);
            try {
                const pages = await seated(fixture, game, nicks);
                await midMatch(game, pages);
                const guest = pages.at(-1);
                const beforeSocket = fixture.view(absentNick, game.game);
                const seat = beforeSocket.deserializeAttachment().seat;
                const handBefore = game.game === 'turdspades' ? await spadesHandLabels(guest) : [];
                await fixture.dropMatch(absentNick, game.game);
                await expect.poll(() => fixture.view(absentNick, game.game) !== beforeSocket
                    && fixture.view(absentNick, game.game).deserializeAttachment().seat).toBe(seat);
                if (game.game === 'turdspades' && handBefore.length) {
                    expect(await spadesHandLabels(guest)).toEqual(handBefore);
                }
                expect(fixture.errors()).toEqual([]);
            } finally { await fixture.close(); }
        });

        test('reload returns to the same seat mid-match', async ({ browser, baseURL }) => {
            const fixture = await gameNight(browser, baseURL);
            try {
                const pages = await seated(fixture, game, nicks);
                await midMatch(game, pages);
                const guest = pages.at(-1);
                const seat = fixture.view(absentNick, game.game).deserializeAttachment().seat;
                const matchBefore = currentMatchId(fixture, absentNick, game.game);
                expect(matchBefore).toBeTruthy();
                const handBefore = game.game === 'turdspades' ? await spadesHandLabels(guest) : [];
                await guest.reload();
                await expect(guest.locator('[data-nick]')).toHaveValue(absentNick);
                await enter(guest);
                await showTable(guest, game);
                await expect(guest.locator(game.board)).toBeVisible();
                await expect.poll(() => fixture.view(absentNick, game.game).deserializeAttachment().seat).toBe(seat);
                await expect.poll(() => currentMatchId(fixture, absentNick, game.game)).toBe(matchBefore);
                if (game.game === 'chess') {
                    await expect(guest.locator('[data-square="e4"][data-piece="wp"]')).toBeVisible();
                }
                if (game.game === 'turdspades' && handBefore.length) {
                    expect(await spadesHandLabels(guest)).toEqual(handBefore);
                }
                expect(fixture.errors()).toEqual([]);
            } finally { await fixture.close(); }
        });

        test('absent seat stays held and watchers never receive a private hand', async ({ browser, baseURL }) => {
            const fixture = await gameNight(browser, baseURL);
            try {
                const pages = await seated(fixture, game, nicks);
                await midMatch(game, pages);
                const host = pages[0], absent = pages.at(-1);
                const seats = Object.fromEntries(nicks.slice(0, game.seats).map(nick =>
                    [nick, fixture.view(nick, game.game).deserializeAttachment().seat]));
                const absentHand = game.game === 'turdspades' ? await spadesHandLabels(absent) : [];
                const watcher = await fixture.phone('Watcher');
                fixture.people.get('Watcher').matchFrames.length = 0;
                await invite(host, watcher, 'Watcher');
                await showTable(watcher, game);
                await expect.poll(() => fixture.view('Watcher', game.game)).toBeTruthy();
                await expect.poll(() => fixture.view('Watcher', game.game).deserializeAttachment().seat).toBeNull();
                if (game.game === 'turdspades') {
                    await expect(watcher.locator('[data-spades-hand-label]')).toHaveText('Watching · hands are private');
                    await expect(watcher.locator('[data-spades-hand] button')).toHaveCount(0);
                }
                await absent.context().setOffline(true);
                await expect(status(host, game)).toContainText('link still works');
                const thief = await fixture.phone('SeatThief');
                await invite(host, thief, 'SeatThief');
                await showTable(thief, game);
                await expect(panel(thief, game).getByRole('button', { name: /^Join / })).toHaveCount(0);
                await expect.poll(() => fixture.view('SeatThief', game.game)?.deserializeAttachment()?.seat ?? null).toBeNull();
                for (const nick of nicks.slice(0, -1)) {
                    expect(fixture.view(nick, game.game).deserializeAttachment().seat).toBe(seats[nick]);
                }
                await expect.poll(() => fixture.view(absentNick, game.game)?.deserializeAttachment()?.seat).toBe(seats[absentNick]);
                assertWatcherPrivacy(fixture, 'Watcher', game.game, absentHand, { privateHands: game.game === 'turdspades' });
                await absent.context().setOffline(false);
                expect(fixture.errors()).toEqual([]);
            } finally { await fixture.close(); }
        });
    });
}