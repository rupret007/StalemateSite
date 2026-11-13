// TEST FIXTURE, not production code. A copy of hangout-worker/src/game-night-table.mjs
// at 4f35bc3 with the BRIDGE-HOOKS.md hook 1 proposal applied, so the proposal's
// behaviour is tested before anyone lands it. The real file is not edited.
//
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
        #holds = [];   // [{ holder, seat, until }], waiting tables only (rule 7)

        constructor(id, host) {
            if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{5,80}$/.test(id) || !subjectValid(host)) {
                throw new TypeError('Invalid match or seat identity');
            }
            this.#id = id;
            this.#seats = Object.fromEntries(sides.map(seat => [seat, seat === first ? host : null]));
        }

        static restore(record) {
            if (record?.version !== version || record.mode !== mode || !record.seats
                || Object.entries(computerSeats).some(([seat, subject]) => record.seats[seat] !== subject)) {
                throw new TypeError('Invalid room match checkpoint');
            }
            const game = new GameNightTable(record.id, record.seats[first]);
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
                if (finished(game.#match) && Array.isArray(votes) && votes.length < occupied.length &&
                    new Set(votes).size === votes.length && votes.every(seat => occupied.includes(seat))) game.#votes = [...votes];
            }
            if (record.holds !== undefined) {
                // Rule 7: start, requestRematch and join's auto-start clear holds, so match + holds is a bad record.
                if (!Array.isArray(record.holds) || record.match
                    || record.holds.some(hold => !subjectValid(hold?.holder) || !Number.isFinite(hold.until)
                        || !sides.slice(1).includes(hold.seat) || game.#seats[hold.seat] || game.seat(hold.holder))
                    || new Set(record.holds.map(hold => hold.holder)).size !== record.holds.length
                    || new Set(record.holds.map(hold => hold.seat)).size !== record.holds.length) throw new TypeError('Invalid seat holds');
                game.#holds = record.holds.map(({ holder, seat, until }) => ({ holder, seat, until }));
            }
            return game;
        }

        #occupied() { return sides.filter(seat => this.#seats[seat]); }

        #rematchView() {
            return twoSeats ? { rematch: this.#votes[0] ?? null } : { rematchVotes: [...this.#votes] };
        }

        checkpoint() {
            return { version, id: this.#id, seats: { ...this.#seats, ...computerSeats }, match: this.#match?.checkpoint() ?? null,
                ...this.#rematchView(), ...(mode ? { mode } : {}),
                ...(this.#holds.length ? { holds: this.#holds.map(hold => ({ ...hold })) } : {}) };
        }

        get deadline() { return this.#match?.deadline ?? null; }
        get subjects() { return sides.map(seat => this.#seats[seat]).filter(Boolean); }

        seat(subject) {
            return subjectValid(subject) ? sides.find(seat => this.#seats[seat] === subject) ?? null : null;
        }

        #live(now, except = null) { return this.#holds.filter(hold => hold.until > now && hold.holder !== except); }

        // The first guest side that is neither occupied nor under someone else's live hold.
        #openSeat(now, except = null) {
            const held = this.#live(now, except).map(hold => hold.seat);
            return sides.slice(1).find(side => !this.#seats[side] && !held.includes(side)) ?? null;
        }

        hasGuestSeat(id, host, now = 0, holder = null) {
            return id === this.#id && !this.#match && this.#seats[first] === host && this.#openSeat(now, holder) !== null;
        }

        holdSeat(id, host, holder, until, now) {
            if (!subjectValid(holder) || !(until > now) || this.seat(holder)) return false;
            this.#holds = this.#live(now);   // an expired hold must not keep its seat name
            if (this.#holds.some(hold => hold.holder === holder) || !this.hasGuestSeat(id, host, now)) return false;
            this.#holds.push({ holder, seat: this.#openSeat(now), until });
            return true;
        }

        moveHold(holder, nextHolder, until, now) {
            const hold = this.#holds.find(entry => entry.holder === holder && entry.until > now);
            if (!hold || this.#match || !subjectValid(nextHolder) || !(until > now) || this.seat(nextHolder)
                || this.#holds.some(entry => entry.holder === nextHolder)) return null;
            hold.holder = nextHolder;
            hold.until = until;
            return hold.seat;   // a real side, never 'next', never sides[0]
        }

        releaseHold(holder) {
            const before = this.#holds.length;
            this.#holds = this.#holds.filter(hold => hold.holder !== holder);
            return this.#holds.length !== before;
        }

        expireHolds(now) {
            const before = this.#holds.length;
            this.#holds = this.#live(now);
            return this.#holds.length !== before;
        }

        view(subject, now) {
            const seat = this.seat(subject);
            return {
                version, game: name, id: this.#id, seat, waiting: !this.#match,
                match: this.#match ? project(this.#match, seat, now) : null, ...this.#rematchView(),
                ...(!twoSeats || mode ? { occupied: this.#occupied() } : {}), ...(mode ? { mode } : {}),
                ...(manualStart ? { canStart: !this.#match && seat === first && this.#occupied().length >= minSeats } : {})
            };
        }

        join(subject, id, now, requested, holder = null) {
            if (id !== this.#id || this.#match || !subjectValid(subject) || this.seat(subject)) return false;
            const mine = holder === null ? null : this.#holds.find(hold => hold.holder === holder && hold.until > now) ?? null;
            if (mine && !twoSeats && requested !== 'next' && requested !== mine.seat) return false;
            const seat = mine ? mine.seat : twoSeats ? sides[1] : requested === 'next' ? this.#openSeat(now) : requested;
            if (!sides.includes(seat) || this.#seats[seat]) return false;
            if (!mine && this.#live(now).some(hold => hold.seat === seat)) return false;
            if (mine) this.releaseHold(holder);
            if (!manualStart && this.subjects.length === sides.length - 1) {
                this.#match = create(id, now);
                this.#holds = [];
            }
            this.#seats[seat] = subject;
            return true;
        }

        start(subject, id, now) {
            const occupied = this.#occupied();
            if (!manualStart || id !== this.#id || this.#match || this.seat(subject) !== first || occupied.length < minSeats) return false;
            this.#match = create(id, now, occupied);
            this.#holds = [];
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
            const occupied = this.#occupied();
            if (this.#votes.length < occupied.length - 1) {
                this.#votes.push(seat);
                return true;
            }
            if (nextId === id) return false;
            const match = create(nextId, now, occupied);
            if (twoSeats) [this.#seats[first], this.#seats[sides[1]]] = [this.#seats[sides[1]], this.#seats[first]];
            this.#id = nextId;
            this.#match = match;
            this.#votes = [];
            this.#holds = [];
            return true;
        }
    };
}
