// Two real browsers in one hidden room, synced over the local stand-in for the relay Worker.
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const SLUG = '45662413410ed051';
const KEY = 'local-preview-key-0001';
const FAKE_YT = path.join(__dirname, 'support/fake-youtube.js');

test.use({
    permissions: ['camera', 'microphone'],
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--disable-features=WebRtcHideLocalIpsWithMdns'] }
});
test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium carries the two-browser sync suite');

let relay;
test.beforeAll(async ({ baseURL }) => {
    const { startRelay } = await import('../../scripts/hangout-relay-dev.mjs');
    relay = await startRelay({ previewKey: KEY, origins: new URL(baseURL).origin });
});
test.afterAll(async () => { if (relay) await relay.close(); });

async function openBrowser(browser) {
    const context = await browser.newContext({ permissions: ['camera', 'microphone'] });
    await context.route(/youtube\.com|ytimg|googlevideo/, (route) => route.abort());
    await context.route('https://www.youtube.com/iframe_api', (route) => route.fulfill({ path: FAKE_YT, contentType: 'text/javascript' }));
    return context.newPage();
}
const roomUrl = (extra = '') => `/r/${SLUG}/?preview=${KEY}&relay=ws://127.0.0.1:${relay.port}${extra}`;

async function hostAndGuest(browser) {
    const host = await openBrowser(browser);
    await host.goto(roomUrl());
    await host.fill('[data-name]', 'Jeff');
    await host.click('[data-enter]');
    await expect(host.locator('[data-room]')).toBeVisible();
    const invite = host.url();
    expect(invite).toMatch(/#r=[A-Za-z0-9_-]{24}&h=[A-Za-z0-9_-]+&a=/);
    const guest = await openBrowser(browser);
    await guest.goto(invite);
    await expect(guest.locator('[data-gate-title]')).toHaveText('You’re invited');
    await guest.fill('[data-name]', 'Karen');
    await guest.click('[data-enter]');
    await expect(guest.locator('[data-peers]')).toContainText('2 here');
    await expect(host.locator('[data-peers]')).toContainText('Karen');
    return { host, guest, invite };
}

async function drawLine(page) {
    const box = await page.locator('[data-canvas]').boundingBox();
    await page.mouse.move(box.x + 40, box.y + 40);
    await page.mouse.down();
    for (let i = 1; i <= 10; i += 1) await page.mouse.move(box.x + 40 + i * 20, box.y + 40 + i * 10);
    await page.mouse.up();
}

test('next-show link hides after the set time', async ({ browser }) => {
    const page = await openBrowser(browser);
    await page.clock.install({ time: new Date('2026-10-15T12:00:00-05:00') });
    await page.goto(roomUrl());
    await expect(page.locator('[data-next-show]')).toBeVisible();
    await page.clock.setFixedTime(new Date('2026-10-24T16:45:01-05:00'));
    await page.evaluate(() => window.StalemateCountdown.apply(document));
    await expect(page.locator('[data-next-show]')).toBeHidden();
});

test('without the preview key the room stays shut and never dials the relay', async ({ browser }) => {
    const page = await openBrowser(browser);
    const sockets = [];
    page.on('websocket', (ws) => sockets.push(ws.url()));
    await page.goto(`/r/${SLUG}/`);
    await expect(page.locator('[data-gate-title]')).toHaveText('Not open yet');
    await expect(page.locator('[data-enter]')).toBeHidden();
    const robots = await page.locator('meta[name="robots"]').getAttribute('content');
    expect(robots).toContain('noindex');
    expect(sockets).toEqual([]);
});

test('copied invite link joins without the preview query param', async ({ browser }) => {
    const host = await openBrowser(browser);
    await host.goto(roomUrl());
    await host.fill('[data-name]', 'Jeff');
    await host.click('[data-enter]');
    const invite = await host.evaluate(() => {
        const link = new URL(window.location.href);
        link.searchParams.delete('preview');
        return link.href;
    });
    expect(invite).not.toMatch(/[?&]preview=/);
    expect(invite).toMatch(/#r=[A-Za-z0-9_-]{24}&h=[A-Za-z0-9_-]+&a=[A-Za-z0-9_-]+/);
    const guest = await openBrowser(browser);
    await guest.goto(invite);
    await expect(guest.locator('[data-gate-title]')).toHaveText('You’re invited');
    await guest.fill('[data-name]', 'Karen');
    await guest.click('[data-enter]');
    await expect(guest.locator('[data-peers]')).toContainText('2 here');
    await expect(host.locator('[data-peers]')).toContainText('Karen');
});

test('a wrong preview key is refused by the relay', async ({ browser }) => {
    const page = await openBrowser(browser);
    await page.goto(`/r/${SLUG}/?preview=wrong-key-wrong-key&relay=ws://127.0.0.1:${relay.port}`);
    await page.click('[data-enter]');
    await expect(page.locator('[data-gate-status]')).toContainText('Couldn’t get in');
});

test('drawing, chat and the host wipe sync between two browsers', async ({ browser }) => {
    const { host, guest } = await hostAndGuest(browser);
    await drawLine(guest);
    await expect.poll(() => host.evaluate(() => window.__hangout.state.strokes.length)).toBeGreaterThan(0);
    await expect.poll(() => host.evaluate(() => window.__hangout.state.strokes[0].pts.length)).toBeGreaterThan(5);
    await guest.fill('[data-text]', 'happy little trees');
    await guest.press('[data-text]', 'Enter');
    await expect(host.locator('[data-log]')).toContainText('Karen: happy little trees');
    await host.fill('[data-text]', 'beat devil');
    await host.press('[data-text]', 'Enter');
    await expect(guest.locator('[data-log]')).toContainText('Jeff: beat devil');

    await expect(guest.locator('[data-clear]')).toBeHidden();
    await expect(guest.locator('[data-picks]')).toBeHidden();
    // A guest forging a host wipe is ignored: no valid signature.
    await guest.evaluate(async () => {
        const app = window.__hangout;
        const frame = await window.HangoutCore.seal(app.key, { type: 'host', body: { kind: 'clear', seq: Date.now() + 9e9 }, sig: 'AAAA' });
        app.ws.send(JSON.stringify(frame));
    });
    await host.waitForTimeout(400);
    expect(await host.evaluate(() => window.__hangout.state.strokes.length)).toBeGreaterThan(0);

    await host.click('[data-clear]');
    await expect.poll(() => guest.evaluate(() => window.__hangout.state.strokes.length)).toBe(0);
});

test('late joiner who receives snapshot from a guest still gets lastHostSeq and ignores replayed clear', async ({ browser }) => {
    const { host, guest, invite } = await hostAndGuest(browser);

    await guest.evaluate(() => {
        window.__capturedClear = null;
        const orig = window.__hangout.ws.onmessage;
        window.__hangout.ws.onmessage = async (e) => {
            const frame = JSON.parse(e.data);
            if (frame.c) {
                const msg = await window.HangoutCore.open(window.__hangout.key, frame);
                if (msg.type === 'host' && msg.body.kind === 'clear') window.__capturedClear = msg;
            }
            return orig(e);
        };
    });

    await drawLine(host);
    await host.click('[data-clear]');
    await expect.poll(() => guest.evaluate(() => !!window.__capturedClear)).toBe(true);
    const clearSeq = await guest.evaluate(() => window.__capturedClear.body.seq);
    await drawLine(host);

    const late = await openBrowser(browser);
    await late.goto(invite);
    await late.fill('[data-name]', 'Pat');
    await late.click('[data-enter]');
    await expect.poll(() => late.evaluate(() => window.__hangout.state.strokes.length)).toBeGreaterThan(0);

    const guestId = await guest.evaluate(() => window.__hangout.myId);
    const lateId = await late.evaluate(() => window.__hangout.myId);
    await late.evaluate((gid) => {
        const app = window.__hangout;
        app.snapshotDone = false;
        app.snapshotFrom = gid;
        app.snapshotHasSeqProof = false;
        app.lastHostSeq = 0;
    }, guestId);

    await guest.evaluate(async (to) => {
        const app = window.__hangout;
        const frame = await window.HangoutCore.seal(app.key, {
            type: 'snapshot',
            to,
            strokes: app.state.strokes.slice(-400),
            chunk: false,
            first: true,
            done: true
        });
        app.ws.send(JSON.stringify(frame));
    }, lateId);
    expect(await late.evaluate(() => window.__hangout.snapshotDone)).toBe(true);

    await host.evaluate(async ({ to, seq }) => {
        const app = window.__hangout;
        const canonical = (body) => new TextEncoder().encode(JSON.stringify(body));
        const b64u = (bytes) => {
            let s = '';
            bytes.forEach((b) => { s += String.fromCharCode(b); });
            return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        };
        const sig = new Uint8Array(await crypto.subtle.sign(
            { name: 'ECDSA', hash: 'SHA-256' },
            app.hostPriv,
            canonical({ kind: 'seq', seq })
        ));
        const lastHostSeqSigned = { type: 'host', body: { kind: 'seq', seq }, sig: b64u(sig) };
        const frame = await window.HangoutCore.seal(app.key, {
            type: 'snapshot',
            to,
            strokes: app.state.strokes.slice(-400),
            chunk: false,
            first: true,
            done: true,
            lastHostSeqSigned
        });
        app.ws.send(JSON.stringify(frame));
    }, { to: lateId, seq: clearSeq });

    await expect.poll(() => late.evaluate(() => window.__hangout.snapshotDone)).toBe(true);
    expect(await late.evaluate(() => window.__hangout.lastHostSeq)).toBeGreaterThanOrEqual(clearSeq);

    await guest.evaluate(async () => {
        const app = window.__hangout;
        const frame = await window.HangoutCore.seal(app.key, window.__capturedClear);
        app.ws.send(JSON.stringify(frame));
    });
    await late.waitForTimeout(500);
    expect(await late.evaluate(() => window.__hangout.state.strokes.length)).toBeGreaterThan(0);
});

test('multi-chunk host snapshot (>100 strokes) with lastHostSeqSigned replaces an unverified guest snapshot without losing earlier chunks', async ({ browser }) => {
    const { host, guest, invite } = await hostAndGuest(browser);
    const strokeCount = 150;
    await host.evaluate((n) => {
        const app = window.__hangout;
        for (let i = 0; i < n; i += 1) {
            app.state.strokes.push({
                id: `bulk-${i}`,
                color: '#221b15',
                size: 8,
                pts: [[i % 50, i % 50], [(i % 50) + 1, (i % 50) + 1]]
            });
        }
    }, strokeCount);

    const late = await openBrowser(browser);
    await late.goto(invite);
    await late.fill('[data-name]', 'Pat');
    await late.click('[data-enter]');
    await expect.poll(() => late.evaluate(() => window.__hangout.snapshotDone)).toBe(true);
    expect(await host.evaluate(() => window.__hangout.state.strokes.length)).toBeGreaterThanOrEqual(strokeCount);

    const guestId = await guest.evaluate(() => window.__hangout.myId);
    await late.evaluate(({ gid, bogus }) => {
        const app = window.__hangout;
        window.HangoutCore.apply(app.state, {
            type: 'snapshot',
            state: { strokes: bogus, chat: [], append: false }
        });
        app.snapshotDone = true;
        app.snapshotFrom = gid;
        app.snapshotHasSeqProof = false;
        app.lastHostSeq = 0;
    }, {
        gid: guestId,
        bogus: [{ id: 'bogus-only', color: '#000000', size: 4, pts: [[0, 0]] }]
    });
    expect(await late.evaluate(() => window.__hangout.state.strokes[0].id)).toBe('bogus-only');

    await guest.evaluate(() => window.__hangout.ws.close());
    await late.evaluate(async () => {
        const app = window.__hangout;
        const frame = await window.HangoutCore.seal(app.key, {
            type: 'hello',
            name: app.name,
            av: { mic: false, cam: false, canvas: false }
        });
        app.ws.send(JSON.stringify(frame));
    });

    await expect.poll(() => late.evaluate(() => window.__hangout.state.strokes.length)).toBeGreaterThanOrEqual(strokeCount);
    expect(await late.evaluate(() => window.__hangout.state.strokes.some((s) => s.id === 'bulk-0'))).toBe(true);
    expect(await late.evaluate(() => window.__hangout.state.strokes.some((s) => s.id === 'bulk-120'))).toBe(true);
    expect(await late.evaluate(() => window.__hangout.state.strokes.some((s) => s.id === 'bogus-only'))).toBe(false);
});

test('snapshot with a non-video host signature in msg.video still renders strokes and chat', async ({ browser }) => {
    const { host, invite } = await hostAndGuest(browser);
    await drawLine(host);
    await host.fill('[data-text]', 'canvas ok');
    await host.press('[data-text]', 'Enter');

    const late = await openBrowser(browser);
    await late.goto(invite);
    await late.fill('[data-name]', 'Pat');
    await late.click('[data-enter]');

    const lateId = await late.evaluate(() => window.__hangout.myId);
    await late.evaluate(() => {
        const app = window.__hangout;
        app.snapshotDone = false;
        app.snapshotFrom = null;
        app.snapshotHasSeqProof = false;
        app.state.strokes = [];
        app.state.chat = [];
    });

    await host.evaluate(async ({ to }) => {
        const app = window.__hangout;
        const body = { kind: 'clear', seq: app.lastHostSeq || Date.now() };
        const canonical = new TextEncoder().encode(JSON.stringify(body));
        const sig = new Uint8Array(await crypto.subtle.sign(
            { name: 'ECDSA', hash: 'SHA-256' },
            app.hostPriv,
            canonical
        ));
        const b64u = (bytes) => {
            let s = '';
            bytes.forEach((b) => { s += String.fromCharCode(b); });
            return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        };
        const signed = { type: 'host', body, sig: b64u(sig) };
        const frame = await window.HangoutCore.seal(app.key, {
            type: 'snapshot',
            to,
            strokes: app.state.strokes.slice(-400),
            chat: app.state.chat.slice(-50),
            video: { signed },
            chunk: false,
            first: true,
            done: true
        });
        app.ws.send(JSON.stringify(frame));
    }, { to: lateId });

    await expect.poll(() => late.evaluate(() => window.__hangout.state.strokes.length)).toBeGreaterThan(0);
    await expect(late.locator('[data-log]')).toContainText('canvas ok');
});

test('late joiner receives lastHostSeq and ignores replayed clear messages', async ({ browser }) => {
    const { host, guest, invite } = await hostAndGuest(browser);

    await guest.evaluate(() => {
        window.__capturedClear = null;
        const orig = window.__hangout.ws.onmessage;
        window.__hangout.ws.onmessage = async (e) => {
            const raw = e.data;
            const frame = JSON.parse(raw);
            if (frame.c) {
                const msg = await window.HangoutCore.open(window.__hangout.key, frame);
                if (msg.type === 'host' && msg.body.kind === 'clear') window.__capturedClear = msg;
            }
            return orig(e);
        };
    });

    await drawLine(host);
    await host.click('[data-clear]');
    await expect.poll(() => guest.evaluate(() => !!window.__capturedClear)).toBe(true);

    await drawLine(host);

    const late = await openBrowser(browser);
    await late.goto(invite);
    await late.click('[data-enter]');
    await expect.poll(() => late.evaluate(() => window.__hangout.state.strokes.length)).toBeGreaterThan(0);

    await guest.evaluate(async () => {
        const app = window.__hangout;
        const frame = await window.HangoutCore.seal(app.key, window.__capturedClear);
        app.ws.send(JSON.stringify(frame));
    });

    await late.waitForTimeout(500);
    expect(await late.evaluate(() => window.__hangout.state.strokes.length)).toBeGreaterThan(0);
});

test('guest snapshot cannot poison lastHostSeq and block host clears', async ({ browser }) => {
    const { host, guest, invite } = await hostAndGuest(browser);
    await drawLine(host);
    const late = await openBrowser(browser);
    await late.goto(invite);
    await late.fill('[data-name]', 'Pat');
    await late.click('[data-enter]');
    await expect.poll(() => late.evaluate(() => window.__hangout.state.strokes.length)).toBeGreaterThan(0);

    const lateId = await late.evaluate(() => window.__hangout.myId);
    await guest.evaluate(async (to) => {
        const app = window.__hangout;
        const frame = await window.HangoutCore.seal(app.key, {
            type: 'snapshot',
            to,
            strokes: [],
            chunk: false,
            first: true,
            done: true,
            lastHostSeq: Number.MAX_SAFE_INTEGER
        });
        app.ws.send(JSON.stringify(frame));
    }, lateId);
    expect(await late.evaluate(() => window.__hangout.lastHostSeq)).toBeLessThan(1e15);

    await host.click('[data-clear]');
    await expect.poll(() => late.evaluate(() => window.__hangout.state.strokes.length)).toBe(0);
});

test('abrupt peer disconnect clears peer count and AV tiles', async ({ browser }) => {
    const { host, guest } = await hostAndGuest(browser);
    await guest.click('[data-cam]');
    await guest.click('[data-ask-yes]');
    await host.click('[data-cam]');
    await host.click('[data-ask-yes]');
    await expect.poll(() => host.evaluate(() => {
        const v = document.querySelector('[data-tiles] .tile:not([data-tile="me"]) video');
        return v && v.videoWidth > 0;
    }), { timeout: 15000 }).toBe(true);

    await guest.evaluate(() => window.__hangout.ws.close());
    await expect(host.locator('[data-peers]')).toHaveText('Just you');
    await expect.poll(() => host.evaluate(() => window.__hangout.names.size)).toBe(0);
    await expect.poll(() => host.locator('[data-tiles] .tile:not([data-tile="me"])').count()).toBe(0);
});

test('switching from one playing YouTube video to another plays the second video on host and guest', async ({ browser }) => {
    const { host, guest } = await hostAndGuest(browser);
    await host.click('[data-pick-yt="oh5p5f5_-7A"]');
    const hYt = host.locator('[data-fake-yt]');
    const gYt = guest.locator('[data-fake-yt]');
    await expect(hYt).toHaveAttribute('data-state', 'playing');
    await expect(gYt).toHaveAttribute('data-video-id', 'oh5p5f5_-7A');
    await host.click('[data-pick-yt="BtnyqIHTDMM"]');
    await expect(hYt).toHaveAttribute('data-video-id', 'BtnyqIHTDMM');
    await expect(hYt).toHaveAttribute('data-state', 'playing');
    await expect(gYt).toHaveAttribute('data-video-id', 'BtnyqIHTDMM');
    await expect(gYt).toHaveAttribute('data-state', 'playing');
});

test('guest snapshot without host seq proof still completes and blocks a later wipe', async ({ browser }) => {
    const { host, guest, invite } = await hostAndGuest(browser);
    await host.evaluate(() => window.__hangout.ws.close());
    await expect.poll(async () => await guest.locator('[data-peers]').textContent()).toBe('Just you');

    await drawLine(guest);
    await guest.fill('[data-text]', 'still here');
    await guest.press('[data-text]', 'Enter');

    const late = await openBrowser(browser);
    await late.goto(invite);
    await late.fill('[data-name]', 'Pat');
    await late.click('[data-enter]');
    await expect.poll(() => late.evaluate(() => window.__hangout.snapshotDone)).toBe(true);
    await expect.poll(() => late.evaluate(() => window.__hangout.state.strokes.length)).toBeGreaterThan(0);
    await expect(late.locator('[data-log]')).toContainText('still here');

    const lateId = await late.evaluate(() => window.__hangout.myId);
    const guestId = await guest.evaluate(() => window.__hangout.myId);
    await guest.evaluate(async (to) => {
        const app = window.__hangout;
        const frame = await window.HangoutCore.seal(app.key, {
            type: 'snapshot',
            to,
            strokes: [],
            chat: [],
            chunk: false,
            first: true,
            done: true
        });
        app.ws.send(JSON.stringify(frame));
    }, lateId);
    await late.waitForTimeout(400);
    expect(await late.evaluate(() => window.__hangout.state.strokes.length)).toBeGreaterThan(0);
    expect(await late.evaluate(() => window.__hangout.snapshotFrom)).toBe(guestId);
});

test('guest snapshot cannot tamper with video timestamp to skew late joiner playback position', async ({ browser }) => {
    const { host, guest, invite } = await hostAndGuest(browser);
    await host.click('[data-pick-yt="oh5p5f5_-7A"]');
    await expect(guest.locator('[data-fake-yt]')).toHaveAttribute('data-state', 'playing');
    await host.evaluate(() => { window.__ytLog[window.__ytLog.length - 1].seekTo(45); });
    await expect.poll(() => host.evaluate(() => window.__ytLog[window.__ytLog.length - 1].getCurrentTime())).toBeGreaterThan(44);
    await expect.poll(() => guest.evaluate(() => Number.isFinite(Number(window.__hangout.lastVideoSigned?.signed?.body?.t)))).toBe(true);

    const late = await openBrowser(browser);
    await late.goto(invite);
    await late.click('[data-enter]');
    const lateId = await late.evaluate(() => window.__hangout.myId);
    await late.evaluate(() => {
        const app = window.__hangout;
        app.snapshotDone = false;
        app.snapshotFrom = null;
        app.snapshotHasSeqProof = false;
        app.state.video = null;
    });
    const forgedT = Date.now() - 3_600_000;
    const signedT = await guest.evaluate(async ({ to, forged }) => {
        const app = window.__hangout;
        const video = app.lastVideoSigned;
        if (!video) throw new Error('no video state');
        const frame = await window.HangoutCore.seal(app.key, {
            type: 'snapshot',
            to,
            strokes: app.state.strokes.slice(-400),
            chat: app.state.chat.slice(-50),
            video: { signed: video.signed, t: forged },
            chunk: false,
            first: true,
            done: true
        });
        app.ws.send(JSON.stringify(frame));
        return video.signed.body.t;
    }, { to: lateId, forged: forgedT });

    expect(forgedT).not.toBe(signedT);
    await expect.poll(() => late.evaluate(() => window.__hangout.state.video && window.__hangout.state.video.t)).toBe(signedT);
    const skew = await late.evaluate((forged) => {
        const v = window.__hangout.state.video;
        const now = window.__hangout.clock.relayNow();
        const honest = window.HangoutCore.expectedPosition(v, now);
        const evil = window.HangoutCore.expectedPosition({ ...v, t: forged }, now);
        return Math.abs(honest - evil);
    }, forgedT);
    expect(skew).toBeGreaterThan(60);
});

test('remote peer cannot exceed AV_MAX or open peer connections without AV state', async ({ browser }) => {
    const { host, guest } = await hostAndGuest(browser);
    const before = await host.evaluate(() => window.__hangout.av.pcs.size);
    await guest.evaluate(async () => {
        const app = window.__hangout;
        const victim = [...window.__hangout.names.keys()][0];
        const frame = await window.HangoutCore.seal(app.key, {
            type: 'rtc',
            to: victim,
            sdp: { type: 'offer', sdp: 'v=0\r\n' }
        });
        app.ws.send(JSON.stringify(frame));
    });
    await host.waitForTimeout(300);
    expect(await host.evaluate(() => window.__hangout.av.pcs.size)).toBe(before);

    await host.evaluate(() => ['x1', 'x2', 'x3', 'x4'].forEach((id) => window.__hangout.av.peers.add(id)));
    await guest.evaluate(async () => {
        const app = window.__hangout;
        const victim = [...window.__hangout.names.keys()][0];
        const frame = await window.HangoutCore.seal(app.key, {
            type: 'rtc',
            to: victim,
            sdp: { type: 'offer', sdp: 'v=0\r\n' }
        });
        app.ws.send(JSON.stringify(frame));
    });
    await host.waitForTimeout(300);
    expect(await host.evaluate(() => window.__hangout.av.pcs.size)).toBe(before);
});

test('host pause right after load still reaches guests', async ({ browser }) => {
    const { host, guest } = await hostAndGuest(browser);
    await host.click('[data-pick-yt="oh5p5f5_-7A"]');
    const gYt = guest.locator('[data-fake-yt]');
    await expect(gYt).toHaveAttribute('data-state', 'playing');
    await host.evaluate(() => { window.__ytLog[0].pauseVideo(); });
    await expect(gYt).toHaveAttribute('data-state', 'paused');
});

test('host-driven YouTube stays in sync: load, play, pause, seek, late joiner', async ({ browser }) => {
    const { host, guest, invite } = await hostAndGuest(browser);
    await host.click('[data-pick-yt="oh5p5f5_-7A"]');
    const gYt = guest.locator('[data-fake-yt]');
    await expect(gYt).toHaveAttribute('data-video-id', 'oh5p5f5_-7A');
    await expect(gYt).toHaveAttribute('data-state', 'playing');
    await host.waitForTimeout(1500);
    const drift = async () => {
        const h = await host.evaluate(() => window.__ytLog[0].getCurrentTime());
        const g = await guest.evaluate(() => window.__ytLog[0].getCurrentTime());
        return Math.abs(h - g);
    };
    expect(await drift()).toBeLessThan(1.0);

    await host.evaluate(() => { window.__ytLog[0].seekTo(120); window.__ytLog[0].pauseVideo(); });
    await expect(gYt).toHaveAttribute('data-state', 'paused');
    await expect.poll(() => guest.evaluate(() => window.__ytLog[0].getCurrentTime())).toBeGreaterThan(119);

    await host.evaluate(() => window.__ytLog[0].playVideo());
    await expect(gYt).toHaveAttribute('data-state', 'playing');

    const late = await openBrowser(browser);
    await late.goto(invite);
    await late.click('[data-enter]');
    const lYt = late.locator('[data-fake-yt]');
    await expect(lYt).toHaveAttribute('data-video-id', 'oh5p5f5_-7A');
    await expect(lYt).toHaveAttribute('data-state', 'playing');
    await expect.poll(() => late.evaluate(() => window.__ytLog[0].getCurrentTime())).toBeGreaterThan(119);
});

test('guests cannot change the video; any YouTube link works for the host; Manic plays from the site', async ({ browser }) => {
    const { host, guest } = await hostAndGuest(browser);
    await expect(guest.locator('[data-load]')).toBeHidden();
    await host.fill('[data-url]', 'https://youtu.be/BtnyqIHTDMM');
    await host.click('[data-load] button');
    await expect(guest.locator('[data-fake-yt]')).toHaveAttribute('data-video-id', 'BtnyqIHTDMM');
    await host.click('[data-pick-file="manic"]');
    await expect(guest.locator('[data-file]')).toBeVisible();
    await expect.poll(() => guest.evaluate(() => document.querySelector('[data-file]').src)).toContain('/assets/manic.mp4');
});

test('mic-only peer attaches an active media element so remote audio plays', async ({ browser }) => {
    const { host, guest } = await hostAndGuest(browser);

    await guest.click('[data-mic]');
    await guest.click('[data-ask-yes]');
    await expect(host.locator('[data-mic]')).toHaveText('Turn on my mic');

    await expect.poll(() => host.evaluate(() => {
        const v = document.querySelector('[data-tiles] .tile:not([data-tile="me"]) video');
        if (!v || !v.srcObject) return false;
        const tracks = v.srcObject.getAudioTracks();
        return tracks.length > 0 && tracks.some((t) => t.readyState === 'live');
    }), { timeout: 15000 }).toBe(true);

    await host.click('[data-cam]');
    await host.click('[data-ask-yes]');
    await guest.click('[data-cam]');
    await guest.click('[data-ask-yes]');
    await expect.poll(() => host.evaluate(() => {
        const v = document.querySelector('[data-tiles] .tile:not([data-tile="me"]) video');
        return v && v.videoWidth > 0;
    }), { timeout: 15000 }).toBe(true);

    await guest.click('[data-cam]');
    await expect(host.locator('[data-tiles] .tile:not([data-tile="me"])')).toHaveCount(1);
    await expect.poll(() => host.evaluate(() => {
        const v = document.querySelector('[data-tiles] .tile:not([data-tile="me"]) video');
        if (!v || !v.srcObject) return false;
        const audio = v.srcObject.getAudioTracks();
        const liveVideo = v.srcObject.getVideoTracks().some((t) => t.readyState === 'live');
        return audio.some((t) => t.readyState === 'live') && !liveVideo;
    }), { timeout: 15000 }).toBe(true);
});

test('toggling camera off and back on while mic stays on updates remote video tile', async ({ browser }) => {
    const { host, guest } = await hostAndGuest(browser);

    await guest.click('[data-mic]');
    await guest.click('[data-ask-yes]');
    await guest.click('[data-cam]');
    await guest.click('[data-ask-yes]');

    await expect.poll(() => host.evaluate(() => {
        const v = document.querySelector('[data-tiles] .tile:not([data-tile="me"]) video');
        return v && v.videoWidth > 0;
    }), { timeout: 15000 }).toBe(true);

    await guest.click('[data-cam]');
    await expect(host.locator('[data-tiles] .tile:not([data-tile="me"])')).toHaveCount(1);
    await expect.poll(() => host.evaluate(() => {
        const v = document.querySelector('[data-tiles] .tile:not([data-tile="me"]) video');
        return v && v.srcObject && v.srcObject.getAudioTracks().some((t) => t.readyState === 'live');
    }), { timeout: 15000 }).toBe(true);

    await guest.click('[data-cam]');
    await guest.click('[data-ask-yes]');
    await expect.poll(() => host.evaluate(() => {
        const v = document.querySelector('[data-tiles] .tile:not([data-tile="me"]) video');
        return v && v.videoWidth > 0;
    }), { timeout: 15000 }).toBe(true);
});

test('camera and mic are opt-in with a plain explainer, then connect peer to peer at capped size', async ({ browser }) => {
    const { host, guest } = await hostAndGuest(browser);
    expect(await host.evaluate(() => window.__hangout.av.stream)).toBeNull();
    await host.click('[data-cam]');
    await expect(host.locator('[data-ask]')).toBeVisible();
    await expect(host.locator('[data-ask-copy]')).toContainText('Tap Allow');
    await host.click('[data-ask-no]');
    expect(await host.evaluate(() => window.__hangout.av.cam)).toBe(false);

    await host.click('[data-cam]');
    await host.click('[data-ask-yes]');
    await expect(host.locator('[data-cam]')).toHaveText('Turn off my camera');
    const settings = await host.evaluate(() => window.__hangout.av.stream.getVideoTracks()[0].getSettings());
    expect(settings.width).toBeLessThanOrEqual(320);
    expect(settings.frameRate).toBeLessThanOrEqual(15);

    await guest.click('[data-mic]');
    await guest.click('[data-ask-yes]');
    const remote = guest.locator('[data-tiles] video').first();
    await expect.poll(() => remote.evaluate((v) => v.videoWidth), { timeout: 15000 }).toBeGreaterThan(0);
    await expect.poll(() => host.evaluate(() => {
        const e = [...window.__hangout.av.pcs.values()][0];
        return e && e.pc.connectionState;
    }), { timeout: 15000 }).toBe('connected');
    const bitrate = await host.evaluate(() => {
        const e = [...window.__hangout.av.pcs.values()][0];
        const s = e.pc.getSenders().find((x) => x.track && x.track.kind === 'video');
        return s.getParameters().encodings[0].maxBitrate;
    });
    expect(bitrate).toBeLessThanOrEqual(250000);

    await host.click('[data-hangup]');
    expect(await host.evaluate(() => window.__hangout.av.stream)).toBeNull();
});

test('TURN servers are fetched before peer connections are opened', async ({ browser }) => {
    const host = await openBrowser(browser);
    await host.addInitScript(() => {
        const Orig = window.RTCPeerConnection;
        window.__hangoutPcIce = [];
        window.RTCPeerConnection = function (config, ...args) {
            window.__hangoutPcIce.push(config);
            return new Orig(config, ...args);
        };
    });
    await host.route('**/room-turn', async (route) => {
        if (route.request().method() === 'POST') {
            await new Promise((r) => setTimeout(r, 200));
            await route.fulfill({ json: { iceServers: [{ urls: 'turn:fake' }] } });
        } else {
            await route.continue();
        }
    });
    await host.goto(roomUrl('&turn=/room-turn'));
    await host.fill('[data-name]', 'Jeff');
    await host.click('[data-enter]');
    await expect(host.locator('[data-room]')).toBeVisible();

    await expect.poll(() => host.evaluate(() => {
        const ice = window.__hangout.av.ice;
        return ice && ice.some((s) => {
            const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
            return urls.some((u) => String(u).includes('turn:fake'));
        });
    })).toBe(true);

    await host.click('[data-cam]');
    await host.click('[data-ask-yes]');

    const guest = await openBrowser(browser);
    await guest.goto(host.url());
    await guest.click('[data-enter]');
    await guest.click('[data-cam]');
    await guest.click('[data-ask-yes]');

    await expect.poll(() => host.evaluate(() => {
        const configs = window.__hangoutPcIce || [];
        return configs.some((c) => (c.iceServers || []).some((s) => {
            const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
            return urls.some((u) => String(u).includes('turn:fake'));
        }));
    }), { timeout: 15000 }).toBe(true);
});

test('hanging up local AV does not drop incoming video from peers', async ({ browser }) => {
    const { host, guest } = await hostAndGuest(browser);

    await guest.click('[data-cam]');
    await guest.click('[data-ask-yes]');
    await host.click('[data-cam]');
    await host.click('[data-ask-yes]');

    await expect.poll(() => guest.evaluate(() => {
        const v = document.querySelector('[data-tile="me"] video');
        return v && v.videoWidth > 0;
    }), { timeout: 15000 }).toBe(true);

    await expect.poll(() => guest.evaluate(() => {
        const v = document.querySelector('[data-tiles] .tile:not([data-tile="me"]) video');
        return v && v.videoWidth > 0;
    }), { timeout: 15000 }).toBe(true);

    await guest.click('[data-hangup]');

    await expect(guest.locator('[data-tile="me"]')).toBeHidden();

    await expect.poll(() => guest.evaluate(() => {
        const v = document.querySelector('[data-tiles] .tile:not([data-tile="me"]) video');
        return v && v.videoWidth > 0;
    })).toBe(true);

    await expect.poll(async () => await host.locator('[data-tiles] .tile:not([data-tile="me"])').count(), { timeout: 10000 }).toBe(0);
});

test('a fifth camera is refused politely', async ({ browser }) => {
    const { guest } = await hostAndGuest(browser);
    await guest.evaluate(() => ['x1', 'x2', 'x3', 'x4'].forEach((id) => window.__hangout.av.peers.add(id)));
    await guest.click('[data-cam]');
    await expect(guest.locator('[data-status]')).toContainText('Faces are full (4 max)');
    await expect(guest.locator('[data-ask]')).toBeHidden();
});

test('crawling every public page from the homepage never reaches the room', async ({ page, baseURL }) => {
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    const origin = new URL(baseURL).origin;
    const seen = new Set();
    const queue = ['/', '/404.html', '/play/'];
    while (queue.length && seen.size < 40) {
        const next = queue.shift();
        if (seen.has(next)) continue;
        seen.add(next);
        const res = await page.goto(next).catch(() => null);
        if (!res || !res.ok()) continue;
        const links = await page.$$eval('a[href], link[href], iframe[src], form[action]', (els) => els.map((e) => e.href || e.src || e.action));
        const html = await page.content();
        expect(html, next).not.toContain(SLUG);
        for (const link of links) {
            const u = new URL(link, origin);
            expect(u.pathname, `${next} links ${u.pathname}`).not.toMatch(/^\/r(\/|$)/);
            if (u.origin === origin && !/\.(png|jpe?g|svg|mp4|m4a|ico|css|js|webmanifest)$/.test(u.pathname)) queue.push(u.pathname);
        }
    }
    expect(seen.size).toBeGreaterThan(2);
});

test('Bob Ross Paint-Along: picker, palette, brushes, pause-for-everyone, catch up and nudge', async ({ browser }) => {
    const { host, guest } = await hostAndGuest(browser);
    await expect(host.locator('[data-bob]')).toBeHidden();
    await host.click('[data-bob-toggle]');
    await expect(host.locator('[data-bob-episodes] .ep')).toHaveCount(12);
    await expect(host.locator('[data-bob-palette] .swatch')).toHaveCount(12);
    await expect(host.locator('[data-bob-palette] [aria-label="Phthalo Blue"]')).toBeVisible();
    await expect(guest.locator('[data-bob-episodes]')).toBeHidden();

    // Picking an episode loads it for everyone and flips guests into Bob mode.
    await host.click('[data-bob-ep="uj5FE70BcB0"]');
    await expect(guest.locator('[data-fake-yt]')).toHaveAttribute('data-video-id', 'uj5FE70BcB0');
    await expect(guest.locator('body')).toHaveClass(/bob-mode/);
    await expect(guest.locator('[data-bob-now]')).toContainText('Waterside Way · S8 E4');
    await expect(guest.locator('[data-bob-hold]')).toBeHidden();
    await expect(guest.locator('[data-bob-catchup]')).toBeVisible();

    // Painting in Van Dyke Brown with the fan brush syncs across.
    await guest.click('[data-bob-palette] [aria-label="Van Dyke Brown"]');
    await guest.click('[data-bob-brushes] .brush:has-text("Fan brush")');
    await drawLine(guest);
    await expect.poll(() => host.evaluate(() => window.__hangout.state.strokes.map((s) => `${s.color}/${s.size}`))).toContain('#221b15/16');

    // Guest nudges, host pauses for everyone, then resumes.
    await guest.click('[data-bob-nudge]');
    await expect(host.locator('[data-status]')).toContainText('needs a sec');
    await host.click('[data-bob-hold]');
    await expect(guest.locator('[data-fake-yt]')).toHaveAttribute('data-state', 'paused');
    await expect(host.locator('[data-bob-hold]')).toHaveText('Back to painting');
    await host.click('[data-bob-hold]');
    await expect(guest.locator('[data-fake-yt]')).toHaveAttribute('data-state', 'playing');

    // A guest who wanders off can catch up to the host in one tap.
    await guest.evaluate(() => { window.__ytLog[0].seekTo(400); });
    await guest.click('[data-bob-catchup]');
    await expect.poll(() => guest.evaluate(() => window.__ytLog[0].getCurrentTime())).toBeLessThan(30);

    // Host rewinds 15s for everyone.
    await host.evaluate(() => window.__ytLog[0].seekTo(100));
    await host.click('[data-bob-rewind]');
    await expect.poll(() => guest.evaluate(() => window.__ytLog[0].getCurrentTime())).toBeLessThan(95);
});

test('show your real canvas: opt-in, rectangular tile for everyone, still capped', async ({ browser }) => {
    const { host, guest } = await hostAndGuest(browser);
    await host.click('[data-canvas-cam]');
    await expect(host.locator('[data-ask-title]')).toHaveText('Show your real canvas?');
    await host.click('[data-ask-yes]');
    await expect(host.locator('[data-canvas-cam]')).toHaveText('Stop showing my canvas');
    const w = await host.evaluate(() => window.__hangout.av.stream.getVideoTracks()[0].getSettings().width);
    expect(w).toBeLessThanOrEqual(640);
    await expect(host.locator('[data-tile="me"]')).toHaveClass(/tile--canvas/);
    await guest.click('[data-mic]');
    await guest.click('[data-ask-yes]');
    await expect(guest.locator('[data-tiles] .tile--canvas')).toHaveCount(1, { timeout: 15000 });
    await expect.poll(() => host.evaluate(() => {
        const e = [...window.__hangout.av.pcs.values()][0];
        const s = e && e.pc.getSenders().find((x) => x.track && x.track.kind === 'video');
        return s ? s.getParameters().encodings[0].maxBitrate : null;
    }), { timeout: 15000 }).toBeLessThanOrEqual(250000);
    await host.click('[data-canvas-cam]');
    expect(await host.evaluate(() => window.__hangout.av.canvas)).toBe(false);
    await expect(host.locator('[data-tile="me"]')).toHaveCount(0);
});
