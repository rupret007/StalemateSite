import { describe, expect, it, vi } from 'vitest';
import { suggestSpadesBid } from '../../play/games/turdspades-engine.js';

const client = vi.hoisted(() => ({ handlers: null, sent: [] }));

vi.mock('../../r/45662413410ed051/lobby/game-night-match-client.mjs', () => ({
    matchConnectionErrors: {},
    createGameNightMatchClient: options => {
        client.handlers = options;
        return { start() {}, stop() {}, send(frame) { client.sent.push(JSON.parse(JSON.stringify(frame))); return true; } };
    }
}));

const { mountArcadeTurdSpades } = await import('../../r/45662413410ed051/lobby/arcade-turdspades.mjs');

function hand(extra = {}) {
    return {
        phase: 'play', round: 1, revision: 1, turn: 'south', scores: [0, 0], target: 500, bags: [0, 0],
        trick: [], lastTrick: [], bids: { south: 3, west: 2, north: 3, east: 4 }, hand: [], canBid: false,
        result: null, roundResult: null, lastWinner: null, spadesBroken: false, ...extra
    };
}

function state(extra = {}) {
    return {
        version: 1, game: 'turdspades', id: 'spades-status-1', seat: null, waiting: false,
        occupied: ['south', 'west', 'north', 'east'], rematchVotes: [], match: hand(), ...extra
    };
}

function mount() {
    document.body.replaceChildren();
    const container = document.createElement('div');
    document.body.append(container);
    const api = mountArcadeTurdSpades(container, () => {});
    api.setRoom({ room: '#game-2ca9e1x1be34a', ref: 'ref-1', actor: 'actor-1' });
    const panel = container.querySelector('.arcade-spades');
    return {
        publish(next, canOpen = false, partners = false) { client.handlers.onState({ state: next, canOpen, partners }); },
        status: () => panel.querySelector('[data-spades-status]').textContent,
        main: panel.querySelector('[data-spades-main]'),
        partners: panel.querySelector('[data-spades-partners]'),
        error: () => panel.querySelector('[data-spades-error]').textContent,
        seats: panel.querySelector('[data-spades-seats]'),
        handLabel: () => panel.querySelector('[data-spades-hand-label]').textContent,
        trick: () => [...panel.querySelectorAll('[data-spades-trick] span')].map(node => node.textContent),
        scores: () => [...panel.querySelectorAll('[data-spades-score]')].map(node => node.textContent)
    };
}

function dealtHand() {
    const cards = [];
    for (const suit of ['S', 'H', 'D', 'C']) {
        for (const rank of ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']) {
            cards.push({ id: cards.length + 1, suit, rank, playable: false });
            if (cards.length === 13) return cards;
        }
    }
    return cards;
}

