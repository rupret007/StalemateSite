// Family Game Night route on a phone, with the in-room call up.
// The production song engine is created only when the suite boots
// (play/assets/turdsuite.js Suite.music / #suite-music-toggle). This lobby
// route mounts Game sound effects (game-night-audio.mjs) and the call, and
// does not mount that song control. The test asserts that truthful state,
// then proves a chess turn, the live mic and camera, and Leave.
const { randomBytes, randomUUID } = require('node:crypto');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const PHONE = { width: 390, height: 844 };
const LOBBY = '/r/45662413410ed051/lobby/';
const PREVIEW = 'local-preview-key-0001';
const SONG_MUTE_NAME = /Stalemate music (on|off), tap to turn music (off|on)/;

test.use({
    permissions: ['camera', 'microphone'],
    trace: 'off',
    video: 'off',
    screenshot: 'only-on-failure',
    launchOptions: {
        args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--disable-features=WebRtcHideLocalIpsWithMdns']
    }
});

async function familyNight(browser, baseURL) {
    const { createLobby } = await import('../../hangout-worker/src/lobby-core.mjs');
    const { arcadeGame, arcadeRoomRequest, createArcadeTransport } = await import('../../hangout-worker/src/arcade-transport.mjs');
    const { createGameNightMedia } = await import('../../hangout-worker/src/game-night-media.mjs');
    const contexts = [];
    const lobbySockets = new Map();
    const people = new Map();
    const matchSockets = [];
    const departures = [];
    const records = new Map();
    let at = 1800000000000;
    let alarm = null;
    let upgrading = null;
    let queue = Promise.resolve();
    const serial = task => { const run = queue.then(task); queue = run.catch(() => {}); return run; };
    const storage = {
        getAlarm: async () => alarm,
        setAlarm: async value => { alarm = value; },
        get: async key => structuredClone(records.get(key)),
        put: async (key, value) => {
            for (const [name, record] of typeof key === 'string' ? [[key, value]] : Object.entries(key)) records.set(name, structuredClone(record));
        },
        delete: async key => { for (const name of [key].flat()) records.delete(name); },
        list: async ({ prefix = '', limit = Infinity } = {}) => new Map([...records].filter(([key]) => key.startsWith(prefix)).slice(0, limit))
    };
    const state = {
        storage,
        getWebSockets: () => matchSockets,
        acceptWebSocket: socket => { matchSockets.push(socket); }
    };
    const connection = id => [...people.values()].find(person => person.identity?.id === id);
    const engine = createLobby({
        gameNight: true,
        now: () => at,
        limits: { defaultSlow: 0, roomPerDevice: 1 },
        send: (id, frame) => {
            const person = connection(id);
            if (frame.t === 'part' && person) {
                const ref = engine.arcadeRoomRef(frame.ch, false);
                if (ref) departures.push({ scope: { room: frame.ch, ref }, subject: person.sid });
            }
            const sent = frame.t === 'hello'
                ? { ...frame, features: { ...frame.features, arcadeChess: 1, arcadeMedia: 1 } }
                : frame;
            lobbySockets.get(id)?.send(JSON.stringify(sent));
        }
    });
    const current = scope => {
        const person = connection(scope.actor);
        if (!person || !lobbySockets.has(scope.actor)) return null;
        const member = engine.arcadeActor(scope, false);
        return member ? { ...person.identity, ...member, socket: person } : null;
    };
    const transport = createArcadeTransport({
        name: 'chess',
        state,
        current,
        active: async () => true,
        charge: async () => true,
        allowed: () => true,
        approve: async actor => (await engine.approveArcade(actor))?.ok === true
    });
    const media = createGameNightMedia({
        state,
        current,
        active: async () => true,
        charge: async () => true,
        allowed: () => true,
        approve: async (...args) => (await engine.approveGameMedia(...args))?.ok === true
    });
    globalThis.WebSocketPair = class { constructor() { this[0] = {}; this[1] = upgrading; } };
    async function reconcile() {
        for (const departure of departures.splice(0)) await transport.revoke(departure.scope, departure.subject);
        transport.reconcile();
        media.reconcile();
    }
    function attachSocket(route, session, onReady) {
        let attachment = null;
        const socket = {
            readyState: 1,
            serializeAttachment: value => { attachment = value; },
            deserializeAttachment: () => attachment,
            send: raw => { if (socket.readyState === 1) route.send(raw); },
            close: (code = 1000, reason = '') => {
                if (socket.readyState !== 1) return;
                socket.readyState = 3;
                void route.close({ code, reason });
            }
        };
        return { socket, accept: () => serial(async () => {
            upgrading = socket;
            try {
                const refused = await onReady(socket, route.protocols().join(', '), session);
                socket.readyState = 3;
                await route.close({ code: 1008, reason: `upgrade refused ${refused.status}` });
            } catch (error) {
                if (!(error instanceof RangeError) || !matchSockets.includes(socket)) throw error;
            } finally { upgrading = null; }
        }) };
    }

    async function phone(nick) {
        const sid = randomUUID();
        const session = { betaSid: sid, betaInviteVersion: '1' };
        const person = { nick, sid, identity: null, errors: [] };
        people.set(nick, person);
        const context = await browser.newContext({
            viewport: { width: PHONE.width, height: PHONE.height },
            isMobile: true,
            hasTouch: true,
            permissions: ['camera', 'microphone']
        });
        contexts.push(context);
        await context.addInitScript(() => {
            window.__capturedTracks = [];
            const devices = navigator.mediaDevices;
            if (!devices?.getUserMedia) return;
            const capture = devices.getUserMedia.bind(devices);
            devices.getUserMedia = async (...args) => {
                const stream = await capture(...args);
                for (const track of stream.getTracks()) window.__capturedTracks.push(track);
                return stream;
            };
        });
        await context.route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL).origin ? route.continue() : route.abort());
        await context.route(url => url.pathname === LOBBY, async route => {
            const response = await route.fetch();
            await route.fulfill({
                response,
                body: (await response.text()).replace('<head>', '<head><script src="/beta/bootstrap.js"></script>')
            });
        });
        await context.route('**/beta/bootstrap.js', route => route.fulfill({
            contentType: 'text/javascript',
            body: 'window.HangoutBootstrap={};'
        }));
        await context.route(url => url.pathname === '/beta/arcade-ticket', async route => {
            const scope = arcadeRoomRequest(route.request().postDataJSON());
            if (!scope) return route.fulfill({ status: 404, json: { error: 'not found' } });
            const response = await serial(() => transport.issue(scope, session));
            await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() });
        });
        await context.route(url => url.pathname === '/beta/game-night-media-ticket', async route => {
            const scope = arcadeRoomRequest(route.request().postDataJSON());
            if (!scope) return route.fulfill({ status: 404, json: { error: 'not found' } });
            const response = await serial(() => media.issue(scope, session));
            await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() });
        });
        const page = await context.newPage();
        person.page = page;
        page.on('pageerror', error => person.errors.push(error.message));
        await page.routeWebSocket(url => url.pathname.endsWith('/lobby'), socket => {
            const identity = {
                id: 'c' + randomBytes(16).toString('hex'),
                dev: `device-${nick}`,
                iph: `ip-${nick}`,
                role: 'fan',
                account: '',
                admin: false,
                ...session
            };
            person.identity = identity;
            lobbySockets.set(identity.id, socket);
            socket.onMessage(raw => { at += 5000; void serial(async () => { await engine.message(identity.id, String(raw)); await reconcile(); }); });
            socket.onClose(() => { lobbySockets.delete(identity.id); void serial(async () => { await engine.disconnect(identity.id); await reconcile(); }); });
            engine.connect(identity);
        });
        await page.routeWebSocket(url => /-match$/.test(url.pathname) && arcadeGame(url.pathname) === 'chess', route => {
            const { socket, accept } = attachSocket(route, session, (_socket, protocols, currentSession) => transport.upgrade(protocols, currentSession));
            route.onMessage(raw => void serial(() => transport.receive(socket, String(raw))));
            route.onClose(() => void serial(async () => {
                if (socket.readyState !== 1) return;
                const scope = socket.deserializeAttachment();
                socket.serializeAttachment({ ...scope, retired: true });
                socket.readyState = 3;
                await transport.presenceChanged(scope);
            }));
            void accept();
        });
        await page.routeWebSocket(url => url.pathname === '/beta/game-night-media', route => {
            const { socket, accept } = attachSocket(route, session, (_socket, protocols, currentSession) => media.upgrade(protocols, currentSession));
            route.onMessage(raw => void serial(() => media.receive(socket, String(raw))));
            route.onClose(() => void serial(() => {
                if (socket.readyState !== 1) return;
                const scope = socket.deserializeAttachment();
                socket.serializeAttachment({ ...scope, retired: true });
                socket.readyState = 3;
                media.reconcile();
            }));
            void accept();
        });
        await page.goto(`${LOBBY}?preview=${PREVIEW}&relay=${encodeURIComponent(hangoutRelayWsBase(baseURL, 'family-song-mute'))}`);
        const field = page.locator('[data-nick]');
        if (await field.inputValue() !== nick) await field.fill(nick);
        await page.locator('[data-enter]').tap();
        await expect(page.locator('[data-connection]')).toHaveText('Connected');
        return page;
    }

    return {
        phone,
        errors: () => [...people.values()].flatMap(person => person.errors),
        close: () => Promise.all(contexts.map(context => context.close()))
    };
}

