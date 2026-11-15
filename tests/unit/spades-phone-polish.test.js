// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GameNightSpadesPartners, GameNightTurdSpades } from '../../hangout-worker/src/game-night-turdspades.mjs';

const client = vi.hoisted(() => ({ handlers: null, sent: [] }));
vi.mock('../../r/45662413410ed051/lobby/game-night-match-client.mjs', () => ({
    matchConnectionErrors: {},
    matchHiddenText: 'Hidden table',
    matchUnavailableText: 'Unavailable table',
    createGameNightMatchClient: handlers => {
        client.handlers = handlers;
        return {
            start() {}, stop() {}, matchUnavailable: () => false, matchOpen: () => false,
            send(frame) { client.sent.push(frame); return true; }
        };
    }
}));
vi.mock('../../r/45662413410ed051/lobby/game-night-audio.mjs', () => ({ gameNightCue() {} }));

const { mountArcadeTurdSpades } = await import('../../r/45662413410ed051/lobby/arcade-turdspades.mjs');
const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function mount() {
    const container = document.createElement('div');
    document.body.append(container);
    const view = mountArcadeTurdSpades(container, () => {});
    return { container, panel: view.panel, find: selector => view.panel.querySelector(selector) };
}

function partnersTable() {
    const table = new GameNightSpadesPartners('spades-phone-fixture', 'host');
    expect(table.join('friend', 'spades-phone-fixture', 0, 'next')).toBe(true);
    return table;
}

function finishMatch(table, subject) {
    const match = table.view(subject).match;
    expect(table.command(subject, { version: match.version, id: match.id, revision: match.revision, action: 'resign' }).ok).toBe(true);
}

beforeEach(() => { document.body.replaceChildren(); client.handlers = null; client.sent = []; });

