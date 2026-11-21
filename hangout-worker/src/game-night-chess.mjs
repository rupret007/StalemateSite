import { ChessMatch, CHESS_MATCH_VERSION } from '../arcade/games/chess-match.js';
import { createGameNightTable } from './game-night-table.mjs';

export const GameNightChess = createGameNightTable({
    name: 'chess',
    version: CHESS_MATCH_VERSION,
    Match: ChessMatch,
    sides: ['w', 'b'],
    finished: match => match.deadline === null,
    project: (match, _seat, now) => match.view(now)
});
