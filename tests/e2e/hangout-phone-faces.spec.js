// Hang Out room phone faces: viewport fit for 2–4 people at 375×667 and 390×664.
const path = require('node:path');
const fs = require('node:fs/promises');
const { test, expect } = require('@playwright/test');

function tapHeight(box) {
    return box ? Math.max(box.height, box.width) : 0;
}
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const FAKE_YT = path.join(__dirname, 'support/fake-youtube.js');

const SLUG = '45662413410ed051';
const KEY = 'local-preview-key-0001';
const SHOT_DIR = path.join('test-results', 'hangout-phone-faces');
const VIEWPORTS = [
    { width: 390, height: 664 },
    { width: 375, height: 667 }
];

test.use({
    permissions: ['camera', 'microphone'],
    launchOptions: {
        args: [
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
            '--disable-features=WebRtcHideLocalIpsWithMdns'
        ]
    }
});
test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium carries the layout fixture suite');

const roomUrl = (baseURL, extra = '') =>
    `/r/${SLUG}/?preview=${KEY}&relay=${encodeURIComponent(hangoutRelayWsBase(baseURL))}${extra}`;

async function seedFacesLayout(page, count) {
    await page.evaluate((people) => {
        document.body.classList.add('faces-on');
        const tiles = document.querySelector('[data-tiles]');
        tiles.dataset.view = 'grid';
        tiles.style.setProperty('--cols', people > 2 ? '2' : '2');
        tiles.replaceChildren();
        const mk = (id, label) => {
            const fig = document.createElement('figure');
            fig.className = 'tile' + (id === 'me' ? ' tile--mirror' : '');
            fig.dataset.tile = id;
            const video = document.createElement('video');
            video.autoplay = true;
            video.playsInline = true;
            video.setAttribute('playsinline', '');
            video.muted = id === 'me';
            const cap = document.createElement('figcaption');
            const nm = document.createElement('span');
            nm.className = 'nm';
            nm.textContent = label;
            cap.append(nm);
            fig.append(video, cap);
            return fig;
        };
        for (let i = 0; i < people - 1; i += 1) {
            tiles.append(mk(`peer${i}`, `Guest ${i + 1}`));
        }
        tiles.append(mk('me', 'You (you)'));
        for (const name of ['mic', 'cam', 'hangup']) {
            const el = document.querySelector(`[data-${name}]`);
            if (!el) continue;
            el.hidden = false;
            el.dataset.ico = name === 'mic' ? '🎤' : name === 'cam' ? '📷' : '✖';
            el.dataset.short = name === 'mic' ? 'Mute' : name === 'cam' ? 'Cam off' : 'Leave';
        }
    }, count);
}

async function auditLayout(page, tag) {
    const metrics = await page.evaluate(() => {
        const vh = window.innerHeight;
        const vw = window.innerWidth;
        const pageWide = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
        const rect = (el) => {
            const r = el.getBoundingClientRect();
            return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
        };
        const tiles = [...document.querySelectorAll('[data-tiles] .tile')].map((tile) => ({
            id: tile.dataset.tile,
            box: rect(tile),
            name: tile.querySelector('.nm')?.textContent || ''
        }));
        const controls = {};
        for (const key of ['mic', 'cam', 'hangup']) {
            const el = document.querySelector(`[data-${key}]`);
            controls[key] = el ? { box: rect(el), hidden: el.hidden } : null;
        }
        const videos = [...document.querySelectorAll('[data-tiles] video')].map((v) => ({
            playsinline: v.hasAttribute('playsinline') || v.playsInline === true
        }));
        return { vw, vh, pageWide, tiles, controls, videos };
    });
    await fs.mkdir(SHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(SHOT_DIR, `${tag}.png`), fullPage: true });
    return metrics;
}

for (const viewport of VIEWPORTS) {
    for (const people of [2, 3, 4]) {
        test(`Hang Out faces fit ${viewport.width}x${viewport.height} with ${people} people`, async ({ page, baseURL }) => {
            await page.route(/youtube\.com|ytimg|googlevideo/, (route) => route.abort());
            await page.route('https://www.youtube.com/iframe_api', (route) => route.fulfill({ path: FAKE_YT, contentType: 'text/javascript' }));
            await page.setViewportSize(viewport);
            await page.goto(roomUrl(baseURL));
            await page.fill('[data-name]', 'LayoutHost');
            await page.click('[data-enter]');
            await expect.poll(async () => page.locator('[data-room]').evaluate((el) => !el.hidden), { timeout: 20000 }).toBe(true);
            await seedFacesLayout(page, people);
            const tag = `${viewport.width}x${viewport.height}-${people}p`;
            const m = await auditLayout(page, tag);

            expect(m.pageWide).toBeLessThanOrEqual(m.vw + 1);
            expect(m.tiles).toHaveLength(people);
            expect(m.tiles.every((t) => t.name.length > 0)).toBe(true);
            for (const tile of m.tiles) {
                expect(tile.box.bottom, tile.id).toBeLessThanOrEqual(m.vh + 0.5);
                expect(tile.box.top, tile.id).toBeGreaterThanOrEqual(-0.5);
                expect(tile.box.right, tile.id).toBeLessThanOrEqual(m.vw + 0.5);
                expect(tile.box.left, tile.id).toBeGreaterThanOrEqual(-0.5);
                expect(tile.box.height, tile.id).toBeGreaterThan(48);
                expect(tile.box.width, tile.id).toBeGreaterThan(48);
            }
            const me = m.tiles.find((t) => t.id === 'me');
            const largest = Math.max(...m.tiles.filter((t) => t.id !== 'me').map((t) => t.box.width * t.box.height));
            expect(me.box.width * me.box.height, 'self-view stays smaller than the main tiles').toBeLessThan(largest * 0.92);

            for (const key of ['mic', 'cam', 'hangup']) {
                const c = m.controls[key];
                expect(c, key).toBeTruthy();
                expect(c.hidden).toBe(false);
                expect(tapHeight(c.box)).toBeGreaterThanOrEqual(44);
                expect(c.box.bottom).toBeLessThanOrEqual(m.vh + 0.5);
                expect(c.box.top).toBeGreaterThanOrEqual(-0.5);
            }
            expect(m.videos.every((v) => v.playsinline)).toBe(true);
            const scrollH = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
            expect(scrollH).toBeLessThanOrEqual(m.vh + 2);
        });
    }
}