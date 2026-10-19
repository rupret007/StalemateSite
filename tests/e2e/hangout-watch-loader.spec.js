// Controlled provider faults use offline fixtures, not real provider acceptance.
const path = require('node:path');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const ROOT = '/r/45662413410ed051/';
const KEY = 'local-preview-key-0001';
const VIDEO = 'BtnyqIHTDMM';
const OTHER = 'Dws9G6UFyUQ';
const API = 'https://www.youtube.com/iframe_api';
const FAKE_YT = path.join(__dirname, 'support/fake-youtube.js');
const FAKE_SOURCE = fs.readFileSync(FAKE_YT, 'utf8');
const LOADER_FAULT_SOURCE = fs.readFileSync(path.join(__dirname, 'support/fake-youtube-loader.js'), 'utf8');
const contexts = new Set();
const releases = new Set();
test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium covers controlled loader failures');
test.describe.configure({ retries: 0 });
test.afterEach(async () => {
    for (const release of releases) release();
    releases.clear();
    await Promise.all([...contexts].map(context => context.close()));
    contexts.clear();
});

async function visitor(browser, baseURL, scriptHandler, loaderFailure) {
    const context = await browser.newContext({ baseURL, serviceWorkers: 'block' });
    contexts.add(context);
    if (loaderFailure) await context.addInitScript(mode => { window.__ytLoaderFailure = mode; }, loaderFailure);
    // Every nonlocal request is blocked. Only the explicit API fixture below
    // is fulfilled; no YouTube/player/media request reaches a real provider.
    await context.route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL).origin
        ? route.continue() : route.abort());
    let attempts = 0;
    await context.route(API, async route => {
        attempts += 1;
        if (scriptHandler) await scriptHandler(route, attempts);
        else await route.fulfill({ path: FAKE_YT, contentType: 'text/javascript' });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.name));
    return { page, errors, attempts: () => attempts };
}

async function pair(browser, baseURL, surface, scriptHandler, loaderFailure, guestScriptHandler) {
    const host = await visitor(browser, baseURL, scriptHandler, loaderFailure);
    const guest = await visitor(browser, baseURL, guestScriptHandler);
    const relay = hangoutRelayWsBase(baseURL, 'watch-loader-' + randomUUID());
    if (surface === 'private') {
        await host.page.goto(ROOT + '?preview=' + KEY + '&relay=' + encodeURIComponent(relay));
        await host.page.fill('[data-name]', 'LoaderHost');
        await host.page.click('[data-enter]');
        await expect(host.page.locator('[data-room]')).toBeVisible();
        await guest.page.goto(host.page.url());
        await guest.page.fill('[data-name]', 'LoaderGuest');
        await guest.page.click('[data-enter]');
        await expect(host.page.locator('[data-peers]')).toContainText('LoaderGuest');
    } else {
        for (const [person, nick] of [[host, 'LoaderHost'], [guest, 'LoaderGuest']]) {
            await person.page.goto(ROOT + 'lobby/?preview=' + KEY + '&relay=' + encodeURIComponent(relay));
            await person.page.fill('[data-nick]', nick);
            await person.page.click('[data-enter]');
            await expect(person.page.locator('[data-app]')).toBeVisible();
            await person.page.fill('[data-text]', '/join #watch-loader');
            await person.page.press('[data-text]', 'Enter');
            await expect.poll(() => person.page.evaluate(() => window.__lobby.active)).toBe('#watch-loader');
        }
        await expect.poll(() => host.page.evaluate(() => window.__lobby.chans.get('#watch-loader').names.length)).toBe(2);
        expect(await host.page.evaluate(() => window.__lobby.role === 'fan' && !window.__lobby.band)).toBe(true);
    }
    const tap = surface === 'private' ? '[data-tap]' : '[data-act-tap]';
    const status = surface === 'private' ? '[data-video-status]' : '[data-act-video-status]';
    const shared = page => page.evaluate(surface => {
        const video = surface === 'private' ? window.__hangout.state.video : window.__lobbyRoom.state.room.video;
        return video && { source: video.source, playing: video.playing };
    }, surface);
    const load = async id => {
        if (surface === 'private') await host.page.click('[data-pick-yt="' + id + '"]');
        else {
            await host.page.fill('[data-act-url]', id);
            await host.page.press('[data-act-url]', 'Enter');
        }
    };
    return { host, guest, surface, tap, status, shared, load };
}

function heldApi() {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    releases.add(release);
    return {
        release,
        handler: async route => {
            await gate;
            await route.fulfill({ body: FAKE_SOURCE + '\nsetTimeout(() => { window.__loaderApiDelivered = true; }, 0);', contentType: 'text/javascript' });
        }
    };
}

