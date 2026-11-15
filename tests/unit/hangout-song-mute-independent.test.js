// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createSuiteMusic } from '../../play/assets/suite-music.js';

const lobby = readFileSync(path.join(process.cwd(), 'r/45662413410ed051/lobby/index.html'), 'utf8');

function accessibleName(element) {
    const explicit = element.getAttribute('aria-label');
    if (explicit) return explicit.trim();
    const parts = [];
    for (const node of element.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) parts.push(node.textContent);
        else if (node.nodeType === Node.ELEMENT_NODE && node.getAttribute('aria-hidden') !== 'true') parts.push(node.textContent);
    }
    return parts.join('').replace(/\s+/g, ' ').trim();
}

function memStorage() {
    const map = new Map();
    return {
        getItem: key => (map.has(key) ? map.get(key) : null),
        setItem: (key, value) => { map.set(key, String(value)); }
    };
}

class SongAudio {
    constructor() {
        this.paused = true;
        this.loop = false;
        this.preload = 'none';
        this.volume = 1;
        this.muted = false;
        this.currentTime = 0;
        this.duration = 120;
        this.readyState = 0;
        this.error = null;
        this.src = '';
        this.seeking = false;
        this.srcObject = null;
        this.listeners = new Map();
    }

    setAttribute() {}

    addEventListener(type, fn) {
        const list = this.listeners.get(type) || [];
        list.push(fn);
        this.listeners.set(type, list);
    }

    pause() {
        this.paused = true;
        this.emit('pause');
    }

    play() {
        return Promise.resolve().then(() => {
            this.paused = false;
            this.emit('playing');
        });
    }

    load() {}

    emit(type) {
        for (const fn of this.listeners.get(type) || []) fn();
    }
}

function liveTrack(kind) {
    const track = {
        kind,
        enabled: true,
        muted: false,
        readyState: 'live',
        listeners: {},
        stop() { track.readyState = 'ended'; },
        addEventListener(type, fn) { track.listeners[type] = fn; }
    };
    return track;
}

class FixtureMediaStream {
    constructor(tracks) { this.tracks = [...tracks]; }
    getTracks() { return this.tracks; }
    getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); }
    getVideoTracks() { return this.tracks.filter(track => track.kind === 'video'); }
}

class FixtureSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    static opened = [];

    constructor(url, protocols) {
        this.url = String(url);
        this.protocols = protocols;
        this.readyState = FixtureSocket.OPEN;
        this.sent = [];
        this.listeners = {};
        FixtureSocket.opened.push(this);
    }

    addEventListener(type, fn) { this.listeners[type] = fn; }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() { this.readyState = FixtureSocket.CLOSED; }
    deliver(frame) { this.listeners.message({ data: JSON.stringify(frame) }); }
}

class FixturePeerConnection {
    static latest = null;

    constructor() {
        this.signalingState = 'stable';
        this.connectionState = 'new';
        this.localDescription = null;
        this.transceivers = [];
        this.onnegotiationneeded = null;
        this.onicecandidate = null;
        this.ontrack = null;
        this.onconnectionstatechange = null;
        FixturePeerConnection.latest = this;
    }

    addTransceiver(kind) {
        const transceiver = {
            direction: 'recvonly',
            receiver: { track: { kind, readyState: 'live' } },
            sender: { track: null, replaceTrack: vi.fn(async () => {}) }
        };
        this.transceivers.push(transceiver);
        return transceiver;
    }

    getTransceivers() { return this.transceivers; }
    getConfiguration() { return { iceServers: [] }; }
    setConfiguration() {}
    close() { this.connectionState = 'closed'; }
    restartIce() {}
    addIceCandidate() { return Promise.resolve(); }
    setRemoteDescription() { return Promise.resolve(); }
    setLocalDescription() { return Promise.resolve(); }
}

function roomFrame({ audio, video }) {
    return {
        version: 1,
        t: 'media-room',
        peers: [{ id: 'peer-b', nick: 'Friend', audio: true, video: false }],
        tracks: { audio, video },
        cameraAllowed: true,
        canManageCamera: false,
        relay: false,
        reports: false
    };
}

