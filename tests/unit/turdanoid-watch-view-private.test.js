import { describe, expect, it } from 'vitest';
import { TurdanoidBrickRace } from '../../play/games/turdanoid-race.js';

describe('Turdanoid watch view privacy', () => {
    it.fails('shows public race state without either racer’s seat-private fields', () => {
        const race = new TurdanoidBrickRace('watch-race-1', 50_000, null, 1);
        const watch = race.view(null, 50_000);
        const seatA = race.view('a', 50_000);
        const seatB = race.view('b', 50_000);

        expect(watch.players).toEqual({
            a: { status: seatA.players.a.status, lives: seatA.players.a.lives, broken: seatA.players.a.broken, score: seatA.players.a.score },
            b: { status: seatB.players.b.status, lives: seatB.players.b.lives, broken: seatB.players.b.broken, score: seatB.players.b.score }
        });
        expect(watch.players.a.score).toBe(seatA.players.a.score);
        expect(watch.players.b.score).toBe(seatB.players.b.score);

        // Expected failure: game.view(null) falls back to racer A at hangout-worker/arcade/games/turdanoid-race.js:262.
        for (const field of ['queue', 'credits', 'sequence', 'lastInputTick']) {
            expect(watch.runner).not.toHaveProperty(field);
        }
        expect(watch.runner.run).not.toHaveProperty('aim');
        for (const field of ['queue', 'credits', 'sequence', 'lastInputTick']) {
            expect(watch.runner).not.toHaveProperty(field, seatB.runner[field]);
        }
        expect(watch.runner.run).not.toHaveProperty('aim', seatB.runner.run.aim);
    });
});
