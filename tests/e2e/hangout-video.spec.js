// Room video: Webex-style basics on the peer-to-peer mesh, two real browsers over the local relay.
const path = require('node:path');
const fs = require('node:fs/promises');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const SLUG = '45662413410ed051';
const KEY = 'local-preview-key-0001';
const FAKE_YT = path.join(__dirname, 'support/fake-youtube.js');
const SHOTS = process.env.HANGOUT_VIDEO_SHOTS || '';

test.use({
    permissions: ['camera', 'microphone'],
    trace: 'retain-on-failure',
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--disable-features=WebRtcHideLocalIpsWithMdns'] }
});
test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium carries the two-browser call suite');

let testOrigin;
test.beforeAll(async ({ baseURL }) => { testOrigin = baseURL; });
const roomContexts = new Set();
test.afterEach(async () => { await Promise.all([...roomContexts].map((context) => context.close())); roomContexts.clear(); });

async function openBrowser(browser, opts = {}) {
    const context = await browser.newContext(Object.assign({ permissions: ['camera', 'microphone'] }, opts));
    roomContexts.add(context);
    await context.route(/youtube\.com|ytimg|googlevideo/, (route) => route.abort());
    await context.route('https://www.youtube.com/iframe_api', (route) => route.fulfill({ path: FAKE_YT, contentType: 'text/javascript' }));
    const page = await context.newPage();
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(e.message));
    return page;
}
const roomUrl = (extra = '') => `/r/${SLUG}/?preview=${KEY}&relay=${encodeURIComponent(hangoutRelayWsBase(testOrigin))}${extra}`;

async function join(page, url, name) {
    await page.goto(url);
    await page.fill('[data-name]', name);
    await page.click('[data-enter]');
    await expect(page.locator('[data-room]')).toBeVisible();
}
async function camOn(page) {
    await page.click('[data-cam]');
    await page.click('[data-ask-yes]');
    await expect(page.locator('[data-cam]')).toHaveText('Turn off my camera');
}
async function micOn(page) {
    await page.click('[data-mic]');
    await page.click('[data-ask-yes]');
    await expect(page.locator('[data-mic]')).toHaveText('Mute my mic');
}
async function captureRtcDiagnostics(page) {
    if (!page) return { available: false };
    return page.evaluate(async () => {
        const app = window.__hangout;
        if (!app) return { available: false };
        const track = (value) => value ? { kind: value.kind, readyState: value.readyState, muted: value.muted, enabled: value.enabled } : null;
        const pcs = await Promise.all([...app.av.pcs].slice(0, 8).map(async ([peer, entry]) => {
            const pc = entry.pc;
            const stats = [];
            const candidates = { local: 0, remote: 0 };
            try {
                (await pc.getStats()).forEach((row) => {
                    if (row.type === 'local-candidate') candidates.local += 1;
                    if (row.type === 'remote-candidate') candidates.remote += 1;
                    if (!['inbound-rtp', 'outbound-rtp'].includes(row.type) || stats.length >= 16) return;
                    const safe = { type: row.type, kind: row.kind || row.mediaType };
                    for (const key of ['bytesSent', 'bytesReceived', 'framesSent', 'framesEncoded', 'framesDecoded', 'framesReceived', 'framesDropped', 'packetsSent', 'packetsReceived']) {
                        if (Number.isFinite(row[key])) safe[key] = row[key];
                    }
                    stats.push(safe);
                });
            } catch (_) { /* closed connections retain their safe state fields */ }
            const transports = [];
            const seen = new Set();
            const matchesDescription = (description, parameters, mid) => {
                if (!description?.sdp || !parameters) return null;
                const sections = description.sdp.split(/(?=^m=)/m);
                const session = sections[0]?.startsWith('m=') ? '' : sections[0] || '';
                const media = sections.find((section) => section.startsWith('m=') && section.split(/\r?\n/).includes(`a=mid:${mid}`)) || '';
                const read = (name) => media.match(new RegExp(`^a=${name}:([^\\r\\n]+)`, 'm'))?.[1] || session.match(new RegExp(`^a=${name}:([^\\r\\n]+)`, 'm'))?.[1];
                // Values are compared only inside this page. Neither credentials
                // nor hashes of them are included in the diagnostic result.
                return read('ice-ufrag') === parameters.usernameFragment && read('ice-pwd') === parameters.password;
            };
            for (const transceiver of pc.getTransceivers().slice(0, 4)) {
                const dtls = transceiver.sender.transport || transceiver.receiver.transport;
                const ice = dtls?.iceTransport;
                if (!ice || seen.has(ice)) continue;
                seen.add(ice);
                try {
                    const local = ice.getLocalParameters?.() || null;
                    const remote = ice.getRemoteParameters?.() || null;
                    transports.push({
                        dtls: dtls.state, ice: ice.state, gathering: ice.gatheringState,
                        localCandidateCount: ice.getLocalCandidates?.().length ?? null,
                        remoteCandidateCount: ice.getRemoteCandidates?.().length ?? null,
                        localParametersPresent: Boolean(local), remoteParametersPresent: Boolean(remote),
                        localParametersMatchDescription: matchesDescription(pc.localDescription, local, transceiver.mid),
                        remoteParametersMatchDescription: matchesDescription(pc.remoteDescription, remote, transceiver.mid)
                    });
                } catch (_) { transports.push({ available: false }); }
            }
            return {
                peer, signaling: pc.signalingState, connection: pc.connectionState, ice: pc.iceConnectionState, gathering: pc.iceGatheringState,
                descriptions: { local: pc.localDescription?.type || null, remote: pc.remoteDescription?.type || null }, candidates,
                polite: entry.polite, makingOffer: entry.makingOffer, ignoreOffer: entry.ignoreOffer, settingRemoteAnswer: entry.settingRemoteAnswer, remoteOfferPending: entry.remoteOfferPending,
                pendingIce: entry.pendingIce.length,
                transceivers: pc.getTransceivers().slice(0, 4).map((value) => ({
                    mid: value.mid, direction: value.direction, currentDirection: value.currentDirection,
                    sender: track(value.sender.track), receiver: track(value.receiver.track)
                })), stats, transports
            };
        }));
        return {
            available: true, mode: 'final-state-only', connected: app.connected, ended: app.ended,
            names: [...app.names].slice(0, 8),
            av: { mic: app.av.mic, cam: app.av.cam, peers: [...app.av.peers].slice(0, 8), micPeers: [...app.av.micPeers].slice(0, 8), camPeers: [...app.av.camPeers].slice(0, 8) },
            pcs,
            videos: [...document.querySelectorAll('[data-tiles] video')].slice(0, 9).map((video) => ({
                peer: video.closest('[data-tile]').dataset.tile,
                paused: video.paused, readyState: video.readyState, width: video.videoWidth,
                tracks: video.srcObject?.getTracks().map(track) || []
            }))
        };
    }).catch(() => ({ available: false }));
}
async function call(browser, opts) {
    const host = await openBrowser(browser, opts);
    await join(host, roomUrl(), 'Jeff');
    const guest = await openBrowser(browser, opts);
    await join(guest, host.url(), 'Karen');
    await expect(guest.locator('[data-peers]')).toContainText('2 here');
    await camOn(host);
    await micOn(host);
    await camOn(guest);
    await expect.poll(() => guest.evaluate(() => {
        const v = document.querySelector('.tile:not([data-tile="me"]) video');
        return v ? v.videoWidth : 0;
    }), { timeout: 15000 }).toBeGreaterThan(0);
    return { host, guest };
}
const sentVideo = (page) => page.evaluate(() => {
    const e = [...window.__hangout.av.pcs.values()][0];
    const s = e && e.senders.video;
    return s ? s.getParameters().encodings[0] : null;
});

