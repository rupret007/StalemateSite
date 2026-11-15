// Game Night demo: Crazy Eights invite play on Travis and Candace phone sizes with tap targets.
const { randomBytes, randomUUID } = require('node:crypto');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const LOBBY = '/r/45662413410ed051/lobby/';
const PREVIEW = 'local-preview-key-0001';
const arcadeFeatures = { arcadeChess: 1, arcadeTurdSpades: 1, arcadeTurdanoid: 1, arcadeCrapeights: 1 };

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
    const names = ['chess', 'turdspades', 'turdanoid', 'crapeights'];
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
        const person = { nick, sid, identity: null, matches: new Map() };
        people.set(nick, person);
        const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
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
        await page.goto(`${LOBBY}?preview=${PREVIEW}&relay=${encodeURIComponent(hangoutRelayWsBase(baseURL, 'demo-eights-phone-tapthrough'))}`);
        await enter(page, nick);
        return page;
    }
    return {
        phone, people,
        view: (nick, game) => people.get(nick).matches.get(game),
        record: async () => [...(await storage.list({ prefix: 'game-night-crapeights:' })).values()][0],
        frames: nick => people.get(nick).frames,
        errors: () => [...people.values()].flatMap(person => person.errors.map(error => `${person.nick}: ${error}`)),
        close: () => Promise.all(contexts.map(context => context.close()))
    };
}

async function enter(page, nick) {
    const field = page.locator('[data-nick]');
    if (nick && await field.inputValue() !== nick) await field.fill(nick);
    await page.locator('[data-enter]').tap();
    await expect(page.locator('[data-connection]')).toHaveText('Connected');
}

async function invite(host, guest, nick) {
    await host.getByRole('button', { name: 'Invite players' }).tap();
    await host.getByRole('button', { name: `Invite ${nick}`, exact: true }).tap();
    await guest.locator('[data-game-offer]').getByRole('button', { name: 'Join Game Night' }).tap();
    await expect(guest.getByRole('region', { name: /Game Night/ })).toBeVisible();
    if (await host.locator('[data-invite-dialog][open]').count()) await host.keyboard.press('Escape');
}

async function seatedEights(fixture, viewport) {
    const travis = await fixture.phone('Travis', { viewport });
    const candace = await fixture.phone('Candace', { viewport });
    const start = travis.getByRole('button', { name: /Game Night/ });
    if (!await start.isVisible()) await travis.locator('.phonetabs [data-show="rooms"]').tap();
    await start.tap();
    await expect(travis.getByRole('region', { name: /Game Night/ })).toBeVisible();
    await invite(travis, candace, 'Candace');
    for (const page of [travis, candace]) {
        await page.getByRole('combobox', { name: 'Switch game' }).selectOption('crapeights');
        await expect(page.locator('[data-eights-status]')).toBeVisible();
    }
    await travis.getByRole('button', { name: 'Open Eights table' }).tap();
    await candace.getByRole('button', { name: 'Join Eights table' }).tap();
    for (const page of [travis, candace]) {
        await expect(page.locator('[data-eights-table]')).toBeVisible();
        await expect(page.locator('[data-eights-card]')).toHaveCount(7);
    }
    return { travis, candace };
}

async function matchRevision(fixture) {
    const record = await fixture.record();
    return record?.crapeights?.match?.revision ?? 0;
}

async function expectRevisionAfter(fixture, before, action) {
    await action();
    await expect.poll(() => matchRevision(fixture)).toBeGreaterThan(before);
}

async function isYourTurn(page) {
    return page.locator('[data-eights-status]').evaluate(node => node.textContent.includes('Your turn'));
}

async function cardLabels(page) {
    return page.locator('[data-eights-card]:enabled').evaluateAll(buttons =>
        buttons.map(button => button.getAttribute('aria-label')));
}

