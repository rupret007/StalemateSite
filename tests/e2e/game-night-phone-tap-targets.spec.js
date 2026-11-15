// Phone tap targets for the four graded Game Night games at 390×844.
// Reuses the same synthetic lobby fixture pattern as family-alpha-gate.spec.js (read-only).
const { randomBytes, randomUUID } = require('node:crypto');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const PHONE = { width: 390, height: 844 };
const LOBBY = '/r/45662413410ed051/lobby/';
const PREVIEW = 'local-preview-key-0001';
const arcadeFeatures = { arcadeChess: 1, arcadeTurdSpades: 1, arcadeTurdanoid: 1 };

const TAP_CSS = {
    'picker-switch': 'r/45662413410ed051/lobby/lobby.css:220 (.btn.btn--small; r/45662413410ed051/lobby/lobby.css:48 min-height 38px)',
    'picker-chess-summary': 'r/45662413410ed051/lobby/arcade-chess.css:9',
    'picker-spades-summary': 'r/45662413410ed051/lobby/lobby.css:276',
    'picker-turdanoid-summary': 'r/45662413410ed051/lobby/lobby.css:481',
    'chess-primary': 'r/45662413410ed051/lobby/arcade-chess.css:110',
    'chess-rematch-host': 'r/45662413410ed051/lobby/arcade-chess.css:110',
    'chess-board-square': 'r/45662413410ed051/lobby/arcade-chess.css:53',
    'spades-bid-select': 'r/45662413410ed051/lobby/lobby.css:349 (38px base; r/45662413410ed051/lobby/lobby.css:351-353 at max-width 900px sets 44px)',
    'spades-bid-button': 'r/45662413410ed051/lobby/lobby.css:351',
    'spades-play-card': 'r/45662413410ed051/lobby/lobby.css:290',
    'turdanoid-launch': 'r/45662413410ed051/lobby/lobby.css:498',
    'turdanoid-back-summary': 'r/45662413410ed051/lobby/lobby.css:481',
    'turdanoid-leave': 'r/45662413410ed051/lobby/lobby.css:481',
};

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
        await page.goto(`${LOBBY}?preview=${PREVIEW}&relay=${encodeURIComponent(hangoutRelayWsBase(baseURL, 'game-night-phone-tap-targets'))}`);
        await enter(page, nick);
        return page;
    }
    return {
        phone, people,
        act: (nick, game, frame) => serial(() => transports.get(game).receive(people.get(nick).matches.get(game), JSON.stringify({ version: 1, ...frame }))),
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

async function openGameNight(host, guest, guestNick) {
    const start = host.getByRole('button', { name: /Game Night/ });
    if (!await start.isVisible()) await host.locator('.phonetabs [data-show="rooms"]').click();
    await start.click();
    await expect(host.getByRole('region', { name: /Game Night/ })).toBeVisible();
    await host.getByRole('button', { name: 'Invite players' }).click();
    await host.getByRole('button', { name: `Invite ${guestNick}`, exact: true }).click();
    await guest.locator('[data-game-offer]').getByRole('button', { name: 'Join Game Night' }).click();
    await expect(guest.getByRole('region', { name: /Game Night/ })).toBeVisible();
    if (await host.locator('[data-invite-dialog][open]').count()) await host.keyboard.press('Escape');
}

async function switchGame(page, value) {
    const picker = page.getByRole('combobox', { name: 'Switch game' });
    await expect(picker).toBeVisible();
    await picker.selectOption(value);
}

function panel(page, selector) {
    return page.locator('details', { has: page.locator(selector) });
}

async function measureTapTarget(locator, { id, css, min = 44 } = {}) {
    await expect(locator).toBeVisible();
    await expect(locator).toBeInViewport({ ratio: 1 });
    const box = await locator.boundingBox();
    const width = box?.width ?? 0;
    const height = box?.height ?? 0;
    expect(width, `${id} width; CSS ${css}`).toBeGreaterThanOrEqual(min);
    expect(height, `${id} height; CSS ${css}`).toBeGreaterThanOrEqual(min);
    await expect(locator.page().locator('html')).toHaveJSProperty('scrollWidth', await locator.page().evaluate(() => document.documentElement.clientWidth));
    await expectNotOverlapped(locator, css);
    return { width, height };
}

async function expectNotOverlapped(locator, label) {
    const clear = await locator.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const root = el.closest('details');
        const pill = root?.querySelector('.arcade-reconnect');
        if (pill && !pill.hidden) {
            const pr = pill.getBoundingClientRect();
            if (x >= pr.left && x <= pr.right && y >= pr.top && y <= pr.bottom) {
                return { ok: false, reason: 'reconnecting pill covers center' };
            }
        }
        for (const cue of root?.querySelectorAll(
            '[data-chess-status],[data-spades-status],[data-brick-status],[role="status"].arcade-chess-status,[role="status"].arcade-card-status,[role="status"].brick-race-status'
        ) ?? []) {
            if (cue.hidden || cue === el || el.contains(cue)) continue;
            const cr = cue.getBoundingClientRect();
            if (cr.width < 1 || cr.height < 1) continue;
            if (x >= cr.left && x <= cr.right && y >= cr.top && y <= cr.bottom) {
                return { ok: false, reason: 'turn/status cue covers center' };
            }
        }
        const hit = document.elementFromPoint(x, y);
        return { ok: !!(hit && (el === hit || el.contains(hit))), reason: hit ? `${hit.tagName}.${hit.className}` : 'no hit target' };
    });
    expect(clear.ok, `${label} center not tappable (${clear.reason})`).toBe(true);
}

