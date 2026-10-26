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
            if (value?.type === 'rollback') { this.localDescription = null; this.signalingState = 'stable'; return; }
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

// ICE credentials are deliberately synthetic. These tests exercise only the
// real client's public native-candidate callback and its existing activity queue.
function mediaIceDescription(sections, session = {}) {
    const credentials = value => [value.ufrag && `a=ice-ufrag:${value.ufrag}`, value.pwd && `a=ice-pwd:${value.pwd}`].filter(Boolean);
    const lines = ['v=0', 'o=- 1 1 IN IP4 0.0.0.0', 's=-', 't=0 0', ...credentials(session)];
    for (const section of sections) lines.push('m=video 9 UDP/TLS/RTP/SAVPF 96', `a=mid:${section.mid}`, ...credentials(section));
    return { type: 'offer', sdp: `${lines.join('\r\n')}\r\n` };
}
async function queuedMediaIce(description, ice) {
    const f = await fixture({ clock: { at: 1800000000000 } }), pc = f.state.pcs.get('peer').pc;
    pc.localDescription = description;
    for (let i = 0; i < 8; i++) pc.onicecandidate({ candidate: { toJSON: () => ({
        candidate: `candidate:synthetic-budget-${i}`, sdpMid: 'camera', sdpMLineIndex: 0
    }) } });
    expect(f.sent).toHaveLength(8);
    pc.onicecandidate({ candidate: { toJSON: () => ice } });
    expect(f.sent).toHaveLength(8);
    return { f, pc };
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

    it.each([
        ['MID', { sdpMid: 'camera' }],
        ['media index', { sdpMLineIndex: 0 }],
        ['matching MID and index', { sdpMid: 'camera', sdpMLineIndex: 0 }]
    ])('keeps queued ICE selected by %s when only another media section changes', async (_label, selector) => {
        const camera = { mid: 'camera', ufrag: 'camera-a', pwd: 'synthetic-camera-password-a' };
        const other = { mid: 'other', ufrag: 'other-b', pwd: 'synthetic-other-password-b' };
        const ice = { candidate: 'candidate:unchanged-selected-media', usernameFragment: 'camera-a', ...selector };
        const { f, pc } = await queuedMediaIce(mediaIceDescription([camera, other]), ice);
        pc.localDescription = mediaIceDescription([camera, { ...other, ufrag: 'other-c', pwd: 'synthetic-other-password-c' }]);
        f.advance(125);
        expect(f.sent).toHaveLength(9); expect(f.sent.at(-1)).toMatchObject({ to: 'peer', ice });
    });

    it('rejects selected-media ICE after its tuple changes even when that tuple remains in another section', async () => {
        const camera = { mid: 'camera', ufrag: 'camera-a', pwd: 'synthetic-camera-password-a' };
        const other = { mid: 'other', ufrag: 'other-b', pwd: 'synthetic-other-password-b' };
        const ice = { candidate: 'candidate:wrong-selected-generation', usernameFragment: 'camera-a', sdpMid: 'camera', sdpMLineIndex: 0 };
        const { f, pc } = await queuedMediaIce(mediaIceDescription([camera, other]), ice);
        // The whole SDP's credential union is unchanged; only the MID ownership
        // of those tuples changed. Finding the old ufrag elsewhere is not valid.
        pc.localDescription = mediaIceDescription([{ ...other, mid: 'camera' }, { ...camera, mid: 'other' }]);
        f.advance(125); expect(f.sent).toHaveLength(8);
    });

    it('rejects contradictory ICE MID and media-index selectors', async () => {
        const description = mediaIceDescription([
            { mid: 'camera', ufrag: 'camera-a', pwd: 'synthetic-camera-password-a' },
            { mid: 'other', ufrag: 'other-b', pwd: 'synthetic-other-password-b' }
        ]);
        const ice = { candidate: 'candidate:contradictory-selectors', usernameFragment: 'camera-a', sdpMid: 'camera', sdpMLineIndex: 1 };
        const { f } = await queuedMediaIce(description, ice);
        f.advance(125); expect(f.sent).toHaveLength(8);
    });

    it('inherits session-level ICE credentials for the selected media section', async () => {
        const session = { ufrag: 'session-a', pwd: 'synthetic-session-password-a' }, camera = { mid: 'camera' };
        const other = { mid: 'other', ufrag: 'other-b', pwd: 'synthetic-other-password-b' };
        const ice = { candidate: 'candidate:inherited-selected-generation', usernameFragment: 'session-a', sdpMid: 'camera', sdpMLineIndex: 0 };
        const { f, pc } = await queuedMediaIce(mediaIceDescription([camera, other], session), ice);
        pc.localDescription = mediaIceDescription([camera, { ...other, ufrag: 'other-c', pwd: 'synthetic-other-password-c' }], session);
        f.advance(125);
        expect(f.sent).toHaveLength(9); expect(f.sent.at(-1)).toMatchObject({ to: 'peer', ice });
    });

    it('keeps queued legacy ICE bound to its selected tuple when another section changes', async () => {
        const camera = { mid: 'camera', ufrag: 'camera-a', pwd: 'synthetic-camera-password-a' };
        const other = { mid: 'other', ufrag: 'other-b', pwd: 'synthetic-other-password-b' };
        const ice = { candidate: 'candidate:legacy-selected-media', sdpMid: 'camera', sdpMLineIndex: 0 };
        const { f, pc } = await queuedMediaIce(mediaIceDescription([camera, other]), ice);
        pc.localDescription = mediaIceDescription([camera, { ...other, ufrag: 'other-c', pwd: 'synthetic-other-password-c' }]);
        f.advance(125);
        expect(f.sent).toHaveLength(9); expect(f.sent.at(-1)).toMatchObject({ to: 'peer', ice });
    });

    it('rejects queued legacy ICE if its selected password changes while the global union stays equal', async () => {
        const camera = { mid: 'camera', ufrag: 'camera-a', pwd: 'synthetic-camera-password-a' };
        const other = { mid: 'other', ufrag: 'other-b', pwd: 'synthetic-other-password-b' };
        const ice = { candidate: 'candidate:legacy-wrong-selected-password', sdpMid: 'camera', sdpMLineIndex: 0 };
        const { f, pc } = await queuedMediaIce(mediaIceDescription([camera, other]), ice);
        pc.localDescription = mediaIceDescription([{ ...camera, pwd: other.pwd }, { ...other, pwd: camera.pwd }]);
        f.advance(125); expect(f.sent).toHaveLength(8);
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

    it('defers local renegotiation until the prior paced offer has been sent and genuinely answered', async () => {
        const f = await fixture({ clock: { at: 1800000000000 } }), pc = f.state.pcs.get('peer').pc, held = deferred();
        for (let i = 0; i < 8; i++) pc.onicecandidate({ candidate: { toJSON: () => ({ candidate: `initial-${i}` }) } });
        await pc.onnegotiationneeded();
        const nativeLocalEffect = pc.setLocalDescription.getMockImplementation();
        pc.setLocalDescription.mockImplementation(async value => { await held.promise; return nativeLocalEffect(value); });
        try {
            await pc.onnegotiationneeded();
            expect(pc.signalingState).toBe('have-local-offer'); expect(pc.setLocalDescription).toHaveBeenCalledOnce();
            f.advance(125); expect(f.sent.filter(frame => frame.sdp).map(frame => frame.sdp.type)).toEqual(['offer']);
            f.incoming({ sdp: { type: 'answer', sdp: 'genuine-prior-offer-answer' } });
            await vi.waitFor(() => expect(pc.setLocalDescription).toHaveBeenCalledTimes(2));
            expect(pc.signalingState).toBe('stable');
            expect(f.sent.filter(frame => frame.sdp)).toHaveLength(1);
        } finally { held.resolve(); await new Promise(resolve => setTimeout(resolve, 0)); }
        f.advance(125);
        expect(f.sent.filter(frame => frame.sdp).map(frame => frame.sdp.type)).toEqual(['offer', 'offer']);
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
        expect(f.state.pcs.get('peer').pc.addTransceiver).not.toHaveBeenCalled();
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
        const nativeLocal = pc.setLocalDescription.getMockImplementation();
        pc.setLocalDescription.mockImplementation(async value => {
            if (value?.type === 'rollback' && entry.settingRemoteAnswer) throw new Error('synthetic rollback queued behind the pending successful answer');
            return nativeLocal(value);
        });
        pc.setRemoteDescription.mockImplementation(async description => {
            if (description.type === 'answer' || entry.settingRemoteAnswer) await held.promise;
            pc.remoteDescription = description; pc.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable';
        });
        f.room.onAct({ ch: f.channel.name, kind: 'rtc', from: 'third', sdp: { type: 'answer', sdp: 'prior-offer-answer' } });
        f.room.onAct({ ch: f.channel.name, kind: 'rtc', from: 'third', sdp: { type: 'offer', sdp: 'next-peer-offer' } });
        held.resolve(); await new Promise(done => setTimeout(done, 0));
        await vi.waitFor(() => expect(pc.setRemoteDescription.mock.calls.map(([description]) => description.type)).toEqual(['answer', 'offer']));
        expect(pc.setLocalDescription.mock.calls.some(([description]) => description?.type === 'rollback')).toBe(false);
    });

    it.each(['remote description', 'local answer'])('does not create a local offer while an incoming %s is pending', async phase => {
        const f = await fixture(), pc = f.state.pcs.get('peer').pc, held = deferred();
        const nativeRemoteEffect = pc.setRemoteDescription.getMockImplementation();
        const nativeLocalEffect = pc.setLocalDescription.getMockImplementation();
        if (phase === 'remote description') pc.setRemoteDescription.mockImplementationOnce(async value => {
            await held.promise; // Native SRD has been invoked, but its effect is pending.
            return nativeRemoteEffect(value);
        });
        else pc.setLocalDescription.mockImplementationOnce(async value => {
            await nativeLocalEffect(value); // Native answer effect occurs first.
            await held.promise; // Its completion is still part of handling the offer.
        });
        f.incoming({ sdp: { type: 'offer', sdp: 'genuine-peer-offer' } });
        try {
            if (phase === 'remote description') {
                await vi.waitFor(() => expect(pc.setRemoteDescription).toHaveBeenCalledOnce());
                expect(pc.signalingState).toBe('stable');
                expect(pc.setLocalDescription).not.toHaveBeenCalled();
            } else {
                await vi.waitFor(() => expect(pc.localDescription.type).toBe('answer'));
                expect(pc.signalingState).toBe('stable');
                expect(pc.setLocalDescription).toHaveBeenCalledOnce();
            }
            const localCalls = pc.setLocalDescription.mock.calls.length;
            await pc.onnegotiationneeded();
            expect(pc.setLocalDescription).toHaveBeenCalledTimes(localCalls);
            expect(f.sent.filter(frame => frame.sdp)).toEqual([]);
        } finally { held.resolve(); await new Promise(resolve => setTimeout(resolve, 0)); }
        const afterIncoming = phase === 'local answer' ? ['answer', 'offer'] : ['answer'];
        await vi.waitFor(() => expect(f.sent.filter(frame => frame.sdp).map(frame => frame.sdp.type)).toEqual(afterIncoming));
        if (phase === 'remote description') {
            // Debt raised before answer construction is already represented by
            // that answer. It must not create a redundant automatic offer.
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(f.sent.filter(frame => frame.sdp).map(frame => frame.sdp.type)).toEqual(['answer']);
            expect(pc.signalingState).toBe('stable');
            await pc.onnegotiationneeded();
        } else {
            // The event after the native answer effect must survive the held
            // completion and create exactly one offer without another event.
            expect(pc.setLocalDescription).toHaveBeenCalledTimes(2);
            expect(pc.signalingState).toBe('have-local-offer');
        }
        expect(f.sent.filter(frame => frame.sdp).map(frame => frame.sdp.type)).toEqual(['answer', 'offer']);
        expect(f.capture).toHaveBeenCalledOnce(); expect(f.localTrack.stop).not.toHaveBeenCalled();
    });

    it.each(['send', 'block/replacement', 'teardown', 'transport failure'])('keeps a paced answer ahead of deferred negotiation on %s', async action => {
        let broken = false;
        const f = await fixture({ clock: { at: 1800000000000 }, onSend: () => !broken });
        const entry = f.state.pcs.get('peer'), pc = entry.pc, held = deferred();
        const nativeLocalEffect = pc.setLocalDescription.getMockImplementation();
        for (let i = 0; i < 8; i++) pc.onicecandidate({ candidate: { toJSON: () => ({ candidate: `answer-budget-${i}` }) } });
        pc.setLocalDescription.mockImplementationOnce(async value => { await nativeLocalEffect(value); await held.promise; });
        f.incoming({ sdp: { type: 'offer', sdp: 'genuine-paced-offer' } });
        try {
            await vi.waitFor(() => expect(pc.localDescription.type).toBe('answer'));
            await pc.onnegotiationneeded();
            expect(pc.setLocalDescription).toHaveBeenCalledOnce();
        } finally { held.resolve(); await new Promise(resolve => setTimeout(resolve, 0)); }
        // Completion queues the answer, but does not guarantee server delivery.
        // Advancing the local description before its raw attempt would silently
        // invalidate that queued answer's existing SDP epoch/identity guard.
        expect(pc.setLocalDescription).toHaveBeenCalledOnce();
        expect(f.sent.filter(frame => frame.sdp)).toEqual([]);
        if (action === 'block/replacement') { f.policy(['peer']); f.policy([]); expect(f.state.pcs.get('peer')).not.toBe(entry); }
        if (action === 'teardown') f.room.onLeave();
        if (action === 'transport failure') broken = true;
        f.advance(125); await new Promise(resolve => setTimeout(resolve, 0));
        if (action === 'send') {
            expect(f.sent.filter(frame => frame.sdp).map(frame => frame.sdp.type)).toEqual(['answer']);
            expect(pc.setLocalDescription).toHaveBeenCalledTimes(2);
            f.advance(125);
            expect(f.sent.filter(frame => frame.sdp).map(frame => frame.sdp.type)).toEqual(['answer', 'offer']);
            expect(f.capture).toHaveBeenCalledOnce(); expect(f.localTrack.stop).not.toHaveBeenCalled();
        } else {
            for (let i = 0; i < 4; i++) f.advance(125);
            expect(pc.setLocalDescription).toHaveBeenCalledOnce(); expect(pc.close).toHaveBeenCalledOnce();
            expect(f.sent.filter(frame => frame.sdp).map(frame => frame.sdp.type)).toEqual(action === 'transport failure' ? ['answer'] : []);
        }
    });

    it('retains failed local negotiation for a later genuine event without retrying the same failure', async () => {
        const f = await fixture(), pc = f.state.pcs.get('peer').pc;
        pc.setLocalDescription.mockRejectedValueOnce(new Error('synthetic native local-description rejection'));
        await pc.onnegotiationneeded(); await new Promise(resolve => setTimeout(resolve, 0));
        expect(pc.setLocalDescription).toHaveBeenCalledOnce(); expect(f.sent.filter(frame => frame.sdp)).toEqual([]);
        await pc.onnegotiationneeded();
        expect(pc.setLocalDescription).toHaveBeenCalledTimes(2);
        expect(f.sent.filter(frame => frame.sdp).map(frame => frame.sdp.type)).toEqual(['offer']);
        expect(f.capture).toHaveBeenCalledOnce(); expect(f.localTrack.stop).not.toHaveBeenCalled();
    });

    it('keeps retired negotiation debt cleared when native rejection arrives after Block and replacement', async () => {
        const f = await fixture(), entry = f.state.pcs.get('peer'), third = f.state.pcs.get('third');
        const pc = entry.pc, held = deferred(), lateNegotiation = pc.onnegotiationneeded;
        pc.setLocalDescription.mockImplementationOnce(async () => { await held.promise; throw new Error('synthetic obsolete native rejection'); });
        const work = lateNegotiation();
        try {
            expect(pc.setLocalDescription).toHaveBeenCalledOnce();
            f.policy(['peer']); f.policy([]);
            expect(f.state.pcs.get('peer')).not.toBe(entry); expect(f.state.pcs.get('third')).toBe(third);
        } finally { held.resolve(); await work; }
        expect(entry.offerNeeded).toBe(false);
        await lateNegotiation();
        expect(pc.setLocalDescription).toHaveBeenCalledOnce(); expect(pc.close).toHaveBeenCalledOnce();
        expect(f.sent.filter(frame => frame.sdp)).toEqual([]);
        expect(f.capture).toHaveBeenCalledOnce(); expect(f.localTrack.stop).not.toHaveBeenCalled();
    });

    it('waits for reentrant local completion and explicit rollback before applying the accepted peer offer', async () => {
        const f = await fixture(), pc = f.state.pcs.get('peer').pc, heldLocal = deferred(), heldRollback = deferred(), order = [];
        const nativeLocal = pc.setLocalDescription.getMockImplementation(), nativeRemote = pc.setRemoteDescription.getMockImplementation();
        pc.setRemoteDescription.mockImplementation(async value => { order.push('remote'); return nativeRemote(value); });
        pc.setLocalDescription.mockImplementation(async value => {
            if (value?.type === 'rollback') { order.push('rollback-start'); await heldRollback.promise; order.push('rollback-end'); }
            return nativeLocal(value);
        });
        pc.setLocalDescription.mockImplementationOnce(value => {
            const effect = nativeLocal(value); // Native offer effect precedes its completion.
            f.incoming({ sdp: { type: 'offer', sdp: 'genuine-reentrant-offer' } }); // BEFORE this call returns a promise.
            return (async () => { await effect; await heldLocal.promise; order.push('local-end'); })();
        });
        const work = pc.onnegotiationneeded();
        try {
            expect(pc.setLocalDescription).toHaveBeenCalledOnce(); expect(pc.setRemoteDescription).not.toHaveBeenCalled();
            expect(f.sent.filter(frame => frame.sdp)).toEqual([]);
            heldLocal.resolve(); await work;
            await vi.waitFor(() => expect(pc.setLocalDescription.mock.calls[1]).toEqual([{ type: 'rollback' }]));
            expect(pc.setRemoteDescription).not.toHaveBeenCalled(); expect(order).toEqual(['local-end', 'rollback-start']);
            heldRollback.resolve();
            await vi.waitFor(() => expect(f.sent.filter(frame => frame.sdp).map(frame => frame.sdp.type)).toEqual(['answer']));
            expect(order).toEqual(['local-end', 'rollback-start', 'rollback-end', 'remote']);
            expect(pc.signalingState).toBe('stable'); expect(pc.setLocalDescription).toHaveBeenCalledTimes(3);
        } finally { heldLocal.resolve(); heldRollback.resolve(); await work; await new Promise(resolve => setTimeout(resolve, 0)); }
    });

    it('rechecks queued rollback eligibility and keeps overlapping accepted offers fenced', async () => {
        const f = await fixture(), entry = f.state.pcs.get('peer'), pc = entry.pc;
        const heldLocal = deferred(), heldRollback = deferred(), heldRemote = deferred(), rollbackStates = [];
        const nativeLocal = pc.setLocalDescription.getMockImplementation(), nativeRemote = pc.setRemoteDescription.getMockImplementation();
        pc.setLocalDescription.mockImplementation(async value => {
            if (value?.type === 'rollback') {
                rollbackStates.push(pc.signalingState);
                if (rollbackStates.length === 1) await heldRollback.promise;
                if (pc.signalingState !== 'have-local-offer') throw new Error('synthetic invalid second rollback');
            }
            return nativeLocal(value);
        });
        pc.setLocalDescription.mockImplementationOnce(value => { const effect = nativeLocal(value); return (async () => { await effect; await heldLocal.promise; })(); });
        pc.setRemoteDescription.mockImplementation(async value => {
            if (value.sdp === 'overlap-first') await heldRemote.promise;
            return nativeRemote(value);
        });
        const work = pc.onnegotiationneeded();
        f.incoming({ sdp: { type: 'offer', sdp: 'overlap-first' } });
        f.incoming({ sdp: { type: 'offer', sdp: 'overlap-second' } });
        try {
            expect(entry.remoteOfferJobs).toBe(2); expect(pc.setRemoteDescription).not.toHaveBeenCalled();
            heldLocal.resolve(); await work;
            await vi.waitFor(() => expect(rollbackStates).toEqual(['have-local-offer']));
            heldRollback.resolve(); await new Promise(resolve => setTimeout(resolve, 0));
            expect(rollbackStates).toEqual(['have-local-offer']);
            await vi.waitFor(() => expect(entry.remoteOfferJobs).toBe(1));
            const localCalls = pc.setLocalDescription.mock.calls.length;
            await pc.onnegotiationneeded(); expect(pc.setLocalDescription).toHaveBeenCalledTimes(localCalls);
            heldRemote.resolve(); await vi.waitFor(() => expect(entry.remoteOfferJobs).toBe(0));
            expect(rollbackStates).toEqual(['have-local-offer']);
        } finally { heldLocal.resolve(); heldRollback.resolve(); heldRemote.resolve(); await work; await new Promise(resolve => setTimeout(resolve, 0)); }
    });

    it.each(['local completion', 'explicit rollback'])('does not resume retired incoming signaling after Block during %s', async phase => {
        const f = await fixture(), entry = f.state.pcs.get('peer'), third = f.state.pcs.get('third'), pc = entry.pc;
        const heldLocal = deferred(), heldRollback = deferred(), nativeLocal = pc.setLocalDescription.getMockImplementation();
        let localCompleted = false;
        pc.setLocalDescription.mockImplementation(async value => {
            if (value?.type === 'rollback') await heldRollback.promise;
            return nativeLocal(value);
        });
        pc.setLocalDescription.mockImplementationOnce(value => {
            const effect = nativeLocal(value);
            f.incoming({ sdp: { type: 'offer', sdp: 'genuine-offer-before-retirement' } });
            return (async () => { await effect; await heldLocal.promise; localCompleted = true; })();
        });
        const work = pc.onnegotiationneeded();
        try {
            expect(pc.setRemoteDescription).not.toHaveBeenCalled();
            if (phase === 'explicit rollback') {
                heldLocal.resolve(); await work;
                await vi.waitFor(() => expect(pc.setLocalDescription.mock.calls[1]).toEqual([{ type: 'rollback' }]));
            }
            f.policy(['peer']); f.policy([]);
            const replacement = f.state.pcs.get('peer'); expect(replacement).not.toBe(entry);
            if (phase === 'local completion') {
                await vi.waitFor(() => expect(entry.remoteOfferJobs).toBe(0)); // Close releases the waiter while native completion stays held.
                expect(localCompleted).toBe(false);
            }
            expect(pc.setRemoteDescription).not.toHaveBeenCalled(); expect(pc.close).toHaveBeenCalledOnce();
            expect(f.state.pcs.get('third')).toBe(third); expect(third.pc.close).not.toHaveBeenCalled();
        } finally { heldLocal.resolve(); heldRollback.resolve(); await work; await new Promise(resolve => setTimeout(resolve, 0)); }
        expect(pc.setRemoteDescription).not.toHaveBeenCalled(); expect(entry.remoteOfferJobs).toBe(0);
        expect(f.sent.filter(frame => frame.sdp)).toEqual([]);
        expect(f.capture).toHaveBeenCalledOnce(); expect(f.localTrack.stop).not.toHaveBeenCalled();
    });

    it('does not publish an obsolete generated offer while a newer peer offer waits for its local completion', async () => {
        const f = await fixture(), entry = f.state.pcs.get('peer'), pc = entry.pc, held = deferred();
        const nativeLocalEffect = pc.setLocalDescription.getMockImplementation();
        let firstCompleted = false;
        pc.setLocalDescription.mockImplementationOnce(async value => {
            await nativeLocalEffect(value); // Native local-offer effect occurs first.
            await held.promise; // Delay only its wrapper completion/callback.
        });
        const work = pc.onnegotiationneeded().then(() => { firstCompleted = true; });
        try {
            await vi.waitFor(() => expect(pc.signalingState).toBe('have-local-offer'));
            expect(entry.polite).toBe(true); expect(firstCompleted).toBe(false);
            expect(f.sent.filter(frame => frame.sdp)).toEqual([]);
            f.incoming({ sdp: { type: 'offer', sdp: 'newer-peer-offer' } });
            expect(pc.setRemoteDescription).not.toHaveBeenCalled(); expect(pc.setLocalDescription).toHaveBeenCalledOnce();
            expect(firstCompleted).toBe(false);
            held.resolve(); await work;
            await vi.waitFor(() => expect(f.sent.filter(frame => frame.sdp).map(frame => frame.sdp.type)).toEqual(['answer']));
            expect(pc.signalingState).toBe('stable'); expect(firstCompleted).toBe(true);
            expect(pc.setLocalDescription.mock.calls.map(([value]) => value?.type || 'auto')).toEqual(['auto', 'rollback', 'auto']);
        } finally { held.resolve(); await work; }
        // A stale completion must not send either the old offer or a duplicate
        // of the now-current answer that replaced it in localDescription.
        expect(firstCompleted).toBe(true);
        expect(f.sent.filter(frame => frame.sdp).map(frame => frame.sdp)).toEqual([{ type: 'answer', sdp: 'native-current-description' }]);
        expect(pc.createOffer).not.toHaveBeenCalled();
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
