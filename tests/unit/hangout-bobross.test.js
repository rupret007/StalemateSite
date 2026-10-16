// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const B = require('../../r/45662413410ed051/bob-ross.js');
const H = require('../../r/45662413410ed051/sync-core.js');

describe('Bob Ross Paint-Along data', () => {
    it('ships 10-12 unique, well-formed episodes with season/episode and a one-liner', () => {
        expect(B.EPISODES.length).toBeGreaterThanOrEqual(10);
        expect(B.EPISODES.length).toBeLessThanOrEqual(12);
        expect(new Set(B.EPISODES.map((e) => e.id)).size).toBe(B.EPISODES.length);
        for (const ep of B.EPISODES) {
            expect(H.parseYouTubeId(ep.id)).toBe(ep.id);
            expect(ep.title.length).toBeGreaterThan(2);
            expect(Number.isInteger(ep.s) && ep.s >= 1 && ep.s <= 31).toBe(true);
            expect(Number.isInteger(ep.e) && ep.e >= 1 && ep.e <= 13).toBe(true);
            expect(ep.blurb.length).toBeGreaterThan(10);
            expect(ep.blurb.length).toBeLessThan(90);
            expect(['Easy', 'Medium', 'Spicy']).toContain(ep.level);
        }
        expect(B.EPISODES.filter((e) => e.level === 'Easy').length).toBeGreaterThanOrEqual(3);
        expect(B.label(B.findEpisode('oh5p5f5_-7A'))).toBe('S1 E1');
        expect(B.findEpisode('nope')).toBeNull();
    });

    it('has the full classic palette, and every color survives the sync core filter', () => {
        const names = B.PALETTE.map((p) => p.name);
        expect(names).toEqual(['Titanium White', 'Phthalo Blue', 'Prussian Blue', 'Midnight Black', 'Dark Sienna', 'Van Dyke Brown',
            'Alizarin Crimson', 'Sap Green', 'Cadmium Yellow', 'Yellow Ochre', 'Indian Yellow', 'Bright Red']);
        for (const p of B.PALETTE) {
            expect(p.hex).toMatch(/^#[0-9a-f]{6}$/);
            expect(H.COLORS).toContain(p.hex);
            expect(H.cleanStroke({ id: 'x', color: p.hex, size: 10, pts: [[0.1, 0.1]] })).not.toBeNull();
        }
        expect(H.cleanStroke({ id: 'x', color: '#123456', size: 10, pts: [[0.1, 0.1]] })).toBeNull();
    });

    it('brush sizes stay inside the core clamp and the slider range', () => {
        const html = readFileSync(new URL('../../r/45662413410ed051/index.html', import.meta.url), 'utf8');
        const max = Number(/data-size/.test(html) && html.match(/max="(\d+)" value="\d+" data-size/)[1]);
        for (const br of B.BRUSHES) { expect(br.size).toBeGreaterThanOrEqual(2); expect(br.size).toBeLessThanOrEqual(max); }
        expect(max).toBeLessThanOrEqual(48);
    });

    it('copy stays punk: no ska wording anywhere in the room', () => {
        for (const f of ['index.html', 'room.js', 'bob-ross.js']) {
            const text = readFileSync(new URL(`../../r/45662413410ed051/${f}`, import.meta.url), 'utf8');
            expect(text).not.toMatch(/\bska\b/i);
        }
    });
});
