// The lobby supplies admitted subjects and authorizes every read and command.
// This table assigns seats and preserves a distinct view for each viewer.
export function createGameNightTable({ name, version, Match, sides, finished, project, create = (id, now) => new Match(id, now) }) {
    const first = sides[0], twoSeats = sides.length === 2;
    const subjectValid = value => typeof value === 'string' && !!value;
    return class GameNightTable {
        #seats;
        #match = null;
        #votes = [];
        #id;

        constructor(id, host) {
            if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{5,80}$/.test(id) || !subjectValid(host)) {
                throw new TypeError('Invalid match or seat identity');
            }
            this.#id = id;
            this.#seats = Object.fromEntries(sides.map(seat => [seat, seat === first ? host : null]));
        }

        static restore(record) {
            if (record?.version !== version || !record.seats) throw new TypeError('Invalid room match checkpoint');
            const game = new GameNightTable(record.id, record.seats[first]);
            for (const seat of sides.slice(1)) {
                const subject = record.seats[seat];
                if (subject === null) continue;
                if (!subjectValid(subject) || game.seat(subject)) throw new TypeError('Invalid match seats');
                game.#seats[seat] = subject;
            }
            const filled = game.subjects.length === sides.length;
            if (filled !== !!record.match || (record.match && record.match.id !== record.id)) throw new TypeError('Invalid match seats');
            if (filled) {
                game.#match = Match.restore(record.match);
                const votes = twoSeats ? (record.rematch ? [record.rematch] : []) : record.rematchVotes;
                if (finished(game.#match) && Array.isArray(votes) && votes.length < sides.length &&
                    new Set(votes).size === votes.length && votes.every(seat => sides.includes(seat))) game.#votes = [...votes];
            }
            return game;
        }

        #rematchView() {
            return twoSeats ? { rematch: this.#votes[0] ?? null } : { rematchVotes: [...this.#votes] };
        }

        checkpoint() {
            return { version, id: this.#id, seats: { ...this.#seats }, match: this.#match?.checkpoint() ?? null, ...this.#rematchView() };
        }

        get deadline() { return this.#match?.deadline ?? null; }
        get subjects() { return sides.map(seat => this.#seats[seat]).filter(Boolean); }

        seat(subject) {
            return subjectValid(subject) ? sides.find(seat => this.#seats[seat] === subject) ?? null : null;
        }

        view(subject, now) {
            const seat = this.seat(subject);
            return {
                version, game: name, id: this.#id, seat, waiting: !this.#match,
                match: this.#match ? project(this.#match, seat, now) : null, ...this.#rematchView(),
                ...(!twoSeats ? { occupied: sides.filter(position => this.#seats[position]) } : {})
            };
        }

        join(subject, id, now, requested) {
            if (id !== this.#id || this.#match || !subjectValid(subject) || this.seat(subject)) return false;
            const seat = twoSeats ? sides[1] : requested;
            if (!sides.includes(seat) || this.#seats[seat]) return false;
            if (this.subjects.length === sides.length - 1) this.#match = create(id, now);
            this.#seats[seat] = subject;
            return true;
        }

        releaseSeat(subject) {
            const seat = this.seat(subject);
            if (twoSeats || this.#match || !seat || seat === first) return false;
            this.#seats[seat] = null;
            return true;
        }

        command(subject, request, now) {
            return this.#match?.command(this.seat(subject), request, now) ?? { ok: false, reason: 'waiting' };
        }

        expire(now) { return this.#match?.expire?.(now) ?? false; }

        requestRematch(subject, id, nextId, now) {
            const seat = this.seat(subject);
            if (id !== this.#id || !seat || !this.#match || !finished(this.#match) || this.#votes.includes(seat)) return false;
            if (this.#votes.length < sides.length - 1) {
                this.#votes.push(seat);
                return true;
            }
            if (nextId === id) return false;
            const match = create(nextId, now);
            if (twoSeats) [this.#seats[first], this.#seats[sides[1]]] = [this.#seats[sides[1]], this.#seats[first]];
            this.#id = nextId;
            this.#match = match;
            this.#votes = [];
            return true;
        }
    };
}
