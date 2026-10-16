// @vitest-environment node
// The 🎲 name generator: thousands of combos, all family-friendly, every one passes the server nick filter.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { checkNick } from '../../hangout-worker/src/filter.mjs';

const src = readFileSync(fileURLToPath(new URL('../../r/45662413410ed051/names.js', import.meta.url)), 'utf8');
const ctx = {};
vm.runInNewContext(src, ctx);
const { roll, all, LEGENDARY } = ctx.StaleNames;

describe('StaleNames', () => {
    const every = all();
    it('has thousands of combinations', () => { expect(every.length).toBeGreaterThan(5000); });
    it('every possible output passes the server nick filter (no slurs, sexual words or reserved names)', () => {
        const bad = every.filter((n) => !checkNick(n).ok);
        expect(bad).toEqual([]);
    }, 120000);
    it('rolls vary, legendaries are rare but real', () => {
        const seen = new Set();
        let legend = 0;
        for (let i = 0; i < 5000; i += 1) { const r = roll(); seen.add(r.name); if (r.legendary) { legend += 1; expect(LEGENDARY).toContain(r.name); } expect(checkNick(r.name).ok, r.name).toBe(true); }
        expect(seen.size).toBeGreaterThan(3000);
        expect(legend).toBeGreaterThan(30);
        expect(legend).toBeLessThan(250);
    }, 60000);
});
