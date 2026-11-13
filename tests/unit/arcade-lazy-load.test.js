import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const lobby = name => readFileSync(path.join(root, 'r/45662413410ed051/lobby', name), 'utf8');

function staticImport(source, specifier) {
    const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^import\\s+(?:[^'"\n]+from\\s+)?['"]${escaped}['"]`, 'm').test(source);
}

describe('Game Night loads another game’s engine only after that game opens', () => {
    it('keeps chess, Turd Rush, and Turdanoid engines off the module graph', () => {
        const chess = lobby('arcade-chess.mjs');
        expect(staticImport(chess, '/play/games/chess-core.js')).toBe(false);
        expect(staticImport(chess, '/play/games/chess-board.js')).toBe(false);
        expect(chess).toContain("import('/play/games/chess-core.js')");
        expect(chess).toContain("import('/play/games/chess-board.js')");
        expect(chess).toContain('ready: () => loadChessAssets()');

        const rush = lobby('arcade-turdrush.mjs');
        expect(staticImport(rush, '/play/games/turdrush-renderer.js')).toBe(false);
        expect(staticImport(rush, '/play/games/turdrush-race.js')).toBe(false);
        expect(staticImport(rush, '/play/games/turdrush-core.js')).toBe(false);
        expect(rush).toContain("import('/play/games/turdrush-renderer.js')");
        expect(rush).toContain("import('/play/games/turdrush-race.js')");

        const brick = lobby('arcade-turdanoid.mjs');
        expect(staticImport(brick, '/play/games/turdanoid-sprites-core.js')).toBe(false);
        expect(staticImport(brick, '/play/games/turdanoid-race.js')).toBe(false);
        expect(brick).toContain("import('/play/games/turdanoid-sprites-core.js')");
        expect(brick).toContain("import('/play/games/turdanoid-race.js')");
    });

    it('fetches Turd Rush physics from the same versioned address as the race module', () => {
        const race = readFileSync(path.join(root, 'play/games/turdrush-race.js'), 'utf8');
        const versioned = race.match(/turdrush-core\.js\?v=[0-9a-f]+/)?.[0];
        expect(versioned).toBeTruthy();
        const rush = lobby('arcade-turdrush.mjs');
        expect(rush).toContain(`/play/games/${versioned}`);
        expect(rush).not.toContain("import('/play/games/turdrush-core.js')");
    });

    it('leaves Spades, Turdtris, Turdomania, and TurdRummy engines for their own panels', () => {
        const specs = [
            ['arcade-turdspades.mjs', '/play/games/turdspades-engine.js'],
            ['arcade-turdtris.mjs', '/play/games/turdtris-sprint.js'],
            ['arcade-turdomania.mjs', '/play/games/turdomania-core.js'],
            ['arcade-turdrummy.mjs', '/play/games/turdrummy-rules.js']
        ];
        for (const [file, specifier] of specs) {
            const source = lobby(file);
            expect(staticImport(source, specifier)).toBe(false);
            expect(source).toContain(`import('${specifier}')`);
        }
    });
});
