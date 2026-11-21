import { CrapeightsMatch, CRAPEIGHTS_MATCH_VERSION } from '../arcade/games/crapeights-match.js';
import { createGameNightTable } from './game-night-table.mjs';

export const GameNightCrapeights = createGameNightTable({
    name: 'crapeights',
    version: CRAPEIGHTS_MATCH_VERSION,
    Match: CrapeightsMatch,
    create: id => new CrapeightsMatch(id),
    sides: ['a', 'b'],
    finished: match => match.finished,
    project: (match, seat) => match.view(seat)
});
