// @vitest-environment node

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = join(fileURLToPath(new URL('../..', import.meta.url)), 'play');
const pages = readdirSync(dir).filter((f) => f.endsWith('.html'));
const ALLOWED_EXTERNAL = 'https://stalemate.goatcounter.com';

function assertPlayCsp(policy) {
  expect(policy).toContain("default-src 'self'");
  expect(policy).toContain("object-src 'none'");
  expect(policy).toMatch(/script-src 'self' 'unsafe-inline'/);
  const scriptSrc = policy.match(/script-src ([^;]+)/)[1];
  expect(scriptSrc.trim()).toBe("'self' 'unsafe-inline'");
  const external = [...policy.matchAll(/https:\/\/[^\s;]+/g)].map((m) => m[0]);
  for (const origin of external) {
    expect(origin).toBe(ALLOWED_EXTERNAL);
  }
  expect(policy).toContain(`connect-src 'self' ${ALLOWED_EXTERNAL}`);
  expect(policy).toContain(`img-src 'self' data: blob: ${ALLOWED_EXTERNAL}`);
  expect(policy).not.toMatch(/\*/);
}

describe('vendored /play/ copy', () => {
  it('has pages to check', () => expect(pages.length).toBeGreaterThanOrEqual(9));
  for (const f of pages) {
    const html = readFileSync(join(dir, f), 'utf8');
    it(`${f} is noindex with exactly one robots meta and a strict CSP allowlist`, () => {
      expect(html.match(/<meta name="robots"/g)).toHaveLength(1);
      const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/);
      expect(csp).not.toBeNull();
      assertPlayCsp(csp[1]);
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
