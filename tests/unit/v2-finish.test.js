// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(fileURLToPath(new URL('../..', import.meta.url)));

describe('v2 signed-band finish', () => {
    it('uses the professional type pairing and a photo hero on the homepage', async () => {
        const home = await readFile(join(repoRoot, 'index.html'), 'utf8');
        const css = await readFile(join(repoRoot, 'styles.css'), 'utf8');
        const lost = await readFile(join(repoRoot, '404.html'), 'utf8');

        expect(home).toContain('Barlow+Condensed');
        expect(home).toContain('Source+Sans+3');
        expect(home).toContain('assets/hero-stage.svg');
        expect(home).toContain('class="hero__media"');
        expect(css).toMatch(/--display:\s*"Barlow Condensed"/);
        expect(css).toMatch(/--body:\s*"Source Sans 3"/);
        expect(lost).toContain('This page is not on the set.');
    });
});
