// Phone sanity: Crappy Eights hand margins, wild suit picker, and match-end paths
// for two phone sizes (Travis/Candace-style viewports) with optional 112.5% root font.
const { randomUUID } = require('node:crypto');
const { test, expect } = require('./fixtures');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const VIEWPORTS = [{ width: 360, height: 640 }, { width: 390, height: 844 }];
const WAIT_FOR_HOST = /wait(ing)? for (the )?host/i;
const DEAD_END = /Return to your Game Night room|couldn.t reconnect|Ask your host/i;
const lobbyUrl = relay => `/r/45662413410ed051/lobby/?preview=local-preview-key-0001&relay=${encodeURIComponent(relay)}`;

async function watchStatus(page) {
    await page.evaluate(() => {
        const node = document.querySelector('[data-eights-status]');
        window.__eightsStatusSeen = [node?.textContent || ''];
        new MutationObserver(() => window.__eightsStatusSeen.push(node.textContent)).observe(node, { childList: true, characterData: true, subtree: true });
    });
    return () => page.evaluate(() => window.__eightsStatusSeen);
}

async function layoutMetrics(page) {
    return page.evaluate(() => {
        const panel = document.querySelector('[data-game-night]');
        const row = document.querySelector('[data-eights-hand]');
        const panelRect = panel.getBoundingClientRect();
        const rowRect = row.getBoundingClientRect();
        const style = getComputedStyle(panel);
        const bottomInset = parseFloat(style.borderBottomWidth) + parseFloat(style.paddingBottom);
        const panelBottom = panelRect.bottom - bottomInset;
        const measure = node => {
            const rect = node.getBoundingClientRect();
            return {
                width: rect.width,
                height: rect.height,
                fullyInViewport: rect.top >= 0 && rect.left >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth,
                fullyInPanel: rect.top >= panelRect.top && rect.left >= panelRect.left
                    && rect.bottom <= panelBottom && rect.right <= panelRect.right
            };
        };
        const cards = [...row.querySelectorAll('[data-eights-card]')].map(measure);
        const suits = [...document.querySelectorAll('[data-eights-suits] button')].map(measure);
        return { clearance: panelBottom - rowRect.bottom, cards, suits };
    });
}

async function assertHand(page, label, expectedCount) {
    const cards = page.locator('[data-eights-card]');
    await expect(cards).toHaveCount(expectedCount);
    for (const card of await cards.all()) await expect(card).toBeInViewport({ ratio: 1 });
    const metrics = await layoutMetrics(page);
    expect(metrics.clearance, `${label} hand bottom clearance px`).toBeGreaterThanOrEqual(20);
    expect(metrics.cards.every(item => item.fullyInViewport && item.fullyInPanel), `${label}: every card fully in view`).toBe(true);
    expect(metrics.cards.every(item => item.height >= 44 && item.width >= 44), `${label}: every card is at least 44px`).toBe(true);
    return metrics.clearance;
}

async function assertSuitPicker(page, label) {
    await expect(page.locator('[data-eights-choose]')).toBeVisible();
    for (const button of await page.locator('[data-eights-suits] button').all()) {
        await expect(button).toBeInViewport({ ratio: 1 });
    }
    const metrics = await layoutMetrics(page);
    expect(metrics.suits.length, `${label}: suit picker buttons`).toBeGreaterThanOrEqual(4);
    expect(metrics.suits.every(item => item.fullyInViewport && item.fullyInPanel), `${label}: suit picker fully in view`).toBe(true);
    expect(metrics.suits.every(item => item.height >= 44 && item.width >= 44), `${label}: suit picker targets are at least 44px`).toBe(true);
    await assertHand(page, `${label} with suit picker open`, await page.locator('[data-eights-card]').count());
}

async function activePage(host, guest) {
    const hostTurn = await host.locator('[data-eights-status]').textContent();
    return hostTurn.includes('Your turn') ? host : guest;
}

async function playWildEight(page) {
    const wild = page.locator('[data-eights-card]:enabled[aria-label*="Wild"]');
    await expect(wild.first()).toBeVisible();
    await wild.first().click();
}

async function advanceTurn(host, guest) {
    const active = await activePage(host, guest);
    const drawButton = active.locator('[data-eights-action="draw"]');
    if (await drawButton.isEnabled()) {
        await drawButton.click();
    } else {
        const card = active.locator('[data-eights-card]:enabled').first();
        await expect(card).toBeVisible();
        const label = await card.getAttribute('aria-label');
        await card.click();
        if (label.includes('Wild')) {
            await active.locator('[data-eights-suits]').getByRole('button', { name: '♣ Clubs', exact: true }).click();
        }
    }
    const next = active === host ? guest : host;
    await expect(next.locator('[data-eights-status]')).toContainText('Your turn');
}

async function drawToTwelve(host, guest) {
  let twelvePage = null;
    for (let draws = 0; draws < 5;) {
        const active = await activePage(host, guest);
        const drawButton = active.locator('[data-eights-action="draw"]');
        const beforeCount = await active.locator('[data-eights-card]').count();
        if (await drawButton.isEnabled()) {
            await drawButton.click();
            draws++;
            await expect(active.locator('[data-eights-card]')).toHaveCount(beforeCount + 1);
            if (draws === 5) twelvePage = active;
        } else {
            const card = active.locator('[data-eights-card]:enabled').first();
            if (await card.count()) {
                const label = await card.getAttribute('aria-label');
                await card.click();
                if (label.includes('Wild')) {
                    await active.locator('[data-eights-suits]').getByRole('button', { name: '♣ Clubs', exact: true }).click();
                }
            } else if (await active.locator('[data-eights-action="pass"]').isVisible()) {
                await active.locator('[data-eights-action="pass"]').click();
            }
        }
        const next = active === host ? guest : host;
        await expect(next.locator('[data-eights-status]')).toContainText('Your turn');
    }
    await expect(twelvePage.locator('[data-eights-card]')).toHaveCount(12);
    return twelvePage;
}

