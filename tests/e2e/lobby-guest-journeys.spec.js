// Browser UI regressions. Jam invitations use the real loopback relay. The
// session-ended cases explicitly inject a server 4401 around the real engine;
// they qualify client recovery, not real cookie expiry or Access sign-in.
const { test, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const ROOT = '/r/45662413410ed051/lobby/';
const INVITE = 'Join our synthetic rehearsal on WebJam:\nPaste this whole message.\nwebjam://join?v=3&r=fixture&i=guest_journey_capability';
test.use({ permissions: ['camera'], launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });

async function visitor(browser, baseURL, relay, nick, width, fixture) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, permissions: ['camera'] });
    await context.route('**/*', route => new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort());
    await context.addInitScript(() => {
        window.copiedInvites = [];
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.copiedInvites.push(text); } } });
        window.capturedTracks = [];
        const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = async constraints => {
            const stream = await capture(constraints); window.capturedTracks.push(...stream.getTracks()); return stream;
        };
    });
    if (fixture && fixture.betaShell !== false) {
        await context.route('**/beta/bootstrap.js', route => route.fulfill({ contentType: 'text/javascript', body: '// Explicit beta-shell routing marker; no authentication fixture.' }));
        await context.route('**/beta/', route => route.fulfill({ contentType: 'text/html', body: '<h1>Your private invitation</h1>' }));
        await context.route(url => url.pathname === ROOT, async route => {
            const response = await route.fetch();
            await route.fulfill({ response, body: (await response.text()).replace('<head>', '<head><script src="/beta/bootstrap.js"></script>') });
        });
    }
    const page = await context.newPage();
    if (fixture) await fixture.attach(page, nick);
    await page.goto(`${ROOT}?preview=local-preview-key-0001&relay=${encodeURIComponent(relay)}${fixture?.ownerNicks?.has(nick) ? '&owner=1' : ''}`);
    await page.fill('[data-nick]', nick); await page.click('[data-enter]');
    await expect(page.locator('[data-connection]')).toHaveText('Connected');
    return page;
}
async function say(page, text) { await page.fill('[data-text]', text); await page.press('[data-text]', 'Enter'); }
async function channel(page, name) {
    await page.locator('.phonetabs [data-show="rooms"]').click(); await page.click('[data-start="chat"]');
    await page.fill('[data-channel-name]', name); await page.locator('[data-channel-form] button[type=submit]').click();
    await expect(page.locator('[data-chat-context]')).toHaveText('#' + name);
}
async function contained(page, locator) {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const bounds = await locator.boundingBox(); expect(bounds).not.toBeNull();
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize().width);
}

