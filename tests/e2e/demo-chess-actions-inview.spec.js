// Two-phone Game Night Chess: every visible match action stays fully in the
// viewport on short phones (locks Offer draw viewport ratio 0.79 on hosted CI).
const { randomBytes, randomUUID } = require('node:crypto');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const LOBBY = '/r/45662413410ed051/lobby/';
const PREVIEW = 'local-preview-key-0001';
const arcadeFeatures = { arcadeChess: 1, arcadeTurdSpades: 1, arcadeTurdanoid: 1 };

const VIEWPORTS = [
    { width: 375, height: 667 },
    { width: 390, height: 664 },
    { width: 360, height: 640 }
];

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

    async function phone(nick, { viewport }) {
        const sid = randomUUID(), session = { betaSid: sid, betaInviteVersion: '1' };
        const person = { nick, sid, identity: null, matches: new Map(), matchFrames: [] };
        people.set(nick, person);
        const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
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
        await page.goto(`${LOBBY}?preview=${PREVIEW}&relay=${encodeURIComponent(hangoutRelayWsBase(baseURL, 'demo-chess-actions-inview'))}`);
        await page.locator('[data-nick]').fill(nick);
        await page.locator('[data-enter]').click();
        await expect(page.locator('[data-connection]')).toHaveText('Connected');
        return page;
    }
    return {
        phone,
        errors: () => [...people.values()].flatMap(person => person.errors.map(error => `${person.nick}: ${error}`)),
        close: () => Promise.all(contexts.map(context => context.close()))
    };
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
    await page.getByRole('combobox', { name: 'Switch game' }).selectOption('chess');
    await expect(page.locator('[data-chess-status]')).toBeVisible();
}

const square = (page, name) => page.locator(`.arcade-chess [data-square="${name}"]`);

async function tapMove(page, from, to) {
    await square(page, from).tap();
    await square(page, to).tap();
}

async function assertVisibleMatchActions(page, viewport, phase, measurements) {
    await page.locator('[data-game-night]').evaluate(surface => { surface.scrollTop = 0; });
    const actions = page.locator('.arcade-chess-actions button:visible');
    const buttons = await actions.all();
    expect(buttons.length, `${phase} has visible match actions`).toBeGreaterThan(0);
    const nick = await page.locator('[data-nick]').inputValue().catch(() => 'player');
    for (const button of buttons) {
        const label = (await button.innerText()).trim() || await button.getAttribute('data-action');
        await expect(button, `${nick} ${label} at ${viewport.width}x${viewport.height} (${phase})`).toBeInViewport({ ratio: 1 });
        const box = await button.boundingBox();
        expect(box, `${nick} ${label} box`).not.toBeNull();
        expect(box.width, `${label} width`).toBeGreaterThanOrEqual(44);
        expect(box.height, `${label} height`).toBeGreaterThanOrEqual(44);
        measurements.push({
            viewport: `${viewport.width}x${viewport.height}`,
            phase,
            nick,
            label,
            width: Math.round(box.width * 10) / 10,
            height: Math.round(box.height * 10) / 10
        });
    }
}

for (const viewport of VIEWPORTS) {
    test(`Travis and Candace keep every Chess match action fully in view at ${viewport.width}x${viewport.height}`, async ({ browser, baseURL }, testInfo) => {
        test.slow();
        const fixture = await gameNight(browser, baseURL);
        const measurements = [];
        try {
            const travis = await fixture.phone('Travis', { viewport });
            const candace = await fixture.phone('Candace', { viewport });
            expect(travis.viewportSize()).toEqual(viewport);
            expect(candace.viewportSize()).toEqual(viewport);

            await openGameNight(travis);
            await inviteGuest(travis, candace, 'Candace');
            await showChess(travis);
            await showChess(candace);
            await travis.getByRole('button', { name: 'Open Chess match', exact: true }).tap();
            await candace.getByRole('button', { name: 'Join as Black', exact: true }).tap();

            await expect(travis.locator('.arcade-chess-board')).toBeVisible();
            await expect(candace.locator('.arcade-chess-board')).toBeVisible();
            await expect(travis.locator('[data-chess-status]')).toHaveText('You’re White · Your turn');
            await expect(candace.locator('[data-chess-status]')).toHaveText('You’re Black · White to move');

            for (const page of [travis, candace]) {
                await assertVisibleMatchActions(page, viewport, 'playing', measurements);
            }

            await tapMove(travis, 'e2', 'e4');
            await expect(travis.locator('[data-square="e4"]')).toHaveAttribute('data-piece', 'wp');
            await expect(candace.locator('[data-chess-status]')).toHaveText('You’re Black · Your turn');
            await tapMove(candace, 'e7', 'e5');
            await expect(candace.locator('[data-square="e5"]')).toHaveAttribute('data-piece', 'bp');
            await expect(travis.locator('[data-chess-status]')).toHaveText('You’re White · Your turn');
            await expect(candace.locator('[data-chess-status]')).toHaveText('You’re Black · White to move');

            for (const page of [travis, candace]) {
                await assertVisibleMatchActions(page, viewport, 'after-one-move-each', measurements);
            }

            await testInfo.attach(`chess-actions-${viewport.width}x${viewport.height}`, {
                body: JSON.stringify(measurements, null, 2),
                contentType: 'application/json'
            });
            expect(fixture.errors()).toEqual([]);
        } finally {
            await fixture.close();
        }
    });
}