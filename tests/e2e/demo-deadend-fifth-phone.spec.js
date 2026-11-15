// Dead-end check: a fifth phone opens the same Game Night invite after four
// people are seated at Spades. Real lobby client, production match transport.
// The Durable Object shell is in-memory, same as family-alpha-gate.spec.js.
const { randomBytes, randomUUID } = require('node:crypto');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const PHONE = { width: 390, height: 844 };
const LOBBY = '/r/45662413410ed051/lobby/';
const PREVIEW = 'local-preview-key-0001';
const GAME = 'turdspades';
const WAIT_LINE = 'Table full. You’re in line for the next open seat.';
const WATCH_LABEL = 'Watching · hands are private';
const HOST_WAIT = /wait(ing)? for (the )?host/i;
const NICKS = ['HostExample', 'GuestWest', 'GuestNorth', 'GuestEast'];
const FIFTH = 'FifthPhone';
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

    async function phone(nick, viewport = PHONE) {
        const sid = randomUUID(), session = { betaSid: sid, betaInviteVersion: '1' };
        const person = { nick, sid, identity: null, match: null, matchFrames: [] };
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
            const identity = { id: 'c' + randomBytes(16).toString('hex'), dev: `device-${nick}`, iph: `hash-${nick}`, role: 'fan', account: '', admin: false, ...session };
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
                    person.match = socket;
                } finally { upgrading = null; }
            });
        });
        await page.goto(`${LOBBY}?preview=${PREVIEW}&relay=${encodeURIComponent(hangoutRelayWsBase(baseURL, 'fifth-phone'))}`);
        await enter(page, nick);
        return page;
    }

    return {
        phone, people,
        view: nick => people.get(nick).match,
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

async function showTable(page) {
    const picker = page.getByRole('combobox', { name: 'Switch game' });
    await expect(picker.locator(`option[value="${GAME}"]`)).toBeEnabled();
    await picker.selectOption(GAME);
    await expect(page.locator('[data-spades-status]')).toBeVisible();
}

function parsedFrames(person) {
    return person.matchFrames.map(raw => JSON.parse(raw));
}

function handsIn(person) {
    return parsedFrames(person).flatMap(frame => Array.isArray(frame.state?.match?.hand) ? [frame.state.match.hand] : []);
}

test.describe('fifth phone on a full Spades table', () => {
    test.beforeEach(() => test.slow());

    test('watches without private cards, can wait or leave, and joins when a seat frees', async ({ browser, baseURL }, testInfo) => {
        const fixture = await gameNight(browser, baseURL);
        const measured = {};
        try {
            const pages = await Promise.all(NICKS.map(nick => fixture.phone(nick)));
            const [host, west, north, east] = pages;
            const start = host.getByRole('button', { name: /Game Night/ });
            if (!await start.isVisible()) await host.locator('.phonetabs [data-show="rooms"]').click();
            await start.click();
            await expect(host.getByRole('region', { name: /Game Night/ })).toBeVisible();
            await invite(host, west, NICKS[1]);
            await invite(host, north, NICKS[2]);
            await invite(host, east, NICKS[3]);
            await Promise.all(pages.map(showTable));
            await host.getByRole('button', { name: 'Open 4-player Spades' }).click();
            await west.getByRole('button', { name: 'Join West' }).click();
            await north.getByRole('button', { name: 'Join North' }).click();
            await east.getByRole('button', { name: 'Join East' }).click();
            for (const page of pages) {
                await expect(page.locator('[data-spades-table]')).toBeVisible();
                await expect(page.locator('[data-spades-hand] button')).toHaveCount(13);
            }

            const extra = await fixture.phone(FIFTH, PHONE);
            await invite(host, extra, FIFTH);
            await showTable(extra);
            const spades = extra.locator('details', { has: extra.locator('[data-spades-status]') });
            const status = extra.locator('[data-spades-status]');
            const waitLine = spades.locator('[data-next-game]');
            const leave = extra.locator('[data-leave]');
            await expect(extra.locator('[data-spades-table]')).toBeVisible();
            await expect(extra.locator('[data-spades-hand-label]')).toHaveText(WATCH_LABEL);
            await expect(status).not.toHaveText(HOST_WAIT);
            await expect(waitLine).toBeVisible();
            await expect(leave).toBeVisible();
            await expect(leave).toBeEnabled();

            const screen = await extra.evaluate(() => ({
                width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth
            }));
            const seat = fixture.view(FIFTH)?.deserializeAttachment()?.seat ?? null;
            const watchFrames = fixture.people.get(FIFTH).matchFrames.slice();
            const watchViews = watchFrames.map(raw => JSON.parse(raw)).filter(frame => frame.state?.match);
            const handCards = watchViews.reduce((count, frame) => count + (frame.state.match.hand?.length || 0), 0);
            const seatedHands = NICKS.flatMap(nick => handsIn(fixture.people.get(nick)).filter(hand => hand.length === 13));
            const panelHtml = await extra.locator('.arcade-spades').innerHTML();
            const domCards = await extra.locator('[data-spades-card]').count();
            const leakedHands = seatedHands.filter(hand => watchFrames.some(raw => raw.includes(JSON.stringify(hand)))).length;
            const leakedMarks = await extra.locator('[data-spades-hand]').evaluate(node => node.textContent);
            const leaveBox = await leave.boundingBox();
            const waitBox = await waitLine.boundingBox();
            measured.viewport = screen;
            measured.seatWhileFull = seat;
            measured.watchFrames = watchFrames.length;
            measured.watchViews = watchViews.length;
            measured.watcherHandCards = handCards;
            measured.domCards = domCards;
            measured.seatedHandsChecked = seatedHands.length;
            measured.leakedHands = leakedHands;
            measured.handRegionText = leakedMarks;
            measured.waitLine = await waitLine.textContent();
            measured.leaveEnabled = await leave.isEnabled();
            measured.leaveBox = leaveBox;
            measured.waitBox = waitBox;
            measured.status = await status.textContent();
            console.log('fifth-phone-watch ' + JSON.stringify(measured));

            expect(screen).toMatchObject(PHONE);
            expect(screen.scrollWidth).toBeLessThanOrEqual(PHONE.width);
            expect(seat).toBeNull();
            expect(await extra.locator('[data-spades-table]').evaluate(node => node.hasAttribute('data-watching'))).toBe(true);
            await expect(extra.locator('[data-spades-seats]')).toBeHidden();
            await expect(extra.getByRole('button', { name: /^Join / })).toHaveCount(0);
            expect(await waitLine.isVisible() || (await leave.isVisible() && await leave.isEnabled()),
                'fifth phone has no way to wait for a seat or leave').toBe(true);
            await expect(waitLine).toHaveText(WAIT_LINE);
            expect(watchViews.length).toBeGreaterThan(0);
            expect(handCards).toBe(0);
            expect(domCards).toBe(0);
            expect(leakedMarks).toBe('');
            for (const frame of watchViews) {
                expect(frame.state.match.hand).toEqual([]);
                expect(frame.state.match.hands).toBeUndefined();
                expect(frame.state.seat ?? null).toBeNull();
            }
            expect(watchFrames.join('\n')).not.toMatch(/"playable"|"hands"|"suit"/);
            expect(leakedHands).toBe(0);
            expect(panelHtml).not.toMatch(/data-spades-card=/);

            const firstId = handsIn(fixture.people.get(NICKS[0])).length;
            await east.locator('[data-spades-action="resign"]').click();
            await east.getByRole('dialog', { name: 'Resign for your team?' }).getByRole('button', { name: 'Resign', exact: true }).click();
            await expect(status).toContainText('win by resignation');
            await east.locator('[data-spades-action="leave"]').click();
            const release = east.getByRole('dialog', { name: 'Leave this table?' });
            await expect(release).toContainText('You’ll free your seat. The table stays open.');
            await release.getByRole('button', { name: 'Leave table', exact: true }).click();

            const join = extra.getByRole('button', { name: 'Join East', exact: true });
            await expect.poll(async () => {
                const taken = fixture.view(FIFTH)?.deserializeAttachment()?.seat;
                if (taken) return taken;
                return await join.isVisible() ? 'join-offered' : '';
            }).not.toBe('');
            if (await join.isVisible()) await join.click();
            await expect.poll(() => fixture.view(FIFTH)?.deserializeAttachment()?.seat).toBe('east');
            await expect(extra.locator('[data-spades-hand] button')).toHaveCount(13);
            await expect(extra.locator('[data-spades-hand-label]')).toContainText('Your hand · 13 cards');
            expect(await extra.locator('[data-spades-table]').evaluate(node => node.hasAttribute('data-watching'))).toBe(false);

            const ownHand = handsIn(fixture.people.get(FIFTH)).findLast(hand => hand.length === 13);
            const otherHands = ['HostExample', 'GuestWest', 'GuestNorth'].flatMap(nick => {
                const dealt = handsIn(fixture.people.get(nick)).filter(hand => hand.length === 13);
                return dealt.length ? [dealt.at(-1)] : [];
            });
            const joinedFrames = fixture.people.get(FIFTH).matchFrames.slice(watchFrames.length);
            measured.ownCardsAfterJoin = ownHand?.length ?? 0;
            measured.otherHandsAfterJoin = otherHands.length;
            measured.otherHandsLeakedAfterJoin = otherHands.filter(hand => joinedFrames.some(raw => raw.includes(JSON.stringify(hand)))).length;
            measured.seatAfterJoin = fixture.view(FIFTH).deserializeAttachment().seat;
            measured.priorHandFrames = firstId;
            measured.errors = fixture.errors();
            console.log('fifth-phone-join ' + JSON.stringify(measured));
            await testInfo.attach('fifth-phone-deadend', { body: JSON.stringify(measured, null, 2), contentType: 'application/json' });

            expect(ownHand).toHaveLength(13);
            expect(otherHands).toHaveLength(3);
            expect(measured.otherHandsLeakedAfterJoin).toBe(0);
            for (const nick of ['HostExample', 'GuestWest', 'GuestNorth']) {
                expect(fixture.view(nick).deserializeAttachment().seat).toBeTruthy();
            }
            expect(fixture.view('GuestEast').deserializeAttachment().seat).toBeNull();
            expect(fixture.errors()).toEqual([]);
        } finally { await fixture.close(); }
    });
});
