// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({ handlers: null, open: false, unavailable: false }));

vi.mock('../../r/45662413410ed051/lobby/game-night-match-client.mjs', () => ({
    matchConnectionErrors: {},
    matchHiddenText: 'Chess is hidden.',
    matchUnavailableText: 'Chess is unavailable.',
    createGameNightMatchClient: options => {
        client.handlers = options;
        return { start() {}, stop() {}, send() { return true; }, matchUnavailable() { return client.unavailable; }, matchOpen() { return client.open; } };
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

function publish({ seat = 'b', turn = 'w', fen, moves = [], result = null, revision = 1 }) {
    client.open = false; client.unavailable = false;
    client.handlers.onState({ canOpen: true, state: {
        id: 'match-one', seat, waiting: false, disconnectedSeats: [],
        match: { id: 'match-one', revision, turn, fen, moves, result,
            clock: { w: 600000, b: 600000 }, drawOffer: null }
    } });
}

function publishHidden(phase = 'playing') {
    client.open = phase === 'playing' || phase === 'finished';
    client.unavailable = phase === 'unavailable';
    client.handlers.onState({ canOpen: false, phase, state: null });
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
        expect(document.querySelectorAll('[data-check]')).toHaveLength(1);
        expect(document.querySelector('[data-square="e8"]').hasAttribute('data-check')).toBe(false);
    });

    it('shows a denied watcher only the hidden message and no match state', () => {
        mount();
        publishHidden('playing');
        expect(document.querySelector('[data-chess-status]').textContent).toBe('Chess is hidden.');
        expect(document.querySelectorAll('[data-square]')).toHaveLength(0);
        expect(document.body.textContent).not.toContain('4k3/8/8');
        expect(document.body.textContent).not.toContain('e2e4');
    });

    it('does not mark either king or status as checked in a non-check position', () => {
        mount();
        publish({ seat: 'b', turn: 'w', fen: '4k3/8/8/8/4P3/8/8/4K3 w - - 0 1', revision: 2 });
        expect(document.querySelectorAll('[data-check]')).toHaveLength(0);
        expect(document.querySelector('[data-chess-status]').textContent).not.toContain('in check');
    });

    it('shows unavailable and closed states with their intended controls', () => {
        mount();
        publishHidden('unavailable');
        expect(document.querySelector('[data-chess-status]').textContent).toBe('Chess is unavailable.');
        expect(document.querySelectorAll('[data-square]')).toHaveLength(0);
        publishHidden('closed');
        expect(document.querySelector('[data-chess-status]').textContent).toContain('Waiting for the host');
        expect(document.querySelector('[data-chess-primary]').hidden).toBe(true);
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
        const forward = document.querySelector('[data-square="e5"]');
        expect(forward.hasAttribute('data-legal')).toBe(true);
        expect(forward.hasAttribute('data-capture')).toBe(false);
        const illegal = document.querySelector('[data-square="d4"]');
        expect(illegal.hasAttribute('data-legal')).toBe(false);
        expect(illegal.hasAttribute('data-capture')).toBe(false);
    });

    it('renders resignation in the mounted result status', () => {
        mount();
        publish({ seat: 'b', turn: 'w', fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1', result: { winner: 'w', reason: 'resignation' } });
        expect(document.querySelector('[data-chess-status]').textContent).toContain('White wins · resignation');
        expect(document.querySelector('[data-chess-status]').textContent).not.toContain('Checkmate');
    });

    it('keeps the board and match controls present at a 390×844 phone viewport', () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
        mount();
        publish({ seat: 'w', turn: 'w', fen: '4k3/8/8/8/4P3/8/8/4K3 w - - 0 1' });
        expect(window.innerWidth).toBe(390);
        expect(window.innerHeight).toBe(844);
        expect(document.querySelectorAll('[data-square]')).toHaveLength(64);
        expect(document.querySelector('[data-action="resign"]')).toBeTruthy();
        expect(document.querySelector('[data-action="leave"]')).toBeTruthy();
    });
});
