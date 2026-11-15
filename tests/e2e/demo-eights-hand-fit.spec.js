const { randomUUID } = require('node:crypto');
const { test, expect } = require('./fixtures');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const lobbyUrl = relay => `/r/45662413410ed051/lobby/?preview=local-preview-key-0001&relay=${encodeURIComponent(relay)}`;

async function measure(page, label) {
    const cards = page.locator('[data-eights-card]');
    await expect(cards).toHaveCount(label.includes('starting hand') ? 7 : 10);
    const result = await page.evaluate(() => {
        const panel = document.querySelector('[data-game-night]');
        const row = document.querySelector('[data-eights-hand]');
        const panelRect = panel.getBoundingClientRect();
        const rowRect = row.getBoundingClientRect();
        const style = getComputedStyle(panel);
        const bottomInset = parseFloat(style.borderBottomWidth) + parseFloat(style.paddingBottom);
        const panelBottom = panelRect.bottom - bottomInset;
        const boxes = [...row.querySelectorAll('[data-eights-card]')].map(card => {
            const rect = card.getBoundingClientRect();
            return { top: rect.top, bottom: rect.bottom, height: rect.height,
                fullyInViewport: rect.top >= 0 && rect.bottom <= innerHeight,
                fullyInPanel: rect.top >= panelRect.top && rect.bottom <= panelBottom };
        });
        return { clearance: panelBottom - rowRect.bottom, boxes };
    });
    expect(result.clearance, `${label} hand-row bottom clearance`).toBeGreaterThanOrEqual(20);
    expect(result.boxes.every(card => card.fullyInViewport && card.fullyInPanel), `${label}: every card fully in view/panel`).toBe(true);
    expect(result.boxes.every(card => card.height >= 44), `${label}: every card is at least 44px tall`).toBe(true);
    return result.clearance;
}

test('two-phone Eights hand clears the phone panel at both hand sizes and font scales', async ({ browser, baseURL }) => {
    const relay = hangoutRelayWsBase(baseURL, `eights-fit-${randomUUID()}`);
    const sizes = [{ width: 375, height: 667 }, { width: 390, height: 664 }];
    const clearances = [];

    for (const viewport of sizes) {
        const contexts = await Promise.all([browser.newContext({ viewport }), browser.newContext({ viewport })]);
        try {
            const [host, guest] = await Promise.all(contexts.map(context => context.newPage()));
            for (const [page, nick] of [[host, 'FitHost'], [guest, 'FitGuest']]) {
                await page.goto(lobbyUrl(relay));
                await page.fill('[data-nick]', nick);
                await page.locator('[data-enter]').click();
                await expect(page.locator('[data-connection]')).toHaveText('Connected');
                await page.getByRole('combobox', { name: 'Switch game' }).selectOption('crapeights');
            }
            await host.getByRole('button', { name: 'Open Eights table' }).click();
            await guest.getByRole('button', { name: 'Join Eights table' }).click();
            await expect(guest.locator('[data-eights-card]')).toHaveCount(7);

            for (const fontScale of [false, true]) {
                if (fontScale) {
                    for (const page of [host, guest]) await page.addStyleTag({ content: 'html { font-size: 112.5%; }' });
                }
                const activePage = async () => await host.locator('[data-eights-status]').textContent().then(text => text.includes('Your turn') ? host : guest);
                const before = await activePage();
                const initialClearance = await measure(before, `${viewport.width}x${viewport.height} ${fontScale ? '112.5%' : 'base'} starting hand`);
                clearances.push({ viewport, fontScale, draws: 0, player: before === host ? 'host' : 'guest', clearance: initialClearance });
                for (let draws = 0; draws < 3;) {
                    const active = await activePage();
                    const player = active === host ? 'host' : 'guest';
                    const drawButton = active.locator('[data-eights-action="draw"]');
                    const beforeCount = await active.locator('[data-eights-card]').count();
                    if (await drawButton.isEnabled()) {
                        await drawButton.click();
                        draws++;
                        await expect(active.locator('[data-eights-card]')).toHaveCount(beforeCount + 1);
                    } else {
                        const card = active.locator('[data-eights-card]:enabled').first();
                        await expect(card).toBeVisible();
                        const wild = (await card.getAttribute('aria-label')).includes('Wild');
                        await card.click();
                        if (wild) await active.locator('[data-eights-suits]').getByRole('button', { name: '♥ Hearts', exact: true }).click();
                    }
                    await expect(active.locator('[data-eights-status]')).not.toContainText('Your turn');
                    await expect((active === host ? guest : host).locator('[data-eights-status]')).toContainText('Your turn');
                    if (draws === 3) {
                        const handPlayer = await activePage();
                        const measured = await measure(handPlayer, `${viewport.width}x${viewport.height} ${fontScale ? '112.5%' : 'base'} after 3 draws`);
                        clearances.push({ viewport, fontScale, draws, player: handPlayer === host ? 'host' : 'guest', clearance: measured });
                    }
                }
                if (fontScale) break;
                // Return to seven cards with a fresh match before the larger-font run.
                const active = await host.locator('[data-eights-status]').textContent().then(text => text.includes('Your turn') ? host : guest);
                await active.getByRole('button', { name: 'Resign', exact: true }).click();
                await active.getByRole('dialog', { name: 'Resign this match?' }).getByRole('button', { name: 'Resign', exact: true }).click();
                const winner = active === host ? guest : host;
                await winner.getByRole('button', { name: 'Request Eights rematch' }).click();
                await active.getByRole('button', { name: 'Accept Eights rematch' }).click();
                await expect(host.locator('[data-eights-card]')).toHaveCount(7);
                await expect(guest.locator('[data-eights-card]')).toHaveCount(7);
            }
        } finally {
            await Promise.all(contexts.map(context => context.close()));
        }
    }
    console.log('Measured Eights hand clearances: ' + clearances.map(item => `${item.viewport.width}x${item.viewport.height} ${item.fontScale ? '112.5%' : 'base'} ${item.draws} draws ${item.player}: ${item.clearance.toFixed(2)}px`).join('; '));
});
