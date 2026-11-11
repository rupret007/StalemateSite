import { TurdRummyMatch, TURDRUMMY_MATCH_VERSION } from '../arcade/games/turdrummy-match.js';
import { createGameNightTable } from './game-night-table.mjs';

export const GameNightTurdRummy = createGameNightTable({
    name: 'turdrummy',
    version: TURDRUMMY_MATCH_VERSION,
    Match: TurdRummyMatch,
    create: id => new TurdRummyMatch(id),
    sides: ['a', 'b'],
    finished: match => match.finished,
    project: (match, seat) => match.view(seat)
});
