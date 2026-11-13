import { describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({ sent: [], handlers: null }));

vi.mock('../../r/45662413410ed051/lobby/game-night-match-client.mjs', () => ({
    matchConnectionErrors: { room: 'Return to the room.' },
    createGameNightMatchClient: options => {
        client.handlers = options;
        return {
            start() {},
            stop() {},
            send(frame) { client.sent.push(JSON.parse(JSON.stringify(frame))); return true; }
        };
    }
}));

const { mountArcadeChess } = await import('../../r/45662413410ed051/lobby/arcade-chess.mjs');

const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function match(extra = {}) {
    return { id: 'chess-status-1', fen, moves: [], turn: 'w', revision: 1, clock: { w: 600000, b: 600000 }, drawOffer: null, result: null, ...extra };
}

function state(extra = {}) {
    return { version: 1, game: 'chess', id: 'chess-status-1', seat: null, waiting: false, rematch: null, match: match(), ...extra };
}

async function mount() {
    client.sent.length = 0;
    document.body.replaceChildren();
    const container = document.createElement('div');
    document.body.append(container);
    const api = mountArcadeChess(container, () => {});
    api.setRoom({ room: '#game-2ca9e1x1be34a', ref: 'ref-1', actor: 'actor-1' });
    await api.ready();
    const panel = container.querySelector('.arcade-chess');
    return {
        publish(next, canOpen = false) { client.handlers.onState({ state: next, canOpen }); },
        status: () => panel.querySelector('[data-chess-status]').textContent,
        primary: panel.querySelector('[data-chess-primary]'),
        leave: panel.querySelector('[data-action="leave"]')
    };
}

describe('Chess table next step', () => {
    it('tells a watcher the table is full and hides seat controls', async () => {
        const view = await mount();
        view.publish(state());
        expect(view.status()).toBe('Table full. You’re up next game.');
        expect(view.primary.hidden).toBe(true);
        expect(view.leave.hidden).toBe(true);
    });

    it('tells a watcher they are up if a finished game rematches', async () => {
        const view = await mount();
        view.publish(state({ match: match({ result: { winner: 'w', reason: 'Checkmate' } }) }));
        expect(view.status()).toBe('White wins · Checkmate. You’re up if they rematch.');
        expect(view.primary.hidden).toBe(true);
    });

    it('keeps Rematch for a seated player when the game is over', async () => {
        const view = await mount();
        view.publish(state({ seat: 'b', match: match({ result: { winner: 'w', reason: 'Checkmate' } }) }));
        expect(view.status()).toBe('White wins · Checkmate');
        expect(view.primary.hidden).toBe(false);
        expect(view.primary.textContent).toBe('Rematch');
    });

    it('says the game is over when the table disappears', async () => {
        const view = await mount();
        view.publish(state({ seat: 'b' }));
        view.publish(null);
        expect(view.status()).toBe('The host left. This game is over.');
        expect(view.primary.hidden).toBe(true);
    });

    it('offers Open after the table disappears when this player can open one', async () => {
        const view = await mount();
        view.publish(state(), true);
        view.publish(null, true);
        expect(view.status()).toBe('The host left. This game is over.');
        expect(view.primary.textContent).toBe('Open');
        expect(view.primary.hidden).toBe(false);
    });

    it('does not call a voluntary leave a host departure', async () => {
        const view = await mount();
        view.publish(state({ seat: 'w', waiting: true, match: null }));
        view.primary.click();
        view.publish(null, true);
        expect(view.status()).toBe('Open a ten-minute match for two players.');
        expect(view.primary.textContent).toBe('Open');
    });

    it('tells a seated player who dropped and returned that the seat is still theirs', async () => {
        const view = await mount();
        view.publish(state({ seat: 'w' }));
        client.handlers.onStatus('reconnecting');
        view.publish(state({ seat: 'w' }));
        expect(view.status()).toBe('You’re still White.');
        view.publish(state({ seat: 'w', match: match({ turn: 'b', revision: 2 }) }));
        expect(view.status()).toBe('You’re White · Black to move');
    });
});
