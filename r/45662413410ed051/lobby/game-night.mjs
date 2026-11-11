// Accept only Discord's HTTPS invites and server channel links.
const INVITE = /^https:\/\/(?:discord\.gg\/|discord\.com\/invite\/)[A-Za-z0-9_-]{2,64}$/;
const CHANNEL = /^https:\/\/discord\.com\/channels\/[0-9]{17,20}\/[0-9]{17,20}$/;

export function discordCallLink(value) {
    if (typeof value !== 'string') return '';
    const url = value.trim();
    return INVITE.test(url) || CHANNEL.test(url) ? url : '';
}

// Reserve a generated room-name format so the durable chat record stays
// readable by the previous Worker without a storage migration.
export const gameNightRoomName = name => typeof name === 'string' && /^#game-[a-f0-9]{6}x[a-f0-9]{6}$/.test(name);

export const FOUR_COLUMNS = 7;
export const FOUR_ROWS = 6;
export const fourMark = moves => moves % 2 ? 'O' : 'X';
export const fourFinished = game => !!game.winner || game.moves === FOUR_COLUMNS * FOUR_ROWS;

export function openFour(id, host) {
    return { id, host, guest: '', board: Array(FOUR_COLUMNS * FOUR_ROWS).fill(''),
        moves: 0, winner: '', lastColumn: null };
}

export function dropFour(game, column) {
    if (!game.guest || fourFinished(game) || !Number.isInteger(column) || column < 0 || column >= FOUR_COLUMNS) return null;
    const index = (row, col) => row * FOUR_COLUMNS + col;
    let row = FOUR_ROWS - 1;
    while (row >= 0 && game.board[index(row, column)]) row--;
    if (row < 0) return null;
    const mark = fourMark(game.moves);
    const board = game.board.slice();
    board[index(row, column)] = mark;
    const count = (dr, dc) => {
        let length = 0;
        for (let r = row + dr, c = column + dc; r >= 0 && r < FOUR_ROWS && c >= 0 && c < FOUR_COLUMNS
            && board[index(r, c)] === mark; r += dr, c += dc) length++;
        return length;
    };
    const won = [[0, 1], [1, 0], [1, 1], [1, -1]].some(([dr, dc]) => 1 + count(dr, dc) + count(-dr, -dc) >= 4);
    return { ...game, board, moves: game.moves + 1, winner: won ? mark : '', lastColumn: column };
}
