// Real private admission and three real clients use the production local relay.
// PM consent, peer quit and background-room closure use UI commands, not injected
// result frames or focus mocks. This is not live Cloudflare/hibernation proof.
const { test, expect } = require('@playwright/test');
const { installNoCaptureSentinel } = require('./helpers/no-capture-sentinel.cjs');

async function tabTo(page, target) {
    await expect(target).toBeVisible();
    const option = process.platform === 'darwin' && page.context().browser()?.browserType().name() === 'webkit';
    for (let index = 0; index < 90; index++) {
        if (await target.evaluate(element => element === document.activeElement)) return;
        await page.keyboard.press(option ? 'Alt+Tab' : 'Tab');
    }
    throw new Error('The visible status action is not reachable by keyboard');
}
const send = async (page, text) => {
    const input = page.getByRole('textbox', { name: 'Message', exact: true });
    await input.fill(text); await input.press('Enter');
};

for (const width of [375, 390, 1440]) for (const mode of ['discard', 'replacement']) {
    test(`protected status action ${mode} keeps keyboard recovery at ${width}px`, async ({ browser }, testInfo) => {
        const { privateCommunity } = await import('./helpers/private-community.mjs');
        const community = await privateCommunity(), contexts = [], sentinels = [], errors = [];
        const draft = 'This unsent private draft stays with the original peer.';
        let draftSent = 0;
        async function guest(nickname, source) {
            const context = await browser.newContext({ ignoreHTTPSErrors: true, reducedMotion: 'reduce',
                viewport: { width, height: width === 375 ? 667 : width === 390 ? 844 : 900 } });
            contexts.push(context);
            await context.route('**/*', route => new URL(route.request().url()).origin === community.origin ? route.continue() : route.abort());
            sentinels.push(await installNoCaptureSentinel(context));
            const page = await context.newPage();
            page.on('pageerror', error => errors.push(error.name));
            page.on('websocket', socket => socket.on('framesent', ({ payload }) => {
                try { const frame = JSON.parse(String(payload)); if (frame.t === 'say' && frame.text === draft) draftSent++; }
                catch { /* Non-JSON transport data is outside this observation. */ }
            }));
            await page.goto(community.origin + '/beta/?via=' + source + '#invite=' + community.invitation);
            await page.getByRole('link', { name: /Choose a nickname and join/ }).press('Enter');
            await page.getByRole('textbox', { name: 'Your nick', exact: true }).fill(nickname);
            await expect(page.locator('[data-enter]')).toBeEnabled(); await page.locator('[data-enter]').press('Enter');
            await expect(page.locator('[data-connection]')).toHaveText('Connected');
            expect(new URL(page.url()).hash).toBe('');
            return page;
        }
        try {
            const host = await guest('StatusHost', 'stalemate');
            const sender = await guest('StatusSender', 'rad-dad');
            const recipient = await guest('StatusRecipient', 'stalemate');
            const room = '#status-recovery';
            await send(host, '/join ' + room);
            await expect(host.locator('[data-chat-context]')).toHaveText(room);
            await send(sender, '/join ' + room);
            await expect(sender.locator('[data-chat-context]')).toHaveText(room);
            await send(sender, '/query StatusRecipient');
            await recipient.locator('[data-pmreqs]').getByRole('button', { name: 'Accept', exact: true }).press('Enter');
            await expect(sender.locator('[data-chat-context]')).toHaveText('PM · StatusRecipient');
            const input = sender.getByRole('textbox', { name: 'Message', exact: true });
            await input.fill(draft);
            await send(recipient, '/quit');
            const status = sender.locator('[data-toast]');
            const discard = status.getByRole('button', { name: 'Discard draft', exact: true });
            await tabTo(sender, discard); await expect(discard).toBeFocused();
            await expect(input).toHaveValue(draft);
            await sender.screenshot({ path: testInfo.outputPath(`00-status-action-${mode}-${width}.png`) });
            if (mode === 'discard') {
                await discard.press('Enter');
                await sender.screenshot({ path: testInfo.outputPath(`01-status-after-discard-${width}.png`) });
                await expect(status).toBeHidden(); await expect(input).toHaveValue('');
                await expect(input).toBeFocused();
            } else {
                // Another participant closes a background room while the guest
                // is reading the private draft's focused recovery action.
                await send(host, '/close');
                await expect(status).toContainText(room + ' was closed by the host');
                await sender.screenshot({ path: testInfo.outputPath(`01-status-after-replacement-${width}.png`) });
                await expect(discard).toHaveCount(0); await expect(status).toBeFocused();
                await expect(input).toHaveValue(draft);
                await expect(host.locator('[data-buffer]')).not.toContainText(draft);
                await tabTo(sender, input); await expect(input).toBeFocused();
            }
            await expect(sender.locator('[data-chat-context]')).toHaveText('PM · StatusRecipient');
            expect(draftSent).toBe(0);
            await expect(input).toBeInViewport({ ratio: 1 });
            expect(await sender.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
            await sender.screenshot({ path: testInfo.outputPath(`02-status-keyboard-recovered-${mode}-${width}.png`) });
            for (const sentinel of sentinels) await sentinel.assertClean();
            expect(errors).toEqual([]);
        } finally {
            for (const context of contexts) await context.close();
            await community.close();
        }
    });
}
