// Short screens use seven Spades columns once each card is still at least
// 44px wide (375px and up). Narrower phones stay on four columns. 375×667
// and 375×661 must show the whole hand and the Send / bid control together.
const { test, expect } = require('@playwright/test');
const { gameNight, invite } = require('./chess-phone-fixture');

const VIEWPORTS = [
    { width: 320, height: 568 },
    { width: 360, height: 640 },
    { width: 375, height: 667 },
    { width: 375, height: 661 },
    { width: 390, height: 844 }
];

function mobileBrowser(browser) {
    return {
        newContext: options => browser.newContext({ ...options, isMobile: true, hasTouch: true })
    };
}

function fitsTogether(viewport) {
    return viewport.width === 375 && (viewport.height === 667 || viewport.height === 661);
}

function expectedColumns(viewport) {
    return viewport.width >= 375 && viewport.height <= 720 ? 7 : 4;
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

async function cardBoxes(page) {
    const cards = page.locator('[data-spades-card]');
    const count = await cards.count();
    const boxes = [];
    for (let index = 0; index < count; index += 1) {
        const box = await cards.nth(index).boundingBox();
        expect(box, `card ${index} bounding box`).not.toBeNull();
        boxes.push(box);
    }
    return boxes;
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
        columns: new Set(cards.map(card => Math.round(card.x))).size
    };
}

async function scrollOffset(page) {
    return page.evaluate(() => {
        const nodes = [document.scrollingElement, document.documentElement, document.body,
            ...document.querySelectorAll('.game-night, .chat, .pane')];
        return nodes.filter(Boolean).reduce((sum, node) => sum + (node.scrollTop || 0) + (node.scrollLeft || 0), 0);
    });
}

async function noHorizontalScroll(page, viewport) {
    const scroll = await page.evaluate(() => ({
        scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
        innerWidth: window.innerWidth,
        scrollLeft: document.documentElement.scrollLeft || document.body.scrollLeft
    }));
    expect(scroll.innerWidth).toBe(viewport.width);
    expect(scroll.scrollLeft).toBe(0);
    expect(scroll.scrollWidth).toBeLessThanOrEqual(viewport.width);
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
                const together = fitsTogether(viewport);
                const reports = [];
                for (const page of pages) {
                    expect(await scrollOffset(page)).toBe(0);
                    const cards = await cardBoxes(page);
                    const size = measure(cards);
                    const hand = await page.locator('[data-spades-hand]').boundingBox();
                    const send = await page.locator('[data-send]').boundingBox();
                    expect(hand).not.toBeNull();
                    expect(send).not.toBeNull();
                    const handBottom = hand.y + hand.height;
                    const sendBottom = send.y + send.height;
                    reports.push({ ...size, handBottom, sendBottom });
                    console.log(`CARD_FIT_PAGE ${mode} ${viewport.width}x${viewport.height} cols ${size.columns} min ${size.minWidth.toFixed(1)}x${size.minHeight.toFixed(1)} hand ${hand.y.toFixed(1)}-${handBottom.toFixed(1)} send ${send.y.toFixed(1)}-${sendBottom.toFixed(1)}`);
                    expect(size.count).toBe(13);
                    expect(size.columns).toBe(expectedColumns(viewport));
                    for (const card of cards) {
                        expect(card.width).toBeGreaterThanOrEqual(44);
                        expect(card.height).toBeGreaterThanOrEqual(44);
                        expect(card.x).toBeGreaterThanOrEqual(-1);
                        expect(card.x + card.width).toBeLessThanOrEqual(viewport.width + 1);
                    }
                    await noHorizontalScroll(page, viewport);
                    if (together) {
                        await expect(page.locator('[data-spades-hand]')).toBeInViewport({ ratio: 1 });
                        await expect(page.locator('[data-send]')).toBeInViewport({ ratio: 1 });
                        expect(hand.y).toBeGreaterThanOrEqual(0);
                        expect(send.y).toBeGreaterThanOrEqual(0);
                        expect(handBottom).toBeLessThanOrEqual(viewport.height);
                        expect(sendBottom).toBeLessThanOrEqual(viewport.height);
                    }
                }
                const summary = reports.map(size => `${size.count} cards, ${size.columns} cols, min ${size.minWidth.toFixed(1)}×${size.minHeight.toFixed(1)}, handBottom ${size.handBottom.toFixed(1)}, sendBottom ${size.sendBottom.toFixed(1)}`).join(' | ');
                console.log(`CARD_FIT ${mode} ${viewport.width}x${viewport.height} ${summary}`);
                await expect.poll(async () => {
                    let visible = 0;
                    for (const page of pages) if (await page.locator('[data-spades-bid]').isVisible()) visible += 1;
                    return visible;
                }).toBeGreaterThan(0);
                let bidder = null;
                for (const page of pages) {
                    const bid = page.locator('[data-spades-bid]');
                    if (!await bid.isVisible()) continue;
                    bidder = page;
                    const select = bid.locator('select');
                    const action = bid.getByRole('button', { name: /^(Lock bid|Bid for me)$/ });
                    await expect(select).toBeVisible();
                    await expect(action).toBeVisible();
                    if (together) {
                        expect(await scrollOffset(page)).toBe(0);
                        await expect(page.locator('[data-spades-hand]')).toBeInViewport({ ratio: 1 });
                        await expect(page.locator('[data-send]')).toBeInViewport({ ratio: 1 });
                        await expect(select).toBeInViewport({ ratio: 1 });
                        await expect(action).toBeInViewport({ ratio: 1 });
                    } else {
                        await bid.scrollIntoViewIfNeeded();
                        await expect(select).toBeInViewport({ ratio: 1 });
                        await expect(action).toBeInViewport({ ratio: 1 });
                    }
                    await noHorizontalScroll(page, viewport);
                }
                expect(bidder).toBeTruthy();
                const select = bidder.getByLabel('Your bid');
                const current = await select.inputValue();
                const next = current === '0' ? '1' : '0';
                await select.selectOption(next);
                const lock = bidder.getByRole('button', { name: 'Lock bid', exact: true });
                await expect(lock).toBeEnabled();
                if (together) {
                    expect(await scrollOffset(bidder)).toBe(0);
                    await expect(lock).toBeInViewport({ ratio: 1 });
                    await expect(bidder.locator('[data-spades-hand]')).toBeInViewport({ ratio: 1 });
                    await expect(bidder.locator('[data-send]')).toBeInViewport({ ratio: 1 });
                }
                await lock.click();
                await expect(bidder.locator('[data-spades-bid]')).toBeHidden();
                await expect(bidder.locator('[data-spades-trick]')).toContainText(next === '0' ? '(you) · Bid Nil' : '(you) · Bid 1');
                expect(fixture.errors()).toEqual([]);
            } finally {
                await fixture.close();
            }
        });
    }
}
