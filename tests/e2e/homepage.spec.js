const { test, expect, tapHeight } = require('./fixtures');

const PLACEHOLDER_COPY = /\bTBA\b|coming soon|\blorem\b|\bplaceholder\b|\byour\b|\benter\b/i;

test('homepage is a finished band page with originals, show and real links', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Stalemate/);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('#band-title')).toContainText('Stalemate');
    await expect(page.locator('#home a.button--listen')).toHaveAttribute('href', '#about');
    await expect(page.locator('#home a.button--hot')).toHaveCount(2);
    for (const cta of await page.locator('#home a.button--hot').all()) await expect(cta).toHaveAttribute('href', 'https://rockinoctober.com');
    const video = page.locator('.hero-video__player');
    await expect(video).toBeVisible();
    await expect(video).not.toHaveAttribute('autoplay');
    await expect(video).toHaveAttribute('playsinline', '');
    await expect(video.locator('source')).toHaveAttribute('src', 'assets/manic.mp4');
    await expect(page.locator('.hero-show__tie')).toContainText('Hear it loud Oct 24 at Los Amigo’s, Plano');
    await expect(page.locator('#about')).toContainText(/punk/i);
    await expect(page.locator('#about')).toContainText('We wrote these. Sorry in advance.');
    await expect(page.locator('body')).not.toContainText(/Better Than Now|named cut|on this page|A lyric video\. A Saturday set\./);
    await expect(page.locator('#about')).toContainText('Manic');
    await expect(page.locator('#about')).not.toContainText(/Lewisville|Flower Mound/);
    await expect(page.locator('#about dt')).toHaveCount(0);
    await expect(page.locator('#music')).toHaveCount(0);
    await expect(page.locator('#video')).toHaveCount(0);
    await expect(page.locator('#follow')).toHaveCount(0);
    await expect(page.locator('#merch')).toHaveCount(0);
    await expect(page.locator('[data-embed]')).toHaveCount(0);
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(page.locator('form')).toHaveCount(0);
    await expect(page.locator('#home')).toContainText('Rockin’ October');
    await expect(page.locator('#home')).toContainText('Los Amigo’s');
    await expect(page.locator('.hero__tag')).toContainText('All originals. All too loud.');
    await expect(page.locator('.hero__lede')).toHaveText('Original punk rock, played loud and a little sloppy.');
    await expect(page.locator('body')).not.toContainText('Press play on Manic');
    await expect(page.locator('.site-footer')).toContainText('Dallas-area punk rock. Loud on purpose.');
    await expect(page.locator('body')).not.toContainText(/Lewisville|Flower Mound/);
    const socials = [
        ['Instagram', 'https://www.instagram.com/stalemate.punk/'],
        ['YouTube', 'https://www.youtube.com/@stalemate.punkband'],
        ['Facebook', 'https://www.facebook.com/stalemate.band/']
    ];
    for (const [name, href] of socials) {
        const header = page.locator('.site-header a.social-link[href="' + href + '"]');
        const hero = page.locator('#home a.social-link[href="' + href + '"]');
        const footer = page.locator('.site-footer a.social-link[href="' + href + '"]');
        await expect(header).toBeVisible();
        await expect(hero).toBeVisible();
        await expect(footer).toBeVisible();
        expect(tapHeight(await header.boundingBox())).toBeGreaterThanOrEqual(44);
        expect(tapHeight(await hero.boundingBox())).toBeGreaterThanOrEqual(44);
        expect(tapHeight(await footer.boundingBox())).toBeGreaterThanOrEqual(44);
        await expect(header).toHaveAttribute('rel', /noopener/);
        await expect(header).toContainText(name);
    }
    await expect(page.locator('body')).not.toContainText(/two-tone/i);
    await expect(page.locator('body')).not.toContainText(/SoCal|Southern California|do not link|other act|Head2Wall/i);
    expect(await page.locator('meta[name="description"]').getAttribute('content')).not.toMatch(/SoCal/);
    expect(await page.locator('meta[property="og:description"]').getAttribute('content')).not.toMatch(/SoCal/);
    expect(await page.locator('meta[name="twitter:description"]').getAttribute('content')).not.toMatch(/SoCal/);
    await expect(page.locator('body')).not.toContainText(/ticket/i);
    await expect(page.locator('body')).not.toContainText(/\bJeff\b/);
    await expect(page.locator('body')).not.toContainText(/\bChe\b/);
    await expect(page.locator('body')).not.toContainText(/\bSean\b/);
    const metadata = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent());
    expect(metadata['@type']).toBe('MusicGroup');
    expect(metadata.name).toBe('Stalemate');
    expect(metadata.foundingLocation).toBeUndefined();
    expect(metadata.description).toBe('Stalemate. Punk rock.');
    expect(metadata.description).not.toMatch(/Lewisville|Flower Mound|SoCal|Southern California|same name/i);
    expect(metadata.sameAs).toEqual(expect.arrayContaining([
        'https://www.instagram.com/stalemate.punk/',
        'https://www.youtube.com/@stalemate.punkband',
        'https://www.facebook.com/stalemate.band/'
    ]));
    await expect(page.locator('body')).not.toContainText('4rwTyXLXW0blHBUjQdJmA7');
});

