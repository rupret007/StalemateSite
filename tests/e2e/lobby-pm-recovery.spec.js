// Two real clients use the production engine via an explicit WebSocket fixture.
// Recreating that engine simulates a wake with the same exact live socket identities.
const { test, expect } = require('@playwright/test');
const { writeFile } = require('node:fs/promises');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

test.skip(({ browserName }) => browserName !== 'chromium', 'PM recovery fixture uses Chromium.');

async function community(browser, baseURL, { privateContextFeature = 1, privatePeerFeature = 1, personTargetFeature = 1 } = {}) {
    const { createLobby } = await import('../../hangout-worker/src/lobby-core.mjs');
    let now = 1800000000000, engine, sequence = 0, advertisedFeature = privateContextFeature;
    const sockets = new Map(), identities = new Map(), contexts = [], inbound = [], delivered = [], held = [];
    let holdDelivery = () => false;
    const boot = () => { engine = createLobby({ now: () => now, send: (id, frame) => {
        const output = structuredClone(frame);
        if (output.t === 'hello') {
            output.features = { ...output.features };
            if (advertisedFeature === undefined) delete output.features.privateMessageContext;
            else output.features.privateMessageContext = advertisedFeature;
            if (privatePeerFeature === null) delete output.features.privateMessagePeers;
            else output.features.privateMessagePeers = privatePeerFeature;
            if (personTargetFeature === null) delete output.features.personTargets;
            else output.features.personTargets = personTargetFeature;
        }
        delivered.push({ recipient: id, ...output });
        if (holdDelivery(id, output)) held.push({ id, output });
        else sockets.get(id)?.send(JSON.stringify(output));
    }, limits: { defaultSlow: 0 } }); };
    boot();
    const guest = async (nick, options = {}) => {
        const context = await browser.newContext(options); contexts.push(context); const page = await context.newPage();
        await context.route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL).origin ? route.continue() : route.abort());
        await page.routeWebSocket((url) => url.pathname.endsWith('/lobby'), (ws) => {
            const identity = { id: `socket-${nick}-${++sequence}`, dev: `device-${nick}`, iph: `ip-${nick}`, role: 'fan', admin: false, account: '' };
            identities.set(identity.id, identity); sockets.set(identity.id, ws);
            ws.onMessage((raw) => { inbound.push({ sender: identity.id, ...JSON.parse(String(raw)) }); void engine.message(identity.id, String(raw)); });
            ws.onClose(() => { identities.delete(identity.id); sockets.delete(identity.id); engine.disconnect(identity.id); });
            engine.connect(identity);
        });
        const relay = hangoutRelayWsBase(baseURL, 'pm-wake-fixture');
        await page.goto(`/r/45662413410ed051/lobby/?preview=local-preview-key-0001&relay=${encodeURIComponent(relay)}`);
        await page.fill('[data-nick]', nick); await page.click('[data-enter]');
        await expect(page.locator('[data-connection]')).toHaveText('Connected'); return page;
    };
    return {
        guest, inbound, delivered, advertise: feature => { advertisedFeature = feature; },
        hold: predicate => { holdDelivery = predicate; },
        release: () => { holdDelivery = () => false; for (const { id, output } of held.splice(0)) sockets.get(id)?.send(JSON.stringify(output)); },
        releaseNext: predicate => { const index = held.findIndex(({ id, output }) => predicate(id, output)); if (index < 0) return false; const [{ id, output }] = held.splice(index, 1); sockets.get(id)?.send(JSON.stringify(output)); return true; },
        advance: (ms) => { now += ms; }, tick: () => engine.tick(),
        disconnect: (nick, code = 1012) => {
            const identity = [...identities.values()].find(item => item.dev === `device-${nick}`);
            const socket = sockets.get(identity.id);
            engine.disconnect(identity.id); identities.delete(identity.id); sockets.delete(identity.id);
            socket.close({ code, reason: 'Explicit protocol-version reconnect fixture' });
        },
        wake: () => {
            const snapshot = structuredClone({ net: engine.snapshot(), rooms: engine.roomSnapshot(), abuse: engine.abuseSnapshot(), sessions: engine.sessionSnapshot() });
            now += 61000; boot(); engine.restore(snapshot.net); engine.restoreRooms(snapshot.rooms); engine.restoreAbuse(snapshot.abuse);
            const result = engine.restoreSessions(snapshot.sessions, [...identities.values()]); expect(result.rejected).toEqual([]); return snapshot;
        },
        close: () => Promise.all(contexts.map((context) => context.close()))
    };
}

const send = async (page, text) => { await page.fill('[data-text]', text); await page.press('[data-text]', 'Enter'); };
const received = (page, text) => page.locator('[data-buffer] li[data-id]').filter({ hasText: text });
async function accept(sender, recipient) {
    await send(sender, '/query Recipient');
    await recipient.locator('[data-pmreqs]').getByRole('button', { name: 'Accept', exact: true }).click();
    await expect(sender.locator('[data-chat-context]')).toHaveText('PM · Recipient');
    await expect(recipient.locator('[data-chat-context]')).toHaveText('PM · Sender');
}

test('an existing PM Accept button survives wake and explains that unsaved first text must be resent', async ({ browser, baseURL }) => {
    const fixture = await community(browser, baseURL);
    try {
        const sender = await fixture.guest('Sender'); const recipient = await fixture.guest('Recipient'); fixture.advance(180000);
        await send(sender, '/msg Recipient A first sentence not retained on the server');
        const accept = recipient.locator('[data-pmreqs]').getByRole('button', { name: 'Accept', exact: true });
        await expect(accept).toBeVisible(); await accept.evaluate((button) => { button.dataset.originalPrompt = 'yes'; });
        const snapshot = fixture.wake(); expect(JSON.stringify(snapshot.sessions)).not.toContain('A first sentence');
        await expect(accept).toHaveAttribute('data-original-prompt', 'yes'); await accept.click();
        for (const page of [sender, recipient]) {
            await expect(page.locator('[data-chat-context]')).toHaveText(page === sender ? 'PM · Recipient' : 'PM · Sender');
            await expect(page.locator('[data-topic]')).toContainText('not end-to-end encrypted');
            await expect(page.locator('[data-topic]')).toContainText('report shares selected text');
            await expect(page.locator('[data-topic]')).not.toContainText('· filtered ·');
            await expect(page.locator('[data-buffer]')).toContainText('first message was not retained');
            await expect(page.locator('[data-buffer]')).not.toContainText('A first sentence');
            await expect(page.locator('[data-connection]')).toHaveText('Connected');
        }
        const complete = 'The sender explicitly resends this complete private sentence after acceptance';
        await send(sender, complete);
        await expect(recipient.locator('[data-buffer]')).toContainText(complete);
    } finally { await fixture.close(); }
});

test('a pending PM expiry clears its visible prompt and offers no old message replay', async ({ browser, baseURL }) => {
    const fixture = await community(browser, baseURL);
    try {
        const sender = await fixture.guest('Sender'); const recipient = await fixture.guest('Recipient'); fixture.advance(180000);
        await send(sender, '/msg Recipient This pending sentence must remain private');
        await expect(recipient.locator('[data-pmreqs] .req')).toHaveCount(1);
        fixture.advance(10 * 60000); await fixture.tick();
        await expect(recipient.locator('[data-pmreqs] .req')).toHaveCount(0);
        await expect(sender.locator('[data-buffer]')).toContainText('PM request to Recipient cleared');
        await expect(recipient.locator('[data-buffer]')).not.toContainText('pending sentence');
    } finally { await fixture.close(); }
});

