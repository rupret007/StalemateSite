const { test, expect, tapHeight } = require('./fixtures');

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
        return el && el.src.includes('/play/stalemate/andrea.m4a');
    })).toBe(true);
    await expect(section.locator('iframe')).toHaveCount(0);

    const fits = await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) <= innerWidth + 1);
    expect(fits).toBe(true);
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
