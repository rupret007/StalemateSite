// Game Night phone tap-through: two seated phones and one watch-only phone.
// Real lobby client, lobby-core, and arcade transport. Match sockets are routed
// in-process; person.frames are the WebSocket payloads each phone receives.
const { randomBytes, randomUUID } = require('node:crypto');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const PHONE = { width: 390, height: 844 };
const LOBBY = '/r/45662413410ed051/lobby/';
const PREVIEW = 'local-preview-key-0001';
const WALLS = /^(Fresh Tiles|Rainbow Rows|Ripple)$/;
const CONTROL_KEYS = ['queue', 'sequence', 'credits', 'pending'];
const RUSH_CONTROLS = ['Move left', 'Move right', 'Jump', 'Slide'];
const arcadeFeatures = { arcadeTurdanoid: 1, arcadeTurdRush: 1 };

async function gameNight(browser, baseURL) {
    const { createLobby } = await import('../../hangout-worker/src/lobby-core.mjs');
    const { arcadeGame, arcadeRoomRequest, createArcadeTransport } = await import('../../hangout-worker/src/arcade-transport.mjs');
    const contexts = [], lobbySockets = new Map(), people = new Map(), matchSockets = [], departures = [], records = new Map(), harnessErrors = [];
    let at = 1800000000000, alarm = null, upgrading = null, queue = Promise.resolve();
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
        if (frame.t === 'part' && person) {
            const ref = engine.arcadeRoomRef(frame.ch, false);
            if (ref) departures.push({ scope: { room: frame.ch, ref }, subject: person.sid });
        }
        const sent = frame.t === 'hello' ? { ...frame, features: { ...frame.features, ...arcadeFeatures } } : frame;
        lobbySockets.get(id)?.send(JSON.stringify(sent));
    } });
    const names = ['turdanoid', 'turdrush'];
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

    async function phone(nick) {
        const sid = randomUUID(), session = { betaSid: sid, betaInviteVersion: '1' };
        const person = { nick, sid, identity: null, matches: new Map() };
        people.set(nick, person);
        const context = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
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
            const identity = { id: 'c' + randomBytes(16).toString('hex'), dev: `device-${nick}`, iph: `seat-${nick}`, role: 'fan', account: '', admin: false, ...session };
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
        await page.goto(`${LOBBY}?preview=${PREVIEW}&relay=${encodeURIComponent(hangoutRelayWsBase(baseURL, 'demo-race-phone'))}`);
        await enter(page, nick);
        return page;
    }
    const table = name => transports.get(name);
    return {
        phone,
        view: (nick, game) => people.get(nick).matches.get(game),
        frames: nick => [...people.get(nick).frames],
        record: async game => [...(await storage.list({ prefix: `game-night-${game}:` })).values()][0],
        errors: () => [...harnessErrors, ...[...people.values()].flatMap(person => person.errors.map(error => `${person.nick}: ${error}`))],
        close: async () => {
            await serial(() => undefined);
            await Promise.all(contexts.map(context => context.close()));
        }
    };
}

async function enter(page, nick) {
    const field = page.locator('[data-nick]');
    if (nick && await field.inputValue() !== nick) await field.fill(nick);
    await page.locator('[data-enter]').tap();
    await expect(page.locator('[data-connection]')).toHaveText('Connected');
}

async function room(fixture, nicks) {
    const pages = await Promise.all(nicks.map(nick => fixture.phone(nick)));
    const [host, ...guests] = pages;
    const start = host.getByRole('button', { name: /Game Night/ });
    if (!await start.isVisible()) await host.locator('.phonetabs [data-show="rooms"]').tap();
    await start.tap();
    await expect(host.getByRole('region', { name: /Game Night/ })).toBeVisible();
    for (const [index, guest] of guests.entries()) await invite(host, guest, nicks[index + 1]);
    return pages;
}

async function invite(host, guest, nick) {
    await host.getByRole('button', { name: 'Invite players' }).tap();
    await host.getByRole('button', { name: `Invite ${nick}`, exact: true }).tap();
    await guest.locator('[data-game-offer]').getByRole('button', { name: 'Join Game Night' }).tap();
    await expect(guest.getByRole('region', { name: /Game Night/ })).toBeVisible();
    if (await host.locator('[data-invite-dialog][open]').count()) await host.keyboard.press('Escape');
}

