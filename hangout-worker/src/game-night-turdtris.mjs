import { TurdtrisMatch, TURDTRIS_MATCH_VERSION } from '../arcade/games/turdtris-match.js';
import { createGameNightTable } from './game-night-table.mjs';

export const GameNightTurdtris = createGameNightTable({
    name: 'turdtris',
    version: TURDTRIS_MATCH_VERSION,
    Match: TurdtrisMatch,
    sides: ['a', 'b'],
    finished: match => match.deadline === null,
    project: (match, seat, now) => match.view(seat, now)
});
