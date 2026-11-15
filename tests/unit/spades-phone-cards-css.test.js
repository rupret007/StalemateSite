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
const spadesHand = rules(phone).filter(rule => rule.selector.includes('.arcade-spades') && rule.selector.includes('.arcade-card-hand'));

describe('Spades phone hand cards', () => {
    it('keeps each card at least 44px by 50px with an 18px face inside the phone block', () => {
        expect(spadesHand.length).toBeGreaterThan(0);
        for (const rule of spadesHand) {
            expect(rule.selector.startsWith('.arcade-spades')).toBe(true);
            expect(rule.selector).not.toMatch(/\.arcade-(?:eights|rummy|jack|chess)\b/);
        }
        const buttons = spadesHand.filter(rule => rule.selector.includes('button'));
        expect(buttons).toHaveLength(1);
        expect(buttons[0].body).toMatch(/min-width:\s*44px/);
        expect(buttons[0].body).toMatch(/min-height:\s*50px/);
        expect(buttons[0].body).not.toMatch(/opacity\s*:/);
        expect(buttons[0].body).not.toMatch(/border-color\s*:/);

        const faces = spadesHand.filter(rule => /\bb\b/.test(rule.selector));
        expect(faces).toHaveLength(1);
        const size = faces[0].body.match(/font-size:\s*(\d+(?:\.\d+)?)px/);
        expect(size, faces[0].body).toBeTruthy();
        expect(Number(size[1])).toBeGreaterThanOrEqual(18);
    });

    it('keeps the seven-card row and the faded unplayable cards', () => {
        expect(css).toMatch(/\.arcade-spades \.arcade-card-hand \{ grid-template-columns: repeat\(7, minmax\(0, 1fr\)\); \}/);
        const columns = spadesHand.filter(rule => rule.body.includes('grid-template-columns'));
        expect(columns).toHaveLength(0);
        expect(css).toMatch(/\.arcade-spades \.arcade-card-hand \[data-cannot-follow\] \{ opacity: \.52; \}/);
    });
});
