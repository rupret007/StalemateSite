// Actual browser/client/loopback-engine journeys. The deliberately labelled HTTP
// callback and existing devowner adapter simulate verified identity only. They
// do not qualify Cloudflare Access, email delivery, beta cookies or revocation.
const { randomUUID } = require('node:crypto');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const ROOT = '/r/45662413410ed051/lobby/';
const PREVIEW = 'local-preview-key-0001';
const INTENT = 'hangout-return-room';
test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium local identity composition');

async function scenario(browser, baseURL, width, { expired = false } = {}) {
    const contexts = [], errors = [];
    const relay = hangoutRelayWsBase(baseURL, `shared-community-keep-${randomUUID()}`);
    const signin = new URL(`${relay.replace(/^ws/, 'http')}/lobby-owner/login`);
    const returned = new URL(ROOT, baseURL);
    returned.searchParams.set('owner', '1'); returned.searchParams.set('entry-return', '1');
    const source = width === 375 ? 'stalemate' : 'rad-dad';
    async function guest(nickname, via) {
        const context = await browser.newContext({ viewport: { width, height: 667 } }); contexts.push(context);
        await context.route('**/*', route => new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort());
        // The expiry variant supplies an old stored timestamp at the synthetic
        // callback. It does not change product clocks or claim ten elapsed minutes.
        await context.route(url => url.pathname === signin.pathname, route => route.fulfill({
            contentType: 'text/html; charset=utf-8',
            body: `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local verification fixture</title><h1>Local verified-identity fixture</h1><p>This button simulates verification; no email is sent.</p><button id="finish">Finish fixture verification</button><script>document.querySelector('#finish').onclick=()=>{${expired ? `const key=${JSON.stringify(INTENT)},value=JSON.parse(sessionStorage.getItem(key));value.at=Date.now()-600000;sessionStorage.setItem(key,JSON.stringify(value));` : ''}sessionStorage.setItem('keep-test-verified','1');location.assign(${JSON.stringify(returned.href)});};</script></html>`
        }));
        await context.addInitScript(() => {
            window.__keepSent = []; window.__captureCalls = 0;
            window.__keepHeldReplies = []; window.__keepHeldReplyBytes = 0;
            window.__releaseKeepReplies = () => {
                window.__keepHoldReply = false;
                const replies = window.__keepHeldReplies.splice(0); window.__keepHeldReplyBytes = 0;
                for (const { socket, raw } of replies) socket.dispatchEvent(new MessageEvent('message', { data: raw }));
            };
            if (navigator.mediaDevices?.getUserMedia) {
                const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
                navigator.mediaDevices.getUserMedia = (...args) => { window.__captureCalls++; return capture(...args); };
            }
            const NativeSocket = window.WebSocket;
            window.WebSocket = class extends NativeSocket {
                constructor(address, protocols) {
                    const target = new URL(address);
                    if (target.pathname.endsWith('/lobby-owner') && sessionStorage.getItem('keep-test-verified') === '1') {
                        target.searchParams.set('devowner', 'local-dev-admin-key-0001');
                        target.searchParams.set('account', 'keep-fixture@example.test');
                    }
                    super(target.href, protocols);
                    this.addEventListener('message', event => {
                        let frame; try { frame = JSON.parse(event.data); } catch { return; }
                        // Hold only a genuine current-room registration reply;
                        // the independent witness still observes its real result.
                        if (!window.__keepHoldReply || frame.t !== 'chan' || !frame.ch?.persistent || frame.ch.keepRef !== window.__keepExpectedRef) return;
                        event.stopImmediatePropagation();
                        const bytes = new TextEncoder().encode(event.data).byteLength;
                        if (window.__keepHeldReplies.length >= 4 || window.__keepHeldReplyBytes + bytes > 16384) throw Error('Keep reply fixture bound exceeded');
                        window.__keepHeldReplies.push({ socket: this, raw: event.data }); window.__keepHeldReplyBytes += bytes;
                    });
                }
                send(raw) {
                    try {
                        const frame = JSON.parse(raw);
                        if (frame.t === 'cmd') window.__keepSent.push({ name: frame.name, args: frame.args, ch: frame.ch, roomInstance: frame.roomInstance });
                    } catch { /* Only bounded command metadata is retained by this test. */ }
                    return super.send(raw);
                }
            };
        });
        const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
        const url = new URL(ROOT, baseURL);
        url.searchParams.set('preview', PREVIEW); url.searchParams.set('relay', relay); url.searchParams.set('via', via);
        await page.goto(url.href); await enter(page, nickname);
        return page;
    }
    const host = await guest(`KeepHost${width}`, source), witness = await guest(`StayGuest${width}`, source === 'stalemate' ? 'rad-dad' : 'stalemate');
    const room = `#art-keep-${width}`;
    await command(host, `/join ${room}`); await expect(host.locator('[data-chat-context]')).toHaveText(room);
    await command(witness, `/join ${room}`); await expect(witness.locator('[data-chat-context]')).toHaveText(room);
    const ref = await host.evaluate(room => window.__lobby.chans.get(room).keepRef, room); expect(ref).toMatch(/^[a-f0-9]{32}$/);
    const device = await host.evaluate(() => localStorage.getItem('hangout-dev'));
    await host.click('nav [data-show="people"]'); await host.locator('[data-entry-share]:visible').uncheck();
    await expect.poll(() => witness.evaluate(nickname => window.__lobby.chans.get(window.__lobby.active).names.find(person => person.nick === nickname)?.entrySource, `KeepHost${width}`)).toBe('');
    await host.click('nav [data-show="chat"]');
    return {
        host, witness, room, ref, source, device,
        async begin() {
            await host.click('[data-roomtools]'); await host.getByRole('button', { name: 'Keep this room', exact: true }).click();
            await expect(host.getByRole('heading', { name: 'Local verified-identity fixture' })).toBeVisible();
            const saved = await host.evaluate(() => ({ intent: JSON.parse(sessionStorage.getItem('hangout-return-room')), entry: JSON.parse(sessionStorage.getItem('hangout-entry-handoff')) }));
            expect(saved.intent).toMatchObject({ v: 1, room, ref }); expect(saved.entry).toMatchObject({ source, share: false });
            await expect.poll(() => witness.evaluate(nickname => window.__lobby.chans.get(window.__lobby.active).names.some(person => person.nick === nickname), `KeepHost${width}`)).toBe(false);
        },
        async finish() {
            await host.getByRole('button', { name: 'Finish fixture verification' }).click();
            await expect(host.locator('[data-gate]')).toBeVisible(); await enter(host, `KeepHost${width}`);
            expect(await host.evaluate(() => window.__lobby.verified)).toBe(true);
            expect(await host.evaluate(() => localStorage.getItem('hangout-dev'))).toBe(device);
            expect(await host.evaluate(() => sessionStorage.getItem('hangout-return-room'))).toBeNull();
            expect(await host.evaluate(() => window.__lobby.capabilities.moderate)).toBe(false);
            expect(await host.evaluate(() => window.__captureCalls)).toBe(0);
        },
        async grantWitness() {
            await host.click('[data-roomtools]'); host.once('dialog', dialog => dialog.accept(`StayGuest${width}`));
            await host.getByRole('button', { name: 'Add guest co-host', exact: true }).click();
            await expect(witness.locator('[data-roomtools]')).toBeVisible();
        },
        async close() {
            await Promise.allSettled(contexts.flatMap(context => context.pages()).map(page => page.evaluate(() => window.__releaseKeepReplies?.())));
            await Promise.allSettled(contexts.map(context => context.close())); expect(errors).toEqual([]);
        }
    };
}
async function enter(page, nickname) {
    await page.fill('[data-nick]', nickname); await page.click('[data-enter]');
    await expect(page.locator('[data-connection]')).toHaveText('Connected');
}
async function command(page, text) {
    await page.click('nav [data-show="chat"]'); await page.fill('[data-text]', text); await page.press('[data-text]', 'Enter');
}
const kept = (page, room) => page.evaluate(room => window.__lobby.chans.get(room)?.persistent === true, room);

