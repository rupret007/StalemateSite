const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const KEY = 'local-preview-key-0001';
let testOrigin;
test.beforeAll(async ({ baseURL }) => { testOrigin = baseURL; });
const roomUrl = () => `/r/45662413410ed051/?preview=${KEY}&relay=${encodeURIComponent(hangoutRelayWsBase(testOrigin))}`;

async function join(page, url, name) {
    await page.route(/youtube\.com|ytimg|googlevideo/, (route) => route.abort());
    await page.route('https://www.youtube.com/iframe_api', (route) => route.fulfill({
        path: path.join(__dirname, 'support/fake-youtube.js'), contentType: 'text/javascript'
    }));
    await page.goto(url);
    await page.fill('[data-name]', name);
    await page.click('[data-enter]');
    await expect(page.locator('[data-room]')).toBeVisible();
}

test('late joiners reject replayed host actions older than their moderation snapshot', async ({ browser, page }) => {
    await join(page, roomUrl(), 'Host');
    await page.click('[data-lock]');
    await expect(page.locator('[data-lock]')).toHaveText('Unlock faces');
    await page.click('[data-lock]');
    await expect(page.locator('[data-lock]')).toHaveText('Lock faces');
    const oldUnlock = await page.evaluate(() => window.__hangout.av.mods.lock);
    await page.click('[data-lock]');
    await expect(page.locator('[data-lock]')).toHaveText('Unlock faces');
    const currentSeq = await page.evaluate(() => window.__hangout.av.mods.lock.body.seq);

    const guestContext = await browser.newContext();
    try {
        const guest = await guestContext.newPage();
        await join(guest, page.url(), 'Late guest');
        await expect.poll(() => guest.evaluate(() => window.__hangout.av.locked)).toBe(true);
        // A room member can copy a genuine old signature; snapshot state must establish
        // the replay floor just as a live host command does.
        await guest.evaluate((signed) => window.__hangoutSend(signed), oldUnlock);
        await page.evaluate((signed) => window.__hangoutSend(signed), oldUnlock);
        await expect.poll(() => guest.evaluate(() => window.__hangout.lastHostSeq)).toBeGreaterThanOrEqual(currentSeq);
        await expect.poll(() => guest.evaluate(() => window.__hangout.av.locked)).toBe(true);
        expect(await page.evaluate(() => window.__hangout.av.locked)).toBe(true);
    } finally {
        await guestContext.close();
    }
});

test('snapshot moderation ignores replayed mods older than the seq proof floor', async ({ browser, page }) => {
    await join(page, roomUrl(), 'Host');
    await page.click('[data-lock]');
    await expect(page.locator('[data-lock]')).toHaveText('Unlock faces');
    await page.click('[data-lock]');
    await expect(page.locator('[data-lock]')).toHaveText('Lock faces');
    const staleUnlock = await page.evaluate(() => window.__hangout.av.mods.lock);
    await page.click('[data-lock]');
    await expect(page.locator('[data-lock]')).toHaveText('Unlock faces');
    const floorSeq = await page.evaluate(() => window.__hangout.lastHostSeq);

    const guestContext = await browser.newContext();
    try {
        const guest = await guestContext.newPage();
        await join(guest, page.url(), 'Late guest');
        await expect.poll(() => guest.evaluate(() => window.__hangout.av.locked)).toBe(true);
        const lateId = await guest.evaluate(() => window.__hangout.myId);
        await guest.evaluate(() => {
            const app = window.__hangout;
            app.snapshotDone = false;
            app.snapshotFrom = null;
            app.snapshotHasSeqProof = false;
        });
        await page.evaluate(async ({ to, staleMod }) => {
            const app = window.__hangout;
            const body = { kind: 'seq', seq: app.lastHostSeq };
            const canonical = new TextEncoder().encode(JSON.stringify(body));
            const sig = new Uint8Array(await crypto.subtle.sign(
                { name: 'ECDSA', hash: 'SHA-256' },
                app.hostPriv,
                canonical
            ));
            const b64u = (bytes) => {
                let s = '';
                bytes.forEach((b) => { s += String.fromCharCode(b); });
                return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
            };
            const lastHostSeqSigned = { type: 'host', body, sig: b64u(sig) };
            const frame = await window.HangoutCore.seal(app.key, {
                type: 'snapshot',
                to,
                strokes: app.state.strokes.slice(-400),
                chat: app.state.chat.slice(-50),
                mods: [staleMod],
                lastHostSeqSigned,
                chunk: false,
                first: true,
                done: true
            });
            app.ws.send(JSON.stringify(frame));
        }, { to: lateId, staleMod: staleUnlock });
        await expect.poll(() => guest.evaluate(() => window.__hangout.lastHostSeq)).toBeGreaterThanOrEqual(floorSeq);
        await expect.poll(() => guest.evaluate(() => window.__hangout.av.locked)).toBe(true);
    } finally {
        await guestContext.close();
    }
});
