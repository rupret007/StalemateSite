// #stalemate lobby: real browsers against the local stand-in relay (same engine as the Worker DO).
const { test, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const SLUG = '45662413410ed051';
const KEY = 'local-preview-key-0001';
const ADMIN = 'local-dev-admin-key-0001';
test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium carries the lobby suite');

let relayWs;
test.beforeEach(async ({ baseURL }) => { relayWs = hangoutRelayWsBase(baseURL, `lobby-${randomUUID()}`); });

const lobbyUrl = () => `/r/${SLUG}/lobby/?preview=${KEY}&relay=${encodeURIComponent(relayWs)}`;
const adminUrl = (key = ADMIN) => `/r/${SLUG}/admin/?preview=${KEY}&relay=${encodeURIComponent(relayWs)}&devadmin=${key}`;

async function fan(browser, nick, viewport) {
    const ctx = await browser.newContext(viewport ? { viewport } : {});
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(lobbyUrl());
    if (nick) await page.fill('[data-nick]', nick);
    await page.click('[data-enter]');
    await expect(page.locator('[data-app]')).toBeVisible();
    page.errors = errors;
    return page;
}
async function sayIn(page, text) { await page.fill('[data-text]', text); await page.press('[data-text]', 'Enter'); }
const buffer = (page) => page.locator('[data-buffer]');

test('no preview key: shut, noindex, no socket; preview key leaves the address bar', async ({ page }) => {
    const sockets = [];
    page.on('websocket', (ws) => sockets.push(ws.url()));
    await page.goto(`/r/${SLUG}/lobby/`);
    await expect(page.locator('[data-gate-copy]')).toContainText('Not open yet');
    await expect(page.locator('[data-enter]')).toBeHidden();
    expect(await page.locator('meta[name="robots"]').getAttribute('content')).toContain('noindex');
    expect(sockets).toEqual([]);
    await page.goto(lobbyUrl());
    expect(page.url()).not.toContain('preview=');
});

test('blank nick by default, dice fills a fun one, StaleBot says hi, rooms start with one tap, nick remembered', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(lobbyUrl());
    await expect(page.locator('[data-nick]')).toHaveValue('');
    await page.click('[data-enter]');
    await expect(page.locator('[data-gate-status]')).toContainText('Type a nick');
    await expect(page.locator('[data-reroll]')).toHaveText('🎲 Make me a name');
    await expect(page.locator('[data-nick]')).toHaveAttribute('placeholder', 'Type a nickname… or roll one →');
    expect((await page.locator('[data-reroll]').boundingBox()).height).toBeGreaterThanOrEqual(44);
    await page.click('[data-reroll]');
    await expect(page.locator('[data-reroll]')).toHaveText('🎲 Roll again');
    await expect(page.locator('[data-nick]')).toHaveValue(/^[A-Z][A-Za-z0-9-]{2,19}$/);
    await page.fill('[data-nick]', 'jeff');
    await page.click('[data-enter]');
    await expect(page.locator('[data-gate-status]')).toContainText('reserved');
    await page.fill('[data-nick]', 'GhostRider');
    await page.click('[data-enter]');
    await expect(buffer(page)).toContainText('StaleBot');
    await expect(buffer(page)).toContainText('welcome to #stalemate');
    await page.click('[data-start="bobross"]');
    await expect(page.locator('[data-tabs]')).toContainText('#bobross-');
    await expect(page.locator('[data-modes]')).toContainText('Bob Ross paint-along');
    await expect(page.locator('[data-nicks]')).toContainText('@');
    const again = await ctx.newPage();
    await again.goto(lobbyUrl());
    await expect(again.locator('[data-nick]')).toHaveValue('GhostRider');
    await ctx.close();
});

