import { makeDemoInvite } from '../../hangout-worker/src/beta-auth.mjs';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium, webkit } from 'playwright';
import { expect } from '@playwright/test';
import { suggestSpadesBid } from '../../play/games/turdspades-engine.js';
import { findDuelSolution } from '../../hangout-worker/arcade/games/turdomania-duel.js';
import { unpackRushRacer } from '../../hangout-worker/arcade/games/turdrush-race.js';
import '../../hangout-worker/arcade/games/turdrummy-rules.js';

const runProcess = promisify(execFile);

export async function runArcadeBrowser(engine, origin, invitation, evidence, entrances, media, relay = false, options = {}) {
    const mixed = options.previousClient || options.previousWorker ? options : null;
    const browser = await { chromium, webkit }[engine].launch({
        headless: true, ...(engine === 'chromium' ? { args: ['--enable-unsafe-swiftshader',
            ...(media ? ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] : [])] } : {})
    });
    const errors = [];
    const naturalBrickRace = process.env.ARCADE_BRICK_FULL_RACE === '1';
    const longRoomTrace = [];
    async function enterFromShell(page, name, game = false) {
        await page.getByRole('link', { name: game ? /Enter Game Night/ : /Choose a nickname and join/ }).click();
        await page.getByLabel('Your nick').fill(name);
        await page.locator('[data-enter]').click();
        await expect(page.locator('[data-connection]')).toHaveText('Connected');
    }
    async function guest(source, name, viewport, hasTouch = false, gameUrl = null, previousClient = false) {
        const context = await browser.newContext({ viewport, hasTouch, reducedMotion: 'reduce', serviceWorkers: 'block', ignoreHTTPSErrors: true,
            ...(previousClient ? { extraHTTPHeaders: { 'X-Fixture-Previous-Lobby': '1' } } : {}) });
        if (hasTouch) await context.addInitScript(() => {
            const native = HTMLCanvasElement.prototype.getContext;
            HTMLCanvasElement.prototype.getContext = function (type, ...options) {
                if (type === 'webgl2' && this.hasAttribute('data-race-3d')) return null;
                return native.call(this, type, ...options);
            };
        });
        if (media) await context.addInitScript(forceRelay => {
            window.testPeers = [];
            window.testLocalTracks = [];
            window.RTCPeerConnection = class extends RTCPeerConnection {
                constructor(config) {
                    super(forceRelay ? { ...config, iceTransportPolicy: 'relay' } : config);
                    window.testPeers.push(this);
                }
            };
            const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
            navigator.mediaDevices.getUserMedia = async (...args) => {
                if (window.testDenyDevice) {
                    window.testDenyDevice = false;
                    throw new DOMException('Denied by the test', 'NotAllowedError');
                }
                const stream = await capture(...args);
                window.testLocalTracks.push(...stream.getTracks());
                return stream;
            };
        }, relay);
        const entrance = entrances?.[source];
        await context.route('**/*', route => {
            const url = route.request().url();
            if (new URL(url).origin === origin) return route.continue();
            if (url === entrance?.url && route.request().isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: entrance.html });
            return route.abort('blockedbyclient');
        });
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        page.on('pageerror', error => errors.push(`${name}: ${error.message}`));
        if (naturalBrickRace && name === 'ChessGuest') page.on('websocket', socket => {
            if (new URL(socket.url()).pathname !== '/lobby') return;
            for (const direction of ['framesent', 'framereceived']) socket.on(direction, ({ payload }) => {
                try {
                    const { t, name, kind, text } = JSON.parse(payload.toString());
                    if (!['part', 'closed', 'notice', 'rate-limit'].includes(t) && !(t === 'cmd' && name === 'part')) return;
                    longRoomTrace.push({ direction, t, name, kind, text });
                    if (longRoomTrace.length > 16) longRoomTrace.shift();
                } catch { /* Preserve structured fixture diagnostics only. */ }
            });
            socket.on('close', () => longRoomTrace.push({ t: 'socket closed' }));
        });
        const protectedBoard = await context.request.get(origin + '/play/games/chess-board.js');
        assert.ok((mixed?.previousWorker ? [401, 404] : [401]).includes(protectedBoard.status()), 'anonymous match asset stays protected');
        const destination = `${origin}/beta/?via=${source}`;
        if (gameUrl) await page.goto(gameUrl);
        else if (entrance) {
            await page.goto(entrance.url);
            const entry = page.getByRole('link', { name: 'Play online with friends' });
            await expect(entry).toHaveAttribute('href', destination);
            await Promise.all([
                page.waitForRequest(request => request.isNavigationRequest() && request.url() === destination),
                entry.click()
            ]);
        } else await page.goto(destination);
        await page.getByLabel('Invitation code').fill(invitation);
        await page.getByRole('button', { name: 'Enter the community' }).click();
        await enterFromShell(page, name, !!gameUrl);
        const label = source === 'rad-dad' ? 'via Rad Dad' : 'via Stalemate';
        await expect(page.locator('[data-entry-label]').first()).toHaveText(label);
        return page;
    }
    async function sendGameInvite(host, nick, capture) {
        await host.getByRole('button', { name: 'Invite players' }).click();
        const dialog = host.locator('[data-invite-dialog]');
        await expect(dialog.locator('form')).toBeHidden();
        if (capture) await capture();
        await dialog.getByRole('button', { name: `Invite ${nick}`, exact: true }).click();
    }
    async function inviteToGame(host, guest, nick) {
        await sendGameInvite(host, nick);
        const offer = guest.locator('[data-game-offer]');
        await offer.getByRole('button', { name: 'Join Game Night', exact: true }).click();
        await expect(offer).toBeHidden();
    }
    async function verifyMixedVersions({ previousClient, previousWorker }) {
        const host = await guest('stalemate', previousWorker ? 'OldWorkerHost' : 'CurrentHost', { width: 1280, height: 900 });
        const nick = previousWorker ? 'OldWorkerGuest' : 'PreviousClient';
        const player = await guest('rad-dad', nick, { width: 375, height: 667 }, true, null, previousClient);
        await host.getByRole('button', { name: /Game Night/ }).click();
        await inviteToGame(host, player, nick);
        await expect(player.locator('[data-arcade-game]')).toHaveCount(previousClient ? 0 : 1);
        await expect(player.getByRole('combobox', { name: 'Switch game' })).toBeHidden();
        await expect(player.locator('[data-call-toggle]')).toBeHidden();
        if (previousWorker) {
            await expect(host.getByRole('combobox', { name: 'Switch game' })).toBeHidden();
            await expect(host.locator('[data-call-toggle]')).toBeHidden();
        } else {
            if (media) await expect(host.locator('[data-call-toggle]')).toBeVisible();
            await host.getByRole('combobox', { name: 'Switch game' }).selectOption('chess');
            await host.getByRole('button', { name: 'Open Chess match' }).click();
            await expect(host.locator('[data-chess-status]')).toContainText('Waiting');
        }
        for (const [sender, recipient, message] of [[player, host, 'Hello from Rad Dad'], [host, player, 'Hello from Stalemate']]) {
            await sender.locator('[data-text]').fill(message);
            await sender.locator('[data-send]').click();
            await expect(recipient.getByRole('log', { name: 'Conversation' })).toContainText(message);
        }
        console.log(`Passed ${engine} ${previousWorker ? 'current client with previous Worker' : 'previous and current clients together'}, invitation and two-way room chat.`);
    }
    async function captureArcadeInvite(page, viewport, step, mask = []) {
        const output = process.env.ARCADE_INVITE_EVIDENCE || evidence;
        if (!output) return;
        await mkdir(output, { recursive: true });
        const visible = await page.locator('body').innerText();
        assert.ok(!visible.includes(invitation));
        assert.doesNotMatch(visible, /(?:instance=[a-f0-9]+|\b[a-f0-9]{32,}\b)/i);
        const textNodes = await page.evaluateHandle(() => {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), changes = [];
            while (walker.nextNode()) {
                const node = walker.currentNode, original = node.textContent;
                const cleaned = original.replace(/#?game-[a-f0-9]{6}x[a-f0-9]{6}/gi, 'Game Night');
                if (cleaned !== original) { changes.push([node, original]); node.textContent = cleaned; }
            }
            return changes;
        });
        try {
            await page.screenshot({ path: join(output, `${engine}-${viewport.width}x${viewport.height}-${step}.png`),
                animations: 'disabled', mask });
        } finally {
            await textNodes.evaluate(changes => { for (const [node, original] of changes) node.textContent = original; });
            await textNodes.dispose();
        }
    }
    async function expectUncoveredControl(control) {
        await expect(control).toBeInViewport({ ratio: 1 });
        assert.ok(await control.evaluate(button => {
            const rect = button.getBoundingClientRect();
            const navigation = document.querySelector('.phonetabs')?.getBoundingClientRect();
            const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
            return button.contains(hit) && (!navigation?.height || rect.bottom <= navigation.top);
        }), 'the full control stays above the mobile sections and receives the pointer');
    }
    async function reopenGameNight(host, viewport, phone) {
        const original = host.viewportSize();
        const before = await host.evaluate(() => window.__lobby.chans.get(window.__lobby.active)?.keepRef);
        assert.ok(/^[a-f0-9]{32}$/.test(before || ''), 'the host has a live room');
        try {
            await host.setViewportSize(viewport);
            // A lost connection preserves the table. An explicit Leave intentionally retires its seat.
            await host.goto(origin + '/r/45662413410ed051/lobby/?via=rad-dad');
            await host.getByLabel('Your nick').fill('LinkHost');
            await host.locator('[data-enter]').click();
            await expect(host.locator('[data-connection]')).toHaveText('Connected');
            await expect(host.locator('[data-game-night]')).toBeHidden();
            if (phone) await host.locator('.phonetabs [data-show="rooms"]').click();
            await host.locator('[data-start="game"]').click();
            await expect(host.locator('[data-game-night]')).toBeVisible();
            assert.ok(await host.evaluate(ref => window.__lobby.chans.get(window.__lobby.active)?.keepRef === ref, before),
                'opening Game Night returns the host to the same room instance');
            await host.getByRole('combobox', { name: 'Switch game' }).selectOption('chess');
            await expect(host.locator('[data-chess-status]')).toContainText('Waiting for an opponent');
            await captureArcadeInvite(host, viewport, 'reopened-00-host-waiting');
        } finally { await host.setViewportSize(original); }
    }
    async function verifyArcadeInvites(host) {
        for (const phone of [true, false]) {
            const viewport = phone ? { width: 390, height: 844 } : { width: 1440, height: 900 };
            const nick = phone ? 'InviteGuestPhone' : 'InviteGuestDesktop';
            const friend = await guest(phone ? 'stalemate' : 'rad-dad', nick, viewport, phone);
            const game = phone ? 'chess' : 'turdspades';
            const label = phone ? 'Royal Flush Chess' : 'TurdSpades';
            try {
                await host.getByRole('combobox', { name: 'Switch game' }).selectOption(game);
                await host.getByRole('button', { name: phone ? 'Open Chess match' : 'Open 4-player Spades' }).click();
                await expect(host.locator(phone ? '[data-chess-status]' : '[data-spades-status]')).toContainText(phone ? 'Waiting for an opponent' : '1/4 seated');
                const hostViewport = host.viewportSize();
                await host.setViewportSize(viewport);
                try { await sendGameInvite(host, nick, () => captureArcadeInvite(host, viewport, '00-host-invite')); }
                finally { await host.setViewportSize(hostViewport); }
                const offer = friend.locator('[data-game-offer]');
                await expect(offer).toContainText(`LinkHost invited you to play ${label}.`);
                await expect(friend.locator('[data-game-night]')).toBeHidden();
                await captureArcadeInvite(friend, viewport, '01-accept');
                const accept = offer.getByRole('button', { name: 'Play ' + label, exact: true });
                if (phone) await accept.tap(); else await accept.click();
                await expect(offer).toBeHidden();
                if (phone) {
                    await expect(friend.locator('[data-chess-status]')).toHaveText('You’re Black · White to move');
                    await moveByKeyboard(host, 'e2', 'ArrowUp', 2);
                    await expect(friend.getByRole('button', { name: 'e4, White pawn' })).toBeAttached();
                    await expect(friend.locator('[data-chess-status]')).toHaveText('You’re Black · Your turn');
                    await fit(friend, 'direct invitation');
                } else {
                    await expect(friend.locator('[data-spades-status]')).toHaveText(/2\/4 seated · You’re West/);
                    await expect(host.locator('[data-spades-status]')).toContainText('2/4 seated');
                    await expect(friend.getByRole('button', { name: 'Join West' })).toBeHidden();
                }
                await captureArcadeInvite(friend, viewport, '02-seated');
                console.log(`Passed ${engine} ${viewport.width}x${viewport.height} ${label} invitation, one guest tap to the same table.`);
                await friend.locator('[data-leave]').click();
                await expect(friend.locator('[data-game-night]')).toBeHidden();
                if (phone) {
                    await host.getByRole('button', { name: 'Open Chess match' }).click();
                    await expect(host.locator('[data-chess-status]')).toContainText('Waiting for an opponent');
                    await sendGameInvite(host, nick);
                    await expect(accept).toBeVisible();
                    await host.getByRole('button', { name: 'Close waiting match' }).click();
                    await host.getByRole('button', { name: 'Open Chess match' }).click();
                    await expect(host.locator('[data-chess-status]')).toContainText('Waiting for an opponent');
                    await accept.tap();
                    await expect(friend.getByText('This game invitation no longer has an open seat. Ask the host for a fresh invitation.')).toBeVisible();
                    await expect(host.locator('[data-chess-status]')).toContainText('Waiting for an opponent');
                    await friend.locator('[data-leave]').click();
                    await expect(friend.locator('[data-game-night]')).toBeHidden();
                    await host.getByRole('button', { name: 'Close waiting match' }).click();
                } else {
                    await expect(host.locator('[data-spades-status]')).toContainText('1/4 seated');
                    await host.getByRole('button', { name: 'Close table', exact: true }).click();
                }
            } finally {
                await friend.context().close();
            }
        }
    }
    async function shareGameNightLink(host, viewport, step, capturePicker, useClipboard = false) {
        const original = host.viewportSize();
        await host.bringToFront();
        await host.evaluate(copy => {
            window.testGameInvitation = '';
            if (copy) {
                Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
                Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async url => {
                    if (!window.allowTestGameInvitationCopy) throw new DOMException('Clipboard unavailable', 'NotAllowedError');
                    window.testGameInvitation = url;
                } });
                return;
            }
            Object.defineProperty(navigator, 'share', { configurable: true, value: async ({ url }) => { window.testGameInvitation = url; } });
        }, useClipboard);
        try {
            await host.setViewportSize(viewport);
            await host.getByRole('button', { name: 'Invite players' }).click();
            const newGuest = host.getByRole('button', { name: /^Invite a friend to / });
            await expect(newGuest).toBeFocused();
            if (capturePicker) await capturePicker(newGuest);
            await newGuest.click();
            const deliver = host.getByRole('button', { name: useClipboard ? 'Copy invite' : 'Share invite' });
            await expect(deliver).toBeFocused();
            await captureArcadeInvite(host, viewport, step);
            await deliver.click();
            if (useClipboard) {
                const status = host.locator('[data-game-invite-link-status]');
                await expect(status).toHaveText('Couldn’t copy the invitation. You can still use Email invite.');
                await expect(host.getByRole('button', { name: 'Email invite' })).toBeVisible();
                await host.evaluate(() => { window.allowTestGameInvitationCopy = true; });
                await deliver.click();
                await expect(status).toContainText('Invitation copied.');
                await host.getByRole('button', { name: 'Cancel' }).click();
            }
            const link = new URL(await host.evaluate(() => window.testGameInvitation));
            assert.ok(link.origin === origin && link.pathname === '/beta/game-night/guest' && /^#invite=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(link.hash), 'the delivery action receives one private game invitation');
            return link;
        } finally {
            await host.evaluate(copy => {
                delete window.testGameInvitation;
                delete navigator.share;
                if (copy) {
                    delete navigator.clipboard.writeText;
                    delete window.allowTestGameInvitationCopy;
                }
            }, useClipboard);
            await host.setViewportSize(original);
        }
    }
    async function openGameNightLink(page, link) {
        // Keep the invitation out of browser automation navigation logs.
        await page.addInitScript(({ path, hash }) => {
            if (location.pathname === path) history.replaceState(null, '', path + hash);
        }, { path: link.pathname, hash: link.hash });
        await page.goto(origin + link.pathname);
    }
    async function tapGameNightLink(page, link, phone) {
        const entry = origin + '/_fixture/invite-tap';
        await page.route(entry, route => route.fulfill({ contentType: 'text/html',
            body: '<meta name="viewport" content="width=device-width"><a href="#">Open invitation</a>' }));
        await page.goto(entry);
        await page.evaluate(url => { document.querySelector('a').href = url; }, link.href);
        const area = await page.getByRole('link', { name: 'Open invitation' }).boundingBox();
        assert.ok(area);
        const x = area.x + area.width / 2, y = area.y + area.height / 2;
        if (phone) await page.touchscreen.tap(x, y);
        else await page.mouse.click(x, y);
    }
    async function verifyFirstVisit(host) {
        for (const phone of [true, false]) {
            const viewport = phone ? { width: 390, height: 844 } : { width: 1440, height: 900 };
            await host.getByRole('combobox', { name: 'Switch game' }).selectOption('chess');
            await host.getByRole('button', { name: 'Open Chess match' }).click();
            await expect(host.locator('[data-chess-status]')).toContainText('Waiting for an opponent');
            const link = await shareGameNightLink(host, viewport, 'first-visit-00-host-share');
            const inviteFromTable = host.locator('.arcade-chess').getByRole('button', { name: 'Invite a friend', exact: true });
            await inviteFromTable.click();
            const picker = host.getByRole('dialog', { name: 'Invite a guest' });
            await expect(picker.getByRole('button', { name: 'Invite a friend to Royal Flush Chess' })).toBeFocused();
            await picker.press('Escape');
            await expect(inviteFromTable).toBeFocused();
            const context = await browser.newContext({ viewport, hasTouch: phone, reducedMotion: 'reduce', ignoreHTTPSErrors: true });
            try {
                const guest = await context.newPage();
                guest.setDefaultTimeout(10000);
                guest.on('pageerror', error => errors.push(`First visit: ${error.message}`));
                assert.equal((await context.cookies()).length, 0, 'guest starts with an empty browser profile');
                const unconfirmed = await context.request.post(origin + '/beta/game-night/invitation/accept', {
                    headers: { Origin: origin }, data: { code: new URLSearchParams(link.hash.slice(1)).get('invite'), age13: false }
                });
                assert.equal(unconfirmed.status(), 400, 'the guest must confirm the age and house rules');
                assert.equal((await context.cookies()).length, 0, 'an unconfirmed invitation grants no access');
                await openGameNightLink(guest, link);
                await expect(guest.getByRole('heading', { name: 'Royal Flush Chess' })).toBeVisible();
                await expect(guest.getByText('LinkHost invited you to play.')).toBeVisible();
                await expect(guest.getByRole('textbox')).toHaveCount(0);
                await expect(guest.getByRole('button')).toHaveCount(1);
                assert.equal(new URL(guest.url()).hash, '');
                await captureArcadeInvite(guest, viewport, 'first-visit-01-guest-accept');
                await reopenGameNight(host, viewport, phone);
                const join = guest.getByRole('button', { name: 'Join game', exact: true });
                await expect(join).toBeInViewport({ ratio: 1 });
                await expect(join).toHaveAccessibleDescription(/13\+ and agree to the house rules/);
                assert.ok((await join.boundingBox()).height >= 44, 'the first action is a full touch target');
                if (phone) {
                    let connections = 0;
                    await guest.routeWebSocket(url => url.pathname === '/lobby', socket => {
                        if (++connections > 1) socket.connectToServer();
                    });
                }
                let ticketRequested = false, releaseTicket;
                const holdTicket = new Promise(resolve => { releaseTicket = resolve; });
                await guest.route(url => url.pathname === '/beta/arcade-ticket' && url.searchParams.get('game-guest') === '1', async route => {
                    ticketRequested = true;
                    await holdTicket;
                    await route.continue();
                }, { times: 1 });
                await guest.route(url => url.pathname.endsWith('/lobby/arcade-chess.mjs'), route => route.abort(), { times: 1 });
                try {
                    if (phone) {
                        await join.tap();
                        const joining = guest.locator('[data-game-guest-connecting]');
                        await expect(joining.getByRole('status')).toHaveText('Still connecting to your game…', { timeout: 9000 });
                        const retry = joining.getByRole('button', { name: 'Try again', exact: true });
                        await expectUncoveredControl(retry);
                        await retry.tap();
                        await expect(retry).toBeHidden();
                    } else {
                        await expect(join).toBeFocused();
                        await guest.keyboard.press('Enter');
                    }
                    const retryGame = guest.getByRole('button', { name: 'Try again', exact: true });
                    await expect(guest.locator('[data-game-guest-status]')).toHaveText('Royal Flush Chess could not load. Try again.');
                    await expect(retryGame).toBeFocused();
                    await expectUncoveredControl(retryGame);
                    await captureArcadeInvite(guest, viewport, 'first-visit-01-game-load-retry');
                    if (phone) await retryGame.tap();
                    else await guest.keyboard.press('Enter');
                    await expect.poll(() => ticketRequested).toBe(true);
                    const joining = guest.locator('[data-game-guest-connecting]');
                    await expect(joining.getByRole('heading', { name: 'Royal Flush Chess', exact: true })).toBeVisible();
                    await expect(joining.getByRole('status')).toHaveText('Finding your seat…');
                    await expect(guest.locator('[data-app]')).toBeHidden();
                    await expect(guest.locator('.titlebar')).toBeHidden();
                    const shell = await context.request.get(guest.url());
                    assert.ok(shell.ok());
                    const html = await shell.text();
                    assert.match(html, /<main class="gate" data-gate hidden>/);
                    assert.match(html, /<main class="gate" data-game-guest-connecting>/);
                    assert.match(html, /<h1 data-game-guest-title>Royal Flush Chess<\/h1>/);
                    await captureArcadeInvite(guest, viewport, 'first-visit-01-finding-seat');
                } finally {
                    releaseTicket();
                }
                await expect(guest.locator('[data-chess-status]')).toHaveText('You’re Black · White to move');
                await expect(guest.locator('[data-game-guest-connecting]')).toBeHidden();
                await expect(guest.locator('details.arcade-chess > summary')).toBeFocused();
                const pieces = guest.locator('.arcade-chess cg-board piece');
                await expect(pieces).toHaveCount(32);
                await expect(pieces.first()).toBeVisible();
                await expect(guest.getByLabel('Your nick')).toBeHidden();
                await expect(guest.getByRole('combobox', { name: 'Switch game' })).toBeHidden();
                await expect(guest.locator('[data-call-toggle]')).toBeHidden();
                await expect(guest.getByRole('tab', { name: '#stalemate' })).toHaveCount(0);
                assert.equal((await context.request.get(origin + '/beta/state')).status(), 401, 'room guest lacks community access');
                assert.equal((await context.request.post(origin + '/beta/arcade-turdanoid-ticket?game-guest=1', {
                    headers: { Origin: origin }, data: {}
                })).status(), 403, 'room guest lacks permission for a different game');
                await moveByKeyboard(host, 'e2', 'ArrowUp', 2);
                await expect(guest.getByRole('button', { name: 'e4, White pawn' })).toBeAttached();
                await expect(guest.locator('[data-chess-status]')).toHaveText('You’re Black · Your turn');
                await captureArcadeInvite(guest, viewport, 'first-visit-02-seated');
                const leaveMatch = guest.getByRole('button', { name: 'Leave match', exact: true });
                await expectUncoveredControl(leaveMatch);
                await expectUncoveredControl(guest.locator('[data-send]'));
                if (phone) {
                    await guest.setViewportSize({ width: 390, height: 664 });
                    try {
                        await leaveMatch.scrollIntoViewIfNeeded();
                        await expectUncoveredControl(leaveMatch);
                        await expectUncoveredControl(guest.locator('[data-send]'));
                        await captureArcadeInvite(guest, guest.viewportSize(), 'phone-short-03-controls');
                    } finally { await guest.setViewportSize(viewport); }
                } else await expect(guest.getByLabel('Announce new chat messages')).toBeVisible();
                await guest.reload();
                await expect(guest.locator('[data-chess-status]')).toHaveText('You’re Black · Your turn');
                await guest.locator('[data-text]').fill('First visit from the game invite');
                await guest.locator('[data-send]').click();
                await expect(host.getByRole('log', { name: 'Conversation' })).toContainText('First visit from the game invite');
                const reused = await context.newPage();
                await openGameNightLink(reused, link);
                await expect(reused.getByRole('status')).toHaveText('This invite is no longer available. Ask your host for a new one.');
                await expect(reused.getByRole('button', { name: 'Join game' })).toBeHidden();
                await reused.close();
                await context.request.post(origin + '/beta/game-night/invitation/leave', { headers: { Origin: origin }, data: { sessionRef: '0'.repeat(64) } });
                assert.equal((await context.request.get(origin + '/beta/state?game-guest=1')).status(), 200, 'an obsolete tab cannot close a different invitation');
                if (!phone) await guest.route('**/beta/game-night/invitation/leave', route => route.fulfill({ status: 503 }), { times: 1 });
                await guest.locator('[data-leave]').click();
                await expect(guest.locator('[data-game-night]')).toBeHidden();
                if (!phone) await guest.getByRole('button', { name: 'Retry closing invitation', exact: true }).click();
                await expect.poll(async () => (await context.request.get(origin + '/beta/state?game-guest=1')).status()).toBe(401);
                await expect(guest.locator('[data-session-reason]')).toHaveText('You left Game Night. Ask your host for a fresh invitation.');
                await captureArcadeInvite(guest, viewport, 'first-visit-04-left');
                await guest.reload();
                await expect(guest.locator('[data-game-night]')).toHaveCount(0);
                console.log(`Passed ${engine} ${viewport.width}x${viewport.height} first-visit Chess, host room reopened, one tap to the same game, move, reload, room chat and replay refusal.`);
            } finally { await context.close(); }
        }
    }
    async function verifyGuestJoinRetry(host) {
        const message = 'The invitation could not be confirmed. Try again.';
        for (const phone of [true, false]) {
            const viewport = phone ? { width: 390, height: 844 } : { width: 1440, height: 900 };
            await host.getByRole('combobox', { name: 'Switch game' }).selectOption('chess');
            await host.getByRole('button', { name: 'Open Chess match' }).click();
            await expect(host.locator('[data-chess-status]')).toContainText('Waiting for an opponent');
            const link = await shareGameNightLink(host, viewport, 'guest-retry-00-share', undefined, !phone);
            const context = await browser.newContext({ viewport, hasTouch: phone, reducedMotion: 'reduce', ignoreHTTPSErrors: true });
            try {
                const friend = await context.newPage();
                await openGameNightLink(friend, link);
                await friend.route('**/beta/game-night/invitation/accept', route => route.fulfill({
                    status: 503, json: { error: message }
                }), { times: 1 });
                const join = friend.getByRole('button', { name: 'Join game', exact: true });
                const activate = () => phone ? join.tap() : friend.keyboard.press('Enter');
                if (!phone) await expect(join).toBeFocused();
                await activate();
                await expect(friend.locator('[data-guest-status]')).toHaveText(message);
                await expect(join).toBeEnabled();
                await captureArcadeInvite(friend, viewport, 'guest-retry-01-error');
                if (!phone) await expect(join).toBeFocused();
                await activate();
                await expect(friend.locator('[data-chess-status]')).toHaveText('You’re Black · White to move');
                await captureArcadeInvite(friend, viewport, 'guest-retry-02-seated');
                await friend.locator('[data-leave]').click();
                await expect(friend.locator('[data-game-night]')).toBeHidden();
                console.log(`Passed ${engine} ${viewport.width}x${viewport.height} Game Night Join retry after a temporary server error.`);
            } finally { await context.close(); }
        }
    }
    async function verifySpadesPartners(host) {
        const desktop = { width: 1440, height: 900 }, phone = { width: 390, height: 844 };
        const original = host.viewportSize();
        const context = await browser.newContext({ viewport: phone, hasTouch: true, reducedMotion: 'reduce', ignoreHTTPSErrors: true });
        const friend = await context.newPage();
        friend.on('pageerror', error => errors.push(`Spades partners: ${error.message}`));
        const status = page => page.locator('[data-spades-status]');
        const cards = page => page.locator('[data-spades-card]');
        const table = page => page.locator('[data-spades-table]');
        try {
            await host.setViewportSize(desktop);
            await host.getByRole('combobox', { name: 'Switch game' }).selectOption('turdspades');
            await host.getByRole('button', { name: 'Open 2-player Spades' }).click();
            await expect(status(host)).toContainText('1/2 seated');
            const link = await shareGameNightLink(host, desktop, 'spades-00-host-share');
            await openGameNightLink(friend, link);
            await expect(friend.getByRole('heading', { name: 'TurdSpades', exact: true })).toBeVisible();
            await captureArcadeInvite(friend, phone, 'spades-01-guest-accept');
            await friend.getByRole('button', { name: 'Join game', exact: true }).tap();
            await expect(table(friend)).toHaveAttribute('data-mode', 'partners');
            await expect(status(friend)).toHaveText('You and a computer partner vs the host and a computer · tap Bid for me');
            await expect(friend.locator('.arcade-card-score')).toBeHidden();
            for (const player of [host, friend]) await expect(cards(player)).toHaveCount(13);
            const suitOf = { Spades: 'S', Hearts: 'H', Diamonds: 'D', Clubs: 'C' };
            const guestHand = (await friend.locator('[data-spades-card]').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label'))))
                .map(label => {
                    const [rank, , suitName] = label.split(' ');
                    return { rank, suit: suitOf[suitName] };
                });
            await expect(friend.locator('#spades-bid')).toHaveValue(String(suggestSpadesBid(guestHand)));
            await friend.getByRole('button', { name: 'Bid for me' }).tap();
            await host.getByRole('button', { name: 'Bid for me' }).click();
            await expect(table(host)).toHaveAttribute('data-phase', 'play');
            await expect(friend.locator('[data-spades-trick]')).toContainText('North (CPU)');
            await expect(friend.locator('[data-spades-trick]')).toContainText('East (CPU)');
            await expect(status(friend)).toHaveText(/Your play · tap a card/);
            await captureArcadeInvite(host, desktop, 'spades-02-playing');
            await captureArcadeInvite(friend, phone, 'spades-02-playing');

            const players = [host, friend], remaining = [13, 13];
            for (let play = 0; play < 26; play++) {
                let turn;
                await expect.poll(async () => {
                    const messages = await Promise.all(players.map(page => status(page).textContent()));
                    turn = messages.flatMap((message, index) => message.startsWith('Round 1 · Your play') ? [index] : []);
                    return turn.length;
                }).toBe(1);
                const index = turn[0], page = players[index], card = page.locator('[data-spades-card]:enabled').first();
                if (play === 0) {
                    await card.tap();
                    await expect(status(friend)).not.toContainText('tap a card');
                } else await card.click();
                await expect(cards(page)).toHaveCount(--remaining[index]);
                if (play === 1) {
                    const scores = friend.locator('.arcade-card-score');
                    await expect(scores).toBeVisible();
                    const totals = await scores.locator('span').allTextContents();
                    assert.equal(totals.length, 2);
                    for (const total of totals) assert.match(total, /\/250 · \d+ bags/);
                }
                if (play === 5) {
                    await friend.reload();
                    await expect(cards(friend)).toHaveCount(remaining[1]);
                }
            }
            for (const page of players) await expect(table(page)).toHaveAttribute('data-phase', 'round-end');
            assert.deepEqual(await host.locator('[data-spades-score]').allTextContents(), await friend.locator('[data-spades-score]').allTextContents());
            await friend.locator('[data-spades-action="resign"]').click();
            await friend.getByRole('dialog', { name: 'Resign for your team?' }).getByRole('button', { name: 'Resign', exact: true }).click();
            await host.getByRole('button', { name: 'Request Spades rematch' }).click();
            await expect(status(friend)).toContainText('1/2 ready for a rematch');
            await friend.getByRole('button', { name: 'Accept Spades rematch' }).click();
            await expect(cards(friend)).toHaveCount(13);
            await friend.locator('[data-leave]').click();
            await expect(friend.locator('[data-game-night]')).toBeHidden();
            console.log(`Passed ${engine} 2-player TurdSpades, one tap to the original table, two computer partners, a scored round, reload and two-player rematch.`);
        } finally {
            await context.close();
            await host.setViewportSize(original);
        }
    }
    async function verifyWebJamShare() {
        const viewport = { width: 1440, height: 900 };
        for (const webShare of [true, false]) {
            const host = await guest('stalemate', webShare ? 'ShareHost' : 'EmailHost', viewport, false,
                origin + '/beta/?game-night=1&table=chess&deliver=share&via=stalemate');
            let issues = 0;
            try {
                host.on('request', request => {
                    if (new URL(request.url()).pathname === '/beta/game-night/invitation/issue') issues++;
                });
                await host.evaluate(supported => {
                    window.testGameShares = 0;
                    Object.defineProperty(navigator, 'share', { configurable: true, value: supported ? async ({ title, url }) => {
                        window.testGameShares++;
                        if (!navigator.userActivation.isActive) throw new DOMException('No activation', 'NotAllowedError');
                        if (title !== 'Join me for Royal Flush Chess' || new URL(url).pathname !== '/beta/game-night/guest')
                            throw new DOMException('Unexpected destination', 'DataError');
                        if (window.testGameShares === 1) throw new DOMException('Canceled', 'AbortError');
                    } : undefined });
                }, webShare);
                await host.getByRole('button', { name: 'Start Game Night', exact: true }).click();
                const open = host.getByRole('button', { name: 'Open Chess match', exact: true });
                await expect(open).toBeVisible();
                assert.equal(issues, 0, 'the host opens a waiting match before preparing its invitation');
                await open.click();
                const share = host.getByRole('button', { name: webShare ? 'Share invite' : 'Email invite', exact: true });
                await expect(share).toBeFocused();
                await expect(share).toBeEnabled();
                await expect(host.getByRole('button', { name: 'Copy invite', exact: true })).toBeVisible();
                assert.equal(issues, 1, 'the WebJam handoff prepares exactly one invitation');
                assert.equal(await host.evaluate(() => window.testGameShares), 0, 'table readiness never invokes Web Share');
                assert.ok(!new URL(host.url()).searchParams.has('deliver'), 'the handoff is removed from the address');
                if (webShare) {
                    await share.click();
                    await expect(share).toBeVisible();
                    await share.click();
                    await expect(share).toBeHidden();
                    assert.equal(await host.evaluate(() => window.testGameShares), 2, 'both share calls came from trusted clicks');
                }
                assert.equal(issues, 1, 'sharing an already prepared invitation issues no extra link');
            } finally { await host.context().close(); }
        }
    }
    async function verifyGameNightEntry() {
        const host = await guest('rad-dad', 'LinkHost', { width: 1280, height: 900 }, false, origin + '/beta/?game-night=1&via=rad-dad');
        await host.getByRole('button', { name: 'Start Game Night', exact: true }).click();
        await verifyArcadeInvites(host);
        if (!mixed) {
            await verifyFirstVisit(host);
            await verifyGuestJoinRetry(host);
            await verifySpadesPartners(host);
        }
        await host.getByRole('button', { name: 'Room address' }).click();
        const share = host.getByRole('dialog', { name: 'Game Night room address' });
        const link = new URL(await share.getByLabel('Room address').inputValue());
        assert.equal(link.origin, origin);
        assert.equal(link.pathname, '/beta/');
        assert.equal(link.search, '?game-night=1&via=rad-dad');
        assert.match(link.hash, /^#game=game-[a-f0-9]{6}x[a-f0-9]{6}&instance=[a-f0-9]{32}$/);
        if (evidence) await host.screenshot({ path: join(evidence, `webjam-room-link-${engine}.png`),
            mask: [share.getByLabel('Room address')] });
        await share.getByRole('button', { name: 'Done' }).click();
        const player = await guest('rad-dad', 'LinkGuest', { width: 390, height: 844 }, true, link.href);
        const joinOffer = player.locator('[data-game-offer]').getByRole('button', { name: 'Join Game Night', exact: true });
        async function expectRefusal() {
            await joinOffer.click();
            await expect(player.getByText('Couldn’t join Game Night. Ask the host for a fresh invitation.', { exact: true })).toBeVisible();
            await expect(player.locator('[data-game-night]')).toBeHidden();
        }
        assert.equal(new URL(player.url()).hash, '');
        await expectRefusal();
        await sendGameInvite(host, 'LinkGuest');
        await expect(player.locator('[data-game-offer-status]')).toHaveText('LinkHost invited you to Game Night.');
        const stale = new URL(link);
        stale.hash = stale.hash.slice(0, -1) + (stale.hash.endsWith('0') ? '1' : '0');
        await player.goto(stale.href);
        await enterFromShell(player, 'LinkGuest', true);
        await expectRefusal();
        await player.goto(link.href);
        await enterFromShell(player, 'LinkGuest', true);
        await joinOffer.click();
        await expect(player.locator('[data-game-night]')).toBeVisible();
        await expect(player.getByRole('button', { name: 'Room address' })).toBeHidden();
        await expect(player.locator('[data-entry-return][href]')).toHaveCount(0);
        await expect(host.locator('[data-entry-return][href]')).toHaveCount(0);
        const matches = [], calls = [];
        if (media && !relay) {
            for (const [path, connections] of [[/\/beta\/arcade-match$/, matches], [/\/beta\/game-night-media$/, calls]]) {
                await player.routeWebSocket(path, route => {
                    const server = route.connectToServer();
                    connections.push([route, server]);
                    if (connections === matches && matches.length === 2) server.onMessage(message => {
                        // Upgrade and deliver match-ready, but never confirm the board on this socket.
                        if (typeof message !== 'string' || JSON.parse(message).t !== 'match-state') route.send(message);
                    });
                });
            }
        }
        const playerGame = player.getByRole('combobox', { name: 'Switch game' });
        await host.getByRole('combobox', { name: 'Switch game' }).selectOption('chess');
        await expect(host.locator('details.arcade-chess > summary')).toBeFocused();
        await expectUncoveredControl(host.getByRole('button', { name: 'Open Chess match' }));
        if (media && !relay) await player.route('**/beta/arcade-ticket', route => route.fulfill({ status: 403 }), { times: 1 });
        await playerGame.selectOption('chess');
        if (media && !relay) {
            await expect(player.locator('[data-chess-status]')).toHaveText('Return to your Game Night room and try again.');
            await expect(player.getByRole('button', { name: 'Reconnect to Chess' })).toBeHidden();
            await playerGame.selectOption('crapeights');
            await playerGame.selectOption('chess');
        }
        await host.getByRole('button', { name: 'Open Chess match' }).click();
        await expect(host.locator('[data-chess-status]')).toContainText('You’re White · Waiting for an opponent');
        await expect(player.locator('[data-chess-status]')).toHaveText('Black is open. Join to play.');
        await player.getByRole('button', { name: 'Join as Black' }).click();
        await expect(host.locator('[data-chess-status]')).toHaveText('You’re White · Your turn');
        await expect(host.locator('[data-clock-side="w"] [data-clock-label]')).toHaveText('White · You');
        await expect(player.locator('[data-clock-side="b"] [data-clock-label]')).toHaveText('Black · You');
        await expect(host.locator('[data-clock-side="w"]')).toHaveAttribute('aria-current', 'true');
        await moveByKeyboard(host, 'e2', 'ArrowUp', 2);
        await expect(player.getByRole('button', { name: 'e4, White pawn' })).toBeAttached();
        await player.locator('[data-text]').fill('Meet me at the chess board');
        await player.locator('[data-send]').tap();
        await expect(host.getByRole('log', { name: 'Conversation' }).getByRole('listitem')
            .filter({ hasText: 'Meet me at the chess board' })).toBeVisible();
        if (!media && !relay) {
            const panel = player.locator('details.arcade-chess');
            const summary = panel.locator('summary');
            await summary.tap();
            await expect(panel).not.toHaveAttribute('open', '');
            await expect(player.locator('[data-game-waiting]')).toHaveText('Choose a game to see whether a table is open.');
            assert.equal(await player.evaluate(() => JSON.parse(sessionStorage.getItem('hangout-game-return')).game), 'chess');
            await player.addInitScript(() => {
                const focus = HTMLElement.prototype.focus;
                HTMLElement.prototype.focus = function (options) {
                    if (this.matches('details.arcade-chess > summary')) window.returnFocusOptions = options;
                    return focus.call(this, options);
                };
            });
            await player.reload();
            await player.getByLabel('Your nick').fill('LinkGuest');
            await player.locator('[data-enter]').click();
            await expect(player.locator('[data-connection]')).toHaveText('Connected');
            const back = player.getByRole('button', { name: 'Back to my seat', exact: true });
            await expect(player.locator('[data-game-offer-status]')).toHaveText('You disconnected. Return to your game to check your seat.');
            await back.tap();
            await expect(panel).toHaveAttribute('open', '');
            await expect(summary).toBeFocused();
            assert.equal(await player.evaluate(() => window.returnFocusOptions?.preventScroll), true);
            await expect(player.locator('[data-chess-status]')).toHaveText('You’re Black · Your turn');
            await expect(player.getByRole('button', { name: 'e4, White pawn' })).toBeAttached();
            console.log(`Passed ${engine} collapsed phone Chess return to the same seat and board without scrolling.`);
        }
        if (media && !relay) {
            await verifyTransportRecovery(host, player, matches, calls);
            await player.goto(link.href);
            await enterFromShell(player, 'LinkGuest', true);
            await expectRefusal();
            console.log('Passed Chromium kicked guest cannot reuse the old Game Night link.');
        }
        console.log(`Passed ${engine} protected Game Night launch, invite-only room link, stale instance refusal, shared Chess move and chat.`);
    }
    async function verifyPrivateSiteEntry() {
        for (const phone of [true, false]) {
            const viewport = phone ? { width: 390, height: 844 } : { width: 1440, height: 900 };
            const context = await browser.newContext({ viewport, hasTouch: phone, reducedMotion: 'reduce', ignoreHTTPSErrors: true });
            try {
                await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
                const page = await context.newPage();
                page.on('pageerror', error => errors.push(`Stalemate preview: ${error.message}`));
                await page.goto(origin + '/site/');
                await expect(page.getByRole('heading', { name: 'Stalemate', exact: true })).toBeVisible();
                await expect(page.getByRole('link', { name: 'Play online with friends', exact: true })).toBeInViewport({ ratio: 1 });
                await expect(page.locator('video[title="Manic lyric video"]')).toBeAttached();
                await captureArcadeInvite(page, viewport, 'site-00-home');
                await page.getByRole('link', { name: 'Arcade', exact: true }).first().click();
                assert.equal(new URL(page.url()).pathname, '/site/play/');
                const arcadeOnline = page.getByRole('link', { name: /Play online with friends/ });
                await expect(arcadeOnline).toBeInViewport({ ratio: 1 });
                assert.ok((await arcadeOnline.boundingBox()).height >= 44, 'the Arcade online action is a full touch target');
                await expect(page.getByText('Your records stay on this device.')).toBeVisible();
                await captureArcadeInvite(page, viewport, 'site-01-arcade');
                await page.getByRole('link', { name: /Royal Flush Chess/ }).click();
                assert.equal(new URL(page.url()).pathname, '/site/play/chess.html');
                const shared = page.getByRole('link', { name: 'Play chess online with a friend' });
                await expect(shared).toBeInViewport({ ratio: 1 });
                assert.ok((await shared.boundingBox()).height >= 44, 'the Chess online action is a full touch target');
                await expect(page.getByText('Share this device', { exact: true })).toBeVisible();
                await captureArcadeInvite(page, viewport, 'site-02-chess');
                const [entry] = await Promise.all([
                    page.waitForRequest(request => request.isNavigationRequest() && new URL(request.url()).pathname === '/beta/'),
                    phone ? shared.tap() : shared.click()
                ]);
                assert.equal(new URL(entry.url()).searchParams.get('table'), 'chess');
                await expect(page.getByLabel('Invitation code')).toBeVisible();
                if (!phone) {
                    await page.getByLabel('Invitation code').fill(invitation);
                    await page.getByRole('button', { name: 'Enter the community' }).click();
                    await enterFromShell(page, 'PreviewHost', true);
                    await expect(page.locator('[data-game-offer-status]')).toContainText('Royal Flush Chess');
                    await page.getByRole('button', { name: 'Start Game Night', exact: true }).click();
                    await page.getByRole('button', { name: 'Open Chess match' }).click();
                    await expect(page.locator('[data-chess-status]')).toContainText('Waiting for an opponent');
                    await captureArcadeInvite(page, viewport, 'site-03-shared-chess');
                }
                console.log(`Passed ${engine} ${viewport.width}x${viewport.height} Stalemate preview home, Arcade, solo Chess and private shared Chess entrance.`);
            } finally { await context.close(); }
        }
    }
    async function verifyBrandGuestEntry(source) {
        const radDad = source === 'rad-dad';
        const brand = radDad ? 'Rad Dad' : 'Stalemate';
        const root = radDad ? '/site/rad-dad/' : '/site/';
        for (const phone of [true, false]) {
            const viewport = phone ? { width: 390, height: 844 } : { width: 1440, height: 900 };
            async function openProfile() {
                const context = await browser.newContext({ viewport, hasTouch: phone, reducedMotion: 'reduce',
                    serviceWorkers: 'block', ignoreHTTPSErrors: true });
                await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
                const page = await context.newPage();
                page.setDefaultTimeout(10000);
                page.on('pageerror', error => errors.push(`${brand} guest entry: ${error.message}`));
                return page;
            }
            const host = await openProfile();
            const friend = await openProfile();
            const step = label => `${source}-${label}`;
            try {
                await host.goto(origin + root);
                await expect(host.getByRole('heading', { level: 1, name: new RegExp(brand) })).toBeVisible();
                await host.getByRole('link', { name: radDad ? /Hit the arcade/ : /^Arcade$/ }).first().click();
                assert.equal(new URL(host.url()).pathname, root + 'play/');
                const online = host.getByRole('link', { name: /Play online with friends/ });
                await expectUncoveredControl(online);
                await captureArcadeInvite(host, viewport, step('00-arcade'));
                await online.click();
                assert.equal(new URL(host.url()).pathname, '/beta/');
                await expect(host.getByLabel('Invitation code')).toBeVisible();
                const demoUrl = new URL(host.url());
                demoUrl.search = new URLSearchParams({ 'game-night': '1', via: source });
                demoUrl.hash = new URLSearchParams({ invite: await makeDemoInvite(options.demoSigningKey, '1', Date.now() - 72 * 60 * 60_000) });
                await host.goto('about:blank');
                await host.goto(demoUrl.href);
                await expect(host.getByRole('status').first()).toContainText('Ask your host for a new one.');
                assert.equal(new URL(host.url()).hash, '');
                assert.equal((await host.context().cookies()).length, 0);
                demoUrl.hash = new URLSearchParams({ invite: await makeDemoInvite(options.demoSigningKey, '1') });
                await host.goto('about:blank');
                await host.goto(demoUrl.href);
                await expect(host.getByRole('link', { name: /Enter Game Night/ })).toHaveCount(1);
                assert.equal(new URL(host.url()).hash, '');
                await captureArcadeInvite(host, viewport, step('01-game-night-entry'));
                await enterFromShell(host, radDad ? 'RadDadHost' : 'PreviewHost', true);
                await expect(host.locator('[data-entry-label]').first()).toHaveText(`via ${brand}`);
                await host.getByRole('button', { name: 'Start Game Night', exact: true }).click();
                await expect(host.getByRole('combobox', { name: 'Switch game' }).locator('option:not([disabled])')).toHaveText([
                    'Games', 'Royal Flush Chess', 'Crappy Eights', 'TurdRummy', 'TurdSpades', 'Crapjack 21',
                    'Turdtris Sprint', 'Turdomania Duel', 'Turd Rush Race', 'Turdanoid Brick Race'
                ]);
                const privateArcade = host.getByRole('button', { name: `Open ${brand} Arcade`, exact: true });
                const roomUrl = host.url();
                const tabs = host.context().pages().length;
                await expect(host.locator('[data-game-arcade-external]')).not.toHaveAttribute('href', /./);
                await expectUncoveredControl(privateArcade);
                if (phone) await privateArcade.tap();
                else await privateArcade.click();
                const gamePicker = host.getByRole('combobox', { name: 'Switch game' });
                await expect(gamePicker).toBeFocused();
                await host.keyboard.press('Escape');
                assert.equal(host.url(), roomUrl);
                assert.equal(host.context().pages().length, tabs);
                const closed = new URL('/beta/game-night/guest', origin);
                closed.hash = 'invite=invalid-local-fixture';
                await friend.goto(closed.href);
                const unavailable = friend.locator('[data-guest-status]');
                await expect(unavailable).toHaveText('This invite is no longer available. Ask your host for a new one.');
                await expect(unavailable).toBeFocused();
                await expect(friend.getByRole('button', { name: 'Join game', exact: true })).toBeHidden();
                assert.equal(new URL(friend.url()).hash, '');
                const invitePlayers = host.getByRole('button', { name: 'Invite players', exact: true });
                await invitePlayers.click();
                const invitePicker = host.locator('[data-invite-dialog]');
                await expect(invitePicker.getByText('Open a game with a free seat to invite a friend.')).toBeVisible();
                await expect(invitePicker.getByRole('button', { name: /^Invite a friend/ })).toHaveCount(0);
                await captureArcadeInvite(host, viewport, step('02a-open-a-table'));
                await invitePicker.getByRole('button', { name: 'Cancel' }).click();
                await host.getByRole('button', { name: 'Room address', exact: true }).click();
                const address = host.getByRole('dialog', { name: 'Game Night room address' });
                await expect(address.getByText('Players with a room invitation can use this address.', { exact: false })).toBeVisible();
                await captureArcadeInvite(host, viewport, step('02b-room-address'), [address.getByLabel('Room address')]);
                await address.getByRole('button', { name: 'Done' }).click();
                await host.getByRole('combobox', { name: 'Switch game' }).selectOption('chess');
                await host.getByRole('button', { name: 'Open Chess match' }).click();
                await expect(host.locator('[data-chess-status]')).toContainText('Waiting for an opponent');
                const link = await shareGameNightLink(host, viewport, step('02-share'), async newGuest => {
                    await expect(newGuest).toHaveAccessibleName('Invite a friend to Royal Flush Chess');
                    await expect(invitePicker.getByText('Nobody else is in Hang Out yet.')).toHaveCount(0);
                    await captureArcadeInvite(host, viewport, step('02c-invite-picker'));
                    if (!phone) return;
                    await host.route('**/beta/game-night/invitation/issue', route =>
                        route.fulfill({ status: 503, contentType: 'text/html', body: '<p>Service unavailable</p>' }), { times: 1 });
                    await newGuest.tap();
                    await expect(host.locator('[data-game-invite-link-status]')).toHaveText('The invitation could not be prepared. Try again.');
                    await expect(newGuest).toBeFocused();
                    await expectUncoveredControl(newGuest);
                    await expect(host.getByRole('button', { name: 'Share invite', exact: true })).toBeHidden();
                    await captureArcadeInvite(host, viewport, step('02d-invite-retry'));
                });
                assert.equal((await friend.context().cookies()).length, 0, 'the invited profile is completely new');
                const attempts = [];
                const acceptPath = '/beta/game-night/invitation/accept';
                friend.on('request', request => {
                    if (new URL(request.url()).pathname === acceptPath && request.method() === 'POST')
                        attempts.push(request.postDataJSON().attempt);
                });
                const gameTitle = friend.getByRole('heading', { name: 'Royal Flush Chess' });
                await tapGameNightLink(friend, link, phone);
                await expect(gameTitle).toBeVisible();
                assert.equal(new URL(friend.url()).hash, '', 'the invitation stays out of the address');
                await friend.reload();
                await expect(gameTitle).toBeVisible();
                assert.equal(attempts.length, 0, 'refresh before confirmation must not attempt to join');
                assert.equal((await friend.context().cookies()).length, 0, 'refresh before confirmation grants no access');
                await expect(friend.getByRole('textbox')).toHaveCount(0);
                await expect(friend.getByRole('button')).toHaveCount(1);
                const joinGame = friend.getByRole('button', { name: 'Join game', exact: true });
                await expectUncoveredControl(joinGame);
                await captureArcadeInvite(friend, viewport, step('03-accept-after-refresh'));
                let firstStatus;
                await friend.route(url => url.pathname === acceptPath, async route => {
                    const response = await route.fetch();
                    firstStatus = response.status();
                    await response.dispose();
                    await route.abort();
                }, { times: 1 });
                await (phone ? joinGame.tap() : joinGame.click());
                await expect(friend.locator('[data-guest-status]')).toHaveText('Couldn’t join just now. Try again.');
                assert.equal(firstStatus, 200, 'the server accepted the invitation before its response was dropped');
                await captureArcadeInvite(friend, viewport, step('03b-join-response-interrupted'));
                await friend.context().clearCookies();
                await friend.reload({ waitUntil: 'commit' });
                await expect(friend.locator('[data-chess-status]')).toContainText('You’re Black');
                assert.ok(attempts.length === 2 && attempts[0] === attempts[1], 'reload recovers the same accepted attempt');
                assert.ok(await friend.evaluate(() => !history.state?.gameNightInvite), 'the seated page retains no invitation state');
                await moveByKeyboard(host, 'e2', 'ArrowUp', 2);
                await expect(friend.locator('[data-chess-status]')).toHaveText('You’re Black · Your turn');
                await tapSquare(friend, 'd7', phone);
                await tapSquare(friend, 'd5', phone);
                await expect(host.getByRole('button', { name: 'd5, Black pawn' })).toBeAttached();
                await captureArcadeInvite(friend, viewport, step('04-playing'));
                assert.equal((await friend.context().request.get(origin + '/beta/state')).status(), 401, 'the guest has only game access');
                console.log(`Passed ${engine} ${viewport.width}x${viewport.height} ${brand} invitation refresh, interrupted acceptance, and first move.`);
            } finally {
                await friend.context().close();
                await host.context().close();
            }
        }
    }
    async function verifyTransportRecovery(host, player, matches, calls) {
        const interrupt = connection => Promise.all(connection.map(route => route.close({ code: 1011, reason: 'fixture connection interrupted' })));
        for (const page of [host, player]) {
            await page.getByRole('button', { name: 'Call', exact: true }).click();
            await page.getByRole('button', { name: 'Join call', exact: true }).click();
            await expect(page.locator('[data-call-toggle]')).toHaveText('Call joined');
            await page.getByRole('button', { name: 'Unmute mic' }).click();
            await expect(page.getByRole('button', { name: 'Mute mic' })).toBeVisible();
        }
        await waitForPackets(host, 'audio');
        await waitForPackets(player, 'audio');
        const before = await packetCount(player, 'audio');
        assert.equal(matches.length, 1);
        assert.equal(calls.length, 1);
        await interrupt(matches[0]);
        await expect.poll(() => matches.length).toBe(2);
        const recoveringStatus = await player.locator('[data-chess-status]').textContent();
        const confirmedBoardVisible = await player.getByRole('button', { name: 'e4, White pawn' }).isVisible();
        await expect.poll(() => matches.length, { timeout: 12000, message: 'Chess retries a socket that never confirms its board' }).toBe(3);
        assert.match(recoveringStatus, /Reconnecting to Chess/);
        assert.equal(confirmedBoardVisible, true);
        await expect(player.locator('[data-chess-status]')).toHaveText('You’re Black · Your turn');
        await expect(player.getByRole('button', { name: 'e4, White pawn' })).toBeAttached();
        await expect(player.locator('[data-connection]')).toHaveText('Connected');
        await expect(player.locator('[data-call-toggle]')).toHaveText('Call joined');
        await waitForPackets(player, 'audio', before);
        assert.equal(calls.length, 1);
        assert.equal(await player.evaluate(() => window.testPeers.length), 1);

        await interrupt(calls[0]);
        await expect(player.locator('[data-call-status]')).toHaveText('The call ended. Chat and games are still available.');
        await expect.poll(() => player.evaluate(() => window.testLocalTracks.map(track => track.readyState))).toEqual(['ended']);
        await expect(host.locator('[data-call-toggle]')).toHaveText('Call joined');
        await tapSquare(player, 'd7');
        await tapSquare(player, 'd5');
        await expect(host.getByRole('button', { name: 'd5, Black pawn' })).toBeAttached();
        assert.equal(matches.length, 3);
        await player.locator('[data-text]').fill('The board and chat stayed connected');
        await player.locator('[data-send]').tap();
        await expect(host.getByRole('log', { name: 'Conversation' })).toContainText('The board and chat stayed connected');

        await player.getByRole('button', { name: 'Join call', exact: true }).click();
        await expect(player.locator('[data-call-toggle]')).toHaveText('Call joined');
        await expect(player.getByRole('button', { name: 'Unmute mic' })).toBeVisible();
        await waitForPackets(player, 'audio');
        assert.equal(calls.length, 2);
        assert.deepEqual(await player.evaluate(() => window.testLocalTracks.map(track => track.readyState)), ['ended']);
        console.log('Passed Chromium separate match and call connection failures, same Chess seat, continued chat and explicit receive-only call rejoin.');

        await player.getByRole('button', { name: 'Unmute mic' }).click();
        await expect(player.getByRole('button', { name: 'Mute mic' })).toBeVisible();
        await host.getByRole('button', { name: 'Allow room cameras' }).click();
        await player.getByLabel('I am 18 or older').check();
        await player.evaluate(() => { window.testDenyDevice = true; });
        await player.getByRole('button', { name: 'Turn camera on' }).click();
        await expect(player.locator('[data-call-status]')).toContainText('Check browser permissions');
        await expect(player.locator('[data-call-toggle]')).toHaveText('Call joined');
        await host.getByRole('button', { name: 'Hide call controls' }).click();
        await moveByKeyboard(host, 'e4', 'ArrowUp', 1);
        await expect(player.getByRole('button', { name: 'e5, White pawn' })).toBeAttached();
        await player.getByRole('button', { name: 'Turn camera on' }).click();
        await waitForPackets(host, 'video');
        await host.locator('[data-call-toggle]').click();
        await host.getByRole('button', { name: 'Actions for LinkGuest' }).click();
        await host.locator('[data-sheet]').getByRole('button', { name: 'Kick', exact: true }).click();
        await expect(player.locator('[data-game-night]')).toBeHidden();
        await expect(player.locator('[data-connection]')).toHaveText('Connected');
        await expect.poll(() => player.evaluate(() => window.testLocalTracks.map(track => track.readyState)))
            .toEqual(['ended', 'ended', 'ended']);
        await expect(host.locator('[data-call-peers] li')).toHaveCount(0);
        await expect(host.getByRole('button', { name: 'Open Chess match' })).toBeVisible();
        await host.getByRole('button', { name: 'Leave call', exact: true }).click();
        console.log('Passed Chromium host room revocation retires the Chess seat and stops guest microphone and camera capture.');
    }
    async function moveByKeyboard(page, from, arrow, count) {
        await page.locator(`[data-square="${from}"]`).focus();
        await page.keyboard.press('Enter');
        for (let n = 0; n < count; n++) await page.keyboard.press(arrow);
        await page.keyboard.press('Enter');
    }
    async function tapSquare(page, square, touch = true) {
        const locator = page.locator(`[data-square="${square}"]`);
        await locator.scrollIntoViewIfNeeded();
        const box = await locator.boundingBox();
        assert.ok(box?.width > 22 && box?.height > 22);
        const x = box.x + box.width / 2, y = box.y + box.height / 2;
        if (touch) await page.touchscreen.tap(x, y);
        else await page.mouse.click(x, y);
    }
    async function fitLandscape(page, scrollTarget, ...controls) {
        const portrait = page.viewportSize();
        await page.setViewportSize({ width: 667, height: 375 });
        await scrollTarget.evaluate(element => element.scrollIntoView({ block: 'center' }));
        for (const control of controls) await expect(control).toBeInViewport({ ratio: 1 });
        await page.setViewportSize(portrait);
        await controls[0].scrollIntoViewIfNeeded();
    }
    async function fit(page, label) {
        try {
            await expect(page.locator('.arcade-chess-board')).toBeInViewport({ ratio: 1 });
            await expect(page.locator('[data-send]')).toBeInViewport();
            assert.ok(await page.locator('[data-clock-side]').evaluateAll(clocks =>
                clocks.every(clock => clock.scrollWidth <= clock.clientWidth)), 'seat labels and times fit inside both clocks');
        } catch (error) {
            if (evidence) {
                await mkdir(evidence, { recursive: true });
                await page.screenshot({ path: join(evidence, `fit-failure-${engine}-${label}.png`) });
            }
            console.error('Chess fit', label, await page.evaluate(() => Object.fromEntries(
                ['.titlebar', '.tabs', '.roombar', '.game-night', '.arcade-chess', '.arcade-chess-board', '.buffer', '.say', '.phonetabs']
                    .map(selector => {
                        const node = document.querySelector(selector), rect = node.getBoundingClientRect();
                        return [selector, { top: rect.top, bottom: rect.bottom, height: rect.height, scrollTop: node.scrollTop }];
                    }))));
            throw error;
        }
    }
    async function verifyCardLandscape(page, game, ...controls) {
        const original = page.viewportSize(), surface = page.locator('[data-game-night]');
        const scroll = await surface.evaluate(node => node.scrollTop);
        try {
            await page.setViewportSize({ width: 667, height: 375 });
            for (const control of controls) {
                await control.evaluate(node => node.scrollIntoView({ block: 'center' }));
                await expect(control).toBeInViewport({ ratio: 1 });
                const box = await control.boundingBox();
                assert.ok(box?.width >= 44 && box?.height >= 44, `${game} landscape control measures ${box?.width}×${box?.height}`);
            }
            await expect(page.locator('[data-send]')).toBeInViewport({ ratio: 1 });
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), game + ' landscape fits horizontally');
            if (evidence) await page.screenshot({ path: join(evidence, game + '-' + engine + '-landscape.png') });
            console.log('Passed ' + engine + ' ' + game + ' landscape touch targets and chat composer.');
        } finally {
            await page.setViewportSize(original);
            await surface.evaluate((node, offset) => { node.scrollTop = offset; }, scroll);
        }
    }
    async function playChessCheckmate(black, white) {
        const before = media ? await packetCount(white, 'audio') : 0;
        for (const [page, from, to] of [
            [white, 'e2', 'e4'], [black, 'e7', 'e5'], [white, 'd1', 'h5'], [black, 'b8', 'c6'],
            [white, 'f1', 'c4'], [black, 'g8', 'f6'], [white, 'h5', 'f7']
        ]) {
            await expect(page.locator('[data-chess-status]')).toContainText('Your turn');
            if (page === white) {
                await tapSquare(page, from);
                await tapSquare(page, to);
            } else {
                for (const square of [from, to]) await page.locator(`[data-square="${square}"]`).press('Enter');
            }
        }
        for (const page of [black, white]) {
            await expect(page.locator('[data-chess-status]')).toHaveText('White wins · Checkmate');
            await expect(page.getByRole('button', { name: 'f7, White queen' })).toBeAttached();
        }
        if (media) {
            await waitForPackets(white, 'audio', before);
            await expectOriginalPeer(white);
        }
        await black.getByRole('button', { name: 'Request rematch' }).click();
        await white.getByRole('button', { name: 'Accept rematch' }).click();
        await expect(black.locator('[data-chess-status]')).toHaveText('You’re White · Your turn');
        console.log(`Passed ${engine} Royal Flush Chess from first move to checkmate, matching results and rematch${media ? ' during the same call' : ''}.`);
    }
    async function joinCalls(a, b) {
        for (const page of [a, b]) {
            await page.getByRole('button', { name: 'Call', exact: true }).click();
            await page.getByRole('button', { name: 'Join call', exact: true }).click();
            await expect(page.locator('[data-call-toggle]')).toHaveText('Call joined');
            assert.deepEqual(await page.evaluate(() => window.testLocalTracks.map(track => track.kind)), []);
        }
        await expect(a.getByRole('button', { name: 'Actions for ChessGuest' })).toBeVisible();
        await expect(b.getByRole('button', { name: 'Actions for ChessHost' })).toBeVisible();
        await a.getByRole('button', { name: 'Unmute mic' }).click();
        await expect(a.getByRole('button', { name: 'Mute mic' })).toBeVisible();
        await b.getByRole('button', { name: 'Unmute mic' }).click();
        await expect(b.getByRole('button', { name: 'Mute mic' })).toBeVisible();
        for (const page of [a, b]) await waitForPackets(page, 'audio');
        if (relay) for (const page of [a, b]) {
            const [selected] = await selectedPairStats(page);
            assert.deepEqual(selected.candidates, ['relay', 'relay']);
        }
        if (relay) console.log('Verified both browsers selected TURN relay candidates and received audio over the relay.');
        await b.getByRole('button', { name: 'Mute mic' }).click();
        await expect(b.getByRole('button', { name: 'Unmute mic' })).toBeVisible();
        assert.deepEqual(await b.evaluate(() => window.testLocalTracks.map(track => track.readyState)), ['ended']);
        await expect(a.locator('[data-call-peers] audio')).toHaveJSProperty('muted', true);
        await b.evaluate(() => { window.testDenyDevice = true; });
        await b.getByRole('button', { name: 'Unmute mic' }).click();
        await expect(b.locator('[data-call-status]')).toContainText('Check browser permissions');
        await expect(b.locator('[data-call-toggle]')).toHaveText('Call joined');
        assert.deepEqual(await b.evaluate(() => window.testLocalTracks.map(track => track.readyState)), ['ended']);
        await b.getByRole('button', { name: 'Unmute mic' }).click();
        await expect(b.getByRole('button', { name: 'Mute mic' })).toBeVisible();
        await expect(a.locator('[data-call-peers] audio')).toHaveJSProperty('muted', false);
        await a.getByRole('button', { name: 'Allow room cameras' }).click();
        await expect(b.getByRole('button', { name: 'Turn camera on' })).toBeDisabled();
        await b.getByLabel('I am 18 or older').check();
        await b.getByRole('button', { name: 'Turn camera on' }).click();
        await expect(b.getByRole('button', { name: 'Turn camera off' })).toBeVisible();
        await waitForPackets(a, 'video');
        await expect.poll(() => a.locator('[data-call-peers] video').evaluate(video => video.videoWidth)).toBeGreaterThan(0);
        await a.getByRole('button', { name: 'Disable room cameras' }).click();
        await expect(b.getByRole('button', { name: 'Turn camera off' })).toBeHidden();
        assert.deepEqual(await b.evaluate(() => window.testLocalTracks.filter(track => track.kind === 'video').map(track => track.readyState)), ['ended']);
        await expect(a.locator('[data-call-peers] video')).toBeHidden();
        for (const page of [a, b]) await page.locator('[data-call-toggle]').click();
    }
    function selectedPairStats(page) {
        return page.evaluate(async () => {
            const active = window.testPeers.filter(peer => peer.connectionState !== 'closed');
            return Promise.all(active.map(async peer => {
                const stats = await peer.getStats();
                const transport = [...stats.values()].find(row => row.type === 'transport' && row.selectedCandidatePairId);
                const pair = stats.get(transport?.selectedCandidatePairId);
                return { candidates: [pair?.localCandidateId, pair?.remoteCandidateId].map(id => stats.get(id)?.candidateType),
                    bytesSent: pair?.bytesSent, bytesReceived: pair?.bytesReceived, rttMs: pair?.currentRoundTripTime * 1000 };
            }));
        });
    }
    function packetCounts(page, kind) {
        return page.evaluate(async expected => {
            const active = window.testPeers.filter(peer => peer.connectionState !== 'closed');
            return Promise.all(active.map(async peer => {
                const stats = await peer.getStats();
                return [...stats.values()].filter(stat => stat.type === 'inbound-rtp' && stat.kind === expected)
                    .reduce((total, stat) => total + stat.packetsReceived, 0);
            }));
        }, kind);
    }
    async function packetCount(page, kind) { return (await packetCounts(page, kind)).at(-1) ?? 0; }
    async function waitForPackets(page, kind, after = 5) {
        await expect.poll(() => packetCount(page, kind)).toBeGreaterThan(after);
    }
    async function expectOriginalPeer(page) {
        assert.deepEqual(await page.evaluate(() => window.testPeers.flatMap((peer, index) =>
            peer.connectionState === 'closed' ? [] : [index])), [0]);
    }
    async function compareHostsDuringCall(voicePeers, cameraPeers) {
        const packetSamples = [...voicePeers.map(page => [page, 'audio']), ...cameraPeers.map(page => [page, 'video'])];
        const before = await Promise.all(packetSamples.map(([page, kind]) => packetCounts(page, kind)));
        const initialPairs = (await Promise.all(voicePeers.map(selectedPairStats))).flat();
        const benchmark = fileURLToPath(new URL('./turdtris-host-compare.mjs', import.meta.url));
        const start = performance.now();
        const { stdout } = await runProcess(process.execPath, [benchmark], { timeout: 30000 });
        const seconds = (performance.now() - start) / 1000;
        const finalPairs = (await Promise.all(voicePeers.map(selectedPairStats))).flat();
        const after = await Promise.all(packetSamples.map(([page, kind]) => packetCounts(page, kind)));
        for (const [index, [, kind]] of packetSamples.entries()) {
            assert.equal(after[index].length, 3);
            const advanced = after[index].filter((count, peer) => count > before[index][peer]).length;
            assert.equal(advanced, kind === 'audio' ? 3 : 1, `${kind} carried packets during the host comparison`);
        }
        assert.equal(initialPairs.length, 12);
        assert.equal(finalPairs.length, initialPairs.length);
        const bytesReceived = finalPairs.reduce((total, pair, index) => total + pair.bytesReceived - initialPairs[index].bytesReceived, 0);
        assert.ok(bytesReceived > 0);
        const result = JSON.parse(stdout);
        console.log('Turdtris host comparison during a four-person loopback call:', JSON.stringify({
            ...result, call: { relayed: relay, seconds: Number(seconds.toFixed(2)), browserPairBytesReceived: bytesReceived }
        }));
    }
    async function submitCallReport(page, reason, capture = false) {
        const dialog = page.getByRole('dialog', { name: 'Report call participant' });
        const description = dialog.getByLabel('What happened?'), send = dialog.getByRole('button', { name: 'Send report' });
        await expect(dialog).toBeInViewport({ ratio: 1 });
        await expect(description).toBeFocused();
        await description.fill(reason);
        await expect(send).toBeDisabled();
        await dialog.getByLabel('Share these details with community staff').check();
        await expect(send).toBeEnabled();
        if (capture && evidence) await page.screenshot({ path: join(evidence, 'call-report-chromium-phone.png') });
        await send.tap();
        await expect(dialog).toBeHidden();
        await expect(page.locator('[data-call-status]')).toHaveText('Queued for review when a moderator is available.');
    }
    function watchCardMatch(page, game) {
        let current;
        page.on('websocket', socket => {
            if (!new URL(socket.url()).pathname.endsWith(`/arcade-${game}-match`)) return;
            socket.on('framereceived', ({ payload }) => {
                const frame = JSON.parse(payload.toString());
                if (frame.t === 'match-state') current = frame.state;
            });
        });
        return () => current;
    }
    async function holdMatchReconnect(page, game) {
        const connections = [];
        let heldState, released = false;
        await page.routeWebSocket(url => url.pathname === `/beta/arcade-${game}-match`, route => {
            const server = route.connectToServer();
            connections.push([route, server]);
            if (connections.length === 2) server.onMessage(message => {
                if (!released && typeof message === 'string' && JSON.parse(message).t === 'match-state') heldState = message;
                else route.send(message);
            });
        });
        return async () => {
            await Promise.all(connections[0].map(route => route.close({ code: 1011, reason: 'fixture connection interrupted' })));
            await expect.poll(() => typeof heldState).toBe('string');
            return () => { released = true; connections[1][0].send(heldState); };
        };
    }
    async function playEightsToTarget(players, views) {
        const suitLabels = { S: '♠ Spades', H: '♥ Hearts', D: '♦ Diamonds', C: '♣ Clubs' };
        const fastPoll = { intervals: [10, 25, 50, 100] };
        await expect.poll(() => views.map(read => read()?.match?.revision), fastPoll).toEqual([0, 0]);
        const first = views[0]();
        assert.equal(views[1]().match.id, first.match.id);
        const startingAudio = media ? await packetCount(players[1], 'audio') : 0;
        async function expectOutcomeAction(name) {
            for (const page of players) {
                const action = page.getByRole('button', { name });
                await expect(page.locator('[data-eights-status]')).toBeInViewport({ ratio: 1 });
                await expect(action).toBeInViewport({ ratio: 1 });
                assert.ok((await action.boundingBox())?.height >= 44, 'phone-sized Eights outcome action');
            }
        }
        let commands = 0, table = first.match;
        while (!table.result && commands < 1500) {
            const index = views.findIndex(read => read().seat === table.turn);
            assert.ok(index >= 0, 'the active seat has a connected client');
            const page = players[index], match = views[index]().match;
            if (match.roundResult) {
                await expectOutcomeAction('Next round');
                await page.getByRole('button', { name: 'Next round' }).click();
            } else {
                const card = match.hand.find(card => card.playable && card.rank !== '8') || match.hand.find(card => card.playable);
                if (!card) {
                    await page.locator(`[data-eights-action="${match.canPass ? 'pass' : 'draw'}"]`).click();
                } else {
                    if (match.hand.length === 1) await players[1 - index].locator('[data-eights-table]').evaluate(table => {
                        const surface = table.closest('.game-night');
                        surface.scrollTop = surface.scrollHeight;
                    });
                    await page.locator(`[data-eights-card="${card.id}"]`).click();
                    if (card.rank === '8') {
                        const remaining = match.hand.filter(card => card.rank !== '8');
                        const count = suit => remaining.filter(card => card.suit === suit).length;
                        const suit = Object.keys(suitLabels).sort((a, b) => count(b) - count(a))[0];
                        await page.locator('[data-eights-suits]').getByRole('button', { name: suitLabels[suit], exact: true }).click();
                    }
                }
            }
            const nextRevision = table.revision + 1;
            await expect.poll(() => views.map(read => read()?.match?.revision), fastPoll).toEqual([nextRevision, nextRevision]);
            table = views[0]().match;
            commands++;
        }
        assert.equal(table.result?.reason, 'score', 'complete a match by earning points');
        assert.equal(table.target, 200);
        assert.ok(table.score[table.result.winner] >= table.target);
        assert.deepEqual(views[1]().match.score, table.score);
        assert.deepEqual(views[1]().match.result, table.result);
        const winner = views.findIndex(read => read().seat === table.result.winner);
        await expect(players[winner].locator('[data-eights-status]')).toHaveText('You won the match.');
        await expect(players[1 - winner].locator('[data-eights-status]')).toHaveText(/^Seat [12] won the match\.$/);
        for (const page of players) for (const seat of ['a', 'b']) {
            await expect(page.locator(`[data-eights-score="${seat}"]`)).toContainText(`· ${table.score[seat]}/200 pts ·`);
        }
        if (evidence) await players[1].screenshot({ path: join(evidence, `eights-${engine}-score-finish.png`) });
        await expectOutcomeAction('Request Eights rematch');
        await players[winner].getByRole('button', { name: 'Request Eights rematch' }).click();
        await players[1 - winner].getByRole('button', { name: 'Accept Eights rematch' }).click();
        for (const page of players) {
            await expect(page.locator('[data-eights-card]')).toHaveCount(7);
            for (const seat of ['a', 'b']) await expect(page.locator(`[data-eights-score="${seat}"]`)).toContainText('· 0/200 pts ·');
        }
        assert.notEqual(views[0]().match.id, table.id);
        if (media) {
            await waitForPackets(players[1], 'audio', startingAudio);
            await expectOriginalPeer(players[1]);
        }
        console.log(`Passed ${engine} Crappy Eights scored match and fresh rematch after ${table.round} rounds and ${commands} commands, final score ${table.score.a}–${table.score.b}.`);
    }
    async function playEights(a, b) {
        const before = media ? await packetCount(b, 'audio') : 0;
        const views = process.env.ARCADE_EIGHTS_FULL_MATCH === '1' ? [a, b].map(page => watchCardMatch(page, 'crapeights')) : null;
        const pauseReconnect = media && !relay ? await holdMatchReconnect(b, 'crapeights') : null;
        for (const page of [a, b]) await page.getByRole('combobox', { name: 'Switch game' }).selectOption('crapeights');
        await a.getByRole('button', { name: 'Open Eights table' }).click();
        await b.getByRole('button', { name: 'Join Eights table' }).click();
        const aCards = a.locator('[data-eights-card]'), bCards = b.locator('[data-eights-card]');
        await expect(aCards).toHaveCount(7);
        await expect(bCards).toHaveCount(7);
        try {
            await expect(b.locator('[data-eights-hand]')).toBeInViewport({ ratio: 1 });
            await expect(b.locator('[data-send]')).toBeInViewport({ ratio: 1 });
        } catch (error) {
            if (evidence) {
                await mkdir(evidence, { recursive: true });
                await b.screenshot({ path: join(evidence, `eights-${engine}-fit-failure.png`) });
            }
            throw error;
        }
        const aHand = await aCards.evaluateAll(buttons => buttons.map(button => button.dataset.eightsCard));
        const bHand = await bCards.evaluateAll(buttons => buttons.map(button => button.dataset.eightsCard));
        assert.ok(aHand.every(id => !bHand.includes(id)));
        if (pauseReconnect) {
            const returnHand = await pauseReconnect();
            await expect(b.locator('[data-eights-status]')).toHaveText('Reconnecting to the table… Your hand is paused.');
            await expect(b.locator('[data-eights-card]:enabled')).toHaveCount(0);
            assert.deepEqual(await bCards.evaluateAll(buttons => buttons.map(button => button.dataset.eightsCard)), bHand);
            returnHand();
            await expect(b.locator('[data-eights-status]')).not.toContainText('Reconnecting');
            assert.deepEqual(await bCards.evaluateAll(buttons => buttons.map(button => button.dataset.eightsCard)), bHand);
        }
        await verifyCardLandscape(b, 'Crappy Eights', bCards.first(), b.locator('[data-eights-action="draw"]'));
        const playable = a.locator('[data-eights-card]:enabled').first();
        if (await playable.count()) {
            const wild = (await playable.getAttribute('aria-label')).includes('Wild');
            await playable.press('Enter');
            if (wild) await a.locator('[data-eights-suits]').getByRole('button', { name: '♥ Hearts', exact: true }).click();
            await expect(aCards).toHaveCount(6);
        } else {
            await a.getByRole('button', { name: /Draw ·/ }).click();
            await expect(aCards).toHaveCount(8);
        }
        await expect(b.locator('[data-eights-score="a"]')).toContainText(`${await aCards.count()} cards`);
        if (media) {
            await waitForPackets(b, 'audio', before);
            await expectOriginalPeer(b);
        } else {
            const hand = await bCards.evaluateAll(buttons => buttons.map(button => button.dataset.eightsCard));
            await b.reload();
            await b.locator('[data-enter]').click();
            await expect(b.locator('[data-eights-table]')).toBeVisible();
            assert.deepEqual(await bCards.evaluateAll(buttons => buttons.map(button => button.dataset.eightsCard)), hand);
            await expect(b.getByRole('link', { name: 'Back to Rad Dad' })).toHaveCount(0);
        }
        await b.getByRole('button', { name: 'Resign', exact: true }).click();
        await b.getByRole('dialog', { name: 'Resign this match?' }).getByRole('button', { name: 'Resign', exact: true }).click();
        await expect(a.locator('[data-eights-status]')).toContainText('You won the match by resignation');
        await a.getByRole('button', { name: 'Request Eights rematch' }).click();
        await b.getByRole('button', { name: 'Accept Eights rematch' }).click();
        await expect(b.locator('[data-eights-status]')).toContainText('Round 1 · Your turn');
        await expect(bCards).toHaveCount(7);
        if (views) await playEightsToTarget([a, b], views);
        if (evidence) {
            await mkdir(evidence, { recursive: true });
            await a.screenshot({ path: join(evidence, `eights-${engine}-desktop.png`) });
            await b.screenshot({ path: join(evidence, `eights-${engine}-phone.png`) });
        }
        console.log(`Passed ${engine} Crappy Eights private hands, a played turn, ${media ? 'same call during a game switch' : 'full reload and seat recovery'}, and rematch.`);
    }
    async function playRummyToTarget(players, views) {
        const { analyzeHand, cardDeadwoodValue } = globalThis.TurdRummyRules;
        const fastPoll = { intervals: [10, 25, 50, 100] };
        const startingAudio = media ? await packetCount(players[1], 'audio') : 0;
        await expect.poll(() => views.map(read => read()?.match?.revision), fastPoll).toEqual([0, 0]);
        let match = views[0]().match, commands = 0;
        const id = match.id, totals = { a: 0, b: 0 };
        assert.equal(views[1]().match.id, id);
        function bestDiscard(hand, blocked) {
            return hand.filter(card => card.id !== blocked).map(card => ({ card,
                deadwood: analyzeHand(hand.filter(other => other.id !== card.id)).deadwoodScore }))
                .sort((a, b) => a.deadwood - b.deadwood || cardDeadwoodValue(b.card) - cardDeadwoodValue(a.card))[0];
        }
        async function expectOutcome(action) {
            for (const [index, page] of players.entries()) {
                try {
                    const button = page.getByRole('button', { name: action });
                    await expect(page.locator('[data-rummy-status]')).toBeInViewport({ ratio: 1 });
                    await expect(button).toBeInViewport({ ratio: 1 });
                    assert.ok((await button.boundingBox())?.height >= 44, 'phone-sized Rummy outcome action');
                } catch (error) {
                    if (evidence) await page.screenshot({ path: join(evidence, `rummy-${engine}-${index}-outcome-failure.png`) });
                    throw error;
                }
            }
        }
        while (!match.result && commands < 1500) {
            const index = views.findIndex(read => read().seat === match.turn);
            assert.ok(index >= 0, 'the active Rummy seat has a connected client');
            const page = players[index], own = views[index]().match;
            if (own.roundResult) {
                await expectOutcome('Next round');
                await page.getByRole('button', { name: 'Next round' }).click();
            } else if (own.phase === 'draw') {
                const deadwood = analyzeHand(own.hand).deadwoodScore;
                const takeDiscard = own.canTakeDiscard && (!own.canDrawStock ||
                    bestDiscard([...own.hand, { ...own.top, id: -1 }], -1).deadwood < deadwood);
                await page.locator(`[data-rummy-action="${takeDiscard ? 'draw-discard' : 'draw-stock'}"]`).click();
            } else {
                const { card, deadwood } = bestDiscard(own.hand, own.blocked);
                const action = deadwood === 0 ? 'gin' : deadwood <= own.knockLimit ? 'knock' : 'discard';
                if (action !== 'discard') await players[1 - index].locator('[data-rummy-table]').evaluate(table => {
                    const surface = table.closest('.game-night');
                    surface.scrollTop = surface.scrollHeight;
                });
                await page.locator(`[data-rummy-card="${card.id}"]`).click();
                await page.locator(`[data-rummy-action="${action}"]`).click();
            }
            const revision = match.revision + 1;
            await expect.poll(() => views.map(read => read()?.match?.revision), fastPoll).toEqual([revision, revision]);
            match = views[0]().match;
            if (match.roundResult) totals[match.roundResult.winner] += match.roundResult.points;
            for (const read of views) assert.deepEqual(read().match.score, totals);
            commands++;
        }
        assert.equal(match.result?.reason, 'score', 'complete a Rummy match by earning points');
        assert.equal(match.target, 100);
        assert.ok(totals[match.result.winner] >= match.target);
        assert.deepEqual(views[1]().match.result, match.result);
        const winner = views.findIndex(read => read().seat === match.result.winner);
        await expect(players[winner].locator('[data-rummy-status]')).toHaveText('You won the match.');
        await expect(players[1 - winner].locator('[data-rummy-status]')).toHaveText(/^Seat [12] won the match\.$/);
        await expectOutcome('Request Rummy rematch');
        if (evidence) await players[1].screenshot({ path: join(evidence, `rummy-${engine}-score-finish.png`) });
        await players[winner].getByRole('button', { name: 'Request Rummy rematch' }).click();
        await players[1 - winner].getByRole('button', { name: 'Accept Rummy rematch' }).click();
        for (const page of players) {
            await expect(page.locator('[data-rummy-card]')).toHaveCount(10);
            for (const seat of ['a', 'b']) await expect(page.locator(`[data-rummy-score="${seat}"]`)).toContainText('· 0/100 pts ·');
        }
        assert.notEqual(views[0]().match.id, id);
        if (media) {
            await waitForPackets(players[1], 'audio', startingAudio);
            await expectOriginalPeer(players[1]);
        }
        console.log(`Passed ${engine} TurdRummy scored match and fresh rematch after ${match.round} rounds and ${commands} commands, final score ${totals.a}–${totals.b}.`);
    }
    async function playRummy(a, b) {
        const before = media ? await packetCount(b, 'audio') : 0;
        const views = process.env.ARCADE_RUMMY_FULL_MATCH === '1' ? [a, b].map(page => watchCardMatch(page, 'turdrummy')) : null;
        const pauseReconnect = media && !relay ? await holdMatchReconnect(b, 'turdrummy') : null;
        for (const page of [a, b]) {
            await expect(page.locator('[data-arcade-game] option[value="turdrummy"]')).toBeEnabled();
            await page.getByRole('combobox', { name: 'Switch game' }).selectOption('turdrummy');
        }
        await a.getByRole('button', { name: 'Open Rummy table' }).click();
        await b.getByRole('button', { name: 'Join Rummy table' }).click();
        const aCards = a.locator('[data-rummy-card]'), bCards = b.locator('[data-rummy-card]');
        const ids = cards => cards.evaluateAll(buttons => buttons.map(button => button.dataset.rummyCard));
        await expect(aCards).toHaveCount(10);
        await expect(bCards).toHaveCount(10);
        const aHand = await ids(aCards), bHand = await ids(bCards);
        assert.ok(aHand.every(id => !bHand.includes(id)));
        await expect(b.locator('[data-rummy-status]')).toContainText('Draw a card');
        await expect(b.locator('[data-rummy-hand]')).toBeInViewport({ ratio: 1 });
        await expect(b.locator('[data-send]')).toBeInViewport({ ratio: 1 });
        await b.locator('[data-rummy-action="draw-discard"]').click();
        await expect(bCards).toHaveCount(11);
        const drawn = b.locator('[data-rummy-card][data-drawn="true"]');
        await expect(drawn).toBeDisabled();
        await expect(drawn).toHaveAttribute('aria-label', /taken from discard/);
        if (!media) {
            const hand = await ids(bCards);
            await b.reload();
            await b.locator('[data-enter]').click();
            await expect(b.locator('[data-rummy-table]')).toBeVisible();
            assert.deepEqual(await ids(bCards), hand);
            await expect(drawn).toBeDisabled();
            await expect(b.getByRole('link', { name: 'Back to Rad Dad' })).toHaveCount(0);
        }
        const card = b.locator('[data-rummy-card]:enabled').first();
        const discarded = await card.getAttribute('aria-label');
        await card.scrollIntoViewIfNeeded();
        const box = await card.boundingBox();
        assert.ok(box?.width >= 44 && box?.height >= 44, 'phone-sized card button');
        await b.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
        await expect(card).toHaveAttribute('aria-pressed', 'true');
        await expect(b.locator('[data-rummy-hand-label]')).toContainText('deadwood after discard');
        if (pauseReconnect) {
            const hand = await ids(bCards);
            const returnHand = await pauseReconnect();
            await expect(b.locator('[data-rummy-status]')).toHaveText('Reconnecting to the table… Your hand is paused.');
            await expect(b.locator('[data-rummy-card]:enabled')).toHaveCount(0);
            await expect(b.getByRole('button', { name: 'Discard', exact: true })).toBeDisabled();
            assert.deepEqual(await ids(bCards), hand);
            returnHand();
            await expect(card).toHaveAttribute('aria-pressed', 'true');
            await expect(drawn).toBeDisabled();
        }
        await verifyCardLandscape(b, 'TurdRummy', card, b.getByRole('button', { name: 'Discard', exact: true }));
        await b.getByRole('button', { name: 'Discard', exact: true }).click();
        await expect(bCards).toHaveCount(10);
        await expect(a.getByRole('button', { name: `Take ${discarded}`, exact: true })).toBeEnabled();
        if (media) {
            await waitForPackets(b, 'audio', before);
            await expectOriginalPeer(b);
        }
        await b.locator('[data-rummy-action="resign"]').click();
        await b.getByRole('dialog', { name: 'Resign this match?' }).getByRole('button', { name: 'Resign', exact: true }).click();
        await expect(a.locator('[data-rummy-status]')).toContainText('You won the match by resignation');
        await a.getByRole('button', { name: 'Request Rummy rematch' }).click();
        await b.getByRole('button', { name: 'Accept Rummy rematch' }).click();
        await expect(a.locator('[data-rummy-status]')).toContainText('Round 1 · Draw a card');
        await expect(bCards).toHaveCount(10);
        if (views) await playRummyToTarget([a, b], views);
        if (evidence) {
            await mkdir(evidence, { recursive: true });
            await a.screenshot({ path: join(evidence, `rummy-${engine}-desktop.png`) });
            await b.screenshot({ path: join(evidence, `rummy-${engine}-phone.png`) });
        }
        console.log(`Passed ${engine} TurdRummy private hands, discard pickup, touch selection, ${media ? 'same call during a game switch' : 'full reload mid-draw'}, and rematch.`);
    }
    async function finishSpadesRound(players, commands) {
        const status = page => page.locator('[data-spades-status]');
        const cards = page => page.locator('[data-spades-card]');
        const scores = page => page.locator('[data-spades-score]');
        const remaining = players.map(() => 12);
        for (let play = 4; play < 52; play++) {
            let turn;
            await expect.poll(async () => {
                const messages = await Promise.all(players.map(page => status(page).textContent()));
                turn = messages.flatMap((message, index) => message.startsWith('Round 1 · Your play') ? [index] : []);
                return turn.length;
            }).toBe(1);
            const index = turn[0], page = players[index];
            await page.locator('[data-spades-card]:enabled').first().click();
            try {
                await expect(cards(page)).toHaveCount(--remaining[index]);
            } catch (error) {
                console.error('Spades play was not confirmed:', { play, index,
                    status: await status(page).textContent(), error: await page.locator('[data-spades-error]').textContent(),
                    command: commands[index] });
                throw error;
            }
        }
        assert.deepEqual(remaining, [0, 0, 0, 0]);
        const host = players[0];
        await expect(status(host)).toHaveText(/^South \+ North [+-]?\d+.* \/ West \+ East [+-]?\d+/);
        const summary = await status(host).textContent();
        const scored = await scores(host).allTextContents();
        const deltas = summary.split(' / ').map(team => Number(team.match(/ ([+-]?\d+)(?: ·|$)/)[1]));
        for (const [index, score] of scored.entries()) {
            assert.equal(Number(score.match(/ · (-?\d+)\/250 · /)[1]), deltas[index]);
        }
        for (const page of players) {
            await expect(page.locator('[data-spades-table]')).toHaveAttribute('data-phase', 'round-end');
            await expect(status(page)).toHaveText(summary);
            await expect(scores(page)).toHaveText(scored);
        }
        await host.getByRole('button', { name: 'Next round' }).click();
        await expect(status(players[2])).toHaveText('Round 2 · Your bid');
        for (const page of players) {
            await expect(cards(page)).toHaveCount(13);
            await expect(scores(page)).toHaveText(scored);
        }
        console.log(`Passed ${engine} TurdSpades 13 tricks, matching partnership scores and dealer rotation.`);
    }
    async function playSpades(a, b) {
        const north = await guest('stalemate', 'SpadesNorth', { width: 1280, height: 900 });
        const east = await guest('rad-dad', 'SpadesEast', { width: 390, height: 844 }, true);
        const pauseReconnect = media && !relay ? await holdMatchReconnect(b, 'turdspades') : null;
        await inviteToGame(a, north, 'SpadesNorth');
        await inviteToGame(a, east, 'SpadesEast');
        const players = [a, b, north, east];
        const commands = players.map(page => {
            const last = {};
            page.on('websocket', socket => {
                if (!new URL(socket.url()).pathname.endsWith('/arcade-turdspades-match')) return;
                socket.on('framesent', ({ payload }) => { last.sent = JSON.parse(payload.toString()); });
                socket.on('framereceived', ({ payload }) => {
                    const frame = JSON.parse(payload.toString());
                    if (frame.t === 'match-error') last.reason = frame.reason;
                    if (frame.t === 'match-state') last.revision = frame.state?.match?.revision;
                });
            });
            return last;
        });
        for (const page of players) {
            await expect(page.locator('[data-arcade-game] option[value="turdspades"]')).toBeEnabled();
            await page.getByRole('combobox', { name: 'Switch game' }).selectOption('turdspades');
        }
        await a.getByRole('button', { name: 'Open 4-player Spades' }).click();
        for (const [index, [page, seat]] of [[b, 'West'], [north, 'North'], [east, 'East']].entries()) {
            await page.getByRole('button', { name: 'Join ' + seat }).click();
            if (index < 2) await expect(a.locator('[data-spades-status]')).toContainText(`${index + 2}/4 seated`);
        }
        const allHands = [];
        for (const page of players) {
            const hand = page.locator('[data-spades-card]');
            await expect(hand).toHaveCount(13);
            allHands.push(...await hand.evaluateAll(buttons => buttons.map(button => button.dataset.spadesCard)));
        }
        assert.equal(new Set(allHands).size, 52);
        const portrait = b.viewportSize();
        try {
            for (const height of [portrait.height, 661]) {
                await b.setViewportSize({ ...portrait, height });
                await expect(b.locator('[data-spades-hand]')).toBeInViewport({ ratio: 1 });
                await expect(b.locator('[data-send]')).toBeInViewport({ ratio: 1 });
            }
        } catch (error) {
            if (evidence) {
                await mkdir(evidence, { recursive: true });
                await b.screenshot({ path: join(evidence, `spades-${engine}-fit-failure.png`) });
            }
            throw error;
        } finally {
            await b.setViewportSize(portrait);
        }
        let audioBeforeTrick;
        if (media) {
            await joinSpadesCall(players);
            audioBeforeTrick = await Promise.all(players.map(page => packetCounts(page, 'audio')));
        }
        await b.getByLabel('Your bid').selectOption('0');
        await verifyCardLandscape(b, 'TurdSpades bid', b.getByLabel('Your bid'), b.getByRole('button', { name: 'Bid for me' }));
        if (pauseReconnect) {
            const cards = b.locator('[data-spades-card]');
            const hand = await cards.evaluateAll(buttons => buttons.map(button => button.dataset.spadesCard));
            const returnHand = await pauseReconnect();
            await expect(b.locator('[data-spades-status]')).toHaveText('Reconnecting to the table… Your hand is paused.');
            await expect(b.getByLabel('Your bid')).toBeDisabled();
            await expect(b.getByRole('button', { name: 'Bid for me' })).toBeDisabled();
            assert.deepEqual(await cards.evaluateAll(buttons => buttons.map(button => button.dataset.spadesCard)), hand);
            returnHand();
            await expect(b.getByLabel('Your bid')).toBeEnabled();
            await expect(b.getByLabel('Your bid')).toHaveValue('0');
        }
        for (const page of [b, north, east, a]) await page.getByRole('button', { name: 'Bid for me' }).click();
        await expect(a.locator('[data-spades-trick]')).toContainText('West · Nil');
        const lead = b.locator('[data-spades-card]:enabled').first();
        await verifyCardLandscape(b, 'TurdSpades', lead, b.locator('[data-spades-action="resign"]'));
        await lead.scrollIntoViewIfNeeded();
        const box = await lead.boundingBox();
        assert.ok(box?.width >= 44 && box?.height >= 44, 'phone-sized Spades card button');
        await b.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
        await expect(b.locator('[data-spades-card]')).toHaveCount(12);
        if (!media) {
            const ids = page => page.locator('[data-spades-card]').evaluateAll(buttons => buttons.map(button => button.dataset.spadesCard));
            const hand = await ids(b);
            const events = [];
            function observeReload(socket) {
                for (const type of ['framesent', 'framereceived']) socket.on(type, ({ payload }) => {
                    if (events.length >= 80) return;
                    try {
                        const { t, name, action, reason, state } = JSON.parse(payload.toString());
                        events.push({ type, t, name, action, reason, seat: state?.seat, cards: state?.match?.hand?.length });
                    } catch { /* Record only structured lobby and match frames. */ }
                });
                socket.on('close', () => events.push({ type: 'close' }));
            }
            b.on('websocket', observeReload);
            try {
                await b.reload();
                await b.locator('[data-enter]').click();
                await expect(b.locator('[data-connection]')).toHaveText('Connected');
                await expect(b.locator('[data-spades-card]')).toHaveCount(12);
            } catch (error) {
                if (evidence) await b.screenshot({ path: join(evidence, `spades-${engine}-reload-failure.png`) });
                console.error('Spades reload events:', JSON.stringify(events));
                throw error;
            } finally { b.off('websocket', observeReload); }
            assert.deepEqual(await ids(b), hand);
            await expect(b.getByRole('link', { name: 'Back to Rad Dad' })).toHaveCount(0);
        }
        for (const page of [north, east, a]) {
            await page.locator('[data-spades-card]:enabled').first().click();
            await expect(page.locator('[data-spades-card]')).toHaveCount(12);
        }
        await expect(a.locator('[data-spades-status]')).toContainText('won the last trick');
        await finishSpadesRound(players, commands);
        await b.locator('[data-spades-action="resign"]').click();
        await b.getByRole('dialog', { name: 'Resign for your team?' }).getByRole('button', { name: 'Resign', exact: true }).click();
        await expect(a.locator('[data-spades-status]')).toContainText('South + North win by resignation');
        await a.getByRole('button', { name: 'Request Spades rematch' }).click();
        const votes = east.locator('[data-spades-status]');
        await expect(votes).toContainText('1/4 ready');
        await b.getByRole('button', { name: 'Accept Spades rematch' }).click();
        await expect(votes).toContainText('2/4 ready');
        await north.getByRole('button', { name: 'Accept Spades rematch' }).click();
        await expect(votes).toContainText('3/4 ready');
        await east.getByRole('button', { name: 'Accept Spades rematch' }).click();
        await expect(b.locator('[data-spades-status]')).toContainText('Round 1 · Your bid');
        await expect(b.locator('[data-spades-card]')).toHaveCount(13);
        if (media) {
            for (const [index, page] of players.entries()) {
                await expect.poll(async () => (await packetCounts(page, 'audio'))
                    .map((count, peer) => count > audioBeforeTrick[index][peer])).toEqual([true, true, true]);
            }
            if (relay) {
                const stats = (await Promise.all(players.map(selectedPairStats))).flat();
                assert.equal(stats.length, 12);
                for (const sample of stats) {
                    assert.deepEqual(sample.candidates, ['relay', 'relay']);
                    assert.ok(sample.bytesSent > 0 && sample.bytesReceived > 0);
                }
                console.log('Selected loopback TURN pairs during four-player Spades:', JSON.stringify(stats));
            }
            for (const page of [east, north]) {
                await page.locator('[data-call-toggle]').click();
                await page.getByRole('button', { name: 'Leave call', exact: true }).click();
                assert.ok(await page.evaluate(() => window.testLocalTracks.every(track => track.readyState === 'ended')));
            }
            for (const page of [a, b]) {
                await expect(page.locator('[data-call-peers] li')).toHaveCount(1);
                await expectOriginalPeer(page);
            }
            console.log('Passed Chromium four-player Spades round and rematch during a shared call, all 12 audio paths, camera delivery to three peers and cleanup on leave.');
        }
        if (evidence) {
            await mkdir(evidence, { recursive: true });
            await a.screenshot({ path: join(evidence, `spades-${engine}-desktop.png`) });
            await b.screenshot({ path: join(evidence, `spades-${engine}-phone.png`) });
        }
        console.log(`Passed ${engine} TurdSpades four independent guests, bidding, a scored round, ${media ? 'same call during a game switch' : 'full reload mid-trick'}, and unanimous rematch.`);
        return north;
    }
    async function joinSpadesCall([host, west, north, east]) {
        for (const page of [north, east]) {
            await page.getByRole('button', { name: 'Call', exact: true }).click();
            await page.getByRole('button', { name: 'Join call', exact: true }).click();
            await expect(page.locator('[data-call-toggle]')).toHaveText('Call joined');
            assert.deepEqual(await page.evaluate(() => window.testLocalTracks.map(track => track.kind)), []);
            await page.getByRole('button', { name: 'Unmute mic' }).click();
            await expect(page.getByRole('button', { name: 'Mute mic' })).toBeVisible();
        }
        for (const page of [host, west, north, east]) {
            await expect(page.locator('[data-call-peers] li')).toHaveCount(3);
            await expect.poll(async () => (await packetCounts(page, 'audio')).map(count => count > 5)).toEqual([true, true, true]);
        }
        await host.locator('[data-call-toggle]').click();
        await host.getByRole('button', { name: 'Allow room cameras' }).click();
        await east.getByLabel('I am 18 or older').check();
        await east.getByRole('button', { name: 'Turn camera on' }).click();
        for (const page of [host, west, north]) {
            await expect.poll(async () => (await packetCounts(page, 'video')).filter(count => count > 5).length).toBe(1);
        }
        if (process.env.ARCADE_COMPARE_HOSTS === '1') await compareHostsDuringCall([host, west, north, east], [host, west, north]);
        await expect(west.locator('[data-spades-hand]')).toBeInViewport({ ratio: 1 });
        await west.locator('[data-call-toggle]').tap();
        await expect(west.getByRole('button', { name: 'Mute mic' })).toBeVisible();
        const hide = west.getByRole('button', { name: 'Hide call controls' });
        await expect(hide).toBeInViewport({ ratio: 1 });
        assert.ok((await hide.boundingBox()).height >= 44);
        if (evidence) await west.screenshot({ path: join(evidence, 'spades-phone-call-controls-fixed.png') });
        await hide.tap();
        await expect(west.locator('[data-spades-hand]')).toBeInViewport({ ratio: 1 });
        await expect(west.locator('[data-call-toggle]')).toHaveText('Call joined');
        await expect(west.locator('[data-call-toggle]')).toBeFocused();
        await west.locator('[data-call-toggle]').press('Enter');
        await expect(hide).toBeFocused();
        await hide.press('Escape');
        await expect(west.locator('[data-spades-hand]')).toBeInViewport({ ratio: 1 });
        await expect(west.locator('[data-send]')).toBeInViewport();
        if (evidence) await west.screenshot({ path: join(evidence, 'spades-phone-call-dismissed.png') });
        for (const page of [host, north, east]) await page.locator('[data-call-toggle]').click();
    }
    async function playJack(a, b, spectator) {
        const before = media ? await packetCount(b, 'audio') : 0;
        const pauseReconnect = media && !relay ? await holdMatchReconnect(b, 'turdjack') : null;
        for (const page of [a, b, spectator]) {
            await page.getByRole('combobox', { name: 'Switch game' }).selectOption('turdjack');
        }
        const table = a.locator('[data-jack-table]');
        const privateCards = page => page.locator('[data-jack-hands] .jack-face');
        await a.getByRole('button', { name: 'Open Crapjack table' }).click();
        await b.getByRole('button', { name: 'Join Seat 2' }).click();
        await a.getByRole('button', { name: 'Start table' }).click();
        await expect(b.locator('[data-jack-bank]')).toHaveText('1000 play chips');
        await b.getByLabel('Play chips').selectOption('20');
        await a.getByRole('button', { name: 'Ready', exact: true }).click();
        await expect(b.locator('[data-jack-status]')).toContainText('1/2 ready');
        await expect(b.getByLabel('Play chips')).toHaveValue('20');
        const ready = b.getByRole('button', { name: 'Ready', exact: true });
        await verifyCardLandscape(b, 'Crapjack 21', b.getByLabel('Play chips'), ready);
        await ready.scrollIntoViewIfNeeded();
        const box = await ready.boundingBox();
        assert.ok(box?.width >= 44 && box?.height >= 44, 'phone-sized Crapjack Ready button');
        await b.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
        await expect(table).toHaveAttribute('data-phase', /^(play|insurance|settled)$/);
        for (const page of [a, b]) await expect(privateCards(page)).toHaveCount(2);
        await expect(spectator.locator('[data-jack-bank]')).toHaveText('Watching · hands are private');
        await expect(privateCards(spectator)).toHaveCount(0);
        if (await table.getAttribute('data-phase') !== 'settled') {
            await expect(spectator.locator('[data-jack-dealer] [aria-label="Hidden dealer card"]')).toBeVisible();
        }
        if (pauseReconnect) {
            const hand = await privateCards(b).allTextContents();
            const returnHand = await pauseReconnect();
            await expect(b.locator('[data-jack-status]')).toHaveText('Reconnecting to the table… Your hand is paused.');
            await expect(b.locator('[data-jack-table] button:visible:enabled')).toHaveCount(0);
            assert.deepEqual(await privateCards(b).allTextContents(), hand);
            returnHand();
            await expect(b.locator('[data-jack-status]')).not.toContainText('Reconnecting');
            assert.deepEqual(await privateCards(b).allTextContents(), hand);
        }
        if (!media) {
            const hand = await privateCards(b).allTextContents();
            await b.reload();
            await b.locator('[data-enter]').click();
            await expect(privateCards(b)).toHaveCount(2);
            assert.deepEqual(await privateCards(b).allTextContents(), hand);
            await expect(b.getByRole('link', { name: 'Back to Rad Dad' })).toHaveCount(0);
        }
        if (evidence) {
            await mkdir(evidence, { recursive: true });
            await a.screenshot({ path: join(evidence, `jack-${engine}-desktop.png`) });
            await b.screenshot({ path: join(evidence, `jack-${engine}-phone.png`) });
        }
        await expect(b.locator('[data-jack-hands]')).toBeInViewport({ ratio: 1 });
        await expect(b.locator('[data-send]')).toBeInViewport({ ratio: 1 });
        if (await table.getAttribute('data-phase') === 'insurance') {
            await a.getByRole('button', { name: 'Decline insurance' }).click();
            await expect(b.locator('[data-jack-players] li').first()).toContainText('Ready');
            await b.getByRole('button', { name: 'Decline insurance' }).click();
            await expect(table).toHaveAttribute('data-phase', /^(play|settled)$/);
        }
        const active = a.locator('[data-jack-players] [data-active="true"]');
        for (let index = 0; index < 2 && await table.getAttribute('data-phase') === 'play'; index++) {
            const label = await active.textContent();
            const page = label.startsWith('You') ? a : b;
            await page.getByRole('button', { name: 'Stand', exact: true }).click();
            await expect.poll(async () => (await active.allTextContents())[0]).not.toBe(label);
        }
        await expect(table).toHaveAttribute('data-phase', 'settled');
        await expect(spectator.locator('[data-jack-dealer] .jack-face').nth(1)).toBeVisible();
        await expect(spectator.locator('[data-jack-players] li').nth(1)).toContainText(/20 chips · (Win|Loss|Blackjack|Push)/);
        if (media) {
            await waitForPackets(b, 'audio', before);
            await expectOriginalPeer(b);
        }
        await a.getByRole('button', { name: 'Next round' }).click();
        await expect(b.locator('[data-jack-status]')).toContainText('Round 2');
        await a.getByRole('button', { name: 'End session' }).click();
        await a.getByRole('dialog', { name: 'End this session?' }).getByRole('button', { name: 'End session' }).click();
        await a.getByRole('button', { name: 'Request fresh session' }).click();
        await b.getByRole('button', { name: 'Accept fresh session' }).click();
        await expect(b.locator('[data-jack-status]')).toContainText('Round 1');
        await expect(b.locator('[data-jack-bank]')).toHaveText('1000 play chips');
        console.log(`Passed ${engine} Crapjack two independent players, touch wager, spectator privacy, settlement, ${media ? 'same call during a game switch' : 'full reload after the deal'}, and fresh session.`);
    }
    async function playTurdtris(a, b, spectator) {
        const before = media ? await packetCount(b, 'audio') : 0;
        const pauseReconnect = media && !relay ? await holdMatchReconnect(a, 'turdtris') : null;
        if (media) {
            await b.routeWebSocket(/\/beta\/arcade-turdtris-match$/, route => {
                const server = route.connectToServer();
                route.onMessage(message => {
                    const isInput = typeof message === 'string' && JSON.parse(message).action === 'input';
                    if (isInput) setTimeout(() => server.send(message), 220);
                    else server.send(message);
                });
            });
        }
        for (const page of [a, b, spectator]) {
            await page.getByRole('combobox', { name: 'Switch game' }).selectOption('turdtris');
        }
        const table = page => page.locator('[data-tris-match]');
        const score = page => page.locator('[data-tris-score]');
        const board = page => page.locator('[data-tris-playfield] canvas');
        await a.getByRole('button', { name: 'Open Turdtris race' }).click();
        await b.getByRole('button', { name: 'Join Turdtris race' }).click();
        await expect(table(a)).toHaveAttribute('data-phase', 'countdown');
        await expect(table(b)).toHaveAttribute('data-phase', 'countdown');
        assert.equal(await a.locator('[data-tris-preview]').textContent(), await b.locator('[data-tris-preview]').textContent());
        await expect(spectator.locator('[data-tris-controls]')).toBeHidden();
        await expect(table(b)).toHaveAttribute('data-phase', 'play');
        if (evidence) {
            await mkdir(evidence, { recursive: true });
            await b.screenshot({ path: join(evidence, `tris-${engine}-before-input.png`) });
        }
        await fitLandscape(b, b.locator('.tris-arena'), board(b), b.locator('[data-tris-controls]'));
        await expect(board(b)).toBeInViewport({ ratio: 1 });
        await expect(b.locator('[data-tris-controls]')).toBeInViewport({ ratio: 1 });
        await expect(b.locator('[data-send]')).toBeInViewport({ ratio: 1 });
        assert.equal(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        if (pauseReconnect) {
            const returnBoard = await pauseReconnect();
            await expect(a.locator('[data-tris-status]')).toHaveText('Reconnecting · race clock keeps running');
            await expect(board(a)).toBeInViewport({ ratio: 1 });
            await expect(a.getByRole('button', { name: 'Hard drop' })).toBeDisabled();
            await board(a).press('Space');
            returnBoard();
            await expect(a.getByRole('button', { name: 'Hard drop' })).toBeEnabled();
            await expect(table(a)).toHaveAttribute('data-sequence', '0');
        }
        await board(a).focus();
        await a.keyboard.press('ArrowLeft');
        await a.keyboard.press('Space');
        await expect(score(a)).toContainText(/· [1-9]\d* pts/);
        await expect(a.locator('[data-tris-clock]')).toBeInViewport({ ratio: 1 });
        await expect(a.locator('[data-tris-controls]')).toBeInViewport({ ratio: 1 });
        const drop = b.getByRole('button', { name: 'Hard drop' });
        const box = await drop.boundingBox();
        assert.ok(box?.width >= 44 && box?.height >= 44, 'phone-sized Turdtris drop button');
        const accepted = media ? b.evaluate(async () => {
            // Record a paint before server acknowledgement while its frame is delayed.
            const canvas = document.querySelector('[data-tris-playfield] canvas');
            const before = canvas.toDataURL();
            const table = document.querySelector('[data-tris-match]');
            const sequence = table.dataset.sequence;
            const start = performance.now();
            while (performance.now() - start < 300) {
                await new Promise(requestAnimationFrame);
                if (table.dataset.sequence !== sequence) return false;
                if (canvas.toDataURL() !== before) return true;
            }
            return false;
        }) : null;
        await b.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
        if (accepted) assert.equal(await accepted, true, 'Turdtris paints locally before the delayed server acknowledgement');
        await expect(table(b)).toHaveAttribute('data-sequence', '1');
        await expect(score(b)).toContainText(/· [1-9]\d* pts/);
        if (media) {
            await waitForPackets(b, 'audio', before);
            await expectOriginalPeer(b);
        } else {
            const recorded = await score(b).textContent();
            await b.reload();
            await b.locator('[data-enter]').click();
            await expect(table(b)).toHaveAttribute('data-sequence', '1');
            await expect(score(b)).toHaveText(recorded);
            await expect(b.getByRole('link', { name: 'Back to Rad Dad' })).toHaveCount(0);
        }
        if (evidence) {
            await a.screenshot({ path: join(evidence, `tris-${engine}-desktop.png`) });
            await b.screenshot({ path: join(evidence, `tris-${engine}-phone.png`) });
        }
        await b.getByRole('button', { name: 'Leave race' }).click();
        await b.getByRole('dialog', { name: 'Leave this race?' }).getByRole('button', { name: 'Leave race' }).click();
        await expect(a.locator('[data-tris-status]')).toHaveText('You win · forfeit');
        await a.getByRole('button', { name: 'Request Turdtris rematch' }).click();
        await b.getByRole('button', { name: 'Accept Turdtris rematch' }).click();
        await expect(table(b)).toHaveAttribute('data-phase', 'countdown');
        await expect(table(b)).toHaveAttribute('data-sequence', '0');
        console.log(`Passed ${engine} Turdtris same countdown and bag, keyboard and 44px phone touch input, ${media ? 'local prediction with 220 ms input delay and the same call' : 'full reload mid-race'}, spectator and rematch.`);
    }
    async function playTurdomania(a, b, spectator) {
        const before = media ? await packetCount(b, 'audio') : 0;
        const pauseReconnect = media && !relay ? await holdMatchReconnect(a, 'turdomania') : null;
        if (media) {
            await b.routeWebSocket(/\/beta\/arcade-turdomania-match$/, route => {
                const server = route.connectToServer();
                route.onMessage(message => {
                    const pop = typeof message === 'string' && JSON.parse(message).action === 'pop';
                    if (pop) setTimeout(() => server.send(message), 220);
                    else server.send(message);
                });
            });
        }
        for (const page of [a, b, spectator]) {
            await page.getByRole('combobox', { name: 'Switch game' }).selectOption('turdomania');
        }
        const table = page => page.locator('[data-mania-match]');
        const board = page => page.getByRole('grid', { name: 'Your puzzle' });
        const tile = (page, id) => board(page).locator(`[data-mania-tile="${id}"]`);
        const current = page => board(page).getByRole('gridcell').evaluateAll(nodes => {
            const stacks = Array.from({ length: 6 }, () => []);
            for (const { dataset } of nodes) {
                stacks[Number(dataset.col)][Number(dataset.row)] = { id: Number(dataset.maniaTile), kind: Number(dataset.kind) };
            }
            return stacks.filter(stack => stack.length);
        });
        await a.getByRole('button', { name: 'Open Turdomania duel' }).click();
        await b.getByRole('button', { name: 'Join Turdomania duel' }).click();
        await expect(table(a)).toHaveAttribute('data-phase', 'countdown');
        await expect(table(b)).toHaveAttribute('data-phase', 'countdown');
        const opening = await current(a);
        assert.deepEqual(await current(b), opening);
        const path = findDuelSolution(opening);
        assert.ok(path.length >= 5);
        await expect(spectator.getByRole('img', { name: 'Player 1 puzzle' }).locator('[data-mania-tile]')).toHaveCount(36);
        await expect(spectator.getByRole('img', { name: 'Player 2 puzzle' }).locator('[data-mania-tile]')).toHaveCount(36);
        await expect(spectator.getByRole('grid')).toHaveCount(0);
        await expect(table(b)).toHaveAttribute('data-phase', 'play');
        if (evidence) {
            await mkdir(evidence, { recursive: true });
            await b.screenshot({ path: join(evidence, `mania-${engine}-phone.png`) });
            await a.screenshot({ path: join(evidence, `mania-${engine}-desktop.png`) });
        }
        await fitLandscape(b, b.locator('.mania-playfield'), board(b), b.locator('[data-mania-clock]'));
        await expect(board(b)).toBeInViewport({ ratio: 1 });
        await expect(b.locator('[data-mania-clock]')).toBeInViewport({ ratio: 1 });
        await expect(b.locator('[data-send]')).toBeInViewport({ ratio: 1 });
        assert.equal(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        const first = tile(a, path[0]);
        if (pauseReconnect) {
            const returnPuzzle = await pauseReconnect();
            await expect(a.locator('[data-mania-status]')).toHaveText('Reconnecting · duel clock keeps running');
            await expect(board(a)).toBeInViewport({ ratio: 1 });
            await expect(first).toBeDisabled();
            await first.press('Enter');
            assert.deepEqual(await current(a), opening);
            returnPuzzle();
            await expect(first).toBeEnabled();
            await expect(table(a)).toHaveAttribute('data-move', '0');
        }
        await first.focus();
        const row = Number(await first.getAttribute('data-row'));
        await a.keyboard.press(row === 5 ? 'ArrowDown' : 'ArrowUp');
        await expect(first).not.toBeFocused();
        await a.keyboard.press(row === 5 ? 'ArrowUp' : 'ArrowDown');
        await expect(first).toBeFocused();
        await a.keyboard.press('Enter');
        await expect(table(a)).toHaveAttribute('data-move', '1');
        assert.deepEqual(await current(b), opening);
        const touch = tile(b, path[0]);
        const box = await touch.boundingBox();
        assert.ok(box?.width >= 44 && box?.height >= 44, 'phone-sized Turdomania tile');
        const prediction = media ? b.evaluate(async id => {
            const table = document.querySelector('[data-mania-match]');
            const target = document.querySelector('[data-mania-board="self"] [data-mania-tile="' + id + '"]');
            const start = performance.now();
            while (performance.now() - start < 350) {
                await new Promise(requestAnimationFrame);
                if (table.dataset.move !== '0') return false;
                if (!target.isConnected) return true;
            }
            return false;
        }, path[0]) : null;
        await b.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
        if (prediction) assert.equal(await prediction, true, 'the local tile disappears before the delayed server confirmation');
        await expect(table(b)).toHaveAttribute('data-move', '1');
        assert.deepEqual(await current(b), await current(a));
        if (!media) {
            const prior = await current(b);
            await b.reload();
            await b.locator('[data-enter]').click();
            await expect(table(b)).toHaveAttribute('data-move', '1');
            assert.deepEqual(await current(b), prior);
            await expect(b.getByRole('link', { name: 'Back to Rad Dad' })).toHaveCount(0);
        }
        for (const [move, id] of path.entries()) {
            if (!move) continue;
            await tile(a, id).click();
            await tile(b, id).click();
            await expect(table(a)).toHaveAttribute('data-move', String(move + 1));
            await expect(table(b)).toHaveAttribute('data-move', String(move + 1));
        }
        for (const page of [a, b, spectator]) {
            await expect(table(page)).toHaveAttribute('data-phase', 'finished');
            await expect(page.locator('[data-mania-status]')).toHaveText('Draw');
            await expect(page.getByText('Cleared', { exact: true })).toHaveCount(2);
        }
        if (media) {
            await waitForPackets(b, 'audio', before);
            await expectOriginalPeer(b);
        }
        await a.getByRole('button', { name: 'Request Turdomania rematch' }).click();
        await b.getByRole('button', { name: 'Accept Turdomania rematch' }).click();
        await expect(table(b)).toHaveAttribute('data-phase', 'countdown');
        await expect(table(b)).toHaveAttribute('data-move', '0');
        await expect(board(b).getByRole('gridcell')).toHaveCount(36);
        console.log(`Passed ${engine} Turdomania two complete puzzles, keyboard and 44px phone touch input, ${media ? 'local prediction with 220 ms input delay and the same call' : 'full reload mid-duel'}, spectator and rematch.`);
    }
    async function playTurdRush(a, b, spectator) {
        const before = media ? await packetCount(b, 'audio') : 0;
        const pauseReconnect = media && !relay ? await holdMatchReconnect(a, 'turdrush') : null;
        if (media) {
            await b.routeWebSocket(/\/beta\/arcade-turdrush-match$/, route => {
                const server = route.connectToServer();
                route.onMessage(message => {
                    const action = typeof message === 'string' && JSON.parse(message).action === 'input';
                    if (action) setTimeout(() => server.send(message), 220);
                    else server.send(message);
                });
            });
        }
        let opening;
        a.on('websocket', socket => {
            if (!socket.url().endsWith('/beta/arcade-turdrush-match')) return;
            socket.on('framereceived', ({ payload }) => {
                if (typeof payload !== 'string') return;
                const match = JSON.parse(payload).state?.match;
                if (match && !opening) opening = match;
            });
        });
        for (const page of [a, b, spectator]) {
            await page.getByRole('combobox', { name: 'Switch game' }).selectOption('turdrush');
        }
        const race = page => page.locator('[data-race-match]');
        const track = page => page.getByRole('region', { name: 'Turd Rush race track' });
        await a.getByRole('button', { name: 'Open Turd Rush race' }).click();
        await b.getByRole('button', { name: 'Join Turd Rush race' }).click();
        await expect(race(b)).toHaveAttribute('data-phase', 'countdown');
        await expect(race(b)).toHaveAttribute('data-renderer', '2d');
        if (engine === 'chromium') await expect(race(a)).toHaveAttribute('data-renderer', '3d');
        await expect(spectator.locator('[data-race-controls]')).toBeHidden();
        await expect.poll(() => !!opening).toBe(true);
        const danger = unpackRushRacer(opening.runner).run.entities
            .find(entity => entity.at === 100 && entity.lane !== 1 && ['crate', 'beam', 'barrier'].includes(entity.kind)).lane;
        const direction = danger === 0 ? 'left' : 'right';
        await fitLandscape(b, track(b), track(b), b.locator('[data-race-controls]'));
        await expect(track(b)).toBeInViewport({ ratio: 1 });
        await expect(b.locator('[data-race-controls]')).toBeInViewport({ ratio: 1 });
        await expect(b.locator('[data-send]')).toBeInViewport({ ratio: 1 });
        assert.equal(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await track(a).focus();
        await expect(race(a)).toHaveAttribute('data-phase', 'play');
        await expect(race(b)).toHaveAttribute('data-phase', 'play');
        if (pauseReconnect) {
            const returnTrack = await pauseReconnect();
            await expect(a.locator('[data-race-status]')).toHaveText('Reconnecting · the course keeps moving');
            await expect(track(a)).toBeInViewport({ ratio: 1 });
            await expect(a.getByRole('button', { name: 'Move left' })).toBeDisabled();
            await track(a).press('ArrowLeft');
            returnTrack();
            await expect(a.getByRole('button', { name: 'Move left' })).toBeEnabled();
            await expect(race(a)).toHaveAttribute('data-lane', '1');
            await expect(race(a)).toHaveAttribute('data-sequence', '0');
        }
        const control = b.getByRole('button', { name: 'Move ' + direction });
        const controlBox = await control.boundingBox();
        assert.ok(controlBox?.width >= 44 && controlBox.height >= 44, 'phone-sized Turd Rush control');
        const prediction = media ? b.evaluate(async expectedLane => {
            const table = document.querySelector('[data-race-match]');
            const start = performance.now();
            while (performance.now() - start < 400) {
                await new Promise(requestAnimationFrame);
                if (table.dataset.sequence !== '0') return false;
                if (table.dataset.lane === expectedLane) return true;
            }
            return false;
        }, String(danger)) : null;
        if (engine === 'chromium') {
            const connection = await b.context().newCDPSession(b);
            try {
                const box = await track(b).boundingBox();
                assert.ok(box);
                const x = box.x + box.width / 2, y = box.y + box.height * .66;
                await connection.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
                await connection.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (danger === 0 ? -75 : 75), y }] });
                await connection.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            } finally { await connection.detach(); }
        } else await b.touchscreen.tap(controlBox.x + controlBox.width / 2, controlBox.y + controlBox.height / 2);
        await track(a).press(danger === 0 ? 'ArrowLeft' : 'ArrowRight');
        if (prediction) assert.equal(await prediction, true, 'native phone swipe moves locally before delayed confirmation');
        for (const page of [a, b]) {
            await expect(race(page)).toHaveAttribute('data-sequence', '1');
            await expect(race(page)).toHaveAttribute('data-lane', String(danger));
        }
        await expect.poll(async () => {
            const meters = await b.locator('[data-race-score] progress').evaluateAll(bars => bars.map(bar => bar.value));
            return meters[0] > 0 && meters[0] === meters[1];
        }).toBe(true);
        if (!media) {
            await b.reload();
            await b.locator('[data-enter]').click();
            await expect(race(b)).toHaveAttribute('data-sequence', '1');
            await expect(race(b)).toHaveAttribute('data-lane', String(danger));
            await expect(b.getByRole('link', { name: 'Back to Rad Dad' })).toHaveCount(0);
        }
        if (evidence) {
            await mkdir(evidence, { recursive: true });
            await a.screenshot({ path: join(evidence, `rush-${engine}-desktop.png`) });
            await b.screenshot({ path: join(evidence, `rush-${engine}-phone.png`) });
        }
        for (const page of [a, b, spectator]) {
            await expect(race(page)).toHaveAttribute('data-phase', 'finished', { timeout: 14000 });
            await expect(page.locator('[data-race-score="a"]')).toContainText(/99 m .*Out/);
            await expect(page.locator('[data-race-score="b"]')).toContainText(/99 m .*Out/);
        }
        if (media) {
            await waitForPackets(b, 'audio', before);
            await expectOriginalPeer(b);
        }
        await a.getByRole('button', { name: 'Request Turd Rush rematch' }).click();
        await b.getByRole('button', { name: 'Accept Turd Rush rematch' }).click();
        await expect(race(b)).toHaveAttribute('data-phase', 'countdown');
        await expect(race(b)).toHaveAttribute('data-sequence', '0');
        console.log(`Passed ${engine} Turd Rush shared course and collision, keyboard, ${media ? 'native swipe with 220 ms delay and active call' : '44px phone touch and full reload'}, 2D fallback, spectator and rematch.`);
    }
    async function verifyBrickRaceFinish(a, b, spectator) {
        const pages = [a, b, spectator];
        const status = page => page.locator('[data-brick-status]');
        const match = page => page.locator('[data-brick-match]');
        const scoreboard = page => page.locator('[data-brick-score]').evaluateAll(rows => rows.map(row => ({
            seat: row.dataset.brickScore,
            bricks: row.children[1].textContent,
            score: row.children[2].textContent
        })));
        const audioBeforeWait = media ? await packetCount(b, 'audio') : 0;
        await a.locator('[data-text]').fill('Playing this brick race to the buzzer');
        await a.locator('[data-send]').click();
        await expect(b.locator('[data-buffer]')).toContainText('Playing this brick race to the buzzer');
        await expect(match(a)).toHaveAttribute('data-phase', 'finished', { timeout: 82000 });
        for (const page of pages) {
            await expect(match(page)).toHaveAttribute('data-phase', 'finished');
            await expect(page.locator('[data-brick-clock]')).toHaveText('Final');
        }
        const scores = await scoreboard(spectator);
        assert.deepEqual(scores.map(score => score.seat), ['a', 'b']);
        const [first, second] = scores;
        const lead = parseInt(first.bricks, 10) - parseInt(second.bricks, 10) || parseInt(first.score, 10) - parseInt(second.score, 10);
        const publicResult = await status(spectator).textContent();
        const [, reason] = publicResult.split(' · ');
        assert.ok(['time limit', 'wall cleared', 'out of balls'].includes(reason), publicResult);
        const labels = lead > 0 ? ['You win', 'Rival wins', 'Player 1 wins']
            : lead < 0 ? ['Rival wins', 'You win', 'Player 2 wins'] : ['Draw', 'Draw', 'Draw'];
        for (const [index, page] of pages.entries()) {
            await expect(status(page)).toHaveText(`${labels[index]} · ${reason}`);
            assert.deepEqual(await scoreboard(page), scores);
        }
        await expect(b.getByRole('button', { name: 'Request Turdanoid rematch' })).toBeInViewport({ ratio: 1 });
        await expect(spectator.getByRole('button', { name: /Turdanoid rematch/ })).toBeHidden();
        if (media) {
            await waitForPackets(b, 'audio', audioBeforeWait);
            await expectOriginalPeer(b);
        }
        if (evidence) await b.screenshot({ path: join(evidence, `brick-${engine}-natural-finish.png`) });
        console.log(`Passed ${engine} natural Turdanoid finish and matching player/spectator scores (${publicResult}).`);
    }
    async function playTurdanoid(a, b, spectator) {
        const before = media ? await packetCount(b, 'audio') : 0;
        const pauseReconnect = media && !relay ? await holdMatchReconnect(a, 'turdanoid') : null;
        const launchFrames = [], keyboardAxes = [];
        let sentServes = 0, confirmedKeyboard;
        function observeKeyboard(socket) {
            if (!new URL(socket.url()).pathname.endsWith('/arcade-turdanoid-match')) return;
            socket.on('framesent', ({ payload }) => {
                const frame = JSON.parse(payload.toString());
                if (frame.action === 'input') for (const [tick, action, value] of frame.inputs) {
                    if (action === 'axis') keyboardAxes.push({ tick, value, sequence: frame.sequence });
                }
            });
            socket.on('framereceived', ({ payload }) => {
                const runner = JSON.parse(payload.toString()).state?.match?.runner;
                if (runner) confirmedKeyboard = runner;
            });
        }
        a.on('websocket', observeKeyboard);
        function observeLaunch(socket) {
            if (!new URL(socket.url()).pathname.endsWith('/arcade-turdanoid-match')) return;
            for (const direction of ['framesent', 'framereceived']) socket.on(direction, ({ payload }) => {
                const { action, inputs, sequence, reason, state } = JSON.parse(payload.toString());
                const runner = state?.match?.runner;
                if (action !== 'input' && !reason && !runner) return;
                if (direction === 'framesent' && action === 'input') sentServes += inputs.filter(([, control]) => control === 'serve').length;
                launchFrames.push({ direction, action, inputs, sequence, reason,
                    at: state?.match?.at, tick: runner?.tick, confirmed: runner?.sequence, serves: runner?.run?.serves });
                if (launchFrames.length > 24) launchFrames.shift();
            });
        }
        b.on('websocket', observeLaunch);
        if (media) {
            await b.routeWebSocket(/\/beta\/arcade-turdanoid-match$/, route => {
                const server = route.connectToServer();
                route.onMessage(message => {
                    if (typeof message === 'string' && JSON.parse(message).action === 'input') {
                        setTimeout(() => server.send(message), 220);
                    } else server.send(message);
                });
            });
        }
        for (const page of [a, b, spectator]) {
            await page.getByRole('combobox', { name: 'Switch game' }).selectOption('turdanoid');
        }
        const match = page => page.locator('[data-brick-match]');
        const board = page => page.getByRole('region', { name: 'Turdanoid playfield' });
        const serve = page => page.getByRole('button', { name: 'Launch ball' });
        const launchWait = page => page.locator('[data-brick-launch-wait]');
        await a.getByRole('button', { name: 'Open Turdanoid race' }).click();
        await b.getByRole('button', { name: 'Join Turdanoid race' }).click();
        await expect(match(b)).toHaveAttribute('data-phase', 'countdown');
        await expect(serve(b)).toBeDisabled();
        await expect(launchWait(b)).toHaveText('Launch is not active yet. The countdown is still running.');
        await expect(launchWait(spectator)).toBeHidden();
        await expect(board(spectator)).toBeVisible();
        await expect(serve(spectator)).toBeHidden();
        await fitLandscape(b, b.locator('.brick-race-layout'), board(b), serve(b));
        await expect(board(b)).toBeInViewport({ ratio: 1 });
        await expect(serve(b)).toBeInViewport({ ratio: 1 });
        await expectUncoveredControl(serve(b));
        await expect(b.locator('[data-send]')).toBeInViewport({ ratio: 1 });
        const field = await board(b).boundingBox(), launch = await serve(b).boundingBox();
        assert.ok(field && launch);
        assert.ok(launch.width >= 44 && launch.height >= 44, 'phone-sized Turdanoid Launch button');
        assert.ok(launch.x >= field.x + field.width, 'Launch button does not cover the playfield or paddle');
        assert.equal(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await expect(serve(b)).toBeEnabled();
        await expect(serve(a)).toBeEnabled();
        await expect(launchWait(b)).toBeHidden();
        if (pauseReconnect) {
            const returnBoard = await pauseReconnect();
            await expect(a.locator('[data-brick-status]')).toHaveText('Reconnecting · race clock keeps running');
            await expect(board(a)).toBeInViewport({ ratio: 1 });
            await expect(serve(a)).toBeDisabled();
            await board(a).press('Space');
            returnBoard();
            await expect(serve(a)).toBeEnabled();
            await expect(match(a)).toHaveAttribute('data-stuck', 'true');
            await expect(match(a)).toHaveAttribute('data-sequence', '0');
        }
        const x = field.x + field.width * .5, y = field.y + field.height * .85;
        const prediction = media ? b.evaluate(async () => {
            const table = document.querySelector('[data-brick-match]');
            const start = performance.now();
            while (performance.now() - start < 400) {
                await new Promise(requestAnimationFrame);
                if (table.dataset.sequence !== '0') return false;
                if (Number(table.dataset.paddle) > 250) return true;
            }
            return false;
        }) : null;
        if (engine === 'chromium') {
            const connection = await b.context().newCDPSession(b);
            try {
                await connection.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
                await connection.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + field.width * .075, y }] });
                await connection.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            } finally { await connection.detach(); }
        } else await b.touchscreen.tap(x + field.width * .075, y);
        if (prediction) assert.equal(await prediction, true, 'phone drag moves paddle before delayed server confirmation');
        await expect.poll(async () => Number(await match(b).getAttribute('data-paddle'))).toBeGreaterThan(260);
        await expect(match(b)).toHaveAttribute('data-stuck', 'true');
        await expect(match(b)).toHaveAttribute('data-sequence', /^[1-9]\d*$/);
        await board(a).focus();
        await a.keyboard.down('ArrowRight');
        await expect.poll(async () => Number(await match(a).getAttribute('data-paddle'))).toBeGreaterThan(248);
        await a.keyboard.up('ArrowRight');
        if (evidence) {
            await a.screenshot({ path: join(evidence, `brick-${engine}-desktop.png`) });
            await b.screenshot({ path: join(evidence, `brick-${engine}-phone.png`) });
        }
        await a.keyboard.press('Space');
        await b.bringToFront();
        const sequenceBeforeLaunch = Number(await match(b).getAttribute('data-sequence'));
        await expect(serve(b)).toBeInViewport({ ratio: 1 });
        const launchEvents = await b.evaluateHandle(suppressClick => {
            const events = [], controller = new AbortController();
            for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'click']) document.addEventListener(type, event => {
                const button = event.target.closest?.('[data-brick-serve]');
                events.push({ type, trusted: event.isTrusted, pointer: event.pointerType, onLaunch: !!button, disabled: button?.disabled });
                // Match the hosted Chromium trace where only native touch pointer events reached Launch.
                if (button && type === 'click' && suppressClick) event.stopImmediatePropagation();
            }, { capture: true, signal: controller.signal });
            return { events, controller };
        }, engine === 'chromium');
        try {
            await serve(b).tap();
            const events = await launchEvents.evaluate(trace => trace.events);
            assert.ok(events.some(event => event.type === 'pointerup' && event.trusted && event.pointer === 'touch' && event.onLaunch));
            await expect(match(b)).toHaveAttribute('data-stuck', 'false');
            await expect.poll(async () => Number(await match(b).getAttribute('data-sequence'))).toBeGreaterThan(sequenceBeforeLaunch);
            await expect.poll(() => launchFrames.some(frame => frame.serves === 1)).toBe(true);
            assert.equal(sentServes, 1, 'one phone tap produces one serve command');
        } catch (error) {
            const events = await launchEvents.evaluate(trace => trace.events);
            const feedback = await b.locator('[data-brick-error]').textContent();
            console.error('Turdanoid phone launch', JSON.stringify({ sequenceBeforeLaunch, events, feedback, launchFrames }));
            if (evidence) await b.screenshot({ path: join(evidence, `brick-${engine}-launch-failure.png`) });
            throw error;
        } finally {
            b.off('websocket', observeLaunch);
            await launchEvents.evaluate(trace => trace.controller.abort());
            await launchEvents.dispose();
        }
        for (const page of [a, b, spectator]) {
            for (const seat of ['a', 'b']) {
                await expect(page.locator(`[data-brick-score="${seat}"]`)).toContainText(/[1-9]\d* pts/);
            }
        }
        if (!media) {
            const sequence = await match(b).getAttribute('data-sequence');
            await b.reload();
            await b.locator('[data-enter]').click();
            await expect(match(b)).toHaveAttribute('data-sequence', sequence);
            await expect(b.locator('[data-brick-score="b"]')).toContainText(/[1-9]\d* pts/);
            await expect(b.getByRole('link', { name: 'Back to Rad Dad' })).toHaveCount(0);
        }
        if (naturalBrickRace) await verifyBrickRaceFinish(a, b, spectator);
        else {
            await b.getByRole('button', { name: 'Leave race' }).click();
            await b.getByRole('dialog', { name: 'Leave this race?' }).getByRole('button', { name: 'Leave race' }).click();
            await expect(a.locator('[data-brick-status]')).toHaveText('You win · forfeit');
        }
        await a.getByRole('button', { name: 'Request Turdanoid rematch' }).click();
        await b.getByRole('button', { name: 'Accept Turdanoid rematch' }).click();
        await expect(match(b)).toHaveAttribute('data-phase', 'countdown');
        await expect(match(b)).toHaveAttribute('data-sequence', '0');
        await expect(launchWait(b)).toHaveText('Launch is not active yet. The countdown is still running.');
        await expect(serve(a)).toBeEnabled();
        await expect(launchWait(b)).toBeHidden();
        await expect(match(b)).toHaveAttribute('data-stuck', 'true');
        const beforeBallTap = Number(await match(b).getAttribute('data-sequence'));
        const ballTap = await board(b).evaluate(element => {
            const canvas = element.querySelector('canvas');
            const rect = element.getBoundingClientRect();
            const paddle = Number(element.closest('[data-brick-match]').dataset.paddle);
            return {
                x: rect.left + (paddle / canvas.width) * rect.width,
                y: rect.top + ((canvas.height - 32) / canvas.height) * rect.height
            };
        });
        await b.touchscreen.tap(ballTap.x, ballTap.y);
        await expect(match(b)).toHaveAttribute('data-stuck', 'false');
        await expect.poll(async () => Number(await match(b).getAttribute('data-sequence'))).toBeGreaterThan(beforeBallTap);
        const axesAt = keyboardAxes.length;
        await board(a).evaluate(element => {
            // Put one launch and seven axis changes in the same render frame.
            // The last release arrives when the unsent input buffer is full.
            for (const [type, key] of [
                ['keydown', ' '], ['keydown', 'ArrowLeft'], ['keydown', 'ArrowRight'], ['keyup', 'ArrowLeft'],
                ['keydown', 'ArrowLeft'], ['keyup', 'ArrowRight'], ['keydown', 'ArrowRight'],
                ['keyup', 'ArrowLeft'], ['keyup', 'ArrowRight']
            ]) element.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true }));
        });
        await expect.poll(() => {
            const final = keyboardAxes.length > axesAt ? keyboardAxes.at(-1) : null;
            return final?.value === 0 && confirmedKeyboard?.sequence >= final.sequence &&
                confirmedKeyboard.tick >= final.tick && confirmedKeyboard.run.axis === 0;
        }, { message: 'Turdanoid confirms the final keyboard release after the input burst' }).toBe(true);
        a.off('websocket', observeKeyboard);
        if (media) {
            await waitForPackets(b, 'audio', before);
            await expectOriginalPeer(b);
        }
        console.log(`Passed ${engine} Turdanoid same wall, keyboard launch, ${media ? 'native phone drag with 220 ms delay and active call' : 'native phone tap and full reload'}, visible paddle and Launch, both scores, spectator and rematch.`);
    }
    try {
        if (options.webJamShare) {
            await verifyWebJamShare();
            assert.deepEqual(errors, []);
            console.log('Passed prepared Game Night invitation and trusted WebJam share.');
            return;
        }
        if (options.siteGuest) {
            await verifyBrandGuestEntry(options.siteGuest);
            assert.deepEqual(errors, []);
            return;
        }
        if (mixed) {
            await verifyMixedVersions(mixed);
            assert.deepEqual(errors, []);
            return;
        }
        const a = await guest('stalemate', 'ChessHost', { width: 1280, height: 900 });
        await expect(a.locator('[data-entry-return][href]')).toHaveCount(0);
        const b = await guest('rad-dad', 'ChessGuest', { width: 375, height: 667 }, true);
        await a.getByRole('button', { name: /Game Night/ }).click();
        await inviteToGame(a, b, 'ChessGuest');
        await expect(b.getByRole('button', { name: 'Open Rad Dad Arcade', exact: true })).toBeVisible();
        await expect(b.locator('[data-game-arcade-external]')).not.toHaveAttribute('href', /./);
        for (const page of [a, b]) await page.locator('.arcade-chess summary').click();
        await a.getByRole('button', { name: 'Open Chess match' }).click();
        await b.getByRole('button', { name: 'Join as Black' }).click();
        await expect(a.locator('[data-chess-status]')).toHaveText('You’re White · Your turn');
        await fit(a, 'desktop');
        const phoneChessboard = b.locator('.arcade-chess-board');
        await fitLandscape(b, phoneChessboard, phoneChessboard);
        await fit(b, 'phone');
        await moveByKeyboard(a, 'e2', 'ArrowUp', 2);
        await expect(b.getByRole('button', { name: 'e4, White pawn' })).toBeAttached();
        await tapSquare(b, 'e7');
        await tapSquare(b, 'e5');
        await expect(a.getByRole('button', { name: 'e5, Black pawn' })).toBeAttached();
        await b.locator('[data-text]').fill('Good game from Rad Dad');
        await b.locator('[data-send]').click();
        await expect(a.locator('[data-buffer]')).toContainText('Good game from Rad Dad');
        await b.reload();
        await expect(b.getByLabel('Your nick')).toHaveValue('ChessGuest');
        await b.locator('[data-enter]').click();
        await expect(b.locator('[data-chess-status]')).toHaveText('You’re Black · White to move');
        await expect(b.getByRole('button', { name: 'e5, Black pawn' })).toBeVisible();
        await expect(a.getByRole('button', { name: 'e5, Black pawn' })).toBeVisible();
        await expect(b.getByRole('link', { name: 'Back to Rad Dad' })).toHaveCount(0);
        await expect(b.locator('[data-buffer]')).not.toContainText('Good game from Rad Dad');
        if (media) await joinCalls(a, b);
        else await expect(b.locator('[data-call-toggle]')).toBeHidden();
        const beforeSwitch = media ? await packetCount(b, 'audio') : 0;
        await b.getByRole('combobox', { name: 'Switch game' }).selectOption('crapeights');
        await expect(b.locator('.arcade-eights')).toHaveAttribute('open', '');
        await expect(b.locator('.arcade-chess')).not.toHaveAttribute('open', '');
        await b.locator('.arcade-chess summary').click();
        await expect(b.getByRole('button', { name: 'e5, Black pawn' })).toBeVisible();
        await expect(b.locator('.arcade-eights')).not.toHaveAttribute('open', '');
        if (media) {
            await expect(b.locator('[data-call-toggle]')).toHaveText('Call joined');
            await waitForPackets(b, 'audio', beforeSwitch);
            await expectOriginalPeer(b);
        }
        await b.locator('[data-text]').fill('Back at the same board');
        await b.locator('[data-send]').click();
        await expect(a.locator('[data-buffer]')).toContainText('Back at the same board');
        await a.getByRole('button', { name: 'Offer draw', exact: true }).click();
        await b.getByRole('button', { name: 'Accept draw', exact: true }).click();
        await expect(a.locator('[data-chess-status]')).toContainText('Draw by agreement');
        await a.getByRole('button', { name: 'Request rematch' }).click();
        await b.getByRole('button', { name: 'Accept rematch' }).click();
        await expect(b.locator('[data-chess-status]')).toHaveText('You’re White · Your turn');
        await expect(b.getByRole('button', { name: 'e2, White pawn' })).toBeAttached();
        await fit(a, 'desktop-rematch');
        await fit(b, 'phone-rematch');
        assert.equal(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        if (evidence) {
            await mkdir(evidence, { recursive: true });
            await a.screenshot({ path: join(evidence, `chess-${engine}-desktop.png`) });
            await b.screenshot({ path: join(evidence, `chess-${engine}-phone.png`) });
        }
        await b.setViewportSize({ width: 390, height: 844 });
        await fit(b, 'phone-tall');
        await b.setViewportSize({ width: 375, height: 667 });
        await playChessCheckmate(a, b);
        await playEights(a, b);
        await playRummy(a, b);
        const spectator = await playSpades(a, b);
        await playJack(a, b, spectator);
        await playTurdtris(a, b, spectator);
        await playTurdomania(a, b, spectator);
        await playTurdRush(a, b, spectator);
        await playTurdanoid(a, b, spectator);
        if (relay) {
            const stats = (await Promise.all([selectedPairStats(a), selectedPairStats(b)])).flat();
            assert.equal(stats.length, 2);
            for (const sample of stats) {
                assert.deepEqual(sample.candidates, ['relay', 'relay']);
                assert.ok(sample.bytesReceived > 0 && sample.bytesSent > 0);
            }
            console.log('Selected loopback relay pair after all nine arcade journeys:', JSON.stringify(stats));
        }
        if (media) {
            const beforeReport = await packetCount(b, 'audio');
            await b.locator('[data-call-toggle]').tap();
            const flag = b.getByRole('button', { name: 'Report ChessHost from this call' });
            const hitArea = await flag.boundingBox();
            assert.ok(hitArea?.height >= 44);
            await flag.tap();
            const report = b.getByRole('dialog', { name: 'Report call participant' });
            await report.getByRole('button', { name: 'Cancel' }).tap();
            await expect(flag).toBeFocused();
            await flag.tap();
            const preservedFocus = await report.getByRole('button', { name: 'Cancel' }).evaluate(cancel => new Promise(resolve => {
                const dialog = cancel.closest('dialog');
                const leave = document.querySelector('[data-leave]');
                dialog.addEventListener('close', () => resolve(document.activeElement === leave), { once: true });
                cancel.click();
                leave.focus();
            }));
            assert.equal(preservedFocus, true, 'the queued dialog close event respects a later focus change');
            await flag.tap();
            await report.getByLabel('What happened?').press('Escape');
            await expect(report).toBeHidden();
            await expect(flag).toBeFocused();
            await flag.tap();
            await submitCallReport(b, 'Synthetic phone report while both players are still in the call.', true);
            await waitForPackets(b, 'audio', beforeReport);
            await a.locator('[data-call-toggle]').click();
            await a.getByRole('button', { name: 'Actions for ChessGuest' }).click();
            await a.locator('[data-sheet]').getByRole('button', { name: 'Block', exact: true }).click();
            for (const page of [a, b]) {
                await expect(page.locator('[data-call-peers] li')).toHaveCount(0);
                assert.equal(await page.evaluate(() => window.testPeers[0].connectionState), 'closed');
            }
            await b.getByText('Report a recent call participant', { exact: true }).tap();
            await b.getByRole('button', { name: 'Report ChessHost', exact: true }).tap();
            await submitCallReport(b, 'Synthetic report after a peer was blocked.');
            console.log('Passed Chromium phone report consent, accessible cancel and focus, durable acknowledgement, continued audio and reporting a recently blocked peer.');
        }
        const leaveRoom = b.locator('[data-leave]');
        await leaveRoom.focus();
        await leaveRoom.press('Enter');
        try {
            await expect(b.locator('[data-game-night]')).toBeHidden();
        } catch (error) {
            if (naturalBrickRace) {
                const state = await leaveRoom.evaluate(button => ({ disabled: button.disabled,
                    focused: document.activeElement === button, connection: document.querySelector('[data-connection]').textContent }));
                console.error('Leave after full brick race', JSON.stringify({ state, longRoomTrace }));
                if (evidence) await b.screenshot({ path: join(evidence, `brick-${engine}-leave-failure.png`) });
            }
            throw error;
        }
        await expect(b.getByRole('tab', { name: '#stalemate', exact: true })).toBeFocused();
        if (media) {
            await expect.poll(() => b.evaluate(() => window.testLocalTracks.every(track => track.readyState === 'ended'))).toBe(true);
            await expect(a.locator('[data-call-peers] li')).toHaveCount(0);
            await a.getByRole('button', { name: 'Leave call', exact: true }).click();
            assert.equal(await a.evaluate(() => window.testLocalTracks.every(track => track.readyState === 'ended')), true);
            console.log('Passed protected two-brand browser voice and video with Chromium synthetic devices, camera revocation, game switching and track cleanup.');
        }
        await b.reload();
        await b.locator('[data-enter]').click();
        await expect(b.locator('[data-connection]')).toHaveText('Connected');
        await expect(b.locator('[data-game-night]')).toBeHidden();
        await verifyGameNightEntry();
        await verifyPrivateSiteEntry();
        assert.deepEqual(errors, []);
        console.log(`Passed ${engine} ${entrances ? 'both generated arcade entry links' : 'protected entry with both brand contexts'}, invitation, keyboard/touch Chess, room chat, draw and rematch.`);
    } finally { await browser.close(); }
}
