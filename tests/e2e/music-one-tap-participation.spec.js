// Two real browser clients exercise lobby-core's safe offer protocol. The C3
// adapter, participation status and Web Join issuer are synthetic test fixtures.
const { randomBytes, randomUUID } = require('node:crypto');
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
        musicCapability: request => ({ href: `https://webjam.example/join/#k=${randomBytes(32).toString('base64url')}`
            + `&s=${randomBytes(32).toString('hex')}&g=1&e=${Math.floor(request.expiresAt / 1000)}` }),
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
            document.addEventListener('click', event => {
                if (event.target.closest('[data-music-invite-action]')) window.__oneTapAcceptCount++;
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
        expect(inbound.filter(frame => frame.t === 'music-offer-create')).toHaveLength(1);
        expect(inbound.filter(frame => frame.t === 'music-offer-accept')).toHaveLength(1);
        expect(inbound.some(frame => frame.t === 'music-invite-offer')).toBe(false);
        await expect(offer).toContainText('audio permission stays separate');
    } finally {
        for (const identity of identities.values()) await engine.disconnect(identity.id);
        await Promise.all(contexts.map(context => context.close()));
    }
});
