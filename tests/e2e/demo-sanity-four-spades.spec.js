// Phone sanity for four-player (cutthroat) Spades. Real lobby client, production
// match transport and Spades rules; only the Durable Object shell is in-memory.
// Two phone sizes walk invite -> seat -> bid -> first trick -> scoreboard.
const { randomBytes, randomUUID } = require('node:crypto');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const LOBBY = '/r/45662413410ed051/lobby/';
const PREVIEW = 'local-preview-key-0001';
const GAME = 'turdspades';
const NICKS = ['SouthHost', 'WestPhone', 'NorthPhone', 'EastPhone'];
const SEATS = ['South', 'West', 'North', 'East'];
const VIEWPORTS = [
    { width: 390, height: 844 },
    { width: 375, height: 667 }
];
const TAP = 44;
const DEAD_END = /wait(ing)? for (the )?host|return to your game night room|couldn.t reconnect|ask your host|seat is unavailable|move was not confirmed|reconnect table|reconnecting|link still works/i;

test.describe.configure({ timeout: 180_000 });

test.describe('four-player Spades phone sanity', () => {
    for (const viewport of VIEWPORTS) {
        test(`${viewport.width}x${viewport.height}: invite, seat, bid, first trick, scoreboard`, async ({ browser, baseURL }) => {
            const fixture = await gameNight(browser, baseURL, viewport);
            const measured = [];
            try {
                const pages = await room(fixture, NICKS, viewport, measured);
                const [host, ...guests] = pages;
                await Promise.all(pages.map(showSpades));
                await tapFloor(host.getByRole('button', { name: 'Open 4-player Spades' }), `${viewport.width} open`, measured);
                await host.getByRole('button', { name: 'Open 4-player Spades' }).tap();
                for (const [index, guest] of guests.entries()) {
                    const seat = SEATS[index + 1];
                    const join = guest.getByRole('button', { name: `Join ${seat}` });
                    await tapFloor(join, `${viewport.width} join ${seat}`, measured);
                    await join.tap();
                }
                for (const [index, page] of pages.entries()) {
                    await expect(page.locator('[data-spades-table]')).toBeVisible();
                    await expect(page.locator('[data-spades-table]')).toHaveAttribute('data-mode', 'four');
                    await expect(page.locator('[data-spades-table]')).toHaveAttribute('data-phase', 'bid');
                    await expect(page.locator('[data-spades-card]')).toHaveCount(13);
                    await expect(page.locator('[data-spades-hand-label]')).toHaveText('Your hand · 13 cards');
                    await expect(page.locator('[data-spades-trick]')).toContainText(`${SEATS[index]} (you)`);
                    for (const other of SEATS) {
                        if (other !== SEATS[index]) await expect(page.locator('[data-spades-trick]')).not.toContainText(`${other} (you)`);
                    }
                    await expect(page.locator('.arcade-card-score')).toBeHidden();
                    await expect(page.locator('[data-spades-error]')).toHaveText('');
                }
                const deal = await readHands(pages);
                expect(deal.map(hand => hand.length)).toEqual([13, 13, 13, 13]);
                assertDisjoint(deal, 52);
                assertOwnWire(fixture, deal);
                const seen = await Promise.all(pages.map(watchStatus));

                for (const [index, page] of pages.entries()) await panelFloor(page, `${viewport.width} ${NICKS[index]} bid`, measured);
                for (const page of pages) await tapFloor(page.locator('[data-send]'), `${viewport.width} send during bid`, measured);

                for (let bid = 0; bid < 4; bid++) {
                    const index = await playerToAct(pages, /Your bid/);
                    const page = pages[index];
                    await tapFloor(page.locator('#spades-bid'), `${viewport.width} ${NICKS[index]} bid select`, measured);
                    const bidForMe = page.getByRole('button', { name: 'Bid for me' });
                    await tapFloor(bidForMe, `${viewport.width} ${NICKS[index]} bid button`, measured);
                    await bidForMe.tap();
                }
                for (const page of pages) {
                    await expect(page.locator('[data-spades-table]')).toHaveAttribute('data-phase', 'play');
                    await expect(page.locator('[data-spades-bid]')).toBeHidden();
                }

                for (let play = 0; play < 4; play++) {
                    const index = await playerToAct(pages, /Your play/);
                    const page = pages[index];
                    const card = page.locator('[data-spades-card]:enabled').first();
                    await tapFloor(card, `${viewport.width} ${NICKS[index]} trick card`, measured);
                    await card.tap();
                    await expect(page.locator('[data-spades-card]')).toHaveCount(12);
                }

                for (const page of pages) {
                    await expect(page.locator('[data-spades-status]')).toContainText('won the last trick');
                    await expect(page.locator('[data-spades-table]')).toHaveAttribute('data-phase', 'play');
                    const faces = await page.locator('[data-spades-trick] b').allTextContents();
                    expect(faces).toHaveLength(4);
                    expect(faces.every(face => face !== '—')).toBe(true);
                    const score = page.locator('.arcade-card-score');
                    await expect(score).toBeVisible();
                    await expect(page.locator('[data-spades-score="0"]')).toHaveText(/South \+ North · \d+\/250 · \d+ bags/);
                    await expect(page.locator('[data-spades-score="1"]')).toHaveText(/West \+ East · \d+\/250 · \d+ bags/);
                    await expect(score).toBeInViewport({ ratio: 1 });
                    const box = await score.boundingBox();
                    measured.push({ label: `${viewport.width} scoreboard`, width: box.width, height: box.height, tap: false });
                    await expect(page.locator('[data-spades-hand-label]')).toHaveText('Your hand · 12 cards');
                    await expect(page.locator('[data-spades-error]')).toHaveText('');
                    await panelFloor(page, `${viewport.width} ${await page.locator('[data-nick]').inputValue()} scoreboard`, measured);
                    await tapFloor(page.locator('[data-send]'), `${viewport.width} send after trick`, measured);
                    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
                }
                const remain = await readHands(pages);
                expect(remain.map(hand => hand.length)).toEqual([12, 12, 12, 12]);
                assertDisjoint(remain, 48);
                for (const [index, hand] of remain.entries()) expect(hand.every(id => deal[index].includes(id))).toBe(true);
                assertOwnWire(fixture, deal);

                for (const [index, page] of pages.entries()) {
                    const lines = await seen[index]();
                    expect(lines.filter(text => DEAD_END.test(text))).toEqual([]);
                    expect(lines.every(text => text.trim().length > 0)).toBe(true);
                }
                expect(fixture.errors()).toEqual([]);
            } finally {
                const taps = measured.filter(box => box.tap !== false);
                if (taps.length) {
                    const area = box => Math.min(box.width, box.height);
                    const smallest = taps.reduce((best, box) => area(box) < area(best) ? box : best);
                    console.log(JSON.stringify({
                        viewport,
                        tapControls: taps.length,
                        minTapWidth: Math.min(...taps.map(box => box.width)),
                        minTapHeight: Math.min(...taps.map(box => box.height)),
                        smallest: { label: smallest.label, width: smallest.width, height: smallest.height },
                        scoreboards: measured.filter(box => box.tap === false)
                    }));
                }
                await fixture.close();
            }
        });
    }
});

