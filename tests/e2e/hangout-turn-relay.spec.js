const { randomUUID } = require('node:crypto');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');
const { expectOrdinaryMediaLabel } = require('./support/ordinary-media-labels');
const { startLocalTurn } = require('./support/local-turn-server.cjs');
const { TEST_SLUG } = require('./support/lobby-fixture');

const KEY = 'local-preview-key-0001';
const DEVICE = `${'a'.repeat(22)}.${'b'.repeat(32)}`;

test.use({
    permissions: ['camera', 'microphone'],
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--disable-features=WebRtcHideLocalIpsWithMdns'] }
});

let turn;
test.beforeAll(async () => { turn = await startLocalTurn(); });
test.afterAll(async () => { await turn?.close(); });

function roomPath(origin) {
    const relay = hangoutRelayWsBase(origin, `turn-relay-${randomUUID()}`);
    return `/r/${TEST_SLUG}/?preview=${KEY}&relay=${encodeURIComponent(relay)}&turn=/room-turn`;
}

async function enter(page, name) {
    await page.locator('[data-name]').fill(name);
    await page.locator('[data-enter]').click();
    await expect(page.locator('[data-room]')).toBeVisible();
}

async function camOn(page) {
    await page.click('[data-cam]');
    await page.click('[data-ask-yes]');
    await expectOrdinaryMediaLabel(page, 'video', true);
}

async function joinPaintCamera(page) {
    const consent = page.locator('[data-consent]');
    await expect(consent.locator('[data-consent-on]')).toBeVisible();
    await consent.locator('[data-consent-on]').click();
    await expect(consent).toHaveAttribute('data-state', 'preview');
    await consent.locator('[data-consent-on]').click();
    await expect.poll(() => page.evaluate(() => window.__hangout.av.cam)).toBe(true);
}

function installRelayPolicy(context) {
    return context.addInitScript(() => {
        const Native = window.RTCPeerConnection;
        window.RTCPeerConnection = class extends Native {
            constructor(config) {
                super(Object.assign({}, config, { iceTransportPolicy: 'relay' }));
            }
        };
    });
}

async function openContext(browser, { relay, payloads, mode }) {
    const context = await browser.newContext({ permissions: ['camera', 'microphone'] });
    await context.addInitScript((device) => localStorage.setItem('hangout-dev', device), DEVICE);
    if (relay) await installRelayPolicy(context);
    let issued = 0;
    await context.route((url) => url.pathname === '/room-turn', async (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        const body = route.request().postDataJSON();
        payloads.push(body);
        issued += 1;
        if (mode === 'deny' || (mode === 'once' && issued > 1)) {
            await route.fulfill({ status: 503, json: { iceServers: [], reason: 'TURN unavailable' } });
            return;
        }
        await route.fulfill({
            json: {
                iceServers: [{ urls: [turn.url], username: turn.username, credential: turn.credential }],
                ttl: mode === 'once' ? 60 : 600,
                expiresAt: Date.now() + (mode === 'once' ? 60000 : 600000)
            }
        });
    });
    return context;
}

async function selectedPairs(page) {
    return page.evaluate(async () => {
        const videos = [...document.querySelectorAll('[data-tiles] .tile:not([data-tile="me"]) video')].filter((video) => video.videoWidth > 0).length;
        const pairs = [];
        for (const entry of window.__hangout.av.pcs.values()) {
            const stats = await entry.pc.getStats();
            let chosen = null;
            for (const report of stats.values()) {
                if (report.type !== 'candidate-pair' || report.state !== 'succeeded' || !report.nominated) continue;
                const local = stats.get(report.localCandidateId);
                const remote = stats.get(report.remoteCandidateId);
                chosen = {
                    connection: entry.pc.connectionState,
                    policy: entry.pc.getConfiguration().iceTransportPolicy,
                    local: local && local.candidateType,
                    remote: remote && remote.candidateType
                };
            }
            pairs.push(chosen);
        }
        return { count: window.__hangout.av.pcs.size, videos, pairs };
    });
}

async function expectRelayMesh(page) {
    await expect.poll(async () => {
        const snap = await selectedPairs(page);
        const ready = snap.count === 2 && snap.videos >= 2 && snap.pairs.length === 2 && snap.pairs.every((pair) =>
            pair && pair.connection === 'connected' && pair.policy === 'relay' && pair.local === 'relay' && pair.remote === 'relay');
        return ready ? 'ready' : JSON.stringify(snap);
    }, { timeout: 15000 }).toBe('ready');
}

