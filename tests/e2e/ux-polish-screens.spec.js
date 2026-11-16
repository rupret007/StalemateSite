// Paint Along, Webex-style: big shared stage, camera filmstrip, chat panel/drawer and a
// labeled bottom control bar, at phone (390x844) and desktop (1440x900) sizes, with two
// people on fake media. Also covers the single camera+mic consent step (preview, denial,
// retry, join without camera, rejoin) and that Music never touches the mic.
// Screenshots: test-results/ux-screens/{phone-stage,phone-join-consent,phone-chat-drawer,desktop-webex,desktop-join-consent}.png
const path = require('node:path');
const fs = require('node:fs/promises');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const SLUG = '45662413410ed051';
const KEY = 'local-preview-key-0001';
const FAKE_YT = path.join(__dirname, 'support/fake-youtube.js');
const EPISODE = 'uj5FE70BcB0';
const SHOTS = path.resolve('test-results/ux-screens');
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };
const roomUrl = (origin) => `/r/${SLUG}/?preview=${KEY}&relay=${encodeURIComponent(hangoutRelayWsBase(origin))}`;

test.skip(({ browserName }) => browserName !== 'chromium', 'Fake media two-person layout coverage runs in Chromium');
test.use({ permissions: ['camera', 'microphone'], launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--disable-features=WebRtcHideLocalIpsWithMdns'] } });

const contexts = new Set();
test.afterEach(async () => { await Promise.all([...contexts].map((c) => c.close())); contexts.clear(); });

async function openPage(browser, viewport) {
    const context = await browser.newContext({ permissions: ['camera', 'microphone'], viewport });
    contexts.add(context);
    await context.route(/youtube\.com|ytimg|googlevideo/, (route) => route.abort());
    await context.route('https://www.youtube.com/iframe_api', (route) => route.fulfill({ path: FAKE_YT, contentType: 'text/javascript' }));
    const page = await context.newPage();
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(e.message));
    return page;
}

async function enter(page, url, name) {
    await page.goto(url);
    await page.fill('[data-name]', name);
    await page.click('[data-enter]');
    await expect(page.locator('[data-room]')).toBeVisible();
}

async function pickEpisode(page) {
    const details = page.locator('[data-bob] details.episodes');
    if (!(await details.evaluate((d) => d.open))) await details.locator('summary').click();
    await page.click(`[data-bob-ep="${EPISODE}"]`);
    // Picking scrolled the episode list into view; put the stage back at the top for the layout checks.
    await page.evaluate(() => {
        if (window.innerWidth <= 820) document.querySelector('[data-bob] details.episodes').open = false;
        document.querySelector('.watch').scrollTop = 0;
    });
}

async function joinWithCamera(page, shot) {
    const card = page.locator('[data-consent]');
    await expect(card).toBeVisible();
    await expect(page.locator('[data-consent-on]')).toContainText('Turn on camera');
    await expect(page.locator('[data-consent-skip]')).toHaveText('Join without camera');
    // Consent-gated: nothing is captured before the tap.
    expect(await page.evaluate(() => Boolean(window.__hangout.av.stream && window.__hangout.av.stream.getTracks().length))).toBe(false);
    await page.click('[data-consent-on]');
    await expect(card).toHaveAttribute('data-state', 'preview');
    await expect.poll(() => page.evaluate(() => document.querySelector('[data-consent-video]').videoWidth), { timeout: 10000 }).toBeGreaterThan(0);
    await expect(page.locator('[data-consent-on]')).toHaveText('Join with camera');
    await expect(page.locator('[data-consent-mic]')).toBeChecked();
    // Previewing does not publish anything to the room yet.
    expect(await page.evaluate(() => window.__hangout.av.cam || window.__hangout.av.mic)).toBe(false);
    if (shot) await page.screenshot({ path: shot });
    await page.click('[data-consent-on]');
    // One step turned on both camera and mic: no second explainer, no second dialog.
    await expect(page.locator('[data-cam]')).toHaveText('Stop video');
    await expect(page.locator('[data-mic]')).toHaveText('Mute mic');
    await expect(page.locator('[data-ask]')).toBeHidden();
    await expect(card).toBeHidden();
}

async function expectPlayingStage(page) {
    const stage = page.locator('.watch .screen');
    await expect(stage).toBeVisible();
    await expect(stage.locator('[data-fake-yt]')).toHaveAttribute('data-state', 'playing');
}

const remoteWidth = (page) => page.evaluate(() => [...document.querySelectorAll('[data-tiles] .tile:not([data-tile="me"]) video')]
    .map((v) => v.videoWidth).find((w) => w > 0) || 0);

async function boxes(page, selectors) {
    return page.evaluate((list) => list.map((selector) => {
        const el = document.querySelector(selector);
        const r = el && el.getBoundingClientRect();
        const shown = el && r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
        return { selector, box: shown ? { x: r.x, y: r.y, width: r.width, height: r.height } : null };
    }), selectors);
}
const overlap = (a, b) => a.x < b.x + b.width - 0.5 && a.x + a.width > b.x + 0.5 && a.y < b.y + b.height - 0.5 && a.y + a.height > b.y + 0.5;

async function expectNoOverlap(page, viewport, { chat }) {
    const found = await boxes(page, ['.watch .screen', '[data-tiles]', '.chat', '.callbar']);
    const byName = Object.fromEntries(found.map((f) => [f.selector, f.box]));
    expect(byName['.watch .screen'], 'stage visible').toBeTruthy();
    expect(byName['[data-tiles]'], 'camera tiles visible').toBeTruthy();
    expect(byName['.callbar'], 'control bar visible').toBeTruthy();
    if (chat) expect(byName['.chat'], 'chat visible').toBeTruthy();
    else expect(byName['.chat'], 'chat drawer closed').toBeNull();
    const shown = found.filter((f) => f.box);
    for (const f of shown) {
        expect(f.box.x, `${f.selector} left edge`).toBeGreaterThanOrEqual(-0.5);
        expect(f.box.x + f.box.width, `${f.selector} right edge`).toBeLessThanOrEqual(viewport.width + 0.5);
        expect(f.box.y + f.box.height, `${f.selector} bottom edge`).toBeLessThanOrEqual(viewport.height + 0.5);
    }
    for (let i = 0; i < shown.length; i += 1) for (let j = i + 1; j < shown.length; j += 1) {
        expect(overlap(shown[i].box, shown[j].box), `${shown[i].selector} overlaps ${shown[j].selector}`).toBe(false);
    }
    // Nothing is painted on top of the stage, and the page never scrolls sideways.
    const onStage = await page.evaluate(() => {
        const r = document.querySelector('.watch .screen').getBoundingClientRect();
        const pts = [[0.5, 0.5], [0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]];
        return pts.every(([fx, fy]) => {
            const el = document.elementFromPoint(r.x + r.width * fx, r.y + r.height * fy);
            return Boolean(el && el.closest('.screen'));
        });
    });
    expect(onStage, 'stage is unobstructed').toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    return byName;
}

async function expectBigLabeledControls(page) {
    const controls = page.locator('.callbar .callbar-main > :visible');
    expect(await controls.count()).toBeGreaterThanOrEqual(5);
    for (const control of await controls.all()) {
        const box = await control.boundingBox();
        const label = (await control.innerText()).trim();
        expect(box.height, `${label} height`).toBeGreaterThanOrEqual(58);
        expect(box.width, `${label} width`).toBeGreaterThanOrEqual(48);
        expect(label.length, 'visible text label').toBeGreaterThan(1);
    }
    for (const button of await page.locator('.callbar button:visible').all()) {
        expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(48);
        expect((await button.innerText()).trim()).not.toBe('');
    }
    for (const text of ['Stop video', 'Mute mic', 'Chat', 'Leave']) await expect(page.locator('.callbar .callbar-main').getByText(text, { exact: true })).toBeVisible();
    await expect(page.locator('[data-soundtrack]')).toContainText('Music');
    // Green = on (camera and mic are on now).
    const bg = (sel) => page.locator(sel).evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(await bg('[data-cam]')).toBe('rgb(31, 122, 69)');
    expect(await bg('[data-mic]')).toBe('rgb(31, 122, 69)');
}

async function paintAlongPair(browser, origin, viewport, prefix) {
    const host = await openPage(browser, viewport);
    await enter(host, roomUrl(origin), 'Host');
    const invite = host.url();
    await host.click('[data-bob-toggle]');
    await expect(host.locator('body')).toHaveClass(/bob-mode/);
    await expect(host.locator('[data-ask]')).toBeHidden(); // no camera prompt pops up on its own
    await pickEpisode(host);
    await expect(host.locator('[data-fake-yt]')).toHaveAttribute('data-video-id', EPISODE);

    const guest = await openPage(browser, viewport);
    await enter(guest, invite, 'Guest');
    await expect(host.locator('[data-peers]')).toContainText('2 here');
    // The shared episode brings the guest into Paint Along, still without any capture prompt.
    await expect(guest.locator('body')).toHaveClass(/bob-mode/);
    await expect(guest.locator('[data-ask]')).toBeHidden();

    await joinWithCamera(host, path.join(SHOTS, `${prefix}-join-consent.png`));
    await joinWithCamera(guest);
    await expect.poll(() => remoteWidth(host), { timeout: 20000 }).toBeGreaterThan(0);
    await expect.poll(() => remoteWidth(guest), { timeout: 20000 }).toBeGreaterThan(0);
    for (const page of [host, guest]) {
        await expect(page.locator('[data-tiles] .tile')).toHaveCount(2);
        await expect(page.locator('[data-tiles] .tile[data-tile="me"]')).toBeVisible();
        await expect(page.locator('[data-tiles] .tile:not([data-tile="me"])')).toBeVisible();
    }
    // Remote face is bigger than the self view.
    const area = async (sel) => { const b = await host.locator(sel).boundingBox(); return b.width * b.height; };
    expect(await area('[data-tiles] .tile:not([data-tile="me"])')).toBeGreaterThan(await area('[data-tiles] .tile[data-tile="me"]'));
    // The stage is the largest surface.
    expect(await area('.watch .screen')).toBeGreaterThan(await area('[data-tiles] .tile:not([data-tile="me"])'));
    return { host, guest };
}

test('Paint Along phone 390x844: stage on top, faces row, chat drawer, pinned labeled bar', async ({ browser, baseURL }) => {
    test.setTimeout(120000);
    await fs.mkdir(SHOTS, { recursive: true });
    const { host, guest } = await paintAlongPair(browser, baseURL, PHONE, 'phone');
    const stage = await host.locator('.watch .screen').boundingBox();
    await expectPlayingStage(host);
    expect(stage.width).toBeGreaterThanOrEqual(PHONE.width - 12);
    expect(Math.abs(stage.width / stage.height - 16 / 9)).toBeLessThan(0.05);
    const closed = await expectNoOverlap(host, PHONE, { chat: false });
    expect(closed['.watch .screen'].y + closed['.watch .screen'].height).toBeLessThanOrEqual(closed['[data-tiles]'].y);
    expect(closed['[data-tiles]'].y + closed['[data-tiles]'].height).toBeLessThanOrEqual(closed['.callbar'].y);
    await expectBigLabeledControls(host);
    await host.screenshot({ path: path.join(SHOTS, 'phone-stage.png') });

    // Chat drawer opens between the faces and the bar; it never covers the stage.
    await expect(guest.locator('.chat')).toBeHidden(); // phones start with the drawer closed
    await guest.click('[data-chat-toggle]');
    await guest.fill('[data-text]', 'Happy little trees');
    await guest.press('[data-text]', 'Enter');
    await expect(host.locator('[data-chat-toggle]')).toHaveText(/^Chat \(\d+ new\)$/);
    await host.click('[data-chat-toggle]');
    await expect(host.locator('[data-chat-toggle]')).toHaveAttribute('aria-expanded', 'true');
    await expect(host.locator('[data-log]')).toContainText('Happy little trees');
    const open = await expectNoOverlap(host, PHONE, { chat: true });
    expect(open['.chat'].y).toBeGreaterThanOrEqual(open['[data-tiles]'].y + open['[data-tiles]'].height);
    expect(open['.chat'].y + open['.chat'].height).toBeLessThanOrEqual(open['.callbar'].y);
    await host.screenshot({ path: path.join(SHOTS, 'phone-chat-drawer.png') });
    await host.click('[data-chat-toggle]');
    await expect(host.locator('.chat')).toBeHidden();

    // Music is the shared video's sound only: muting it leaves the conversation alone.
    await host.click('[data-soundtrack]');
    await expect(host.locator('[data-soundtrack-pop]')).toBeVisible();
    await host.click('[data-soundtrack-mute]');
    await expect(host.locator('[data-soundtrack]')).toContainText('Music muted');
    await expect(host.locator('[data-mic]')).toHaveText('Mute mic');
    expect(await host.evaluate(() => window.__hangout.av.mic && window.__hangout.av.stream.getAudioTracks().some((t) => t.enabled && t.readyState === 'live'))).toBe(true);
    await host.keyboard.press('Escape');
    await expect(host.locator('[data-soundtrack-pop]')).toBeHidden();

    // Red = off, and the self tile offers a big Start video prompt.
    await host.click('[data-cam]');
    await expect(host.locator('[data-cam]')).toHaveText('Start video');
    expect(await host.locator('[data-cam]').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(179, 38, 30)');
    await expect(host.locator('[data-tile="me"] .tile-start-video')).toBeVisible();
    expect((await host.locator('[data-tile="me"] .tile-start-video').boundingBox()).height).toBeGreaterThanOrEqual(48);
    await host.click('[data-tile="me"] .tile-start-video');
    await expect(host.locator('[data-cam]')).toHaveText('Stop video');
    expect(host.errors).toEqual([]);
    expect(guest.errors).toEqual([]);
});

test('Paint Along desktop 1440x900: Webex layout with stage, filmstrip, chat panel and control bar', async ({ browser, baseURL }) => {
    test.setTimeout(120000);
    await fs.mkdir(SHOTS, { recursive: true });
    const { host, guest } = await paintAlongPair(browser, baseURL, DESKTOP, 'desktop');
    await expectPlayingStage(host);
    const b = await expectNoOverlap(host, DESKTOP, { chat: true });
    const stage = b['.watch .screen'];
    // The stage takes most of the screen: left of the side panel, at least 60% of the width.
    expect(stage.width).toBeGreaterThanOrEqual(DESKTOP.width * 0.6);
    expect(stage.x + stage.width).toBeLessThanOrEqual(b['[data-tiles]'].x);
    expect(stage.x + stage.width).toBeLessThanOrEqual(b['.chat'].x);
    expect(b['[data-tiles]'].y + b['[data-tiles]'].height).toBeLessThanOrEqual(b['.chat'].y);
    await expectBigLabeledControls(host);
    await host.screenshot({ path: path.join(SHOTS, 'desktop-webex.png') });

    // Chat toggles the side panel; the stage and faces stay put.
    await host.click('[data-chat-toggle]');
    await expect(host.locator('.chat')).toBeHidden();
    await expectNoOverlap(host, DESKTOP, { chat: false });
    await host.click('[data-chat-toggle]');
    await expect(host.locator('.chat')).toBeVisible();

    // More holds the extra tools without covering the stage.
    await host.click('[data-more]');
    await expect(host.locator('[data-canvas-cam]')).toBeVisible();
    await expect(host.locator('[data-settings]')).toBeVisible();
    await host.click('[data-more]');
    await expect(host.locator('[data-canvas-cam]')).toBeHidden();

    // The room owner can pause the same shared player.
    await host.click('[data-bob-hold]');
    await expect(host.locator('[data-fake-yt]')).toHaveAttribute('data-state', 'paused');
    expect(host.errors).toEqual([]);
    expect(guest.errors).toEqual([]);
});

test('Paint Along consent: denial shows how to retry, retry works, join without camera, rejoin asks again', async ({ browser, baseURL }) => {
    test.setTimeout(90000);
    const page = await openPage(browser, PHONE);
    // Simulate a blocked camera/mic until the person fixes it in the browser.
    await page.addInitScript(() => {
        window.__denyMedia = true;
        const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = (c) => window.__denyMedia
            ? Promise.reject(new DOMException('Permission denied', 'NotAllowedError')) : real(c);
    });
    await enter(page, roomUrl(baseURL), 'Solo');
    const invite = page.url();
    await page.click('[data-bob-toggle]');
    await expect(page.locator('[data-consent]')).toBeVisible();
    await page.click('[data-consent-on]');
    await expect(page.locator('[data-consent]')).toHaveAttribute('data-state', 'denied');
    await expect(page.locator('[data-consent-error]')).toContainText('allow Camera and Microphone');
    await expect(page.locator('[data-consent-on]')).toHaveText('Try again');
    expect(await page.evaluate(() => window.__hangout.av.cam || window.__hangout.av.mic)).toBe(false);

    await page.evaluate(() => { window.__denyMedia = false; });
    await page.click('[data-consent-on]');
    await expect(page.locator('[data-consent]')).toHaveAttribute('data-state', 'preview');
    // Changing their mind: Join without camera stops the preview and captures nothing.
    await page.click('[data-consent-skip]');
    await expect(page.locator('[data-consent]')).toBeHidden();
    expect(await page.evaluate(() => [...document.querySelectorAll('video')].some((v) => v.srcObject && v.srcObject.getTracks().some((t) => t.readyState === 'live')))).toBe(false);
    await expect(page.locator('[data-tile="me"] .tile-start-video')).toBeVisible();
    // The self-tile prompt brings the same single consent step back.
    await page.click('[data-tile="me"] .tile-start-video');
    await expect(page.locator('[data-consent]')).toBeVisible();
    await expect(page.locator('[data-consent-on]')).toBeFocused();

    // Leave and rejoin: the room never turns the camera back on by itself.
    await page.click('.callbar .leave-room');
    await expect(page).toHaveURL(/\/lobby\//);
    page.errors = []; // only the room page matters here, not the lobby we passed through
    await page.goto(invite);
    await page.click('[data-enter]');
    await expect(page.locator('[data-room]')).toBeVisible();
    await page.click('[data-bob-toggle]');
    await expect(page.locator('[data-consent]')).toBeVisible();
    expect(await page.evaluate(() => window.__hangout.av.cam || window.__hangout.av.mic)).toBe(false);
    expect(page.errors).toEqual([]);
});
