import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { chessResultText } from '../../r/45662413410ed051/lobby/arcade-chess.mjs';
import { turdanoidResultText } from '../../r/45662413410ed051/lobby/arcade-turdanoid.mjs';
import { watchWaitingText } from '../../r/45662413410ed051/lobby/game-night.mjs';
import { matchConnectionErrors, matchHiddenText, matchUnavailableText } from '../../r/45662413410ed051/lobby/game-night-match-client.mjs';

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

describe('Game Night status copy', () => {
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
        expectHumanSentence('2/4 seated · You’re South · South + North CPU vs West + East CPU.');
        [connecting, reconnecting, reconnectingPaused, waiting, watchWaitingText].forEach(expectHumanSentence);
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
        [connecting, reconnecting, reconnectingClock, watching, waiting, seatWins, rivalWins]
            .forEach(expectHumanSentence);
        expect(seatWins).toBe(`${winner} ${forfeit}.`);
        expect(rivalWins).toBe(`${rival} ${forfeit}.`);
    });
});
