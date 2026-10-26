// Visible controls, real loopback relay/engine and real Chromium WebRTC with
// synthetic camera devices. This does not qualify TURN/WAN or hosted identity.
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const ROOT = '/r/45662413410ed051/lobby/', PREVIEW = 'local-preview-key-0001';
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--disable-features=WebRtcHideLocalIpsWithMdns'] } });
test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium supplies the synthetic cameras');

async function scenario(browser, baseURL, width) {
    const contexts = [], websites = [], errors = [];
    const relay = hangoutRelayWsBase(baseURL, `shared-community-media-${randomUUID()}`);
    async function guest(source, nickname, existingContext) {
        const context = existingContext || await browser.newContext({ viewport: { width, height: 812 }, permissions: ['camera'] });
        if (!existingContext) {
            contexts.push(context);
            await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
            await context.addInitScript(() => {
                window.__captureCalls = 0;
                if (!navigator.mediaDevices) return; // about:blank has no capture API.
                const nativeCapture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
                navigator.mediaDevices.getUserMedia = constraints => { window.__captureCalls += 1; return nativeCapture(constraints); };
                window.__mediaDiagnostics = []; let sequence = 0;
                const record = entry => { window.__mediaDiagnostics.push(entry); if (window.__mediaDiagnostics.length > 200) window.__mediaDiagnostics.shift(); };
                const frame = (direction, raw) => {
                    try {
                        const item = JSON.parse(raw);
                        if (item.t === 'act' && item.kind === 'rtc') record({ direction, from: item.from, to: item.to, type: item.sdp?.type || 'ice', bytes: raw.length });
                        if (item.t === 'notice' && item.kind === 'error') record({ direction, notice: String(item.text).slice(0, 100) });
                    } catch { /* Non-application frame. No SDP, ICE addresses or credentials are recorded. */ }
                };
                const NativeSocket = window.WebSocket;
                window.WebSocket = class extends NativeSocket {
                    constructor(...args) { super(...args); this.addEventListener('message', event => frame('in', event.data)); }
                    send(raw) { frame('out', raw); return super.send(raw); }
                };
                const NativePC = window.RTCPeerConnection;
                window.RTCPeerConnection = class extends NativePC {
                    constructor(...args) { super(...args); this.__probeId = ++sequence; }
                    async setLocalDescription(description) {
                        try { await super.setLocalDescription(description); this.__localSnapshot = this.localDescription?.toJSON(); record({ pc: this.__probeId, op: 'local', type: this.localDescription?.type, state: this.signalingState }); }
                        catch (error) { record({ pc: this.__probeId, op: 'local-error', name: error.name, state: this.signalingState }); throw error; }
                    }
                    async setRemoteDescription(description) {
                        try { await super.setRemoteDescription(description); record({ pc: this.__probeId, op: 'remote', type: description.type, state: this.signalingState }); }
                        catch (error) { record({ pc: this.__probeId, op: 'remote-error', type: description.type, name: error.name, state: this.signalingState }); throw error; }
                    }
                };
            });
        }
        const target = new URL(ROOT, baseURL); target.searchParams.set('preview', PREVIEW); target.searchParams.set('relay', relay); target.searchParams.set('via', source);
        const website = http.createServer((_request, response) => {
            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Referrer-Policy': 'no-referrer' });
            response.end(`<!doctype html><html lang="en"><title>${source} entry fixture</title><a href="${target.href.replace(/&/g, '&amp;')}">Hang Out</a></html>`);
        });
        await new Promise((resolve, reject) => { website.once('error', reject); website.listen(0, '127.0.0.1', resolve); }); websites.push(website);
        const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${website.address().port}/`); await page.getByRole('link', { name: 'Hang Out', exact: true }).click();
        await page.fill('[data-nick]', nickname); await page.click('[data-enter]'); await expect(page.locator('[data-connection]')).toHaveText('Connected');
        expect(new URL(page.url()).origin).toBe(new URL(baseURL).origin); return page;
    }
    return { guest, errors, close: async () => { await Promise.allSettled(contexts.map(context => context.close())); for (const website of websites) { website.closeAllConnections(); await new Promise(resolve => website.close(resolve)); } } };
}
async function command(page, text) {
    await page.click('nav [data-show="chat"]'); await page.fill('[data-text]', text); await page.press('[data-text]', 'Enter');
}
async function camera(page) {
    await page.click('nav [data-show="chat"]'); await page.click('[data-cam]');
    await page.locator('[data-cam-gate] [data-adult]').check(); await page.locator('[data-cam-gate] [data-cam-yes]').click();
    await expect.poll(() => page.evaluate(() => !!window.__lobbyRoom.state.stream)).toBe(true);
}
async function block(page, nickname) {
    await page.click('nav [data-show="people"]');
    await page.locator('[data-nicks] button').filter({ hasText: nickname }).click();
    await page.locator('[data-sheet-buttons]').getByRole('button', { name: 'Block', exact: true }).click();
    await page.click('nav [data-show="chat"]'); await expect(page.locator('[data-buffer]')).toContainText(`Blocked ${nickname}.`);
}
const peerState = page => page.evaluate(async () => Promise.all([...window.__lobbyRoom.state.pcs].map(async ([id, entry]) => {
    const stats = await entry.pc.getStats(); let decoded = 0;
    stats.forEach(report => { if (report.type === 'inbound-rtp' && (report.kind === 'video' || report.mediaType === 'video')) decoded += report.framesDecoded || 0; });
    return { id, signaling: entry.pc.signalingState, connected: entry.pc.connectionState, decoded, tracks: entry.stream.getVideoTracks().filter(track => track.readyState === 'live').length };
})));

for (const width of [375, 390]) test(`Block retires live camera pairs across entries and same-device tabs at ${width}px`, async ({ browser, baseURL }, testInfo) => {
    const app = await scenario(browser, baseURL, width);
    try {
        const alpha = await app.guest('stalemate', 'MediaAlpha'), bravo = await app.guest('rad-dad', 'MediaBravo'), witness = await app.guest('stalemate', 'MediaWitness');
        await alpha.click('nav [data-show="rooms"]'); await alpha.click('[data-start="art"]');
        await expect(alpha.locator('[data-act-canvas]')).toBeVisible(); const room = await alpha.locator('[data-chat-context]').innerText();
        for (const page of [bravo, witness]) { await command(page, `/join ${room}`); await expect(page.locator('[data-chat-context]')).toHaveText(room); }
        const connectionIds = await Promise.all([alpha, bravo, witness].map(page => page.evaluate(() => window.__lobbyRoom.state.myId)));
        expect(new Set(connectionIds).size).toBe(3);
        for (const id of connectionIds) expect(id).toMatch(/^c[a-f0-9]{32}$/);
        for (const page of [alpha, bravo, witness]) await camera(page);
        try {
            for (const page of [alpha, bravo, witness]) await expect.poll(async () => {
                const peers = await peerState(page); return peers.length === 2 && peers.every(peer => peer.connected === 'connected' && peer.tracks > 0 && peer.decoded > 0);
            }).toBe(true);
        } catch (error) {
            console.log('Pre-block decoded media state', JSON.stringify(await Promise.all([alpha, bravo, witness].map(peerState))));
            console.log('Bounded signaling diagnostics', JSON.stringify(await Promise.all([alpha, bravo, witness].map(page => page.evaluate(() => window.__mediaDiagnostics)))));
            console.log('Pre-block native media state', JSON.stringify(await Promise.all([alpha, bravo, witness].map(page => page.evaluate(() => ({
                name: window.__lobby.me, capture: window.__captureCalls,
                peers: [...window.__lobbyRoom.state.pcs].map(([id, entry]) => {
                    const current = entry.pc.localDescription?.sdp || '', original = entry.pc.__localSnapshot?.sdp || '';
                    const lines = sdp => sdp.split(/\r?\n/).filter(line => line && !/^a=(?:candidate:|end-of-candidates$)/.test(line));
                    const classify = line => /^a=([^:]+)/.exec(line)?.[0] || /^m=([^ ]+)/.exec(line)?.[0] || line.slice(0, 2);
                    const selected = (sdp, pattern) => sdp.split(/\r?\n/).filter(line => pattern.test(line)).join('\n');
                    return { id, probe: entry.pc.__probeId, signaling: entry.pc.signalingState, connected: entry.pc.connectionState,
                        sameOriginVersion: selected(current, /^o=/) === selected(original, /^o=/), sameIceCredentials: selected(current, /^a=ice-(ufrag|pwd):/) === selected(original, /^a=ice-(ufrag|pwd):/),
                        changedLineKinds: [...new Set([...lines(current).filter(line => !lines(original).includes(line)), ...lines(original).filter(line => !lines(current).includes(line))].map(classify))],
                        senders: entry.pc.getSenders().map(sender => sender.track?.kind || null), receivers: entry.stream.getTracks().map(track => ({ kind: track.kind, state: track.readyState })) };
                })
            })))))); throw error;
        }
        const witnessBefore = await peerState(witness);
        for (const [page, name] of [[alpha, 'MediaBravo'], [bravo, 'MediaAlpha']]) await page.evaluate(async nickname => {
            const state = window.__lobbyRoom.state, id = [...state.names].find(([, name]) => name === nickname)[0], entry = state.pcs.get(id);
            const thirdId = [...state.names].find(([, name]) => name === 'MediaWitness')[0];
            const third = state.pcs.get(thirdId).pc, stats = await third.getStats(); let decoded = 0;
            stats.forEach(report => { if (report.type === 'inbound-rtp' && (report.kind === 'video' || report.mediaType === 'video')) decoded += report.framesDecoded || 0; });
            window.__blockedPairProof = { id, pc: entry.pc, received: entry.stream.getTracks(), thirdId, third, decoded, local: state.stream.getTracks() };
        }, name);
        await block(alpha, 'MediaBravo');
        for (const page of [alpha, bravo]) await expect.poll(() => page.evaluate(async () => {
            const state = window.__lobbyRoom.state, old = window.__blockedPairProof;
            const stats = await old.third.getStats(); let decoded = 0;
            stats.forEach(report => { if (report.type === 'inbound-rtp' && (report.kind === 'video' || report.mediaType === 'video')) decoded += report.framesDecoded || 0; });
            return !state.pcs.has(old.id) && old.pc.signalingState === 'closed' && old.received.every(track => track.readyState === 'ended')
                && state.pcs.get(old.thirdId)?.pc === old.third && old.third.connectionState === 'connected' && decoded > old.decoded && old.local.every(track => track.readyState === 'live');
        })).toBe(true);
        await expect.poll(async () => (await peerState(witness)).filter(peer => peer.connected === 'connected' && peer.decoded > witnessBefore.find(old => old.id === peer.id)?.decoded).length).toBe(2);
        expect(await alpha.evaluate(() => window.__captureCalls)).toBe(1); expect(await bravo.evaluate(() => window.__captureCalls)).toBe(1);
        expect(await alpha.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        await alpha.screenshot({ path: testInfo.outputPath(`blocked-camera-${width}.png`), fullPage: true });

        // A changed nickname on a same-device new connection is real admission,
        // not a bypass of the existing one-minute nickname-change cooldown.
        const parallel = await app.guest('stalemate', 'ParallelBravo', bravo.context()); await command(parallel, `/join ${room}`); await expect(parallel.locator('[data-chat-context]')).toHaveText(room); await camera(parallel);
        const alphaId = await alpha.evaluate(() => window.__lobbyRoom.state.myId), parallelId = await parallel.evaluate(() => window.__lobbyRoom.state.myId);
        await expect.poll(() => parallel.evaluate(id => window.__lobby.chans.get(window.__lobby.active).mediaBlocked?.includes(id), alphaId)).toBe(true);
        await expect.poll(() => alpha.evaluate(id => window.__lobby.chans.get(window.__lobby.active).mediaBlocked?.includes(id), parallelId)).toBe(true);
        expect(await parallel.evaluate(id => window.__lobbyRoom.state.pcs.has(id), alphaId)).toBe(false);
        expect(await alpha.evaluate(id => window.__lobbyRoom.state.pcs.has(id), parallelId)).toBe(false);
        await expect.poll(async () => (await peerState(parallel)).filter(peer => peer.connected === 'connected' && peer.tracks > 0 && peer.decoded > 0).length).toBe(2);

        await block(bravo, 'MediaAlpha'); await command(alpha, '/unblock MediaBravo');
        await expect(alpha.locator('[data-buffer]')).toContainText('Unblocked MediaBravo.');
        expect(await alpha.evaluate(() => window.__lobbyRoom.state.pcs.has(window.__blockedPairProof.id))).toBe(false);
        await command(bravo, '/unblock MediaAlpha'); await expect(bravo.locator('[data-buffer]')).toContainText('Unblocked MediaAlpha.');
        for (const page of [alpha, bravo]) {
            const id = await page.evaluate(() => window.__blockedPairProof.id);
            await expect.poll(async () => { const peer = (await peerState(page)).find(item => item.id === id); return peer?.connected === 'connected' && peer.decoded > 0; }).toBe(true);
        }
        for (const page of [alpha, bravo, witness, parallel]) expect(await page.evaluate(() => window.__captureCalls)).toBe(1);
        expect(app.errors).toEqual([]);
        console.log('Public media Block acceptance', JSON.stringify({ width, initialPairs: 6, closedPairs: 2, parallelDevice: true,
            finalDecoded: await Promise.all([alpha, bravo, witness, parallel].map(peerState)), captureCalls: await Promise.all([alpha, bravo, witness, parallel].map(page => page.evaluate(() => window.__captureCalls))) }));
    } finally { await app.close(); }
});
