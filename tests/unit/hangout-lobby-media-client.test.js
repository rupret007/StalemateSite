// @vitest-environment node
// Actual public-room client with instrumented native interfaces, not real media.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createLobby } from '../../hangout-worker/src/lobby-core.mjs';

const root = '../../r/45662413410ed051/';
const html = readFileSync(new URL(`${root}lobby/index.html`, import.meta.url), 'utf8');
const core = readFileSync(new URL(`${root}sync-core.js`, import.meta.url), 'utf8');
const client = readFileSync(new URL(`${root}lobby/lobby-room.js`, import.meta.url), 'utf8');
const windows = [];
afterEach(() => { for (const dom of windows.splice(0)) dom.window.close(); });
const deferred = () => { let resolve; return { promise: new Promise(done => { resolve = done; }), resolve: value => resolve(value) }; };

async function fixture({ inboundBeforeCapture = false, receiveOnly = false, clock = null, onSend = null } = {}) {
    const dom = new JSDOM(html, { url: 'http://127.0.0.1:4320/', runScripts: 'outside-only' }); windows.push(dom);
    const { window } = dom, peers = [], sent = [];
    const timers = new Map(); let timerId = 0;
    if (clock) {
        window.Date.now = () => clock.at;
        window.setTimeout = (fn, delay) => { timers.set(++timerId, { fn, at: clock.at + delay }); return timerId; };
        window.clearTimeout = id => timers.delete(id);
    }
    window.HTMLCanvasElement.prototype.getContext = () => ({ clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} });
    window.HTMLCanvasElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1200, height: 720 });
    window.HangoutVideo = { isPhoneDevice: () => false };
    const selectVideo = vi.fn(async () => ({ getCurrentTime: () => 0, getPlayerState: () => 2, seekTo() {}, playVideo() {}, pauseVideo() {} }));
    window.HangoutYouTube = { create: () => ({ cancel() {}, select: selectVideo }) };
    window.BobRoss = { EPISODES: [], label: () => '' };
    window.MediaStream = class { tracks = []; addTrack(track) { this.tracks.push(track); } getTracks() { return this.tracks; } getVideoTracks() { return this.tracks; } };
    const localTrack = { stop: vi.fn(), kind: 'video' }, stream = new window.MediaStream(); stream.addTrack(localTrack);
    const heldCapture = deferred(), capture = vi.fn(async () => { if (inboundBeforeCapture) await heldCapture.promise; return stream; });
    Object.defineProperty(window.navigator, 'mediaDevices', { value: { getUserMedia: capture } });
    window.RTCPeerConnection = class {
        signalingState = 'stable'; remoteDescription = null; senders = [];
        // A synthetic outgoing ICE event belongs to a known native description,
        // just as the real browser fixture's gathered candidates do.
        localDescription = { type: 'offer', sdp: 'native-current-description', toJSON: () => ({ type: 'offer', sdp: 'native-current-description' }) };
        constructor() { peers.push(this); }
        createOffer = vi.fn(async () => ({ type: 'offer', sdp: 'synthetic-offer' }));
        createAnswer = vi.fn(async () => ({ type: 'answer', sdp: 'synthetic-answer' }));
        setLocalDescription = vi.fn(async value => {
            const chosen = value || { type: this.signalingState === 'have-remote-offer' ? 'answer' : 'offer', sdp: 'native-current-description' };
            this.localDescription = { ...chosen, toJSON: () => chosen }; this.signalingState = chosen.type === 'answer' ? 'stable' : 'have-local-offer';
        });
        setRemoteDescription = vi.fn(async value => { this.remoteDescription = value; this.signalingState = value.type === 'offer' ? 'have-remote-offer' : 'stable'; });
        addIceCandidate = vi.fn(async () => {}); addTransceiver = vi.fn(); addTrack = vi.fn(track => { this.senders.push({ track }); }); getSenders = () => this.senders; close = vi.fn();
    };
    window.eval(core); window.eval(client);
    const channel = { name: '#art-safety', kind: 'art', myCam: true, mediaBlocked: [], names: [
        { id: 'self', nick: 'Alpha', prefix: '@', cam: true }, { id: 'peer', nick: 'Bravo', cam: !receiveOnly }, { id: 'third', nick: 'Witness', cam: true }
    ] };
    const app = { me: 'Alpha', active: channel.name, band: false, chans: new Map([[channel.name, channel]]) };
    const room = window.LobbyRoom.attach({ app, send: frame => { sent.push(structuredClone(frame)); return onSend?.(frame) !== false; }, $: selector => window.document.querySelector(selector), turnUrl: '' });
    room.onJoin(channel, { strokes: [] }); room.onCam(channel.name, true);
    if (inboundBeforeCapture) {
        await vi.waitFor(() => expect(capture).toHaveBeenCalledOnce());
        room.onAct({ ch: channel.name, kind: 'rtc', from: 'peer', ice: { candidate: 'before-capture' } }); heldCapture.resolve();
    }
    await vi.waitFor(() => expect(window.__lobbyRoom.state.stream).toBe(stream));
    const state = window.__lobbyRoom.state;
    const policy = ids => { channel.mediaBlocked = ids; room.onChan(channel); };
    const incoming = extra => room.onAct({ ch: channel.name, kind: 'rtc', from: 'peer', ...extra });
    const advance = ms => {
        clock.at += ms;
        for (const [id, timer] of [...timers]) if (timer.at <= clock.at) { timers.delete(id); timer.fn(); }
    };
    const draw = (x = 120) => {
        const canvas = window.document.querySelector('[data-act-canvas]');
        for (const [type, clientX] of [['mousedown', x], ['mousemove', x + 2], ['mouseup', x + 2]])
            canvas.dispatchEvent(new window.MouseEvent(type, { button: 0, clientX, clientY: 100, bubbles: true }));
    };
    sent.length = 0; return { window, room, state, peers, sent, capture, localTrack, channel, app, policy, incoming, advance, draw, selectVideo };
}

