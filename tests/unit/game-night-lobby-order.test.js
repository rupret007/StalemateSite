// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
import {
    arcadeLobbyPanelSelector,
    GAME_NIGHT_LOBBY_GRID_AREA,
    GAME_NIGHT_LOBBY_ORDER,
    gameNightLabels,
    placeArcadePanelInLobbyOrder,
} from '../../r/45662413410ed051/lobby/game-night.mjs';

const OLD_LOBBY_ORDER = Object.freeze([
    'chess', 'crapeights', 'turdrummy', 'turdspades', 'turdjack', 'turdtris', 'turdomania', 'turdrush', 'turdanoid'
]);

const OLD_DESKTOP_GRID_ROW_AREAS = ['chess', 'eights', 'rummy', 'spades', 'jack', 'tris', 'mania', 'rush', 'brick'];

function expectedDesktopGridRowAreas() {
    return GAME_NIGHT_LOBBY_ORDER.map(game => GAME_NIGHT_LOBBY_GRID_AREA[game]);
}

function readDesktopCardTableGridRowAreas() {
    const css = readFileSync(join(repoRoot, 'r/45662413410ed051/lobby/lobby.css'), 'utf8');
    const block = css.match(
        /\.game-night:has\(\.arcade-card-table\[open\] \[data-card-table\]:not\(\[hidden\]\)\)\s*\{[^}]*grid-template:\s*([^;]+);/
    );
    expect(block, 'desktop open card-table grid block').toBeTruthy();
    return [...block[1].matchAll(/"cards\s+(\w+)"/g)].map(match => match[1])
        .filter(area => !['heading', 'actions', 'call'].includes(area));
}

describe('Game Night beta lobby lineup', () => {
    it('puts Chess, TurdSpades, and Turdanoid first', () => {
        expect(GAME_NIGHT_LOBBY_ORDER.slice(0, 3)).toEqual(['chess', 'turdspades', 'turdanoid']);
    });

    it('keeps the remaining games in the previous tail order', () => {
        expect(GAME_NIGHT_LOBBY_ORDER.slice(3)).toEqual(OLD_LOBBY_ORDER.filter(
            game => !['chess', 'turdspades', 'turdanoid'].includes(game)
        ));
    });

    it('rejects the pre-lineup order', () => {
        expect([...GAME_NIGHT_LOBBY_ORDER]).not.toEqual([...OLD_LOBBY_ORDER]);
    });

    it('covers every beta lobby game label and no extras', () => {
        expect(GAME_NIGHT_LOBBY_ORDER).toHaveLength(9);
        expect([...GAME_NIGHT_LOBBY_ORDER].sort()).toEqual(Object.keys(gameNightLabels).sort());
    });

    it('wires lobby.js arcadeTables through GAME_NIGHT_LOBBY_ORDER', () => {
        const lobby = readFileSync(join(repoRoot, 'r/45662413410ed051/lobby/lobby.js'), 'utf8');
        expect(lobby).toContain('GAME_NIGHT_LOBBY_ORDER.map(game => [game, arcadeTableDefs[game]])');
    });

    it('orders desktop grid rows for an open card table like GAME_NIGHT_LOBBY_ORDER', () => {
        const rows = readDesktopCardTableGridRowAreas();
        expect(rows).toEqual(expectedDesktopGridRowAreas());
        expect(rows).not.toEqual(OLD_DESKTOP_GRID_ROW_AREAS);
        expect(rows.slice(0, 3)).toEqual(['chess', 'spades', 'brick']);
    });

    it('keeps the remaining desktop games in lineup order while Chess is active', () => {
        const css = readFileSync(join(repoRoot, 'r/45662413410ed051/lobby/arcade-chess.css'), 'utf8');
        const grid = css.match(/grid-template:\s*("chess heading"[^;]+);/);
        expect(grid, 'desktop Chess grid').toBeTruthy();
        const gameRows = [...grid[1].matchAll(/"chess\s+(\w+)"/g)].map(match => match[1])
            .filter(area => !['heading', 'actions', 'call'].includes(area));
        expect(gameRows).toEqual(expectedDesktopGridRowAreas().filter(area => area !== 'chess'));
    });

    it('repositions panels after mount so DOM follows GAME_NIGHT_LOBBY_ORDER', () => {
        const lobby = readFileSync(join(repoRoot, 'r/45662413410ed051/lobby/lobby.js'), 'utf8');
        expect(lobby).toContain('placeArcadePanelInLobbyOrder');
    });
});