async function showTable(page, game) {
    const picker = page.getByRole('combobox', { name: 'Switch game' });
    await expect(picker.locator(`option[value="${game}"]`)).toBeEnabled();
    await picker.selectOption(game);
    await expect(page.locator(game === 'turdanoid' ? '[data-brick-status]' : '[data-race-status]')).toBeVisible();
}

async function expectPhoneTarget(page, locator) {
    await expect(locator).toBeVisible();
    const viewport = page.viewportSize();
    expect(viewport).toEqual(PHONE);
    const box = await locator.boundingBox();
    expect(box).toBeTruthy();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    const fullyVisible = await locator.evaluate(node => {
        const rect = node.getBoundingClientRect();
        if (rect.width < 44 || rect.height < 44) return false;
        if (rect.top < -1 || rect.left < -1 || rect.bottom > innerHeight + 1 || rect.right > innerWidth + 1) return false;
        for (let parent = node.parentElement; parent; parent = parent.parentElement) {
            const style = getComputedStyle(parent);
            const clipX = /hidden|clip|auto|scroll/.test(style.overflowX);
            const clipY = /hidden|clip|auto|scroll/.test(style.overflowY);
            if (!clipX && !clipY) continue;
            const parentRect = parent.getBoundingClientRect();
            if (clipX && (rect.left < parentRect.left - 1 || rect.right > parentRect.right + 1)) return false;
            if (clipY && (rect.top < parentRect.top - 1 || rect.bottom > parentRect.bottom + 1)) return false;
        }
        return true;
    });
    expect(fullyVisible, 'control should sit fully inside the phone viewport').toBe(true);
}

async function aimPaddle(page, fraction) {
    const board = page.locator('.brick-race-board');
    const box = await board.boundingBox();
    expect(box).toBeTruthy();
    await board.tap({ position: { x: Math.round(box.width * fraction), y: Math.round(box.height * 0.55) } });
}

function paddleOf(frames) {
    for (let index = frames.length - 1; index >= 0; index -= 1) {
        try {
            const paddle = JSON.parse(frames[index]).state?.match?.runner?.run?.paddleX;
            if (Number.isFinite(paddle)) return paddle;
        } catch { /* A non-match frame has no runner. */ }
    }
    return null;
}

function matchViews(frames) {
    return frames.flatMap(raw => {
        try {
            const frame = JSON.parse(raw);
            return frame?.state?.match ? [frame] : [];
        } catch { return []; }
    });
}

function controlKeys(runner) {
    if (!runner || typeof runner !== 'object') return [];
    return CONTROL_KEYS.filter(key => Object.prototype.hasOwnProperty.call(runner, key));
}

function seatOf(fixture, nick, game) {
    const socket = fixture.view(nick, game);
    if (!socket) return 'missing';
    const seat = socket.deserializeAttachment()?.seat;
    return seat === undefined ? 'missing' : seat;
}

async function expectWatcherSurface(page, selector) {
    const surface = await page.locator(selector).evaluate(node => ({
        sequence: node.getAttribute('data-sequence'),
        markup: node.innerHTML
    }));
    expect(surface.sequence ?? '').toBe('');
    expect(surface.markup).not.toMatch(/"(?:queue|sequence|credits|pending)"\s*:/);
}

async function forfeit(page, dialog) {
    await page.getByRole('button', { name: 'Leave race', exact: true }).tap();
    const confirm = page.locator(dialog).getByRole('button', { name: 'Leave race', exact: true });
    await expect(confirm).toBeVisible();
    await confirm.tap();
}

async function expectResult(host, guest, watcher, status) {
    await expect(host.locator(status)).toHaveText('Rival wins · forfeit');
    await expect(guest.locator(status)).toHaveText('You win · forfeit');
    await expect(watcher.locator(status)).toHaveText('Player 2 wins · forfeit');
}

