// Actual betaFetch HTML/CSP/style responses in a real browser, with a local
// static ASSETS transport and no auth/registry/provider. Not hosted acceptance.
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const TERMS = '/r/45662413410ed051/terms/';
let server, origin, betaFetch;
const calls = [];
test.beforeAll(async () => {
    ({ betaFetch } = await import('../../hangout-worker/src/beta-entry.mjs'));
    const env = { HANGOUT_MODERATION_CONTACT: 'moderator@example.test', ASSETS: { fetch: async request => {
        expect(request.url).toBe(`${origin}${TERMS}index.html`);
        expect(request.headers.get('Cookie')).toBeNull();
        return new Response(await readFile(path.join(__dirname, '../../r/45662413410ed051/terms/index.html')), { headers: { 'Content-Type': 'text/html' } });
    } } };
    server = createServer(async (request, response) => {
        try {
            calls.push({ method: request.method, path: request.url });
            const result = await betaFetch(new Request(`${origin}${request.url}`, { method: request.method, headers: request.headers }), env);
            response.writeHead(result.status, Object.fromEntries(result.headers));
            response.end(Buffer.from(await result.arrayBuffer()));
        } catch (error) { response.writeHead(500); response.end('Local help fixture failed'); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(4621, '127.0.0.1', resolve); });
    origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { if (server) await new Promise(resolve => server.close(resolve)); });

for (const [width, height] of [[375, 667], [390, 812]]) {
    test(`public privacy/contact is styled and keyboard-reachable without invitation at ${width}px`, async ({ browser }, testInfo) => {
        const context = await browser.newContext({ viewport: { width, height } });
        const errors = [], requests = [];
        try {
            await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
            const page = await context.newPage();
            page.on('pageerror', error => errors.push(error.message));
            page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
            page.on('request', request => requests.push(new URL(request.url()).pathname));
            const result = await page.goto(`${origin}/beta/privacy`);
            expect(result.status()).toBe(200);
            expect(page.url()).toBe(`${origin}${TERMS}`);
            await expect(page.getByRole('heading', { name: 'House rules', exact: true })).toBeVisible();
            await expect(page.getByText('13+ only.', { exact: true })).toBeVisible();
            const contact = page.getByRole('link', { name: 'moderator@example.test', exact: true });
            for (let i = 0; i < 12 && !await contact.evaluate(element => element === document.activeElement); i++) await page.keyboard.press('Tab');
            await expect(contact).toBeFocused(); await expect(contact).toBeVisible();
            expect(await contact.evaluate(element => getComputedStyle(element).outlineWidth)).toBe('3px');
            const geometry = await page.evaluate(() => ({ viewport: innerWidth, page: document.documentElement.scrollWidth,
                body: document.body.scrollWidth, background: getComputedStyle(document.documentElement).backgroundColor,
                contact: document.querySelector('[data-contact]').getBoundingClientRect().toJSON(),
                scripts: document.scripts.length, cookies: document.cookie, storage: { ...sessionStorage } }));
            expect(geometry.page).toBeLessThanOrEqual(width); expect(geometry.body).toBeLessThanOrEqual(width);
            expect(geometry.contact.x).toBeGreaterThanOrEqual(0); expect(geometry.contact.right).toBeLessThanOrEqual(width);
            expect(geometry.background).toBe('rgb(13, 16, 17)');
            expect(geometry.scripts).toBe(0); expect(geometry.cookies).toBe(''); expect(geometry.storage).toEqual({});
            expect(await context.cookies()).toEqual([]);
            expect(requests).toEqual(['/beta/privacy', TERMS, '/beta/help.css']);
            await page.screenshot({ path: testInfo.outputPath(`public-help-${width}.png`), fullPage: true });
            await testInfo.attach('geometry', { body: JSON.stringify(geometry, null, 2), contentType: 'application/json' });
            expect(errors).toEqual([]);
        } finally { await context.close(); }
    });
}