async function runDemoPlays(fixture, travis, candace) {
    const milestones = { drew: false, legal: false, wild: false };
    const seats = [travis, candace];
    let lastRevision = await matchRevision(fixture);
    for (let attempt = 0; attempt < 80 && !(milestones.drew && milestones.legal && milestones.wild); attempt++) {
        let moved = false;
        for (const page of seats) {
            if (!await isYourTurn(page)) continue;
            const revision = await matchRevision(fixture);
            const draw = page.locator('[data-eights-action="draw"]');
            const pass = page.locator('[data-eights-action="pass"]');
            const labels = await cardLabels(page);

            if (!milestones.drew) {
                await expectRevisionAfter(fixture, revision, () => draw.tap());
                milestones.drew = true;
                moved = true;
                continue;
            }
            if (!milestones.legal) {
                const index = labels.findIndex(label => label && !label.includes('Wild'));
                if (index >= 0) {
                    await expectRevisionAfter(fixture, revision, () => page.locator('[data-eights-card]:enabled').nth(index).tap());
                    milestones.legal = true;
                    moved = true;
                    continue;
                }
                if (await pass.isVisible()) {
                    await expectRevisionAfter(fixture, revision, () => pass.tap());
                    moved = true;
                    continue;
                }
            }
            if (!milestones.wild) {
                const index = labels.findIndex(label => label && label.includes('Wild'));
                if (index >= 0) {
                    await page.locator('[data-eights-card]:enabled').nth(index).tap();
                    await expect(page.locator('[data-eights-choose]')).toBeVisible();
                    const suit = page.locator('[data-eights-suits]').getByRole('button').first();
                    await expect(suit).toBeVisible();
                    await expectRevisionAfter(fixture, revision, () => suit.tap());
                    milestones.wild = true;
                    moved = true;
                    continue;
                }
                if (labels.length > 0) {
                    const nonWild = labels.findIndex(label => label && !label.includes('Wild'));
                    if (nonWild >= 0) {
                        await expectRevisionAfter(fixture, revision, () => page.locator('[data-eights-card]:enabled').nth(nonWild).tap());
                        moved = true;
                        continue;
                    }
                }
                if (await pass.isVisible()) {
                    await expectRevisionAfter(fixture, revision, () => pass.tap());
                    moved = true;
                    continue;
                }
                await expectRevisionAfter(fixture, revision, () => draw.tap());
                moved = true;
                continue;
            }
        }
        if (!moved) {
            await expect.poll(() => matchRevision(fixture), { timeout: 15000 }).not.toBe(lastRevision);
        }
        lastRevision = await matchRevision(fixture);
    }
    expect(milestones).toEqual({ drew: true, legal: true, wild: true });
}

async function expectTapTarget(page, locator) {
    await expect(locator).toBeVisible();
    const box = await locator.boundingBox();
    const { width: vw, height: vh } = page.viewportSize();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect(box?.y).toBeGreaterThanOrEqual(0);
    expect(box && box.x + box.width).toBeLessThanOrEqual(vw);
    expect(box && box.y + box.height).toBeLessThanOrEqual(vh);
}

async function expectHandInsidePanel(page) {
    const panel = page.locator('details.arcade-eights[open]');
    await expect(panel).toBeVisible();
    const bounds = await panel.evaluate(node => {
        const r = node.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, clientHeight: node.clientHeight, scrollHeight: node.scrollHeight };
    });
    const { height: vh, width: vw } = page.viewportSize();
    expect(bounds.top).toBeGreaterThanOrEqual(0);
    expect(bounds.bottom).toBeLessThanOrEqual(vh);
    expect(bounds.scrollHeight).toBeLessThanOrEqual(bounds.clientHeight + 1);
    const hand = panel.locator('[data-eights-hand]');
    await expect(hand).toBeVisible();
    await expect(hand.locator('[data-eights-card]')).not.toHaveCount(0);
    const layout = await hand.evaluate((node, panelBounds) => {
        const row = node.getBoundingClientRect();
        const cards = [...node.querySelectorAll('[data-eights-card]')].map(child => {
            const r = child.getBoundingClientRect();
            return { bottom: r.bottom, top: r.top, left: r.left, right: r.right, width: r.width, height: r.height };
        });
        return { row: { bottom: row.bottom, top: row.top, left: row.left, right: row.right, width: row.width, height: row.height }, cards, panelBounds };
    }, bounds);
    expect(layout.row.height).toBeGreaterThan(0);
    expect(layout.row.bottom).toBeLessThanOrEqual(bounds.bottom + 0.5);
    expect(layout.row.top).toBeGreaterThanOrEqual(bounds.top);
    expect(layout.row.right).toBeLessThanOrEqual(vw);
    for (const card of layout.cards) {
        expect(card.width).toBeGreaterThan(0);
        expect(card.height).toBeGreaterThan(0);
        expect(card.bottom).toBeLessThanOrEqual(bounds.bottom + 0.5);
        expect(card.top).toBeGreaterThanOrEqual(bounds.top);
        expect(card.left).toBeGreaterThanOrEqual(bounds.left);
        expect(card.right).toBeLessThanOrEqual(bounds.right + 0.5);
    }
}