describe('placeArcadePanelInLobbyOrder', () => {
    function mountStub(container, game) {
        const panel = document.createElement('details');
        const rootClass = arcadeLobbyPanelSelector(game).replace('details.', '');
        panel.className = rootClass;
        panel.dataset.game = game;
        container.append(panel);
        return panel;
    }

    function panelOrder(container) {
        return [...container.querySelectorAll(':scope > details[data-game]')].map(el => el.dataset.game);
    }

    it('matches GAME_NIGHT_LOBBY_ORDER when imports resolve out of order', () => {
        const container = document.createElement('section');
        container.className = 'game-night';
        const gameCall = document.createElement('div');
        gameCall.className = 'game-call';
        container.append(gameCall);

        const resolutionOrder = ['crapeights', 'turdjack', 'turdspades', 'turdomania', 'turdrummy', 'chess', 'turdtris', 'turdanoid', 'turdrush'];
        const panels = new Map();
        for (const game of resolutionOrder) {
            const panel = mountStub(container, game);
            panels.set(game, panel);
            placeArcadePanelInLobbyOrder(container, panel, game);
        }

        expect(panelOrder(container)).toEqual([...GAME_NIGHT_LOBBY_ORDER]);
    });

    it('does not remount an already ordered panel and interrupt its keyboard focus', () => {
        const container = document.createElement('section');
        document.body.append(container);
        try {
            const first = mountStub(container, 'chess');
            const last = mountStub(container, 'turdrush');
            const call = document.createElement('div');
            call.className = 'game-call';
            container.append(call);
            const summary = document.createElement('summary');
            summary.textContent = 'Royal Flush Chess';
            first.append(summary);
            summary.focus();
            const insertBefore = vi.spyOn(container, 'insertBefore');
            placeArcadePanelInLobbyOrder(container, first, 'chess');
            placeArcadePanelInLobbyOrder(container, last, 'turdrush');
            expect(insertBefore).not.toHaveBeenCalled();
            expect(document.activeElement).toBe(summary);
        } finally {
            container.remove();
        }
    });
});

describe('drawArcadeTable WebJam chess', () => {
    function controllerPlacementBlock() {
        const lobby = readFileSync(join(repoRoot, 'r/45662413410ed051/lobby/lobby.js'), 'utf8');
        const start = lobby.indexOf('        if (table.controller) {');
        const end = lobby.indexOf('        if (!scope || table.loading) return;');
        expect(start).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(start);
        return lobby.slice(start, end);
    }

    it('declares moved before the WebJam open guard', () => {
        const block = controllerPlacementBlock();
        expect(block).toMatch(/const moved = table\.controller\.panel\.parentElement !== container;/);
        expect(block).toMatch(/if \(inWebJam && scope && \(moved \|\| table\.webJamRef !== scope\.ref\)\)/);
    });

    it('runs the WebJam open branch under strict mode without ReferenceError', () => {
        const block = controllerPlacementBlock();
        const run = new Function(
            'container', 'table', 'inWebJam', 'scope', 'game', 'placeArcadePanelInLobbyOrder', 'c',
            'updateTableInvite', 'arcadeInvitation', 'arcadeReturning',
            `'use strict';\n${block}`
        );
        const open = vi.fn(() => ({ open: false }));
        const jamContainer = document.createElement('section');
        jamContainer.setAttribute('data-jam-chess', '');
        const otherParent = document.createElement('div');
        document.body.append(otherParent, jamContainer);
        const panel = document.createElement('details');
        otherParent.append(panel);
        const table = {
            controller: { panel, setRoom: vi.fn(), open },
            webJamRef: undefined,
            supported: true,
        };
        const scope = { actor: 'self', room: '#jam', ref: 'keep-ref' };
        const room = { name: '#jam', keepRef: 'keep-ref' };
        expect(() => run(
            jamContainer, table, true, scope, 'chess', () => {}, room, vi.fn(), null, null
        )).not.toThrow();
        expect(open).toHaveBeenCalledTimes(1);
        expect(jamContainer.contains(panel)).toBe(true);
    });
});