test('long private text, escaped slashes and typed or quick actions never fall through to the shared lobby', async ({ browser, baseURL }, testInfo) => {
    const fixture = await community(browser, baseURL);
    try {
        const sender = await fixture.guest('Sender', { viewport: { width: 390, height: 844 } });
        const recipient = await fixture.guest('Recipient'); const observer = await fixture.guest('Observer');
        fixture.advance(180000); await accept(sender, recipient);
        const complete = 'Our entire private sentence should arrive with every word after the seventh';
        await send(sender, complete); await expect(received(recipient, complete)).toHaveCount(1);
        fixture.advance(4000);
        const literal = '/This literal slash stays between the two accepted participants';
        await send(sender, `/${literal}`); await expect(received(recipient, literal)).toHaveCount(1);
        fixture.advance(4000);
        const action = 'keeps the complete private action between the two participants';
        await send(sender, `/me ${action}`); await expect(received(recipient, action)).toContainText('* Sender');
        fixture.advance(4000); await sender.click('[data-quick-me]');
        await expect(received(recipient, 'moshes')).toContainText('* Sender');
        fixture.advance(4000); await sender.click('[data-quick-cmd="slap"]');
        await expect(received(recipient, 'slaps Recipient around a bit with a large trout')).toContainText('* Sender');
        fixture.advance(4000); await sender.click('[data-quick-line="🤘 SHRED"]');
        await expect(received(recipient, '🤘 SHRED')).toHaveCount(1);
        expect(fixture.delivered.filter(frame => frame.t === 'line')).toEqual([]);
        expect(fixture.delivered.filter(frame => frame.recipient.startsWith('socket-Observer-') && frame.t === 'pm')).toEqual([]);
        for (const text of [complete, literal, action, 'moshes', 'large trout', '🤘 SHRED'])
            await expect(observer.locator('[data-buffer]')).not.toContainText(text);
        await expect(sender.locator('[data-topic]')).toContainText('not end-to-end encrypted');
        const geometry = await sender.evaluate(() => {
            const input = document.querySelector('[data-text]'), send = document.querySelector('[data-say] button[type="submit"]');
            const inputBox = input.getBoundingClientRect(), sendBox = send.getBoundingClientRect();
            return { viewport: innerWidth, page: document.documentElement.scrollWidth, inputLeft: inputBox.left,
                inputRight: inputBox.right, sendLeft: sendBox.left, sendRight: sendBox.right,
                sendBottom: sendBox.bottom, height: innerHeight, fontSize: getComputedStyle(input).fontSize };
        });
        expect(geometry.page).toBeLessThanOrEqual(geometry.viewport);
        expect(geometry.inputLeft).toBeGreaterThanOrEqual(0); expect(geometry.inputRight).toBeLessThanOrEqual(390);
        expect(geometry.sendLeft).toBeGreaterThanOrEqual(0); expect(geometry.sendRight).toBeLessThanOrEqual(390);
        expect(geometry.sendBottom).toBeLessThanOrEqual(geometry.height); expect(geometry.fontSize).toBe('16px');
        await testInfo.attach('pm-composer-geometry-390', { body: JSON.stringify(geometry, null, 2), contentType: 'application/json' });
        await sender.screenshot({ path: testInfo.outputPath('private-text-actions-390.png'), fullPage: true });
        fixture.advance(4000); await send(sender, '/help');
        await expect(sender.locator('[data-buffer]')).toContainText('Everyone: /join');
        fixture.advance(4000); const explicit = 'An explicitly addressed private message still works from its private tab';
        await send(sender, `/msg Recipient ${explicit}`); await expect(received(recipient, explicit)).toHaveCount(1);
        fixture.advance(4000); await send(sender, '/join #intentional-channel');
        await expect(sender.locator('[data-chat-context]')).toHaveText('#intentional-channel');
        fixture.advance(4000); const publicText = 'This line is intentionally sent after selecting the channel';
        await send(sender, publicText); await expect(received(sender, publicText)).toHaveCount(1);
        await expect(observer.locator('[data-buffer]')).not.toContainText(publicText);
    } finally { await fixture.close(); }
});

for (const [label, feature] of [['missing', null], ['a string', '1'], ['a boolean', true]])
    test(`without a numeric private-context capability (${label}), PM actions preserve drafts and ordinary PMs still work`, async ({ browser, baseURL }) => {
        // null is converted to a genuinely missing property by this fixture.
        const fixture = await community(browser, baseURL, { privateContextFeature: feature === null ? null : feature });
        if (feature === null) fixture.advertise(undefined);
        try {
            const sender = await fixture.guest('Sender'); const recipient = await fixture.guest('Recipient');
            const observer = await fixture.guest('Observer'); fixture.advance(180000); await accept(sender, recipient);
            const before = fixture.inbound.length;
            const draft = '/me this private draft must never become a lobby action';
            await send(sender, draft);
            await expect(sender.locator('[data-text]')).toHaveValue(draft);
            await expect(sender.locator('[data-toast]')).toContainText('unavailable in private chat');
            await sender.click('[data-quick-me]'); await sender.click('[data-quick-cmd="slap"]');
            await palettePrompt(sender, '/me', 'A menu action must respect the same private-context capability');
            await expect(sender.locator('[data-text]')).toHaveValue(draft);
            expect(fixture.inbound).toHaveLength(before);
            expect(fixture.delivered.some(frame => frame.t === 'line')).toBe(false);
            const normal = 'A complete ordinary private sentence remains usable on the older server';
            fixture.advance(4000); await send(sender, normal); await expect(received(recipient, normal)).toHaveCount(1);
            fixture.advance(4000); await send(sender, '//A private escaped slash also remains usable');
            await expect(received(recipient, '/A private escaped slash also remains usable')).toHaveCount(1);
            await expect(observer.locator('[data-buffer]')).not.toContainText(normal);
            fixture.advance(4000); await send(sender, '/help');
            await expect(sender.locator('[data-buffer]')).toContainText('Everyone: /join');
        } finally { await fixture.close(); }
    });

test('a PM person sheet kept open across nickname reuse blocks the original live peer only', async ({ browser, baseURL }) => {
    const fixture = await community(browser, baseURL);
    try {
        const sender = await fixture.guest('Sender'); const recipient = await fixture.guest('Recipient');
        const third = await fixture.guest('Third'); fixture.advance(180000); await accept(sender, recipient);
        const original = fixture.delivered.find(frame => frame.t === 'pm-open' && frame.recipient.startsWith('socket-Sender-'));
        const history = 'An earlier incoming message keeps its historical author label';
        await send(recipient, history); await expect(received(sender, history)).toHaveCount(1);
        await send(sender, '/query Third');
        await third.locator('[data-pmreqs]').getByRole('button', { name: 'Accept', exact: true }).click();
        await expect(sender.locator('[data-chat-context]')).toHaveText('PM · Third');
        const other = fixture.delivered.filter(frame => frame.t === 'pm-open' && frame.recipient === original.recipient).at(-1);
        await sender.getByRole('tab', { name: '✉ Recipient', exact: true }).click();
        await sender.locator('[data-nicks] button.nick').filter({ hasText: /^Recipient$/ }).click();
        const sheet = sender.locator('dialog[data-sheet]'); await expect(sheet).toBeVisible();
        await send(recipient, '/nick RenamedRecipient');
        await third.getByRole('tab', { name: '#stalemate', exact: true }).click();
        await expect(third.locator('[data-nicks] button.nick').filter({ hasText: /^RenamedRecipient$/ })).toHaveCount(1);
        await send(third, '/nick Recipient');
        await expect(third.locator('[data-nicks] button.nick').filter({ hasText: /^Recipient$/ })).toHaveCount(1);
        const noticesBefore = fixture.delivered.filter(frame => frame.recipient === original.recipient && frame.t === 'notice').length;
        await sheet.getByRole('button', { name: 'Who?', exact: true }).click();
        await expect.poll(() => fixture.delivered.filter(frame => frame.recipient === original.recipient && frame.t === 'notice').length).toBe(noticesBefore + 1);
        expect(fixture.delivered.filter(frame => frame.recipient === original.recipient && frame.t === 'notice').at(-1).text).toContain('RenamedRecipient');
        expect(fixture.inbound.filter(frame => frame.name === 'whois').at(-1)).toMatchObject({ pmPeer: original.peer, pmRef: original.ref });
        // A historical transcript label is not a fresh nickname selection.
        await received(sender, history).getByRole('button', { name: '<Recipient>', exact: true }).click();
        await expect(sheet).toBeVisible(); await expect(sheet.locator('[data-sheet-title]')).toHaveText('RenamedRecipient');
        const before = fixture.delivered.length;
        const beforeBlockNotices = fixture.delivered.filter(frame => frame.recipient === original.recipient && frame.t === 'notice').length;
        await sheet.getByRole('button', { name: 'Block', exact: true }).click();
        await expect.poll(() => fixture.delivered.filter(frame => frame.recipient === original.recipient && frame.t === 'notice').length).toBe(beforeBlockNotices + 1);
        const blockNotice = fixture.delivered.filter(frame => frame.recipient === original.recipient && frame.t === 'notice').at(-1);
        expect(blockNotice).toMatchObject({ kind: 'info', text: "Blocked RenamedRecipient. They can't PM you and you won't see them." });
        await expect(sender.locator('[data-buffer]')).toContainText(blockNotice.text);
        expect(fixture.inbound.filter(frame => frame.name === 'block').at(-1)).toMatchObject({ pmPeer: original.peer, pmRef: original.ref });
        const closing = fixture.delivered.slice(before).filter(frame => frame.t === 'pm-closed');
        expect(closing).toHaveLength(2); expect(closing.every(frame => frame.ref === original.ref)).toBe(true);
        expect(closing.some(frame => frame.ref === other.ref)).toBe(false);
        await sender.getByRole('tab', { name: '✉ Recipient', exact: true }).click();
        await third.getByRole('tab', { name: '✉ Sender', exact: true }).click();
        fixture.advance(4000); const text = 'The other accepted peer still receives a fresh deliberate reply';
        await send(sender, text); await expect(received(third, text)).toHaveCount(1);
        expect(fixture.delivered.some(frame => frame.recipient === original.peer && frame.t === 'pm' && frame.text === text)).toBe(false);
    } finally { await fixture.close(); }
});

