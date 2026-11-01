// Exercise the actual human launcher and its runtime-only identity/storage setup.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

test.skip(({ browserName }) => browserName !== 'chromium', 'Local launcher smoke tests use Chromium');
let preview, directory;
test.beforeEach(async () => {
    const { startPreview } = await import('../../scripts/preview-hangout-server.mjs');
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hangout-preview-browser-'));
    preview = await startPreview({ port: 0, statePath: path.join(directory, 'state.json') });
});
test.afterEach(async () => { await preview?.close(); fs.rmSync(directory, { recursive: true, force: true }); });

async function openProfile(launcher, label) {
    const [page] = await Promise.all([launcher.context().waitForEvent('page'), launcher.getByRole('button', { name: label, exact: true }).click()]);
    await page.waitForLoadState('load');
    return page;
}
async function enter(page) {
    await page.locator('[data-enter]').click();
    await expect(page.locator('[data-app], [data-panel]')).toBeVisible();
}

test('local visitors can replace the suggested nickname and keep their chosen nickname after reloading', async ({ page }) => {
    await page.goto(preview.url);
    const guest = await openProfile(page, 'Open a guest');
    const nickname = guest.getByRole('textbox', { name: 'Your nick', exact: true });
    await expect(nickname).toHaveValue(/^Guest[a-f0-9]{5}$/);
    await nickname.fill('MyChosenNickname');
    await enter(guest);
    await expect.poll(() => guest.evaluate(() => __lobby.me)).toBe('MyChosenNickname');
    await guest.reload();
    await expect(nickname).toHaveValue('MyChosenNickname');
    await enter(guest);
    await expect.poll(() => guest.evaluate(() => __lobby.me)).toBe('MyChosenNickname');
});

test('local tabs represent distinct visitors, with working room registration and limited moderator role', async ({ page, context }) => {
    const errors = []; const external = [];
    context.on('page', (tab) => tab.on('pageerror', (error) => errors.push(error.message)));
    context.on('request', (request) => { if (!request.url().startsWith(preview.origin) && !request.url().startsWith('data:')) external.push(request.url()); });
    await page.goto(preview.url);
    const owner = await openProfile(page, 'Open room owner A'); await enter(owner);
    const guest = await openProfile(page, 'Open a guest'); await enter(guest);
    expect(await owner.evaluate(() => __lobby.verified)).toBe(true);
    expect(await guest.evaluate(() => __lobby.verified)).toBe(false);
    const ownerDev = (await owner.context().cookies(preview.origin)).find((c) => c.name === '__Host-hangout-dev')?.value;
    const guestDev = (await guest.context().cookies(preview.origin)).find((c) => c.name === '__Host-hangout-dev')?.value;
    expect(ownerDev).toBeTruthy();
    expect(guestDev).toBeTruthy();
    expect(ownerDev).not.toBe(guestDev);
    await owner.evaluate(() => __lobby.cmd('join', ['#browser-room']));
    await expect.poll(() => owner.evaluate(() => __lobby.active)).toBe('#browser-room');
    await owner.evaluate(() => __lobby.cmd('register', [], '#browser-room'));
    await expect.poll(() => owner.evaluate(() => __lobby.chans.get('#browser-room')?.persistent)).toBe(true);
    await guest.evaluate(() => __lobby.cmd('join', ['#browser-room']));
    await expect.poll(() => guest.evaluate(() => __lobby.active)).toBe('#browser-room');
    await owner.locator('[data-text]').fill('A real local test message'); await owner.locator('[data-send]').click();
    await expect(guest.locator('[data-buffer]')).toContainText('A real local test message');
    await guest.getByRole('button', { name: /^Report this message from/ }).click();
    const moderator = await openProfile(page, 'Open moderator panel'); await enter(moderator);
    await expect.poll(() => moderator.evaluate(() => __admin.state?.capabilities)).toEqual({ moderate: true, configure: false, register: true });
    await expect(moderator.locator('[data-reports]')).toContainText('A real local test message');
    await expect(moderator.locator('[data-ai-state]')).toHaveText('AI review is off');
    await owner.reload(); await enter(owner);
    await owner.evaluate(() => __lobby.cmd('join', ['#browser-room']));
    await expect.poll(() => owner.evaluate(() => __lobby.chans.get('#browser-room')?.names.some((name) => name.nick === __lobby.me && name.owner))).toBe(true);
    await expect(owner.locator('[data-buffer]')).not.toContainText('A real local test message');
    expect(errors).toEqual([]); expect(external).toEqual([]);
});

test('launcher fits a phone and explains the simulated identity before entry', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(preview.url);
    await expect(page.getByText('Private on this computer.', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const owner = await openProfile(page, 'Open room owner A');
    await owner.setViewportSize({ width: 390, height: 844 });
    await expect(owner.locator('.preview-banner')).toContainText('Room owner A');
    await expect(owner.locator('.preview-banner')).toContainText('Email/staff identity is simulated. AI off.');
    await expect(owner.getByRole('link', { name: 'Open another identity' })).toBeVisible();
    await enter(owner);
    await expect(owner.locator('[data-text]')).toBeVisible();
    expect(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