async function releaseApi(control, page) {
    control.release();
    await expect.poll(() => page.evaluate(() => Boolean(window.__loaderApiDelivered))).toBe(true);
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
}

async function expectPlaying(room, id) {
    for (const person of [room.host, room.guest]) {
        await expect(person.page.locator('[data-fake-yt]')).toHaveAttribute('data-video-id', id);
        await expect(person.page.locator('[data-fake-yt]')).toHaveAttribute('data-state', 'playing');
        expect((await room.shared(person.page))?.source).toEqual({ kind: 'yt', id });
    }
}

for (const surface of ['private', 'channel']) {
    test(surface + ' script network error gives local feedback and deliberate retry succeeds without reload', async ({ browser, baseURL }) => {
        const room = await pair(browser, baseURL, surface, (route, attempt) => attempt === 1
            ? route.abort('failed') : route.fulfill({ path: FAKE_YT, contentType: 'text/javascript' }));
        const navigations = [];
        room.host.page.on('framenavigated', frame => { if (frame === room.host.page.mainFrame()) navigations.push(true); });
        await room.load(VIDEO);
        await expect.poll(room.host.attempts).toBe(1);
        await expect(room.host.page.locator(room.status)).toBeVisible();
        await expect(room.host.page.locator(room.status)).toContainText('YouTube couldn’t load');
        await expect(room.host.page.locator(room.tap)).toBeVisible();
        await expect(room.host.page.locator(room.tap)).toHaveText('Retry video');
        await room.host.page.click(room.tap);
        await expect.poll(room.host.attempts).toBe(2);
        await expectPlaying(room, VIDEO);
        await expect(room.host.page.locator(room.tap)).toBeHidden();
        await expect(room.host.page.locator(room.status)).not.toContainText('YouTube couldn’t load');
        expect(navigations).toEqual([]);
        expect(room.host.errors).toEqual([]);
        expect(room.guest.errors).toEqual([]);
    });

    if (surface === 'channel') test(surface + ' a delayed earlier API load cannot replace the newer shared YouTube selection', async ({ browser, baseURL }) => {
        const control = heldApi();
        const room = await pair(browser, baseURL, surface, control.handler);
        await room.load(VIDEO);
        await expect.poll(room.host.attempts).toBe(1);
        await room.load(OTHER);
        // Explicit host intent reaches the other visitor even while the host
        // waits on its provider; late completion must use this newest intent.
        await expect.poll(async () => (await room.shared(room.guest.page))?.source.id).toBe(OTHER);
        await releaseApi(control, room.host.page);
        await expectPlaying(room, OTHER);
        expect(await room.host.page.evaluate(() => window.__ytEmbeds.map(entry => new URL(entry.src).pathname))).toEqual(['/embed/' + OTHER]);
        expect(room.host.attempts()).toBe(1);
        expect(room.host.errors).toEqual([]);
        expect(room.guest.errors).toEqual([]);
    });
}

