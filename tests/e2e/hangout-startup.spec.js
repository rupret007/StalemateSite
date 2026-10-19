const path = require('node:path');
const fs = require('node:fs/promises');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const SLUG = '45662413410ed051';
const FAKE_YT = path.join(__dirname, 'support/fake-youtube.js');
const contexts = new Set();
let origin;
test.use({ permissions: ['camera', 'microphone'], trace: 'retain-on-failure',
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--disable-features=WebRtcHideLocalIpsWithMdns'] } });
test.skip(({ browserName }) => browserName !== 'chromium', 'Two-browser native media checks use Chromium');
test.beforeAll(async ({ baseURL }) => { origin = baseURL; });
test.afterEach(async () => { await Promise.all([...contexts].map((context) => context.close())); contexts.clear(); });

async function open(browser) {
    const context = await browser.newContext({ permissions: ['camera', 'microphone'] });
    contexts.add(context);
    await context.route(/youtube\.com|ytimg|googlevideo/, (route) => route.abort());
    await context.route('https://www.youtube.com/iframe_api', (route) => route.fulfill({ path: FAKE_YT, contentType: 'text/javascript' }));
    const page = await context.newPage();
    return page;
}
const url = () => `/r/${SLUG}/?preview=local-preview-key-0001&relay=${encodeURIComponent(hangoutRelayWsBase(origin))}`;
async function join(page, target, name) {
    await page.goto(target); await page.fill('[data-name]', name); await page.click('[data-enter]');
    await expect(page.locator('[data-room]')).toBeVisible();
}
async function turnOn(page, kind) {
    await page.click(kind === 'video' ? '[data-cam]' : '[data-mic]'); await page.click('[data-ask-yes]');
    await expect(page.locator(kind === 'video' ? '[data-cam]' : '[data-mic]')).toHaveText(kind === 'video' ? 'Turn off my camera' : 'Mute my mic');
}
async function decoded(page, kind = 'video') {
    await expect.poll(() => page.evaluate(async (kind) => {
        const entries = [...window.__hangout.av.pcs.values()];
        if (!entries.length || entries.some((entry) => entry.pc.connectionState !== 'connected' || entry.pc.signalingState !== 'stable')) return false;
        for (const entry of entries) {
            let received = false;
            (await entry.pc.getStats()).forEach((row) => {
                if (row.type === 'inbound-rtp' && (row.kind || row.mediaType) === kind && row.bytesReceived > 0 && (kind !== 'video' || row.framesDecoded > 0)) received = true;
            });
            if (!received) return false;
        }
        return true;
    }, kind), { timeout: 15000 }).toBe(true);
}
async function observeWire(page) {
    await page.evaluate(() => {
        const seal = window.HangoutCore.seal;
        const send = WebSocket.prototype.send;
        const descriptions = new Map();
        const counts = { offer: 0, answer: 0 };
        window.HangoutCore.seal = async (key, message) => {
            const frame = await seal(key, message);
            if (message.type === 'rtc' && message.sdp && descriptions.size < 64) descriptions.set(JSON.stringify(frame), message.sdp.type);
            return frame;
        };
        WebSocket.prototype.send = function (frame) {
            const type = descriptions.get(frame);
            if (Object.hasOwn(counts, type)) { counts[type] += 1; descriptions.delete(frame); }
            return send.call(this, frame);
        };
        window.__startupWire = counts;
    });
}
async function holdHello(host) {
    await host.evaluate(() => {
        const open = window.HangoutCore.open;
        window.HangoutCore.open = async (key, frame) => {
            const message = await open(key, frame);
            if (message.type === 'hello' && !message.reply) {
                window.HangoutCore.open = open;
                window.__startupHelloHeld = true;
                await new Promise((resolve) => { window.__releaseStartupHello = resolve; });
            }
            return message;
        };
    });
}
async function holdLeaderOffer(host) {
    await host.evaluate(() => {
        const createOffer = RTCPeerConnection.prototype.createOffer;
        let held = false;
        RTCPeerConnection.prototype.createOffer = async function (...args) {
            const offer = await createOffer.apply(this, args);
            const entry = [...window.__hangout.av.pcs.values()].find((value) => value.pc === this);
            if (!held && entry && !entry.polite) {
                held = true; window.__startupLeaderHeld = true;
                await new Promise((resolve) => { window.__releaseStartupLeader = resolve; });
            }
            return offer;
        };
    });
}
async function initialPair(browser, hostKind = 'video', guestKind = 'video') {
    const host = await open(browser); await join(host, url(), 'Jeff');
    await turnOn(host, hostKind); await holdHello(host); await holdLeaderOffer(host); await observeWire(host);
    const guest = await open(browser); await join(guest, host.url(), 'Karen'); await observeWire(guest);
    await holdLeaderOffer(guest);
    await expect.poll(() => host.evaluate(() => window.__startupHelloHeld)).toBe(true);
    await turnOn(guest, guestKind);
    const guestId = await guest.evaluate(() => window.__hangout.myId);
    await expect.poll(() => host.evaluate((id) => window.__hangout.av.peers.has(id), guestId)).toBe(true);
    await host.evaluate(() => window.__releaseStartupHello());
    await expect.poll(() => host.evaluate(() => window.__hangout.av.pcs.size)).toBe(1);
    const hostPolite = await host.evaluate(() => [...window.__hangout.av.pcs.values()][0].polite);
    const leader = hostPolite ? guest : host;
    const follower = hostPolite ? host : guest;
    await expect.poll(() => leader.evaluate(() => window.__startupLeaderHeld)).toBe(true);
    return { host, guest, leader, follower };
}

test('both active peers let the initial impolite offer lead without an initial polite offer', async ({ browser }) => {
    const { host, guest, leader, follower } = await initialPair(browser);
    const proof = {};
    try {
        await expect.poll(() => follower.evaluate(() => window.__startupWire.offer > 0 || [...window.__hangout.av.pcs.values()].some((entry) => entry.waitingInitialOffer))).toBe(true);
        proof.beforeLeaderRelease = await follower.evaluate(() => ({ offers: window.__startupWire.offer, answers: window.__startupWire.answer,
            polite: [...window.__hangout.av.pcs.values()][0]?.polite }));
        // This primary assertion fails on the old source's real transmitted offer.
        expect(proof.beforeLeaderRelease.offers).toBe(0);
        await leader.evaluate(() => window.__releaseStartupLeader());
        await decoded(host); await decoded(guest);
        proof.after = { host: await host.evaluate(() => window.__startupWire), guest: await guest.evaluate(() => window.__startupWire) };
    } finally {
        await leader.evaluate(() => window.__releaseStartupLeader?.());
        const receipt = test.info().outputPath('controlled-initial-offer.json');
        await fs.writeFile(receipt, `${JSON.stringify(proof, null, 2)}\n`);
        await test.info().attach('controlled-initial-offer', { path: receipt, contentType: 'application/json' });
    }
});


for (const passivePolite of [false, true]) {
    test(`a passive ${passivePolite ? 'polite' : 'impolite'} viewer can initiate receiving without capture`, async ({ browser }) => {
        const host = await open(browser); await join(host, url(), 'Jeff');
        const guest = await open(browser); await join(guest, host.url(), 'Karen');
        await expect.poll(() => host.evaluate(() => window.__hangout.names.size)).toBe(1);
        await expect.poll(() => guest.evaluate(() => window.__hangout.names.size)).toBe(1);
        await observeWire(host); await observeWire(guest);
        const hostId = await host.evaluate(() => window.__hangout.myId);
        const guestId = await guest.evaluate(() => window.__hangout.myId);
        const viewer = (hostId > guestId) === passivePolite ? host : guest;
        const publisher = viewer === host ? guest : host;
        await turnOn(publisher, 'video');
        await decoded(viewer);
        expect(await viewer.evaluate(() => {
            const app = window.__hangout, entry = [...app.av.pcs.values()][0];
            return { polite: entry.polite, mic: app.av.mic, cam: app.av.cam,
                capture: Boolean(app.av.rawCam) || Boolean(app.av.stream?.getTracks().some((track) => track.readyState === 'live')),
                offers: window.__startupWire.offer };
        })).toEqual({ polite: passivePolite, mic: false, cam: false, capture: false, offers: 1 });
    });
}

for (const politeKind of ['video', 'audio']) {
    test(`initial arbitration preserves a polite ${politeKind} sender and the other media kind`, async ({ browser }) => {
        const host = await open(browser); await join(host, url(), 'Jeff');
        await holdHello(host); await holdLeaderOffer(host); await observeWire(host);
        const guest = await open(browser); await join(guest, host.url(), 'Karen');
        await holdLeaderOffer(guest); await observeWire(guest);
        await expect.poll(() => host.evaluate(() => window.__startupHelloHeld)).toBe(true);
        const hostPolite = await host.evaluate((guestId) => window.__hangout.myId > guestId, await guest.evaluate(() => window.__hangout.myId));
        const hostKind = hostPolite ? politeKind : politeKind === 'video' ? 'audio' : 'video';
        const guestKind = hostKind === 'video' ? 'audio' : 'video';
        await turnOn(host, hostKind); await turnOn(guest, guestKind);
        await expect.poll(() => host.evaluate(() => window.__hangout.av.peers.size)).toBe(1);
        await expect.poll(() => guest.evaluate(() => window.__hangout.av.peers.size)).toBe(1);
        await host.evaluate(() => window.__releaseStartupHello());
        const leader = hostPolite ? guest : host, follower = hostPolite ? host : guest;
        await expect.poll(() => leader.evaluate(() => window.__startupLeaderHeld)).toBe(true);
        await expect.poll(() => follower.evaluate(() => [...window.__hangout.av.pcs.values()][0]?.waitingInitialOffer)).toBe(true);
        expect(await follower.evaluate(() => window.__startupWire.offer)).toBe(0);
        await leader.evaluate(() => window.__releaseStartupLeader());
        await decoded(host, guestKind); await decoded(guest, hostKind);
        // The first leader offer contains only its own kind. A later real
        // native negotiation must publish the follower's omitted sending kind.
        expect(await follower.evaluate(() => window.__startupWire.offer)).toBeGreaterThan(0);
    });
}

test('turning passive wakes an initial waiter before the leader sees its earlier camera-on', async ({ browser }) => {
    const host = await open(browser); await join(host, url(), 'Jeff');
    const guest = await open(browser); await join(guest, host.url(), 'Karen');
    await expect.poll(() => host.evaluate(() => window.__hangout.names.size)).toBe(1);
    await expect.poll(() => guest.evaluate(() => window.__hangout.names.size)).toBe(1);
    const hostPolite = await host.evaluate((guestId) => window.__hangout.myId > guestId, await guest.evaluate(() => window.__hangout.myId));
    const leader = hostPolite ? guest : host, follower = hostPolite ? host : guest;
    await observeWire(leader); await observeWire(follower);
    await leader.evaluate(() => {
        const open = window.HangoutCore.open;
        window.HangoutCore.open = async (key, frame) => {
            const message = await open(key, frame);
            if (message.type === 'av' && message.av.cam && !window.__heldFollowerCameraOn) {
                window.__heldFollowerCameraOn = true;
                await new Promise((resolve) => { window.__releaseFollowerCameraOn = resolve; });
                window.__followerCameraOnDecryptCompleted = true;
            }
            return message;
        };
    });
    await follower.evaluate(() => {
        const createOffer = RTCPeerConnection.prototype.createOffer;
        let held = false;
        RTCPeerConnection.prototype.createOffer = async function (...args) {
            const offer = await createOffer.apply(this, args);
            if (!held) {
                held = true; window.__heldPassiveOffer = true;
                await new Promise((resolve) => { window.__releasePassiveOffer = resolve; });
            }
            return offer;
        };
    });
    try {
        await turnOn(leader, 'video');
        await expect.poll(() => follower.evaluate(() => window.__heldPassiveOffer)).toBe(true);
        await turnOn(follower, 'video');
        await expect.poll(() => leader.evaluate(() => window.__heldFollowerCameraOn)).toBe(true);
        await follower.evaluate(() => window.__releasePassiveOffer());
        await expect.poll(() => follower.evaluate(() => [...window.__hangout.av.pcs.values()][0]?.waitingInitialOffer)).toBe(true);
        expect(await leader.evaluate(() => window.__hangout.av.peers.size)).toBe(0);
        expect(await follower.evaluate(() => window.__startupWire.offer)).toBe(0);
        await follower.click('[data-cam]');
        await expect(follower.locator('[data-cam]')).toHaveText('Turn on my camera');
        await decoded(follower);
        expect(await follower.evaluate(() => window.__startupWire.offer)).toBeGreaterThan(0);
        await leader.evaluate(() => window.__releaseFollowerCameraOn());
        await expect.poll(() => leader.evaluate(() => window.__followerCameraOnDecryptCompleted)).toBe(true);
        // The AV handler runs synchronously after decrypt; the next task proves
        // the absence assertions below observe the processed stale message.
        await leader.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
        await expect(leader.locator('.tile:not([data-tile="me"])')).toHaveCount(0);
        expect(await leader.evaluate(() => window.__hangout.av.camPeers.size)).toBe(0);
        expect(await follower.evaluate(() => Boolean(window.__hangout.av.rawCam) || Boolean(window.__hangout.av.stream?.getVideoTracks().some((track) => track.readyState === 'live')))).toBe(false);
    } finally {
        await follower.evaluate(() => window.__releasePassiveOffer?.());
        await leader.evaluate(() => window.__releaseFollowerCameraOn?.());
    }
});

test('a remote camera-off wakes an active initial waiter', async ({ browser }) => {
    const { leader, follower } = await initialPair(browser);
    try {
        await expect.poll(() => follower.evaluate(() => [...window.__hangout.av.pcs.values()][0]?.waitingInitialOffer)).toBe(true);
        await leader.click('[data-cam]');
        await expect(leader.locator('[data-cam]')).toHaveText('Turn on my camera');
        await expect.poll(() => follower.evaluate(() => window.__startupWire.offer)).toBeGreaterThan(0);
        await leader.evaluate(() => window.__releaseStartupLeader());
        await decoded(leader);
        expect(await leader.evaluate(() => Boolean(window.__hangout.av.rawCam))).toBe(false);
        expect(await follower.evaluate(() => window.__hangout.av.camPeers.size)).toBe(0);
    } finally { await leader.evaluate(() => window.__releaseStartupLeader?.()); }
});

async function startupExtrasConnectedPair(browser) {
    const pair = await initialPair(browser);
    await pair.leader.evaluate(() => window.__releaseStartupLeader());
    await decoded(pair.host); await decoded(pair.guest);
    for (const page of [pair.host, pair.guest]) {
        await expect.poll(() => page.evaluate(() => [...window.__hangout.av.pcs.values()].every((entry) =>
            entry.pc.signalingState === 'stable' && !entry.makingOffer && !entry.remoteOfferPending))).toBe(true);
    }
    return pair;
}

test('a synthetic offer failure retains debt without self-retry until a later media change', async ({ browser }) => {
    const { host, guest } = await startupExtrasConnectedPair(browser);
    const target = guest, other = host;
    await target.evaluate(() => {
        const entry = [...window.__hangout.av.pcs.values()][0];
        const nativeCreateOffer = entry.pc.createOffer.bind(entry.pc);
        const proof = window.__offerFaultProof = { calls: 0, injected: false, externalChangeAllowed: false, unexpectedCalls: 0 };
        entry.pc.createOffer = async (...args) => {
            proof.calls += 1;
            const offer = await nativeCreateOffer(...args);
            if (!proof.injected) {
                proof.injected = true;
                // Explicit synthetic fault AFTER genuine native offer creation.
                throw new DOMException('Synthetic createOffer failure for debt regression', 'OperationError');
            }
            if (!proof.externalChangeAllowed) {
                proof.unexpectedCalls += 1;
                // A broken immediate-retry pump stops here instead of spinning.
                await new Promise(() => {});
            }
            return offer;
        };
    });
    await turnOn(target, 'audio');
    await expect.poll(() => target.evaluate(() => {
        const proof = window.__offerFaultProof, entry = [...window.__hangout.av.pcs.values()][0];
        return proof.injected && (!entry.makingOffer || proof.calls > 1);
    })).toBe(true);
    const beforeExternalChange = await target.evaluate(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        const proof = window.__offerFaultProof, entry = [...window.__hangout.av.pcs.values()][0];
        return { calls: proof.calls, unexpectedCalls: proof.unexpectedCalls, offerNeeded: entry.offerNeeded,
            makingOffer: entry.makingOffer, activeCapture: window.__hangout.av.stream.getAudioTracks().some((track) => track.readyState === 'live') };
    });
    expect(beforeExternalChange).toEqual({ calls: 1, unexpectedCalls: 0, offerNeeded: true, makingOffer: false, activeCapture: true });

    // A genuine later media transition is the retry stimulus; no direct pump call.
    await target.evaluate(() => { window.__offerFaultProof.externalChangeAllowed = true; });
    await target.click('[data-cam]');
    await expect(target.locator('[data-cam]')).toHaveText('Turn on my camera');
    await decoded(other, 'audio'); await decoded(target, 'video');
    await expect.poll(() => target.evaluate(() => window.__offerFaultProof.calls)).toBeGreaterThan(1);
    await expect.poll(() => target.evaluate(() => [...window.__hangout.av.pcs.values()][0].offerNeeded)).toBe(false);
    const videoFrames = () => other.evaluate(async () => {
        let decoded = 0;
        for (const entry of window.__hangout.av.pcs.values()) {
            (await entry.pc.getStats()).forEach((row) => {
                if (row.type === 'inbound-rtp' && (row.kind || row.mediaType) === 'video') decoded += row.framesDecoded || 0;
            });
        }
        return decoded;
    });
    const beforeRestoredVideo = await videoFrames();
    // Restore real video using the already-approved camera; this adds no prompt.
    await target.click('[data-cam]');
    await expect(target.locator('[data-cam]')).toHaveText('Turn off my camera');
    await decoded(other, 'video');
    await expect.poll(videoFrames, { timeout: 15000 }).toBeGreaterThan(beforeRestoredVideo);
    await test.info().attach('synthetic-offer-failure-debt', { body: JSON.stringify(beforeExternalChange), contentType: 'application/json' });
});

test('real answer publication precedes queued native work from a newly captured media kind', async ({ browser }) => {
    const { host, guest } = await startupExtrasConnectedPair(browser);
    const target = await guest.evaluate(() => [...window.__hangout.av.pcs.values()][0].polite) ? guest : host;
    const other = target === guest ? host : guest;
    await target.evaluate(() => {
        const seal = window.HangoutCore.seal, send = WebSocket.prototype.send;
        const frames = new Map();
        const proof = window.__answerPublicationProof = { held: false, releaseCalled: false, wire: [] };
        window.HangoutCore.seal = async (key, message) => {
            const frame = await seal(key, message);
            if (message.type === 'rtc' && message.sdp) {
                if (frames.size < 64) frames.set(JSON.stringify(frame), message.sdp.type);
                if (message.sdp.type === 'answer' && !proof.held) {
                    proof.held = true;
                    // Hold genuine encrypted-answer completion, leaving all native
                    // offer/answer promises and outcomes unchanged.
                    await new Promise((resolve) => { window.__releaseAnswerPublication = () => { proof.releaseCalled = true; resolve(); }; });
                }
            }
            return frame;
        };
        WebSocket.prototype.send = function (frame) {
            const type = frames.get(frame);
            if (type) { if (proof.wire.length < 16) proof.wire.push(type); frames.delete(frame); }
            return send.call(this, frame);
        };
    });
    try {
        await other.evaluate(() => [...window.__hangout.av.pcs.values()][0].pc.restartIce());
        await expect.poll(() => target.evaluate(() => window.__answerPublicationProof.held)).toBe(true);
        await turnOn(target, 'audio');
        // The real addTrack negotiation callback must either latch debt (fixed)
        // or expose a premature transmitted offer (old behavior).
        await expect.poll(() => target.evaluate(() => {
            const entry = [...window.__hangout.av.pcs.values()][0];
            return entry.offerNeeded || window.__answerPublicationProof.wire.includes('offer');
        })).toBe(true);
        const held = await target.evaluate(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
            const entry = [...window.__hangout.av.pcs.values()][0];
            return { offerNeeded: entry.offerNeeded, wire: [...window.__answerPublicationProof.wire],
                activeCapture: window.__hangout.av.stream.getAudioTracks().some((track) => track.readyState === 'live') };
        });
        expect(held.activeCapture).toBe(true);
        expect(held.offerNeeded).toBe(true);
        expect(held.wire).toEqual([]);
        await target.evaluate(() => window.__releaseAnswerPublication());
        await expect.poll(() => target.evaluate(() => window.__answerPublicationProof.wire.includes('offer'))).toBe(true);
        await decoded(other, 'audio'); await decoded(host, 'video'); await decoded(guest, 'video');
        const wire = await target.evaluate(() => window.__answerPublicationProof.wire);
        expect(wire[0]).toBe('answer');
        expect(wire.indexOf('offer')).toBeGreaterThan(wire.indexOf('answer'));
        await expect.poll(() => target.evaluate(() => [...window.__hangout.av.pcs.values()][0].offerNeeded)).toBe(false);
        await test.info().attach('answer-before-queued-offer', { body: JSON.stringify({ held, wire }), contentType: 'application/json' });
    } finally { await target.evaluate(() => window.__releaseAnswerPublication?.()); }
});
