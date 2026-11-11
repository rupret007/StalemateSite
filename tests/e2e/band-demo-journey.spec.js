// Stalemate entry → lobby chat → jam room → browser Web Join (mocked transport).
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const ROOT = '/r/45662413410ed051/lobby/';
const MOCK_SESSION = `export function waitFor() { return Promise.resolve(); }
export class WebJoinSession {
  constructor({ onStatus = () => {}, onTrack = () => {}, stream, audioContext }) {
    Object.assign(this, { onStatus, onTrack, stream, audioContext });
  }
  async join() {
    this.onStatus('Checking the host invitation…');
    this.onStatus('Connecting directly, with free relay fallback…');
    if (this.stream) this.stream.getAudioTracks().forEach((track) => { track.enabled = true; });
    const ctx = this.audioContext || new AudioContext();
    const remote = ctx.createMediaStreamDestination().stream;
    this.onTrack(remote);
    this.onStatus('Connected — Web Join, higher delay (about 60–120 ms).');
  }
  close() {}
  fail() {}
}`;

function webInviteHash() {
    const capability = Buffer.alloc(32, 17).toString('base64url');
    const session = '22'.repeat(32);
    const expires = Math.floor(Date.now() / 1000) + 300;
    return { capability, session, expires, href: `https://webjam.example/join/#k=${capability}&s=${session}&g=1&e=${expires}` };
}

async function stalemateEntrySite(href) {
    const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
        res.end(`<!doctype html><html lang="en"><title>Stalemate</title><h1>Stalemate</h1><a href="${href.replace(/&/g, '&amp;')}">Hang Out</a></html>`);
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    return { url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((resolve) => { server.closeIdleConnections(); server.close(resolve); }) };
}

async function lobbyContext(browser, baseURL, { trackClicks = false, webJoinFixtures = false } = {}) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    let clicks = 0;
    if (trackClicks) {
        await context.exposeBinding('__qaBandmateClick', () => { clicks += 1; });
        await context.addInitScript(() => {
            document.addEventListener('click', (event) => {
                if (event.isTrusted) void window.__qaBandmateClick().catch(() => {});
            }, true);
        });
    }
    await context.route(/youtube\.com|ytimg|googlevideo|goatcounter/, (route) => route.abort());
    if (webJoinFixtures) {
        await context.route('https://webjam.example/**', async (route) => {
            const target = new URL(route.request().url());
            const response = await route.fetch({ url: `${baseURL}${target.pathname}${target.search}${target.hash}` });
            await route.fulfill({ response });
        });
        await context.route('**/join/session.js', (route) => route.fulfill({ contentType: 'text/javascript', body: MOCK_SESSION }));
        await context.addInitScript(() => {
            Object.defineProperty(Object.getPrototypeOf(navigator.mediaDevices), 'getUserMedia', {
                configurable: true,
                value: async () => {
                    const audioContext = new AudioContext();
                    const stream = audioContext.createMediaStreamDestination().stream;
                    for (const track of stream.getTracks()) {
                        const stop = track.stop.bind(track);
                        track.stop = () => { stop(); audioContext.close().catch(() => {}); };
                    }
                    return stream;
                }
            });
        });
    }
    const page = await context.newPage();
    return { page, context, clicks: () => clicks };
}

// The isolated guest context provides its own synthetic MediaStream.
// Chromium-only launch switches prevent Linux WebKit from starting.

