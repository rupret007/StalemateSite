// @vitest-environment node

import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));
const guard = await readFile(join(root, '.htaccess'), 'utf8');
const directives = guard.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
const rules = directives.map(line => {
    const match = line.match(/^RedirectMatch 404 "\(\?i\)(.+)"$/);
    if (!match) throw new Error(`Unexpected Apache directive: ${line}`);
    return new RegExp(match[1], 'i');
});
const blocked = path => rules.some(rule => rule.test(decodeURIComponent(new URL(path, 'https://fixture.invalid').pathname)));
const packager = await readFile(join(root, 'scripts/package-pages.cjs'), 'utf8');
function packageList(name) {
    const declaration = packager.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
    if (!declaration) throw new Error(`Missing ${name} package allowlist`);
    return [...declaration[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
}

async function descendants(relativePath) {
    const entries = await readdir(join(root, relativePath), { withFileTypes: true });
    const nested = await Promise.all(entries.map(entry => entry.isDirectory()
        ? descendants(`${relativePath}/${entry.name}`)
        : [`${relativePath}/${entry.name}`]));
    return nested.flat();
}

describe('Apache repository-root public boundary', () => {
    it.each([
        '/README.md', '/package.json', '/package-lock.json',
        '/scripts/package-pages.cjs', '/tests/e2e/homepage.spec.js',
        '/.git/HEAD', '/.github/workflows/ci.yml', '/.openai/hosting.json',
        '/.env', '/.env.local', '/node_modules/', '/docs/chess-integration.md',
        '/GPT/', '/backup_restore_point/', '/pr-assets/screenshot.png',
        '/dist/index.html', '/preview-dist/index.html', '/test-results/index.html',
        '/playwright-report/index.html', '/playwright.live.config.js',
        '/vitest.config.js', '/.gitignore', '/%70ackage.json'
    ])('returns a missing response for source/config path %s at root and project paths', path => {
        expect(blocked(path), path).toBe(true);
        expect(blocked(`/StalemateSite${path}?source=fixture`), path).toBe(true);
        expect(blocked(path.toUpperCase()), path).toBe(true);
    });

    it('leaves every file in the actual Pages package allowlist reachable', async () => {
        const files = [...packageList('FILES'), ...(await Promise.all(packageList('DIRS').map(descendants))).flat()];
        expect(files.length).toBeGreaterThan(200);
        for (const file of files) {
            expect(blocked(`/${file}`), file).toBe(false);
            expect(blocked(`/StalemateSite/${file}`), file).toBe(false);
        }
        for (const source of ['play/assets/chess/stockfish-19.0.1-source.tar.gz', 'play/assets/chess/chessground-10.5.0-source.tar.gz']) {
            expect(files, 'GPL corresponding sources remain packaged').toContain(source);
        }
    });

    it('denies every tracked non-public root entry so new source files cannot silently become public', () => {
        const tracked = spawnSync('git', ['ls-files', '--cached'], { cwd: root, encoding: 'utf8' });
        expect(tracked.status, tracked.stderr).toBe(0);
        const publicRoots = new Set([...packageList('FILES'), ...packageList('DIRS')].map(file => file.split('/')[0]));
        const sourceRoots = new Set(tracked.stdout.trim().split('\n').map(file => file.split('/')[0]).filter(entry => !publicRoots.has(entry)));
        expect(sourceRoots.size).toBeGreaterThan(10);
        for (const entry of sourceRoots) {
            expect(blocked(`/${entry}`), entry).toBe(true);
            expect(blocked(`/StalemateSite/${entry}`), entry).toBe(true);
        }
    });

    it.each([
        '/', '/index.html', '/qr/', '/tap/', '/play/', '/play/chess.html',
        '/play/assets/chess/credits.html', '/play/assets/chess/Chessground-LICENSE.txt',
        '/play/stalemate/manic.m4a', '/assets/manic.mp4',
        '/.well-known/acme-challenge/fixture', '/scripts-night/', '/docs-show/',
        '/package.json-cover.png', '/events/stalemate-rockin-october-2026.ics'
    ])('keeps public media, licensing, aliases and neighboring names available: %s', path => {
        expect(blocked(path), path).toBe(false);
        expect(blocked(`/StalemateSite${path}`), path).toBe(false);
    });
});