test('nav and footer have no press, EPK, or QR links', async ({ page }) => {
    for (const path of ['/', '/missing']) {
        await page.goto(path);
        const chrome = page.locator('.site-nav, .site-footer nav');
        await expect(chrome.getByRole('link', { name: /press|epk|qr/i })).toHaveCount(0);
        const hrefs = await chrome.locator('a').evaluateAll((links) => links.map((link) => link.getAttribute('href') || ''));
        expect(hrefs.join('\n'), path).not.toMatch(/epk|\/qr|press/i);
        await expect(page.locator('a[href*="epk"], a[href*="qr/"]')).toHaveCount(0);
        await expect(page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Home' })).toBeVisible();
        await expect(page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'About' })).toBeVisible();
    }
});

test('unpublished press and QR paths render the 404 page', async ({ page }) => {
    for (const path of ['/epk/', '/qr/']) {
        const response = await page.goto(path);
        expect(response.status(), path).toBe(404);
        await expect(page.locator('h1')).toContainText('Wrong song.');
    }
});

test('public pages fail on template placeholder words', async ({ page }) => {
    for (const path of ['/', '/missing']) {
        await page.goto(path);
        const text = await page.locator('body').innerText();
        expect(text, path).not.toMatch(PLACEHOLDER_COPY);
        expect(text, path).not.toMatch(/two-tone/i);
        expect(text, path).not.toMatch(/SoCal|Southern California|do not link|other act|Head2Wall/i);
        expect(text, path).not.toMatch(/Lewisville|Flower Mound/);
    }
});

