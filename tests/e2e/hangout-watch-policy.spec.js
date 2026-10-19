// Policy-event fixtures, not real-provider or physical-device acceptance.
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const ROOT = '/r/45662413410ed051/';
const KEY = 'local-preview-key-0001';
const VIDEO = 'BtnyqIHTDMM';
const FAKE_YT = path.join(__dirname, 'support/fake-youtube.js');
const contexts = new Set();
test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium covers policy-event recovery');
test.afterEach(async () => {
    await Promise.all([...contexts].map(context => context.close()));
    contexts.clear();
});

async function visitor(browser, blocked) {
    const context = await browser.newContext();
    contexts.add(context);
    await context.addInitScript(({ blocked }) => {
        window.__ytAutoplayControl = { blocked, deferPlaying: false, playCalls: 0, blockedEvents: 0, players: [] };
        window.__autoplayTrustedTap = false;
        document.addEventListener('click', event => {
            if (event.target.closest('[data-tap], [data-act-tap]')) window.__autoplayTrustedTap = event.isTrusted;
        }, true);
    }, { blocked });
    await context.route(/youtube\.com|ytimg|googlevideo/, route => route.abort());
    await context.route('https://www.youtube.com/iframe_api', route => route.fulfill({ path: FAKE_YT, contentType: 'text/javascript' }));
    const page = await context.newPage();
    let videoPublications = 0;
    page.on('websocket', socket => socket.on('framesent', ({ payload }) => {
        try {
            const frame = JSON.parse(String(payload));
            if (frame.t === 'act' && frame.kind === 'video') videoPublications += 1;
        } catch (_) { /* Encrypted/private and non-JSON frames are handled separately. */ }
    }));
    return { page, publications: async () => videoPublications + await page.evaluate(() => window.__autoplayHostPublications || 0) };
}

async function pair(browser, baseURL, surface, blocked = 'guest') {
    const host = await visitor(browser, blocked === 'host');
    const guest = await visitor(browser, blocked === 'guest');
    const relay = hangoutRelayWsBase(baseURL, 'watch-autoplay-' + randomUUID());
    if (surface === 'private') {
        await host.page.goto(ROOT + '?preview=' + KEY + '&relay=' + encodeURIComponent(relay));
        await host.page.fill('[data-name]', 'AutoplayHost');
        await host.page.click('[data-enter]');
        await expect(host.page.locator('[data-room]')).toBeVisible();
        await guest.page.goto(host.page.url());
        await guest.page.fill('[data-name]', 'AutoplayGuest');
        await guest.page.click('[data-enter]');
        await expect(host.page.locator('[data-peers]')).toContainText('AutoplayGuest');
        await guest.page.evaluate(() => {
            const seal = window.HangoutCore.seal;
            window.__autoplayHostPublications = 0;
            window.HangoutCore.seal = function (key, message) {
                if (message.type === 'host' && message.body?.kind === 'video') window.__autoplayHostPublications += 1;
                return seal.call(this, key, message);
            };
        });
    } else {
        for (const [visitor, nick] of [[host, 'AutoplayHost'], [guest, 'AutoplayGuest']]) {
            await visitor.page.goto(ROOT + 'lobby/?preview=' + KEY + '&relay=' + encodeURIComponent(relay));
            await visitor.page.fill('[data-nick]', nick);
            await visitor.page.click('[data-enter]');
            await expect(visitor.page.locator('[data-app]')).toBeVisible();
        }
        // A normal guest founder receives @ through the actual local relay.
        for (const visitor of [host, guest]) {
            await visitor.page.fill('[data-text]', '/join #watch-autoplay');
            await visitor.page.press('[data-text]', 'Enter');
            await expect.poll(() => visitor.page.evaluate(() => window.__lobby.active)).toBe('#watch-autoplay');
        }
        await expect.poll(() => host.page.evaluate(() => window.__lobby.chans.get('#watch-autoplay').names.length)).toBe(2);
        expect(await guest.page.evaluate(() => window.__lobby.chans.get('#watch-autoplay').names.find(n => n.nick === window.__lobby.me).prefix)).toBe('');
    }
    const tap = surface === 'private' ? '[data-tap]' : '[data-act-tap]';
    const shared = page => page.evaluate(surface => {
        const video = surface === 'private' ? window.__hangout.state.video : window.__lobbyRoom.state.room.video;
        return video && { source: video.source, playing: video.playing, pos: video.pos };
    }, surface);
    const load = async () => {
        if (surface === 'private') await host.page.click('[data-pick-yt="' + VIDEO + '"]');
        else {
            await host.page.fill('[data-act-url]', 'https://youtu.be/' + VIDEO);
            await host.page.press('[data-act-url]', 'Enter');
        }
        await expect.poll(() => guest.page.evaluate(() => window.__ytLog?.length || 0)).toBe(1);
        await expect.poll(async () => (await shared(guest.page))?.source.id).toBe(VIDEO);
    };
    return { host, guest, tap, shared, load };
}

async function expectBlocked(page, tap) {
    await expect.poll(() => page.evaluate(() => window.__ytAutoplayControl.blockedEvents)).toBeGreaterThan(0);
    // This UI assertion is the old-code negative: void playVideo() has no catch.
    await expect(page.locator(tap)).toBeVisible();
    expect(await page.evaluate(() => window.__ytLog[0].getPlayerState())).not.toBe(1);
}

