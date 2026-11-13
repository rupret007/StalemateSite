const { createHash, randomBytes } = require('node:crypto');
const { test, expect, chromium, webkit, devices } = require('@playwright/test');

const iphone = devices['iPhone 13'];
const EXPIRED_LINE = 'This invitation has expired, was used, or the game is no longer waiting for a guest. Ask your host for a new invite.';
const FULL_LINE = "Table full, you're up next game";
const HOST_LINE = 'You are hosting this table and already have a seat.';
const secret = () => randomBytes(32).toString('base64url');
const digest = value => createHash('sha256').update(value).digest('hex');

const CHESS = { room: '#game-abcdefxabcdef', ref: 'a'.repeat(32), match: 'match-chess-0001', host: 'host-session-0001' };
const SCOPE = { room: CHESS.room, ref: CHESS.ref, game: 'chess', match: CHESS.match };

async function realBench(now = () => 1_700_000_000_000) {
    const adapter = await import('./support/bridge-grants-adapter.mjs');
    const { randomBytes } = await import('node:crypto');
    const bench = adapter.createChessBench({ now });
    expect(bench.openTable(CHESS)).toBe(true);
    const register = async values => bench.grants.registerGrants({
        room: CHESS.room, ref: CHESS.ref, match: CHESS.match, game: 'chess', hostSubject: CHESS.host,
        hashes: await Promise.all(values.map(adapter.hashGrant)), now: now()
    });
    return { adapter, bench, grants: bench.grants, register, fresh: () => randomBytes(16).toString('hex') };
}

test.describe('worker module grant cases (real module, real Chess table, in-process)', () => {
    test('reused grant returns the existing 410 expired shape', async () => {
        const { adapter, bench, grants, register, fresh } = await realBench();
        expect(adapter.USING_STAND_IN).toBe(false);
        const raw = fresh();
        expect((await register([raw])).status).toBe(200);
        expect((await grants.redeemGrant({ value: raw, now: 1_700_000_000_000 })).status).toBe(200);
        const replay = adapter.grantResponse(await grants.redeemGrant({ value: raw, now: 1_700_000_000_000 }));
        expect(replay.status).toBe(410);
        expect(await replay.json()).toEqual({ error: adapter.EXPIRED_ERROR });
        expect(bench.stored().includes(raw)).toBe(false);
    });

    test('a host session cannot claim a guest grant', async () => {
        const { bench, grants, register, fresh } = await realBench();
        const raw = fresh();
        await register([raw]);
        expect((await grants.redeemGrant({ value: raw, subject: CHESS.host, now: 1_700_000_000_000 })).status).toBe(403);
        expect(bench.grantRows().map(row => row.kind)).toEqual(['grant']);
        expect(await grants.redeemGrant({ value: raw, now: 1_700_000_000_000 })).toMatchObject({ status: 200, seat: 'b' });
        expect(bench.table(SCOPE).seats.w).toBe(CHESS.host);
    });

    test('an expired hold leaves the host table waiting', async () => {
        let at = 1_700_000_000_000;
        const { adapter, bench, grants, register, fresh } = await realBench(() => at);
        const raw = fresh();
        await register([raw]);
        at += adapter.GRANT_TTL_MS;
        expect(await grants.sweep(at)).toEqual({ expired: 1, released: 1 });
        expect(bench.table(SCOPE)).toEqual({ present: true, id: CHESS.match, status: 'waiting', seats: { w: CHESS.host, b: null } });
        expect((await grants.redeemGrant({ value: raw, now: at })).status).toBe(410);
    });

    test('the extra person gets the table-full line after the guest sits', async () => {
        const { adapter, bench, grants, register, fresh } = await realBench();
        const first = fresh(), extra = fresh();
        expect((await register([first, extra])).body).toMatchObject({ granted: 1, standby: 1 });
        expect((await grants.redeemGrant({ value: first, now: 1_700_000_000_000 })).status).toBe(200);
        expect(bench.table(SCOPE).status).toBe('playing');
        const response = adapter.grantResponse(await grants.redeemGrant({ value: extra, now: 1_700_000_000_000 }));
        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({ tableFull: true, message: adapter.TABLE_FULL });
    });
});

function relayMatchFrames(page) {
    page.on('websocket', socket => {
        socket.on('framereceived', event => {
            const payload = Buffer.isBuffer(event.payload) ? event.payload.toString('utf8') : String(event.payload);
            if (!payload.includes('match-state')) return;
            page.evaluate(frame => window.__bridgeRecordWaitingMatch?.(frame), payload).catch(() => {});
        });
    });
}