describe('Spades phone table', () => {
    it('shows the seat, bid turn, scores and a legal hand for a partner', () => {
        const table = partnersTable();
        const view = mount();
        client.handlers.onState({ state: table.view('friend'), canOpen: false, partners: true });
        expect(view.find('[data-spades-seat]').textContent).toBe('You’re West · Partner: East (CPU)');
        expect(view.find('[data-spades-status]').textContent).toContain('Your bid · tap Bid for me');
        expect(view.find('[data-spades-score="0"]').textContent).toContain('South + North CPU');
        expect(view.find('[data-spades-score="1"]').textContent).toContain('West + East CPU');
        expect(view.find('[data-spades-trick-summary]').textContent).toBe('Bids · no cards played yet');
        expect(view.find('[data-spades-hand]').children).toHaveLength(13);
        expect(view.find('[data-spades-bid]').hidden).toBe(false);
        expect(view.find('[data-spades-hand-label]').textContent).toContain('13 cards');
        const select = view.find('#spades-bid');
        select.value = '4';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        expect(view.find('[data-spades-action="bid"]').textContent).toBe('Lock bid');
        expect(view.find('[data-spades-status]').textContent).toContain('Your bid · tap Lock bid');
    });

    it('shows a distinct partner and private 13-card hand at a four-player seat', () => {
        const table = new GameNightTurdSpades('spades-four-phone-fixture', 'host');
        for (const [subject, position] of [['west-player', 'west'], ['north-player', 'north'], ['east-player', 'east']]) {
            expect(table.join(subject, 'spades-four-phone-fixture', 0, position)).toBe(true);
        }
        const view = mount();
        client.handlers.onState({ state: table.view('host'), canOpen: true, partners: true });
        expect(view.find('[data-spades-seat]').textContent).toBe('You’re South · Partner: North');
        expect(view.find('[data-spades-hand]').children).toHaveLength(13);
        expect(view.find('[data-spades-trick]').children).toHaveLength(4);
        expect(view.find('[data-spades-status]').textContent).toContain('to bid');
        expect(view.find('[data-spades-score="0"]').textContent).toContain('South + North');
    });

    it('gives watchers the exact privacy sentence and no private card controls', () => {
        const table = partnersTable();
        const view = mount();
        client.handlers.onState({ state: table.view('watcher'), canOpen: false, partners: true });
        expect(view.find('[data-spades-seat]').textContent).toBe('Watching · hands are private');
        expect(view.find('[data-spades-hand]').children).toHaveLength(0);
        expect(view.find('[data-spades-hand-label]').hidden).toBe(true);
        expect(view.find('[data-spades-bid]').hidden).toBe(true);
        expect(view.panel.querySelectorAll('[data-spades-action]:not([hidden])')).toHaveLength(0);
    });

    it('keeps the full-table up-next sentence', () => {
        const table = partnersTable();
        const state = { ...table.view('watcher'), upNext: true };
        mount();
        client.handlers.onState({ state, canOpen: false, partners: true });
        expect(document.querySelector('[data-next-game]').textContent).toBe("Table full, you're up next game");
        expect(document.querySelector('[data-next-game]').hidden).toBe(false);
    });

    it.each(['partners', 'four'])('keeps %s rematch on the finished phone table and preserves watcher privacy', mode => {
        const table = mode === 'partners' ? partnersTable() : new GameNightTurdSpades('spades-four-rematch', 'host');
        if (mode === 'four') for (const [subject, seat] of [['west-player', 'west'], ['north-player', 'north'], ['east-player', 'east']]) {
            expect(table.join(subject, 'spades-four-rematch', 0, seat)).toBe(true);
        }
        const view = mount();
        client.handlers.onState({ state: table.view('host'), canOpen: true, partners: true });
        view.container.scrollTop = 300;
        finishMatch(table, 'host');
        const finished = { ...table.view('host'), canStartRematch: true };
        client.handlers.onState({ state: finished, canOpen: true, partners: true });
        expect(view.container.scrollTop).toBe(0);
        expect(view.find('[data-spades-status]').textContent).toContain('Game over');
        expect(view.find('[data-spades-rematch-actions]').hidden).toBe(false);
        expect(view.find('[data-spades-rematch-vote]').hidden).toBe(false);
        expect(view.find('[data-spades-start-rematch]').hidden).toBe(false);
        expect(view.find('[data-spades-rematch-vote]').closest('[data-spades-table]')).toBe(view.find('[data-spades-table]'));
        expect(view.find('[data-spades-hand]').hidden).toBe(true);
        expect(view.find('[data-spades-hand]').children).toHaveLength(0);
        for (const selector of ['[data-spades-rematch-vote]', '[data-spades-start-rematch]']) {
            const button = view.find(selector);
            expect(button.style.minWidth).toBe('44px');
            expect(button.style.minHeight).toBe('44px');
            expect(button.style.maxWidth).toBe('100%');
        }
        view.find('[data-spades-rematch-vote]').click();
        expect(client.sent.at(-1)).toMatchObject({ action: 'rematch', id: finished.id });
        client.handlers.onState({ state: finished, canOpen: true, partners: true });
        view.find('[data-spades-start-rematch]').click();
        expect(client.sent.at(-1)).toMatchObject({ action: 'start-rematch', id: finished.id });

        expect(table.requestRematch('host', finished.id, 'spades-next-phone', 1, { force: true })).toBe(true);
        client.handlers.onState({ state: table.view('host'), canOpen: true, partners: true });
        expect(view.find('[data-spades-seat]').textContent).toContain('You’re South');
        expect(view.find('[data-spades-hand]').children).toHaveLength(13);
        expect(view.find('[data-spades-rematch-actions]').hidden).toBe(true);

        client.handlers.onState({ state: table.view('late-watcher'), canOpen: false, partners: true });
        expect(table.view('late-watcher').seat).toBeNull();
        expect(table.view('late-watcher').match.hand).toEqual([]);
        expect(view.find('[data-spades-seat]').textContent).toBe('Watching · hands are private');
        expect(view.find('[data-spades-hand]').children).toHaveLength(0);
        expect(view.find('[data-spades-rematch-actions]').hidden).toBe(true);
    });

    it('distinguishes a completed hand from a finished game', () => {
        const table = partnersTable();
        const view = mount();
        const state = table.view('host');
        const roundResult = [{ delta: 30, nil: [], bagPenalties: 0 }, { delta: 20, nil: [], bagPenalties: 0 }];
        state.match = { ...state.match, phase: 'round-end', roundResult, tricks: { south: 4, west: 3, north: 3, east: 3 }, hand: [] };
        client.handlers.onState({ state, canOpen: true, partners: true });
        expect(view.find('[data-spades-status]').textContent).toContain('Hand over');
        expect(view.find('[data-spades-trick-summary]').textContent).toContain('13 tricks complete');
        expect(view.find('[data-spades-rematch-actions]').hidden).toBe(true);
        finishMatch(table, 'host');
        client.handlers.onState({ state: table.view('host'), canOpen: true, partners: true });
        expect(view.find('[data-spades-status]').textContent).toContain('Game over');
    });

    it('uses four phone hand columns and two trick columns with full-width controls', () => {
        const css = readFileSync(join(root, 'r/45662413410ed051/lobby/lobby.css'), 'utf8');
        const phone = css.slice(css.indexOf('@media (max-width: 600px)'), css.indexOf('@media (max-width: 900px)', css.indexOf('@media (max-width: 600px)')));
        expect(phone).toMatch(/\.arcade-spades \.arcade-card-hand\s*\{\s*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
        expect(phone).toMatch(/\.arcade-spades \.spades-trick\s*\{\s*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
        expect(phone).toMatch(/\.arcade-spades \.arcade-card-hand button\s*\{[^}]*min-height:\s*50px/);
        expect(css).toMatch(/\.game-night :is\(\.arcade-eights, \.arcade-rummy, \.arcade-spades, \.arcade-jack\) :is\(\.btn, select\)\s*\{[^}]*min-height:\s*44px/);
    });
});
