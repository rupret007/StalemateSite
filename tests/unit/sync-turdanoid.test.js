// @vitest-environment node
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const sourceRoot = fileURLToPath(new URL('../..', import.meta.url));
const fixtures = [];
afterEach(() => { for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const songs = ['manic.m4a', 'andrea.m4a', 'only-been-18.m4a', 'wham-bam.m4a', 'planet-of-the-flakes.m4a'];

function fixture() {
    const base = mkdtempSync(join(tmpdir(), 'stalemate-sync-test-'));
    fixtures.push(base);
    const root = join(base, 'site');
    const upstream = join(base, 'upstream');
    mkdirSync(join(root, 'scripts/lib'), { recursive: true });
    mkdirSync(join(root, 'scripts/stalemate-overlay'), { recursive: true });
    for (const file of ['scripts/sync-turdanoid.sh', 'scripts/lib/sync-turdanoid.cjs', 'scripts/play-track.js', 'scripts/stalemate-strip.css', 'scripts/chess-stockfish-loader.js']) {
        cpSync(join(sourceRoot, file), join(root, file));
    }
    for (const song of songs) writeFileSync(join(root, 'scripts/stalemate-overlay', song), song);
    for (const file of ['stalemate-overlay.js', 'stalemate-overlay.css']) cpSync(join(sourceRoot, 'scripts/stalemate-overlay', file), join(root, 'scripts/stalemate-overlay', file));
    mkdirSync(join(upstream, 'assets'), { recursive: true });
    mkdirSync(join(upstream, 'games'), { recursive: true });
    const html = '<!doctype html><html><head><meta name="robots" content="index"><meta http-equiv="Content-Security-Policy" content="default-src *"></head><body><h1>First revision</h1></body></html>';
    for (const page of ['index', 'TurdAnoid', 'turdtris', 'turdjack', 'crapeights', 'turdrummy', 'turdspades', 'turdomania', 'chess', 'neon-arkanoid', 'hub']) writeFileSync(join(upstream, `${page}.html`), html);
    writeFileSync(join(upstream, 'index.html'), html.replace('</body>', '<details class="changelog"><summary>Latest Changelog</summary>Private dev notes</details></body>'));
    writeFileSync(join(upstream, 'game.js'), '/* upstream game */');
    writeFileSync(join(upstream, 'favicon.svg'), '<svg/>');
    writeFileSync(join(upstream, 'assets/suite-music.js'), 'export const music = true;');
    writeFileSync(join(upstream, 'games/core.js'), 'export const core = true;');
    writeFileSync(join(upstream, 'games/core.test.js'), 'do not ship');
    mkdirSync(join(upstream, 'assets/chess'), { recursive: true });
    writeFileSync(join(upstream, 'assets/chess/credits.html'), '<a href="../../games/chess-engine.js">UCI client</a>');
    writeFileSync(join(upstream, 'games/chess-engine.js'), "new globalThis.URL('../assets/chess/stockfish-19-lite-single.js', import.meta.url)");
    const git = (...args) => execFileSync('git', args, { cwd: upstream, encoding: 'utf8' }).trim();
    git('init', '--quiet', '-b', 'main');
    git('add', '.');
    git('-c', 'user.name=Arcade test', '-c', 'user.email=arcade-test@example.invalid', 'commit', '--quiet', '-m', 'Fixture');
    const first = git('rev-parse', 'HEAD');
    git('tag', 'release-test');
    return { root, upstream, first, git };
}

function sync(f, ref) {
    return spawnSync('bash', [join(f.root, 'scripts/sync-turdanoid.sh'), '--source', f.upstream, ref], { cwd: f.root, encoding: 'utf8' });
}

function snapshot(root) {
    const files = {};
    function walk(dir, relative = '') {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const name = join(relative, entry.name);
            if (entry.isDirectory()) walk(join(dir, entry.name), name);
            else files[name] = readFileSync(join(dir, entry.name)).toString('base64');
        }
    }
    walk(root);
    return files;
}

describe('committed Turdanoid synchronization', () => {
    it('imports exact SHA, tag and branch reproducibly, discarding uncommitted source edits', () => {
        const f = fixture();
        writeFileSync(join(f.upstream, 'game.js'), '/* second committed revision */');
        f.git('add', '.');
        f.git('-c', 'user.name=Arcade test', '-c', 'user.email=arcade-test@example.invalid', 'commit', '--quiet', '-m', 'Second revision');
        writeFileSync(join(f.upstream, 'game.js'), '/* uncommitted source edit */');
        const result = sync(f, f.first);
        expect(result.status, result.stderr).toBe(0);
        const play = join(f.root, 'play');
        const firstSnapshot = snapshot(play);
        expect(readFileSync(join(play, 'VENDORED.txt'), 'utf8')).toContain(`Turdanoid@${f.first}`);
        expect(readFileSync(join(play, 'game.js'), 'utf8')).toBe('/* upstream game */');
        expect(existsSync(join(play, 'games/core.test.js'))).toBe(false);
        for (const song of songs) expect(readFileSync(join(play, 'assets/stalemate', song), 'utf8')).toBe(song);
        const hub = readFileSync(join(play, 'index.html'), 'utf8');
        expect(hub).not.toMatch(/changelog/i);
        expect(hub.match(/name="robots"/g)).toHaveLength(1);
        expect(hub).toContain('content="index,follow"');
        expect(hub).toContain('<link rel="canonical" href="https://stalemate.band/play/">');
        expect(readFileSync(join(play, 'turdtris.html'), 'utf8')).toContain('content="noindex,nofollow"');
        const chess = readFileSync(join(play, 'chess.html'), 'utf8');
        expect(chess).toContain("worker-src 'self'");
        expect(chess).toContain('stalemate/play-track.js');
        expect(readFileSync(join(play, 'games/chess-engine.js'), 'utf8')).toContain('stockfish-loader.js#stockfish-19-lite-single.wasm');
        expect(readFileSync(join(play, 'assets/chess/stockfish-loader.js'), 'utf8')).toBe(readFileSync(join(sourceRoot, 'scripts/chess-stockfish-loader.js'), 'utf8'));
        expect(readFileSync(join(play, 'assets/chess/credits.html'), 'utf8')).toContain('<a href="stockfish-loader.js">worker delivery loader</a>');
        expect(readFileSync(join(play, 'VENDORED.txt'), 'utf8')).toContain('GPL-3.0-or-later');
        expect(hub.match(/http-equiv="Content-Security-Policy"/g)).toHaveLength(1);
        expect(hub).toContain("default-src 'self'");
        expect(hub).toContain('Stalemate Arcade');
        expect(hub).toContain('https://stalemate.band/play/stalemate/og-play.png');
        expect(readFileSync(join(play, 'TurdAnoid.html'), 'utf8').match(/src="stalemate\/stalemate-overlay.js"/g)).toHaveLength(1);
        for (const ref of [f.first, 'release-test']) {
            const repeated = sync(f, ref);
            expect(repeated.status, repeated.stderr).toBe(0);
            expect(snapshot(play)).toEqual(firstSnapshot);
        }
        const latest = sync(f, 'main');
        expect(latest.status, latest.stderr).toBe(0);
        expect(readFileSync(join(play, 'game.js'), 'utf8')).toBe('/* second committed revision */');
    });

    it('preserves the previous import when ref resolution or transformation fails', () => {
        const f = fixture();
        mkdirSync(join(f.root, 'play'));
        writeFileSync(join(f.root, 'play/keep.txt'), 'existing candidate');
        const before = snapshot(join(f.root, 'play'));
        expect(sync(f, 'missing-ref').status).not.toBe(0);
        expect(snapshot(join(f.root, 'play'))).toEqual(before);
        writeFileSync(join(f.upstream, 'TurdAnoid.html'), '<html>missing head and body</html>');
        f.git('add', '.');
        f.git('-c', 'user.name=Arcade test', '-c', 'user.email=arcade-test@example.invalid', 'commit', '--quiet', '-m', 'Broken upstream');
        expect(sync(f, 'main').status).not.toBe(0);
        expect(snapshot(join(f.root, 'play'))).toEqual(before);
        expect(readdirSync(f.root).some((name) => name.startsWith('.play-sync-'))).toBe(false);
    });
});
