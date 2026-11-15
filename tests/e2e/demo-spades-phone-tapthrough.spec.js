// Game Night demo: phones at 390×844 join one Spades table by invite, bid and
// play the first trick with tap(), and keep hands private from watchers.
// The lobby engine and match transport are the family-alpha harness
// (tests/e2e/chess-phone-fixture.js). Only the Durable Object shell is synthetic.
const { test, expect } = require('@playwright/test');
const { gameNight, room, invite } = require('./chess-phone-fixture');

const PHONE = { width: 390, height: 844 };
const NICKS = ['HostExample', 'GuestWest', 'GuestNorth', 'GuestEast'];
const WATCHER = 'LateWatcher';
const TURN = 'Your turn · tap a card';
const PAUSED = 'Reconnecting to the table… Your hand is paused.';

function touchBrowser(browser) {
    return {
        newContext: options => browser.newContext({ ...options, viewport: PHONE, isMobile: true, hasTouch: true })
    };
}

async function showSpades(page) {
    const picker = page.getByRole('combobox', { name: 'Switch game' });
    await expect(picker.locator('option[value="turdspades"]')).toBeEnabled();
    await picker.selectOption('turdspades');
    await expect(page.locator('[data-spades-status]')).toBeVisible();
}

async function enterPhone(page) {
    await page.locator('[data-enter]').tap();
    await expect(page.locator('[data-connection]')).toHaveText('Connected');
}

async function handIds(page) {
    return page.locator('[data-spades-card]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-spades-card')));
}

async function handLabels(page) {
    return page.locator('[data-spades-hand] [data-spades-card]').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
}

async function spadesSurface(page) {
    return page.locator('.arcade-spades').evaluate(panel => {
        const attrs = [...panel.querySelectorAll('*')].flatMap(node => [...node.attributes].map(attr => attr.value));
        return `${panel.innerText}\n${attrs.join('\n')}`;
    });
}

function matchViews(raw) {
    return raw.map(text => JSON.parse(text)).filter(frame => frame?.state?.match);
}

