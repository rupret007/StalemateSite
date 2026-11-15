// Cases for scripts/family-alpha-regrade-shots-lib.mjs. Runs under either runner:
//   npx --no-install vitest run tests/unit/family-alpha-regrade-shots.test.js
//   node --test scripts/family-alpha-regrade-shots.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { arcadeHello, assertPort, brickWallShown, controlFloor, gameSpecs, layoutFindings, matchSocket, retireMatchSocket, seatStarted, settle } from './family-alpha-regrade-shots-lib.mjs';

const lobby = name => readFileSync(new URL(`../r/45662413410ed051/lobby/${name}`, import.meta.url), 'utf8');
const phone = { width: 390, height: 844 }, desktop = { width: 1440, height: 900 };
export const cases = [];
const test = (name, run) => { cases.push([name, run]); };

test('the fixture hello carries the arcade flags the lobby client gates each game on', () => {
    const hello = arcadeHello({ t: 'hello', features: { gameNight: 1 } });
    const client = lobby('lobby.js');
    for (const flag of ['arcadeChess', 'arcadeTurdSpades', 'arcadeTurdanoid']) {
        assert.equal(hello.features[flag], 1, flag);
        assert.match(client, new RegExp(`features\\?\\.${flag} === 1`));
    }
    assert.equal(hello.features.gameNight, 1);
    const part = { t: 'part', ch: '#room' };
    assert.equal(arcadeHello(part), part);
});

