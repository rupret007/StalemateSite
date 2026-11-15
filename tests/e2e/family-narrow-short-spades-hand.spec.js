// Narrow short phones must keep a four-column Spades hand. A later
// short-screen query used to switch that hand to seven columns, so each card
// fell under 44px at 320px wide.
const { test, expect } = require('@playwright/test');
const { gameNight, invite } = require('./chess-phone-fixture');

const VIEWPORTS = [
    { width: 320, height: 568 },
    { width: 360, height: 640 },
    { width: 375, height: 667 },
    { width: 390, height: 844 }
];

function mobileBrowser(browser) {
    return {
        newContext: options => browser.newContext({ ...options, isMobile: true, hasTouch: true })
    };
}

async function openGameNight(host) {
    const start = host.getByRole('button', { name: /Game Night/ });
    if (!await start.isVisible()) await host.locator('.phonetabs [data-show="rooms"]').click();
    await start.click();
    await expect(host.getByRole('region', { name: /Game Night/ })).toBeVisible();
}

async function showSpades(page) {
    await page.getByRole('combobox', { name: 'Switch game' }).selectOption('turdspades');
    await expect(page.locator('[data-spades-status]')).toBeVisible();
}

async function seat(browser, baseURL, viewport, mode) {
    const fixture = await gameNight(mobileBrowser(browser), baseURL);
    const nicks = mode === 'partners'
        ? ['HostExample', 'GuestWest']
        : ['HostExample', 'GuestWest', 'GuestNorth', 'GuestEast'];
    const pages = await Promise.all(nicks.map(nick => fixture.phone(nick, { viewport })));
    const [host, ...guests] = pages;
    await openGameNight(host);
    for (const [index, guest] of guests.entries()) await invite(host, guest, nicks[index + 1]);
    for (const page of pages) await showSpades(page);
    if (mode === 'partners') {
        await host.getByRole('button', { name: 'Open 2-player Spades' }).click();
        await guests[0].getByRole('button', { name: 'Join West' }).click();
    } else {
        await host.getByRole('button', { name: 'Open 4-player Spades' }).click();
        for (const [index, guest] of guests.entries()) {
            await guest.getByRole('button', { name: `Join ${['West', 'North', 'East'][index]}` }).click();
        }
    }
    for (const page of pages) {
        await expect(page.locator('[data-spades-table]')).toBeVisible();
        await expect(page.locator('[data-spades-card]')).toHaveCount(13);
    }
    return { fixture, pages };
}

async function handCards(page) {
    return page.locator('[data-spades-card]').evaluateAll(nodes => nodes.filter(node => {
        const style = getComputedStyle(node);
        return style.display !== 'none' && style.visibility !== 'hidden' && node.getClientRects().length > 0;
    }).map(node => {
        const box = node.getBoundingClientRect();
        return { left: box.left, top: box.top, width: box.width, height: box.height, right: box.right };
    }));
}

function measure(cards) {
    const widths = cards.map(card => card.width);
    const heights = cards.map(card => card.height);
    const unique = values => [...new Set(values.map(value => value.toFixed(1)))].join(',');
    return {
        count: cards.length,
        minWidth: Math.min(...widths),
        minHeight: Math.min(...heights),
        widths: unique(widths),
        heights: unique(heights),
        columns: new Set(cards.map(card => Math.round(card.left))).size
    };
}

for (const viewport of VIEWPORTS) {
    for (const mode of ['partners', 'four']) {
        test(`${mode} Spades cards stay at least 44px at ${viewport.width}×${viewport.height}`, async ({ browser, baseURL }) => {
            test.slow();
            const { fixture, pages } = await seat(browser, baseURL, viewport, mode);
            try {
                expect(await pages[0].evaluate(() => navigator.maxTouchPoints)).toBeGreaterThan(0);
                expect(await pages[0].evaluate(() => window.innerWidth)).toBe(viewport.width);
                expect(await pages[0].evaluate(() => window.innerHeight)).toBe(viewport.height);
                const reports = [];
                for (const page of pages) {
                    const cards = await handCards(page);
                    const size = measure(cards);
                    reports.push(size);
                    expect(size.count).toBe(13);
                    expect(size.columns).toBe(4);
                    for (const card of cards) {
                        expect(card.width).toBeGreaterThanOrEqual(44);
                        expect(card.height).toBeGreaterThanOrEqual(44);
                        expect(card.left).toBeGreaterThanOrEqual(-1);
                        expect(card.right).toBeLessThanOrEqual(viewport.width + 1);
                    }
                    const scroll = await page.evaluate(() => ({
                        scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
                        innerWidth: window.innerWidth,
                        scrollLeft: document.documentElement.scrollLeft || document.body.scrollLeft
                    }));
                    expect(scroll.innerWidth).toBe(viewport.width);
                    expect(scroll.scrollLeft).toBe(0);
                    expect(scroll.scrollWidth).toBeLessThanOrEqual(viewport.width);
                }
                const summary = reports.map(size => `${size.count} cards, ${size.columns} cols, min ${size.minWidth.toFixed(1)}×${size.minHeight.toFixed(1)}, widths ${size.widths}`).join(' | ');
                console.log(`CARD_WIDTHS ${mode} ${viewport.width}x${viewport.height} ${summary}`);
                await expect.poll(async () => {
                    let visible = 0;
                    for (const page of pages) if (await page.locator('[data-spades-bid]').isVisible()) visible += 1;
                    return visible;
                }).toBeGreaterThan(0);
                for (const page of pages) {
                    const bid = page.locator('[data-spades-bid]');
                    if (!await bid.isVisible()) continue;
                    const select = bid.locator('select');
                    const action = bid.getByRole('button', { name: /^(Lock bid|Bid for me)$/ });
                    await expect(select).toBeVisible();
                    await expect(action).toBeVisible();
                    // The bid row sits at the bottom of the short pane. Scroll that
                    // pane so the controls are fully on screen, then confirm they fit.
                    await bid.scrollIntoViewIfNeeded();
                    await expect(select).toBeInViewport({ ratio: 1 });
                    await expect(action).toBeInViewport({ ratio: 1 });
                    const scroll = await page.evaluate(() => ({
                        scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
                        innerWidth: window.innerWidth,
                        scrollLeft: document.documentElement.scrollLeft || document.body.scrollLeft
                    }));
                    expect(scroll.innerWidth).toBe(viewport.width);
                    expect(scroll.scrollLeft).toBe(0);
                    expect(scroll.scrollWidth).toBeLessThanOrEqual(viewport.width);
                }
                expect(fixture.errors()).toEqual([]);
            } finally {
                await fixture.close();
            }
        });
    }
}