function actualEngine(clock) {
    const received = [];
    const engine = createLobby({ now: () => clock.at, limits: { defaultSlow: 0 }, send: (recipient, frame) => received.push({ recipient, ...frame }) });
    for (const [id, nick] of [['self', 'Alpha'], ['peer', 'Bravo'], ['third', 'Witness']]) {
        engine.connect({ id, dev: `device-${id}`, iph: `ip-${id}` }); engine.message(id, JSON.stringify({ t: 'hello', nick, age13: true }));
        engine.message(id, JSON.stringify({ t: 'cmd', name: 'join', args: ['#art-safety'], ch: '#stalemate' }));
        engine.message(id, JSON.stringify({ t: 'cam', ch: '#art-safety', on: true, adult18: true }));
    }
    return { engine, received };
}

describe('public-room Block retires only the affected pair', () => {
    it('delivers an SDP offer after a native ICE burst through the actual engine without exhausting its activity allowance', async () => {
        const clock = { at: 1800000000000 }, { engine, received } = actualEngine(clock);
        const f = await fixture({ clock, onSend: frame => engine.message('self', JSON.stringify(frame)) }); received.length = 0;
        const pc = f.state.pcs.get('peer').pc;
        for (let i = 0; i < 30; i++) pc.onicecandidate({ candidate: { toJSON: () => ({ candidate: `synthetic-ice-${i}` }) } });
        await pc.onnegotiationneeded(); for (let i = 0; i < 32; i++) f.advance(250);
        expect(received.some(frame => frame.kind === 'rtc' && frame.recipient === 'peer' && frame.sdp?.type === 'offer')).toBe(true);
        expect(received.filter(frame => frame.kind === 'rtc' && frame.recipient === 'peer')).toHaveLength(31);
        expect(received.some(frame => frame.text === 'Easy on the paint brush.')).toBe(false);
    });

    it('shares one allowance between drawing and signaling while preserving stroke/clear order through the actual engine', async () => {
        const clock = { at: 1800000000000 }, { engine, received } = actualEngine(clock);
        const f = await fixture({ clock, onSend: frame => engine.message('self', JSON.stringify(frame)) }); received.length = 0;
        const pc = f.state.pcs.get('peer').pc;
        for (let i = 0; i < 30; i++) pc.onicecandidate({ candidate: { toJSON: () => ({ candidate: `mixed-ice-${i}` }) } });
        f.draw(120); f.window.document.querySelector('[data-act-clear]').click(); f.draw(240);
        await pc.onnegotiationneeded(); for (let i = 0; i < 64; i++) f.advance(125);
        const peerFrames = received.filter(frame => frame.recipient === 'peer' && frame.t === 'act');
        expect(peerFrames.filter(frame => frame.kind !== 'rtc').map(frame => frame.kind)).toEqual(['stroke', 'clear', 'stroke']);
        expect(peerFrames.filter(frame => frame.kind === 'rtc')).toHaveLength(31);
        expect(received.some(frame => frame.text === 'Easy on the paint brush.')).toBe(false);
    });

    it('rejects an overflowing drawing before optimistic state changes and delivers every previously accepted operation', async () => {
        const clock = { at: 1800000000000 }, { engine, received } = actualEngine(clock);
        const f = await fixture({ clock, onSend: frame => engine.message('self', JSON.stringify(frame)) }); received.length = 0;
        for (let i = 0; i < 136; i++) f.window.document.querySelector('[data-act-clear]').click();
        const accepted = structuredClone(f.state.room.strokes);
        f.draw(700);
        expect(f.state.room.strokes).toEqual(accepted);
        expect(f.window.document.querySelector('[data-act-relay-status]').textContent).toContain('not queued');
        expect(f.sent).toHaveLength(8);
        for (let i = 0; i < 150; i++) f.advance(125);
        expect(f.sent).toHaveLength(136);
        const remote = engine.roomSnapshot().rooms.find(room => room.name === '#art-safety').act.strokes;
        expect(remote).toEqual(f.state.room.strokes);
        expect(received.filter(frame => frame.recipient === 'peer' && frame.kind === 'clear')).toHaveLength(136);
        expect(received.some(frame => frame.text === 'Easy on the paint brush.')).toBe(false);
    });

    it('losslessly coalesces unsent chunks of a continuous 80ms brush stroke through the actual engine', async () => {
        const clock = { at: 1800000000000 }, { engine, received } = actualEngine(clock);
        const f = await fixture({ clock, onSend: frame => engine.message('self', JSON.stringify(frame)) }); received.length = 0;
        const canvas = f.window.document.querySelector('[data-act-canvas]');
        canvas.dispatchEvent(new f.window.MouseEvent('mousedown', { button: 0, clientX: 100, clientY: 100 }));
        for (let i = 0; i < 80; i++) {
            canvas.dispatchEvent(new f.window.MouseEvent('mousemove', { button: 0, clientX: 101 + i, clientY: 100 }));
            f.advance(80);
        }
        canvas.dispatchEvent(new f.window.MouseEvent('mouseup', { button: 0 }));
        for (let i = 0; i < 32; i++) f.advance(125);
        const strokes = f.sent.filter(frame => frame.kind === 'stroke');
        expect(strokes.length).toBeLessThan(80);
        expect(strokes.reduce((total, frame) => total + frame.stroke.pts.length, 0)).toBe(81);
        const remote = engine.roomSnapshot().rooms.find(room => room.name === '#art-safety').act.strokes;
        expect(remote).toEqual(f.state.room.strokes); expect(remote[0].pts).toHaveLength(81);
        expect(received.some(frame => frame.text === 'Easy on the paint brush.')).toBe(false);
    });

    it('accounts for coalesced stroke bytes and rejects more points before the shared byte allowance is exceeded', async () => {
        const f = await fixture({ clock: { at: 1800000000000 } }), pc = f.state.pcs.get('peer').pc;
        for (let i = 0; i < 39; i++) pc.onicecandidate({ candidate: { toJSON: () => ({ candidate: 'x'.repeat(8192) }) } });
        const canvas = f.window.document.querySelector('[data-act-canvas]');
        canvas.dispatchEvent(new f.window.MouseEvent('mousedown', { button: 0, clientX: 100, clientY: 101 }));
        for (let i = 0; i < 400; i++) canvas.dispatchEvent(new f.window.MouseEvent('mousemove', { clientX: 101 + i, clientY: 101 }));
        canvas.dispatchEvent(new f.window.MouseEvent('mouseup', { button: 0 }));
        expect(f.window.document.querySelector('[data-act-relay-status]').textContent).toContain('not queued');
        expect(f.state.pcs.has('peer')).toBe(true);
        for (let i = 0; i < 150; i++) f.advance(125);
        const queuedBytes = f.sent.slice(8).reduce((total, frame) => total + new f.window.Blob([JSON.stringify(frame)]).size, 0);
        expect(queuedBytes).toBeLessThanOrEqual(256 * 1024);
        const points = f.sent.filter(frame => frame.kind === 'stroke').reduce((total, frame) => total + frame.stroke.pts.length, 0);
        expect(points).toBeGreaterThan(0); expect(points).toBeLessThan(400);
        expect(f.state.room.strokes[0].pts).toHaveLength(points);
    });

    it('does not apply a queued video proposal after its host loses permission', async () => {
        const f = await fixture({ clock: { at: 1800000000000 } }), pc = f.state.pcs.get('peer').pc;
        for (let i = 0; i < 8; i++) pc.onicecandidate({ candidate: { toJSON: () => ({ candidate: `budget-${i}` }) } });
        f.channel.kind = 'watch'; f.channel.name = '#watch-safety'; f.app.active = f.channel.name;
        f.app.chans.clear(); f.app.chans.set(f.channel.name, f.channel); f.room.onJoin(f.channel, { strokes: [] });
        f.window.document.querySelector('[data-act-url]').value = 'https://www.youtube.com/watch?v=abcdefghijk';
        f.window.document.querySelector('[data-act-load]').dispatchEvent(new f.window.Event('submit', { cancelable: true }));
        expect(f.state.room.video).toBeNull(); expect(f.selectVideo).not.toHaveBeenCalled();
        f.channel.names[0].prefix = ''; f.room.onChan(f.channel); f.advance(250);
        expect(f.sent.filter(frame => frame.kind === 'video')).toEqual([]); expect(f.state.room.video).toBeNull();
        expect(f.selectVideo).not.toHaveBeenCalled();
    });

    it('bounds queued signaling bytes and retires only the overfull pair without another capture', async () => {
        const f = await fixture({ clock: { at: 1800000000000 } }), peer = f.state.pcs.get('peer'), third = f.state.pcs.get('third');
        const ice = peer.pc.onicecandidate;
        for (let i = 0; i < 60; i++) ice({ candidate: { toJSON: () => ({ candidate: 'x'.repeat(8192) }) } });
        expect(f.state.pcs.has('peer')).toBe(false); expect(peer.pc.close).toHaveBeenCalledOnce();
        expect(f.sent).toHaveLength(8); expect(f.state.pcs.get('third')).toBe(third);
        expect(f.localTrack.stop).not.toHaveBeenCalled(); expect(f.capture).toHaveBeenCalledOnce();
        expect(f.window.document.querySelector('[data-act-relay-status]').textContent).toContain('not queued');
        for (let i = 0; i < 80; i++) f.advance(125);
        expect(f.sent).toHaveLength(8);
    });

    it('purges queued Block and stale SDP/ICE work before it can publish', async () => {
        const f = await fixture({ clock: { at: 1800000000000 } }), pc = f.state.pcs.get('peer').pc;
        for (let i = 0; i < 10; i++) pc.onicecandidate({ candidate: { toJSON: () => ({ candidate: `queued-${i}` }) } });
        await pc.onnegotiationneeded(); expect(f.sent).toHaveLength(8); f.policy(['peer']);
        for (let i = 0; i < 32; i++) f.advance(125);
        expect(f.sent).toHaveLength(8);
        const third = f.state.pcs.get('third').pc;
        await third.onnegotiationneeded(); expect(f.sent.at(-1)).toMatchObject({ to: 'third', sdp: { type: 'offer' } });
    });

    it('drops a queued obsolete local description and an ICE candidate from a replaced native ICE generation', async () => {
        const f = await fixture({ clock: { at: 1800000000000 } }), pc = f.state.pcs.get('peer').pc;
        for (let i = 0; i < 8; i++) pc.onicecandidate({ candidate: { toJSON: () => ({ candidate: `initial-${i}` }) } });
        await pc.onnegotiationneeded();
        pc.localDescription = { type: 'offer', sdp: 'a=ice-ufrag:old\r\n' };
        pc.onicecandidate({ candidate: { toJSON: () => ({ candidate: 'old-epoch', usernameFragment: 'old' }) } });
        pc.localDescription = { type: 'answer', sdp: 'a=ice-ufrag:new\r\n' }; f.advance(125);
        expect(f.sent).toHaveLength(8);
        pc.onicecandidate({ candidate: { toJSON: () => ({ candidate: 'current-epoch', usernameFragment: 'new' }) } });
        expect(f.sent.at(-1)).toMatchObject({ ice: { candidate: 'current-epoch' } });
    });

    it('keeps a queued description valid when native trickle ICE appends candidates to the same negotiation', async () => {
        const f = await fixture({ clock: { at: 1800000000000 } }), pc = f.state.pcs.get('peer').pc;
        for (let i = 0; i < 8; i++) pc.onicecandidate({ candidate: { toJSON: () => ({ candidate: `initial-${i}` }) } });
        await pc.onnegotiationneeded();
        pc.localDescription = { type: 'offer', sdp: 'native-current-description\r\na=candidate:synthetic-trickle\r\na=end-of-candidates\r\n' };
        f.advance(125);
        expect(f.sent).toHaveLength(9); expect(f.sent.at(-1)).toMatchObject({ sdp: { type: 'offer', sdp: 'native-current-description' } });
    });

    it('keeps an API-bound offer when native gathering fills its transport port and address', async () => {
        const f = await fixture({ clock: { at: 1800000000000 } }), pc = f.state.pcs.get('peer').pc;
        for (let i = 0; i < 8; i++) pc.onicecandidate({ candidate: { toJSON: () => ({ candidate: `initial-${i}` }) } });
        const sdp = 'v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\nc=IN IP4 0.0.0.0\r\na=ice-ufrag:same\r\na=ice-pwd:synthetic-test-password\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=sendrecv\r\n';
        pc.setLocalDescription.mockImplementation(async () => { pc.localDescription = { type: 'offer', sdp, toJSON: () => ({ type: 'offer', sdp }) }; });
        await pc.onnegotiationneeded();
        pc.localDescription = { type: 'offer', sdp: sdp.replace('m=video 9 ', 'm=video 12345 ').replace('c=IN IP4 0.0.0.0', 'c=IN IP4 192.0.2.5') };
        f.advance(125); expect(f.sent).toHaveLength(9); expect(f.sent.at(-1)).toMatchObject({ sdp: { type: 'offer', sdp } });
    });

    it.each([
        ['session version', 'o=- 1 1 IN IP4 0.0.0.0', 'o=- 1 2 IN IP4 0.0.0.0'],
        ['ICE credentials', 'a=ice-ufrag:same', 'a=ice-ufrag:replacement'],
        ['media direction', 'a=sendrecv', 'a=recvonly'],
        ['media rejection', 'm=video 9 ', 'm=video 0 ']
    ])('still rejects a queued description when its %s changes', async (_label, before, after) => {
        const f = await fixture({ clock: { at: 1800000000000 } }), pc = f.state.pcs.get('peer').pc;
        for (let i = 0; i < 8; i++) pc.onicecandidate({ candidate: { toJSON: () => ({ candidate: `initial-${i}` }) } });
        const sdp = 'v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\na=ice-ufrag:same\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=sendrecv\r\n';
        pc.setLocalDescription.mockImplementation(async () => { pc.localDescription = { type: 'offer', sdp, toJSON: () => ({ type: 'offer', sdp }) }; });
        await pc.onnegotiationneeded(); pc.localDescription = { type: 'offer', sdp: sdp.replace(before, after) }; f.advance(125);
        expect(f.sent).toHaveLength(8);
    });

    it('purges queued activity on teardown without restoring a burst allowance by hopping rooms', async () => {
        const f = await fixture({ clock: { at: 1800000000000 } }), pc = f.state.pcs.get('peer').pc;
        for (let i = 0; i < 10; i++) pc.onicecandidate({ candidate: { toJSON: () => ({ candidate: `leaving-${i}` }) } });
        f.room.onLeave(); f.room.onJoin(f.channel, { strokes: [] }); f.draw(500);
        expect(f.sent).toHaveLength(8); f.advance(125);
        expect(f.sent).toHaveLength(9); expect(f.sent.at(-1).kind).toBe('stroke');
    });

    it.each([false, true])('does not accept a new stroke when flushing an older transport failure (coalesced=%s)', async coalesced => {
        const clock = { at: 1800000000000 }; let broken = false;
        const f = await fixture({ clock, onSend: () => !broken }), pc = f.state.pcs.get('peer').pc, errors = [];
        f.window.addEventListener('error', event => { errors.push(event.message); event.preventDefault(); });
        for (let i = 0; i < 10; i++) pc.onicecandidate({ candidate: { toJSON: () => ({ candidate: `queued-${i}` }) } });
        const canvas = f.window.document.querySelector('[data-act-canvas]');
        if (coalesced) {
            canvas.dispatchEvent(new f.window.MouseEvent('mousedown', { button: 0, clientX: 100, clientY: 100 }));
            canvas.dispatchEvent(new f.window.MouseEvent('mousemove', { clientX: 120, clientY: 100 })); f.advance(80);
        }
        const before = structuredClone(f.state.room.strokes); broken = true; clock.at += 250;
        if (coalesced) {
            canvas.dispatchEvent(new f.window.MouseEvent('mousemove', { clientX: 140, clientY: 100 }));
            canvas.dispatchEvent(new f.window.MouseEvent('mouseup', { button: 0 }));
        } else f.draw(240);
        expect(errors).toEqual([]); expect(f.state.room.strokes).toEqual(before);
        expect(f.window.document.querySelector('[data-act-relay-status]').textContent).toContain('interrupted');
    });

    it('binds queued legacy ICE without usernameFragment to its non-null native description', async () => {
        const f = await fixture({ clock: { at: 1800000000000 } }), pc = f.state.pcs.get('peer').pc;
        await pc.onnegotiationneeded();
        for (let i = 0; i < 8; i++) pc.onicecandidate({ candidate: { toJSON: () => ({ candidate: `legacy-${i}` }) } });
        pc.localDescription = { type: 'offer', sdp: 'a=ice-ufrag:replacement\r\n' }; f.advance(125);
        expect(f.sent).toHaveLength(8);
    });

    it('refuses a legacy ICE callback without any current native local description', async () => {
        const f = await fixture({ clock: { at: 1800000000000 } }), pc = f.state.pcs.get('peer').pc;
        pc.localDescription = null; pc.onicecandidate({ candidate: { toJSON: () => ({ candidate: 'without-description' }) } });
        expect(f.sent).toEqual([]);
    });

    it('invalidates queued SDP before a newer native local-description operation finishes', async () => {
        const f = await fixture({ clock: { at: 1800000000000 } }), pc = f.state.pcs.get('peer').pc, held = deferred();
        for (let i = 0; i < 8; i++) pc.onicecandidate({ candidate: { toJSON: () => ({ candidate: `initial-${i}` }) } });
        await pc.onnegotiationneeded();
        pc.setLocalDescription.mockImplementation(async () => { await held.promise; }); const next = pc.onnegotiationneeded(); f.advance(125);
        expect(f.sent).toHaveLength(8); held.resolve(); await next;
    });

    it('invalidates queued SDP before an incoming offer performs its native rollback', async () => {
        const f = await fixture({ clock: { at: 1800000000000 } }), pc = f.state.pcs.get('peer').pc, held = deferred();
        for (let i = 0; i < 8; i++) pc.onicecandidate({ candidate: { toJSON: () => ({ candidate: `initial-${i}` }) } });
        await pc.onnegotiationneeded();
        pc.setRemoteDescription.mockImplementation(async description => { await held.promise; pc.remoteDescription = description; pc.signalingState = 'have-remote-offer'; });
        f.incoming({ sdp: { type: 'offer', sdp: 'newer-peer-offer' } }); f.advance(125);
        expect(f.sent).toHaveLength(8); held.resolve(); await new Promise(done => setTimeout(done, 0));
    });
    it('attaches opted-in capture to a current receive-only peer created while the browser camera was pending', async () => {
        const f = await fixture({ inboundBeforeCapture: true });
        expect(f.state.pcs.get('peer').pc.addTrack).toHaveBeenCalledExactlyOnceWith(f.localTrack, f.state.stream);
        expect(f.capture).toHaveBeenCalledOnce();
    });

    it('attaches that capture even when the current receiving visitor has no camera of their own', async () => {
        const f = await fixture({ inboundBeforeCapture: true, receiveOnly: true });
        expect(f.state.peers.has('peer')).toBe(false);
        expect(f.state.pcs.get('peer').pc.addTrack).toHaveBeenCalledExactlyOnceWith(f.localTrack, f.state.stream);
        expect(f.capture).toHaveBeenCalledOnce();
    });

    it('preserves an existing allowed receive-only viewer during another peer’s block refresh, but retires a departed viewer', async () => {
        const f = await fixture({ inboundBeforeCapture: true, receiveOnly: true }), viewer = f.state.pcs.get('peer'), blocked = f.state.pcs.get('third');
        f.policy(['third']);
        expect(f.state.pcs.get('peer')).toBe(viewer); expect(viewer.pc.close).not.toHaveBeenCalled();
        expect(f.state.pcs.has('third')).toBe(false); expect(blocked.pc.close).toHaveBeenCalledOnce();
        expect(f.localTrack.stop).not.toHaveBeenCalled(); expect(f.capture).toHaveBeenCalledOnce();
        f.channel.names = f.channel.names.filter(person => person.id !== 'peer'); f.policy(['third']);
        expect(f.state.pcs.has('peer')).toBe(false); expect(viewer.pc.close).toHaveBeenCalledOnce();
    });

    it('accepts a newer offer queued behind an incoming answer instead of treating it as an impolite collision', async () => {
        const f = await fixture(), entry = f.state.pcs.get('third'), held = deferred(), pc = entry.pc;
        expect(entry.polite).toBe(false); pc.signalingState = 'have-local-offer';
        pc.setRemoteDescription.mockImplementation(async description => {
            if (description.type === 'answer') await held.promise;
            pc.remoteDescription = description; pc.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable';
        });
        f.room.onAct({ ch: f.channel.name, kind: 'rtc', from: 'third', sdp: { type: 'answer', sdp: 'prior-offer-answer' } });
        f.room.onAct({ ch: f.channel.name, kind: 'rtc', from: 'third', sdp: { type: 'offer', sdp: 'next-peer-offer' } });
        const accepted = pc.setRemoteDescription.mock.calls.map(([description]) => description.type);
        held.resolve(); await new Promise(done => setTimeout(done, 0));
        expect(accepted).toEqual(['answer', 'offer']);
    });

    it('does not publish an obsolete generated offer after a newer remote offer has been answered', async () => {
        const f = await fixture(), pc = f.state.pcs.get('peer').pc, held = deferred();
        pc.createOffer.mockImplementation(() => held.promise); const work = pc.onnegotiationneeded();
        f.incoming({ sdp: { type: 'offer', sdp: 'newer-peer-offer' } });
        await new Promise(done => setTimeout(done, 0)); held.resolve({ type: 'offer', sdp: 'obsolete-after-remote-offer' }); await work;
        expect(f.sent.some(frame => frame.sdp?.sdp === 'obsolete-after-remote-offer')).toBe(false);
        expect(f.sent.some(frame => frame.sdp?.type === 'answer')).toBe(true);
    });

    it('closes the existing pair and received tracks, preserving local capture and the third participant', async () => {
        const f = await fixture(), peer = f.state.pcs.get('peer'), third = f.state.pcs.get('third');
        const track = { kind: 'video', stop: vi.fn() }; peer.pc.ontrack({ track });
        peer.pendingIce.push({ candidate: 'old' }); const oldIce = peer.pc.onicecandidate, oldTrack = peer.pc.ontrack;
        f.policy(['peer']);
        expect(f.state.pcs.has('peer')).toBe(false); expect(peer.pc.close).toHaveBeenCalledOnce();
        expect(track.stop).toHaveBeenCalledOnce(); expect(peer.pendingIce).toEqual([]);
        expect(f.state.pcs.get('third')).toBe(third); expect(third.pc.close).not.toHaveBeenCalled();
        expect(f.localTrack.stop).not.toHaveBeenCalled(); expect(f.capture).toHaveBeenCalledOnce();
        oldIce({ candidate: { toJSON: () => ({ candidate: 'late' }) } });
        const late = { stop: vi.fn() }; oldTrack({ track: late });
        expect(late.stop).toHaveBeenCalledOnce(); expect(f.sent).toEqual([]);
    });

    it('refuses new SDP and ICE, including presence refresh and a changed nickname for the same ID', async () => {
        const f = await fixture(); f.policy(['peer']); const count = f.peers.length;
        f.channel.names[1].nick = 'ChangedBravo'; f.room.onChan(f.channel);
        f.incoming({ sdp: { type: 'offer', sdp: 'blocked-offer' } }); f.incoming({ sdp: { type: 'answer', sdp: 'blocked-answer' } }); f.incoming({ ice: { candidate: 'blocked-ice' } });
        await new Promise(done => setTimeout(done, 0));
        expect(f.peers).toHaveLength(count); expect(f.state.pcs.has('peer')).toBe(false); expect(f.sent).toEqual([]);
    });

    it('cannot recreate a blocked peer from stale signaling after that connection leaves the roster', async () => {
        const f = await fixture(); f.policy(['peer']);
        f.channel.names = f.channel.names.filter(person => person.id !== 'peer'); f.policy([]);
        const count = f.peers.length;
        f.incoming({ sdp: { type: 'offer', sdp: 'departed-offer' } }); f.incoming({ ice: { candidate: 'departed-ice' } });
        await new Promise(done => setTimeout(done, 0));
        expect(f.state.pcs.has('peer')).toBe(false); expect(f.peers).toHaveLength(count); expect(f.sent).toEqual([]);
    });

    it('uses the joining recipient’s block view before accepting its first signaling frame', async () => {
        const f = await fixture(); f.room.onLeave(); f.channel.mediaBlocked = ['peer']; f.channel.myCam = false;
        f.room.onJoin(f.channel, { strokes: [] }); const count = f.peers.length;
        f.incoming({ ice: { candidate: 'blocked-at-join' } });
        expect(f.state.pcs.has('peer')).toBe(false); expect(f.peers).toHaveLength(count);
    });

    it('does not publish an already pending native local description after Block or interrupt another pair', async () => {
        const f = await fixture(), peer = f.state.pcs.get('peer'), third = f.state.pcs.get('third'), held = deferred();
        peer.pc.setLocalDescription.mockImplementation(() => held.promise); const work = peer.pc.onnegotiationneeded();
        f.policy(['peer']); held.resolve({ type: 'offer', sdp: 'old-offer' }); await work;
        expect(peer.pc.setLocalDescription).toHaveBeenCalledOnce(); expect(peer.pc.close).toHaveBeenCalledOnce(); expect(f.sent).toEqual([]);
        await third.pc.onnegotiationneeded(); expect(f.sent[0]).toMatchObject({ to: 'third', kind: 'rtc' });
    });

    it('does not answer an offer whose remote description finished after Block', async () => {
        const f = await fixture(), peer = f.state.pcs.get('peer'), held = deferred();
        peer.pc.setRemoteDescription.mockImplementation(() => held.promise); f.incoming({ sdp: { type: 'offer', sdp: 'before-block' } });
        expect(peer.pc.setRemoteDescription).toHaveBeenCalledOnce(); f.policy(['peer']); held.resolve();
        await new Promise(done => setTimeout(done, 0));
        expect(peer.pc.setLocalDescription).not.toHaveBeenCalled(); expect(f.sent).toEqual([]);
    });

    it('removing the policy permits fresh negotiation using only already opted-in capture', async () => {
        const f = await fixture(), old = f.state.pcs.get('peer'); f.policy(['peer']); f.policy([]);
        const next = f.state.pcs.get('peer'); expect(next).toBeDefined(); expect(next).not.toBe(old);
        expect(f.capture).toHaveBeenCalledOnce(); expect(f.localTrack.stop).not.toHaveBeenCalled();
        await next.pc.onnegotiationneeded(); expect(f.sent[0]).toMatchObject({ to: 'peer', kind: 'rtc' });
        f.room.onCam(f.channel.name, false); f.channel.myCam = false; f.policy(['peer']); f.policy([]);
        expect(f.capture).toHaveBeenCalledOnce(); expect(f.state.stream).toBeNull();
    });
});
