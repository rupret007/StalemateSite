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
    expect(hub).not.toMatch(/changelog/i);
  });
  it('the first share attempt carries text and a link with the score image', () => {
    const js = readFileSync(join(dir, 'stalemate', 'stalemate-overlay.js'), 'utf8');
    expect(js).toMatch(/files: \[file\], title: 'Turdanoid', text: text, url: url \}/);
    // the link is passed once (url), never also appended to the text
    expect(js).not.toMatch(/text: text \+ ' ' \+ url/);
    expect(js).not.toMatch(/navigator\.share\(\{ files: \[file\] \}\)/);
  });
  it('ships the Stalemate playlist (Manic, Andrea, It\u2019s Only Been 18, Wham Bam, Planet of the Flakes) as small same-origin AAC files, identical to the overlay source', () => {
    const src = join(dir, '..', 'scripts', 'stalemate-overlay');
    for (const f of ['manic.m4a', 'andrea.m4a', 'only-been-18.m4a', 'wham-bam.m4a', 'planet-of-the-flakes.m4a']) {
      const vendored = readFileSync(join(dir, 'stalemate', f));
      expect(vendored.equals(readFileSync(join(src, f)))).toBe(true);
      expect(vendored.subarray(4, 8).toString('latin1')).toBe('ftyp');
      expect(vendored.length).toBeGreaterThan(1_000_000);
      expect(vendored.length).toBeLessThan(3_500_000);
    }
    const js = readFileSync(join(dir, 'stalemate', 'stalemate-overlay.js'), 'utf8');
    expect(js).toBe(readFileSync(join(src, 'stalemate-overlay.js'), 'utf8'));
    const order = ['manic.m4a', 'andrea.m4a', 'only-been-18.m4a', 'wham-bam.m4a', 'planet-of-the-flakes.m4a'].map((f) => js.indexOf(`'stalemate/${f}'`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order); // Manic first
    expect(js).toContain("title: 'It\\u2019s Only Been 18'");
    expect(js).not.toMatch(/Over 18|Been Only/);
  });
  it('hub links seven games including Turdomania', () => {
    const hub = readFileSync(join(dir, 'index.html'), 'utf8');
    expect(hub).toMatch(/Seven games/i);
    expect(hub).toContain('href="turdomania.html"');
    expect(readdirSync(dir)).toContain('turdomania.html');
  });
  it('strip "Listen to Manic" link meets WCAG AA 4.5:1 on the strip background', () => {
    const css = readFileSync(join(dir, 'stalemate-strip.css'), 'utf8');
    const fg = css.match(/\.sm-listen\{color:#([0-9a-f]{6})\}/i)[1];
    const bg = css.match(/\.stalemate-strip\{[^}]*background:#([0-9a-f]{6})/i)[1];
    const lum = (h) => {
      const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
        .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    expect((a + 0.05) / (b + 0.05)).toBeGreaterThanOrEqual(4.5);
  });
});
