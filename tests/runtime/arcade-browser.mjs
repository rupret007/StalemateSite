import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, webkit } from 'playwright';
import { expect } from '@playwright/test';

export async function runArcadeBrowser(engine, origin, invitation, evidence, entrances, media) {
    const browser = await { chromium, webkit }[engine].launch({
        headless: true, ...(media ? { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } : {})
    });
    const errors = [];
    async function guest(source, name, viewport, hasTouch = false) {
        const context = await browser.newContext({ viewport, hasTouch, reducedMotion: 'reduce', serviceWorkers: 'block', ignoreHTTPSErrors: true });
        if (media) await context.addInitScript(() => {
            window.testPeers = [];
            window.testLocalTracks = [];
            window.RTCPeerConnection = class extends RTCPeerConnection {
                constructor(...args) { super(...args); window.testPeers.push(this); }
            };
            const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
            navigator.mediaDevices.getUserMedia = async (...args) => {
                if (window.testDenyDevice) {
                    window.testDenyDevice = false;
                    throw new DOMException('Denied by the test', 'NotAllowedError');
                }
                const stream = await capture(...args);
                window.testLocalTracks.push(...stream.getTracks());
                return stream;
            };
        });
        const entrance = entrances?.[source];
        await context.route('**/*', route => {
            const url = route.request().url();
            if (new URL(url).origin === origin) return route.continue();
            if (url === entrance?.url && route.request().isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: entrance.html });
            return route.abort('blockedbyclient');
        });
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        page.on('pageerror', error => errors.push(`${name}: ${error.message}`));
        const protectedBoard = await context.request.get(origin + '/play/games/chess-board.js');
        assert.equal(protectedBoard.status(), 401, 'anonymous match asset stays protected');
        const destination = `${origin}/beta/?via=${source}`;
        if (entrance) {
            await page.goto(entrance.url);
            const entry = page.getByRole('link', { name: 'Play online with friends' });
            await expect(entry).toHaveAttribute('href', destination);
            await Promise.all([
                page.waitForRequest(request => request.isNavigationRequest() && request.url() === destination),
                entry.click()
            ]);
        } else await page.goto(destination);
        await page.getByLabel('Invitation code').fill(invitation);
        await page.getByRole('button', { name: 'Enter the community' }).click();
        await page.getByRole('link', { name: /Choose a nickname and join/ }).click();
        await page.getByLabel('Your nick').fill(name);
        await page.locator('[data-enter]').click();
        await expect(page.locator('[data-connection]')).toHaveText('Connected');
        const label = source === 'rad-dad' ? 'via Rad Dad' : 'via Stalemate';
        await expect(page.locator('[data-entry-label]').first()).toHaveText(label);
        return page;
    }
    async function moveByKeyboard(page, from, arrow, count) {
        await page.locator(`[data-square="${from}"]`).focus();
        await page.keyboard.press('Enter');
        for (let n = 0; n < count; n++) await page.keyboard.press(arrow);
        await page.keyboard.press('Enter');
    }
    async function tapSquare(page, square) {
        const locator = page.locator(`[data-square="${square}"]`);
        await locator.scrollIntoViewIfNeeded();
        const box = await locator.boundingBox();
        assert.ok(box?.width > 22 && box?.height > 22);
        await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    }
    async function fit(page, label) {
        try {
            await expect(page.locator('.arcade-chess-board')).toBeInViewport({ ratio: 1 });
            await expect(page.locator('[data-send]')).toBeInViewport();
        } catch (error) {
            if (evidence) {
                await mkdir(evidence, { recursive: true });
                await page.screenshot({ path: join(evidence, `fit-failure-${engine}-${label}.png`) });
            }
            console.error('Chess fit', label, await page.evaluate(() => Object.fromEntries(
                ['.titlebar', '.tabs', '.roombar', '.game-night', '.arcade-chess', '.arcade-chess-board', '.buffer', '.say', '.phonetabs']
                    .map(selector => {
                        const node = document.querySelector(selector), rect = node.getBoundingClientRect();
                        return [selector, { top: rect.top, bottom: rect.bottom, height: rect.height, scrollTop: node.scrollTop }];
                    }))));
            throw error;
        }
    }
    async function joinCalls(a, b) {
        for (const page of [a, b]) {
            await page.getByRole('button', { name: 'Call', exact: true }).click();
            await page.getByRole('button', { name: 'Join call', exact: true }).click();
            await expect(page.locator('[data-call-toggle]')).toHaveText('Call joined');
            assert.deepEqual(await page.evaluate(() => window.testLocalTracks.map(track => track.kind)), []);
        }
        await expect(a.getByRole('button', { name: 'Actions for ChessGuest' })).toBeVisible();
        await expect(b.getByRole('button', { name: 'Actions for ChessHost' })).toBeVisible();
        await a.getByRole('button', { name: 'Unmute mic' }).click();
        await expect(a.getByRole('button', { name: 'Mute mic' })).toBeVisible();
        await b.getByRole('button', { name: 'Unmute mic' }).click();
        await expect(b.getByRole('button', { name: 'Mute mic' })).toBeVisible();
        for (const page of [a, b]) await waitForPackets(page, 'audio');
        await b.getByRole('button', { name: 'Mute mic' }).click();
        await expect(b.getByRole('button', { name: 'Unmute mic' })).toBeVisible();
        assert.deepEqual(await b.evaluate(() => window.testLocalTracks.map(track => track.readyState)), ['ended']);
        await expect(a.locator('[data-call-peers] audio')).toHaveJSProperty('muted', true);
        await b.evaluate(() => { window.testDenyDevice = true; });
        await b.getByRole('button', { name: 'Unmute mic' }).click();
        await expect(b.locator('[data-call-status]')).toContainText('Check browser permissions');
        await expect(b.locator('[data-call-toggle]')).toHaveText('Call joined');
        assert.deepEqual(await b.evaluate(() => window.testLocalTracks.map(track => track.readyState)), ['ended']);
        await b.getByRole('button', { name: 'Unmute mic' }).click();
        await expect(b.getByRole('button', { name: 'Mute mic' })).toBeVisible();
        await expect(a.locator('[data-call-peers] audio')).toHaveJSProperty('muted', false);
        await a.getByRole('button', { name: 'Allow room cameras' }).click();
        await expect(b.getByRole('button', { name: 'Turn camera on' })).toBeDisabled();
        await b.getByLabel('I am 18 or older').check();
        await b.getByRole('button', { name: 'Turn camera on' }).click();
        await expect(b.getByRole('button', { name: 'Turn camera off' })).toBeVisible();
        await waitForPackets(a, 'video');
        await expect.poll(() => a.locator('[data-call-peers] video').evaluate(video => video.videoWidth)).toBeGreaterThan(0);
        await a.getByRole('button', { name: 'Disable room cameras' }).click();
        await expect(b.getByRole('button', { name: 'Turn camera off' })).toBeHidden();
        assert.deepEqual(await b.evaluate(() => window.testLocalTracks.filter(track => track.kind === 'video').map(track => track.readyState)), ['ended']);
        await expect(a.locator('[data-call-peers] video')).toBeHidden();
        for (const page of [a, b]) await page.locator('[data-call-toggle]').click();
    }
    function packetCount(page, kind) {
        return page.evaluate(async expected => {
            const [pc] = window.testPeers;
            if (!pc || pc.connectionState === 'closed') return 0;
            const stats = await pc.getStats();
            return [...stats.values()].filter(stat => stat.type === 'inbound-rtp' && stat.kind === expected)
                .reduce((total, stat) => total + stat.packetsReceived, 0);
        }, kind);
    }
    async function waitForPackets(page, kind, after = 5) {
        await expect.poll(() => packetCount(page, kind)).toBeGreaterThan(after);
    }
    try {
        const a = await guest('stalemate', 'ChessHost', { width: 1280, height: 900 });
        const b = await guest('rad-dad', 'ChessGuest', { width: 375, height: 667 }, true);
        await a.getByRole('button', { name: /Game Night/ }).click();
        await a.getByRole('button', { name: 'Invite players' }).click();
        const invite = a.locator('[data-invite-dialog]');
        await invite.getByLabel('Choose a current person').selectOption({ label: 'ChessGuest' });
        await invite.getByRole('button', { name: 'Invite selected person' }).click();
        await b.getByRole('button', { name: 'Join', exact: true }).click();
        await expect(b.getByRole('link', { name: 'Open Rad Dad Arcade' })).toHaveAttribute('href', 'https://raddadband.com/play/');
        for (const page of [a, b]) await page.getByText('Royal Flush Chess', { exact: true }).click();
        await a.getByRole('button', { name: 'Open Chess match' }).click();
        await b.getByRole('button', { name: 'Join as Black' }).click();
        await expect(a.locator('[data-chess-status]')).toHaveText('You’re White · Your turn');
        await fit(a, 'desktop');
        await fit(b, 'phone');
        await moveByKeyboard(a, 'e2', 'ArrowUp', 2);
        await expect(b.getByRole('button', { name: 'e4, White pawn' })).toBeAttached();
        await tapSquare(b, 'e7');
        await tapSquare(b, 'e5');
        await expect(a.getByRole('button', { name: 'e5, Black pawn' })).toBeAttached();
        await b.locator('[data-text]').fill('Good game from Rad Dad');
        await b.locator('[data-send]').click();
        await expect(a.locator('[data-buffer]')).toContainText('Good game from Rad Dad');
        await b.reload();
        await expect(b.getByLabel('Your nick')).toHaveValue('ChessGuest');
        await b.locator('[data-enter]').click();
        await expect(b.locator('[data-chess-status]')).toHaveText('You’re Black · White to move');
        await expect(b.getByRole('button', { name: 'e5, Black pawn' })).toBeVisible();
        await expect(a.getByRole('button', { name: 'e5, Black pawn' })).toBeVisible();
        await expect(b.getByRole('link', { name: 'Back to Rad Dad' })).toBeVisible();
        await expect(b.locator('[data-buffer]')).not.toContainText('Good game from Rad Dad');
        if (media) await joinCalls(a, b);
        else await expect(b.locator('[data-call-toggle]')).toBeHidden();
        const beforeSwitch = media ? await packetCount(b, 'audio') : 0;
        await b.getByText('Four in a Row', { exact: true }).click();
        await expect(b.locator('[data-four]')).toHaveAttribute('open', '');
        await expect(b.locator('.arcade-chess')).not.toHaveAttribute('open', '');
        await b.getByText('Royal Flush Chess', { exact: true }).click();
        await expect(b.getByRole('button', { name: 'e5, Black pawn' })).toBeVisible();
        await expect(b.locator('[data-four]')).not.toHaveAttribute('open', '');
        if (media) {
            await expect(b.locator('[data-call-toggle]')).toHaveText('Call joined');
            await waitForPackets(b, 'audio', beforeSwitch);
            assert.equal(await b.evaluate(() => window.testPeers.length), 1);
        }
        await b.locator('[data-text]').fill('Back at the same board');
        await b.locator('[data-send]').click();
        await expect(a.locator('[data-buffer]')).toContainText('Back at the same board');
        await a.getByRole('button', { name: 'Offer draw', exact: true }).click();
        await b.getByRole('button', { name: 'Accept draw', exact: true }).click();
        await expect(a.locator('[data-chess-status]')).toContainText('Draw by agreement');
        await a.getByRole('button', { name: 'Request rematch' }).click();
        await b.getByRole('button', { name: 'Accept rematch' }).click();
        await expect(b.locator('[data-chess-status]')).toHaveText('You’re White · Your turn');
        await expect(b.getByRole('button', { name: 'e2, White pawn' })).toBeAttached();
        await fit(a, 'desktop-rematch');
        await fit(b, 'phone-rematch');
        assert.equal(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        if (evidence) {
            await mkdir(evidence, { recursive: true });
            await a.screenshot({ path: join(evidence, `chess-${engine}-desktop.png`) });
            await b.screenshot({ path: join(evidence, `chess-${engine}-phone.png`) });
        }
        await b.setViewportSize({ width: 390, height: 844 });
        await fit(b, 'phone-tall');
        if (media) {
            await a.locator('[data-call-toggle]').click();
            await a.getByRole('button', { name: 'Actions for ChessGuest' }).click();
            await a.locator('[data-sheet]').getByRole('button', { name: 'Block', exact: true }).click();
            for (const page of [a, b]) {
                await expect(page.locator('[data-call-peers] li')).toHaveCount(0);
                assert.equal(await page.evaluate(() => window.testPeers[0].connectionState), 'closed');
            }
        }
        await b.locator('[data-leave]').click();
        await expect(b.locator('[data-game-night]')).toBeHidden();
        if (media) {
            await expect.poll(() => b.evaluate(() => window.testLocalTracks.every(track => track.readyState === 'ended'))).toBe(true);
            await expect(a.locator('[data-call-peers] li')).toHaveCount(0);
            await a.getByRole('button', { name: 'Leave call', exact: true }).click();
            assert.equal(await a.evaluate(() => window.testLocalTracks.every(track => track.readyState === 'ended')), true);
            console.log('Passed protected two-brand browser voice and video with Chromium synthetic devices, camera revocation, game switching and track cleanup.');
        }
        await b.reload();
        await b.locator('[data-enter]').click();
        await expect(b.locator('[data-connection]')).toHaveText('Connected');
        await expect(b.locator('[data-game-night]')).toBeHidden();
        assert.deepEqual(errors, []);
        console.log(`Passed ${engine} ${entrances ? 'both generated arcade entry links' : 'protected entry with both brand contexts'}, invitation, keyboard/touch Chess, room chat, draw and rematch.`);
    } finally { await browser.close(); }
}