test('grid by default, speaker view and pin ask the sender for the sharp feed', async ({ browser }) => {
    const { host, guest } = await call(browser);
    await expect(guest.locator('[data-tiles]')).toHaveAttribute('data-view', 'grid');
    await expect(guest.locator('[data-tiles] .tile')).toHaveCount(2);
    await expect(guest.locator('[data-tiles] .tile').last()).toHaveAttribute('data-tile', 'me');
    expect((await sentVideo(host)).maxBitrate).toBeLessThanOrEqual(250000);

    // Pin the host big: the host's sender to this guest steps up, never above 600 kbps.
    const hostTile = guest.locator('.tile:not([data-tile="me"])');
    await hostTile.locator('.more').click();
    await guest.click('[data-tile-menu] button:has-text("Pin big for me")');
    await expect(guest.locator('[data-tiles]')).toHaveAttribute('data-view', 'speaker');
    await expect(hostTile).toHaveClass(/tile--big/);
    await expect.poll(async () => (await sentVideo(host)).maxBitrate).toBe(600000);
    if (SHOTS) { await guest.setViewportSize({ width: 1280, height: 900 }); await guest.locator('.call').screenshot({ path: `${SHOTS}/05-desktop-speaker.png` }); }
    expect((await sentVideo(host)).scaleResolutionDownBy).toBe(1);

    // Back to grid: the sender drops back to a thumbnail.
    await guest.click('[data-view-toggle]');
    await expect(guest.locator('[data-tiles]')).toHaveAttribute('data-view', 'grid');
    await expect.poll(async () => (await sentVideo(host)).maxBitrate).toBeLessThanOrEqual(250000);
    expect(host.errors.concat(guest.errors)).toEqual([]);
});

test('connection bars show on every remote tile and a dead link drops to audio only', async ({ browser }) => {
    const { host, guest } = await call(browser);
    const q = guest.locator('.tile:not([data-tile="me"]) .q');
    await expect(q).toHaveAttribute('aria-label', /connection/i, { timeout: 10000 });
    // Simulate three bad samples on the guest's link to the host.
    await guest.evaluate(() => {
        const e = [...window.__hangout.av.pcs.values()][0];
        e.hist = ['bad', 'bad'];
        e.tier = 'weak';
        e.pc.getStats = async () => new Map([['p', { type: 'candidate-pair', nominated: true, state: 'succeeded', currentRoundTripTime: 1.2, availableOutgoingBitrate: 20000 }]]);
    });
    await expect(guest.locator('[data-status]')).toContainText('video paused, audio kept', { timeout: 8000 });
    await expect.poll(async () => (await sentVideo(guest)).active).toBe(false);
    await expect(guest.locator('.tile:not([data-tile="me"])')).toHaveClass(/tile--nocam/);
    expect((await sentVideo(host)).active).toBe(true);
});

test('raise hand and reactions reach everyone; junk reactions are dropped', async ({ browser }) => {
    const { host, guest } = await call(browser);
    await guest.click('[data-hand]');
    await expect(guest.locator('[data-hand]')).toHaveText('Lower hand');
    await expect(host.locator('[data-hands]')).toContainText('Karen');
    await expect(host.locator('.tile:not([data-tile="me"]) .badge')).toContainText('✋');
    await guest.click('[data-reacts] button[data-r="🤘"]');
    await expect(host.locator('.tile:not([data-tile="me"]) .react')).toContainText('🤘');
    await guest.evaluate(() => window.__hangoutSend && window.__hangoutSend({ type: 'react', r: '<img src=x>' }));
    await expect(host.locator('.react span')).not.toContainText('<img');
    await guest.click('[data-hand]');
    await expect(host.locator('[data-hands]')).toBeHidden();
});

