const { execFile } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const { devices, expect, test } = require('@playwright/test');

const lobbyPath = '/r/45662413410ed051/lobby/';
const release = 'https://github.com/rupret007/webjam/releases/latest';
const guestName = 'G3Guest';
const musicFrame = '[data-music-session-content] iframe';
const room = '[data-chat-context]';

// The band link hands off to a native app. Exercise its actual mode chooser
// offscreen, using the matched WebJam checkout and a disposable settings file.
async function chooseNativeMusicAndArt() {
    const source = process.env.WEBJAM_DEMO_ROOT || path.resolve(__dirname, '../../../webjam');
    const python = process.env.WEBJAM_DEMO_PYTHON || path.join(source, '.venv/bin/python');
    const script = `
from pathlib import Path
from tempfile import TemporaryDirectory
from PySide6.QtWidgets import QApplication, QAbstractButton
from core.settings import AppSettings
from webjam_qt.windows.launch_dialog import LaunchDialog

app = QApplication([])
with TemporaryDirectory() as directory:
    dialog = LaunchDialog(AppSettings(config_file=str(Path(directory) / "settings.json"),
                                      musician_name="Presenter", last_creator_profile_key="art"))
    dialog.show()
    app.processEvents()
    def click(label):
        button, = [b for b in dialog.findChildren(QAbstractButton)
                   if b.isVisible() and b.text() == label]
        assert button.isEnabled()
        button.click()
        app.processEvents()
    click("Music")
    assert dialog.selected_creator_profile_key == "music"
    assert dialog._host_button.isVisible() and dialog._join_button.isVisible()
    click("Art")
    click("Paint along")
    assert dialog.selected_creator_profile_key == "art"
    assert dialog.selected_start_key == "paint_along" and dialog._choice_helper.isVisible()
    dialog.close()
`;
    // Keep native diagnostics private. A failing line number is enough to
    // distinguish a missing dependency from a changed chooser.
    try {
        await promisify(execFile)(python, ['-B', '-c', script], {
            cwd: source,
            env: { ...process.env, QT_QPA_PLATFORM: 'offscreen', PYTHONOPTIMIZE: '' },
        });
    } catch (error) {
        const line = error.stderr?.match(/File "<string>", line (\d+)/)?.[1];
        throw new Error(`WebJam chooser failed (exit ${error.code}, driver line ${line || 'unavailable'}).`);
    }
}

// Port of the two-phone rehearsal. The packaging, invitation, lobby engine,
// browser Music apps and canvas are real. Only participation, issuer, lesson
// media and audio transport are local fixtures. Couple the transport's two
// ends by offer so one phone cannot show a successful solo connection.
async function musicLab(origin) {
    const { createLobby } = await import('../../hangout-worker/src/lobby-core.mjs');
    const sockets = new Map();
    const issued = [], retired = [];
    const prepare = async () => Object.freeze({});
    const commit = async () => ({ ok: true });
    const acknowledge = async () => ({ status: 200 });
    const engine = createLobby({
        gameNight: true, directMusicInvites: true,
        limits: { webJoinOrigins: [origin] },
        send: (id, frame) => sockets.get(id)?.send(JSON.stringify(frame)),
        effectCommit: { prepare, commit },
        participation: {
            prepare, commit, allows: () => true, providerAllowed: async () => true,
            revisionFor: (_context, id) => `approved-${id}`,
            startProvider: (_context, _request, start) => start(),
        },
        musicProvider: {
            origin, prepare: acknowledge, touch: acknowledge, keepAlive: task => { void task; },
            issue: async (claim, confirm) => {
                if (!await confirm()) return { status: 403 };
                issued.push(claim.role);
                return { status: 200, credentials: { client: 'web', ttl: 180, quota_bytes: 1048576,
                    iceServers: [{ urls: 'turn:turn.cloudflare.com:3478?transport=udp',
                        username: 'synthetic', credential: 'inert' }] } };
            },
            revoke: async claim => { retired.push(claim.role); return { status: 200 }; },
        },
    });
    const offers = new Map();
    function connectTransport(role, session) {
        if (role === 'host') return new Promise(resolve => offers.set(session, resolve));
        const hostReady = offers.get(session);
        if (!hostReady) throw new Error('Guest transport did not match an active host offer');
        offers.delete(session);
        hostReady();
    }
    return { engine, sockets, connectTransport, issued, retired };
}

