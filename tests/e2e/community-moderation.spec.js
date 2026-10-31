// Real local WebSockets, application engine, report/reviewer UI and independent
// entry origins. devadmin/as/devowner are the loopback relay's explicit identity fixture,
// not Cloudflare Access. Socket close + credential removal below do not prove
// hosted logout, JWT expiry or beta-registry revocation; those have separate tests.
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const ROOT = '/r/45662413410ed051/';
const PREVIEW = 'local-preview-key-0001';
const LOCAL_STAFF = 'local-dev-admin-key-0001';
const escapeHtml = value => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

async function scenario(browser, baseURL) {
    const contexts = new Set(), websites = [], errors = [], providerRequests = [];
    const relay = hangoutRelayWsBase(baseURL, `shared-community-moderation-${randomUUID()}`);
    const lobbyUrl = (source, owner = false) => {
        const target = new URL(`${ROOT}lobby/`, baseURL);
        target.searchParams.set('preview', PREVIEW); target.searchParams.set('relay', relay);
        if (source) target.searchParams.set('via', source);
        if (owner) target.searchParams.set('owner', '1');
        return target.href;
    };
    const adminUrl = credential => {
        const target = new URL(`${ROOT}admin/`, baseURL);
        target.searchParams.set('preview', PREVIEW); target.searchParams.set('relay', relay);
        if (credential) target.searchParams.set('devadmin', credential);
        return target.href;
    };
    async function context(options = {}) {
        const value = await browser.newContext(options); contexts.add(value);
        value.once('close', () => contexts.delete(value));
        // Matches only the explicit shared-community namespace's relay fixture.
        await value.addInitScript(() => { window.HangoutEntrySites = [{ id: 'makers', label: 'Makers & Friends' }]; });
        value.on('page', page => page.on('pageerror', error => errors.push(error.message)));
        value.on('request', request => {
            if (new URL(request.url()).hostname === 'api.openai.com') providerRequests.push(request.url());
        });
        await value.route('**/*', route => {
            const url = new URL(route.request().url());
            return url.protocol === 'http:' && url.hostname === '127.0.0.1' ? route.continue() : route.abort();
        });
        return value;
    }
    async function website(source, label, owner) {
        const server = http.createServer((_request, response) => {
            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
            response.end(`<!doctype html><html lang="en"><title>${escapeHtml(label)} moderation fixture</title><h1>${escapeHtml(label)}</h1><a href="${escapeHtml(lobbyUrl(source, owner))}">Hang Out</a></html>`);
        });
        await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
        const url = `http://127.0.0.1:${server.address().port}/`;
        websites.push(server);
        return url;
    }
    async function guest(source, nickname, existingContext, { account, viewport, beforePage } = {}) {
        const profile = existingContext || await context(viewport ? { viewport } : {});
        if (account) await profile.addInitScript(identity => {
            const NativeSocket = window.WebSocket;
            window.WebSocket = class extends NativeSocket {
                constructor(address, protocols) {
                    const url = new URL(address);
                    // TEST-ONLY authenticated adapter; no real email/Access flow.
                    if (url.pathname.endsWith('/lobby-owner')) {
                        url.searchParams.set('devowner', 'local-dev-admin-key-0001');
                        url.searchParams.set('account', identity);
                    }
                    super(url.href, protocols);
                }
            };
        }, account);
        if (beforePage) await beforePage(profile);
        const page = await profile.newPage();
        if (source) {
            const origin = await website(source, { stalemate: 'Stalemate', 'rad-dad': 'Rad Dad', makers: 'Makers & Friends' }[source], !!account);
            await page.goto(origin); await page.getByRole('link', { name: 'Hang Out', exact: true }).click();
        } else await page.goto(lobbyUrl('', !!account));
        await page.fill('[data-nick]', nickname); await page.click('[data-enter]');
        await expect(page.locator('[data-connection]')).toHaveText('Connected');
        await expect(page.locator('[data-app]')).toBeVisible();
        expect(new URL(page.url()).origin).toBe(new URL(baseURL).origin);
        expect(await page.evaluate(() => window.__lobby.verified)).toBe(!!account);
        return page;
    }
    async function moderator(nickname = 'FixtureMod') {
        const profile = await context();
        await profile.addInitScript(() => {
            const NativeSocket = window.WebSocket;
            window.WebSocket = class extends NativeSocket {
                constructor(address, protocols) {
                    const url = new URL(address);
                    // This switch exists only in the loopback relay fixture.
                    if (url.pathname.endsWith('/lobby-admin')) url.searchParams.set('as', 'moderator');
                    super(url.href, protocols);
                }
            };
        });
        const page = await profile.newPage();
        await page.goto(adminUrl(LOCAL_STAFF)); await page.fill('[data-nick]', nickname); await page.click('[data-enter]');
        await expect(page.locator('[data-panel]')).toBeVisible();
        expect(await page.evaluate(() => window.__admin.state.capabilities)).toMatchObject({ moderate: true, configure: false });
        return page;
    }
    return { guest, moderator, adminUrl, websiteOrigins: () => websites.map(server => `http://127.0.0.1:${server.address().port}`),
        close: async () => {
            const closed = await Promise.allSettled([...contexts].map(value => value.close()));
            const stopped = await Promise.allSettled(websites.map(server => new Promise((resolve, reject) => {
                server.closeIdleConnections(); server.close(error => error ? reject(error) : resolve());
            })));
            const failures = [...closed, ...stopped].filter(result => result.status === 'rejected');
            if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Community fixture cleanup failed');
            expect(providerRequests).toEqual([]); expect(errors).toEqual([]);
        }
    };
}