test('three Hangout peers connect only through TURN when ICE is relay-only', async ({ browser, baseURL }) => {
    const payloads = [];
    const contexts = [];
    try {
        const url = roomPath(baseURL);
        const hostContext = await openContext(browser, { relay: true, payloads, mode: 'allow' });
        contexts.push(hostContext);
        const host = await hostContext.newPage();
        await host.goto(url);
        await enter(host, 'Relay Host');
        await expect(host.locator('[data-turn-status]')).toContainText('relay available');
        const guests = await Promise.all(['Relay Guest', 'Relay Friend'].map(async (name) => {
            const context = await openContext(browser, { relay: true, payloads, mode: 'allow' });
            contexts.push(context);
            const page = await context.newPage();
            await page.goto(host.url());
            await enter(page, name);
            return page;
        }));
        const pages = [host, ...guests];
        await expect(host.locator('[data-peers]')).toContainText('3 here');
        await Promise.all(pages.map(camOn));
        await Promise.all(pages.map(expectRelayMesh));
        expect(payloads.length).toBeGreaterThanOrEqual(3);
        for (const body of payloads) {
            expect(Object.keys(body).sort()).toEqual(['device', 'preview', 'room']);
            expect(body.device).toBe(DEVICE);
            expect(body.preview).toBe(KEY);
            expect(body.room).toMatch(/^[a-f0-9]{64}$/);
            expect(JSON.stringify(body)).not.toContain(turn.credential);
        }
        expect(await host.evaluate(() => JSON.stringify(localStorage))).not.toContain(turn.credential);
    } finally {
        await Promise.all(contexts.map((context) => context.close()));
    }
});

test('three Paint Along peers share a relay-only camera mesh from the room invite', async ({ browser, baseURL }) => {
    const payloads = [];
    const contexts = [];
    try {
        const hostContext = await openContext(browser, { relay: true, payloads, mode: 'allow' });
        contexts.push(hostContext);
        const host = await hostContext.newPage();
        await host.goto(roomPath(baseURL));
        await enter(host, 'Paint Host');
        await host.locator('[data-bob-toggle]').click();
        await expect(host.locator('[data-mode-pill]')).toHaveText('Paint Along');
        await host.evaluate(() => {
            navigator.clipboard.writeText = async (url) => { window.copiedInvite = url; };
        });
        await host.locator('[data-copy]').click({ force: true });
        const copied = await host.evaluate(() => window.copiedInvite);
        const invite = new URL(copied);
        expect(invite.searchParams.get('activity')).toBe('paint');
        expect(invite.searchParams.has('preview')).toBe(false);
        expect(invite.searchParams.get('turn')).toBe('/room-turn');
        expect(invite.hash).toContain('r=');
        const guests = await Promise.all(['Paint Guest', 'Paint Friend'].map(async (name) => {
            const context = await openContext(browser, { relay: true, payloads, mode: 'allow' });
            contexts.push(context);
            const page = await context.newPage();
            await page.goto(invite.href);
            await enter(page, name);
            await expect(page.locator('[data-mode-pill]')).toHaveText('Paint Along');
            return page;
        }));
        const pages = [host, ...guests];
        await expect(host.locator('[data-peers]')).toContainText('3 here');
        await Promise.all(pages.map(joinPaintCamera));
        await Promise.all(pages.map(expectRelayMesh));
    } finally {
        await Promise.all(contexts.map((context) => context.close()));
    }
});

test('expired TURN credentials fall back to STUN and a direct pair still connects', async ({ browser, baseURL }) => {
    const payloads = [];
    const contexts = [];
    try {
        const expiryContext = await openContext(browser, { relay: false, payloads, mode: 'once' });
        contexts.push(expiryContext);
        const expiry = await expiryContext.newPage();
        await expiry.clock.install({ time: new Date() });
        await expiry.goto(roomPath(baseURL));
        await enter(expiry, 'Expiry Host');
        await expect(expiry.locator('[data-turn-status]')).toContainText('relay available');
        await expiry.clock.fastForward(49000);
        await expect.poll(() => payloads.length).toBeGreaterThanOrEqual(2);
        await expect(expiry.locator('[data-turn-status]')).toContainText('unavailable for now');
        const ice = await expiry.evaluate(() => window.__hangout.av.ice);
        expect(JSON.stringify(ice)).toContain('stun:');
        expect(JSON.stringify(ice)).not.toContain('turn:');
        expect(JSON.stringify(ice)).not.toContain(turn.credential);
        expect(await expiry.evaluate(() => JSON.stringify(localStorage))).not.toContain(turn.credential);

        const directPayloads = [];
        const url = roomPath(baseURL);
        const hostContext = await openContext(browser, { relay: false, payloads: directPayloads, mode: 'deny' });
        contexts.push(hostContext);
        const host = await hostContext.newPage();
        await host.goto(url);
        await enter(host, 'Direct Host');
        await expect(host.locator('[data-turn-status]')).toContainText('unavailable for now');
        const guestContext = await openContext(browser, { relay: false, payloads: directPayloads, mode: 'deny' });
        contexts.push(guestContext);
        const guest = await guestContext.newPage();
        await guest.goto(host.url());
        await enter(guest, 'Direct Guest');
        await camOn(host);
        await camOn(guest);
        await expect.poll(async () => {
            const snap = await selectedPairs(host);
            const pair = snap.pairs[0];
            const ready = snap.count === 1 && snap.videos >= 1 && pair && pair.connection === 'connected'
                && pair.policy === 'all' && pair.local !== 'relay' && pair.remote !== 'relay';
            return ready ? 'ready' : JSON.stringify(snap);
        }, { timeout: 15000 }).toBe('ready');
        expect(directPayloads.length).toBeGreaterThanOrEqual(2);
    } finally {
        await Promise.all(contexts.map((context) => context.close()));
    }
});