test('reconnecting renegotiates private actions instead of reusing an earlier server capability', async ({ browser, baseURL }) => {
    const fixture = await community(browser, baseURL);
    try {
        const sender = await fixture.guest('Sender'); const recipient = await fixture.guest('Recipient');
        const observer = await fixture.guest('Observer'); fixture.advance(180000); await accept(sender, recipient);
        await send(sender, '/me an action before the connection changes');
        await expect(received(recipient, 'an action before the connection changes')).toHaveCount(1);
        fixture.advertise(undefined); fixture.disconnect('Sender');
        await expect.poll(() => fixture.inbound.filter(frame => frame.sender.startsWith('socket-Sender-') && frame.t === 'hello').length).toBe(2);
        await expect(sender.locator('[data-connection]')).toHaveText('Connected');
        await expect(sender.locator('[data-chat-context]')).toHaveText('#stalemate');
        fixture.advance(180000); await accept(sender, recipient);
        const before = fixture.inbound.length, draft = '/me the old connection grants no private action support';
        await send(sender, draft); await expect(sender.locator('[data-text]')).toHaveValue(draft);
        await expect(sender.locator('[data-toast]')).toContainText('unavailable in private chat');
        expect(fixture.inbound).toHaveLength(before);
        await expect(observer.locator('[data-buffer]')).not.toContainText('old connection');
        fixture.advance(4000); const normal = 'A newly accepted ordinary PM works after reconnecting to the older capability';
        await send(sender, normal); await expect(received(recipient, normal)).toHaveCount(1);
    } finally { await fixture.close(); }
});

async function palettePrompt(page, label, answer) {
    await page.locator('[data-palette-open]').click();
    const palette = page.locator('dialog[data-palette]');
    await expect(palette).toBeVisible();
    const response = page.waitForEvent('dialog').then(async dialog => {
        expect(dialog.type()).toBe('prompt');
        if (answer === null) await dialog.dismiss();
        else await dialog.accept(answer);
    });
    await palette.getByRole('button', { name: label, exact: true }).click();
    await response; await expect(palette).toBeHidden();
}

test('the command menu delivers a complete public action within the existing 300-character limit', async ({ browser, baseURL }) => {
    const fixture = await community(browser, baseURL);
    try {
        const sender = await fixture.guest('Sender'); const recipient = await fixture.guest('Recipient');
        fixture.advance(180000);
        const action = 'builds a warm riff with friends while the drums find a new rhythm '.repeat(5).slice(0, 299) + '.';
        expect(action).toHaveLength(300);
        await palettePrompt(sender, '/me', action);
        await expect(received(recipient, action)).toContainText('* Sender');
        await expect(received(sender, action)).toHaveCount(1);
        const lines = fixture.delivered.filter(frame => frame.t === 'line' && frame.me);
        expect(lines).toHaveLength(2); expect(lines.every(frame => frame.text === action)).toBe(true);
        const before = fixture.inbound.length;
        await palettePrompt(sender, '/me', null);
        expect(fixture.inbound).toHaveLength(before);
        fixture.advance(4000); await palettePrompt(sender, '/me', '   ');
        await expect.poll(() => fixture.inbound.filter(frame => frame.sender.startsWith('socket-Sender-') && frame.name === 'me').at(-1)?.args).toEqual([]);
        expect(fixture.delivered.filter(frame => frame.t === 'line' && frame.me)).toHaveLength(2);
    } finally { await fixture.close(); }
});

test('the command menu preserves a complete away reason and supports cancel and blank-to-return', async ({ browser, baseURL }) => {
    const fixture = await community(browser, baseURL);
    try {
        const sender = await fixture.guest('Sender'); const recipient = await fixture.guest('Recipient');
        fixture.advance(180000);
        const reason = 'taking a short break then coming back to play a new song with friends '.repeat(2).slice(0, 79) + '.';
        expect(reason).toHaveLength(80);
        await palettePrompt(sender, '/away', reason);
        await expect(sender.locator('[data-buffer]')).toContainText(`You're marked away: ${reason}`);
        await send(recipient, '/whois Sender');
        await expect(recipient.locator('[data-buffer]')).toContainText(`away: ${reason}`);
        const before = fixture.inbound.length;
        await palettePrompt(sender, '/away', null);
        expect(fixture.inbound).toHaveLength(before);
        fixture.advance(4000); await palettePrompt(sender, '/away', '   ');
        await expect(sender.locator('[data-buffer]')).toContainText('Welcome back.');
        expect(fixture.inbound.filter(frame => frame.sender.startsWith('socket-Sender-') && frame.name === 'away').at(-1).args).toEqual([]);
        const beforeWhois = fixture.delivered.filter(frame => frame.recipient.startsWith('socket-Recipient-') && frame.t === 'notice').length;
        await send(recipient, '/whois Sender');
        await expect.poll(() => fixture.delivered.filter(frame => frame.recipient.startsWith('socket-Recipient-') && frame.t === 'notice').length).toBe(beforeWhois + 1);
        const notices = fixture.delivered.filter(frame => frame.recipient.startsWith('socket-Recipient-') && frame.t === 'notice');
        expect(notices.at(-1).text).not.toContain('away:');
    } finally { await fixture.close(); }
});

test('the command menu keeps complete PM text and actions private behind recipient acceptance', async ({ browser, baseURL }) => {
    const fixture = await community(browser, baseURL);
    try {
        const sender = await fixture.guest('Sender'); const recipient = await fixture.guest('Recipient');
        const observer = await fixture.guest('Observer'); fixture.advance(180000);
        const body = 'A private note about the song we can finish together after practice '.repeat(5).slice(0, 299) + '.';
        expect(body).toHaveLength(300);
        await palettePrompt(sender, '/msg', `Recipient ${body}`);
        await expect(recipient.locator('[data-pmreqs]').getByRole('button', { name: 'Accept', exact: true })).toBeVisible();
        expect(fixture.delivered.filter(frame => frame.t === 'pm')).toEqual([]);
        await expect(recipient.locator('[data-buffer]')).not.toContainText(body);
        await recipient.locator('[data-pmreqs]').getByRole('button', { name: 'Accept', exact: true }).click();
        await expect(sender.locator('[data-chat-context]')).toHaveText('PM · Recipient');
        await expect(recipient.locator('[data-chat-context]')).toHaveText('PM · Sender');
        await expect(received(recipient, body)).toHaveCount(1); await expect(received(sender, body)).toHaveCount(1);
        fixture.advance(4000);
        const action = 'keeps every word of this private action between the two accepted participants '.repeat(4).slice(0, 299) + '.';
        expect(action).toHaveLength(300);
        await palettePrompt(sender, '/me', action);
        await expect(received(recipient, action)).toContainText('* Sender');
        await expect(received(sender, action)).toHaveCount(1);
        expect(fixture.delivered.filter(frame => frame.t === 'line')).toEqual([]);
        expect(fixture.delivered.filter(frame => frame.recipient.startsWith('socket-Observer-') && frame.t === 'pm')).toEqual([]);
        for (const text of [body, action]) await expect(observer.locator('[data-buffer]')).not.toContainText(text);
    } finally { await fixture.close(); }
});


