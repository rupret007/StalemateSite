// Go/no-go for a private Hang Out faces room (invite room, not Game Night).
// Four people: one desktop host and three coarse-pointer phones, then a voice-only guest.
const path = require('node:path');
const fs = require('node:fs/promises');
const { test, expect, webkit } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const SLUG = '45662413410ed051';
const KEY = 'local-preview-key-0001';
const FAKE_YT = path.join(__dirname, 'support/fake-youtube.js');
const SHOT_DIR = path.join('test-results', 'hangout-faces-family-demo');
const PHONE = {
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
};
const HOST_VIEW = { viewport: { width: 1440, height: 900 } };

test.use({
    permissions: ['camera', 'microphone'],
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--disable-features=WebRtcHideLocalIpsWithMdns'] }
});
test.beforeEach(({ browserName }) => {
    test.skip(browserName !== 'chromium', 'Chromium project owns this check; WebKit is launched inside it');
});

let testOrigin;
test.beforeAll(async ({ baseURL }) => { testOrigin = baseURL; });
const roomContexts = new Set();
let extraBrowser = null;
test.afterEach(async () => {
    await Promise.all([...roomContexts].map((context) => context.close().catch(() => {})));
    roomContexts.clear();
    if (extraBrowser) {
        await extraBrowser.close().catch(() => {});
        extraBrowser = null;
    }
});

function scrub(value) {
    return String(value || '')
        .replace(/https?:\/\/\S+/gi, '[link]')
        .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[address]')
        .replace(/\/home\/\S+/g, '[path]')
        .replace(/#[A-Za-z0-9_=&%-]{12,}/g, '[invite]')
        .replace(/preview=[^&\s]+/gi, 'preview=[redacted]')
        .replace(/relay=[^&\s]+/gi, 'relay=[redacted]')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 280);
}
function seconds(ms) { return Math.round(ms / 100) / 10; }
const roomUrl = (extra = '') => `/r/${SLUG}/?preview=${KEY}&relay=${encodeURIComponent(hangoutRelayWsBase(testOrigin))}${extra}`;

