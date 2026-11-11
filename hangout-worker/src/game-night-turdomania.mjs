import { TurdomaniaDuel, TURDOMANIA_DUEL_VERSION } from '../arcade/games/turdomania-duel.js';
import { createGameNightTable } from './game-night-table.mjs';

export const GameNightTurdomania = createGameNightTable({
    name: 'turdomania',
    version: TURDOMANIA_DUEL_VERSION,
    Match: TurdomaniaDuel,
    sides: ['a', 'b'],
    finished: match => match.deadline === null,
    project: (match, seat, now) => match.view(seat, now)
});