async function openGameNight(host) {
    const start = host.getByRole('button', { name: /Game Night/ });
    if (!await start.isVisible()) await host.locator('.phonetabs [data-show="rooms"]').tap();
    await start.tap();
    await expect(host.getByRole('region', { name: /Game Night/ })).toBeVisible();
}

async function invite(host, guest, nick) {
    await host.getByRole('button', { name: 'Invite players' }).tap();
    await host.getByRole('button', { name: `Invite ${nick}`, exact: true }).tap();
    await guest.locator('[data-game-offer]').getByRole('button', { name: 'Join Game Night' }).tap();
    await expect(guest.getByRole('region', { name: /Game Night/ })).toBeVisible();
    if (await host.locator('[data-invite-dialog][open]').count()) await host.keyboard.press('Escape');
}

async function showChess(page) {
    const picker = page.getByRole('combobox', { name: 'Switch game' });
    await expect(picker.locator('option[value="chess"]')).toBeEnabled();
    await picker.selectOption('chess');
    await expect(page.locator('[data-chess-status]')).toBeVisible();
}

async function joinCall(page) {
    await page.getByRole('button', { name: 'Call', exact: true }).tap();
    await page.getByRole('button', { name: 'Join call', exact: true }).tap();
    await expect(page.locator('[data-call-toggle]')).toHaveText('Call joined');
    await expect(page.locator('[data-call-status]')).toContainText('in the call');
}

