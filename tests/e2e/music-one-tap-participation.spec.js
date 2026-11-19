// Two real browser clients exercise lobby-core's safe offer protocol. C3,
// relay delivery and the native WebJam host callback are synthetic fixtures.
const { randomBytes, randomUUID } = require('node:crypto');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { createLobby } = require('../../hangout-worker/src/lobby-core.mjs');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const LOBBY = '/r/45662413410ed051/lobby/';

test('a guest joins the invited Music session with one accept tap', async ({ browser, baseURL }) => {
    const relay = hangoutRelayWsBase(baseURL, `webjam-browser-one-tap-${randomUUID()}`);
    const contexts = [];
    const sockets = new Map();
    const identities = new Map();
    const inbound = [];
    let serial = 0;
    const effectCommit = { prepare: async () => Object.freeze({}), commit: async () => ({ ok: true }) };
    const participation = {
        prepare: async connections => Object.freeze({ connectionIds: connections.map(connection => connection.id) }),
        allows: () => true,
        commit: async () => ({ ok: true }),
        providerAllowed: async () => true,
        startProvider: async (_context, _request, start) => start(),
        revisionFor: (_context, actorId) => `synthetic-revision-${actorId}`,
    };
    const engine = createLobby({
        gameNight: true,
        directMusicInvites: true,
        participation,
        effectCommit,
        send: (id, frame) => sockets.get(id)?.send(JSON.stringify(frame)),
        limits: { defaultSlow: 0, pmMinLobbyMs: 0, webJoinOrigins: ['https://webjam.example'] },
    });

    async function enter(nick) {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
        contexts.push(context);
        await context.route(url => url.pathname === LOBBY, async route => {
            const response = await route.fetch();
            await route.fulfill({ response, body: (await response.text()).replace('<head>', '<head><script src="/beta/bootstrap.js"></script>') });
        });
        await context.route('**/beta/bootstrap.js', route => route.fulfill({
            contentType: 'text/javascript', body: 'window.HangoutParticipationControls=true;'
        }));
        await context.route('**/beta/participation', route => route.fulfill({ json: {
            ok: true, state: 'authorized', available: true,
            purposes: ['direct-contact', 'external-provider'], revision: 2, canStop: true
        } }));
        await context.route('https://webjam.example/join/**', route => route.fulfill({
            contentType: 'text/html', body: '<!doctype html><title>WebJam private join fixture</title><p>Invitation received.</p>'
        }));
        await context.addInitScript(() => {
            window.__oneTapAcceptCount = 0;
            window.__webJamLaunches = [];
            document.addEventListener('click', event => {
                if (event.target.closest('[data-music-invite-action]')) window.__oneTapAcceptCount++;
                const launcher = event.target.closest('a[href^="webjam-beta://hangout-music/"]');
                if (launcher) {
                    event.preventDefault();
                    window.__webJamLaunches.push(launcher.href.split('/').at(-1));
                }
            }, true);
        });
        const page = await context.newPage();
        await page.routeWebSocket(url => url.pathname.endsWith('/lobby'), socket => {
            const identity = { id: `browser-${++serial}-${randomUUID().replaceAll('-', '')}`,
                dev: `device-${nick}`, iph: `browser-network-${nick}`, role: 'fan', account: '', admin: false,
                betaSid: `synthetic-beta-session-${nick}` };
            sockets.set(identity.id, socket);
            identities.set(nick, identity);
            socket.onMessage(raw => {
                inbound.push({ nick, ...JSON.parse(String(raw)) });
                void engine.message(identity.id, String(raw));
            });
            socket.onClose(() => {
                sockets.delete(identity.id);
                void engine.disconnect(identity.id);
            });
            void engine.connect(identity);
        });
        const url = new URL(LOBBY, baseURL);
        url.search = new URLSearchParams({ preview: 'local-preview-key-0001', relay }).toString();
        await page.goto(url.href);
        await page.fill('[data-nick]', nick);
        await page.click('[data-enter]');
        await expect(page.locator('[data-connection]')).toHaveText('Connected');
        await expect(page.locator('[data-sharing-status]')).toContainText('Approved:');
        return page;
    }

    try {
        const host = await enter('MusicHost');
        const guest = await enter('MusicGuest');
        await host.locator('.phonetabs [data-show="rooms"]').click();
        await host.getByRole('button', { name: /^jam \(webjam\)/i }).click();
        await expect(host.locator('[data-jam]')).toBeVisible();
        const invite = host.locator('[data-jam-invite-music]');
        await expect(invite).toBeVisible();
        await invite.click();
        const dialog = host.locator('[data-invite-dialog]');
        await expect(dialog).toBeVisible();
        const roster = dialog.locator('[data-invite-options]');
        await expect(roster.locator('option').filter({ hasText: 'MusicGuest' })).toHaveCount(1);
        await roster.selectOption({ label: 'MusicGuest' });
        await dialog.getByRole('button', { name: 'Send Music invitation', exact: true }).click();

        const request = await host.waitForFunction(() => window.__webJamLaunches[0] || null);
        const hostRequest = await request.jsonValue();
        expect(hostRequest).toMatch(/^[a-f0-9]{32}$/);
        const callback = await host.context().newPage();
        const callbackUrl = new URL('/__webjam-native-callback-fixture', baseURL).href;
        await callback.route(callbackUrl, route => route.fulfill({
            contentType: 'text/html', body: '<!doctype html><title>WebJam native callback fixture</title>'
        }));
        await callback.goto(callbackUrl);
        const musicHref = `https://webjam.example/join/#k=${randomBytes(32).toString('base64url')}`
            + `&s=${randomBytes(32).toString('hex')}&g=1&e=${Math.floor((Date.now() + 600000) / 1000)}`;
        const returned = await callback.evaluate(({ requestId, href }) => new Promise(resolve => {
            const channel = new BroadcastChannel(`webjam-music-${requestId}`);
            const timer = setTimeout(() => { channel.close(); resolve(false); }, 5000);
            channel.onmessage = ({ data }) => {
                if (typeof data?.returned !== 'boolean') return;
                clearTimeout(timer);
                channel.close();
                resolve(data.returned);
            };
            channel.postMessage({ href });
        }), { requestId: hostRequest, href: musicHref });
        expect(returned).toBe(true);
        await expect(host.locator('[data-jam-link]')).toHaveValue('');
        expect(await host.evaluate(() => window.__webJamLaunches)).toEqual([hostRequest]);

        const offer = guest.locator('[data-music-invite]');
        await expect(offer).toBeVisible();
        await expect(offer).toContainText('MusicHost invited you to join Music.');
        const accept = offer.getByRole('button', { name: 'Accept and open Music', exact: true });
        await expect(accept).toBeVisible();
        const popupPromise = guest.waitForEvent('popup');
        await accept.click();
        const popup = await popupPromise;
        await expect(popup).toHaveTitle('WebJam private join fixture');
        const validJoin = await popup.evaluate(() => location.origin === 'https://webjam.example'
            && location.pathname === '/join/'
            && /^#k=[A-Za-z0-9_-]{43}&s=[a-f0-9]{64}&g=1&e=[1-9]\d{0,9}$/.test(location.hash));
        expect(validJoin).toBe(true);
        expect(await guest.evaluate(() => window.__oneTapAcceptCount)).toBe(1);
        expect(inbound.filter(frame => frame.t === 'music-offer-create')).toEqual([
            expect.objectContaining({ request: hostRequest, href: musicHref })
        ]);
        expect(inbound.filter(frame => frame.t === 'music-offer-accept')).toHaveLength(1);
        expect(inbound.some(frame => frame.t === 'music-invite-offer')).toBe(false);
        await expect(offer).toContainText('audio permission stays separate');
        // A guest who closed the WebJam tab can open the accepted link again
        // from the lobby, exactly as the plain Music invite allows.
        const reopen = offer.getByRole('button', { name: 'Open WebJam in browser', exact: true });
        await expect(reopen).toBeVisible();
        const reopenPromise = guest.context().waitForEvent('page');
        await reopen.click();
        const reopened = await reopenPromise;
        await expect(reopened).toHaveTitle('WebJam private join fixture');
        expect(await reopened.evaluate(() => location.hash)).toBe(new URL(musicHref).hash);
        expect(inbound.filter(frame => frame.t === 'music-offer-accept')).toHaveLength(1);
    } finally {
        for (const identity of identities.values()) await engine.disconnect(identity.id);
        await Promise.all(contexts.map(context => context.close()));
    }
});

test('the packaged browser Music host waits for explicit audio consent and closes capture when issuance is refused', async ({ page }) => {
    const hostAssets = path.resolve(__dirname, '../../.beta-assets/join/host');
    const operations = [];
    await page.route('**/join/host/**', route => {
        const file = new URL(route.request().url()).pathname.split('/').at(-1) || 'index.html';
        if (!/^[a-z-]+\.(?:html|css|js)$/.test(file)) return route.abort();
        return route.fulfill({ path: path.join(hostAssets, file) });
    });
    await page.route('**/beta/music', route => {
        operations.push(route.request().postDataJSON().op);
        return route.fulfill({ status: 403, json: { error: 'unavailable' } });
    });
    await page.route('**/music-workspace', route => route.fulfill({ contentType: 'text/html', body: `
        <!doctype html><title>Music workspace fixture</title>
        <details open><summary>Music controls</summary><iframe title="Host private Music" allow="microphone" src="/join/host/"></iframe></details>` }));
    await page.addInitScript(() => {
        if (window === window.top) sessionStorage.setItem('private-music-host', JSON.stringify({ request: 'a'.repeat(32),
            webjam: 'b'.repeat(64), proof: 'c'.repeat(64), generation: 1, expires: Date.now() + 60000 }));
        window.musicCaptureAttempts = 0;
        const Audio = window.AudioContext || window.webkitAudioContext;
        const getUserMedia = async () => {
            window.musicCaptureAttempts += 1;
            const oscillatorContext = window.musicFixtureContext = new Audio();
            const stream = oscillatorContext.createMediaStreamDestination().stream;
            window.musicFixtureTrack = stream.getAudioTracks()[0];
            return stream;
        };
        Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia } });
    });
    const music = page.frameLocator('iframe[title="Host private Music"]');
    const frame = music.owner();
    try {
        await page.goto('/music-workspace');
        const start = music.getByRole('button', { name: 'Start with microphone' });
        await expect(start).toBeDisabled();
        await music.getByRole('checkbox', { name: 'I’m wearing headphones' }).check();
        await expect(start).toBeEnabled();
        expect(await frame.evaluate(iframe => iframe.contentWindow.musicCaptureAttempts)).toBe(0);
        expect(operations).toEqual([]);
        await start.click();
        await expect(music.getByRole('status')).toContainText('Music could not start');
        expect(await frame.evaluate(iframe => ({ attempts: iframe.contentWindow.musicCaptureAttempts,
            readyState: iframe.contentWindow.musicFixtureTrack.readyState })))
            .toEqual({ attempts: 1, readyState: 'ended' });
        await expect.poll(() => operations.slice()).toEqual(['host-join', 'host-stop']);
        await expect(start).toBeDisabled();
        await expect(music.getByRole('button', { name: 'Stop Music' })).toBeHidden();
    } finally { await frame.evaluate(iframe => iframe.contentWindow.musicFixtureContext?.close()).catch(() => {}); }
});
