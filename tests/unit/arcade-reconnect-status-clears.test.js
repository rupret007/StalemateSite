// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameNightSpadesPartners } from '../../hangout-worker/src/game-night-turdspades.mjs';

const clients = vi.hoisted(() => []);
vi.mock('../../r/45662413410ed051/lobby/game-night-match-client.mjs', () => ({
    matchConnectionErrors: { room: 'Return to your Game Night room and try again.' },
    matchHiddenText: 'A game is under way at this table. You can’t see it right now.',
    matchUnavailableText: 'This table isn\'t available from this invite. Ask the host for a fresh link.',
    createGameNightMatchClient: options => {
        clients.push(options);
        return { start() {}, stop() {}, matchUnavailable: () => false, matchOpen: () => false, send: () => true };
    }
}));
vi.mock('../../r/45662413410ed051/lobby/game-night-audio.mjs', () => ({ gameNightCue() {} }));
vi.mock('/play/games/turdspades-engine.js', () => ({ suggestSpadesBid: () => 3 }));
vi.mock('/play/games/turdrush-core.js', () => ({ classifyRushSwipe: () => null }));
vi.mock('/play/games/turdrush-renderer.js', () => ({ TurdRushRenderer: class {} }));
vi.mock('/play/games/turdrush-race.js', () => ({
    advanceRushRacer() {},
    RUSH_LIMIT_TICKS: 1,
    rushRaceTick: () => 0,
    unpackRushRacer: () => ({ tick: 0, queue: [], status: 'running', run: { player: { lane: 1 } } })
}));

const { mountArcadeTurdSpades } = await import('../../r/45662413410ed051/lobby/arcade-turdspades.mjs');
const { mountArcadeChess, chessTurnText } = await import('../../r/45662413410ed051/lobby/arcade-chess.mjs');
const { mountArcadeCrapeights } = await import('../../r/45662413410ed051/lobby/arcade-crapeights.mjs');
const { mountArcadeTurdRush } = await import('../../r/45662413410ed051/lobby/arcade-turdrush.mjs');

const suitName = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };

function mount(create) {
    const container = document.createElement('div');
    document.body.append(container);
    const before = clients.length;
    const view = create(container, () => {});
    return { view, handlers: clients[before], container };
}

function partnersViews() {
    const table = new GameNightSpadesPartners('spades-reconnect-status', 'host');
    expect(table.join('friend', 'spades-reconnect-status', 0, 'next')).toBe(true);
    const request = (match, fields) => ({ version: match.version, id: match.id, revision: match.revision, ...fields });
    for (let turn = 0; turn < 2; turn++) {
        const subject = table.view('watcher').match.turn === 'south' ? 'host' : 'friend';
        const match = table.view(subject).match;
        expect(table.command(subject, request(match, { action: 'bid', bid: 3 }))).toEqual({ ok: true });
    }
    return { seated: table.view('friend'), watcher: table.view('watcher') };
}

function frame(state, extra = {}) {
    return { state, canOpen: false, partners: true, ...extra };
}

