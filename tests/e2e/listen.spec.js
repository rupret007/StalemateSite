const path = require('node:path');
const { test, expect, tapHeight } = require('./fixtures');

const ANDREA_M4A = path.join(__dirname, '..', '..', 'play', 'stalemate', 'andrea.m4a');

const TRACKS = [
    ['Andrea', 'andrea', 'https://music.apple.com/us/album/andrea/1718463871?i=1718463872', '6GBydFSUtZ7wZ7pSAvbytw'],
    ['It’s Only Been 18', 'only-been-18', 'https://music.apple.com/us/album/its-been-only-18/1718464113?i=1718464114', '00i8GYyog0bCGJnhtqNJKo']
];
const SPOTIFY_ARTIST = 'https://open.spotify.com/artist/5cZqYe3bDw3xcKIk4aPHNH';
const ALLOWED_SPOTIFY = new Set([SPOTIFY_ARTIST, ...TRACKS.map(([, , , id]) => `https://open.spotify.com/track/${id}`)]);

test('hero PLAY HERE starts same-origin Manic audio on first tap', async ({ page }) => {
    await page.goto('/');
    const play = page.locator('#home [data-site-play="manic"]').first();
    await expect(play).toHaveText(/PLAY HERE/);
    await play.click();
    await expect.poll(() => page.evaluate(() => {
        const el = document.getElementById('stalemate-site-player');
        return el && !el.paused && el.src.includes('/play/stalemate/manic.m4a');
    })).toBe(true);
});

test('listen section plays on-site audio only on tap', async ({ page }) => {
    await page.goto('/');
    const section = page.locator('#listen');
    await expect(section).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Primary navigation', exact: true }).getByRole('link', { name: 'Listen' })).toHaveAttribute('href', '#listen');
    await expect(section.locator('iframe')).toHaveCount(0);
    await expect(page.locator('[href*="4rwTyXLXW0blHBUjQdJmA7"], [src*="4rwTyXLXW0blHBUjQdJmA7"]')).toHaveCount(0);
    expect(await page.content()).not.toContain('4rwTyXLXW0blHBUjQdJmA7');
    const spotifyHrefs = await page.locator('a[href*="spotify.com"]').evaluateAll((links) => links.map((a) => a.getAttribute('href')));
    for (const href of spotifyHrefs) expect(ALLOWED_SPOTIFY.has(href), href).toBe(true);
    await expect(section.locator(`a[href="${SPOTIFY_ARTIST}"]`)).toBeVisible();

    const gamesLink = section.locator('.listen-games-link a');
    await expect(gamesLink).toHaveAttribute('href', '#games');
    expect(tapHeight(await gamesLink.boundingBox())).toBeGreaterThanOrEqual(44);

    const rows = section.locator('[data-listen-track]');
    await expect(rows).toHaveCount(TRACKS.length);
    for (const [index, [title, playId, href, spotifyId]] of TRACKS.entries()) {
        const row = rows.nth(index);
        await expect(row.locator('h3')).toHaveText(title);
        const link = row.locator('a', { hasText: 'Apple Music' });
        await expect(link).toHaveAttribute('href', href);
        expect(tapHeight(await link.boundingBox())).toBeGreaterThanOrEqual(46);
        const spotify = row.locator('a', { hasText: 'Spotify' });
        await expect(spotify).toHaveAttribute('href', `https://open.spotify.com/track/${spotifyId}`);
        expect(tapHeight(await spotify.boundingBox())).toBeGreaterThanOrEqual(46);
        const playBtn = row.locator('[data-site-play]');
        await expect(playBtn).toHaveAttribute('data-site-play', playId);
        expect(tapHeight(await playBtn.boundingBox())).toBeGreaterThanOrEqual(46);
    }
    await expect(section.locator('a[href="https://music.apple.com/us/album/my-mom-says-were-cool/1718884118"]')).toBeVisible();
    const html = await page.content();
    for (const gone of ['Over 18', 'over-18-1997', '1718884699', '5d7NzhgfZgFBvKiYa63xea']) expect(html).not.toContain(gone);

    await rows.first().locator('[data-site-play]').click();
    await expect.poll(() => page.evaluate(() => {
        const el = document.getElementById('stalemate-site-player');
        return el && el.src.includes('/play/stalemate/andrea.m4a') && !el.paused;
    })).toBe(true);
    await expect(rows.first().locator('[data-site-play]')).toHaveAttribute('aria-pressed', 'true');
    await rows.first().locator('[data-site-play]').click();
    await expect.poll(() => page.evaluate(() => {
        const el = document.getElementById('stalemate-site-player');
        return el && el.paused;
    })).toBe(true);
    await expect(rows.first().locator('[data-site-play]')).toHaveAttribute('aria-pressed', 'false');
    await rows.first().locator('[data-site-play]').click();
    await expect.poll(() => page.evaluate(() => {
        const el = document.getElementById('stalemate-site-player');
        return el && !el.paused;
    })).toBe(true);

    const fits = await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) <= innerWidth + 1);
    expect(fits).toBe(true);
});

