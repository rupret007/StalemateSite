import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TurdanoidBrickRace } from '../../hangout-worker/arcade/games/turdanoid-race.js';
import { GameNightTurdanoid } from '../../hangout-worker/src/game-night-turdanoid.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workerGame = path.join(root, 'hangout-worker/arcade/games/turdanoid-race.js');
const playGame = path.join(root, 'play/games/turdanoid-race.js');
const deniedRunner = ['queue', 'credits', 'sequence', 'lastInputTick', 'chargedAt'];
const deniedRun = ['aim', 'axis'];

function send(race, seat, sequence, inputs, now) {
    expect(race.command(seat, { id: race.checkpoint().id, version: 1, action: 'input', sequence, inputs }, now)).toMatchObject({ ok: true });
}

function seatPrivate(runner) {
    return {
        queue: runner.queue,
        credits: runner.credits,
        sequence: runner.sequence,
        lastInputTick: runner.lastInputTick,
        chargedAt: runner.chargedAt,
        aim: runner.run.aim,
        axis: runner.run.axis
    };
}

function assertDistinctPrivate(seatA, seatB) {
    const a = seatPrivate(seatA.runner);
    const b = seatPrivate(seatB.runner);
    expect(a.queue.length).toBeGreaterThan(0);
    expect(b.queue.length).toBeGreaterThan(0);
    expect(a.queue).not.toEqual(b.queue);
    expect(a.aim).not.toBe(b.aim);
    expect(a.axis).not.toBe(b.axis);
    expect(a.lastInputTick).not.toBe(b.lastInputTick);
    expect(a.credits).not.toBe(undefined);
    expect(a.sequence).not.toBe(undefined);
    expect(a.chargedAt).not.toBe(undefined);
}

// The watcher clones runner and appends local controls onto queue before painting run.
function watcherBoard(match) {
    const visual = structuredClone(match.runner);
    const buffer = [];
    const flights = [];
    visual.queue.push(...[...flights.flatMap(flight => flight.inputs), ...buffer].filter(input => input[0] > visual.tick));
    visual.queue.sort((left, right) => left[0] - right[0]);
    return visual;
}

function assertPublicRace(watch, seatA, seatB) {
    expect(watch.players).toEqual({
        a: { status: seatA.players.a.status, lives: seatA.players.a.lives, broken: seatA.players.a.broken, score: seatA.players.a.score },
        b: { status: seatB.players.b.status, lives: seatB.players.b.lives, broken: seatB.players.b.broken, score: seatB.players.b.score }
    });
    expect(watch.wall).toEqual(seatA.wall);
    expect(watch.tick).toBe(seatA.tick);
    expect(watch.runner).not.toEqual(seatA.runner);
    expect(watch.runner).not.toEqual(seatB.runner);

    // queue is the watcher's local buffer, so it stays present and empty. Every other denylisted field is omitted.
    expect(watch.runner.queue).toEqual([]);
    for (const field of deniedRunner) {
        if (field === 'queue') {
            expect(watch.runner.queue).not.toEqual(seatA.runner.queue);
            expect(watch.runner.queue).not.toEqual(seatB.runner.queue);
            continue;
        }
        expect(watch.runner).not.toHaveProperty(field);
        expect(watch.runner).not.toHaveProperty(field, seatA.runner[field]);
        expect(watch.runner).not.toHaveProperty(field, seatB.runner[field]);
    }
    for (const field of deniedRun) {
        expect(watch.runner.run).not.toHaveProperty(field);
        expect(watch.runner.run).not.toHaveProperty(field, seatA.runner.run[field]);
        expect(watch.runner.run).not.toHaveProperty(field, seatB.runner.run[field]);
    }

    const snapshot = JSON.stringify(watch);
    for (const seated of [seatA, seatB]) {
        expect(snapshot).not.toContain(JSON.stringify(seatPrivate(seated.runner).queue));
    }
    for (const field of ['credits', 'sequence', 'lastInputTick', 'chargedAt', 'aim', 'axis']) {
        expect(snapshot).not.toContain(`"${field}"`);
    }

    const board = watcherBoard(watch);
    expect(board.queue).toEqual([]);
    expect(board.run.ball).toEqual(seatA.runner.run.ball);
    expect(board.run.paddleX).toBe(seatA.runner.run.paddleX);
    expect(board.run.hp).toEqual(seatA.runner.run.hp);
    expect(board.run.status).toBe(seatA.runner.run.status);
    expect(board.run.powers).toEqual(seatA.runner.run.powers);
}

function playToPrivateInputs(race, opened) {
    const starts = opened + 3_000;
    send(race, 'a', 1, [[1, 'aim', 640]], starts);
    send(race, 'b', 1, [[1, 'axis', -1]], starts);
    const later = starts + 400;
    send(race, 'a', 2, [[20, 'aim', 100]], later);
    send(race, 'b', 2, [[21, 'axis', 1]], later);
    return later;
}

describe('Turdanoid watch view privacy', () => {
    it('shows public race state without either racer’s seat-private fields', () => {
        const opened = 50_000;
        const race = new TurdanoidBrickRace('watch-race-1', opened, null, 1);
        const later = playToPrivateInputs(race, opened);
        const seatA = race.view('a', later);
        const seatB = race.view('b', later);
        assertDistinctPrivate(seatA, seatB);
        expect(readFileSync(playGame).equals(readFileSync(workerGame))).toBe(true);

        for (const seat of [null, undefined, 'watcher']) {
            assertPublicRace(race.view(seat, later), seatA, seatB);
        }
        expect(seatA.runner.queue).toEqual([[20, 'aim', 100]]);
        expect(seatB.runner.queue).toEqual([[21, 'axis', 1]]);
        expect(seatA.runner).toHaveProperty('chargedAt');
        expect(seatB.runner.run).toHaveProperty('axis');
    });

    it('gives an unseated table viewer no seat-private fields', () => {
        const id = 'watch-race-1';
        const opened = 50_000;
        const table = new GameNightTurdanoid(id, 'host-one');
        expect(table.join('guest-two', id, opened)).toBe(true);
        const starts = opened + 3_000;
        const frame = (sequence, inputs) => ({ version: 1, id, action: 'input', sequence, inputs });
        expect(table.command('host-one', frame(1, [[1, 'aim', 640]]), starts)).toMatchObject({ ok: true });
        expect(table.command('guest-two', frame(1, [[1, 'axis', -1]]), starts)).toMatchObject({ ok: true });
        const later = starts + 400;
        expect(table.command('host-one', frame(2, [[20, 'aim', 100]]), later)).toMatchObject({ ok: true });
        expect(table.command('guest-two', frame(2, [[21, 'axis', 1]]), later)).toMatchObject({ ok: true });

        const watcher = table.view('watcher-three', later);
        const host = table.view('host-one', later);
        const guest = table.view('guest-two', later);
        expect(watcher.seat).toBeNull();
        expect(host.seat).toBe('a');
        expect(guest.seat).toBe('b');
        assertDistinctPrivate(host.match, guest.match);
        assertPublicRace(watcher.match, host.match, guest.match);
        expect(host.match.runner).toHaveProperty('queue', [[20, 'aim', 100]]);
        expect(guest.match.runner.run).toHaveProperty('axis', -1);
    });
});
