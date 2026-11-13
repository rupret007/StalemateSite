// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { JOIN_FUNNEL_EVENTS, JOIN_FUNNEL_SOURCES, JOIN_FUNNEL_STEPS, createJoinFunnel } from '../../hangout-worker/src/join-funnel.mjs';

function memoryStorage() {
    const rows = new Map();
    const deletes = [];
    const lists = [];
    let puts = 0;
    return {
        deletes, lists, rows,
        puts: () => puts,
        async get(key) { return rows.has(key) ? rows.get(key) : undefined; },
        async put(key, value) { puts += 1; rows.set(key, value); },
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

const dayKey = (day, source, event) => `jf:v1:${day}:${source}:${event}`;

describe('join funnel counters', () => {
    it('rejects unknown events and stores nothing about them', async () => {
        const storage = memoryStorage();
        let now = Date.parse('2026-11-12T18:00:00Z');
        const funnel = createJoinFunnel({ storage, now: () => now, retentionDays: 30 });
        for (const event of ['game_over', 'invite_created ', 'SEATED', 'rematch\n', '', 1, null, undefined]) {
            expect(await funnel.record(event, 'stalemate')).toBe(false);
        }
        expect(await funnel.record('nope', { ip: '203.0.113.9', ua: 'agent' })).toBe(false);
        expect(storage.puts()).toBe(0);
        expect(storage.rows.size).toBe(0);
        expect(JSON.stringify([...storage.rows])).not.toContain('203.0.113.9');
    });

    it('collapses every source outside the fixed set to unknown', async () => {
        const storage = memoryStorage();
        const funnel = createJoinFunnel({ storage, now: () => Date.parse('2026-11-12T18:00:00Z'), retentionDays: 7 });
        expect(await funnel.record('invite_created', 'stalemate')).toBe(true);
        expect(await funnel.record('invite_created', 'rad-dad')).toBe(true);
        expect(await funnel.record('invite_created', 'unknown')).toBe(true);
        for (const source of ['Rad-Dad', 'rad-dad ', 'STALEMATE', 'community-demo', '203.0.113.9', 'rad_dad', '', null]) {
            expect(await funnel.record('invite_created', source)).toBe(true);
        }
        expect(storage.rows.get(dayKey('2026-11-12', 'stalemate', 'invite_created'))).toBe(1);
        expect(storage.rows.get(dayKey('2026-11-12', 'rad-dad', 'invite_created'))).toBe(1);
        expect(storage.rows.get(dayKey('2026-11-12', 'unknown', 'invite_created'))).toBe(9);
        expect([...storage.rows.keys()].sort()).toEqual(JOIN_FUNNEL_SOURCES.map(source => dayKey('2026-11-12', source, 'invite_created')).sort());
        for (const [key, value] of storage.rows) {
            expect(key).toMatch(/^jf:v1:\d{4}-\d{2}-\d{2}:(stalemate|rad-dad|unknown):[a-z_]+$/);
            expect(Number.isSafeInteger(value)).toBe(true);
            expect(JSON.stringify({ key, value })).not.toContain('203.0.113.9');
        }
    });

    it('buckets by UTC day and serialises concurrent increments', async () => {
        const storage = memoryStorage();
        let now = Date.parse('2026-11-12T23:30:00Z');
        const funnel = createJoinFunnel({ storage, now: () => now, retentionDays: 7 });
        await funnel.record('seated', 'stalemate');
        now = Date.parse('2026-11-13T00:30:00Z');
        await Promise.all(Array.from({ length: 20 }, () => funnel.record('seated', 'stalemate')));
        expect(storage.rows.get(dayKey('2026-11-12', 'stalemate', 'seated'))).toBe(1);
        expect(storage.rows.get(dayKey('2026-11-13', 'stalemate', 'seated'))).toBe(20);
        expect(storage.rows.size).toBe(2);
    });

    it('suppresses small cells and publishes step ratios only from publishable counts', async () => {
        const storage = memoryStorage();
        let now = Date.parse('2026-11-12T18:00:00Z');
        const funnel = createJoinFunnel({ storage, now: () => now, retentionDays: 7 });
        const hit = (event, times, source = 'stalemate') => Promise.all(Array.from({ length: times }, () => funnel.record(event, source)));
        await hit('invite_created', 9);
        await hit('invite_opened', 3);
        await hit('redeemed', 2);
        await hit('room_joined', 4);
        await hit('seated', 8);
        await hit('game_finished', 3);
        await hit('install_card_shown', 3, 'rad-dad');
        const quiet = JSON.stringify(await funnel.report({ days: 1 }));
        expect(quiet).not.toContain('"redeemed":2');
        expect(quiet).not.toContain('"rematch":0');
        expect(quiet).not.toContain('"rematch":1');
        expect(quiet).not.toContain('"rematch":2');
        expect(quiet).toContain('"redeemed":"<3"');

        const report = await funnel.report({ days: 1 });
        const counts = report.days['2026-11-12'].counts.stalemate;
        expect(counts.invite_created).toBe(9);
        expect(counts.invite_opened).toBe(3);
        expect(counts.redeemed).toBe('<3');
        expect(counts.room_joined).toBe(4);
        expect(counts.seated).toBe(8);
        expect(counts.game_finished).toBe(3);
        expect(counts.rematch).toBe('<3');
        expect(counts.install_card_shown).toBe('<3');
        expect(report.days['2026-11-12'].counts['rad-dad'].install_card_shown).toBe(3);
        expect(report.totals.counts.stalemate.invite_opened).toBe(3);
        expect(report.totals.counts.stalemate.redeemed).toBe('<3');
        const steps = report.days['2026-11-12'].conversions.stalemate;
        expect(steps.map(step => [step.from, step.to])).toEqual([
            ['invite_created', 'invite_opened'],
            ['invite_opened', 'redeemed'],
            ['redeemed', 'room_joined'],
            ['room_joined', 'seated'],
            ['seated', 'game_finished'],
            ['game_finished', 'rematch']
        ]);
        expect(steps[0]).toMatchObject({ fromCount: 9, toCount: 3, ratio: 0.3333 });
        expect(steps[1]).toMatchObject({ fromCount: 3, toCount: '<3', ratio: null });
        expect(steps[3]).toMatchObject({ fromCount: 4, toCount: 8, ratio: 2 });
        expect(JSON.stringify(report.totals.conversions)).not.toContain('install_card_shown');
        expect(report.steps).toEqual([...JOIN_FUNNEL_STEPS]);
        expect(report.events).toEqual([...JOIN_FUNNEL_EVENTS]);

        await hit('invite_created', 1);
        const raised = await funnel.report({ days: 1, minCell: 5 });
        expect(raised.days['2026-11-12'].counts.stalemate.room_joined).toBe('<5');
        expect(raised.days['2026-11-12'].counts.stalemate.seated).toBe(8);
        expect(raised.minCell).toBe(5);

        now = Date.parse('2026-11-13T18:00:00Z');
        await hit('invite_created', 2);
        await hit('invite_opened', 2);
        const split = await funnel.report({ days: 2 });
        expect(split.days['2026-11-13'].counts.stalemate.invite_created).toBe('<3');
        expect(split.totals.counts.stalemate.invite_created).toBe('<3');
        expect(JSON.stringify(split.totals)).not.toMatch(/:1[14][,}]/);
        expect(split.days['2026-11-12'].conversions.stalemate[0].ratio).toBe(0.3);
    });

    it('limits a report to the retention window and does not write while reading', async () => {
        const storage = memoryStorage();
        let now = Date.parse('2026-11-10T12:00:00Z');
        const funnel = createJoinFunnel({ storage, now: () => now, retentionDays: 2 });
        for (const day of ['2026-11-10', '2026-11-11', '2026-11-12']) {
            now = Date.parse(`${day}T12:00:00Z`);
            for (let i = 0; i < 5; i++) await funnel.record('invite_created', 'unknown');
        }
        const puts = storage.puts();
        const report = await funnel.report({ days: 10 });
        expect(storage.puts()).toBe(puts);
        expect(Object.keys(report.days)).toEqual(['2026-11-11', '2026-11-12']);
        expect(report.totals.counts.unknown.invite_created).toBe(10);
        expect(report.from).toBe('2026-11-11');
        expect(report.to).toBe('2026-11-12');
        await expect(funnel.report({})).rejects.toThrow('days');
        await expect(funnel.report({ days: 1, minCell: 0 })).rejects.toThrow('minCell');
    });

    it('prunes days older than the retention window, including across the new year', async () => {
        const storage = memoryStorage();
        let now = Date.parse('2025-12-31T12:00:00Z');
        const funnel = createJoinFunnel({ storage, now: () => now, retentionDays: 1 });
        await funnel.record('redeemed', 'rad-dad');
        now = Date.parse('2026-01-01T12:00:00Z');
        await funnel.record('redeemed', 'rad-dad');
        storage.rows.set('jf:v1:203.0.113.9', 1);
        storage.rows.set('jf:v1:2026-01-01:stalemate:not_event', 4);
        storage.rows.set('notes:keep', { ip: '203.0.113.9' });
        expect(await funnel.prune()).toEqual({ deleted: 3 });
        expect([...storage.rows.keys()].sort()).toEqual(['jf:v1:2026-01-01:rad-dad:redeemed', 'notes:keep']);
        expect(storage.deletes.every(chunk => chunk.length <= 128)).toBe(true);
        expect(JSON.stringify([...storage.rows.keys()])).not.toContain('203.0.113.9');
    });

    it('keeps the default of 30 UTC days', async () => {
        const storage = memoryStorage();
        let now = Date.parse('2026-01-01T12:00:00Z');
        const funnel = createJoinFunnel({ storage, now: () => now });
        for (let day = 0; day < 31; day++) {
            now = Date.parse('2026-01-01T12:00:00Z') + day * 86400000;
            await funnel.record('invite_opened', 'stalemate');
        }
        await funnel.prune();
        expect(storage.rows.has(dayKey('2026-01-01', 'stalemate', 'invite_opened'))).toBe(false);
        expect(storage.rows.has(dayKey('2026-01-02', 'stalemate', 'invite_opened'))).toBe(true);
        expect(storage.rows.has(dayKey('2026-01-31', 'stalemate', 'invite_opened'))).toBe(true);
        expect(storage.rows.size).toBe(30);
    });

    it('deletes stale buckets in chunks of at most 128 keys', async () => {
        const storage = memoryStorage();
        let now = Date.parse('2026-01-01T12:00:00Z');
        const funnel = createJoinFunnel({ storage, now: () => now, retentionDays: 1 });
        for (let day = 0; day < 6; day++) {
            now = Date.parse('2026-01-01T12:00:00Z') + day * 86400000;
            for (const event of JOIN_FUNNEL_EVENTS) {
                for (const source of JOIN_FUNNEL_SOURCES) await funnel.record(event, source);
            }
        }
        expect(storage.rows.size).toBe(144);
        now = Date.parse('2026-01-10T12:00:00Z');
        expect(await funnel.prune()).toEqual({ deleted: 144 });
        expect(storage.deletes.map(chunk => chunk.length)).toEqual([128, 16]);
        expect(storage.lists.map(call => call.limit)).toEqual([128, 128]);
        expect(storage.lists[1].startAfter).toEqual(storage.deletes[0][127]);
        expect(storage.rows.size).toBe(0);
        expect(await funnel.prune()).toEqual({ deleted: 0 });
        expect(storage.deletes).toHaveLength(2);
    });

    it('refuses a storage handle or retention window it cannot bound', () => {
        const storage = memoryStorage();
        expect(() => createJoinFunnel({ now: () => 0 })).toThrow('storage');
        expect(() => createJoinFunnel({ storage, retentionDays: 30 })).toThrow('now');
        expect(() => createJoinFunnel({ storage, now: () => 0, retentionDays: 0 })).toThrow('retentionDays');
        expect(() => createJoinFunnel({ storage, now: () => 0, retentionDays: 1.5 })).toThrow('retentionDays');
        expect(() => createJoinFunnel({ storage, now: () => 0, retentionDays: 367 })).toThrow('retentionDays');
    });
});