test('host can mute, turn a camera off, spotlight, lock and take someone off faces; guests cannot forge it', async ({ browser }) => {
    const { host, guest } = await call(browser);
    const guestId = await guest.evaluate(() => window.__hangout.myId);
    await micOn(guest);
    const guestTile = host.locator('.tile:not([data-tile="me"])');

    // A guest forging a host action (unsigned) changes nothing.
    await guest.evaluate(() => window.__hangoutSend({ type: 'host', body: { kind: 'camoff', seq: Date.now() + 1e9, target: '*' }, sig: 'AAAA' }));
    await host.waitForTimeout(500);
    expect(await host.evaluate(() => window.__hangout.av.cam)).toBe(true);

    await guestTile.locator('.more').click();
    await host.click('[data-tile-menu] button:has-text("Mute them")');
    await expect(guest.locator('[data-mic]')).toHaveText('Turn on my mic');
    await expect(guest.locator('[data-status]')).toContainText('The host muted you');
    // Muted, never force-unmuted: the guest can come back on their own.
    await guestTile.locator('.more').click();
    await host.click('[data-tile-menu] button:has-text("Turn their camera off")');
    await expect(guest.locator('[data-cam]')).toHaveText('Turn on my camera');
    await expect.poll(() => guest.evaluate(() => {
        const a = window.__hangout.av;
        if (a.cam) return 'cam-on';
        const live = a.stream && a.stream.getVideoTracks().some((t) => t.readyState === 'live');
        return live ? 'live' : 'off';
    }), { timeout: 5000 }).toBe('off');
    // Observe the all-off publication before resuming, so an earlier mic-on
    // advertisement cannot satisfy the admission check before locking faces.
    await expect.poll(() => host.evaluate((id) => {
        const av = window.__hangout.av;
        return !av.micPeers.has(id) && !av.camPeers.has(id) && !av.peers.has(id);
    }, guestId)).toBe(true);

    await host.locator('[data-tile="me"] .more').click();
    await host.click('[data-tile-menu] button:has-text("Spotlight me for everyone")');
    await expect(guest.locator('.tile:not([data-tile="me"])')).toHaveClass(/tile--big/);

    // Muted by the host, back on by choice (no second explainer).
    await guest.click('[data-mic]');
    await expect(guest.locator('[data-mic]')).toHaveText('Mute my mic');
    await expect.poll(() => host.evaluate((id) => {
        const av = window.__hangout.av;
        return av.micPeers.has(id) && av.peers.has(id);
    }, guestId)).toBe(true);
    await expect(host.locator('.tile:not([data-tile="me"])')).toHaveCount(1);

    await host.click('[data-lock]');
    await expect(host.locator('[data-lock]')).toHaveText('Unlock faces');
    const late = await openBrowser(browser);
    await join(late, host.url(), 'Latecomer');
    await late.click('[data-cam]');
    await expect(late.locator('[data-status]')).toContainText('locked');
    await host.click('[data-lock]');

    await guestTile.locator('.more').click();
    await host.click('[data-tile-menu] button:has-text("Take them off faces")');
    await expect(guest.locator('[data-status]')).toContainText('took you off faces');
    await expect(host.locator('.tile:not([data-tile="me"])')).toHaveCount(0);
    await guest.click('[data-cam]');
    await expect(guest.locator('[data-status]')).toContainText('took you off faces');
});

test('report hides the person for you and tells the host', async ({ browser }) => {
    const { host, guest } = await call(browser);
    await guest.locator('.tile:not([data-tile="me"]) .more').click();
    await guest.click('[data-tile-menu] button:has-text("Report to the host")');
    await expect(guest.locator('.tile:not([data-tile="me"])')).toHaveCount(0);
    // The host is the one reported here, so they see their own report notice.
    await expect(host.locator('[data-status]')).toContainText('reported');
});

test('settings: device pickers, music mode, and a background that never breaks the camera', async ({ browser }) => {
    test.setTimeout(90000);
    const { host, guest } = await call(browser);
    await guest.click('[data-settings]');
    await expect(guest.locator('[data-settings-dlg]')).toBeVisible();
    await expect.poll(() => guest.locator('[data-dev-cam] option').count()).toBeGreaterThan(0);
    await expect(guest.locator('[data-bg-picks] button')).toHaveCount(6);
    if (SHOTS) await guest.screenshot({ path: `${SHOTS}/04-settings-desktop.png` });
    await guest.click('[data-bg="checkerboard"]');
    // Either the background runs (sender gets the processed track) or it falls back politely. Camera stays on.
    await expect.poll(() => guest.evaluate(() => {
        const a = window.__hangout.av;
        if (a.bg.loading) return 'loading';
        if (a.bg.proc) return a.stream.getVideoTracks()[0] === a.bg.proc.processedTrack ? 'running' : 'mismatch';
        return a.bg.choice === 'none' ? 'fell-back' : 'pending';
    }), { timeout: 45000 }).toMatch(/running|fell-back/);
    console.log('background result:', await guest.evaluate(() => (window.__hangout.av.bg.proc ? 'running' : `fell-back: ${window.__hangout.av.bg.error}`)));
    expect(await guest.evaluate(() => window.__hangout.av.cam)).toBe(true);
    const viaSender = await guest.evaluate(() => {
        const e = [...window.__hangout.av.pcs.values()][0];
        return e.senders.video.track === window.__hangout.av.stream.getVideoTracks()[0];
    });
    expect(viaSender).toBe(true);
    await guest.click('[data-bg="none"]');
    await expect.poll(() => guest.evaluate(() => window.__hangout.av.bg.proc)).toBeNull();

    await guest.click('[data-settings-close]');
    await micOn(guest);
    await guest.click('[data-settings]');
    await guest.check('[data-music]');
    await expect.poll(() => guest.evaluate(() => window.__hangout.av.stream.getAudioTracks()[0].getSettings().echoCancellation)).toBe(false);
    await expect.poll(() => guest.evaluate(() => {
        const e = [...window.__hangout.av.pcs.values()][0];
        return e.senders.audio.getParameters().encodings[0].maxBitrate;
    })).toBe(128000);
    await guest.click('[data-settings-close]');
    expect(host.errors.concat(guest.errors)).toEqual([]);
});

test('jam rooms: browser mic starts off and is labelled for talking only', async ({ browser }) => {
    const page = await openBrowser(browser);
    await join(page, roomUrl('&kind=jam'), 'Drummer');
    await expect(page.locator('[data-mic]')).toHaveText('Talk (browser mic)');
    await expect(page.locator('[data-jam-note]')).toContainText('WebJam');
    expect(await page.evaluate(() => window.__hangout.av.mic)).toBe(false);
});

test('a dropped relay connection reconnects and faces come back', async ({ browser }) => {
    const { host, guest } = await call(browser);
    await expect.poll(() => host.evaluate(() => {
        const v = document.querySelector('.tile:not([data-tile="me"]) video');
        return v ? v.videoWidth : 0;
    }), { timeout: 15000 }).toBeGreaterThan(0);
    const before = await guest.evaluate(() => window.__hangout.myId);
    await guest.evaluate(() => window.__hangout.ws.close(3000));
    await expect(guest.locator('[data-status]')).toContainText(/Reconnecting|Back in/);
    await expect.poll(() => guest.evaluate(() => window.__hangout.myId), { timeout: 15000 }).not.toBe(before);
    await expect.poll(() => host.evaluate(() => {
        const v = document.querySelector('.tile:not([data-tile="me"]) video');
        return v && v.videoWidth;
    }), { timeout: 20000 }).toBeGreaterThan(0);
    await expect(host.locator('.tile:not([data-tile="me"])')).toHaveCount(1, { timeout: 20000 });
});

