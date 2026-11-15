// Phone sanity for the Game Night Turd Rush race: two phones, short viewports,
// and one large-text pass. Measures track and control clearance in CSS pixels.
const { randomBytes, randomUUID } = require('node:crypto');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const LOBBY = '/r/45662413410ed051/lobby/';
const PREVIEW = 'local-preview-key-0001';
const WAIT_FOR_HOST = /wait(ing)? for (the )?host/i;
const RESULT = /^(You win|Rival wins|Draw|Player [12] wins)( · forfeit)?$/;
const RACE_CONTROLS = ['Move left', 'Move right', 'Jump', 'Slide'];
const PHONES = [
    { width: 375, height: 667 },
    { width: 390, height: 664 },
    { width: 360, height: 640 },
    { width: 360, height: 640, fontSize: '112.5%' }
];

async function gameNight(browser, baseURL, viewport, fontSize) {
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
        const sent = frame.t === 'hello' ? { ...frame, features: { ...frame.features, arcadeTurdRush: 1 } } : frame;
        lobbySockets.get(id)?.send(JSON.stringify(sent));
    } });
    const transport = createArcadeTransport({
        name: 'turdrush', state,
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
        const person = { nick, sid, identity: null, errors: [] };
        people.set(nick, person);
        const context = await browser.newContext({ viewport, hasTouch: true });
        contexts.push(context);
        await context.route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL).origin ? route.continue() : route.abort());
        await context.route(url => url.pathname === LOBBY, async route => {
            const response = await route.fetch();
            const zoom = fontSize ? `<style>html{font-size:${fontSize}}</style>` : '';
            await route.fulfill({ response, body: (await response.text()).replace('<head>', `<head><script src="/beta/bootstrap.js"></script>${zoom}`) });
        });
        await context.route('**/beta/bootstrap.js', route => route.fulfill({ contentType: 'text/javascript', body: 'window.HangoutBootstrap={};' }));
        await context.route(url => /-ticket$/.test(url.pathname) && !!arcadeGame(url.pathname), async route => {
            const scope = arcadeRoomRequest(route.request().postDataJSON());
            if (arcadeGame(new URL(route.request().url()).pathname) !== 'turdrush' || !scope) return route.fulfill({ status: 404, json: { error: 'not found' } });
            const response = await serial(() => transport.issue(scope, session));
            await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() });
        });
        const page = await context.newPage();
        person.page = page;
        page.on('pageerror', error => person.errors.push(error.message));
        await page.routeWebSocket(url => url.pathname.endsWith('/lobby'), socket => {
            const identity = { id: 'c' + randomBytes(16).toString('hex'), dev: `device-${nick}`, iph: `ip-${nick}`, role: 'fan', account: '', admin: false, ...session };
            person.identity = identity;
            lobbySockets.set(identity.id, socket);
            socket.onMessage(raw => { at += 5000; void serial(async () => { await engine.message(identity.id, String(raw)); await reconcile(); }); });
            socket.onClose(() => { lobbySockets.delete(identity.id); void serial(async () => { await engine.disconnect(identity.id); await reconcile(); }); });
            engine.connect(identity);
        });
        await page.routeWebSocket(url => /-match$/.test(url.pathname) && arcadeGame(new URL(url).pathname) === 'turdrush', route => {
            let attachment = null;
            const socket = {
                readyState: 1,
                serializeAttachment: value => { attachment = value; },
                deserializeAttachment: () => attachment,
                send: raw => { if (socket.readyState === 1) route.send(raw); },
                close: (code = 1000, reason = '') => { if (socket.readyState !== 1) return; socket.readyState = 3; void route.close({ code, reason }); }
            };
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
        const relay = hangoutRelayWsBase(baseURL, 'turdrush-phone-sanity');
        await page.goto(`${LOBBY}?preview=${PREVIEW}&relay=${encodeURIComponent(relay)}`);
        if (fontSize) expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('18px');
        await enter(page, nick);
        return page;
    }

    return {
        phone,
        errors: () => [...people.values()].flatMap(person => person.errors.map(error => `${person.nick}: ${error}`)),
        close: () => Promise.all(contexts.map(context => context.close()))
    };
}

