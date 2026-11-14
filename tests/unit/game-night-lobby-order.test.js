// @vitest-environment node

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
import { GAME_NIGHT_LOBBY_ORDER, gameNightLabels } from '../../r/45662413410ed051/lobby/game-night.mjs';

const OLD_LOBBY_ORDER = Object.freeze([
    'chess', 'crapeights', 'turdrummy', 'turdspades', 'turdjack', 'turdtris', 'turdomania', 'turdrush', 'turdanoid'
]);

describe('Game Night beta lobby lineup', () => {
    it('puts Chess, TurdSpades, and Turdanoid first', () => {
        expect(GAME_NIGHT_LOBBY_ORDER.slice(0, 3)).toEqual(['chess', 'turdspades', 'turdanoid']);
    });

    it('keeps the remaining games in the previous tail order', () => {
        expect(GAME_NIGHT_LOBBY_ORDER.slice(3)).toEqual(OLD_LOBBY_ORDER.filter(
            game => !['chess', 'turdspades', 'turdanoid'].includes(game)
        ));
    });

    it('rejects the pre-lineup order', () => {
        expect([...GAME_NIGHT_LOBBY_ORDER]).not.toEqual([...OLD_LOBBY_ORDER]);
    });

    it('covers every beta lobby game label and no extras', () => {
        expect(GAME_NIGHT_LOBBY_ORDER).toHaveLength(9);
        expect([...GAME_NIGHT_LOBBY_ORDER].sort()).toEqual(Object.keys(gameNightLabels).sort());
    });

    it('wires lobby.js arcadeTables through GAME_NIGHT_LOBBY_ORDER', () => {
        const lobby = readFileSync(join(repoRoot, 'r/45662413410ed051/lobby/lobby.js'), 'utf8');
        expect(lobby).toContain('GAME_NIGHT_LOBBY_ORDER.map(game => [game, arcadeTableDefs[game]])');
    });
});