for (const width of [375, 390]) test(`verified Keep return preserves the hidden entrance and requires confirmation at ${width}px`, async ({ browser, baseURL }, testInfo) => {
    testInfo.annotations.push({ type: 'identity-scope', description: 'Explicit local verification callback/devowner identity; actual client, signed device token, WebSocket and Lobby engine. No real email/Access/beta-session claim.' });
    const app = await scenario(browser, baseURL, width);
    try {
        await command(app.host, 'This earlier connected-session line must not replay');
        await expect(app.witness.locator('[data-buffer]')).toContainText('This earlier connected-session line must not replay');
        await app.begin(); await app.finish();
        await expect(app.host.locator('[data-chat-context]')).toHaveText(app.room);
        const prompt = app.host.getByRole('region', { name: 'Keep this room', exact: true });
        await expect(prompt).toBeVisible(); await expect(prompt).toContainText(`Email verified. Keep ${app.room}`);
        expect(await kept(app.host, app.room)).toBe(false); expect(await kept(app.witness, app.room)).toBe(false);
        expect(await app.host.evaluate(() => window.__keepSent.filter(frame => frame.name === 'register'))).toEqual([]);
        expect(await app.host.evaluate(() => window.__keepSent.find(frame => frame.name === 'join'))).toMatchObject({ args: [app.room], roomInstance: app.ref });
        await expect(app.host.locator('[data-buffer]')).not.toContainText('This earlier connected-session line must not replay');
        await expect.poll(() => app.witness.evaluate(nickname => window.__lobby.chans.get(window.__lobby.active).names.find(person => person.nick === nickname)?.entrySource, `KeepHost${width}`)).toBe('');
        await app.host.click('nav [data-show="people"]'); await expect(app.host.locator('[data-entry-share]:visible')).not.toBeChecked();
        await app.host.click('nav [data-show="chat"]');
        const geometry = await app.host.evaluate(() => {
            const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
            return { width: innerWidth, height: innerHeight, pageWidth: document.documentElement.scrollWidth, prompt: box('[data-keep-prompt]'),
                accept: box('[data-keep-accept]'), input: box('[data-text]'), send: box('[data-send]'), nav: box('nav.phonetabs'), captures: window.__captureCalls };
        });
        console.log('Keep confirmation geometry', JSON.stringify(geometry));
        await testInfo.attach(`keep-confirmation-${width}`, { body: JSON.stringify(geometry, null, 2), contentType: 'application/json' });
        await app.host.screenshot({ path: testInfo.outputPath(`keep-confirmation-${width}.png`), fullPage: true });
        for (const box of [geometry.prompt, geometry.accept, geometry.input, geometry.send]) {
            expect(box.left).toBeGreaterThanOrEqual(0); expect(box.right).toBeLessThanOrEqual(width + 1);
            expect(box.top).toBeGreaterThanOrEqual(0); expect(box.bottom).toBeLessThanOrEqual(geometry.nav.top + 1);
        }
        expect(geometry.pageWidth).toBeLessThanOrEqual(width + 1); expect(geometry.captures).toBe(0);
        await app.host.evaluate(ref => { window.__keepExpectedRef = ref; window.__keepHoldReply = true; }, app.ref);
        const accept = prompt.getByRole('button', { name: 'Keep this room', exact: true });
        await accept.focus(); await app.host.keyboard.press('Enter');
        await expect.poll(() => kept(app.witness, app.room)).toBe(true);
        await expect(accept).toBeDisabled(); await expect(prompt.getByRole('button', { name: 'Not now', exact: true })).toBeDisabled();
        await expect(prompt).toBeFocused();
        await expect.poll(() => app.host.evaluate(() => window.__keepHeldReplies.length)).toBeGreaterThan(0);
        expect(await kept(app.host, app.room)).toBe(false);
        // A later confirmation must preserve a visitor's deliberate focus move.
        if (width === 390) await app.host.locator('[data-text]').focus();
        await app.host.evaluate(() => window.__releaseKeepReplies());
        await expect(prompt).toBeHidden(); await expect(app.host.locator('[data-host-status]')).toContainText('Registered');
        await expect(app.host.locator(width === 375 ? '[data-roomtools]' : '[data-text]')).toBeFocused();
        expect(await app.host.evaluate(() => window.__keepSent.filter(frame => frame.name === 'register'))).toEqual([{ name: 'register', args: [], ch: app.room, roomInstance: app.ref }]);
        expect(await app.host.evaluate(room => window.__lobby.chans.get(room).names.find(person => person.nick === window.__lobby.me).owner, app.room)).toBe(true);
        await command(app.host, 'The verified return still hides my entrance');
        const received = app.witness.locator('[data-buffer] li[data-id]').filter({ hasText: 'The verified return still hides my entrance' });
        await expect(received).toHaveCount(1); await expect(received.locator('.entry-badge')).toHaveCount(0);
        expect(await app.host.evaluate(() => window.__captureCalls)).toBe(0);
    } finally { await app.close(); }
});

