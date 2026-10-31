import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { createSuiteMusic } from '../../play/assets/suite-music.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const prefSource = readFileSync(path.join(repoRoot, 'js/music-preference.js'), 'utf8');
const turdsuiteSource = readFileSync(path.join(repoRoot, 'play/assets/turdsuite.js'), 'utf8');

function memStorage() {
    const map = new Map();
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => { map.set(k, v); }
    };
}

class MockSuiteAudio {
    constructor() {
        this.paused = true;
        this.loop = false;
        this.preload = 'none';
        this.volume = 0.45;
        this.currentTime = 0;
        this.duration = 120;
        this.readyState = 4;
        this.error = null;
        this.src = '';
        this.seeking = false;
        this._listeners = new Map();
    }

    setAttribute() {}

    addEventListener(type, fn) {
        if (!this._listeners.has(type)) this._listeners.set(type, []);
        this._listeners.get(type).push(fn);
    }

    pause() {
        this.paused = true;
        this._emit('pause');
    }

    play() {
        return Promise.resolve().then(() => {
            this.paused = false;
            this._emit('playing');
        });
    }

    load() {}

    _emit(type) {
        for (const fn of this._listeners.get(type) || []) fn();
    }
}

function loadPlayPage(bodyHtml) {
    const dom = new JSDOM(
        `<!DOCTYPE html><html><body>${bodyHtml}</body></html>`,
        {
            url: pathToFileURL(path.join(repoRoot, 'play/turdomania.html')).href,
            runScripts: 'outside-only'
        }
    );
    const { window } = dom;
    Object.defineProperty(window, 'localStorage', { value: memStorage(), configurable: true });
    window.HTMLMediaElement.prototype.play = function playStub() {
        return Promise.resolve();
    };
    window.eval(prefSource);
    window.eval(turdsuiteSource);
    window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
    return { window, dom };
}

describe('suite BGM follows site music preference', () => {
    it('wires stalemate-music-change in turdsuite boot', () => {
        expect(turdsuiteSource).toContain('wireSiteMusicPref');
        expect(turdsuiteSource).toContain("addEventListener('stalemate-music-change'");
        expect(turdsuiteSource).toContain('applySiteMusicPref');
        expect(turdsuiteSource).toContain('musicEngine.sync');
    });

    let pages = [];

    afterEach(() => {
        pages.splice(0).forEach((dom) => dom.window.close());
    });

    it('header toggle off pauses armed suite music in the same session', async () => {
        let musicEnabled = true;
        const storage = memStorage();
        const player = createSuiteMusic({
            isSuiteMuted: () => !musicEnabled,
            resolveSrc: (rel) => `https://stalemate.band/play/assets/${rel}`,
            storage,
            AudioCtor: MockSuiteAudio
        });

        function applySiteMusicPref(on) {
            on = !!on;
            if (musicEnabled === on) {
                player.sync();
                return;
            }
            musicEnabled = on;
            storage.setItem('stalemate.music', on ? 'on' : 'off');
            player.sync();
        }

        const dom = new JSDOM(
            '<!DOCTYPE html><html><body><button type="button" data-music-toggle>Music on</button></body></html>',
            { url: 'https://stalemate.band/play/turdomania.html', runScripts: 'outside-only' }
        );
        pages.push(dom);
        const { window } = dom;
        Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
        window.eval(prefSource);
        window.addEventListener('stalemate-music-change', (event) => {
            if (event.detail && typeof event.detail.on === 'boolean') {
                applySiteMusicPref(event.detail.on);
            }
        });

        player.armFromGesture();
        await Promise.resolve();
        await Promise.resolve();
        expect(player.audioElement.paused).toBe(false);

        window.document.querySelector('[data-music-toggle]').click();
        await Promise.resolve();
        expect(storage.getItem('stalemate.music')).toBe('off');
        expect(player.audioElement.paused).toBe(true);
        expect(window.StalemateMusicPref.isOn()).toBe(false);
    });

    it('suite setMusicEnabled keeps the site header toggle in sync', async () => {
        const { window, dom } = loadPlayPage('<button type="button" data-music-toggle>Music on</button>');
        pages.push(dom);
        window.Suite.setMusicEnabled(false);
        await Promise.resolve();
        const header = window.document.querySelector('[data-music-toggle]');
        expect(header.getAttribute('aria-pressed')).toBe('false');
        expect(header.textContent).toBe('Music off');
        expect(window.localStorage.getItem('stalemate.music')).toBe('off');
    });
});