const transportModule = `
export class BrowserMusicHost {
    constructor({ stream, invite }) { this.stream = stream; this.session = invite.session; }
    async host(_credentials, publish) {
        const connected = window.g3Connect(this.session);
        publish();
        await connected;
        this.stream.getAudioTracks()[0].enabled = true;
    }
    close() { this.stream.getTracks().forEach(track => track.stop()); }
}
export class WebJoinSession {
    constructor(options) { Object.assign(this, options); this.accessExpiresAt = options.grantedCredentials.expiresAt; }
    async join() {
        await window.g3Connect(this.invite.session);
        this.onStatus('Connected to the local Music host.');
    }
    close() { this.stream.getTracks().forEach(track => track.stop()); }
}`;

async function preparePhone(context, role, bandOrigin, community, lab) {
    let site;
    await context.exposeBinding('g3Connect', (_source, session) => lab.connectTransport(role, session));
    await context.addInitScript(() => {
        if (window === window.top) window.g3AudioTracks = [];
        else if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => {
            const audio = new AudioContext();
            const stream = audio.createMediaStreamDestination().stream;
            for (const track of stream.getAudioTracks()) {
                const stop = track.stop.bind(track);
                track.stop = () => { stop(); void audio.close().catch(() => {}); };
                window.top.g3AudioTracks.push(track);
            }
            return stream;
        };
    });
    await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.href === release && route.request().isNavigationRequest()) {
            // A release page is a navigation. A 204 leaves the previous page loaded.
            return route.fulfill({
                status: 200,
                contentType: 'text/html',
                body: '<!doctype html><title>WebJam release</title>',
            });
        }
        if (url.hostname === 'www.youtube.com' && url.pathname === '/iframe_api') return route.fulfill({
            path: path.join(__dirname, 'support/fake-youtube.js'), contentType: 'text/javascript',
        });
        if (url.origin === bandOrigin) return route.continue();
        if (url.origin !== community.origin) return route.abort();
        if (url.pathname === lobbyPath || url.pathname === '/beta/bootstrap.js') {
            const response = await route.fetch();
            if (!response.ok()) return route.fulfill({ response });
            if (url.pathname === '/beta/bootstrap.js') return route.fulfill({ response,
                body: await response.text() + '\nwindow.HangoutParticipationControls=true;' });
            // The shared privateCommunity fixture has Music disabled by default.
            const headers = response.headers();
            headers['content-security-policy'] = headers['content-security-policy'].replace('frame-src ',
                `frame-src ${community.origin}/join/host/ ${community.origin}/join/guest/ `);
            headers['permissions-policy'] = 'microphone=(self)';
            return route.fulfill({ response, headers });
        }
        if (url.pathname === '/beta/participation') return route.fulfill({ json: {
            ok: true, available: true, state: 'authorized', revision: 1, canStop: true,
            purposes: ['public-text', 'room-creation', 'public-artifact', 'audio', 'media-reception', 'direct-contact', 'external-provider'],
        } });
        if (url.pathname === '/beta/music') {
            const response = await lab.engine.musicAccess(route.request().postDataJSON(), site, 'local-fixture');
            return route.fulfill({ status: response.status, json: await response.json() });
        }
        const asset = /^\/join\/(host|guest)\/([a-z-]+\.(?:js|css)|)$/.exec(url.pathname);
        if (!asset) return route.continue();
        const [, assetRole, file] = asset;
        const access = await lab.engine.musicAccess({ op: assetRole === 'host' ? 'host-page' : 'guest-frame-page' }, site);
        if (!access.ok) return route.fulfill({ status: access.status });
        if (file === 'host-session.js' || (file === 'session.js' && assetRole === 'guest'))
            return route.fulfill({ contentType: 'text/javascript', body: transportModule });
        const localPath = path.join(__dirname, '../../.beta-assets/join', assetRole, file || 'index.html');
        if (file) return route.fulfill({ path: localPath });
        const html = await readFile(localPath, 'utf8');
        return route.fulfill({ contentType: 'text/html',
            body: html.replace('<head>', '<head><meta name="private-music" content="required">') });
    });
    const socketURL = new URL('/lobby', community.origin);
    socketURL.protocol = 'wss:';
    await context.routeWebSocket('**/*', socket => {
        const url = new URL(socket.url());
        if (!site || url.origin !== socketURL.origin || url.pathname !== socketURL.pathname)
            return socket.close({ code: 1008 });
        const identity = { id: randomUUID(), dev: randomUUID(), iph: randomUUID(), role: 'fan', account: '',
            admin: false, betaSid: site.sid, betaInviteVersion: site.version, expiresAt: site.exp };
        lab.sockets.set(identity.id, socket);
        let frames = lab.engine.connect(identity);
        socket.onMessage(raw => { frames = frames.then(() => lab.engine.message(identity.id, String(raw))); });
        socket.onClose(() => {
            lab.sockets.delete(identity.id);
            void frames.then(() => lab.engine.disconnect(identity.id));
        });
    });
    const page = await context.newPage();
    async function enter(nick) {
        const protectedURL = community.origin + lobbyPath;
        expect((await context.request.get(protectedURL)).status()).toBe(401);
        await page.goto(community.origin + '/beta/?via=stalemate#invite=' + community.invitation);
        await page.getByRole('link', { name: /Choose a nickname and join/ }).click();
        expect((await context.request.get(protectedURL)).status()).toBe(200);
        const cookie = (await context.cookies(community.origin)).find(c => c.name === community.sessionCookieName);
        const { sid, version, exp } = JSON.parse(Buffer.from(cookie.value.split('.')[0], 'base64url'));
        site = { sid, version, exp };
        await page.getByRole('textbox', { name: 'Your nick', exact: true }).fill(nick);
        await page.locator('[data-enter]').click();
        await expect(page.locator('[data-connection]')).toHaveText('Connected');
    }
    return { page, enter };
}