async function expectEightsControls(page) {
    const table = page.locator('[data-eights-table]');
    await expect(table).toBeVisible();
    for (const selector of ['[data-eights-action="draw"]', '[data-eights-action="pass"]', '[data-eights-action="resign"]', '[data-eights-action="leave"]']) {
        const control = table.locator(selector);
        if (await control.isVisible()) await expectTapTarget(page, control);
    }
    for (const card of await table.locator('[data-eights-card]:enabled').all()) await expectTapTarget(page, card);
    const choose = page.locator('[data-eights-choose]:not([hidden])');
    if (await choose.count()) {
        for (const suit of await page.locator('[data-eights-suits]').getByRole('button').all()) await expectTapTarget(page, suit);
    }
}

async function expectWatcherPrivacy(fixture, host, watcher) {
    await invite(host, watcher, 'DemoWatcher');
    await watcher.getByRole('combobox', { name: 'Switch game' }).selectOption('crapeights');
    await expect(watcher.locator('[data-eights-table]')).toBeVisible();
    await expect(watcher.locator('[data-eights-hand-label]')).toHaveText('Watching · hands are private');
    await expect(watcher.locator('[data-eights-hand] button')).toHaveCount(0);
    await expect(watcher.locator('[data-eights-card]')).toHaveCount(0);
    const seat = fixture.view('DemoWatcher', 'crapeights')?.deserializeAttachment()?.seat ?? null;
    expect(seat).toBeNull();
    const handsIn = value => Array.isArray(value) ? value.flatMap(handsIn)
        : value && typeof value === 'object'
            ? Object.entries(value).flatMap(([key, child]) => key.toLowerCase() === 'hand' ? [child] : handsIn(child)) : [];
    const watcherHands = fixture.frames('DemoWatcher').map(raw => JSON.parse(raw)).flatMap(handsIn);
    expect(watcherHands.length).toBeGreaterThan(0);
    for (const hand of watcherHands) expect(hand).toEqual([]);
}

for (const viewport of [{ width: 375, height: 667 }, { width: 390, height: 844 }]) {
    test.describe(`${viewport.width}×${viewport.height} Crazy Eights demo tap-through`, () => {
        test.beforeEach(() => test.slow());

        test('invite play, draw, legal card, wild eight, layout and watcher privacy', async ({ browser, baseURL }) => {
            const fixture = await gameNight(browser, baseURL);
            try {
                const { travis, candace } = await seatedEights(fixture, viewport);
                const watcher = await fixture.phone('DemoWatcher', { viewport });
                await expectWatcherPrivacy(fixture, travis, watcher);

                await runDemoPlays(fixture, travis, candace);

                for (const page of [travis, candace]) {
                    await expectHandInsidePanel(page);
                    await expectEightsControls(page);
                    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
                }
                await expect(watcher.locator('[data-eights-hand] button')).toHaveCount(0);
                expect(fixture.errors()).toEqual([]);
            } finally { await fixture.close(); }
        });
    });
}