async function deliverStaleBlocked(page) {
    await page.evaluate(() => {
        window.__ytAutoplayControl.players[0].emitAutoplayBlocked();
        return new Promise(resolve => requestAnimationFrame(() => resolve()));
    });
}

for (const surface of ['private', 'channel']) {
    test(surface + ' guest retries void YouTube play with a trusted tap and waits for actual playback', async ({ browser, baseURL }) => {
        const room = await pair(browser, baseURL, surface);
        await room.load();
        await expectBlocked(room.guest.page, room.tap);
        const publications = await room.guest.publications();
        const playCalls = await room.guest.page.evaluate(() => {
            const policy = window.__ytAutoplayControl;
            policy.blocked = false; policy.deferPlaying = true;
            return policy.playCalls;
        });
        await room.guest.page.click(room.tap);
        await expect.poll(() => room.guest.page.evaluate(() => window.__ytAutoplayControl.playCalls)).toBeGreaterThan(playCalls);
        expect(await room.guest.page.evaluate(() => window.__autoplayTrustedTap)).toBe(true);
        expect(await room.guest.page.evaluate(() => window.__ytLog[0].getPlayerState())).not.toBe(1);
        await expect(room.guest.page.locator(room.tap)).toBeVisible();
        await room.guest.page.evaluate(() => window.__ytAutoplayControl.players[0].finishPlayback());
        await expect(room.guest.page.locator('[data-fake-yt]')).toHaveAttribute('data-state', 'playing');
        await expect(room.guest.page.locator(room.tap)).toBeHidden();
        // A delayed denial from the earlier attempt must not re-latch the
        // prompt or suspend synchronization after playback has recovered.
        await deliverStaleBlocked(room.guest.page);
        expect(await room.guest.page.locator(room.tap).evaluate(node => node.hidden)).toBe(true);
        expect(await room.guest.publications()).toBe(publications);
        expect((await room.shared(room.host.page)).playing).toBe(true);
        expect((await room.shared(room.guest.page)).playing).toBe(true);
    });

    test(surface + ' blocked host keeps shared playback requested across automatic synchronization', async ({ browser, baseURL }) => {
        const room = await pair(browser, baseURL, surface, 'host');
        await room.load();
        await expectBlocked(room.host.page, room.tap);
        const calls = await room.host.page.evaluate(() => window.__ytAutoplayControl.playCalls);
        // Cross both the 900ms applying window and the real 2s host interval.
        // No clock override: the relay timestamps and client timer stay genuine.
        await room.host.page.waitForTimeout(2300);
        expect((await room.shared(room.host.page)).playing).toBe(true);
        expect((await room.shared(room.guest.page)).playing).toBe(true);
        expect(await room.host.page.evaluate(() => window.__ytAutoplayControl.playCalls)).toBe(calls);
        await expect(room.host.page.locator(room.tap)).toBeVisible();
    });

    test(surface + ' delayed autoplay policy callbacks cannot revive prompts after shared pause or teardown', async ({ browser, baseURL }) => {
        const room = await pair(browser, baseURL, surface);
        await room.load();
        await expectBlocked(room.guest.page, room.tap);
        await room.host.page.evaluate(() => window.__ytLog[0].pauseVideo());
        await expect.poll(async () => (await room.shared(room.guest.page))?.playing).toBe(false);
        expect(await room.guest.page.locator(room.tap).evaluate(node => node.hidden)).toBe(true);
        await deliverStaleBlocked(room.guest.page);
        expect(await room.guest.page.locator(room.tap).evaluate(node => node.hidden)).toBe(true);
        if (surface === 'private') {
            await room.guest.page.evaluate(() => window.__hangout.ws.close(4401, 'Synthetic session expiry'));
            await expect.poll(() => room.guest.page.evaluate(() => window.__hangout.ended)).toBe(true);
        } else {
            await room.guest.page.fill('[data-text]', '/part #watch-autoplay');
            await room.guest.page.press('[data-text]', 'Enter');
            await expect.poll(() => room.guest.page.evaluate(() => window.__lobbyRoom.state.ch)).toBe(null);
        }
        await deliverStaleBlocked(room.guest.page);
        // Check hidden itself: a closed room's ancestor must not mask revival.
        expect(await room.guest.page.locator(room.tap).evaluate(node => node.hidden)).toBe(true);
    });
}

test('private delayed YouTube policy callback cannot revive its prompt after a paused file source', async ({ browser, baseURL }) => {
    const room = await pair(browser, baseURL, 'private');
    await room.load();
    await expectBlocked(room.guest.page, room.tap);
    // Send a genuine host-signed paused-file action. Keeping it paused isolates
    // the stale YouTube event from the independent native-file autoplay policy.
    await room.host.page.evaluate(async () => {
        const app = window.__hangout;
        const body = { kind: 'video', seq: Math.max(Date.now(), app.lastHostSeq + 1),
            source: { kind: 'file', id: 'manic' }, playing: false, pos: 0, t: app.clock.relayNow() };
        const bytes = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, app.hostPriv,
            new TextEncoder().encode(JSON.stringify(body))));
        const signature = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        await window.__hangoutSend({ type: 'host', body, sig: signature });
    });
    await expect.poll(async () => (await room.shared(room.guest.page))?.source.kind).toBe('file');
    await expect(room.guest.page.locator('[data-file]')).toBeVisible();
    expect(await room.guest.page.locator(room.tap).evaluate(node => node.hidden)).toBe(true);
    await deliverStaleBlocked(room.guest.page);
    expect(await room.guest.page.locator(room.tap).evaluate(node => node.hidden)).toBe(true);
});
