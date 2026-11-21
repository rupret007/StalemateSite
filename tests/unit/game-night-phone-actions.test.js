import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

import { productRoomName } from '../support/product-room.cjs';
const lobby = join(dirname(fileURLToPath(import.meta.url)), `../../r/${productRoomName}/lobby`);
const readLobby = name => readFileSync(join(lobby, name), 'utf8');
const phoneMedia = new Set([
    '(max-width: 900px)',
    '(max-width: 430px) and (min-height: 451px)'
]);
const games = [
    ['chess', 'chess', '[data-chess-primary], [data-chess-start-rematch]', 2],
    ['crapeights', 'eights', '[data-eights-main], [data-start-rematch]', 2],
    ['turdrummy', 'rummy', '[data-rummy-main], [data-start-rematch]', 2],
    ['turdspades', 'spades', '[data-spades-main], [data-spades-partners], [data-spades-start-rematch]', 3],
    ['turdjack', 'jack', '[data-jack-main], [data-start-rematch]', 2],
    ['turdtris', 'tris', '.tris-actions .btn', 3],
    ['turdomania', 'mania', '.mania-actions .btn', 3],
    ['turdrush', 'rush-race', '.rush-race-actions .btn', 3],
    ['turdanoid', 'brick-race', '.brick-race-actions .btn', 3]
];

it.each(games)('%s declares the tap floor for opening and rematching on a phone', (game, panel, selector, count) => {
    const fixture = document.implementation.createHTMLDocument();
    const style = document.createElement('style');
    // An attached style element in the test window gives us CSSOM rules.
    style.textContent = readLobby('lobby.css') + readLobby('arcade-chess.css');
    document.head.append(style);
    try {
        const markup = readLobby(`arcade-${game}.mjs`).match(/const markup = `([\s\S]*?)`;\n/)[1];
        fixture.body.innerHTML = `<section class="game-night"><details class="arcade-card-table arcade-${panel}" open>${markup}</details></section>`;
        const controls = [...fixture.querySelectorAll(selector)];
        expect(controls).toHaveLength(count);
        // These are the two responsive rules for the action floor at 390×844.
        const rules = [...style.sheet.cssRules]
            .filter(rule => rule.media && phoneMedia.has(rule.media.mediaText))
            .flatMap(rule => [...rule.cssRules]);
        for (const control of controls) {
            const applicable = rules.filter(rule => rule.selectorText && control.matches(rule.selectorText));
            for (const property of ['min-width', 'min-height']) {
                expect(applicable.some(rule => rule.style.getPropertyValue(property) === '48px'), property).toBe(true);
            }
        }
    } finally {
        style.remove();
    }
});