async function say(page, text) {
    await page.fill('[data-text]', text); await page.press('[data-text]', 'Enter');
}
const received = (page, text) => page.locator('[data-buffer] li[data-id]').filter({ hasText: text });
const reportRow = (page, text) => page.locator('[data-reports] > li').filter({ hasText: text });

test('three entrances share a guest-hosted creative room, real report review and signed-device restrictions', async ({ browser, baseURL }, testInfo) => {
    const app = await scenario(browser, baseURL);
    try {
        const author = await app.guest('stalemate', 'StaleAuthor', null, { viewport: { width: 390, height: 844 } });
        const beforeJoin = 'This earlier lobby line belongs only to its connected session';
        await say(author, beforeJoin); await expect(received(author, beforeJoin)).toHaveCount(1);
        const witness = await app.guest('rad-dad', 'RadWitness');
        const observer = await app.guest('makers', 'MakerObserver');
        expect(new Set(app.websiteOrigins()).size).toBe(3);
        for (const page of [witness, observer]) await expect(received(page, beforeJoin)).toHaveCount(0);
        // An unverified visitor really creates and hosts this activity room.
        await witness.click('[data-start="art"]');
        await expect(witness.locator('[data-act-canvas]')).toBeVisible();
        await expect(witness.locator('[data-roomtools]')).toBeVisible();
        const room = await witness.evaluate(() => window.__lobby.active);
        for (const page of [author, observer]) {
            await page.evaluate(name => window.__lobby.cmd('join', [name]), room);
            await expect(page.locator('[data-chat-context]')).toHaveText(room);
            await expect(page.locator('[data-act-canvas]')).toBeVisible();
            await expect(page.locator('[data-roomtools]')).toBeHidden();
        }
        await author.click('nav [data-show="people"]');
        await expect(author.locator('[data-nicks] .entry-badge')).toHaveText(['via Rad Dad', 'via Makers & Friends', 'via Stalemate']);
        await author.click('nav [data-show="chat"]');
        const moderator = await app.moderator();
        const text = 'Synthetic shared community report for this test only';
        await say(author, text);
        for (const page of [author, witness, observer]) await expect(received(page, text)).toContainText('via Stalemate');
        const messageId = await received(witness, text).getAttribute('data-id');

        await author.screenshot({ path: testInfo.outputPath('shared-creative-report-390.png'), fullPage: true });
        // Even the guest room host cannot acquire global message deletion by
        // supplying a source label and invented authority in its JSON frame.
        await witness.evaluate(({ id, ch }) => window.__lobby.ws.send(JSON.stringify({ t: 'cmd', name: 'delete', args: [id],
            ch, role: 'owner', admin: true, entrySource: 'stalemate' })), { id: messageId, ch: room });
        await expect(witness.locator('[data-buffer]')).toContainText('permission denied');
        for (const page of [author, witness, observer]) await expect(received(page, text)).toHaveCount(1);
        expect(await witness.evaluate(() => window.__lobby.capabilities.moderate)).toBe(false);

        await received(witness, text).locator('.flag').click();
        await expect(received(witness, text).locator('.flag')).toHaveText('✓');
        await expect(reportRow(moderator, text)).toContainText('StaleAuthor');
        expect(await moderator.evaluate(id => window.__admin.state.reports.find(item => item.id === id).count, messageId)).toBe(1);
        await expect(moderator.locator('[data-panic]')).toBeHidden();
        await expect(moderator.locator('[data-lobby="readonly"]')).toBeHidden();
        await moderator.evaluate(() => window.__admin.ws.send(JSON.stringify({ t: 'cmd', name: 'shield', args: [],
            ch: '#stalemate', role: 'owner', admin: true })));
        await expect(moderator.locator('[data-toast]')).toContainText('permission denied');

        await reportRow(moderator, text).getByRole('button', { name: 'Delete', exact: true }).click();
        await expect(reportRow(moderator, text)).toHaveCount(0);
        for (const page of [author, witness, observer]) await expect(page.locator(`[data-buffer] [data-id="${messageId}"]`)).toHaveCount(0);

        await moderator.click('[data-tab="people"]');
        await moderator.locator('[data-users] > li').filter({ hasText: 'StaleAuthor' }).getByRole('button', { name: 'Mute 10m', exact: true }).click();
        await expect(author.locator('[data-buffer]')).toContainText("You're muted for 10 min");
        await expect(moderator.locator('[data-users]')).toContainText('StaleAuthor (muted)');

        // Same canonical-origin browser context keeps its genuine signed device
        // token, but now enters through the other website under a fresh nickname.
        const returning = await app.guest('rad-dad', 'OtherEntrance', author.context());
        await returning.evaluate(name => window.__lobby.cmd('join', [name]), room);
        await expect(returning.locator('[data-chat-context]')).toHaveText(room);
        await expect(received(returning, beforeJoin)).toHaveCount(0);
        await expect(received(returning, text)).toHaveCount(0);
        const blocked = 'A muted device must not gain another allowance through another entrance';
        await say(returning, blocked);
        await expect(returning.locator('[data-buffer]')).toContainText('You’re muted for now');
        for (const page of [witness, observer]) await expect(received(page, blocked)).toHaveCount(0);

        const healthy = 'The other entrance can still talk in our shared community';
        await say(witness, healthy);
        for (const page of [author, observer, returning]) await expect(received(page, healthy)).toContainText('via Rad Dad');
        await moderator.click('[data-tab="log"]');
        await expect(moderator.locator('[data-modlog]')).toContainText('mute StaleAuthor');
        await expect(moderator.locator('[data-modlog]')).toContainText('delete');
    } finally { await app.close(); }
});

