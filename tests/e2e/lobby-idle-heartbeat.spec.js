// Real page/modules with an explicit WebSocket protocol fixture and virtual
// browser timers. This is not real-time idle/hibernation or hosted expiry proof.
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');
test.use({ permissions: [], video: 'off' });
const INTERVAL = 5 * 60 * 1000;

async function fixture(page, baseURL, version = 1) {
    const sockets = [], sent = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.context().route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL).origin
        ? route.continue() : route.abort());
    await page.clock.install({ time: new Date('2026-11-07T00:00:00Z') });
    await page.routeWebSocket(url => url.pathname.endsWith('/lobby'), socket => {
        const generation = sockets.push(socket);
        socket.onMessage(raw => {
            const frame = JSON.parse(String(raw)); sent.push({ generation, frame });
            if (frame.t === 'hello') {
                socket.send(JSON.stringify({ t: 'welcome', id: `heartbeat-${generation}`, nick: frame.nick, band: false, verified: false }));
                socket.send(JSON.stringify({ t: 'join', ch: { name: '#stalemate', kind: 'lobby', title: 'The lobby', topic: '', count: 1,
                    modes: { m: false, i: false, k: false, l: 150, t: true, S: 0, C: false, Q: false, locked: false },
                    names: [{ id: `heartbeat-${generation}`, nick: frame.nick, prefix: '' }] } }));
            } else if (frame.t === 'transport-ping') {
                socket.send(JSON.stringify({ t: 'transport-pong', transportSeq: sent.filter(e => e.generation === generation && e.frame.t === 'transport-ping').length }));
            }
        });
        socket.send(JSON.stringify({ t: 'hello', role: 'fan', lock: 'off', shield: false, budget: 'ok', needNick: true,
            features: version === undefined ? {} : { transportPing: version } }));
    });
    await page.goto(`/r/45662413410ed051/lobby/?preview=local-preview-key-0001&relay=${encodeURIComponent(hangoutRelayWsBase(baseURL, 'idle-heartbeat-fixture'))}`);
    await page.fill('[data-nick]', 'QuietGuest'); await page.click('[data-enter]');
    await expect(page.locator('[data-connection]')).toHaveText('Connected');
    await page.clock.pauseAt(new Date('2026-11-07T00:01:00Z'));
    return { sockets, sent, errors, pings: () => sent.filter(e => e.frame.t === 'transport-ping') };
}

test('idle keepalive is acknowledged without chat, role changes or sending the draft', async ({ page, baseURL }) => {
    const f = await fixture(page, baseURL);
    await page.fill('[data-text]', 'An unsent private draft');
    const buffer = await page.locator('[data-buffer]').innerText();
    const identity = await page.evaluate(() => ({ id: __lobby.selfId, role: __lobby.role }));
    await page.clock.fastForward(INTERVAL);
    await expect.poll(() => f.pings().length).toBe(1);
    await page.clock.runFor(100);
    await expect.poll(() => f.sent.some(e => e.frame.t === 'transport-ack' && e.frame.seq === 1)).toBe(true);
    await expect(page.locator('[data-text]')).toHaveValue('An unsent private draft');
    await expect(page.locator('[data-buffer]')).toHaveText(buffer);
    expect(await page.evaluate(() => ({ id: __lobby.selfId, role: __lobby.role }))).toEqual(identity);
    expect(f.sent.some(e => e.frame.t === 'say')).toBe(false); expect(f.errors).toEqual([]);
});

test('an older server receives no unadvertised ping', async ({ page, baseURL }) => {
    const f = await fixture(page, baseURL, 0);
    await page.clock.fastForward(INTERVAL * 3);
    expect(f.pings()).toEqual([]); await expect(page.locator('[data-connection]')).toHaveText('Connected');
    expect(f.errors).toEqual([]);
});

test('absolute session closure retires the timer and does not reconnect', async ({ page, baseURL }) => {
    const f = await fixture(page, baseURL);
    f.sockets[0].close({ code: 4401, reason: 'synthetic expired session' });
    await expect(page.locator('[data-session-ended]')).toBeVisible();
    await page.clock.fastForward(INTERVAL * 3);
    expect(f.pings()).toEqual([]); expect(f.sockets).toHaveLength(1); expect(f.errors).toEqual([]);
});

test('a replacement socket owns the only next keepalive after reconnect', async ({ page, baseURL }) => {
    const f = await fixture(page, baseURL);
    f.sockets[0].close({ code: 1012, reason: 'synthetic restart' });
    await expect(page.locator('[data-connection]')).toHaveText('Reconnecting…');
    await page.clock.runFor(1500);
    await expect.poll(() => f.sockets.length).toBe(2);
    await expect.poll(() => page.evaluate(() => __lobby.selfId)).toBe('heartbeat-2');
    await expect(page.locator('[data-connection]')).toHaveText('Connected');
    await page.clock.fastForward(INTERVAL);
    await expect.poll(() => f.pings()).toEqual([{ generation: 2, frame: { t: 'transport-ping' } }]);
    expect(f.errors).toEqual([]);
});
