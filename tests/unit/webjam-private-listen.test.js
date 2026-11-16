// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { JOIN_SIGNAL, applyJoinFailure, clearJoinFailure, mapJoinError } from '../../join/errors.js';

const read = (path) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const html = read('hangout-worker/web-join-chess/index.html');
const app = read('hangout-worker/web-join-music/app.js');
const windows = [];
afterEach(() => { for (const window of windows.splice(0)) window.close(); });

function fixture({ firstJoinFails = false } = {}) {
    const { window } = new JSDOM(html, {
        url: 'https://music.example.test/join/#synthetic',
        runScripts: 'outside-only',
    });
    windows.push(window);
    const $ = id => window.document.getElementById(id);
    const capture = vi.fn();
    const sessions = [];
    class Session {
        constructor(options) { this.options = options; sessions.push(this); }
        async join() {
            if (firstJoinFails && sessions.length === 1) throw new Error(JOIN_SIGNAL.HOST_NO_ANSWER);
            this.options.onStatus('Connected');
        }
        close() {}
    }
    window.AudioContext = class { async resume() {} };
    window.HTMLMediaElement.prototype.pause = () => {};
    window.fixture = {
        readInvite: () => ({ expiresAt: Math.floor(Date.now() / 1000) + 60 }),
        acquireMusicStream: capture, closeAudioContext: () => Promise.resolve(),
        WebJoinSession: Session, RELAY_ORIGIN: 'https://relay.example.test',
        JOIN_SIGNAL, applyJoinFailure, clearJoinFailure, mapJoinError,
    };
    const bindings = Object.keys(window.fixture).join(',');
    const source = app.replace(/^import[\s\S]*?from "[^"]+";\n/gm, '');
    window.eval(`const {${bindings}} = window.fixture;\n${source}`);
    return { $, capture, sessions, window };
}

it('joins to listen on an explicit action without acquiring a microphone stream', async () => {
    const { $, capture, sessions } = fixture();
    expect($('listen').disabled).toBe(false);
    expect($('join').disabled).toBe(true);
    $('listen').click();
    await vi.waitFor(() => expect($('status').textContent).toContain('microphone off'));
    expect(sessions).toHaveLength(1);
    expect(sessions[0].options.stream).toBeUndefined();
    expect(capture).not.toHaveBeenCalled();
    expect($('listen-actions').hidden).toBe(true);
    expect($('leave').hidden).toBe(false);
});

it('keeps a listener’s Retry focused on listening after a host timeout', async () => {
    const { $, capture, sessions, window } = fixture({ firstJoinFails: true });
    $('listen').focus();
    $('listen').click();
    await vi.waitFor(() => expect($('retry').hidden).toBe(false));
    expect($('error-hint').textContent).toContain('Retry to listen with your microphone off');
    expect(window.document.activeElement).toBe($('retry'));
    $('retry').click();
    await vi.waitFor(() => expect($('status').textContent).toContain('microphone off'));
    expect(sessions).toHaveLength(2);
    expect(sessions.every(session => session.options.stream === undefined)).toBe(true);
    expect(capture).not.toHaveBeenCalled();
});

it.each([false, true])('sets the audio answer direction with microphone present = %s', async (withMic) => {
    const source = read('hangout-worker/web-join-chess/session.js')
        .replace(/^import .*;\n/gm, '')
        .replace(/^export /gm, '');
    const stopBeforeSignaling = new Error('Fixture stops before signaling');
    const video = { receiver: { track: { kind: 'video' } }, direction: 'sendrecv' };
    const audio = { receiver: { track: { kind: 'audio' } }, direction: 'sendrecv' };
    const track = { enabled: true };
    const stream = withMic ? { getAudioTracks: () => [track] } : undefined;
    const addTrack = vi.fn();
    const createAnswer = vi.fn(() => { throw stopBeforeSignaling; });
    class Peer {
        static async generateCertificate() { return {}; }
        addEventListener() {}
        async setRemoteDescription() {}
        getTransceivers() { return [video, audio]; }
        addTrack(...args) { addTrack(...args); }
        createAnswer() { return createAnswer(); }
    }
    const Session = runInNewContext(`${source}\nWebJoinSession;`, {
        AbortController, RTCPeerConnection: Peer, SESSION_BYTES: 2048,
        Mailbox: class {
            async receive() { return {}; }
            async credentials() { return { expiresAt: Date.now() + 60000, quotaBytes: 2048, iceServers: [] }; }
        },
        open: async (_, payload) => payload,
        validateOffer: () => ({ sdp: 'fixture offer' }),
        policySdp: sdp => sdp,
    });
    const session = new Session({ stream });
    await expect(session.join()).rejects.toBe(stopBeforeSignaling);
    expect(createAnswer).toHaveBeenCalledOnce();
    expect(video.direction).toBe('sendrecv');
    if (withMic) {
        expect(track.enabled).toBe(false);
        expect(addTrack).toHaveBeenCalledExactlyOnceWith(track, stream);
        expect(audio.direction).toBe('sendrecv');
    } else {
        expect(addTrack).not.toHaveBeenCalled();
        expect(audio.direction).toBe('recvonly');
    }
});
