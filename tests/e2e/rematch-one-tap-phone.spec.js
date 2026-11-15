// 390×844 one-tap rematch for the four graded Game Night games.
// Harness: tests/e2e/chess-phone-fixture.js when present; otherwise mirrors family-alpha-gate.
const { existsSync } = require('node:fs');
const { join } = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { test: base, expect } = require('@playwright/test');
const { tapHeight } = require('./fixtures');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const test = base;
const PHONE = { width: 390, height: 844 };
const LOBBY = '/r/45662413410ed051/lobby/';
const PREVIEW = 'local-preview-key-0001';
const WAIT_FOR_HOST = /wait(ing)? for (the )?host/i;
const arcadeFeatures = { arcadeChess: 1, arcadeTurdSpades: 1, arcadeTurdanoid: 1 };

const fixturePath = join(__dirname, 'chess-phone-fixture.js');
const sharedFixture = existsSync(fixturePath) ? require('./chess-phone-fixture') : null;

async function gameNight(browser, baseURL) {
    if (sharedFixture) return sharedFixture.gameNight(browser, baseURL);
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

    async function phone(nick, { viewport = PHONE } = {}) {
        const sid = randomUUID(), session = { betaSid: sid, betaInviteVersion: '1' };
        const person = { nick, sid, identity: null, matches: new Map(), matchFrames: [] };
        people.set(nick, person);
        const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true });
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
        await page.emulateMedia({ media: 'screen', features: [{ name: 'pointer', value: 'coarse' }] });
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
        await page.goto(`${LOBBY}?preview=${PREVIEW}&relay=${encodeURIComponent(hangoutRelayWsBase(baseURL, 'rematch-one-tap-phone'))}`);
        await enter(page, nick);
        return page;
    }
    const table = name => transports.get(name);
    return {
        phone, people,
        view: (nick, game) => people.get(nick).matches.get(game),
        act: (nick, game, frame) => serial(() => table(game).receive(people.get(nick).matches.get(game), JSON.stringify({ version: 1, ...frame }))),
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

async function room(fixture, nicks) {
    if (sharedFixture) return sharedFixture.room(fixture, nicks);
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
    if (sharedFixture) return sharedFixture.invite(host, guest, nick);
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
        finished: /wins · /,
        rematch: /rematch/i,
        board: '.arcade-chess-board'
    },
    partners: {
        label: 'partners Spades', game: 'turdspades', status: '[data-spades-status]', seats: 2,
        open: host => host.getByRole('button', { name: 'Open 2-player Spades' }).click(),
        join: guest => guest.getByRole('button', { name: 'Join West' }).click(),
        live: [/computer partner|Round 1/, /computer partner|Waiting for the host to bid|Round 1/],
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
        live: [/^(Fresh Tiles|Rainbow Rows|Ripple)$/, /^(Fresh Tiles|Rainbow Rows|Ripple)$/],
        finished: /forfeit/,
        rematch: /Turdanoid rematch/,
        board: '[data-brick-match]'
    }
};

const status = (page, game) => page.locator(game.status);
const panel = (page, game) => page.locator('details', { has: page.locator(game.status) });

async function showTable(page, game) {
    const picker = page.getByRole('combobox', { name: 'Switch game' });
    await expect(picker.locator(`option[value="${game.game}"]`)).toBeEnabled();
    await picker.selectOption(game.game);
    await expect(status(page, game)).toBeVisible();
}

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

async function watchStatus(page, game) {
    await page.evaluate(selector => {
        const node = document.querySelector(selector);
        window.__statusSeen = [node.textContent];
        new MutationObserver(() => window.__statusSeen.push(node.textContent)).observe(node, { childList: true, characterData: true, subtree: true });
    }, game.status);
    return () => page.evaluate(() => window.__statusSeen);
}

async function finish(fixture, game, nick) {
    const record = await fixture.record(game.game), saved = record[game.game];
    await fixture.act(nick, game.game, {
        action: 'resign',
        id: saved.id,
        revision: saved.match.revision ?? saved.match.state?.revision ?? 0
    });
}

async function assertRematchTapTarget(rematch) {
    await expect(rematch).toBeVisible();
    await expect(rematch).toBeInViewport();
    const box = await rematch.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(tapHeight(box)).toBeGreaterThanOrEqual(44);
    expect(await rematch.evaluate(node => {
        const y = node.getBoundingClientRect().top + window.scrollY;
        return y + node.offsetHeight <= document.documentElement.scrollHeight + 1;
    })).toBeTruthy();
}

async function tapEachRematch(pages, game) {
    for (const page of pages) {
        const rematch = panel(page, game).getByRole('button', { name: game.rematch });
        await assertRematchTapTarget(rematch);
        await rematch.tap();
    }
}