async function tapFloor(locator, label, measured) {
    await expect(locator, label).toBeVisible();
    const box = await locator.boundingBox();
    expect(box, `${label} is laid out`).not.toBeNull();
    expect(Math.min(box.width, box.height), `${label} is ${box.width}x${box.height}`).toBeGreaterThanOrEqual(TAP);
    await expect(locator, `${label} is ${box.width}x${box.height} and fully in view`).toBeInViewport({ ratio: 1 });
    measured.push({ label, width: box.width, height: box.height, tap: true });
}

async function panelFloor(page, label, measured) {
    const controls = page.locator('details.arcade-spades').locator('button, select, summary').filter({ visible: true });
    const count = await controls.count();
    expect(count, `${label} has controls`).toBeGreaterThan(0);
    for (let index = 0; index < count; index++) await tapFloor(controls.nth(index), `${label} #${index}`, measured);
}

async function readHands(pages) {
    return Promise.all(pages.map(page => page.locator('[data-spades-card]').evaluateAll(nodes => nodes.map(node => node.dataset.spadesCard))));
}

function assertDisjoint(hands, size) {
    const flat = hands.flat();
    expect(new Set(flat).size).toBe(size);
    expect(flat.length).toBe(size);
}

function assertOwnWire(fixture, deal) {
    for (const [index, nick] of NICKS.entries()) {
        const own = new Set(deal[index]);
        const frames = fixture.people.get(nick).matchFrames.map(raw => JSON.parse(raw)).filter(frame => frame.state?.match);
        expect(frames.length, `${nick} received a hand`).toBeGreaterThan(0);
        for (const frame of frames) {
            const match = frame.state.match;
            expect(match.hands).toBeUndefined();
            const shown = (match.hand || []).map(card => String(card.id));
            expect(shown.every(id => own.has(id)), `${nick} hand`).toBe(true);
            const leaked = [...JSON.stringify(match).matchAll(/"id":(\d+)/g)].map(hit => hit[1]).filter(id => !own.has(id));
            expect(leaked, `${nick} wire`).toEqual([]);
        }
    }
}

