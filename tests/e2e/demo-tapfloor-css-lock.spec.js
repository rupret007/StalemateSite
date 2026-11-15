// Locks the c475460a short-phone Game Night CSS: chess actions, Turd Rush track
// height under the 44px tap floor, and Crappy Eights hand clearance on a 375×667 phone.
const { randomBytes, randomUUID } = require('node:crypto');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const PHONE = { width: 375, height: 667 };
const LOBBY = '/r/45662413410ed051/lobby/';
const PREVIEW = 'local-preview-key-0001';
const TAP_FLOOR_TRACK_OFFSET_PX = 521;
const EIGHTS_HAND_MIN_CLEARANCE_PX = 8;
const CHESS_BUFFER_MIN_HEIGHT_PX = 8;
const arcadeFeatures = { arcadeChess: 1, arcadeCrapeights: 1, arcadeTurdRush: 1 };

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
    const names = ['chess', 'crapeights', 'turdrush'];
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
        await page.goto(`${LOBBY}?preview=${PREVIEW}&relay=${encodeURIComponent(hangoutRelayWsBase(baseURL, 'demo-tapfloor-css-lock'))}`);
        await enter(page, nick);
        return page;
    }
    return {
        phone,
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

async function invite(host, guest, nick) {
    await host.getByRole('button', { name: 'Invite players' }).click();
    await host.getByRole('button', { name: `Invite ${nick}`, exact: true }).click();
    await guest.locator('[data-game-offer]').getByRole('button', { name: 'Join Game Night' }).click();
    await expect(guest.getByRole('region', { name: /Game Night/ })).toBeVisible();
    if (await host.locator('[data-invite-dialog][open]').count()) await host.keyboard.press('Escape');
}

async function openGameNight(host, guest) {
    const start = host.getByRole('button', { name: /Game Night/ });
    if (!await start.isVisible()) await host.locator('.phonetabs [data-show="rooms"]').click();
    await start.click();
    await expect(host.getByRole('region', { name: /Game Night/ })).toBeVisible();
    await invite(host, guest, 'PhoneGuest');
}

async function resetGameNightScroll(page) {
    await page.locator('[data-game-night]').evaluate(surface => { surface.scrollTop = 0; });
}

async function expectAboveTapFloor(control) {
    await expect(control).toBeInViewport({ ratio: 1 });
    expect(await control.evaluate(button => {
        const rect = button.getBoundingClientRect();
        const navigation = document.querySelector('nav.phonetabs')?.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return button.contains(hit) && (!navigation?.height || rect.bottom <= navigation.top);
    }), 'control must sit above phonetabs and receive pointer hits').toBe(true);
}

async function measureChessTapFloor(page) {
    return page.evaluate((bufferMin) => {
        const buffer = document.querySelector('.chat .buffer');
        const bufferMinHeight = buffer ? parseFloat(getComputedStyle(buffer).minHeight) : NaN;
        const actions = [...document.querySelectorAll('.arcade-chess-actions button')].filter(button => button.offsetParent);
        const actionBoxes = actions.map(button => {
            const rect = button.getBoundingClientRect();
            return { bottom: rect.bottom, height: rect.height };
        });
        return { bufferMinHeight, actionCount: actions.length, actionBoxes, expectedBufferMin: bufferMin };
    }, CHESS_BUFFER_MIN_HEIGHT_PX);
}

async function measureRushTapFloor(page) {
    return page.evaluate((offset) => {
        const track = document.querySelector('.rush-race-track');
        const controls = document.querySelector('[data-race-controls]');
        const trackHeight = track ? parseFloat(getComputedStyle(track).height) : NaN;
        const clamped = Math.min(275, Math.max(132, window.innerHeight - offset));
        const trackBox = track?.getBoundingClientRect();
        const controlsBox = controls?.getBoundingClientRect();
        const navigation = document.querySelector('nav.phonetabs')?.getBoundingClientRect();
        const floor = navigation?.top ?? window.innerHeight;
        return {
            innerHeight: window.innerHeight,
            trackHeight,
            expectedTrackHeight: clamped,
            trackBottom: trackBox?.bottom ?? NaN,
            controlsBottom: controlsBox?.bottom ?? NaN,
            tapFloorTop: floor,
            controlsHidden: controls?.hidden ?? true
        };
    }, TAP_FLOOR_TRACK_OFFSET_PX);
}

async function measureEightsHandClearance(page) {
    return page.evaluate(() => {
        const hand = document.querySelector('.arcade-eights [data-eights-hand]');
        const rect = hand?.getBoundingClientRect();
        const navigation = document.querySelector('nav.phonetabs')?.getBoundingClientRect();
        const floor = navigation?.top ?? window.innerHeight;
        const clearance = rect ? floor - rect.bottom : NaN;
        const buffer = document.querySelector('.chat .buffer');
        const bufferMinHeight = buffer ? parseFloat(getComputedStyle(buffer).minHeight) : NaN;
        return { clearance, handBottom: rect?.bottom ?? NaN, tapFloorTop: floor, bufferMinHeight, cardCount: hand?.querySelectorAll('button').length ?? 0 };
    });
}

test('375×667 Game Night phone lanes lock c475460a tap-floor CSS', async ({ browser, baseURL }, testInfo) => {
    test.slow();
    const fixture = await gameNight(browser, baseURL);
    const metrics = {};
    try {
        const host = await fixture.phone('CssHost', { viewport: { width: 1280, height: 900 } });
        const phone = await fixture.phone('PhoneGuest', { viewport: PHONE });
        await openGameNight(host, phone);
        await phone.evaluate(() => document.fonts.ready);

        await host.getByRole('combobox', { name: 'Switch game' }).selectOption('chess');
        await phone.getByRole('combobox', { name: 'Switch game' }).selectOption('chess');
        await phone.locator('details.arcade-chess').evaluate(panel => { panel.open = true; });
        await host.getByRole('button', { name: 'Open Chess match' }).click();
        await phone.getByRole('button', { name: 'Join as Black' }).click();
        await expect(phone.locator('[data-chess-playing]')).toBeVisible();
        await resetGameNightScroll(phone);
        metrics.chess = await measureChessTapFloor(phone);
        expect(metrics.chess.bufferMinHeight, 'chess transcript floor under 44px chrome').toBe(CHESS_BUFFER_MIN_HEIGHT_PX);
        expect(metrics.chess.actionCount).toBeGreaterThan(0);
        const chessActions = phone.locator('.arcade-chess-actions button:visible');
        for (const action of await chessActions.all()) {
            await expectAboveTapFloor(action);
            const box = await action.boundingBox();
            expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
        }

        await host.getByRole('combobox', { name: 'Switch game' }).selectOption('turdrush');
        await phone.getByRole('combobox', { name: 'Switch game' }).selectOption('turdrush');
        await phone.locator('details.arcade-rush-race').evaluate(panel => { panel.open = true; });
        await host.getByRole('button', { name: 'Open Turd Rush race' }).click();
        await phone.getByRole('button', { name: 'Join Turd Rush race' }).click();
        await expect(phone.locator('[data-race-match]')).toBeVisible();
        await expect(phone.locator('[data-race-controls]')).toBeVisible();
        await resetGameNightScroll(phone);
        metrics.rush = await measureRushTapFloor(phone);
        expect(metrics.rush.controlsHidden, 'rush controls visible during countdown').toBe(false);
        expect(metrics.rush.trackHeight).toBe(metrics.rush.expectedTrackHeight);
        expect(metrics.rush.trackHeight).toBe(PHONE.height - TAP_FLOOR_TRACK_OFFSET_PX);
        await expectAboveTapFloor(phone.getByRole('region', { name: 'Turd Rush race track' }));
        for (const label of ['Move left', 'Move right', 'Jump', 'Slide']) {
            await expectAboveTapFloor(phone.getByRole('button', { name: label, exact: true }));
        }
        expect(metrics.rush.controlsBottom).toBeLessThanOrEqual(metrics.rush.tapFloorTop);

        await host.getByRole('combobox', { name: 'Switch game' }).selectOption('crapeights');
        await phone.getByRole('combobox', { name: 'Switch game' }).selectOption('crapeights');
        await phone.locator('details.arcade-eights').evaluate(panel => { panel.open = true; });
        await host.getByRole('button', { name: 'Open Eights table' }).click();
        await phone.getByRole('button', { name: 'Join Eights table' }).click();
        await expect(phone.locator('[data-eights-hand] button')).toHaveCount(7);
        await resetGameNightScroll(phone);
        metrics.eights = await measureEightsHandClearance(phone);
        await expect(phone.locator('[data-eights-hand]')).toBeInViewport({ ratio: 1 });
        expect(metrics.eights.clearance).toBeGreaterThanOrEqual(EIGHTS_HAND_MIN_CLEARANCE_PX);
        expect(metrics.eights.bufferMinHeight).toBe(34);

        expect(fixture.errors()).toEqual([]);
        const report = { viewport: PHONE, ...metrics };
        console.log('DEMO_TAPFLOOR_CSS_LOCK', JSON.stringify(report));
        await testInfo.attach('demo-tapfloor-css-lock-metrics', {
            body: JSON.stringify(report, null, 2),
            contentType: 'application/json'
        });
    } finally {
        await fixture.close();
    }
});