test('private an older signature completing after the newer selection cannot publish over it', async ({ browser, baseURL }) => {
    const room = await pair(browser, baseURL, 'private');
    await room.host.page.evaluate(oldId => {
        const original = crypto.subtle.sign.bind(crypto.subtle);
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        const control = window.__loaderSigning = { held: false, intercepted: false, release, pending: null };
        crypto.subtle.sign = function (...args) {
            const signed = original(...args);
            let body;
            try { body = JSON.parse(new TextDecoder().decode(args[2])); } catch (_) { return signed; }
            if (control.intercepted || body.kind !== 'video' || body.source?.id !== oldId) return signed;
            control.intercepted = true;
            control.pending = signed.then(async signature => {
                control.held = true;
                await gate;
                return signature;
            });
            return control.pending;
        };
    }, VIDEO);
    try {
        await room.load(VIDEO);
        await expect.poll(() => room.host.page.evaluate(() => window.__loaderSigning.held)).toBe(true);
        await room.load(OTHER);
        await expectPlaying(room, OTHER);
        // The host await is registered before this fence, so releasing the old
        // native signature and crossing the next task also executes its async
        // publication continuation. Checking before release would miss the race.
        await room.host.page.evaluate(async () => {
            const control = window.__loaderSigning;
            control.release();
            await control.pending;
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        await expectPlaying(room, OTHER);
        expect(await room.host.page.evaluate(() => window.__ytEmbeds.map(entry => new URL(entry.src).pathname))).toEqual(['/embed/' + OTHER]);
        expect(room.host.errors).toEqual([]);
        expect(room.guest.errors).toEqual([]);
    } finally {
        await room.host.page.evaluate(() => window.__loaderSigning?.release()).catch(() => {});
    }
});

test('private a late YouTube API completion cannot replace a newer paused site video', async ({ browser, baseURL }) => {
    const control = heldApi();
    const room = await pair(browser, baseURL, 'private', control.handler);
    await room.load(VIDEO);
    await expect.poll(room.host.attempts).toBe(1);
    await room.host.page.click('[data-pick-file="manic"]');
    await expect.poll(async () => (await room.shared(room.guest.page))?.source.kind).toBe('file');
    await room.host.page.locator('[data-file]').evaluate(video => video.pause());
    await expect.poll(async () => (await room.shared(room.guest.page))?.playing).toBe(false);
    await releaseApi(control, room.host.page);
    // Cross the genuine 2s host reconciliation interval after delivery. An
    // immediate check could run before the obsolete async publication finishes.
    await room.host.page.waitForTimeout(2300);
    for (const person of [room.host, room.guest]) {
        expect(await room.shared(person.page)).toEqual({ source: { kind: 'file', id: 'manic' }, playing: false });
        await expect(person.page.locator('[data-file]')).toBeVisible();
        expect(await person.page.locator('[data-file]').evaluate(video => video.paused)).toBe(true);
    }
    expect(await room.host.page.evaluate(() => window.__ytLog.length)).toBe(0);
    expect(room.host.errors).toEqual([]);
    expect(room.guest.errors).toEqual([]);
});

test('channel a late API load cannot revive an activity after leaving and the current room can be rejoined', async ({ browser, baseURL }) => {
    const control = heldApi();
    const room = await pair(browser, baseURL, 'channel', control.handler);
    await room.load(VIDEO);
    await expect.poll(room.host.attempts).toBe(1);
    await room.load(OTHER);
    await expect.poll(async () => (await room.shared(room.guest.page))?.source.id).toBe(OTHER);
    await room.host.page.fill('[data-text]', '/part #watch-loader');
    await room.host.page.press('[data-text]', 'Enter');
    await expect.poll(() => room.host.page.evaluate(() => window.__lobbyRoom.state.ch)).toBe(null);
    await releaseApi(control, room.host.page);
    expect(await room.host.page.evaluate(() => window.__ytLog.length)).toBe(0);
    expect(await room.host.page.locator(room.tap).evaluate(node => node.hidden)).toBe(true);
    expect(await room.host.page.locator(room.status).textContent()).toBe('');
    await room.host.page.fill('[data-text]', '/join #watch-loader');
    await room.host.page.press('[data-text]', 'Enter');
    await expectPlaying(room, OTHER);
    expect(room.host.attempts()).toBe(1);
    expect(room.host.errors).toEqual([]);
    expect(room.guest.errors).toEqual([]);
});

for (const [surface, mode] of [['private', 'never-ready'], ['channel', 'provider-error']]) {
    test(surface + ' ' + mode + ' failure gives local feedback and a fresh player retries without reload', async ({ browser, baseURL }) => {
        const room = await pair(browser, baseURL, surface,
            route => route.fulfill({ body: FAKE_SOURCE + '\n' + LOADER_FAULT_SOURCE, contentType: 'text/javascript' }), mode);
        await room.load(VIDEO);
        await expect.poll(() => room.host.page.evaluate(() => window.__ytLoaderFixture?.constructed || 0)).toBe(1);
        // Real default readiness deadline, no application test hook or fake clock.
        await expect(room.host.page.locator(room.status)).toContainText('YouTube couldn’t load', { timeout: 18000 });
        await expect(room.host.page.locator(room.tap)).toHaveText('Retry video');
        await room.host.page.click(room.tap);
        await expectPlaying(room, VIDEO);
        expect(await room.host.page.evaluate(() => window.__ytLoaderFixture.constructed)).toBe(2);
        expect(room.host.attempts()).toBe(1); // API already loaded; only the failed player is recreated.
        await expect(room.host.page.locator(room.tap)).toBeHidden();
        expect(room.host.errors).toEqual([]);
        expect(room.guest.errors).toEqual([]);
    });
}

test('private Bob controls use current shared intent while the replacement player is not ready', async ({ browser, baseURL }) => {
    const room = await pair(browser, baseURL, 'private',
        route => route.fulfill({ body: FAKE_SOURCE + '\n' + LOADER_FAULT_SOURCE, contentType: 'text/javascript' }), 'hold-second-ready');
    await room.host.page.click('[data-bob-toggle]');
    await room.load(VIDEO);
    await expectPlaying(room, VIDEO);
    await room.load(OTHER);
    await expect.poll(() => room.host.page.evaluate(() => window.__ytLoaderFixture.readyHeld)).toBe(true);
    await expect(room.host.page.locator(room.status)).toContainText('Loading YouTube');
    await expect.poll(async () => (await room.shared(room.guest.page))?.source.id).toBe(OTHER);
    await expect(room.host.page.locator('[data-bob-hold]')).toBeVisible();
    await room.host.page.click('[data-bob-hold]');
    await expect.poll(async () => (await room.shared(room.guest.page))?.playing).toBe(false);
    const pausedPosition = await room.host.page.evaluate(() => window.__hangout.state.video.pos);
    expect(pausedPosition).toBeGreaterThanOrEqual(0);
    expect(pausedPosition).toBeLessThan(5);
    await room.host.page.click('[data-bob-rewind]');
    await expect.poll(() => room.guest.page.evaluate(() => window.__hangout.state.video.pos)).toBe(0);
    for (const person of [room.host, room.guest]) {
        expect(await room.shared(person.page)).toEqual({ source: { kind: 'yt', id: OTHER }, playing: false });
    }
    expect(await room.host.page.evaluate(() => window.__ytLoaderFixture.retiredCalls)).toEqual([]);
    await room.host.page.evaluate(() => window.__ytLoaderFixture.releaseReady());
    await expect.poll(() => room.host.page.evaluate(() => window.__ytLoaderFixture.readyDelivered)).toBe(true);
    // A rendered but unready fixture is already paused. Wait for the real
    // frontend's successful-readiness feedback to clear before final checks.
    await expect(room.host.page.locator(room.status)).toHaveText('');
    for (const person of [room.host, room.guest]) {
        await expect(person.page.locator('[data-fake-yt]')).toHaveAttribute('data-video-id', OTHER);
        await expect(person.page.locator('[data-fake-yt]')).toHaveAttribute('data-state', 'paused');
        expect(await room.shared(person.page)).toEqual({ source: { kind: 'yt', id: OTHER }, playing: false });
        expect(await person.page.evaluate(() => window.__hangout.state.video.pos)).toBe(0);
    }
    expect(await room.host.page.evaluate(() => window.__ytLoaderFixture.retiredCalls)).toEqual([]);
    expect(room.host.errors).toEqual([]);
    expect(room.guest.errors).toEqual([]);
});

test('private guest Bob Catchup keeps failed retry visible and Retry stays local to that guest', async ({ browser, baseURL }) => {
    const room = await pair(browser, baseURL, 'private', undefined, undefined,
        (route, attempt) => attempt < 3 ? route.abort('failed') : route.fulfill({ path: FAKE_YT, contentType: 'text/javascript' }));
    await room.load(VIDEO);
    await expect(room.host.page.locator('[data-fake-yt]')).toHaveAttribute('data-state', 'playing');
    await expect(room.guest.page.locator(room.status)).toContainText('YouTube couldn’t load');
    await expect(room.guest.page.locator(room.tap)).toHaveText('Retry video');
    expect(await room.guest.page.evaluate(() => window.__hangout.isHost)).toBe(false);
    const hostSequence = await room.host.page.evaluate(() => window.__hangout.lastHostSeq);
    await room.guest.page.click('[data-bob-toggle]');
    await expect(room.guest.page.locator('[data-bob-catchup]')).toBeVisible();
    await room.guest.page.click('[data-bob-catchup]');
    await expect.poll(room.guest.attempts).toBe(2);
    await expect(room.guest.page.locator(room.status)).toContainText('YouTube couldn’t load');
    await expect(room.guest.page.locator(room.tap)).toBeVisible();
    await expect(room.guest.page.locator(room.tap)).toHaveText('Retry video');
    await expect(room.guest.page.locator('[data-status]')).not.toContainText('Caught up with the host.');
    await room.guest.page.click(room.tap);
    await expect.poll(room.guest.attempts).toBe(3);
    await expectPlaying(room, VIDEO);
    await expect(room.guest.page.locator(room.tap)).toBeHidden();
    await expect(room.guest.page.locator(room.status)).toHaveText('');
    expect(await room.host.page.evaluate(() => window.__hangout.lastHostSeq)).toBe(hostSequence);
    for (const person of [room.host, room.guest]) expect((await room.shared(person.page)).playing).toBe(true);
    expect(room.host.errors).toEqual([]);
    expect(room.guest.errors).toEqual([]);
});
