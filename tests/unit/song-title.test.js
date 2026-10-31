// @vitest-environment node

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CANONICAL = 'It\u2019s Only Been 18';

const BANNED = [
    /\bIt['\u2019]s Been Only 18\b/,
    /\bBeen Only 18\b/,
    /\bOver 18\b/,
    /\bIt['\u2019]s Only Been\s*(?!18\b)\d+/
];

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'pr-assets', 'tests']);
const TEXT_EXT = new Set([
    '.html', '.js', '.css', '.md', '.json', '.cjs', '.mjs', '.sh', '.txt', '.svg'
]);

function walk(dir, out) {
    for (const name of readdirSync(dir)) {
        if (SKIP_DIRS.has(name)) continue;
        const full = path.join(dir, name);
        const st = statSync(full);
        if (st.isDirectory()) {
            walk(full, out);
            continue;
        }
        const ext = path.extname(name).toLowerCase();
        if (!TEXT_EXT.has(ext)) continue;
        if (name.endsWith('.m4a') || name.endsWith('.mp4') || name.endsWith('.webp') || name.endsWith('.png')) continue;
        out.push(path.relative(repoRoot, full));
    }
}

function stripAllowedSlugs(text) {
    return text
        .replace(/its-been-only-18/gi, '')
        .replace(/only-been-18/gi, '')
        .replace(/album\/its-been-only-18/gi, '');
}

describe('song title: It\u2019s Only Been 18', () => {
    const files = [];
    walk(repoRoot, files);

    it('uses the canonical title in site-player and suite music', () => {
        const player = readFileSync(path.join(repoRoot, 'js/site-player.js'), 'utf8');
        const suiteMusic = readFileSync(path.join(repoRoot, 'play/assets/suite-music.js'), 'utf8');
        expect(player).toContain("It\\u2019s Only Been 18");
        expect(suiteMusic).toContain("It\\u2019s Only Been 18");
    });

    it('has no banned variants in repo text/metadata', () => {
        const hits = [];
        for (const relative of files) {
            const raw = readFileSync(path.join(repoRoot, relative), 'utf8');
            const text = stripAllowedSlugs(raw);
            for (const pattern of BANNED) {
                if (pattern.test(text)) {
                    hits.push(`${relative}: ${pattern}`);
                }
            }
        }
        expect(hits).toEqual([]);
    });
});