async function flush() {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

describe('component-isolation evidence only: a standalone suite-music fixture, not the family-route song control', () => {
    let nativePlay;
    let view;
    let realAddEventListener;
    const added = [];

    beforeEach(async () => {
        localStorage.clear();
        vi.resetModules();
        FixtureSocket.opened = [];
        FixturePeerConnection.latest = null;
        nativePlay = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function play() { return Promise.resolve(); };
        Element.prototype.scrollIntoView = () => {};
        globalThis.MediaStream = FixtureMediaStream;
        globalThis.WebSocket = FixtureSocket;
        globalThis.RTCPeerConnection = FixturePeerConnection;
        globalThis.fetch = async () => ({
            ok: true,
            json: async () => ({ protocol: 'game-night-media.v1', ticket: `m${'ab'.repeat(16)}` })
        });
        const captured = {};
        realAddEventListener = window.addEventListener.bind(window);
        window.addEventListener = (type, fn, options) => {
            added.push([type, fn]);
            realAddEventListener(type, fn, options);
        };
        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            value: {
                getUserMedia: async constraints => {
                    const kind = constraints.video ? 'video' : 'audio';
                    const track = liveTrack(kind);
                    captured[kind] = track;
                    return { getTracks: () => [track] };
                }
            }
        });
        const parsed = new DOMParser().parseFromString(lobby, 'text/html');
        document.body.innerHTML = `${parsed.querySelector('[data-call-toggle]').outerHTML}${parsed.querySelector('[data-game-night]').outerHTML}`;
        const { mountGameNightSound } = await import('../../r/45662413410ed051/lobby/game-night-audio.mjs');
        const { mountGameNightCall } = await import('../../r/45662413410ed051/lobby/game-night-call.mjs');
        const surface = document.querySelector('[data-game-night]');
        const call = document.querySelector('#game-night-call');
        mountGameNightSound(surface.querySelector('[data-game-sound]'), surface);
        const api = mountGameNightCall(call, document.querySelector('[data-call-toggle]'), { personActions: vi.fn() });
        api.setRoom({ room: '#game-night', ref: 'b'.repeat(32), actor: 'actor-a' });
        document.querySelector('[data-call-toggle]').click();
        document.querySelector('[data-call-join]').click();
        await vi.waitFor(() => expect(FixtureSocket.opened).toHaveLength(1));
        const socket = FixtureSocket.opened[0];
        socket.deliver({ t: 'media-ready' });
        socket.deliver(roomFrame({ audio: false, video: false }));
        const remoteVoice = liveTrack('audio');
        FixturePeerConnection.latest.ontrack({ track: remoteVoice });
        const voice = document.querySelector('[data-call-peers] audio');
        const adult = document.querySelector('[data-call-adult]');
        document.querySelector('[data-call-mic]').click();
        socket.deliver(roomFrame({ audio: true, video: false }));
        await vi.waitFor(() => expect(captured.audio?.readyState).toBe('live'));
        adult.checked = true;
        adult.dispatchEvent(new Event('change'));
        document.querySelector('[data-call-camera]').click();
        socket.deliver(roomFrame({ audio: true, video: true }));
        await vi.waitFor(() => expect(captured.video?.readyState).toBe('live'));
        let songsMuted = false;
        const songs = createSuiteMusic({
            isSuiteMuted: () => songsMuted,
            resolveSrc: path => `https://example.test/play/assets/${path}`,
            storage: memStorage(),
            AudioCtor: SongAudio
        });
        songs.armFromGesture();
        await flush();
        view = {
            songs,
            muteSongs() { songsMuted = true; songs.sync(); },
            voice,
            remoteVoice,
            mic: captured.audio,
            camera: captured.video,
            effects: surface.querySelector('[data-game-sound]'),
            micButton: document.querySelector('[data-call-mic]'),
            voiceVolume: voice.volume
        };
    });

    afterEach(() => {
        window.dispatchEvent(new Event('pagehide'));
        for (const [type, fn] of added.splice(0)) window.removeEventListener(type, fn);
        window.addEventListener = realAddEventListener;
        HTMLMediaElement.prototype.play = nativePlay;
        document.body.replaceChildren();
        vi.resetModules();
    });

    it('keeps song volume and song mute off remote voice playback and the live camera and mic tracks', async () => {
        expect(view.songs.audioElement).not.toBe(view.voice);
        expect(view.songs.audioElement.volume).toBe(0.45);
        expect(view.songs.isPlaying()).toBe(true);
        expect(view.voice.muted).toBe(false);
        expect(view.voice.srcObject.getAudioTracks()[0]).toBe(view.remoteVoice);
        expect(view.mic.kind).toBe('audio');
        expect(view.camera.kind).toBe('video');
        expect(view.mic).not.toBe(view.remoteVoice);

        view.songs.audioElement.volume = 0;
        expect(view.voice.volume).toBe(view.voiceVolume);
        expect(view.voice.muted).toBe(false);
        expect(view.camera.readyState).toBe('live');
        expect(view.camera.enabled).toBe(true);
        expect(view.mic.readyState).toBe('live');
        view.songs.audioElement.volume = 0.45;

        view.effects.click();
        expect(view.effects.getAttribute('aria-pressed')).toBe('false');
        expect(view.songs.isPlaying()).toBe(true);
        expect(view.songs.audioElement.volume).toBe(0.45);
        expect(view.voice.muted).toBe(false);
        expect(view.voice.srcObject.getAudioTracks()[0]).toBe(view.remoteVoice);
        expect(view.remoteVoice.readyState).toBe('live');
        expect(view.camera.readyState).toBe('live');
        expect(view.camera.enabled).toBe(true);
        expect(view.mic.readyState).toBe('live');
        expect(view.mic.enabled).toBe(true);

        view.muteSongs();
        expect(view.songs.audioElement.paused).toBe(true);
        expect(view.songs.isPlaying()).toBe(false);
        expect(view.songs.audioElement.muted).toBe(false);
        expect(view.songs.audioElement.volume).toBe(0.45);
        expect(view.voice.muted).toBe(false);
        expect(view.voice.volume).toBe(view.voiceVolume);
        expect(view.voice.srcObject.getAudioTracks()[0]).toBe(view.remoteVoice);
        expect(view.remoteVoice.readyState).toBe('live');
        expect(view.camera.readyState).toBe('live');
        expect(view.camera.enabled).toBe(true);
        expect(view.mic.readyState).toBe('live');
        expect(view.mic.enabled).toBe(true);
    });

    it('gives the game-effects and mic controls different accessible names', () => {
        const effects = accessibleName(view.effects);
        const mic = accessibleName(view.micButton);
        expect(effects).toBe('Game sound');
        expect(mic).toBe('Mute mic');
        expect(effects).not.toBe(mic);
        expect(view.camera.readyState).toBe('live');
        expect(view.voice.muted).toBe(false);
    });
});