async function enableMicAndCamera(page) {
    await page.getByRole('button', { name: 'Unmute mic' }).tap();
    await expect(page.getByRole('button', { name: 'Mute mic' })).toBeVisible();
    await page.getByLabel('I am 18 or older').check();
    await page.getByRole('button', { name: 'Turn camera on' }).tap();
    await expect(page.getByRole('button', { name: 'Turn camera off' })).toBeVisible();
}

async function songEngine(page) {
    return page.evaluate(() => ({
        suiteMusic: typeof window.Suite?.music,
        toggleLabel: document.getElementById('suite-music-toggle')?.getAttribute('aria-label') || '',
        musicState: document.documentElement.dataset.stalemateMusic || '',
        songSources: [...document.querySelectorAll('audio')].map(audio => audio.currentSrc || audio.src || '').filter(src => /stalemate\/.+\.m4a/.test(src))
    }));
}

async function liveTracks(page) {
    return page.evaluate(() => (window.__capturedTracks || []).filter(track => track.readyState === 'live').map(track => ({
        kind: track.kind,
        enabled: track.enabled,
        muted: track.muted
    })));
}

async function expectCallHeld(page) {
    await expect(page.locator('[data-call-toggle]')).toHaveText('Call joined');
    await expect(page.locator('[data-call-status]')).toContainText('in the call');
    await expect(page.locator('[data-call-peers] li')).toHaveCount(1);
    const tracks = await liveTracks(page);
    expect(tracks).toEqual(expect.arrayContaining([
        { kind: 'audio', enabled: true, muted: false },
        { kind: 'video', enabled: true, muted: false }
    ]));
    const leave = page.getByRole('button', { name: 'Leave', exact: true });
    await leave.scrollIntoViewIfNeeded();
    await expect(leave).toBeVisible();
    await expect(leave).toBeEnabled();
    const box = await leave.boundingBox();
    expect(box?.width).toBeGreaterThan(0);
    expect(box?.height).toBeGreaterThan(0);
    expect(box.y + box.height).toBeLessThanOrEqual(PHONE.height + 1);
}

