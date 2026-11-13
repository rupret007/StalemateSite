import { describe, expect, it, vi } from 'vitest';
import { TurdanoidBrickRace } from '../../play/games/turdanoid-race.js';

const client = vi.hoisted(() => ({ sent: [], handlers: null }));

vi.mock('../../r/45662413410ed051/lobby/game-night-match-client.mjs', () => ({
    matchConnectionErrors: {},
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
const { mountArcadeTurdSpades } = await import('../../r/45662413410ed051/lobby/arcade-turdspades.mjs');
const { mountArcadeTurdanoid } = await import('../../r/45662413410ed051/lobby/arcade-turdanoid.mjs');

const FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function mount(create) {
    client.sent.length = 0;
    document.body.replaceChildren();
    const media = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    window.matchMedia = media;
    globalThis.matchMedia = media;
    const container = document.createElement('div');
    document.body.append(container);
    create(container, () => {});
    return container;
}

function state(frame) {
    client.handlers.onState(frame);
}

describe('Chess next step', () => {
    it('tells a watcher the table is full and keeps a seated rematch', () => {
        const view = mount(mountArcadeChess);
        const status = view.querySelector('[data-chess-status]');
        const button = view.querySelector('[data-chess-primary]');
        state({ state: null, canOpen: false });
        expect(status.textContent).toBe('Waiting for the host to open a match.');
        expect(button.hidden).toBe(true);
        state({
            state: { id: 'chess-1', seat: null, waiting: false, rematch: null, match: { fen: FEN, turn: 'w', result: null, moves: [], revision: 1, clock: { w: 600000, b: 600000 } } },
            canOpen: false
        });
        expect(status.textContent).toBe('Table full. You’re watching. White to move.');
        expect(button.hidden).toBe(false);
        expect(button.textContent).toBe('Watch this game');
        button.click();
        expect(client.sent).toEqual([]);
        state({
            state: { id: 'chess-1', seat: null, waiting: false, rematch: null, match: { fen: FEN, turn: 'b', result: { winner: 'b', reason: 'Resignation' }, moves: [], revision: 2, clock: { w: 600000, b: 600000 } } },
            canOpen: false
        });
        expect(status.textContent).toBe('Black wins · Resignation. You can watch the next match.');
        expect(button.textContent).toBe('Watch for the next game');
        state({
            state: { id: 'chess-1', seat: 'b', waiting: false, rematch: null, match: { fen: FEN, turn: 'b', result: { winner: 'b', reason: 'Resignation' }, moves: [], revision: 2, clock: { w: 600000, b: 600000 } } },
            canOpen: false
        });
        expect(status.textContent).toBe('Black wins · Resignation');
        expect(button.textContent).toBe('Request rematch');
    });

    it('tells a guest the match ended and still lets the host open', () => {
        const view = mount(mountArcadeChess);
        const status = view.querySelector('[data-chess-status]');
        const button = view.querySelector('[data-chess-primary]');
        state({
            state: { id: 'chess-1', seat: 'b', waiting: false, rematch: null, match: { fen: FEN, turn: 'w', result: null, moves: [], revision: 1, clock: { w: 600000, b: 600000 } } },
            canOpen: false
        });
        state({ state: null, canOpen: false });
        expect(status.textContent).toBe('This match ended. Wait here for the next game.');
        expect(button.textContent).toBe('Stay for the next game');
        button.click();
        expect(client.sent).toEqual([]);
        expect(status.textContent).toBe('Waiting for the host to open a match.');
        expect(button.hidden).toBe(true);
        state({ state: null, canOpen: true });
        expect(status.textContent).toBe('Open a ten-minute match for two players.');
        expect(button.textContent).toBe('Open Chess match');
    });
});

function spadesMatch(extra = {}) {
    return {
        phase: 'bid', round: 1, turn: 'west', scores: [0, 0], target: 500, bags: [0, 0],
        trick: [], lastTrick: [], bids: { south: null, west: null, north: null, east: null },
        canBid: false, hand: [], spadesBroken: false, lastWinner: null, revision: 1, result: null, ...extra
    };
}

describe('Spades next step', () => {
    it('keeps an open seat and tells a full table what is next', () => {
        const view = mount(mountArcadeTurdSpades);
        const status = view.querySelector('[data-spades-status]');
        const button = view.querySelector('[data-spades-main]');
        state({
            state: { version: 1, game: 'turdspades', id: 'spades-1', seat: null, waiting: true, occupied: ['south', 'west', 'north'], match: null },
            canOpen: false, partners: true
        });
        expect(status.textContent).toContain('3/4 seated');
        expect(view.querySelector('[data-spades-seats]').hidden).toBe(false);
        expect([...view.querySelectorAll('[data-spades-seats] button')].find(item => !item.hidden).textContent).toBe('Join East');
        for (const [occupied, expected] of [
            [['south', 'west'], 'Waiting for 2 more players'],
            [['south', 'west', 'north'], 'Waiting for 1 more player']
        ]) {
            state({ state: { version: 1, game: 'turdspades', id: 'spades-1', seat: 'west', waiting: true, occupied, match: null }, canOpen: false, partners: true });
            expect(status.textContent).toContain(expected);
            expect(button.textContent).toBe('Release seat');
        }
        state({
            state: { version: 1, game: 'turdspades', id: 'spades-1', seat: null, waiting: false, occupied: ['south', 'west', 'north', 'east'], match: spadesMatch() },
            canOpen: false, partners: true
        });
        expect(status.textContent).toBe('Table full. You’re watching. West to bid');
        expect(button.textContent).toBe('Keep watching');
        expect(view.querySelector('[data-spades-hand-label]').textContent).toBe('Watching · hands are private');
        button.click();
        expect(client.sent).toEqual([]);
        state({
            state: { version: 1, game: 'turdspades', id: 'spades-1', seat: null, mode: 'partners', waiting: false, occupied: ['south', 'west'], match: spadesMatch({ result: { winner: 1, reason: 'resigned' } }) },
            canOpen: false, partners: true
        });
        expect(status.textContent).toBe('West + East CPU win by resignation. You’re watching.');
        expect(button.textContent).toBe('Watch for the rematch');
        const roundResult = [{ delta: 12, nil: [] }, { delta: -3, nil: [] }];
        state({
            state: { version: 1, game: 'turdspades', id: 'spades-1', seat: null, waiting: false, occupied: ['south', 'west', 'north', 'east'], match: spadesMatch({ roundResult }) },
            canOpen: false, partners: true
        });
        expect(status.textContent).toContain('Waiting for the next round.');
        expect(button.textContent).toBe('Keep watching');
        button.click();
        expect(view.ownerDocument.activeElement).toBe(view.querySelector('[data-spades-trick]'));
        state({
            state: { version: 1, game: 'turdspades', id: 'spades-1', seat: 'west', waiting: false, occupied: ['south', 'west', 'north', 'east'], match: spadesMatch({ result: { winner: 1, reason: 'resigned' } }) },
            canOpen: false, partners: true
        });
        expect(status.textContent).toBe('West + East win by resignation. 0/4 ready for a rematch.');
        expect(button.textContent).toBe('Request Spades rematch');
    });

    it('tells partners and four-player guests when the host leaves', () => {
        const view = mount(mountArcadeTurdSpades);
        const status = view.querySelector('[data-spades-status]');
        const button = view.querySelector('[data-spades-main]');
        state({
            state: { version: 1, game: 'turdspades', id: 'spades-1', seat: 'west', mode: 'partners', waiting: false, occupied: ['south', 'west'], match: spadesMatch() },
            canOpen: false, partners: true
        });
        state({ state: null, canOpen: false, partners: true });
        expect(status.textContent).toBe('This match ended. Wait here for the next game.');
        expect(button.textContent).toBe('Stay for the next game');
        button.click();
        expect(status.textContent).toBe('Waiting for the host to open a table.');
        expect(client.sent).toEqual([]);
    });
});

describe('Turdanoid next step', () => {
    it('gives a watcher, a dropped seat, and a departed host one next step', () => {
        HTMLCanvasElement.prototype.getContext = () => {
            let proxy;
            const node = function stub() { return proxy; };
            proxy = new Proxy(node, { get: (_target, prop) => prop === 'a' ? 1 : proxy, set: () => true, apply: () => proxy });
            return proxy;
        };
        const view = mount(mountArcadeTurdanoid);
        const status = view.querySelector('[data-brick-status]');
        const button = view.querySelector('[data-brick-main]');
        const match = new TurdanoidBrickRace('race-12345', 50_000, null, 1).view('a', 50_000);
        state({ state: { version: 1, game: 'turdanoid', id: 'race-12345', seat: null, waiting: false, rematch: null, match }, canOpen: false });
        expect(status.textContent).toBe('Race full. You’re watching.');
        expect(button.textContent).toBe('Watch this race');
        button.click();
        expect(client.sent).toEqual([]);
        state({ state: { version: 1, game: 'turdanoid', id: 'race-12345', seat: 'b', waiting: false, rematch: null, match }, canOpen: false });
        client.handlers.onStatus('reconnecting');
        expect(status.textContent).toBe('Reconnecting to your seat · race clock keeps running');
        state({
            state: { version: 1, game: 'turdanoid', id: 'race-12345', seat: null, waiting: false, rematch: null, match: { ...match, result: { winner: 'a', reason: 'clear' } } },
            canOpen: false
        });
        expect(status.textContent).toBe('Player 1 wins · wall cleared');
        expect(button.textContent).toBe('Watch for the next race');
        state({
            state: { version: 1, game: 'turdanoid', id: 'race-12345', seat: 'b', waiting: false, rematch: null, match: { ...match, result: { winner: 'a', reason: 'clear' } } },
            canOpen: false
        });
        expect(status.textContent).toBe('Rival wins · wall cleared');
        expect(button.textContent).toBe('Request Turdanoid rematch');
        state({ state: null, canOpen: false });
        expect(status.textContent).toBe('This race ended. Wait here for the next race.');
        expect(button.textContent).toBe('Stay for the next race');
    });
});