async function enter(page, nick) {
    const field = page.locator('[data-nick]');
    if (await field.inputValue() !== nick) await field.fill(nick);
    await page.click('[data-enter]');
    await expect(page.locator('[data-connection]')).toHaveText('Connected');
}

async function seatRace(fixture) {
    const travis = await fixture.phone('Travis');
    const candace = await fixture.phone('Candace');
    const start = travis.getByRole('button', { name: /Game Night/ });
    if (!await start.isVisible()) await travis.locator('.phonetabs [data-show="rooms"]').click();
    await start.click();
    await expect(travis.getByRole('region', { name: /Game Night/ })).toBeVisible();
    await travis.getByRole('button', { name: 'Invite players' }).click();
    await travis.getByRole('button', { name: 'Invite Candace', exact: true }).click();
    await candace.locator('[data-game-offer]').getByRole('button', { name: 'Join Game Night' }).click();
    await expect(candace.getByRole('region', { name: /Game Night/ })).toBeVisible();
    if (await travis.locator('[data-invite-dialog][open]').count()) await travis.keyboard.press('Escape');
    for (const page of [travis, candace]) {
        const picker = page.getByRole('combobox', { name: 'Switch game' });
        await expect(picker.locator('option[value="turdrush"]')).toBeEnabled();
        await picker.selectOption('turdrush');
        await expect(page.locator('[data-race-status]')).toBeVisible();
    }
    await travis.getByRole('button', { name: 'Open Turd Rush race' }).click();
    await candace.getByRole('button', { name: 'Join Turd Rush race' }).click();
    for (const page of [travis, candace]) {
        await expect(page.locator('[data-race-match]')).toHaveAttribute('data-phase', 'play');
        await expect(page.locator('[data-race-controls]')).toBeVisible();
        await expect(page.locator('[data-race-input="left"]')).toBeEnabled();
    }
    return [travis, candace];
}

