const { randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const PHONE = { width: 390, height: 844 };
const DEAD_END = /invite is no longer available|could not load|no seat is available/i;

async function privatePreview() {
    const invitation = randomBytes(32).toString('base64url');
    const child = spawn(process.execPath, ['tests/runtime/arcade-transport.mjs', '--serve'], {
        cwd: path.resolve(__dirname, '../..'),
        env: { ...process.env, ARCADE_PREVIEW_INVITATION: invitation },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const origin = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Private Game Night fixture did not start within 90 seconds.')), 90000);
        const inspect = () => {
            const match = /Stalemate private Game Night preview with all nine games: (https?:\/\/[^\s]+)/.exec(output);
            if (match) { clearTimeout(timer); resolve(match[1]); }
            else if (child.exitCode !== null) {
                clearTimeout(timer);
                reject(new Error(`Private Game Night fixture exited (${child.exitCode}): ${stderr.slice(-2000)}`));
            }
        };
        child.stdout.on('data', inspect);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', inspect);
    });
    return { origin, invitation, stop: () => child.kill('SIGTERM') };
}

async function enterPhone(browser, origin, invitation, nick) {
    const context = await browser.newContext({ viewport: PHONE, hasTouch: true, ignoreHTTPSErrors: true, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.on('pageerror', error => { page.__pageErrors ||= []; page.__pageErrors.push(error.message); });
    await page.goto(`${origin}/beta/?via=stalemate`);
    await page.getByLabel('Invitation code').fill(invitation);
    await page.getByRole('button', { name: 'Enter the community' }).click();
    await page.getByRole('link', { name: /Enter Game Night/ }).click();
    await page.getByLabel('Your nick').fill(nick);
    await page.locator('[data-enter]').click();
    await expect(page.locator('[data-connection]')).toHaveText('Connected');
    return { context, page };
}

async function invite(host, guest, nick) {
    await host.getByRole('button', { name: 'Invite players' }).click();
    await host.locator('[data-invite-dialog]').getByRole('button', { name: `Invite ${nick}`, exact: true }).click();
    const offer = guest.locator('[data-game-offer]');
    await expect(offer).toBeVisible();
    await offer.getByRole('button', { name: 'Join Game Night' }).click();
    await expect(guest.getByRole('region', { name: /Game Night/ })).toBeVisible();
    if (await host.locator('[data-invite-dialog][open]').count()) await host.keyboard.press('Escape');
}

async function switchGame(pages, value) {
    for (const page of pages) {
        const picker = page.getByRole('combobox', { name: 'Switch game' });
        await expect(picker.locator(`option[value="${value}"]`)).toBeEnabled();
        await picker.selectOption(value);
        await expect(page.getByRole('region', { name: /Game Night/ })).toBeVisible();
    }
}

async function assertPhoneControl(control, label) {
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box, `${label} has a rendered target`).not.toBeNull();
    expect(box.width, `${label} is at least 44px wide`).toBeGreaterThanOrEqual(44);
    expect(box.height, `${label} is at least 44px tall`).toBeGreaterThanOrEqual(44);
    expect(box.x, `${label} is fully inside the viewport`).toBeGreaterThanOrEqual(0);
    expect(box.y, `${label} is fully inside the viewport`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `${label} is fully inside the viewport`).toBeLessThanOrEqual(PHONE.width);
    expect(box.y + box.height, `${label} is fully inside the viewport`).toBeLessThanOrEqual(PHONE.height);
    await expect(control).toBeInViewport({ ratio: 1 });
    return { width: Math.round(box.width), height: Math.round(box.height) };
}

test('one private invite reaches a first move in six Game Night games and survives switches on phones', async ({ browser }) => {
    test.setTimeout(330000);
    const started = Date.now();
    const fixture = await privatePreview();
    const players = [];
    const measurements = [];
    try {
        const nicks = ['SmokeHost', 'SmokeWest', 'SmokeNorth', 'SmokeEast'];
        for (const nick of nicks) players.push(await enterPhone(browser, fixture.origin, fixture.invitation, nick));
        const pages = players.map(player => player.page);
        const [host, west, north, east] = pages;
        await host.getByRole('button', { name: /Game Night/ }).click();
        await expect(host.getByRole('region', { name: /Game Night/ })).toBeVisible();
        for (let i = 1; i < pages.length; i++) await invite(host, pages[i], nicks[i]);

        const moveStart = Date.now();
        await switchGame(pages.slice(0, 2), 'chess');
        await host.getByRole('button', { name: 'Open Chess match' }).click();
        await west.getByRole('button', { name: 'Join as Black' }).tap();
        await expect(host.locator('.arcade-chess-board')).toBeVisible();
        await expect(west.locator('.arcade-chess-board')).toBeVisible();
        const e2 = host.locator('[data-square="e2"]');
        measurements.push(['Chess square', await assertPhoneControl(e2, 'Chess first-move square')]);
        await e2.tap();
        await host.locator('[data-square="e4"]').tap();
        await expect(west.getByRole('button', { name: 'e4, White pawn' })).toBeVisible();
        measurements.push(['Chess', Date.now() - moveStart]);

        const partnersStart = Date.now();
        await switchGame(pages.slice(0, 2), 'turdspades');
        await host.getByRole('button', { name: 'Open 2-player Spades' }).click();
        await west.getByRole('button', { name: 'Join game', exact: true }).tap();
        await expect(west.locator('[data-spades-table]')).toHaveAttribute('data-mode', 'partners');
        const partnerBid = west.getByRole('button', { name: 'Bid for me' });
        measurements.push(['Partners bid', await assertPhoneControl(partnerBid, 'partners Spades bid')]);
        await partnerBid.tap();
        await host.getByRole('button', { name: 'Bid for me' }).tap();
        await expect(host.locator('[data-spades-table]')).toHaveAttribute('data-phase', 'play');
        measurements.push(['partners Spades', Date.now() - partnersStart]);

        const fourStart = Date.now();
        await switchGame(pages, 'turdspades');
        await host.locator('[data-spades-action="leave"]').click();
        const leaveDialog = host.getByRole('dialog', { name: 'Leave this table?' });
        await leaveDialog.getByRole('button', { name: 'Leave table' }).click();
        await host.getByRole('button', { name: 'Open 4-player Spades' }).click();
        for (const [page, seat] of [[west, 'West'], [north, 'North'], [east, 'East']]) {
            await page.getByRole('button', { name: `Join ${seat}` }).tap();
        }
        const bid = host.getByRole('button', { name: 'Bid for me' });
        measurements.push(['Four-player bid', await assertPhoneControl(bid, 'four-player Spades bid')]);
        for (const page of [west, north, east, host]) await page.getByRole('button', { name: 'Bid for me' }).tap();
        await expect(host.locator('[data-spades-table]')).toHaveAttribute('data-phase', 'play');
        measurements.push(['four-player Spades', Date.now() - fourStart]);

        const brickStart = Date.now();
        await switchGame(pages.slice(0, 2), 'turdanoid');
        await host.getByRole('button', { name: 'Open Turdanoid race' }).click();
        await west.getByRole('button', { name: 'Join Turdanoid race' }).tap();
        const launch = west.getByRole('button', { name: 'Launch ball' });
        await expect(launch).toBeEnabled();
        measurements.push(['Turdanoid launch', await assertPhoneControl(launch, 'Turdanoid Launch ball')]);
        await launch.tap();
        await expect(west.locator('[data-brick-match]')).toHaveAttribute('data-phase', 'play');
        measurements.push(['Turdanoid', Date.now() - brickStart]);

        const rushStart = Date.now();
        await switchGame(pages.slice(0, 2), 'turdrush');
        await host.getByRole('button', { name: 'Open Turd Rush race' }).click();
        await west.getByRole('button', { name: 'Join Turd Rush race' }).tap();
        const track = west.getByRole('region', { name: 'Turd Rush race track' });
        await expect(track).toBeVisible();
        await expect(west.locator('[data-race-match]')).toHaveAttribute('data-phase', 'play');
        const moveRight = west.getByRole('button', { name: 'Move right' });
        measurements.push(['Turd Rush control', await assertPhoneControl(moveRight, 'Turd Rush lane control')]);
        const beforeLane = await west.locator('[data-race-match]').getAttribute('data-lane');
        await moveRight.tap();
        await expect(west.locator('[data-race-match]')).not.toHaveAttribute('data-lane', beforeLane);
        measurements.push(['Turd Rush', Date.now() - rushStart]);

        const eightsStart = Date.now();
        await switchGame(pages.slice(0, 2), 'crapeights');
        await host.getByRole('button', { name: 'Open Eights table' }).click();
        await west.getByRole('button', { name: 'Join Eights table' }).tap();
        const hand = host.locator('[data-eights-card]');
        await expect(hand).toHaveCount(7);
        const playable = host.locator('[data-eights-card]:enabled').first();
        const draw = host.getByRole('button', { name: /Draw ·/ });
        const hasPlayable = await playable.count() > 0;
        const firstAction = hasPlayable ? playable : draw;
        measurements.push(['Crazy Eights card', await assertPhoneControl(firstAction, 'Crazy Eights first action')]);
        if (hasPlayable) await playable.tap();
        else await draw.tap();
        await expect(hand).toHaveCount(hasPlayable ? 6 : 8);
        measurements.push(['Crazy Eights', Date.now() - eightsStart]);

        for (const page of pages) {
            await expect(page.getByRole('region', { name: /Game Night/ })).toBeVisible();
            await expect(page.locator('[data-game-night]')).toBeVisible();
            await expect(page.locator('[data-game-waiting]')).not.toContainText(DEAD_END);
            expect(page.__pageErrors || []).toEqual([]);
        }
        console.log(`Demo smoke measurements (ms per first move; control px): ${JSON.stringify(measurements)}; total ${Date.now() - started} ms.`);
        expect(Date.now() - started, 'six-game demo remains under six minutes').toBeLessThan(360000);
    } finally {
        await Promise.all(players.map(player => player.context.close()));
        fixture.stop();
    }
});