test('family Game Night keeps the call, a chess turn, and Leave with no separate song mute', async ({ browser, baseURL }) => {
    test.slow();
    const fixture = await familyNight(browser, baseURL);
    try {
        const host = await fixture.phone('HostExample');
        const guest = await fixture.phone('GuestWest');
        await openGameNight(host);
        await invite(host, guest, 'GuestWest');
        await showChess(host);
        await showChess(guest);
        await host.getByRole('button', { name: 'Open Chess match' }).tap();
        await guest.getByRole('button', { name: 'Join as Black' }).tap();
        await expect(host.locator('[data-chess-status]')).toContainText('White · Your turn');
        await expect(guest.locator('[data-chess-status]')).toContainText('Black · White to move');

        await joinCall(host);
        await joinCall(guest);
        await expect(host.locator('[data-call-peers] li')).toHaveCount(1);
        await expect(guest.locator('[data-call-peers] li')).toHaveCount(1);
        await host.getByRole('button', { name: 'Allow room cameras' }).tap();
        await expect(host.getByRole('button', { name: 'Disable room cameras' })).toBeVisible();
        await enableMicAndCamera(host);
        await enableMicAndCamera(guest);

        // play/assets/turdsuite.js:331 creates the song engine and :794 names the
        // mute control. lobby/index.html:249 and game-night-audio.mjs:8 only
        // mount Game sound effects. This route has no song control to tap.
        for (const page of [host, guest]) {
            await expect(page.getByRole('button', { name: 'Game sound', exact: true })).toBeVisible();
            await expect(page.getByRole('button', { name: SONG_MUTE_NAME })).toHaveCount(0);
            await expect(page.locator('#suite-music-toggle')).toHaveCount(0);
            expect(await songEngine(page)).toEqual({
                suiteMusic: 'undefined',
                toggleLabel: '',
                musicState: '',
                songSources: []
            });
            await expectCallHeld(page);
            expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(PHONE.width);
        }

        const from = host.locator('[data-square="e2"]');
        await from.scrollIntoViewIfNeeded();
        await from.tap();
        const to = host.locator('[data-square="e4"]');
        await expect(to).toHaveAttribute('data-legal', '');
        await to.tap();
        await expect(host.locator('[data-chess-status]')).toContainText('White · Black to move');
        await expect(guest.locator('[data-chess-status]')).toContainText('Black · Your turn');
        await expect(guest.getByRole('button', { name: 'e4, White pawn' })).toBeAttached();
        await expect(host.getByRole('button', { name: 'e4, White pawn' })).toBeAttached();

        for (const page of [host, guest]) {
            expect(await songEngine(page)).toEqual({
                suiteMusic: 'undefined',
                toggleLabel: '',
                musicState: '',
                songSources: []
            });
            await expectCallHeld(page);
        }
        expect(fixture.errors()).toEqual([]);
    } finally {
        await fixture.close();
    }
});
