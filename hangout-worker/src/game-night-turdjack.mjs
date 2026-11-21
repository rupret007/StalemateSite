import { TurdJackMatch, JACK_SEATS, TURDJACK_MATCH_VERSION } from '../arcade/games/turdjack-match.js';
import { createGameNightTable } from './game-night-table.mjs';

export const GameNightTurdJack = createGameNightTable({
    name: 'turdjack',
    version: TURDJACK_MATCH_VERSION,
    Match: TurdJackMatch,
    create: (id, _now, occupied) => new TurdJackMatch(id, occupied),
    sides: JACK_SEATS,
    manualStart: true,
    minSeats: 2,
    finished: match => match.finished,
    project: (match, seat) => match.view(seat)
});
