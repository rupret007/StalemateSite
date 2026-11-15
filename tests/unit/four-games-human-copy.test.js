import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { chessResultText } from '../../r/45662413410ed051/lobby/arcade-chess.mjs';
import { turdanoidResultText } from '../../r/45662413410ed051/lobby/arcade-turdanoid.mjs';
import { watchWaitingText } from '../../r/45662413410ed051/lobby/game-night.mjs';
import { matchConnectionErrors, matchHiddenText, matchUnavailableText } from '../../r/45662413410ed051/lobby/game-night-match-client.mjs';

const spadesClient = vi.hoisted(() => ({ handlers: null }));
vi.mock('../../r/45662413410ed051/lobby/game-night-match-client.mjs', async original => ({
    ...(await original()),
    createGameNightMatchClient: handlers => {
        spadesClient.handlers = handlers;
        return {
            start() {}, stop() {}, matchOpen: () => false, matchUnavailable: () => false,
            send: () => true
        };
    }
}));
vi.mock('../../r/45662413410ed051/lobby/game-night-audio.mjs', () => ({ gameNightCue: () => {} }));
vi.mock('/play/games/turdspades-engine.js', () => ({ suggestSpadesBid: () => 3 }));

const { mountArcadeTurdSpades } = await import('../../r/45662413410ed051/lobby/arcade-turdspades.mjs');

const chessSource = readFileSync('r/45662413410ed051/lobby/arcade-chess.mjs', 'utf8');
const spadesSource = readFileSync('r/45662413410ed051/lobby/arcade-turdspades.mjs', 'utf8');
const turdanoidSource = readFileSync('r/45662413410ed051/lobby/arcade-turdanoid.mjs', 'utf8');

function sourceString(source, value) {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const found = source.match(new RegExp(`(['\"\x60])${escaped}\\1`));
    expect(found, `expected product source to contain ${value}`).not.toBeNull();
    return found[0].slice(1, -1);
}

function expectHumanSentence(text) {
    expect(text).toEqual(expect.any(String));
    expect(text.trim().length).toBeGreaterThan(0);
    expect(text).not.toMatch(/\b(?:4001|4003|undefined|null)\b/i);
    expect(text.trim()).toMatch(/[.!?…]$/);
}

function spadesWaitingLine({ mode, occupied, seat }) {
    const container = document.createElement('div');
    document.body.append(container);
    const view = mountArcadeTurdSpades(container, () => {});
    view.setRoom({ room: 'room', ref: '0'.repeat(32), actor: 'c' + '1'.repeat(32) });
    spadesClient.handlers.onState({
        state: {
            version: 1, game: 'turdspades', id: 'spades-human-copy', tableId: 'spades-human-copy',
            mode, seat, waiting: true, match: null, occupied
        },
        canOpen: false,
        partners: mode === 'partners'
    });
    const line = container.querySelector('[data-spades-status]').textContent;
    container.remove();
    return line;
}

describe('Game Night status copy', () => {
    beforeEach(() => { document.body.replaceChildren(); });

    afterEach(() => {
        spadesClient.handlers?.onStatus('reconnecting');
        document.body.replaceChildren();
    });

    it('keeps the real Chess and shared access messages human-readable', () => {
        const reconnecting = sourceString(chessSource, 'Reconnecting to Chess…');
        const connecting = sourceString(chessSource, 'Connecting to Chess…');
        const reconnectWithClocks = sourceString(chessSource, 'Reconnecting to Chess… The clocks keep running.');
        const whiteResigned = chessResultText({ winner: 'w', reason: 'Resignation' });
        [reconnecting, connecting, reconnectWithClocks, watchWaitingText, matchHiddenText, matchUnavailableText,
            ...Object.values(matchConnectionErrors), whiteResigned,
            chessResultText({ winner: null, reason: 'stalemate' })].forEach(expectHumanSentence);
        expect(whiteResigned).toBe('White wins · Resignation.');
    });

    it('checks actual partners and four-player Spades status copy', () => {
        const connecting = sourceString(spadesSource, 'Connecting to the table…');
        const reconnecting = sourceString(spadesSource, 'Reconnecting to the table…');
        const reconnectingPaused = sourceString(spadesSource, 'Reconnecting to the table… Your hand is paused.');
        const waiting = sourceString(spadesSource, 'Waiting for the host to open a table.');
        expect(spadesSource).toContain("teams.join(' vs ')}.");
        const partnersLine = spadesWaitingLine({ mode: 'partners', occupied: ['south', 'west'], seat: 'south' });
        const fourPlayerLine = spadesWaitingLine({ occupied: ['south', 'west'], seat: 'south' });
        expect(partnersLine).toBe('2/2 seated · You’re South · South + North CPU vs West + East CPU.');
        expect(fourPlayerLine).toBe('2/4 seated · You’re South · South + North vs West + East.');
        [connecting, reconnecting, reconnectingPaused, waiting, watchWaitingText, partnersLine, fourPlayerLine]
            .forEach(expectHumanSentence);
    });

    it('checks Turdanoid reconnect, watcher, waiting, and game-over copy', () => {
        const connecting = sourceString(turdanoidSource, 'Connecting to the race…');
        const reconnecting = sourceString(turdanoidSource, 'Reconnecting to the race…');
        const reconnectingClock = sourceString(turdanoidSource, 'Reconnecting · race clock keeps running.');
        const watching = sourceString(turdanoidSource, 'Watching · waiting for players.');
        const waiting = sourceString(turdanoidSource, 'Waiting for a second player.');
        const winner = sourceString(turdanoidSource, 'You win');
        const rival = sourceString(turdanoidSource, 'Rival wins');
        const forfeit = sourceString(turdanoidSource, 'by forfeit');
        const seatWins = turdanoidResultText({ winner: 'a', reason: 'resign' }, 'a');
        const rivalWins = turdanoidResultText({ winner: 'b', reason: 'resign' }, 'a');
        const drawTime = turdanoidResultText({ winner: null, reason: 'time' }, 'a');
        const drawClear = turdanoidResultText({ winner: null, reason: 'clear' }, 'a');
        const drawOut = turdanoidResultText({ winner: null, reason: 'out' }, 'a');
        [connecting, reconnecting, reconnectingClock, watching, waiting, seatWins, rivalWins,
            drawTime, drawClear, drawOut].forEach(expectHumanSentence);
        expect(seatWins).toBe(`${winner} ${forfeit}.`);
        expect(rivalWins).toBe(`${rival} ${forfeit}.`);
        expect(drawTime).toBe('Draw · time limit.');
        expect(drawClear).toBe('Draw · wall cleared.');
        expect(drawOut).toBe('Draw · out of balls.');
    });
});