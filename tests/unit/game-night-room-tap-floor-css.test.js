// @vitest-environment node

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const css = readFileSync(join(root, 'r/45662413410ed051/lobby/lobby.css'), 'utf8');

function mediaBlock(source, header) {
    const start = source.indexOf(header);
    expect(start, header).toBeGreaterThanOrEqual(0);
    const open = source.indexOf('{', start);
    let depth = 0;
    for (let index = open; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        else if (source[index] === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(open + 1, index);
        }
    }
    throw new Error(`unclosed ${header}`);
}

function rules(block) {
    const source = block.replace(/\/\*[\s\S]*?\*\//g, '');
    return [...source.matchAll(/([^{}]+)\{([^{}]+)\}/g)].map(([, selector, body]) => ({
        selector: selector.trim(),
        body
    }));
}

const phone = mediaBlock(css, '@media (max-width: 430px) and (min-height: 451px)');
const floor = rules(phone).filter(rule => rule.selector.includes('body:has(.game-night:not([hidden]))'));

function hasFloor(selector, property) {
    return floor.some(rule => rule.selector.includes(selector)
        && new RegExp(`${property}:\\s*44px\\s*!important`).test(rule.body));
}

describe('Game Night room tap floor', () => {
    it('keeps each listed room control at least 44px by 44px while a room is open', () => {
        expect(floor.length).toBeGreaterThan(0);
        for (const rule of floor) {
            expect(rule.selector.startsWith('body:has(.game-night:not([hidden]))')).toBe(true);
        }

        // Room tabs, Host tools, Room address, Open Arcade, and Launch ball need both axes in the floor.
        // Launch ball is button.btn.btn--small[data-brick-serve]; .btn--small alone is only 38px tall.
        for (const selector of ['.tabs button', '.roombar .btn', '.game-actions .btn', '[data-brick-serve]']) {
            expect(hasFloor(selector, 'min-width'), selector).toBe(true);
            expect(hasFloor(selector, 'min-height'), selector).toBe(true);
        }
        expect(floor.some(rule => rule.selector.includes('button.btn.btn--small[data-brick-serve]'))).toBe(true);

        // Send is 58px wide from the phone composer rule; the floor only has to lift its 36px height.
        expect(hasFloor('.say .btn', 'min-height')).toBe(true);
        expect(hasFloor('.say .btn', 'min-width')).toBe(false);
        expect(css).toMatch(/\.say \.btn \{[^}]*min-width:\s*58px/);

        // Commands is 33px wide on a phone until the floor; its 46px height already clears 44.
        expect(hasFloor('.slash', 'min-width')).toBe(true);
        expect(hasFloor('.slash', 'min-height')).toBe(false);
        expect(css).toMatch(/\.slash \{[^}]*min-height:\s*46px/);
    });

    it('leaves the Spades hand, transcript minimum, and Rush track rules in place', () => {
        expect(phone).toMatch(/\.arcade-spades \.arcade-card-hand button \{[^}]*min-height:\s*50px/);
        expect(phone).toMatch(/\.chat:has\(\.arcade-eights\[open\] \[data-card-table\]:not\(\[hidden\]\)\) \.buffer:not\(:has\(:focus-visible\)\) \{ min-height: 34px; \}/);
        expect(phone).toMatch(/\.rush-race-track \{ height: clamp\(132px, calc\(100dvh - 521px\), 275px\); \}/);
    });
});
