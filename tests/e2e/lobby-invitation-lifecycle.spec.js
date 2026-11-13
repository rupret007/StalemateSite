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
    const engine = createLobby({ gameNight: true, now: () => at, send: (id, frame) => {
        // Freeze the real engine's frame now, and delay the entire connection's
        // outbound stream in FIFO order. Never let later frames overtake it.
        const raw = JSON.stringify(frame), queue = held.get(id);
        if (queue) { if (queue.length >= 1000) throw Error('Synthetic frame hold exceeded its bound'); queue.push(raw); }
        else sockets.get(id)?.send(raw);
    },
        limits: { defaultSlow: 0, roomPerDevice: 1 } });
    const visitor = async (nick, viewport, controls = false, via = '') => {
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
        await page.goto(`/r/45662413410ed051/lobby/?preview=local-preview-key-0001&relay=${encodeURIComponent(hangoutRelayWsBase(baseURL, 'invitation-lifecycle'))}${via ? `&via=${encodeURIComponent(via)}` : ''}`);
        await page.fill('[data-nick]', nick); await page.click('[data-enter]');
        await expect(page.locator('[data-connection]')).toHaveText('Connected');
        return page;
    };
    return { visitor, inbound, advance: ms => { at += ms; },
        holdServerFrames: nick => {
            const id = identities.get(nick)?.id;
            if (!sockets.has(id) || held.has(id)) throw Error('Hold requires one live, unheld connection');
            const frames = []; held.set(id, frames);
            return { frames, releaseThrough: predicate => {
                if (held.get(id) !== frames) throw Error('Frame hold already released');
                const index = frames.findIndex(raw => predicate(JSON.parse(raw)));
                if (index < 0) throw Error('Ordered release requires an existing real frame');
                for (const raw of frames.splice(0, index + 1)) sockets.get(id)?.send(raw);
            }, release: () => {
                if (held.get(id) !== frames) throw Error('Frame hold already released');
                held.delete(id);
                for (const raw of frames) sockets.get(id)?.send(raw);
            } };
        },
        disconnect: (nick, code = 1000) => { const identity = identities.get(nick); engine.disconnect(identity.id); sockets.get(identity.id).close({ code, reason: 'Synthetic disconnect' }); },
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

test('a newer rejected share stays editable when an earlier publication arrives late', async ({ browser, baseURL }) => {
    const f = await community(browser, baseURL);
    const rejected = 'https://unapproved.example/join/#newer_unpublished_fixture';
    try {
        const host = await f.visitor('OrderHost'), guest = await f.visitor('OrderGuest');
        await create(host, '#jam-order'); await invite(host, guest, '#jam-order', 'OrderGuest');
        const held = f.holdServerFrames('OrderHost');
        await host.fill('[data-jam-link]', FIRST); await host.locator('[data-jam-form] button[type="submit"]').click();
        await expect(guest.locator('[data-jam-copy]')).toBeVisible();
        await host.fill('[data-jam-link]', rejected);
        const submit = host.locator('[data-jam-form] button[type="submit"]');
        await expect(submit).toBeDisabled();
        // Programmatic submission must not bypass the same single-flight bound.
        await host.locator('[data-jam-form]').evaluate(form => form.requestSubmit());
        expect(f.inbound.filter(frame => frame.name === 'jamlink')).toHaveLength(1);
        held.release();
        await expect(submit).toBeEnabled();
        await expect(host.locator('[data-jam-link]')).toHaveValue(rejected);
        await submit.click();
        await expect(host.locator('[data-toast]')).toContainText('Browser joining is not configured');
        await expect(host.locator('[data-jam-link]')).toHaveValue(rejected);
        expect(await guest.evaluate(() => __lobby.chans.get(__lobby.active).jam.invitation)).toBe(FIRST);
        expect(f.inbound.filter(frame => frame.name === 'jamlink').map(frame => frame.args)).toEqual([['invitation', FIRST], ['web', rejected]]);
        const ids = f.inbound.filter(frame => frame.name === 'jamlink').map(frame => frame.jamRequestId);
        expect(ids).toHaveLength(2); expect(ids[0]).toMatch(/^[a-f0-9]{32}$/); expect(ids[1]).toMatch(/^[a-f0-9]{32}$/);
        expect(ids[0]).not.toBe(ids[1]);
    } finally { await f.close(); }
});

test('an old room share result cannot complete the new room request', async ({ browser, baseURL }) => {
    const f = await community(browser, baseURL);
    try {
        const host = await f.visitor('ReceiptHost'), guest = await f.visitor('ReceiptGuest');
        await create(host, '#jam-receiptold'); await invite(host, guest, '#jam-receiptold', 'ReceiptGuest');
        await create(host, '#jam-receiptnew'); await select(host, '#jam-receiptold');
        const held = f.holdServerFrames('ReceiptHost');
        await host.fill('[data-jam-link]', FIRST); await host.locator('[data-jam-form] button[type="submit"]').click();
        await expect(guest.locator('[data-jam-copy]')).toBeVisible();
        // This real later presence frame is a delivery barrier after the old
        // result. It is queued before the new room's request, preserving FIFO.
        await command(guest, 'away', ['Receipt barrier']);
        await expect.poll(() => guest.evaluate(() => __lobby.chans.get('#jam-receiptold').names.some(n => n.nick === 'ReceiptGuest' && n.away))).toBe(true);
        await select(host, '#jam-receiptnew'); await host.fill('[data-jam-link]', SECOND);
        const submit = host.locator('[data-jam-form] button[type="submit"]'); await submit.click();
        await expect.poll(() => f.inbound.filter(frame => frame.name === 'jamlink').length).toBe(2);
        const requests = f.inbound.filter(frame => frame.name === 'jamlink');
        await expect.poll(() => held.frames.some(raw => JSON.parse(raw).id === requests[1]?.jamRequestId && JSON.parse(raw).t === 'jam-share-result')).toBe(true);
        held.releaseThrough(frame => frame.t === 'chan' && frame.ch.name === '#jam-receiptold' && frame.ch.names.some(n => n.nick === 'ReceiptGuest' && n.away));
        await expect.poll(() => host.evaluate(() => __lobby.chans.get('#jam-receiptold').names.some(n => n.nick === 'ReceiptGuest' && n.away))).toBe(true);
        await expect(host.locator('[data-jam-link]')).toHaveValue(SECOND); await expect(submit).toBeDisabled();
        held.release(); await expect(submit).toBeEnabled(); await expect(host.locator('[data-jam-link]')).toHaveValue('');
        expect(requests[0].jamRequestId).not.toBe(requests[1].jamRequestId);
    } finally { await f.close(); }
});

test('an unconfirmed share keeps one request and an editable paste without automatic retry', async ({ browser, baseURL }, testInfo) => {
    const f = await community(browser, baseURL);
    try {
        const host = await f.visitor('WaitingHost', { width: 390, height: 844 }), guest = await f.visitor('WaitingGuest');
        await create(host, '#jam-waiting'); await invite(host, guest, '#jam-waiting', 'WaitingGuest');
        const held = f.holdServerFrames('WaitingHost');
        await host.fill('[data-jam-link]', FIRST); await host.locator('[data-jam-form] button[type="submit"]').click();
        await expect(guest.locator('[data-jam-copy]')).toBeVisible();
        await expect(host.locator('[data-jam-share-status]')).toContainText('Still waiting', { timeout: 10000 });
        await expect(host.locator('[data-connection]')).toHaveText('Connected');
        await expect(host.locator('[data-jam-link]')).toHaveValue(FIRST);
        await host.screenshot({ path: testInfo.outputPath('jam-share-waiting-390.png'), fullPage: true });
        await host.fill('[data-jam-link]', DRAFT); await host.locator('[data-jam-form]').evaluate(form => form.requestSubmit());
        expect(f.inbound.filter(frame => frame.name === 'jamlink')).toHaveLength(1);
        held.release(); await expect(host.locator('[data-jam-form] button[type="submit"]')).toBeEnabled();
        await expect(host.locator('[data-jam-link]')).toHaveValue(DRAFT);
        await expect(host.locator('[data-jam-share-status]')).toHaveText('Invitation shared.');
        await host.click('[data-leave]'); await cleared(host);
        await expect(host.locator('[data-jam-share-status]')).toHaveText('');
    } finally { await f.close(); }
});

for (const late of [false, true]) test(`a published invitation unlocks Share if its separate result is lost (${late ? 'late room state' : 'early room state'})`, async ({ browser, baseURL }) => {
    const f = await community(browser, baseURL);
    try {
        const host = await f.visitor('LostResultHost'), guest = await f.visitor('LostResultGuest');
        await create(host, '#jam-lostresult');
        await invite(host, guest, '#jam-lostresult', 'LostResultGuest');
        await host.clock.install();
        const held = f.holdServerFrames('LostResultHost');
        const submit = host.locator('[data-jam-form] button[type="submit"]');
        await host.fill('[data-jam-link]', FIRST);
        await submit.click();
        await expect(guest.locator('[data-jam-copy]')).toBeVisible();
        const request = f.inbound.find(frame => frame.name === 'jamlink');
        await expect.poll(() => held.frames.some(raw => {
            const frame = JSON.parse(raw);
            return frame.t === 'jam-share-result' && frame.id === request.jamRequestId;
        })).toBe(true);
        if (late) {
            await host.clock.runFor(8_500);
            await expect(host.locator('[data-jam-share-status]')).toContainText('Still waiting');
            await expect(submit).toBeDisabled();
        }
        held.releaseThrough(frame => frame.t === 'chan' && frame.ch.jam?.invitation === FIRST);
        const resultIndex = held.frames.findIndex(raw => {
            const frame = JSON.parse(raw);
            return frame.t === 'jam-share-result' && frame.id === request.jamRequestId;
        });
        expect(resultIndex).toBeGreaterThanOrEqual(0);
        held.frames.splice(resultIndex, 1);
        held.release();
        await expect(host.locator('[data-jam-copy]')).toBeVisible();
        await host.fill('[data-jam-link]', DRAFT);
        await expect(submit).toBeDisabled();
        await host.clock.runFor(late ? 500 : 8_500);
        await expect(submit).toBeEnabled();
        await expect(host.locator('[data-jam-share-status]')).toHaveText('Invitation is available in the room. Your paste is kept.');
        await expect(host.locator('[data-jam-link]')).toHaveValue(DRAFT);
        expect(f.inbound.filter(frame => frame.name === 'jamlink')).toHaveLength(1);

        await submit.click();
        await expect(host.locator('[data-jam-share-status]')).toHaveText('Invitation shared.');
        await expect(host.locator('[data-jam-link]')).toHaveValue('');
        await expect.poll(() => guest.evaluate(expected => __lobby.chans.get(__lobby.active).jam.invitation === expected, DRAFT)).toBe(true);
        expect(f.inbound.filter(frame => frame.name === 'jamlink').map(frame => frame.args)).toEqual([
            ['invitation', FIRST], ['invitation', DRAFT]
        ]);
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

test('a co-host can kick or ban after the founder leaves and the guest can tell which happened', async ({ browser, baseURL }) => {
    const f = await community(browser, baseURL);
    try {
        const host = await f.visitor('RoomFounder', undefined, false, 'stalemate');
        const cohost = await f.visitor('GuestCohost', undefined, false, 'rad-dad');
        const guest = await f.visitor('RoomVisitor', undefined, false, 'stalemate');
        const room = '#room-handoff';
        await host.locator('[data-start="chat"]').click();
        await host.getByLabel('Channel name').fill(room);
        await host.getByRole('button', { name: 'Join / create' }).click();
        await expect(host.locator('[data-chat-context]')).toHaveText(room);

        const join = page => page.locator(`[data-roomlist] button[data-room="${room}"]`).click();
        for (const page of [cohost, guest]) {
            await join(page);
            await expect(page.locator('[data-chat-context]')).toHaveText(room);
            await expect(page.locator('[data-roomtools]')).toBeHidden();
        }
        const person = (page, nick) => page.locator('[data-nicks] button.nick').filter({ hasText: new RegExp(`^${nick}$`) });
        await person(host, 'GuestCohost').click();
        await host.getByRole('button', { name: 'Make @', exact: true }).click();
        await expect(cohost.locator('[data-roomtools]')).toBeVisible();
        await host.locator('[data-leave]').click();
        await expect(host.locator('[data-chat-context]')).toHaveText('#stalemate');
        await expect(cohost.locator('[data-roomtools]')).toBeVisible();

        await person(cohost, 'RoomVisitor').click();
        await cohost.getByRole('button', { name: 'Kick', exact: true }).click();
        await expect(guest.locator('[data-chat-context]')).toHaveText('#stalemate');
        await expect(guest.locator('[data-toast]')).toHaveText(`Kicked from ${room} by GuestCohost: take a breather`);
        await join(guest);
        await expect(guest.locator('[data-buffer]')).toContainText(`Kicked from ${room} recently.`);

        const { LOBBY_LIMITS } = await import('../../hangout-worker/src/lobby-core.mjs');
        f.advance(LOBBY_LIMITS.kickCooldown);
        await join(guest);
        await expect(guest.locator('[data-chat-context]')).toHaveText(room);
        await person(cohost, 'RoomVisitor').click();
        cohost.once('dialog', dialog => dialog.accept('Room rule broken'));
        await cohost.getByRole('button', { name: 'Ban', exact: true }).click();
        await expect(guest.locator('[data-chat-context]')).toHaveText('#stalemate');
        await expect(guest.locator('[data-toast]')).toHaveText(`Banned from ${room} by GuestCohost: Room rule broken`);
        await join(guest);
        await expect(guest.locator('[data-buffer]')).toContainText(`You're banned from ${room}.`);
        await expect(guest.locator('[data-connection]')).toHaveText('Connected');
        await expect(cohost.locator('[data-chat-context]')).toHaveText(room);
        await guest.locator('[data-text]').fill('Still here in the lobby');
        await guest.locator('[data-text]').press('Enter');
        await expect(host.locator('[data-buffer]')).toContainText('Still here in the lobby');
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

test('Game Night invites players, publishes a Discord handoff and keeps chat usable on phones', async ({ browser, baseURL }, testInfo) => {
    const fixture = await community(browser, baseURL);
    const link = 'https://discord.gg/GameNightFixture';
    try {
        const host = await fixture.visitor('GameHost', { width: 1280, height: 850 });
        const guest = await fixture.visitor('GameGuest', { width: 390, height: 844 });
        const discordRequests = [];
        await guest.context().route(link, route => {
            discordRequests.push(route.request().headers().referer);
            return route.fulfill({ body: 'Synthetic Discord destination' });
        });
        await host.getByRole('button', { name: /Game Night/ }).click();
        await host.getByRole('region', { name: /Game Night/ }).getByRole('button', { name: 'Invite players' }).click();
        await host.getByRole('button', { name: 'Invite GameGuest', exact: true }).click();
        await guest.getByRole('button', { name: 'Join Game Night' }).click();
        const panel = guest.getByRole('region', { name: /Game Night/ });
        const open = panel.getByRole('link', { name: 'Open Discord call' });
        await expect(panel).toBeVisible();
        const arcade = panel.getByRole('link', { name: 'Open Stalemate Arcade' });
        await expect(arcade).toHaveAttribute('href', 'https://stalemate.band/play/');
        await expect(arcade).toHaveAccessibleDescription('Opens in a new tab');
        await expect(open).toHaveCount(0);
        await expect(panel.getByText('Manage Discord link')).toBeHidden();
        await expect(guest.locator('[data-cam]')).toBeHidden();

        await host.getByText('Manage Discord link').click();
        const input = host.getByLabel('Discord invite or voice channel link');
        await input.fill('https://discord.gg.invalid/example');
        await host.getByRole('button', { name: 'Share link' }).click();
        await expect(host.locator('[data-game-error]')).toContainText('Paste a Discord invite');
        await input.fill(link);
        await host.getByRole('button', { name: 'Share link' }).click();
        await expect(open).toHaveAttribute('href', link);
        await expect(open).toHaveAttribute('target', '_blank');
        await expect(open).toHaveAttribute('referrerpolicy', 'no-referrer');
        expect(discordRequests).toHaveLength(0);
        const [popup] = await Promise.all([guest.waitForEvent('popup'), open.click()]);
        await expect(popup.locator('body')).toHaveText('Synthetic Discord destination');
        expect(discordRequests).toEqual([undefined]);
        await popup.close();
        for (const width of [390, 375]) {
            await guest.setViewportSize({ width, height: 844 });
            await expect(guest.locator('[data-send]')).toBeInViewport();
            expect(await guest.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
            await guest.screenshot({ path: testInfo.outputPath(`game-night-${width}.png`), animations: 'disabled' });
        }

        await guest.locator('[data-text]').fill('Anyone up for a round?');
        await guest.locator('[data-send]').click();
        await expect(host.locator('[data-chat-lines]')).toContainText('Anyone up for a round?');
        await guest.locator('[data-four] summary').click();
        await expect(guest.locator('[data-game-call-status]')).toBeHidden();
        await expect(open).toBeVisible();
        await host.getByRole('button', { name: 'Remove link' }).click();
        await expect(guest.locator('[data-game-open]')).not.toHaveAttribute('href', /./);
    } finally {
        await fixture.close();
    }
});

test('Game Night plays one shared Four in a Row match with the chat composer still visible', async ({ browser, baseURL }, testInfo) => {
    const fixture = await community(browser, baseURL);
    try {
        const host = await fixture.visitor('FourHost', { width: 1280, height: 850 });
        const guest = await fixture.visitor('FourGuest', { width: 390, height: 844 });
        await host.getByRole('button', { name: /Game Night/ }).click();
        await host.getByRole('button', { name: 'Invite players' }).click();
        await host.getByRole('button', { name: 'Invite FourGuest', exact: true }).click();
        await guest.getByRole('button', { name: 'Join Game Night' }).click();
        await expect(guest.getByRole('tab', { name: 'Game Night' })).toHaveAttribute('aria-selected', 'true');
        await host.locator('[data-four] summary').click();
        await guest.locator('[data-four] summary').click();
        await host.getByRole('button', { name: 'Open a match' }).click();
        await expect(host.locator('[data-four-status]')).toContainText('Waiting');
        await expect(host.locator('[data-four-player="O"]')).toHaveText('Open seat');
        await guest.getByRole('button', { name: 'Join match' }).click();
        await expect(guest.locator('[data-four-player="X"]')).toHaveText('FourHost');
        await expect(guest.locator('[data-four-player="O"]')).toHaveText('FourGuest');
        await expect(host.locator('[data-four-status]')).toHaveText('Your turn (X).');
        await expect(guest.getByRole('button', { name: 'Drop in column 1' })).toHaveAttribute('aria-disabled', 'true');
        const drop = (page, column) => page.getByRole('button', { name: `Drop in column ${column}` });
        await drop(host, 1).press('Enter');
        await expect(guest.locator('[data-four-status]')).toHaveText('X played column 1. Your turn (O).');
        await expect(guest.locator('[data-four-table] [data-last]')).toHaveText('X');
        await guest.setViewportSize({ width: 375, height: 844 });
        await expect(guest.getByRole('table', { name: 'Four in a Row board' }).locator('tr').last()).toBeInViewport({ ratio: 1 });
        await expect(guest.locator('[data-send]')).toBeInViewport();
        await drop(guest, 7).click();
        for (let column = 2; column <= 3; column++) {
            await drop(host, column).click();
            await drop(guest, 7).click();
        }
        await drop(host, 4).click();
        await expect(guest.locator('[data-four-status]')).toHaveText('X played column 4. X wins.');
        await expect(guest.getByRole('table', { name: 'Four in a Row board' }).locator('tbody tr').last().locator('[data-mark="X"][data-winning]')).toHaveCount(4);
        await host.screenshot({ path: testInfo.outputPath('four-in-a-row-desktop.png'), animations: 'disabled' });
        for (const width of [390, 375]) {
            await guest.setViewportSize({ width, height: 844 });
            await expect(guest.getByRole('table', { name: 'Four in a Row board' }).locator('tr').last()).toBeInViewport({ ratio: 1 });
            await expect(guest.locator('[data-send]')).toBeInViewport();
            expect(await guest.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
            await guest.screenshot({ path: testInfo.outputPath(`four-in-a-row-${width}.png`), animations: 'disabled' });
        }
        await guest.setViewportSize({ width: 640, height: 356 });
        await expect(guest.locator('[data-buffer]')).toHaveCSS('min-height', '64px');
        expect((await guest.locator('[data-buffer]').boundingBox()).height).toBeGreaterThanOrEqual(64);
        await guest.locator('[data-text]').scrollIntoViewIfNeeded();
        await expect(guest.locator('[data-send]')).toBeInViewport();
        await host.locator('[data-text]').fill('Can you read this while playing?');
        await host.locator('[data-send]').click();
        const reply = guest.locator('[data-chat-lines]').getByText('Can you read this while playing?');
        await reply.scrollIntoViewIfNeeded();
        expect(await reply.evaluate(line => {
            const bounds = line.getBoundingClientRect();
            return line.contains(document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2));
        })).toBe(true);
        await guest.setViewportSize({ width: 375, height: 667 });
        const landingRow = guest.locator('[data-four-table] tbody tr').last();
        await landingRow.evaluate(row => row.scrollIntoView({ block: 'nearest' }));
        await expect(landingRow).toBeInViewport({ ratio: 1 });
        const columns = guest.locator('[data-four-columns]');
        await expect(columns).toBeInViewport({ ratio: 1 });
        const rowBounds = await landingRow.boundingBox();
        const columnBounds = await columns.boundingBox();
        expect(rowBounds.y).toBeGreaterThanOrEqual(columnBounds.y + columnBounds.height);
        await guest.locator('[data-text]').fill('Good game');
        await guest.locator('[data-send]').click();
        await expect(host.locator('[data-chat-lines]')).toContainText('Good game');
        await host.getByRole('button', { name: 'Play again' }).click();
        await guest.getByRole('button', { name: 'Join match' }).click();
        await guest.getByRole('button', { name: 'Leave match' }).click();
        await expect(host.locator('[data-four-status]')).toHaveText('Match ended. A host can open another.');
        await expect(host.getByRole('button', { name: 'Open a match' })).toBeVisible();
    } finally {
        await fixture.close();
    }
});

test('Game Night keeps invitations actionable and offers a safe return after a disconnect or refresh', async ({ browser, baseURL }) => {
    const fixture = await community(browser, baseURL);
    try {
        const host = await fixture.visitor('ReturnHost', { width: 1280, height: 850 });
        const guest = await fixture.visitor('ReturnGuest', { width: 375, height: 667 });
        await host.getByRole('button', { name: /Game Night/ }).click();
        const roomTab = guest.getByRole('tab', { name: 'Game Night' });
        const offer = guest.locator('[data-game-offer]');
        const roomSection = guest.getByRole('navigation', { name: 'Sections' }).locator('[data-show="rooms"]');
        await roomSection.click();
        await guest.clock.install();
        const invitePlayer = async () => {
            await host.getByRole('button', { name: 'Invite players' }).click();
            await host.getByRole('button', { name: 'Invite ReturnGuest', exact: true }).click();
            await expect(offer).toContainText('ReturnHost invited you to Game Night.');
        };
        await invitePlayer();
        await guest.getByRole('button', { name: 'Not now', exact: true }).press('Enter');
        await expect(offer).toBeHidden();
        await expect(roomSection).toBeFocused();
        await invitePlayer();
        await guest.clock.runFor(13_000);
        const join = offer.getByRole('button', { name: 'Join Game Night' });
        await expect(join).toBeVisible();
        await join.press('Enter');
        await expect(roomTab).toBeFocused();
        await expect(offer).toBeHidden();
        await expect(guest.locator('[data-four]')).not.toHaveAttribute('open', '');

        await host.locator('[data-four] summary').click();
        await host.getByRole('button', { name: 'Open a match' }).dblclick();
        await expect(host.getByRole('button', { name: 'Close match' })).toBeVisible();
        await expect(guest.locator('[data-four-availability]')).toContainText('has an open seat');
        await guest.getByRole('button', { name: 'Join match' }).press('Enter');
        await expect(guest.locator('[data-four-status]')).toBeFocused();
        await guest.keyboard.press('Enter');
        await expect(host.locator('[data-four-status]')).toHaveText('Your turn (X).');
        await expect(guest.getByRole('button', { name: 'Leave match' })).toBeVisible();
        await host.getByRole('button', { name: 'Drop in column 1' }).press('Enter');
        await expect(guest.locator('[data-four-status]')).toContainText('X played column 1');

        fixture.disconnect('ReturnGuest', 1012);
        await expect(host.locator('[data-four-status]')).toContainText('Match ended');
        await expect(offer).toContainText('Game Night disconnected. Return to the room to check your match.');
        await offer.getByRole('button', { name: 'Return to room' }).click();
        await expect(roomTab).toBeFocused();
        await expect(guest.locator('[data-four-table]')).toBeHidden();

        await guest.reload();
        await guest.locator('[data-nick]').fill('ReturnGuest');
        await guest.locator('[data-enter]').click();
        await offer.getByRole('button', { name: 'Return to room' }).press('Enter');
        await expect(roomTab).toBeFocused();
        await guest.locator('[data-leave]').press('Enter');
        await expect(guest.getByRole('tab', { name: '#stalemate', exact: true })).toBeFocused();
        await expect(offer).toBeHidden();
        expect(await guest.evaluate(() => sessionStorage.getItem('hangout-game-return'))).toBeNull();
    } finally {
        await fixture.close();
    }
});

for (const width of [375, 390, 1280]) test(`a Jam room invitation stays actionable and a dropped or refreshed bandmate can return at ${width}px`, async ({ browser, baseURL }, testInfo) => {
    const fixture = await community(browser, baseURL);
    try {
        const host = await fixture.visitor('JamHost', { width: 1280, height: 850 });
        const guest = await fixture.visitor('JamGuest', { width, height: width > 500 ? 850 : 667 });
        await host.locator('[data-start="jam"]').click();
        await expect(host.locator('[data-jam]')).toBeVisible();
        const room = await host.locator('[data-chat-context]').textContent();
        const offer = guest.locator('[data-game-offer]'), roomTab = guest.getByRole('tab', { name: room });
        const context = guest.locator('[data-chat-context]');
        // The offer waits for an answer, so it must not cover the composer or
        // widen the page while it is showing.
        const composerClear = () => guest.evaluate(() => {
            const say = document.querySelector('[data-say]').getBoundingClientRect();
            const notices = document.querySelector('.irc-notices').getBoundingClientRect();
            return notices.height > 0 && say.height > 0 && say.bottom <= notices.top && document.documentElement.scrollWidth <= innerWidth;
        });
        const enter = async page => {
            await page.locator('[data-nick]').fill(page === host ? 'JamHost' : 'JamGuest');
            await page.locator('[data-enter]').click();
            await expect(page.locator('[data-connection]')).toHaveText('Connected');
        };
        const inviteGuest = async () => {
            await host.locator('[data-jam-invite-room]').click();
            await host.getByRole('button', { name: 'Invite JamGuest', exact: true }).click();
            await expect(offer).toContainText(`JamHost invited you to ${room}.`);
        };
        await guest.clock.install();
        await inviteGuest();
        // The earlier invitation was a notice that disappeared after twelve
        // seconds, leaving no way into an invite-only room.
        await guest.clock.runFor(13_000);
        const join = offer.getByRole('button', { name: 'Join room', exact: true });
        await expect(join).toBeVisible();
        await expect(guest.locator('[data-toast]')).toBeHidden();
        expect(await composerClear()).toBe(true);
        await guest.screenshot({ path: testInfo.outputPath(`jam-room-invitation-${width}.png`) });
        await join.press('Enter');
        await expect(context).toHaveText(room);
        await expect(roomTab).toBeFocused();
        await expect(offer).toBeHidden();
        await expect(guest.locator('[data-jam]')).toBeVisible();

        // A rehearsal lasts longer than the return window measured from the
        // last tab switch. A late connection drop still offers the room.
        await guest.clock.fastForward(45 * 60 * 1000);
        fixture.disconnect('JamGuest', 1012);
        await expect(offer).toContainText(`You were disconnected from ${room}.`);
        await expect(context).toHaveText('#stalemate');
        expect(await composerClear()).toBe(true);
        await guest.screenshot({ path: testInfo.outputPath(`jam-room-return-${width}.png`) });
        await offer.getByRole('button', { name: 'Return to room', exact: true }).press('Enter');
        await expect(context).toHaveText(room);
        await expect(roomTab).toBeFocused();
        await expect(offer).toBeHidden();

        // Leaving on purpose is not a disconnect. A fresh invitation is needed.
        await guest.locator('[data-leave]').press('Enter');
        await expect(context).toHaveText('#stalemate');
        await expect(offer).toBeHidden();
        expect(await guest.evaluate(() => sessionStorage.getItem('hangout-game-return'))).toBeNull();
        await inviteGuest();
        await offer.getByRole('button', { name: 'Join room', exact: true }).click();
        await expect(context).toHaveText(room);

        // The host can refresh without losing the room or their bandmate.
        await host.reload();
        await enter(host);
        await host.locator('[data-game-offer]').getByRole('button', { name: 'Return to room', exact: true }).click();
        await expect(host.locator('[data-chat-context]')).toHaveText(room);
        await expect(host.locator('[data-jam-invite-room]')).toBeVisible();

        // A refreshed bandmate is offered the same room. If the host closed it
        // meanwhile, the stale offer says so and goes away.
        await guest.reload();
        await enter(guest);
        const comeBack = offer.getByRole('button', { name: 'Return to room', exact: true });
        await expect(comeBack).toBeVisible();
        await command(host, 'close', [], room);
        await expect(host.locator('[data-chat-context]')).toHaveText('#stalemate');
        await comeBack.click();
        await expect(guest.locator('[data-toast]')).toContainText(`Couldn’t join ${room}. It may have closed.`);
        await expect(offer).toBeHidden();
        await expect(context).toHaveText('#stalemate');
        expect(await guest.evaluate(() => sessionStorage.getItem('hangout-game-return'))).toBeNull();
    } finally {
        await fixture.close();
    }
});