async function sendAndReceive(sender, receiver, marker) {
    const composer = sender.getByRole('textbox', { name: 'Message', exact: true });
    await composer.fill(marker);
    await composer.press('Enter');
    // A failing assertion reports a boolean rather than printing the private log.
    await expect.poll(() => receiver.getByRole('log').evaluate((log, value) => log.innerText.includes(value), marker)).toBe(true);
}

const rooms = page => page.locator('.phonetabs [data-show="rooms"]').click();

async function inviteToActivity(host, guest, activity, expectedRoom) {
    await rooms(host);
    await host.locator(`[data-start="${activity}"]`).click();
    await expect(host.locator(room)).toHaveText(expectedRoom);
    const name = await host.locator(room).innerText();
    await host.locator('[data-roomtools]').click();
    await host.getByRole('button', { name: 'Invite guest', exact: true }).click();
    await host.getByRole('combobox', { name: 'Online guests' }).selectOption({ label: guestName });
    await host.getByRole('button', { name: 'Invite selected person' }).click();
    await guest.locator('[data-room-invite-join]').click();
    await expect(guest.locator(room)).toHaveText(name);
}

// Sample the interior of the line, away from either endpoint. Both blank
// canvases must change at this location for a remote stroke to pass.
function painted(page, fractionY) {
    return page.locator('[data-act-canvas]').evaluate((c, y) => {
        const pixels = c.getContext('2d').getImageData(c.width / 2 - 2, Math.round(c.height * y) - 2, 5, 5).data;
        return pixels.some((value, index) => index % 4 === 3 && value !== 0);
    }, fractionY);
}

async function drawAndVerify(sender, receiver, fractionY) {
    const canvas = page => page.locator('[data-act-canvas]');
    for (const phone of [sender, receiver]) {
        await expect(canvas(phone)).toBeVisible();
        expect(await painted(phone, fractionY)).toBe(false);
    }
    await canvas(sender).scrollIntoViewIfNeeded();
    const box = await canvas(sender).boundingBox();
    const y = box.y + box.height * fractionY;
    await sender.mouse.move(box.x + box.width * .3, y);
    await sender.mouse.down();
    await sender.mouse.move(box.x + box.width * .7, y, { steps: 4 });
    await sender.mouse.up();
    for (const phone of [sender, receiver]) await expect.poll(() => painted(phone, fractionY)).toBe(true);
}

