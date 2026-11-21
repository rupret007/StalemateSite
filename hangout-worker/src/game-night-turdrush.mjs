import { TurdRushRace, TURD_RUSH_RACE_VERSION } from '../arcade/games/turdrush-race.js';
import { createGameNightTable } from './game-night-table.mjs';

export const GameNightTurdRush = createGameNightTable({
    name: 'turdrush',
    version: TURD_RUSH_RACE_VERSION,
    Match: TurdRushRace,
    sides: ['a', 'b'],
    finished: match => match.deadline === null,
    project: (match, seat, now) => match.view(seat, now)
});
