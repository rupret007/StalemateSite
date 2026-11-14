// The lobby supplies admitted subjects and authorizes every read and command.
// This table assigns seats and preserves a distinct view for each viewer.
export function createGameNightTable({
    name, version, Match, sides, finished, project, create = (id, now) => new Match(id, now), manualStart = false, minSeats = sides.length,
    mode, computerSeats = {}
}) {
    const first = sides[0], twoSeats = sides.length === 2;
    const subjectValid = value => typeof value === 'string' && !!value;
    return class GameNightTable {
        #seats;
        #match = null;
        #votes = [];
        #id;
        #tableId;
        #host;
        #closed = false;

        constructor(id, host, tableId = id) {
            if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{5,80}$/.test(id) || !subjectValid(host)
                || typeof tableId !== 'string' || !/^[a-zA-Z0-9-]{5,80}$/.test(tableId)) {
                throw new TypeError('Invalid match or seat identity');
            }
            this.#id = id;
            this.#tableId = tableId;
            this.#host = host;
            this.#seats = Object.fromEntries(sides.map(seat => [seat, seat === first ? host : null]));
        }

        static restore(record) {
            if (record?.version !== version || record.mode !== mode || !record.seats
                || Object.entries(computerSeats).some(([seat, subject]) => record.seats[seat] !== subject)) {
                throw new TypeError('Invalid room match checkpoint');
            }
            const game = new GameNightTable(record.id, record.seats[first], record.tableId);
            const host = record.host === undefined ? record.seats[first] : record.host;
            if (!sides.some(seat => record.seats[seat] === host)) throw new TypeError('Invalid table host');
            game.#host = host;
            game.#closed = record.closed === true;
            for (const seat of sides.slice(1)) {
                const subject = record.seats[seat];
                if (subject === null) continue;
                if (!subjectValid(subject) || game.seat(subject)) throw new TypeError('Invalid match seats');
                game.#seats[seat] = subject;
            }
            const occupied = game.#occupied();
            if (record.match ? occupied.length < minSeats || record.match.id !== record.id
                : !manualStart && occupied.length === sides.length) throw new TypeError('Invalid match seats');
            if (record.match) {
                game.#match = Match.restore(record.match);
                if (manualStart && JSON.stringify(game.#match.players) !== JSON.stringify(occupied)) throw new TypeError('Invalid active seats');
                const votes = twoSeats ? (record.rematch ? [record.rematch] : []) : record.rematchVotes;
                if (finished(game.#match) && Array.isArray(votes) && votes.length <= occupied.length &&
                    new Set(votes).size === votes.length && votes.every(seat => occupied.includes(seat))) game.#votes = [...votes];
            }
            return game;
        }

        #occupied() { return sides.filter(seat => this.#seats[seat]); }

        #rematchView() {
            return twoSeats ? { rematch: this.#votes[0] ?? null } : { rematchVotes: [...this.#votes] };
        }

        checkpoint() {
            return { version, id: this.#id, tableId: this.#tableId, host: this.#host, seats: { ...this.#seats, ...computerSeats }, match: this.#match?.checkpoint() ?? null,
                ...this.#rematchView(), ...(this.#closed ? { closed: true } : {}), ...(mode ? { mode } : {}) };
        }

        get deadline() { return this.#closed ? null : this.#match?.deadline ?? null; }
        get closed() { return this.#closed; }
        get host() { return this.#host; }
        get tableId() { return this.#tableId; }
        get subjects() { return sides.map(seat => this.#seats[seat]).filter(Boolean); }

        seat(subject) {
            return subjectValid(subject) ? sides.find(seat => this.#seats[seat] === subject) ?? null : null;
        }

        guestSeats(id, host) {
            if (this.#closed || id !== this.#id || this.#match || this.#host !== host) return [];
            return sides.filter(seat => !this.#seats[seat]);
        }

        hasGuestSeat(id, host, reserved = 0) {
            return !this.#closed && id === this.#id && !this.#match && this.#host === host && this.#occupied().length + reserved < sides.length;
        }

        view(subject, now) {
            const seat = this.seat(subject);
            return {
                version, game: name, id: this.#id, tableId: this.#tableId, seat, waiting: !this.#match,
                hasOpenSeat: !this.#match && this.#occupied().length < sides.length,
                match: this.#match ? project(this.#match, seat, now) : null, ...this.#rematchView(),
                ...(!twoSeats || mode ? { occupied: this.#occupied() } : {}), ...(mode ? { mode } : {}),
                ...(manualStart ? { canStart: !this.#match && seat === first && this.#occupied().length >= minSeats } : {})
            };
        }

        join(subject, id, now, requested, reserved = 0, heldSeats = []) {
            if (this.#closed || id !== this.#id || this.#match || !subjectValid(subject) || this.seat(subject) || this.#occupied().length + reserved >= sides.length) return false;
            const seat = twoSeats ? sides[1] : requested === 'next' ? sides.find(side => !this.#seats[side] && !heldSeats.includes(side)) : requested;
            if (!sides.includes(seat) || this.#seats[seat] || heldSeats.includes(seat)) return false;
            if (!manualStart && this.subjects.length === sides.length - 1) this.#match = create(id, now);
            this.#seats[seat] = subject;
            return true;
        }

        start(subject, id, now) {
            const occupied = this.#occupied();
            if (!manualStart || id !== this.#id || this.#match || this.seat(subject) !== first || occupied.length < minSeats) return false;
            this.#match = create(id, now, occupied);
            return true;
        }

        releaseSeat(subject) {
            const seat = this.seat(subject);
            if (twoSeats || this.#match || !seat || seat === first) return false;
            this.#seats[seat] = null;
            return true;
        }

        close(subject, id) {
            if (this.#closed || subject !== this.#host || id !== this.#id) return false;
            this.#closed = true;
            this.#votes = [];
            return true;
        }

        reopen(subject, id, modeRequested, now) {
            if (!this.#closed || subject !== this.#host || id === this.#id || modeRequested !== mode) return false;
            const occupied = this.#occupied();
            const match = occupied.length >= minSeats ? create(id, now, occupied) : null;
            this.#id = id;
            this.#match = match;
            this.#closed = false;
            return true;
        }

        command(subject, request, now) {
            if (this.#closed) return { ok: false, reason: 'waiting' };
            return this.#match?.command(this.seat(subject), request, now) ?? { ok: false, reason: 'waiting' };
        }

        expire(now) { return !this.#closed && (this.#match?.expire?.(now) ?? false); }

        requestRematch(subject, id, nextId, now, { connected, force = false } = {}) {
            const seat = this.seat(subject);
            if (this.#closed || id !== this.#id || !seat || !this.#match || !finished(this.#match)
                || nextId === id || (force ? subject !== this.#host : this.#votes.includes(seat))) return false;
            if (!force) this.#votes.push(seat);
            this.startReadyRematch(nextId, now, connected, force);
            return true;
        }

        startReadyRematch(nextId, now, connected, force = false) {
            if (this.#closed || !this.#match || !finished(this.#match) || nextId === this.#id) return false;
            const occupied = this.#occupied();
            const online = connected ? occupied.filter(side => connected.has(this.#seats[side])) : occupied;
            if (!force && (!online.length || !online.every(side => this.#votes.includes(side)))) return false;
            const match = create(nextId, now, occupied);
            this.#id = nextId;
            this.#match = match;
            this.#votes = [];
            return true;
        }
    };
}