async function finishChess(fixture, guestNick) {
    const saved = (await fixture.record('chess')).chess;
    await fixture.act(guestNick, 'chess', { action: 'resign', id: saved.id, revision: saved.match.revision ?? 0 });
}

test.use({ viewport: PHONE, hasTouch: true, serviceWorkers: 'block' });

test.describe('Game Night phone tap targets at 390×844', () => {
    test.slow();

    test('picker options and graded game summaries', async ({ browser, baseURL }) => {
        const fixture = await gameNight(browser, baseURL);
        try {
            const host = await fixture.phone('TapHost');
            const guest = await fixture.phone('TapGuest');
            await openGameNight(host, guest, 'TapGuest');
            const picker = host.getByRole('combobox', { name: 'Switch game' });
            await measureTapTarget(picker, { id: 'picker-switch', css: TAP_CSS['picker-switch'] });
            const options = await picker.evaluate(select => [...select.options].filter(option => !option.disabled && option.value));
            expect(options.map(option => option.value)).toEqual(
                expect.arrayContaining(['chess', 'turdspades', 'turdanoid'])
            );
            const summaries = {
                chess: host.locator('details.arcade-chess > summary'),
                turdspades: host.locator('details.arcade-spades > summary'),
                turdanoid: host.locator('details.arcade-brick-race > summary'),
            };
            for (const [value, summary] of Object.entries(summaries)) {
                await switchGame(host, value);
                const css = value === 'chess' ? TAP_CSS['picker-chess-summary']
                    : value === 'turdspades' ? TAP_CSS['picker-spades-summary'] : TAP_CSS['picker-turdanoid-summary'];
                await measureTapTarget(summary, { id: `picker-${value}-summary`, css });
            }
        } finally { await fixture.close(); }
    });

    test('Chess primary, board square, and rematch controls', async ({ browser, baseURL }) => {
        const fixture = await gameNight(browser, baseURL);
        try {
            const host = await fixture.phone('ChessHost');
            const guest = await fixture.phone('ChessGuest');
            await openGameNight(host, guest, 'ChessGuest');
            await switchGame(host, 'chess');
            await switchGame(guest, 'chess');
            const openPrimary = host.getByRole('button', { name: 'Open Chess match' });
            await measureTapTarget(openPrimary, { id: 'chess-primary-open', css: TAP_CSS['chess-primary'] });
            await openPrimary.click();
            await guest.getByRole('button', { name: 'Join as Black' }).click();
            await expect(host.locator('.arcade-chess-board')).toBeVisible();
            const square = guest.locator('[data-square="e2"]');
            await measureTapTarget(square, { id: 'chess-board-square', css: TAP_CSS['chess-board-square'] });
            await finishChess(fixture, 'ChessGuest');
            await expect(host.locator('[data-chess-status]')).toContainText('wins');
            for (const [page, id] of [[guest, 'chess-rematch-guest'], [host, 'chess-rematch-host']]) {
                const rematch = panel(page, '[data-chess-status]').getByRole('button', { name: /rematch/i });
                await expect(rematch).toBeVisible();
                await measureTapTarget(rematch, { id, css: TAP_CSS['chess-primary'] });
            }
        } finally { await fixture.close(); }
    });

    test('Spades bid controls and a playable card', async ({ browser, baseURL }) => {
        const fixture = await gameNight(browser, baseURL);
        try {
            const host = await fixture.phone('SpadesHost');
            const guest = await fixture.phone('SpadesGuest');
            await openGameNight(host, guest, 'SpadesGuest');
            await switchGame(host, 'turdspades');
            await switchGame(guest, 'turdspades');
            await host.getByRole('button', { name: 'Open 2-player Spades' }).click();
            await guest.getByRole('button', { name: 'Join West' }).click();
            await expect(host.locator('[data-spades-table]')).toBeVisible();
            const firstBidder = await host.locator('[data-spades-bid]:not([hidden])').count() ? host : guest;
            await expect(firstBidder.locator('[data-spades-bid]')).toBeVisible();
            await measureTapTarget(firstBidder.locator('#spades-bid'), {
                id: 'spades-bid-select',
                css: TAP_CSS['spades-bid-select'],
            });
            await measureTapTarget(firstBidder.getByRole('button', { name: 'Bid for me' }), {
                id: 'spades-bid-button',
                css: TAP_CSS['spades-bid-button'],
            });
            let activePlayer = guest;
            await expect.poll(async () => {
                for (const page of [host, guest]) {
                    if (await page.locator('[data-spades-bid]:not([hidden])').count()) {
                        await page.getByRole('button', { name: 'Bid for me' }).tap();
                    }
                }
                for (const page of [guest, host]) {
                    const text = await page.locator('[data-spades-status]').textContent();
                    const cards = await page.locator('[data-spades-hand] [data-spades-card]:not([disabled])').count();
                    if (cards && (/Your play|tap a card/i.test(text) || cards > 0)) {
                        activePlayer = page;
                        return true;
                    }
                }
                return false;
            }, { timeout: 45000 }).toBe(true);
            const playable = activePlayer.locator('[data-spades-hand] [data-spades-card]:not([disabled])').first();
            await expect(playable).toBeVisible();
            await measureTapTarget(playable, { id: 'spades-play-card', css: TAP_CSS['spades-play-card'] });
        } finally { await fixture.close(); }
    });

    test('Turdanoid launch, panel back summary, and leave', async ({ browser, baseURL }) => {
        const fixture = await gameNight(browser, baseURL);
        try {
            const host = await fixture.phone('BrickHost');
            const guest = await fixture.phone('BrickGuest');
            await openGameNight(host, guest, 'BrickGuest');
            await switchGame(host, 'turdanoid');
            await switchGame(guest, 'turdanoid');
            await host.getByRole('button', { name: 'Open Turdanoid race' }).click();
            await guest.getByRole('button', { name: 'Join Turdanoid race' }).click();
            await expect(guest.locator('[data-brick-match]')).toBeVisible();
            await measureTapTarget(guest.locator('[data-brick-serve]'), { id: 'turdanoid-launch', css: TAP_CSS['turdanoid-launch'] });
            await measureTapTarget(panel(guest, '[data-brick-status]').locator('summary'), {
                id: 'turdanoid-back-summary',
                css: TAP_CSS['turdanoid-back-summary'],
            });
            await measureTapTarget(guest.locator('[data-brick-leave]'), { id: 'turdanoid-leave', css: TAP_CSS['turdanoid-leave'] });
        } finally { await fixture.close(); }
    });
});

