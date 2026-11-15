const { test, expect } = require('@playwright/test');

const viewports = [
    { width: 375, height: 667 },
    { width: 390, height: 664 }
];

async function openPhone(browser, baseURL, viewport, largerFont) {
    const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    if (largerFont) {
        await page.addInitScript(() => {
            const apply = () => {
                if (document.documentElement) document.documentElement.style.fontSize = '112.5%';
            };
            apply();
            new MutationObserver(apply).observe(document, { childList: true, subtree: true });
        });
    }
    await page.goto(new URL('/play/turdomania.html?seed=209&level=normal&reducedMotion=1', baseURL).href);
    await page.waitForFunction(() => !!window.__turdomania);
    await expect(page.locator('#board')).toBeVisible();
    await expect(page.locator('.dock')).toBeVisible();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    return { context, page };
}

async function measure(page) {
    return page.evaluate(() => {
        const rect = selector => {
            const r = document.querySelector(selector).getBoundingClientRect();
            return { top: r.top, right: r.right, bottom: r.bottom, left: r.left, width: r.width, height: r.height };
        };
        const board = rect('#board');
        const panel = rect('.dock');
        const boardFrame = rect('#boardWrap');
        const controls = [...document.querySelectorAll('.dock button, .dock select, .dock summary')]
            .filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
            .map(el => {
                const r = el.getBoundingClientRect();
                return { name: el.getAttribute('aria-label') || el.textContent.trim(), x: r.left, y: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
            });
        return {
            viewport: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
            board, boardFrame, panel,
            boardToPanel: panel.top - boardFrame.bottom,
            boardViewportClearance: document.documentElement.clientHeight - boardFrame.bottom,
            boardFits: board.left >= 0 && board.top >= 0 && board.right <= document.documentElement.clientWidth && board.bottom <= document.documentElement.clientHeight,
            frameFits: boardFrame.left >= 0 && boardFrame.top >= 0 && boardFrame.right <= document.documentElement.clientWidth && boardFrame.bottom <= document.documentElement.clientHeight,
            controls
        };
    });
}

for (const viewport of viewports) {
    test(`two-phone Turdomania duel board and controls fit at ${viewport.width}x${viewport.height}`, async ({ browser, baseURL }) => {
        const phones = [];
        try {
            // Each pass opens a pair of independent phones for the private demo duel.
            for (const largerFont of [false, true]) {
                const pair = await Promise.all([
                    openPhone(browser, baseURL, viewport, largerFont),
                    openPhone(browser, baseURL, viewport, largerFont)
                ]);
                phones.push(...pair);
                for (const { page } of pair) {
                    const result = await measure(page);
                    console.log(`BOARD FIT ${viewport.width}x${viewport.height} font=${largerFont ? '112.5%' : '100%'} ${JSON.stringify(result)}`);
                    expect(result.boardFits, 'entire board remains in the viewport').toBe(true);
                    expect(result.frameFits, 'board frame remains in the viewport').toBe(true);
                    expect(result.boardToPanel, 'board keeps the roughly 21px clearance before the controls panel').toBeGreaterThanOrEqual(20);
                    expect(result.boardViewportClearance, 'board frame clears the viewport bottom').toBeGreaterThanOrEqual(0);
                    expect(result.controls.length).toBeGreaterThan(0);
                    for (const control of result.controls) {
                        expect(control.width, `${control.name} width`).toBeGreaterThanOrEqual(44);
                        expect(control.height, `${control.name} height`).toBeGreaterThanOrEqual(44);
                        expect(control.x, `${control.name} left edge`).toBeGreaterThanOrEqual(0);
                        expect(control.y, `${control.name} top edge`).toBeGreaterThanOrEqual(0);
                        expect(control.right, `${control.name} right edge`).toBeLessThanOrEqual(result.viewport.width);
                        expect(control.bottom, `${control.name} bottom edge`).toBeLessThanOrEqual(result.viewport.height);
                    }
                }
            }
        } finally {
            await Promise.all(phones.map(({ context }) => context.close()));
        }
    });
}
