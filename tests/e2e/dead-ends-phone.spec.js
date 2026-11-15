// Phone check (390x844) that a full Game Night table and an expired invite
// both have a next step. The extra phone uses the real lobby client and match
// transport, the same way family-alpha-gate.spec.js does. The expired invite
// uses the real guest page (game-night-guest.js) and its beta stylesheet.
const { randomBytes, randomUUID } = require('node:crypto');
const path = require('node:path');
const { readFileSync } = require('node:fs');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const PHONE = { width: 390, height: 844 };
const LOBBY = '/r/45662413410ed051/lobby/';
const PREVIEW = 'local-preview-key-0001';
const ROOT = path.join(__dirname, '../..');
const WAIT_FOR_HOST = /wait(ing)? for (the )?host/i;
const UP_NEXT = "Table full, you're up next game";
const FRESH_LINK = 'Ask the host for a fresh link.';
const EXPIRED = 'This invite is no longer available. Ask your host for a new one.';
const arcadeFeatures = { arcadeChess: 1, arcadeTurdSpades: 1, arcadeTurdanoid: 1 };
// Fixture markers so the local beta shell will serve the guest page. Not credentials.
const shellEnv = () => ({
    HANGOUT_BETA_MODE: 'protected',
    HANGOUT_HMAC_KEY: 'h'.repeat(40),
    HANGOUT_BETA_INVITE_KEY: 'i'.repeat(40),
    HANGOUT_PREVIEW_KEY: 'p'.repeat(40),
    HANGOUT_GAME_NIGHT_GUESTS: '1',
    ASSETS: { fetch: async request => {
        const pathname = new URL(request.url).pathname;
        if (!pathname.startsWith('/r/45662413410ed051/')) return new Response('missing', { status: 404 });
        return new Response(readFileSync(path.join(ROOT, pathname.slice(1))));
    } },
    LOBBY: {}, QUOTA: {}, ROOMS: {}, BETA_SESSIONS: {}
});

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
    const transports = new Map(['chess', 'turdspades', 'turdanoid'].map(name => [name, createArcadeTransport({
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
    const relay = hangoutRelayWsBase(baseURL, 'dead-ends-' + randomBytes(4).toString('hex'));

    async function phone(nick) {
        const sid = randomUUID(), session = { betaSid: sid, betaInviteVersion: '1' };
        const person = { nick, sid, identity: null, matches: new Map(), matchFrames: [] };
        people.set(nick, person);
        const context = await browser.newContext({ viewport: PHONE, hasTouch: true });
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
        await page.goto(`${LOBBY}?preview=${PREVIEW}&relay=${encodeURIComponent(relay)}`);
        await enter(page, nick);
        return page;
    }
    return {
        phone, people,
        view: (nick, game) => people.get(nick).matches.get(game),
        act: (nick, game, frame) => serial(() => transports.get(game).receive(people.get(nick).matches.get(game), JSON.stringify({ version: 1, ...frame }))),
        record: async game => [...(await storage.list({ prefix: game === 'chess' ? 'game-night-match:' : `game-night-${game}:` })).values()][0],
        errors: () => [...people.values()].flatMap(person => person.errors.map(error => `${person.nick}: ${error}`)),
        seat: (nick, game) => people.get(nick).matches.get(game)?.deserializeAttachment()?.seat ?? null,
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

const GAMES = {
    chess: {
        label: 'Chess', game: 'chess', status: '[data-chess-status]',
        open: host => host.getByRole('button', { name: 'Open Chess match' }).click(),
        join: guest => guest.getByRole('button', { name: 'Join as Black' }).click(),
        live: [/^You’re White · Your turn/, /^You’re Black · White to move/],
        watching: /^Watching · /,
        board: '.arcade-chess-board'
    },
    partners: {
        label: 'partners Spades', game: 'turdspades', status: '[data-spades-status]',
        open: host => host.getByRole('button', { name: 'Open 2-player Spades' }).click(),
        join: guest => guest.getByRole('button', { name: 'Join West' }).click(),
        live: [/computer partner|Round 1/, /computer partner|Waiting for the host to bid|Round 1/],
        watching: /Round 1/,
        board: '[data-spades-table]'
    },
    four: {
        label: 'four-player Spades', game: 'turdspades', status: '[data-spades-status]', seats: 4,
        open: host => host.getByRole('button', { name: 'Open 4-player Spades' }).click(),
        join: (guest, index) => guest.getByRole('button', { name: `Join ${['West', 'North', 'East'][index]}` }).click(),
        live: [/^Round 1 · /, /^Round 1 · /, /^Round 1 · /, /^Round 1 · /],
        watching: /^Round 1 · /,
        board: '[data-spades-table]'
    },
    turdanoid: {
        label: 'Turdanoid', game: 'turdanoid', status: '[data-brick-status]',
        open: host => host.getByRole('button', { name: 'Open Turdanoid race' }).click(),
        join: guest => guest.getByRole('button', { name: 'Join Turdanoid race' }).click(),
        live: [/\S/, /\S/],
        watching: /\S/,
        board: '[data-brick-match]'
    }
};

const statusOf = (page, game) => page.locator(game.status);
const panelOf = (page, game) => page.locator('details', { has: page.locator(game.status) });

async function showTable(page, game) {
    const picker = page.getByRole('combobox', { name: 'Switch game' });
    await expect(picker.locator(`option[value="${game.game}"]`)).toBeEnabled();
    await picker.selectOption(game.game);
    await expect(statusOf(page, game)).toBeVisible();
}

async function seated(fixture, game, nicks) {
    const pages = await room(fixture, nicks);
    await Promise.all(pages.map(page => showTable(page, game)));
    await game.open(pages[0]);
    for (const [index, guest] of pages.slice(1).entries()) await game.join(guest, index);
    for (const [index, page] of pages.entries()) {
        await expect(page.locator(game.board)).toBeVisible();
        await expect(statusOf(page, game)).toHaveText(game.live[index]);
    }
    return pages;
}

function seatsOf(fixture, nicks, game) {
    return nicks.map(nick => fixture.seat(nick, game));
}

async function fits(page) {
    const box = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
    expect(box.scrollWidth).toBeLessThanOrEqual(box.innerWidth);
}

async function openExpiredInvite(browser, baseURL) {
    const { betaFetch } = await import('../../hangout-worker/src/beta-entry.mjs');
    const env = shellEnv();
    const code = 'expired-invite-fixture';
    const context = await browser.newContext({ viewport: PHONE, hasTouch: true });
    const origin = new URL(baseURL).origin;
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await context.route('**/beta/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (request.method() === 'POST' && url.pathname.startsWith('/beta/game-night/invitation/')) {
            await route.fulfill({ status: 410, contentType: 'application/json', body: JSON.stringify({ error: EXPIRED }) });
            return;
        }
        const result = await betaFetch(new Request(request.url(), { method: request.method(), headers: request.headers() }), env);
        const headers = Object.fromEntries(result.headers);
        delete headers['content-length'];
        await route.fulfill({ status: result.status, headers, body: Buffer.from(await result.arrayBuffer()) });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${baseURL}/beta/game-night/guest#invite=${code}`);
    return { page, context, errors, code };
}

for (const game of Object.values(GAMES)) {
    const nicks = ['HostExample', 'GuestWest', 'GuestNorth', 'GuestEast'].slice(0, game.seats || 2);

    test.describe(`${game.label} guest phone`, () => {
        test.beforeEach(() => test.slow());

        test('an extra phone sees the live table, an up-next status, and no seat', async ({ browser, baseURL }) => {
            const fixture = await gameNight(browser, baseURL);
            try {
                const pages = await seated(fixture, game, nicks);
                const held = seatsOf(fixture, nicks, game.game);
                expect(held.every(Boolean)).toBe(true);
                expect(new Set(held).size).toBe(nicks.length);
                const extra = await fixture.phone('ExtraPhone');
                await invite(pages[0], extra, 'ExtraPhone');
                await showTable(extra, game);
                await expect(extra.locator(game.board)).toBeVisible();
                await expect(statusOf(extra, game)).toHaveText(game.watching);
                await expect(statusOf(extra, game)).not.toHaveText(WAIT_FOR_HOST);
                const next = panelOf(extra, game).locator('[data-next-game]');
                await expect(next).toBeVisible();
                await expect(next).toHaveText(UP_NEXT);
                await expect(next).toBeInViewport();
                await expect(panelOf(extra, game).getByRole('button', { name: /join/i })).toHaveCount(0);
                await expect.poll(() => fixture.seat('ExtraPhone', game.game)).toBeNull();
                expect(seatsOf(fixture, nicks, game.game)).toEqual(held);
                if (game.game === 'turdspades') {
                    await expect(extra.locator('[data-spades-hand-label]')).toHaveText('Watching · hands are private');
                    await expect(extra.locator('[data-spades-hand] button')).toHaveCount(0);
                    const frames = fixture.people.get('ExtraPhone').matchFrames;
                    const views = frames.map(raw => JSON.parse(raw)).filter(frame => frame.state?.match);
                    expect(views.length).toBeGreaterThan(0);
                    for (const view of views) {
                        expect(view.state.match.hand).toEqual([]);
                        expect(view.state.match.hands).toBeUndefined();
                    }
                    expect(frames.join('\n')).not.toMatch(/"playable"/);
                }
                const id = (await fixture.record(game.game))[game.game].id;
                await fixture.act('ExtraPhone', game.game, { action: 'join', id, seat: 'next' });
                await expect.poll(() => fixture.seat('ExtraPhone', game.game)).toBeNull();
                expect(seatsOf(fixture, nicks, game.game)).toEqual(held);
                await fits(extra);
                expect(fixture.errors()).toEqual([]);
            } finally { await fixture.close(); }
        });

        test('an expired invite offers a tappable fresh-link ask and no private state', async ({ browser, baseURL }) => {
            const opened = await openExpiredInvite(browser, baseURL);
            try {
                const { page, context, errors, code } = opened;
                const status = page.locator('[data-guest-status]');
                const ask = page.getByRole('button', { name: FRESH_LINK, exact: true });
                await expect(status).toHaveText(EXPIRED);
                await expect(page.locator('[data-guest-join]')).toBeHidden();
                await expect(page.locator('[data-guest-retry]')).toBeHidden();
                await expect(ask).toBeVisible();
                await expect(ask).toBeEnabled();
                const box = await ask.evaluate(element => {
                    const rect = element.getBoundingClientRect();
                    return { width: rect.width, height: rect.height, top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
                });
                expect(box.width).toBeGreaterThanOrEqual(44);
                expect(box.height).toBeGreaterThanOrEqual(44);
                const viewport = page.viewportSize();
                expect(box.left).toBeGreaterThanOrEqual(0);
                expect(box.right).toBeLessThanOrEqual(viewport.width);
                expect(box.top).toBeGreaterThanOrEqual(0);
                expect(box.bottom).toBeLessThanOrEqual(viewport.height);
                await ask.tap();
                await expect(ask).toHaveText(/Ask the host for a fresh link\.|Copied\. Send it to your host\./);
                await fits(page);
                const surface = await page.evaluate(() => ({
                    href: location.href,
                    hash: location.hash,
                    text: document.body.innerText,
                    state: history.state === null ? null : JSON.stringify(history.state),
                    storage: [...Object.keys(localStorage), ...Object.keys(sessionStorage)]
                }));
                expect(surface.hash).toBe('');
                expect(surface.href).not.toContain(code);
                expect(surface.text).not.toContain(code);
                expect(surface.state ?? '').not.toContain(code);
                expect(surface.text).not.toMatch(/#game-|playable|passHash/);
                expect(surface.storage).toEqual([]);
                const copied = await page.evaluate(async () => {
                    try { return await navigator.clipboard.readText(); } catch { return ''; }
                });
                expect(copied === '' || copied === FRESH_LINK).toBe(true);
                expect(copied).not.toContain(code);
                expect(await context.cookies()).toEqual([]);
                expect(errors).toEqual([]);
            } finally { await opened.context.close(); }
        });
    });
}
