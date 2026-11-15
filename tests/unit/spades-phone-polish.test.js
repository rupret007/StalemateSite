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

const harnessSource = readFileSync(join(root, 'tests/runtime/arcade-browser.mjs'), 'utf8');
// The phone playthrough harness keeps its turn detection in two pure helpers.
// Evaluate them straight from the harness source so this test exercises the
// exact code the browser run uses, without launching a browser.
function harnessTurnHelpers() {
    const prompt = harnessSource.match(/^export const spadesTurnPrompt = .*;$/m)?.[0];
    const seats = harnessSource.match(/^export function spadesTurnSeats\([\s\S]*?^}$/m)?.[0];
    expect(prompt, 'harness exports spadesTurnPrompt').toBeTruthy();
    expect(seats, 'harness exports spadesTurnSeats').toBeTruthy();
    return new Function(`${prompt.replace('export ', '')}\n${seats.replace('export ', '')}\nreturn { spadesTurnPrompt, spadesTurnSeats };`)();
}

const request = (match, fields) => ({ version: match.version, id: match.id, revision: match.revision, ...fields });
// Bids for both humans (the CPUs bid on their own) so the table reaches play.
function playingPartnersTable() {
    const table = partnersTable();
    const subjects = { south: 'host', west: 'friend' };
    for (let turn = 0; turn < 2; turn++) {
        const subject = subjects[table.view('watcher').match.turn];
        const match = table.view(subject).match;
        expect(match.phase).toBe('bid');
        expect(table.command(subject, request(match, { action: 'bid', bid: 3 }))).toEqual({ ok: true });
    }
    const open = table.view('watcher').match;
    expect(open.phase).toBe('play');
    const active = subjects[open.turn];
    return { table, active, idle: Object.values(subjects).find(subject => subject !== active) };
}
function statusFor(state) {
    document.body.replaceChildren();
    const view = mount();
    client.handlers.onState({ state, canOpen: false, partners: true });
    return view.find('[data-spades-status]').textContent;
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

    it('uses four phone hand columns and two trick columns with full-width controls', () => {
        const css = readFileSync(join(root, 'r/45662413410ed051/lobby/lobby.css'), 'utf8');
        const phone = css.slice(css.indexOf('@media (max-width: 600px)'), css.indexOf('@media (max-width: 900px)', css.indexOf('@media (max-width: 600px)')));
        expect(phone).toMatch(/\.arcade-spades \.arcade-card-hand\s*\{\s*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
        expect(phone).toMatch(/\.arcade-spades \.spades-trick\s*\{\s*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
        expect(phone).toMatch(/\.arcade-spades \.arcade-card-hand button\s*\{[^}]*min-height:\s*50px/);
        expect(css).toMatch(/\.game-night :is\(\.arcade-eights, \.arcade-rummy, \.arcade-spades, \.arcade-jack\) :is\(\.btn, select\)\s*\{[^}]*min-height:\s*44px/);
    });

    it('renders a seated phone’s play line as `Round N · Your turn · tap a card`, which the playthrough harness detects', () => {
        const { table, active, idle } = playingPartnersTable();
        const activeState = table.view(active), idleState = table.view(idle);
        const lines = [activeState, idleState, table.view('watcher')].map(statusFor);
        expect(lines[0]).toBe('Round 1 · Your turn · tap a card');
        expect(lines[1]).toMatch(/^Round 1 · (South|West) to play$/);
        expect(lines[2]).toBe(lines[1]);

        const { spadesTurnPrompt, spadesTurnSeats } = harnessTurnHelpers();
        expect(spadesTurnPrompt(1)).toBe(lines[0]);
        // Exactly the active seat is picked, wherever it sits in the page list.
        expect(spadesTurnSeats([lines[0], lines[1]], 1)).toEqual([0]);
        expect(spadesTurnSeats([lines[1], lines[0]], 1)).toEqual([1]);
        expect(spadesTurnSeats([lines[1], lines[2]], 1)).toEqual([]);
        // A page that is reconnecting, or showing another round, is never treated as ready to play.
        expect(spadesTurnSeats([lines[0], 'Reconnecting to the table… Your hand is paused.'], 1)).toEqual([]);
        expect(spadesTurnSeats([lines[0], lines[1]], 2)).toEqual([]);

        // Later rounds and the partners "won the last trick" suffix keep the same prefix.
        for (const round of [2, 7]) {
            const later = state => ({ ...state, match: { ...state.match, round, lastWinner: 'north', trick: [] } });
            const laterLines = [later(activeState), later(idleState)].map(statusFor);
            expect(laterLines[0]).toBe(`Round ${round} · Your turn · tap a card · North (CPU) won the last trick`);
            expect(laterLines[0].startsWith(spadesTurnPrompt(round))).toBe(true);
            expect(spadesTurnSeats(laterLines, round)).toEqual([0]);
            expect(spadesTurnSeats(laterLines, 1)).toEqual([]);
        }
    });

    it('keeps the playthrough harness waiting only on elements the Game Night Spades page renders', () => {
        const { table, active } = playingPartnersTable();
        mount();
        client.handlers.onState({ state: table.view(active), canOpen: false, partners: true });
        expect(document.querySelector('[data-spades-status]')).not.toBeNull();
        expect(document.querySelector('#tableCaption')).toBeNull();
        expect(harnessSource.includes('tableCaption'), 'harness must not wait on #tableCaption').toBe(false);
        // Every Spades turn-detection site goes through the shared helpers; no bare prompt literal remains.
        const literal = harnessSource.split('\n').filter(line => line.includes('Your turn · tap a card'));
        expect(literal).toHaveLength(1);
        expect(literal[0]).toMatch(/^export const spadesTurnPrompt = /);
        expect(harnessSource.match(/spadesTurnSeats\(messages, \d+\)/g)).toHaveLength(2);
    });
});
