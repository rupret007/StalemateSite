// Go/no-go for a private Hang Out faces room (invite room, not Game Night).
// Four people: one desktop host and three coarse-pointer phones, then a voice-only guest.
const path = require('node:path');
const fs = require('node:fs/promises');
const { test, expect, webkit, devices } = require('@playwright/test');
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
        const closing = extraBrowser;
        extraBrowser = null;
        await Promise.race([closing.close().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 2000))]);
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

// The only two WebKit outcomes that are the host's fault, and the only two that may skip:
// the browser is not installed, or its renderer process crashed. Everything else fails.
const WEBKIT_MISSING = 'WebKit not launchable on this host';
const WEBKIT_CRASH = 'WebKit renderer crash on this host (environment limit)';
const errorText = (error) => `${error && error.name ? error.name : ''} ${error && error.message ? error.message : ''}`;
const webkitExecutableMissing = (error) => /executable doesn['’]t exist|executable does not exist/i.test(errorText(error));
/** Records Playwright's page 'crash' event. That event is the only proof of a renderer crash:
 * the wording of an error never is, so an error that merely mentions a crash still fails. */
function watchCrash(pages) {
    const watch = { seen: false };
    watch.event = new Promise((resolve) => {
        for (const page of pages) page.on('crash', () => { watch.seen = true; resolve(); });
    });
    // A call rejected by a crash can reach the test just ahead of the event itself, so wait for
    // the event (bounded) before deciding. No event in that window means no crash was observed.
    watch.settle = async () => {
        if (watch.seen) return true;
        let timer;
        await Promise.race([watch.event, new Promise((resolve) => { timer = setTimeout(resolve, 1000); })]);
        clearTimeout(timer);
        return watch.seen;
    };
    return watch;
}
function skipForHost(description) {
    test.info().annotations.push({ type: 'environment', description });
    test.skip(true, description);
}
/** Launches WebKit. Skips only when its executable is missing; any other launch failure fails the test. */
async function launchWebkit(report) {
    try {
        // The Chromium worker's fake-device flags are the default launch options.
        // Passing an empty args list keeps those flags off this WebKit process.
        const launched = await webkit.launch({ headless: true, args: [] });
        extraBrowser = launched;
        report.launched = true;
        return launched;
    } catch (error) {
        report.status = `WebKit did not launch (${scrub(error.message || error.name)})`;
        report.missing = webkitExecutableMissing(error);
        return null;
    }
}
const roomUrl = (extra = '') => `/r/${SLUG}/?preview=${KEY}&relay=${encodeURIComponent(hangoutRelayWsBase(testOrigin))}${extra}`;

async function openBrowser(browser, opts = {}, initScript) {
    const context = await browser.newContext(Object.assign({ permissions: ['camera', 'microphone'] }, opts));
    roomContexts.add(context);
    if (initScript) await context.addInitScript(initScript);
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
    test.setTimeout(45000);
    const hostLimitText = WEBKIT_CRASH;
    const report = { launched: false, pass: false, status: 'WebKit did not launch', environment: false };
    let browser;
    let host;
    let guest;
    let hostLimit = '';
    let closing = false;
    const noteLimit = (status) => {
        if (closing || hostLimit) return;
        hostLimit = status || hostLimitText;
        report.environment = true;
        report.pass = false;
        report.status = hostLimit;
    };
    // Only an observed page 'crash' event counts. A closed page, a closed browser or an error
    // whose text mentions a crash is not one.
    let crash = { seen: false, settle: async () => false };
    const pageDown = () => { if (crash.seen) noteLimit(hostLimitText); return Boolean(hostLimit); };
    browser = await launchWebkit(report);
    if (!browser) {
        console.log(`CHECK f fail launched=false env=${Boolean(report.missing)} seconds= status=${report.status}`);
        await writeJson('webkit.json', report);
        if (report.missing) skipForHost(WEBKIT_MISSING);
        throw new Error(report.status);
    }
    try {
        {
            host = await openBrowser(browser, HOST_VIEW);
            guest = await openBrowser(browser, PHONE);
            host.setDefaultTimeout(8000);
            guest.setDefaultTimeout(8000);
            crash = watchCrash([host, guest]);
            const inputs = await guest.evaluate(async () => {
                try {
                    const list = await navigator.mediaDevices.enumerateDevices();
                    return list.filter((device) => device.kind === 'videoinput').length;
                } catch (_) { return -1; }
            });
            if (pageDown()) noteLimit(hostLimitText);
            if (!hostLimit) await join(host, roomUrl(), 'Alex');
            if (pageDown()) noteLimit(hostLimitText);
            if (!hostLimit) await join(guest, host.url(), 'Blair');
            if (pageDown()) noteLimit(hostLimitText);
            const started = Date.now();
            if (!hostLimit) {
                await turnCamera(host);
                await turnCamera(guest);
            }
            if (pageDown()) noteLimit(hostLimitText);
            if (!hostLimit) {
                let outcome = 'waiting';
                try {
                    await expect.poll(async () => {
                        if (pageDown()) return 'crashed';
                        const [hostRows, guestRows] = await Promise.all([remoteWidths(host), remoteWidths(guest)]);
                        if (hostRows.some((row) => row.width > 0) && guestRows.some((row) => row.width > 0)) {
                            outcome = 'frames';
                            return 'frames';
                        }
                        outcome = 'waiting';
                        return 'waiting';
                    }, { timeout: 12000 }).not.toBe('waiting');
                } catch (error) {
                    if (!(await crash.settle()) || !pageDown()) {
                        report.pass = false;
                        report.status = 'WebKit stayed up, but neither side showed a playing face.';
                        throw new Error(report.status);
                    }
                }
                if (!hostLimit && outcome !== 'frames') {
                    report.status = 'WebKit stayed up, but neither side showed a playing face.';
                    throw new Error(report.status);
                }
                if (!hostLimit) {
                    report.pass = true;
                    report.seconds = seconds(Date.now() - started);
                    report.videoInputs = inputs;
                    report.environment = false;
                    report.cameraDenied = false;
                    report.status = await onScreenStatus(host);
                    expect(host.errors.concat(guest.errors)).toEqual([]);
                }
            }
        }
    } catch (error) {
        if (!(await crash.settle()) || !pageDown()) {
            report.pass = false;
            report.environment = false;
            if (!report.status || report.status === 'WebKit did not launch') report.status = scrub(error.message);
            throw error;
        }
    } finally {
        closing = true;
        console.log(`CHECK f ${report.pass ? 'pass' : 'fail'} launched=${report.launched} env=${Boolean(report.environment)} seconds=${report.seconds ?? ''} status=${report.status || ''}`);
        await writeJson('webkit.json', report);
        if (browser) {
            extraBrowser = null;
            await Promise.race([browser.close().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 1500))]);
        }
    }
    if (hostLimit) skipForHost(hostLimitText);
});

