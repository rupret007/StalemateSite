import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = readFileSync(path.join(repoRoot, 'js/music-preference.js'), 'utf8');

function loadPref(storage) {
    const dom = new JSDOM('<!DOCTYPE html><html><body><button data-music-toggle type="button">Music on</button><audio></audio></body></html>', {
        url: 'https://stalemate.band/',
        runScripts: 'outside-only'
    });
    const { window } = dom;
    Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
    window.eval(source);
    return window;
}

describe('music preference', () => {
    let store;

    beforeEach(() => {
        store = new Map();
    });

    afterEach(() => {
        store = null;
    });

    it('defaults to on and persists off', () => {
        const storage = {
            getItem: (k) => store.get(k) ?? null,
            setItem: (k, v) => store.set(k, v)
        };
        const win = loadPref(storage);
        expect(win.StalemateMusicPref.read()).toBe('on');
        win.StalemateMusicPref.write('off');
        expect(win.StalemateMusicPref.read()).toBe('off');
        expect(store.get('stalemate.music')).toBe('off');
    });

    it('blocks HTMLMediaElement.play when off', async () => {
        const storage = {
            getItem: (k) => store.get(k) ?? null,
            setItem: (k, v) => store.set(k, v)
        };
        const win = loadPref(storage);
        win.StalemateMusicPref.write('off');
        const audio = win.document.createElement('audio');
        await expect(audio.play()).resolves.toBeUndefined();
    });
});

describe('music toggle markup', () => {
    const sitePages = ['index.html', '404.html', 'qr/index.html', 'play/index.html'];

    it('includes a site music toggle on every public surface page', () => {
        for (const relativePath of sitePages) {
            const html = readFileSync(path.join(repoRoot, relativePath), 'utf8');
            expect(html, relativePath).toMatch(/data-music-toggle/);
            expect(html, relativePath).toMatch(/music-preference\.js/);
        }
    });

    it('loads the shared site player on the homepage and play hub', () => {
        expect(readFileSync(path.join(repoRoot, 'index.html'), 'utf8')).toContain('js/site-player.js');
        expect(readFileSync(path.join(repoRoot, 'play/index.html'), 'utf8')).toContain('js/site-player.js');
    });

    it('loads music preference on every vendored play page', () => {
        const playDir = path.join(repoRoot, 'play');
        expect(readFileSync(path.join(playDir, 'VENDORED.txt'), 'utf8')).toContain('Turdanoid');
        for (const name of readdirSync(playDir).filter((n) => n.endsWith('.html'))) {
            const html = readFileSync(path.join(playDir, name), 'utf8');
            expect(html, name).toContain('music-preference.js');
            expect(html, name).toContain('play-music-pref.js');
        }
    });
});