test('390×844 phones launch Turdanoid, run Turd Rush, rematch, and keep the watcher off seated controls', async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    const fixture = await gameNight(browser, baseURL);
    try {
        const [host, guest, watcher] = await room(fixture, ['RaceHost', 'RaceGuest', 'RaceWatcher']);
        expect(await host.evaluate(() => navigator.maxTouchPoints)).toBeGreaterThan(0);
        for (const page of [host, guest, watcher]) await showTable(page, 'turdanoid');
        await host.getByRole('button', { name: 'Open Turdanoid race' }).tap();
        await guest.getByRole('button', { name: 'Join Turdanoid race' }).tap();
        const brick = page => page.locator('[data-brick-match]');
        for (const page of [host, guest, watcher]) await expect(brick(page)).toBeVisible();
        await expect(watcher.getByRole('button', { name: 'Join Turdanoid race' })).toBeHidden();
        await expect.poll(() => seatOf(fixture, 'RaceWatcher', 'turdanoid')).toBeNull();
        await expect(host.locator('[data-brick-status]')).toHaveText(WALLS);
        const wall = await host.locator('[data-brick-status]').innerText();
        await expect(guest.locator('[data-brick-status]')).toHaveText(wall);
        await expect(watcher.locator('[data-brick-status]')).toHaveText(wall);

        const launch = page => page.getByRole('button', { name: 'Launch ball', exact: true });
        for (const page of [host, guest]) {
            await expectPhoneTarget(page, launch(page));
            await expect(launch(page)).toBeEnabled();
        }
        await expect(watcher.locator('[data-brick-serve]')).toBeHidden();
        const clock = await host.locator('[data-brick-clock]').textContent();
        await launch(host).tap();
        await launch(guest).tap();
        await expect(brick(host)).toHaveAttribute('data-stuck', 'false');
        await expect(brick(guest)).toHaveAttribute('data-stuck', 'false');
        await expect(brick(watcher)).not.toHaveAttribute('data-stuck');
        await expect(brick(watcher)).not.toHaveAttribute('data-paddle');
        await aimPaddle(host, 0.12);
        await aimPaddle(guest, 0.88);
        await expect.poll(async () => {
            const raw = await brick(host).getAttribute('data-paddle');
            return raw === null ? 240 : Number(raw);
        }).toBeLessThan(200);
        await expect.poll(async () => {
            const raw = await brick(guest).getAttribute('data-paddle');
            return raw === null ? 240 : Number(raw);
        }).toBeGreaterThan(280);
        await expect.poll(() => paddleOf(fixture.frames('RaceHost'))).toBeLessThan(200);
        await expect.poll(() => paddleOf(fixture.frames('RaceGuest'))).toBeGreaterThan(280);
        await expect.poll(() => host.locator('[data-brick-clock]').textContent()).not.toBe(clock);
        await expectWatcherSurface(watcher, '[data-brick-match]');
        await expect(watcher.getByRole('button', { name: 'Request Turdanoid rematch', exact: true })).toHaveCount(0);

        const brickId = (await fixture.record('turdanoid')).turdanoid.id;
        await forfeit(host, '[data-brick-confirm]');
        await expectResult(host, guest, watcher, '[data-brick-status]');
        await expect(watcher.getByRole('button', { name: 'Accept Turdanoid rematch', exact: true })).toHaveCount(0);
        await host.getByRole('button', { name: 'Request Turdanoid rematch', exact: true }).tap();
        await guest.getByRole('button', { name: 'Accept Turdanoid rematch', exact: true }).tap();
        await expect.poll(async () => (await fixture.record('turdanoid')).turdanoid.id).not.toBe(brickId);
        await expect(brick(host)).toHaveAttribute('data-phase', /countdown|play/);
        await expect(brick(guest)).toBeVisible();
        await expect(brick(watcher)).toBeVisible();
        await expect.poll(() => seatOf(fixture, 'RaceHost', 'turdanoid')).toBe('a');
        await expect.poll(() => seatOf(fixture, 'RaceGuest', 'turdanoid')).toBe('b');
        await expect.poll(() => seatOf(fixture, 'RaceWatcher', 'turdanoid')).toBeNull();
        await expectPhoneTarget(host, launch(host));
        await expectWatcherSurface(watcher, '[data-brick-match]');

        for (const page of [host, guest, watcher]) await showTable(page, 'turdrush');
        await host.getByRole('button', { name: 'Open Turd Rush race' }).tap();
        await guest.getByRole('button', { name: 'Join Turd Rush race' }).tap();
        const race = page => page.locator('[data-race-match]');
        for (const page of [host, guest, watcher]) await expect(race(page)).toBeVisible();
        await expect(watcher.getByRole('button', { name: 'Join Turd Rush race' })).toBeHidden();
        await expect(watcher.locator('[data-race-controls]')).toBeHidden();
        await expect.poll(() => seatOf(fixture, 'RaceWatcher', 'turdrush')).toBeNull();
        for (const page of [host, guest]) {
            for (const name of RUSH_CONTROLS) await expectPhoneTarget(page, page.getByRole('button', { name, exact: true }));
        }
        const moveLeft = host.getByRole('button', { name: 'Move left', exact: true });
        const jump = guest.getByRole('button', { name: 'Jump', exact: true });
        await expect(moveLeft).toBeEnabled();
        await expect(jump).toBeEnabled();
        await moveLeft.tap();
        await jump.tap();
        await expect(race(host)).toHaveAttribute('data-phase', 'play');
        await expect(race(host)).toHaveAttribute('data-lane', '0');
        await expect(race(host)).toHaveAttribute('data-sequence', '1');
        await expect(race(guest)).toHaveAttribute('data-lane', '1');
        await expect(race(guest)).toHaveAttribute('data-sequence', '1');
        await expect(race(watcher)).toHaveAttribute('data-sequence', '');
        await expect(host.locator('[data-race-status]')).toHaveText('Swipe or use arrows to move, jump and slide.');
        await expect(guest.locator('[data-race-status]')).toHaveText('Swipe or use arrows to move, jump and slide.');
        await expect(watcher.locator('[data-race-status]')).toHaveText('Watching both runners');
        await expect.poll(async () => {
            const values = await host.locator('[data-race-score] progress').evaluateAll(bars => bars.map(bar => bar.value));
            return values.length === 2 && values.every(value => value > 0);
        }).toBe(true);
        await expectWatcherSurface(watcher, '[data-race-match]');

        const rushId = (await fixture.record('turdrush')).turdrush.id;
        await forfeit(host, '[data-race-confirm]');
        await expectResult(host, guest, watcher, '[data-race-status]');
        await expect(watcher.getByRole('button', { name: 'Request Turd Rush rematch', exact: true })).toHaveCount(0);
        await host.getByRole('button', { name: 'Request Turd Rush rematch', exact: true }).tap();
        await guest.getByRole('button', { name: 'Accept Turd Rush rematch', exact: true }).tap();
        await expect.poll(async () => (await fixture.record('turdrush')).turdrush.id).not.toBe(rushId);
        await expect(race(host)).toHaveAttribute('data-phase', /countdown|play/);
        await expect(race(guest)).toHaveAttribute('data-sequence', '0');
        await expect(race(watcher)).toHaveAttribute('data-sequence', '');
        await expect(watcher.locator('[data-race-controls]')).toBeHidden();
        await expect.poll(() => seatOf(fixture, 'RaceHost', 'turdrush')).toBe('a');
        await expect.poll(() => seatOf(fixture, 'RaceGuest', 'turdrush')).toBe('b');
        await expect.poll(() => seatOf(fixture, 'RaceWatcher', 'turdrush')).toBeNull();
        for (const name of RUSH_CONTROLS) await expectPhoneTarget(host, host.getByRole('button', { name, exact: true }));
        await expectWatcherSurface(watcher, '[data-race-match]');

        const views = matchViews(fixture.frames('RaceWatcher'));
        expect(views.length).toBeGreaterThan(0);
        const leaked = views.flatMap(frame => {
            const keys = controlKeys(frame.state.match.runner);
            if (!keys.length) return [];
            const runner = frame.state.match.runner;
            return [{ game: frame.state.match.game, keys, sequence: runner.sequence, queue: runner.queue }];
        });
        const inputs = [];
        for (const frame of leaked) {
            if (!frame.queue.length) continue;
            const signature = `${frame.game}:${frame.sequence}:${JSON.stringify(frame.queue)}`;
            if (inputs.some(item => item.signature === signature)) continue;
            inputs.push({ signature, game: frame.game, sequence: frame.sequence, queue: frame.queue });
        }
        expect({
            controlFrames: leaked.length,
            games: [...new Set(leaked.map(frame => frame.game))].sort(),
            inputs: inputs.map(({ game, sequence, queue }) => ({ game, sequence, queue }))
        }, 'watcher socket frames must not carry seated runner queue, sequence, credits, or pending inputs').toEqual({
            controlFrames: 0, games: [], inputs: []
        });
        expect(fixture.errors()).toEqual([]);
    } finally { await fixture.close(); }
});
