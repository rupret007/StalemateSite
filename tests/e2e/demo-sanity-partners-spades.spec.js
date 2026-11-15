// Phone sanity for partners Spades: invite, seat, bid, and the first trick.
// Four phones are 390x844. One phone is 375x667 with isMobile set.
// Real lobby client and match transport; only the Durable Object shell is in-memory.
const { randomBytes, randomUUID } = require('node:crypto');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const LOBBY = '/r/45662413410ed051/lobby/';
const PREVIEW = 'local-preview-key-0001';
const TAP = 44;
const PHONES = [
    { nick: 'Host', viewport: { width: 390, height: 844 } },
    { nick: 'West', viewport: { width: 375, height: 667 }, isMobile: true },
    { nick: 'Ada', viewport: { width: 390, height: 844 } },
    { nick: 'Bea', viewport: { width: 390, height: 844 } },
    { nick: 'Cam', viewport: { width: 390, height: 844 } }
];
const DEAD_END = /isn.t available from this invite|can.t see it right now|couldn.t reconnect|couldn’t reconnect|Ask (the |your )?host|Return to your Game Night room|Waiting for the host to open/i;
const WAIT_FOR_HOST = /wait(ing)? for (the )?host/i;
const TEAM_SCORES = ['South + North CPU · 0/250 · 0 bags', 'West + East CPU · 0/250 · 0 bags'];

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
        const sent = frame.t === 'hello' ? { ...frame, features: { ...frame.features, arcadeTurdSpades: 1 } } : frame;
        lobbySockets.get(id)?.send(JSON.stringify(sent));
    } });
    const transport = createArcadeTransport({
        name: 'turdspades', state,
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

    async function phone(nick, { viewport, isMobile = false }) {
        const sid = randomUUID(), session = { betaSid: sid, betaInviteVersion: '1' };
        const person = { nick, sid, identity: null, viewport, isMobile };
        people.set(nick, person);
        const context = await browser.newContext({ viewport, isMobile, hasTouch: true });
        contexts.push(context);
        await context.route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL).origin ? route.continue() : route.abort());
        await context.route(url => url.pathname === LOBBY, async route => {
            const response = await route.fetch();
            await route.fulfill({ response, body: (await response.text()).replace('<head>', '<head><script src="/beta/bootstrap.js"></script>') });
        });
        await context.route('**/beta/bootstrap.js', route => route.fulfill({ contentType: 'text/javascript', body: 'window.HangoutBootstrap={};' }));
        await context.route(url => /-ticket$/.test(url.pathname) && !!arcadeGame(url.pathname), async route => {
            const scope = arcadeRoomRequest(route.request().postDataJSON());
            if (arcadeGame(new URL(route.request().url()).pathname) !== 'turdspades' || !scope) return route.fulfill({ status: 404, json: { error: 'not found' } });
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
        await page.routeWebSocket(url => /-match$/.test(url.pathname) && arcadeGame(url.pathname) === 'turdspades', route => {
            let attachment = null;
            const socket = { readyState: 1, serializeAttachment: value => { attachment = value; }, deserializeAttachment: () => attachment,
                send: raw => { if (socket.readyState === 1) route.send(raw); },
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
                } finally { upgrading = null; }
            });
        });
        await page.goto(`${LOBBY}?preview=${PREVIEW}&relay=${encodeURIComponent(hangoutRelayWsBase(baseURL, 'demo-sanity-partners-spades'))}`);
        await enter(page, nick);
        return person;
    }
    return {
        phone, people,
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

async function showSpades(page) {
    const picker = page.getByRole('combobox', { name: 'Switch game' });
    await expect(picker.locator('option[value="turdspades"]')).toBeEnabled();
    await picker.selectOption('turdspades');
    await expect(page.locator('[data-spades-status]')).toBeVisible();
}

async function watchStatus(page) {
    await page.evaluate(() => {
        const node = document.querySelector('[data-spades-status]');
        window.__statusSeen = [node.textContent];
        new MutationObserver(() => window.__statusSeen.push(node.textContent)).observe(node, { childList: true, characterData: true, subtree: true });
    });
    return () => page.evaluate(() => window.__statusSeen);
}

function stuckLines(lines) {
    const opened = lines.some(text => /seated|computer partner|Round 1 ·/.test(text));
    return lines.filter(text => {
        if (text === 'Waiting for the host to open a table.' && opened) return false;
        return DEAD_END.test(text) || (WAIT_FOR_HOST.test(text) && !/to bid/.test(text));
    });
}

async function scrollState(page) {
    return page.evaluate(() => ({
        window: window.scrollY,
        night: document.querySelector('.game-night')?.scrollTop ?? 0,
        chat: document.querySelector('.chat')?.scrollTop ?? 0
    }));
}

async function visibleTarget(page, locator, label) {
    await expect(locator, label).toBeVisible();
    await expect(locator, label).toBeInViewport({ ratio: 1 });
    const box = await locator.boundingBox();
    expect(box, label).toBeTruthy();
    return { label, width: box.width, height: box.height, x: box.x, y: box.y };
}

async function tapTargets(page) {
    return page.evaluate(minimum => {
        const viewport = { width: window.innerWidth, height: window.innerHeight };
        const nodes = [...document.querySelectorAll('button, a[href], select, summary, input:not([type="hidden"])')];
        const controls = [];
        for (const node of nodes) {
            if (node.disabled || node.closest('[hidden]') || node.hidden || node.closest('[inert]')) continue;
            const closed = node.closest('details:not([open])');
            if (closed && node !== closed.querySelector('summary')) continue;
            const style = getComputedStyle(node);
            if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') continue;
            const box = node.getBoundingClientRect();
            if (box.width === 0 || box.height === 0) continue;
            const hit = document.elementFromPoint(box.left + box.width / 2, box.top + Math.min(box.height / 2, box.height - 1));
            if (!hit || (hit !== node && !node.contains(hit))) continue;
            const text = [
                node.getAttribute('aria-label'),
                node.innerText,
                node.id && `#${node.id}`,
                node.getAttribute('data-spades-action'),
                node.getAttribute('data-command'),
                typeof node.className === 'string' ? node.className : ''
            ].filter(Boolean).join(' ').trim().replace(/\s+/g, ' ').slice(0, 140) || node.tagName;
            const inView = box.top >= 0 && box.left >= 0 && box.right <= viewport.width && box.bottom <= viewport.height;
            const meets = box.width >= minimum && box.height >= minimum;
            controls.push({
                text, width: box.width, height: box.height, top: box.top, left: box.left, right: box.right, bottom: box.bottom, inView, meets,
                html: meets && inView ? '' : node.outerHTML.slice(0, 240)
            });
        }
        return { viewport, controls };
    }, TAP);
}

function shortTargets(sample) {
    return sample.controls.filter(control => !control.meets || !control.inView).map(control =>
        `${control.text} ${control.width.toFixed(1)}x${control.height.toFixed(1)} inView=${control.inView} ${control.html}`);
}

test('partners Spades on four 390x844 phones and one 375x667 phone', async ({ browser, baseURL }) => {
    test.slow();
    const fixture = await gameNight(browser, baseURL);
    const measured = [];
    try {
        const people = [];
        for (const spec of PHONES) people.push(await fixture.phone(spec.nick, spec));
        const [host, west, ...watchers] = people;
        const start = host.page.getByRole('button', { name: /Game Night/ });
        if (!await start.isVisible()) await host.page.locator('.phonetabs [data-show="rooms"]').tap();
        await start.tap();
        await expect(host.page.getByRole('region', { name: /Game Night/ })).toBeVisible();
        for (const guest of [west, ...watchers]) await invite(host.page, guest.page, guest.nick);
        await Promise.all(people.map(person => showSpades(person.page)));
        const seen = await Promise.all(people.map(person => watchStatus(person.page)));

        await host.page.getByRole('button', { name: 'Open 2-player Spades' }).tap();
        await expect(host.page.locator('[data-spades-status]')).toContainText('1/2 seated');
        await expect(host.page.locator('[data-spades-status]')).toContainText('South + North CPU vs West + East CPU');
        await west.page.getByRole('button', { name: 'Join West' }).tap();
        await expect(west.page.locator('[data-spades-table]')).toHaveAttribute('data-mode', 'partners');
        await expect(west.page.locator('[data-spades-table]')).toHaveAttribute('data-phase', 'bid');
        await expect(west.page.locator('[data-spades-status]')).toHaveText('You and a computer partner vs the host and a computer · tap Bid for me');
        await expect(host.page.locator('[data-spades-status]')).toHaveText('Round 1 · West to bid');
        for (const watcher of watchers) {
            await expect(watcher.page.locator('[data-spades-table]')).toBeVisible();
            await expect(watcher.page.locator('[data-spades-status]')).toHaveText('Round 1 · West to bid');
            await expect(watcher.page.locator('[data-spades-hand-label]')).toHaveText('Watching · hands are private');
            await expect(watcher.page.locator('[data-spades-hand] button')).toHaveCount(0);
            await expect(watcher.page.getByRole('button', { name: /^Join / })).toHaveCount(0);
        }

        const bidAndHand = async person => {
            expect(await scrollState(person.page), `${person.nick} scroll`).toEqual({ window: 0, night: 0, chat: 0 });
            const bid = await visibleTarget(person.page, person.page.locator('[data-spades-bid]'), `${person.nick} bid control`);
            const select = await visibleTarget(person.page, person.page.getByLabel('Your bid'), `${person.nick} bid select`);
            const button = await visibleTarget(person.page, person.page.getByRole('button', { name: 'Bid for me' }), `${person.nick} Bid for me`);
            const hand = await visibleTarget(person.page, person.page.locator('[data-spades-hand]'), `${person.nick} hand`);
            const cards = person.page.locator('[data-spades-card]');
            await expect(cards).toHaveCount(13);
            const cardBoxes = [];
            for (const card of await cards.all()) cardBoxes.push(await visibleTarget(person.page, card, `${person.nick} card`));
            const sample = await tapTargets(person.page);
            measured.push({
                nick: person.nick, viewport: person.viewport, isMobile: !!person.isMobile, phase: 'bid',
                bid, select, button, hand,
                smallestCard: cardBoxes.reduce((small, box) => Math.min(small, box.width, box.height), Infinity),
                tapCount: sample.controls.length,
                shortest: shortTargets(sample)
            });
            expect(select.width, `${person.nick} bid select width`).toBeGreaterThanOrEqual(TAP);
            expect(select.height, `${person.nick} bid select height`).toBeGreaterThanOrEqual(TAP);
            expect(button.width, `${person.nick} Bid for me width`).toBeGreaterThanOrEqual(TAP);
            expect(button.height, `${person.nick} Bid for me height`).toBeGreaterThanOrEqual(TAP);
            expect(shortTargets(sample), `${person.nick} tappable controls`).toEqual([]);
            expect(await person.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(person.viewport.width);
        };

        await bidAndHand(west);
        await west.page.getByRole('button', { name: 'Bid for me' }).tap();
        await expect(host.page.locator('[data-spades-status]')).toHaveText('You and a computer partner vs your friend and a computer · tap Bid for me');
        await expect(west.page.locator('[data-spades-status]')).toHaveText('Waiting for the host to bid');
        await bidAndHand(host);
        await host.page.getByRole('button', { name: 'Bid for me' }).tap();

        await expect(west.page.locator('[data-spades-table]')).toHaveAttribute('data-phase', 'play');
        await expect(west.page.locator('[data-spades-status]')).toHaveText(/Round 1 · Your play · tap a card/);
        const playCard = async person => {
            const card = person.page.locator('[data-spades-card]:enabled').first();
            const box = await visibleTarget(person.page, card, `${person.nick} playable card`);
            const sample = await tapTargets(person.page);
            measured.push({
                nick: person.nick, viewport: person.viewport, isMobile: !!person.isMobile, phase: 'play',
                card: box, tapCount: sample.controls.length, shortest: shortTargets(sample)
            });
            expect(box.width, `${person.nick} card width`).toBeGreaterThanOrEqual(TAP);
            expect(box.height, `${person.nick} card height`).toBeGreaterThanOrEqual(TAP);
            expect(shortTargets(sample), `${person.nick} tappable controls`).toEqual([]);
            await card.tap();
        };
        await playCard(west);
        await expect(west.page.locator('[data-spades-card]')).toHaveCount(12);
        await expect(host.page.locator('[data-spades-status]')).toContainText('Your play');
        await playCard(host);
        await expect(host.page.locator('[data-spades-card]')).toHaveCount(12);
        await expect(west.page.locator('[data-spades-status]')).toContainText('won the last trick');

        const trickLabel = /^(South|West|North \(CPU\)|East \(CPU\))(?: \(you\))? · Bid (?:Nil|\d+) · \d+ tricks?$/;
        for (const person of people) {
            await expect(person.page.locator('[data-spades-table]')).toHaveAttribute('data-mode', 'partners');
            await expect(person.page.locator('[data-spades-score]')).toHaveText(TEAM_SCORES);
            const labels = await person.page.locator('[data-spades-trick] span').allTextContents();
            expect(labels, person.nick).toHaveLength(4);
            for (const label of labels) expect(label, person.nick).toMatch(trickLabel);
            expect(labels.filter(label => label.startsWith('North (CPU)'))).toHaveLength(1);
            expect(labels.filter(label => label.startsWith('East (CPU)'))).toHaveLength(1);
            const you = labels.filter(label => label.includes('(you)'));
            if (person.nick === 'Host') expect(you).toEqual([expect.stringMatching(/^South \(you\) /)]);
            else if (person.nick === 'West') expect(you).toEqual([expect.stringMatching(/^West \(you\) /)]);
            else expect(you).toEqual([]);
            const tricks = labels.map(label => Number(label.match(/· (\d+) trick/)[1]));
            expect(tricks.reduce((sum, count) => sum + count, 0), person.nick).toBe(1);
            const sample = await tapTargets(person.page);
            measured.push({
                nick: person.nick, viewport: person.viewport, isMobile: !!person.isMobile, phase: 'trick',
                labels, tapCount: sample.controls.length, shortest: shortTargets(sample)
            });
            expect(shortTargets(sample), `${person.nick} tappable controls`).toEqual([]);
            expect(stuckLines(await seen[people.indexOf(person)]()), `${person.nick} dead-end`).toEqual([]);
            await expect(person.page.locator('[data-spades-error]')).toHaveText('');
        }
        expect(fixture.errors()).toEqual([]);
    } finally {
        console.log(`PARTNERS_SPADES_PHONE ${JSON.stringify(measured)}`);
        await fixture.close();
    }
});
