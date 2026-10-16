// @vitest-environment node

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = join(fileURLToPath(new URL('../..', import.meta.url)), 'play');
const pages = readdirSync(dir).filter((f) => f.endsWith('.html'));

describe('vendored /play/ copy', () => {
  it('has pages to check', () => expect(pages.length).toBeGreaterThanOrEqual(9));
  for (const f of pages) {
    const html = readFileSync(join(dir, f), 'utf8');
    it(`${f} is noindex with exactly one robots meta and a same-origin CSP`, () => {
      expect(html.match(/<meta name="robots"/g)).toHaveLength(1);
      const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/);
      expect(csp).not.toBeNull();
      expect(csp[1]).toContain("default-src 'self'");
      expect(csp[1]).toContain("object-src 'none'");
      expect(csp[1]).not.toMatch(/https?:|\*/);
    });
  }
  it('hub ships without the upstream Latest Changelog dev notes', () => {
    const hub = readFileSync(join(dir, 'index.html'), 'utf8');
    expect(hub).not.toMatch(/<details class="changelog"|Latest Changelog/);
  });
  it('the first share attempt carries text and a link with the score image', () => {
    const js = readFileSync(join(dir, 'stalemate', 'stalemate-overlay.js'), 'utf8');
    expect(js).toMatch(/files: \[file\], title: 'Turdanoid', text: text \+ ' ' \+ url, url: url/);
    expect(js).not.toMatch(/navigator\.share\(\{ files: \[file\] \}\)/);
  });
});
