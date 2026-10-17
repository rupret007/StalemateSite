import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const playerSource = readFileSync(path.join(repoRoot, 'js/site-player.js'), 'utf8');
const baseSource = readFileSync(path.join(repoRoot, 'site-base.js'), 'utf8');
const prefSource = readFileSync(path.join(repoRoot, 'js/music-preference.js'), 'utf8');

function loadPlayer(storage) {
    const dom = new JSDOM('<!DOCTYPE html><html><body><button data-site-play="manic" type="button">Play</button></body></html>', {
        url: 'https://stalemate.band/',
        runScripts: 'outside-only'
    });
    const { window } = dom;
    Object.defineProperty(window, 'localStorage', {
        value: {
            getItem: (k) => storage.get(k) ?? null,
            setItem: (k, v) => storage.set(k, v)
        },
        configurable: true
    });
    window.eval(baseSource);
    window.eval(prefSource);
    window.eval(playerSource);
    window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
    return window;
}

describe('site player', () => {
    let storage;

    beforeEach(() => {
        storage = new Map();
    });

    it('resolves manic under play/stalemate on the homepage', () => {
        const win = loadPlayer(storage);
        expect(win.StalemateSitePlayer.trackSrc('manic')).toBe('/play/stalemate/manic.m4a');
    });

    it('does not play when site music is off', async () => {
        const win = loadPlayer(storage);
        win.StalemateMusicPref.write('off');
        await win.StalemateSitePlayer.play('manic');
        const el = win.document.getElementById('stalemate-site-player');
        expect(el).toBeNull();
    });

    it('pauses when another media element starts playing', async () => {
        const win = loadPlayer(storage);
        win.HTMLMediaElement.prototype.play = function playStub() {
            return Promise.resolve();
        };
        await win.StalemateSitePlayer.play('manic');
        const el = win.document.getElementById('stalemate-site-player');
        let pausedCalled = false;
        el.pause = () => { pausedCalled = true; };

        const other = win.document.createElement('video');
        win.document.body.appendChild(other);
        other.dispatchEvent(new win.Event('play'));

        expect(pausedCalled).toBe(true);
    });
});
