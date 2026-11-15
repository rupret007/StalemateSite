// Four real phones at one four-player Spades table (390×844, coarse pointer).
//
// The Game Night phone harness lives in family-alpha-gate.spec.js (room, invite,
// phone, act, record). That spec does not export it, and loading it as a test
// file would register its whole suite again. This file compiles those fixtures
// with the suite loop removed, and sets isMobile so (pointer: coarse) matches.
// tests/e2e/spades-phone-layout.spec.js is not on this base; when it is present
// and exports helpers, those are used for the 44px box check.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { test, expect } = require('@playwright/test');

const SUITS = ['S', 'H', 'D', 'C'];
const NICKS = ['HostExample', 'GuestWest', 'GuestNorth', 'GuestEast'];
const SEATS = ['south', 'west', 'north', 'east'];
const SEAT_NAME = { south: 'South', west: 'West', north: 'North', east: 'East' };
const NICK_BY_SEAT = Object.fromEntries(SEATS.map((seat, index) => [seat, NICKS[index]]));

function familyFixtures() {
    const filename = path.join(__dirname, 'family-alpha-gate.spec.js');
    const original = fs.readFileSync(filename, 'utf8');
    const contextLine = 'const context = await browser.newContext({ viewport, hasTouch: true });';
    const suiteAt = original.indexOf('\nfor (const game of Object.values(GAMES)) {');
    if (!original.includes(contextLine) || suiteAt < 0) {
        throw new Error('family-alpha-gate.spec.js no longer matches the fixture loader');
    }
    const source = original.slice(0, suiteAt).replace(
        contextLine,
        'const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true });'
    ) + '\nmodule.exports = { PHONE, gameNight, enter, room, invite, seated, showTable, GAMES };\n';
    const compiled = new Module(filename, module);
    compiled.filename = filename;
    compiled.paths = Module._nodeModulePaths(path.dirname(filename));
    compiled._compile(source, filename);
    return compiled.exports;
}

function layoutFixtures() {
    const filename = path.join(__dirname, 'spades-phone-layout.spec.js');
    if (!fs.existsSync(filename)) return {};
    const original = fs.readFileSync(filename, 'utf8');
    if (!original.includes('module.exports')) return {};
    return require('./spades-phone-layout.spec.js');
}

const { PHONE, gameNight, room } = familyFixtures();
const layout = layoutFixtures();

function suitOf(id) {
    return SUITS[Math.floor(id / 13)];
}

// Same legal-card rule the table uses, so the hook can play a hand without
// clicking all 52 cards. Any legal card is enough; the test does not care which.
function legalCard(state, seat) {
    const hand = state.hands[seat];
    const countInTrick = state.played.length % 4;
    const trick = countInTrick ? state.played.slice(-countInTrick) : [];
    const lead = trick.length ? suitOf(trick[0].id) : null;
    if (lead) {
        const following = hand.filter(id => suitOf(id) === lead);
        return (following.length ? following : hand)[0];
    }
    if (state.spadesBroken) return hand[0];
    const offSuit = hand.filter(id => suitOf(id) !== 'S');
    return (offSuit.length ? offSuit : hand)[0];
}

async function boxAtLeast44(locator) {
    if (layout.boxAtLeast44) return layout.boxAtLeast44(locator);
    await expect(locator).toBeVisible();
    await expect(locator).toBeInViewport();
    const box = await locator.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
}

async function handIds(page) {
    return page.locator('[data-spades-hand] [data-spades-card]').evaluateAll(nodes => nodes.map(node => node.dataset.spadesCard));
}

async function assertOwnHands(pages) {
    const hands = await Promise.all(pages.map(handIds));
    const all = hands.flat();
    expect(new Set(all).size, 'each card button belongs to one phone').toBe(all.length);
    for (const [index, page] of pages.entries()) {
        expect(await page.locator('[data-spades-card]').count()).toBe(hands[index].length);
    }
}

