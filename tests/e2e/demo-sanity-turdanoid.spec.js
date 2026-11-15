// Phone sanity for Turdanoid Brick Race: two touch phones, rotation, touch paddle,
// launch, life loss, score visibility, 44px controls, no dead-end.
const { randomBytes, randomUUID } = require('node:crypto');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const LOBBY = '/r/45662413410ed051/lobby/';
const PREVIEW = 'local-preview-key-0001';
const WAIT_FOR_HOST = /wait(ing)? for (the )?host/i;
const TRAVIS = { width: 390, height: 844 };
const CANDACE = { width: 375, height: 667 };
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

    async function phone(nick, { viewport } = {}) {
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
        await page.goto(`${LOBBY}?preview=${PREVIEW}&relay=${encodeURIComponent(hangoutRelayWsBase(baseURL, 'demo-sanity-turdanoid'))}`);
        await enter(page, nick);
        return page;
    }
    return {
        phone, people,
        view: (nick, game) => people.get(nick).matches.get(game),
        errors: () => [...people.values()].flatMap(person => person.errors.map(error => `${person.nick}: ${error}`)),
        close: () => Promise.all(contexts.map(context => context.close()))
    };
}

async function enter(page, nick) {
    const field = page.locator('[data-nick]');
    if (nick && await field.inputValue() !== nick) await field.fill(nick);
    await page.click('[data-enter]');
    await expect(page.locator('[data-connection]')).toHaveText('Connected');
}

async function room(fixture, nicks) {
    const pages = await Promise.all(nicks.map(nick => fixture.phone(nick, nick === 'Travis' ? { viewport: TRAVIS } : { viewport: CANDACE })));
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

async function showTurdanoid(page) {
    const picker = page.getByRole('combobox', { name: 'Switch game' });
    await expect(picker.locator('option[value="turdanoid"]')).toBeEnabled();
    await picker.selectOption('turdanoid');
    await expect(page.locator('[data-brick-status]')).toBeVisible();
}

async function seatedRace(fixture) {
    const pages = await room(fixture, ['Travis', 'Candace']);
    await Promise.all(pages.map(showTurdanoid));
    await pages[0].getByRole('button', { name: 'Open Turdanoid race' }).click();
    await pages[1].getByRole('button', { name: 'Join Turdanoid race' }).click();
    for (const page of pages) {
        await expect(page.locator('[data-brick-match]')).toBeVisible();
        await expect(page.getByRole('region', { name: 'Turdanoid playfield' })).toBeVisible();
    }
    await expect(pages[1].locator('[data-brick-match]')).toHaveAttribute('data-phase', 'play');
    return pages;
}

async function touchDrag(page, x1, y1, x2, y2) {
    const connection = await page.context().newCDPSession(page);
    try {
        await connection.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y: y1 }] });
        await connection.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x2, y: y2 }] });
        await connection.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally {
        await connection.detach();
    }
}

async function assertReachable(control) {
    await expect(control).toBeInViewport({ ratio: 1 });
    const box = await control.boundingBox();
    expect(Math.min(box.width, box.height), 'control tap target').toBeGreaterThanOrEqual(44);
    expect(await control.evaluate(button => {
        const rect = button.getBoundingClientRect();
        const navigation = document.querySelector('.phonetabs')?.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return button.contains(hit) && (!navigation?.height || rect.bottom <= navigation.top);
    }), 'control receives touch above mobile tabs').toBe(true);
}

async function assertNoDeadEnd(page, viewportWidth) {
    await expect(page.locator('[data-brick-status]')).toBeVisible();
    await expect(page.locator('[data-brick-status]')).not.toHaveText(WAIT_FOR_HOST);
    await expect(page.locator('[data-brick-status]')).not.toHaveText(/couldn.t reconnect|Ask your host for a new/i);
    await expect(page.getByRole('button', { name: 'Leave race' })).toBeVisible();
    await expect(page.locator('[data-send]')).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Back to my seat' })).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewportWidth);
}