async function playerToAct(pages, pattern) {
    let index = -1;
    await expect.poll(async () => {
        const messages = await Promise.all(pages.map(page => page.locator('[data-spades-status]').textContent()));
        index = messages.findIndex(message => pattern.test(message || ''));
        return index;
    }, { timeout: 20_000 }).toBeGreaterThanOrEqual(0);
    return index;
}

async function watchStatus(page) {
    await page.locator('[data-spades-status]').evaluate(node => {
        window.__spadesStatus = [node.textContent];
        new MutationObserver(() => window.__spadesStatus.push(node.textContent)).observe(node, { childList: true, characterData: true, subtree: true });
    });
    return () => page.evaluate(() => window.__spadesStatus);
}

async function showSpades(page) {
    const picker = page.getByRole('combobox', { name: 'Switch game' });
    await expect(picker.locator('option[value="turdspades"]')).toBeEnabled();
    await picker.selectOption(GAME);
    await expect(page.locator('[data-spades-status]')).toBeVisible();
}

async function enter(page, nick) {
    const field = page.locator('[data-nick]');
    if (nick && await field.inputValue() !== nick) await field.fill(nick);
    await page.locator('[data-enter]').tap();
    await expect(page.locator('[data-connection]')).toHaveText('Connected');
}

async function room(fixture, nicks, viewport, measured) {
    const pages = await Promise.all(nicks.map(nick => fixture.phone(nick)));
    const [host, ...guests] = pages;
    const start = host.getByRole('button', { name: /Game Night/ });
    if (!await start.isVisible()) await host.locator('.phonetabs [data-show="rooms"]').tap();
    // The room directory is a scrollable list. Bring Game Night up, then require the tile itself to fit.
    await start.scrollIntoViewIfNeeded();
    await tapFloor(start, `${viewport.width} Game Night`, measured);
    await start.tap();
    await expect(host.getByRole('region', { name: /Game Night/ })).toBeVisible();
    for (const [index, guest] of guests.entries()) await invite(host, guest, nicks[index + 1], viewport, measured);
    return pages;
}

async function invite(host, guest, nick, viewport, measured) {
    const open = host.getByRole('button', { name: 'Invite players' });
    await tapFloor(open, `${viewport.width} invite players`, measured);
    await open.tap();
    const person = host.getByRole('button', { name: `Invite ${nick}`, exact: true });
    await tapFloor(person, `${viewport.width} invite ${nick}`, measured);
    await person.tap();
    const join = guest.locator('[data-game-offer]').getByRole('button', { name: 'Join Game Night' });
    await tapFloor(join, `${viewport.width} ${nick} join room`, measured);
    await join.tap();
    await expect(guest.getByRole('region', { name: /Game Night/ })).toBeVisible();
    if (await host.locator('[data-invite-dialog][open]').count()) await host.keyboard.press('Escape');
}