test('three fans + a band op: chat, /me, slap button, filters, PM accept-first, forged commands', async ({ browser, baseURL }) => {
    const a = await fan(browser, 'Sk8rKid');
    const b = await fan(browser, 'MoshPit');
    const c = await fan(browser, 'GoatLord');
    await sayIn(a, 'yo this show rips, fucking loud');
    await expect(buffer(b)).toContainText('fucking loud');
    await sayIn(b, '/me crowd-surfs');
    await expect(buffer(a)).toContainText('* MoshPit crowd-surfs');
    await c.click('[data-quick-cmd="slap"]');
    await expect(buffer(a)).toContainText('large trout');
    await a.waitForTimeout(3200);
    await sayIn(a, 'text me 214-555-0199');
    await expect(buffer(a)).toContainText('no phone numbers');
    await expect(buffer(b)).not.toContainText('214-555');
    // PM: must be accepted before anything is delivered.
    await a.waitForTimeout(1600);
    await a.locator('[data-nicks] button', { hasText: 'MoshPit' }).click();
    await a.click('[data-sheet-buttons] >> text=✉ PM');
    await expect(b.locator('[data-pmreqs]')).toContainText('Sk8rKid wants to chat');
    await b.click('[data-pmreqs] >> text=Accept');
    await expect(a.locator('[data-tabs]')).toContainText('✉ MoshPit');
    await expect(a.locator('[data-topic]')).toContainText('Private chat with MoshPit');
    await sayIn(a, 'great set huh');
    await expect(buffer(a)).toContainText('great set huh');
    await expect(buffer(b)).toContainText('great set huh');
    await expect(b.locator('[data-tabs]')).toContainText('✉ Sk8rKid');
    // Forged op command from a fan: refused by the server, nobody kicked.
    await c.evaluate(() => window.__lobby.ws.send(JSON.stringify({ t: 'cmd', name: 'kick', args: ['Sk8rKid'], ch: '#stalemate', role: 'owner' })));
    await c.evaluate(() => window.__lobby.ws.send(JSON.stringify({ t: 'cmd', name: 'shield', args: [], ch: '#stalemate' })));
    await expect(buffer(c)).toContainText('permission denied');
    await expect(a.locator('[data-app]')).toBeVisible();
    const modlog = await a.request.get(`${relayWs.replace(/^ws/, 'http')}/__test/modlog.json`).then((r) => r.json());
    expect(modlog.filter((e) => e.action === 'denied').length).toBeGreaterThanOrEqual(2);
    // Band panel: sees the report queue, kicks and bans.
    const admin = await (await browser.newContext()).newPage();
    await admin.goto(adminUrl());
    await admin.click('[data-enter]');
    await expect(admin.locator('[data-panel]')).toBeVisible();
    await a.locator('[data-tabs] button', { hasText: '#stalemate' }).click();
    await a.locator('[data-buffer] li', { hasText: 'large trout' }).hover();
    await a.locator('[data-buffer] li', { hasText: 'large trout' }).locator('.flag').click();
    await admin.click('[data-tab="queue"]');
    await expect(admin.locator('[data-reports]')).toContainText('GoatLord');
    await admin.click('[data-tab="people"]');
    admin.once('dialog', (d) => d.accept('spamming'));
    await admin.locator('[data-users] li', { hasText: 'GoatLord' }).locator('text=Ban').click();
    await expect(c.locator('[data-gate-status]')).toContainText('boot');
    await expect(admin.locator('[data-bans]')).toContainText('GoatLord');
    await admin.click('[data-tab="stats"]');
    await expect(admin.locator('[data-kpis]')).toContainText('visits');
    await admin.click('[data-tab="log"]');
    await expect(admin.locator('[data-modlog]')).toContainText('ban GoatLord');
    // Everyone here shares 127.0.0.1, so the IP-hash ban now blocks new devices too (ban-dodge check)...
    const dodger = await (await browser.newContext()).newPage();
    await dodger.goto(lobbyUrl());
    await dodger.fill('[data-nick]', 'TotallyNew');
    await dodger.click('[data-enter]');
    await expect(dodger.locator('[data-gate-status]')).toContainText('Couldn’t get in');
    // ...until the band unbans from the panel.
    await admin.click('[data-tab="people"]');
    await admin.locator('[data-bans] li', { hasText: 'GoatLord' }).locator('text=Unban').click();
    await expect(admin.locator('[data-bans]')).not.toContainText('GoatLord');
    for (const p of [a, b]) expect(p.errors).toEqual([]);
});

test('a wrong dev-admin key is refused; fans cannot reach the admin socket', async ({ page }) => {
    await page.goto(adminUrl('wrong-wrong-wrong-key'));
    await page.click('[data-enter]');
    await expect(page.locator('[data-status]')).toContainText('Not signed in as a site moderator');
});

test('open rooms: camera off by default with an 18+ gate; jam hands off to WebJam', async ({ browser }) => {
    const host = await fan(browser, 'ArtHost');
    await host.click('[data-start="art"]');
    await expect(host.locator('[data-cam]')).toHaveText('📷 Camera (18+)');
    await host.click('[data-cam]');
    await host.click('[data-cam-yes]');
    await expect(host.locator('[data-toast]')).toContainText('18+');
    await host.check('[data-adult]');
    await host.click('[data-cam-yes]');
    await expect(host.locator('[data-cam]')).toHaveText('📷 Camera on');
    const jammer = await fan(browser, 'JamHost');
    await jammer.click('[data-start="jam"]');
    await expect(jammer.locator('[data-jam]')).toContainText('Plug in Ethernet');
    await expect(jammer.locator('[data-jam-web]')).toBeDisabled();
    await jammer.fill('[data-jam-link]', 'webjam://join?v=1#k=abcdef0123');
    await jammer.press('[data-jam-link]', 'Enter');
    await expect(jammer.locator('[data-jam-desktop]')).toHaveAttribute('href', 'webjam://join?v=1#k=abcdef0123');
});

test('GoatCounter gets fixed event names only: no preview key, nick or room name', async ({ browser }) => {
    const ctx = await browser.newContext();
    const hits = [];
    await ctx.route(/goatcounter\.com/, (route) => { hits.push(route.request().url()); route.fulfill({ status: 204, body: '' }); });
    const page = await ctx.newPage();
    await page.addInitScript(() => { window.goatcounter = { allow_local: true }; });
    await page.goto(lobbyUrl());
    await page.waitForFunction(() => window.goatcounter && window.goatcounter.count);
    await page.fill('[data-nick]', 'CountMePickle');
    await page.click('[data-enter]');
    await expect(page.locator('[data-app]')).toBeVisible();
    await page.click('[data-start="watch"]');
    await expect.poll(() => hits.filter((u) => /\/count\?/.test(u)).length).toBeGreaterThanOrEqual(2);
    for (const u of hits) {
        expect(u).not.toContain('preview');
        expect(u).not.toContain(KEY);
        expect(u).not.toContain('CountMePickle');
        expect(u).not.toMatch(/watch-[a-z]/);
    }
    expect(hits.some((u) => decodeURIComponent(u).includes('hangout-room-start-watch'))).toBe(true);
    await ctx.close();
});
