import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = readFileSync(path.join(repoRoot, 'site-base.js'), 'utf8');

function loadSite() {
    const scope = {};
    const fn = new Function('globalThis', `${source}\nreturn globalThis.StalemateSite;`);
    return fn(scope);
}

describe('site base path', () => {
    it('keeps the GitHub Pages project path and can collapse to a root domain', () => {
        const site = loadSite();

        expect(site.PROJECT_BASE).toBe('/StalemateSite/');
        expect(site.detectBase('/StalemateSite/')).toBe('/StalemateSite/');
        expect(site.detectBase('/StalemateSite/qr/')).toBe('/StalemateSite/');
        expect(site.detectBase('/qr/')).toBe('/');
        expect(site.detectBase('/')).toBe('/');
        expect(site.normalizeBase('/')).toBe('/');
        expect(site.join('/StalemateSite/', 'styles.css')).toBe('/StalemateSite/styles.css');
        expect(site.join('/', 'styles.css')).toBe('/styles.css');
        expect(site.publicUrl()).toBe('https://rupret007.github.io/StalemateSite/');
    });
});
