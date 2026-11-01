// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../../r/45662413410ed051/lobby/index.html', import.meta.url), 'utf8');
const core = readFileSync(new URL('../../r/45662413410ed051/sync-core.js', import.meta.url), 'utf8');
const client = readFileSync(new URL('../../r/45662413410ed051/lobby/lobby-room.js', import.meta.url), 'utf8');
const windows = [];
afterEach(() => { for (const dom of windows.splice(0)) dom.window.close(); });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function fixture() {
    const dom = new JSDOM(html, { url: 'http://127.0.0.1:4320/', runScripts: 'outside-only' }); windows.push(dom);
    const { window } = dom, timers = new Map(), sent = [], peers = []; let timerId = 0;
    window.setTimeout = (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; };
    window.clearTimeout = id => timers.delete(id);
    window.HTMLCanvasElement.prototype.getContext = () => ({ clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} });
    window.HangoutVideo = { isPhoneDevice: () => false };
    window.HangoutYouTube = { create: () => ({ cancel() {} }) };
    window.MediaStream = class { tracks = []; addTrack(track) { this.tracks.push(track); } getTracks() { return this.tracks; } getVideoTracks() { return this.tracks; } };
    window.RTCPeerConnection = class {
        signalingState = 'stable'; localDescription = null; remoteDescription = null;
        constructor() { peers.push(this); }
        createOffer = vi.fn(async () => ({ type: 'offer', sdp: 'synthetic-offer' }));
        createAnswer = vi.fn(async () => ({ type: 'answer', sdp: 'synthetic-answer' }));
        setLocalDescription = vi.fn(async value => {
            const type = this.signalingState === 'have-remote-offer' ? 'answer' : 'offer';
            const chosen = value || { type, sdp: `synthetic-${type}` };
            this.localDescription = { ...chosen, toJSON: () => chosen }; this.signalingState = chosen.type === 'answer' ? 'stable' : 'have-local-offer';
        });
        setRemoteDescription = vi.fn(async value => { this.remoteDescription = value; this.signalingState = value.type === 'offer' ? 'have-remote-offer' : 'stable'; });
        addIceCandidate = vi.fn(async () => {});
        addTransceiver = vi.fn();
        close = vi.fn();
    };
    window.eval(core); window.eval(client);
    const app = { me: 'Painter', active: '#stalemate', band: false, chans: new Map() };
    const room = window.LobbyRoom.attach({ app, send: message => { sent.push(structuredClone(message)); return true; }, $: selector => window.document.querySelector(selector), turnUrl: '' });
    const canvas = window.document.querySelector('[data-act-canvas]');
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 360 });
    const join = name => {
        const channel = { name, kind: 'art', names: [{ nick: 'Painter', id: 'self' }, { nick: 'Peer', id: 'peer' }] };
        app.active = name; app.chans.set(name, channel); room.onJoin(channel, { strokes: [] }); return channel;
    };
    const mouse = (type, x = 60, y = 36) => canvas.dispatchEvent(new window.MouseEvent(type, { clientX: x, clientY: y, button: 0, cancelable: true }));
    const flush = () => { for (const [id, timer] of [...timers]) if (timer.delay === 80) { timers.delete(id); timer.fn(); } };
    const incoming = extra => room.onAct({ ch: app.active, kind: 'rtc', from: 'peer', ...extra });
    join('#art-first');
    return { room, app, window, canvas, peers, sent, timers, join, mouse, flush, incoming, state: window.__lobbyRoom.state };
}

async function negotiateIncomingPeer(f) {
    f.incoming({ ice: { candidate: 'synthetic-handshake-ice' } });
    const pc = f.state.pcs.get('peer').pc;
    f.incoming({ sdp: { type: 'offer', sdp: 'synthetic-handshake-offer' } });
    await vi.waitFor(() => expect(f.state.pcs.get('peer').remoteOfferJobs).toBe(0));
    expect(pc.signalingState).toBe('stable'); expect(pc.localDescription.type).toBe('answer');
    f.sent.length = 0; pc.setLocalDescription.mockClear(); // Only handshake setup history.
    return pc;
}

