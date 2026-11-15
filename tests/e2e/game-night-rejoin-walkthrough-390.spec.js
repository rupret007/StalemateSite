// Walkthrough evidence for the protected Game Night guest recovery UI.
// The loopback server has no beta cookie issuer, so the resume HTTP boundary is
// routed below; the Chess reconnect uses the shared live transport fixture.
const { test, expect } = require('@playwright/test');
const { randomBytes, randomUUID } = require('node:crypto');
const { readFile, mkdir } = require('node:fs/promises');
const path = require('node:path');
const { gameNight, room } = require('./chess-phone-fixture');

const ROOT = '/r/45662413410ed051/lobby/';
const RESUME = '/beta/game-night/invitation/resume';
const SHOTS = path.resolve(__dirname, '../../test-results/wj-rejoin-walkthrough');
const STATUS = '[data-chess-status]';
const seatText = text => /You’re (White|Black)/.exec(text)?.[1];

async function shot(page, name) {
    await mkdir(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`), animations: 'disabled' });
}

async function chessTable(fixture) {
    const [host, guest] = await room(fixture, ['WalkHost', 'WalkGuest']);
    for (const page of [host, guest]) {
        await page.getByRole('combobox', { name: 'Switch game' }).selectOption('chess');
        await expect(page.locator(STATUS)).toBeVisible();
    }
    await host.getByRole('button', { name: 'Open Chess match' }).click();
    await guest.getByRole('button', { name: 'Join as Black' }).click();
    await expect(guest.locator(STATUS)).toContainText('You’re Black');
    await expect(host.locator(STATUS)).toContainText('You’re White');
    return { host, guest };
}

test('390×844 guest reconnects to the same Chess table and plays a legal turn', async ({ browser, baseURL }) => {
    test.slow();
    const fixture = await gameNight(browser, baseURL);
    try {
        const { host, guest } = await chessTable(fixture);
        const table = (await fixture.record('chess')).chess.tableId;
        const seat = seatText(await guest.locator(STATUS).textContent());
        expect(seat).toBe('Black');
        await shot(guest, '01-guest-seated');

        const originalSocket = fixture.view('WalkGuest', 'chess');
        await fixture.dropMatch('WalkGuest', 'chess');
        await expect(guest.locator(STATUS)).toContainText('Reconnecting to Chess');
        await shot(guest, '02-guest-disconnected');
        await expect.poll(() => fixture.view('WalkGuest', 'chess')?.readyState).toBe(1);
        expect(fixture.view('WalkGuest', 'chess')).not.toBe(originalSocket);
        await expect(guest.locator(STATUS)).toContainText('You’re Black');
        expect((await fixture.record('chess')).chess.tableId).toBe(table);
        expect(fixture.view('WalkGuest', 'chess').deserializeAttachment().seat).toBe('b');
        expect(seatText(await guest.locator(STATUS).textContent())).toBe(seat);
        await shot(guest, '03-guest-restored');

        // White moves first; the recovered Black seat then makes a legal reply.
        await host.locator('[data-square="e2"]').click();
        await host.locator('[data-square="e4"]').click();
        await expect(guest.locator(STATUS)).toContainText('Your turn');
        await guest.locator('[data-square="e7"]').click();
        await expect(guest.locator('[data-square="e5"]')).toHaveAttribute('data-legal', '');
        await guest.locator('[data-square="e5"]').click();
        await expect.poll(async () => (await fixture.record('chess')).chess.match.moves).toEqual(['e2e4', 'e7e5']);
        await expect(host.locator('[data-square="e5"]')).toHaveAttribute('data-piece', 'bp');
        await shot(host, '04-host-sees-guest-turn');
        expect(fixture.errors()).toEqual([]);
    } finally { await fixture.close(); }
});

// Mirror the protected worker's cookie-free resume shell while loading the
// actual shipped guest script and its imports. No pass appears in the DOM.
const resumeShell = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Game Night invitation</title><script type="module" src="/beta/game-night/guest.js"></script></head>
<body><main data-resume-guest class="game-invitation"><h1 data-guest-game>Game Night</h1>
<p data-guest-status role="status">Connecting…</p>
<section data-guest-invite hidden><button data-guest-join>Join game</button></section>
<button data-guest-retry hidden>Try again</button>
<button data-guest-fresh hidden>Ask the host for a fresh link</button></main></body></html>`;

async function cookieFreeResume(browser, baseURL, outcome) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const tableId = randomUUID(), pass = randomBytes(32).toString('hex');
    let attempts = 0;
    await context.addInitScript(({ tableId, pass }) => {
        localStorage.setItem('gn:pass:' + tableId, pass);
        localStorage.setItem('gn:last-table', tableId);
    }, { tableId, pass });
    await context.route(url => url.pathname === ROOT && url.searchParams.get('game-guest') === '1', async route => {
        if (attempts === 0) await route.fulfill({ status: 401, contentType: 'text/html', body: resumeShell });
        else await route.continue();
    });
    await context.route('**/beta/game-night/guest.js', async route => route.fulfill({
        contentType: 'text/javascript',
        body: await readFile(path.resolve(__dirname, '../../r/45662413410ed051/lobby/game-night-guest.js'), 'utf8')
    }));
    await context.route(url => url.pathname === RESUME, async route => {
        const body = route.request().postDataJSON();
        // Compare without letting a failed assertion print the saved pass.
        expect(body.tableId === tableId && body.pass === pass).toBe(true);
        expect(route.request().headers().cookie).toBeUndefined();
        attempts++;
        if (attempts === 1) return route.fulfill({ status: 429, json: { error: 'limited' } });
        return outcome === 410
            ? route.fulfill({ status: 410, json: { error: 'gone' } })
            : route.fulfill({ status: 200, json: { next: ROOT + '?game-guest=1' } });
    });
    const page = await context.newPage();
    await page.goto(`${ROOT}?game-guest=1&table=${tableId}`);
    return { page, context, tableId, attempts: () => attempts };
}

for (const outcome of [200, 410]) {
    test(`390×844 cookie-free saved-pass resume: 429 then ${outcome}`, async ({ browser, baseURL }) => {
        const flow = await cookieFreeResume(browser, baseURL, outcome);
        try {
            const { page, tableId } = flow;
            const status = page.locator('[data-guest-status]');
            const retry = page.locator('[data-guest-retry]');
            await expect(status).toHaveText('Too many reconnect attempts. Wait a minute, then try again.');
            await expect(retry).toBeFocused();
            await shot(page, `05-resume-${outcome}-wait`);
            await retry.click();
            await expect.poll(flow.attempts).toBe(2);
            if (outcome === 410) {
                await expect(page.locator('[data-guest-fresh]')).toBeVisible();
                await expect(page.locator('[data-guest-fresh]')).toHaveText('Ask the host for a fresh link.');
                await expect(retry).toBeHidden();
                expect(await page.evaluate(id => localStorage.getItem('gn:pass:' + id) === null, tableId)).toBe(true);
                await shot(page, '06-resume-expired-fresh-link');
            } else {
                await expect.poll(() => {
                    const url = new URL(page.url());
                    return url.pathname === ROOT && url.searchParams.get('game-guest') === '1'
                        && url.searchParams.get('table') === tableId;
                }).toBe(true);
                await expect(page.locator('[data-guest-status]')).toHaveCount(0);
                await shot(page, '06-resume-redirected-to-table');
            }
        } finally { await flow.context.close(); }
    });
}
