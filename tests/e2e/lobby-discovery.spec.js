// Real guest conversations on the local relay; no fabricated production activity.
const { test, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

test.skip(({ browserName }) => browserName !== 'chromium', 'Desktop and phone layouts use Chromium here.');
// A mocked external challenge callback connects to a loopback test relay. Chromium's
// local-network provenance check otherwise blocks that fixture; production CSP stays enforced.
test.use({ launchOptions: { args: ['--disable-features=LocalNetworkAccessChecks'] } });
const ROOT = '/r/45662413410ed051/lobby/';
const KEY = 'local-preview-key-0001';
let origin;
let relayNamespace;
test.beforeEach(async ({ baseURL }) => { origin = baseURL; relayNamespace = `discovery-${randomUUID()}`; });
const url = () => `${ROOT}?preview=${KEY}&relay=${encodeURIComponent(hangoutRelayWsBase(origin, relayNamespace))}`;

async function guest(browser, nick, viewport) {
    const context = await browser.newContext(viewport ? { viewport, isMobile: true, hasTouch: true } : {});
    const page = await context.newPage();
    await page.goto(url());
    await page.fill('[data-nick]', nick);
    await page.click('[data-enter]');
    await expect(page.locator('[data-app]')).toBeVisible();
    await expect(page.locator('[data-connection]')).toHaveText('Connected');
    return page;
}
const lobbyTab = (page) => page.locator('[data-tabs] [data-channel-key="#stalemate"]');

test('guests host named chat channels with live-only history and can hand off room controls', async ({ browser }) => {
    const host = await guest(browser, 'NightHost');
    let visitor;
    try {
        await host.fill('[data-text]', 'This lobby message predates the next visitor');
        await host.press('[data-text]', 'Enter');
        await expect(host.locator('[data-buffer]')).toContainText('predates the next visitor');
        visitor = await guest(browser, 'NightGuest');
        await expect(visitor.locator('[data-buffer]')).not.toContainText('predates the next visitor');

        await host.click('[data-start="chat"]');
        await host.fill('[data-channel-name]', '#art-night-owls');
        await host.locator('[data-channel-form] button[type="submit"]').click();
        await expect(host.locator('[data-channel-error]')).toContainText('starts an activity room');
        await host.fill('[data-channel-name]', '#night-owls');
        await host.locator('[data-channel-form] button[type="submit"]').click();
        await expect(host.locator('[data-chat-context]')).toHaveText('#night-owls');
        await expect(host.locator('[data-nicks]')).toContainText('@NightHost');
        await expect(host.locator('[data-roomtools]')).toBeVisible();
        await host.click('[data-roomtools]');
        await expect(host.locator('[data-palette-buttons]')).not.toContainText('Cams allowed');
        await host.click('[data-palette-close]');
        await expect(host.locator('[data-activity]')).toBeHidden();
        await expect(host.locator('[data-cam]')).toBeHidden();
        await host.fill('[data-text]', 'This room message was sent before you joined');
        await host.press('[data-text]', 'Enter');
        await expect(host.locator('[data-buffer]')).toContainText('before you joined');

        await visitor.locator('[data-roomlist] [data-room="#night-owls"]').click();
        await expect(visitor.locator('[data-chat-context]')).toHaveText('#night-owls');
        await expect(visitor.locator('[data-buffer]')).not.toContainText('before you joined');
        await expect(visitor.locator('[data-roomtools]')).toBeHidden();
        await host.fill('[data-text]', 'This message arrives while we are both here');
        await host.press('[data-text]', 'Enter');
        await expect(visitor.locator('[data-buffer]')).toContainText('while we are both here');
        await lobbyTab(visitor).click();
        await visitor.locator('[data-tabs] [data-channel-key="#night-owls"]').click();
        await expect(visitor.locator('[data-buffer]')).toContainText('while we are both here');

        await visitor.click('[data-leave]');
        await expect(visitor.locator('[data-chat-context]')).toHaveText('#stalemate');
        await host.fill('[data-text]', 'This message arrives while you are away');
        await host.press('[data-text]', 'Enter');
        await expect(host.locator('[data-buffer]')).toContainText('while you are away');
        await visitor.locator('[data-roomlist] [data-room="#night-owls"]').click();
        await expect(visitor.locator('[data-chat-context]')).toHaveText('#night-owls');
        await expect(visitor.locator('[data-buffer]')).not.toContainText('while we are both here');
        await expect(visitor.locator('[data-buffer]')).not.toContainText('while you are away');

        await host.fill('[data-text]', '/op NightGuest');
        await host.press('[data-text]', 'Enter');
        await expect(visitor.locator('[data-roomtools]')).toBeVisible();
        await host.click('[data-leave]');
        await expect(visitor.locator('[data-host-status]')).toContainText('You have @ host controls');
        await visitor.fill('[data-text]', '/topic A hangout for night owls');
        await visitor.press('[data-text]', 'Enter');
        await expect(visitor.locator('[data-topic]')).toHaveText('A hangout for night owls');

        // A refreshed client receives current topic/membership, but no previous conversation.
        await visitor.reload();
        await visitor.click('[data-enter]');
        await expect(visitor.locator('[data-connection]')).toHaveText('Connected');
        await visitor.locator('[data-roomlist] [data-room="#night-owls"]').click();
        await expect(visitor.locator('[data-topic]')).toHaveText('A hangout for night owls');
        await expect(visitor.locator('[data-roomtools]')).toBeVisible();
        await expect(visitor.locator('[data-buffer]')).not.toContainText('while you are away');
        await expect(visitor.locator('[data-buffer]')).not.toContainText('sets mode +o');
    } finally { await host.context().close(); if (visitor) await visitor.context().close(); }
});

test('IRC conversation leads into an existing room; drafts and mentions survive channel switches', async ({ browser }) => {
    const host = await guest(browser, 'DoodleHost');
    const visitor = await guest(browser, 'RiffGuest');
    try {
        await expect(visitor.locator('[data-presence-title]')).toContainText('other visitor');
        await expect(visitor.locator('[data-quiet-prompt]')).toBeHidden();
        await expect(visitor.locator('[data-creation]')).toBeHidden();
        await expect(visitor.locator('[data-gathering-activity]')).toContainText('No confirmed gathering was supplied');
        await visitor.click('[data-prompt="Hey everyone, I’m new here. "]');
        await expect(visitor.locator('[data-text]')).toHaveValue('Hey everyone, I’m new here. ');
        await expect(host.locator('[data-buffer]')).not.toContainText('Hey everyone, I’m new here.');
        await host.click('[data-start="art"]');
        await expect(host.locator('[data-act-canvas]')).toBeVisible();
        const roomName = await host.evaluate(() => window.__lobby.active);
        const card = visitor.locator('[data-roomlist] button').filter({ hasText: roomName });
        await expect(card).toContainText('1/8 here');
        await expect(card).toContainText('Join room');
        await card.click();
        await expect(visitor.locator('[data-act-canvas]')).toBeVisible();
        await expect(visitor.locator('[data-text]')).toHaveValue('');
        await visitor.fill('[data-text]', 'A drawing idea I haven’t sent yet');
        await lobbyTab(visitor).click();
        await expect(visitor.locator('[data-text]')).toHaveValue('Hey everyone, I’m new here. ');
        await expect(visitor.locator('[data-lobby-welcome]')).toBeVisible();
        await lobbyTab(visitor).focus();
        await host.fill('[data-text]', 'RiffGuest, let’s draw a tiny monster');
        await host.press('[data-text]', 'Enter');
        const roomTab = visitor.locator('[data-tabs] button').filter({ hasText: roomName });
        await expect(roomTab).toContainText('@you');
        await expect(lobbyTab(visitor)).toBeFocused();
        await expect(visitor).toHaveTitle(/^\(1\)/);
        await roomTab.click();
        await expect(visitor.locator('[data-text]')).toHaveValue('A drawing idea I haven’t sent yet');
        await expect(visitor.locator('[data-buffer] .mention')).toContainText('tiny monster');
        await expect(visitor).toHaveTitle('#stalemate · Hang Out');
        await expect(visitor.locator('[data-cam]')).toHaveAttribute('aria-pressed', 'false');
        await expect(visitor.locator('[data-lobby-welcome]')).toBeHidden();
    } finally { await host.context().close(); await visitor.context().close(); }
});

test('offline sends keep the draft; reconnect clears stale membership and preserves PM preference', async ({ browser }) => {
    const page = await guest(browser, 'ReturnGuest');
    try {
        await page.check('[data-pm-off]');
        await expect(page.locator('[data-toast]')).toContainText('off');
        await page.click('[data-start="art"]');
        await expect(page.locator('[data-act-canvas]')).toBeVisible();
        const oldRoom = await page.evaluate(() => window.__lobby.active);
        await page.fill('[data-text]', 'This idea must not disappear');
        await page.evaluate(() => window.__lobby.ws.close(1000));
        await expect(page.locator('[data-connection]')).toHaveText('Offline');
        await expect(page.locator('[data-presence-title]')).toHaveText('The lobby is offline');
        await expect(page.locator('[data-lobby-count]')).toHaveText('Main conversation');
        await expect(page.locator('[data-presence-detail]')).toContainText('not an empty room');
        await expect(page.locator('[data-presence-title]')).not.toContainText('quiet');
        await expect(page.locator('[data-gathering]')).toBeHidden();
        await expect(page.locator('[data-quiet-prompt]')).toBeHidden();
        await expect(page.locator('[data-welcome-title]')).toHaveText('Hang Out is not connected.');
        await expect(page.locator('[data-send]')).toBeDisabled();
        await page.locator('[data-say]').evaluate((form) => form.requestSubmit());
        await expect(page.locator('[data-text]')).toHaveValue('This idea must not disappear');
        await page.click('[data-reconnect]');
        await expect(page.locator('[data-connection]')).toHaveText('Connected');
        await expect(page.locator('[data-nicks]')).toContainText('ReturnGuest');
        await expect(page.locator('[data-lobby-count]')).toHaveText('1 here · chat');
        await expect(page.locator('[data-tabs] button')).toHaveCount(1);
        await expect(page.locator('[data-pm-off]')).toBeChecked();
        await expect(page.locator('[data-toast]')).toContainText('off');
        const room = page.locator('[data-roomlist] button').filter({ hasText: oldRoom });
        await expect(room).toContainText('No one here yet');
        await room.click();
        await expect(page.locator('[data-text]')).toHaveValue('This idea must not disappear');
        await expect(page.locator('[data-cam]')).toHaveAttribute('aria-pressed', 'false');
    } finally { await page.context().close(); }
});

test('a quiet visit shows no invented gathering and drafts a prompt without sending', async ({ browser }) => {
    const page = await guest(browser, 'QuietGuest');
    try {
        await expect(page.locator('[data-presence-title]')).toHaveText('It is quiet in #stalemate');
        await expect(page.locator('[data-lobby-count]')).toHaveText('1 here · chat');
        await expect(page.locator('[data-welcome-title]')).toHaveText('First one here? Make yourself at home.');
        await expect(page.locator('[data-presence-detail]')).toContainText('No confirmed gathering was supplied');
        await expect(page.locator('[data-presence-detail]')).not.toContainText('band is here');
        await expect(page.locator('[data-gathering-activity]')).toContainText('does not invent a time');
        await expect(page.locator('[data-gathering-save]')).toBeHidden();
        await expect(page.locator('[data-creation-detail]')).toContainText('No approved past creation was supplied');
        await expect(page.locator('[data-quiet-prompt]')).toBeVisible();
        await page.click('[data-quiet-prompt]');
        await expect(page.locator('[data-text]')).toHaveValue('One line is enough, and no gear is needed: what should we make together? ');
        await expect(page.locator('[data-buffer]')).not.toContainText('no gear is needed');
    } finally { await page.context().close(); }
});

test('phone chat, room discovery and composer fit without horizontal scrolling', async ({ browser }) => {
    const page = await guest(browser, 'PocketGuest', { width: 375, height: 667 });
    try {
        await expect(page.locator('[data-text]')).toBeInViewport();
        await expect(page.locator('[data-send]')).toBeInViewport();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
        await page.click('[data-show="rooms"]');
        await expect(page.locator('[data-lobby-home]')).toBeVisible();
        await expect(page.locator('[data-start="art"]')).toBeVisible();
        await page.click('[data-lobby-home]');
        await expect(page.locator('[data-text]')).toBeInViewport();
        await page.click('[data-prompt="What’s everyone making or working on? "]');
        await expect(page.locator('[data-text]')).toHaveValue('What’s everyone making or working on? ');
    } finally { await page.context().close(); }
});

test('phone room creation keeps the name and shows a server rejection inside the dialog', async ({ browser }) => {
    const page = await guest(browser, 'PhoneHost', { width: 375, height: 667 });
    try {
        await page.click('[data-show="rooms"]');
        await page.click('[data-start="chat"]');
        await page.fill('[data-channel-name]', '#first-chat');
        await page.locator('[data-channel-form] button[type="submit"]').click();
        await expect(page.locator('[data-chat-context]')).toHaveText('#first-chat');
        await expect(page.locator('[data-channel-dialog]')).toBeHidden();
        await page.click('[data-show="rooms"]');
        await page.click('[data-start="chat"]');
        await page.fill('[data-channel-name]', '#another-chat');
        await page.locator('[data-channel-form] button[type="submit"]').click();
        await expect(page.locator('[data-channel-dialog]')).toBeVisible();
        await expect(page.locator('[data-channel-error]')).toContainText('One new room per 10 minutes');
        await expect(page.locator('[data-channel-name]')).toHaveValue('#another-chat');
        await expect(page.locator('[data-channel-error]')).toBeInViewport();
        await expect(page.locator('[data-channel-cancel]')).toBeInViewport();
        await page.click('[data-channel-cancel]');
        await expect(page.locator('[data-start="chat"]')).toBeFocused();
        await page.click('[data-start="chat"]');
        await page.fill('[data-channel-name]', '#first-chat');
        await page.locator('[data-channel-form] button[type="submit"]').click();
        await expect(page.locator('[data-channel-dialog]')).toBeHidden();
        await expect(page.locator('[data-chat-context]')).toHaveText('#first-chat');
        await expect(page.locator('[data-text]')).toBeInViewport();
    } finally { await page.context().close(); }
});

test('a fresh guest challenge is used on every socket admission and can be shown on reconnect', async ({ page }) => {
    const tokens = [];
    page.on('websocket', (ws) => tokens.push(new URL(ws.url()).searchParams.get('ts')));
    await page.route(`**${ROOT}*`, async (route) => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()).replace('name="hangout-turnstile" content=""', 'name="hangout-turnstile" content="test-site-key"') });
    });
    await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js*', (route) => route.fulfill({
        contentType: 'application/javascript',
        body: `let cb, n=0; window.turnstile={render(el,opts){cb=opts.callback;setTimeout(()=>cb('test-'+(++n)),30);return 1}, reset(){setTimeout(()=>cb('test-'+(++n)),100)}};window.__tsReady();`
    }));
    await page.goto(url());
    await page.fill('[data-nick]', 'ChallengeGuest');
    await page.click('[data-enter]');
    await expect(page.locator('[data-connection]')).toHaveText('Connected');
    await page.evaluate(() => window.__lobby.ws.close(1000));
    await expect(page.locator('[data-connection]')).toHaveText('Offline');
    await page.click('[data-reconnect]');
    await expect(page.locator('[data-guest-check]')).toBeVisible();
    await expect(page.locator('[data-connection]')).toHaveText('Connected');
    expect(tokens).toEqual(['test-1', 'test-2']);
    await expect(page.locator('[data-guest-check]')).toBeHidden();
});

