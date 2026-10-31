// @vitest-environment node

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(fileURLToPath(new URL('../..', import.meta.url)));

describe('GitHub Pages package', () => {
    it('copies only the public site and never ships tests or node_modules', () => {
        const script = readFileSync(join(repoRoot, 'scripts/package-pages.cjs'), 'utf8');
        expect(script).toContain('index.html');
        expect(script).toContain('404.html');
        expect(script).toContain("'qr', 'tap'");
        expect(script).not.toContain('epk/index.html');
        expect(script).not.toContain('embed-placeholder.html');
        expect(script).toContain('.nojekyll');
        expect(script).toContain('countdown.js');
        expect(script).toContain('js/count.js');
        expect(script).toContain('js/track.js');
        expect(script).toContain('js/site-track.js');
        expect(script).toContain('js/music-preference.js');
        expect(script).toContain('js/site-player.js');
        expect(script).toContain('assets/hero-stage.svg');
        expect(script).toContain('assets/manic.mp4');
        expect(script).toContain('assets/og.png');
        expect(script).toContain('assets/manic-poster.jpg');
        expect(script).toContain('assets/icon-instagram.svg');
        expect(script).toContain('assets/icon-youtube.svg');
        expect(script).toContain('assets/icon-facebook.svg');
        expect(script).not.toContain('node_modules');
        expect(script).not.toContain('tests/');
        expect(script).not.toContain('worker/');
    });

    it('can package into dist/ from this checkout', () => {
        const result = spawnSync(process.execPath, [join(repoRoot, 'scripts/package-pages.cjs')], {
            cwd: repoRoot,
            encoding: 'utf8'
        });
        expect(result.status, result.stderr).toBe(0);
        expect(readFileSync(join(repoRoot, 'dist/index.html'), 'utf8')).toContain('Stalemate');
        for (const file of ['robots.txt', 'sitemap.xml', 'events/stalemate-rockin-october-2026.ics']) {
            expect(readFileSync(join(repoRoot, 'dist', file), 'utf8')).toBe(readFileSync(join(repoRoot, file), 'utf8'));
        }
        expect(readFileSync(join(repoRoot, 'dist/.nojekyll'), 'utf8')).toBeDefined();
        expect(existsSync(join(repoRoot, 'dist/epk'))).toBe(false);
        expect(readFileSync(join(repoRoot, 'dist/qr/index.html'), 'utf8')).toContain('play/stalemate/manic.m4a');
        expect(readFileSync(join(repoRoot, 'dist/tap/index.html'), 'utf8')).toContain('../qr/');
        expect(existsSync(join(repoRoot, 'dist/embed-placeholder.html'))).toBe(false);
        rmSync(join(repoRoot, 'dist'), { recursive: true, force: true });
        expect(mkdtempSync(join(tmpdir(), 'stalemate-'))).toBeTruthy();
    });

    it('omits SoCal from the built HTML', () => {
        const result = spawnSync(process.execPath, [join(repoRoot, 'scripts/package-pages.cjs')], {
            cwd: repoRoot,
            encoding: 'utf8'
        });
        expect(result.status, result.stderr).toBe(0);
        for (const relativePath of ['index.html', '404.html']) {
            const html = readFileSync(join(repoRoot, 'dist', relativePath), 'utf8');
            expect(html, relativePath).not.toMatch(/SoCal/);
            expect(html, relativePath).not.toMatch(/Lewisville|Flower Mound/);
        }
        rmSync(join(repoRoot, 'dist'), { recursive: true, force: true });
    });

    it('packages the game screenshots referenced by the homepage', () => {
        const result = spawnSync(process.execPath, [join(repoRoot, 'scripts/package-pages.cjs')], {
            cwd: repoRoot,
            encoding: 'utf8'
        });
        try {
            expect(result.status, result.stderr).toBe(0);
            const html = readFileSync(join(repoRoot, 'dist/index.html'), 'utf8');
            const screenshots = [...html.matchAll(/<img\b[^>]*\bsrc="(assets\/games\/[^"]+)"/g)]
                .map((match) => match[1]);
            expect(screenshots).toHaveLength(2);
            for (const screenshot of screenshots) {
                const packagedPath = join(repoRoot, 'dist', screenshot);
                expect(existsSync(packagedPath), screenshot).toBe(true);
                expect(readFileSync(packagedPath)).toEqual(readFileSync(join(repoRoot, screenshot)));
            }
        } finally {
            rmSync(join(repoRoot, 'dist'), { recursive: true, force: true });
        }
    });
});
