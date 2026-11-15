import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { chessResultText } from '../../r/45662413410ed051/lobby/arcade-chess.mjs';
import { watchWaitingText } from '../../r/45662413410ed051/lobby/game-night.mjs';
import { matchConnectionErrors, matchHiddenText, matchUnavailableText } from '../../r/45662413410ed051/lobby/game-night-match-client.mjs';

const lobbySource = readFileSync('r/45662413410ed051/lobby/lobby.js', 'utf8');
const spadesSource = readFileSync('r/45662413410ed051/lobby/arcade-turdspades.mjs', 'utf8');
const turdanoidSource = readFileSync('r/45662413410ed051/lobby/arcade-turdanoid.mjs', 'utf8');

function expectHumanSentence(text) {
    expect(text).toEqual(expect.any(String));
    expect(text.trim().length).toBeGreaterThan(0);
    expect(text).not.toMatch(/\b(?:4001|4003|undefined|null)\b/i);
    expect(text.trim()).toMatch(/[.!?]$/);
}

describe('Game Night status copy', () => {
    it('keeps gate, watcher, and chess status strings human-readable', () => {
        const gateWaiting = 'Waiting for the host to open the table. This link still works.';
        expect(lobbySource).toContain('const gateStatus = (t) =>');
        expect(lobbySource).toContain('gateStatus(\'Waiting for the host to open the table. This link still works.\')');
        [gateWaiting, watchWaitingText, chessResultText({ winner: null, reason: 'stalemate.' })].forEach(expectHumanSentence);
    });

    it('keeps shared reconnect and access copy free of transport close codes', () => {
        [matchHiddenText, matchUnavailableText, ...Object.values(matchConnectionErrors)].forEach(expectHumanSentence);
    });

    it('keeps Spades and Turdanoid render status setters attached to human copy', () => {
        expect(spadesSource).toContain('if (status.textContent !== message) status.textContent = message;');
        expect(turdanoidSource).toContain('put(status, message);');

        const spadesWaiting = 'Waiting for the host to open a table.';
        const spadesWatcher = watchWaitingText;
        const brickWaiting = 'Waiting for a second player.';
        const brickIntro = 'Same wall and three balls. Clear it first or break the most bricks in 75 seconds.';
        [spadesWaiting, spadesWatcher, brickWaiting, brickIntro].forEach(expectHumanSentence);
    });
});
