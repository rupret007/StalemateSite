const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { test: base, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../../scripts/lib/e2e-test-server.cjs');
const { LOBBY, ROOM } = require('../../e2e/support/lobby-fixture');

const NAMES = ['RelayHost', 'RelayGuestOne', 'RelayGuestTwo', 'RelayGuestThree'];
const TURN_PATH = '/__hangout-test-turn';
const DEVICE = /^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{32}$/;
const FAKE_YOUTUBE = path.resolve(__dirname, '../../e2e/support/fake-youtube.js');

// HANGOUT_TEST_PREVIEW is the local e2e server's preview fixture value.
// HANGOUT_TEST_TURN_ICE is one JSON RTCIceServer from a disposable local TURN service.
function relayIce(baseURL) {
    const invalid = 'Set HANGOUT_TEST_TURN_ICE to a disposable local TURN RTCIceServer.';
    let entry, address;
    try {
        entry = JSON.parse(process.env.HANGOUT_TEST_TURN_ICE);
        if (typeof entry.urls !== 'string' || !/^turns?:[^/?#\s]+(?:\?transport=(?:udp|tcp))?$/.test(entry.urls)) throw new Error();
        address = new URL(entry.urls.replace(/^turns?:/, 'http://'));
    } catch { throw new Error(invalid); }
    if (![new URL(baseURL).hostname, 'localhost'].includes(address.hostname) || address.username || address.password
        || typeof entry.username !== 'string' || !entry.username
        || typeof entry.credential !== 'string' || !entry.credential) throw new Error(invalid);
    return { urls: entry.urls, username: entry.username, credential: entry.credential };
}

function forceRelay() {
    const Native = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Native {
        constructor(config) { super({ ...config, iceTransportPolicy: 'relay' }); }
    };
}

const test = base.extend({
    mesh: async ({ browser, baseURL }, use) => {
        const ice = relayIce(baseURL);
        const preview = process.env.HANGOUT_TEST_PREVIEW;
        if (!preview) throw new Error('Set HANGOUT_TEST_PREVIEW to the local e2e preview fixture value.');
        const signaling = hangoutRelayWsBase(baseURL, `forced-turn-${randomUUID()}`);
        const params = new URLSearchParams({ preview, relay: signaling });
        const lobby = `${LOBBY}?${params}`;
        params.set('turn', TURN_PATH);
        const contexts = [];
        try {
            for (const name of NAMES) {
                const context = await browser.newContext({ baseURL, permissions: ['camera'] });
                contexts.push(context);
                await context.addInitScript(forceRelay);
                await context.route(url => url.pathname === TURN_PATH, async route => {
                    const request = route.request();
                    const body = request.postDataJSON();
                    if (request.method() !== 'POST' || !body || Object.keys(body).sort().join(',') !== 'device,preview,room'
                        || body.preview !== preview || !DEVICE.test(body.device) || !/^[a-f0-9]{64}$/.test(body.room)) {
                        await route.fulfill({ status: 403 });
                        return;
                    }
                    const ttl = 600;
                    await route.fulfill({ headers: { 'Cache-Control': 'no-store' }, json: {
                        iceServers: [ice], ttl, expiresAt: Date.now() + ttl * 1000
                    } });
                });
                await context.route(/youtube\.com|ytimg|googlevideo/, route => {
                    if (new URL(route.request().url()).pathname === '/iframe_api') {
                        return route.fulfill({ path: FAKE_YOUTUBE, contentType: 'text/javascript' });
                    }
                    return route.abort();
                });
            }
            const pages = await Promise.all(contexts.map(context => context.newPage()));
            await use({ pages, lobby, paint: `${LOBBY}?${params}`, room: `${ROOM}?${params}` });
        } finally {
            await Promise.all(contexts.map(context => context.close()));
        }
    }
});

test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });

async function enter(page, url, name, nameField, joined) {
    await page.goto(url);
    await page.fill(nameField, name);
    await page.click('[data-enter]');
    await expect(page.locator(joined)).toBeVisible();
}

async function joinLobby(page, url, name) {
    await enter(page, url, name, '[data-nick]', '[data-app]');
    await expect(page.locator('[data-connection]')).toHaveText('Connected');
    await expect.poll(() => page.evaluate(pattern => new RegExp(pattern).test(localStorage.getItem('hangout-dev')), DEVICE.source)).toBe(true);
}

async function expectRelayMesh(pages, surface, remoteVideos) {
    await Promise.all(pages.map(async page => {
        await expect.poll(() => page.evaluate(async kind => {
            const pcs = kind === 'paint' ? window.__lobbyRoom.state.pcs : window.__hangout.av.pcs;
            return Promise.all([...pcs.values()].map(async ({ pc }) => {
                const policy = pc.getConfiguration().iceTransportPolicy;
                const connection = pc.connectionState;
                if (connection !== 'connected') return { policy, connection };
                const stats = await pc.getStats();
                const rows = [...stats.values()];
                const transport = rows.find(row => row.type === 'transport' && row.selectedCandidatePairId);
                const pair = stats.get(transport?.selectedCandidatePairId);
                return { policy, connection, pair: pair?.state,
                    local: stats.get(pair?.localCandidateId)?.candidateType,
                    remote: stats.get(pair?.remoteCandidateId)?.candidateType,
                    video: rows.some(row => row.type === 'inbound-rtp' && row.kind === 'video' && row.framesDecoded > 0) };
            }));
        }, surface)).toEqual(Array(pages.length - 1).fill({ policy: 'relay', connection: 'connected', pair: 'succeeded',
            local: 'relay', remote: 'relay', video: true }));
        const videos = page.locator(remoteVideos);
        await expect(videos).toHaveCount(pages.length - 1);
        await expect.poll(() => videos.evaluateAll(nodes => nodes.filter(video => video.videoWidth > 0 && !video.paused).length))
            .toBe(pages.length - 1);
    }));
}

test('Hangout host and three guests exchange camera video over selected TURN pairs', async ({ mesh }) => {
    const { pages, lobby, room } = mesh;
    await Promise.all(pages.map((page, index) => joinLobby(page, lobby, NAMES[index])));
    const [host, ...guests] = pages;
    await enter(host, room, NAMES[0], '[data-name]', '[data-room]');
    const invite = host.url();
    await Promise.all(guests.map((page, index) => enter(page, invite, NAMES[index + 1], '[data-name]', '[data-room]')));
    await Promise.all(pages.map(async page => {
        await expect(page.locator('[data-turn-status]')).toContainText('relay available');
        await page.click('[data-cam]');
        await page.click('[data-ask-yes]');
    }));
    await expectRelayMesh(pages, 'hangout', '[data-tiles] [data-tile]:not([data-tile="me"]) video');
});

test('Paint Along host and three guests exchange camera video over selected TURN pairs', async ({ mesh }) => {
    const { pages, paint } = mesh;
    await Promise.all(pages.map((page, index) => joinLobby(page, paint, NAMES[index])));
    const [host, ...guests] = pages;
    await host.click('[data-start="bobross"]');
    await expect(host.locator('[data-fake-yt]')).toHaveAttribute('data-state', 'playing');
    const channel = await host.evaluate(() => window.__lobby.active);
    await Promise.all(guests.map(page => page.evaluate(room => window.__lobby.cmd('join', [room]), channel)));
    await Promise.all(pages.map(async page => {
        await expect(page.locator('[data-fake-yt]')).toHaveAttribute('data-state', 'playing');
        await page.click('nav [data-show="chat"]');
        await page.click('[data-cam]');
        await page.locator('[data-cam-gate] [data-adult]').check();
        await page.click('[data-cam-gate] [data-cam-yes]');
        await expect(page.locator('[data-act-relay-status]')).toContainText('relay available');
    }));
    await expectRelayMesh(pages, 'paint', '[data-act-tiles] [data-camera-key]:not([data-camera-key="self"]) video');
});