test('blocked on-site audio keeps focused manual reload and the existing streaming destinations', async ({ page }) => {
    await page.clock.install();
    let attempts = 0;
    await page.route('**/play/stalemate/andrea.m4a', async route => {
        attempts += 1;
        if (attempts === 1) await route.abort('internetdisconnected');
        else await route.fulfill({ path: ANDREA_M4A });
    });
    await page.goto('/');
    const row = page.locator('[data-listen-track]').first();
    const button = row.locator('[data-site-play]');
    const destinations = await row.locator('a').evaluateAll(links => links.map(link => link.href));
    await button.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => attempts).toBe(1);
    await page.clock.fastForward(10_001);
    await expect(button).toHaveText('Reload player');
    await expect(button).toBeFocused();
    const status = row.getByRole('status');
    await expect(status).toHaveText(/taking longer|could not be opened/);
    await expect(button).toHaveAccessibleName('Reload Andrea here');
    await expect(status).not.toHaveText(/^(Playing|Successfully loaded|Playback started)/i);
    await expect(button).toHaveAttribute('aria-describedby', await status.getAttribute('id'));
    await page.keyboard.press('Enter');
    await expect.poll(() => attempts).toBe(2);
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(await row.locator('a').evaluateAll(links => links.map(link => link.href))).toEqual(destinations);
});

test('stalled on-site audio cancels late load and offers only deliberate retries', async ({ page }) => {
    await page.clock.install();
    const attempts = [];
    await page.route('**/play/stalemate/andrea.m4a', route => { attempts.push(route); });
    try {
        await page.goto('/');
        const row = page.locator('[data-listen-track]').first();
        const button = row.locator('[data-site-play]');
        const status = row.getByRole('status');
        await button.focus();
        await page.keyboard.press('Enter');
        await expect.poll(() => attempts.length).toBe(1);
        await expect(button).toHaveAttribute('aria-disabled', 'true');
        await expect(button).toBeFocused();
        await page.keyboard.press('Enter');
        expect(attempts).toHaveLength(1);
        await page.clock.fastForward(10_001);
        await expect(status).toContainText('taking longer');
        await expect(button).toHaveText('Reload player');
        await page.clock.fastForward(30_000);
        expect(attempts).toHaveLength(1);
        await page.keyboard.press('Enter');
        await expect.poll(() => attempts.length).toBe(2);
        await expect(button).toHaveAttribute('aria-disabled', 'true');
        await expect(status).toContainText('Opening');
        await attempts[1].fulfill({ path: ANDREA_M4A });
        await expect.poll(() => page.evaluate(() => {
            const el = document.getElementById('stalemate-site-player');
            return el && !el.paused;
        })).toBe(true);
        await expect(button).toHaveAttribute('aria-pressed', 'true');
    } finally {
        for (const route of attempts) await route.abort().catch(() => {});
    }
});

test('leaving an opening on-site preview retires it before history return', async ({ page }) => {
    const attempts = [];
    await page.route('**/play/stalemate/andrea.m4a', route => { attempts.push(route); });
    try {
        await page.goto('/');
        const button = page.locator('[data-listen-track]').first().locator('[data-site-play]');
        await button.click();
        await expect.poll(() => attempts.length).toBe(1);
        await page.evaluate(() => window.addEventListener('pagehide', () => sessionStorage.setItem('test-site-audio-exit', JSON.stringify({
            paused: document.getElementById('stalemate-site-player')?.paused ?? true,
            label: document.querySelector('[data-listen-track] [data-site-play]').textContent,
            busy: document.querySelector('[data-listen-track] [data-site-play]').getAttribute('aria-disabled'),
            status: document.querySelector('[data-listen-track] [data-site-play-status]')?.textContent || ''
        })), { once: true }));
        await page.goto('/qr/');
        expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('test-site-audio-exit')))).toEqual({
            paused: true,
            label: '▶ PLAY HERE',
            busy: null,
            status: ''
        });
        await page.goBack();
        await expect(button).toHaveText('▶ PLAY HERE');
        expect(await page.evaluate(() => document.getElementById('stalemate-site-player')?.paused ?? true)).toBe(true);
        expect(attempts).toHaveLength(1);
    } finally {
        for (const route of attempts) await route.abort().catch(() => {});
    }
});

test('QR Listen clears the actual sticky header through phone rotation without changing intro spacing', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/qr/');
    for (const viewport of [{ width: 320, height: 568 }, { width: 568, height: 320 }, { width: 1280, height: 900 }]) {
        await page.setViewportSize(viewport);
        await expect.poll(() => page.evaluate(() => Math.abs(parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) - document.querySelector('.site-header').getBoundingClientRect().height))).toBeLessThan(1);
        await page.locator('.site-nav a[href="#manic"]').click();
        await expect.poll(() => page.evaluate(() => document.querySelector('#manic').getBoundingClientRect().top - document.querySelector('.site-header').getBoundingClientRect().bottom)).toBeGreaterThanOrEqual(-1);
        expect(await page.locator('.qr-intro').evaluate(el => getComputedStyle(el).paddingTop)).toBe('112px');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        await page.locator('a[href="#top"]').click();
    }
});

test('Manic teaser and stalemate.band share metadata', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.hero-video__teaser')).toContainText('Manic is just the first');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://stalemate.band/');
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', 'https://stalemate.band/');
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', 'https://stalemate.band/assets/og.png');
    await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute('content', 'https://stalemate.band/assets/og.png');
    expect(await page.content()).not.toContain('rupret007.github.io');
    expect((await page.request.get('assets/og.png')).status()).toBe(200);
});
