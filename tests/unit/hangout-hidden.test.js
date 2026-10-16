// @vitest-environment node
// The hangout room must stay hidden: nothing public links to it, it asks not to be indexed,
// robots disallows its prefix, and no preview key is committed.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(fileURLToPath(new URL('../..', import.meta.url)));
const SLUG = '45662413410ed051';
const ROOM = join(repoRoot, 'r', SLUG);
const SKIP = new Set(['node_modules', '.git', 'tests', 'r', 'dist', 'playwright-report', 'test-results', 'hangout-worker', 'pr-assets']);

function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
        if (SKIP.has(name) && dir === repoRoot) continue;
        if (name === 'node_modules') continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.(html|js|cjs|mjs|css|json|xml|txt|webmanifest|svg|md)$/.test(name)) out.push(full);
    }
    return out;
}

describe('hidden hangout room', () => {
    const publicFiles = walk(repoRoot).filter((f) => !f.endsWith('package-lock.json'));

    it('is not linked or named from any public page, script, style or nav', () => {
        expect(publicFiles.length).toBeGreaterThan(5);
        for (const file of publicFiles) {
            const rel = relative(repoRoot, file);
            if (rel === 'robots.txt' || rel === 'scripts/package-pages.cjs' || rel === 'scripts/hangout-relay-dev.mjs') continue;
            const text = readFileSync(file, 'utf8');
            expect(text, rel).not.toContain(SLUG);
            expect(text, rel).not.toMatch(/href=["'][^"']*\/?r\/[0-9a-f]{8,}/i);
            expect(text, rel).not.toMatch(/hang ?out room|data-hangout/i);
        }
    });

    it('robots.txt disallows the /r/ prefix without naming the room', () => {
        const robots = readFileSync(join(repoRoot, 'robots.txt'), 'utf8');
        expect(robots).toMatch(/^User-agent: \*$/m);
        expect(robots).toMatch(/^Disallow: \/r\/$/m);
        expect(robots).not.toContain(SLUG);
        expect(robots).not.toMatch(/sitemap/i);
    });

    it('the room page says noindex, nofollow and sends no referrer', () => {
        const html = readFileSync(join(ROOM, 'index.html'), 'utf8');
        expect(html).toMatch(/<meta name="robots" content="[^"]*noindex[^"]*nofollow[^"]*">/);
        expect(html).toMatch(/<meta name="googlebot" content="noindex, nofollow">/);
        expect(html).toMatch(/<meta name="referrer" content="no-referrer">/);
        expect(html).not.toMatch(/og:|twitter:|canonical/);
    });

    it('never commits a preview key or a relay secret', () => {
        for (const name of readdirSync(ROOM)) {
            const text = readFileSync(join(ROOM, name), 'utf8');
            expect(text, name).not.toMatch(/preview=[A-Za-z0-9_-]{8,}/);
            expect(text, name).not.toMatch(/HANGOUT_PREVIEW_KEY\s*=/);
        }
        const toml = readFileSync(join(repoRoot, 'hangout-worker/wrangler.toml'), 'utf8');
        expect(toml).not.toMatch(/HANGOUT_PREVIEW_KEY\s*=/);
    });

    it('ships robots.txt and the room directory in the Pages package', () => {
        const script = readFileSync(join(repoRoot, 'scripts/package-pages.cjs'), 'utf8');
        expect(script).toContain("'robots.txt'");
        expect(script).toMatch(/const DIRS = \[[^\]]*'r'[^\]]*\]/);
        expect(existsSync(join(repoRoot, 'r', 'index.html'))).toBe(false); // no listing page for /r/
        expect(script).not.toContain(SLUG);
    });
});
