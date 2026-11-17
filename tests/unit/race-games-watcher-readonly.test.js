// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { GameNightTurdRush } from '../../hangout-worker/src/game-night-turdrush.mjs';
import { GameNightTurdanoid } from '../../hangout-worker/src/game-night-turdanoid.mjs';
import { TurdRushRace, TURD_RUSH_RACE_VERSION, RUSH_COUNTDOWN_MS } from '../../hangout-worker/arcade/games/turdrush-race.js';
import { TurdanoidBrickRace, TURDANOID_RACE_VERSION, BRICK_COUNTDOWN_MS } from '../../hangout-worker/arcade/games/turdanoid-race.js';

const matchId = 'race-12345';
const opened = 50_000;
const privateKeys = ['sequence', 'credits', 'pending', 'chargedAt', 'lastInputTick'];

function send(race, seat, version, sequence, inputs, now) {
  const result = race.command(seat, { id: matchId, version, action: 'input', sequence, inputs }, now);
  expect(result).toMatchObject({ ok: true });
  return result;
}

function assertWatcherHidesSeatPrivate(watch, seatA, seatB) {
  expect(watch.runner.queue).toEqual([]);
  expect(watch.runner.queue).not.toEqual(seatA.runner.queue);
  expect(watch.runner.queue).not.toEqual(seatB.runner.queue);
  for (const field of privateKeys) expect(watch.runner).not.toHaveProperty(field);

  const snapshot = JSON.stringify(watch);
  for (const field of ['sequence', 'credits', 'pending']) expect(snapshot).not.toContain(`"${field}"`);
  for (const seated of [seatA, seatB]) {
    expect(seated.runner.queue.length).toBeGreaterThan(0);
    expect(snapshot).not.toContain(JSON.stringify(seated.runner.queue));
    if (seated.runner.pending != null) expect(snapshot).not.toContain(JSON.stringify(seated.runner.pending));
  }
}

describe('race games keep watchers read-only', () => {
  it('gives a Turd Rush watcher a public runner and still accepts a seated input', () => {
    const race = new TurdRushRace(matchId, opened, null, 1);
    const at = opened + RUSH_COUNTDOWN_MS;

    expect(race.command(null, { id: matchId, version: TURD_RUSH_RACE_VERSION, action: 'input', sequence: 1,
      inputs: [[1, 'left']] }, at)).toMatchObject({ ok: false, reason: 'unavailable' });
    send(race, 'a', TURD_RUSH_RACE_VERSION, 1, [[1, 'jump']], at);
    send(race, 'b', TURD_RUSH_RACE_VERSION, 1, [[2, 'slide']], at);

    const seatA = race.view('a', at);
    const seatB = race.view('b', at);
    expect(seatA.runner.queue).toEqual([[1, 'jump']]);
    expect(seatA.runner.sequence).toBe(1);
    expect(seatA.runner).toHaveProperty('credits');
    expect(seatA.runner).toHaveProperty('pending');
    expect(seatB.runner.queue).toEqual([[2, 'slide']]);
    expect(seatB.runner.sequence).toBe(1);
    expect(seatA.runner.queue).not.toEqual(seatB.runner.queue);

    for (const seat of [null, undefined, 'watcher']) {
      const watch = race.view(seat, at);
      assertWatcherHidesSeatPrivate(watch, seatA, seatB);
      expect(Object.keys(watch.runner).sort()).toEqual(['queue', 'run', 'status', 'tick']);
      expect(watch.runner.tick).toBe(seatA.runner.tick);
      expect(watch.runner.status).toBe(seatA.runner.status);
      expect(watch.runner.run.player).toEqual(seatA.runner.run.player);
      expect(watch.players).toEqual(seatA.players);
    }
    expect(race.view('a', at).runner.queue).toEqual([[1, 'jump']]);
    expect(race.view('b', at).runner.queue).toEqual([[2, 'slide']]);
  });

  it('gives a Turdanoid watcher a public runner and still accepts a seated input', () => {
    const race = new TurdanoidBrickRace(matchId, opened, null, 1);
    const at = opened + BRICK_COUNTDOWN_MS;

    expect(race.command(null, { id: matchId, version: TURDANOID_RACE_VERSION, action: 'input', sequence: 1,
      inputs: [[1, 'aim', 640]] }, at)).toMatchObject({ ok: false, reason: 'unavailable' });
    send(race, 'a', TURDANOID_RACE_VERSION, 1, [[1, 'aim', 640]], at);
    send(race, 'b', TURDANOID_RACE_VERSION, 1, [[2, 'axis', 1]], at);

    const seatA = race.view('a', at);
    const seatB = race.view('b', at);
    expect(seatA.runner.queue).toEqual([[1, 'aim', 640]]);
    expect(seatA.runner.sequence).toBe(1);
    expect(seatA.runner).toHaveProperty('credits');
    expect(seatB.runner.queue).toEqual([[2, 'axis', 1]]);
    expect(seatB.runner.sequence).toBe(1);

    for (const seat of [null, undefined, 'watcher']) {
      const watch = race.view(seat, at);
      assertWatcherHidesSeatPrivate(watch, seatA, seatB);
      expect(Object.keys(watch.runner).sort()).toEqual(['queue', 'run', 'tick']);
      expect(watch.runner.tick).toBe(seatA.runner.tick);
      expect(watch.runner.run.ball).toEqual(seatA.runner.run.ball);
      expect(watch.runner.run).not.toHaveProperty('aim');
      expect(watch.runner.run).not.toHaveProperty('axis');
      expect(watch.players).toEqual(seatA.players);
    }
    expect(race.view('a', at).runner.queue).toEqual([[1, 'aim', 640]]);
    expect(race.view('b', at).runner.queue).toEqual([[2, 'axis', 1]]);
  });
});

describe('race table watcher views after restore', () => {
  it.each([
    ['Turd Rush', GameNightTurdRush, TURD_RUSH_RACE_VERSION, RUSH_COUNTDOWN_MS, [1, 'jump'], [2, 'slide']],
    ['Turdanoid', GameNightTurdanoid, TURDANOID_RACE_VERSION, BRICK_COUNTDOWN_MS, [1, 'aim', 640], [2, 'axis', 1]]
  ])('keeps %s spectators read-only after a checkpoint restore', (_game, Table, version, countdown, inputA, inputB) => {
    const host = 'race-host';
    const guest = 'race-guest';
    const watcher = 'race-watcher';
    const table = new Table(matchId, host);
    expect(table.join(guest, matchId, opened)).toBe(true);
    const at = opened + countdown;
    send(table, host, version, 1, [inputA], at);
    send(table, guest, version, 1, [inputB], at);

    const checkpoint = JSON.parse(JSON.stringify(table.checkpoint()));
    const restored = Table.restore(checkpoint);
    const first = restored.view(host, at);
    const second = restored.view(guest, at);
    const spectator = restored.view(watcher, at);
    expect(first.seat).toBe('a');
    expect(second.seat).toBe('b');
    expect(spectator.seat).toBeNull();
    expect(first.match.runner.queue).toEqual([inputA]);
    expect(second.match.runner.queue).toEqual([inputB]);
    expect(spectator.match.players).toEqual(first.match.players);
    assertWatcherHidesSeatPrivate(spectator.match, first.match, second.match);

    expect(restored.command(watcher, {
      id: matchId, version, action: 'input', sequence: 2, inputs: [inputA]
    }, at)).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(restored.checkpoint()).toEqual(checkpoint);
  });
});
