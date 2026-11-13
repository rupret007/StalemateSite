const { test, expect, chromium, webkit, devices } = require('@playwright/test');

const iphone = devices['iPhone 13'];
const HOOK_MISSING = 'hangout-worker/src/game-night-room-grants.mjs is not in this worktree, and the table-hold and route hooks are not registered. Do not satisfy this with the stand-in.';

test.describe('stand-in grant cases', () => {
    test('reused grant returns the existing 410 expired shape', async () => {
        const { createRoomGrants, EXPIRED_ERROR, hashGrant } = await import('./support/bridge-grants-adapter.mjs');
        const { randomBytes } = await import('node:crypto');
        const grants = createRoomGrants({ now: () => 1_700_000_000_000 });
        const host = { hostSession: 'host-session', room: 'room-chess', match: 'match-chess', game: 'chess' };
        expect((await grants.seatHost(host)).status).toBe(200);
        const raw = randomBytes(16).toString('hex');
        expect((await grants.registerGrants({ ...host, confirmed: true, grants: [{ hash: await hashGrant(raw), seat: 'next' }] })).status).toBe(200);
        expect((await grants.redeemGrant({ session: 'phone-guest', raw, ...host })).status).toBe(200);
        const replay = await grants.redeemGrant({ session: 'phone-guest', raw, ...host });
        expect(replay.status).toBe(410);
        expect(await replay.json()).toEqual({ error: EXPIRED_ERROR });
    });

    test('a host session cannot claim a guest grant', async () => {
        const { createRoomGrants, hashGrant } = await import('./support/bridge-grants-adapter.mjs');
        const { randomBytes } = await import('node:crypto');
        const grants = createRoomGrants({ now: () => 1_700_000_000_000 });
        const host = { hostSession: 'host-session', room: 'room-chess', match: 'match-chess', game: 'chess' };
        expect((await grants.seatHost(host)).status).toBe(200);
        const raw = randomBytes(16).toString('hex');
        expect((await grants.registerGrants({ ...host, confirmed: true, grants: [{ hash: await hashGrant(raw), seat: 'next' }] })).status).toBe(200);
        expect((await grants.redeemGrant({ session: host.hostSession, raw, ...host })).status).toBe(403);
        expect(grants.snapshot()[0].grants[0].burned).toBe(false);
        expect((await grants.redeemGrant({ session: 'phone-guest', raw, ...host })).status).toBe(200);
    });

    test('an expired hold leaves the host table waiting', async () => {
        const { createRoomGrants, HOLD_MS, hashGrant } = await import('./support/bridge-grants-adapter.mjs');
        const { randomBytes } = await import('node:crypto');
        let at = 1_700_000_000_000;
        const grants = createRoomGrants({ now: () => at });
        const host = { hostSession: 'host-session', room: 'room-chess', match: 'match-chess', game: 'chess' };
        expect((await grants.seatHost(host)).status).toBe(200);
        const raw = randomBytes(16).toString('hex');
        expect((await grants.registerGrants({ ...host, confirmed: true, grants: [{ hash: await hashGrant(raw), seat: 'next' }] })).status).toBe(200);
        at += HOLD_MS;
        const swept = grants.sweep();
        expect(swept.tables).toHaveLength(1);
        expect(swept.tables[0]).toMatchObject({ present: true, status: 'waiting', seats: { w: 'host-session', b: null }, holds: [] });
        expect((await grants.redeemGrant({ session: 'phone-guest', raw, ...host })).status).toBe(410);
    });

    test('the extra person gets an enabled next-game response, never a dead control', async () => {
        const { createRoomGrants, TABLE_FULL, hashGrant } = await import('./support/bridge-grants-adapter.mjs');
        const { randomBytes } = await import('node:crypto');
        const grants = createRoomGrants({ now: () => 1_700_000_000_000 });
        const host = { hostSession: 'host-session', room: 'room-chess', match: 'match-chess', game: 'chess' };
        expect((await grants.seatHost(host)).status).toBe(200);
        const first = randomBytes(16).toString('hex');
        const extra = randomBytes(16).toString('hex');
        const issued = await grants.registerGrants({
            ...host, confirmed: true,
            grants: [{ hash: await hashGrant(first), seat: 'next' }, { hash: await hashGrant(extra), seat: 'next' }]
        });
        expect((await issued.json()).overflow).toEqual([{ message: TABLE_FULL, enabled: true, disabled: false }]);
        const response = await grants.redeemGrant({ session: 'extra-person', raw: extra, ...host });
        expect(await response.json()).toEqual({ message: TABLE_FULL, enabled: true, disabled: false });
    });
});

for (const name of [
    'worker hook: reused grant returns 410',
    'worker hook: a host session cannot redeem a grant',
    'worker hook: an expired grant leaves the host table waiting',
    'worker hook: the extra person sees the table-full line'
]) {
    test(name, async () => {
        test.fixme(true, HOOK_MISSING);
        throw new Error(HOOK_MISSING);
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
        const { createRoomGrants } = await import('./support/bridge-grants-adapter.mjs');
        const grants = createRoomGrants();
        expect(grants.notePageLoad()).toEqual({ registered: 0, issued: false });
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
