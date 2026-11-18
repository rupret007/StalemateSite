// Real private admission and three real clients use the production local relay.
// PM consent, peer quit and background-room closure use UI commands, not injected
// result frames or focus mocks. This is not live Cloudflare/hibernation proof.
const { test, expect } = require('@playwright/test');
const { writeFile } = require('node:fs/promises');
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
        let lobbyNow = Date.now();
        const community = await privateCommunity({ lobbyNow: () => lobbyNow }), contexts = [], sentinels = [], errors = [];
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
            // Simulate waiting in the lobby; retain the real PM eligibility gate.
            lobbyNow += 180000;
            const room = '#status-recovery';
            await send(host, '/join ' + room);
            await expect(host.locator('[data-chat-context]')).toHaveText(room);
            await send(sender, '/join ' + room);
            await expect(sender.locator('[data-chat-context]')).toHaveText(room);
            await send(sender, '/query StatusRecipient');
            await recipient.locator('[data-pmreqs]').getByRole('button', { name: 'Accept', exact: true }).press('Enter');
            await expect(sender.locator('[data-chat-context]')).toHaveText('PM · StatusRecipient');
            await expect(recipient.locator('[data-chat-context]')).toHaveText('PM · StatusSender');
            const input = sender.getByRole('textbox', { name: 'Message', exact: true });
            await input.fill(draft);
            await send(recipient, '/quit');
            await expect(recipient.locator('[data-connection]')).toHaveText('Offline');
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


for (const width of [375, 390, 1440]) test(`protected private draft choices survive their old deadline at ${width}px`, async ({ browser }, testInfo) => {
    const { privateCommunity } = await import('./helpers/private-community.mjs');
    let lobbyNow = Date.now();
    const community = await privateCommunity({ lobbyNow: () => lobbyNow }), contexts = [], sentinels = [], errors = [];
    const draft = 'An unsent private note stays mine until I choose.';
    let draftSent = 0;
    async function guest(nick, source) {
        const context = await browser.newContext({ ignoreHTTPSErrors: true, reducedMotion: 'reduce',
            viewport: { width, height: width === 375 ? 667 : width === 390 ? 844 : 900 } });
        contexts.push(context);
        await context.route('**/*', route => new URL(route.request().url()).origin === community.origin ? route.continue() : route.abort());
        sentinels.push(await installNoCaptureSentinel(context));
        const page = await context.newPage(); page.on('pageerror', error => errors.push(error.name));
        page.on('websocket', socket => socket.on('framesent', ({ payload }) => {
            try { const frame = JSON.parse(String(payload)); if (frame.t === 'say' && frame.text === draft) draftSent++; }
            catch { /* Observation only; no transport mutation. */ }
        }));
        await page.goto(community.origin + '/beta/?via=' + source + '#invite=' + community.invitation);
        await page.getByRole('link', { name: /Choose a nickname and join/ }).press('Enter');
        await page.getByRole('textbox', { name: 'Your nick', exact: true }).fill(nick);
        await expect(page.locator('[data-enter]')).toBeEnabled(); await page.locator('[data-enter]').press('Enter');
        await expect(page.locator('[data-connection]')).toHaveText('Connected');
        expect(new URL(page.url()).hash).toBe('');
        return page;
    }
    try {
        const [sender, recipient] = await Promise.all([guest('PatientSender', 'rad-dad'), guest('PatientPeer', 'stalemate')]);
        lobbyNow += 180000; // Keep the real two-minute PM eligibility policy.
        await send(sender, '/query PatientPeer');
        await recipient.locator('[data-pmreqs]').getByRole('button', { name: 'Accept', exact: true }).press('Enter');
        await expect(sender.locator('[data-chat-context]')).toHaveText('PM · PatientPeer');
        await expect(recipient.locator('[data-chat-context]')).toHaveText('PM · PatientSender');
        const input = sender.getByRole('textbox', { name: 'Message', exact: true });
        await input.fill(draft); await send(recipient, '/quit');
        await expect(recipient.locator('[data-connection]')).toHaveText('Offline');
        const notice = sender.locator('[data-toast]');
        await expect(notice).toContainText('Private replies are not confirmed. Your draft stays here.');
        await expect(input).toBeFocused();
        await sender.screenshot({ path: testInfo.outputPath(`00-draft-choices-before-deadline-${width}.png`) });
        // Cross the actual existing12s UI deadline. No fake browser clock or
        // injected close/result frames; transport and ACK timers remain real.
        await sender.waitForTimeout(12200);
        await sender.screenshot({ path: testInfo.outputPath(`01-draft-choices-after-deadline-${width}.png`) });
        await expect(notice).toBeVisible(); await expect(input).toBeFocused();
        await expect(input).toHaveValue(draft);
        for (const name of ['Copy draft', 'Discard draft', 'Keep draft']) {
            const action = notice.getByRole('button', { name, exact: true });
            await expect(action).toBeVisible();
            const rect = await action.boundingBox();
            expect(rect.width).toBeGreaterThanOrEqual(48); expect(rect.height).toBeGreaterThanOrEqual(48);
        }
        const keep = notice.getByRole('button', { name: 'Keep draft', exact: true });
        await tabTo(sender, keep); await expect(keep).toBeFocused(); await expect(keep).toBeInViewport({ ratio: 1 });
        expect(await keep.evaluate(node => { const r = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); })).toBe(true);
        for (const control of [input, sender.locator('[data-send]')]) {
            await expect(control).toBeInViewport({ ratio: 1 });
            expect(await control.evaluate(node => { const r = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); })).toBe(true);
        }
        await keep.press('Enter'); await expect(notice).toBeHidden(); await expect(input).toBeFocused();
        await expect(input).toHaveValue(draft); expect(draftSent).toBe(0);
        expect(await sender.evaluate(text => JSON.stringify({ ...localStorage, ...sessionStorage }).includes(text), draft)).toBe(false);
        expect(await sender.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await sender.screenshot({ path: testInfo.outputPath(`02-draft-kept-by-choice-${width}.png`) });
        for (const sentinel of sentinels) await sentinel.assertClean();
        expect(errors).toEqual([]);
    } finally {
        const closed = await Promise.allSettled(contexts.map(context => context.close()));
        await community.close();
        const failures = closed.filter(result => result.status === 'rejected').map(result => result.reason);
        if (failures.length) throw new AggregateError(failures, 'Draft-recovery contexts did not close');
    }
});