test('a stalled guest-check script recovers to a retryable entry state', async ({ page }) => {
    await page.route(`**${ROOT}*`, async (route) => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()).replace('name="hangout-turnstile" content=""', 'name="hangout-turnstile" content="test-site-key"') });
    });
    // The API loads but its onload callback never arrives: exercise the bounded load wait.
    await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js*', (route) => route.fulfill({ contentType: 'application/javascript', body: '/* deliberately no callback */' }));
    await page.goto(url());
    await page.clock.install();
    await page.fill('[data-nick]', 'PatientGuest');
    await page.click('[data-enter]');
    await page.clock.fastForward(21000);
    await expect(page.locator('[data-connection]')).toHaveText('Offline');
    await expect(page.locator('[data-enter]')).toBeEnabled();
    await expect(page.locator('[data-gate-status]')).toContainText('couldn’t finish');
});

test('reading older chat stays put until the guest chooses to jump to new messages', async ({ browser }) => {
    const writer = await guest(browser, 'StoryWriter');
    const reader = await guest(browser, 'StoryReader', { width: 375, height: 667 });
    try {
        const paragraphs = [
            'The first drawing could be a crooked little house with a rooftop garden. A tiny bird keeps stealing all the seeds. We could each add one unexpected detail, a window, a plant, a strange door or a hand painted sign. Nobody needs to be good at drawing; a wobbly line can become part of the story.',
            'The second drawing could take that same bird out for a nighttime adventure. It visits an empty train station and meets a friendly moth. One person could draw the sky while someone else works on the station. I would love to try telling a little story together without planning every part first.',
            'For the last scene, the bird finally returns the missing seeds. There is a new tree next to the little house and a bench where the moth can rest. Someone could write a short caption or invent a name for the garden. We can leave a bit of blank canvas for the next person who wants to join in.'
        ];
        for (const text of paragraphs) {
            await writer.fill('[data-text]', text);
            await writer.press('[data-text]', 'Enter');
            await expect(reader.locator('[data-buffer]')).toContainText(text);
            await writer.waitForTimeout(3100); // Respect the unchanged three-second server slow mode.
        }
        const buffer = reader.locator('[data-buffer]');
        await buffer.evaluate((el) => { el.scrollTop = 0; });
        await writer.fill('[data-text]', 'Who wants to add a name for our little garden?');
        await writer.press('[data-text]', 'Enter');
        await expect(reader.locator('[data-new-messages]')).toBeVisible();
        expect(await buffer.evaluate((el) => el.scrollTop)).toBe(0);
        await reader.click('[data-new-messages]');
        await expect(reader.locator('[data-new-messages]')).toBeHidden();
        expect(await buffer.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(3);
    } finally { await writer.context().close(); await reader.context().close(); }
});
