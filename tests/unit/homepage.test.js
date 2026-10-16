import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const htmlPath = path.join(repoRoot, 'index.html');
const scriptPath = path.join(repoRoot, 'script.js');
const rawHtml = fs.readFileSync(htmlPath, 'utf8')
    .replace(/<script\b[^>]*\bsrc=["']script\.js["'][^>]*><\/script>/i, '')
    .replace(/<script\b[^>]*\bsrc=["']show-state\.js["'][^>]*><\/script>/i, '')
    .replace(/<script\b[^>]*\bsrc=["']countdown\.js["'][^>]*><\/script>/i, '')
    .replace(/<script\b[^>]*\bsrc=["']site-base\.js["'][^>]*><\/script>/i, '');
const scriptSource = fs.readFileSync(scriptPath, 'utf8');
const siteBaseSource = fs.readFileSync(path.join(repoRoot, 'site-base.js'), 'utf8');

function loadHomepage({ share, writeText } = {}) {
    const dom = new JSDOM(rawHtml, {
        pretendToBeVisual: true,
        runScripts: 'dangerously',
        url: 'http://127.0.0.1:4320/'
    });
    const { window } = dom;

    if (share !== undefined) {
        Object.defineProperty(window.navigator, 'share', { configurable: true, value: share });
    }
    if (writeText !== undefined) {
        Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText } });
    }

    window.eval(siteBaseSource);
    window.eval(scriptSource);
    window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));

    return { document: window.document, window };
}

async function settle() {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
}

function deferred() {
    let resolve;
    const promise = new Promise((yes) => { resolve = yes; });
    return { promise, resolve };
}

describe('homepage script behavior', () => {
    it('hides a failed logo and creates exactly one fallback across repeated errors', () => {
        const { document, window } = loadHomepage();
        const brand = document.querySelector('.brand');
        const logo = document.getElementById('logo');

        logo.dispatchEvent(new window.Event('error'));
        logo.dispatchEvent(new window.Event('error'));

        const fallbacks = document.querySelectorAll('.logo-fallback');
        expect(logo.hidden).toBe(true);
        expect(fallbacks).toHaveLength(1);
        expect(fallbacks[0].textContent).toBe('STALEMATE');
        expect(brand.contains(fallbacks[0])).toBe(true);
    });

    it('loads a preview iframe only after an explicit tap', () => {
        const { document } = loadHomepage();
        const host = document.querySelector('[data-embed]');
        const button = host.querySelector('[data-load-preview]');

        expect(host.querySelector('iframe')).toBeNull();
        expect(button.hidden).toBe(false);
        button.click();
        expect(host.querySelector('iframe')).toBeTruthy();
        expect(host.querySelector('iframe').getAttribute('src')).toContain('embed-placeholder.html');
        expect(button.hidden).toBe(true);
        button.click();
        expect(host.querySelectorAll('iframe')).toHaveLength(1);
    });
});

describe('share and copy single-flight behavior', () => {
    it('re-enables Copy after a Share click interleaves while Copy is still pending', async () => {
        const pendingCopy = deferred();
        const share = () => Promise.resolve();
        const writeText = () => pendingCopy.promise;
        const { document } = loadHomepage({ share, writeText });
        const shareButton = document.querySelector('[data-share-band]');
        const copyButton = document.querySelector('[data-copy-band]');
        const status = document.querySelector('[data-share-status]');

        copyButton.click();
        expect(copyButton.disabled).toBe(true);
        shareButton.click();
        await settle();
        expect(shareButton.disabled).toBe(true);
        pendingCopy.resolve();
        await settle();
        expect(copyButton.disabled).toBe(false);
        expect(shareButton.disabled).toBe(false);
        expect(status.textContent).toBe('Band website copied.');
    });

    it('does not copy automatically when the native share sheet is canceled', async () => {
        const share = () => Promise.reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' }));
        const writeTextSpy = (...args) => { writeTextSpy.calls.push(args); return Promise.resolve(); };
        writeTextSpy.calls = [];
        const { document } = loadHomepage({ share, writeText: writeTextSpy });
        const shareButton = document.querySelector('[data-share-band]');
        const status = document.querySelector('[data-share-status]');

        shareButton.click();
        await settle();
        expect(writeTextSpy.calls).toHaveLength(0);
        expect(status.textContent).toMatch(/cancel/i);
        expect(shareButton.disabled).toBe(false);
    });
});
