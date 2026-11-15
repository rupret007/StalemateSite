// Phone smoke: Game Night picker → first screen → back to the room chat (390×844).
const { randomBytes, randomUUID } = require('node:crypto');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const PHONE = { width: 390, height: 844 };
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

    async function phone(nick, { viewport = PHONE } = {}) {
        const sid = randomUUID(), session = { betaSid: sid, betaInviteVersion: '1' };
        const person = { nick, sid, identity: null, matches: new Map(), matchFrames: [] };
        people.set(nick, person);
        const context = await browser.newContext({ viewport, hasTouch: true });
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
        await page.goto(`${LOBBY}?preview=${PREVIEW}&relay=${encodeURIComponent(hangoutRelayWsBase(baseURL, 'game-night-four-games-phone'))}`);
        await enter(page, nick);
        return page;
    };
    return { phone, close: () => Promise.all(contexts.map(context => context.close())) };
}

async function enter(page, nick) {
    const field = page.locator('[data-nick]');
    if (nick && await field.inputValue() !== nick) await field.fill(nick);
    await page.click('[data-enter]');
    await expect(page.locator('[data-connection]')).toHaveText('Connected');
}

async function openGameNight(page) {
    const start = page.getByRole('button', { name: /Game Night/ });
    if (!await start.isVisible()) await page.locator('.phonetabs [data-show="rooms"]').click();
    await start.click();
    await expect(page.getByRole('region', { name: /Game Night/ })).toBeVisible();
}

async function invite(host, guest, nick) {
    await host.getByRole('button', { name: 'Invite players' }).click();
    await host.getByRole('button', { name: `Invite ${nick}`, exact: true }).click();
    await guest.locator('[data-game-offer]').getByRole('button', { name: 'Join Game Night' }).click();
    await expect(guest.getByRole('region', { name: /Game Night/ })).toBeVisible();
    if (await host.locator('[data-invite-dialog][open]').count()) await host.keyboard.press('Escape');
}

async function pickGame(page, game) {
    const picker = page.getByRole('combobox', { name: 'Switch game' });
    const option = picker.locator(`option[value="${game}"]`);
    await expect(option).toHaveCount(1);
    await expect(option).toBeEnabled();
    await picker.selectOption(game);
}

async function fitsWidth(page) {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function primaryVisible(page, name) {
    const action = page.getByRole('button', { name, exact: true });
    await expect(action).toBeVisible();
    await expect(action).toBeInViewport();
    return action;
}

async function primaryInView(page, name) {
    const action = await primaryVisible(page, name);
    const box = await action.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
    return action;
}

async function tapClose(page, gameCase) {
    const close = await primaryInView(page, gameCase.close);
    await close.tap();
    if (gameCase.game === 'turdanoid') {
        const confirm = page.getByRole('dialog', { name: 'Leave this race?' }).getByRole('button', { name: 'Leave race', exact: true });
        await expect(confirm).toBeVisible();
        const confirmBox = await confirm.boundingBox();
        expect(confirmBox?.height).toBeGreaterThanOrEqual(44);
        expect(confirmBox?.width).toBeGreaterThanOrEqual(44);
        await confirm.tap();
    }
    await expect(page.getByRole('button', { name: gameCase.close, exact: true })).toBeHidden();
    await expect(page.getByRole('button', { name: gameCase.open, exact: true })).toBeVisible();
}

async function backToRoomChat(page) {
    await page.locator('.phonetabs [data-show="chat"]').click();
    await expect(page.locator('[data-send]')).toBeInViewport();
    await expect(page.locator('[data-chat-context]')).toBeVisible();
    await fitsWidth(page);
}

async function assertWatcherSpades(watcher) {
    await expect(watcher.locator('[data-spades-status]')).toHaveText(/^Round 1 ·/);
    await expect(watcher.locator('[data-spades-hand] button')).toHaveCount(0);
    const label = watcher.locator('[data-spades-hand-label]');
    await expect(label).toHaveText('Watching · hands are private');
    await fitsWidth(watcher);
}

const CASES = [
    { label: 'Chess', game: 'chess', open: 'Open Chess match', status: '[data-chess-status]', table: null, card: false,
        close: 'Close waiting match' },
    { label: 'partners Spades', game: 'turdspades', open: 'Open 2-player Spades', status: '[data-spades-status]', table: '[data-spades-table]', card: true,
        close: 'Close table' },
    { label: 'four-player Spades', game: 'turdspades', open: 'Open 4-player Spades', status: '[data-spades-status]', table: '[data-spades-table]', card: true, seats: 4,
        close: 'Close table' },
    { label: 'Turdanoid', game: 'turdanoid', open: 'Open Turdanoid race', status: '[data-brick-status]', table: null, card: false,
        close: 'Leave race' }
];

test.describe.configure({ mode: 'serial' });
test.describe('Game Night four graded games at 390×844', () => {
    test.use({ viewport: PHONE, hasTouch: true });
    let fixture, host, watcher, spadesGuests;

    test.beforeAll(async ({ browser, baseURL }) => {
        test.setTimeout(120_000);
        fixture = await gameNight(browser, baseURL);
        host = await fixture.phone('PhoneHost');
        await openGameNight(host);
        watcher = await fixture.phone('PhoneWatcher');
        await invite(host, watcher, 'PhoneWatcher');
        spadesGuests = await Promise.all(['PhoneWest', 'PhoneNorth', 'PhoneEast'].map(nick => fixture.phone(nick)));
        for (const [index, guest] of spadesGuests.entries()) await invite(host, guest, ['PhoneWest', 'PhoneNorth', 'PhoneEast'][index]);
    });

    test.afterAll(async () => { await fixture?.close(); });

    for (const gameCase of CASES) {
        test(`${gameCase.label}: picker, first screen, room return`, async () => {
            test.slow();
            await pickGame(host, gameCase.game);
            await expect(host.locator(gameCase.status)).toBeVisible();
            await fitsWidth(host);

            const open = await primaryVisible(host, gameCase.open);
            await open.tap();
            await expect(host.locator(gameCase.status)).toBeVisible();
            if (gameCase.seats === 4) {
                for (const [index, guest] of spadesGuests.entries()) {
                    await pickGame(guest, gameCase.game);
                    const join = guest.getByRole('button', { name: `Join ${['West', 'North', 'East'][index]}`, exact: true });
                    await join.click();
                    await expect(join).toBeHidden();
                }
                await expect(host.locator('[data-spades-table]')).toBeVisible();
                await expect(host.locator(gameCase.status)).toHaveText(/^Round 1 ·/);
            }
            if (gameCase.close) await primaryInView(host, gameCase.close);
            if (gameCase.table) await expect(host.locator(gameCase.table)).toBeVisible();
            await fitsWidth(host);

            if (gameCase.card) {
                await pickGame(watcher, gameCase.game);
                await assertWatcherSpades(watcher);
            }

            await backToRoomChat(host);

            await pickGame(host, gameCase.game);
            await tapClose(host, gameCase);
            await fitsWidth(host);
        });
    }
});
