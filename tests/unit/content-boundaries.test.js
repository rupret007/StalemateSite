// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(fileURLToPath(new URL('../..', import.meta.url)));

const PUBLIC_COPY = [
    'index.html',
    'qr/index.html',
    'epk/index.html',
    '404.html',
    'embed-placeholder.html',
    'script.js',
    'show-state.js',
    'site-base.js',
    'epk/stage-plot.txt',
    'epk/tech-rider.txt',
    'assets/og.svg',
    'assets/hero-stage.svg',
    'assets/mark.svg'
];

function words(text) {
    return text.trim().split(/\s+/).filter(Boolean);
}

describe('content boundaries', () => {
    it('keeps the known originals, ticket actions, and operational tokens without naming members or chess kickers', async () => {
        const home = await readFile(join(repoRoot, 'index.html'), 'utf8');
        const readme = await readFile(join(repoRoot, 'README.md'), 'utf8');
        expect(home).toContain('Better Than Now');
        expect(home).toContain('Manic');
        expect(home).toMatch(/punk rock/i);
        expect(home).toContain('Originals. Two-tone.');
        expect(home).not.toMatch(/Ska \/ punk/i);
        expect(home).not.toMatch(/ska\/punk/i);
        expect(home).toContain('Get tickets');
        expect(home).toContain('class="button button--tickets"');
        expect(home).toContain('class="button button--listen"');
        expect(home).toContain('[DATE/VENUE/TICKET LINK NEEDED]');
        expect(home).toContain('[MAILING LIST TOOL NEEDED]');
        expect(home).toContain('[MERCH NEEDED]');
        expect(home).not.toMatch(/A1\s*·/);
        expect(home).not.toMatch(/E4\s*·/);
        expect(home).not.toContain('[CITY NEEDED');
        expect(readme).toContain('[DATE/VENUE/TICKET LINK NEEDED]');
        expect(readme).toContain('[MAILING LIST TOOL NEEDED]');
        expect(readme).toContain('[MERCH NEEDED]');
        expect(readme).toContain('[BOOKING EMAIL NEEDED]');
        expect(readme).toContain('Member names and roles');
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

    it('keeps the EPK short bio inside 50–75 words and lists press assets', async () => {
        const epk = await readFile(join(repoRoot, 'epk/index.html'), 'utf8');
        const short = epk.match(/<h2 id="short-bio-title">[\s\S]*?<p>([\s\S]*?)<\/p>/)[1];
        const count = words(short.replace(/<[^>]+>/g, '')).length;
        expect(count).toBeGreaterThanOrEqual(50);
        expect(count).toBeLessThanOrEqual(75);
        expect(epk).toContain('Long bio');
        expect(epk).toContain('stage-plot.txt');
        expect(epk).toContain('tech-rider.txt');
        expect(epk).toContain('[BOOKING EMAIL NEEDED]');
    });
});
