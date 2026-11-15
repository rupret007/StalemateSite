// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({ handlers: null }));

vi.mock('../../r/45662413410ed051/lobby/game-night-match-client.mjs', () => ({
    matchConnectionErrors: {},
    matchHiddenText: 'Chess is hidden.',
    matchUnavailableText: 'Chess is unavailable.',
    createGameNightMatchClient: options => {
        client.handlers = options;
        return { start() {}, stop() {}, send() { return true; }, matchUnavailable() { return false; }, matchOpen() { return false; } };
    }
}));

const { mountArcadeChess } = await import('../../r/45662413410ed051/lobby/arcade-chess.mjs');

function mount() {
    document.body.innerHTML = '<main></main>';
    const game = mountArcadeChess(document.querySelector('main'), () => {});
    game.setRoom({ room: 'room-one', ref: 'match-one', actor: 'member-two' });
    game.open();
    return { game, panel: game.panel };
}

function publish({ seat = 'b', turn = 'w', fen, moves = [], result = null }) {
    client.handlers.onState({ canOpen: false, state: {
        id: 'match-one', seat, waiting: false, disconnectedSeats: [],
        match: { id: 'match-one', revision: 1, turn, fen, moves, result,
            clock: { w: 600000, b: 600000 }, drawOffer: null }
    } });
}

afterEach(() => { document.body.innerHTML = ''; });

describe('mounted Game Night Chess status and square annotations', () => {
    it('shows the seated black player the white turn and check status', () => {
        mount();
        publish({ fen: 'k3r3/8/8/8/8/8/8/4K3 w - - 0 1' });
        expect(document.querySelector('[data-chess-status]').textContent)
            .toContain('You’re Black · White to move');
        expect(document.querySelector('[data-chess-status]').textContent).toContain('White is in check');
        const checkedKing = document.querySelector('[data-square="e1"]');
        expect(checkedKing.getAttribute('aria-label')).toContain('In check');
        expect(checkedKing.hasAttribute('data-check')).toBe(true);
    });

    it('exposes selected, legal, capture and last-move squares accessibly', () => {
        mount();
        publish({ seat: 'w', turn: 'w', fen: '4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1', moves: ['e2e4'] });
        const pawn = document.querySelector('[data-square="e4"]');
        pawn.click();
        expect(pawn.getAttribute('aria-label')).toContain('Selected');
        expect(pawn.getAttribute('aria-label')).toContain('Last move');
        expect(pawn.hasAttribute('data-last')).toBe(true);
        const capture = document.querySelector('[data-square="d5"]');
        expect(capture.getAttribute('aria-label')).toContain('Legal move');
        expect(capture.getAttribute('aria-label')).toContain('Capture');
        expect(capture.hasAttribute('data-legal')).toBe(true);
        expect(capture.hasAttribute('data-capture')).toBe(true);
    });
});
