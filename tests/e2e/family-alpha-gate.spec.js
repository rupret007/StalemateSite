// Family-alpha acceptance: the four graded Game Night games must have no dead
// ends for a stranger on a phone (390x844).
//
// Real lobby client in real browsers, the production lobby engine
// (lobby-core.mjs) and the production match transport (arcade-transport.mjs,
// game-night-sockets.mjs, game-night-table.mjs and each game's rules). Only the
// Durable Object shell is synthetic: storage is an in-memory map, the page's
// WebSockets are routed to those engines in this process, and the protected
// shell marker is added the same way lobby-invitation-lifecycle.spec.js adds it.
// tests/runtime/arcade-transport.mjs runs the same code inside workerd.
const { randomBytes, randomUUID } = require('node:crypto');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const PHONE = { width: 390, height: 844 };
const LOBBY = '/r/45662413410ed051/lobby/';
const PREVIEW = 'local-preview-key-0001';
const WAIT_FOR_HOST = /wait(ing)? for (the )?host/i;
const arcadeFeatures = { arcadeChess: 1, arcadeTurdSpades: 1, arcadeTurdanoid: 1 };

async function gameNight(browser, baseURL) {
    const { createLobby } = await import('../../hangout-worker/src/lobby-core.mjs');
    const { arcadeGame, arcadeRoomRequest, createArcadeTransport } = await import('../../hangout-worker/src/arcade-transport.mjs');
    const contexts = [], lobbySockets = new Map(), people = new Map(), matchSockets = [], departures = [], records = new Map();
    let at = 1800000000000, alarm = null, upgrading = null, queue = Promise.resolve();
    // A Durable Object handles one event at a time.
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
        // lobby-do.mjs retires a match seat when its player parts the room.
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
    // lobby-do.mjs reconcileArcade(): runs after every lobby event.
    async function reconcile() {
        for (const departure of departures.splice(0)) for (const transport of transports.values()) await transport.revoke(departure.scope, departure.subject);
        for (const transport of transports.values()) transport.reconcile();
    }
    // arcade-transport.mjs is written for workerd. The upgrade accepts this pair's
    // server end, then builds a 101 response that only workerd can construct.
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
        const person = { nick, sid, identity: null, matches: new Map() };
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
                send: raw => { if (socket.readyState === 1) route.send(raw); },
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
        await page.goto(`${LOBBY}?preview=${PREVIEW}&relay=${encodeURIComponent(hangoutRelayWsBase(baseURL, 'family-alpha-gate'))}`);
        await enter(page, nick);
        return page;
    }
    const table = name => transports.get(name);
    return {
        phone, people,
        // The live table as the server sees it for one phone.
        view: (nick, game) => people.get(nick).matches.get(game),
        // Send one match command as this phone's seat, exactly as its socket would.
        act: (nick, game, frame) => serial(() => table(game).receive(people.get(nick).matches.get(game), JSON.stringify({ version: 1, ...frame }))),
        // The network takes the match socket without a goodbye.
        dropMatch: (nick, game) => serial(async () => {
            const socket = people.get(nick).matches.get(game);
            const scope = socket.deserializeAttachment();
            socket.serializeAttachment({ ...scope, retired: true });
            socket.close(1012, 'Synthetic network loss');
            await table(game).presenceChanged(scope);
        }),
        // The network takes the lobby socket too.
        dropLobby: (nick, code = 1012) => serial(async () => {
            const { id } = people.get(nick).identity, socket = lobbySockets.get(id);
            lobbySockets.delete(id);
            await engine.disconnect(id);
            await socket.close({ code, reason: 'Synthetic network loss' });
            await reconcile();
        }),
        record: async game => [...(await storage.list({ prefix: game === 'chess' ? 'game-night-match:' : `game-night-${game}:` })).values()][0],
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

// The host opens Game Night and each guest accepts a person-bound invitation.
async function room(fixture, nicks) {
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
        live: [/^You’re White · Your turn/, /^You’re Black · White to move/],
        watching: /^Watching · White to move/,
        finished: /wins · /,
        rematch: /rematch/i,
        board: '.arcade-chess-board'
    },
    partners: {
        label: 'partners Spades', game: 'turdspades', status: '[data-spades-status]', seats: 2,
        open: host => host.getByRole('button', { name: 'Open 2-player Spades' }).click(),
        join: guest => guest.getByRole('button', { name: 'Join West' }).click(),
        live: [/computer partner|Round 1/, /computer partner|Waiting for the host to bid|Round 1/],
        watching: /Round 1/,
        finished: / win by resignation\./,
        rematch: /Spades rematch/,
        board: '[data-spades-table]'
    },
    four: {
        label: 'four-player Spades', game: 'turdspades', status: '[data-spades-status]', seats: 4,
        open: host => host.getByRole('button', { name: 'Open 4-player Spades' }).click(),
        join: (guest, index) => guest.getByRole('button', { name: `Join ${['West', 'North', 'East'][index]}` }).click(),
        live: [/^Round 1 · /, /^Round 1 · /, /^Round 1 · /, /^Round 1 · /],
        watching: /^Round 1 · /,
        finished: / win by resignation\./,
        rematch: /Spades rematch/,
        board: '[data-spades-table]'
    },
    turdanoid: {
        label: 'Turdanoid', game: 'turdanoid', status: '[data-brick-status]', seats: 2,
        open: host => host.getByRole('button', { name: 'Open Turdanoid race' }).click(),
        join: guest => guest.getByRole('button', { name: 'Join Turdanoid race' }).click(),
        live: [/\S/, /\S/],
        watching: /\S/,
        finished: /forfeit/,
        rematch: /Turdanoid rematch/,
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

// Everyone seated and the first deal, board or wall on screen.
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
// Records every status line a phone shows, so a transient dead-end message is caught.
async function watchStatus(page, game) {
    await page.evaluate(selector => {
        const node = document.querySelector(selector);
        window.__statusSeen = [node.textContent];
        new MutationObserver(() => window.__statusSeen.push(node.textContent)).observe(node, { childList: true, characterData: true, subtree: true });
    }, game.status);
    return () => page.evaluate(() => window.__statusSeen);
}
const finish = async (fixture, game, nick) => {
    const record = await fixture.record(game.game), saved = record[game.game];
    await fixture.act(nick, game.game, { action: 'resign', id: saved.id, revision: saved.match.revision ?? saved.match.state?.revision ?? 0 });
};

for (const game of Object.values(GAMES)) {
    const nicks = ['HostExample', 'GuestWest', 'GuestNorth', 'GuestEast'].slice(0, game.seats);
    const last = nicks.at(-1);

    test.describe(`${game.label} on phones`, () => {
        // Up to five phone browsers share one worker.
        test.beforeEach(() => test.slow());

        // BUG: a phone that arrives at a full table is never told the table is full
        // or that it is up next. It gets the watcher view with no seat control:
        // Chess r/45662413410ed051/lobby/arcade-chess.mjs:303 ("Watching · …"),
        // Spades arcade-turdspades.mjs:239-242 and :300, Turdanoid
        // arcade-turdanoid.mjs:300 (the wall name only). The server has no queue
        // either (hangout-worker/src/game-night-table.mjs:164-176 re-seats the
        // same roster on every rematch).
        test.fixme(`2. one phone too many is told the table is full and that it is up next game`, async ({ browser, baseURL }) => {
            const fixture = await gameNight(browser, baseURL);
            try {
                const pages = await seated(fixture, game, nicks);
                const extra = await fixture.phone('ExtraPhone');
                await invite(pages[0], extra, 'ExtraPhone');
                await showTable(extra, game);
                await expect(extra.locator(game.board)).toBeVisible();
                await expect(panel(extra, game)).toContainText(/table (is )?full/i);
                await expect(panel(extra, game)).toContainText(/up next|next game/i);
            } finally { await fixture.close(); }
        });

        test(`2a. one phone too many still gets the live table, with no seat button and no "wait for host"`, async ({ browser, baseURL }) => {
            const fixture = await gameNight(browser, baseURL);
            try {
                const pages = await seated(fixture, game, nicks);
                const extra = await fixture.phone('ExtraPhone');
                await invite(pages[0], extra, 'ExtraPhone');
                await showTable(extra, game);
                await expect(extra.locator(game.board)).toBeVisible();
                await expect(status(extra, game)).toHaveText(game.watching);
                await expect(status(extra, game)).not.toHaveText(WAIT_FOR_HOST);
                await expect(panel(extra, game).getByRole('button', { name: /^Join /, includeHidden: false })).toHaveCount(0);
                expect(fixture.view('ExtraPhone', game.game).deserializeAttachment().seat).toBeNull();
                // Chat is the only way forward this phone has today.
                await expect(extra.locator('[data-send]')).toBeInViewport();
                expect(await extra.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(PHONE.width);
            } finally { await fixture.close(); }
        });

        test(`1. a phone that loses signal shows Reconnecting… then its own seat, never "wait for host"`, async ({ browser, baseURL }) => {
            const fixture = await gameNight(browser, baseURL);
            try {
                const pages = await seated(fixture, game, nicks);
                const guest = pages.at(-1), host = pages[0];
                const before = fixture.view(last, game.game).deserializeAttachment().seat;
                expect(before).toBeTruthy();
                const seen = await watchStatus(guest, game);
                const pill = panel(guest, game).locator('.arcade-reconnect');
                await guest.context().setOffline(true);
                await expect(pill).toBeVisible();
                await expect(pill).toHaveText('Reconnecting…');
                await expect(status(host, game)).toContainText('link still works');
                await guest.context().setOffline(false);
                await expect(pill).toBeHidden();
                await expect(status(guest, game)).toHaveText(game.live.at(-1));
                await expect(guest.locator(game.board)).toBeVisible();
                await expect.poll(() => fixture.view(last, game.game).deserializeAttachment().seat).toBe(before);
                await expect(status(host, game)).not.toContainText('link still works');
                expect((await seen()).filter(text => WAIT_FOR_HOST.test(text) && !/to bid/.test(text))).toEqual([]);
                expect(await guest.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(PHONE.width);
                expect(fixture.errors()).toEqual([]);
            } finally { await fixture.close(); }
        });

        test('1b. a match socket cut by the network comes back on its own', async ({ browser, baseURL }) => {
            const fixture = await gameNight(browser, baseURL);
            try {
                const pages = await seated(fixture, game, nicks);
                const guest = pages.at(-1);
                const before = fixture.view(last, game.game);
                const seat = before.deserializeAttachment().seat;
                const seen = await watchStatus(guest, game);
                await fixture.dropMatch(last, game.game);
                await expect.poll(() => fixture.view(last, game.game) !== before && fixture.view(last, game.game).deserializeAttachment().seat).toBe(seat);
                await expect(status(guest, game)).toHaveText(game.live.at(-1));
                expect((await seen()).filter(text => WAIT_FOR_HOST.test(text) && !/to bid/.test(text))).toEqual([]);
            } finally { await fixture.close(); }
        });

        test('1c. a reloaded phone returns to its own seat after one tap', async ({ browser, baseURL }) => {
            const fixture = await gameNight(browser, baseURL);
            try {
                const pages = await seated(fixture, game, nicks);
                const guest = pages.at(-1);
                const seat = fixture.view(last, game.game).deserializeAttachment().seat;
                await guest.reload();
                await expect(guest.locator('[data-nick]')).toHaveValue(last);
                await enter(guest);
                await expect(status(guest, game)).toHaveText(game.live.at(-1));
                await expect(guest.locator(game.board)).toBeVisible();
                await expect.poll(() => fixture.view(last, game.game).deserializeAttachment().seat).toBe(seat);
                await expect(status(guest, game)).not.toHaveText(/Waiting for the host to open/);
            } finally { await fixture.close(); }
        });

        // Both sockets die while the page stays up. dropLobby(4403) is the lobby
        // close; reconcile then closes the match with 4403 because membership
        // cannot be confirmed. The phone must show Reconnecting… and sit down
        // again on its own. A ban still uses this code with reason "banned".
        test('1d. total signal loss, including a 4403 close, shows Reconnecting… then its own seat', async ({ browser, baseURL }) => {
            const fixture = await gameNight(browser, baseURL);
            try {
                const pages = await seated(fixture, game, nicks);
                const guest = pages.at(-1);
                const before = fixture.view(last, game.game).deserializeAttachment().seat;
                expect(before).toBeTruthy();
                const seen = await watchStatus(guest, game);
                const pill = panel(guest, game).locator('.arcade-reconnect');
                await fixture.dropLobby(last, 4403);
                await expect(pill).toBeVisible();
                await expect(pill).toHaveText('Reconnecting…');
                await expect(pill).toBeHidden();
                await expect(status(guest, game)).toHaveText(game.live.at(-1));
                await expect(guest.locator(game.board)).toBeVisible();
                await expect(guest.locator('[data-connection]')).toHaveText('Connected');
                await expect(guest.locator('[data-game-offer]')).toBeHidden();
                await expect.poll(() => fixture.view(last, game.game)?.deserializeAttachment()?.seat).toBe(before);
                const lines = await seen();
                expect(lines.filter(text => WAIT_FOR_HOST.test(text) && !/to bid/.test(text))).toEqual([]);
                expect(lines.filter(text => /Return to your Game Night room|couldn.t reconnect|Ask your host/i.test(text))).toEqual([]);
                expect(await guest.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(PHONE.width);
                expect(fixture.errors()).toEqual([]);
            } finally { await fixture.close(); }
        });

        test('4. a finished game offers the host a one-tap rematch that seats everyone again', async ({ browser, baseURL }) => {
            const fixture = await gameNight(browser, baseURL);
            try {
                const pages = await seated(fixture, game, nicks);
                const seats = nicks.map(nick => fixture.view(nick, game.game).deserializeAttachment().seat);
                const first = (await fixture.record(game.game))[game.game].id;
                await finish(fixture, game, last);
                for (const page of pages) await expect(status(page, game)).toHaveText(game.finished);
                // Every seated phone has a visible, tappable rematch control.
                for (const page of pages) {
                    const ask = panel(page, game).getByRole('button', { name: game.rematch });
                    await expect(ask).toBeVisible();
                    await expect(ask).toBeInViewport();
                }
                const startNow = panel(pages[0], game).getByRole('button', { name: 'Start now', exact: true });
                await expect(startNow).toBeVisible();
                await startNow.tap();
                await expect.poll(async () => (await fixture.record(game.game))[game.game].id).not.toBe(first);
                for (const [index, page] of pages.entries()) {
                    await expect(status(page, game)).toHaveText(game.live[index]);
                    await expect(page.locator(game.board)).toBeVisible();
                    expect(fixture.view(nicks[index], game.game).deserializeAttachment().seat).toBe(seats[index]);
                }
                expect(fixture.errors()).toEqual([]);
            } finally { await fixture.close(); }
        });

        test('5. a late joiner can watch the game', async ({ browser, baseURL }) => {
            const fixture = await gameNight(browser, baseURL);
            try {
                const pages = await seated(fixture, game, nicks);
                const frames = [];
                const late = await fixture.phone('LateWatcher');
                late.on('websocket', socket => { if (/-match$/.test(new URL(socket.url()).pathname)) socket.on('framereceived', ({ payload }) => frames.push(String(payload))); });
                await invite(pages[0], late, 'LateWatcher');
                await showTable(late, game);
                await expect(late.locator(game.board)).toBeVisible();
                await expect(status(late, game)).toHaveText(game.watching);
                await expect(status(late, game)).not.toHaveText(WAIT_FOR_HOST);
                expect(fixture.view('LateWatcher', game.game).deserializeAttachment().seat).toBeNull();
                if (game.game === 'turdspades') {
                    await expect(late.locator('[data-spades-hand-label]')).toHaveText('Watching · hands are private');
                    await expect(late.locator('[data-spades-hand] button')).toHaveCount(0);
                    const views = frames.map(raw => JSON.parse(raw)).filter(frame => frame.state?.match);
                    expect(views.length).toBeGreaterThan(0);
                    for (const view of views) { expect(view.state.match.hand).toEqual([]); expect(view.state.match.hands).toBeUndefined(); }
                    expect(frames.join('\n')).not.toMatch(/"playable"/);
                }
                expect(await late.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(PHONE.width);
            } finally { await fixture.close(); }
        });
    });
}
