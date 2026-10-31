// @vitest-environment node

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const PUBLIC_HTML = ['index.html', '404.html', 'qr/index.html', 'tap/index.html', 'play/index.html'];

function listenButtons(doc) {
    return [...doc.querySelectorAll('button, a')].filter((el) => {
        const text = (el.textContent || '').trim();
        const label = (el.getAttribute('aria-label') || '').toLowerCase();
        return /listen|play/i.test(text) || /listen|play/.test(label);
    });
}

describe('listen/play controls never point at YouTube', () => {
    for (const relative of PUBLIC_HTML) {
        it(relative, () => {
            const html = readFileSync(path.join(repoRoot, relative), 'utf8');
            const doc = new JSDOM(html).window.document;
            for (const el of listenButtons(doc)) {
                const href = el.getAttribute('href') || '';
                expect(href, `${relative} ${el.outerHTML.slice(0, 120)}`).not.toMatch(/youtube\.com|youtu\.be/i);
            }
            expect(html).not.toMatch(/data-listen-load/);
        });
    }

    it('play hub strip uses on-site play for Manic', () => {
        const html = readFileSync(path.join(repoRoot, 'play/index.html'), 'utf8');
        expect(html).toMatch(/data-site-play="manic"/);
        expect(html).not.toMatch(/sm-listen[^>]*href="https:\/\/www\.youtube\.com/);
    });
});