// PM-open frames are ordered within each socket, not between two browsers.
// A late recipient ACK can change its view between filling /quit and Enter.
for (const width of [390, 1440]) test(`protected PM recovery waits for recipient readiness across a late open at ${width}px`, async ({ browser }, testInfo) => {
    const { privateCommunity } = await import('./helpers/private-community.mjs');
    let lobbyNow = Date.now(), releaseRecipientOpen, quitWrites = 0;
    const community = await privateCommunity({ lobbyNow: () => lobbyNow }), contexts = [], sentinels = [], errors = [];
    async function guest(nick, holdOpen = false) {
        const context = await browser.newContext({ ignoreHTTPSErrors: true, reducedMotion: 'reduce',
            viewport: { width, height: width === 390 ? 844 : 900 } });
        contexts.push(context);
        await context.route('**/*', route => new URL(route.request().url()).origin === community.origin ? route.continue() : route.abort());
        sentinels.push(await installNoCaptureSentinel(context));
        const page = await context.newPage(); page.on('pageerror', error => errors.push(error.name));
        if (holdOpen) {
            page.on('websocket', socket => socket.on('framesent', ({ payload }) => {
                try { const frame = JSON.parse(String(payload)); if (frame.t === 'say' && frame.text === '/quit') quitWrites++; }
                catch { /* Observe commands only, never alter outgoing frames. */ }
            }));
            await page.routeWebSocket(url => url.pathname.endsWith('/lobby'), socket => {
                const server = socket.connectToServer(), pending = []; let holding = false, released = false;
                server.onMessage(raw => {
                    const frame = JSON.parse(String(raw));
                    if (!released && frame.t === 'pm-open' && frame.with === 'CausalSender') {
                        holding = true;
                        releaseRecipientOpen = () => {
                            released = true; holding = false;
                            for (const message of pending.splice(0)) socket.send(message);
                        };
                    }
                    if (holding) { expect(pending.length).toBeLessThan(128); pending.push(raw); }
                    else socket.send(raw);
                });
            });
        }
        await page.goto(community.origin + '/beta/#invite=' + community.invitation);
        await page.getByRole('link', { name: /Choose a nickname and join/ }).press('Enter');
        await page.getByRole('textbox', { name: 'Your nick', exact: true }).fill(nick);
        await expect(page.locator('[data-enter]')).toBeEnabled(); await page.locator('[data-enter]').press('Enter');
        await expect(page.locator('[data-connection]')).toHaveText('Connected');
        expect(new URL(page.url()).hash).toBe('');
        return page;
    }
    try {
        const sender = await guest('CausalSender'), recipient = await guest('CausalPeer', true);
        lobbyNow += 180000; // Preserve the real two-minute PM eligibility rule.
        await send(sender, '/query CausalPeer');
        await recipient.locator('[data-pmreqs]').getByRole('button', { name: 'Accept', exact: true }).press('Enter');
        await expect(sender.locator('[data-chat-context]')).toHaveText('PM · CausalPeer');
        await expect.poll(() => typeof releaseRecipientOpen).toBe('function');
        await expect(recipient.locator('[data-chat-context]')).toHaveText('#stalemate');
        const senderInput = sender.getByRole('textbox', { name: 'Message', exact: true });
        const recipientInput = recipient.getByRole('textbox', { name: 'Message', exact: true });
        const draft = 'This local draft still belongs to the original peer.';
        await senderInput.fill(draft); await recipientInput.fill('/quit');
        releaseRecipientOpen();
        await expect(recipient.locator('[data-chat-context]')).toHaveText('PM · CausalSender');
        await expect(recipientInput).toHaveValue(''); await recipientInput.press('Enter');
        expect(quitWrites).toBe(0);
        await expect(recipient.locator('[data-connection]')).toHaveText('Connected');
        await expect(sender.locator('[data-toast]')).toBeHidden(); await expect(senderInput).toHaveValue(draft);
        await recipient.screenshot({ path: testInfo.outputPath(`00-pm-late-open-no-quit-${width}.png`) });
        const selected = recipient.locator('[data-tabs] [aria-selected="true"]');
        await tabTo(recipient, selected); await recipient.keyboard.press('Home');
        await expect(recipient.locator('[data-chat-context]')).toHaveText('#stalemate');
        await expect(recipientInput).toHaveValue('/quit');
        await recipient.keyboard.press('ArrowRight');
        await expect(recipient.locator('[data-chat-context]')).toHaveText('PM · CausalSender');
        await expect(recipientInput).toHaveValue('');
        // Keep the same UI send helper; require this browser's own view to be ready.
        await send(recipient, '/quit');
        await expect(recipient.locator('[data-connection]')).toHaveText('Offline'); expect(quitWrites).toBe(1);
        const notice = sender.locator('[data-toast]');
        await expect(notice).toContainText('Private replies are not confirmed. Your draft stays here.');
        await expect(senderInput).toHaveValue(draft); await expect(senderInput).toBeFocused();
        await sender.screenshot({ path: testInfo.outputPath(`01-pm-ready-real-quit-${width}.png`) });
        const path = testInfo.outputPath(`pm-recipient-readiness-${width}.json`);
        await writeFile(path, JSON.stringify({ width, emptyEnterQuitWrites: 0, realReadyQuitWrites: quitWrites,
            lobbyCommandDraftPreserved: true, recipientOffline: true, senderDraftNotice: true }, null, 2));
        await testInfo.attach('pm-recipient-readiness', { path, contentType: 'application/json' });
        for (const sentinel of sentinels) await sentinel.assertClean();
        expect(errors).toEqual([]);
    } finally {
        const closed = await Promise.allSettled(contexts.map(context => context.close()));
        await community.close();
        const failures = closed.filter(result => result.status === 'rejected').map(result => result.reason);
        if (failures.length) throw new AggregateError(failures, 'PM-readiness contexts did not close');
    }
});
