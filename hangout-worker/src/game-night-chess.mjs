import { ChessMatch, CHESS_MATCH_VERSION } from '../arcade/games/chess-match.js';

// Room admission supplies server-owned subjects. This state never decides who
// can enter a room or see its board. The lobby must authorize each operation,
// including a read, and serialize membership changes with match changes.
export class GameNightChess {
    #seats;
    #match = null;
    #rematch = null;
    #id;

    constructor(id, host) {
        if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{5,80}$/.test(id) ||
            typeof host !== 'string' || !host) throw new TypeError('Invalid match or seat identity');
        this.#id = id;
        this.#seats = { w: host, b: null };
    }

    static restore(record) {
        if (record?.version !== CHESS_MATCH_VERSION || !record.seats) throw new TypeError('Invalid room match checkpoint');
        const game = new GameNightChess(record.id, record.seats.w);
        if (record.match) {
            if (record.match.id !== record.id || typeof record.seats.b !== 'string' ||
                !record.seats.b || record.seats.b === record.seats.w) throw new TypeError('Invalid match seats');
            game.#match = ChessMatch.restore(record.match);
            game.#seats.b = record.seats.b;
            if (game.deadline === null && (record.rematch === 'w' || record.rematch === 'b')) game.#rematch = record.rematch;
        }
        return game;
    }

    checkpoint() {
        return { version: CHESS_MATCH_VERSION, id: this.#id, seats: { ...this.#seats },
            match: this.#match?.checkpoint() ?? null, rematch: this.#rematch };
    }

    get deadline() { return this.#match?.deadline ?? null; }
    get subjects() { return this.#seats.b ? [this.#seats.w, this.#seats.b] : [this.#seats.w]; }

    seat(subject) {
        if (typeof subject !== 'string' || !subject) return null;
        if (this.#seats.w === subject) return 'w';
        if (this.#seats.b === subject) return 'b';
        return null;
    }

    view(subject, now) {
        return { version: CHESS_MATCH_VERSION, game: 'chess', id: this.#id,
            seat: this.seat(subject), waiting: !this.#match, match: this.#match?.view(now) ?? null,
            rematch: this.#rematch };
    }

    join(subject, id, now) {
        if (id !== this.#id || this.#match || typeof subject !== 'string' || !subject || this.seat(subject)) return false;
        this.#match = new ChessMatch(id, now);
        this.#seats.b = subject;
        return true;
    }

    command(subject, request, now) {
        return this.#match?.command(this.seat(subject), request, now) ?? { ok: false, reason: 'waiting' };
    }

    expire(now) { return this.#match?.expire(now) ?? false; }

    requestRematch(subject, id, nextId, now) {
        const seat = this.seat(subject);
        if (id !== this.#id || !seat || !this.#match || this.deadline !== null || seat === this.#rematch) return false;
        if (!this.#rematch) {
            this.#rematch = seat;
            return true;
        }
        if (nextId === id) return false;
        const match = new ChessMatch(nextId, now);
        this.#seats = { w: this.#seats.b, b: this.#seats.w };
        this.#id = nextId;
        this.#match = match;
        this.#rematch = null;
        return true;
    }
}
