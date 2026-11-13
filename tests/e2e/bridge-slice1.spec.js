const { test, expect, chromium, webkit, devices } = require('@playwright/test');

const iphone = devices['iPhone 13'];
const ROUTE_MISSING = 'The grants module and the real Chess table run in-process above. No Worker route serves them on the preview yet (BRIDGE-HOOKS.md hook 2), and the table has no seat holds (hook 1).';

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

for (const name of [
    'live route: reused grant returns 410',
    'live route: a host session cannot redeem a grant',
    'live route: an expired grant leaves the host table waiting',
    'live route: the extra person sees the table-full line'
]) {
    test(name, async () => {
        test.fixme(true, ROUTE_MISSING);
        throw new Error(ROUTE_MISSING);
    });
}

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
        // Nothing on the page can reach the module: no grant route exists and none was called.
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