test('a real accepted peer disconnect disables saved PM restore while Copy and Discard remain usable', async ({ browser, baseURL }) => {
    const fixture = await community(browser, baseURL);
    try {
        const sender = await fixture.guest('Sender'); const recipient = await fixture.guest('Recipient');
        await sender.context().grantPermissions(['clipboard-read', 'clipboard-write']);
        fixture.advance(180000); await accept(sender, recipient);
        // The existing fixture clock stays fixed while the real production
        // chat bucket permits five bodies, then refuses the sixth. No reply
        // is injected and neither production limits nor its result are changed.
        for (let index = 0; index < 5; index++) {
            const text = `A published private body ${index}`;
            await send(sender, text); await expect(received(recipient, text)).toHaveCount(1);
        }
        const unsent = 'Keep this refused private body only in my tab';
        await send(sender, unsent);
        await expect(sender.locator('[data-toast]')).toContainText('Please wait');
        await expect(received(recipient, unsent)).toHaveCount(0);
        const id = await sender.locator('[data-message-recovery-list] li').filter({ hasText: unsent }).getAttribute('data-message-id');
        expect(id).toMatch(/^[a-f0-9]{32}$/);
        const row = sender.locator(`[data-message-id="${id}"]`);
        await expect(row).toContainText('Message was not sent.');
        const restore = row.getByRole('button', { name: 'Restore draft', exact: true });
        const copy = row.getByRole('button', { name: 'Copy saved text', exact: true });
        const discard = row.getByRole('button', { name: 'Discard saved copy', exact: true });
        await expect(restore).toBeEnabled();
        const senderId = fixture.inbound.find(frame => frame.t === 'hello' && frame.nick === 'Sender').sender;
        expect(fixture.delivered.filter(frame => frame.recipient === senderId && frame.t === 'message-result' && frame.id === id))
            .toEqual([{ recipient: senderId, t: 'message-result', id, status: 'rejected' }]);
        expect(fixture.inbound.filter(frame => frame.clientMessageId === id)).toHaveLength(1);
        // The actual browser /quit reaches the production command and
        // disconnect path; no close notification is fabricated. Page teardown
        // alone does not trigger this routed WebSocket fixture's onClose.
        await send(recipient, '/quit');
        await expect.poll(() => fixture.delivered.some(frame => frame.recipient === senderId && frame.t === 'event' && frame.ch === '#stalemate' && frame.text.startsWith('Recipient has quit'))).toBe(true);
        await expect(restore).toBeDisabled();
        await expect(sender.locator('[data-connection]')).toHaveText('Connected');
        const opened = fixture.delivered.find(frame => frame.recipient === senderId && frame.t === 'pm-open');
        expect(fixture.delivered.filter(frame => frame.t === 'pm-closed'))
            .toEqual([{ recipient: senderId, t: 'pm-closed', with: 'Recipient', peer: opened.peer, ref: opened.ref }]);
        await expect(copy).toBeEnabled(); await expect(discard).toBeEnabled();
        await copy.click();
        await expect.poll(() => sender.evaluate(() => navigator.clipboard.readText())).toBe(unsent);
        await expect(sender.locator('[data-text]')).toHaveValue('');
        expect(fixture.inbound.filter(frame => frame.clientMessageId === id)).toHaveLength(1);
        await discard.click(); await expect(row).toHaveCount(0);
        expect(fixture.inbound.filter(frame => frame.clientMessageId === id)).toHaveLength(1);
        expect(fixture.delivered.some(frame => frame.t === 'pm' && frame.text === unsent)).toBe(false);
    } finally { await fixture.close(); }
});

test('an accepted PM keeps its original peer and unsent draft when another accepted peer reuses that nickname', async ({ browser, baseURL }, testInfo) => {
    const fixture = await community(browser, baseURL);
    try {
        const sender = await fixture.guest('Sender'); const recipient = await fixture.guest('Recipient');
        const third = await fixture.guest('Third'); fixture.advance(180000);
        await accept(sender, recipient);
        const history = 'This private history belongs to the original Recipient endpoint';
        await send(sender, history); await expect(received(recipient, history)).toHaveCount(1);
        await expect(received(sender, history)).toHaveCount(1);
        const historyId = await received(sender, history).getAttribute('data-id');
        expect(historyId).toMatch(/^p[a-z0-9]+$/);
        fixture.advance(4000);
        // Establish the second pair through the real request and acceptance UI.
        // Existing consent with this peer must not redirect the first PM view.
        await send(sender, '/query Third');
        await third.locator('[data-pmreqs]').getByRole('button', { name: 'Accept', exact: true }).click();
        await expect(sender.locator('[data-chat-context]')).toHaveText('PM · Third');
        await expect(third.locator('[data-chat-context]')).toHaveText('PM · Sender');
        await sender.getByRole('tab', { name: '✉ Recipient', exact: true }).click();
        await expect(sender.locator('[data-chat-context]')).toHaveText('PM · Recipient');
        await expect(received(sender, history)).toHaveAttribute('data-id', historyId);
        const draft = 'This unsent draft is for the original Recipient and must never move to Third';
        await sender.fill('[data-text]', draft);
        const senderId = fixture.inbound.find(frame => frame.t === 'hello' && frame.nick === 'Sender').sender;
        const recipientId = fixture.inbound.find(frame => frame.t === 'hello' && frame.nick === 'Recipient').sender;
        const thirdId = fixture.inbound.find(frame => frame.t === 'hello' && frame.nick === 'Third').sender;
        expect(new Set([senderId, recipientId, thirdId]).size).toBe(3);
        // Both original connections remain live. Their real /nick commands
        // and the public roster witness precede Send; Sender never switches
        // away from the original PM to choose a replacement target.
        await send(recipient, '/nick RenamedRecipient');
        await third.locator('[data-tabs] [data-channel-key="#stalemate"]').click();
        await expect(third.locator('[data-nicks] button.nick').filter({ hasText: /^RenamedRecipient$/ })).toHaveCount(1);
        await expect(third.locator('[data-nicks] button.nick').filter({ hasText: /^Recipient$/ })).toHaveCount(0);
        await send(third, '/nick Recipient');
        await expect(third.locator('[data-nicks] button.nick').filter({ hasText: /^Recipient$/ })).toHaveCount(1);
        await expect(third.locator('[data-nicks] button.nick').filter({ hasText: /^RenamedRecipient$/ })).toHaveCount(1);
        await expect(third.locator('[data-nicks] button.nick').filter({ hasText: /^Third$/ })).toHaveCount(0);
        await expect(sender.locator('[data-text]')).toHaveValue(draft);
        await expect(received(sender, history)).toHaveAttribute('data-id', historyId);
        fixture.advance(4000); await sender.press('[data-text]', 'Enter');
        const copies = () => fixture.delivered.filter(frame => frame.t === 'pm' && frame.text === draft);
        await expect.poll(() => copies().length).toBe(2);
        const delivery = {
            senderCopies: copies().filter(frame => frame.recipient === senderId).length,
            originalPeerCopies: copies().filter(frame => frame.recipient === recipientId).length,
            replacementPeerCopies: copies().filter(frame => frame.recipient === thirdId).length
        };
        await testInfo.attach('pm-peer-binding-delivery', { body: JSON.stringify(delivery), contentType: 'application/json' });
        // Check actual endpoint delivery before the desired updated heading,
        // so the baseline can expose wrong delivery rather than a label gap.
        expect(delivery.replacementPeerCopies).toBe(0);
        expect(delivery.originalPeerCopies).toBe(1); expect(delivery.senderCopies).toBe(1);
        await expect(received(recipient, draft)).toHaveCount(1);
        await expect(sender.locator('[data-chat-context]')).toHaveText('PM · RenamedRecipient');
        await expect(received(sender, history)).toHaveAttribute('data-id', historyId);
        await expect(received(sender, draft)).toHaveCount(1);
        await expect(sender.locator('[data-text]')).toHaveValue('');
        fixture.advance(4000);
        await send(sender, '/me keeps this action with the original renamed peer');
        await expect(received(recipient, 'keeps this action with the original renamed peer')).toContainText('* Sender');
        expect(fixture.delivered.some(frame => frame.recipient === thirdId && frame.t === 'pm' && frame.text === 'keeps this action with the original renamed peer')).toBe(false);
        fixture.advance(4000); await send(sender, '/slap Recipient');
        const mention = 'slaps Recipient around a bit with a large trout';
        await expect(received(recipient, mention)).toHaveCount(1);
        expect(fixture.delivered.some(frame => frame.recipient === thirdId && frame.t === 'pm' && frame.text === mention)).toBe(false);
        expect(fixture.delivered.filter(frame => frame.t === 'line' && [history, draft].includes(frame.text))).toEqual([]);
    } finally { await fixture.close(); }
});