test('Stalemate to WebJam Music and Art to a private two-phone Hangout and leave', async ({ browser, baseURL }) => {
    const { privateCommunity } = await import('./helpers/private-community.mjs');
    const community = await privateCommunity();
    const contexts = [];
    try {
        const lab = await musicLab(community.origin);
        async function phone(role) {
            const context = await browser.newContext({ ...devices['iPhone 15'], ignoreHTTPSErrors: true, serviceWorkers: 'block' });
            contexts.push(context);
            return preparePhone(context, role, baseURL, community, lab);
        }
        const [first, second] = await Promise.all([phone('host'), phone('guest')]);
        const host = first.page, guest = second.page;
        await test.step('Follow the band link and choose Music, then Art and Paint along in WebJam', async () => {
            await host.goto(baseURL, { waitUntil: 'domcontentloaded' });
            await expect(host.locator('#band-title')).toContainText('Stalemate');
            const link = host.locator('#listen').getByRole('link', { name: 'Music and Art in WebJam', exact: true });
            const [navigation] = await Promise.all([
                host.waitForRequest(request => request.isNavigationRequest() && request.url() === release),
                link.click(),
            ]);
            expect(navigation.method()).toBe('GET');
            await expect(host).toHaveURL(release);
            await chooseNativeMusicAndArt();
        });
        await test.step('Redeem the private invite separately and exchange chat', async () => {
            await Promise.all([first.enter('G3Host'), second.enter(guestName)]);
            await sendAndReceive(host, guest, 'Ready for the band demo.');
            await sendAndReceive(guest, host, 'Ready for the private hangout.');
        });
        let jam;
        await test.step('Start and accept the same private Music session', async () => {
            await rooms(host);
            await host.locator('[data-start="jam"]').click();
            await expect(host.locator(room)).toHaveText(/^#jam-/);
            jam = await host.locator(room).innerText();
            await host.getByRole('button', { name: 'Host Music on this device' }).click();
            await host.locator('[data-invite-options]').selectOption({ label: guestName });
            await host.getByRole('button', { name: 'Continue to Music' }).click();
            const h = host.frameLocator('iframe[title="Host private Music"]');
            await h.getByRole('checkbox').check();
            await h.getByRole('button', { name: 'Start with microphone' }).click();
            await expect(h.locator('#status')).toContainText('Waiting for your guest');
            await guest.getByRole('button', { name: 'Accept and join', exact: true }).click();
            const g = guest.frameLocator('iframe[title="Join private Music"]');
            await g.getByRole('button', { name: 'Skip check' }).click();
            await g.getByRole('checkbox').check();
            await g.getByRole('button', { name: 'Join with microphone' }).click();
            await expect(g.getByRole('button', { name: 'Leave session' })).toBeVisible();
            await expect(g.locator('#access-window')).toBeVisible();
            await expect(g.locator('#status')).toBeVisible();
            await expect(g.locator('#status')).toContainText('Connected');
            await expect(h.locator('#status')).toBeVisible();
            await expect(h.locator('#status')).toHaveText('Connected to your guest.');
            await expect(guest.locator(room)).toHaveText(jam);
            expect(lab.issued).toEqual(['host', 'guest']);
            for (const page of [host, guest]) {
                expect(await page.evaluate(() => window.g3AudioTracks.map(t => t.readyState))).toEqual(['live']);
                await page.locator('[data-music-session-panel] summary').click();
            }
        });
        await test.step('Share a Paint lesson, draw on both phones and chat with Music open', async () => {
            await inviteToActivity(host, guest, 'bobross', /^#bobross-/);
            for (const page of [host, guest]) {
                await expect(page.locator('[data-act-video]')).toBeVisible();
                await expect(page.locator('[data-fake-yt]')).toHaveAttribute('data-video-id', 'mT0RNrTDHkI');
            }
            await inviteToActivity(host, guest, 'art', /^#art-/);
            await drawAndVerify(host, guest, .35);
            await drawAndVerify(guest, host, .65);
            await sendAndReceive(guest, host, 'The shared painting looks good on my phone.');
            for (const page of [host, guest]) {
                expect(await painted(page, .35)).toBe(true);
                expect(await painted(page, .65)).toBe(true);
                await expect(page.locator(musicFrame)).toHaveCount(1);
                expect(await page.evaluate(() => window.g3AudioTracks.map(t => t.readyState))).toEqual(['live']);
            }
        });
        await test.step('Leave Jam, retire both Music roles and leave the private beta', async () => {
            await guest.locator(`[data-channel-key="${jam}"]`).click();
            await expect(guest.locator(room)).toHaveText(jam);
            await guest.locator('[data-roombar]').getByRole('button', { name: 'Leave', exact: true }).click();
            await expect(guest.locator(room)).toHaveText('#stalemate');
            await expect(guest.locator(`[data-channel-key="${jam}"]`)).toHaveCount(0);
            for (const page of [host, guest]) {
                await expect(page.locator(musicFrame)).toHaveCount(0);
                await expect.poll(() => page.evaluate(() => window.g3AudioTracks.map(t => t.readyState))).toEqual(['ended']);
            }
            await expect.poll(() => [...lab.retired].sort()).toEqual(['guest', 'host']);
            for (const [page, role] of [[host, 'host'], [guest, 'guest']]) {
                expect(await page.evaluate(async role => (await fetch('/join/' + role + '/', { cache: 'no-store' })).status, role)).toBe(403);
            }
            async function leaveBeta(page) {
                await page.goto(community.origin + '/beta/?via=stalemate');
                await page.getByRole('button', { name: 'Leave this beta' }).click();
                await expect(page.getByRole('heading', { name: 'Your private invitation' })).toBeVisible();
                expect((await page.context().request.get(community.origin + lobbyPath)).status()).toBe(401);
            }
            await leaveBeta(guest);
            expect((await host.context().request.get(community.origin + lobbyPath)).status()).toBe(200);
            await leaveBeta(host);
            expect(community.diagnostics().failures).toEqual([]);
        });
    } finally {
        try { await Promise.all(contexts.map(context => context.close())); }
        finally { await community.close(); }
    }
});
