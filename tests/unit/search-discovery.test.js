// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));
describe('arcade search discovery', () => {
    it('gives both hosted copies one crawlable, canonical band arcade destination', () => {
        const document = new JSDOM(readFileSync(join(root, 'play/index.html'), 'utf8')).window.document;
        expect(document.querySelectorAll('meta[name="robots"]')).toHaveLength(1);
        expect(document.querySelector('meta[name="robots"]').content).toBe('index,follow');
        expect(document.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
        expect(document.querySelector('link[rel="canonical"]').href).toBe('https://stalemate.band/play/');
        expect(document.querySelector('meta[name="description"]').content).toMatch(/seven free browser games/i);
        expect(document.querySelector('meta[property="og:url"]').content).toBe('https://stalemate.band/play/');
        expect(document.querySelector('meta[property="og:image"]').content).toBe('https://stalemate.band/play/stalemate/og-play.png');
        expect(document.querySelectorAll('a.game-card')).toHaveLength(7);
    });
    it('lists only the band homepage and hub, leaving all games and legacy pages excluded', () => {
        const xml = readFileSync(join(root, 'sitemap.xml'), 'utf8');
        const doc = new JSDOM(xml, { contentType: 'application/xml' }).window.document;
        expect(doc.documentElement.namespaceURI).toBe('http://www.sitemaps.org/schemas/sitemap/0.9');
        expect([...doc.querySelectorAll('loc')].map(el => el.textContent)).toEqual(['https://stalemate.band/', 'https://stalemate.band/play/']);
        for (const file of readdirSync(join(root, 'play')).filter(file => file.endsWith('.html') && file !== 'index.html')) {
            const html = readFileSync(join(root, 'play', file), 'utf8');
            expect(html, file).toContain('<meta name="robots" content="noindex,nofollow">');
            expect(xml).not.toContain(file);
        }
        const robots = readFileSync(join(root, 'robots.txt'), 'utf8');
        expect(robots).toMatch(/User-agent: \*/);
        expect(robots).toMatch(/Allow: \/\n/);
        expect(robots).not.toMatch(/Disallow:/);
        expect(robots).toContain('Sitemap: https://stalemate.band/sitemap.xml');
    });
});
