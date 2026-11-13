// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createNightScore } from '../../hangout-worker/src/game-night-night-score.mjs';

function memoryStorage() {
    const rows = new Map();
    const deletes = [];
    const lists = [];
    return {
        deletes, lists, rows,
        async get(key) { return rows.has(key) ? rows.get(key) : undefined; },
        async put(key, value) { rows.set(key, value); },
        async delete(keyOrKeys) {
            const chunk = Array.isArray(keyOrKeys) ? [...keyOrKeys] : [keyOrKeys];
            deletes.push(chunk);
            for (const key of chunk) rows.delete(key);
        },
        async list(options = {}) {
            lists.push({ ...options });
            const prefix = options.prefix || '';
            const limit = options.limit ?? 128;
            const keys = [...rows.keys()].filter(key => key.startsWith(prefix) && (options.startAfter === undefined || key > options.startAfter)).sort();
            const page = new Map();
            for (const key of keys.slice(0, limit)) page.set(key, rows.get(key));
            return page;
        }
    };
}

const ROOM = '#game-abc123xdef456';

describe('game night score', () => {
    it('scores wins, trims nicks, and keeps draws off the win column', async () => {
        const storage = memoryStorage();
        const now = Date.parse('2026-07-15T18:00:00Z');
        const score = createNightScore({ storage, now: () => now });
        expect(await score.recordResult(ROOM, { winnerNick: '  Sam  ', players: ['  Sam  ', 'Sam', 'Ana'] })).toBe(true);
        await score.recordResult(ROOM, { winnerNick: 'Sam', players: ['Sam', 'Ana'] });
        await score.recordResult(ROOM, { winnerNick: 'Sam', players: ['Sam', 'Ana'] });
        await score.recordResult(ROOM, { winnerNick: 'Ana', players: ['Ana', 'Sam'] });
        await score.recordResult(ROOM, { winnerNick: 'Ana', players: ['Ana', 'Sam'] });
        await score.recordResult(ROOM, { winnerNick: 'Sam', players: ['Sam', 'Ana'], draw: true });
        const view = await score.tonight(ROOM);
        expect(view.night).toBe('2026-07-15');
        expect(view.standings).toEqual([
            { nick: 'Sam', wins: 3, draws: 1 },
            { nick: 'Ana', wins: 2, draws: 1 }
        ]);
        expect(view.display).toBe('Tonight: Sam 3 (1 draw) \u00b7 Ana 2 (1 draw)');
        view.standings[0].wins = 99;
        view.standings.push({ nick: 'Hacker', wins: 9, draws: 0 });
        expect((await score.tonight(ROOM)).standings[0]).toEqual({ nick: 'Sam', wins: 3, draws: 1 });
        const stored = storage.rows.get('ns:v1:2026-07-15:' + ROOM);
        expect(stored.every(row => Object.keys(row).sort().join() === 'draws,nick,wins')).toBe(true);
        expect(JSON.stringify(stored)).not.toContain(ROOM);
        expect(JSON.stringify(stored)).not.toMatch(/\d{4}-\d{2}-\d{2}T/);

        const draws = createNightScore({ storage: memoryStorage(), now: () => now });
        await draws.recordResult('#draw-room', { winnerNick: 'Sam', players: ['Sam', 'Ana'], draw: true });
        const drawn = await draws.tonight('#draw-room');
        expect(drawn.standings).toEqual([
            { nick: 'Ana', wins: 0, draws: 1 },
            { nick: 'Sam', wins: 0, draws: 1 }
        ]);
        expect(drawn.display).toBe('Tonight: Ana 1 draw \u00b7 Sam 1 draw');
        expect(await draws.recordResult('#draw-room', { winnerNick: 'Sam', players: ['Sam', 'Ana'], draw: 'true' })).toBe(true);
        expect((await draws.tonight('#draw-room')).standings.find(row => row.nick === 'Sam').wins).toBe(1);
    });

    it('caps nicks at 24 code points and a room night at 12 players', async () => {
        const storage = memoryStorage();
        const score = createNightScore({ storage, now: () => Date.parse('2026-07-15T18:00:00Z') });
        const dice = '🎲'.repeat(25);
        expect(await score.recordResult('#dice-room', { winnerNick: dice, players: [dice, '  ', 'A\nB'] })).toBe(true);
        const row = (await score.tonight('#dice-room')).standings[0];
        expect(row.nick).toBe('🎲'.repeat(24));
        expect(Array.from(row.nick)).toHaveLength(24);
        expect(row.wins).toBe(1);
        expect(await score.recordResult('#dice-room', { winnerNick: 'A\nB', players: ['A\nB'] })).toBe(false);

        const players = Array.from({ length: 13 }, (_, index) => `p${index}`);
        expect(await score.recordResult('#cap-room', { winnerNick: 'p0', players })).toBe(true);
        expect((await score.tonight('#cap-room')).standings).toHaveLength(12);
        expect((await score.tonight('#cap-room')).standings.map(item => item.nick)).not.toContain('p12');
        await score.recordResult('#cap-room', { winnerNick: 'p0', players: ['p0', 'p12'] });
        const capped = await score.tonight('#cap-room');
        expect(capped.standings.find(item => item.nick === 'p0').wins).toBe(2);
        expect(capped.standings.map(item => item.nick)).not.toContain('p12');
        expect(storage.rows.get('ns:v1:2026-07-15:#cap-room')).toHaveLength(12);
    });

    it('counts a finish before 06:00 Chicago time toward the previous night, including DST changes', async () => {
        const storage = memoryStorage();
        let now = Date.parse('2026-11-01T11:59:00Z');
        const score = createNightScore({ storage, now: () => now });
        await score.recordResult(ROOM, { winnerNick: 'Sam', players: ['Sam', 'Ana'] });
        expect((await score.tonight(ROOM)).night).toBe('2026-10-31');
        now = Date.parse('2026-11-01T12:00:00Z');
        expect(await score.tonight(ROOM)).toEqual({ night: '2026-11-01', standings: [], display: 'Tonight: no results yet' });
        await score.recordResult(ROOM, { winnerNick: 'Ana', players: ['Ana', 'Sam'] });
        expect((await score.tonight(ROOM)).display).toBe('Tonight: Ana 1');
        expect(storage.rows.has('ns:v1:2026-10-31:' + ROOM)).toBe(true);
        expect(storage.rows.has('ns:v1:2026-11-01:' + ROOM)).toBe(true);

        now = Date.parse('2026-03-08T10:59:00Z');
        await score.recordResult('#spring-room', { winnerNick: 'Sam', players: ['Sam'] });
        expect((await score.tonight('#spring-room')).night).toBe('2026-03-07');
        now = Date.parse('2026-03-08T11:00:00Z');
        await score.recordResult('#spring-room', { winnerNick: 'Ana', players: ['Ana'] });
        expect((await score.tonight('#spring-room')).night).toBe('2026-03-08');
        expect((await score.tonight('#spring-room')).standings).toEqual([{ nick: 'Ana', wins: 1, draws: 0 }]);

        now = Date.parse('2026-07-15T10:59:00Z');
        await score.recordResult('#summer-room', { winnerNick: 'Sam', players: ['Sam'] });
        expect((await score.tonight('#summer-room')).night).toBe('2026-07-14');
        now = Date.parse('2026-07-15T11:00:00Z');
        expect((await score.tonight('#summer-room')).night).toBe('2026-07-15');
    });

    it('drops a night 24h after it ends and deletes in chunks of at most 128', async () => {
        const storage = memoryStorage();
        let now = Date.parse('2026-10-31T11:00:00Z');
        const score = createNightScore({ storage, now: () => now });
        await score.recordResult(ROOM, { winnerNick: 'Sam', players: ['Sam'] });
        now = Date.parse('2026-11-02T11:00:00Z');
        expect(await score.prune()).toEqual({ deleted: 0 });
        expect(storage.rows.has('ns:v1:2026-10-31:' + ROOM)).toBe(true);
        now = Date.parse('2026-11-02T12:00:00Z');
        expect(await score.prune()).toEqual({ deleted: 1 });
        expect(storage.rows.has('ns:v1:2026-10-31:' + ROOM)).toBe(false);

        now = Date.parse('2026-03-07T12:00:00Z');
        await score.recordResult('#spring-room', { winnerNick: 'Sam', players: ['Sam'] });
        now = Date.parse('2026-03-09T10:00:00Z');
        expect((await score.prune()).deleted).toBe(0);
        now = Date.parse('2026-03-09T11:00:00Z');
        expect(await score.prune()).toEqual({ deleted: 1 });
        expect(storage.rows.has('ns:v1:2026-03-07:#spring-room')).toBe(false);

        now = Date.parse('2026-01-01T18:00:00Z');
        for (let index = 0; index < 129; index++) {
            const room = `#r${String(index).padStart(2, '0')}`;
            expect(await score.recordResult(room, { winnerNick: 'Sam', players: ['Sam'] })).toBe(true);
        }
        now = Date.parse('2026-01-02T18:00:00Z');
        await score.recordResult('#kept-room', { winnerNick: 'Ana', players: ['Ana'] });
        storage.rows.set('ns:v1:not-a-night:#kept-room', [{ nick: 'Secret', wins: 1, draws: 0 }]);
        storage.rows.set('notes:keep', 1);
        now = Date.parse('2026-01-03T12:00:00Z');
        const pruned = await score.prune();
        expect(pruned.deleted).toBe(130);
        expect(storage.deletes.map(chunk => chunk.length)).toEqual([1, 1, 128, 2]);
        expect(storage.deletes.every(chunk => chunk.length <= 128)).toBe(true);
        expect(storage.rows.has('ns:v1:2026-01-02:#kept-room')).toBe(true);
        expect(storage.rows.has('notes:keep')).toBe(true);
        expect(JSON.stringify([...storage.rows.keys()])).not.toContain('not-a-night');
        now = Date.parse('2026-01-02T18:00:00Z');
        expect((await score.tonight('#kept-room')).display).toBe('Tonight: Ana 1');
        expect(await score.tonight('room')).toEqual({ night: null, standings: [], display: 'Tonight: no results yet' });
    });

    it('rejects rooms and clocks it cannot score', async () => {
        const storage = memoryStorage();
        const score = createNightScore({ storage, now: () => Date.parse('2026-07-15T18:00:00Z') });
        expect(await score.recordResult('not a room', { winnerNick: 'Sam', players: ['Sam'] })).toBe(false);
        expect(await score.recordResult('#ab', { winnerNick: 'Sam', players: ['   '] })).toBe(false);
        expect(await score.recordResult('#ab', { players: ['Sam'] })).toBe(false);
        expect(storage.rows.size).toBe(0);
        expect(() => createNightScore({ storage, now: () => 0, timeZone: 'Not/AZone' })).toThrow('timeZone');
        expect(() => createNightScore({ storage, timeZone: 'America/Chicago' })).toThrow('now');
        const broken = createNightScore({ storage, now: () => Number.NaN });
        await expect(broken.recordResult('#ab', { winnerNick: 'Sam', players: ['Sam'] })).rejects.toThrow('now');
    });
});
