// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { GameNightChess } from '../../hangout-worker/src/game-night-chess.mjs';
import { GameNightSpadesPartners, GameNightTurdSpades } from '../../hangout-worker/src/game-night-turdspades.mjs';
import { GameNightTurdanoid } from '../../hangout-worker/src/game-night-turdanoid.mjs';

const now = 1000;
const games = [
    { name: 'Chess', Table: GameNightChess, seats: ['w', 'b'], players: ['host', 'guest'] },
    { name: 'partners Spades', Table: GameNightSpadesPartners, seats: ['south', 'west'], players: ['host', 'guest'] },
    { name: 'four-player Spades', Table: GameNightTurdSpades, seats: ['south', 'west', 'north', 'east'], players: ['host', 'guest', 'player-3', 'player-4'] },
    { name: 'Turdanoid', Table: GameNightTurdanoid, seats: ['a', 'b'], players: ['host', 'guest'] }
];

function setup({ Table, seats, players }) {
    const id = 'rematch-original';
    const table = new Table(id, players[0]);
    for (let index = 1; index < players.length; index++) {
        expect(table.join(players[index], id, now, seats[index])).toBe(true);
    }
    return { table, id, seats, players };
}

function finish(table, player) {
    const match = table.checkpoint().match;
    expect(table.command(player, { version: match.version, id: match.id, revision: match.revision, action: 'resign' }).ok).toBe(true);
}

function rematch(f, { spectator = false, disconnected = null } = {}) {
    const { table, id, players, seats } = f;
    if (spectator) expect(table.enqueue('watcher')).toBe(true);
    finish(table, players[0]);
    const connected = new Set(players.filter(player => player !== disconnected));
    const nextId = 'rematch-next';
    for (const player of players) {
        if (player === disconnected) continue;
        expect(table.requestRematch(player, id, nextId, now + 1, { connected })).toBe(true);
    }
    expect(table.view(players[0], now + 1).id).toBe(nextId);
    for (const [index, player] of players.entries()) {
        expect(table.view(player, now + 1).seat).toBe(seats[index]);
    }
    if (spectator) {
        const view = table.view('watcher', now + 1);
        expect(view.seat).toBeNull();
        expect(view.match?.hand ?? []).toEqual([]);
        expect(JSON.stringify(view)).not.toContain('hand:');
    }
    if (disconnected) {
        expect(table.seat(disconnected)).toBe(seats[players.indexOf(disconnected)]);
        expect(table.view('watcher', now + 1).seat).toBeNull();
    }
}

describe('Game Night rematch keeps the same seats', () => {
    for (const game of games) {
        it(`${game.name}: unanimous rematch keeps every player's seat`, () => rematch(setup(game)));
        it(`${game.name}: watcher stays unseated and receives no private hand`, () => rematch(setup(game), { spectator: true }));
        it(`${game.name}: disconnected player's seat remains held`, () => rematch(setup(game), { spectator: true, disconnected: game.players[1] }));
    }
});
