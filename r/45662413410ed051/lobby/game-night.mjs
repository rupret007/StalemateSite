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

export function fourWinningCells(board, placed) {
    const mark = board[placed];
    if (!mark) return [];
    const row = Math.floor(placed / FOUR_COLUMNS), column = placed % FOUR_COLUMNS;
    const winning = new Set();
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
        const line = [placed];
        for (const direction of [-1, 1]) {
            const dy = dr * direction, dx = dc * direction;
            for (let r = row + dy, c = column + dx; r >= 0 && r < FOUR_ROWS && c >= 0 && c < FOUR_COLUMNS; r += dy, c += dx) {
                const index = r * FOUR_COLUMNS + c;
                if (board[index] !== mark) break;
                line.push(index);
            }
        }
        if (line.length >= 4) for (const index of line) winning.add(index);
    }
    return [...winning];
}

export function dropFour(game, column) {
    if (!game.guest || fourFinished(game) || !Number.isInteger(column) || column < 0 || column >= FOUR_COLUMNS) return null;
    const index = (row, col) => row * FOUR_COLUMNS + col;
    let row = FOUR_ROWS - 1;
    while (row >= 0 && game.board[index(row, column)]) row--;
    if (row < 0) return null;
    const mark = fourMark(game.moves);
    const board = game.board.slice();
    const placed = index(row, column);
    board[placed] = mark;
    const won = fourWinningCells(board, placed).length > 0;
    return { ...game, board, moves: game.moves + 1, winner: won ? mark : '', lastColumn: column };
}