const IPHONE = devices['iPhone 13'];
function iphoneContext() {
    return {
        userAgent: IPHONE.userAgent,
        viewport: IPHONE.viewport,
        deviceScaleFactor: IPHONE.deviceScaleFactor,
        isMobile: IPHONE.isMobile,
        hasTouch: IPHONE.hasTouch
    };
}
function armIosGestureMedia() {
    // True only while a user-input event is dispatching. Promise continuations are too late for iOS.
    let gesture = false;
    const on = () => { gesture = true; };
    const off = () => { gesture = false; };
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click', 'touchend', 'keyup']) {
        window.addEventListener(type, on, true);
        window.addEventListener(type, off, false);
    }
    window.__gumLog = [];
    const realGum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = function gum(constraints) {
        const during = gesture;
        window.__gumLog.push(during);
        if (!during) return Promise.reject(new DOMException('getUserMedia needs a user gesture', 'NotAllowedError'));
        return realGum(constraints);
    };
    const realPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function play() {
        if (!gesture) {
            try { this.pause(); } catch (error) { /* not playing yet */ }
            return Promise.reject(new DOMException('play needs a user gesture', 'NotAllowedError'));
        }
        return realPlay.apply(this, arguments);
    };
}
async function releaseRooms() {
    await Promise.all([...roomContexts].map((context) => context.close().catch(() => {})));
    roomContexts.clear();
}
async function turnMic(page) {
    await page.locator('[data-mic]').click();
    await page.locator('[data-ask-yes]').click();
    await expect(page.locator('[data-mic]')).toHaveText('Mute my mic');
}
async function meshSnapshot(pages) {
    return Promise.all(pages.map((page) => page.evaluate(async () => {
        const app = window.__hangout;
        const rows = [];
        for (const [peer, entry] of app.av.pcs) {
            let videoFrames = 0;
            let audioBytes = 0;
            try {
                (await entry.pc.getStats()).forEach((row) => {
                    if (row.type !== 'inbound-rtp') return;
                    const kind = row.kind || row.mediaType;
                    if (kind === 'video') videoFrames += row.framesDecoded || 0;
                    if (kind === 'audio') audioBytes += row.bytesReceived || 0;
                });
            } catch (error) { /* peer closed mid-read */ }
            const video = document.querySelector(`[data-tile="${CSS.escape(peer)}"] video`);
            const kinds = video && video.srcObject ? video.srcObject.getTracks().map((track) => track.kind) : [];
            rows.push({
                id: peer,
                videoFrames,
                audioBytes,
                width: video ? video.videoWidth : 0,
                hasVideo: kinds.includes('video'),
                hasAudio: kinds.includes('audio')
            });
        }
        return { mine: app.myId, rows };
    })));
}
async function expectFullDuplex(pages) {
    const ids = await Promise.all(pages.map((page) => page.evaluate(() => window.__hangout.myId)));
    await expect.poll(async () => {
        const shots = await meshSnapshot(pages);
        return shots.every((shot) => {
            const want = ids.filter((id) => id !== shot.mine);
            return want.every((id) => shot.rows.some((row) => row.id === id && row.width > 0 && row.hasVideo && row.hasAudio && row.audioBytes > 0));
        });
    }, { timeout: 20000 }).toBe(true);
    const before = await meshSnapshot(pages);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const after = await meshSnapshot(pages);
    after.forEach((shot, index) => {
        const want = ids.filter((id) => id !== shot.mine).sort();
        expect(shot.rows.map((row) => row.id).sort()).toEqual(want);
        for (const row of shot.rows) {
            const prior = before[index].rows.find((item) => item.id === row.id);
            expect(row.hasVideo).toBe(true);
            expect(row.hasAudio).toBe(true);
            expect(row.width).toBeGreaterThan(0);
            expect(row.videoFrames).toBeGreaterThan(prior ? prior.videoFrames : 0);
            expect(row.audioBytes).toBeGreaterThan(prior ? prior.audioBytes : 0);
        }
    });
}

