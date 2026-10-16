const { test, expect } = require('@playwright/test');

// Every link on every public page: internal targets load, external targets are ours.
const PAGES = ['/', '/qr/', '/tap/', '/play/', '/404.html'];
const OURS = [
    /^https:\/\/www\.instagram\.com\/stalemate\.punk\/$/,
    /^https:\/\/www\.youtube\.com\/@stalemate\.punkband$/,
    /^https:\/\/www\.facebook\.com\/stalemate\.band\/$/,
    /^https:\/\/rockinoctober\.com\/?$/,
    /^https:\/\/music\.apple\.com\/us\/album\/(my-mom-says-were-cool\/1718884118|andrea\/1718463871\?i=1718463872|its-been-only-18\/1718464113\?i=1718464114)$/,
    /^https:\/\/open\.spotify\.com\/(artist\/5cZqYe3bDw3xcKIk4aPHNH|track\/6GBydFSUtZ7wZ7pSAvbytw|track\/00i8GYyog0bCGJnhtqNJKo)$/
];

const GAMES = [
    ['Turdanoid', 'play/TurdAnoid.html', /^Turdanoid\b/],
    ['Turdomania', 'play/turdomania.html', /^Turdomania$/],
    ['Turdtris', 'play/turdtris.html', /^Turdtris$/],
    ['blackjack', 'play/turdjack.html', /^Crapjack 21$/],
    ['rummy', 'play/turdrummy.html', /^TurdRummy/],
    ['spades', 'play/turdspades.html', /^TurdSpades$/],
    ['crazy eights', 'play/crapeights.html', /^Crappy Eights$/]
];

test('every link on every page resolves and every external link is our Stalemate', async ({ page, request, baseURL }) => {
    const origin = new URL(baseURL).origin;
    const checked = new Set();
    for (const p of PAGES) {
        await page.goto(p);
        const links = await page.locator('a[href]').evaluateAll((as) => as.map((a) => ({ href: a.href, text: (a.getAttribute('aria-label') || a.textContent).trim() })));
        expect(links.length, p).toBeGreaterThan(0);
        for (const { href, text } of links) {
            expect(href, `${p} "${text}"`).not.toMatch(/4rwTyXLXW0blHBUjQdJmA7/);
            const u = new URL(href);
            if (u.origin !== origin) {
                expect(OURS.some((re) => re.test(href)), `${p} "${text}" -> ${href} is not an approved Stalemate link`).toBe(true);
                continue;
            }
            u.hash = '';
            if (checked.has(u.href)) continue;
            checked.add(u.href);
            const res = await request.get(u.href);
            expect(res.status(), `${p} "${text}" -> ${u.href}`).toBe(200);
        }
        // In-page anchors point at real ids.
        const missing = await page.locator('a[href^="#"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')).filter((h) => h.length > 1 && !document.getElementById(h.slice(1))));
        expect(missing, p).toEqual([]);
    }
});

test('homepage Play Turdanoid and every game link open their own game', async ({ page }) => {
    await page.goto('/');
    const games = page.locator('#games');
    await expect(games.getByRole('link', { name: 'Play Turdanoid' })).toHaveAttribute('href', 'play/TurdAnoid.html');
    await expect(games.getByRole('link', { name: 'All seven games' })).toHaveAttribute('href', 'play/');
    const list = games.locator('.games-card__list');
    await expect(list.locator('a')).toHaveCount(7);
    const hrefs = await list.locator('a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    expect(new Set(hrefs).size).toBe(7);
    for (const [name, href, title] of GAMES) {
        const link = list.getByRole('link', { name, exact: true });
        await expect(link).toHaveAttribute('href', href);
        await page.goto('/' + href);
        expect(new URL(page.url()).pathname).toBe('/' + href);
        await expect(page).toHaveTitle(title);
        await page.goto('/');
    }
    await games.getByRole('link', { name: 'Play Turdanoid' }).click();
    await expect(page).toHaveURL(/\/play\/TurdAnoid\.html$/);
    await expect(page).toHaveTitle(/^Turdanoid\b/);
});

test('the /play/ hub cards each open a different game', async ({ page }) => {
    await page.goto('/play/');
    const cards = page.locator('a.game-card');
    await expect(cards).toHaveCount(7);
    const hrefs = await cards.evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    expect(hrefs.sort()).toEqual(GAMES.map(([, h]) => h.replace('play/', '')).sort());
    await cards.first().click();
    await expect(page).toHaveURL(/\/play\/TurdAnoid\.html$/);
});

test('no page calls any game "Turbo"', async ({ page }) => {
    for (const p of [...PAGES, ...GAMES.map(([, h]) => '/' + h), '/play/neon-arkanoid.html']) {
        await page.goto(p);
        expect(await page.title(), p).not.toMatch(/turbo/i);
        expect(await page.content(), p).not.toMatch(/turbo/i);
    }
});