describe('activity work belongs to its original room lifetime', () => {
    it('discards a pending brush update when the active drawing room is replaced', () => {
        const f = fixture(); f.mouse('mousedown'); f.mouse('mousemove', 120, 72);
        f.join('#art-second'); f.flush(); f.mouse('mouseup');
        expect(f.sent).toEqual([]); expect(f.state.room.strokes).toEqual([]); expect(f.timers.size).toBe(0);
        f.mouse('mousedown', 300, 180); f.mouse('mousemove', 360, 216); f.mouse('mouseup');
        expect(f.sent).toHaveLength(1); expect(f.sent[0]).toMatchObject({ t: 'act', ch: '#art-second', kind: 'stroke', stroke: { pts: [[0.5, 0.5], [0.6, 0.6]] } });
    });

    it('cancels all queued drawing work on leaving or disconnect teardown', () => {
        const f = fixture(); f.mouse('mousedown'); f.room.onLeave(); f.flush(); f.mouse('mousemove'); f.mouse('mouseup');
        expect(f.sent).toEqual([]); expect(f.timers.size).toBe(0); expect(f.state.ch).toBeNull(); expect(f.state.room.strokes).toEqual([]);
    });

    it('does not publish while navigation has changed the active tab before room setup', () => {
        const f = fixture(); f.mouse('mousedown'); f.app.active = '#stalemate'; f.flush(); f.mouse('mouseup');
        expect(f.sent).toEqual([]);
    });

    it('drops a cancelled touch gesture and ignores a detached hidden canvas', () => {
        const f = fixture(); f.mouse('mousedown'); f.canvas.dispatchEvent(new f.window.Event('touchcancel')); f.flush();
        expect(f.sent).toEqual([]);
        f.room.onLeave(); f.mouse('mousedown'); f.flush(); f.mouse('mouseup'); expect(f.sent).toEqual([]);
    });

    it('keeps an already-captured old timer from flushing a replacement gesture', () => {
        const f = fixture(); f.mouse('mousedown'); const oldTimer = [...f.timers.values()][0].fn;
        f.join('#art-second'); f.mouse('mousedown', 300, 180); oldTimer(); expect(f.sent).toEqual([]);
        f.flush(); expect(f.sent).toHaveLength(1); expect(f.sent[0].ch).toBe('#art-second');
    });

    it('does not revive an activity context from a late frame after teardown', () => {
        const f = fixture(); f.room.onLeave();
        f.room.onAct({ ch: '#art-first', from: 'peer', kind: 'stroke', stroke: { id: 'late', color: '#009ee8', size: 8, pts: [[0.1, 0.1], [0.2, 0.2]] } });
        expect(f.state.ch).toBeNull(); expect(f.state.room.strokes).toEqual([]);
    });

    it('closes the old pair and drops publication of a native local description that finishes after changing rooms', async () => {
        const f = fixture(), pc = await negotiateIncomingPeer(f), held = deferred();
        pc.setLocalDescription.mockImplementation(() => held.promise); const work = pc.onnegotiationneeded();
        f.join('#art-second'); held.resolve({ type: 'offer', sdp: 'old-room' }); await work;
        expect(pc.setLocalDescription).toHaveBeenCalledOnce(); expect(pc.close).toHaveBeenCalledOnce(); expect(f.sent).toEqual([]);
    });

    it('drops a delayed remote camera offer before creating its answer in a replacement room', async () => {
        const f = fixture(); f.incoming({ ice: { candidate: 'synthetic' } }); const pc = f.peers[0], held = deferred();
        pc.setRemoteDescription.mockImplementation(() => held.promise); f.incoming({ sdp: { type: 'offer', sdp: 'old-room' } });
        expect(pc.setRemoteDescription).toHaveBeenCalledOnce(); f.join('#art-second'); held.resolve();
        await new Promise(done => setTimeout(done, 0)); expect(pc.setLocalDescription).not.toHaveBeenCalled(); expect(f.sent).toEqual([]);
    });

    it('does not signal a local description which finishes after teardown', async () => {
        const f = fixture(), pc = await negotiateIncomingPeer(f), held = deferred();
        pc.setLocalDescription.mockImplementation(async value => { await held.promise; pc.localDescription = { toJSON: () => value }; });
        const work = pc.onnegotiationneeded(); await vi.waitFor(() => expect(pc.setLocalDescription).toHaveBeenCalledOnce());
        f.room.onLeave(); held.resolve(); await work; expect(f.sent).toEqual([]);
    });

    it('does not publish a delayed native answer or reuse a removed peer even in the same room', async () => {
        const f = fixture(); f.incoming({ ice: { candidate: 'synthetic' } }); const old = f.peers[0], held = deferred();
        old.setLocalDescription.mockImplementation(() => held.promise); f.incoming({ sdp: { type: 'offer', sdp: 'old-offer' } });
        await vi.waitFor(() => expect(old.setLocalDescription).toHaveBeenCalledOnce()); f.room.onCam('#art-first', false);
        f.incoming({ ice: { candidate: 'replacement-peer' } }); const replacement = f.peers[1]; expect(replacement).toBeDefined();
        held.resolve({ type: 'answer', sdp: 'old-answer' }); await new Promise(done => setTimeout(done, 0));
        expect(old.setLocalDescription).toHaveBeenCalledOnce(); expect(old.close).toHaveBeenCalledOnce(); expect(f.sent).toEqual([]);
        expect(await negotiateIncomingPeer(f)).toBe(replacement);
        await replacement.onnegotiationneeded(); expect(f.sent[0]).toMatchObject({ ch: '#art-first', kind: 'rtc', to: 'peer' });
    });

    it('ignores old ICE callbacks and stops tracks delivered after their peer is removed', () => {
        const f = fixture(); f.incoming({ ice: { candidate: 'synthetic' } }); const pc = f.peers[0], ice = pc.onicecandidate, track = pc.ontrack;
        f.join('#art-second'); ice({ candidate: { toJSON: () => ({ candidate: 'old-room' }) } });
        const staleTrack = { stop: vi.fn() }; track({ track: staleTrack });
        expect(f.sent).toEqual([]); expect(staleTrack.stop).toHaveBeenCalledOnce(); expect(f.state.pcs.size).toBe(0);
    });

    it('stops accepted remote tracks and empties queued candidates when a peer closes', () => {
        const f = fixture(); f.incoming({ ice: { candidate: 'synthetic' } }); const pc = f.peers[0], entry = f.state.pcs.get('peer');
        const track = { stop: vi.fn() }; pc.ontrack({ track }); expect(entry.pendingIce).toHaveLength(1);
        f.room.onLeave(); expect(track.stop).toHaveBeenCalledOnce(); expect(entry.pendingIce).toEqual([]); expect(pc.close).toHaveBeenCalledOnce();
        expect(pc.onicecandidate).toBeNull(); expect(pc.ontrack).toBeNull(); expect(pc.onnegotiationneeded).toBeNull();
    });

    it('allows current-room painting and camera signaling without changing their wire payloads', async () => {
        const f = fixture(), pc = await negotiateIncomingPeer(f); f.mouse('mousedown'); f.mouse('mousemove', 120, 72); f.flush(); f.mouse('mouseup');
        expect(f.sent[0]).toMatchObject({ t: 'act', ch: '#art-first', kind: 'stroke', stroke: { pts: [[0.1, 0.1], [0.2, 0.2]] } });
        await pc.onnegotiationneeded();
        expect(f.sent[1]).toEqual({ t: 'act', ch: '#art-first', kind: 'rtc', to: 'peer', sdp: { type: 'offer', sdp: 'synthetic-offer' } });
        pc.onicecandidate({ candidate: { toJSON: () => ({ candidate: 'current-room' }) } });
        expect(f.sent[2]).toEqual({ t: 'act', ch: '#art-first', kind: 'rtc', to: 'peer', ice: { candidate: 'current-room' } });
        const currentTrack = { stop: vi.fn() }; pc.ontrack({ track: currentTrack }); expect(currentTrack.stop).not.toHaveBeenCalled();
    });
});
