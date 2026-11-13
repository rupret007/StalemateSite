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

function mount() {
    client.sent.length = 0;
    document.body.replaceChildren();
    const container = document.createElement('div');
    document.body.append(container);
    const api = mountArcadeChess(container, () => {});
    api.setRoom({ room: '#game-2ca9e1x1be34a', ref: 'ref-1', actor: 'actor-1' });
    const panel = container.querySelector('.arcade-chess');
    return {
        publish(next, canOpen = false) { client.handlers.onState({ state: next, canOpen }); },
        status: () => panel.querySelector('[data-chess-status]').textContent,
        primary: panel.querySelector('[data-chess-primary]'),
        leave: panel.querySelector('[data-action="leave"]')
    };
}

describe('Chess table next step', () => {
    // Finding 2: nobody queues for a seat and a rematch keeps the same two players.
    it('tells a watcher whose move it is without promising them a seat', () => {
        const view = mount();
        view.publish(state());
        expect(view.status()).toBe('Watching · White to move');
        expect(view.status()).not.toMatch(/up next|You’re up/);
        expect(view.primary.hidden).toBe(true);
        expect(view.leave.hidden).toBe(true);
    });

    it('tells a watcher the result of a finished game without promising a turn', () => {
        const view = mount();
        view.publish(state({ match: match({ result: { winner: 'w', reason: 'Checkmate' } }) }));
        expect(view.status()).toBe('Watching · White wins · Checkmate');
        expect(view.status()).not.toMatch(/up next|You’re up/);
        expect(view.primary.hidden).toBe(true);
    });

    it('keeps Rematch for a seated player when the game is over', () => {
        const view = mount();
        view.publish(state({ seat: 'b', match: match({ result: { winner: 'w', reason: 'Checkmate' } }) }));
        expect(view.status()).toBe('White wins · Checkmate');
        expect(view.primary.hidden).toBe(false);
        expect(view.primary.textContent).toBe('Rematch');
    });

    // Finding 1: a table also closes when the guest leaves, a player is removed or it times out.
    it('says the game ended, not that the host left, when the table disappears', () => {
        const view = mount();
        view.publish(state({ seat: 'b' }));
        view.publish(null);
        expect(view.status()).toBe('This game ended. Waiting for the host to open a table.');
        expect(view.primary.hidden).toBe(true);
    });

    it('never tells the host that the host left when their guest leaves', () => {
        const view = mount();
        view.publish(state({ seat: 'w' }), true);
        view.publish(null, true);
        expect(view.status()).toBe('This game ended. Open a ten-minute match for two players.');
        expect(view.status()).not.toMatch(/host left/i);
        expect(view.primary.textContent).toBe('Open');
        expect(view.primary.hidden).toBe(false);
    });

    it('does not call a voluntary leave a host departure', () => {
        const view = mount();
        view.publish(state({ seat: 'w', waiting: true, match: null }));
        view.primary.click();
        view.publish(null, true);
        expect(view.status()).toBe('Open a ten-minute match for two players.');
        expect(view.primary.textContent).toBe('Open');
    });

    // Finding 5: no new frame arrives until the returning player moves, so the turn must stay on screen.
    it('keeps Your turn on screen for a player who dropped and returned on their own move', () => {
        const view = mount();
        view.publish(state({ seat: 'w' }));
        client.handlers.onStatus('reconnecting');
        view.publish(state({ seat: 'w' }));
        expect(view.status()).toBe('You’re still White · Your turn');
        view.publish(state({ seat: 'w', match: match({ turn: 'b', revision: 2 }) }));
        expect(view.status()).toBe('You’re White · Black to move');
    });

    it('tells a returning player when it is the other side’s move', () => {
        const view = mount();
        view.publish(state({ seat: 'b' }));
        client.handlers.onStatus('reconnecting');
        view.publish(state({ seat: 'b' }));
        expect(view.status()).toBe('You’re still Black · White to move');
    });

    // Finding 6: after three failed tries nothing reconnects until Retry is tapped.
    it('does not say Reconnecting once the client has stopped trying', () => {
        const view = mount();
        view.publish(state({ seat: 'w' }));
        client.handlers.onStatus('reconnecting');
        expect(view.status()).toBe('Reconnecting… Clocks keep running.');
        client.handlers.onStatus('unavailable');
        expect(view.status()).toBe('Couldn’t reconnect. Clocks keep running. Tap Retry.');
        expect(view.status()).not.toMatch(/Reconnecting/);
        expect(view.primary.textContent).toBe('Retry');
        expect(view.primary.hidden).toBe(false);
    });

    it('does not mention clocks when there was never a match to reconnect to', () => {
        const view = mount();
        client.handlers.onStatus('unavailable');
        expect(view.status()).toBe('Couldn’t reconnect. Tap Retry.');
        expect(view.primary.textContent).toBe('Retry');
        const finished = mount();
        finished.publish(state({ seat: 'w', match: match({ result: { winner: 'w', reason: 'Checkmate' } }) }));
        client.handlers.onStatus('unavailable');
        expect(finished.status()).toBe('Couldn’t reconnect. Tap Retry.');
    });
});