async function assertNoOverflow(page) {
    const width = page.viewportSize().width;
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const past = await page.evaluate(limit => [...document.querySelectorAll('.arcade-spades *')].filter(node => {
        const box = node.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && box.right > limit + 1;
    }).slice(0, 4).map(node => node.getAttribute('data-spades-action') || node.className || node.tagName), width);
    expect(past).toEqual([]);
}

async function assertTurnCue(pages) {
    const statuses = await Promise.all(pages.map(page => page.locator('[data-spades-status]').innerText()));
    const actor = statuses.findIndex(text => /Your (bid|play)/.test(text));
    expect(actor, `one phone is told it is their turn: ${statuses.join(' | ')}`).toBeGreaterThanOrEqual(0);
    const name = SEAT_NAME[SEATS[actor]];
    for (const [index, text] of statuses.entries()) {
        if (index === actor) {
            expect(text).toMatch(/Your (bid|play)/);
            await expect(pages[index].locator('[data-spades-trick] [data-active="true"]')).toContainText(name);
            await expect(pages[index].locator('[data-spades-trick] [data-active="true"]')).toContainText('(you)');
        } else {
            expect(text).toContain(`${name} to`);
        }
    }
}

async function assertNotStuck(page) {
    const status = page.locator('[data-spades-status]');
    await expect(status).not.toHaveText('');
    const text = await status.innerText();
    expect(text).not.toMatch(/Checking the table|couldn’t reconnect|could not confirm|Waiting for the host to open/i);
    await expect(page.locator('[data-spades-error]')).toHaveText('');
    const phase = await page.locator('[data-spades-table]').getAttribute('data-phase');
    if (/Your bid/.test(text)) {
        await expect(page.locator('[data-spades-action="bid"]')).toBeEnabled();
    } else if (/Your play/.test(text)) {
        expect(await page.locator('[data-spades-card]:enabled').count()).toBeGreaterThan(0);
    } else if (phase === 'round-end' && !/win by/.test(text)) {
        await expect(page.getByRole('button', { name: 'Next round', exact: true })).toBeEnabled();
    } else if (/win by/.test(text)) {
        await expect(page.getByRole('button', { name: /Spades rematch/ })).toBeEnabled();
    } else {
        expect(text).toMatch(/South|West|North|East/);
    }
}

async function assertPhones(pages) {
    await assertOwnHands(pages);
    for (const page of pages) {
        await assertNoOverflow(page);
        await assertNotStuck(page);
    }
}

async function savedTable(fixture) {
    return (await fixture.record('turdspades')).turdspades;
}

async function playOutHand(fixture) {
    for (let play = 0; play < 52; play++) {
        const saved = await savedTable(fixture);
        expect(saved.match.phase, `play ${play}`).toBe('play');
        const seat = saved.match.turn;
        const revision = saved.match.revision;
        await fixture.act(NICK_BY_SEAT[seat], 'turdspades', {
            action: 'play', id: saved.id, revision, card: legalCard(saved.match, seat)
        });
        expect((await savedTable(fixture)).match.revision).toBe(revision + 1);
    }
    expect((await savedTable(fixture)).match.phase).toBe('round-end');
}

