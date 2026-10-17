// Local-only: screenshots of the hidden lobby, a room, the jam hand-off, terms and the band panel (desktop + phone).
// Usage: STALEMATE_TEST_PORT=4392 node scripts/serve-test.cjs & node tests/e2e/support/capture-lobby-screens.mjs <outDir>
import { chromium } from '@playwright/test';
import { startRelay } from '../../../scripts/hangout-relay-dev.mjs';

const OUT = process.argv[2] || 'pr-assets/lobby';
const BASE = `http://127.0.0.1:${process.env.STALEMATE_TEST_PORT || 4392}`;
const SLUG = '45662413410ed051';
const KEY = 'local-preview-key-0001';
const ADMIN = 'local-dev-admin-key-0001';
const relay = await startRelay({ previewKey: KEY, origins: BASE, devAdminKey: ADMIN, lobbyLimits: { pmMinLobbyMs: 0, roomPerDevice: 0, roomsPerIpHour: 99, defaultSlow: 0, burst: 50 } });
const R = `ws://127.0.0.1:${relay.port}`;
const browser = await chromium.launch();
const sizes = { desktop: { viewport: { width: 1280, height: 800 } }, phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function fan(nick, size = 'desktop') {
    const ctx = await browser.newContext(sizes[size]);
    const p = await ctx.newPage();
    await p.goto(`${BASE}/r/${SLUG}/lobby/?preview=${KEY}&relay=${R}`);
    if (nick) { await p.fill('[data-nick]', nick); await p.click('[data-enter]'); await p.waitForSelector('[data-app]:not([hidden])'); }
    return p;
}
const say = async (p, t) => { await p.fill('[data-text]', t); await p.press('[data-text]', 'Enter'); await wait(120); };
const shot = (p, name) => p.screenshot({ path: `${OUT}/${name}.png` });

// Gate (first-timer screen), desktop + phone, blank then rolled.
for (const size of ['desktop', 'phone']) {
    const g = await fan('', size);
    await shot(g, `01-gate-${size}`);
    await g.click('[data-reroll]');
    await shot(g, `02-gate-rolled-${size}`);
}
const band = await (async () => {
    const ctx = await browser.newContext(sizes.desktop);
    const p = await ctx.newPage();
    await p.goto(`${BASE}/r/${SLUG}/admin/?preview=${KEY}&relay=${R}&devadmin=${ADMIN}`);
    await p.fill('[data-nick]', 'Jeff');
    await p.click('[data-enter]');
    await p.waitForSelector('[data-panel]:not([hidden])');
    return p;
})();
const a = await fan('CaptainHappyTree');
const b = await fan('GrandmaFeedback');
const c = await fan('SirMosh-a-Lot');
const ph = await fan('ToiletPaperBandit', 'phone');
await say(a, 'who’s going to Los Amigo’s saturday?? 🤘');
await say(b, 'me! bringing earplugs this time, that fucking snare');
await c.click('[data-quick-cmd="slap"]');
await say(ph, '/me pogos');
await say(b, 'what was that song, Manic? https://youtu.be/dQw4w9WgXcQ');
await say(c, 'call me 214-555-0199');
await say(c, 'you are such a loser');
await a.click('[data-start="bobross"]');
await wait(300);
await say(a, '/topic Happy little trees, Saturday edition');
await b.locator('[data-roomlist] button').first().click();
await say(b, 'beat the devil out of it!');
await c.locator('[data-tabs] button').first().click();
await c.click('[data-start="jam"]');
await wait(300);
await c.fill('[data-jam-link]', 'webjam://join?v=1#demo-invite-not-real');
await c.press('[data-jam-link]', 'Enter');
await wait(300);
const flag = b.locator('[data-tabs] button', { hasText: '#stalemate' });
await flag.click();
await b.locator('[data-buffer] li', { hasText: 'large trout' }).hover();
await b.locator('[data-buffer] li', { hasText: 'large trout' }).locator('.flag').click();
await ph.locator('[data-buffer]').waitFor();
await wait(300);
await a.locator('[data-tabs] button', { hasText: '#stalemate' }).click();
await shot(a, '03-lobby-desktop');
await shot(ph, '04-lobby-phone');
await ph.click('[data-show="rooms"]');
await shot(ph, '05-rooms-phone');
await ph.click('[data-show="people"]');
await shot(ph, '06-people-phone');
await ph.click('[data-show="chat"]');
await ph.locator('[data-buffer] .who', { hasText: 'GrandmaFeedback' }).first().click();
await shot(ph, '07-nick-sheet-phone');
await ph.click('[data-sheet-close]');
await a.locator('[data-tabs] button', { hasText: '#bobross' }).click();
await shot(a, '08-room-bobross-desktop');
await a.click('[data-roomtools]');
await shot(a, '09-host-tools-desktop');
await a.click('[data-palette-close]');
await a.click('[data-cam]');
await shot(a, '10-camera-18-gate-desktop');
await a.click('[data-cam-no]');
await shot(c, '11-room-jam-desktop');
const jamPhone = await fan('LilPickle', 'phone');
await jamPhone.click('.quick .startroom');
await jamPhone.click('[data-start="art"]');
await wait(300);
await shot(jamPhone, '12-room-art-phone');
// PM accept-first
await a.locator('[data-tabs] button', { hasText: '#stalemate' }).click();
await a.locator('[data-nicks] button', { hasText: 'ToiletPaperBandit' }).click();
await a.click('[data-sheet-buttons] >> text=✉ PM');
await wait(300);
await shot(ph, '13-pm-request-phone');
await ph.click('[data-pmreqs] >> text=Accept');
await say(ph, 'hey! love the name');
await shot(ph, '14-pm-open-phone');
// Band panel
await band.click('[data-tab="queue"]');
await shot(band, '15-admin-queue-desktop');
await band.click('[data-tab="people"]');
await shot(band, '16-admin-people-desktop');
await band.click('[data-tab="rooms"]');
await shot(band, '17-admin-rooms-desktop');
await band.click('[data-tab="stats"]');
await band.screenshot({ path: `${OUT}/18-admin-stats-desktop.png`, fullPage: true });
await band.click('[data-tab="log"]');
await shot(band, '19-admin-modlog-desktop');
const bandPhone = await (async () => {
    const ctx = await browser.newContext(sizes.phone);
    const p = await ctx.newPage();
    await p.goto(`${BASE}/r/${SLUG}/admin/?preview=${KEY}&relay=${R}&devadmin=${ADMIN}`);
    await p.fill('[data-nick]', 'Drummer');
    await p.click('[data-enter]');
    await p.waitForSelector('[data-panel]:not([hidden])');
    return p;
})();
await shot(bandPhone, '20-admin-phone');
await bandPhone.click('[data-tab="stats"]');
await bandPhone.screenshot({ path: `${OUT}/21-admin-stats-phone.png`, fullPage: true });
const t = await (await browser.newContext(sizes.phone)).newPage();
await t.goto(`${BASE}/r/${SLUG}/terms/`);
await t.screenshot({ path: `${OUT}/22-terms-phone.png`, fullPage: true });
const room = await (await browser.newContext(sizes.phone)).newPage();
await room.goto(`${BASE}/r/${SLUG}/?preview=${KEY}&relay=${R}`);
await room.click('[data-dice]');
await shot(room, '23-private-room-gate-phone');
await browser.close();
await relay.close();
console.log('saved to', OUT);
