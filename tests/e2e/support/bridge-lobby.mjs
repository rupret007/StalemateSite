import { expect } from '@playwright/test';

export function contextOptions(origin, extra = {}) {
    return {
        baseURL: origin,
        ignoreHTTPSErrors: true,
        serviceWorkers: 'block',
        reducedMotion: 'reduce',
        ...extra
    };
}

export async function enterLobby(page, invitation, nick) {
    await page.goto('/beta/?via=stalemate');
    const code = page.getByLabel('Invitation code');
    await expect(code).toBeVisible();
    await code.fill(invitation);
    await page.getByRole('button', { name: 'Enter the community' }).click();
    await page.getByRole('link', { name: /Choose a nickname and join/ }).click();
    await page.getByLabel('Your nick').fill(nick);
    const enter = page.locator('[data-enter]');
    await expect(enter).toBeEnabled();
    await enter.click();
    await expect(page.locator('[data-connection]')).toHaveText('Connected');
}

export async function openGameNight(page) {
    const start = page.locator('[data-start="game"]');
    await expect(start).toBeEnabled();
    await start.click();
    await expect(page.locator('[data-game-night]')).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Switch game' })).toBeVisible();
}

export async function showChess(page) {
    await page.getByRole('combobox', { name: 'Switch game' }).selectOption('chess');
    await expect(page.locator('[data-chess-status]')).toBeVisible();
}

export async function seatHost(page) {
    await page.getByRole('button', { name: 'Open Chess match' }).click();
    await expect(page.locator('[data-chess-status]')).toContainText('Waiting for an opponent');
}

export async function ensureHostWaiting(page) {
    await showChess(page);
    const status = page.locator('[data-chess-status]');
    const open = page.getByRole('button', { name: 'Open Chess match' });
    await expect(async () => {
        if (/Waiting for an opponent/.test(await status.innerText())) return;
        await expect(open).toBeVisible();
    }).toPass({ timeout: 20000 });
    if (!/Waiting for an opponent/.test(await status.innerText())) await seatHost(page);
}

export async function shareChessInvite(host) {
    await host.evaluate(() => {
        window.__bridgeShare = '';
        Object.defineProperty(navigator, 'share', {
            configurable: true,
            value: async ({ url }) => { window.__bridgeShare = url; }
        });
    });
    try {
        await host.getByRole('button', { name: 'Invite players' }).click();
        await host.getByRole('button', { name: /^Invite a friend to / }).click();
        const share = host.getByRole('button', { name: 'Share invite' });
        await expect(share).toBeVisible();
        await share.click();
        const href = await host.evaluate(() => window.__bridgeShare);
        let link;
        try { link = new URL(href); } catch { link = null; }
        if (!link || link.pathname !== '/beta/game-night/guest' || !link.hash.startsWith('#invite=')) {
            throw new Error('The share sheet did not return a game invitation.');
        }
        return link;
    } finally {
        await host.evaluate(() => {
            delete window.__bridgeShare;
            try { delete navigator.share; } catch { /* The stub is already gone. */ }
            for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
        }).catch(() => {});
    }
}

export async function openChessInvite(page, link) {
    await page.addInitScript(({ path, hash }) => {
        if (location.pathname === path) history.replaceState(null, '', path + hash);
    }, { path: link.pathname, hash: link.hash });
    await page.goto(link.pathname);
}

export async function waitForGuestSeat(page) {
    const status = page.locator('[data-chess-status]');
    await expect(status).toContainText('Black');
    await expect(status).toContainText('White to move');
    await expect(page.locator('.arcade-chess cg-board piece')).toHaveCount(32);
}

export async function leaveGame(page) {
    await page.locator('[data-leave]').click();
    await expect(page.locator('[data-game-night]')).toBeHidden();
}

// The Chess match id is not stored on the lobby channel. It arrives as a
// match-state frame on the arcade socket. Playwright's websocket hook does
// not attach to a socket that is already open, so also watch those.
export function installWaitingMatchTap() {
    window.__bridgeWaitingMatchIds = window.__bridgeWaitingMatchIds || [];
    window.__bridgeRecordWaitingMatch = data => {
        if (typeof data !== 'string' || !data.includes('match-state')) return;
        let frame;
        try { frame = JSON.parse(data); } catch { return; }
        const state = frame?.t === 'match-state' && frame.version === 1 ? frame.state : null;
        const id = state?.waiting === true && state.game === 'chess' && typeof state.id === 'string' ? state.id : '';
        if (!/^[a-zA-Z0-9-]{5,80}$/.test(id)) return;
        const ids = window.__bridgeWaitingMatchIds;
        if (!ids.includes(id)) ids.push(id);
    };
    const watch = socket => {
        if (!socket || socket.__bridgeMatchWatched) return;
        socket.__bridgeMatchWatched = true;
        socket.addEventListener('message', event => window.__bridgeRecordWaitingMatch?.(event.data));
    };
    window.__bridgeWatchMatchSocket = watch;
    if (window.__bridgeMatchTapInstalled) return;
    window.__bridgeMatchTapInstalled = true;
    const NativeWebSocket = window.WebSocket;
    function BridgeWebSocket(url, protocols) {
        const socket = arguments.length < 2 ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
        watch(socket);
        return socket;
    }
    BridgeWebSocket.prototype = NativeWebSocket.prototype;
    for (const name of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) BridgeWebSocket[name] = NativeWebSocket[name];
    window.WebSocket = BridgeWebSocket;
}

export async function bindOpenMatchSockets(page) {
    await page.evaluate(installWaitingMatchTap);
    const client = await page.context().newCDPSession(page);
    const contexts = [];
    client.on('Runtime.executionContextCreated', event => {
        const context = event.context;
        if (context?.auxData?.isDefault && !context.name) contexts.push(context.id);
    });
    try {
        await client.send('Runtime.enable');
        if (!contexts.length) throw new Error('No page context was available to read the open Chess match socket.');
        for (const contextId of contexts) {
            const proto = await client.send('Runtime.evaluate', {
                expression: 'WebSocket.prototype',
                contextId,
                objectGroup: 'bridge-match-watch'
            });
            const prototypeId = proto.result?.objectId;
            if (!prototypeId) continue;
            const queried = await client.send('Runtime.queryObjects', { prototypeObjectId: prototypeId });
            const listId = queried.objects?.objectId;
            if (!listId) continue;
            await client.send('Runtime.callFunctionOn', {
                objectId: listId,
                functionDeclaration: `function () {
                    const watch = window.__bridgeWatchMatchSocket;
                    if (typeof watch !== 'function') return 0;
                    let added = 0;
                    for (const socket of this) {
                        if (socket && !socket.__bridgeMatchWatched) added += 1;
                        watch(socket);
                    }
                    return added;
                }`,
                returnByValue: true
            });
            await client.send('Runtime.releaseObject', { objectId: listId }).catch(() => {});
        }
    } finally {
        await client.send('Runtime.releaseObjectGroup', { objectGroup: 'bridge-match-watch' }).catch(() => {});
        await client.detach().catch(() => {});
    }
}

export function markFreshWaitingMatch(page) {
    return page.evaluate(() => {
        window.__bridgeMatchMark = (window.__bridgeWaitingMatchIds || []).length;
    });
}
