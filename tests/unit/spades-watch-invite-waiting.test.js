import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const match = vi.hoisted(() => ({ options: null }));
vi.mock('../../r/45662413410ed051/lobby/game-night-match-client.mjs', async original => ({
    ...await original(),
    createGameNightMatchClient: options => {
        match.options = options;
        return { start() {}, stop() {}, matchOpen: () => false, matchUnavailable: () => false, send: () => true };
    }
}));
vi.mock('../../r/45662413410ed051/lobby/game-night-audio.mjs', () => ({ gameNightCue: () => {} }));
vi.mock('/play/games/turdspades-engine.js', () => ({ suggestSpadesBid: () => 3 }));

import { mountArcadeTurdSpades } from '../../r/45662413410ed051/lobby/arcade-turdspades.mjs';

describe('Spades watch-invite waiting table', () => {
    let container, view;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.append(container);
        view = mountArcadeTurdSpades(container, () => {});
        view.setRoom({ room: '#game-2ca9e1x1be34a', ref: '0'.repeat(32), actor: 'c' + '1'.repeat(32) });
    });

    afterEach(() => {
        match.options.onStatus('reconnecting');
        container.remove();
    });

    it('shows a watching state without offering Join or Sit while the table waits', () => {
        match.options.onState({
            state: {
                version: 1,
                game: 'turdspades',
                id: 'c8eb7f10-e113-418f-9900-000000000002',
                tableId: 'c8eb7f10-e113-418f-9900-000000000001',
                seat: null,
                waiting: true,
                match: null,
                occupied: ['south', 'north', 'east'],
                watchOnly: true
            },
            canOpen: false
        });

        expect(container.querySelector('[data-spades-status]').textContent).toContain('Stay here to watch when the next hand starts.');
        expect(container.querySelector('[data-spades-seats]').hidden).toBe(true);
        expect(container.querySelector('[data-spades-main]').hidden).toBe(true);
        const offered = [...container.querySelectorAll('button')].filter(button => {
            for (let node = button; node; node = node.parentElement) if (node.hidden) return false;
            return true;
        });
        expect(offered.map(button => button.textContent)).not.toEqual(expect.arrayContaining([expect.stringMatching(/join|sit/i)]));
    });
});
