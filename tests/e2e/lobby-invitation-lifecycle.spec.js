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
    const contexts = [], sockets = new Map(), identities = new Map(), inbound = [], held = new Map();
    let at = 1800000000000, serial = 0;
    const engine = createLobby({ now: () => at, send: (id, frame) => {
        // Freeze the real engine's frame now, and delay the entire connection's
        // outbound stream in FIFO order. Never let later frames overtake it.
        const raw = JSON.stringify(frame), queue = held.get(id);
        if (queue) { if (queue.length >= 1000) throw Error('Synthetic frame hold exceeded its bound'); queue.push(raw); }
        else sockets.get(id)?.send(raw);
    },
        limits: { defaultSlow: 0, roomPerDevice: 1 } });
    const visitor = async (nick, viewport, controls = false) => {
        const context = await browser.newContext({ viewport,
            ...(controls && browser.browserType().name() === 'chromium' ? { permissions: ['local-network-access'] } : {}) }); contexts.push(context);
        await context.route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL).origin ? route.continue() : route.abort());
        if (controls) {
            // Own-status HTTP is synthetic, as in lobby-webjam.spec.js. The
            // actual client handles Stop; this is not native consent proof.
            await context.route(url => url.pathname === '/r/45662413410ed051/lobby/', async route => {
                const response = await route.fetch();
                await route.fulfill({ response, body: (await response.text()).replace('<head>', '<head><script src="/beta/bootstrap.js"></script>') });
            });
            await context.route('**/beta/bootstrap.js', route => route.fulfill({ contentType: 'text/javascript', body: 'window.HangoutParticipationControls=true;' }));
            await context.route('**/beta/participation', route => route.fulfill({ json: {
                ok: true, state: 'authorized', available: true, purposes: ['public-text', 'camera'], revision: 2, canStop: true
            } }));
            await context.route('**/beta/participation/stop', route => route.fulfill({ status: 503, json: { error: 'Synthetic unconfirmed withdrawal' } }));
        }
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
        holdServerFrames: nick => {
            const id = identities.get(nick)?.id;
            if (!sockets.has(id) || held.has(id)) throw Error('Hold requires one live, unheld connection');
            const frames = []; held.set(id, frames);
            return { frames, release: () => {
                if (held.get(id) !== frames) throw Error('Frame hold already released');
                held.delete(id);
                for (const raw of frames) sockets.get(id)?.send(raw);
            } };
        },
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

test('a delayed publication confirmation keeps a newer edit without sharing it', async ({ browser, baseURL }) => {
    const f = await community(browser, baseURL);
    try {
        const host = await f.visitor('EditingHost'), guest = await f.visitor('EditingGuest');
        await create(host, '#jam-editing'); await invite(host, guest, '#jam-editing', 'EditingGuest');
        const held = f.holdServerFrames('EditingHost');
        await host.fill('[data-jam-link]', FIRST); await host.locator('[data-jam-form] button[type="submit"]').click();
        // The independent guest observes actual engine publication while the
        // host's complete ordered response stream remains delayed.
        await expect(guest.locator('[data-jam-copy]')).toBeVisible();
        expect(held.frames.some(raw => JSON.parse(raw).ch?.jam?.invitation === FIRST)).toBe(true);
        await host.fill('[data-jam-link]', DRAFT); held.release();
        await expect(host.locator('[data-jam-copy]')).toBeVisible();
        await expect(host.locator('[data-jam-link]')).toHaveValue(DRAFT);
        expect(f.inbound.filter(frame => frame.name === 'jamlink').map(frame => frame.args)).toEqual([['invitation', FIRST]]);
        expect(await host.evaluate(() => JSON.stringify({ ...sessionStorage, ...localStorage }))).not.toContain(DRAFT);
    } finally { await f.close(); }
});

test('a delayed confirmation from another room cannot clear or share the current room draft', async ({ browser, baseURL }) => {
    const f = await community(browser, baseURL);
    try {
        const host = await f.visitor('DelayedHost'), guest = await f.visitor('DelayedGuest');
        await create(host, '#jam-origin'); await invite(host, guest, '#jam-origin', 'DelayedGuest');
        await create(host, '#jam-current'); await share(host, SECOND); await select(host, '#jam-origin');
        const held = f.holdServerFrames('DelayedHost');
        await host.fill('[data-jam-link]', FIRST); await host.locator('[data-jam-form] button[type="submit"]').click();
        await expect(guest.locator('[data-jam-copy]')).toBeVisible();
        expect(held.frames.some(raw => JSON.parse(raw).ch?.jam?.invitation === FIRST)).toBe(true);
        await select(host, '#jam-current'); await host.fill('[data-jam-link]', DRAFT); held.release();
        await expect.poll(() => host.evaluate(() => __lobby.chans.get('#jam-origin').jam.invitation)).toBe(FIRST);
        await expect(host.locator('[data-chat-context]')).toHaveText('#jam-current');
        await expect(host.locator('[data-jam-link]')).toHaveValue(DRAFT);
        expect(f.inbound.filter(frame => frame.name === 'jamlink' && frame.ch === '#jam-current').map(frame => frame.args)).toEqual([['invitation', SECOND]]);
        await select(host, '#jam-origin'); await expect(host.locator('[data-jam-link]')).toHaveValue('');
        await fallback(host, FIRST);
    } finally { await f.close(); }
});

test('local Stop purges a pending paste before a delayed publication confirmation arrives', async ({ browser, baseURL }) => {
    const f = await community(browser, baseURL);
    try {
        const host = await f.visitor('PendingStopHost', { width: 375, height: 812 }, true), guest = await f.visitor('PendingStopGuest');
        await create(host, '#jam-pendingstop'); await invite(host, guest, '#jam-pendingstop', 'PendingStopGuest');
        const held = f.holdServerFrames('PendingStopHost');
        await host.fill('[data-jam-link]', FIRST); await host.locator('[data-jam-form] button[type="submit"]').click();
        await expect(guest.locator('[data-jam-copy]')).toBeVisible();
        expect(held.frames.some(raw => JSON.parse(raw).ch?.jam?.invitation === FIRST)).toBe(true);
        await host.fill('[data-jam-link]', DRAFT);
        await host.locator('[data-sharing-controls] summary').click();
        await host.click('[data-sharing-stop]'); await host.click('[data-sharing-accept]');
        await expect(host.locator('[data-sharing-status]')).toContainText('could not be confirmed');
        await cleared(host); held.release();
        // A real later chat event is an ordered delivery barrier, without
        // requiring stopped clients to retain the old invitation in memory.
        await command(guest, 'me', ['Synthetic delivery barrier']);
        await expect(host.locator('[data-buffer]')).toContainText('Synthetic delivery barrier');
        await expect(host.locator('[data-jam]')).toBeHidden(); await cleared(host);
        await expect(host.locator('[data-text]')).toBeDisabled();
        expect(await host.evaluate(() => __lobby.localMediaPaused)).toBe(true);
        expect(f.inbound.filter(frame => frame.name === 'jamlink').map(frame => frame.args)).toEqual([['invitation', FIRST]]);
        // The guest already received the capability; local Stop does not
        // revoke a copied invitation or falsely claim server withdrawal.
        await expect(guest.locator('[data-jam-copy]')).toBeVisible();
    } finally { await f.close(); }
});

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
