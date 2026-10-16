// @vitest-environment node

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { disallowedStreamingUrls } from './streaming-allowlist.js';

const repoRoot = join(fileURLToPath(new URL('../..', import.meta.url)));
const read = (p) => readFileSync(join(repoRoot, p), 'utf8');

describe('QR keychain landing', () => {
    it('/tap/ forwards to /qr/ keeping query and hash, like the Rad Dad sticker flow', () => {
        const html = read('tap/index.html');
        expect(html).toContain('url=../qr/');
        expect(html).toContain("new URL('../qr/'");
        expect(html).toContain('destination.search = window.location.search');
        expect(html).toContain('noindex');
    });

    it('/qr/ cues Manic, links the site and games, and counts a qr-scan event', () => {
        const html = read('qr/index.html');
        expect(html).toContain('src="../play/stalemate/manic.m4a"');
        expect(html).toContain('href="../play/"');
        expect(html).toContain('href="../"');
        expect(html.replace(/<[^>]*>/g, " ")).not.toMatch(/\bska\b/i);
        const js = read('qr/script.js');
        expect(js).toContain("path: 'qr-scan'");
        expect(js).toContain('event: true');
    });

    it('never links the other Stalemate band', () => {
        for (const p of ['qr/index.html', 'qr/script.js', 'tap/index.html']) {
            const src = read(p);
            expect(src, p).not.toContain('4rwTyXLXW0blHBUjQdJmA7');
            expect(disallowedStreamingUrls(src), p).toEqual([]);
            expect(src, p).not.toMatch(/SoCal/);
        }
    });
});