// A seat may receive only its own hand. Watchers and other seats get no cards,
// no playable flags, and no canBid control for a hand they do not hold (#557/#560).
function assertPrivateHand(raw, ownIds) {
    const own = new Set(ownIds);
    const views = matchViews(raw);
    expect(views.length).toBeGreaterThan(0);
    for (const frame of views) {
        const match = frame.state.match;
        expect(match.hands).toBeUndefined();
        expect(Array.isArray(match.hand)).toBe(true);
        if (own.size === 0) {
            expect(match.hand).toEqual([]);
            expect(match.canBid).not.toBe(true);
        }
        for (const card of match.hand) {
            expect(own.has(String(card.id))).toBe(true);
            if (card.playable === true) expect(own.has(String(card.id))).toBe(true);
        }
    }
    if (own.size === 0) {
        const sent = raw.join('\n');
        expect(sent).not.toMatch(/"playable"/);
        expect(sent).not.toMatch(/"canBid":true/);
        expect(sent).not.toMatch(/"hand":\[\{/);
    }
}

async function measureHand(page) {
    const cards = page.locator('[data-spades-card]');
    await expect(cards).toHaveCount(13);
    expect(await page.evaluate(() => window.innerWidth)).toBe(PHONE.width);
    expect(await page.evaluate(() => window.innerHeight)).toBe(PHONE.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(PHONE.width);
    return cards.evaluateAll(nodes => nodes.map((button, index) => {
        const rect = button.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return {
            index, width: rect.width, height: rect.height, top: rect.top, left: rect.left,
            right: rect.right, bottom: rect.bottom,
            centerHit: !!hit && (hit === button || button.contains(hit))
        };
    }));
}

function expectHandFits(seat, cards) {
    expect(cards, seat).toHaveLength(13);
    for (const card of cards) {
        expect(card.width, `${seat} card ${card.index} width`).toBeGreaterThanOrEqual(44);
        expect(card.height, `${seat} card ${card.index} height`).toBeGreaterThanOrEqual(44);
        expect(card.left, `${seat} card ${card.index} left`).toBeGreaterThanOrEqual(-1);
        expect(card.top, `${seat} card ${card.index} top`).toBeGreaterThanOrEqual(-1);
        expect(card.right, `${seat} card ${card.index} right`).toBeLessThanOrEqual(PHONE.width + 1);
        expect(card.bottom, `${seat} card ${card.index} bottom`).toBeLessThanOrEqual(PHONE.height + 1);
        expect(card.centerHit, `${seat} card ${card.index} center`).toBe(true);
    }
}

async function watchStatus(page) {
    await page.evaluate(() => {
        const node = document.querySelector('[data-spades-status]');
        window.__statusSeen = [node.textContent];
        new MutationObserver(() => window.__statusSeen.push(node.textContent)).observe(node, { childList: true, characterData: true, subtree: true });
    });
    return () => page.evaluate(() => window.__statusSeen);
}

async function tapBid(page) {
    const button = page.getByRole('button', { name: 'Bid for me', exact: true });
    await expect(button).toBeVisible();
    await expect(button).toBeEnabled();
    await button.tap();
    await expect(page.locator('[data-spades-bid]')).toBeHidden();
    await expect(page.locator('[data-spades-trick]')).toContainText('(you) · Bid');
}

async function tapLegalCard(page) {
    const status = page.locator('[data-spades-status]');
    await expect(status).toContainText(TURN);
    await expect(status).not.toContainText('Reconnecting');
    const cards = page.locator('[data-spades-card]');
    const before = await cards.count();
    const card = page.locator('[data-spades-card]:enabled').first();
    await expect(card).toBeVisible();
    await expect(card).toBeEnabled();
    await expect(card).not.toHaveAttribute('data-cannot-follow');
    await card.tap();
    await expect(cards).toHaveCount(before - 1);
}

// West leads. Partners computer seats play inside West's turn, so the next
// human is South. Four-player continues clockwise through North and East.
const ACT_ORDER = { partners: [1, 0], four: [1, 2, 3, 0] };

async function resumeAfterDrop(leader, host) {
    const status = leader.locator('[data-spades-status]');
    const hostStatus = host.locator('[data-spades-status]');
    const pill = leader.locator('.arcade-spades .arcade-reconnect');
    await expect(status).toContainText(TURN);
    const seen = await watchStatus(leader);
    await leader.context().setOffline(true);
    await expect(status).toHaveText(PAUSED);
    await expect(pill).toBeVisible();
    await expect(pill).toHaveText('Reconnecting…');
    await expect(leader.locator('[data-spades-card]:enabled')).toHaveCount(0);
    await expect(hostStatus).toContainText('Waiting for West, link still works.');
    await leader.context().setOffline(false);
    await expect(status).toContainText(TURN);
    await expect(status).not.toContainText('Reconnecting');
    await expect(pill).toBeHidden();
    await expect(hostStatus).not.toContainText('link still works');
    await expect(hostStatus).not.toContainText('Reconnecting');
    await expect(hostStatus).toContainText('West to play');
    const lines = await seen();
    const dropped = lines.findIndex(line => line.includes('Reconnecting'));
    expect(dropped).toBeGreaterThanOrEqual(0);
    const resumed = lines.findIndex((line, index) => index > dropped && line.includes(TURN) && !line.includes('Reconnecting'));
    expect(resumed).toBeGreaterThan(dropped);
    expect(lines.slice(resumed).filter(line => line.includes('Reconnecting'))).toEqual([]);
    return seen;
}

for (const mode of ['partners', 'four']) {
    const seatedCount = mode === 'partners' ? 2 : 4;
    const openLabel = mode === 'partners' ? 'Open 2-player Spades' : 'Open 4-player Spades';
    const joinSeats = mode === 'partners' ? ['West'] : ['West', 'North', 'East'];

    test(`${mode} Spades at 390×844: invite, tap bids, tap the first trick, reload, and hide hands from a watcher`, async ({ browser, baseURL }) => {
        test.setTimeout(180_000);
        const fixture = await gameNight(touchBrowser(browser), baseURL);
        try {
            const pages = await room(fixture, NICKS);
            const seated = pages.slice(0, seatedCount);
            const [host] = seated;
            expect(await host.evaluate(() => navigator.maxTouchPoints)).toBeGreaterThan(0);
            await Promise.all(pages.map(showSpades));
            await host.getByRole('button', { name: openLabel, exact: true }).tap();
            for (const [index, seat] of joinSeats.entries()) {
                await pages[index + 1].getByRole('button', { name: `Join ${seat}`, exact: true }).tap();
            }
            const handsFit = [];
            for (const [index, page] of seated.entries()) {
                await expect(page.locator('[data-spades-table]')).toBeVisible();
                await expect(page.locator('[data-spades-table]')).toHaveAttribute('data-mode', mode);
                await expect(page.locator('[data-spades-card]')).toHaveCount(13);
                handsFit.push([NICKS[index], await measureHand(page)]);
            }

            const watcher = await fixture.phone(WATCHER);
            await invite(host, watcher, WATCHER);
            await showSpades(watcher);
            const watchers = [...pages.slice(seatedCount), watcher];
            for (const page of watchers) {
                await expect(page.locator('[data-spades-table]')).toBeVisible();
                await expect(page.locator('[data-spades-seat]')).toHaveText('Watching · hands are private');
                await expect(page.locator('[data-spades-hand-label]')).toHaveText('Watching · hands are private');
                await expect(page.locator('[data-spades-card]')).toHaveCount(0);
                await expect(page.locator('[data-spades-hand] button')).toHaveCount(0);
                await expect(page.getByRole('button', { name: /^Join / })).toHaveCount(0);
            }

            const ownHands = new Map();
            for (const [index, page] of seated.entries()) ownHands.set(NICKS[index], await handIds(page));
            const dealt = new Set();
            for (const ids of ownHands.values()) {
                expect(ids).toHaveLength(13);
                for (const id of ids) {
                    expect(dealt.has(id)).toBe(false);
                    dealt.add(id);
                }
            }
            expect(dealt.size).toBe(seatedCount * 13);

            const west = seated[1];
            const westHand = ownHands.get(NICKS[1]);
            await west.reload();
            await expect(west.locator('[data-nick]')).toHaveValue(NICKS[1]);
            await enterPhone(west);
            await expect(west.locator('[data-spades-card]')).toHaveCount(13);
            await expect.poll(() => handIds(west)).toEqual(westHand);
            await expect(west.locator('[data-spades-status]')).toContainText('Your bid · tap Bid for me');
            await expect(west.locator('[data-spades-status]')).not.toContainText('Reconnecting');
            await expect(west.locator('.arcade-spades .arcade-reconnect')).toBeHidden();
            handsFit.push([`${NICKS[1]} after reload`, await measureHand(west)]);

            const labels = [];
            for (const page of seated) labels.push(await handLabels(page));
            expect(new Set(labels.flat()).size).toBe(labels.flat().length);
            for (const [index, mine] of labels.entries()) {
                for (const other of [...seated.filter((_, otherIndex) => otherIndex !== index), ...watchers]) {
                    const surface = await spadesSurface(other);
                    for (const label of mine) expect(surface).not.toContain(label);
                }
            }

            for (const index of ACT_ORDER[mode]) await tapBid(seated[index]);
            await expect(west.locator('[data-spades-table]')).toHaveAttribute('data-phase', 'play');
            const seen = await resumeAfterDrop(west, host);
            for (const index of ACT_ORDER[mode]) await tapLegalCard(seated[index]);

            const lines = await seen();
            const dropped = lines.findIndex(line => line.includes('Reconnecting'));
            const resumed = lines.findIndex((line, index) => index > dropped && line.includes(TURN) && !line.includes('Reconnecting'));
            expect(resumed).toBeGreaterThan(dropped);
            expect(lines.slice(resumed).filter(line => line.includes('Reconnecting'))).toEqual([]);

            for (const page of seated) {
                await expect(page.locator('[data-spades-card]')).toHaveCount(12);
                await expect(page.locator('[data-spades-trick-summary]')).toContainText('Trick 2 of 13');
                await expect(page.locator('[data-spades-status]')).not.toContainText('Reconnecting');
                await expect(page.locator('.arcade-spades .arcade-reconnect')).toBeHidden();
            }
            for (const page of watchers) {
                await expect(page.locator('[data-spades-card]')).toHaveCount(0);
                await expect(page.locator('[data-spades-hand-label]')).toHaveText('Watching · hands are private');
                await expect(page.locator('[data-spades-status]')).not.toContainText('Reconnecting');
            }

            for (const [index, page] of seated.entries()) {
                const remaining = await handIds(page);
                expect(remaining).toHaveLength(12);
                for (const id of remaining) expect(ownHands.get(NICKS[index]).includes(id)).toBe(true);
                assertPrivateHand(fixture.frames(NICKS[index]), ownHands.get(NICKS[index]));
            }
            for (const [index, page] of watchers.entries()) {
                const nick = index < pages.slice(seatedCount).length ? NICKS[seatedCount + index] : WATCHER;
                expect(await handIds(page)).toEqual([]);
                assertPrivateHand(fixture.frames(nick), []);
            }
            expect(fixture.errors()).toEqual([]);
            for (const [seat, cards] of handsFit) expectHandFits(seat, cards);
        } finally {
            await fixture.close();
        }
    });
}
