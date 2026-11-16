// Real application pages and a loopback lobby engine. Entry sites and the
// native WebJam return are fixtures, and this walkthrough never starts audio.
const { randomUUID } = require('node:crypto');
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
            const guest = await enter('ChosenGuest', guestSite);
            const peer = await enter('OtherGuest', guestSite);
            if (width < 901) await host.locator('.phonetabs [data-show="rooms"]').click();
            await host.getByRole('button', { name: /^jam \(webjam\)/i }).click();
            const room = await host.locator('[data-chat-context]').textContent();
            expect(room).toMatch(/^#jam-/);
            const callback = await host.context().newPage();
            await callback.goto(baseURL);
            const inviteButton = host.getByRole('button', { name: 'Invite to Music', exact: true });
            const expiry = Math.floor(Date.now() / 1000) + 70;
            const href = `https://webjam.example/join/#k=${'A'.repeat(43)}&s=${'0'.repeat(64)}&g=1&e=${expiry}`;
            async function invite(sequence, link = href) {
                await inviteButton.click();
                const dialog = host.getByRole('dialog', { name: 'Invite a guest' });
                const roster = dialog.getByRole('combobox', { name: 'Choose a current person' });
                await expect(roster).toBeFocused();
                await roster.selectOption({ label: 'ChosenGuest' });
                if (sequence === 2) await capture(host, '01-host-chooses-guest');
                await dialog.getByRole('button', { name: 'Continue in WebJam' }).click();
                await expect.poll(() => host.evaluate(() => window.fixtureLaunches.length)).toBe(sequence);
                const request = await host.evaluate(() => window.fixtureLaunches.at(-1));
                expect(request).toMatch(/^[a-f0-9]{32}$/);
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
            expect(await invite(1, href.replace('webjam.example', 'other-audio.example.test'))).toBe(false);
            await expect(panel).toBeHidden();
            await expect(status).toContainText('couldn’t be sent');
            await expect(host.getByRole('button', { name: 'Share a link instead' })).toBeVisible();

            expect(await invite(2)).toBe(true);
            await expect(status).toContainText('sent to ChosenGuest');
            await expect(panel).toContainText('MusicHost invited you');
            await expect(peer.locator('[data-music-invite]')).toBeHidden();
            await panel.getByRole('button', { name: 'Not now' }).click();
            await expect(status).toContainText('declined the Music invitation');
            await expect(guest.locator('[data-chat-context]')).toHaveText('#stalemate');

            expect(await invite(3)).toBe(true);
            const accept = panel.getByRole('button', { name: 'Accept and join', exact: true });
            await expect(accept).toBeInViewport({ ratio: 1 });
            await capture(guest, '02-guest-receives-offer');
            await accept.press('Enter');
            await expect(guest.locator('[data-chat-context]')).toHaveText(room);
            const audio = panel.getByRole('button', { name: 'Open WebJam in browser', exact: true });
            await expect(audio).toBeInViewport({ ratio: 1 });
            await expect(audio).toBeFocused();
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
        } finally {
            await Promise.all(contexts.map(context => context.close()));
        }
    });
}