test('a disconnected PM keeps its ordinary draft separate from a newly accepted visitor using the old nickname', async ({ browser, baseURL }, testInfo) => {
    const fixture = await community(browser, baseURL);
    try {
        const sender = await fixture.guest('Sender', { viewport: { width: 375, height: 667 } }); const recipient = await fixture.guest('Recipient');
        await sender.context().grantPermissions(['clipboard-read', 'clipboard-write']);
        fixture.advance(180000); await accept(sender, recipient);
        const original = fixture.delivered.find(frame => frame.t === 'pm-open' && frame.recipient.startsWith('socket-Sender-'));
        const history = 'Only the departed original peer shares this earlier private history';
        await send(sender, history); await expect(received(recipient, history)).toHaveCount(1);
        const draft = 'Keep this ordinary unsent draft with the departed original peer';
        await sender.fill('[data-text]', draft); await send(recipient, '/quit');
        await expect.poll(() => fixture.delivered.some(frame => frame.recipient === original.recipient && frame.t === 'event' && frame.text.startsWith('Recipient has quit'))).toBe(true);
        await expect(sender.getByRole('tab', { name: '✉ Recipient (closed)', exact: true })).toBeVisible();
        await expect(sender.getByRole('button', { name: 'Copy draft', exact: true })).toBeVisible();
        await expect(sender.getByRole('button', { name: 'Discard draft', exact: true })).toBeVisible();
        // Observe the untouched closed-view layout before an action's native
        // scrolling/focus can conceal a clipped composer or recovery control.
        const geometry = await sender.evaluate(() => {
            const rect = element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
            const buttons = [...document.querySelectorAll('[data-toast] button')];
            const controls = {
                input: document.querySelector('[data-text]'), send: document.querySelector('[data-send]'),
                copy: buttons.find(button => button.textContent === 'Copy draft'),
                discard: buttons.find(button => button.textContent === 'Discard draft')
            };
            const observe = element => {
                const box = rect(element), style = getComputedStyle(element);
                const points = [[box.left + 2, box.top + 2], [box.right - 2, box.top + 2],
                    [box.left + 2, box.bottom - 2], [box.right - 2, box.bottom - 2],
                    [box.left + box.width / 2, box.top + box.height / 2]];
                let clipsContain = true;
                for (let parent = element.parentElement; parent; parent = parent.parentElement) {
                    const clipping = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
                    if (/hidden|clip|auto|scroll/.test(clipping.overflowX) && (box.left < bounds.left || box.right > bounds.right)) clipsContain = false;
                    if (/hidden|clip|auto|scroll/.test(clipping.overflowY) && (box.top < bounds.top || box.bottom > bounds.bottom)) clipsContain = false;
                }
                return { ...box, disabled: element.disabled, displayed: style.display !== 'none' && style.visibility === 'visible',
                    clipsContain, uncovered: points.every(([x, y]) => element.contains(document.elementFromPoint(x, y))) };
            };
            return { viewport: { width: innerWidth, height: innerHeight }, pageWidth: document.documentElement.scrollWidth,
                controls: Object.fromEntries(Object.entries(controls).map(([name, element]) => [name, observe(element)])),
                inputFontSize: getComputedStyle(controls.input).fontSize };
        });
        const geometryPath = testInfo.outputPath('closed-pm-draft-controls-375.json');
        await writeFile(geometryPath, JSON.stringify(geometry, null, 2));
        await testInfo.attach('closed-pm-draft-controls-375', { path: geometryPath, contentType: 'application/json' });
        await sender.screenshot({ path: testInfo.outputPath('closed-pm-draft-controls-375.png'), fullPage: true });
        expect(geometry.viewport).toEqual({ width: 375, height: 667 });
        expect(geometry.pageWidth).toBeLessThanOrEqual(375); expect(geometry.inputFontSize).toBe('16px');
        for (const control of Object.values(geometry.controls)) {
            expect(control.width).toBeGreaterThan(0); expect(control.height).toBeGreaterThan(0);
            expect(control.left).toBeGreaterThanOrEqual(0); expect(control.right).toBeLessThanOrEqual(375);
            expect(control.top).toBeGreaterThanOrEqual(0); expect(control.bottom).toBeLessThanOrEqual(667);
            expect(control.displayed).toBe(true); expect(control.clipsContain).toBe(true); expect(control.uncovered).toBe(true);
        }
        // Send remains enabled for deliberate named commands. Its ordinary
        // closed-PM body guard is exercised below without emitting a frame.
        expect(geometry.controls.input.disabled).toBe(false); expect(geometry.controls.send.disabled).toBe(false);
        const replacement = await fixture.guest('Recipient'); fixture.advance(180000);
        const replacementId = fixture.inbound.filter(frame => frame.t === 'hello' && frame.nick === 'Recipient').at(-1).sender;
        expect(replacementId).not.toBe(original.peer);
        const beforeBlockedSend = fixture.inbound.length;
        await sender.press('[data-text]', 'Enter');
        await expect(sender.locator('[data-toast]')).toContainText('Private replies are not confirmed');
        expect(fixture.inbound).toHaveLength(beforeBlockedSend);
        await expect(sender.locator('[data-text]')).toHaveValue(draft);
        expect(fixture.delivered.some(frame => frame.recipient === replacementId && ['pm', 'pm-request'].includes(frame.t))).toBe(false);
        await sender.getByRole('button', { name: 'Copy draft', exact: true }).click();
        await expect.poll(() => sender.evaluate(() => navigator.clipboard.readText())).toBe(draft);
        await sender.press('[data-text]', 'Enter');
        await sender.getByRole('button', { name: 'Discard draft', exact: true }).click();
        await expect(sender.locator('[data-text]')).toHaveValue('');
        // An explicit new request is a separate deliberate choice, not an
        // automatic replay or transfer of the old draft/history.
        await send(sender, '/query Recipient');
        await replacement.locator('[data-pmreqs]').getByRole('button', { name: 'Accept', exact: true }).click();
        await expect(sender.locator('[data-chat-context]')).toHaveText('PM · Recipient');
        const reopened = fixture.delivered.filter(frame => frame.t === 'pm-open' && frame.recipient === original.recipient).at(-1);
        expect(reopened.peer).toBe(replacementId); expect(reopened.ref).not.toBe(original.ref);
        await expect(sender.locator('[data-text]')).toHaveValue('');
        await expect(sender.locator('[data-buffer]')).not.toContainText(draft);
        await expect(sender.locator('[data-buffer]')).not.toContainText(history);
        const fresh = 'A consciously new message after the new visitor accepted';
        await send(sender, fresh); await expect(received(replacement, fresh)).toHaveCount(1);
        expect(fixture.delivered.some(frame => frame.t === 'pm' && frame.text === draft)).toBe(false);
    } finally { await fixture.close(); }
});