async function waitForTurn(page, host, guest) {
    for (let tries = 0; tries < 40; tries++) {
        if ((await page.locator('[data-eights-status]').textContent()).includes('Your turn')) return;
        await advanceTurn(host, guest);
    }
    await expect(page.locator('[data-eights-status]')).toContainText('Your turn');
}

async function assertMatchEnd(host, guest, seenHost, seenGuest) {
    const lines = [...(await seenHost()), ...(await seenGuest())];
    expect(lines.filter(text => WAIT_FOR_HOST.test(text) && !/to bid/.test(text))).toEqual([]);
    expect(lines.filter(text => DEAD_END.test(text))).toEqual([]);
    for (const page of [host, guest]) {
        await expect(page.locator('[data-eights-status]')).toBeInViewport({ ratio: 1 });
        const action = page.getByRole('button', { name: /Eights rematch/, exact: false });
        await expect(action).toBeVisible();
        await expect(action).toBeInViewport({ ratio: 1 });
        const box = await action.boundingBox();
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.width).toBeGreaterThanOrEqual(44);
    }
}

test('two-phone Crazy Eights margins, wild suit picker, and match-end sanity', async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    test.slow();
    const relay = hangoutRelayWsBase(baseURL, `eights-sanity-${randomUUID()}`);
    const measured = [];

    for (const viewport of VIEWPORTS) {
        const contexts = await Promise.all([
            browser.newContext({ viewport, hasTouch: true }),
            browser.newContext({ viewport, hasTouch: true })
        ]);
        try {
            const [host, guest] = await Promise.all(contexts.map(context => context.newPage()));
            for (const [page, nick] of [[host, 'Travis'], [guest, 'Candace']]) {
                await page.goto(lobbyUrl(relay));
                await page.fill('[data-nick]', nick);
                await page.locator('[data-enter]').click();
                await expect(page.locator('[data-connection]')).toHaveText('Connected');
                await page.getByRole('combobox', { name: 'Switch game' }).selectOption('crapeights');
            }
            await host.getByRole('button', { name: 'Open Eights table' }).click();
            await guest.getByRole('button', { name: 'Join Eights table' }).click();
            await expect(host.locator('[data-eights-card]')).toHaveCount(7);
            await expect(guest.locator('[data-eights-card]')).toHaveCount(7);

            for (const fontScale of [false, true]) {
                const tag = `${viewport.width}x${viewport.height} ${fontScale ? '112.5%' : 'base'}`;
                if (fontScale) {
                    for (const page of [host, guest]) await page.addStyleTag({ content: 'html { font-size: 112.5%; }' });
                }

                const startingPlayer = await activePage(host, guest);
                const startingClearance = await assertHand(startingPlayer, `${tag} starting hand`, 7);
                measured.push({ tag, phase: 'starting hand', clearance: startingClearance });

                const twelvePlayer = await drawToTwelve(host, guest);
                const twelveClearance = await assertHand(twelvePlayer, `${tag} after 12 cards`, 12);
                measured.push({ tag, phase: '12 cards', clearance: twelveClearance });

                await waitForTurn(twelvePlayer, host, guest);
                await playWildEight(twelvePlayer);
                const wildPlayer = twelvePlayer;
                await assertSuitPicker(wildPlayer, `${tag} suit picker`);
                await wildPlayer.locator('[data-eights-suits]').getByRole('button', { name: '♥ Hearts', exact: true }).click();
                const opponent = wildPlayer === host ? guest : host;
                await expect(opponent.locator('[data-eights-status]')).toContainText('Your turn');

                if (!fontScale) {
                    const resigner = await activePage(host, guest);
                    const winner = resigner === host ? guest : host;
                    const seenResigner = await watchStatus(resigner);
                    const seenWinner = await watchStatus(winner);
                    await resigner.getByRole('button', { name: 'Resign', exact: true }).click();
                    await resigner.getByRole('dialog', { name: 'Resign this match?' }).getByRole('button', { name: 'Resign', exact: true }).click();
                    await expect(winner.locator('[data-eights-status]')).toContainText('won');
                    await assertMatchEnd(host, guest, seenResigner, seenWinner);
                    await winner.getByRole('button', { name: 'Request Eights rematch' }).click();
                    await resigner.getByRole('button', { name: 'Accept Eights rematch' }).click();
                    await expect(host.locator('[data-eights-card]')).toHaveCount(7);
                    await expect(guest.locator('[data-eights-card]')).toHaveCount(7);
                }
            }

            const seenHost = await watchStatus(host);
            const seenGuest = await watchStatus(guest);
            const finisher = await activePage(host, guest);
            const other = finisher === host ? guest : host;
            await finisher.getByRole('button', { name: 'Resign', exact: true }).click();
            await finisher.getByRole('dialog', { name: 'Resign this match?' }).getByRole('button', { name: 'Resign', exact: true }).click();
            await expect(other.locator('[data-eights-status]')).toContainText('won');
            await assertMatchEnd(host, guest, seenHost, seenGuest);
        } finally {
            await Promise.all(contexts.map(context => context.close()));
        }
    }

    console.log('Measured Eights hand bottom clearances (px): '
        + measured.map(item => `${item.tag} ${item.phase}: ${item.clearance.toFixed(2)}`).join('; '));
});