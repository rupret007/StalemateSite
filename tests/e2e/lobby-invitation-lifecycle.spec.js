// Real browser clients and the production engine; all invitations are inert
// synthetic capabilities, and no external application or origin is contacted.
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const FIRST = 'webjam://join?v=3&r=fixture&i=first_synthetic_capability';
const SECOND = 'webjam://join?v=3&r=fixture&i=second_synthetic_capability';
const DRAFT = 'Join my unpublished rehearsal\nwebjam://join?v=3&i=unpublished_synthetic_draft';
const COMPLETE = `Join a synthetic rehearsal on WebJam:\nPaste this entire invitation.\n${FIRST}\nwebjam-signal:V0pTRQ${'x'.repeat(3000)}`;

async function community(browser, baseURL) {
    const { createLobby } = await import('../../hangout-worker/src/lobby-core.mjs');
    const contexts = [], sockets = new Map(), identities = new Map(), inbound = [];
    let at = 1800000000000, serial = 0;
    const engine = createLobby({ now: () => at, send: (id, frame) => sockets.get(id)?.send(JSON.stringify(frame)),
        limits: { defaultSlow: 0, roomPerDevice: 1 } });
    const visitor = async (nick, viewport) => {
        const context = await browser.newContext({ viewport }); contexts.push(context);
        await context.route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL).origin ? route.continue() : route.abort());
        await context.addInitScript(() => {
            window.copiedInvites = []; window.clipboardMode = 'ok';
            Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => {
                window.copiedInvites.push(text);
                if (window.clipboardMode === 'blocked') throw Error('Synthetic clipboard refusal');
                if (window.clipboardMode === 'delayed') return new Promise((resolve, reject) => { window.rejectClipboard = () => reject(Error('Synthetic late refusal')); });
            } } });
        });
        const page = await context.newPage();
        await page.routeWebSocket(url => url.pathname.endsWith('/lobby'), socket => {
            const identity = { id: `socket-${nick}-${++serial}`, dev: `device-${nick}`, iph: `ip-${nick}`, role: 'fan', account: '', admin: false };
            sockets.set(identity.id, socket); identities.set(nick, identity);
            socket.onMessage(raw => { at += 5000; inbound.push({ nick, ...JSON.parse(String(raw)) }); void engine.message(identity.id, String(raw)); });
            socket.onClose(() => { sockets.delete(identity.id); void engine.disconnect(identity.id); });
            engine.connect(identity);
        });
        await page.goto(`/r/45662413410ed051/lobby/?preview=local-preview-key-0001&relay=${encodeURIComponent(hangoutRelayWsBase(baseURL, 'invitation-lifecycle'))}`);
        await page.fill('[data-nick]', nick); await page.click('[data-enter]');
        await expect(page.locator('[data-connection]')).toHaveText('Connected');
        return page;
    };
    return { visitor, inbound,
        disconnect: nick => { const identity = identities.get(nick); engine.disconnect(identity.id); sockets.get(identity.id).close({ code: 1000, reason: 'Synthetic normal disconnect' }); },
        close: () => Promise.all(contexts.map(context => context.close())) };
}
const command = (page, name, args = [], channel) => page.evaluate(({ name, args, channel }) => __lobby.cmd(name, args, channel), { name, args, channel });
const select = (page, room) => page.locator('[data-tabs] [role="tab"]').filter({ hasText: room }).click();
async function create(page, room) {
    await command(page, 'join', [room]); await expect(page.locator('[data-chat-context]')).toHaveText(room);
}
async function invite(host, guest, room, nick) {
    await command(host, 'invite', [nick], room); await command(guest, 'join', [room]);
    await expect(guest.locator('[data-chat-context]')).toHaveText(room);
}
async function share(page, invitation) {
    await page.fill('[data-jam-link]', invitation); await page.locator('[data-jam-form] button[type="submit"]').click();
    await expect(page.locator('[data-jam-copy]')).toBeVisible();
}
async function fallback(page, expected) {
    await page.evaluate(() => { window.clipboardMode = 'blocked'; }); await page.click('[data-jam-copy]');
    await expect(page.locator('[data-jam-copy-value]')).toBeVisible(); await expect(page.locator('[data-jam-copy-value]')).toHaveValue(expected);
}
async function cleared(page) {
    await expect(page.locator('[data-jam-copy-value]')).toHaveValue('');
    await expect(page.locator('[data-jam-copy-fallback]')).toBeHidden();
    await expect(page.locator('[data-jam-link]')).toHaveValue('');
    await expect(page.locator('[data-jam-desktop]')).not.toHaveAttribute('href');
}

test('published fallback and unpublished invite disappear on leave while unrelated chat drafts stay tab-local', async ({ browser, baseURL }, testInfo) => {
    const f = await community(browser, baseURL);
    try {
        const host = await f.visitor('FirstHost', { width: 390, height: 844 });
        await host.fill('[data-text]', 'Unrelated lobby chat draft'); await create(host, '#jam-first');
        await share(host, COMPLETE); await fallback(host, COMPLETE); await host.fill('[data-jam-link]', DRAFT);
        await host.click('[data-leave]'); await expect(host.locator('[data-chat-context]')).toHaveText('#stalemate');
        await cleared(host); await expect(host.locator('[data-text]')).toHaveValue('Unrelated lobby chat draft');
        await host.screenshot({ path: testInfo.outputPath('invitation-cleanup-390.png'), fullPage: true });
    } finally { await f.close(); }
});