test('a reconnect during camera publication cannot restore a departed peer after decryption', async ({ browser }) => {
    const host = await openBrowser(browser);
    await join(host, roomUrl(), 'Jeff');
    const guest = await openBrowser(browser);
    await join(guest, host.url(), 'Karen');
    await expect(guest.locator('[data-peers]')).toContainText('2 here');
    await camOn(host);
    await micOn(host);
    const oldId = await guest.evaluate(() => window.__hangout.myId);

    // Reproduce a real event ordering: encrypted camera publication is still
    // decrypting when the relay's unencrypted leave notification arrives.
    await host.evaluate((id) => {
        const originalOpen = window.HangoutCore.open;
        const releases = [];
        window.__heldCameraPublication = false;
        window.__heldDepartingChat = false;
        window.__departedWhileDecrypting = false;
        window.__releaseCameraPublication = () => {
            window.HangoutCore.open = originalOpen;
            releases.forEach((release) => release());
        };
        window.HangoutCore.open = async (key, frame) => {
            const msg = await originalOpen(key, frame);
            if (frame.from === id && ((msg.type === 'av' && msg.av?.cam) || msg.text === 'Sent before disconnect')) {
                if (msg.type === 'av') window.__heldCameraPublication = true;
                else window.__heldDepartingChat = true;
                await new Promise((resolve) => { releases.push(resolve); });
            }
            return msg;
        };
        window.__hangout.ws.addEventListener('message', (event) => {
            if (JSON.parse(event.data).left === id) window.__departedWhileDecrypting = true;
        });
    }, oldId);
    await camOn(guest);
    await expect.poll(() => host.evaluate(() => window.__heldCameraPublication)).toBe(true);
    await guest.fill('[data-text]', 'Sent before disconnect');
    await guest.press('[data-text]', 'Enter');
    await expect.poll(() => host.evaluate(() => window.__heldDepartingChat)).toBe(true);
    await guest.evaluate(() => window.__hangout.ws.close(3000));
    await expect.poll(() => host.evaluate(() => window.__departedWhileDecrypting)).toBe(true);
    await host.evaluate(() => window.__releaseCameraPublication());
    await expect.poll(() => guest.evaluate(() => window.__hangout.myId), { timeout: 15000 }).not.toBe(oldId);
    const newId = await guest.evaluate(() => window.__hangout.myId);
    await expect.poll(() => host.evaluate((id) => {
        const v = document.querySelector(`[data-tile="${id}"] video`);
        return v ? v.videoWidth : 0;
    }, newId), { timeout: 20000 }).toBeGreaterThan(0);
    await expect(host.locator(`[data-tile="${oldId}"]`)).toHaveCount(0);
    await expect(host.locator('.tile:not([data-tile="me"])')).toHaveCount(1);
    await expect(host.locator('[data-log]')).toContainText('Sent before disconnect');
    expect(host.errors.concat(guest.errors)).toEqual([]);
});

test('a reconnect does not wait for obsolete peer ICE setup', async ({ browser }) => {
    const host = await openBrowser(browser);
    await join(host, roomUrl(), 'Jeff');
    const guest = await openBrowser(browser);
    await guest.addInitScript(() => {
        document.addEventListener('DOMContentLoaded', () => {
            const create = window.HangoutTurn.createTurnClient;
            window.HangoutTurn.createTurnClient = (options) => {
                const client = create(options);
                const get = client.get;
                let calls = 0;
                client.get = () => {
                    const result = get();
                    // The first call preloads ICE when entering the room.
                    if (++calls !== 2) return result;
                    window.__heldOldIce = true;
                    return new Promise((resolve) => { window.__releaseOldIce = () => result.then(resolve); });
                };
                return client;
            };
        });
    });
    await join(guest, host.url(), 'Karen');
    await expect(guest.locator('[data-peers]')).toContainText('2 here');
    await camOn(guest);
    await expect.poll(() => guest.evaluate(() => window.__heldOldIce)).toBe(true);
    const oldId = await guest.evaluate(() => window.__hangout.myId);
    await guest.evaluate(() => window.__hangout.ws.close(3000));
    await expect.poll(() => guest.evaluate(() => window.__hangout.myId), { timeout: 15000 }).not.toBe(oldId);
    const newId = await guest.evaluate(() => window.__hangout.myId);
    try {
        // Fresh peer negotiation must progress even while the old TURN request
        // remains unresolved. Releasing it later must not replace the fresh PC.
        await expect.poll(() => host.evaluate((id) => {
            const v = document.querySelector(`[data-tile="${id}"] video`);
            return v ? v.videoWidth : 0;
        }, newId), { timeout: 20000 }).toBeGreaterThan(0);
    } finally {
        await guest.evaluate(() => window.__releaseOldIce());
    }
    await expect.poll(() => guest.evaluate(() => window.__hangout.av.pcs.size)).toBe(1);
    expect(host.errors.concat(guest.errors)).toEqual([]);
});

test('initial camera publication stays current when an earlier hello decrypts late', async ({ browser }) => {
    const host = await openBrowser(browser);
    let guest;
    try {
        await join(host, roomUrl(), 'Jeff');
        await camOn(host);
        await host.evaluate(() => {
            const open = window.HangoutCore.open;
            window.HangoutCore.open = async (key, frame) => {
                const msg = await open(key, frame);
                if (msg.type === 'hello' && !msg.reply) {
                    window.HangoutCore.open = open;
                    window.__heldInitialHello = true;
                    await new Promise((resolve) => { window.__releaseInitialHello = resolve; });
                }
                return msg;
            };
        });
        guest = await openBrowser(browser);
        await join(guest, host.url(), 'Karen');
        await expect.poll(() => host.evaluate(() => window.__heldInitialHello)).toBe(true);
        await camOn(guest);
        const guestId = await guest.evaluate(() => window.__hangout.myId);
        // The newer camera advertisement finishes decrypting before the older
        // hello; releasing hello must not replace that current camera state.
        await expect.poll(() => host.evaluate((id) => window.__hangout.av.camPeers.has(id), guestId)).toBe(true);
        await host.evaluate(() => window.__releaseInitialHello());
        await expect.poll(() => guest.evaluate(() => {
            const v = document.querySelector('.tile:not([data-tile="me"]) video');
            return v ? v.videoWidth : 0;
        }), { timeout: 15000 }).toBeGreaterThan(0);
        await expect.poll(() => host.evaluate(() => {
            const v = document.querySelector('.tile:not([data-tile="me"]) video');
            return v ? v.videoWidth : 0;
        }), { timeout: 15000 }).toBeGreaterThan(0);
        expect(await host.evaluate((id) => ({ name: window.__hangout.names.get(id), camera: window.__hangout.av.camPeers.has(id) }), guestId)).toEqual({ name: 'Karen', camera: true });
        expect(host.errors.concat(guest.errors)).toEqual([]);
    } finally {
        const diagnostic = { host: await captureRtcDiagnostics(host), guest: await captureRtcDiagnostics(guest) };
        const diagnosticPath = test.info().outputPath('initial-camera-diagnostics.json');
        await fs.writeFile(diagnosticPath, `${JSON.stringify(diagnostic, null, 2)}\n`);
        await test.info().attach('initial-camera-diagnostics', { path: diagnosticPath, contentType: 'application/json' });
    }
});

