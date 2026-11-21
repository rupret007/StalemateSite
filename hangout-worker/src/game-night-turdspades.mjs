import { TurdSpadesMatch, SPADES_SEATS, TURDSPADES_MATCH_VERSION } from '../arcade/games/turdspades-match.js';
import { RANK_VALUES, pickNilCoverCard, suggestSpadesBid } from '../arcade/games/turdspades-engine.js';
import { createGameNightTable } from './game-night-table.mjs';

const rules = {
    name: 'turdspades',
    version: TURDSPADES_MATCH_VERSION,
    Match: TurdSpadesMatch,
    create: id => new TurdSpadesMatch(id),
    sides: SPADES_SEATS,
    finished: match => match.finished,
    project: (match, seat) => match.view(seat)
};

export const GameNightTurdSpades = createGameNightTable(rules);

const computerSeats = Object.freeze({ north: '@cpu:north', east: '@cpu:east' });
const partners = { north: 'south', east: 'west' };
const rank = card => RANK_VALUES[card.rank];

// Use the standalone game's high-card estimates and Nil policy.
function computerBid(hand) {
    return suggestSpadesBid(hand);
}

function beats(card, winner, lead) {
    if (card.suit === winner.suit) return rank(card) > rank(winner);
    return card.suit === 'S' || card.suit === lead && winner.suit !== 'S';
}

function computerCard(view) {
    const { turn, bids, tricks, trick } = view;
    const partner = partners[turn];
    const legal = view.hand.filter(card => card.playable).sort((a, b) => rank(a) - rank(b) || a.id - b.id);
    const needsTricks = bids[turn] + bids[partner] > tricks[turn] + tricks[partner];
    if (!trick.length) {
        if (bids[turn] === 0 || !needsTricks) return legal[0];
        return legal.filter(card => card.suit !== 'S').at(-1) ?? legal.at(-1);
    }
    const lead = trick[0].suit;
    const winner = trick.reduce((best, card) => beats(card, best, lead) ? card : best);
    const wins = card => beats(card, winner, lead);
    if (bids[turn] === 0) return legal.filter(card => !wins(card)).at(-1) ?? legal[0];
    const cover = pickNilCoverCard(legal, { partnerBid: bids[partner], winnerPlayer: winner.seat, partner, cardBeatsWinner: wins });
    if (cover) return cover;
    const follow = legal.filter(card => card.suit === lead);
    const eligible = follow.length ? follow : legal.filter(card => card.suit === 'S');
    if (!eligible.length) return legal.at(-1);
    return (needsTricks && winner.seat !== partner ? eligible.find(wins) : null) ?? eligible[0];
}

class SpadesPartnersMatch {
    #match;

    constructor(id, saved) {
        this.#match = new TurdSpadesMatch(id, saved);
        if (!saved) this.#playComputerTurns();
    }

    static restore(saved) { return new SpadesPartnersMatch(saved?.id, saved); }
    get finished() { return this.#match.finished; }
    checkpoint() { return this.#match.checkpoint(); }
    view(seat) { return this.#match.view(seat); }

    command(seat, frame) {
        const result = this.#match.command(seat, frame);
        if (result.ok) this.#playComputerTurns();
        return result;
    }

    #playComputerTurns() {
        let current = this.#match.view(null);
        while (!current.result && ['bid', 'play'].includes(current.phase) && Object.hasOwn(computerSeats, current.turn)) {
            const view = this.#match.view(current.turn);
            const action = view.phase === 'bid' ? { action: 'bid', bid: computerBid(view.hand) }
                : { action: 'play', card: computerCard(view).id };
            const result = this.#match.command(view.turn, { ...action, version: view.version, id: view.id, revision: view.revision });
            if (!result.ok) throw new Error('Spades computer action was refused.');
            current = this.#match.view(null);
        }
    }
}

export const GameNightSpadesPartners = createGameNightTable({
    ...rules, mode: 'partners', sides: ['south', 'west'], computerSeats,
    Match: SpadesPartnersMatch, create: id => new SpadesPartnersMatch(id)
});
