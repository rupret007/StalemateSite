// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(fileURLToPath(new URL('../..', import.meta.url)));

const PUBLIC_COPY = [
    'index.html',
    '404.html',
    'script.js',
    'show-state.js',
    'countdown.js',
    'site-base.js',
    'assets/og.svg',
    'assets/hero-stage.svg',
    'assets/mark.svg'
];

describe('content boundaries', () => {
    it('keeps confirmed facts and finished CTAs without template slots or member names', async () => {
        const home = await readFile(join(repoRoot, 'index.html'), 'utf8');
        const readme = await readFile(join(repoRoot, 'README.md'), 'utf8');
        expect(home).toContain('Better Than Now');
        expect(home).toContain('Manic');
        expect(home).toMatch(/punk rock/i);
        expect(home).toContain('Originals. Punk rock. Live.');
        expect(home).toContain('The songs are ours');
        expect(home).toContain('Stalemate writes the songs');
        expect(home).toContain('Dallas-area punk rock');
        expect(home).not.toMatch(/Lewisville|Flower Mound/);
        expect((home.match(/Dallas-area/g) || []).length).toBe(1);
        expect(home).not.toContain('foundingLocation');
        expect(home).not.toMatch(/Two-tone|two-tone/i);
        expect(home).not.toMatch(/SoCal|Southern California|do not link|other act|Head2Wall/i);
        expect(home).not.toMatch(/Ska \/ punk/i);
        expect(home).not.toMatch(/ska\/punk/i);
        expect(home).not.toMatch(/ticket/i);
        expect(home).toContain('href="#top">Home');
        expect(home).toContain('href="#about">About');
        expect(home).not.toMatch(/href=["'][^"']*(epk|qr)[^"']*["']/i);
        expect(home).not.toMatch(/Press kit|QR landing|>Press</);
        expect(home).toContain('http://rockinoctober.com');
        expect(home).toContain('class="button button--listen"');
        expect(home).toContain('2026-10-24T16:45:00-05:00');
        expect(home).toContain('Rockin’ October');
        expect(home).toContain('Los Amigo’s');
        expect(home).toContain('Festival info');
        expect(home).toContain('assets/manic.mp4');
        expect(home).toContain('Hear it live Oct 24');
        expect(home).toContain('at Los Amigo’s, Plano');
        expect(home).toContain('https://www.instagram.com/stalemate.punk/');
        expect(home).toContain('https://www.youtube.com/@stalemate.punkband');
        expect(home).toContain('https://www.facebook.com/stalemate.band/');
        expect(home).toContain('class="hero-video__player"');
        expect(home).not.toMatch(/\bautoplay\b/);
        expect(home).not.toMatch(/id="(music|video|follow|merch)"/);
        expect(home).not.toContain('data-embed');
        expect(home).not.toContain('<form');
        expect(home).not.toMatch(/\[(DATE\/VENUE|MAILING LIST TOOL|MERCH|BOOKING EMAIL|HANDLE|STREAM LINK|CITY) NEEDED\]/);
        expect(home).not.toMatch(/\bTBA\b|coming soon|\blorem\b|\bplaceholder\b|\byour\b|\benter\b/i);
        expect(home).not.toMatch(/A1\s*·/);
        expect(home).not.toMatch(/E4\s*·/);
        expect(readme).toContain('original songs');
        expect(readme).not.toMatch(/Lewisville|Flower Mound/);
        expect(readme).toContain('Member names and roles');
        expect(readme).not.toMatch(/ticket/i);
        expect(readme).not.toMatch(/\[(MAILING LIST TOOL|MERCH|BOOKING EMAIL|HANDLE) NEEDED\]/);
    });

    it('gives social links a 46px floor so tap targets stay at or above 44px', async () => {
        const css = await readFile(join(repoRoot, 'styles.css'), 'utf8');
        expect(css).toMatch(/\.social-link\s*\{[^}]*min-height:\s*46px/);
        expect(css).toMatch(/\.social-link\s*\{[^}]*min-width:\s*46px/);
    });

    it('never names band members on public surfaces', async () => {
        for (const relativePath of PUBLIC_COPY) {
            const source = await readFile(join(repoRoot, relativePath), 'utf8');
            expect(source, relativePath).not.toMatch(/\bJeff\b/);
            expect(source, relativePath).not.toMatch(/\bChe\b/);
            expect(source, relativePath).not.toMatch(/\bSean\b/);
            expect(source, relativePath).not.toMatch(/JEFF\s*[·•]\s*CHE\s*[·•]\s*SEAN/i);
        }
    });

    it('does not publish press, EPK, or QR pages', async () => {
        const { access } = await import('node:fs/promises');
        for (const relativePath of ['epk/index.html', 'qr/index.html', 'embed-placeholder.html']) {
            await expect(access(join(repoRoot, relativePath))).rejects.toMatchObject({ code: 'ENOENT' });
        }
    });

    it('keeps Lewisville and Flower Mound off every public surface', async () => {
        for (const relativePath of [...PUBLIC_COPY, 'README.md']) {
            const source = await readFile(join(repoRoot, relativePath), 'utf8');
            expect(source, relativePath).not.toMatch(/Lewisville|Flower Mound/);
        }
    });
});