describe('arcade reconnect status clears once the link is back', () => {
    afterEach(() => {
        document.body.replaceChildren();
        vi.unstubAllGlobals();
    });

    it('returns partners Spades to the turn line when the link is connected and the hand is already applied', () => {
        const { seated } = partnersViews();
        const { view, handlers } = mount(mountArcadeTurdSpades);
        const status = view.panel.querySelector('[data-spades-status]');
        handlers.onState(frame(seated));
        const turn = status.textContent;
        expect(turn).toMatch(/^Round 1 · /);
        expect(turn).not.toMatch(/Reconnecting/);

        handlers.onStatus('reconnecting');
        expect(status.textContent).toBe('Reconnecting to the table… Your hand is paused.');

        handlers.onStatus('connected');
        expect(status.textContent).toBe(turn);
        expect(status.textContent).not.toMatch(/Reconnecting/);
        expect(view.panel.querySelector('[data-spades-hand]').children.length).toBe(seated.match.hand.length);
    });

    it('keeps a Spades watcher on the public turn line without another seat’s cards', () => {
        const { seated, watcher } = partnersViews();
        const privateLabels = seated.match.hand.map(card => `${card.rank} of ${suitName[card.suit]}`);
        expect(privateLabels.length).toBeGreaterThan(0);
        expect(watcher.match.hand).toEqual([]);
        const { view, handlers } = mount(mountArcadeTurdSpades);
        const status = view.panel.querySelector('[data-spades-status]');
        handlers.onState(frame(watcher));
        handlers.onStatus('reconnecting');
        expect(status.textContent).toBe('Reconnecting to the table…');
        handlers.onStatus('connected');
        expect(status.textContent).toMatch(/^Round 1 · /);
        expect(status.textContent).not.toMatch(/Reconnecting/);
        expect(view.panel.querySelector('[data-spades-seat]').textContent).toBe('Watching · hands are private');
        expect(view.panel.querySelector('[data-spades-hand]').children).toHaveLength(0);
        const visible = view.panel.textContent;
        for (const label of privateLabels) expect(visible).not.toContain(label);
    });

    it('returns Chess, Eights and Turd Rush to their normal status when connected after a snapshot', () => {
        const chessState = {
            version: 1, game: 'chess', id: 'chess-reconnect-status', seat: 'w', waiting: false,
            match: {
                id: 'chess-reconnect-status', revision: 2, turn: 'w', result: null, moves: [],
                fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
                clock: { w: 600000, b: 600000 }
            }
        };
        const chess = mount(mountArcadeChess);
        const chessStatus = chess.view.panel.querySelector('[data-chess-status]');
        chess.handlers.onState({ state: chessState, canOpen: false });
        const chessTurn = chessTurnText('w', 'w');
        expect(chessStatus.textContent).toBe(chessTurn);
        chess.handlers.onStatus('reconnecting');
        expect(chessStatus.textContent).toBe('Reconnecting to Chess… The clocks keep running.');
        chess.handlers.onStatus('connected');
        expect(chessStatus.textContent).toBe(chessTurn);
        chess.view.panel.open = true;
        chess.view.panel.open = false;

        const eightsState = {
            version: 1, game: 'crapeights', id: 'eights-reconnect-status', seat: 'a', waiting: false,
            match: {
                id: 'eights-reconnect-status', revision: 1, round: 1, turn: 'b', result: null, roundResult: null,
                score: { a: 0, b: 0 }, target: 200, counts: { a: 7, b: 7 }, deckCount: 10,
                canDraw: true, canPass: false, activeSuit: 'S', top: { id: 1, rank: '5', suit: 'S' },
                hand: [{ id: 2, rank: '5', suit: 'H', playable: true }]
            }
        };
        const eights = mount(mountArcadeCrapeights);
        const eightsStatus = eights.view.panel.querySelector('[data-eights-status]');
        eights.handlers.onState({ state: eightsState, canOpen: false });
        expect(eightsStatus.textContent).toBe('Round 1 · Seat 2 to play');
        eights.handlers.onStatus('reconnecting');
        expect(eightsStatus.textContent).toBe('Reconnecting to the table… Your hand is paused.');
        eights.handlers.onStatus('connected');
        expect(eightsStatus.textContent).toBe('Round 1 · Seat 2 to play');
        expect(eightsStatus.textContent).not.toMatch(/Reconnecting/);

        const watcherEights = { ...eightsState, seat: null, match: { ...eightsState.match, hand: [] } };
        const watching = mount(mountArcadeCrapeights);
        const watchingStatus = watching.view.panel.querySelector('[data-eights-status]');
        watching.handlers.onState({ state: watcherEights, canOpen: false });
        watching.handlers.onStatus('reconnecting');
        watching.handlers.onStatus('connected');
        expect(watchingStatus.textContent).toBe('Round 1 · Seat 2 to play');
        expect(watching.view.panel.querySelector('[data-eights-hand]').children).toHaveLength(0);
        expect(watching.view.panel.textContent).not.toContain('5 of Hearts');

        const rushState = {
            version: 1, game: 'turdrush', id: 'rush-reconnect-status', seat: 'a', waiting: false,
            match: { id: 'rush-reconnect-status', result: null, runner: { sequence: 0 }, players: { a: {}, b: {} } }
        };
        vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
        const rush = mount(mountArcadeTurdRush);
        const rushStatus = rush.view.panel.querySelector('[data-race-status]');
        rush.handlers.onState({ state: rushState, canOpen: false });
        expect(rushStatus.textContent).toBe('Swipe or use arrows to move, jump and slide.');
        rush.handlers.onStatus('reconnecting');
        expect(rushStatus.textContent).toBe('Reconnecting · the course keeps moving');
        rush.handlers.onStatus('connected');
        expect(rushStatus.textContent).toBe('Swipe or use arrows to move, jump and slide.');
        expect(rushStatus.textContent).not.toMatch(/Reconnecting/);
    });
});
