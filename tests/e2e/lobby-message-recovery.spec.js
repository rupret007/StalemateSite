// Real client, guest WebSockets and createLobby slow-mode policy. This does not
// replace server replies, advance its clock, or claim hosted identity readiness.
const { randomUUID } = require('node:crypto');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');
const ROOT = '/r/45662413410ed051/lobby/';
const FIRST = 'A first real lobby message';
const SECOND = 'Keep this second unsent sentence';

async function guest(browser, baseURL, relay, nick, width, { manualCopy = false } = {}) {
    const context = await browser.newContext({ viewport: { width, height: 667 }, permissions: ['local-network-access'] });
    await context.route('**/*', route => new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort());
    if (manualCopy) {
        // Tighten this document's native clipboard policy, without replacing
        // the clipboard function or changing any served product bytes.
        await context.route(url => url.pathname === ROOT, async route => {
            const response = await route.fetch();
            await route.fulfill({ response, headers: { ...response.headers(), 'permissions-policy': 'clipboard-write=()' } });
        });
        await context.addInitScript(() => {
            window.__heldMessageResults = []; window.__holdRefusal = true;
            window.__releaseRefusal = () => {
                window.__holdRefusal = false;
                const frames = window.__heldMessageResults.splice(0);
                for (const { socket, raw } of frames) socket.dispatchEvent(new MessageEvent('message', { data: raw }));
                return frames.length;
            };
            const NativeSocket = window.WebSocket;
            window.WebSocket = class extends NativeSocket {
                constructor(...args) {
                    super(...args);
                    this.addEventListener('message', event => {
                        const frame = JSON.parse(event.data);
                        if (!window.__holdRefusal || frame.t !== 'message-result' || frame.status !== 'rejected') return;
                        event.stopImmediatePropagation();
                        if (window.__heldMessageResults.length >= 1 || new TextEncoder().encode(event.data).byteLength > 1024) throw Error('Message-result fixture bound exceeded');
                        window.__heldMessageResults.push({ socket: this, raw: event.data });
                    });
                }
            };
        });
    }
    const page = await context.newPage(), errors = [], sends = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('websocket', socket => socket.on('framesent', event => {
        const frame = JSON.parse(event.payload.toString());
        if (frame.t !== 'say') return;
        if (sends.length >= 16) throw Error('Message-recovery fixture send bound exceeded');
        sends.push({ ch: frame.ch, text: frame.text });
    }));
    const url = new URL(ROOT, baseURL); url.searchParams.set('preview', 'local-preview-key-0001'); url.searchParams.set('relay', relay);
    await page.goto(url.href); await page.fill('[data-nick]', nick); await page.click('[data-enter]');
    await expect(page.locator('[data-connection]')).toHaveText('Connected');
    return { page, sends, async close() {
        try { if (manualCopy && !page.isClosed()) await page.evaluate(() => window.__releaseRefusal()); }
        finally { await context.close(); }
        expect(errors).toEqual([]);
    } };
}