test('a delayed genuine close cannot retire a new PM or move an older unsent draft into it', async ({ browser, baseURL }) => {
    const fixture = await community(browser, baseURL);
    try {
        const sender = await fixture.guest('Sender'); const recipient = await fixture.guest('Recipient');
        fixture.advance(180000); await accept(sender, recipient);
        const original = fixture.delivered.find(frame => frame.t === 'pm-open' && frame.recipient.startsWith('socket-Sender-'));
        const draft = 'An older draft stays only in its original closed conversation';
        await sender.fill('[data-text]', draft);
        fixture.hold((id, frame) => id === original.recipient && frame.t === 'pm-closed');
        await send(recipient, '/quit');
        await expect.poll(() => fixture.delivered.some(frame => frame.recipient === original.recipient && frame.t === 'pm-closed' && frame.ref === original.ref)).toBe(true);
        const replacement = await fixture.guest('Recipient'); fixture.advance(180000);
        await sender.getByRole('tab', { name: '#stalemate', exact: true }).click();
        await send(sender, '/query Recipient');
        await replacement.locator('[data-pmreqs]').getByRole('button', { name: 'Accept', exact: true }).click();
        await expect(sender.locator('[data-chat-context]')).toHaveText('PM · Recipient');
        const opened = fixture.delivered.filter(frame => frame.t === 'pm-open' && frame.recipient === original.recipient).at(-1);
        expect(opened.ref).not.toBe(original.ref); expect(opened.peer).not.toBe(original.peer);
        await expect(sender.locator(`[data-tabs] [data-channel-key="pm:${original.ref}"]`)).toHaveText('✉ Recipient');
        fixture.release();
        await expect(sender.getByRole('tab', { name: '✉ Recipient (closed)', exact: true })).toBeVisible();
        await expect(sender.locator('[data-chat-context]')).toHaveText('PM · Recipient');
        await expect(sender.locator('[data-text]')).toHaveValue('');
        const fresh = 'The current peer still receives a deliberate fresh reply after the old close';
        await send(sender, fresh); await expect(received(replacement, fresh)).toHaveCount(1);
        await sender.getByRole('tab', { name: '✉ Recipient (closed)', exact: true }).click();
        await expect(sender.locator('[data-text]')).toHaveValue(draft);
        await sender.press('[data-text]', 'Enter');
        await expect(sender.locator('[data-text]')).toHaveValue(draft);
        expect(fixture.delivered.some(frame => frame.t === 'pm' && frame.text === draft)).toBe(false);
    } finally { await fixture.close(); }
});

for (const [label, feature] of [['missing', null], ['a string', '1'], ['a boolean', true]])
    test(`without numeric peer binding (${label}), implicit PM sends retain drafts while explicit nickname commands remain usable`, async ({ browser, baseURL }) => {
        const fixture = await community(browser, baseURL, { privatePeerFeature: feature });
        try {
            const sender = await fixture.guest('Sender'); const recipient = await fixture.guest('Recipient'); fixture.advance(180000);
            await send(sender, '/query Recipient');
            // The old-server request widget lacks an authoritative endpoint;
            // a consciously typed named acceptance is still a named command.
            await send(recipient, '/accept Sender');
            await expect(sender.locator('[data-chat-context]')).toHaveText('PM · Recipient');
            const draft = 'This implicit private draft must not use an unconfirmed nickname';
            const before = fixture.inbound.length;
            await send(sender, draft);
            await expect(sender.locator('[data-text]')).toHaveValue(draft);
            await expect(sender.locator('[data-toast]')).toContainText('Private replies are not confirmed');
            expect(fixture.inbound).toHaveLength(before);
            await send(sender, '/me an unconfirmed private action stays here');
            await expect(sender.locator('[data-text]')).toHaveValue('/me an unconfirmed private action stays here');
            expect(fixture.inbound).toHaveLength(before);
            const explicit = 'This message deliberately names the currently accepted Recipient';
            await send(sender, `/msg Recipient ${explicit}`);
            await expect(received(recipient, explicit)).toHaveCount(1);
            expect(fixture.delivered.some(frame => frame.t === 'pm' && frame.text === draft)).toBe(false);
            await sender.getByRole('tab', { name: '#stalemate', exact: true }).click(); fixture.advance(4000);
            await send(sender, 'Public chat still works when private peer binding is unavailable');
            await recipient.locator('[data-tabs] [data-channel-key="#stalemate"]').click();
            await expect(received(recipient, 'Public chat still works when private peer binding is unavailable')).toHaveCount(1);
        } finally { await fixture.close(); }
    });


test('a public People sheet kept open across nickname reuse requests only the originally selected live person', async ({ browser, baseURL }, testInfo) => {
    const fixture = await community(browser, baseURL);
    try {
        const sender = await fixture.guest('Sender');
        const original = await fixture.guest('Original');
        const replacement = await fixture.guest('Third');
        const senderId = fixture.inbound.find(frame => frame.t === 'hello' && frame.nick === 'Sender').sender;
        const originalId = fixture.inbound.find(frame => frame.t === 'hello' && frame.nick === 'Original').sender;
        const replacementId = fixture.inbound.find(frame => frame.t === 'hello' && frame.nick === 'Third').sender;
        expect(new Set([senderId, originalId, replacementId]).size).toBe(3);
        for (const page of [sender, original, replacement]) {
            await expect(page.locator('[data-connection]')).toHaveText('Connected');
            await expect(page.locator('[data-chat-context]')).toHaveText('#stalemate');
            await expect(page.locator('[data-pmreqs] .req')).toHaveCount(0);
        }
        expect(fixture.delivered.filter(frame => ['pm', 'pm-open', 'pm-request'].includes(frame.t))).toEqual([]);
        // The existing real-engine fixture clock advances past both the PM
        // minimum stay and nickname-change cooldown; no production limit changes.
        fixture.advance(180000);
        const person = sender.locator('[data-nicks] button.nick').filter({ hasText: /^Original$/ });
        await expect(person).toHaveAttribute('data-connection-id', originalId);
        await person.click();
        const sheet = sender.locator('dialog[data-sheet]');
        await expect(sheet).toBeVisible();
        await expect(sheet.locator('[data-sheet-title]')).toHaveText('Original');
        await expect(sheet.getByRole('button', { name: '✉ PM', exact: true })).toBeEnabled();

        // The original sheet stays open while both real /nick commands and
        // their authoritative public roster updates complete.
        await send(original, '/nick RenamedOriginal');
        await expect(sender.locator(`[data-nicks] button[data-connection-id="${originalId}"]`)).toHaveText('RenamedOriginal');
        await expect(sender.locator('[data-nicks] button.nick').filter({ hasText: /^Original$/ })).toHaveCount(0);
        await send(replacement, '/nick Original');
        await expect(sender.locator(`[data-nicks] button[data-connection-id="${replacementId}"]`)).toHaveText('Original');
        await expect(sender.locator(`[data-nicks] button[data-connection-id="${originalId}"]`)).toHaveText('RenamedOriginal');
        await expect(sheet).toBeVisible();
        await expect(sender.locator('[data-chat-context]')).toHaveText('#stalemate');
        await sender.screenshot({ path: testInfo.outputPath('public-person-held-before-pm.png'), fullPage: true });

        const incomingStart = fixture.inbound.length, outgoingStart = fixture.delivered.length;
        await sheet.getByRole('button', { name: '✉ PM', exact: true }).click();
        const requests = () => fixture.delivered.slice(outgoingStart).filter(frame => frame.t === 'pm-request');
        // This positive witness makes the baseline fail on actual routing,
        // rather than a missing button, unsupported feature or ineligible guest.
        await expect.poll(() => requests().length).toBe(1);
        const diagnostic = {
            scope: 'Production client and core with explicit local WebSocket, identity and clock fixtures; no hosted/authentication claim',
            selected: { senderId, originalId, replacementId, originalLabel: 'Original', currentOriginalLabel: 'RenamedOriginal', currentReplacementLabel: 'Original' },
            inbound: fixture.inbound.slice(incomingStart),
            outbound: fixture.delivered.slice(outgoingStart),
            requestRecipients: requests().map(frame => frame.recipient),
            dom: await Promise.all([sender, original, replacement].map(page => page.evaluate(() => ({
                connection: document.querySelector('[data-connection]').textContent,
                channel: document.querySelector('[data-chat-context]').textContent,
                requests: [...document.querySelectorAll('[data-pmreqs] .req')].map(node => node.textContent),
                people: [...document.querySelectorAll('[data-nicks] button.nick')].map(node => ({ id: node.dataset.connectionId, text: node.textContent }))
            }))))
        };
        const diagnosticPath = testInfo.outputPath('public-person-held-pm-routing.json');
        await writeFile(diagnosticPath, JSON.stringify(diagnostic, null, 2));
        await testInfo.attach('public-person-held-pm-routing', { path: diagnosticPath, contentType: 'application/json' });
        await Promise.all([
            sender.screenshot({ path: testInfo.outputPath('public-person-pm-sender.png'), fullPage: true }),
            original.screenshot({ path: testInfo.outputPath('public-person-pm-original.png'), fullPage: true }),
            replacement.screenshot({ path: testInfo.outputPath('public-person-pm-replacement.png'), fullPage: true })
        ]);
        // No prior PM consent is present. Selecting the public person must
        // request that same live endpoint, never the new holder of its old label.
        expect(requests().filter(frame => frame.recipient === replacementId)).toHaveLength(0);
        expect(requests().map(frame => frame.recipient)).toEqual([originalId]);
        await expect(original.locator('[data-pmreqs] .req')).toHaveCount(1);
        await expect(original.locator('[data-pmreqs] .req')).toContainText('Sender');
        await expect(replacement.locator('[data-pmreqs] .req')).toHaveCount(0);
        expect(fixture.delivered.slice(outgoingStart).filter(frame => frame.t === 'pm')).toEqual([]);
    } finally { await fixture.close(); }
});


