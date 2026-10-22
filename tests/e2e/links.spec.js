const { test, expect } = require('@playwright/test');

// Every link on every public page: internal targets load, external targets are ours.
const PAGES = ['/', '/qr/', '/tap/', '/play/', '/404.html'];
const OURS = [
    // The verified show venue is an approved destination for the new directions action.
    /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=Los\+Amigo%27s\+Sports\+Bar\+%2B\+Bites%2C\+8604\+Preston\+Rd\+Suite\+100%2C\+Plano\+TX\+75024$/,
    /^mailto:stalemate\.punk@gmail\.com$/,
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
    ['Crapjack 21', 'play/turdjack.html', /^Crapjack 21$/],
    ['TurdRummy', 'play/turdrummy.html', /^TurdRummy/],
    ['TurdSpades', 'play/turdspades.html', /^TurdSpades$/],
    ['Crappy Eights', 'play/crapeights.html', /^Crappy Eights$/]
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
        // New-tab links can't reach back into our page.
        const unsafe = await page.locator('a[target="_blank"]').evaluateAll((as) => as.filter((a) => !/\bnoopener\b/.test(a.rel || '')).map((a) => a.href));
        expect(unsafe, `${p} target=_blank without noopener`).toEqual([]);
        // In-page anchors point at real ids.
        const missing = await page.locator('a[href^="#"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')).filter((h) => h.length > 1 && !document.getElementById(h.slice(1))));
        expect(missing, p).toEqual([]);
    }
});

test('homepage arcade action and every game link open their destination', async ({ page }) => {
    await page.goto('/');
    const games = page.locator('#games');
    await expect(games.getByRole('link', { name: 'Open Stalemate Arcade' })).toHaveAttribute('href', 'play/');
    await expect(games.getByRole('link', { name: 'Play Turdanoid' })).toHaveAttribute('href', 'play/TurdAnoid.html');
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
    for (const a of await list.locator('a').all()) {
        const b = await a.boundingBox();
        expect(b.height, `${await a.textContent()} tap target`).toBeGreaterThanOrEqual(44);
    }
    await games.getByRole('link', { name: 'Open Stalemate Arcade' }).click();
    await expect(page).toHaveURL(/\/play\/$/);
    await expect(page).toHaveTitle(/^Stalemate Arcade/);
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

test('Games nav goes straight to all seven game cards in one click', async ({ page }) => {
    for (const [start, nav] of [['/', 'Primary navigation'], ['/qr/', null]]) {
        await page.goto(start);
        const link = nav ? page.getByRole('navigation', { name: nav, exact: true }).getByRole('link', { name: 'Games', exact: true }) : page.locator('header').getByRole('link', { name: 'Games', exact: true });
        await link.click();
        await expect(page).toHaveURL(/\/play\/#hub-games$/);
        const cards = page.locator('#hub-games a.game-card');
        await expect(cards).toHaveCount(7);
        await expect(cards.first()).toBeInViewport();
    }
});

// Every game chip is a real 44px target: taps just inside each edge land on that same link, never a neighbor.
for (const vp of [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 1366, height: 900 }]) {
    test(`game chips own their whole tap box at ${vp.width}px`, async ({ page }) => {
        await page.setViewportSize(vp);
        await page.goto('/');
        const list = page.locator('#games .games-card__list');
        await list.scrollIntoViewIfNeeded();
        const misses = await list.locator('a').evaluateAll((as) => as.flatMap((a) => {
            const r = a.getBoundingClientRect();
            const out = [];
            if (r.height < 44 || r.width < 44) out.push(`${a.textContent} is ${r.width}x${r.height}`);
            const midX = r.left + r.width / 2, midY = r.top + r.height / 2;
            for (const [edge, x, y] of [['top', midX, r.top + 1], ['bottom', midX, r.bottom - 1], ['left', r.left + 1, midY], ['right', r.right - 1, midY]]) {
                const hit = document.elementFromPoint(x, y);
                if (!hit || hit.closest('a') !== a) out.push(`${a.textContent} ${edge} edge hits ${hit && (hit.closest('a')?.textContent || hit.tagName)}`);
            }
            return out;
        }));
        expect(misses).toEqual([]);
    });
}