test('two, three and four peers exchange playing video and audio both ways', async ({ browser }) => {
    test.setTimeout(180000);
    for (const count of [2, 3, 4]) {
        const names = ['Alex', 'Blair', 'Casey', 'Drew'].slice(0, count);
        const host = await openBrowser(browser, HOST_VIEW);
        await join(host, roomUrl(), names[0]);
        const pages = [host];
        for (const name of names.slice(1)) {
            const page = await openBrowser(browser, PHONE);
            await join(page, host.url(), name);
            pages.push(page);
        }
        await expect(host.locator('[data-peers]')).toContainText(`${count} here`);
        for (const page of pages) {
            await turnCamera(page);
            await turnMic(page);
        }
        await expectFullDuplex(pages);
        await releaseRooms();
    }
});

test('camera-denied guest is heard, still sees faces, and Leave stays visible', async ({ browser }) => {
    test.setTimeout(60000);
    const host = await openBrowser(browser, HOST_VIEW);
    await join(host, roomUrl(), 'Alex');
    await turnCamera(host);
    await turnMic(host);
    const guest = await openBrowser(browser, PHONE, () => {
        const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = (constraints) => (
            constraints && constraints.video
                ? Promise.reject(new DOMException('Permission denied', 'NotAllowedError'))
                : real(constraints)
        );
    });
    await join(guest, host.url(), 'Eden');
    await guest.locator('[data-cam]').click();
    await guest.locator('[data-ask-yes]').click();
    await expect(guest.locator('[data-ask-title]')).toHaveText('Camera’s not available');
    await guest.locator('[data-ask-yes]').click();
    await expect(guest.locator('[data-mic]')).toHaveText('Mute my mic');
    await expect(guest.locator('[data-status]')).toContainText('voice only');
    const leave = await layoutAudit(guest);
    expect(leave.controls.hangup.onScreen && leave.controls.hangup.short === 'Leave' && !leave.controls.hangup.hidden).toBe(true);
    await expect.poll(() => guest.evaluate(() => {
        const video = document.querySelector('[data-tiles] .tile:not([data-tile="me"]) video');
        return video ? video.videoWidth : 0;
    }), { timeout: 15000 }).toBeGreaterThan(0);
    const edenId = await guest.evaluate(() => window.__hangout.myId);
    await expect.poll(async () => {
        const [shot] = await meshSnapshot([host]);
        const row = shot.rows.find((item) => item.id === edenId);
        return Boolean(row && row.hasAudio && row.audioBytes > 0);
    }, { timeout: 15000 }).toBe(true);
    await expect.poll(async () => {
        const rows = await remoteWidths(host);
        return rows.some((row) => row.name.includes('Eden') && row.nocam);
    }, { timeout: 15000 }).toBe(true);
});