async function postJson(page, path, body) {
    return page.evaluate(async ({ path, body }) => {
        const response = await fetch(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        let json = null;
        try { json = await response.json(); } catch { json = null; }
        return { status: response.status, json };
    }, { path, body });
}

async function gameScope(page) {
    return page.evaluate(() => {
        const app = window.__lobby;
        const game = [...(app?.chans?.values() || [])].find(room => room.kind === 'game' && room.keepRef && room.name);
        if (!game || !app.selfId) return null;
        const ids = window.__bridgeWaitingMatchIds || [];
        const mark = window.__bridgeMatchMark;
        const match = Number.isInteger(mark) ? ids.slice(mark).at(-1) : undefined;
        return { actor: app.selfId, room: game.name, ref: game.keepRef, ...(typeof match === 'string' ? { match } : {}) };
    });
}

async function openFreshChess(host) {
    const { showChess, seatHost, bindOpenMatchSockets, markFreshWaitingMatch } = await import('./support/bridge-lobby.mjs');
    await showChess(host);
    const close = host.getByRole('button', { name: 'Close waiting match' });
    if (await close.isVisible()) {
        await close.click();
        await expect(host.getByRole('button', { name: 'Open Chess match' })).toBeVisible();
    }
    await expect(host.getByRole('button', { name: 'Open Chess match' })).toBeVisible();
    await bindOpenMatchSockets(host);
    await markFreshWaitingMatch(host);
    await seatHost(host);
    await expect.poll(async () => (await gameScope(host))?.match || '').not.toBe('');
    const scope = await gameScope(host);
    expect(scope?.room && scope.ref && scope.actor && scope.match).toBeTruthy();
    return scope;
}

async function registerGrants(host, scope, values) {
    const result = await postJson(host, '/beta/game-night/room-grant/register', {
        actor: scope.actor, room: scope.room, ref: scope.ref, game: 'chess', match: scope.match, hashes: values.map(digest)
    });
    expect(result.status, result.json?.error || 'register was refused').toBe(200);
    return result.json;
}

function redeem(page, value, attempt) {
    return postJson(page, '/beta/game-night/room-grant/redeem', { value, attempt, age13: true });
}

async function blankGuest(browser, origin) {
    const { contextOptions } = await import('./support/bridge-lobby.mjs');
    const context = await browser.newContext(contextOptions(origin));
    const page = await context.newPage();
    await page.goto('/robots.txt');
    return { context, page };
}

test.describe('live room-grant routes', () => {
    test.describe.configure({ mode: 'serial', timeout: 240000 });
    let desktop;
    let host;
    let origin;

    test.beforeAll(async () => {
        const ready = await fetch('http://localhost:8792/ready');
        origin = (await ready.text()).trim();
        if (!/^https:\/\/[^/\s]+$/.test(origin)) throw new Error('The local preview did not publish an origin.');
        desktop = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
        const { contextOptions, enterLobby, openGameNight, installWaitingMatchTap } = await import('./support/bridge-lobby.mjs');
        const context = await desktop.newContext(contextOptions(origin, { viewport: { width: 1440, height: 900 } }));
        host = await context.newPage();
        host.setDefaultTimeout(20000);
        await host.addInitScript(installWaitingMatchTap);
        relayMatchFrames(host);
        const invitation = process.env.BRIDGE_PREVIEW_INVITATION;
        if (!invitation || invitation.length < 32) throw new Error('The local preview invitation was not passed to the test process.');
        await enterLobby(host, invitation, 'GrantHost');
        await openGameNight(host);
    });

    test.afterAll(async () => {
        await host?.context().close().catch(() => {});
        await desktop?.close().catch(() => {});
    });

    test('live route: reused grant returns 410', async () => {
        const scope = await openFreshChess(host);
        const value = secret();
        const attempt = secret();
        await registerGrants(host, scope, [value]);
        const first = await blankGuest(desktop, origin);
        const again = await blankGuest(desktop, origin);
        try {
            expect((await redeem(first.page, value, attempt)).status).toBe(200);
            const reused = await redeem(again.page, value, secret());
            expect(reused.status).toBe(410);
            expect(reused.json).toEqual({ error: EXPIRED_LINE });
            expect((await redeem(first.page, value, attempt)).status).toBe(200);
        } finally {
            await first.context.close();
            await again.context.close();
        }
    });

    test('live route: a host session cannot redeem a grant', async () => {
        const scope = await openFreshChess(host);
        const value = secret();
        await registerGrants(host, scope, [value]);
        const hostTry = await redeem(host, value, secret());
        expect(hostTry.status).toBe(403);
        expect(hostTry.json).toEqual({ error: HOST_LINE });
        const guest = await blankGuest(desktop, origin);
        try {
            expect((await redeem(guest.page, value, secret())).status).toBe(200);
        } finally {
            await guest.context.close();
        }
    });

    test('live route: an expired grant leaves the host table waiting', async () => {
        const scope = await openFreshChess(host);
        const value = secret();
        const issued = await registerGrants(host, scope, [value]);
        expect(issued.until).toBeGreaterThan(Date.now());
        await host.waitForTimeout(Math.max(0, issued.until - Date.now()) + 400);
        const guest = await blankGuest(desktop, origin);
        try {
            const late = await redeem(guest.page, value, secret());
            expect(late.status).toBe(410);
            expect(late.json).toEqual({ error: EXPIRED_LINE });
        } finally {
            await guest.context.close();
        }
        await expect(host.locator('[data-chess-status]')).toContainText('Waiting for an opponent');
        await expect(host.getByRole('button', { name: 'Close waiting match' })).toBeVisible();
    });

    test('live route: the extra person sees the table-full line', async () => {
        const scope = await openFreshChess(host);
        const first = secret();
        const extra = secret();
        expect(await registerGrants(host, scope, [first, extra])).toMatchObject({ granted: 1, standby: 1 });
        const seated = await blankGuest(desktop, origin);
        const overflow = await blankGuest(desktop, origin);
        try {
            const taken = await redeem(overflow.page, extra, secret());
            expect(taken.status).toBe(409);
            expect(taken.json).toEqual({ tableFull: true, message: FULL_LINE });
            expect((await redeem(seated.page, first, secret())).status).toBe(200);
            const still = await redeem(overflow.page, extra, secret());
            expect(still.status).toBe(409);
            expect(still.json).toEqual({ tableFull: true, message: FULL_LINE });
        } finally {
            await seated.context.close();
            await overflow.context.close();
        }
    });
});

test.describe('local preview profiles', () => {
    test.describe.configure({ mode: 'serial', timeout: 240000 });
    let desktop;
    let phone;
    let phoneEngine = 'webkit';
    let host;
    let grantPaths;
    let origin;

    test.beforeAll(async () => {
        const ready = await fetch('http://localhost:8792/ready');
        origin = (await ready.text()).trim();
        if (!/^https:\/\/[^/\s]+$/.test(origin)) throw new Error('The local preview did not publish an origin.');
        desktop = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
        try {
            phone = await webkit.launch({ headless: true });
        } catch {
            phone = desktop;
            phoneEngine = 'chromium-iphone';
        }
        console.log(`BRIDGE_PHONE_ENGINE ${phoneEngine}`);
    });

    test.afterAll(async () => {
        await host?.context().close().catch(() => {});
        if (phone && phone !== desktop) await phone.close().catch(() => {});
        await desktop?.close().catch(() => {});
    });

    test('loading the host page does not open Chess or issue a grant', async () => {
        const { contextOptions, enterLobby, openGameNight, showChess } = await import('./support/bridge-lobby.mjs');
        grantPaths = [];
        const context = await desktop.newContext(contextOptions(origin, { viewport: { width: 1440, height: 900 } }));
        host = await context.newPage();
        host.setDefaultTimeout(20000);
        host.on('request', request => {
            const path = new URL(request.url()).pathname;
            if (path.includes('room-grant') || path.includes('/grants')) grantPaths.push(path);
        });
        const invitation = process.env.BRIDGE_PREVIEW_INVITATION;
        if (!invitation || invitation.length < 32) throw new Error('The local preview invitation was not passed to the test process.');
        await enterLobby(host, invitation, 'BridgeHost');
        await openGameNight(host);
        await showChess(host);
        await expect(host.locator('[data-chess-status]')).toHaveText(/Open a ten-minute match/);
        await expect(host.locator('[data-chess-status]')).not.toContainText('Waiting for an opponent');
        expect(grantPaths).toEqual([]);
        // Opening the host page does not register a grant. The route exists and stays idle.
        const { createChessBench } = await import('./support/bridge-grants-adapter.mjs');
        expect(createChessBench().grantRows()).toEqual([]);
    });

    test('three phone joins are timed from the Join tap to a seated Chess board', async () => {
        test.setTimeout(300000);
        const { contextOptions, ensureHostWaiting, shareChessInvite, openChessInvite, waitForGuestSeat, leaveGame } = await import('./support/bridge-lobby.mjs');
        const { shoot } = await import('./support/bridge-shots.mjs');
        const runs = [];
        for (let index = 1; index <= 3; index += 1) {
            await ensureHostWaiting(host);
            const link = await shareChessInvite(host);
            const context = await phone.newContext(contextOptions(origin, {
                viewport: { width: 390, height: 844 },
                screen: { width: 390, height: 844 },
                deviceScaleFactor: iphone.deviceScaleFactor,
                isMobile: true,
                hasTouch: true,
                userAgent: iphone.userAgent
            }));
            const guest = await context.newPage();
            guest.setDefaultTimeout(30000);
            try {
                await openChessInvite(guest, link);
                const join = guest.getByRole('button', { name: 'Join game', exact: true });
                await expect(join).toBeEnabled();
                const started = Date.now();
                await join.tap();
                await waitForGuestSeat(guest);
                const ms = Date.now() - started;
                runs.push(ms);
                console.log(`BRIDGE_TIMING_RUN ${index} ${ms}`);
                if (index === 1) {
                    await shoot(guest, 'bridge-slice1-phone-seated.png');
                    await shoot(host, 'bridge-slice1-host-seated.png');
                }
                await leaveGame(guest);
            } finally {
                await context.close();
            }
        }
        expect(runs).toHaveLength(3);
        expect(grantPaths).toEqual([]);
        console.log(`BRIDGE_TIMING ${runs.join(',')}`);
    });

    test('a closed invite tells the phone guest the seat is gone', async () => {
        const { contextOptions, ensureHostWaiting, shareChessInvite, openChessInvite } = await import('./support/bridge-lobby.mjs');
        const { shoot } = await import('./support/bridge-shots.mjs');
        await ensureHostWaiting(host);
        const link = await shareChessInvite(host);
        const context = await phone.newContext(contextOptions(origin, {
            viewport: { width: 390, height: 844 },
            screen: { width: 390, height: 844 },
            deviceScaleFactor: iphone.deviceScaleFactor,
            isMobile: true,
            hasTouch: true,
            userAgent: iphone.userAgent
        }));
        const guest = await context.newPage();
        guest.setDefaultTimeout(30000);
        try {
            await openChessInvite(guest, link);
            const join = guest.getByRole('button', { name: 'Join game', exact: true });
            await expect(join).toBeEnabled();
            await host.getByRole('button', { name: 'Close waiting match' }).click();
            await expect(host.getByRole('button', { name: 'Open Chess match' })).toBeVisible();
            await join.tap();
            const closed = 'This invite can’t open the game anymore. Ask your host for a new invite.';
            await expect(guest.locator('[data-guest-status]')).toHaveText(closed);
            await expect(join).toBeHidden();
            await expect(guest.locator('[data-guest-inviter]')).toBeHidden();
            await shoot(guest, 'bridge-slice1-stale-offer.png');
        } finally {
            await context.close();
        }
    });

    test('a third context is not seated when the chess table is full', async () => {
        const { contextOptions, enterLobby, ensureHostWaiting, shareChessInvite, openChessInvite, waitForGuestSeat } = await import('./support/bridge-lobby.mjs');
        const { shoot } = await import('./support/bridge-shots.mjs');
        const invitation = process.env.BRIDGE_PREVIEW_INVITATION;
        const extraContext = await desktop.newContext(contextOptions(origin, { viewport: { width: 1440, height: 900 } }));
        const extra = await extraContext.newPage();
        extra.setDefaultTimeout(20000);
        const guestContext = await phone.newContext(contextOptions(origin, {
            viewport: { width: 390, height: 844 },
            screen: { width: 390, height: 844 },
            deviceScaleFactor: iphone.deviceScaleFactor,
            isMobile: true,
            hasTouch: true,
            userAgent: iphone.userAgent
        }));
        const guest = await guestContext.newPage();
        guest.setDefaultTimeout(30000);
        try {
            await enterLobby(extra, invitation, 'ExtraGuest');
            await ensureHostWaiting(host);
            const link = await shareChessInvite(host);
            await openChessInvite(guest, link);
            await guest.getByRole('button', { name: 'Join game', exact: true }).tap();
            await waitForGuestSeat(guest);
            const dialog = host.locator('[data-invite-dialog]');
            await expect(async () => {
                if (await dialog.isVisible()) await host.keyboard.press('Escape');
                await host.getByRole('button', { name: 'Invite players' }).click();
                await expect(dialog.getByRole('button', { name: 'Invite ExtraGuest', exact: true })).toBeEnabled();
            }).toPass({ timeout: 20000 });
            await dialog.getByRole('button', { name: 'Invite ExtraGuest', exact: true }).click();
            const joinRoom = extra.locator('[data-game-offer-join]');
            await expect(joinRoom).toBeVisible();
            await expect(joinRoom).toBeEnabled();
            await joinRoom.click();
            await expect(extra.locator('[data-game-night]')).toBeVisible();
            await extra.getByRole('combobox', { name: 'Switch game' }).selectOption('chess');
            const status = extra.locator('[data-chess-status]');
            await expect(status).toBeVisible();
            await expect(status).not.toContainText(/You’re (White|Black)/);
            await expect(extra.locator('.arcade-chess button:visible:disabled')).toHaveCount(0);
            const primary = extra.locator('[data-chess-primary]');
            if (await primary.isVisible()) {
                await expect(primary).toBeEnabled();
                await primary.click();
                await expect(status).not.toContainText(/You’re (White|Black)/);
            }
            await shoot(extra, 'bridge-slice1-overflow.png');
        } finally {
            await guestContext.close();
            await extraContext.close();
        }
    });
});
