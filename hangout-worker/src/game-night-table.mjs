// Room admission supplies server-owned subjects. This state never decides who
// can enter a room or see its board. The lobby must authorize each operation,
// including a read, and serialize membership changes with match changes.
export function createGameNightTable({ name, version, Match, sides: [first, second], finished, project, create = (id, now) => new Match(id, now) }) {
    return class GameNightTable {
        #seats;
        #match = null;
        #rematch = null;
        #id;

        constructor(id, host) {
            if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{5,80}$/.test(id) ||
                typeof host !== 'string' || !host) throw new TypeError('Invalid match or seat identity');
            this.#id = id;
            this.#seats = { [first]: host, [second]: null };
        }

        static restore(record) {
            if (record?.version !== version || !record.seats) throw new TypeError('Invalid room match checkpoint');
            const game = new GameNightTable(record.id, record.seats[first]);
            if (record.match) {
                if (record.match.id !== record.id || typeof record.seats[second] !== 'string' ||
                    !record.seats[second] || record.seats[second] === record.seats[first]) throw new TypeError('Invalid match seats');
                game.#match = Match.restore(record.match);
                game.#seats[second] = record.seats[second];
                if (finished(game.#match) && [first, second].includes(record.rematch)) game.#rematch = record.rematch;
            }
            return game;
        }

        checkpoint() {
            return { version, id: this.#id, seats: { ...this.#seats },
                match: this.#match?.checkpoint() ?? null, rematch: this.#rematch };
        }

        get deadline() { return this.#match?.deadline ?? null; }
        get subjects() { return this.#seats[second] ? [this.#seats[first], this.#seats[second]] : [this.#seats[first]]; }

        seat(subject) {
            if (typeof subject !== 'string' || !subject) return null;
            if (this.#seats[first] === subject) return first;
            if (this.#seats[second] === subject) return second;
            return null;
        }

        view(subject, now) {
            return { version, game: name, id: this.#id,
                seat: this.seat(subject), waiting: !this.#match, match: this.#match ? project(this.#match, this.seat(subject), now) : null,
                rematch: this.#rematch };
        }

        join(subject, id, now) {
            if (id !== this.#id || this.#match || typeof subject !== 'string' || !subject || this.seat(subject)) return false;
            this.#match = create(id, now);
            this.#seats[second] = subject;
            return true;
        }

        command(subject, request, now) {
            return this.#match?.command(this.seat(subject), request, now) ?? { ok: false, reason: 'waiting' };
        }

        expire(now) { return this.#match?.expire?.(now) ?? false; }

        requestRematch(subject, id, nextId, now) {
            const seat = this.seat(subject);
            if (id !== this.#id || !seat || !this.#match || !finished(this.#match) || seat === this.#rematch) return false;
            if (!this.#rematch) {
                this.#rematch = seat;
                return true;
            }
            if (nextId === id) return false;
            const match = create(nextId, now);
            this.#seats = { [first]: this.#seats[second], [second]: this.#seats[first] };
            this.#id = nextId;
            this.#match = match;
            this.#rematch = null;
            return true;
        }
    };
}
