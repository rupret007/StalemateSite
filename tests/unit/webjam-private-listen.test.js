// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
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