describe('Spades table next step', () => {
    // Finding 2: nobody queues for a seat and a rematch keeps the same players.
    it('tells a watcher what is happening without promising them a seat', () => {
        const four = mount();
        four.publish(state());
        expect(four.status()).toBe('Watching · Round 1 · South to play');
        expect(four.status()).not.toMatch(/up next|You’re up/);
        expect(four.main.hidden).toBe(true);
        expect(four.seats.hidden).toBe(true);

        const partners = mount();
        partners.publish(state({
            mode: 'partners', occupied: ['south', 'west'],
            match: hand({ turn: 'west', bids: { south: null, west: null, north: null, east: null }, phase: 'bid' })
        }), false, true);
        expect(partners.status()).toBe('Watching · Round 1 · West to bid');
        expect(partners.main.hidden).toBe(true);
    });

    it('tells a watcher of a full waiting table that they are watching and hides seat buttons', () => {
        const view = mount();
        view.publish(state({ waiting: true, match: null }));
        expect(view.status()).toBe('Watching · 4/4 seated · South + North vs West + East');
        expect(view.seats.hidden).toBe(true);
        expect(view.main.hidden).toBe(true);
    });

    // Finding 4: the seat decides your partner, so every seat button names its seat.
    it('names the seat on every Join button and hides taken seats', () => {
        const view = mount();
        view.publish(state({ waiting: true, match: null, occupied: ['south'] }));
        expect(view.status()).toContain('1/4 seated');
        expect(view.seats.hidden).toBe(false);
        const buttons = [...view.seats.querySelectorAll('button')];
        expect(buttons.map(button => button.textContent)).toEqual(['Join South', 'Join West', 'Join North', 'Join East']);
        expect(buttons.filter(button => !button.hidden).map(button => button.textContent)).toEqual(['Join West', 'Join North', 'Join East']);
        expect(new Set(buttons.map(button => button.textContent)).size).toBe(4);
    });

    it('tells a watcher who won a finished match', () => {
        const view = mount();
        view.publish(state({ match: hand({ result: { winner: 0, reason: 'score' } }) }));
        expect(view.status()).toBe('Watching · South + North win.');
        expect(view.status()).not.toMatch(/up next|You’re up/);
        expect(view.main.hidden).toBe(true);
    });

    // Finding 3: the two buttons open different tables, so they cannot share a label.
    it('gives the host two differently named Open buttons and explains both tables', () => {
        const view = mount();
        view.publish(null, true, true);
        expect(view.main.hidden).toBe(false);
        expect(view.partners.hidden).toBe(false);
        expect(view.main.textContent).toBe('Open 4-player');
        expect(view.partners.textContent).toBe('Open 2-player');
        expect(view.status()).toBe('2-player: you and a friend, each with a computer partner. 4-player: South and North versus West and East.');
        view.partners.click();
        expect(client.sent.at(-1)).toMatchObject({ action: 'open', mode: 'partners' });
    });

    it('shows one plain Open button when only the four-player table exists', () => {
        const view = mount();
        view.publish(null, true, false);
        expect(view.main.textContent).toBe('Open');
        expect(view.partners.hidden).toBe(true);
        expect(view.status()).toBe('4 players. South and North versus West and East.');
        view.main.click();
        expect(client.sent.at(-1)).toMatchObject({ action: 'open' });
        expect(client.sent.at(-1).mode).toBeUndefined();
    });

    // Finding 7: one taken seat does not mean the table is full.
    it('tells a guest whose seat was taken to pick another, not that the table is full', () => {
        const view = mount();
        view.publish(state({ waiting: true, match: null, occupied: ['south', 'west'] }));
        client.handlers.onError('seat-unavailable');
        expect(view.error()).toBe('That seat is unavailable. Pick an open seat.');
        expect(view.seats.hidden).toBe(false);
    });

    // Finding 6: after three failed tries nothing reconnects until Retry is tapped.
    it('does not say Reconnecting once the client has stopped trying', () => {
        const view = mount();
        view.publish(state({ seat: 'west' }));
        client.handlers.onStatus('reconnecting');
        expect(view.status()).toBe('Reconnecting… Your hand is paused.');
        client.handlers.onStatus('unavailable');
        expect(view.status()).toBe('Couldn’t reconnect. Tap Retry to get back to your hand.');
        expect(view.main.textContent).toBe('Retry');
        const never = mount();
        client.handlers.onStatus('unavailable');
        expect(never.status()).toBe('Couldn’t reconnect. Tap Retry.');
        expect(never.status()).not.toMatch(/Reconnecting|hand/);
    });

    it('keeps the result and Rematch for a seated player', () => {
        const view = mount();
        view.publish(state({ seat: 'south', match: hand({ result: { winner: 0, reason: 'resigned' } }) }));
        expect(view.status()).toContain('South + North win by resignation');
        expect(view.main.textContent).toBe('Rematch');
        expect(view.main.hidden).toBe(false);
    });

    // Finding 1: a table also closes when a guest leaves a started match, a player is removed or it times out.
    it('says the game ended, not that the host left, when the table disappears', () => {
        const view = mount();
        view.publish(state({ seat: 'west' }));
        view.publish(null);
        expect(view.status()).toBe('This game ended. Waiting for the host to open a table.');
        expect(view.main.hidden).toBe(true);
        const host = mount();
        host.publish(state({ seat: 'south' }), true);
        host.publish(null, true);
        expect(host.status()).toBe('This game ended. 4 players. South and North versus West and East.');
        expect(host.status()).not.toMatch(/host left/i);
        expect(host.main.textContent).toBe('Open');
    });

    it('does not call a voluntary leave a host departure', () => {
        const view = mount();
        view.publish(state({ seat: 'west', waiting: true, match: null, occupied: ['south', 'west'] }), true);
        view.main.click();
        view.publish(null, true);
        expect(view.status()).toBe('4 players. South and North versus West and East.');
        expect(view.main.textContent).toBe('Open');
    });

    // A phone that just sat down sees a lime box on whoever is bidding. That box is their turn, not "you".
    it('names your seat while someone else bids', () => {
        const view = mount();
        view.publish(state({
            seat: 'east',
            match: hand({
                phase: 'bid', turn: 'west', canBid: false,
                bids: { south: null, west: null, north: null, east: null }, hand: []
            })
        }));
        expect(view.status()).toBe('Round 1 · West to bid · You’re East');
        expect(view.trick()).toEqual(['South · —', 'West · —', 'North · —', 'East (you) · —']);
    });

    // The prefilled number is a suggestion. Say so, and say to tap Bid.
    it('tells you the suggested bid and to tap Bid', () => {
        const cards = dealtHand();
        const suggested = suggestSpadesBid(cards);
        const view = mount();
        view.publish(state({
            seat: 'west',
            match: hand({
                phase: 'bid', turn: 'west', canBid: true, hand: cards,
                bids: { south: null, west: null, north: null, east: null }
            })
        }));
        expect(view.status()).toBe(`Round 1 · Your bid · You’re West · ${suggested || 'Nil'} suggested · tap Bid`);
        expect(view.status()).not.toMatch(/^Round 1 · Your bid$/);
    });

    // An empty hand at the end of the round is the result, not a missing deal.
    it('says the hand is over, labels each bid, and uses bag for a single bag', () => {
        const view = mount();
        view.publish(state({
            seat: 'west',
            match: hand({
                phase: 'round-end', turn: 'east', hand: [], target: 250,
                scores: [31, 63], bags: [1, 3],
                bids: { south: 1, west: 2, north: 2, east: 0 },
                roundResult: [
                    { delta: 31, nil: [], bagPenalties: 0 },
                    { delta: 63, nil: [], bagPenalties: 0 }
                ]
            })
        }));
        expect(view.handLabel()).toBe('Hand over · tap Next round');
        expect(view.handLabel()).not.toMatch(/0 cards/);
        expect(view.scores()).toEqual([
            'South + North · 31/250 · 1 bag',
            'West + East · 63/250 · 3 bags'
        ]);
        expect(view.trick()).toEqual([
            'South · bid 1', 'West (you) · bid 2', 'North · bid 2', 'East · bid Nil'
        ]);
        expect(view.status()).toBe('South + North +31 / West + East +63');

        const watching = mount();
        watching.publish(state({
            match: hand({
                phase: 'round-end', hand: [],
                roundResult: [
                    { delta: 31, nil: [], bagPenalties: 0 },
                    { delta: 63, nil: [], bagPenalties: 0 }
                ]
            })
        }));
        expect(watching.handLabel()).toBe('Watching · hand over');
        expect(watching.handLabel()).not.toContain('private');
    });
});
