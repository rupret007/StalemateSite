const { test: base, expect } = require('@playwright/test');

const test = base.extend({
    serviceWorkers: 'block',
    showTime: ['2026-10-15T12:00:00-05:00', { option: true }],
    page: async ({ page, showTime }, use) => {
        if (showTime !== null) {
            await page.clock.setFixedTime(new Date(showTime));
        }
        await use(page);
    },
    launchOptions: async ({ launchOptions }, use) => {
        await use({
            ...launchOptions,
            args: [
                ...(launchOptions.args || []),
                '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'
            ]
        });
    },
    _offlineNetwork: [async ({ context, baseURL }, use) => {
        const localOrigin = new URL(baseURL).origin;
        const unexpected = [];
        const isLocal = (value) => new URL(value, baseURL).origin === localOrigin;
        const forbidden = /4rwTyXLXW0blHBUjQdJmA7|open\.spotify\.com\/artist/i;

        const api = context.request;
        const originals = new Map();
        for (const method of ['fetch', 'get', 'post', 'put', 'patch', 'delete', 'head']) {
            const original = api[method];
            originals.set(method, original);
            api[method] = function localRequestOnly(input, ...args) {
                const url = typeof input === 'string' ? input : input.url();
                if (forbidden.test(url)) {
                    throw new Error(`Offline browser fixture refused forbidden artist URL: ${url}`);
                }
                if (!isLocal(url)) {
                    throw new Error(`Offline browser fixture refused API request: ${url}`);
                }
                return original.call(this, input, ...args);
            };
        }

        await context.route('**/*', async (route) => {
            const request = route.request();
            const url = new URL(request.url());
            if (forbidden.test(url.href)) {
                unexpected.push(`FORBIDDEN ${request.method()} ${url.href}`);
                await route.abort('blockedbyclient');
                return;
            }
            if (isLocal(url.href)) {
                await route.continue();
                return;
            }
            if (url.protocol === 'https:' && (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com')) {
                await route.fulfill({
                    contentType: url.hostname === 'fonts.googleapis.com' ? 'text/css' : 'application/octet-stream',
                    body: url.hostname === 'fonts.googleapis.com' ? '/* Offline font fallback. */' : ''
                });
                return;
            }
            unexpected.push(`${request.method()} ${url.origin}${url.pathname}`);
            await route.abort('blockedbyclient');
        });
        await context.routeWebSocket('**/*', (socket) => socket.close());

        try {
            await use();
        } finally {
            for (const [method, original] of originals) api[method] = original;
            expect(unexpected, 'No unexpected external network requests').toEqual([]);
        }
    }, { auto: true }]
});

module.exports = { test, expect };
