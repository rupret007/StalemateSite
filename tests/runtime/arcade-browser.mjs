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
    async function inviteToGame(host, guest, nick) {
        await host.getByRole('button', { name: 'Invite players' }).click();
        const dialog = host.locator('[data-invite-dialog]');
        await dialog.getByLabel('Choose a current person').selectOption({ label: nick });
        await dialog.getByRole('button', { name: 'Invite selected person' }).click();
        await guest.getByRole('button', { name: 'Join', exact: true }).click();
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
    async function playEights(a, b) {
        const before = media ? await packetCount(b, 'audio') : 0;
        for (const page of [a, b]) await page.getByRole('combobox', { name: 'Switch game' }).selectOption('crapeights');
        await a.getByRole('button', { name: 'Open Eights table' }).click();
        await b.getByRole('button', { name: 'Join Eights table' }).click();
        const aCards = a.locator('[data-eights-card]'), bCards = b.locator('[data-eights-card]');
        await expect(aCards).toHaveCount(7);
        await expect(bCards).toHaveCount(7);
        try {
            await expect(b.locator('[data-eights-hand]')).toBeInViewport({ ratio: 1 });
            await expect(b.locator('[data-send]')).toBeInViewport({ ratio: 1 });
        } catch (error) {
            if (evidence) {
                await mkdir(evidence, { recursive: true });
                await b.screenshot({ path: join(evidence, `eights-${engine}-fit-failure.png`) });
            }
            throw error;
        }
        const aHand = await aCards.evaluateAll(buttons => buttons.map(button => button.dataset.eightsCard));
        const bHand = await bCards.evaluateAll(buttons => buttons.map(button => button.dataset.eightsCard));
        assert.ok(aHand.every(id => !bHand.includes(id)));
        const playable = a.locator('[data-eights-card]:enabled').first();
        if (await playable.count()) {
            const wild = (await playable.getAttribute('aria-label')).includes('Wild');
            await playable.press('Enter');
            if (wild) await a.locator('[data-eights-suits]').getByRole('button', { name: '♥ Hearts', exact: true }).click();
            await expect(aCards).toHaveCount(6);
        } else {
            await a.getByRole('button', { name: /Draw ·/ }).click();
            await expect(aCards).toHaveCount(8);
        }
        await expect(b.locator('[data-eights-score="a"]')).toContainText(`${await aCards.count()} cards`);
        if (media) {
            await waitForPackets(b, 'audio', before);
            assert.equal(await b.evaluate(() => window.testPeers.length), 1);
        } else {
            const hand = await bCards.evaluateAll(buttons => buttons.map(button => button.dataset.eightsCard));
            await b.reload();
            await b.locator('[data-enter]').click();
            await expect(b.locator('[data-eights-table]')).toBeVisible();
            assert.deepEqual(await bCards.evaluateAll(buttons => buttons.map(button => button.dataset.eightsCard)), hand);
            await expect(b.getByRole('link', { name: 'Back to Rad Dad' })).toBeVisible();
        }
        await b.getByRole('button', { name: 'Resign', exact: true }).click();
        await b.getByRole('dialog', { name: 'Resign this match?' }).getByRole('button', { name: 'Resign', exact: true }).click();
        await expect(a.locator('[data-eights-status]')).toContainText('You won the match by resignation');
        await a.getByRole('button', { name: 'Request Eights rematch' }).click();
        await b.getByRole('button', { name: 'Accept Eights rematch' }).click();
        await expect(b.locator('[data-eights-status]')).toContainText('Round 1 · Your turn');
        await expect(bCards).toHaveCount(7);
        if (evidence) {
            await mkdir(evidence, { recursive: true });
            await a.screenshot({ path: join(evidence, `eights-${engine}-desktop.png`) });
            await b.screenshot({ path: join(evidence, `eights-${engine}-phone.png`) });
        }
        console.log(`Passed ${engine} Crappy Eights private hands, a played turn, ${media ? 'same call during a game switch' : 'full reload and seat recovery'}, and rematch.`);
    }
    async function playRummy(a, b) {
        const before = media ? await packetCount(b, 'audio') : 0;
        for (const page of [a, b]) {
            await expect(page.locator('[data-arcade-game] option[value="turdrummy"]')).toBeEnabled();
            await page.getByRole('combobox', { name: 'Switch game' }).selectOption('turdrummy');
        }
        await a.getByRole('button', { name: 'Open Rummy table' }).click();
        await b.getByRole('button', { name: 'Join Rummy table' }).click();
        const aCards = a.locator('[data-rummy-card]'), bCards = b.locator('[data-rummy-card]');
        const ids = cards => cards.evaluateAll(buttons => buttons.map(button => button.dataset.rummyCard));
        await expect(aCards).toHaveCount(10);
        await expect(bCards).toHaveCount(10);
        const aHand = await ids(aCards), bHand = await ids(bCards);
        assert.ok(aHand.every(id => !bHand.includes(id)));
        await expect(b.locator('[data-rummy-status]')).toContainText('Draw a card');
        await expect(b.locator('[data-rummy-hand]')).toBeInViewport({ ratio: 1 });
        await expect(b.locator('[data-send]')).toBeInViewport({ ratio: 1 });
        await b.locator('[data-rummy-action="draw-discard"]').click();
        await expect(bCards).toHaveCount(11);
        const drawn = b.locator('[data-rummy-card][data-drawn="true"]');
        await expect(drawn).toBeDisabled();
        await expect(drawn).toHaveAttribute('aria-label', /taken from discard/);
        if (!media) {
            const hand = await ids(bCards);
            await b.reload();
            await b.locator('[data-enter]').click();
            await expect(b.locator('[data-rummy-table]')).toBeVisible();
            assert.deepEqual(await ids(bCards), hand);
            await expect(drawn).toBeDisabled();
            await expect(b.getByRole('link', { name: 'Back to Rad Dad' })).toBeVisible();
        }
        const card = b.locator('[data-rummy-card]:enabled').first();
        const discarded = await card.getAttribute('aria-label');
        await card.scrollIntoViewIfNeeded();
        const box = await card.boundingBox();
        assert.ok(box?.width >= 44 && box?.height >= 44, 'phone-sized card button');
        await b.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
        await expect(card).toHaveAttribute('aria-pressed', 'true');
        await expect(b.locator('[data-rummy-hand-label]')).toContainText('deadwood after discard');
        await b.getByRole('button', { name: 'Discard', exact: true }).click();
        await expect(bCards).toHaveCount(10);
        await expect(a.getByRole('button', { name: `Take ${discarded}`, exact: true })).toBeEnabled();
        if (media) {
            await waitForPackets(b, 'audio', before);
            assert.equal(await b.evaluate(() => window.testPeers.length), 1);
        }
        await b.locator('[data-rummy-action="resign"]').click();
        await b.getByRole('dialog', { name: 'Resign this match?' }).getByRole('button', { name: 'Resign', exact: true }).click();
        await expect(a.locator('[data-rummy-status]')).toContainText('You won the match by resignation');
        await a.getByRole('button', { name: 'Request Rummy rematch' }).click();
        await b.getByRole('button', { name: 'Accept Rummy rematch' }).click();
        await expect(a.locator('[data-rummy-status]')).toContainText('Round 1 · Draw a card');
        await expect(bCards).toHaveCount(10);
        if (evidence) {
            await mkdir(evidence, { recursive: true });
            await a.screenshot({ path: join(evidence, `rummy-${engine}-desktop.png`) });
            await b.screenshot({ path: join(evidence, `rummy-${engine}-phone.png`) });
        }
        console.log(`Passed ${engine} TurdRummy private hands, discard pickup, touch selection, ${media ? 'same call during a game switch' : 'full reload mid-draw'}, and rematch.`);
    }
    async function playSpades(a, b) {
        const before = media ? await packetCount(b, 'audio') : 0;
        const north = await guest('stalemate', 'SpadesNorth', { width: 1280, height: 900 });
        const east = await guest('rad-dad', 'SpadesEast', { width: 390, height: 844 }, true);
        await inviteToGame(a, north, 'SpadesNorth');
        await inviteToGame(a, east, 'SpadesEast');
        const players = [a, b, north, east];
        for (const page of players) {
            await expect(page.locator('[data-arcade-game] option[value="turdspades"]')).toBeEnabled();
            await page.getByRole('combobox', { name: 'Switch game' }).selectOption('turdspades');
        }
        await a.getByRole('button', { name: 'Open Spades table' }).click();
        for (const [page, seat] of [[b, 'West'], [north, 'North'], [east, 'East']]) {
            await page.getByRole('button', { name: 'Join ' + seat }).click();
        }
        const allHands = [];
        for (const page of players) {
            const hand = page.locator('[data-spades-card]');
            await expect(hand).toHaveCount(13);
            allHands.push(...await hand.evaluateAll(buttons => buttons.map(button => button.dataset.spadesCard)));
        }
        assert.equal(new Set(allHands).size, 52);
        try {
            await expect(b.locator('[data-spades-hand]')).toBeInViewport({ ratio: 1 });
            await expect(b.locator('[data-send]')).toBeInViewport({ ratio: 1 });
        } catch (error) {
            if (evidence) {
                await mkdir(evidence, { recursive: true });
                await b.screenshot({ path: join(evidence, `spades-${engine}-fit-failure.png`) });
            }
            throw error;
        }
        await b.getByLabel('Your bid').selectOption('0');
        for (const page of [b, north, east, a]) await page.getByRole('button', { name: 'Lock bid' }).click();
        await expect(a.locator('[data-spades-trick]')).toContainText('West · Nil');
        const lead = b.locator('[data-spades-card]:enabled').first();
        await lead.scrollIntoViewIfNeeded();
        const box = await lead.boundingBox();
        assert.ok(box?.width >= 44 && box?.height >= 44, 'phone-sized Spades card button');
        await b.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
        await expect(b.locator('[data-spades-card]')).toHaveCount(12);
        if (!media) {
            const ids = page => page.locator('[data-spades-card]').evaluateAll(buttons => buttons.map(button => button.dataset.spadesCard));
            const hand = await ids(b);
            await b.reload();
            await b.locator('[data-enter]').click();
            await expect(b.locator('[data-spades-card]')).toHaveCount(12);
            assert.deepEqual(await ids(b), hand);
            await expect(b.getByRole('link', { name: 'Back to Rad Dad' })).toBeVisible();
        }
        for (const page of [north, east, a]) await page.locator('[data-spades-card]:enabled').first().click();
        await expect(a.locator('[data-spades-status]')).toContainText('won the last trick');
        if (media) {
            await waitForPackets(b, 'audio', before);
            assert.equal(await b.evaluate(() => window.testPeers.length), 1);
        }
        await b.locator('[data-spades-action="resign"]').click();
        await b.getByRole('dialog', { name: 'Resign for your team?' }).getByRole('button', { name: 'Resign', exact: true }).click();
        await expect(a.locator('[data-spades-status]')).toContainText('South + North win by resignation');
        await a.getByRole('button', { name: 'Request Spades rematch' }).click();
        for (const page of [b, north]) await page.getByRole('button', { name: 'Accept Spades rematch' }).click();
        await expect(east.locator('[data-spades-status]')).toContainText('3/4 ready');
        await east.getByRole('button', { name: 'Accept Spades rematch' }).click();
        await expect(b.locator('[data-spades-status]')).toContainText('Round 1 · Your bid');
        await expect(b.locator('[data-spades-card]')).toHaveCount(13);
        if (evidence) {
            await mkdir(evidence, { recursive: true });
            await a.screenshot({ path: join(evidence, `spades-${engine}-desktop.png`) });
            await b.screenshot({ path: join(evidence, `spades-${engine}-phone.png`) });
        }
        console.log(`Passed ${engine} TurdSpades four independent guests, bidding, a complete trick, ${media ? 'same call during a game switch' : 'full reload mid-trick'}, and unanimous rematch.`);
        return north;
    }
    async function playJack(a, b, spectator) {
        const before = media ? await packetCount(b, 'audio') : 0;
        for (const page of [a, b, spectator]) {
            await page.getByRole('combobox', { name: 'Switch game' }).selectOption('turdjack');
        }
        const table = a.locator('[data-jack-table]');
        const privateCards = page => page.locator('[data-jack-hands] .jack-face');
        await a.getByRole('button', { name: 'Open Crapjack table' }).click();
        await b.getByRole('button', { name: 'Join Seat 2' }).click();
        await a.getByRole('button', { name: 'Start table' }).click();
        await expect(b.locator('[data-jack-bank]')).toHaveText('1000 play chips');
        await b.getByLabel('Play chips').selectOption('20');
        await a.getByRole('button', { name: 'Ready', exact: true }).click();
        await expect(b.locator('[data-jack-status]')).toContainText('1/2 ready');
        await expect(b.getByLabel('Play chips')).toHaveValue('20');
        const ready = b.getByRole('button', { name: 'Ready', exact: true });
        await ready.scrollIntoViewIfNeeded();
        const box = await ready.boundingBox();
        assert.ok(box?.width >= 44 && box?.height >= 44, 'phone-sized Crapjack Ready button');
        await b.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
        await expect(table).toHaveAttribute('data-phase', /^(play|insurance|settled)$/);
        for (const page of [a, b]) await expect(privateCards(page)).toHaveCount(2);
        await expect(spectator.locator('[data-jack-bank]')).toHaveText('Watching · hands are private');
        await expect(privateCards(spectator)).toHaveCount(0);
        if (await table.getAttribute('data-phase') !== 'settled') {
            await expect(spectator.locator('[data-jack-dealer] [aria-label="Hidden dealer card"]')).toBeVisible();
        }
        if (!media) {
            const hand = await privateCards(b).allTextContents();
            await b.reload();
            await b.locator('[data-enter]').click();
            await expect(privateCards(b)).toHaveCount(2);
            assert.deepEqual(await privateCards(b).allTextContents(), hand);
            await expect(b.getByRole('link', { name: 'Back to Rad Dad' })).toBeVisible();
        }
        if (evidence) {
            await mkdir(evidence, { recursive: true });
            await a.screenshot({ path: join(evidence, `jack-${engine}-desktop.png`) });
            await b.screenshot({ path: join(evidence, `jack-${engine}-phone.png`) });
        }
        await expect(b.locator('[data-jack-hands]')).toBeInViewport({ ratio: 1 });
        await expect(b.locator('[data-send]')).toBeInViewport({ ratio: 1 });
        if (await table.getAttribute('data-phase') === 'insurance') {
            await a.getByRole('button', { name: 'Decline insurance' }).click();
            await expect(b.locator('[data-jack-players] li').first()).toContainText('Ready');
            await b.getByRole('button', { name: 'Decline insurance' }).click();
            await expect(table).toHaveAttribute('data-phase', /^(play|settled)$/);
        }
        const active = a.locator('[data-jack-players] [data-active="true"]');
        for (let index = 0; index < 2 && await table.getAttribute('data-phase') === 'play'; index++) {
            const label = await active.textContent();
            const page = label.startsWith('You') ? a : b;
            await page.getByRole('button', { name: 'Stand', exact: true }).click();
            await expect.poll(async () => (await active.allTextContents())[0]).not.toBe(label);
        }
        await expect(table).toHaveAttribute('data-phase', 'settled');
        await expect(spectator.locator('[data-jack-dealer] .jack-face').nth(1)).toBeVisible();
        await expect(spectator.locator('[data-jack-players] li').nth(1)).toContainText(/20 chips · (Win|Loss|Blackjack|Push)/);
        if (media) {
            await waitForPackets(b, 'audio', before);
            assert.equal(await b.evaluate(() => window.testPeers.length), 1);
        }
        await a.getByRole('button', { name: 'Next round' }).click();
        await expect(b.locator('[data-jack-status]')).toContainText('Round 2');
        await a.getByRole('button', { name: 'End session' }).click();
        await a.getByRole('dialog', { name: 'End this session?' }).getByRole('button', { name: 'End session' }).click();
        await a.getByRole('button', { name: 'Request fresh session' }).click();
        await b.getByRole('button', { name: 'Accept fresh session' }).click();
        await expect(b.locator('[data-jack-status]')).toContainText('Round 1');
        await expect(b.locator('[data-jack-bank]')).toHaveText('1000 play chips');
        console.log(`Passed ${engine} Crapjack two independent players, touch wager, spectator privacy, settlement, ${media ? 'same call during a game switch' : 'full reload after the deal'}, and fresh session.`);
    }
    async function playTurdtris(a, b, spectator) {
        const before = media ? await packetCount(b, 'audio') : 0;
        if (media) {
            await b.routeWebSocket(/\/beta\/arcade-turdtris-match$/, route => {
                const server = route.connectToServer();
                route.onMessage(message => {
                    const isInput = typeof message === 'string' && JSON.parse(message).action === 'input';
                    if (isInput) setTimeout(() => server.send(message), 220);
                    else server.send(message);
                });
            });
        }
        for (const page of [a, b, spectator]) {
            await page.getByRole('combobox', { name: 'Switch game' }).selectOption('turdtris');
        }
        const table = page => page.locator('[data-tris-match]');
        const score = page => page.locator('[data-tris-score]');
        const board = page => page.locator('[data-tris-playfield] canvas');
        await a.getByRole('button', { name: 'Open Turdtris race' }).click();
        await b.getByRole('button', { name: 'Join Turdtris race' }).click();
        await expect(table(a)).toHaveAttribute('data-phase', 'countdown');
        await expect(table(b)).toHaveAttribute('data-phase', 'countdown');
        assert.equal(await a.locator('[data-tris-preview]').textContent(), await b.locator('[data-tris-preview]').textContent());
        await expect(spectator.locator('[data-tris-controls]')).toBeHidden();
        await expect(table(b)).toHaveAttribute('data-phase', 'play');
        if (evidence) {
            await mkdir(evidence, { recursive: true });
            await b.screenshot({ path: join(evidence, `tris-${engine}-before-input.png`) });
        }
        await expect(board(b)).toBeInViewport({ ratio: 1 });
        await expect(b.locator('[data-tris-controls]')).toBeInViewport({ ratio: 1 });
        await expect(b.locator('[data-send]')).toBeInViewport({ ratio: 1 });
        assert.equal(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await board(a).focus();
        await a.keyboard.press('ArrowLeft');
        await a.keyboard.press('Space');
        await expect(score(a)).toContainText(/· [1-9]\d* pts/);
        await expect(a.locator('[data-tris-clock]')).toBeInViewport({ ratio: 1 });
        await expect(a.locator('[data-tris-controls]')).toBeInViewport({ ratio: 1 });
        const drop = b.getByRole('button', { name: 'Hard drop' });
        const box = await drop.boundingBox();
        assert.ok(box?.width >= 44 && box?.height >= 44, 'phone-sized Turdtris drop button');
        const accepted = media ? b.evaluate(async () => {
            // Record a paint before server acknowledgement while its frame is delayed.
            const canvas = document.querySelector('[data-tris-playfield] canvas');
            const before = canvas.toDataURL();
            const table = document.querySelector('[data-tris-match]');
            const sequence = table.dataset.sequence;
            const start = performance.now();
            while (performance.now() - start < 300) {
                await new Promise(requestAnimationFrame);
                if (table.dataset.sequence !== sequence) return false;
                if (canvas.toDataURL() !== before) return true;
            }
            return false;
        }) : null;
        await b.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
        if (accepted) assert.equal(await accepted, true, 'Turdtris paints locally before the delayed server acknowledgement');
        await expect(table(b)).toHaveAttribute('data-sequence', '1');
        await expect(score(b)).toContainText(/· [1-9]\d* pts/);
        if (media) {
            await waitForPackets(b, 'audio', before);
            assert.equal(await b.evaluate(() => window.testPeers.length), 1);
        } else {
            const recorded = await score(b).textContent();
            await b.reload();
            await b.locator('[data-enter]').click();
            await expect(table(b)).toHaveAttribute('data-sequence', '1');
            await expect(score(b)).toHaveText(recorded);
            await expect(b.getByRole('link', { name: 'Back to Rad Dad' })).toBeVisible();
        }
        if (evidence) {
            await a.screenshot({ path: join(evidence, `tris-${engine}-desktop.png`) });
            await b.screenshot({ path: join(evidence, `tris-${engine}-phone.png`) });
        }
        await b.getByRole('button', { name: 'Leave race' }).click();
        await b.getByRole('dialog', { name: 'Leave this race?' }).getByRole('button', { name: 'Leave race' }).click();
        await expect(a.locator('[data-tris-status]')).toHaveText('You win · forfeit');
        await a.getByRole('button', { name: 'Request Turdtris rematch' }).click();
        await b.getByRole('button', { name: 'Accept Turdtris rematch' }).click();
        await expect(table(b)).toHaveAttribute('data-phase', 'countdown');
        await expect(table(b)).toHaveAttribute('data-sequence', '0');
        console.log(`Passed ${engine} Turdtris same countdown and bag, keyboard and 44px phone touch input, ${media ? 'local prediction with 220 ms input delay and the same call' : 'full reload mid-race'}, spectator and rematch.`);
    }
    try {
        const a = await guest('stalemate', 'ChessHost', { width: 1280, height: 900 });
        const b = await guest('rad-dad', 'ChessGuest', { width: 375, height: 667 }, true);
        await a.getByRole('button', { name: /Game Night/ }).click();
        await inviteToGame(a, b, 'ChessGuest');
        await expect(b.getByRole('link', { name: 'Open Rad Dad Arcade' })).toHaveAttribute('href', 'https://raddadband.com/play/');
        for (const page of [a, b]) await page.locator('.arcade-chess summary').click();
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
        await b.locator('[data-four] summary').click();
        await expect(b.locator('[data-four]')).toHaveAttribute('open', '');
        await expect(b.locator('.arcade-chess')).not.toHaveAttribute('open', '');
        await b.locator('.arcade-chess summary').click();
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
        await b.setViewportSize({ width: 375, height: 667 });
        await playEights(a, b);
        await playRummy(a, b);
        const spectator = await playSpades(a, b);
        await playJack(a, b, spectator);
        await playTurdtris(a, b, spectator);
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