test('canceling a verified Keep return consumes the intent without registration or replay', async ({ browser, baseURL }) => {
    const app = await scenario(browser, baseURL, 375);
    try {
        await app.begin(); await app.finish(); await expect(app.host.locator('[data-keep-prompt]')).toBeVisible();
        await app.host.getByRole('button', { name: 'Not now', exact: true }).click();
        await expect(app.host.locator('[data-keep-prompt]')).toBeHidden(); expect(await kept(app.witness, app.room)).toBe(false);
        await expect(app.host.locator('[data-roomtools]')).toBeFocused();
        await app.host.reload(); await enter(app.host, 'KeepHost375');
        await expect(app.host.locator('[data-chat-context]')).toHaveText('#stalemate');
        await expect(app.host.locator('[data-keep-prompt]')).toBeHidden();
        expect(await app.host.evaluate(() => window.__keepSent.filter(frame => ['join', 'register'].includes(frame.name)))).toEqual([]);
        expect(await kept(app.witness, app.room)).toBe(false);
    } finally { await app.close(); }
});

test('a return whose stored timestamp expired during verification cannot rejoin or register', async ({ browser, baseURL }) => {
    const app = await scenario(browser, baseURL, 390, { expired: true });
    try {
        await app.begin(); await app.finish();
        await expect(app.host.locator('[data-chat-context]')).toHaveText('#stalemate');
        await expect(app.host.locator('[data-keep-prompt]')).toBeHidden();
        expect(await app.host.evaluate(() => window.__keepSent.filter(frame => ['join', 'register'].includes(frame.name)))).toEqual([]);
        expect(await kept(app.witness, app.room)).toBe(false);
    } finally { await app.close(); }
});

