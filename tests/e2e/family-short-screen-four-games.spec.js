// Family-alpha on iPhone SE (375×667): Chess, partners Spades, four-player Spades, and
// Turdanoid must expose full-size touch targets and a reachable primary control with no
// horizontal page scroll. Uses the same synthetic Game Night harness as family-alpha-gate.
const { randomBytes, randomUUID } = require('node:crypto');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');
const { room } = require('./chess-phone-fixture');

const SHORT = { width: 375, height: 667 };
const LOBBY = '/r/45662413410ed051/lobby/';
const PREVIEW = 'local-preview-key-0001';
const arcadeFeatures = { arcadeChess: 1, arcadeTurdSpades: 1, arcadeTurdanoid: 1 };

async function gameNight(browser, baseURL) {
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

    async function phone(nick, { viewport = SHORT } = {}) {
        const sid = randomUUID(), session = { betaSid: sid, betaInviteVersion: '1' };
        const person = { nick, sid, identity: null, matches: new Map() };
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
        await page.goto(`${LOBBY}?preview=${PREVIEW}&relay=${encodeURIComponent(hangoutRelayWsBase(baseURL, 'family-short-screen-four-games'))}`);
        await enter(page, nick);
        return page;
    }
    const table = name => transports.get(name);
    return {
        phone, people,
        view: (nick, game) => people.get(nick).matches.get(game),
        act: (nick, game, frame) => serial(() => table(game).receive(people.get(nick).matches.get(game), JSON.stringify({ version: 1, ...frame }))),
        close: () => Promise.all(contexts.map(context => context.close())),
        errors: () => [...people.values()].flatMap(person => person.errors.map(error => `${person.nick}: ${error}`))
    };
}

async function enter(page, nick) {
    const field = page.locator('[data-nick]');
    if (nick && await field.inputValue() !== nick) await field.fill(nick);
    await page.click('[data-enter]');
    await expect(page.locator('[data-connection]')).toHaveText('Connected');
}

const GAMES = {
    chess: {
        label: 'Chess', game: 'chess', status: '[data-chess-status]', seats: 2,
        open: host => host.getByRole('button', { name: 'Open Chess match' }).click(),
        join: guest => guest.getByRole('button', { name: 'Join as Black' }).click(),
        live: [/^You’re White · Your turn/, /^You’re Black · White to move/],
        board: '.arcade-chess-board',
        primary: page => page.getByRole('group', { name: 'Chessboard' }),
        assertPages: pages => pages.slice(0, 2)
    },
    partners: {
        label: 'partners Spades', game: 'turdspades', status: '[data-spades-status]', seats: 2,
        open: host => host.getByRole('button', { name: 'Open 2-player Spades' }).click(),
        join: guest => guest.getByRole('button', { name: 'Join West' }).click(),
        live: [/computer partner|Round 1/, /computer partner|Waiting for the host to bid|Round 1/],
        board: '[data-spades-table]',
        primary: page => page.locator('[data-spades-action="bid"]'),
        assertPages: pages => [pages[1]]
    },
    four: {
        label: 'four-player Spades', game: 'turdspades', status: '[data-spades-status]', seats: 4,
        open: host => host.getByRole('button', { name: 'Open 4-player Spades' }).click(),
        join: (guest, index) => guest.getByRole('button', { name: `Join ${['West', 'North', 'East'][index]}` }).click(),
        live: [/^Round 1 · /, /^Round 1 · /, /^Round 1 · /, /^Round 1 · /],
        board: '[data-spades-table]',
        primary: page => page.locator('[data-spades-action="bid"]')
    },
    turdanoid: {
        label: 'Turdanoid', game: 'turdanoid', status: '[data-brick-status]', seats: 2,
        open: host => host.getByRole('button', { name: 'Open Turdanoid race' }).click(),
        join: guest => guest.getByRole('button', { name: 'Join Turdanoid race' }).click(),
        live: [/\S/, /\S/],
        board: '[data-brick-match]',
        primary: page => page.getByRole('button', { name: 'Launch ball', exact: true }),
        assertPages: pages => pages.slice(0, 2)
    }
};

const panel = (page, game) => page.locator('details', { has: page.locator(game.status) });
const status = (page, game) => page.locator(game.status);

async function showTable(page, game) {
    const picker = page.getByRole('combobox', { name: 'Switch game' });
    await expect(picker.locator(`option[value="${game.game}"]`)).toBeEnabled();
    await picker.selectOption(game.game);
    await expect(status(page, game)).toBeVisible();
}

async function seated(fixture, game, nicks) {
    const pages = await room(fixture, nicks);
    await Promise.all(pages.map(page => showTable(page, game)));
    await game.open(pages[0]);
    for (const [index, guest] of pages.slice(1, game.seats).entries()) await game.join(guest, index);
    for (const [index, page] of pages.slice(0, game.seats).entries()) {
        await expect(page.locator(game.board)).toBeVisible();
        await expect(status(page, game)).toHaveText(game.live[index]);
    }
    return pages;
}

async function assertNoHorizontalScroll(page) {
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        await page.evaluate(() => innerWidth)
    );
}

async function assertVisibleGameButtons(page, game) {
    const buttonQuery = game.game === 'chess' ? 'button.btn' : 'button';
    const misses = await panel(page, game).evaluate((root, selector) => {
        const isVisible = button => {
            if (button.hidden) return false;
            const style = getComputedStyle(button);
            if (style.visibility === 'hidden' || style.display === 'none') return false;
            const rect = button.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        };
        return [...root.querySelectorAll(selector)].filter(isVisible).flatMap(button => {
            const rect = button.getBoundingClientRect();
            if (rect.height >= 44) return [];
            const name = (button.textContent || button.getAttribute('aria-label') || button.dataset.spadesCard || 'button').trim().slice(0, 48);
            return [`${name}: ${Math.round(rect.width)}×${Math.round(rect.height)}`];
        });
    }, buttonQuery);
    expect(misses).toEqual([]);
}

async function assertShortPhoneLayout(page, game) {
    await assertNoHorizontalScroll(page);
    await assertVisibleGameButtons(page, game);
    const control = game.primary(page);
    await expect(control).toBeVisible();
    await expect(control).toBeInViewport();
}

async function pagesWithBidControl(pages) {
    const ready = [];
    for (const page of pages) {
        const bid = page.locator('[data-spades-action="bid"]');
        if (await bid.isVisible()) ready.push(page);
    }
    return ready;
}

for (const [key, game] of Object.entries(GAMES)) {
    const nicks = ['HostExample', 'GuestWest', 'GuestNorth', 'GuestEast'].slice(0, game.seats);

    test(`${game.label} at 375×667`, async ({ browser, baseURL }) => {
        test.slow();
        const fixture = await gameNight(browser, baseURL);
        try {
            const pages = await seated(fixture, game, nicks);
            const targets = key === 'four'
                ? await pagesWithBidControl(pages)
                : game.assertPages(pages);
            expect(targets.length).toBeGreaterThan(0);
            for (const page of pages.slice(0, game.seats)) await assertNoHorizontalScroll(page);
            for (const page of pages.slice(0, game.seats)) await assertVisibleGameButtons(page, game);
            for (const page of targets) await assertShortPhoneLayout(page, game);
            expect(fixture.errors()).toEqual([]);
        } finally { await fixture.close(); }
    });
}