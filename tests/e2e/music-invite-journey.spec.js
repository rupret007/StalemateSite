// Real application pages and a loopback lobby engine. Entry sites and the
// native WebJam return are fixtures, and this walkthrough never starts audio.
const { randomUUID } = require('node:crypto');
const { resolve } = require('node:path');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const LOBBY = '/r/45662413410ed051/lobby/';
const sites = {
    stalemate: { label: 'Stalemate', origin: 'http://stalemate-entry.test' },
    'rad-dad': { label: 'Rad Dad', origin: 'http://rad-dad-entry.test' },
};

const viewports = [
    { width: 390, height: 844, hostSite: 'stalemate', guestSite: 'rad-dad' },
    { width: 1440, height: 900, hostSite: 'rad-dad', guestSite: 'stalemate' },
];

for (const { width, height, hostSite, guestSite } of viewports) {
    test(`targeted Music invite across band entrances at ${width}x${height}`, async ({ browser, baseURL }, testInfo) => {
        const relay = hangoutRelayWsBase(baseURL, `webjam-browser-targeted-${randomUUID()}`);
        const contexts = [];
        async function enter(nick, via) {
            const site = sites[via];
            const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
            contexts.push(context);
            const link = new URL(LOBBY, baseURL);
            link.search = new URLSearchParams({ preview: 'local-preview-key-0001', relay, via }).toString();
            await context.route('**/*', route => {
                const url = new URL(route.request().url());
                if (url.origin === baseURL) return route.continue();
                if (url.origin !== site.origin || url.pathname !== '/') return route.abort();
                const href = link.href.replaceAll('&', '&amp;');
                return route.fulfill({ contentType: 'text/html', body: `<!doctype html><a href="${href}">Hang Out</a>` });
            });
            await context.addInitScript(() => {
                window.fixtureLaunches = [];
                window.fixtureOpens = [];
                window.fixtureMicRequests = 0;
                window.open = (...args) => { window.fixtureOpens.push(args); return null; };
                if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => {
                    window.fixtureMicRequests += 1;
                    throw new Error('This invite walkthrough does not start audio');
                };
                document.addEventListener('click', event => {
                    const launcher = event.target.closest('a[href^="webjam-beta://hangout-music/"]');
                    if (!launcher) return;
                    event.preventDefault();
                    window.fixtureLaunches.push(new URL(launcher.href).pathname.slice(1));
                }, true);
            });
            const page = await context.newPage();
            await page.goto(site.origin);
            await page.getByRole('link', { name: 'Hang Out' }).click();
            await expect(page.locator('[data-entry-label]').first()).toHaveText(`via ${site.label}`);
            await page.getByRole('textbox', { name: 'Your nick', exact: true }).fill(nick);
            await page.locator('[data-enter]').click();
            await expect(page.locator('[data-connection]')).toHaveText('Connected');
            return page;
        }
        const capture = (page, name) => page.screenshot({ path: testInfo.outputPath(`${name}-${width}x${height}.png`) });
        try {
            const host = await enter('MusicHost', hostSite);
            if (width < 901) await host.locator('.phonetabs [data-show="rooms"]').click();
            await host.getByRole('button', { name: /^jam \(webjam\)/i }).click();
            const roomContext = host.locator('[data-chat-context]');
            await expect(roomContext).toHaveText(/^#jam-/);
            const room = await roomContext.textContent();
            const callback = await host.context().newPage();
            await callback.goto(baseURL);
            const inviteButton = host.getByRole('button', { name: 'Invite to Music', exact: true });
            const dialog = host.getByRole('dialog', { name: 'Invite a guest' });
            await inviteButton.click();
            const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
            await expect(dialog).toHaveAccessibleDescription(/No guests are online yet/);
            await expect(dialog.getByRole('button', { name: 'Continue in WebJam' })).toBeDisabled();
            await expect(cancel).toBeInViewport({ ratio: 1 });
            await expect(cancel).toBeFocused();
            await capture(host, '00-host-waits-for-guest');
            await cancel.press('Enter');
            await expect(inviteButton).toBeFocused();
            const guest = await enter('ChosenGuest', guestSite);
            const peer = await enter('OtherGuest', guestSite);
            // The dialog takes a snapshot of the host's current shared roster.
            await expect.poll(() => host.evaluate(() =>
                window.__lobby.chans.get('#stalemate')?.names.map(person => person.nick) ?? [])).toContain('ChosenGuest');
            const expiry = Math.floor(Date.now() / 1000) + 70;
            const capability = Buffer.alloc(32, 1).toString('base64url');
            const href = `https://webjam.example/join/#k=${capability}&s=${'1'.repeat(64)}&g=1&e=${expiry}`;
            async function requestInvite(sequence) {
                await inviteButton.click();
                const roster = dialog.getByRole('combobox', { name: 'Online guests' });
                await expect(roster).toBeFocused();
                await roster.selectOption({ label: 'ChosenGuest' });
                if (sequence === 3) await capture(host, '01-host-chooses-guest');
                await dialog.getByRole('button', { name: 'Continue in WebJam' }).click();
                await expect.poll(() => host.evaluate(() => window.fixtureLaunches.length)).toBe(sequence);
                const request = await host.evaluate(() => window.fixtureLaunches.at(-1));
                expect(request).toMatch(/^[a-f0-9]{32}$/);
                return request;
            }
            async function invite(sequence, link = href) {
                const request = await requestInvite(sequence);
                return callback.evaluate(({ request, href }) => new Promise(resolve => {
                    const channel = new BroadcastChannel(`webjam-music-${request}`);
                    const finish = result => { clearTimeout(timer); channel.close(); resolve(result); };
                    const timer = setTimeout(() => finish(null), 5000);
                    channel.onmessage = ({ data }) => finish(data.returned);
                    channel.postMessage({ href });
                }), { request, href: link });
            }
            const panel = guest.locator('[data-music-invite]');
            const status = host.locator('[data-music-handoff-status]');
            // Shorten only the first native handoff timer so chat, relay and invitation expiry use real time.
            await host.evaluate(() => {
                const schedule = window.setTimeout;
                window.setTimeout = (handler, delay, ...args) => {
                    if (delay !== 90000) return schedule.call(window, handler, delay, ...args);
                    window.setTimeout = schedule;
                    return schedule.call(window, handler, 0, ...args);
                };
            });
            await requestInvite(1);
            await expect(status).toContainText('Check that your private rehearsal build is open and hosting Music');
            await expect(panel).toBeHidden();
            const manual = host.getByRole('button', { name: 'Share a link instead' });
            await expect(manual).toBeInViewport({ ratio: 1 });
            await capture(host, '00b-native-handoff-timeout');
            await manual.press('Enter');
            await expect(host.locator('[data-jam-link]')).toBeFocused();
            await expect(host.locator('[data-jam-link]')).toBeEmpty();

            expect(await invite(2, href.replace('webjam.example', 'other-audio.example.test'))).toBe(false);
            await expect(panel).toBeHidden();
            await expect(status).toContainText('couldn’t be sent');
            await expect(host.getByRole('button', { name: 'Share a link instead' })).toBeVisible();

            const announcement = guest.getByRole('status').and(guest.locator('[data-music-invite-announcement]'));
            await expect(announcement).toHaveText('');
            expect(await invite(3)).toBe(true);
            await expect(status).toContainText('sent to ChosenGuest');
            await expect(panel).toContainText('MusicHost invited you');
            await expect(announcement).toHaveText('MusicHost invited you to join Music.');
            await expect(peer.locator('[data-music-invite]')).toBeHidden();
            const decline = panel.getByRole('button', { name: 'Not now' });
            await expect(decline).toHaveAccessibleDescription('MusicHost invited you to join Music.');
            if (width === 390) await guest.setViewportSize({ width: 320, height: 210 });
            await decline.scrollIntoViewIfNeeded();
            await expect(decline).toBeInViewport({ ratio: 1 });
            await decline.press('Enter');
            const lobbyTab = guest.getByRole('tab', { name: '#stalemate', selected: true });
            await expect(lobbyTab).toBeFocused();
            await expect(lobbyTab).toBeInViewport({ ratio: 1 });
            if (width === 390) {
                await guest.screenshot({ path: testInfo.outputPath('decline-restores-lobby-focus-320x210.png') });
                await guest.setViewportSize({ width, height });
            }
            await expect(status).toContainText('declined the Music invitation');
            await expect(announcement).toHaveText('');
            await expect(guest.locator('[data-chat-context]')).toHaveText('#stalemate');

            expect(await invite(4)).toBe(true);
            const accept = panel.getByRole('button', { name: 'Accept and join', exact: true });
            await expect(accept).toBeInViewport({ ratio: 1 });
            await expect(accept).toHaveAccessibleDescription('MusicHost invited you to join Music.');
            await capture(guest, '02-guest-receives-offer');
            await host.locator('[data-channel-key="#stalemate"]').click();
            await expect(roomContext).toHaveText('#stalemate');
            await accept.press('Enter');
            await expect(guest.locator('[data-chat-context]')).toHaveText(room);
            const audio = panel.getByRole('button', { name: 'Open WebJam in browser', exact: true });
            await expect(audio).toBeInViewport({ ratio: 1 });
            await expect(audio).toBeFocused();
            await expect(announcement).toContainText('You’re in the Jam room.');
            await host.locator('[data-tabs] [data-channel-key]').filter({ hasText: room }).click();
            await expect(status).toContainText('accepted and joined the Jam room');
            await expect(peer.locator('[data-music-invite]')).toBeHidden();
            await expect(peer.locator('[data-chat-context]')).toHaveText('#stalemate');
            expect(await guest.evaluate(() => window.fixtureOpens)).toEqual([]);
            await capture(guest, '03-guest-joined');
            await capture(host, '04-host-confirmed');
            await audio.press('Enter');
            expect(await guest.evaluate(() => window.fixtureOpens)).toEqual([[href, '_blank', 'noopener,noreferrer']]);
            expect(await guest.evaluate(() => window.fixtureMicRequests)).toBe(0);
            expect(await guest.evaluate(() => JSON.stringify({ ...sessionStorage, ...localStorage }))).not.toContain(href);
            await expect(host.locator('[data-jam-link]')).toBeEmpty();

            const listener = await guest.context().newPage();
            await listener.addInitScript(() => {
                window.fixturePlaybackAttempts = 0;
                HTMLMediaElement.prototype.play = async () => {
                    if (++window.fixturePlaybackAttempts === 1) {
                        throw new DOMException('A playback gesture is needed', 'NotAllowedError');
                    }
                };
            });
            // Serve the protected overlays used by package:beta. Only the
            // media transport is simulated. No relay or actual mic is used.
            await listener.route(url => url.origin === baseURL && url.pathname === '/join/', route =>
                route.fulfill({ path: resolve(__dirname, '../../hangout-worker/web-join-chess/index.html'), contentType: 'text/html' }));
            await listener.route(url => url.origin === baseURL && url.pathname === '/join/app.js', route =>
                route.fulfill({ path: resolve(__dirname, '../../hangout-worker/web-join-music/app.js'), contentType: 'text/javascript' }));
            await listener.route(url => url.origin === baseURL && url.pathname === '/join/session.js', route =>
                route.fulfill({ contentType: 'text/javascript', body: `
                    let attempts = 0;
                    export class WebJoinSession {
                        constructor({ stream, onTrack }) {
                            this.onTrack = onTrack;
                            if (stream) throw new Error('This fixture only accepts a listening guest');
                        }
                        async join() {
                            if (++attempts <= 2) throw new Error('The host did not answer in time. Ask for a new invite.');
                            this.authorized = true;
                            this.onTrack(new MediaStream());
                        }
                        close() {}
                    }` }));
            const opened = new URL(await guest.evaluate(() => window.fixtureOpens[0][0]));
            const listen = listener.getByRole('button', { name: 'Join to listen', exact: true });
            const invalidInvite = new URL(opened);
            invalidInvite.hash = invalidInvite.hash.replace(capability, 'A'.repeat(43));
            await listener.goto(invalidInvite.pathname + '?fixture=invalid' + invalidInvite.hash);
            await expect(listener.locator('#status')).toHaveText('This invite link is no longer valid.');
            await expect(listener.locator('#error-hint')).toContainText('Ask your host for a new browser invite');
            await expect(listen).toBeHidden();

            await listener.goto(opened.pathname + opened.hash);
            await expect(listen).toBeEnabled();
            await expect(listen).toBeInViewport({ ratio: 1 });
            await capture(listener, '05-listening-choice');
            await listen.press('Enter');
            const retry = listener.getByRole('button', { name: 'Retry', exact: true });
            await expect(retry).toBeFocused();
            await expect(listener.locator('#error-hint')).toContainText('Retry to listen with your microphone off');
            await expect(retry).toBeInViewport({ ratio: 1 });
            const audioOptions = listener.getByRole('button', { name: 'Back to audio options', exact: true });
            const checkMic = listener.getByRole('button', { name: 'Check microphone', exact: true });
            await expect(audioOptions).toBeVisible();
            await expect(listen).toBeHidden();
            await expect(checkMic).toBeHidden();
            await capture(listener, '06-listen-retry');

            // WebKit on macOS uses Option-Tab to include buttons by default.
            const tab = process.platform === 'darwin' && browser.browserType().name() === 'webkit' ? 'Alt+Tab' : 'Tab';
            await listener.keyboard.press(tab);
            await expect(audioOptions).toBeFocused();
            await listener.keyboard.press('Enter');
            await expect(listen).toBeFocused();
            await expect(checkMic).toBeVisible();
            await expect(retry).toBeHidden();
            expect(await listener.evaluate(() => window.fixtureMicRequests)).toBe(0);
            await capture(listener, '06b-audio-options-restored');

            await listener.keyboard.press('Enter');
            await expect(retry).toBeFocused();
            await listener.keyboard.press('Enter');
            const resumeAudio = listener.getByRole('button', { name: 'Resume audio', exact: true });
            await expect(resumeAudio).toBeInViewport({ ratio: 1 });
            await expect(resumeAudio).toBeFocused();
            await capture(listener, '07-resume-audio');
            await resumeAudio.press('Enter');
            await expect(resumeAudio).toBeHidden();
            await expect(listener.locator('#status')).toContainText('listening with your microphone off');
            expect(await listener.evaluate(() => window.fixturePlaybackAttempts)).toBe(2);
            await capture(listener, '08-listening');
            await listener.getByRole('button', { name: 'Leave session', exact: true }).click();
            await expect(listener.locator('#status')).toContainText('You left the session');
            expect(await listener.evaluate(() => window.fixtureMicRequests)).toBe(0);
        } finally {
            await Promise.all(contexts.map(context => context.close()));
        }
    });
}
