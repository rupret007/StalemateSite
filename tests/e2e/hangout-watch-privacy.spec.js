const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const ROOT = '/r/45662413410ed051/';
const KEY = 'local-preview-key-0001';
const VIDEO = 'BtnyqIHTDMM';
const FAKE_YT = path.join(__dirname, 'support/fake-youtube.js');
const contexts = new Set();
test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium covers player construction');
test.afterEach(async () => {
    await Promise.all([...contexts].map(context => context.close()));
    contexts.clear();
});

async function visitor(browser) {
    const context = await browser.newContext();
    contexts.add(context);
    await context.route(/youtube\.com|ytimg|googlevideo/, route => route.abort());
    await context.route('https://www.youtube.com/iframe_api', route => route.fulfill({ path: FAKE_YT, contentType: 'text/javascript' }));
    return context.newPage();
}

async function assertPrivatePlayerUrl(page, attribute, id) {
    await expect.poll(() => page.evaluate(() => window.__ytEmbeds?.length || 0)).toBe(1);
    // Return booleans only: failures must not print a room's invite fragment.
    const actual = await page.evaluate(({ attribute, id, video }) => {
        const entry = window.__ytEmbeds[0];
        const src = entry.src || '';
        const url = new URL(src || 'about:blank');
        const allowedKeys = new Set(['enablejsapi', 'origin', 'playsinline', 'rel', 'widget_referrer']);
        const params = url.searchParams;
        return {
            existingIframe: entry.tagName === 'IFRAME',
            safeSource: url.origin === 'https://www.youtube.com' && url.pathname === '/embed/' + video,
            onlyKnownParameters: [...params.keys()].every(key => allowedKeys.has(key)),
            jsApiEnabled: params.get('enablejsapi') === '1',
            originOnlyIdentity: params.get('origin') === location.origin && params.get('widget_referrer') === location.origin,
            noParentQueryOrFragment: Boolean(src) && !url.hash && !src.includes(location.search) && !src.includes(location.hash),
            scopedReferrer: entry.referrerPolicy === 'strict-origin-when-cross-origin',
            retainedIdentity: entry.id === id && Object.hasOwn(entry.attributes, attribute),
            playerPermissions: Boolean(entry.allow?.includes('autoplay')) && entry.allowFullscreen,
            pageStillPrivate: document.querySelector('meta[name="referrer"]').content === 'no-referrer'
        };
    }, { attribute, id, video: VIDEO });
    expect(actual).toEqual({
        existingIframe: true, safeSource: true, onlyKnownParameters: true,
        jsApiEnabled: true, originOnlyIdentity: true, noParentQueryOrFragment: true,
        scopedReferrer: true, retainedIdentity: true, playerPermissions: true, pageStillPrivate: true
    });
    await expect(page.locator('[data-fake-yt]')).toHaveAttribute('data-video-id', VIDEO);
    await expect(page.locator('[data-fake-yt]')).toHaveAttribute('data-state', 'playing');
}

test('private watch embeds omit the preview query and encrypted invitation without changing its URL', async ({ browser, baseURL }) => {
    const host = await visitor(browser);
    await host.goto(ROOT + '?preview=' + KEY + '&relay=' + encodeURIComponent(hangoutRelayWsBase(baseURL)));
    await host.fill('[data-name]', 'PrivateWatchHost');
    await host.click('[data-enter]');
    await expect(host.locator('[data-room]')).toBeVisible();
    const invite = host.url();
    const guest = await visitor(browser);
    await guest.goto(invite);
    await guest.fill('[data-name]', 'PrivateWatchGuest');
    await guest.click('[data-enter]');
    await expect(host.locator('[data-peers]')).toContainText('PrivateWatchGuest');
    await host.click('[data-pick-yt="' + VIDEO + '"]');
    for (const page of [host, guest]) await assertPrivatePlayerUrl(page, 'data-yt', 'yt-player');
    expect(host.url() === invite && guest.url() === invite).toBe(true);
});

test('guest-hosted watch embeds omit preview and unrelated query/fragment data', async ({ browser, baseURL }) => {
    const host = await visitor(browser);
    const relay = hangoutRelayWsBase(baseURL, 'watch-privacy-' + randomUUID());
    await host.goto(ROOT + 'lobby/?preview=' + KEY + '&relay=' + encodeURIComponent(relay) + '&canary=private-watch-query#private-watch-fragment');
    await host.fill('[data-nick]', 'LobbyWatchHost');
    await host.click('[data-enter]');
    await expect(host.locator('[data-app]')).toBeVisible();
    // Keep explicit harmless canaries in the live URL even if lobby startup
    // strips its preview parameter. The real API must never receive either.
    await host.evaluate(() => history.replaceState(null, '', location.pathname + '?canary=private-watch-query#private-watch-fragment'));
    await host.click('[data-start="watch"]');
    await host.fill('[data-act-url]', 'https://youtu.be/' + VIDEO);
    await host.press('[data-act-url]', 'Enter');
    await assertPrivatePlayerUrl(host, 'data-act-yt', 'lobby-yt-player');
    expect(await host.evaluate(() => location.search === '?canary=private-watch-query' && location.hash === '#private-watch-fragment')).toBe(true);
});
