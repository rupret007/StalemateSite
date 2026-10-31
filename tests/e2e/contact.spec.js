const { test, expect } = require('./fixtures');

const PAGES = [
    { path: '/', contactHref: /#contact$/ },
    { path: '/404.html', contactHref: /\.\/#contact$/ },
    { path: '/qr/', contactHref: /\.\.\/#contact$/ },
    { path: '/play/', contactHref: /\.\.\/#contact$/ }
];

const FORMSUBMIT = 'https://formsubmit.co/stalemate.punk@gmail.com';

test.describe('contact', () => {
    for (const { path, contactHref } of PAGES) {
        test(`Contact in primary nav and footer on ${path}`, async ({ page }) => {
            await page.goto(path);
            const headerContact = page.locator('.site-nav, nav[aria-label="Stalemate"]').getByRole('link', { name: 'Contact', exact: true });
            await expect(headerContact.first()).toBeVisible();
            await expect(headerContact.first()).toHaveAttribute('href', contactHref);

            const footer = page.locator('.site-footer, footer').first();
            const footerContact = footer.getByRole('link', { name: 'Contact', exact: true });
            await expect(footerContact).toBeVisible();
            await expect(footerContact).toHaveAttribute('href', contactHref);
        });
    }

    test('homepage contact form fields, honeypot, and FormSubmit action', async ({ page }) => {
        await page.goto('/#contact');
        const form = page.locator('[data-contact-form]');
        await expect(form).toHaveAttribute('action', FORMSUBMIT);
        await expect(form.locator('input[name="name"]')).toBeVisible();
        await expect(form.locator('input[name="email"]')).toBeVisible();
        await expect(form.locator('textarea[name="message"]')).toBeVisible();
        await expect(form.locator('input[name="_honey"]')).toBeHidden();
        await expect(form.locator('input[name="_captcha"]')).toHaveAttribute('value', 'false');
        await expect(form.locator('input[name="_next"]')).toHaveCount(1);
    });

    test('mailto backup is assembled in JS with a readable noscript fallback', async ({ page }) => {
        await page.goto('/#contact');
        const mailto = page.locator('[data-contact-mailto]');
        await expect(mailto).toHaveAttribute('href', 'mailto:stalemate.punk@gmail.com');
        await expect(mailto).toHaveText('stalemate.punk@gmail.com');
        const noscript = await page.locator('noscript').evaluateAll((nodes) => nodes.map((n) => n.textContent).join('\n'));
        expect(noscript).toContain('stalemate.punk@gmail.com');
    });

    test('Facebook remains a contact option on the homepage', async ({ page }) => {
        await page.goto('/#contact');
        const section = page.locator('#contact');
        await expect(section.getByRole('link', { name: /Facebook/i })).toHaveAttribute(
            'href',
            'https://www.facebook.com/stalemate.band/'
        );
    });

    test('form submit is intercepted and never hits FormSubmit live', async ({ page }) => {
        await page.route(FORMSUBMIT, async (route) => {
            const request = route.request();
            if (request.method() !== 'POST') {
                await route.continue();
                return;
            }
            const fields = request.postDataJSON();
            const redirectTo = fields._next;
            await route.fulfill({
                status: 302,
                headers: { Location: redirectTo }
            });
        });

        await page.goto('/#contact');
        await page.locator('[data-contact-form] input[name="name"]').fill('Test Fan');
        await page.locator('[data-contact-form] input[name="email"]').fill('fan@example.com');
        await page.locator('[data-contact-form] textarea[name="message"]').fill('Loud show!');

        const [request] = await Promise.all([
            page.waitForRequest((req) => req.method() === 'POST' && req.url() === FORMSUBMIT),
            page.locator('[data-contact-form] button[type="submit"]').click()
        ]);

        const fields = request.postDataJSON();
        expect(fields).toMatchObject({
            name: 'Test Fan',
            email: 'fan@example.com',
            message: 'Loud show!',
            _captcha: 'false',
            _subject: 'New message from stalemate.band'
        });
        expect(fields._honey ?? '').toBe('');
        expect(fields._next).toMatch(/\?contact=sent#contact$/);
        expect(request.url()).toBe(FORMSUBMIT);
    });
});
