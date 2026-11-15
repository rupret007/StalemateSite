// Screen-lock recovery on the private phone Game Night demo.
const { randomBytes, randomUUID } = require('node:crypto');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const PHONE = { width: 390, height: 844 };
const LOBBY = '/r/45662413410ed051/lobby/';
const PREVIEW = 'local-preview-key-0001';

async function fixture(browser, baseURL) {
    const { createLobby } = await import('../../hangout-worker/src/lobby-core.mjs');
    const { arcadeGame, arcadeRoomRequest, createArcadeTransport } = await import('../../hangout-worker/src/arcade-transport.mjs');
    const contexts = [], lobbySockets = new Map(), people = new Map(), matchSockets = [], records = new Map();
    let at = 1800000000000, alarm = null, upgrading = null, queue = Promise.resolve();
    const serial = task => { const run = queue.then(task); queue = run.catch(() => {}); return run; };
    const storage = {
        getAlarm: async () => alarm, setAlarm: async value => { alarm = value; },
        get: async key => structuredClone(records.get(key)),
        put: async (key, value) => { for (const [name, record] of typeof key === 'string' ? [[key, value]] : Object.entries(key)) records.set(name, structuredClone(record)); },
        delete: async key => { for (const name of [key].flat()) records.delete(name); },
        list: async ({ prefix = '', limit = Infinity } = {}) => new Map([...records].filter(([key]) => key.startsWith(prefix)).slice(0, limit))
    };
    const state = { storage, getWebSockets: () => matchSockets, acceptWebSocket: socket => matchSockets.push(socket) };
    const personFor = id => [...people.values()].find(person => person.identity?.id === id);
    const engine = createLobby({ gameNight: true, now: () => at, limits: { defaultSlow: 0, roomPerDevice: 1 }, send: (id, frame) => {
        const person = personFor(id);
        if (frame.t === 'part' && person) {
            const ref = engine.arcadeRoomRef(frame.ch, false);
            if (ref) person.departures.push({ scope: { room: frame.ch, ref }, subject: person.sid });
        }
        const features = { arcadeTurdSpades: 1, arcadeCrapeights: 1 };
        lobbySockets.get(id)?.send(JSON.stringify(frame.t === 'hello' ? { ...frame, features: { ...frame.features, ...features } } : frame));
    } });
    const transports = new Map(['turdspades', 'crapeights'].map(name => [name, createArcadeTransport({
        name, state,
        current: scope => { const person = personFor(scope.actor); const member = engine.arcadeActor(scope, false);
            return person && lobbySockets.has(scope.actor) && member ? { ...person.identity, ...member, socket: person } : null; },
        active: async () => true, charge: async () => true, allowed: () => true,
        approve: async actor => (await engine.approveArcade(actor))?.ok === true
    })]));
    globalThis.WebSocketPair = class { constructor() { this[0] = {}; this[1] = upgrading; } };
    const reconcile = async () => {
        for (const person of people.values()) for (const departure of person.departures.splice(0))
            for (const transport of transports.values()) await transport.revoke(departure.scope, departure.subject);
        for (const transport of transports.values()) transport.reconcile();
    };
    async function phone(nick) {
        const sid = randomUUID(), session = { betaSid: sid, betaInviteVersion: '1' };
        const person = { nick, sid, session, identity: null, matches: new Map(), departures: [], errors: [] };
        people.set(nick, person);
        const context = await browser.newContext({ viewport: PHONE, hasTouch: true }); contexts.push(context);
        await context.route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL).origin ? route.continue() : route.abort());
        await context.route(url => url.pathname === LOBBY, async route => {
            const response = await route.fetch(); await route.fulfill({ response, body: (await response.text()).replace('<head>', '<head><script src="/beta/bootstrap.js"></script>') });
        });
        await context.route('**/beta/bootstrap.js', route => route.fulfill({ contentType: 'text/javascript', body: 'window.HangoutBootstrap={};' }));
        await context.route(url => /-ticket$/.test(url.pathname) && !!arcadeGame(url.pathname), async route => {
            const game = arcadeGame(new URL(route.request().url()).pathname), scope = arcadeRoomRequest(route.request().postDataJSON());
            const response = scope && transports.has(game) ? await serial(() => transports.get(game).issue(scope, session)) : new Response('Not found', { status: 404 });
            await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() });
        });
        const page = await context.newPage(); person.page = page; page.on('pageerror', error => person.errors.push(error.message));
        await page.routeWebSocket(url => url.pathname.endsWith('/lobby'), socket => {
            const identity = { id: 'c' + randomBytes(16).toString('hex'), dev: `device-${nick}`, iph: `ip-${nick}`, role: 'fan', account: '', admin: false, ...session };
            person.identity = identity; lobbySockets.set(identity.id, socket);
            socket.onMessage(raw => { at += 5000; void serial(async () => { await engine.message(identity.id, String(raw)); await reconcile(); }); });
            socket.onClose(() => { lobbySockets.delete(identity.id); void serial(async () => { await engine.disconnect(identity.id); await reconcile(); }); });
            engine.connect(identity);
        });
        await page.routeWebSocket(url => /-match$/.test(url.pathname) && transports.has(arcadeGame(url.pathname)), route => {
            const game = arcadeGame(new URL(route.url()).pathname), transport = transports.get(game); let attachment = null;
            const socket = { readyState: 1, serializeAttachment: value => { attachment = value; }, deserializeAttachment: () => attachment,
                send: raw => { if (socket.readyState === 1) route.send(raw); }, close: (code = 1000, reason = '') => { if (socket.readyState === 1) { socket.readyState = 3; void route.close({ code, reason }); } } };
            route.onMessage(raw => void serial(() => transport.receive(socket, String(raw))));
            route.onClose(() => void serial(async () => { if (socket.readyState !== 1) return; const scope = socket.deserializeAttachment(); socket.readyState = 3; await transport.presenceChanged(scope); }));
            void serial(async () => { upgrading = socket; try { const refusal = await transport.upgrade(route.protocols().join(', '), session); socket.readyState = 3; await route.close({ code: 1008, reason: `upgrade refused ${refusal.status}` }); }
                catch (error) { if (!(error instanceof RangeError) || !matchSockets.includes(socket)) throw error; person.matches.set(game, socket); } finally { upgrading = null; } });
        });
        await page.goto(`${LOBBY}?preview=${PREVIEW}&relay=${encodeURIComponent(hangoutRelayWsBase(baseURL, 'screen-lock-demo'))}`);
        await page.fill('[data-nick]', nick); await page.click('[data-enter]'); await expect(page.locator('[data-connection]')).toHaveText('Connected');
        return page;
    }
    return { phone, people, transports,
        drop: async (nick, game) => serial(async () => {
            const socket = people.get(nick).matches.get(game), scope = socket.deserializeAttachment();
            socket.serializeAttachment({ ...scope, retired: true });
            socket.close(1012, 'Screen lock network drop');
            await transports.get(game).presenceChanged(scope);
        }),
        close: () => Promise.all(contexts.map(context => context.close())) };
}

