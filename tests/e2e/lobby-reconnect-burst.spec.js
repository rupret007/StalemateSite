// Five independent Chromium profiles, the actual loopback relay/engine, and
// actual TCP loss. Identity and persistence remain the loopback adapters: this
// is not hosted/C3 authority, WAN, high-load or native audio qualification.
const http = require('node:http');
const { test, expect } = require('@playwright/test');

async function lossyRelay(origin) {
    const { createHangoutRelay } = await import('../../scripts/hangout-relay-dev.mjs');
    const relay = createHangoutRelay({ origins: origin });
    const sockets = new Set(), faults = [];
    let admissions = 0;
    const server = http.createServer((_request, response) => { response.writeHead(404); response.end(); });
    server.on('connection', socket => {
        sockets.add(socket); socket.once('close', () => sockets.delete(socket));
    });
    server.on('upgrade', (request, socket, head) => {
        admissions++;
        void relay.handleUpgrade(request, socket, head, new URL(request.url, 'http://relay')).catch(error => {
            faults.push(error.message); socket.destroy();
        });
    });
    try {
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
        });
    } catch (error) { await relay.close(); throw error; }
    return {
        url: `ws://127.0.0.1:${server.address().port}`,
        admissions: () => admissions,
        liveSockets: () => sockets.size,
        sessions: () => relay.lobby.sessionSnapshot().connections,
        metrics: relay.metrics,
        settled: relay.settled,
        faults,
        cut() {
            const connected = [...sockets];
            // Destroy only this test's accepted transports. No server restart,
            // fake browser close event or production fault endpoint is used.
            for (const socket of connected) socket.destroy();
            return connected.length;
        },
        async close() {
            try { await relay.close(); }
            finally {
                for (const socket of sockets) socket.destroy();
                if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
            }
        }
    };
}

test('five visitors recover together from TCP loss without replay, duplicate lines or leaked sessions', async ({ browser, baseURL }) => {
    const fixture = await lossyRelay(new URL(baseURL).origin);
    const contexts = [], pages = [], errors = [];
    const names = ['BurstOne', 'BurstTwo', 'BurstThree', 'BurstFour', 'BurstFive'];
    const beforeText = 'Synthetic line before the shared transport loss';
    const afterText = 'Synthetic line after everyone reconnected';
    const draft = 'Keep this unsent draft private to its tab';
    const send = async (page, text) => { await page.fill('[data-text]', text); await page.press('[data-text]', 'Enter'); };
    const receivedNames = page => page.evaluate(() => (__lobby.chans.get('#stalemate')?.names || []).map(person => person.nick).sort());
    try {
        for (const name of names) {
            const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
            contexts.push(context);
            await context.route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL).origin ? route.continue() : route.abort());
            const page = await context.newPage(); pages.push(page);
            page.on('pageerror', error => errors.push(error.message));
            const target = new URL('/r/45662413410ed051/lobby/', baseURL);
            target.searchParams.set('preview', 'local-preview-key-0001'); target.searchParams.set('relay', fixture.url);
            await page.goto(target.href);
            await page.fill('[data-nick]', name); await page.click('[data-enter]');
            await expect(page.locator('[data-connection]')).toHaveText('Connected');
        }
        await Promise.all(pages.map(page => expect.poll(() => receivedNames(page)).toEqual([...names].sort())));
        await send(pages[0], beforeText);
        await Promise.all(pages.map(page => expect(page.locator('[data-buffer]')).toContainText(beforeText)));
        // An in-flight message result intentionally pauses automatic reconnect.
        // Establish an idle, acknowledged baseline before testing this path.
        await fixture.settled();
        await expect.poll(() => fixture.metrics().delivery.pendingFrames).toBe(0);
        await fixture.settled();
        await pages[1].fill('[data-text]', draft);
        const oldIds = await Promise.all(pages.map(page => page.evaluate(() => __lobby.selfId)));
        expect(oldIds.every(Boolean)).toBe(true); expect(new Set(oldIds).size).toBe(5);
        expect(fixture.admissions()).toBe(5); expect(fixture.liveSockets()).toBe(5);

        expect(fixture.cut()).toBe(5);
        // A new welcome/ID is the recovery witness. Checking only "Connected"
        // here could accidentally accept the old UI before its close event.
        await Promise.all(pages.map((page, index) => expect.poll(async () => {
            const id = await page.evaluate(() => __lobby.selfId);
            return !!id && id !== oldIds[index];
        }).toBe(true)));
        const newIds = await Promise.all(pages.map(page => page.evaluate(() => __lobby.selfId)));
        expect(new Set(newIds).size).toBe(5);
        expect(newIds.every(id => !oldIds.includes(id))).toBe(true);
        await Promise.all(pages.map(async page => {
            await expect(page.locator('[data-connection]')).toHaveText('Connected');
            await expect.poll(() => receivedNames(page)).toEqual([...names].sort());
            await expect(page.locator('[data-buffer]')).not.toContainText(beforeText);
            await expect(page.locator('[data-buffer]')).not.toContainText(draft);
        }));
        await expect(pages[1].locator('[data-text]')).toHaveValue(draft);
        await expect.poll(() => fixture.sessions().map(session => session.id).sort()).toEqual([...newIds].sort());
        await send(pages[2], afterText);
        await Promise.all(pages.map(page => expect(page.locator('[data-buffer] li').filter({ hasText: afterText })).toHaveCount(1)));
        await fixture.settled();
        // Wait for actual application ACKs, then count again. A first visible
        // copy alone could miss a second copy still queued for delivery.
        await expect.poll(() => fixture.metrics().delivery.pendingFrames).toBe(0);
        await fixture.settled();
        await Promise.all(pages.map(page => expect(page.locator('[data-buffer] li').filter({ hasText: afterText })).toHaveCount(1)));
        expect(fixture.admissions()).toBe(10); expect(fixture.liveSockets()).toBe(5);
        expect(fixture.metrics().work).toMatchObject({ pending: 0, cleanup: 0, rejected: 0 });
        expect(fixture.metrics().delivery.pressureCloses).toBe(0);
        expect(fixture.faults).toEqual([]); expect(errors).toEqual([]);
        console.log('RECONNECT_BURST_LOCAL', JSON.stringify({ clients: 5, droppedTcpConnections: 5, admissions: 10,
            freshSessionIds: 5, retainedLiveSessions: 5, priorChatReplayed: false, draftAutoSent: false,
            newLineCopiesPerClient: 1, finalPendingDeliveryFrames: 0,
            scope: 'Chromium/loopback relay identity; not hosted capacity, C3 authority, WAN or native audio' }));
    } finally {
        const results = await Promise.allSettled(contexts.map(context => context.close()));
        await fixture.close();
        for (const result of results) if (result.status === 'rejected') throw result.reason;
    }
});