test('a real local staff disconnect clears evidence and withdrawing the fixture credential denies a new review session', async ({ browser, baseURL }) => {
    const app = await scenario(browser, baseURL);
    try {
        const author = await app.guest('stalemate', 'ReportAuthor');
        const witness = await app.guest('rad-dad', 'ReportWitness');
        const moderator = await app.moderator('FirstReviewer');
        const text = 'Synthetic evidence must not remain in a disconnected staff panel';
        await say(author, text); await expect(received(witness, text)).toHaveCount(1);
        await received(witness, text).locator('.flag').click();
        await expect(reportRow(moderator, text)).toHaveCount(1);
        await moderator.evaluate(() => {
            window.__oldReviewButton = document.querySelector('[data-reports] button');
            window.__admin.ws.close(1000, 'explicit local staff fixture ended');
        });
        await expect(moderator.locator('[data-panel]')).toBeHidden();
        await expect(moderator.locator('[data-reports]')).toHaveText('');
        await expect(moderator.locator('body')).not.toContainText(text);
        expect(await moderator.evaluate(() => window.__admin.state)).toBeNull();
        // A detached old control must not dispatch its former privileged action.
        await moderator.evaluate(() => { window.__oldReviewButton.click(); sessionStorage.removeItem('hangout-devadmin'); });
        await moderator.goto(app.adminUrl(''));
        await moderator.click('[data-enter]');
        await expect(moderator.locator('[data-status]')).toContainText('Not signed in as a site moderator');
        await expect(moderator.locator('[data-panel]')).toBeHidden();
        expect(await moderator.evaluate(() => window.__admin.state)).toBeNull();

        const replacement = await app.moderator('NextReviewer');
        await expect(reportRow(replacement, text)).toHaveCount(1);
        await reportRow(replacement, text).getByRole('button', { name: 'Dismiss', exact: true }).click();
        await expect(reportRow(replacement, text)).toHaveCount(0);
        // Dismissal removes review evidence, not the already delivered message.
        for (const page of [author, witness]) await expect(received(page, text)).toHaveCount(1);
    } finally { await app.close(); }
});

