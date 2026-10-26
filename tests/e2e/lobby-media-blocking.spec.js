// Visible controls, real loopback relay/engine and real Chromium WebRTC with
// synthetic camera devices. This does not qualify TURN/WAN or hosted identity.
const http = require('node:http');
const { randomUUID, createHash } = require('node:crypto');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const ROOT = '/r/45662413410ed051/lobby/', PREVIEW = 'local-preview-key-0001';
const diagnostic = process.env.HANGOUT_MEDIA_DIAGNOSTIC === '1';
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--disable-features=WebRtcHideLocalIpsWithMdns'] } });
test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium supplies the synthetic cameras');

async function scenario(browser, baseURL, width, { heldCaptureFor = null } = {}) {
    const contexts = [], websites = [], errors = [], transforms = [];
    const relay = hangoutRelayWsBase(baseURL, `shared-community-media-${randomUUID()}`);
    async function guest(source, nickname, existingContext) {
        const context = existingContext || await browser.newContext({ viewport: { width, height: 812 }, permissions: ['camera'] });
        if (!existingContext) {
            contexts.push(context);
            await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
            if (diagnostic) await context.route('**/lobby-room.js', async route => {
                const response = await route.fetch(), original = await response.text();
                const marker = 'window.__lobbyRoom = { state, player }; // test hook';
                expect(original.split(marker)).toHaveLength(2);
                const getter = 'window.__lobbyRoom = { state, player, diagnosticActivity: () => ({ frames: activity.queue.length, bytes: activity.bytes, tokens: activity.tokens, sinceTokenUpdateMs: Date.now() - activity.at, queued: Object.values(activity.queue.reduce((groups, item) => { const key = item.kind + ":" + (item.to || "activity") + ":" + (item.sdp?.type || "data"); const row = groups[key] ||= { kind: item.kind, to: item.to, sdp: item.sdp?.type, count: 0, bytes: 0, retired: 0, epochMismatches: 0, iceUnionMismatches: 0 }; row.count++; row.bytes += item.bytes; if (item.entry && !item.entry.current()) row.retired++; if (item.sdp && item.epoch !== item.entry?.descriptionEpoch) row.epochMismatches++; if (item.kind === "rtc" && !item.sdp && item.iceGeneration !== iceGeneration(item.entry?.pc.localDescription, item.iceSelector, item.ufrag)) row.iceUnionMismatches++; return groups; }, {})) }) }; // test-only read-only queue getter';
                const served = original.replace(marker, getter);
                transforms.push({ originalSha256: createHash('sha256').update(original).digest('hex'), servedSha256: createHash('sha256').update(served).digest('hex') });
                await route.fulfill({ response, body: served });
            });
            await context.addInitScript(({ heldCapture }) => {
                window.__captureCalls = 0;
                if (!navigator.mediaDevices) return; // about:blank has no capture API.
                const nativeCapture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
                let releaseCapture, releaseOffer, releaseRemote;
                const captureGate = heldCapture ? new Promise(resolve => { releaseCapture = resolve; }) : Promise.resolve();
                window.__holdMedia = false;
                window.__releaseHeldOffer = () => releaseOffer?.();
                window.__releaseHeldCapture = () => releaseCapture?.();
                window.__releaseHeldRemoteOffer = () => releaseRemote?.();
                window.__releaseHeldMedia = () => { releaseOffer?.(); releaseCapture?.(); releaseRemote?.(); };
                navigator.mediaDevices.getUserMedia = constraints => {
                    window.__captureCalls += 1;
                    const capture = nativeCapture(constraints);
                    return window.__holdMedia ? capture.then(async stream => { await captureGate; return stream; }) : capture;
                };
                window.__safeMediaSdp = (description, candidate) => {
                    const session = [], sections = []; let target = session;
                    for (const line of (description?.sdp || '').split(/\r?\n/).filter(Boolean)) {
                        if (line.startsWith('m=')) { target = []; sections.push(target); } target.push(line);
                    }
                    const attr = (section, name) => (section?.find(line => line.startsWith('a=' + name + ':')) || session.find(line => line.startsWith('a=' + name + ':')) || '').slice(name.length + 3);
                    const hasMid = candidate?.sdpMid !== undefined && candidate.sdpMid !== null, hasIndex = candidate?.sdpMLineIndex !== undefined && candidate.sdpMLineIndex !== null;
                    const byMid = hasMid ? sections.filter(section => attr(section, 'mid') === candidate.sdpMid) : [];
                    const byIndex = hasIndex && Number.isInteger(candidate.sdpMLineIndex) ? sections[candidate.sdpMLineIndex] : null;
                    const selected = hasMid ? byMid.length === 1 ? byMid[0] : null : byIndex;
                    const selectorValid = !!selected && (!hasIndex || byIndex === selected);
                    return { present: !!description, type: description?.type, sections: sections.map(section => ({
                        active: section[0].split(/\s+/)[1]?.split('/')[0] !== '0',
                        direction: section.find(line => /^a=(sendrecv|sendonly|recvonly|inactive)$/.test(line))?.slice(2) || 'unspecified'
                    })), credentialTuples: new Set(sections.map(section => attr(section, 'ice-ufrag') + '\n' + attr(section, 'ice-pwd'))).size,
                    candidateSelectorValid: candidate ? selectorValid : null,
                    candidateFragmentMatchesSelected: candidate?.usernameFragment ? selectorValid && attr(selected, 'ice-ufrag') === candidate.usernameFragment : null };
                };
                window.__mediaDiagnostics = []; window.__mediaControlTotals = {}; let sequence = 0;
                const record = entry => { window.__mediaDiagnostics.push({ atMs: Math.round(performance.now()), ...entry }); if (window.__mediaDiagnostics.length > 200) window.__mediaDiagnostics.shift(); };
                const frame = (direction, raw) => {
                    try {
                        const item = JSON.parse(raw);
                        if (item.t === 'act' && item.kind === 'rtc') {
                            const key = [direction, item.from || item.to, item.sdp?.type || 'ice'].join(':');
                            window.__mediaControlTotals[key] = (window.__mediaControlTotals[key] || 0) + 1;
                            const binding = direction === 'out' && item.ice ? window.__safeMediaSdp(window.__lobbyRoom?.state.pcs.get(item.to)?.pc.localDescription, item.ice) : null;
                            record({ direction, from: item.from, to: item.to, type: item.sdp?.type || 'ice', bytes: raw.length,
                                selectedTupleValid: binding?.candidateSelectorValid, selectedFragmentMatches: binding?.candidateFragmentMatchesSelected });
                        }
                        if (item.t === 'notice' && item.kind === 'error') record({ direction, notice: String(item.text).slice(0, 100) });
                    } catch { /* Non-application frame. No SDP, ICE addresses or credentials are recorded. */ }
                };
                const NativeSocket = window.WebSocket;
                window.WebSocket = class extends NativeSocket {
                    constructor(...args) {
                        super(...args);
                        this.addEventListener('message', event => {
                            if (heldCapture && window.__holdMedia && !releaseOffer) {
                                let item; try { item = JSON.parse(event.data); } catch { /* Not application JSON. */ }
                                if (item?.t === 'act' && item.kind === 'rtc' && item.sdp?.type === 'offer') {
                                    event.stopImmediatePropagation();
                                    releaseOffer = () => {
                                        if (window.__heldOfferReleased) return;
                                        window.__heldOfferReleased = true; this.dispatchEvent(new MessageEvent('message', { data: event.data }));
                                    };
                                    window.__heldOfferFrom = item.from; return;
                                }
                            }
                            frame('in', event.data);
                        });
                    }
                    send(raw) { frame('out', raw); return super.send(raw); }
                };
                const NativePC = window.RTCPeerConnection;
                window.RTCPeerConnection = class extends NativePC {
                    constructor(...args) {
                        super(...args); this.__probeId = ++sequence; this.__nativeIce = 0; this.__localStarts = 0; this.__nativeNegotiations = 0;
                        this.addEventListener('negotiationneeded', () => {
                            this.__nativeNegotiations += 1; record({ pc: this.__probeId, op: 'native-negotiation', state: this.signalingState });
                        });
                        this.addEventListener('icecandidate', event => {
                            if (!event.candidate) return;
                            this.__nativeIce += 1;
                            const current = this.localDescription, fragment = event.candidate.usernameFragment;
                            record({ pc: this.__probeId, op: 'native-ice', localPresent: !!current, localType: current?.type, state: this.signalingState,
                                gathering: this.iceGatheringState, hasFragment: !!fragment, fragmentMatchesLocal: fragment ? !!current?.sdp.split(/\r?\n/).includes('a=ice-ufrag:' + fragment) : null,
                                selected: window.__safeMediaSdp(current, event.candidate) });
                        });
                        this.addEventListener('icegatheringstatechange', () => record({ pc: this.__probeId, op: 'gathering', state: this.iceGatheringState }));
                    }
                    addTransceiver(...args) { record({ pc: this.__probeId, op: 'manual-transceiver' }); return super.addTransceiver(...args); }
                    async setLocalDescription(description) {
                        this.__localStarts += 1;
                        record({ pc: this.__probeId, op: 'local-start', argument: description?.type || 'auto', state: this.signalingState });
                        try {
                            const native = super.setLocalDescription(description);
                            if (window.__releaseOfferAtLocalStart && !window.__heldOfferReleased) window.__releaseHeldOffer();
                            await native;
                            this.__localSnapshot = this.localDescription?.toJSON(); record({ pc: this.__probeId, op: 'local', type: this.localDescription?.type, state: this.signalingState });
                        }
                        catch (error) { record({ pc: this.__probeId, op: 'local-error', name: error.name, state: this.signalingState }); throw error; }
                    }
                    async setRemoteDescription(description) {
                        record({ pc: this.__probeId, op: 'remote-request', type: description.type, state: this.signalingState });
                        if (window.__holdNativeOffer && description.type === 'offer' && !releaseRemote) {
                            window.__pendingNativeOffer = { pc: this.__probeId, state: this.signalingState };
                            await new Promise(resolve => { releaseRemote = resolve; });
                        }
                        record({ pc: this.__probeId, op: 'remote-start', type: description.type, state: this.signalingState });
                        try { await super.setRemoteDescription(description); record({ pc: this.__probeId, op: 'remote', type: description.type, state: this.signalingState }); }
                        catch (error) { record({ pc: this.__probeId, op: 'remote-error', type: description.type, name: error.name, state: this.signalingState }); throw error; }
                    }
                };
            }, { heldCapture: nickname === heldCaptureFor || heldCaptureFor === '*' });
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
    return { guest, errors, transforms, close: async () => { await Promise.allSettled(contexts.map(context => context.close())); for (const website of websites) { website.closeAllConnections(); await new Promise(resolve => website.close(resolve)); } } };
}
async function command(page, text) {
    await page.click('nav [data-show="chat"]'); await page.fill('[data-text]', text); await page.press('[data-text]', 'Enter');
}
async function requestCamera(page) {
    await page.click('nav [data-show="chat"]'); await page.click('[data-cam]');
    await page.locator('[data-cam-gate] [data-adult]').check(); await page.locator('[data-cam-gate] [data-cam-yes]').click();
}
async function camera(page) {
    await requestCamera(page);
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
const diagnosticState = page => page.evaluate(async () => ({
    name: window.__lobby.me, queue: window.__lobbyRoom.diagnosticActivity?.(), totals: window.__mediaControlTotals,
    peers: await Promise.all([...window.__lobbyRoom.state.pcs].map(async ([id, entry]) => {
        const stats = await entry.pc.getStats(), pairStates = {}; let local = 0, remote = 0, decoded = 0;
        stats.forEach(row => {
            if (row.type === 'candidate-pair') pairStates[row.state] = (pairStates[row.state] || 0) + 1;
            if (row.type === 'local-candidate') local += 1;
            if (row.type === 'remote-candidate') remote += 1;
            if (row.type === 'inbound-rtp' && (row.kind === 'video' || row.mediaType === 'video')) decoded += row.framesDecoded || 0;
        });
        return { id, probe: entry.pc.__probeId, generatedIce: entry.pc.__nativeIce, signaling: entry.pc.signalingState,
            gathering: entry.pc.iceGatheringState, ice: entry.pc.iceConnectionState, connected: entry.pc.connectionState,
            localPresent: !!entry.pc.localDescription, localType: entry.pc.localDescription?.type,
            candidateLines: (entry.pc.localDescription?.sdp.match(/^a=candidate:/gm) || []).length, localCandidates: local, remoteCandidates: remote, pairStates, decoded,
            localShape: window.__safeMediaSdp(entry.pc.localDescription), remoteShape: window.__safeMediaSdp(entry.pc.remoteDescription) };
    }))
}));

for (const width of [375, 390]) test(`pending capture waits for an incoming offer to create its receiver at ${width}px`, async ({ browser, baseURL }) => {
    const app = await scenario(browser, baseURL, width, { heldCaptureFor: '*' });
    try {
        const alpha = await app.guest('stalemate', 'CaptureAlpha'), bravo = await app.guest('rad-dad', 'CaptureBravo');
        await alpha.click('nav [data-show="rooms"]'); await alpha.click('[data-start="art"]');
        await expect(alpha.locator('[data-act-canvas]')).toBeVisible();
        const room = await alpha.locator('[data-chat-context]').innerText();
        await command(bravo, `/join ${room}`); await expect(bravo.locator('[data-chat-context]')).toHaveText(room);
        await expect(bravo.locator('[data-act-canvas]')).toBeVisible();
        const ids = await Promise.all([alpha, bravo].map(page => page.evaluate(() => window.__lobbyRoom.state.myId)));
        for (const id of ids) expect(id).toMatch(/^c[a-f0-9]{32}$/);
        // Exercise the real perfect-negotiation polite/rollback role, without
        // replacing the gateway's opaque production-shaped connection IDs.
        const [sender, receiver] = ids[0] < ids[1] ? [alpha, bravo] : [bravo, alpha];
        await receiver.evaluate(() => { window.__holdMedia = true; });
        await camera(sender); await requestCamera(receiver);
        await expect.poll(() => receiver.evaluate(() => !!window.__heldOfferFrom && window.__lobbyRoom.state.pcs.has(window.__heldOfferFrom))).toBe(true);
        const pending = await receiver.evaluate(() => ({
            captureCalls: window.__captureCalls, hasStream: !!window.__lobbyRoom.state.stream,
            heldOffer: !!window.__heldOfferFrom, released: !!window.__heldOfferReleased,
            native: window.__mediaDiagnostics.filter(event => event.op === 'manual-transceiver' || event.op === 'local'),
            descriptions: [...window.__lobbyRoom.state.pcs.values()].map(entry => entry.pc.localDescription?.type || null)
        }));
        console.log('Held-capture early ICE receiver state', JSON.stringify({ width, ...pending }));
        expect(pending.captureCalls).toBe(1); expect(pending.hasStream).toBe(false); expect(pending.released).toBe(false);
        // On the old path, finish the already-triggered native offer so the
        // genuine held offer exercises implicit rollback. Retain its functional
        // outcome before asserting the startup invariant below.
        if (pending.native.some(event => event.op === 'manual-transceiver')) await expect.poll(() => receiver.evaluate(() =>
            [...window.__lobbyRoom.state.pcs.values()][0]?.pc.localDescription?.type)).toBe('offer');
        let functionalError;
        try {
            await receiver.evaluate(() => window.__releaseHeldOffer());
            await expect.poll(() => sender.evaluate(() => [...window.__lobbyRoom.state.pcs.values()][0]?.pc.remoteDescription?.type)).toBe('answer');
            await receiver.evaluate(() => window.__releaseHeldCapture());
            await expect.poll(() => receiver.evaluate(() => !!window.__lobbyRoom.state.stream)).toBe(true);
            for (const page of [alpha, bravo]) await expect.poll(async () => {
                const peers = await peerState(page); return peers.length === 1 && peers[0].connected === 'connected' && peers[0].decoded > 0 && peers[0].tracks > 0;
            }).toBe(true);
        } catch (error) { functionalError = error; }
        finally { await receiver.evaluate(() => window.__releaseHeldMedia()); }
        console.log('Held-capture native functional outcome', JSON.stringify({ width, decoded: !functionalError,
            participants: await Promise.all([alpha, bravo].map(diagnosticState)) }));
        // Real early ICE may create the PC, but cannot invent a local offer.
        // Native setRemoteDescription will create the receiving transceiver.
        expect(pending.native).toEqual([]); expect(pending.descriptions).toEqual([null]);
        if (functionalError) throw functionalError;
        for (const page of [alpha, bravo]) expect(await page.evaluate(() => window.__captureCalls)).toBe(1);
        expect(app.errors).toEqual([]);
    } finally { await app.close(); }
});

for (const width of [375, 390]) test(`pending incoming offer fences native negotiation and permits later renegotiation at ${width}px`, async ({ browser, baseURL }) => {
    const app = await scenario(browser, baseURL, width, { heldCaptureFor: '*' });
    let receiver;
    try {
        const alpha = await app.guest('stalemate', 'OfferAlpha'), bravo = await app.guest('rad-dad', 'OfferBravo');
        await alpha.click('nav [data-show="rooms"]'); await alpha.click('[data-start="art"]');
        await expect(alpha.locator('[data-act-canvas]')).toBeVisible();
        const room = await alpha.locator('[data-chat-context]').innerText();
        await command(bravo, `/join ${room}`); await expect(bravo.locator('[data-act-canvas]')).toBeVisible();
        const ids = await Promise.all([alpha, bravo].map(page => page.evaluate(() => window.__lobbyRoom.state.myId)));
        for (const id of ids) expect(id).toMatch(/^c[a-f0-9]{32}$/);
        const sender = ids[0] < ids[1] ? alpha : bravo; receiver = sender === alpha ? bravo : alpha;
        await receiver.evaluate(() => { window.__holdMedia = true; window.__holdNativeOffer = true; });
        await camera(sender); await requestCamera(receiver);
        await expect.poll(() => receiver.evaluate(() => !!window.__heldOfferFrom && window.__lobbyRoom.state.pcs.has(window.__heldOfferFrom))).toBe(true);
        await receiver.evaluate(() => window.__releaseHeldOffer());
        await expect.poll(() => receiver.evaluate(() => !!window.__pendingNativeOffer)).toBe(true);
        // The application has accepted the real incoming offer and invoked SRD;
        // its wrapper holds the native effect. Completing opted-in capture now
        // adds a real track and dispatches native negotiationneeded in that gap.
        await receiver.evaluate(() => window.__releaseHeldCapture());
        await expect.poll(() => receiver.evaluate(() => [...window.__lobbyRoom.state.pcs.values()][0]?.pc.__nativeNegotiations > 0)).toBe(true);
        const pending = await receiver.evaluate(() => {
            const entry = [...window.__lobbyRoom.state.pcs.values()][0];
            return { polite: entry.polite, capture: window.__captureCalls, hasStream: !!window.__lobbyRoom.state.stream,
                localStarts: entry.pc.__localStarts, nativeNegotiations: entry.pc.__nativeNegotiations,
                localType: entry.pc.localDescription?.type || null, remoteType: entry.pc.remoteDescription?.type || null };
        });
        console.log('Pending native remote-offer invocation window', JSON.stringify({ width, ...pending }));
        expect(pending.polite).toBe(true); expect(pending.capture).toBe(1); expect(pending.hasStream).toBe(true);
        if (pending.localStarts) await expect.poll(() => receiver.evaluate(() => [...window.__lobbyRoom.state.pcs.values()][0]?.pc.localDescription?.type)).toBe('offer');
        let functionalError, later = false;
        try {
            await receiver.evaluate(() => window.__releaseHeldRemoteOffer());
            for (const page of [alpha, bravo]) await expect.poll(async () => {
                const peers = await peerState(page); return peers.length === 1 && peers[0].connected === 'connected' && peers[0].decoded > 0;
            }).toBe(true);
            const before = await Promise.all([alpha, bravo].map(peerState));
            const localBefore = await receiver.evaluate(() => {
                const pc = [...window.__lobbyRoom.state.pcs.values()][0].pc, count = pc.__localStarts;
                // A deliberate later native media change must still negotiate.
                // It uses the existing capture and keeps its first video active.
                pc.addTransceiver('video', { direction: 'recvonly' }); return count;
            });
            await expect.poll(() => receiver.evaluate(count => {
                const pc = [...window.__lobbyRoom.state.pcs.values()][0].pc;
                return pc.__localStarts > count && pc.signalingState === 'stable' && pc.localDescription?.type === 'offer'
                    && pc.remoteDescription?.type === 'answer' && (pc.localDescription.sdp.match(/^m=/gm) || []).length === 2;
            }, localBefore)).toBe(true);
            for (const [index, page] of [alpha, bravo].entries()) await expect.poll(async () => {
                const peer = (await peerState(page))[0]; return peer.connected === 'connected' && peer.decoded > before[index][0].decoded;
            }).toBe(true);
            later = true;
        } catch (error) { functionalError = error; }
        console.log('Pending remote-offer functional outcome', JSON.stringify({ width, decoded: !functionalError, laterRenegotiated: later,
            participants: await Promise.all([alpha, bravo].map(diagnosticState)) }));
        expect(pending.localStarts).toBe(0); expect(pending.localType).toBeNull(); expect(pending.remoteType).toBeNull();
        if (functionalError) throw functionalError;
        expect(later).toBe(true); expect(app.errors).toEqual([]);
        for (const page of [alpha, bravo]) expect(await page.evaluate(() => window.__captureCalls)).toBe(1);
    } finally {
        if (receiver && !receiver.isClosed()) await receiver.evaluate(() => window.__releaseHeldMedia());
        await app.close();
    }
});

for (const width of [375, 390]) test(`an already-invoked native offer survives polite glare and later renegotiation at ${width}px`, async ({ browser, baseURL }) => {
    const app = await scenario(browser, baseURL, width, { heldCaptureFor: '*' });
    let receiver, alpha, bravo, decoded = false, later = false;
    try {
        alpha = await app.guest('stalemate', 'GlareAlpha'); bravo = await app.guest('rad-dad', 'GlareBravo');
        await alpha.click('nav [data-show="rooms"]'); await alpha.click('[data-start="art"]');
        await expect(alpha.locator('[data-act-canvas]')).toBeVisible(); const room = await alpha.locator('[data-chat-context]').innerText();
        await command(bravo, `/join ${room}`); await expect(bravo.locator('[data-act-canvas]')).toBeVisible();
        const ids = await Promise.all([alpha, bravo].map(page => page.evaluate(() => window.__lobbyRoom.state.myId)));
        for (const id of ids) expect(id).toMatch(/^c[a-f0-9]{32}$/);
        const sender = ids[0] < ids[1] ? alpha : bravo; receiver = sender === alpha ? bravo : alpha;
        await receiver.evaluate(() => { window.__holdMedia = true; window.__releaseOfferAtLocalStart = true; });
        await camera(sender); await requestCamera(receiver);
        await expect.poll(() => receiver.evaluate(() => !!window.__heldOfferFrom && window.__lobbyRoom.state.pcs.has(window.__heldOfferFrom))).toBe(true);
        // Completing actual capture invokes native SLD through negotiationneeded.
        // Its probe dispatches the genuine held peer offer synchronously AFTER
        // calling native SLD, BEFORE awaiting completion/ICE tasks. The incoming
        // offer fence cannot retroactively prevent that already-started call.
        await receiver.evaluate(() => window.__releaseHeldCapture());
        await expect.poll(() => receiver.evaluate(() => !!window.__heldOfferReleased)).toBe(true);
        for (const page of [alpha, bravo]) await expect.poll(async () => {
            const peers = await peerState(page); return peers.length === 1 && peers[0].connected === 'connected' && peers[0].decoded > 0;
        }).toBe(true);
        decoded = true;
        const before = await Promise.all([alpha, bravo].map(peerState));
        const localBefore = await receiver.evaluate(() => {
            const pc = [...window.__lobbyRoom.state.pcs.values()][0].pc, count = pc.__localStarts;
            pc.addTransceiver('video', { direction: 'recvonly' }); return count;
        });
        await expect.poll(() => receiver.evaluate(count => {
            const pc = [...window.__lobbyRoom.state.pcs.values()][0].pc;
            return pc.__localStarts > count && pc.signalingState === 'stable' && pc.localDescription?.type === 'offer'
                && pc.remoteDescription?.type === 'answer' && (pc.localDescription.sdp.match(/^m=/gm) || []).length === 2;
        }, localBefore)).toBe(true);
        for (const [index, page] of [alpha, bravo].entries()) await expect.poll(async () => {
            const peer = (await peerState(page))[0]; return peer.connected === 'connected' && peer.decoded > before[index][0].decoded;
        }).toBe(true);
        later = true; expect(app.errors).toEqual([]);
        for (const page of [alpha, bravo]) expect(await page.evaluate(() => window.__captureCalls)).toBe(1);
    } finally {
        if (alpha && bravo) console.log('Already-invoked native glare outcome', JSON.stringify({ width, decoded, laterRenegotiated: later,
            participants: await Promise.all([alpha, bravo].map(diagnosticState)),
            events: await Promise.all([alpha, bravo].map(page => page.evaluate(() => window.__mediaDiagnostics))) }));
        if (receiver && !receiver.isClosed()) await receiver.evaluate(() => window.__releaseHeldMedia());
        await app.close();
    }
});

for (const width of [375, 390]) test(`Block retires live camera pairs across entries and same-device tabs at ${width}px`, async ({ browser, baseURL }, testInfo) => {
    const scenarioStarted = Date.now();
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
            if (diagnostic) {
                const failedAt = Date.now(), until = failedAt + Math.max(0, Math.min(15000, testInfo.timeout - (failedAt - scenarioStarted) - 2000)), samples = [];
                do {
                    const participants = await Promise.all([alpha, bravo, witness].map(diagnosticState));
                    const allDecoded = participants.every(person => person.peers.length === 2 && person.peers.every(peer => peer.connected === 'connected' && peer.decoded > 0));
                    if (!samples.length || Date.now() - failedAt - samples.at(-1).sinceFailureMs >= 1000 || allDecoded || Date.now() >= until - 250)
                        samples.push({ sinceScenarioMs: Date.now() - scenarioStarted, sinceFailureMs: Date.now() - failedAt, participants, allDecoded });
                    if (allDecoded) break;
                    await new Promise(resolve => setTimeout(resolve, 250));
                } while (Date.now() < until);
                console.log('Instrumented post-failure observation (original five-second failure retained)', JSON.stringify({ transforms: app.transforms, samples }));
            }
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
        if (diagnostic) console.log('Instrumented baseline passed without extending its five-second assertion', JSON.stringify({
            sinceScenarioMs: Date.now() - scenarioStarted, transforms: app.transforms, participants: await Promise.all([alpha, bravo, witness].map(diagnosticState)),
            nativeEvents: await Promise.all([alpha, bravo, witness].map(page => page.evaluate(() => window.__mediaDiagnostics)))
        }));
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
        try {
            for (const page of [alpha, bravo, witness, parallel]) await expect.poll(async () => {
                const peers = await peerState(page);
                return peers.length === 3 && peers.every(peer => peer.signaling === 'stable' && peer.connected === 'connected' && peer.tracks > 0 && peer.decoded > 0);
            }).toBe(true);
        } catch (error) {
            console.log('Final four-peer mesh state', JSON.stringify(await Promise.all([alpha, bravo, witness, parallel].map(diagnosticState))));
            console.log('Final bounded signaling diagnostics', JSON.stringify(await Promise.all([alpha, bravo, witness, parallel].map(page => page.evaluate(() => window.__mediaDiagnostics)))));
            throw error;
        }
        for (const page of [alpha, bravo, witness, parallel]) expect(await page.evaluate(() => window.__captureCalls)).toBe(1);
        expect(app.errors).toEqual([]);
        console.log('Public media Block acceptance', JSON.stringify({ width, initialPairs: 6, closedPairs: 2, parallelDevice: true,
            finalDecoded: await Promise.all([alpha, bravo, witness, parallel].map(peerState)), captureCalls: await Promise.all([alpha, bravo, witness, parallel].map(page => page.evaluate(() => window.__captureCalls))) }));
    } finally { await app.close(); }
});
