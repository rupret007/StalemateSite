// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(fileURLToPath(new URL('../..', import.meta.url)));
const PUBLIC_HTML = [
    'index.html',
    '404.html'
];
const PUBLIC_CLIENT_TEXT = [
    ...PUBLIC_HTML,
    'script.js',
    'show-state.js',
    'countdown.js',
    'site-base.js',
    'styles.css'
];

function targetBlankTags(html) {
    return [...html.matchAll(/<a\b[^>]*\btarget=["']_blank["'][^>]*>/gi)].map((match) => match[0]);
}

describe('public surface security', () => {
    it('never links the other Stalemate band or a guessed Spotify artist', async () => {
        for (const relativePath of PUBLIC_CLIENT_TEXT) {
            const source = await readFile(join(repoRoot, relativePath), 'utf8');
            expect(source, relativePath).not.toContain('4rwTyXLXW0blHBUjQdJmA7');
            expect(source, relativePath).not.toMatch(/open\.spotify\.com/i);
            expect(source, relativePath).not.toContain('/private/');
        }
    });

    it('ships no preview iframes on the finished public pages', async () => {
        for (const relativePath of PUBLIC_HTML) {
            const html = await readFile(join(repoRoot, relativePath), 'utf8');
            const iframes = [...html.matchAll(/<iframe\b[^>]*>/gi)].map((match) => match[0]);
            expect(iframes, relativePath).toEqual([]);
            expect(html, relativePath).not.toMatch(/youtube-nocookie|open\.spotify\.com|apple\.com/i);
            expect(html, relativePath).not.toContain('4rwTyXLXW0blHBUjQdJmA7');
        }
    });

    it('isolates every new-tab link and rejects script or data URLs', async () => {
        for (const relativePath of PUBLIC_HTML) {
            const html = await readFile(join(repoRoot, relativePath), 'utf8');
            expect(html, relativePath).not.toMatch(/href=["']javascript:/i);
            expect(html, relativePath).not.toMatch(/href=["']data:/i);
            for (const tag of targetBlankTags(html)) {
                expect(tag, relativePath).toMatch(/\brel=["'][^"']*noopener[^"']*["']/i);
                expect(tag, relativePath).toMatch(/\brel=["'][^"']*noreferrer[^"']*["']/i);
            }
        }
    });
});