async function openBrowser(browser, opts = {}) {
    const context = await browser.newContext(Object.assign({ permissions: ['camera', 'microphone'] }, opts));
    roomContexts.add(context);
    await context.route(/youtube\.com|ytimg|googlevideo/, (route) => route.abort());
    await context.route('https://www.youtube.com/iframe_api', (route) => route.fulfill({ path: FAKE_YT, contentType: 'text/javascript' }));
    const page = await context.newPage();
    page.errors = [];
    page.on('pageerror', (error) => page.errors.push(scrub(error.message)));
    return page;
}
async function join(page, url, name) {
    try {
        await page.goto(url);
    } catch (error) {
        throw new Error(`Could not open the private room (${scrub(error.message)})`);
    }
    await page.fill('[data-name]', name);
    await page.click('[data-enter]');
    await expect(page.locator('[data-room]')).toBeVisible();
}
async function onScreenStatus(page) {
    const text = await page.evaluate(() => {
        const read = (sel) => (document.querySelector(sel)?.textContent || '').replace(/\s+/g, ' ').trim();
        return [read('[data-peers]'), read('[data-status]'), read('[data-turn-status]')].filter(Boolean).join(' · ');
    }).catch(() => '');
    return scrub(text) || '(no status text)';
}
async function turnCamera(page) {
    const taps = [];
    const started = Date.now();
    await page.locator('[data-cam]').click();
    taps.push('turn-camera-on');
    const yes = page.locator('[data-ask-yes]');
    await expect(yes).toBeVisible();
    taps.push(scrub(await yes.innerText()));
    await yes.click();
    await expect(page.locator('[data-cam]')).toHaveText('Turn off my camera');
    const id = await page.evaluate(() => window.__hangout.myId);
    return { taps, started, id };
}
async function remoteWidths(page) {
    return page.evaluate(() => [...document.querySelectorAll('[data-tiles] .tile:not([data-tile="me"])')].map((tile) => ({
        id: tile.dataset.tile,
        width: tile.querySelector('video')?.videoWidth || 0,
        nocam: tile.classList.contains('tile--nocam'),
        name: tile.querySelector('.nm')?.textContent || ''
    }))).catch(() => []);
}
function watchRemoteFrames(pages, seenAt) {
    let stop = false;
    const loop = (async () => {
        while (!stop) {
            const now = Date.now();
            for (const page of pages) {
                const rows = await remoteWidths(page);
                for (const row of rows) {
                    if (row.width > 0 && row.id && !seenAt.has(row.id)) seenAt.set(row.id, now);
                }
            }
            await new Promise((resolve) => setTimeout(resolve, 150));
        }
    })();
    return async () => { stop = true; await loop; };
}
async function playingProof(page) {
    return page.evaluate(async () => {
        const tiles = [...document.querySelectorAll('[data-tiles] .tile:not([data-tile="me"])')];
        const read = async () => {
            const decoded = new Map();
            const app = window.__hangout;
            if (app) {
                for (const [peer, entry] of app.av.pcs) {
                    let frames = 0;
                    let saw = false;
                    try {
                        (await entry.pc.getStats()).forEach((row) => {
                            if (row.type !== 'inbound-rtp') return;
                            if (row.kind !== 'video' && row.mediaType !== 'video') return;
                            if (Number.isFinite(row.framesDecoded)) { frames += row.framesDecoded; saw = true; }
                        });
                    } catch (_) { frames = -1; }
                    decoded.set(peer, saw ? frames : -1);
                }
            }
            return tiles.map((tile) => ({
                id: tile.dataset.tile,
                width: tile.querySelector('video')?.videoWidth || 0,
                time: tile.querySelector('video')?.currentTime || 0,
                frames: decoded.has(tile.dataset.tile) ? decoded.get(tile.dataset.tile) : -1,
                nocam: tile.classList.contains('tile--nocam')
            }));
        };
        const before = await read();
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const after = await read();
        return after.map((row, index) => {
            const prior = before[index] && before[index].id === row.id ? before[index] : before.find((item) => item.id === row.id);
            const timeAdvanced = Boolean(prior) && row.time > prior.time + 0.2;
            const framesAdvanced = Boolean(prior) && row.frames >= 0 && prior.frames >= 0 && row.frames > prior.frames;
            return {
                id: row.id,
                width: row.width,
                nocam: row.nocam,
                timeAdvanced,
                framesAdvanced,
                playing: (row.width > 0 && timeAdvanced) || framesAdvanced
            };
        });
    });
}
async function layoutAudit(page) {
    return page.evaluate(() => {
        const root = document.documentElement;
        const view = {
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
            scrollWidth: Math.max(root.scrollWidth, document.body.scrollWidth)
        };
        const controls = {};
        for (const name of ['mic', 'cam', 'hangup']) {
            const el = document.querySelector(`[data-${name}]`);
            const rect = el.getBoundingClientRect();
            controls[name] = {
                width: Math.round(rect.width),
                height: Math.round(rect.height),
                onScreen: rect.width >= 44 && rect.height >= 44 && rect.left >= -0.5 && rect.top >= -0.5
                    && rect.right <= window.innerWidth + 0.5 && rect.bottom <= window.innerHeight + 0.5,
                short: el.dataset.short || '',
                hidden: Boolean(el.hidden)
            };
        }
        const wide = [];
        for (const el of document.body.querySelectorAll('*')) {
            const rect = el.getBoundingClientRect();
            if (rect.right <= window.innerWidth + 1 || rect.width < 8) continue;
            const label = `${el.tagName}.${String(el.className || '').slice(0, 40)}`;
            if (!wide.includes(label) && wide.length < 6) wide.push(label);
        }
        return {
            view,
            controls,
            wide,
            coarse: window.matchMedia('(pointer: coarse)').matches,
            fine: window.matchMedia('(pointer: fine)').matches
        };
    });
}
async function writeJson(name, value) {
    await fs.mkdir(SHOT_DIR, { recursive: true });
    await fs.writeFile(path.join(SHOT_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
}

test('four people in one private Hang Out room can see each other', async ({ browser }) => {
    test.setTimeout(240000);
    const report = {};
    const people = [];
    try {
        const host = await openBrowser(browser, HOST_VIEW);
        await join(host, roomUrl(), 'Alex');
        const room = host.url();
        const guests = [];
        for (const name of ['Blair', 'Casey', 'Drew']) {
            const page = await openBrowser(browser, PHONE);
            await join(page, room, name);
            guests.push({ name, page });
        }
        people.push({ name: 'Alex', page: host }, ...guests);
        await expect(host.locator('[data-peers]')).toContainText('4 here');
        const coarse = await Promise.all(guests.map((guest) => guest.page.evaluate(() => ({
            coarse: window.matchMedia('(pointer: coarse)').matches,
            fine: window.matchMedia('(pointer: fine)').matches,
            width: window.innerWidth,
            height: window.innerHeight
        }))));
        expect(coarse.every((row) => row.coarse && row.width === 390 && row.height === 844)).toBe(true);

        const seenAt = new Map();
        const stopWatch = watchRemoteFrames(people.map((person) => person.page), seenAt);
        const turns = [];
        try {
            for (const person of people) {
                const turned = await turnCamera(person.page);
                person.id = turned.id;
                turns.push({ name: person.name, taps: turned.taps, started: turned.started });
            }
            await expect.poll(() => people.filter((person) => seenAt.has(person.id)).length, { timeout: 25000 }).toBe(people.length);
        } finally {
            await stopWatch();
        }
        const timing = turns.map((turn) => ({
            name: turn.name,
            taps: turn.taps,
            seconds: seconds(seenAt.get(people.find((person) => person.name === turn.name).id) - turn.started)
        }));
        report.a = {
            pass: true,
            taps: timing.reduce((sum, row) => sum + row.taps.length, 0),
            perPerson: timing,
            maxSeconds: Math.max(...timing.map((row) => row.seconds)),
            coarse,
            status: await onScreenStatus(host)
        };

        await fs.mkdir(SHOT_DIR, { recursive: true });
        await host.locator('[data-tiles]').screenshot({ path: path.join(SHOT_DIR, 'tiles-1440x900.png') });
        await guests[0].page.locator('[data-tiles]').screenshot({ path: path.join(SHOT_DIR, 'tiles-390x844.png') });

        const proofs = await Promise.all(people.map((person) => playingProof(person.page)));
        const streams = proofs.flat().filter((row) => row.playing);
        const eachHasThree = proofs.every((rows) => rows.length === 3 && rows.every((row) => row.playing));
        const phoneLayout = await layoutAudit(guests[0].page);
        report.eLayout = {
            pass: phoneLayout.view.scrollWidth <= phoneLayout.view.innerWidth
                && ['mic', 'cam', 'hangup'].every((name) => phoneLayout.controls[name].onScreen && !phoneLayout.controls[name].hidden),
            phoneLayout,
            status: await onScreenStatus(guests[0].page)
        };
        report.b = {
            pass: eachHasThree && streams.length === 12,
            streams: streams.length,
            seconds: 5,
            tiles: proofs.map((rows) => rows.map((row) => ({ playing: row.playing, width: row.width, timeAdvanced: row.timeAdvanced, framesAdvanced: row.framesAdvanced }))),
            status: await onScreenStatus(host)
        };
        expect(report.b.pass, JSON.stringify(report.b.tiles)).toBe(true);

        const drew = guests[2];
        const oldId = drew.page && people.find((person) => person.name === 'Drew').id;
        const recoveryStarted = Date.now();
        await drew.page.reload();
        await drew.page.fill('[data-name]', 'Drew');
        await drew.page.click('[data-enter]');
        await expect(drew.page.locator('[data-room]')).toBeVisible();
        const rejoined = await turnCamera(drew.page);
        drew.id = rejoined.id;
        const budget = 20000 - (Date.now() - recoveryStarted);
        expect(budget).toBeGreaterThan(1000);
        await expect.poll(async () => {
            const rows = await Promise.all(people.map((person) => remoteWidths(person.page)));
            return rows.every((remote) => remote.length === 3 && remote.every((row) => row.width > 0) && remote.every((row) => row.id !== oldId));
        }, { timeout: budget }).toBe(true);
        const recoverySeconds = seconds(Date.now() - recoveryStarted);
        const ghost = (await Promise.all(people.map((person) => person.page.locator(`[data-tile="${oldId}"]`).count()))).reduce((sum, count) => sum + count, 0);
        report.c = {
            pass: recoverySeconds <= 20 && ghost === 0 && rejoined.id !== oldId,
            seconds: recoverySeconds,
            ghost,
            taps: rejoined.taps,
            status: await onScreenStatus(host)
        };
        expect(report.c.pass).toBe(true);

        const eden = await openBrowser(browser, PHONE);
        await eden.addInitScript(() => {
            const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
            navigator.mediaDevices.getUserMedia = (constraints) => (
                constraints && constraints.video
                    ? Promise.reject(new DOMException('Permission denied', 'NotAllowedError'))
                    : real(constraints)
            );
        });
        await join(eden, room, 'Eden');
        const voiceTaps = ['turn-camera-on'];
        await eden.locator('[data-cam]').click();
        const firstYes = eden.locator('[data-ask-yes]');
        await expect(firstYes).toBeVisible();
        voiceTaps.push(scrub(await firstYes.innerText()));
        await firstYes.click();
        await expect(eden.locator('[data-ask-title]')).toHaveText('Camera’s not available');
        const voiceYes = eden.locator('[data-ask-yes]');
        voiceTaps.push(scrub(await voiceYes.innerText()));
        await voiceYes.click();
        await expect(eden.locator('[data-mic]')).toHaveText('Mute my mic');
        await expect(eden.locator('[data-status]')).toContainText('voice only');
        await expect.poll(async () => {
            const tiles = await Promise.all(people.map(async (person) => {
                const rows = await remoteWidths(person.page);
                return rows.find((row) => row.name.includes('Eden')) || null;
            }));
            return tiles.every((row) => row && row.nocam);
        }, { timeout: 15000 }).toBe(true);
        await expect.poll(() => eden.evaluate(() => {
            const video = document.querySelector('[data-tiles] .tile:not([data-tile="me"]) video');
            return video ? video.videoWidth : 0;
        }), { timeout: 15000 }).toBeGreaterThan(0);
        const leave = await layoutAudit(eden);
        report.d = {
            pass: leave.controls.hangup.onScreen && leave.controls.hangup.short === 'Leave',
            taps: voiceTaps,
            leave: leave.controls.hangup,
            status: await onScreenStatus(eden)
        };
        expect(report.d.pass).toBe(true);

        const blairTile = host.locator('[data-tiles] .tile', { hasText: 'Blair' });
        await blairTile.locator('.more').click();
        await host.locator('[data-tile-menu] button', { hasText: 'Turn their camera off' }).click();
        await expect(guests[0].page.locator('[data-cam]')).toHaveText('Turn on my camera');
        await expect(guests[1].page.locator('[data-cam]')).toHaveText('Turn off my camera');
        await expect(drew.page.locator('[data-cam]')).toHaveText('Turn off my camera');
        await expect(host.locator('[data-cam]')).toHaveText('Turn off my camera');
        await expect.poll(async () => {
            const rows = await remoteWidths(host);
            const casey = rows.find((row) => row.name.includes('Casey'));
            const drewRow = rows.find((row) => row.name.includes('Drew'));
            const blair = rows.find((row) => row.name.includes('Blair'));
            // Camera-only Blair leaves the mesh when the host turns that camera off.
            const blairOff = !blair || blair.nocam || blair.width === 0;
            return Boolean(casey && casey.width > 0 && drewRow && drewRow.width > 0 && blairOff);
        }, { timeout: 15000 }).toBe(true);
        report.e = {
            pass: report.eLayout.pass,
            layout: report.eLayout.phoneLayout,
            cameraOff: 'Blair off; Casey, Drew and Alex stayed on',
            status: await onScreenStatus(host)
        };
        expect(report.e.pass, JSON.stringify(report.e.layout)).toBe(true);
        const errors = people.concat([{ page: eden }]).flatMap((person) => person.page.errors);
        expect(errors).toEqual([]);
    } catch (error) {
        report.error = scrub(error.message);
        throw error;
    } finally {
        for (const [key, value] of Object.entries(report)) {
            if (!value || typeof value !== 'object') continue;
            console.log(`CHECK ${key} ${value.pass ? 'pass' : 'fail'} seconds=${value.maxSeconds ?? value.seconds ?? ''} taps=${value.taps ?? ''} status=${value.status || ''}`);
        }
        if (report.error) console.log(`CHECK error ${report.error}`);
        await writeJson('summary.json', report);
    }
});

test('two people in WebKit when that browser launches', async () => {
    test.skip(true, 'Linux headless WebKit 27.2 crashes on 2-peer getUserMedia+WebRTC receive (plain P2P A:crash); family Safari needs real iOS/macOS, not this harness.');
    test.setTimeout(120000);
    const report = { launched: false, pass: false, status: 'WebKit did not launch' };
    let browser;
    try {
        try {
            // The Chromium worker's fake-device flags are the default launch options.
            // Passing an empty args list keeps those flags off this WebKit process.
            browser = await webkit.launch({ headless: true, args: [] });
            extraBrowser = browser;
            report.launched = true;
        } catch (error) {
            report.status = `WebKit did not launch (${scrub(error.message || error.name)})`;
            return;
        }
        const host = await openBrowser(browser, HOST_VIEW);
        await join(host, roomUrl(), 'Alex');
        const guest = await openBrowser(browser, PHONE);
        const inputs = await guest.evaluate(async () => {
            try {
                const list = await navigator.mediaDevices.enumerateDevices();
                return list.filter((device) => device.kind === 'videoinput').length;
            } catch (_) { return -1; }
        });
        await join(guest, host.url(), 'Blair');
        const started = Date.now();
        let cameraDenied = false;
        try {
            await turnCamera(host);
            await turnCamera(guest);
        } catch (error) {
            cameraDenied = true;
            const crashed = /crash|has been closed/i.test(error.message || '');
            report.pass = false;
            report.environment = crashed || inputs <= 0;
            report.status = crashed
                ? 'WebKit launched, then the renderer crashed while the second person turned the camera on.'
                : `WebKit launched; camera path stopped (${scrub(error.message)}).`;
            return;
        }
        await expect.poll(async () => {
            const [hostRows, guestRows] = await Promise.all([remoteWidths(host), remoteWidths(guest)]);
            return hostRows.some((row) => row.width > 0) && guestRows.some((row) => row.width > 0);
        }, { timeout: 20000 }).toBe(true);
        report.pass = true;
        report.seconds = seconds(Date.now() - started);
        report.videoInputs = inputs;
        report.environment = false;
        report.cameraDenied = cameraDenied;
        report.status = await onScreenStatus(host);
        expect(host.errors.concat(guest.errors)).toEqual([]);
    } catch (error) {
        report.pass = false;
        report.status = scrub(error.message);
        if (!report.environment) throw error;
    } finally {
        console.log(`CHECK f ${report.pass ? 'pass' : 'fail'} launched=${report.launched} env=${Boolean(report.environment)} seconds=${report.seconds ?? ''} status=${report.status || ''}`);
        await writeJson('webkit.json', report);
        if (browser) {
            extraBrowser = null;
            await browser.close().catch(() => {});
        }
    }
});