test('a closed and recreated room refuses the original return instance', async ({ browser, baseURL }) => {
    const app = await scenario(browser, baseURL, 375);
    try {
        await app.grantWitness(); await app.begin();
        await app.witness.click('[data-roomtools]'); app.witness.once('dialog', dialog => dialog.accept());
        await app.witness.getByRole('button', { name: 'Close room', exact: true }).click();
        await expect(app.witness.locator('[data-chat-context]')).toHaveText('#stalemate');
        await command(app.witness, `/join ${app.room}`); await expect(app.witness.locator('[data-chat-context]')).toHaveText(app.room);
        expect(await app.witness.evaluate(room => window.__lobby.chans.get(room).keepRef, app.room)).not.toBe(app.ref);
        await app.finish(); await expect(app.host.locator('[data-buffer]')).toContainText('That room changed or closed while you signed in.');
        await expect(app.host.locator('[data-chat-context]')).toHaveText('#stalemate');
        await expect(app.host.locator('[data-keep-prompt]')).toBeHidden();
        expect(await app.host.evaluate(() => window.__keepSent.filter(frame => frame.name === 'register'))).toEqual([]);
        expect(await kept(app.witness, app.room)).toBe(false);
    } finally { await app.close(); }
});

test('lost host controls retire the pending Keep confirmation without registering', async ({ browser, baseURL }) => {
    const app = await scenario(browser, baseURL, 390);
    try {
        await app.grantWitness(); await app.begin(); await app.finish();
        await expect(app.host.locator('[data-keep-prompt]')).toBeVisible();
        await command(app.witness, '/deop KeepHost390');
        await expect(app.host.locator('[data-keep-prompt]')).toBeHidden(); await expect(app.host.locator('[data-roomtools]')).toBeHidden();
        expect(await app.host.evaluate(() => window.__lobby.verified)).toBe(true);
        expect(await app.host.evaluate(() => window.__keepSent.filter(frame => frame.name === 'register'))).toEqual([]);
        expect(await kept(app.witness, app.room)).toBe(false);
    } finally { await app.close(); }
});
