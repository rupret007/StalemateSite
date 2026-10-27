// @vitest-environment node

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
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
  expect(policy).toContain("worker-src 'self'");
  expect(policy).toContain(`img-src 'self' data: blob: ${ALLOWED_EXTERNAL}`);
  expect(policy).not.toMatch(/http:/);
  expect(policy).not.toMatch(/\*/);
}

describe('vendored /play/ copy', () => {
  it('retains pinned chess vendors, piece art and both matching public GPL source archives', () => {
    const assets = join(dir, 'assets/chess');
    for (const lock of ['vendor-lock.json', 'board-vendor-lock.json']) {
      const pinned = JSON.parse(readFileSync(join(assets, lock), 'utf8'));
      const files = pinned.files || Object.fromEntries(Object.entries(pinned).filter(([, value]) => value.sha256));
      for (const [file, expected] of Object.entries(files)) {
        const bytes = readFileSync(join(assets, file));
        expect(createHash('sha256').update(bytes).digest('hex'), file).toBe(expected.sha256);
      }
    }
    for (const archive of ['stockfish-19.0.1-source.tar.gz', 'chessground-10.5.0-source.tar.gz']) {
      expect(readFileSync(join(assets, archive)).subarray(0, 2).toString('hex')).toBe('1f8b');
      expect(readFileSync(join(assets, 'credits.html'), 'utf8')).toContain(archive);
    }
  });
  it('has pages to check', () => expect(pages.length).toBeGreaterThanOrEqual(9));
  for (const f of pages) {
    const html = readFileSync(join(dir, f), 'utf8');
    it(`${f} has the intended indexing policy, one robots meta and strict CSP`, () => {
      expect(html.match(/<meta name="robots"/g)).toHaveLength(1);
      expect(html).toContain(`<meta name="robots" content="${f === 'index.html' ? 'index,follow' : 'noindex,nofollow'}">`);
      const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/);
      expect(csp).not.toBeNull();
      assertPlayCsp(csp[1]);
    });
  }
  it('hub ships without the upstream Latest Changelog dev notes', () => {
    const hub = readFileSync(join(dir, 'index.html'), 'utf8');
    expect(hub).not.toMatch(/changelog/i);
  });
  it('ships the Stalemate playlist (Manic, Andrea, It\u2019s Only Been 18, Wham Bam, Planet of the Flakes) as small same-origin AAC files, identical to the overlay source', () => {
    const src = join(dir, '..', 'scripts', 'stalemate-overlay');
    for (const f of ['manic.m4a', 'andrea.m4a', 'only-been-18.m4a', 'wham-bam.m4a', 'planet-of-the-flakes.m4a']) {
      const vendored = readFileSync(join(dir, 'stalemate', f));
      expect(vendored.equals(readFileSync(join(src, f)))).toBe(true);
      expect(readFileSync(join(dir, 'assets', 'stalemate', f)).equals(vendored)).toBe(true);
      expect(vendored.subarray(4, 8).toString('latin1')).toBe('ftyp');
      expect(vendored.length).toBeGreaterThan(1_000_000);
      expect(vendored.length).toBeLessThan(3_500_000);
    }
    const js = readFileSync(join(dir, 'stalemate', 'stalemate-overlay.js'), 'utf8');
    expect(js).toBe(readFileSync(join(src, 'stalemate-overlay.js'), 'utf8'));
    expect(js).not.toMatch(/new Audio\(|trackForLevel/);
    const music = readFileSync(join(dir, 'assets', 'suite-music.js'), 'utf8');
    const order = ['manic.m4a', 'andrea.m4a', 'only-been-18.m4a', 'wham-bam.m4a', 'planet-of-the-flakes.m4a'].map((f) => music.indexOf(`'stalemate/${f}'`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order); // Manic first
    expect(music).toContain("'It\\u2019s Only Been 18'");
    expect(music).not.toMatch(/Over 18|Been Only/);
  });
  it('hub links nine games including chess and Turdomania', () => {
    const hub = readFileSync(join(dir, 'index.html'), 'utf8');
    expect(hub).toMatch(/Nine games/i);
    expect(hub).toContain('href="turdomania.html"');
    expect(readdirSync(dir)).toContain('turdomania.html');
    expect(hub).toContain('href="chess.html"');
    expect(readdirSync(dir)).toContain('chess.html');
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
