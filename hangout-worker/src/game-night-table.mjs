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
        // Arrival order of people who found a full table. The next game seats them.
        #next = [];
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
            // A full waiting table would already have dealt. A match may continue
            // with fewer seats after a guest is removed between hands.
            if (record.match) {
                if (record.match.id !== record.id) throw new TypeError('Invalid match seats');
            } else if (!manualStart && occupied.length === sides.length) throw new TypeError('Invalid match seats');
            if (record.match) {
                game.#match = Match.restore(record.match);
                const done = !!finished(game.#match);
                if (manualStart && !done && JSON.stringify(game.#match.players) !== JSON.stringify(occupied)) throw new TypeError('Invalid active seats');
                const votes = twoSeats ? (record.rematch ? [record.rematch] : []) : record.rematchVotes;
                if (done && Array.isArray(votes) && votes.length <= occupied.length &&
                    new Set(votes).size === votes.length && votes.every(seat => occupied.includes(seat))) game.#votes = [...votes];
            }
            const queued = [];
            if (record.nextGame !== undefined) {
                if (!Array.isArray(record.nextGame)) throw new TypeError('Invalid room match checkpoint');
                for (const subject of record.nextGame) {
                    if (!subjectValid(subject) || queued.includes(subject) || queued.length >= 32) throw new TypeError('Invalid room match checkpoint');
                    if (!game.seat(subject)) queued.push(subject);
                }
            }
            game.#next = queued;
            return game;
        }

        #occupied() { return sides.filter(seat => this.#seats[seat]); }

        #rematchView() {
            return twoSeats ? { rematch: this.#votes[0] ?? null } : { rematchVotes: [...this.#votes] };
        }

        checkpoint() {
            return { version, id: this.#id, tableId: this.#tableId, host: this.#host, seats: { ...this.#seats, ...computerSeats }, match: this.#match?.checkpoint() ?? null,
                ...this.#rematchView(), ...(this.#next.length ? { nextGame: [...this.#next] } : {}),
                ...(this.#closed ? { closed: true } : {}), ...(mode ? { mode } : {}) };
        }

        get deadline() { return this.#closed ? null : this.#match?.deadline ?? null; }
        get closed() { return this.#closed; }
        get mode() { return mode; }
        get host() { return this.#host; }
        get tableId() { return this.#tableId; }
        // What a viewer who cannot see the board may still be told.
        get openMatch() {
            return this.#closed || !this.#match ? null : { id: this.#id, finished: !!finished(this.#match) };
        }
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

        #full() { return !!this.#match || this.#occupied().length >= sides.length; }

        view(subject, now) {
            const seat = this.seat(subject);
            const upNext = !seat && this.#full() && this.#next.includes(subject);
            return {
                version, game: name, id: this.#id, tableId: this.#tableId, seat, waiting: !this.#match,
                hasOpenSeat: !this.#match && this.#occupied().length < sides.length,
                ...(upNext ? { upNext: true } : {}),
                match: this.#match ? project(this.#match, seat, now) : null, ...this.#rematchView(),
                ...(!twoSeats || mode ? { occupied: this.#occupied() } : {}), ...(mode ? { mode } : {}),
                ...(manualStart ? { canStart: !this.#match && seat === first && this.#occupied().length >= minSeats } : {})
            };
        }

        // A connected person with no seat at a full table is lined up for the next game.
        enqueue(subject) {
            if (this.#closed || !this.#full() || !subjectValid(subject) || this.seat(subject) || this.#next.includes(subject) || this.#next.length >= 32) return false;
            this.#next.push(subject);
            return true;
        }

        // Take someone out of the line, e.g. a watch-only invitation that an older
        // checkpoint had lined up. They are never seated from it.
        dequeue(subject) {
            if (!this.#next.includes(subject)) return false;
            this.#next = this.#next.filter(entry => entry !== subject);
            return true;
        }

        join(subject, id, now, requested, reserved = 0, heldSeats = []) {
            if (this.#closed || id !== this.#id || this.#match || !subjectValid(subject) || this.seat(subject) || this.#occupied().length + reserved >= sides.length) return false;
            const seat = twoSeats ? sides[1] : requested === 'next' ? sides.find(side => !this.#seats[side] && !heldSeats.includes(side)) : requested;
            if (!sides.includes(seat) || this.#seats[seat] || heldSeats.includes(seat)) return false;
            if (!manualStart && this.subjects.length === sides.length - 1) this.#match = create(id, now);
            this.#seats[seat] = subject;
            this.#next = this.#next.filter(entry => entry !== subject);
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

        // A checkpoint or older build may still list a watch-only subject in a seat.
        // A live hand keeps that seat: this person cannot play, so the deal stalls,
        // and freeing the seat mid-hand would change who must act. Between matches
        // the seat can be given to someone waiting. The host seat stays.
        #watchSeat(subject) {
            const seat = this.seat(subject);
            if (!seat || seat === first || subject === this.#host) return null;
            if (!this.#closed && this.#match && !finished(this.#match)) return null;
            return seat;
        }

        #releaseWatchSeats(watchers) {
            for (const subject of watchers || []) {
                const seat = this.#watchSeat(subject);
                if (!seat) continue;
                this.#seats[seat] = null;
                this.dequeue(subject);
            }
        }

        // Kick or ban while the hand is over. The finished match stays so the
        // host can rematch; this guest's seat is empty and they are not dealt
        // the next hand. The host seat stays. An in-progress hand is held.
        releaseFinishedSeat(subject) {
            const seat = this.seat(subject);
            if (this.#closed || !this.#match || !finished(this.#match) || !seat || seat === first || subject === this.#host) return false;
            this.#votes = this.#votes.filter(entry => entry !== seat);
            this.#seats[seat] = null;
            this.dequeue(subject);
            return true;
        }

        // A guest gives up a seat once play is over. The table, its host and the
        // other seats stay; a finished match is cleared so the seat can be filled.
        // During play the seat is held, so this returns false.
        vacate(subject, nextId) {
            const seat = this.seat(subject);
            if (this.#closed || !seat || seat === first || subject === this.#host) return false;
            if (this.#match) {
                if (!finished(this.#match) || typeof nextId !== 'string' || !/^[a-zA-Z0-9-]{5,80}$/.test(nextId) || nextId === this.#id) return false;
                this.#match = null;
                this.#id = nextId;
                this.#votes = [];
            }
            this.#seats[seat] = null;
            return true;
        }

        close(subject, id) {
            if (this.#closed || subject !== this.#host || id !== this.#id) return false;
            this.#closed = true;
            this.#votes = [];
            return true;
        }

        reopen(subject, id, modeRequested, now, connected, watchers = []) {
            if (!this.#closed || subject !== this.#host || id === this.#id || modeRequested !== mode) return false;
            // The closed hand is not resumed. Free a stored watch-only seat first,
            // while the table is still closed, so the line can take it.
            this.#releaseWatchSeats(watchers);
            this.#closed = false;
            this.#admitNext(connected);
            const occupied = this.#occupied();
            const match = occupied.length >= minSeats ? create(id, now, occupied) : null;
            this.#id = id;
            this.#match = match;
            return true;
        }

        command(subject, request, now) {
            if (this.#closed) return { ok: false, reason: 'waiting' };
            return this.#match?.command(this.seat(subject), request, now) ?? { ok: false, reason: 'waiting' };
        }

        expire(now) { return !this.#closed && (this.#match?.expire?.(now) ?? false); }

        requestRematch(subject, id, nextId, now, { connected, force = false, watchers = [] } = {}) {
            const seat = this.seat(subject);
            if (this.#closed || id !== this.#id || !seat || !this.#match || !finished(this.#match)
                || nextId === id || (force ? subject !== this.#host : this.#votes.includes(seat))) return false;
            if (!force) this.#votes.push(seat);
            this.startReadyRematch(nextId, now, connected, force, watchers);
            return true;
        }

        startReadyRematch(nextId, now, connected, force = false, watchers = []) {
            if (this.#closed || !this.#match || !finished(this.#match) || nextId === this.#id) return false;
            // A connected watch-only seat cannot vote or play. It must not block
            // the next deal, and it is freed only once that deal is actually starting.
            const skipping = new Set((watchers || []).filter(subject => this.#watchSeat(subject)));
            const occupied = this.#occupied();
            const online = (connected ? occupied.filter(side => connected.has(this.#seats[side])) : occupied)
                .filter(side => !skipping.has(this.#seats[side]));
            if (!force && (!online.length || !online.every(side => this.#votes.includes(side)))) return false;
            this.#releaseWatchSeats(watchers);
            this.#admitNext(connected);
            const match = create(nextId, now, this.#occupied());
            this.#id = nextId;
            this.#match = match;
            this.#votes = [];
            return true;
        }

        #online(connected, subject) { return !connected || connected.has(subject); }

        // Fill only open seats from the line. A seated player keeps the same seat
        // on a rematch, including one who lost signal (#585 same-seat recovery);
        // anyone still waiting stays in line for the next open seat. A watch-only
        // seat is cleared by the caller before this runs, so the line can take it.
        #admitNext(connected) {
            const waiting = this.#next.filter(subject => this.#online(connected, subject) && !this.seat(subject));
            if (!waiting.length) {
                if (connected) this.#next = this.#next.filter(subject => connected.has(subject) && !this.seat(subject));
                return;
            }
            const open = sides.filter(seat => seat !== first && !this.#seats[seat]);
            open.sort((left, right) => sides.indexOf(left) - sides.indexOf(right));
            const leftover = [];
            for (const subject of waiting) {
                const seat = open.shift();
                if (seat) this.#seats[seat] = subject;
                else leftover.push(subject);
            }
            this.#next = leftover.filter(subject => !this.seat(subject));
        }
    };
}
