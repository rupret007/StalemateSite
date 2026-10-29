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
                const earlyRtc = []; let earlyRtcBytes = 0;
                const captureGate = heldCapture ? new Promise(resolve => { releaseCapture = resolve; }) : Promise.resolve();
                window.__holdMedia = false;
                window.__releaseHeldOffer = () => releaseOffer?.();
                window.__releaseHeldCapture = () => releaseCapture?.();
                window.__releaseHeldRemoteOffer = () => releaseRemote?.();
                window.__releaseHeldMedia = () => { releaseOffer?.(); releaseCapture?.(); releaseRemote?.(); };
                window.__armHeldOfferForGlare = holdIce => {
                    releaseOffer = null; earlyRtc.length = 0; earlyRtcBytes = 0;
                    window.__heldOfferFrom = null; window.__heldOfferReleased = false;
                    window.__holdOffer = true; window.__holdEarlyRtc = holdIce;
                    window.__glarePhase = (window.__glarePhase || 0) + 1;
                };
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
                const record = entry => { window.__mediaDiagnostics.push({ atMs: Math.round(performance.now()), phase: window.__glarePhase || 0, ...entry }); if (window.__mediaDiagnostics.length > 200) window.__mediaDiagnostics.shift(); };
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
                            if (heldCapture && (window.__holdMedia || window.__holdOffer)) {
                                let item; try { item = JSON.parse(event.data); } catch { /* Not application JSON. */ }
                                if (!window.__heldOfferReleased && window.__holdEarlyRtc && item?.t === 'act' && item.kind === 'rtc' && item.ice) {
                                    event.stopImmediatePropagation();
                                    if (earlyRtc.length >= 64 || earlyRtcBytes + event.data.length > 65536) throw new Error('bounded native fixture early-ICE overflow');
                                    earlyRtc.push(event.data); earlyRtcBytes += event.data.length; return;
                                }
                                if (!releaseOffer && item?.t === 'act' && item.kind === 'rtc' && item.sdp?.type === 'offer') {
                                    event.stopImmediatePropagation();
                                    releaseOffer = () => {
                                        if (window.__heldOfferReleased) return;
                                        window.__heldOfferReleased = true; this.dispatchEvent(new MessageEvent('message', { data: event.data }));
                                        for (const data of earlyRtc.splice(0)) this.dispatchEvent(new MessageEvent('message', { data }));
                                        earlyRtcBytes = 0;
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
                        super(...args); this.__probeId = ++sequence; this.__nativeIce = 0; this.__localStarts = 0; this.__nativeNegotiations = 0; this.__trackAdds = 0;
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
                    addTrack(...args) { this.__trackAdds += 1; record({ pc: this.__probeId, op: 'track-add', state: this.signalingState, hasRemote: !!this.remoteDescription }); return super.addTrack(...args); }
                    close() { record({ pc: this.__probeId, op: 'close', state: this.signalingState, hasCurrentRemote: !!this.currentRemoteDescription }); return super.close(); }
                    async setLocalDescription(description) {
                        this.__localStarts += 1;
                        record({ pc: this.__probeId, op: 'local-start', argument: description?.type || 'auto', state: this.signalingState, hasCurrentRemote: !!this.currentRemoteDescription });
                        try {
                            const native = super.setLocalDescription(description);
                            if (window.__releaseOfferAtLocalStart && !window.__heldOfferReleased) {
                                window.__glareOldPc = this; window.__glareStartedEstablished = !!this.currentRemoteDescription;
                                window.__releaseHeldOffer();
                            }
                            await native;
                            this.__localSnapshot = this.localDescription?.toJSON(); record({ pc: this.__probeId, op: 'local', argument: description?.type || 'auto', type: this.localDescription?.type, state: this.signalingState });
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
            localPresent: !!entry.pc.localDescription, localType: entry.pc.localDescription?.type, hasCurrentRemote: !!entry.pc.currentRemoteDescription, hasPendingRemote: !!entry.pc.pendingRemoteDescription,
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
        // Capture resolving while accepted SRD is held keeps a passive PC
        // trackless until the native receiver exists under the offer fence.
        await receiver.evaluate(() => window.__releaseHeldCapture());
        await expect.poll(() => receiver.evaluate(() => !!window.__lobbyRoom.state.stream)).toBe(true);
        const pending = await receiver.evaluate(() => {
            const entry = [...window.__lobbyRoom.state.pcs.values()][0];
            return { polite: entry.polite, capture: window.__captureCalls, hasStream: !!window.__lobbyRoom.state.stream,
                localStarts: entry.pc.__localStarts, nativeNegotiations: entry.pc.__nativeNegotiations, trackAdds: entry.pc.__trackAdds,
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
        expect(pending.trackAdds).toBe(0); expect(pending.nativeNegotiations).toBe(0);
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
    let receiver, alpha, bravo, decoded = false, later = false, establishedGlare = false, initialProof = null, establishedProof = null;
    try {
        alpha = await app.guest('stalemate', 'GlareAlpha'); bravo = await app.guest('rad-dad', 'GlareBravo');
        await alpha.click('nav [data-show="rooms"]'); await alpha.click('[data-start="art"]');
        await expect(alpha.locator('[data-act-canvas]')).toBeVisible(); const room = await alpha.locator('[data-chat-context]').innerText();
        await command(bravo, `/join ${room}`); await expect(bravo.locator('[data-act-canvas]')).toBeVisible();
        const ids = await Promise.all([alpha, bravo].map(page => page.evaluate(() => window.__lobbyRoom.state.myId)));
        for (const id of ids) expect(id).toMatch(/^c[a-f0-9]{32}$/);
        const sender = ids[0] < ids[1] ? alpha : bravo; receiver = sender === alpha ? bravo : alpha;
        await receiver.evaluate(() => {
            window.__holdMedia = true; window.__armHeldOfferForGlare(true); window.__releaseOfferAtLocalStart = true;
        });
        await camera(sender); await requestCamera(receiver);
        // Hold the genuine offer AND its early ICE until capture creates an
        // active outgoing PC. Incoming early-ICE PCs are now correctly passive.
        await expect.poll(() => receiver.evaluate(() => !!window.__heldOfferFrom && window.__lobbyRoom.state.pcs.size === 0)).toBe(true);
        await receiver.evaluate(() => window.__releaseHeldCapture());
        // The native SLD probe still dispatches the genuine held peer offer
        // synchronously AFTER native SLD invocation, BEFORE awaiting completion.
        await expect.poll(() => receiver.evaluate(() => !!window.__heldOfferReleased)).toBe(true);
        for (const page of [alpha, bravo]) await expect.poll(async () => {
            const peers = await peerState(page); return peers.length === 1 && peers[0].connected === 'connected' && peers[0].decoded > 0;
        }).toBe(true);
        decoded = true;
        initialProof = await receiver.evaluate(() => {
            const old = window.__glareOldPc, entry = [...window.__lobbyRoom.state.pcs.values()][0], events = window.__mediaDiagnostics.filter(event => event.phase === 1);
            const oldDone = events.findIndex(event => event.pc === old.__probeId && event.op === 'local' && event.type === 'offer');
            const retired = events.findIndex(event => event.pc === old.__probeId && event.op === 'close');
            const remoteDone = events.findIndex(event => event.pc === entry.pc.__probeId && event.op === 'remote' && event.type === 'offer');
            const tracks = events.findIndex(event => event.pc === entry.pc.__probeId && event.op === 'track-add');
            const answer = events.findIndex(event => event.pc === entry.pc.__probeId && event.op === 'local-start');
            return { oldProbe: old.__probeId, freshProbe: entry.pc.__probeId, startedEstablished: window.__glareStartedEstablished,
                retired: old !== entry.pc && old.signalingState === 'closed', passiveAnswer: oldDone >= 0 && retired > oldDone && remoteDone > retired && tracks > remoteDone && answer > tracks,
                oldRolledBack: events.some(event => event.pc === old.__probeId && event.op === 'local-start' && event.argument === 'rollback'),
                trackAdds: entry.pc.__trackAdds, localSections: (entry.pc.localDescription.sdp.match(/^m=/gm) || []).length,
                sharedCaptureLive: window.__lobbyRoom.state.stream.getTracks().every(track => track.readyState === 'live'),
                hasCurrentRemote: !!entry.pc.currentRemoteDescription };
        });
        expect(initialProof).toMatchObject({ startedEstablished: false, retired: true, passiveAnswer: true, oldRolledBack: false, trackAdds: 1, localSections: 1, sharedCaptureLive: true, hasCurrentRemote: true });
        expect(initialProof.freshProbe).not.toBe(initialProof.oldProbe);

        // Preserve the existing ordinary later renegotiation requirement.
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
        later = true;

        // Now collide two genuine offers on the ESTABLISHED transport. Change
        // only the unused second transceiver's direction: no capture, ICE
        // restart or additional media section is needed for this control.
        await receiver.evaluate(() => {
            window.__establishedGlarePc = [...window.__lobbyRoom.state.pcs.values()][0].pc;
            window.__armHeldOfferForGlare(true);
        });
        const establishedBefore = await Promise.all([alpha, bravo].map(peerState));
        const requestDirectionChange = page => page.evaluate(() => {
            const pc = [...window.__lobbyRoom.state.pcs.values()][0].pc, transceiver = pc.getTransceivers()[1];
            if (!transceiver) return false;
            transceiver.direction = transceiver.direction === 'sendrecv' ? 'sendonly' : 'sendrecv'; return true;
        });
        expect(await requestDirectionChange(sender)).toBe(true);
        await expect.poll(() => receiver.evaluate(() => !!window.__heldOfferFrom)).toBe(true);
        expect(await requestDirectionChange(receiver)).toBe(true);
        await expect.poll(() => receiver.evaluate(() => !!window.__heldOfferReleased)).toBe(true);
        for (const [index, page] of [alpha, bravo].entries()) await expect.poll(async () => {
            const peer = (await peerState(page))[0];
            return peer.signaling === 'stable' && peer.connected === 'connected' && peer.decoded > establishedBefore[index][0].decoded;
        }).toBe(true);
        establishedProof = await receiver.evaluate(() => {
            const entry = [...window.__lobbyRoom.state.pcs.values()][0], events = window.__mediaDiagnostics.filter(event => event.phase === 2 && event.pc === entry.pc.__probeId);
            const ownStart = events.findIndex(event => event.op === 'local-start' && event.argument === 'auto');
            const ownDone = events.findIndex(event => event.op === 'local' && event.argument === 'auto' && event.type === 'offer');
            const rollbackStart = events.findIndex(event => event.op === 'local-start' && event.argument === 'rollback');
            const rollbackDone = events.findIndex(event => event.op === 'local' && event.argument === 'rollback');
            const remoteStart = events.findIndex(event => event.op === 'remote-start' && event.type === 'offer');
            return { samePc: entry.pc === window.__establishedGlarePc && entry.pc === window.__glareOldPc,
                probe: entry.pc.__probeId, startedEstablished: window.__glareStartedEstablished,
                orderedRollback: ownStart >= 0 && events[ownStart].hasCurrentRemote && ownDone > ownStart && rollbackStart > ownDone && rollbackDone > rollbackStart && remoteStart > rollbackDone,
                closed: events.some(event => event.op === 'close'), trackAdds: entry.pc.__trackAdds,
                localSections: (entry.pc.localDescription.sdp.match(/^m=/gm) || []).length,
                hasCurrentRemote: !!entry.pc.currentRemoteDescription };
        });
        expect(establishedProof).toMatchObject({ samePc: true, startedEstablished: true, orderedRollback: true, closed: false, trackAdds: 1, localSections: 2, hasCurrentRemote: true });
        expect(establishedProof.probe).toBe(initialProof.freshProbe);
        establishedGlare = true; expect(app.errors).toEqual([]);
        for (const page of [alpha, bravo]) expect(await page.evaluate(() => window.__captureCalls)).toBe(1);
    } finally {
        if (alpha && bravo) console.log('Already-invoked native glare outcome', JSON.stringify({ width, decoded, laterRenegotiated: later, establishedGlare, initialProof, establishedProof,
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


// Proposed UI follow-up only. Uses this file's existing real native cameras and
// actual local relay; no fixture DOM videos stand in for decoded media.
for (const [width, height] of [[375, 667], [390, 667], [375, 812], [390, 812]]) {
    test(`camera strip stays labelled, visible and contained at ${width}x${height}`, async ({ browser, baseURL }, testInfo) => {
        const app = await scenario(browser, baseURL, width);
        try {
            const names = ['SamePrefixCamera1111', 'SamePrefixCamera2222', 'SamePrefixCamera3333', 'SamePrefixCamera4444'];
            const pages = [];
            for (const [index, name] of names.entries()) {
                const page = await app.guest(index % 2 ? 'rad-dad' : 'stalemate', name);
                await page.setViewportSize({ width, height }); pages.push(page);
            }
            const [owner, bravo] = pages;
            await owner.click('nav [data-show="rooms"]'); await owner.click('[data-start="art"]');
            await expect(owner.locator('[data-act-canvas]')).toBeVisible();
            const room = await owner.locator('[data-chat-context]').innerText();
            for (const page of pages.slice(1)) { await command(page, `/join ${room}`); await expect(page.locator('[data-act-canvas]')).toBeVisible(); }
            await expect(owner.locator('[data-act-camera-strip]')).toBeHidden();
            await expect(owner.locator('[data-act-camera-summary]')).toBeHidden();
            for (const page of pages) await camera(page);
            for (const page of pages) await expect.poll(async () => {
                const peers = await peerState(page);
                return peers.length === 3 && peers.every(peer => peer.signaling === 'stable' && peer.connected === 'connected' && peer.decoded > 0);
            }).toBe(true);
            // This check deliberately uses the existing video container and
            // physical clipping rectangles, so the baseline RED demonstrates
            // decoded cameras below the activity viewport rather than merely
            // the absence of new UI selectors.
            const cameras = owner.locator('[data-act-tiles] video');
            await expect(cameras).toHaveCount(4);
            const videoTimes = await cameras.evaluateAll(videos => videos.map(video => video.currentTime));
            await expect.poll(() => cameras.evaluateAll((videos, times) => videos.every((video, index) =>
                video.videoWidth > 0 && video.videoHeight > 0 && video.currentTime > times[index]), videoTimes)).toBe(true);
            const discoverability = await owner.evaluate(() => {
                const box = element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
                const activity = document.querySelector('[data-activity]'), a = box(activity);
                const videos = [...document.querySelectorAll('[data-act-tiles] video')].map(video => ({ ...box(video), pixels: [video.videoWidth, video.videoHeight], time: video.currentTime }));
                return { viewport: { width: innerWidth, height: innerHeight }, activity: a, activityScroll: activity.scrollTop,
                    canvas: box(document.querySelector('[data-act-canvas]')), cameraContainer: box(document.querySelector('[data-act-tiles]')), videos,
                    completeCameras: videos.filter(v => v.height >= 40 && v.left >= a.left - 1 && v.right <= a.right + 1 && v.top >= a.top && v.bottom <= a.bottom + 1 && v.bottom <= innerHeight).length,
                    pageWidth: document.documentElement.scrollWidth, captureCalls: window.__captureCalls };
            });
            console.log('Camera discoverability geometry', JSON.stringify({ width, height, ...discoverability }));
            await testInfo.attach(`camera-discoverability-${width}x${height}`, { body: JSON.stringify(discoverability, null, 2), contentType: 'application/json' });
            await owner.screenshot({ path: testInfo.outputPath(`camera-discoverability-${width}x${height}.png`), fullPage: true });
            expect(discoverability.completeCameras).toBeGreaterThanOrEqual(1);
            const strip = owner.locator('[data-act-camera-strip]'), region = owner.getByRole('region', { name: 'Room cameras', exact: true });
            await expect(strip).toBeVisible(); await expect(region.locator('figure')).toHaveCount(4);
            await expect(strip.locator('[data-act-camera-count]')).toHaveText('Cameras (4)');
            await expect(owner.locator('[data-act-camera-summary]')).toHaveText('4 cameras');
            const labels = await region.locator('figcaption').allTextContents();
            expect(labels[0]).toBe('You · preview'); expect(labels.slice(1).sort()).toEqual(names.slice(1).sort());
            expect(await owner.evaluate(() => [...document.querySelectorAll('[data-act-tiles] figure')].every(figure => {
                const key = figure.dataset.cameraKey, video = figure.querySelector('video'), label = figure.querySelector('figcaption').textContent;
                if (key === 'self') return label === 'You · preview' && video.muted && video.srcObject === window.__lobbyRoom.state.stream;
                return label === window.__lobbyRoom.state.names.get(key) && video.srcObject === window.__lobbyRoom.state.pcs.get(key)?.stream;
            }))).toBe(true);
            await expect(region).toHaveAttribute('aria-describedby', 'lobby-camera-count lobby-camera-scroll-help');
            expect(await region.locator('figcaption').evaluateAll(captions => captions.every(caption => {
                const style = getComputedStyle(caption); return style.whiteSpace !== 'nowrap' && style.textOverflow !== 'ellipsis'
                    && caption.scrollWidth <= caption.clientWidth + 1 && caption.scrollHeight <= caption.clientHeight + 1;
            }))).toBe(true);
            const beforeTimes = await region.locator('video').evaluateAll(videos => videos.map(video => video.currentTime));
            await expect.poll(() => region.locator('video').evaluateAll((videos, times) => videos.every((video, index) =>
                video.videoWidth > 0 && video.videoHeight > 0 && video.currentTime > times[index]), beforeTimes)).toBe(true);
            await owner.locator('[data-text]').focus();
            const geometry = await owner.evaluate(() => {
                const rect = element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
                const $ = selector => document.querySelector(selector), activity = $('[data-activity]'), row = $('[data-act-tiles]');
                return {
                    viewport: { width: innerWidth, height: innerHeight }, pageWidth: document.documentElement.scrollWidth,
                    activity: rect(activity), strip: rect($('[data-act-camera-strip]')), row: rect(row), canvas: rect($('[data-act-canvas]')),
                    figures: [...row.querySelectorAll('figure')].map(figure => ({ box: rect(figure), label: figure.querySelector('figcaption').textContent })),
                    input: rect($('[data-text]')), send: rect($('[data-send]')), navigation: rect($('nav.phonetabs')), conversation: rect($('[data-buffer]')),
                    inputFont: parseFloat(getComputedStyle($('[data-text]')).fontSize), horizontal: { client: row.clientWidth, scroll: row.scrollWidth },
                    cameraFirst: $('[data-act-stage]').firstElementChild === $('[data-act-camera-strip]'),
                    captureCalls: window.__captureCalls
                };
            });
            console.log('Camera strip complete geometry', JSON.stringify({ width, height, ...geometry }));
            await testInfo.attach(`camera-strip-geometry-${width}x${height}`, { body: JSON.stringify(geometry, null, 2), contentType: 'application/json' });
            expect(geometry.pageWidth).toBeLessThanOrEqual(width + 1); expect(geometry.cameraFirst).toBe(true);
            expect(geometry.strip.height).toBeLessThanOrEqual(height === 667 ? 112 : 128);
            expect(geometry.conversation.height).toBeGreaterThanOrEqual(height === 667 ? 96 : 144);
            expect(geometry.strip.left).toBeGreaterThanOrEqual(0); expect(geometry.strip.right).toBeLessThanOrEqual(width + 1);
            expect(geometry.strip.top).toBeLessThan(geometry.canvas.top);
            for (const tile of geometry.figures.slice(0, 2)) {
                expect(tile.box.left).toBeGreaterThanOrEqual(geometry.row.left - 1); expect(tile.box.right).toBeLessThanOrEqual(geometry.row.right + 1);
                expect(tile.box.top).toBeGreaterThanOrEqual(geometry.activity.top); expect(tile.box.bottom).toBeLessThanOrEqual(geometry.activity.bottom + 1);
                expect(tile.box.height).toBeGreaterThanOrEqual(height === 667 ? 68 : 78); expect(tile.label).not.toBe('');
            }
            for (const box of [geometry.input, geometry.send]) {
                expect(box.left).toBeGreaterThanOrEqual(0); expect(box.right).toBeLessThanOrEqual(width + 1);
                expect(box.top).toBeGreaterThanOrEqual(0); expect(box.bottom).toBeLessThanOrEqual(geometry.navigation.top + 1);
            }
            expect(geometry.input.right).toBeLessThanOrEqual(geometry.send.left + 1); expect(geometry.inputFont).toBeGreaterThanOrEqual(16);
            expect(geometry.horizontal.scroll).toBeGreaterThan(geometry.horizontal.client); expect(geometry.captureCalls).toBe(1);
            await owner.screenshot({ path: testInfo.outputPath(`camera-strip-${width}x${height}.png`), fullPage: true });
            await region.focus(); await owner.keyboard.press('Home');
            await expect.poll(() => region.evaluate(row => row.scrollLeft <= 1)).toBe(true);
            await owner.keyboard.press('ArrowRight'); await expect.poll(() => region.evaluate(row => row.scrollLeft > 1)).toBe(true);
            await owner.keyboard.press('ArrowLeft'); await expect.poll(() => region.evaluate(row => row.scrollLeft <= 1)).toBe(true);
            await owner.keyboard.press('End');
            await expect.poll(() => region.evaluate(row => Math.abs(row.scrollLeft - (row.scrollWidth - row.clientWidth)) <= 1)).toBe(true);
            const disclosure = owner.locator('[data-activity] > summary');
            await disclosure.click(); await expect(region).toBeHidden(); await expect(owner.locator('[data-act-camera-summary]')).toHaveText('4 cameras');
            await disclosure.click(); await expect(region).toBeVisible(); await expect(region).toHaveAttribute('tabindex', '0');
            await owner.setViewportSize({ width: 1600, height: 900 });
            await expect(region).toHaveAttribute('tabindex', '-1'); await expect(region).toHaveAttribute('aria-describedby', 'lobby-camera-count');
            await expect(owner.locator('#lobby-camera-scroll-help')).toBeHidden();
            await owner.setViewportSize({ width, height });
            await expect(region).toHaveAttribute('tabindex', '0');
            await expect(region).toHaveAttribute('aria-describedby', 'lobby-camera-count lobby-camera-scroll-help');
            expect(await owner.evaluate(() => window.__captureCalls)).toBe(1);
            await region.focus(); await owner.keyboard.press('End');
            await owner.keyboard.press('Tab'); expect(await region.evaluate(row => document.activeElement === row)).toBe(false);
            await region.focus(); await owner.keyboard.press('End');
            await owner.evaluate(blockedName => {
                const row = document.querySelector('[data-act-tiles]');
                window.__stripKeep = [...row.querySelectorAll('figure')].filter(figure => figure.querySelector('figcaption').textContent !== blockedName).map(figure => figure.querySelector('video'));
            }, names[1]);
            // A different participant changes policy while this row keeps focus.
            await block(bravo, names[0]);
            await expect(region.locator('figure')).toHaveCount(3); await expect(strip.locator('[data-act-camera-count]')).toHaveText('Cameras (3)');
            expect(await region.evaluate(row => document.activeElement === row)).toBe(true);
            expect(await region.evaluate(row => row.scrollLeft <= Math.max(0, row.scrollWidth - row.clientWidth) + 1)).toBe(true);
            expect(await owner.evaluate(() => window.__stripKeep.every(video => document.querySelector('[data-act-tiles]').contains(video)))).toBe(true);
            await command(bravo, `/unblock ${names[0]}`);
            await expect(region.locator('figure')).toHaveCount(4); await expect(owner.locator('[data-act-camera-summary]')).toHaveText('4 cameras');
            expect(await region.evaluate(row => document.activeElement === row)).toBe(true);
            expect(await owner.evaluate(() => window.__stripKeep.every(video => document.querySelector('[data-act-tiles]').contains(video)))).toBe(true);
            for (const page of pages) await expect.poll(async () => {
                const peers = await peerState(page); return peers.length === 3 && peers.every(peer => peer.signaling === 'stable' && peer.connected === 'connected' && peer.decoded > 0);
            }).toBe(true);
            await region.focus();
            await owner.evaluate(() => {
                window.__retiredCameraVideos = [...document.querySelectorAll('[data-act-tiles] video')];
                window.__retiredCaptureTracks = window.__lobbyRoom.state.stream.getTracks();
                // Exercise the real Leave handler without moving focus first;
                // asynchronous room/session retirement can occur while this row is focused.
                document.querySelector('[data-leave]').click();
            });
            await expect(owner.locator('[data-chat-context]')).toHaveText('#stalemate');
            await expect(strip).toBeHidden(); await expect(owner.locator('[data-act-camera-summary]')).toBeHidden();
            await expect(strip.locator('[data-act-camera-count]')).toHaveText('Cameras (0)');
            await expect(region.locator('figure')).toHaveCount(0);
            expect(await owner.evaluate(() => {
                const row = document.querySelector('[data-act-tiles]'), active = document.activeElement;
                return window.__retiredCameraVideos.every(video => video.srcObject === null)
                    && window.__retiredCaptureTracks.every(track => track.readyState === 'ended')
                    && row.scrollLeft === 0 && row.tabIndex === -1 && !row.contains(active)
                    && !active.closest('[hidden], [inert]') && active.getClientRects().length > 0;
            })).toBe(true);
            for (const page of pages) expect(await page.evaluate(() => window.__captureCalls)).toBe(1);
            expect(app.errors).toEqual([]);

        } finally { await app.close(); }
    });
}


// External v2 only: a last/self tile can disappear without any remote closePc.
test('camera presentation resets last-tile focus and self-only leave without recapture', async ({ browser, baseURL }) => {
    const app = await scenario(browser, baseURL, 390);
    try {
        const owner = await app.guest('stalemate', 'SelfCameraReset'); await owner.setViewportSize({ width: 390, height: 667 });
        await owner.click('nav [data-show="rooms"]'); await owner.click('[data-start="art"]');
        await expect(owner.locator('[data-act-canvas]')).toBeVisible();
        const room = await owner.locator('[data-chat-context]').innerText();
        const strip = owner.locator('[data-act-camera-strip]'), region = owner.getByRole('region', { name: 'Room cameras', exact: true });
        const save = async () => owner.evaluate(() => {
            window.__retiredCameraVideos = [...document.querySelectorAll('[data-act-tiles] video')];
            window.__retiredCaptureTracks = window.__lobbyRoom.state.stream.getTracks();
        });
        const reset = async calls => {
            await expect(strip).toBeHidden(); await expect(region.locator('figure')).toHaveCount(0);
            await expect(strip.locator('[data-act-camera-count]')).toHaveText('Cameras (0)');
            await expect(owner.locator('[data-act-camera-summary]')).toBeHidden();
            expect(await owner.evaluate(() => {
                const row = document.querySelector('[data-act-tiles]'), active = document.activeElement;
                return window.__retiredCameraVideos.every(video => video.srcObject === null)
                    && window.__retiredCaptureTracks.every(track => track.readyState === 'ended')
                    && row.scrollLeft === 0 && row.tabIndex === -1 && !row.contains(active)
                    && !active.closest('[hidden], [inert]') && active.getClientRects().length > 0;
            })).toBe(true);
            expect(await owner.evaluate(() => window.__captureCalls)).toBe(calls);
        };
        await camera(owner); await expect(region.locator('figure')).toHaveCount(1);
        await expect(region).toHaveAttribute('tabindex', '-1'); await expect(region).toHaveAttribute('aria-describedby', 'lobby-camera-count');
        await expect(owner.locator('#lobby-camera-scroll-help')).toBeHidden();
        await expect.poll(() => region.locator('video').evaluate(video => video.videoWidth > 0 && video.currentTime > 0)).toBe(true);
        await region.focus(); await save();
        await owner.evaluate(() => document.querySelector('[data-cam]').click());
        await reset(1); // One explicit enable; presentation never recaptured.
        await camera(owner); await expect(region.locator('figure')).toHaveCount(1);
        await expect.poll(() => region.locator('video').evaluate(video => video.videoWidth > 0 && video.currentTime > 0)).toBe(true);
        await region.focus(); await save(); await owner.evaluate(() => document.querySelector('[data-leave]').click());
        await expect(owner.locator('[data-chat-context]')).toHaveText('#stalemate'); await reset(2); // Second deliberate enable only.
        await command(owner, `/join ${room}`); await expect(owner.locator('[data-act-canvas]')).toBeVisible();
        await expect(strip).toBeHidden(); await expect(region.locator('figure')).toHaveCount(0);
        await expect(strip.locator('[data-act-camera-count]')).toHaveText('Cameras (0)');
        expect(await owner.evaluate(() => window.__captureCalls)).toBe(2);
        expect(app.errors).toEqual([]);
    } finally { await app.close(); }
});

test('camera off removes its tile while the receive-only pair and third camera remain', async ({ browser, baseURL }, testInfo) => {
    const app = await scenario(browser, baseURL, 390);
    try {
        const observer = await app.guest('stalemate', 'CameraOffObserver');
        const retiring = await app.guest('rad-dad', 'CameraOffRetiring');
        const third = await app.guest('stalemate', 'CameraOffThird');
        const pages = [observer, retiring, third];
        for (const page of pages) await page.setViewportSize({ width: 390, height: 667 });
        await observer.click('nav [data-show="rooms"]'); await observer.click('[data-start="art"]');
        await expect(observer.locator('[data-act-canvas]')).toBeVisible();
        const room = await observer.locator('[data-chat-context]').innerText();
        for (const page of pages.slice(1)) {
            await command(page, `/join ${room}`); await expect(page.locator('[data-act-canvas]')).toBeVisible();
        }
        for (const page of pages) await camera(page);
        for (const page of pages) await expect.poll(async () => {
            const peers = await peerState(page);
            return peers.length === 2 && peers.every(peer => peer.signaling === 'stable' && peer.connected === 'connected' && peer.decoded > 0);
        }).toBe(true);
        const retiringId = await retiring.evaluate(() => window.__lobbyRoom.state.myId);
        const thirdId = await third.evaluate(() => window.__lobbyRoom.state.myId);
        const region = observer.getByRole('region', { name: 'Room cameras', exact: true });
        await expect(region.locator('figure')).toHaveCount(3);
        await observer.evaluate(({ retiringId, thirdId }) => {
            const state = window.__lobbyRoom.state;
            window.__cameraOff = {
                retiringId, thirdId, retiringEntry: state.pcs.get(retiringId), thirdEntry: state.pcs.get(thirdId),
                retiringVideo: document.querySelector(`[data-camera-key="${retiringId}"] video`),
                thirdVideo: document.querySelector(`[data-camera-key="${thirdId}"] video`),
                stream: state.stream, tracks: state.stream.getTracks()
            };
        }, { retiringId, thirdId });
        const beforeThird = (await peerState(observer)).find(peer => peer.id === thirdId).decoded;
        await retiring.getByRole('button', { name: 'Camera on', exact: false }).click();
        await expect(retiring.locator('[data-cam]')).toHaveAttribute('aria-pressed', 'false');
        await expect.poll(() => observer.evaluate(id => !window.__lobbyRoom.state.peers.has(id), retiringId)).toBe(true);
        const presentation = await observer.evaluate(() => {
            const before = window.__cameraOff, state = window.__lobbyRoom.state;
            return {
                cameraAdvertised: state.peers.has(before.retiringId),
                receiveOnlyPairRetained: state.pcs.get(before.retiringId) === before.retiringEntry && before.retiringEntry.pc.signalingState !== 'closed',
                thirdPairRetained: state.pcs.get(before.thirdId) === before.thirdEntry,
                retiringVideoAttached: document.querySelector('[data-act-tiles]').contains(before.retiringVideo),
                retiringSrcCleared: before.retiringVideo.srcObject === null,
                labels: [...document.querySelectorAll('[data-act-tiles] figcaption')].map(caption => caption.textContent),
                count: document.querySelector('[data-act-camera-count]').textContent,
                summary: document.querySelector('[data-act-camera-summary]').textContent,
                localCaptureRetained: state.stream === before.stream && before.tracks.every(track => track.readyState === 'live'),
                captureCalls: window.__captureCalls
            };
        });
        console.log('Camera-off presentation outcome', JSON.stringify(presentation));
        await testInfo.attach('camera-off-presentation', { body: JSON.stringify(presentation, null, 2), contentType: 'application/json' });
        await observer.screenshot({ path: testInfo.outputPath('camera-off-observer-390x667.png'), fullPage: true });
        expect(presentation.cameraAdvertised).toBe(false);
        expect(presentation.receiveOnlyPairRetained).toBe(true);
        expect(presentation.thirdPairRetained).toBe(true);
        expect(presentation.localCaptureRetained).toBe(true);
        expect(presentation.captureCalls).toBe(1);
        await expect(region.locator('figure')).toHaveCount(2);
        expect(presentation.retiringVideoAttached).toBe(false);
        expect(presentation.retiringSrcCleared).toBe(true);
        expect(presentation.labels).toEqual(['You · preview', 'CameraOffThird']);
        expect(presentation.count).toBe('Cameras (2)'); expect(presentation.summary).toBe('2 cameras');
        expect(await observer.evaluate(() => {
            const before = window.__cameraOff, state = window.__lobbyRoom.state;
            return state.pcs.get(before.thirdId) === before.thirdEntry
                && document.querySelector('[data-act-tiles]').contains(before.thirdVideo)
                && before.thirdVideo.srcObject === before.thirdEntry.stream;
        })).toBe(true);
        await expect.poll(async () => {
            const peer = (await peerState(observer)).find(peer => peer.id === thirdId);
            return peer.signaling === 'stable' && peer.connected === 'connected' && peer.decoded > beforeThird;
        }).toBe(true);
        const time = await observer.evaluate(() => window.__cameraOff.thirdVideo.currentTime);
        await expect.poll(() => observer.evaluate(time => window.__cameraOff.thirdVideo.currentTime > time, time)).toBe(true);
        for (const page of pages) expect(await page.evaluate(() => window.__captureCalls)).toBe(1);
        expect(app.errors).toEqual([]);
    } finally { await app.close(); }
});