async function joinedGame(f, game, label) {
    const host = await f.phone('DemoHost');
    await host.getByRole('button', { name: /Game Night/ }).click();
    await expect(host.getByRole('region', { name: /Game Night/ })).toBeVisible();
    await host.getByRole('button', { name: 'Invite players' }).click();
    await host.getByRole('button', { name: 'Invite DemoGuest', exact: true }).click();
    const guest = await f.phone('DemoGuest');
    await guest.locator('[data-game-offer]').getByRole('button', { name: 'Join Game Night' }).click();
    await expect(guest.getByRole('region', { name: /Game Night/ })).toBeVisible();
    for (const page of [host, guest]) {
        const picker = page.getByRole('combobox', { name: 'Switch game' });
        await picker.selectOption(game);
    }
    const status = game === 'turdspades' ? '[data-spades-status]' : '[data-eights-status]';
    const board = game === 'turdspades' ? '[data-spades-table]' : '[data-eights-table]';
    await host.getByRole('button', { name: game === 'turdspades' ? 'Open 2-player Spades' : /Open.*Eights/ }).click();
    await guest.getByRole('button', { name: game === 'turdspades' ? 'Join West' : /Join Seat 2/ }).click();
    await expect(host.locator(board)).toBeVisible(); await expect(guest.locator(board)).toBeVisible();
    await expect(guest.locator(status)).not.toHaveText(/waiting for the host to open/i);
    return { host, guest, status, board, game };
}

for (const [game, label] of [['turdspades', 'Spades'], ['crapeights', 'Crazy Eights']]) {
    test(`390x844 ${label} resumes the same seat and hand after screen lock`, async ({ browser, baseURL }) => {
        const f = await fixture(browser, baseURL);
        try {
            const { guest, status, board } = await joinedGame(f, game, label);
            const before = f.people.get('DemoGuest').matches.get(game);
            const seat = before.deserializeAttachment().seat;
            const initial = await guest.locator(board).evaluate(el => el.innerText);
            const hand = await guest.locator(game === 'turdspades' ? '[data-spades-card]' : '[data-eights-card]').evaluateAll(nodes => nodes.map(node => node.dataset[game === 'turdspades' ? 'spadesCard' : 'eightsCard']).sort());
            const seen = await guest.evaluate(selector => {
                const node = document.querySelector(selector); window.__lockStatuses = [node.textContent];
                new MutationObserver(() => window.__lockStatuses.push(node.textContent)).observe(node, { childList: true, characterData: true, subtree: true });
                return true;
            }, status);
            expect(seen).toBe(true);
            await guest.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new PageTransitionEvent('pagehide')); });
            await f.drop('DemoGuest', game);
            await expect.poll(() => before.readyState).toBe(3);
            await guest.evaluate(() => { window.dispatchEvent(new PageTransitionEvent('pageshow')); Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
            await expect.poll(() => {
                const socket = f.people.get('DemoGuest').matches.get(game);
                return socket && socket !== before && socket.readyState === 1 && socket.deserializeAttachment().seat === seat;
            }, { timeout: 5000 }).toBeTruthy();
            await expect(guest.locator(board)).toBeVisible();
            await expect(guest.locator(status)).not.toHaveText(/wait(ing)? for (the )?host/i);
            expect(await guest.locator(board).evaluate(el => el.innerText)).toBe(initial);
            expect(await guest.locator(game === 'turdspades' ? '[data-spades-card]' : '[data-eights-card]').evaluateAll(nodes => nodes.map(node => node.dataset[game === 'turdspades' ? 'spadesCard' : 'eightsCard']).sort())).toEqual(hand);
            expect(f.people.get('DemoGuest').matches.get(game).deserializeAttachment().seat).toBe(seat);
            expect(f.people.get('DemoGuest').errors).toEqual([]);
        } finally { await f.close(); }
    });
}