async function assertNoDeadEnd(readSeen, game) {
    const lines = await readSeen();
    expect(lines.filter(text => WAIT_FOR_HOST.test(text) && !/to bid/.test(text))).toEqual([]);
    const stuck = lines.filter(text => /^Waiting( for)?\s*$/i.test(text) || /^Waiting…$/i.test(text));
    expect(stuck).toEqual([]);
    expect(lines.at(-1) || '').not.toMatch(/^Waiting for the host to open/);
}

for (const game of Object.values(GAMES)) {
  const nicks = ['HostExample', 'GuestWest', 'GuestNorth', 'GuestEast'].slice(0, game.seats);
  const last = nicks.at(-1);

  test.describe(`${game.label} rematch on phone`, () => {
    test.slow();

    test(`every seat taps Rematch once and returns to the same seat`, async ({ browser, baseURL }) => {
      const fixture = await gameNight(browser, baseURL);
      try {
        const pages = await seated(fixture, game, nicks);
        const seats = nicks.map(nick => fixture.view(nick, game.game).deserializeAttachment().seat);
        const firstId = (await fixture.record(game.game))[game.game].id;
        const seen = await Promise.all(pages.map(page => watchStatus(page, game)));

        await finish(fixture, game, last);
        for (const page of pages) await expect(status(page, game)).toHaveText(game.finished);

        if (game.game === 'turdanoid') {
          for (const page of pages) {
            const rematch = panel(page, game).getByRole('button', { name: game.rematch });
            const box = await rematch.boundingBox();
            expect(tapHeight(box), 'Turdanoid Rematch must be at least 44px tall on a phone').toBeGreaterThanOrEqual(44);
          }
        }
        await tapEachRematch(pages, game);
        await expect.poll(async () => (await fixture.record(game.game))[game.game].id).not.toBe(firstId);

        for (const [index, page] of pages.entries()) {
          await expect(status(page, game)).toHaveText(game.live[index]);
          await expect(page.locator(game.board)).toBeVisible();
          expect(fixture.view(nicks[index], game.game).deserializeAttachment().seat).toBe(seats[index]);
          await assertNoDeadEnd(seen[index], game);
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(PHONE.width);
        }
        expect(fixture.errors()).toEqual([]);
      } finally {
        await fixture.close();
      }
    });
  });
}

test.describe('four-player Spades watch-only guest', () => {
  test.slow();

  test('stays read-only with zero cards through a full-table rematch', async ({ browser, baseURL }) => {
    const game = GAMES.four;
    const nicks = ['HostExample', 'GuestWest', 'GuestNorth', 'GuestEast'];
    const fixture = await gameNight(browser, baseURL);
    try {
      const pages = await seated(fixture, game, nicks);
      const seats = nicks.map(nick => fixture.view(nick, game.game).deserializeAttachment().seat);
      const watcher = await fixture.phone('WatchGuest');
      await invite(pages[0], watcher, 'WatchGuest');
      await showTable(watcher, game);
      await expect(watcher.locator(game.board)).toBeVisible();
      await expect(status(watcher, game)).toHaveText(game.watching);
      await expect(status(watcher, game)).not.toHaveText(WAIT_FOR_HOST);
      expect(fixture.view('WatchGuest', game.game).deserializeAttachment().seat).toBeNull();
      await expect(watcher.locator('[data-spades-hand-label]')).toHaveText('Watching · hands are private');
      await expect(watcher.locator('[data-spades-hand] button')).toHaveCount(0);
      await expect(watcher.locator('[data-spades-card]')).toHaveCount(0);

      const firstId = (await fixture.record(game.game))[game.game].id;
      await finish(fixture, game, nicks.at(-1));
      for (const page of pages) await expect(status(page, game)).toHaveText(game.finished);

      await tapEachRematch(pages, game);
      await expect.poll(async () => (await fixture.record(game.game))[game.game].id).not.toBe(firstId);

      for (const [index, page] of pages.entries()) {
        await expect(status(page, game)).toHaveText(game.live[index]);
        expect(fixture.view(nicks[index], game.game).deserializeAttachment().seat).toBe(seats[index]);
      }
      await expect(watcher.locator('[data-spades-card]')).toHaveCount(0);
      await expect(watcher.locator('[data-spades-hand] button')).toHaveCount(0);
      expect(fixture.view('WatchGuest', game.game).deserializeAttachment().seat).toBeNull();
      // chess-phone-fixture stores person.frames and exposes frames(nick).
      // The inline harness below is still reachable when that file is absent
      // and keeps the same bytes on person.matchFrames.
      const frames = typeof fixture.frames === 'function'
        ? fixture.frames('WatchGuest')
        : fixture.people.get('WatchGuest').matchFrames;
      const views = frames.map(raw => JSON.parse(raw)).filter(frame => frame.state?.match);
      expect(views.length).toBeGreaterThan(0);
      for (const view of views) {
        expect(view.state.match.hand).toEqual([]);
        expect(view.state.match.hands).toBeUndefined();
      }
      expect(frames.join('\n')).not.toMatch(/"playable"/);
      expect(fixture.errors()).toEqual([]);
    } finally {
      await fixture.close();
    }
  });
});
