import { TurdanoidBrickRace, TURDANOID_RACE_VERSION } from '../arcade/games/turdanoid-race.js';
import { createGameNightTable } from './game-night-table.mjs';

export const GameNightTurdanoid = createGameNightTable({
    name: 'turdanoid',
    version: TURDANOID_RACE_VERSION,
    Match: TurdanoidBrickRace,
    sides: ['a', 'b'],
    finished: match => match.deadline === null,
    project: (match, seat, now) => match.view(seat, now)
});
