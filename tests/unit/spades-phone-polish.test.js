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

    it('reserves Game over for a match result and keeps the last trick winner', () => {
        const four = new GameNightTurdSpades('spades-four-summary', 'host');
        for (const [subject, position] of [['west-player', 'west'], ['north-player', 'north'], ['east-player', 'east']]) {
            expect(four.join(subject, 'spades-four-summary', 0, position)).toBe(true);
        }
        const view = mount();
        for (const table of [partnersTable(), four]) {
            const state = table.view('host');
            const roundEnd = { ...state, match: {
                ...state.match, phase: 'round-end', lastWinner: 'north',
                tricks: { south: 0, west: 0, north: 0, east: 0 }, result: null
            } };
            client.handlers.onState({ state: roundEnd, canOpen: true, partners: true });
            expect(view.find('[data-spades-trick-summary]').textContent).toBe('Hand over · Last won by North' + (state.mode === 'partners' ? ' (CPU)' : ''));

            const completed = { ...roundEnd, match: { ...roundEnd.match, tricks: { south: 13, west: 0, north: 0, east: 0 } } };
            client.handlers.onState({ state: completed, canOpen: true, partners: true });
            expect(view.find('[data-spades-trick-summary]').textContent).toBe('13 tricks complete · Last won by North' + (state.mode === 'partners' ? ' (CPU)' : ''));

            const finished = { ...completed, match: { ...completed.match, result: { winner: 0, reason: 'score' } } };
            client.handlers.onState({ state: finished, canOpen: true, partners: true });
            expect(view.find('[data-spades-trick-summary]').textContent).toBe('Game over · Last won by North' + (state.mode === 'partners' ? ' (CPU)' : ''));
        }
    });

    describe('trick summary: Game over vs Hand over edge cases', () => {
        function trickSummary(match) {
            const table = partnersTable();
            const view = mount();
            const base = table.view('friend');
            client.handlers.onState({ state: { ...base, match: { ...base.match, ...match } }, canOpen: false, partners: true });
            return view.find('[data-spades-trick-summary]').textContent;
        }

        it('shows Game over when match.result is set even if phase is not round-end', () => {
            const text = trickSummary({
                phase: 'play',
                result: { winner: 0, reason: 'score' },
                lastWinner: 'north',
                tricks: { south: 2, west: 2, north: 2, east: 1 }
            });
            expect(text).toBe('Game over · Last won by North (CPU)');
            expect(text).not.toContain('Hand over');
        });

        it('shows Game over (not Hand over or 13 tricks complete) when result is set with fewer than 13 tricks', () => {
            const text = trickSummary({
                phase: 'round-end',
                result: { winner: 1, reason: 'resign' },
                lastWinner: 'east',
                tricks: { south: 1, west: 3, north: 0, east: 4 }
            });
            expect(text).toBe('Game over · Last won by East (CPU)');
            expect(text).not.toMatch(/Hand over|13 tricks complete/);
        });

        it('shows Hand over for a result-less round-end with exactly 12 tricks played', () => {
            const text = trickSummary({
                phase: 'round-end',
                result: null,
                lastWinner: 'west',
                tricks: { south: 3, west: 3, north: 3, east: 3 }
            });
            expect(text).toBe('Hand over · Last won by West');
            expect(text).not.toContain('Game over');
            expect(text).not.toContain('13 tricks complete');
        });

        it('omits the last-winner clause when lastWinner is null (no dangling separator)', () => {
            const table = partnersTable();
            const view = mount();
            const base = table.view('friend');
            for (const match of [
                { phase: 'round-end', result: null, lastWinner: null, tricks: { south: 3, west: 3, north: 3, east: 3 } },
                { phase: 'round-end', result: { winner: 0, reason: 'score' }, lastWinner: null, tricks: { south: 2, west: 2, north: 2, east: 2 } }
            ]) {
                client.handlers.onState({ state: { ...base, match: { ...base.match, ...match } }, canOpen: false, partners: true });
                const text = view.find('[data-spades-trick-summary]').textContent;
                expect(text).not.toMatch(/ · $/);
                expect(text).not.toContain('Last won by');
                expect(text).toBe(match.result ? 'Game over' : 'Hand over');
            }
        });

        it('keeps Trick N of 13 during active play with no match result', () => {
            const text = trickSummary({
                phase: 'play',
                result: null,
                lastWinner: 'south',
                tricks: { south: 2, west: 1, north: 1, east: 1 },
                trick: [],
                lastTrick: [{ seat: 'south', rank: 'A', suit: 'S' }]
            });
            expect(text).toBe('Trick 6 of 13 · showing last trick');
            expect(text).not.toMatch(/Game over|Hand over/);
        });
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