test('board proofs use attributes the game clients render', () => {
    const spades = lobby('arcade-turdspades.mjs'), chess = lobby('arcade-chess.mjs');
    assert.match(spades, /dataset\.spadesCard = /);
    assert.doesNotMatch(spades, /data-card[\]=\s"]/);
    for (const key of ['partners-spades', 'four-player-spades']) {
        assert.match(gameSpecs[key].proof.selector, /\[data-spades-card\]/);
        assert.equal(gameSpecs[key].proof.min, 13);
    }
    // Every square is a [data-square] button and empty squares carry data-piece="".
    assert.match(chess, /button\.dataset\.piece = art/);
    assert.equal(gameSpecs.chess.proof.selector, '[data-piece]:not([data-piece=""])');
    assert.equal(gameSpecs.chess.proof.min, 32);
});

test('a waiting table is never accepted as a started game', () => {
    const { chess, turdanoid } = gameSpecs, partners = gameSpecs['partners-spades'], four = gameSpecs['four-player-spades'];
    assert.equal(seatStarted(chess, 0, 'You’re White · Waiting for an opponent.'), false);
    assert.equal(seatStarted(chess, 1, 'Black is open. Join to play.'), false);
    assert.equal(seatStarted(chess, 0, 'Connecting to Chess…'), false);
    assert.equal(seatStarted(chess, 0, ''), false);
    assert.equal(seatStarted(chess, 0, 'You’re White · Your turn'), true);
    assert.equal(seatStarted(chess, 1, 'You’re Black · White to move'), true);
    assert.equal(seatStarted(four, 0, '3/4 seated · You’re South · North & South vs East & West'), false);
    assert.equal(seatStarted(four, 1, 'Waiting for the host to open a table.'), false);
    assert.equal(seatStarted(four, 2, 'Round 1 · Your bid · tap Bid for me'), true);
    assert.equal(seatStarted(partners, 1, 'Round 1 · HostExample to bid'), true);
    assert.equal(seatStarted(partners, 0, 'Round 1 · Your bid · tap Bid for me · Waiting for West, link still works.'), false);
    assert.equal(seatStarted(turdanoid, 0, 'Waiting for a second player.'), false);
    assert.equal(seatStarted(turdanoid, 1, 'An opponent is ready.'), false);
    assert.equal(seatStarted(turdanoid, 0, 'Connecting to the race…'), false);
    assert.equal(seatStarted(turdanoid, 0, 'Same wall and three balls. Clear it first or break the most bricks in 75 seconds.'), false);
    assert.equal(seatStarted(turdanoid, 0, 'Sewer Stack'), true);
});

test('a blank Turdanoid canvas is not a wall', () => {
    assert.equal(brickWallShown({ canvases: 1, phase: '', bricks: 0, painted: false }), false);
    assert.equal(brickWallShown({ canvases: 1, phase: 'countdown', bricks: 40, painted: false }), false);
    assert.equal(brickWallShown({ canvases: 1, phase: 'finished', bricks: 40, painted: true }), false);
    assert.equal(brickWallShown({ canvases: 1, phase: 'countdown', bricks: 40, painted: true }), true);
    assert.equal(brickWallShown({ canvases: 1, phase: 'play', bricks: 40, painted: true }), true);
});

test('phone controls are held to 44px and findings are named', () => {
    assert.equal(controlFloor(phone), 44);
    assert.equal(controlFloor(desktop), 24);
    const controls = [
        { label: 'button "Resign"', x: 10, y: 700, width: 80, height: 38 },
        { label: 'button "Dance"', x: 10, y: 750, width: 60, height: 32 },
        { label: 'button "Send"', x: 300, y: 790, width: 58, height: 44 },
        { label: 'button "Hidden away"', x: 400, y: 100, width: 60, height: 44 }
    ];
    assert.deepEqual(layoutFindings({ scrollWidth: 390, controls }, phone), [
        'undersized control (80x38, floor 44): button "Resign"',
        'undersized control (60x32, floor 44): button "Dance"',
        'unreachable control: button "Hidden away"'
    ]);
    assert.deepEqual(layoutFindings({ scrollWidth: 412, controls: [] }, phone), ['horizontal overflow: 412px wide in a 390px viewport']);
    assert.deepEqual(layoutFindings({ scrollWidth: 1440, controls: controls.slice(0, 3) }, desktop), []);
});

test('a server-closed match socket is still retired and leaves getWebSockets', async () => {
    const closes = [], changed = [], matchSockets = [];
    const transport = { presenceChanged: async scope => { changed.push(scope); } };
    const socket = matchSocket({ send() {}, close: async detail => { closes.push(detail); } }, closed => retireMatchSocket(closed, transport, matchSockets));
    socket.serializeAttachment({ room: '#night', actor: 'c1' });
    matchSockets.push(socket);
    socket.close(4001, 'kicked');
    await retireMatchSocket(socket, transport, matchSockets); // the browser's close event arrives afterwards
    assert.deepEqual(closes, [{ code: 4001, reason: 'kicked' }]);
    assert.equal(socket.readyState, 3);
    assert.deepEqual(changed, [{ room: '#night', actor: 'c1' }]);
    assert.equal(socket.deserializeAttachment().retired, true);
    assert.deepEqual(matchSockets, []);
});

test('a browser-closed match socket is retired once', async () => {
    const changed = [], matchSockets = [];
    const transport = { presenceChanged: async scope => { changed.push(scope); } };
    const socket = matchSocket({ send() {}, close: async () => {} }, closed => retireMatchSocket(closed, transport, matchSockets));
    socket.serializeAttachment({ room: '#night', actor: 'c2' });
    matchSockets.push(socket);
    await retireMatchSocket(socket, transport, matchSockets);
    await retireMatchSocket(socket, transport, matchSockets);
    assert.equal(changed.length, 1);
    assert.deepEqual(matchSockets, []);
});

test('a refused upgrade with no attachment retires without touching presence', async () => {
    const changed = [], matchSockets = [];
    const socket = matchSocket({ send() {}, close: async () => {} }, () => {});
    await retireMatchSocket(socket, { presenceChanged: async scope => { changed.push(scope); } }, matchSockets);
    assert.equal(socket.readyState, 3);
    assert.deepEqual(changed, []);
});

test('every cleanup step runs even when an earlier one throws', async () => {
    const ran = [];
    await assert.rejects(settle([
        async () => { ran.push('browser'); throw new Error('browser close failed'); },
        async () => { ran.push('site'); },
        async () => { ran.push('temp'); throw new Error('temp delete failed'); },
        async () => { ran.push('partial output'); }
    ]), /browser close failed/);
    assert.deepEqual(ran, ['browser', 'site', 'temp', 'partial output']);
});

test('the local server only binds 4800–4849 ports', () => {
    assert.equal(assertPort(4825), 4825);
    for (const port of [4765, 4850, 9000, 80, NaN]) assert.throws(() => assertPort(port), /4800–4849/);
});

if (!process.env.VITEST) {
    const runner = await import('node:test');
    for (const [name, run] of cases) runner.test(name, run);
}
