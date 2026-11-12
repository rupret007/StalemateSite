import { TurdSpadesMatch, SPADES_SEATS, TURDSPADES_MATCH_VERSION } from '../arcade/games/turdspades-match.js';
import { createGameNightTable } from './game-night-table.mjs';

export const GameNightTurdSpades = createGameNightTable({
    name: 'turdspades',
    version: TURDSPADES_MATCH_VERSION,
    Match: TurdSpadesMatch,
    create: id => new TurdSpadesMatch(id),
    sides: SPADES_SEATS,
    finished: match => match.finished,
    project: (match, seat) => match.view(seat)
});