test('a historical public author blocks only its original identity after that label is reused', async ({ browser, baseURL }) => {
    const fixture = await community(browser, baseURL);
    try {
        const sender = await fixture.guest('Sender'), original = await fixture.guest('Original'), replacement = await fixture.guest('Third');
        fixture.advance(180000);
        const originalId = fixture.inbound.find(frame => frame.t === 'hello' && frame.nick === 'Original').sender;
        const replacementId = fixture.inbound.find(frame => frame.t === 'hello' && frame.nick === 'Third').sender;
        const history = 'A public sentence belongs to the original connection';
        await send(original, history); await expect(received(sender, history)).toHaveCount(1);
        const delivered = fixture.delivered.find(frame => frame.t === 'line' && frame.text === history && frame.recipient.startsWith('socket-Sender-'));
        expect(delivered.personPeer).toBe(originalId); expect(delivered.personSelf).toBe(false);
        await send(original, '/nick RenamedOriginal');
        await expect(sender.locator(`[data-nicks] button[data-connection-id="${originalId}"]`)).toHaveText('RenamedOriginal');
        await send(replacement, '/nick Original');
        await expect(sender.locator(`[data-nicks] button[data-connection-id="${replacementId}"]`)).toHaveText('Original');
        await received(sender, history).getByRole('button', { name: '<Original>', exact: true }).click();
        const sheet = sender.locator('dialog[data-sheet]');
        await expect(sheet.locator('[data-sheet-title]')).toHaveText('RenamedOriginal');
        await sheet.getByRole('button', { name: 'Block', exact: true }).click();
        await expect(sender.locator('[data-buffer]')).toContainText('Blocked RenamedOriginal');
        const command = fixture.inbound.filter(frame => frame.t === 'cmd' && frame.name === 'block').at(-1);
        expect(command).toMatchObject({ personContext: 1, personPeer: originalId, ch: '#stalemate', roomInstance: delivered.roomInstance });
        fixture.advance(4000); const hidden = 'This later original sentence is blocked by identity';
        await send(original, hidden); await expect(received(original, hidden)).toHaveCount(1);
        expect(fixture.delivered.some(frame => frame.t === 'line' && frame.text === hidden && frame.recipient === command.sender)).toBe(false);
        fixture.advance(4000); const visible = 'The unrelated holder of the old label can still participate';
        await send(replacement, visible); await expect(received(sender, visible)).toHaveCount(1);
        // Reporting retains the selected old delivery, independently of the
        // person's new name, Block and whether a contact pair ever existed.
        const before = fixture.inbound.length;
        await received(sender, history).locator('.flag').click();
        await expect(received(sender, history).locator('.flag')).toHaveText('✓');
        expect(fixture.inbound.slice(before).find(frame => frame.t === 'report')).toMatchObject({ id: delivered.id, text: history });
    } finally { await fixture.close(); }
});

test('identity Ignore waits for its committed snapshot and survives a same-socket wake without hiding a new label holder', async ({ browser, baseURL }) => {
    const fixture = await community(browser, baseURL);
    try {
        const sender = await fixture.guest('Sender'), original = await fixture.guest('Original'), replacement = await fixture.guest('Third');
        fixture.advance(180000);
        const originalId = fixture.inbound.find(frame => frame.t === 'hello' && frame.nick === 'Original').sender;
        const senderId = fixture.inbound.find(frame => frame.t === 'hello' && frame.nick === 'Sender').sender;
        fixture.hold((id, frame) => id === senderId && frame.t === 'person-preferences');
        // Hold a genuine earlier named-rule ACK, then issue the independent
        // selected-person operation before delivering that earlier snapshot.
        await send(sender, '/ignore UnknownRule');
        await expect.poll(() => fixture.delivered.some(frame => frame.recipient === senderId && frame.t === 'person-preferences' && frame.names.includes('unknownrule') && frame.peers.length === 0)).toBe(true);
        await sender.locator('[data-nicks] button.nick').filter({ hasText: /^Original$/ }).click();
        const sheet = sender.locator('dialog[data-sheet]');
        await sheet.getByRole('button', { name: 'Ignore', exact: true }).click();
        await expect.poll(() => fixture.delivered.some(frame => frame.recipient === senderId && frame.t === 'person-preferences' && frame.peers.includes(originalId))).toBe(true);
        expect(await sender.evaluate(id => window.__lobby.peerIgnores.has(id), originalId)).toBe(false);
        await expect(sheet.getByRole('button', { name: 'Ignore', exact: true })).toBeVisible();
        await expect(sheet.locator('[data-person-status]')).toContainText('Waiting');
        expect(fixture.releaseNext((id, frame) => id === senderId && frame.t === 'person-preferences' && frame.names.includes('unknownrule') && frame.peers.length === 0)).toBe(true);
        await expect.poll(() => sender.evaluate(() => window.__lobby.ignores.has('unknownrule'))).toBe(true);
        await expect(sheet.locator('[data-person-status]')).toContainText('Waiting');
        await expect(sheet.getByRole('button', { name: 'Ignore', exact: true })).toBeVisible();
        fixture.release();
        await expect(sheet.getByRole('button', { name: 'Unignore', exact: true })).toBeVisible();
        expect(await sender.evaluate(id => window.__lobby.peerIgnores.has(id), originalId)).toBe(true);
        await sender.keyboard.press('Escape');
        await send(original, '/nick RenamedOriginal');
        await expect(sender.locator(`[data-nicks] button[data-connection-id="${originalId}"]`)).toHaveText('RenamedOriginal');
        await send(replacement, '/nick Original');
        await expect(sender.locator('[data-nicks] button.nick').filter({ hasText: /^Original$/ })).toHaveCount(1);
        fixture.advance(4000); const hidden = 'The ignored connection remains ignored under its new name';
        await send(original, hidden); await expect(received(original, hidden)).toHaveCount(1);
        expect(fixture.delivered.some(frame => frame.t === 'line' && frame.text === hidden && frame.recipient === senderId)).toBe(false);
        fixture.advance(4000); const visible = 'The new name holder is independent of the ignored connection';
        await send(replacement, visible); await expect(received(sender, visible)).toHaveCount(1);
        fixture.wake();
        await sender.locator(`[data-nicks] button[data-connection-id="${originalId}"]`).click();
        await expect(sheet.getByRole('button', { name: 'Unignore', exact: true })).toBeVisible();
        await sheet.getByRole('button', { name: 'Unignore', exact: true }).click();
        await expect(sheet.getByRole('button', { name: 'Ignore', exact: true })).toBeVisible();
        expect(await sender.evaluate(id => window.__lobby.peerIgnores.has(id), originalId)).toBe(false);
        await sender.keyboard.press('Escape');
        fixture.advance(4000); const resumed = 'The same original connection is visible after confirmed Unignore';
        await send(original, resumed); await expect(received(sender, resumed)).toHaveCount(1);
    } finally { await fixture.close(); }
});

for (const [label, feature] of [['missing', null], ['a string', '1'], ['a boolean', true]])
    test(`without numeric public person targeting (${label}), exact reports and deliberate typed names remain usable`, async ({ browser, baseURL }) => {
        const fixture = await community(browser, baseURL, { personTargetFeature: feature });
        try {
            const sender = await fixture.guest('Sender'), original = await fixture.guest('Original'); fixture.advance(180000);
            const text = 'An exact delivered message can still be reported on an older server';
            await send(original, text); await expect(received(sender, text)).toHaveCount(1);
            await expect(sender.locator('[data-nicks] button.nick').filter({ hasText: /^Original$/ })).toBeDisabled();
            await expect(received(sender, text).getByRole('button', { name: '<Original>', exact: true })).toBeDisabled();
            await received(sender, text).locator('.flag').click();
            await expect(received(sender, text).locator('.flag')).toHaveText('✓');
            expect(fixture.inbound.filter(frame => frame.t === 'cmd' && frame.personContext === 1)).toEqual([]);
            await send(sender, '/query Original');
            await expect(original.locator('[data-pmreqs] .req')).toHaveCount(1);
            await expect(original.locator('[data-pmreqs] .req')).toContainText('Sender');
        } finally { await fixture.close(); }
    });