for (const width of [320, 390, 768, 1440]) {
    test(`homepage remains usable without overlap at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/');
        for (const section of ['#home', '#about']) {
            await page.locator(section).scrollIntoViewIfNeeded();
            expect(await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) <= innerWidth + 1)).toBe(true);
        }
        const nav = page.getByRole('navigation', { name: 'Primary navigation', exact: true });
        for (const link of await nav.getByRole('link').all()) {
            expect(tapHeight(await link.boundingBox())).toBeGreaterThanOrEqual(44);
        }
        const about = page.locator('#home a.button--listen');
        expect(tapHeight(await about.boundingBox())).toBeGreaterThanOrEqual(44);
    });
}

test.describe('homepage without JavaScript', () => {
    test.use({ javaScriptEnabled: false });
    test('keeps about, the show facts and festival link usable', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#home a[href="#about"]')).toBeVisible();
        await expect(page.locator('#home a.button--hot[href="https://rockinoctober.com"]')).toHaveCount(2);
        for (const cta of await page.locator('#home a.button--hot[href="https://rockinoctober.com"]').all()) await expect(cta).toBeVisible();
        await expect(page.locator('.hero-video__player source')).toHaveAttribute('src', 'assets/manic.mp4');
        await expect(page.locator('.hero-show__tie')).toContainText('Hear it loud Oct 24 at Los Amigo’s, Plano');
        await expect(page.locator('#about')).toContainText('Rockin’ October on Saturday, Oct 24, 4:45 PM');
        await expect(page.locator('[data-load-preview]')).toHaveCount(0);
        await expect(page.locator('[data-share-band]:not([hidden])')).toHaveCount(0);
        await expect(page.locator('#about')).toContainText(/punk rock/i);
        await expect(page.locator('#about dt')).toHaveCount(0);
        await expect(page.locator('[data-next-show-block]')).toContainText('Rockin’ October');
        await expect(page.locator('[data-countdown-clock]')).toBeHidden();
        await expect(page.locator('body')).not.toContainText(/ticket/i);
        await expect(page.locator('body')).not.toContainText(PLACEHOLDER_COPY);
    });
});

test.describe('hero countdown before the set', () => {
    test.use({ showTime: '2026-10-15T12:00:00-05:00' });

    test('shows the countdown and next-show facts', async ({ page }) => {
        await page.goto('/');
        const next = page.locator('[data-next-show]');
        await expect(next).toBeVisible();
        await expect(page.locator('[data-countdown]')).toBeVisible();
        await expect(page.locator('[data-countdown-clock]')).toBeVisible();
        await expect(page.locator('[data-countdown-days]')).toHaveText('09');
        await expect(page.locator('[data-next-show-block]')).toContainText('Rockin’ October');
        await expect(page.locator('[data-next-show-block]')).toContainText('Studio 801');
        await expect(page.locator('[data-next-show-block]')).toContainText('Los Amigo’s, Plano, TX');
        await expect(page.locator('[data-next-show-block]')).toContainText('Doors at noon');
        await expect(page.locator('[data-next-show-block]')).toContainText('All ages');
        await expect(page.locator('.hero-show__tie')).toContainText('Hear it loud Oct 24 at Los Amigo’s, Plano');
        await expect(page.locator('.hero-video__player')).toBeVisible();
        await expect(page.locator('#home a[href="https://rockinoctober.com"]').first()).toBeVisible();
        await expect(page.locator('#home')).not.toContainText(/ticket/i);
        await expect(page.locator('#home')).not.toContainText(/\bJeff\b/);
        const box = await next.boundingBox();
        expect(box.height).toBeGreaterThan(80);
    });
});

test.describe('hero countdown after the set', () => {
    test.use({ showTime: '2026-10-24T16:45:00-05:00' });

    test('hides the countdown and next-show block without a leftover placeholder', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('[data-next-show]')).toBeHidden();
        await expect(page.locator('[data-countdown]')).toBeHidden();
        await expect(page.locator('[data-next-show-block]')).toBeHidden();
        await expect(page.locator('.hero-show__tie')).toBeHidden();
        await expect(page.locator('.hero-video__player')).toBeVisible();
        await expect(page.locator('#home a[href="#about"]')).toBeVisible();
        const repeat = page.locator('#home .button-row [data-show-cta]');
        await expect(repeat).toBeVisible();
        await expect(repeat).toHaveText('Catch the next show');
        await expect(repeat).toHaveAttribute('href', 'https://www.instagram.com/stalemate.punk/');
        await expect(repeat).toHaveAttribute('data-track', 'show-cta-next-fallback');
        await expect(page.locator('#home')).not.toContainText('See us Oct 24');
        await expect(page.locator('#home .hero-show__cta a')).toBeHidden();
        await expect(page.locator('#home')).not.toContainText('Shows coming soon');
        expect(await page.locator('[data-next-show]').boundingBox()).toBeNull();
        await expect(page.locator('[data-upcoming-empty]')).toHaveCount(0);
        await expect(page.locator('#about')).toContainText('Rockin’ October');
        await expect(page.locator('body')).not.toContainText(/ticket/i);
        await expect(page.locator('body')).not.toContainText(PLACEHOLDER_COPY);
    });
});

test('the GitHub Pages project prefix serves the same homepage', async ({ page }) => {
    await page.goto('/StalemateSite/');
    await expect(page.locator('#band-title')).toContainText('Stalemate');
    await expect(page.locator('link[rel="stylesheet"][href="styles.css"]')).toHaveCount(1);
});

test.describe('repeat show button', () => {
    test('before the show it says See us Oct 24 and links to the show', async ({ page }) => {
        await page.goto('/');
        const repeat = page.locator('#home .button-row [data-show-cta]');
        await expect(repeat).toHaveText('See us Oct 24');
        await expect(repeat).toHaveAttribute('href', 'https://rockinoctober.com');
        await expect(repeat).toHaveAttribute('data-track', 'show-cta-under-video');
    });

    test.describe('after the show with a next show booked', () => {
        test.use({ showTime: '2026-11-01T12:00:00-05:00' });
        test('points at the next show', async ({ page }) => {
            await page.route(/\/(index\.html)?$/, async (route) => {
                const res = await route.fetch();
                const html = (await res.text()).replace('data-show-cta ', 'data-show-cta data-next-starts="2026-12-05T20:00:00-06:00" data-next-href="https://example.com/next" data-next-label="See us Dec 5" ');
                await route.fulfill({ response: res, body: html });
            });
            await page.goto('/');
            const repeat = page.locator('#home .button-row [data-show-cta]');
            await expect(repeat).toHaveText('See us Dec 5');
            await expect(repeat).toHaveAttribute('href', 'https://example.com/next');
            await expect(repeat).toHaveAttribute('data-track', 'show-cta-next');
        });
    });
});