test('switching jam rooms clears the unpublished host draft and never shares it to the other room', async ({ browser, baseURL }) => {
    const f = await community(browser, baseURL);
    try {
        const host = await f.visitor('SwitchHost'); await create(host, '#jam-first'); await share(host, FIRST);
        await host.fill('[data-jam-link]', DRAFT); await create(host, '#jam-second');
        await expect(host.locator('[data-jam-link]')).toHaveValue('');
        await host.locator('[data-jam-form]').evaluate(form => form.requestSubmit());
        expect(f.inbound.filter(frame => frame.name === 'jamlink' && frame.ch === '#jam-second')).toEqual([]);
        await share(host, SECOND); await fallback(host, SECOND);
        await select(host, '#jam-first'); await expect(host.locator('[data-jam-link]')).toHaveValue('');
        await host.click('[data-jam-copy]'); await expect(host.locator('[data-jam-copy-value]')).toHaveValue(FIRST);
        expect(await host.evaluate(() => JSON.stringify({ ...sessionStorage, ...localStorage }))).not.toContain(DRAFT);
    } finally { await f.close(); }
});

test('host-power loss clears only unpublished draft; current members can still copy the current invitation', async ({ browser, baseURL }) => {
    const f = await community(browser, baseURL);
    try {
        const host = await f.visitor('PowerHost'), peer = await f.visitor('PowerPeer');
        await create(host, '#jam-power'); await invite(host, peer, '#jam-power', 'PowerPeer');
        await command(host, 'op', ['PowerPeer']); await share(host, FIRST); await fallback(host, FIRST); await host.fill('[data-jam-link]', DRAFT);
        await command(peer, 'away', ['Synthetic break']);
        await expect(host.locator('[data-jam-link]')).toHaveValue(DRAFT);
        await expect(host.locator('[data-jam-copy-value]')).toHaveValue(FIRST);
        await share(peer, SECOND);
        await expect(host.locator('[data-jam-link]')).toHaveValue('');
        await expect(host.locator('[data-jam-copy-value]')).toHaveValue('');
        await fallback(host, SECOND); await host.fill('[data-jam-link]', DRAFT);
        await command(peer, 'deop', ['PowerHost']); await expect(host.locator('[data-jam-form]')).toBeHidden();
        await expect(host.locator('[data-jam-link]')).toHaveValue(''); await fallback(host, SECOND);
        await host.locator('[data-jam-link]').evaluate((input, value) => { input.value = value; }, DRAFT);
        await host.locator('[data-jam-form]').evaluate(form => form.requestSubmit());
        await expect(host.locator('[data-jam-link]')).toHaveValue('');
        expect(f.inbound.some(frame => frame.name === 'jamlink' && frame.args.includes(DRAFT))).toBe(false);
        await command(peer, 'kick', ['PowerHost', 'Synthetic removal']); await expect(host.locator('[data-chat-context]')).toHaveText('#stalemate');
        await cleared(host);
    } finally { await f.close(); }
});

test('disconnect and reconnect remove cached bearer controls and invitation drafts before new admission', async ({ browser, baseURL }) => {
    const f = await community(browser, baseURL);
    try {
        const host = await f.visitor('ReconnectHost'); await create(host, '#jam-reconnect');
        await share(host, FIRST); await fallback(host, FIRST); await host.fill('[data-jam-link]', DRAFT);
        await host.fill('[data-text]', 'Unsent room chat survives the invitation cleanup'); f.disconnect('ReconnectHost');
        await expect(host.locator('[data-connection]')).toHaveText('Offline'); await cleared(host);
        expect(await host.evaluate(() => JSON.stringify([...__lobby.chans.values()]))).not.toContain(FIRST);
        await expect(host.locator('[data-text]')).toHaveValue('Unsent room chat survives the invitation cleanup');
        await host.click('[data-reconnect]'); await expect(host.locator('[data-connection]')).toHaveText('Connected');
        await expect(host.locator('[data-chat-context]')).toHaveText('#stalemate'); await cleared(host);
    } finally { await f.close(); }
});

test('replacement, clear, room changes and disconnect suppress delayed clipboard fallbacks from an old capability', async ({ browser, baseURL }) => {
    const f = await community(browser, baseURL);
    try {
        const host = await f.visitor('RaceHost'), guest = await f.visitor('RaceGuest');
        await create(host, '#jam-race'); await invite(host, guest, '#jam-race', 'RaceGuest'); await share(host, FIRST);
        await fallback(guest, FIRST); await share(host, SECOND);
        await expect(guest.locator('[data-jam-copy-value]')).toHaveValue('');
        await guest.evaluate(() => { window.clipboardMode = 'delayed'; }); await guest.click('[data-jam-copy]');
        await select(guest, '#stalemate'); await select(guest, '#jam-race');
        await guest.evaluate(() => window.rejectClipboard());
        await expect(guest.locator('[data-jam-copy-value]')).toHaveValue('');
        await guest.click('[data-jam-copy]'); await share(host, FIRST);
        await expect.poll(() => guest.evaluate(() => __lobby.chans.get(__lobby.active).jam.invitation)).toBe(FIRST);
        await guest.evaluate(() => window.rejectClipboard());
        await expect(guest.locator('[data-jam-copy-value]')).toHaveValue('');
        await guest.click('[data-jam-copy]');
        await command(host, 'jamlink', ['clear']); await expect(guest.locator('[data-jam-copy]')).toBeHidden();
        await guest.evaluate(() => window.rejectClipboard()); await cleared(guest);
        await share(host, FIRST); await guest.click('[data-jam-copy]'); f.disconnect('RaceGuest');
        await expect(guest.locator('[data-connection]')).toHaveText('Offline');
        await guest.evaluate(() => window.rejectClipboard()); await cleared(guest);
    } finally { await f.close(); }
});