async function measure(page) {
    return page.evaluate(() => {
        const round = value => Math.round(value * 10) / 10;
        function clipOf(element) {
            const clip = { top: 0, right: innerWidth, bottom: innerHeight, left: 0, limiter: 'viewport' };
            for (let node = element.parentElement; node; node = node.parentElement) {
                const style = getComputedStyle(node);
                const clipsY = ['auto', 'hidden', 'clip', 'scroll'].includes(style.overflowY);
                const clipsX = ['auto', 'hidden', 'clip', 'scroll'].includes(style.overflowX);
                if (!clipsY && !clipsX) continue;
                const rect = node.getBoundingClientRect();
                if (clipsY) {
                    if (rect.top > clip.top) clip.limiter = node.className.toString() || node.tagName;
                    clip.top = Math.max(clip.top, rect.top);
                    if (rect.bottom < clip.bottom) clip.limiter = node.className.toString() || node.tagName;
                    clip.bottom = Math.min(clip.bottom, rect.bottom);
                }
                if (clipsX) {
                    clip.left = Math.max(clip.left, rect.left);
                    clip.right = Math.min(clip.right, rect.right);
                }
            }
            return clip;
        }
        function shown(element) {
            if (!element?.isConnected || element.closest('[hidden]')) return false;
            const dialog = element.closest('dialog');
            if (dialog && !dialog.open) return false;
            const style = getComputedStyle(element);
            return style.display !== 'none' && style.visibility !== 'hidden';
        }
        function covered(element) {
            const rect = element.getBoundingClientRect();
            // Stay inside border-radius so a rounded corner is not counted as covered.
            const inset = Math.min(8, rect.width / 3, rect.height / 3);
            const points = [
                [rect.left + inset, rect.top + inset],
                [rect.right - inset, rect.top + inset],
                [rect.left + inset, rect.bottom - inset],
                [rect.right - inset, rect.bottom - inset],
                [(rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2]
            ];
            return points.filter(([x, y]) => {
                if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return true;
                const hit = document.elementFromPoint(x, y);
                return !hit || hit !== element && !element.contains(hit);
            }).length;
        }
        function gaps(element) {
            const rect = element.getBoundingClientRect();
            const clip = clipOf(element);
            return {
                top: round(rect.top - clip.top),
                bottom: round(clip.bottom - rect.bottom),
                left: round(rect.left - clip.left),
                right: round(clip.right - rect.right),
                width: round(rect.width),
                height: round(rect.height),
                viewportTop: round(rect.top),
                viewportBottom: round(innerHeight - rect.bottom),
                covered: covered(element),
                limiter: clip.limiter
            };
        }
        const buttons = [...document.querySelectorAll('[data-race-input], [data-race-leave], [data-race-main], [data-start-rematch], [data-race-confirm-yes], [data-race-confirm-no]')]
            .filter(shown)
            .map(element => ({
                name: element.getAttribute('aria-label') || element.textContent.trim(),
                kind: element.dataset.raceInput || element.dataset.raceConfirmYes !== undefined && 'confirm-yes'
                    || element.dataset.raceConfirmNo !== undefined && 'confirm-no'
                    || element.dataset.startRematch !== undefined && 'start'
                    || element.dataset.raceMain !== undefined && 'main'
                    || 'leave',
                ...gaps(element)
            }));
        return {
            viewport: { width: innerWidth, height: innerHeight },
            fontSize: getComputedStyle(document.documentElement).fontSize,
            scrollWidth: document.documentElement.scrollWidth,
            track: gaps(document.querySelector('[data-race-track]')),
            controls: shown(document.querySelector('[data-race-controls]')) ? gaps(document.querySelector('[data-race-controls]')) : null,
            buttons
        };
    });
}

function assertClearance(label, box) {
    expect(box, label).toBeTruthy();
    expect(box.top, `${label} top clearance ${box.top}px`).toBeGreaterThanOrEqual(0);
    expect(box.bottom, `${label} bottom clearance ${box.bottom}px`).toBeGreaterThanOrEqual(0);
    expect(box.left, `${label} left clearance ${box.left}px`).toBeGreaterThanOrEqual(0);
    expect(box.right, `${label} right clearance ${box.right}px`).toBeGreaterThanOrEqual(0);
    expect(box.viewportTop, `${label} viewport top ${box.viewportTop}px`).toBeGreaterThanOrEqual(0);
    expect(box.viewportBottom, `${label} viewport bottom ${box.viewportBottom}px`).toBeGreaterThanOrEqual(0);
    expect(box.covered, `${label} covered corners ${box.covered}`).toBe(0);
}

function assertTap(label, box) {
    assertClearance(label, box);
    expect(box.width, `${label} width ${box.width}px`).toBeGreaterThanOrEqual(44);
    expect(box.height, `${label} height ${box.height}px`).toBeGreaterThanOrEqual(44);
}

async function useRaceControls(page) {
    const race = page.locator('[data-race-match]');
    const sequence = () => race.getAttribute('data-sequence').then(value => Number(value));
    const lane = () => race.getAttribute('data-lane');
    async function press(name) {
        const before = await sequence();
        await page.getByRole('button', { name, exact: true }).click();
        await expect.poll(sequence).toBeGreaterThan(before);
    }
    await press('Move left');
    await expect.poll(lane).toBe('0');
    await press('Move right');
    await expect.poll(lane).toBe('1');
    await press('Jump');
    await press('Slide');
    await expect(page.locator('[data-race-error]')).toHaveText('');
}

test.describe('Turd Rush phone clearance', () => {
    test.describe.configure({ mode: 'serial', timeout: 120000 });

    for (const phone of PHONES) {
        const zoom = phone.fontSize ? ` html{font-size:${phone.fontSize}}` : '';
        test(`two phones at ${phone.width}x${phone.height}${zoom} start a race, use every control, and finish with a next step`, async ({ browser, baseURL }) => {
            const fixture = await gameNight(browser, baseURL, { width: phone.width, height: phone.height }, phone.fontSize);
            try {
                const [travis, candace] = await seatRace(fixture);
                const playing = {};
                for (const [name, page] of [['Travis', travis], ['Candace', candace]]) {
                    playing[name] = await measure(page);
                    console.log(`Turd Rush ${phone.width}x${phone.height}${zoom} ${name} playing ${JSON.stringify(playing[name])}`);
                    assertClearance(`${name} track`, playing[name].track);
                    assertClearance(`${name} controls`, playing[name].controls);
                    expect(playing[name].scrollWidth, `${name} horizontal overflow`).toBeLessThanOrEqual(phone.width);
                    for (const control of RACE_CONTROLS) {
                        assertTap(`${name} ${control}`, playing[name].buttons.find(button => button.name === control));
                    }
                    assertTap(`${name} Leave race`, playing[name].buttons.find(button => button.name === 'Leave race'));
                }
                for (const page of [travis, candace]) {
                    await page.locator('[data-race-leave]').click();
                    await expect(page.locator('[data-race-confirm]')).toBeVisible();
                    const dialog = await measure(page);
                    const yes = dialog.buttons.find(button => button.kind === 'confirm-yes');
                    const keep = dialog.buttons.find(button => button.kind === 'confirm-no');
                    console.log(`Turd Rush ${phone.width}x${phone.height}${zoom} leave dialog ${JSON.stringify({ yes, keep })}`);
                    assertTap('Leave race', yes);
                    assertTap('Keep running', keep);
                    await page.locator('[data-race-confirm-no]').click();
                    await expect.poll(() => page.locator('[data-race-confirm]').evaluate(dialog => dialog.open)).toBe(false);
                }
                await Promise.all([travis, candace].map(useRaceControls));
                for (const page of [travis, candace]) {
                    await expect(page.locator('[data-race-match]')).toHaveAttribute('data-phase', 'finished', { timeout: 70000 });
                    await expect(page.locator('[data-race-status]')).toHaveText(RESULT);
                    await expect(page.locator('[data-race-status]')).not.toHaveText(WAIT_FOR_HOST);
                }
                const finished = {};
                for (const [name, page] of [['Travis', travis], ['Candace', candace]]) {
                    finished[name] = await measure(page);
                    console.log(`Turd Rush ${phone.width}x${phone.height}${zoom} ${name} finished ${JSON.stringify(finished[name])}`);
                    assertClearance(`${name} finished track`, finished[name].track);
                    const rematch = finished[name].buttons.find(button => /Turd Rush rematch/.test(button.name));
                    assertTap(`${name} rematch`, rematch);
                    expect(finished[name].controls, `${name} race controls hide after the result`).toBeNull();
                }
                assertTap('Travis Start now', finished.Travis.buttons.find(button => button.name === 'Start now'));
                expect(finished.Candace.buttons.find(button => button.name === 'Start now')).toBeUndefined();
                await travis.getByRole('button', { name: 'Request Turd Rush rematch' }).click();
                await candace.getByRole('button', { name: 'Accept Turd Rush rematch' }).click();
                for (const page of [travis, candace]) {
                    await expect(page.locator('[data-race-match]')).toHaveAttribute('data-phase', 'countdown');
                    await expect(page.locator('[data-race-status]')).not.toHaveText(WAIT_FOR_HOST);
                    await expect(page.locator('[data-race-controls]')).toBeVisible();
                }
                const again = await measure(candace);
                console.log(`Turd Rush ${phone.width}x${phone.height}${zoom} rematch ${JSON.stringify({ track: again.track, controls: again.controls, buttons: again.buttons })}`);
                assertClearance('rematch track', again.track);
                assertClearance('rematch controls', again.controls);
                for (const control of RACE_CONTROLS) assertTap(`rematch ${control}`, again.buttons.find(button => button.name === control));
                expect(fixture.errors()).toEqual([]);
            } finally {
                await fixture.close();
            }
        });
    }
});