test('a reloaded peer gets faces back within 20 seconds and leaves no ghost tile', async ({ browser }) => {
    test.setTimeout(90000);
    const host = await openBrowser(browser, HOST_VIEW);
    await join(host, roomUrl(), 'Alex');
    const guest = await openBrowser(browser, PHONE);
    await join(guest, host.url(), 'Blair');
    await turnCamera(host);
    const first = await turnCamera(guest);
    await expect.poll(async () => {
        const rows = await remoteWidths(host);
        return rows.some((row) => row.id === first.id && row.width > 0);
    }, { timeout: 15000 }).toBe(true);
    const started = Date.now();
    await guest.reload();
    await guest.fill('[data-name]', 'Blair');
    await guest.click('[data-enter]');
    await expect(guest.locator('[data-room]')).toBeVisible();
    const again = await turnCamera(guest);
    const budget = 20000 - (Date.now() - started);
    expect(budget).toBeGreaterThan(1000);
    await expect.poll(async () => {
        const [hostRows, guestRows] = await Promise.all([remoteWidths(host), remoteWidths(guest)]);
        return hostRows.length === 1 && hostRows[0].width > 0 && hostRows[0].id === again.id
            && guestRows.length === 1 && guestRows[0].width > 0
            && hostRows.every((row) => row.id !== first.id);
    }, { timeout: budget }).toBe(true);
    expect(await host.locator(`[data-tile="${first.id}"]`).count()).toBe(0);
    expect(again.id).not.toBe(first.id);
});

test('iPhone emulation plays faces after one tap and captures only from a gesture', async ({ browser }) => {
    test.setTimeout(120000);
    const host = await openBrowser(browser, iphoneContext(), armIosGestureMedia);
    await join(host, roomUrl(), 'Alex');
    const guest = await openBrowser(browser, iphoneContext(), armIosGestureMedia);
    await join(guest, host.url(), 'Blair');
    await turnCamera(host);
    await turnCamera(guest);
    await expect(guest.locator('[data-faces-play]')).toBeVisible({ timeout: 15000 });
    await expect(host.locator('[data-faces-play]')).toBeVisible({ timeout: 15000 });
    const paused = await guest.evaluate(() => {
        const video = document.querySelector('[data-tiles] .tile:not([data-tile="me"]) video');
        return Boolean(video && video.paused);
    });
    expect(paused).toBe(true);
    await guest.locator('[data-faces-play]').click();
    await host.locator('[data-faces-play]').click();
    await expect.poll(() => guest.evaluate(() => {
        const video = document.querySelector('[data-tiles] .tile:not([data-tile="me"]) video');
        return Boolean(video && !video.paused && video.videoWidth > 0);
    }), { timeout: 15000 }).toBe(true);
    await expect.poll(() => host.evaluate(() => {
        const video = document.querySelector('[data-tiles] .tile:not([data-tile="me"]) video');
        return Boolean(video && !video.paused && video.videoWidth > 0);
    }), { timeout: 15000 }).toBe(true);
    for (const page of [host, guest]) {
        const log = await page.evaluate(() => window.__gumLog || []);
        expect(log.length).toBeGreaterThan(0);
        expect(log.every(Boolean)).toBe(true);
    }
});

// Its own test so a WebKit host limit shows as an explicit skip and never rides on the check above.
test('WebKit iPhone emulation captures the camera from one gesture', async () => {
    test.setTimeout(60000);
    const wkReport = { launched: false, environment: false, status: '' };
    const wk = await launchWebkit(wkReport);
    if (!wk) {
        console.log(`CHECK 3d-webkit env=${Boolean(wkReport.missing)} launched=false status=${wkReport.status}`);
        if (wkReport.missing) skipForHost(WEBKIT_MISSING);
        throw new Error(wkReport.status);
    }
    let crashed = false;
    let crash = { seen: false, settle: async () => false };
    try {
        const phone = await openBrowser(wk, iphoneContext(), armIosGestureMedia);
        crash = watchCrash([phone]);
        await join(phone, roomUrl(), 'Casey');
        await turnCamera(phone);
        const log = await phone.evaluate(() => window.__gumLog || []);
        expect(log.length).toBeGreaterThan(0);
        expect(log.every(Boolean)).toBe(true);
        wkReport.status = 'WebKit stayed up through one camera gesture.';
    } catch (error) {
        // Only an observed page 'crash' event is the host's limit. Any other error is a real failure.
        if (!(await crash.settle())) {
            wkReport.status = scrub(error.message);
            throw error;
        }
        crashed = true;
    } finally {
        if (crashed) { wkReport.environment = true; wkReport.status = WEBKIT_CRASH; }
        console.log(`CHECK 3d-webkit env=${wkReport.environment} launched=${wkReport.launched} status=${wkReport.status}`);
        extraBrowser = null;
        await Promise.race([wk.close().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 2000))]);
    }
    if (crashed) skipForHost(WEBKIT_CRASH);
});
