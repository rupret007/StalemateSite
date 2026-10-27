// Two real clients use the production engine via an explicit WebSocket fixture.
// Recreating that engine simulates a wake with the same exact live socket identities.
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

test.skip(({ browserName }) => browserName !== 'chromium', 'PM recovery fixture uses Chromium.');

async function community(browser, baseURL, { privateContextFeature = 1 } = {}) {
    const { createLobby } = await import('../../hangout-worker/src/lobby-core.mjs');
    let now = 1800000000000, engine, sequence = 0, advertisedFeature = privateContextFeature;
    const sockets = new Map(), identities = new Map(), contexts = [], inbound = [], delivered = [];
    const boot = () => { engine = createLobby({ now: () => now, send: (id, frame) => {
        const output = structuredClone(frame);
        if (output.t === 'hello') {
            output.features = { ...output.features };
            if (advertisedFeature === undefined) delete output.features.privateMessageContext;
            else output.features.privateMessageContext = advertisedFeature;
        }
        delivered.push({ recipient: id, ...output });
        sockets.get(id)?.send(JSON.stringify(output));
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
