// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { disallowedStreamingUrls, disallowedEmbedAttributes } from './streaming-allowlist.js';

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
            expect(disallowedStreamingUrls(source), relativePath).toEqual([]);
            expect(source, relativePath).not.toContain('/private/');
        }
    });

    it('ships no preview iframes on the finished public pages', async () => {
        for (const relativePath of PUBLIC_HTML) {
            const html = await readFile(join(repoRoot, relativePath), 'utf8');
            const iframes = [...html.matchAll(/<iframe\b[^>]*>/gi)].map((match) => match[0]);
            expect(iframes, relativePath).toEqual([]);
            expect(html, relativePath).not.toMatch(/youtube-nocookie/i);
            expect(disallowedStreamingUrls(html), relativePath).toEqual([]);
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

    it('allowlist still rejects the other band, stray apple.com URLs and unknown Spotify IDs', () => {
        expect(disallowedStreamingUrls('<a href="https://open.spotify.com/artist/4rwTyXLXW0blHBUjQdJmA7">x</a>')).not.toEqual([]);
        expect(disallowedStreamingUrls('<a href="https://open.spotify.com/artist/0000000000000000000000">x</a>')).not.toEqual([]);
        expect(disallowedStreamingUrls('<a href="https://open.spotify.com/track/1j60Wu27zoYlmkd7wrgAe9">x</a>')).not.toEqual([]);
        expect(disallowedStreamingUrls('<a href="https://www.apple.com/iphone/">x</a>')).not.toEqual([]);
        expect(disallowedStreamingUrls('<a href="https://music.apple.com/us/artist/stalemate/999">x</a>')).not.toEqual([]);
        expect(disallowedStreamingUrls('<iframe src="https://embed.music.apple.com/us/album/other/123"></iframe>')).not.toEqual([]);
        expect(disallowedStreamingUrls('see music.apple.com/us/album/x/1')).not.toEqual([]);
        expect(disallowedStreamingUrls('<a href="https://open.spotify.com/artist/5cZqYe3bDw3xcKIk4aPHNH">ok</a>')).toEqual([]);
        expect(disallowedEmbedAttributes('<div data-embed="x"></div>')).not.toEqual([]);
        expect(disallowedEmbedAttributes('<button data-listen-load data-embed-src="https://embed.music.apple.com/us/album/other/1">x</button>')).not.toEqual([]);
        expect(disallowedEmbedAttributes('<button data-embed-src="https://embed.music.apple.com/us/album/andrea/1718463871?i=1718463872">x</button>')).not.toEqual([]);
        expect(disallowedEmbedAttributes('<button data-listen-load data-embed-src="https://embed.music.apple.com/us/album/andrea/1718463871?i=1718463872">x</button>')).toEqual([]);
    });
});
