// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const repo = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const excluded = ['docs', 'pr-assets', 'hangout-worker', 'scripts', 'tests', '.local', '.github', '.git', '.wrangler', '.beta-assets', 'node_modules'];
const marker = 'INTERNAL_PAGES_BOUNDARY_CANARY';

function outputFiles(directory, files = []) {
    for (const name of readdirSync(directory)) {
        const path = join(directory, name);
        const stat = lstatSync(path);
        expect(stat.isSymbolicLink(), 'Pages artifacts must not contain symlinks').toBe(false);
        if (stat.isDirectory()) outputFiles(path, files);
        else {
            expect(stat.isFile()).toBe(true);
            files.push(path);
        }
    }
    return files;
}

it('builds the public Pages artifact without internal paths or their contents', () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'stalemate-pages-boundary-'));
    try {
        // Copy tracked repository inputs, including uncommitted packager edits.
        // Ignored local state and installed dependencies are never read.
        const inputs = new Set(execFileSync('git', ['ls-files', '--cached', '-z'], {
            cwd: repo, encoding: 'utf8', timeout: 10000
        }).split('\0').filter(Boolean));
        for (const input of inputs) {
            const from = resolve(repo, input);
            expect(from.startsWith(repo + sep)).toBe(true);
            if (!existsSync(from)) continue; // Respect a working-tree deletion.
            const stat = lstatSync(from);
            expect(stat.isFile(), 'Only regular tracked inputs may enter this build').toBe(true);
            const to = join(sandbox, input);
            mkdirSync(dirname(to), { recursive: true });
            copyFileSync(from, to);
        }

        // Synthetic canaries exercise each exclusion even on a clean CI checkout.
        for (const prefix of excluded) {
            mkdirSync(join(sandbox, prefix), { recursive: true });
            writeFileSync(join(sandbox, prefix, 'pages-boundary-canary.txt'), `${marker}:${prefix}`);
        }
        writeFileSync(join(sandbox, 'NEEDS_JEFF.md'), `${marker}:owner-prerequisites`);
        // Exercise an existing internal document copied under a public name.
        appendFileSync(join(sandbox, 'docs/HANGOUT_BETA_READINESS.md'), `\n${marker}:readiness-document\n`);

        const build = spawnSync(process.execPath, [join(sandbox, 'scripts/package-pages.cjs')], {
            cwd: sandbox, encoding: 'utf8', timeout: 20000
        });
        expect(build.status, build.stderr).toBe(0);
        const dist = join(sandbox, 'dist');
        const files = outputFiles(dist);
        const paths = files.map((path) => relative(dist, path).split(sep).join('/'));
        expect(paths).toEqual(expect.arrayContaining(['index.html', 'robots.txt', '.nojekyll']));
        expect(paths.some((path) => path.startsWith('play/'))).toBe(true);
        expect(paths.some((path) => path.startsWith('r/') && path.endsWith('/index.html'))).toBe(true);
        expect(paths).not.toContain('NEEDS_JEFF.md');
        for (let index = 0; index < files.length; index += 1) {
            expect(excluded.includes(paths[index].split('/')[0]), paths[index]).toBe(false);
            // Also catch a private input copied under a different public filename.
            expect(readFileSync(files[index]).includes(Buffer.from(marker)), paths[index]).toBe(false);
        }
    } finally {
        rmSync(sandbox, { recursive: true, force: true });
    }
}, 30000);