test('a held room-host person action stays on its original endpoint and refuses a recreated room', async ({ browser, baseURL }) => {
    const fixture = await community(browser, baseURL);
    try {
        const host = await fixture.guest('Sender'), original = await fixture.guest('Original'), replacement = await fixture.guest('Third');
        const room = '#people-host-room';
        for (const page of [host, original, replacement]) { await send(page, `/join ${room}`); await expect(page.locator('[data-chat-context]')).toHaveText(room); }
        fixture.advance(180000);
        const originalId = fixture.inbound.find(frame => frame.t === 'hello' && frame.nick === 'Original').sender;
        const replacementId = fixture.inbound.find(frame => frame.t === 'hello' && frame.nick === 'Third').sender;
        await host.locator('[data-nicks] button.nick').filter({ hasText: /^Original$/ }).click();
        const sheet = host.locator('dialog[data-sheet]'); await expect(sheet.getByRole('button', { name: 'Kick', exact: true })).toBeVisible();
        await send(original, '/nick RenamedOriginal');
        await expect(host.locator(`[data-nicks] button[data-connection-id="${originalId}"]`)).toHaveText('RenamedOriginal');
        await send(replacement, '/nick Original');
        await expect(host.locator(`[data-nicks] button[data-connection-id="${replacementId}"]`)).toHaveText('Original');
        await sheet.getByRole('button', { name: 'Kick', exact: true }).click();
        await expect(original.locator('[data-chat-context]')).toHaveText('#stalemate');
        await expect(replacement.locator('[data-chat-context]')).toHaveText(room);
        const kick = fixture.inbound.filter(frame => frame.name === 'kick').at(-1);
        expect(kick).toMatchObject({ personContext: 1, personPeer: originalId, ch: room });
        expect(kick.roomInstance).toMatch(/^[a-f0-9]{32}$/);
        await host.locator(`[data-nicks] button[data-connection-id="${replacementId}"]`).click();
        // Actual authorized close/recreate commands change the room generation
        // while the old selected-person sheet is held; they do not fake roles.
        await host.evaluate(name => window.__lobby.cmd('close', [], name), room);
        await expect(replacement.locator('[data-chat-context]')).toHaveText('#stalemate');
        const { LOBBY_LIMITS } = await import('../../hangout-worker/src/lobby-core.mjs');
        fixture.advance(LOBBY_LIMITS.roomPerDevice); // Honor the real ordinary room-creation interval.
        await host.evaluate(name => window.__lobby.cmd('join', [name]), room);
        await expect(host.locator('[data-chat-context]')).toHaveText(room);
        expect(await host.evaluate(name => window.__lobby.chans.get(name).keepRef, room)).not.toBe(kick.roomInstance);
        const before = fixture.inbound.filter(frame => frame.name === 'kick').length;
        await sheet.getByRole('button', { name: 'Kick', exact: true }).click();
        await expect(sheet).toBeVisible();
        await expect(sheet.locator('[data-person-status]')).toContainText('no longer confirmed');
        expect(fixture.inbound.filter(frame => frame.name === 'kick')).toHaveLength(before);
    } finally { await fixture.close(); }
});

test('current-person invitation selection stays bound while deliberate nickname invitations select the current name holder', async ({ browser, baseURL }) => {
    const fixture = await community(browser, baseURL);
    try {
        const host = await fixture.guest('Sender'), original = await fixture.guest('Original'), replacement = await fixture.guest('Third');
        const originalId = fixture.inbound.find(frame => frame.t === 'hello' && frame.nick === 'Original').sender;
        const replacementId = fixture.inbound.find(frame => frame.t === 'hello' && frame.nick === 'Third').sender;
        const room = '#people-invite-room'; await send(host, `/join ${room}`); await expect(host.locator('[data-chat-context]')).toHaveText(room);
        fixture.advance(180000);
        await host.locator('[data-roomtools]').click(); await host.getByRole('button', { name: 'Invite guest', exact: true }).click();
        const dialog = host.locator('[data-invite-dialog]'); await expect(dialog).toBeVisible();
        await dialog.locator('[data-invite-options]').selectOption(originalId);
        await send(original, '/nick RenamedOriginal');
        await expect(replacement.locator('[data-nicks] button.nick').filter({ hasText: /^RenamedOriginal$/ })).toHaveCount(1);
        await send(replacement, '/nick Original');
        await expect(replacement.locator('[data-nicks] button.nick').filter({ hasText: /^Original$/ })).toHaveCount(1);
        const before = fixture.delivered.length;
        await dialog.getByRole('button', { name: 'Invite selected person', exact: true }).click();
        await expect.poll(() => fixture.delivered.slice(before).filter(frame => frame.t === 'invite').length).toBe(1);
        expect(fixture.delivered.slice(before).filter(frame => frame.t === 'invite').map(frame => frame.recipient)).toEqual([originalId]);
        await host.locator('[data-roomtools]').click(); await host.getByRole('button', { name: 'Invite guest', exact: true }).click();
        await dialog.locator('[data-invite-nick]').fill('Original');
        const namedBefore = fixture.delivered.length;
        await dialog.getByRole('button', { name: 'Send invitation', exact: true }).click();
        await expect.poll(() => fixture.delivered.slice(namedBefore).filter(frame => frame.t === 'invite').length).toBe(1);
        expect(fixture.delivered.slice(namedBefore).filter(frame => frame.t === 'invite').map(frame => frame.recipient)).toEqual([replacementId]);
        expect(fixture.inbound.filter(frame => frame.name === 'invite').at(-1)).toMatchObject({ personNamed: true, args: ['Original'] });
    } finally { await fixture.close(); }
});


test('older PM peer binding cannot silently use nickname-collateral Block while exact reports and deliberate typed safety actions remain usable', async ({ browser, baseURL }) => {
    const fixture = await community(browser, baseURL, { personTargetFeature: null });
    try {
        const sender = await fixture.guest('Sender'), recipient = await fixture.guest('Recipient'); fixture.advance(180000);
        await send(sender, '/query Recipient');
        const prompt = recipient.locator('[data-pmreqs] .req'); await expect(prompt).toHaveCount(1);
        const beforeRequestBlock = fixture.inbound.length;
        await prompt.getByRole('button', { name: 'Block', exact: true }).click();
        await expect(recipient.locator('[data-toast]')).toContainText('Identity-safe blocking is unavailable');
        await expect(prompt).toHaveCount(1);
        expect(fixture.inbound.slice(beforeRequestBlock).some(frame => frame.t === 'cmd' && frame.name === 'block')).toBe(false);
        await prompt.getByRole('button', { name: 'Accept', exact: true }).click();
        await expect(sender.locator('[data-chat-context]')).toHaveText('PM · Recipient');
        await expect(recipient.locator('[data-chat-context]')).toHaveText('PM · Sender');
        const history = 'This exact private delivery remains reportable without a new safety capability';
        await send(recipient, history); await expect(received(sender, history)).toHaveCount(1);
        await received(sender, history).getByRole('button', { name: '<Recipient>', exact: true }).click();
        const sheet = sender.locator('dialog[data-sheet]');
        const beforeSheetBlock = fixture.inbound.length;
        await sheet.getByRole('button', { name: 'Block', exact: true }).click();
        await expect(sheet).toBeVisible();
        await expect(sheet.locator('[data-person-status]')).toContainText('Identity-safe blocking is unavailable');
        expect(fixture.inbound.slice(beforeSheetBlock).some(frame => frame.t === 'cmd' && frame.name === 'block')).toBe(false);
        await sheet.getByRole('button', { name: 'Who?', exact: true }).click();
        await expect(sheet).toBeHidden();
        await expect(sender.locator('[data-buffer]')).toContainText('Recipient · on');
        await received(sender, history).locator('.flag').click();
        await expect(received(sender, history).locator('.flag')).toHaveText('✓');
        fixture.advance(4000); const beforeNamed = fixture.inbound.length;
        await send(sender, '/block Recipient');
        await expect(sender.locator('[data-buffer]')).toContainText('Blocked Recipient');
        expect(fixture.inbound.slice(beforeNamed).some(frame => frame.t === 'say' && frame.text === '/block Recipient')).toBe(true);
    } finally { await fixture.close(); }
});
