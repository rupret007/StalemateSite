import { describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({ handlers: null }));

vi.mock('../../r/45662413410ed051/lobby/game-night-match-client.mjs', () => ({
    matchConnectionErrors: {},
    createGameNightMatchClient: options => {
        client.handlers = options;
        return { start() {}, stop() {}, send() { return true; } };
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
        seats: panel.querySelector('[data-spades-seats]')
    };
}

describe('Spades table next step', () => {
    it('tells a full-table watcher they are up next game in four-player and partners', () => {
        const four = mount();
        four.publish(state());
        expect(four.status()).toBe('Table full. You’re up next game.');
        expect(four.main.hidden).toBe(true);
        expect(four.seats.hidden).toBe(true);

        const partners = mount();
        partners.publish(state({
            mode: 'partners', occupied: ['south', 'west'],
            match: hand({ turn: 'west', bids: { south: null, west: null, north: null, east: null }, phase: 'bid' })
        }), false, true);
        expect(partners.status()).toBe('Table full. You’re up next game.');
        expect(partners.main.hidden).toBe(true);
    });

    it('tells a watcher of a full waiting table the same next step and hides seat buttons', () => {
        const view = mount();
        view.publish(state({ waiting: true, match: null }));
        expect(view.status()).toBe('Table full. You’re up next game.');
        expect(view.seats.hidden).toBe(true);
        expect(view.main.hidden).toBe(true);
    });

    it('keeps an open seat available to a watcher', () => {
        const view = mount();
        view.publish(state({ waiting: true, match: null, occupied: ['south'] }));
        expect(view.status()).toContain('1/4 seated');
        expect(view.seats.hidden).toBe(false);
    });

    it('tells a finished watcher they are up if the table rematches', () => {
        const view = mount();
        view.publish(state({ match: hand({ result: { winner: 0, reason: 'score' } }) }));
        expect(view.status()).toBe('You’re up if they rematch.');
        expect(view.main.hidden).toBe(true);
    });

    it('keeps the result and Rematch for a seated player', () => {
        const view = mount();
        view.publish(state({ seat: 'south', match: hand({ result: { winner: 0, reason: 'resigned' } }) }));
        expect(view.status()).toContain('South + North win by resignation');
        expect(view.main.textContent).toBe('Rematch');
        expect(view.main.hidden).toBe(false);
    });

    it('says the game is over when the table disappears', () => {
        const view = mount();
        view.publish(state({ seat: 'west' }));
        view.publish(null);
        expect(view.status()).toBe('The host left. This game is over.');
        expect(view.main.hidden).toBe(true);
    });

    it('does not call a voluntary leave a host departure', () => {
        const view = mount();
        view.publish(state({ seat: 'west', waiting: true, match: null, occupied: ['south', 'west'] }), true);
        view.main.click();
        view.publish(null, true);
        expect(view.status()).toBe('4 players. South and North versus West and East.');
        expect(view.main.textContent).toBe('Open');
    });
});
