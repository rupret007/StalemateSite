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
                    // This buffer observes only frames forwarded by the routed socket fixture.
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
        dropLobby: (nick, code = 1012, reason = 'Synthetic network loss') => serial(async () => {
            const { id } = people.get(nick).identity, socket = lobbySockets.get(id);
            lobbySockets.delete(id);
            await engine.disconnect(id);
            await socket.close({ code, reason });
            await reconcile();
        }),
        record: async game => [...(await storage.list({ prefix: game === 'chess' ? 'game-night-match:' : `game-night-${game}:` })).values()][0],
        errors: () => [...people.values()].flatMap(person => person.errors.map(error => `${person.nick}: ${error}`)),
        close: () => Promise.all(contexts.map(context => context.close()))
    };
}

async function enter(page, nick) {
    await page.locator('[data-nick]').fill(nick);
    await page.locator('[data-enter]').click();
    await expect(page.locator('[data-connection]')).toHaveText('Connected');
}

test('two-phone Chess match actions fit with draw clearance at phone sizes and larger text', async ({ browser, baseURL }) => {
    const fixture = await gameNight(browser, baseURL);
    try {
        const host = await fixture.phone('ClearanceHost', { viewport: { width: 390, height: 844 } });
        const guest = await fixture.phone('ClearanceGuest', { viewport: { width: 390, height: 844 } });
        await host.getByRole('button', { name: /Game Night/ }).click();
        await expect(host.getByRole('region', { name: /Game Night/ })).toBeVisible();
        await host.getByRole('button', { name: 'Invite players' }).click();
        await host.getByRole('button', { name: 'Invite ClearanceGuest', exact: true }).click();
        await guest.locator('[data-game-offer]').getByRole('button', { name: 'Join Game Night' }).click();
        for (const page of [host, guest]) {
            await page.getByRole('combobox', { name: 'Switch game' }).selectOption('chess');
            await expect(page.locator('.arcade-chess-status')).toBeVisible();
        }
        await host.getByRole('button', { name: 'Open Chess match' }).click();
        await guest.getByRole('button', { name: 'Join as Black' }).click();
        for (const page of [host, guest]) await expect(page.locator('.arcade-chess-board')).toBeVisible();

        for (const height of [664, 844]) {
            for (const largerText of [false, true]) {
                for (const page of [host, guest]) {
                    await page.setViewportSize({ width: 390, height });
                    if (largerText) await page.addStyleTag({ content: 'html { font-size: 112.5%; }' });
                    const panel = page.locator('.arcade-chess');
                    const panelBox = await panel.boundingBox();
                    const offerBox = await panel.locator('[data-action="offer-draw"]').boundingBox();
                    expect(offerBox, `Offer draw at ${height}px, largerText=${largerText}`).not.toBeNull();
                    for (const action of await panel.locator('[data-action]:visible').all()) {
                        const label = await action.innerText();
                        const box = await action.boundingBox();
                        expect(box.width, `${label} width`).toBeGreaterThanOrEqual(44);
                        expect(box.height, `${label} height`).toBeGreaterThanOrEqual(44);
                        expect(box.x, `${label} left`).toBeGreaterThanOrEqual(0);
                        expect(box.y, `${label} top`).toBeGreaterThanOrEqual(0);
                        expect(box.x + box.width, `${label} right`).toBeLessThanOrEqual(390);
                        expect(box.y + box.height, `${label} bottom`).toBeLessThanOrEqual(height);
                        expect(box.x).toBeGreaterThanOrEqual(panelBox.x);
                        expect(box.y).toBeGreaterThanOrEqual(panelBox.y);
                        expect(box.x + box.width).toBeLessThanOrEqual(panelBox.x + panelBox.width);
                        expect(box.y + box.height).toBeLessThanOrEqual(panelBox.y + panelBox.height);
                        const ratio = await action.evaluate(el => {
                            const r = el.getBoundingClientRect();
                            return Math.max(0, Math.min(innerWidth, r.right) - Math.max(0, r.left)) *
                                Math.max(0, Math.min(innerHeight, r.bottom) - Math.max(0, r.top)) / (r.width * r.height);
                        });
                        expect(ratio, `${label} visible ratio`).toBe(1);
                    }
                    expect(panelBox.y + panelBox.height - (offerBox.y + offerBox.height), 'clearance below Offer draw').toBeGreaterThanOrEqual(8);
                    if (largerText) await page.addStyleTag({ content: 'html { font-size: 100% !important; }' });
                }
            }
        }
    } finally { await fixture.close(); }
});
