// @vitest-environment node

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const cssPath = join(dirname(fileURLToPath(import.meta.url)), '../../r/45662413410ed051/lobby/arcade-chess.css');
const css = readFileSync(cssPath, 'utf8');

function mediaBlock(header) {
    const start = css.indexOf(header);
    expect(start, header).toBeGreaterThanOrEqual(0);
    const open = css.indexOf('{', start);
    let depth = 0;
    for (let index = open; index < css.length; index += 1) {
        if (css[index] === '{') depth += 1;
        else if (css[index] === '}') {
            depth -= 1;
            if (depth === 0) return css.slice(open + 1, index);
        }
    }
    return '';
}

describe('Game Night Chess board size', () => {
    it('caps a desktop board at 640px from 1024px wide', () => {
        const block = mediaBlock('@media (min-width: 1024px)');
        expect(block).toMatch(/\.arcade-chess #board\s*\{[^}]*width:\s*min\(100%,\s*640px,\s*max\(15rem,\s*calc\(100dvh - 500px\)\)\)/);
        expect(block).toMatch(/max-width:\s*min\(100%,\s*640px\)/);
        expect(block).toContain('minmax(0, 640px) minmax(12rem, 1fr)');
    });

    it('keeps the 640px cap beside the match controls on a wide desktop', () => {
        const block = mediaBlock('@media (min-width: 1280px)');
        expect(block).toMatch(/\.arcade-chess #board\s*\{[^}]*width:\s*min\(100%,\s*640px,\s*max\(15rem,\s*calc\(100dvh - 400px\)\)\)/);
        expect(block).toMatch(/\.arcade-chess-clocks,\s*\.arcade-chess-actions\s*\{[^}]*grid-column:\s*2/);
        expect(block).toContain('minmax(0, 860px) minmax(12rem, 1fr)');
    });

    it('floors a tall phone board at 352px without exceeding the panel', () => {
        const block = mediaBlock('@media (max-width: 430px) and (min-height: 800px)');
        expect(block).toMatch(/\.arcade-chess #board\s*\{[^}]*width:\s*min\(100%,\s*25rem,\s*max\(352px,\s*calc\(100dvh - 465px\)\)\)/);
    });

    it('keeps the short-phone height cap and the match-control inset', () => {
        const phone = mediaBlock('@media (max-width: 900px)');
        expect(phone).toMatch(/\.arcade-chess #board\s*\{[^}]*width:\s*min\(100%,\s*25rem,\s*max\(12\.5rem,\s*calc\(100dvh - 465px\)\)\)/);
        const inset = mediaBlock('@media (max-width: 430px) and (min-height: 451px)');
        expect(inset).toContain('padding-inline: .375rem');
        expect(inset).toContain('.tabs { padding-top: 0; }');
        expect(inset).toContain('.roombar { padding-block: 2px; }');
        expect(inset).toContain('.buffer:not(:has(:focus-visible)) { min-height: 24px; }');
    });
});