test('Stalemate entry through jam room to connected browser Web Join with few bandmate clicks', async ({ browser, baseURL }, testInfo) => {
    const { communityIntegration, communityJoinLink } = await import('../../hangout-worker/src/community-integration.mjs');
    const integration = communityIntegration({ version: 1, communityAddress: `${baseURL}/r/45662413410ed051/lobby/`, sites: [
        { id: 'stalemate', label: 'Stalemate', origins: ['https://stalemate.band'], returnUrl: 'https://stalemate.band/', permissions: ['link', 'badge', 'return'], enabled: true, domainVerified: true }
    ] }, { allowLoopback: true });
    const target = new URL(communityJoinLink(integration, 'stalemate').href);
    target.searchParams.set('preview', 'local-preview-key-0001');
    const relay = hangoutRelayWsBase(baseURL, `webjam-browser-band-demo-${randomUUID()}`);
    target.searchParams.set('relay', relay);
    const invite = webInviteHash();
    const entry = await stalemateEntrySite(target.href);
    const hostCtx = await lobbyContext(browser, baseURL);
    const mateCtx = await lobbyContext(browser, baseURL, { trackClicks: true, webJoinFixtures: true });
    try {
        await hostCtx.page.goto(`${ROOT}?preview=local-preview-key-0001&relay=${encodeURIComponent(relay)}&via=stalemate`);
        await hostCtx.page.fill('[data-nick]', 'DemoHost');
        await hostCtx.page.click('[data-enter]');
        await expect(hostCtx.page.locator('[data-connection]')).toHaveText('Connected');

        await mateCtx.page.goto(entry.url);
        await mateCtx.page.getByRole('link', { name: 'Hang Out', exact: true }).click();
        await expect(mateCtx.page.locator('[data-entry-label]').first()).toHaveText('via Stalemate');
        await mateCtx.page.fill('[data-nick]', 'DemoMate');
        await mateCtx.page.click('[data-enter]');
        await expect(mateCtx.page.locator('[data-connection]')).toHaveText('Connected');
        await expect(mateCtx.page.locator('[data-app]')).toBeVisible();

        await mateCtx.page.fill('[data-text]', 'Hey band — ready when you are');
        await mateCtx.page.press('[data-text]', 'Enter');
        await expect(hostCtx.page.locator('[data-buffer]')).toContainText('Hey band — ready when you are');

        await hostCtx.page.locator('.phonetabs [data-show="rooms"]').click();
        await hostCtx.page.click('[data-start="jam"]');
        await expect(hostCtx.page.locator('[data-jam]')).toBeVisible();
        const roomName = await hostCtx.page.locator('[data-chat-context]').textContent();
        await expect(roomName).toMatch(/^#jam-/);

        const inviteBandmate = hostCtx.page.getByRole('button', { name: 'Invite bandmate to room', exact: true });
        const guestNickname = hostCtx.page.getByLabel('Guest nickname', { exact: true });
        await expect(inviteBandmate).toBeInViewport({ ratio: 1 });
        await inviteBandmate.press('Enter');
        await expect(guestNickname).toBeFocused();
        await hostCtx.page.keyboard.press('Escape');
        await expect(inviteBandmate).toBeFocused();
        await inviteBandmate.press('Enter');
        await guestNickname.fill('DemoMate');
        await hostCtx.page.getByRole('button', { name: 'Send invitation', exact: true }).click();
        await mateCtx.page.locator('[data-toast]').getByRole('button', { name: 'Join', exact: true }).click();
        await expect(mateCtx.page.locator('[data-chat-context]')).toHaveText(roomName);
        await expect(mateCtx.page.locator('[data-jam-invite-room]')).toBeHidden();
        await expect.poll(mateCtx.clicks).toBeGreaterThanOrEqual(3);
        expect(mateCtx.clicks()).toBeLessThanOrEqual(4);
        await testInfo.attach('bandmate-click-count', {
            body: JSON.stringify({ project: testInfo.project.name, trustedClicksFromEntryThroughRoomJoin: mateCtx.clicks(), transport: 'mocked' }),
            contentType: 'application/json'
        });

        await hostCtx.page.fill('[data-jam-link]', invite.href);
        await hostCtx.page.locator('[data-jam-form] button[type="submit"]').click();
        await expect(hostCtx.page.locator('[data-jam-web]')).toBeEnabled();
        await expect(mateCtx.page.locator('[data-jam-web]')).toBeEnabled();

        const joinPopup = mateCtx.page.waitForEvent('popup');
        await mateCtx.page.click('[data-jam-web]');
        const joinPage = await joinPopup;
        await expect(joinPage).toHaveURL(/webjam\.example\/join\/#/);
        await expect(joinPage.getByRole('heading', { name: 'Check your audio', exact: true })).toBeVisible();
        await joinPage.getByRole('button', { name: 'Skip check', exact: true }).click();
        await joinPage.getByRole('checkbox').check();
        await joinPage.getByRole('button', { name: 'Join with microphone', exact: true }).click();
        await expect(joinPage.locator('#status')).toContainText('Connected — Web Join');
        await expect(joinPage.getByRole('button', { name: 'Leave session', exact: true })).toBeVisible();
    } finally {
        await hostCtx.context.close();
        await mateCtx.context.close();
        await entry.close();
    }
});