for (const width of [375, 390]) test(`a real slow-mode refusal keeps the second draft recoverable at ${width}px`, async ({ browser, baseURL }, testInfo) => {
    const relay = hangoutRelayWsBase(baseURL, `message-recovery-${randomUUID()}`);
    const sender = await guest(browser, baseURL, relay, `Recovery${width}`, width);
    const reader = await guest(browser, baseURL, relay, `Witness${width}`, width);
    try {
        await sender.page.fill('[data-text]', FIRST); await sender.page.press('[data-text]', 'Enter');
        await expect(reader.page.locator('[data-buffer]')).toContainText(FIRST);
        await sender.page.fill('[data-text]', SECOND); await sender.page.press('[data-text]', 'Enter');
        // Reaching this real server notice establishes the policy refusal;
        // this test must not call a missing new UI hook its baseline failure.
        await expect(sender.page.locator('[data-buffer]')).toContainText('Slow mode: one line every 3s.');
        await expect(reader.page.locator('[data-buffer]')).not.toContainText(SECOND);
        const recoveryVisible = await sender.page.getByText(SECOND, { exact: true }).isVisible();
        const witness = { width, composer: await sender.page.inputValue('[data-text]'), recoveryVisible,
            actualSubmissions: sender.sends.filter(frame => frame.text === SECOND), secondDeliveredToPeer: false };
        console.log('MESSAGE_RECOVERY_SLOW_WITNESS', JSON.stringify(witness));
        await sender.page.screenshot({ path: testInfo.outputPath(`slow-refused-${width}.png`) });
        const geometry = await sender.page.evaluate(() => {
            const box = selector => { const b = document.querySelector(selector).getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
            return { viewport: innerWidth, height: innerHeight, pageWidth: document.documentElement.scrollWidth,
                composer: box('[data-say]'), transcript: box('[data-buffer]'), input: box('[data-text]'), inputFont: getComputedStyle(document.querySelector('[data-text]')).fontSize,
                send: box('[data-send]'), recovery: box('[data-message-recovery]'),
                recoveryOverflow: getComputedStyle(document.querySelector('[data-message-recovery]')).overflowY,
                actions: [...document.querySelectorAll('.saved-message-actions button')].map(control => {
                    const b = control.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
                }) };
        });
        console.log('MESSAGE_RECOVERY_GEOMETRY', JSON.stringify(geometry));
        expect(geometry.pageWidth).toBeLessThanOrEqual(width);
        expect(geometry.composer.bottom).toBeLessThanOrEqual(667); expect(geometry.composer.left).toBeGreaterThanOrEqual(0);
        expect(geometry.send.right).toBeLessThanOrEqual(width);
        expect(geometry.inputFont).toBe('16px'); expect(geometry.input.left).toBeGreaterThanOrEqual(0); expect(geometry.input.right).toBeLessThanOrEqual(width);
        expect(geometry.actions.every(action => action.left >= 0 && action.right <= width)).toBe(true);
        expect(geometry.recovery.bottom - geometry.recovery.top).toBeGreaterThanOrEqual(96);
        expect(geometry.transcript.bottom - geometry.transcript.top).toBeGreaterThanOrEqual(48);
        expect(geometry.recoveryOverflow).toBe('auto');
        expect(geometry.actions.every(action => action.top >= geometry.recovery.top && action.bottom <= geometry.recovery.bottom)).toBe(true);
        await expect(sender.page.getByRole('button', { name: 'Copy saved text', exact: true })).toBeVisible();
        await expect(sender.page.getByRole('button', { name: 'Discard saved copy', exact: true })).toBeVisible();
        expect(witness.composer === SECOND || witness.recoveryVisible,
            'The server refused the actual second line; its text must remain available to this visitor').toBe(true);
        if (witness.composer !== SECOND) {
            const recovery = sender.page.locator('[data-message-recovery]').filter({ hasText: SECOND });
            await recovery.getByRole('button', { name: 'Restore draft', exact: true }).click();
        }
        await expect(sender.page.locator('[data-text]')).toHaveValue(SECOND);
        await expect(sender.page.locator('[data-text]')).toBeFocused();
        expect(sender.sends.filter(frame => frame.text === SECOND)).toEqual([{ ch: '#stalemate', text: SECOND }]);
        await expect(reader.page.locator('[data-buffer]')).not.toContainText(SECOND);
    } finally {
        const cleanup = await Promise.allSettled([sender.close(), reader.close()]);
        for (const result of cleanup) if (result.status === 'rejected') throw result.reason;
    }
});

test('native manual-copy Escape returns focus after a genuine refusal redraw', async ({ browser, baseURL }, testInfo) => {
    const relay = hangoutRelayWsBase(baseURL, `message-dialog-${randomUUID()}`);
    const sender = await guest(browser, baseURL, relay, 'DialogGuest', 375, { manualCopy: true });
    try {
        await sender.page.fill('[data-text]', FIRST); await sender.page.press('[data-text]', 'Enter');
        await expect(sender.page.locator('[data-buffer]')).toContainText(FIRST);
        await sender.page.fill('[data-text]', SECOND); await sender.page.press('[data-text]', 'Enter');
        await expect(sender.page.locator('[data-buffer]')).toContainText('Slow mode: one line every 3s.');
        await expect.poll(() => sender.page.evaluate(() => window.__heldMessageResults.length)).toBe(1);
        const copy = sender.page.getByRole('button', { name: 'Copy saved text', exact: true });
        await expect(copy).toHaveCount(1); const originalOpener = await copy.elementHandle();
        await copy.click();
        await expect(sender.page.getByRole('dialog', { name: 'Copy saved text', exact: true })).toBeVisible();
        await expect(sender.page.locator('[data-message-copy-text]')).toHaveValue(SECOND);
        expect(await sender.page.evaluate(() => window.__releaseRefusal())).toBe(1);
        await expect.poll(() => originalOpener.evaluate(node => node.isConnected)).toBe(false);
        await sender.page.screenshot({ path: testInfo.outputPath('manual-copy-refusal-redraw-375.png') });
        await sender.page.keyboard.press('Escape');
        await expect(sender.page.locator('[data-message-copy]')).not.toBeVisible();
        await expect(copy).toBeFocused();
        expect(await sender.page.inputValue('[data-message-copy-text]')).toBe('');
        expect(sender.sends.filter(frame => frame.text === SECOND)).toEqual([{ ch: '#stalemate', text: SECOND }]);
        console.log('MESSAGE_RECOVERY_NATIVE_DIALOG', JSON.stringify({ width: 375, genuineHeldRefusalCount: 1, originalOpenerDetached: true,
            nativeEscapeClosed: true, focusOnLiveCopy: true, fallbackTextCleared: true, actualSecondSubmissions: 1 }));
    } finally { await sender.close(); }
});
