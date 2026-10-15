// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(fileURLToPath(new URL('../..', import.meta.url)));

function words(text) {
    return text.trim().split(/\s+/).filter(Boolean);
}

describe('content boundaries', () => {
    it('names the known members and originals, and marks every unknown as a placeholder', async () => {
        const home = await readFile(join(repoRoot, 'index.html'), 'utf8');
        expect(home).toContain('Better Than Now');
        expect(home).toContain('Manic');
        expect(home).toMatch(/<dt>Jeff<\/dt>/);
        expect(home).toMatch(/<dt>Che<\/dt>/);
        expect(home).toMatch(/<dt>Sean<\/dt>/);
        expect(home).toContain('Drums');
        expect(home).toContain('Bass');
        expect(home).toContain('Guitar / vocals [CONFIRM]');
        expect(home).toContain('[DATE/VENUE/TICKET LINK NEEDED]');
        expect(home).toContain('[MAILING LIST TOOL NEEDED]');
        expect(home).toContain('[MERCH NEEDED]');
        expect(home).toContain('Get tickets');
        expect(home).toContain('class="button button--tickets"');
        expect(home).toContain('class="button button--listen"');
        expect(home).toContain('A1 · Music');
        expect(home).toContain('E4 · Shows');
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