test('an older camera-on publication cannot restore a newer camera-off tile', async ({ browser }) => {
    const host = await openBrowser(browser);
    await join(host, roomUrl(), 'Jeff');
    await camOn(host);
    const guest = await openBrowser(browser);
    await join(guest, host.url(), 'Karen');
    await expect(host.locator('[data-peers]')).toContainText('Karen');
    const guestId = await guest.evaluate(() => window.__hangout.myId);
    await host.evaluate((id) => {
        const open = window.HangoutCore.open;
        window.HangoutCore.open = async (key, frame) => {
            const msg = await open(key, frame);
            if (frame.from === id && msg.type === 'av') {
                if (msg.av.cam) {
                    window.__heldCameraOn = true;
                    await new Promise((resolve) => { window.__releaseCameraOn = resolve; });
                } else window.__receivedCameraOff = true;
            }
            return msg;
        };
        window.__restoreCameraDecrypt = () => { window.HangoutCore.open = open; };
    }, guestId);
    await camOn(guest);
    await expect.poll(() => host.evaluate(() => window.__heldCameraOn)).toBe(true);
    await guest.click('[data-cam]');
    await expect(guest.locator('[data-cam]')).toHaveText('Turn on my camera');
    await expect.poll(() => host.evaluate(() => window.__receivedCameraOff)).toBe(true);
    await host.evaluate(async () => {
        window.__restoreCameraDecrypt();
        window.__releaseCameraOn();
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await expect(host.locator(`[data-tile="${guestId}"]`)).toHaveCount(0);
    expect(await host.evaluate((id) => window.__hangout.av.camPeers.has(id), guestId)).toBe(false);
    expect(await guest.evaluate(() => Boolean(window.__hangout.av.rawCam) || window.__hangout.av.stream?.getVideoTracks().some((track) => track.readyState === 'live'))).toBe(false);
    expect(host.errors.concat(guest.errors)).toEqual([]);
});

test('a valid follow-up offer is answered while the previous remote answer is pending', async ({ browser }) => {
    const { host, guest } = await call(browser);
    await expect.poll(() => host.evaluate(() => [...window.__hangout.av.pcs.values()][0]?.pc.signalingState)).toBe('stable');
    await expect.poll(() => guest.evaluate(() => [...window.__hangout.av.pcs.values()][0]?.pc.signalingState)).toBe('stable');
    const hostPolite = await host.evaluate(() => [...window.__hangout.av.pcs.values()][0].polite);
    const impolite = hostPolite ? guest : host;
    const polite = hostPolite ? host : guest;
    await impolite.evaluate(() => {
        const open = window.HangoutCore.open;
        const gates = {};
        window.__heldSdp = [];
        window.__remoteSdpCalls = [];
        window.HangoutCore.open = async (key, frame) => {
            const msg = await open(key, frame);
            if (msg.type === 'rtc' && msg.sdp && !gates[msg.sdp.type]) {
                window.__heldSdp.push(msg.sdp.type);
                await new Promise((resolve) => { gates[msg.sdp.type] = resolve; });
            }
            return msg;
        };
        window.__releaseSdp = () => {
            window.HangoutCore.open = open;
            gates.answer();
            gates.offer();
        };
        const pc = [...window.__hangout.av.pcs.values()][0].pc;
        const setRemote = pc.setRemoteDescription.bind(pc);
        let answerPending = false;
        pc.setRemoteDescription = (description) => {
            window.__remoteSdpCalls.push({ type: description.type, state: pc.signalingState, answerPending });
            if (description.type === 'answer') answerPending = true;
            const result = setRemote(description);
            if (description.type === 'answer') result.then(() => { answerPending = false; }, () => { answerPending = false; });
            return result;
        };
        pc.restartIce();
    });
    await expect.poll(() => impolite.evaluate(() => window.__heldSdp.includes('answer'))).toBe(true);
    await expect.poll(() => polite.evaluate(() => [...window.__hangout.av.pcs.values()][0].pc.signalingState)).toBe('stable');
    await polite.evaluate(() => [...window.__hangout.av.pcs.values()][0].pc.restartIce());
    await expect.poll(() => impolite.evaluate(() => window.__heldSdp.includes('offer'))).toBe(true);
    // Resolve both decryptions in the same task: the valid next offer reaches
    // the browser's native operations chain while SRD(answer) is still pending.
    await impolite.evaluate(() => window.__releaseSdp());
    try {
        await expect.poll(() => impolite.evaluate(() => window.__remoteSdpCalls.some((entry) => entry.type === 'offer'))).toBe(true);
        expect(await impolite.evaluate(() => window.__remoteSdpCalls.some((entry) => entry.type === 'offer' && entry.answerPending && entry.state === 'have-local-offer'))).toBe(true);
        await expect.poll(() => polite.evaluate(() => [...window.__hangout.av.pcs.values()][0].pc.signalingState)).toBe('stable');
        await expect.poll(() => impolite.evaluate(() => [...window.__hangout.av.pcs.values()][0].pc.signalingState)).toBe('stable');
        expect(await impolite.evaluate(() => [...window.__hangout.av.pcs.values()][0].settingRemoteAnswer)).toBe(false);
        for (const page of [host, guest]) {
            await expect.poll(() => page.evaluate(() => [...window.__hangout.av.pcs.values()][0].pc.connectionState)).toBe('connected');
            await expect.poll(() => page.evaluate(() => document.querySelector('.tile:not([data-tile="me"]) video')?.videoWidth || 0)).toBeGreaterThan(0);
        }
    } finally {
        const diagnostic = {
            impolite: await impolite.evaluate(() => {
                const entry = [...window.__hangout.av.pcs.values()][0];
                return { state: entry.pc.signalingState, ignoreOffer: entry.ignoreOffer, held: window.__heldSdp, nativeCalls: window.__remoteSdpCalls };
            }),
            polite: await polite.evaluate(() => ({ state: [...window.__hangout.av.pcs.values()][0].pc.signalingState }))
        };
        await test.info().attach('sdp-overlap-state', { body: JSON.stringify(diagnostic), contentType: 'application/json' });
    }
    expect(host.errors.concat(guest.errors)).toEqual([]);
});

test('a pending remote offer prevents an obsolete local offer from entering the native chain', async ({ browser }) => {
    const { host, guest } = await call(browser);
    for (const page of [host, guest]) {
        await expect.poll(() => page.evaluate(() => [...window.__hangout.av.pcs.values()][0].pc.signalingState)).toBe('stable');
    }
    const target = await host.evaluate(() => [...window.__hangout.av.pcs.values()][0].polite) ? host : guest;
    const other = target === host ? guest : host;
    await target.evaluate(() => {
        const pc = [...window.__hangout.av.pcs.values()][0].pc;
        const createOffer = pc.createOffer.bind(pc);
        const setRemote = pc.setRemoteDescription.bind(pc);
        const setLocal = pc.setLocalDescription.bind(pc);
        window.__localOfferProof = { overlap: false, localDescriptions: [] };
        pc.createOffer = async (...args) => {
            pc.createOffer = createOffer;
            const offer = await createOffer(...args);
            window.__localOfferReady = true;
            return new Promise((resolve) => { window.__releaseLocalOffer = () => resolve(offer); });
        };
        pc.setRemoteDescription = (description) => {
            const result = setRemote(description);
            if (description.type === 'offer' && window.__releaseLocalOffer) {
                window.__localOfferProof.overlap = pc.signalingState === 'stable';
                const release = window.__releaseLocalOffer;
                window.__releaseLocalOffer = null;
                release();
            }
            return result;
        };
        pc.setLocalDescription = (description) => {
            const record = { type: description.type, before: pc.signalingState, result: 'pending' };
            if (window.__localOfferProof.localDescriptions.length < 20) window.__localOfferProof.localDescriptions.push(record);
            const result = setLocal(description);
            result.then(() => { record.result = 'fulfilled'; record.after = pc.signalingState; }, (error) => {
                record.result = 'rejected'; record.after = pc.signalingState;
                record.error = ['InvalidStateError', 'OperationError', 'TypeError'].includes(error.name) ? error.name : 'Other';
            });
            return result;
        };
        pc.restartIce();
    });
    await expect.poll(() => target.evaluate(() => window.__localOfferReady)).toBe(true);
    await other.evaluate(() => [...window.__hangout.av.pcs.values()][0].pc.restartIce());
    try {
        await expect.poll(() => target.evaluate(() => window.__localOfferProof.overlap)).toBe(true);
        for (const page of [host, guest]) {
            await expect.poll(() => page.evaluate(() => [...window.__hangout.av.pcs.values()][0].pc.signalingState)).toBe('stable');
            await expect.poll(() => page.evaluate(() => [...window.__hangout.av.pcs.values()][0].pc.connectionState)).toBe('connected');
            await expect.poll(() => page.evaluate(() => document.querySelector('.tile:not([data-tile="me"]) video')?.videoWidth || 0)).toBeGreaterThan(0);
        }
        expect(await target.evaluate(() => window.__localOfferProof.localDescriptions.filter((entry) => entry.result === 'rejected'))).toEqual([]);
        expect(await target.evaluate(() => [...window.__hangout.av.pcs.values()][0].remoteOfferPending)).toBe(false);
    } finally {
        const diagnostic = {
            overlap: await target.evaluate(() => window.__localOfferProof),
            host: await captureRtcDiagnostics(host), guest: await captureRtcDiagnostics(guest)
        };
        const diagnosticPath = test.info().outputPath('pending-remote-offer.json');
        await fs.writeFile(diagnosticPath, `${JSON.stringify(diagnostic, null, 2)}\n`);
        await test.info().attach('pending-remote-offer', { path: diagnosticPath, contentType: 'application/json' });
    }
    expect(host.errors.concat(guest.errors)).toEqual([]);
});

test('phones: portrait tiles, call bar sticks to the bottom in thumb reach, 44px targets', async ({ browser }) => {
    const opts = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' };
    const { host, guest } = await call(browser, opts);
    const tile = await guest.locator('.tile:not([data-tile="me"])').boundingBox();
    expect(tile.height).toBeGreaterThan(tile.width); // portrait
    await expect(guest.locator('[data-share]')).toBeHidden(); // no screen share on phones
    const bar = guest.locator('.callbar');
    await expect(bar).toHaveCSS('position', 'fixed');
    const vb = await bar.boundingBox();
    expect(vb.y + vb.height).toBeGreaterThan(844 - 4); // pinned to the bottom edge, in thumb reach
    for (const sel of ['[data-mic]', '[data-cam]', '[data-hand]']) {
        const b = await guest.locator(sel).boundingBox();
        expect(b.height, sel).toBeGreaterThanOrEqual(44);
    }
    const settings = await guest.evaluate(() => window.__hangout.av.rawCam.getSettings());
    expect(settings.frameRate).toBeLessThanOrEqual(20); // battery-friendly default
    if (SHOTS) {
        await guest.locator('.call').evaluate((e) => e.scrollIntoView());
        await guest.screenshot({ path: `${SHOTS}/01-phone-grid.png` });
        await host.locator('[data-reacts] button[data-r="🔥"]').click();
        await guest.locator('.tile:not([data-tile="me"]) .more').click();
        await guest.screenshot({ path: `${SHOTS}/02-phone-tile-menu.png` });
        await guest.click('[data-tile-menu] button:has-text("Pin big for me")');
        await guest.locator('.call').evaluate((e) => e.scrollIntoView());
        await guest.screenshot({ path: `${SHOTS}/03-phone-speaker.png` });
    }
});

test('camera blocked: one tap joins with voice only and the others see an audio tile', async ({ browser }) => {
    const host = await openBrowser(browser);
    await join(host, roomUrl(), 'Jeff');
    await camOn(host);
    const guest = await openBrowser(browser);
    await guest.addInitScript(() => {
        const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = (c) => (c && c.video ? Promise.reject(new DOMException('Permission denied', 'NotAllowedError')) : real(c));
    });
    await join(guest, host.url(), 'Karen');
    await guest.click('[data-cam]');
    await guest.click('[data-ask-yes]'); // camera explainer
    await expect(guest.locator('[data-ask-title]')).toHaveText('Camera’s not available');
    await guest.click('[data-ask-yes]'); // join with voice
    await expect(guest.locator('[data-mic]')).toHaveText('Mute my mic');
    await expect(guest.locator('[data-cam]')).toHaveText('Turn on my camera');
    await expect(guest.locator('[data-status]')).toContainText('voice only');
    expect(await guest.evaluate(() => window.__hangout.av.stream.getVideoTracks().length)).toBe(0);
    // The host sees Karen as an audio tile (initial, no video) and still sends their camera.
    const karen = host.locator('.tile:not([data-tile="me"])');
    await expect(karen).toHaveClass(/tile--nocam/, { timeout: 15000 });
    await expect(karen.locator('.nm')).toHaveText('Karen');
    await expect.poll(() => guest.evaluate(() => {
        const v = document.querySelector('.tile:not([data-tile="me"]) video');
        return v ? v.videoWidth : 0;
    }), { timeout: 15000 }).toBeGreaterThan(0);
    await expect.poll(() => host.evaluate(() => [...window.__hangout.av.pcs.values()][0].pc.connectionState), { timeout: 15000 }).toBe('connected');
});

test('host camera-off targets only that peer; other cameras stay on', async ({ browser }) => {
    const host = await openBrowser(browser);
    await join(host, roomUrl(), 'Jeff');
    const invite = host.url();
    const pat = await openBrowser(browser);
    await join(pat, invite, 'Pat');
    const sam = await openBrowser(browser);
    await join(sam, invite, 'Sam');
    await camOn(pat);
    await camOn(sam);
    await expect.poll(() => host.locator('.tile:not([data-tile="me"]) video').count()).toBe(2, { timeout: 15000 });

    const patTile = host.locator('.tile').filter({ hasText: 'Pat' });
    await patTile.locator('.more').click();
    await host.click('[data-tile-menu] button:has-text("Turn their camera off")');
    await expect(pat.locator('[data-cam]')).toHaveText('Turn on my camera');
    await expect(sam.locator('[data-cam]')).toHaveText('Turn off my camera');
    await expect.poll(() => host.evaluate(() => {
        const tiles = [...document.querySelectorAll('[data-tiles] .tile:not([data-tile="me"])')];
        const samTile = tiles.find((t) => t.textContent.includes('Sam'));
        const v = samTile && samTile.querySelector('video');
        return v && v.videoWidth > 0;
    }), { timeout: 15000 }).toBe(true);
});

test('no host or relay action can turn a guest camera on', async ({ browser }) => {
    const { host, guest } = await call(browser);
    const guestTile = host.locator('.tile:not([data-tile="me"])');
    await guestTile.locator('.more').click();
    await host.click('[data-tile-menu] button:has-text("Turn their camera off")');
    const camOff = () => guest.evaluate(() => {
        const a = window.__hangout.av;
        if (a.cam) return 'cam-flag';
        const live = a.stream && a.stream.getVideoTracks().some((t) => t.readyState === 'live');
        return live ? 'live' : 'off';
    });
    await expect.poll(camOff, { timeout: 8000 }).toBe('off');

    await guest.evaluate(() => window.__hangoutSend({
        type: 'host',
        body: { kind: 'camoff', seq: Date.now() + 1e9, target: '*' },
        sig: 'AAAA'
    }));
    await guest.waitForTimeout(400);
    await expect.poll(camOff, { timeout: 8000 }).toBe('off');
    await expect(guest.locator('[data-cam]')).toHaveText('Turn on my camera');
});

test('send queue: a signaling burst never loses the offer or answer', async ({ browser }) => {
    const page = await openBrowser(browser);
    await join(page, roomUrl(), 'Burst');
    const kept = await page.evaluate(async () => {
        const send = window.__hangoutSend;
        const pace = window.__hangoutPace;
        pace.tokens = 0; pace.last = Date.now();
        await send({ type: 'rtc', to: 'x', sdp: { type: 'offer', sdp: 'v=0' } });
        for (let i = 0; i < 260; i += 1) await send({ type: 'rtc', to: 'x', ice: { candidate: `c${i}` } });
        await send({ type: 'rtc', to: 'x', sdp: { type: 'answer', sdp: 'v=0' } });
        return { len: pace.queue.length, ice: pace.queue.filter((q) => q.ice).length };
    });
    expect(kept.len).toBeLessThanOrEqual(200);
    expect(kept.len - kept.ice).toBeGreaterThanOrEqual(2); // offer + answer survived
});

async function observeOutboundAv(page) {
    await page.evaluate(() => {
        const open = window.HangoutCore.open;
        window.__outboundAvProof = { received: [], decryptions: [] };
        window.HangoutCore.open = async (key, frame) => {
            const decoding = open(key, frame);
            if (window.__outboundAvProof.decryptions.length < 100) window.__outboundAvProof.decryptions.push(decoding);
            const msg = await decoding;
            if (['hello', 'av'].includes(msg.type) && window.__outboundAvProof.received.length < 40) {
                window.__outboundAvProof.received.push({ type: msg.type, from: frame.from, camera: Boolean(msg.av?.cam) });
            }
            return msg;
        };
    });
}

async function settleOutboundAv(page) {
    await page.evaluate(async () => {
        await Promise.allSettled(window.__outboundAvProof.decryptions);
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

const captureIsOff = (page) => page.evaluate(() => {
    const av = window.__hangout.av;
    return !av.cam && !av.rawCam && !av.stream?.getVideoTracks().some((track) => track.readyState === 'live');
});

test('outbound generation: delayed camera encryption cannot publish through a replacement relay identity', async ({ browser }) => {
    const host = await openBrowser(browser);
    await join(host, roomUrl(), 'Jeff');
    await observeOutboundAv(host);
    const guest = await openBrowser(browser);
    await join(guest, host.url(), 'Karen');
    await expect(host.locator('[data-peers]')).toContainText('Karen');
    await camOn(guest);
    const oldId = await guest.evaluate(() => window.__hangout.myId);
    await expect.poll(() => host.evaluate((id) => window.__hangout.av.camPeers.has(id), oldId)).toBe(true);

    await guest.evaluate(() => {
        const seal = window.HangoutCore.seal;
        window.HangoutCore.seal = async (key, msg) => {
            const frame = await seal(key, msg);
            if (msg.type === 'av' && msg.av?.cam) {
                window.HangoutCore.seal = seal;
                window.__heldOldOutboundAv = true;
                await new Promise((resolve) => { window.__releaseOldOutboundAv = resolve; });
            }
            return frame;
        };
        const av = window.__hangout.av;
        window.__heldOutboundSend = window.__hangoutSend({ type: 'av', av: { cam: av.cam, mic: av.mic } });
    });
    await expect.poll(() => guest.evaluate(() => window.__heldOldOutboundAv)).toBe(true);
    await guest.click('[data-cam]');
    await expect(guest.locator('[data-cam]')).toHaveText('Turn on my camera');
    expect(await captureIsOff(guest)).toBe(true);
    await expect.poll(() => host.evaluate((id) => window.__hangout.av.camPeers.has(id), oldId)).toBe(false);

    await guest.evaluate(() => window.__hangout.ws.close(3000));
    await expect.poll(() => guest.evaluate(() => window.__hangout.myId), { timeout: 15000 }).not.toBe(oldId);
    const replacement = await guest.evaluate(() => window.__hangout.myId);
    await expect.poll(() => host.evaluate((id) => window.__outboundAvProof.received.some((entry) => entry.type === 'hello' && entry.from === id && !entry.camera), replacement)).toBe(true);

    // The real send began on the old socket. Its encryption completes only
    // after the replacement identity has advertised the actual camera-off state.
    await guest.evaluate(async () => {
        window.__releaseOldOutboundAv();
        await window.__heldOutboundSend;
        await window.__hangoutSend({ type: 'chat', name: window.__hangout.name, text: 'After held camera encryption' });
    });
    await expect(host.locator('[data-log]')).toContainText('After held camera encryption');
    await settleOutboundAv(host);
    const diagnostic = await host.evaluate((id) => ({
        cameraOnFromReplacement: window.__outboundAvProof.received.filter((entry) => entry.type === 'av' && entry.from === id && entry.camera).length,
        currentCamera: window.__hangout.av.camPeers.has(id),
        barrierChatCount: window.__hangout.state.chat.filter((line) => line.text === 'After held camera encryption').length
    }), replacement);
    diagnostic.identityChanged = replacement !== oldId;
    diagnostic.captureOff = await captureIsOff(guest);
    await test.info().attach('outbound-encryption-generation', { body: JSON.stringify(diagnostic), contentType: 'application/json' });
    expect(diagnostic.captureOff).toBe(true);
    expect(diagnostic.barrierChatCount).toBe(1);
    expect(diagnostic.cameraOnFromReplacement).toBe(0);
    expect(diagnostic.currentCamera).toBe(false);
    await expect(host.locator(`[data-tile="${replacement}"]`)).toHaveCount(0);
    expect(host.errors.concat(guest.errors)).toEqual([]);
});

test('outbound generation: reconnect drops paced camera state while preserving one queued chat', async ({ browser }) => {
    const host = await openBrowser(browser);
    await join(host, roomUrl(), 'Jeff');
    await observeOutboundAv(host);
    const guest = await openBrowser(browser);
    await join(guest, host.url(), 'Karen');
    await expect(host.locator('[data-peers]')).toContainText('Karen');
    await camOn(guest);
    const oldId = await guest.evaluate(() => window.__hangout.myId);
    await expect.poll(() => host.evaluate((id) => window.__hangout.av.camPeers.has(id), oldId)).toBe(true);

    await guest.evaluate(async () => {
        const pace = window.__hangoutPace;
        clearTimeout(pace.timer);
        // Keep the bounded real send queue paused across the reconnect without
        // modifying its contents or constructing encrypted relay frames by hand.
        pace.timer = setTimeout(() => {}, 30000);
        const av = window.__hangout.av;
        await window.__hangoutSend({ type: 'av', av: { cam: av.cam, mic: av.mic } });
    });
    await guest.fill('[data-text]', 'Queued before the relay reconnect');
    await guest.press('[data-text]', 'Enter');
    await expect.poll(() => guest.evaluate(() => window.__hangoutPace.queue.length)).toBeGreaterThanOrEqual(2);
    await guest.click('[data-cam]');
    await expect(guest.locator('[data-cam]')).toHaveText('Turn on my camera');
    expect(await captureIsOff(guest)).toBe(true);
    const queuedBeforeReconnect = await guest.evaluate(() => window.__hangoutPace.queue.length);

    await guest.evaluate(() => window.__hangout.ws.close(3000));
    await expect.poll(() => guest.evaluate(() => window.__hangout.myId), { timeout: 15000 }).not.toBe(oldId);
    const replacement = await guest.evaluate(() => window.__hangout.myId);
    await guest.evaluate(async () => {
        const pace = window.__hangoutPace;
        clearTimeout(pace.timer); pace.timer = 0;
        pace.tokens = 24; pace.last = Date.now();
        await window.__hangoutSend({ type: 'chat', name: window.__hangout.name, text: 'After paced queue drain' });
    });
    await expect(host.locator('[data-log]')).toContainText('After paced queue drain');
    await settleOutboundAv(host);
    const diagnostic = await host.evaluate((id) => ({
        cameraOnFromReplacement: window.__outboundAvProof.received.filter((entry) => entry.type === 'av' && entry.from === id && entry.camera).length,
        queuedChatCount: window.__hangout.state.chat.filter((line) => line.text === 'Queued before the relay reconnect').length,
        barrierChatCount: window.__hangout.state.chat.filter((line) => line.text === 'After paced queue drain').length
    }), replacement);
    diagnostic.queuedBeforeReconnect = queuedBeforeReconnect;
    diagnostic.identityChanged = replacement !== oldId;
    diagnostic.captureOff = await captureIsOff(guest);
    await test.info().attach('outbound-paced-generation', { body: JSON.stringify(diagnostic), contentType: 'application/json' });
    expect(diagnostic.captureOff).toBe(true);
    expect(diagnostic.queuedChatCount).toBe(1);
    expect(diagnostic.barrierChatCount).toBe(1);
    expect(diagnostic.cameraOnFromReplacement).toBe(0);
    expect(host.errors.concat(guest.errors)).toEqual([]);
});