async function gameNight(browser, baseURL, viewport) {
    const { createLobby } = await import('../../hangout-worker/src/lobby-core.mjs');
    const { arcadeGame, arcadeRoomRequest, createArcadeTransport } = await import('../../hangout-worker/src/arcade-transport.mjs');
    const contexts = [], lobbySockets = new Map(), people = new Map(), matchSockets = [], departures = [], records = new Map();
    let at = 1800000000000, alarm = null, upgrading = null, queue = Promise.resolve();
    const priorPair = globalThis.WebSocketPair;
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
        const sent = frame.t === 'hello' ? { ...frame, features: { ...frame.features, arcadeTurdSpades: 1 } } : frame;
        lobbySockets.get(id)?.send(JSON.stringify(sent));
    } });
    const transport = createArcadeTransport({
        name: GAME, state,
        current: scope => {
            const person = connection(scope.actor);
            if (!person || !lobbySockets.has(scope.actor)) return null;
            const member = engine.arcadeActor(scope, false);
            return member ? { ...person.identity, ...member, socket: person } : null;
        },
        active: async () => true, charge: async () => true, allowed: () => true,
        approve: async actor => (await engine.approveArcade(actor))?.ok === true
    });
    async function reconcile() {
        for (const departure of departures.splice(0)) await transport.revoke(departure.scope, departure.subject);
        transport.reconcile();
    }
    globalThis.WebSocketPair = class { constructor() { this[0] = {}; this[1] = upgrading; } };
    const retire = async socket => {
        if (socket.readyState !== 1) return;
        const scope = socket.deserializeAttachment();
        socket.serializeAttachment({ ...scope, retired: true });
        socket.readyState = 3;
        await transport.presenceChanged(scope);
    };

    async function phone(nick) {
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
            if (game !== GAME || !scope) return route.fulfill({ status: 404, json: { error: 'not found' } });
            const response = await serial(() => transport.issue(scope, session));
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
        await page.routeWebSocket(url => /-match$/.test(url.pathname) && arcadeGame(url.pathname) === GAME, route => {
            let attachment = null;
            const socket = { readyState: 1, serializeAttachment: value => { attachment = value; }, deserializeAttachment: () => attachment,
                send: raw => {
                    if (socket.readyState !== 1) return;
                    route.send(raw);
                    person.matchFrames.push(String(raw));
                },
                close: (code = 1000, reason = '') => { if (socket.readyState !== 1) return; socket.readyState = 3; void route.close({ code, reason }); } };
            route.onMessage(raw => void serial(() => transport.receive(socket, String(raw))));
            route.onClose(() => void serial(() => retire(socket)));
            void serial(async () => {
                upgrading = socket;
                try {
                    const refused = await transport.upgrade(route.protocols().join(', '), session);
                    socket.readyState = 3;
                    await route.close({ code: 1008, reason: `upgrade refused ${refused.status}` });
                } catch (error) {
                    if (!(error instanceof RangeError) || !matchSockets.includes(socket)) throw error;
                    person.matches.set(GAME, socket);
                } finally { upgrading = null; }
            });
        });
        await page.goto(`${LOBBY}?preview=${PREVIEW}&relay=${encodeURIComponent(hangoutRelayWsBase(baseURL, 'demo-sanity-four-spades'))}`);
        await enter(page, nick);
        return page;
    }

    return {
        phone, people,
        errors: () => [...people.values()].flatMap(person => person.errors.map(error => `${person.nick}: ${error}`)),
        close: async () => {
            globalThis.WebSocketPair = priorPair;
            await Promise.all(contexts.map(context => context.close()));
        }
    };
}
