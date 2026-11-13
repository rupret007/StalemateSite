const { test, expect } = require('@playwright/test');

const origin = process.env.FOUR_INVITE_ORIGIN || '';
const invitation = process.env.FOUR_INVITE_CODE || '';

test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    ignoreHTTPSErrors: true
});

async function localOnly(context) {
    await context.route('**/*', route => {
        const url = route.request().url();
        if (url.startsWith(origin) || url.startsWith('blob:') || url.startsWith('data:')) return route.continue();
        return route.abort();
    });
}

async function enterHost(page, nick) {
    await page.goto(`${origin}/beta/?via=stalemate`, { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Invitation code').fill(invitation);
    await page.getByRole('button', { name: /Enter the community/ }).click();
    await page.getByRole('link', { name: /Enter Game Night/ }).click();
    await page.getByLabel('Your nick').fill(nick);
    await page.locator('[data-enter]').click();
    await page.locator('[data-connection]').filter({ hasText: 'Connected' }).waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: 'Start Game Night', exact: true }).click();
    await page.locator('[data-game-night]:not([hidden])').waitFor({ timeout: 20000 });
}

async function openFour(page) {
    await page.getByRole('combobox', { name: 'Switch game' }).selectOption('four');
    await page.getByRole('button', { name: 'Open a match' }).click();
    await expect(page.locator('[data-four-status]')).toHaveText('Invite a friend. You play first when they join.');
}

test('a phone guest joins an open Four seat from one invite tap and drops a piece', async ({ browser }) => {
    test.setTimeout(60000);
    test.skip(!origin || invitation.length < 32, 'local game night preview is required');
    const hostContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, ignoreHTTPSErrors: true });
    const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, ignoreHTTPSErrors: true });
    await localOnly(hostContext);
    await localOnly(guestContext);
    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();
    host.setDefaultTimeout(20000);
    guest.setDefaultTimeout(20000);
    try {
        await enterHost(host, 'FourHost');
        await openFour(host);
        const inviteButton = host.locator('[data-four]').getByRole('button', { name: 'Invite a friend', exact: true });
        await expect(inviteButton).toBeVisible();
        await host.getByRole('button', { name: 'Invite players', exact: true }).click();
        const sheet = host.locator('[data-invite-dialog]');
        await expect(sheet.getByRole('button', { name: 'Invite a friend to Four in a Row' })).toBeVisible();
        await expect(sheet.getByText('Open a game with a free seat to invite a friend.')).toBeHidden();
        await host.keyboard.press('Escape');

        await host.evaluate(() => {
            window.__fourInvite = '';
            const share = async data => {
                if (!navigator.userActivation.isActive) throw new DOMException('User activation required', 'NotAllowedError');
                window.__fourInvite = data?.url || '';
            };
            try { Object.defineProperty(navigator, 'share', { configurable: true, value: share }); }
            catch { navigator.share = share; }
        });
        const opened = Date.now();
        await inviteButton.click();
        const share = sheet.getByRole('button', { name: 'Share invite', exact: true });
        await expect(share).toBeFocused();
        expect(await host.evaluate(() => window.__fourInvite)).toBe('');
        await share.click();
        await expect.poll(() => host.evaluate(() => window.__fourInvite)).not.toBe('');
        const href = await host.evaluate(() => window.__fourInvite);
        const link = new URL(href);
        expect(link.origin).toBe(origin);
        expect(link.pathname).toBe('/beta/game-night/guest');
        expect(link.hash.startsWith('#invite=')).toBe(true);

        await guest.addInitScript(({ path, hash }) => {
            if (location.pathname === path) history.replaceState(null, '', path + hash);
        }, { path: link.pathname, hash: link.hash });
        await guest.goto(origin + link.pathname, { waitUntil: 'domcontentloaded' });
        await expect(guest.getByRole('heading', { name: 'Four in a Row' })).toBeVisible();
        await expect(guest.getByText('FourHost invited you to play.')).toBeVisible();
        const join = guest.getByRole('button', { name: 'Join game', exact: true });
        await expect(join).toBeVisible();
        await join.tap();
        const columns = guest.locator('[data-four-columns] button');
        await expect(columns).toHaveCount(7);
        await expect(columns.first()).toBeInViewport();
        expect((await columns.first().boundingBox()).height).toBeGreaterThanOrEqual(44);
        await expect(guest.locator('[data-four-status]')).toHaveText('You’re O. FourHost (X) goes first.');
        await host.locator('[data-four-columns] button').nth(0).click();
        await expect(guest.locator('[data-four-status]')).toContainText(/Your turn/);
        await guest.locator('[data-four-columns] button').nth(1).tap();
        await expect(guest.locator('[data-four-status]')).toContainText(/column 2/);
        expect(Date.now() - opened).toBeLessThan(30000);
    } finally {
        await hostContext.close();
        await guestContext.close();
    }
});