test('four phones bid, finish a hand, start the next hand, and rematch in the same seats', async ({ browser, baseURL }) => {
    test.setTimeout(180_000);
    const fixture = await gameNight(browser, baseURL);
    try {
        const pages = await room(fixture, NICKS);
        for (const page of pages) {
            expect(page.viewportSize()).toEqual(PHONE);
            expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
            await page.getByRole('combobox', { name: 'Switch game' }).selectOption('turdspades');
            await expect(page.locator('[data-spades-status]')).toBeVisible();
        }
        const [south, west, north, east] = pages;
        await south.getByRole('button', { name: 'Open 4-player Spades', exact: true }).click();
        for (const [page, seat] of [[west, 'West'], [north, 'North'], [east, 'East']]) {
            await page.getByRole('button', { name: `Join ${seat}`, exact: true }).click();
        }
        for (const page of pages) {
            await expect(page.locator('[data-spades-table]')).toBeVisible();
            await expect(page.locator('[data-spades-card]')).toHaveCount(13);
        }
        const seats = NICKS.map(nick => fixture.view(nick, 'turdspades').deserializeAttachment().seat);
        expect(seats).toEqual(SEATS);
        await assertPhones(pages);
        await assertTurnCue(pages);

        // West bids first (dealer is South). Each phone sees Bid for me, edits
        // the amount, and locks that bid. The lock control has to stay 44px.
        for (const page of [west, north, east, south]) {
            await expect(page.locator('[data-spades-status]')).toContainText('Your bid');
            await assertTurnCue(pages);
            await assertPhones(pages);
            const bidForMe = page.getByRole('button', { name: 'Bid for me', exact: true });
            await boxAtLeast44(bidForMe);
            const select = page.getByLabel('Your bid');
            const current = await select.inputValue();
            await select.selectOption(current === '0' ? '1' : '0');
            const lock = page.getByRole('button', { name: 'Lock bid', exact: true });
            await boxAtLeast44(lock);
            await lock.tap();
        }
        // Dealer is South, so the lead returns to West.
        await expect(west.locator('[data-spades-status]')).toContainText('Your play');
        await assertPhones(pages);
        await assertTurnCue(pages);

        await playOutHand(fixture);
        let summary = '';
        for (const page of pages) {
            await expect(page.locator('[data-spades-table]')).toHaveAttribute('data-phase', 'round-end');
            await expect(page.locator('[data-spades-status]')).toContainText('South + North');
            await expect(page.locator('[data-spades-status]')).toContainText('West + East');
            await boxAtLeast44(page.getByRole('button', { name: 'Next round', exact: true }));
        }
        summary = await south.locator('[data-spades-status]').innerText();
        for (const page of pages) await expect(page.locator('[data-spades-status]')).toHaveText(summary);
        await assertPhones(pages);

        await south.getByRole('button', { name: 'Next round', exact: true }).tap();
        await expect(north.locator('[data-spades-status]')).toContainText('Round 2');
        await expect(north.locator('[data-spades-status]')).toContainText('Your bid');
        for (const page of pages) {
            await expect(page.locator('[data-spades-table]')).toHaveAttribute('data-phase', 'bid');
            await expect(page.locator('[data-spades-status]')).not.toContainText('won the last trick');
            await expect(page.locator('[data-spades-trick] b')).toHaveText(['—', '—', '—', '—']);
        }
        await assertPhones(pages);
        await assertTurnCue(pages);

        const finishedFrom = await savedTable(fixture);
        await fixture.act(NICKS[3], 'turdspades', {
            action: 'resign', id: finishedFrom.id, revision: finishedFrom.match.revision
        });
        for (const page of pages) {
            await expect(page.locator('[data-spades-status]')).toContainText(/win by resignation/);
            await assertNoOverflow(page);
            await assertNotStuck(page);
        }
        await assertOwnHands(pages);

        for (const page of pages) {
            const rematch = page.getByRole('button', { name: /Spades rematch/ });
            await boxAtLeast44(rematch);
            await rematch.tap();
        }
        for (const [index, page] of pages.entries()) {
            await expect(page.locator('[data-spades-status]')).toContainText('Round 1');
            await expect(page.locator('[data-spades-status]')).not.toContainText('won the last trick');
            await expect(page.locator('[data-spades-card]')).toHaveCount(13);
            await expect.poll(() => fixture.view(NICKS[index], 'turdspades').deserializeAttachment().seat).toBe(seats[index]);
        }
        await assertPhones(pages);
        await assertTurnCue(pages);
        expect(fixture.errors()).toEqual([]);
    } finally {
        await fixture.close();
    }
});