async function measureControls(page) {
    const names = [];
    const rows = [];
    for (const control of [
        page.getByRole('button', { name: 'Launch ball' }),
        page.getByRole('button', { name: 'Leave race' }),
        page.locator('[data-send]')
    ]) {
        await expect(control).toBeVisible();
        const box = await control.boundingBox();
        const label = await control.evaluate(el => el.getAttribute('aria-label') || el.textContent?.trim() || el.dataset.send || 'send');
        names.push(label);
        rows.push({ label, width: Math.round(box.width), height: Math.round(box.height) });
        expect(Math.min(box.width, box.height), `${label} tap size`).toBeGreaterThanOrEqual(44);
        await expect(control).toBeInViewport({ ratio: 1 });
    }
    return rows;
}

test.describe('Turdanoid phone sanity demo', () => {
    test.beforeEach(() => test.slow());

    test('390x844 and 375x667 phones: touch paddle, launch, lose a life, score, rotation', async ({ browser, baseURL }, testInfo) => {
        const fixture = await gameNight(browser, baseURL);
        const measures = { Travis: null, Candace: null, paddleDelta: null, livesAfterLoss: null, landscapeLaunch: null };
        try {
            const [travis, candace] = await seatedRace(fixture);
            const board = candace.getByRole('region', { name: 'Turdanoid playfield' });
            const match = candace.locator('[data-brick-match]');
            const serve = candace.getByRole('button', { name: 'Launch ball' });
            const score = candace.locator('[data-brick-score="b"] small');

            await assertNoDeadEnd(travis, TRAVIS.width);
            await assertNoDeadEnd(candace, CANDACE.width);
            measures.Travis = await measureControls(travis);
            measures.Candace = await measureControls(candace);

            const field = await board.boundingBox();
            expect(field).toBeTruthy();
            const paddleBefore = Number(await match.getAttribute('data-paddle'));
            const y = field.y + field.height * 0.85;
            await candace.bringToFront();
            await touchDrag(candace, field.x + field.width * 0.5, y, field.x + field.width * 0.78, y);
            await expect.poll(async () => Number(await match.getAttribute('data-paddle'))).toBeGreaterThan(paddleBefore + 40);
            measures.paddleDelta = Number(await match.getAttribute('data-paddle')) - paddleBefore;

            await assertReachable(serve);
            await serve.tap();
            await expect(match).toHaveAttribute('data-stuck', 'false');

            await touchDrag(candace, field.x + field.width * 0.5, y, field.x + field.width * 0.04, y);
            await expect.poll(async () => await score.textContent()).toMatch(/2 balls/);
            await expect(match).toHaveAttribute('data-stuck', 'true');
            await expect(score).toContainText(/\d+ pts/);
            measures.livesAfterLoss = await score.textContent();

            const layout = candace.locator('.brick-race-layout');
            const portrait = candace.viewportSize();
            await candace.setViewportSize({ width: portrait.height, height: portrait.width });
            await layout.evaluate(element => element.scrollIntoView({ block: 'center' }));
            const landscapeBox = await serve.boundingBox();
            measures.landscapeLaunch = {
                width: Math.round(landscapeBox.width),
                height: Math.round(landscapeBox.height),
                viewport: `${portrait.height}x${portrait.width}`
            };
            await assertReachable(serve);
            await candace.setViewportSize(portrait);
            await serve.scrollIntoViewIfNeeded();
            await assertReachable(serve);

            await assertNoDeadEnd(travis, TRAVIS.width);
            await assertNoDeadEnd(candace, CANDACE.width);
            measures.Candace = await measureControls(candace);
            expect(fixture.errors()).toEqual([]);

            await testInfo.attach('turdanoid-phone-sanity', {
                body: JSON.stringify(measures, null, 2),
                contentType: 'application/json'
            });
        } finally {
            await fixture.close();
        }
    });
});