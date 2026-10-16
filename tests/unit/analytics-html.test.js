// @vitest-environment node

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(fileURLToPath(new URL('../..', import.meta.url)));
const GC_URL = 'https://stalemate.goatcounter.com/count';

const rootPages = ['index.html', '404.html'];
const playPages = readdirSync(join(repoRoot, 'play')).filter((f) => f.endsWith('.html'));

function expectGoatTag(html, src) {
  expect(html).toContain(`data-goatcounter="${GC_URL}"`);
  expect(html).toContain(`src="${src}"`);
}

describe('GoatCounter script tags on every HTML page', () => {
  for (const f of rootPages) {
    it(`${f} includes count.js and track helpers`, () => {
      const html = readFileSync(join(repoRoot, f), 'utf8');
      expectGoatTag(html, 'js/count.js');
      expect(html).toContain('js/track.js');
      expect(html).toContain('js/site-track.js');
    });
  }

  for (const f of playPages) {
    it(`play/${f} includes vendored analytics scripts`, () => {
      const html = readFileSync(join(repoRoot, 'play', f), 'utf8');
      expectGoatTag(html, '../js/count.js');
      expect(html).toContain('../js/track.js');
      expect(html).toContain('stalemate/play-track.js');
    });
  }
});