for (const width of [375, 390]) {
    test(`a host invites a lobby guest into a protected Jam room using visible controls at ${width}px`, async ({ browser, baseURL }, testInfo) => {
        const relay = hangoutRelayWsBase(baseURL, `guest-jam-${randomUUID()}`), pages = [];
        try {
            const host = await visitor(browser, baseURL, relay, 'JourneyHost', width); pages.push(host);
            const guest = await visitor(browser, baseURL, relay, 'JourneyGuest', width); pages.push(guest);
            const outsider = await visitor(browser, baseURL, relay, 'JourneyOutsider', width); pages.push(outsider);
            await host.click('.phonetabs [data-show="rooms"]'); await host.click('[data-start="jam"]');
            await expect(host.locator('[data-chat-context]')).toHaveText(/^#jam-/);
            const roomName = await host.locator('[data-chat-context]').textContent();
            await expect(host.locator('[data-modes]')).toContainText('+ti');
            // An outsider uses only the normal command composer; the server
            // must still reject entry and invitation attempts.
            await say(outsider, '/join ' + roomName);
            await expect(outsider.locator('[data-toast]')).toContainText('invite-only');
            await say(outsider, '/invite JourneyGuest ' + roomName);
            await expect(outsider.locator('[data-buffer]')).toContainText('/invite: permission denied');
            await expect(guest.locator('[data-toast] button')).toHaveCount(0);
            await host.click('[data-roomtools]');
            await expect(host.getByRole('button', { name: 'Invite guest', exact: true })).toBeVisible();
            await host.getByRole('button', { name: 'Invite guest', exact: true }).click();
            const dialog = host.getByRole('dialog', { name: 'Invite a guest' });
            await expect(dialog).toBeVisible(); await expect(dialog).toContainText(roomName);
            await expect(host.getByLabel('Guest nickname', { exact: true })).toBeFocused();
            await host.getByLabel('Guest nickname', { exact: true }).fill('JourneyGuest');
            await contained(host, dialog);
            expect(await host.getByLabel('Guest nickname', { exact: true }).evaluate(node => getComputedStyle(node).fontSize)).toBe('16px');
            await host.screenshot({ path: testInfo.outputPath(`invite-guest-${width}.png`) });
            await dialog.getByRole('button', { name: 'Send invitation', exact: true }).click();
            await expect(dialog).toBeHidden();
            await expect(guest.locator('[data-toast]')).toContainText('JourneyHost invited you to ' + roomName);
            await guest.locator('[data-toast]').getByRole('button', { name: 'Join', exact: true }).click();
            await expect(guest.locator('[data-chat-context]')).toHaveText(roomName);
            await expect(guest.locator('[data-roomtools]')).toBeHidden();
            await host.fill('[data-jam-link]', INVITE); await host.locator('[data-jam-form] button[type=submit]').click();
            await expect(guest.locator('[data-jam-copy]')).toBeVisible(); await guest.click('[data-jam-copy]');
            expect(await guest.evaluate(() => window.copiedInvites)).toEqual([INVITE]);
            await expect(guest.locator('[data-toast]')).toContainText('Open WebJam, choose Join');
            await expect(outsider.locator('[data-jam-copy]')).toBeHidden();
            await expect(outsider.locator('[data-chat-context]')).toHaveText('#stalemate');
            expect(await outsider.evaluate(() => document.body.textContent)).not.toContain(INVITE);
            await contained(guest, guest.locator('[data-send]'));
            await guest.screenshot({ path: testInfo.outputPath(`jam-handoff-${width}.png`) });
        } finally { await Promise.all(pages.map(page => page.context().close())); }
    });
}

for (const viewport of [{ width: 320, height: 256 }, { width: 640, height: 512 }]) {
    test(`ended-session invitation and readonly draft remain keyboard-reachable at ${viewport.width}x${viewport.height}`, async ({ browser, baseURL }, testInfo) => {
        const fixture = await closingFixture(), relay = hangoutRelayWsBase(baseURL, `guest-reflow-${randomUUID()}`);
        const page = await visitor(browser, baseURL, relay, 'ReflowGuest', viewport.width, fixture);
        try {
            await page.setViewportSize(viewport);
            await page.fill('[data-text]', 'Copy this unsent message before returning'); fixture.end('ReflowGuest');
            const link = page.getByRole('link', { name: 'Return to invitation', exact: true }), input = page.locator('[data-text]');
            await expect(page.getByRole('region', { name: 'Session ended' })).toBeVisible();
            const inView = async locator => {
                await locator.focus(); await expect(locator).toBeFocused(); await contained(page, locator);
                const box = await locator.boundingBox(); expect(box.y).toBeGreaterThanOrEqual(0);
                expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
            };
            await inView(link); await page.screenshot({ path: testInfo.outputPath(`session-ended-${viewport.width}-invitation.png`) });
            await inView(input); await expect(input).toHaveValue('Copy this unsent message before returning');
            expect(await input.evaluate(node => node.readOnly)).toBe(true);
            await input.press('ControlOrMeta+A');
            expect(await input.evaluate(node => node.selectionEnd - node.selectionStart)).toBe('Copy this unsent message before returning'.length);
            await page.screenshot({ path: testInfo.outputPath(`session-ended-${viewport.width}-draft.png`) });
            expect(fixture.admissions.get('ReflowGuest')).toBe(1);
        } finally { await page.context().close(); }
    });
}

async function closingFixture({ verifiedOwners = [] } = {}) {
    const { createLobby } = await import('../../hangout-worker/src/lobby-core.mjs');
    const sockets = new Map(), identities = new Map(), admissions = new Map(), inbound = []; let now = 1800000000000;
    const engine = createLobby({ now: () => now, limits: { defaultSlow: 0, pmMinLobbyMs: 0, roomPerDevice: 1 },
        send: (id, frame) => sockets.get(id)?.send(JSON.stringify(frame)), close: (id, code, reason) => sockets.get(id)?.close({ code, reason }) });
    const ownerNicks = new Set(verifiedOwners), rejected = new Set();
    return {
        ownerNicks,
        attach(page, nick) {
            return page.routeWebSocket(url => /\/lobby(?:-owner)?$/.test(url.pathname), socket => {
                admissions.set(nick, (admissions.get(nick) || 0) + 1);
                if (rejected.delete(nick)) {
                    // This case's /unavailable path is rejected by the actual
                    // loopback HTTP upgrade handler. No mock onopen/close event
                    // is delivered for the failed admission.
                    socket.connectToServer(); return;
                }
                const owner = new URL(socket.url()).pathname.endsWith('/lobby-owner') && ownerNicks.has(nick);
                const identity = { id: `journey-${nick}`, dev: `device-${nick}`, iph: `ip-${nick}`, role: 'fan', account: owner ? 'a_' + 'O'.repeat(43) : '', admin: false };
                sockets.set(identity.id, socket); identities.set(nick, identity);
                socket.onMessage(raw => { now += 5000; inbound.push({ nick, ...JSON.parse(String(raw)) }); void engine.message(identity.id, String(raw)); });
                socket.onClose(() => { sockets.delete(identity.id); void engine.disconnect(identity.id); });
                void engine.connect(identity);
            });
        },
        end(nick, code = 4401) { const identity = identities.get(nick); void engine.disconnect(identity.id); sockets.get(identity.id).close({ code, reason: code === 4401 ? 'sign in again' : 'fixture connection closed' }); },
        rejectNext: nick => rejected.add(nick),
        admissions, inbound
    };
}

test('the local preview can explicitly rejoin without sending an old private draft into the lobby', async ({ browser, baseURL }) => {
    const fixture = await closingFixture(); fixture.betaShell = false;
    const relay = hangoutRelayWsBase(baseURL, `guest-local-${randomUUID()}`), pages = [];
    try {
        const guest = await visitor(browser, baseURL, relay, 'ReturningGuest', 390, fixture); pages.push(guest);
        const peer = await visitor(browser, baseURL, relay, 'PrivatePeer', 390, fixture); pages.push(peer);
        await say(peer, '/msg ReturningGuest A private greeting');
        await guest.locator('[data-pmreqs]').getByRole('button', { name: 'Accept', exact: true }).click();
        await expect(guest.locator('[data-chat-context]')).toHaveText('PM · PrivatePeer');
        await guest.fill('[data-text]', 'An unsent private draft'); fixture.end('ReturningGuest');
        await expect(guest.getByRole('region', { name: 'Session ended' })).toBeVisible();
        await expect(guest.locator('[data-session-reentry]')).toBeHidden();
        await expect(guest.locator('[data-chat-context]')).toHaveText('PM · PrivatePeer');
        await expect(guest.locator('[data-text]')).toHaveValue('An unsent private draft');
        await guest.locator('[data-reconnect]').click();
        await expect(guest.locator('[data-connection]')).toHaveText('Connected');
        await expect(guest.locator('[data-session-ended]')).toBeHidden();
        await expect(guest.locator('[data-chat-context]')).toHaveText('#stalemate');
        await expect(guest.locator('[data-text]')).toHaveValue('');
        expect(fixture.admissions.get('ReturningGuest')).toBe(2);
        expect(fixture.inbound.some(frame => frame.text === 'An unsent private draft' || frame.args?.includes('An unsent private draft'))).toBe(false);
        expect(await peer.evaluate(() => document.body.textContent)).not.toContain('An unsent private draft');
    } finally { await Promise.all(pages.map(page => page.context().close())); }
});

for (const owner of [false, true]) {
    test(`a ${owner ? 'verified owner' : 'guest'} sees visible recovery after a refused reconnect upgrade`, async ({ browser, baseURL }) => {
        const nick = owner ? 'ReconnectingOwner' : 'ReconnectingGuest';
        const fixture = await closingFixture({ verifiedOwners: owner ? [nick] : [] });
        const relay = hangoutRelayWsBase(baseURL, `upgrade-refused-${randomUUID()}`) + '/unavailable';
        const page = await visitor(browser, baseURL, relay, nick, 390, fixture);
        try {
            await page.fill('[data-text]', 'Keep my unsent reconnect draft'); fixture.end(nick, 1000);
            await expect(page.locator('[data-connection]')).toHaveText('Offline');
            fixture.rejectNext(nick); await page.click('[data-reconnect]');
            const recovery = page.getByRole('region', { name: 'Session ended' });
            await expect(recovery).toBeVisible(); await expect(recovery).toContainText('Couldn’t reconnect');
            await expect(recovery).not.toContainText('revoked');
            await expect(recovery.getByRole('link', { name: 'Return to invitation' })).toHaveAttribute('href', '/beta/');
            await expect(page.locator('[data-text]')).toHaveValue('Keep my unsent reconnect draft');
            await expect(page.locator('[data-self-role]')).toHaveText('Session ended');
            await expect(page.locator('[data-reconnect]')).toBeHidden();
            await page.waitForTimeout(1400); expect(fixture.admissions.get(nick)).toBe(2);
        } finally { await page.context().close(); }
    });
}

for (const betaShell of [true, false]) {
    test(`a verified owner session ends visibly and ${betaShell ? 'returns through invitation admission' : 'rejoins locally as an unverified guest'}`, async ({ browser, baseURL }, testInfo) => {
        // The verified account is a named local identity fixture, not Access
        // verification. Actual register/room/invitation rules remain in use.
        const fixture = await closingFixture({ verifiedOwners: ['VerifiedOwner'] }); fixture.betaShell = betaShell;
        const relay = hangoutRelayWsBase(baseURL, `owner-ended-${randomUUID()}`), page = await visitor(browser, baseURL, relay, 'VerifiedOwner', 390, fixture);
        try {
            await expect(page.locator('[data-self-role]')).toHaveText('Room owner account');
            await page.click('.phonetabs [data-show="rooms"]'); await page.click('[data-start="jam"]');
            await page.fill('[data-jam-link]', INVITE); await page.locator('[data-jam-form] button[type=submit]').click();
            await page.click('.phonetabs [data-show="rooms"]'); await page.click('[data-start="art"]');
            await expect(page.locator('[data-act-canvas]')).toBeVisible();
            const registeredRoom = await page.locator('[data-chat-context]').textContent();
            await page.click('[data-roomtools]'); await page.getByRole('button', { name: 'Keep this room', exact: true }).click();
            await expect(page.locator('[data-host-status]')).toContainText('Registered');
            await page.click('[data-cam]'); await page.check('[data-adult]'); await page.click('[data-cam-yes]');
            await expect.poll(() => page.evaluate(() => capturedTracks.some(track => track.readyState === 'live'))).toBe(true);
            await page.fill('[data-text]', 'An unsent owner draft');
            await page.click('[data-roomtools]'); await page.getByRole('button', { name: 'Invite guest', exact: true }).click();
            await page.getByLabel('Guest nickname', { exact: true }).fill('SomeoneElse');
            fixture.end('VerifiedOwner');
            const recovery = page.getByRole('region', { name: 'Session ended' });
            await expect(recovery).toBeVisible(); await expect(recovery).toContainText('verified sign-in');
            await expect(page.locator('[data-connection]')).toHaveText('Session ended');
            await expect(page.locator('[data-self-role]')).toHaveText('Session ended');
            await expect(page.locator('[data-owner-signout]')).toBeHidden();
            await expect(page.locator('[data-room-filter] option[value=mine]')).toHaveJSProperty('disabled', true);
            await expect(page.locator('[data-invite-dialog]')).toBeHidden(); await expect(page.locator('[data-invite-nick]')).toHaveValue('');
            await expect(page.locator('[data-jam-link]')).toHaveValue(''); await expect(page.locator('[data-text]')).toHaveValue('An unsent owner draft');
            expect(await page.evaluate(() => ({ verified: __lobby.verified, band: __lobby.band, capabilities: __lobby.capabilities, channels: __lobby.chans.size, ownerHint: sessionStorage.getItem('hangout-owner') })))
                .toEqual({ verified: false, band: false, capabilities: {}, channels: 0, ownerHint: null });
            await expect.poll(() => page.evaluate(() => capturedTracks.every(track => track.readyState === 'ended'))).toBe(true);
            await page.waitForTimeout(1400); expect(fixture.admissions.get('VerifiedOwner')).toBe(1);
            await page.screenshot({ path: testInfo.outputPath(`owner-session-ended-${betaShell ? 'beta' : 'local'}-390.png`) });
            if (betaShell) {
                await expect(recovery).toContainText('verify your email again');
                const reentry = recovery.getByRole('link', { name: 'Return to invitation', exact: true });
                await expect(reentry).toHaveAttribute('href', '/beta/'); await reentry.click();
                await expect(page).toHaveURL(baseURL + '/beta/');
            } else {
                await page.click('[data-reconnect]'); await expect(page.locator('[data-connection]')).toHaveText('Connected');
                await expect(page.locator('[data-self-role]')).toHaveText('Guest access');
                await say(page, '/join ' + registeredRoom); await expect(page.locator('[data-chat-context]')).toHaveText(registeredRoom);
                await expect(page.locator('[data-roomtools]')).toBeHidden();
                await say(page, '/topic Cannot reclaim verified ownership');
                await expect(page.locator('[data-buffer]')).toContainText('only @');
                expect(fixture.inbound.some(frame => frame.text === 'An unsent owner draft')).toBe(false);
            }
        } finally { await page.context().close(); }
    });
}

test('a host losing room controls cannot submit an invitation from an already open dialog', async ({ browser, baseURL }) => {
    const fixture = await closingFixture(), relay = hangoutRelayWsBase(baseURL, `guest-invite-loss-${randomUUID()}`), pages = [];
    try {
        const host = await visitor(browser, baseURL, relay, 'FormerHost', 390, fixture); pages.push(host);
        const cohost = await visitor(browser, baseURL, relay, 'CurrentHost', 390, fixture); pages.push(cohost);
        const target = await visitor(browser, baseURL, relay, 'InviteTarget', 390, fixture); pages.push(target);
        await host.click('.phonetabs [data-show="rooms"]'); await host.click('[data-start="jam"]');
        await expect(host.locator('[data-chat-context]')).toHaveText(/^#jam-/);
        await host.click('[data-roomtools]'); await host.getByRole('button', { name: 'Invite guest', exact: true }).click();
        await host.getByLabel('Guest nickname', { exact: true }).fill('CurrentHost');
        await host.getByRole('button', { name: 'Send invitation', exact: true }).click();
        await cohost.locator('[data-toast]').getByRole('button', { name: 'Join', exact: true }).click();
        await expect(cohost.locator('[data-jam]')).toBeVisible();
        await say(host, '/op CurrentHost'); await expect(cohost.locator('[data-roomtools]')).toBeVisible();
        await host.click('[data-roomtools]'); await host.getByRole('button', { name: 'Invite guest', exact: true }).click();
        await host.getByLabel('Guest nickname', { exact: true }).fill('InviteTarget');
        await say(cohost, '/deop FormerHost');
        await expect(host.locator('[data-invite-dialog]')).toBeHidden();
        await expect(host.locator('[data-invite-nick]')).toHaveValue('');
        await expect(host.locator('[data-text]')).toBeFocused();
        // An adversarial script can dispatch form events even when its dialog
        // is hidden. The stale form must not emit a new invitation frame.
        const before = fixture.inbound.filter(frame => frame.nick === 'FormerHost' && frame.name === 'invite').length;
        await host.locator('[data-invite-nick]').evaluate(input => { input.value = 'InviteTarget'; });
        await host.locator('[data-invite-form]').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
        expect(fixture.inbound.filter(frame => frame.nick === 'FormerHost' && frame.name === 'invite')).toHaveLength(before);
        await expect(target.locator('[data-toast] button')).toHaveCount(0);
    } finally { await Promise.all(pages.map(page => page.context().close())); }
});

for (const width of [375, 390]) {
    test(`an ended guest session has visible invitation recovery and retires stale actions at ${width}px`, async ({ browser, baseURL }, testInfo) => {
        const fixture = await closingFixture(), relay = hangoutRelayWsBase(baseURL, `guest-ended-${randomUUID()}`), pages = [];
        try {
            const ended = await visitor(browser, baseURL, relay, 'EndingGuest', width, fixture); pages.push(ended);
            const peer = await visitor(browser, baseURL, relay, 'ContinuingPeer', width, fixture); pages.push(peer);
            const reader = await visitor(browser, baseURL, relay, 'ContinuingReader', width, fixture); pages.push(reader);
            await ended.click('.phonetabs [data-show="rooms"]'); await ended.click('[data-start="jam"]');
            await ended.fill('[data-jam-link]', INVITE); await ended.locator('[data-jam-form] button[type=submit]').click();
            await ended.click('.phonetabs [data-show="rooms"]'); await ended.click('[data-start="art"]');
            await ended.click('[data-cam]'); await ended.check('[data-adult]'); await ended.click('[data-cam-yes]');
            await expect.poll(() => ended.evaluate(() => capturedTracks.some(track => track.readyState === 'live'))).toBe(true);
            await say(peer, '/msg EndingGuest A private request awaiting a decision');
            await expect(ended.locator('[data-pmreqs]')).toContainText('ContinuingPeer');
            await channel(peer, 'guest-later'); await say(peer, '/invite EndingGuest');
            await expect(ended.locator('[data-toast]')).toContainText('invited you');
            await ended.fill('[data-text]', 'Unsent drawing idea — never move this into lobby chat');
            await ended.click('[data-roomtools]'); await expect(ended.locator('[data-palette]')).toBeVisible();
            fixture.end('EndingGuest');
            const recovery = ended.getByRole('region', { name: 'Session ended' });
            await expect(recovery).toBeVisible(); await expect(recovery).toContainText('unsent');
            await expect(ended.locator('[data-connection]')).toHaveText('Session ended');
            await expect(ended.locator('[data-reconnect]')).toBeHidden();
            await expect(ended.locator('[data-send]')).toBeDisabled();
            await expect(ended.locator('[data-text]')).toHaveValue('Unsent drawing idea — never move this into lobby chat');
            await expect(ended.locator('[data-pmreqs]')).toBeEmpty();
            await expect(ended.locator('[data-palette]')).toBeHidden();
            await expect(ended.locator('[data-toast] button')).toHaveCount(0);
            await expect(ended.locator('[data-jam-link]')).toHaveValue('');
            await expect(ended.locator('[data-jam-copy-value]')).toHaveValue('');
            expect(await ended.evaluate(() => JSON.stringify([...__lobby.chans.values()]))).not.toContain(INVITE);
            await expect.poll(() => ended.evaluate(() => capturedTracks.length > 0 && capturedTracks.every(track => track.readyState === 'ended'))).toBe(true);
            await say(peer, '/join #stalemate'); await say(peer, 'The other visitors can keep talking');
            await expect(reader.locator('[data-buffer]')).toContainText('The other visitors can keep talking');
            await ended.waitForTimeout(1400);
            expect(fixture.admissions.get('EndingGuest')).toBe(1);
            expect(await reader.evaluate(() => document.body.textContent)).not.toContain('Unsent drawing idea');
            await contained(ended, recovery); await contained(ended, ended.locator('[data-send]'));
            await ended.screenshot({ path: testInfo.outputPath(`session-ended-${width}.png`) });
            const reentry = recovery.getByRole('link', { name: 'Return to invitation', exact: true });
            await expect(reentry).toHaveAttribute('href', '/beta/'); await reentry.click();
            await expect(ended).toHaveURL(baseURL + '/beta/');
            await expect(ended.getByRole('heading', { name: 'Your private invitation' })).toBeVisible();
        } finally { await Promise.all(pages.map(page => page.context().close())); }
    });
}