test('visible Ignore and Block protect a visitor across a third site and a changed entry and nickname', async ({ browser, baseURL }, testInfo) => {
    const app = await scenario(browser, baseURL);
    try {
        const host = await app.guest('rad-dad', 'RadRoomHost', null, { viewport: { width: 375, height: 812 } });
        const witness = await app.guest('stalemate', 'StaleWitness');
        const maker = await app.guest('makers', 'MakerGuest');
        await host.click('[data-show="rooms"].startroom');
        await host.click('[data-start="art"]');
        await expect(host.locator('[data-act-canvas]')).toBeVisible();
        const room = await host.evaluate(() => window.__lobby.active);
        for (const page of [witness, maker]) {
            await page.evaluate(name => window.__lobby.cmd('join', [name]), room);
            await expect(page.locator('[data-chat-context]')).toHaveText(room);
        }
        const earlier = 'A line received before choosing Ignore stays in session scrollback';
        await say(maker, earlier);
        for (const page of [host, witness]) await expect(received(page, earlier)).toContainText('via Makers & Friends');
        await host.click('nav [data-show="people"]');
        await host.locator('[data-nicks] button').filter({ hasText: /MakerGuest$/ }).click();
        await host.locator('[data-sheet-buttons]').getByRole('button', { name: 'Ignore', exact: true }).click();
        await expect(host.locator('[data-sheet] [data-person-status]')).toHaveText('Your preference is confirmed.');
        await expect(host.locator('[data-sheet-buttons]').getByRole('button', { name: 'Unignore', exact: true })).toBeVisible();
        await host.keyboard.press('Escape');
        await expect(host.locator('[data-sheet]')).toBeHidden();
        await host.click('nav [data-show="chat"]');
        await expect(host.locator('[data-buffer]')).toContainText('Ignoring MakerGuest.');

        const ignored = 'Other visitors still see this line after one person chooses Ignore';
        await say(maker, ignored);
        await expect(received(witness, ignored)).toHaveCount(1);
        await expect(received(host, ignored)).toHaveCount(0);
        await expect(received(host, earlier)).toHaveCount(1);

        await host.click('nav [data-show="people"]');
        await host.locator('[data-nicks] button').filter({ hasText: /MakerGuest$/ }).click();
        await host.locator('[data-sheet-buttons]').getByRole('button', { name: 'Block', exact: true }).click();
        await host.click('nav [data-show="chat"]');
        await expect(host.locator('[data-buffer]')).toContainText("Blocked MakerGuest. They can't PM you and you won't see them.");

        // A fresh tab keeps its real signed device token, not its old nickname
        // or website badge. Blocking must follow the device on this connection.
        const returning = await app.guest('stalemate', 'DifferentMaker', maker.context());
        await returning.evaluate(name => window.__lobby.cmd('join', [name]), room);
        await expect(returning.locator('[data-chat-context]')).toHaveText(room);
        await expect(received(returning, earlier)).toHaveCount(0);
        await expect(received(returning, ignored)).toHaveCount(0);
        const blocked = 'A different nickname and entrance still respect this visitor block';
        await say(returning, blocked);
        await expect(received(witness, blocked)).toContainText('via Stalemate');
        await expect(received(host, blocked)).toHaveCount(0);
        await returning.evaluate(() => window.__lobby.cmd('query', ['RadRoomHost']));
        await expect(returning.locator('[data-buffer]')).toContainText("RadRoomHost isn't taking PMs.");
        await expect(host.locator('[data-pmreqs]')).toHaveText('');
        // Personal controls have no effect on other visitors or staff powers.
        expect(await host.evaluate(() => window.__lobby.capabilities.moderate)).toBe(false);
        expect(await returning.evaluate(() => window.__lobby.capabilities.register)).toBe(false);
        expect(await host.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
        await host.screenshot({ path: testInfo.outputPath('shared-personal-controls-375.png'), fullPage: true });
    } finally { await app.close(); }
});

test('one fixture-verified account keeps ownership across entries and revokes an offline cross-entry co-host', async ({ browser, baseURL }, testInfo) => {
    testInfo.annotations.push({ type: 'identity-scope', description: 'Loopback devowner account adapter; not a hosted Cloudflare Access or email-delivery qualification.' });
    const app = await scenario(browser, baseURL);
    try {
        const account = 'journey-owner@example.test', cohostAccount = 'journey-cohost@example.test';
        const owner = await app.guest('stalemate', 'OriginalOwner', null, { account });
        const cohost = await app.guest('rad-dad', 'RadCoHost', null, { account: cohostAccount });
        const guest = await app.guest('makers', 'UnverifiedMaker');
        const room = '#cross-entry-owners';
        for (const page of [owner, cohost, guest]) {
            await page.evaluate(name => window.__lobby.cmd('join', [name]), room);
            await expect(page.locator('[data-chat-context]')).toHaveText(room);
        }
        await owner.click('[data-roomtools]');
        await owner.getByRole('button', { name: 'Keep this room', exact: true }).click();
        await expect(owner.locator('[data-host-status]')).toContainText('Registered');
        await owner.click('[data-roomtools]');
        owner.once('dialog', dialog => dialog.accept('RadCoHost'));
        await owner.getByRole('button', { name: 'Add verified co-host', exact: true }).click();
        await expect(cohost.locator('[data-roomtools]')).toBeVisible();
        await expect(guest.locator('[data-roomtools]')).toBeHidden();
        await guest.evaluate(ch => window.__lobby.ws.send(JSON.stringify({ t: 'cmd', name: 'cohost', args: ['add', 'UnverifiedMaker'], ch, personNamed: true,
            account: 'journey-owner@example.test', verified: true, role: 'owner', entrySource: 'stalemate' })), room);
        await expect(guest.locator('[data-buffer]')).toContainText('Only the registered room owner can do that.');
        expect(await guest.evaluate(() => window.__lobby.verified)).toBe(false);
        await expect(guest.locator('[data-roomtools]')).toBeHidden();
        const earlier = 'Registered ownership is retained while ordinary chat remains ephemeral';
        await say(owner, earlier); await expect(received(cohost, earlier)).toHaveCount(1);
        const oldDevice = await owner.evaluate(() => localStorage.getItem('hangout-dev'));
        await owner.context().close(); await cohost.context().close();

        // New browser storage/device; only the adapter's authenticated account
        // is the same. Website source is deliberately changed.
        const returnedOwner = await app.guest('rad-dad', 'ReturnedOwner', null, { account, viewport: { width: 390, height: 844 } });
        expect(await returnedOwner.evaluate(() => localStorage.getItem('hangout-dev'))).not.toBe(oldDevice);
        await returnedOwner.click('nav [data-show="rooms"]');
        await returnedOwner.selectOption('[data-room-filter]', 'mine');
        await returnedOwner.fill('[data-room-search]', 'cross-entry');
        await returnedOwner.locator(`[data-room="${room}"]`).click();
        await expect(returnedOwner.locator('[data-chat-context]')).toHaveText(room);
        await expect(returnedOwner.locator('[data-roomtools]')).toBeVisible();
        await expect(received(returnedOwner, earlier)).toHaveCount(0);
        expect(await returnedOwner.evaluate(name => window.__lobby.chans.get(name).names.find(person => person.nick === window.__lobby.me).owner, room)).toBe(true);
        expect(await returnedOwner.evaluate(() => window.__lobby.capabilities.moderate)).toBe(false);
        await returnedOwner.click('[data-roomtools]');
        returnedOwner.once('dialog', dialog => dialog.accept());
        await returnedOwner.getByRole('button', { name: 'Remove verified co-host: RadCoHost', exact: true }).click();
        await expect.poll(() => returnedOwner.evaluate(name => window.__lobby.chans.get(name).cohosts.length, room)).toBe(0);

        const revoked = await app.guest('makers', 'ReturnedCoHost', null, { account: cohostAccount });
        await revoked.evaluate(name => window.__lobby.cmd('join', [name]), room);
        await expect(revoked.locator('[data-chat-context]')).toHaveText(room);
        await expect(revoked.locator('[data-roomtools]')).toBeHidden();
        await expect(received(revoked, earlier)).toHaveCount(0);
        await revoked.evaluate(ch => window.__lobby.cmd('topic', ['A revoked host cannot replace the room topic'], ch), room);
        await expect(revoked.locator('[data-buffer]')).toContainText('only @ can set the topic');
        await expect(returnedOwner.locator('[data-topic]')).not.toContainText('A revoked host');
        await returnedOwner.screenshot({ path: testInfo.outputPath('shared-owner-revocation-390.png'), fullPage: true });
        expect(await returnedOwner.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    } finally { await app.close(); }
});

for (const width of [375, 390]) test(`delayed owner metadata updates open host tools at ${width}px without losing focus`, async ({ browser, baseURL }, testInfo) => {
    const app = await scenario(browser, baseURL);
    const room = '#delayed-owner-tools', account = 'delayed-owner@example.test', cohostAccount = 'delayed-cohost@example.test';
    let releaseOwnership;
    const held = [];
    try {
        const owner = await app.guest('stalemate', 'FirstHost', null, { account });
        const cohost = await app.guest('rad-dad', 'OfflineCoHost', null, { account: cohostAccount });
        for (const page of [owner, cohost]) {
            await page.evaluate(name => window.__lobby.cmd('join', [name]), room);
            await expect(page.locator('[data-chat-context]')).toHaveText(room);
        }
        await owner.click('[data-roomtools]');
        await owner.getByRole('button', { name: 'Keep this room', exact: true }).click();
        await expect(owner.locator('[data-host-status]')).toContainText('Registered');
        await owner.evaluate(ch => window.__lobby.cmd('cohost', ['add', 'OfflineCoHost'], ch), room);
        await expect(cohost.locator('[data-roomtools]')).toBeVisible();
        await owner.context().close(); await cohost.context().close();

        const returned = await app.guest('rad-dad', 'ReturnedHost', null, { account, viewport: { width, height: 844 }, beforePage: async profile => {
            await profile.routeWebSocket(url => url.hostname === '127.0.0.1' && url.pathname.endsWith('/lobby-owner'), socket => {
                const server = socket.connectToServer();
                let released = false;
                releaseOwnership = () => { released = true; for (const frame of held.splice(0)) socket.send(frame); };
                server.onMessage(message => {
                    const frame = typeof message === 'string' ? JSON.parse(message) : null;
                    // Delay only the separate owner-only metadata. Real join,
                    // account authorization and room state still run normally.
                    if (!released && frame?.t === 'ownership' && frame.ch === room) held.push(message);
                    else socket.send(message);
                });
            });
        } });
        await returned.click('nav [data-show="rooms"]');
        await returned.selectOption('[data-room-filter]', 'mine');
        await returned.locator(`[data-room="${room}"]`).click();
        await expect(returned.locator('[data-chat-context]')).toHaveText(room);
        await expect.poll(() => held.length).toBeGreaterThan(0);
        await returned.click('[data-roomtools]');
        const palette = returned.getByRole('dialog', { name: 'Commands', exact: true });
        const removal = palette.getByRole('button', { name: 'Remove verified co-host: OfflineCoHost', exact: true });
        await expect(palette).toBeVisible(); await expect(removal).toHaveCount(0);
        await expect(palette.locator('[data-palette-status]')).toContainText('Checking verified co-hosts');
        const focused = palette.getByRole('button', { name: 'Transfer ownership', exact: true });
        for (let step = 0; step < 30 && !await focused.evaluate(element => element === document.activeElement); step++)
            await returned.keyboard.press('Tab');
        await expect(focused).toBeFocused();
        await returned.screenshot({ path: testInfo.outputPath(`owner-tools-waiting-${width}.png`), fullPage: true });
        releaseOwnership();
        await expect(removal).toBeVisible(); await expect(focused).toBeFocused();
        await expect(palette.locator('[data-palette-status]')).toHaveText('Verified co-host list updated.');
        await returned.screenshot({ path: testInfo.outputPath(`owner-tools-updated-${width}.png`), fullPage: true });
        expect(await returned.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        const bounds = await palette.boundingBox();
        expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        returned.once('dialog', dialog => dialog.accept());
        await removal.click(); await expect(palette).toBeHidden();
        await expect.poll(() => returned.evaluate(ch => window.__lobby.chans.get(ch).cohosts.length, room)).toBe(0);

        const revoked = await app.guest('stalemate', 'ReturnedCoHost', null, { account: cohostAccount });
        await revoked.evaluate(ch => window.__lobby.cmd('join', [ch]), room);
        await expect(revoked.locator('[data-chat-context]')).toHaveText(room);
        await expect(revoked.locator('[data-roomtools]')).toBeHidden();
        expect(await returned.evaluate(() => window.__lobby.capabilities.moderate)).toBe(false);
    } finally { await app.close(); }
});
