// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import versions from '../../scripts/lib/arcade-asset-versions.cjs';
const { versionArcadeAssets } = versions;
const roots = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'arcade-cache-'));
    roots.push(root);
    const write = (file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text); };
    const read = file => readFileSync(join(root, file), 'utf8');
    const hash = file => createHash('sha256').update(readFileSync(join(root, file))).digest('hex').slice(0, 16);
    write('games/chess-core.js', 'export const revision = 1;');
    write('games/chess-engine.js', "import { revision } from './chess-core.js';");
    write('games/chess-ui.js', "import { revision } from './chess-core.js';\nimport './unchanged-vendor.js';\nimport { engine } from './chess-engine.js';");
    write('assets/suite-share.js', '/* branded share */');
    write('assets/suite-progress.css', '/* progress styles */');
    write('stalemate/stalemate-overlay.js', '/* band links */');
    write('chess.html', '<script type="module" src="games/chess-ui.js"></script><script src="assets/suite-share.js"></script><link rel="stylesheet" href="assets/suite-progress.css"><a href="games/chess-core.js">Source</a><a href="chess.html?mode=local">Play</a><script src="https://cdn.example.test/assets/suite-share.js"></script><script src="assets/chess/chessground.js"></script>');
    return { root, write, read, hash };
}
describe('content-versioned arcade delivery', () => {
    it('keeps one current Core URL through Engine, UI and the HTML entry point without changing unrelated destinations', () => {
        const f = fixture(); versionArcadeAssets(f.root);
        const core = './chess-core.js?v=' + f.hash('games/chess-core.js');
        expect(f.read('games/chess-engine.js')).toContain(core);
        expect(f.read('games/chess-ui.js')).toContain(core);
        expect(f.read('games/chess-ui.js')).toContain('./chess-engine.js?v=' + f.hash('games/chess-engine.js'));
        expect(f.read('chess.html')).toContain('games/chess-ui.js?v=' + f.hash('games/chess-ui.js'));
        expect(f.read('chess.html')).toContain('assets/suite-share.js?v=' + f.hash('assets/suite-share.js'));
        expect(f.read('chess.html')).toContain('assets/suite-progress.css?v=' + f.hash('assets/suite-progress.css'));
        for (const unchanged of ['href="games/chess-core.js"', 'href="chess.html?mode=local"', 'src="https://cdn.example.test/assets/suite-share.js"', 'src="assets/chess/chessground.js"']) expect(f.read('chess.html')).toContain(unchanged);
        expect(f.read('games/chess-ui.js')).toContain("import './unchanged-vendor.js'");
    });
    it('propagates a changed dependency to its parents and regenerates idempotently', () => {
        const f = fixture(); versionArcadeAssets(f.root);
        const before = ['games/chess-engine.js', 'games/chess-ui.js', 'chess.html'].map(f.read);
        f.write('games/chess-core.js', 'export const revision = 2;'); versionArcadeAssets(f.root);
        const after = ['games/chess-engine.js', 'games/chess-ui.js', 'chess.html'].map(f.read);
        after.forEach((text, index) => expect(text).not.toBe(before[index]));
        expect(f.read('games/chess-engine.js')).toContain('./chess-core.js?v=' + f.hash('games/chess-core.js'));
        expect(f.read('games/chess-ui.js')).toContain('./chess-engine.js?v=' + f.hash('games/chess-engine.js'));
        versionArcadeAssets(f.root);
        expect(['games/chess-engine.js', 'games/chess-ui.js', 'chess.html'].map(f.read)).toEqual(after);
    });
    it('versions final branded and site-only bytes while preserving other query values and fragments', () => {
        const f = fixture();
        f.write('index.html', '<script src="stalemate/stalemate-overlay.js?keep=one&amp;v=old#anchor"></script><script src="assets/suite-share.js?keep=two#result"></script>');
        versionArcadeAssets(f.root); const before = f.read('index.html');
        expect(before).toContain('keep=one&amp;v=' + f.hash('stalemate/stalemate-overlay.js') + '#anchor');
        expect(before).toContain('keep=two&amp;v=' + f.hash('assets/suite-share.js') + '#result');
        f.write('stalemate/stalemate-overlay.js', '/* updated links */'); f.write('assets/suite-share.js', '/* Rad Dad blue */'); versionArcadeAssets(f.root);
        expect(f.read('index.html')).not.toBe(before);
        expect(f.read('index.html')).toContain('v=' + f.hash('assets/suite-share.js') + '#result');
    });
    it('allows partial import fixtures without changing or inventing missing resources', () => {
        const f = fixture();
        rmSync(join(f.root, 'games'), { recursive: true });
        f.write('partial.html', '<script src="games/chess-ui.js"></script><script src="unrelated.js"></script>');
        versionArcadeAssets(f.root);
        expect(f.read('partial.html')).toBe('<script src="games/chess-ui.js"></script><script src="unrelated.js"></script>');
    });
    it('invalidates audio leaves through SDK and game parents, including inline imports', () => {
        const f = fixture();
        f.write('assets/suite-sound.js', 'export const sound = 1;');
        f.write('assets/suite-audio.js', "import { sound } from './suite-sound.js';");
        f.write('assets/turdsuite.js', "suiteImport('./suite-audio.js?keep=yes#bank');");
        f.write('games/turdspades-audio.js', 'export const play = 1;');
        f.write('games/turdspades-client.js', "import './turdspades-audio.js';");
        f.write('games/turdrummy-audio-core.js', 'export const player = 1;');
        f.write('games/turdrummy-audio.js', "export { player } from './turdrummy-audio-core.js';");
        f.write('audio.html', '<script src="./assets/turdsuite.js?lang=en&amp;v=old"></script><script type="module">import "./games/turdspades-client.js?keep=one#go"; import("./games/turdrummy-audio.js");</script>');
        versionArcadeAssets(f.root);
        expect(f.read('assets/suite-audio.js')).toContain('./suite-sound.js?v=' + f.hash('assets/suite-sound.js'));
        expect(f.read('assets/turdsuite.js')).toContain('./suite-audio.js?keep=yes&v=' + f.hash('assets/suite-audio.js') + '#bank');
        expect(f.read('audio.html')).toContain('./assets/turdsuite.js?lang=en&amp;v=' + f.hash('assets/turdsuite.js'));
        expect(f.read('audio.html')).toContain('./games/turdspades-client.js?keep=one&v=' + f.hash('games/turdspades-client.js') + '#go');
        expect(f.read('games/turdrummy-audio.js')).toContain('./turdrummy-audio-core.js?v=' + f.hash('games/turdrummy-audio-core.js'));
        const files = ['assets/suite-audio.js', 'assets/turdsuite.js', 'audio.html'];
        const before = files.map(f.read);
        f.write('assets/suite-sound.js', 'export const sound = 2;');
        versionArcadeAssets(f.root);
        const after = files.map(f.read);
        after.forEach((text, index) => expect(text).not.toBe(before[index]));
        versionArcadeAssets(f.root);
        expect(files.map(f.read)).toEqual(after);
    });
    it('rejects versioned import cycles instead of publishing inconsistent hashes', () => {
        const f = fixture();
        f.write('assets/suite-audio.js', "import './suite-sound.js';");
        f.write('assets/suite-sound.js', "import './suite-audio.js';");
        expect(() => versionArcadeAssets(f.root)).toThrow('Cyclic versioned arcade import');
    });
});
