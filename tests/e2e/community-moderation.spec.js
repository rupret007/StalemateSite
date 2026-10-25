// Real local WebSockets, application engine, report/reviewer UI and independent
// entry origins. devadmin/as are the loopback relay's explicit identity fixture,
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
    const contexts = [], websites = [], errors = [], providerRequests = [];
    const relay = hangoutRelayWsBase(baseURL, `shared-community-moderation-${randomUUID()}`);
    const lobbyUrl = source => {
        const target = new URL(`${ROOT}lobby/`, baseURL);
        target.searchParams.set('preview', PREVIEW); target.searchParams.set('relay', relay);
        if (source) target.searchParams.set('via', source);
        return target.href;
    };
    const adminUrl = credential => {
        const target = new URL(`${ROOT}admin/`, baseURL);
        target.searchParams.set('preview', PREVIEW); target.searchParams.set('relay', relay);
        if (credential) target.searchParams.set('devadmin', credential);
        return target.href;
    };
    async function context() {
        const value = await browser.newContext(); contexts.push(value);
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
    async function website(source, label) {
        const server = http.createServer((_request, response) => {
            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
            response.end(`<!doctype html><html lang="en"><title>${escapeHtml(label)} moderation fixture</title><h1>${escapeHtml(label)}</h1><a href="${escapeHtml(lobbyUrl(source))}">Hang Out</a></html>`);
        });
        await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
        const url = `http://127.0.0.1:${server.address().port}/`;
        websites.push(server);
        return url;
    }
    async function guest(source, nickname, existingContext) {
        const profile = existingContext || await context(), page = await profile.newPage();
        if (source) {
            const origin = await website(source, source === 'stalemate' ? 'Stalemate' : 'Rad Dad');
            await page.goto(origin); await page.getByRole('link', { name: 'Hang Out', exact: true }).click();
        } else await page.goto(lobbyUrl(''));
        await page.fill('[data-nick]', nickname); await page.click('[data-enter]');
        await expect(page.locator('[data-connection]')).toHaveText('Connected');
        await expect(page.locator('[data-app]')).toBeVisible();
        expect(new URL(page.url()).origin).toBe(new URL(baseURL).origin);
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
    return { guest, moderator, adminUrl,
        close: async () => {
            await Promise.all(contexts.map(value => value.close()));
            await Promise.all(websites.map(server => new Promise(resolve => { server.closeIdleConnections(); server.close(resolve); })));
            expect(providerRequests).toEqual([]); expect(errors).toEqual([]);
        }
    };
}

async function say(page, text) {
    await page.fill('[data-text]', text); await page.press('[data-text]', 'Enter');
}
const received = (page, text) => page.locator('[data-buffer] li[data-id]').filter({ hasText: text });
const reportRow = (page, text) => page.locator('[data-reports] > li').filter({ hasText: text });

test('mixed entrances share real reports, authorized disposition and restrictions that follow the signed device', async ({ browser, baseURL }) => {
    const app = await scenario(browser, baseURL);
    try {
        const author = await app.guest('stalemate', 'StaleAuthor');
        const witness = await app.guest('rad-dad', 'RadWitness');
        const observer = await app.guest('', 'DirectObserver');
        const moderator = await app.moderator();
        const text = 'Synthetic shared community report for this test only';
        await say(author, text);
        for (const page of [author, witness, observer]) await expect(received(page, text)).toContainText('via Stalemate');
        const messageId = await received(witness, text).getAttribute('data-id');

        // A source label and forged JSON role never grant message deletion.
        await witness.evaluate(id => window.__lobby.ws.send(JSON.stringify({ t: 'cmd', name: 'delete', args: [id],
            ch: '#stalemate', role: 'owner', admin: true, entrySource: 'stalemate' })), messageId);
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
