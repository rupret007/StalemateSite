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
const phoneWidth = 390, phoneHeight = 844;

function installPhoneStyles() {
    // jsdom does not resolve media queries. Apply the rules active at 390×844
    // so computed styles can drive the bounds checks below.
    const css = readFileSync(join(root, 'r/45662413410ed051/lobby/lobby.css'), 'utf8');
    const source = document.createElement('style');
    source.textContent = css;
    document.head.append(source);
    const active = rules => [...rules].flatMap(rule => {
        if (rule.type !== 4) return [rule.cssText];
        const condition = rule.conditionText || rule.media?.mediaText || '';
        if (/prefers-|pointer:|orientation:/.test(condition)) return [];
        const dimensions = [...condition.matchAll(/(min|max)-(width|height):\s*(\d+)px/g)];
        if (dimensions.some(([, limit, axis, value]) =>
            limit === 'min' ? (axis === 'width' ? phoneWidth : phoneHeight) < Number(value)
                : (axis === 'width' ? phoneWidth : phoneHeight) > Number(value))) return [];
        return active(rule.cssRules);
    });
    const flattened = document.createElement('style');
    flattened.textContent = active(source.sheet.cssRules).join('\n');
    source.remove();
    document.head.append(flattened);
}

function assertPhoneLayout(view, phase) {
    const panelWidth = phoneWidth - 20; // .game-night has 10px padding on each side.
    const panel = view.panel;
    const style = selector => getComputedStyle(view.find(selector));
    const boxes = [];
    const addGrid = (columns, gap, count, minHeight) => {
        const width = (panelWidth - gap * (columns - 1)) / columns;
        for (let index = 0; index < count; index++) {
            const left = 10 + (index % columns) * (width + gap);
            boxes.push({ left, right: left + width, width, height: minHeight });
        }
    };
    expect(style('summary').width).toBe('100%');
    expect(style('[data-spades-hand]').gridTemplateColumns).toContain('repeat(4, minmax(0, 1fr))');
    expect(style('[data-spades-trick]').gridTemplateColumns).toContain('repeat(2, minmax(0, 1fr))');
    expect(style('[data-spades-score="0"]').overflowWrap).toBe('anywhere');
    expect(style('[data-spades-status]').overflowWrap).toBe('anywhere');
    expect(style('[data-spades-table]').maxWidth).toBe('100%');
    expect(getComputedStyle(panel.parentElement).overflow).toBe('auto');
    const reconnect = view.find('.arcade-reconnect');
    expect(reconnect.parentElement).toBe(view.find('summary'));
    expect(getComputedStyle(reconnect).position).not.toBe('absolute');
    expect(getComputedStyle(reconnect).maxWidth).toBe('calc(100% - 6px)');
    expect(getComputedStyle(reconnect).whiteSpace).toBe('normal');
    expect(getComputedStyle(view.find('summary').nextElementSibling).position).not.toBe('absolute');
    for (const selector of ['[data-spades-status]', '[data-spades-seat]', '[data-spades-trick-summary]',
        '[data-spades-score="0"]', '[data-spades-trick] span', '[data-spades-action="leave"]']) {
        expect(parseFloat(style(selector).fontSize)).toBeGreaterThanOrEqual(13);
    }
    const control = selector => {
        const node = view.find(selector);
        if (node.hidden) return;
        const computed = getComputedStyle(node);
        expect(parseFloat(computed.minHeight)).toBeGreaterThanOrEqual(44);
        boxes.push({ left: 10, right: 10 + panelWidth, width: panelWidth, height: parseFloat(computed.minHeight) });
    };
    control('summary');
    control('[data-spades-main]');
    control('[data-spades-start-rematch]');
    control('[data-spades-action="resign"]');
    control('[data-spades-action="leave"]');
    if (phase === 'bid') {
        expect(style('[data-spades-bid]').gridTemplateColumns).toBe('minmax(0, 1fr) minmax(0, 1fr)');
        control('#spades-bid');
        control('[data-spades-action="bid"]');
        addGrid(2, 8, 2, 44);
    }
    if (phase === 'play') {
        const cards = view.find('[data-spades-hand]').children;
        expect(cards.length).toBe(13);
        expect([...cards].some(card => !card.disabled)).toBe(true);
        expect(parseFloat(style('[data-spades-hand] button').minHeight)).toBeGreaterThanOrEqual(44);
        addGrid(4, 4, cards.length, 50);
    }
    const scrollWidth = Math.ceil(Math.max(...boxes.map(box => box.right)));
    expect(boxes.every(box => box.left >= 0 && box.width >= 44 && box.height >= 44)).toBe(true);
    expect(scrollWidth).toBeLessThanOrEqual(phoneWidth);
    expect(panelWidth).toBeLessThanOrEqual(phoneWidth);
    expect(parseFloat(getComputedStyle(panel.parentElement).maxHeight)).toBe(68);
}

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
        client.handlers.onState({ state: table.view('host'), canOpen: true, partners: false });
        expect(view.find('[data-spades-seat]').textContent).toBe('You’re South · Partner: North');
        expect(view.find('[data-spades-hand]').children).toHaveLength(13);
        expect(view.find('[data-spades-trick]').children).toHaveLength(4);
        expect(view.find('[data-spades-status]').textContent).toContain('to bid');
        expect(view.find('[data-spades-score="0"]').textContent).toContain('South + North');
    });

    it('hides a stale trick while bidding in both modes and shows trick cards during play', () => {
        const four = new GameNightTurdSpades('spades-four-trick-fixture', 'host');
        for (const [subject, position] of [['west-player', 'west'], ['north-player', 'north'], ['east-player', 'east']]) {
            expect(four.join(subject, 'spades-four-trick-fixture', 0, position)).toBe(true);
        }
        const view = mount();
        const trick = view.find('[data-spades-trick]');
        const previousCard = { seat: 'north', rank: 'A', suit: 'S' };
        const currentCard = { seat: 'south', rank: 'K', suit: 'H' };
        for (const table of [partnersTable(), four]) {
            const state = table.view('host');
            const bidding = { ...state, match: { ...state.match, phase: 'bid', canBid: true, trick: [], lastTrick: [previousCard] } };
            client.handlers.onState({ state: bidding, canOpen: true, partners: state.mode === 'partners' });
            expect(trick.hidden).toBe(true);
            expect(view.find('[data-spades-score="0"]').hidden).toBe(false);
            expect(view.find('[data-spades-bid]').hidden).toBe(false);
            expect(view.find('[data-spades-trick-summary]').textContent).toBe('Bids · no cards played yet');

            const showingLast = { ...bidding, match: { ...bidding.match, phase: 'play' } };
            client.handlers.onState({ state: showingLast, canOpen: true, partners: state.mode === 'partners' });
            expect(trick.hidden).toBe(false);
            expect(trick.children[2].querySelector('b').textContent).toBe('A♠');

            const showingCurrent = { ...showingLast, match: { ...showingLast.match, trick: [currentCard] } };
            client.handlers.onState({ state: showingCurrent, canOpen: true, partners: state.mode === 'partners' });
            expect(trick.hidden).toBe(false);
            expect(trick.children[0].querySelector('b').textContent).toBe('K♥');
            expect([...trick.querySelectorAll('b')].map(card => card.textContent)).not.toContain('A♠');

            const nextBid = { ...showingCurrent, match: { ...showingCurrent.match, phase: 'bid', trick: [], lastTrick: [currentCard] } };
            client.handlers.onState({ state: nextBid, canOpen: true, partners: state.mode === 'partners' });
            expect(trick.hidden).toBe(true);
        }
    });

    it('hides a stale trick for four-player bidders and watchers', () => {
        const four = new GameNightTurdSpades('spades-four-stale-bid', 'host');
        for (const [subject, position] of [['west-player', 'west'], ['north-player', 'north'], ['east-player', 'east']]) {
            expect(four.join(subject, 'spades-four-stale-bid', 0, position)).toBe(true);
        }
        const view = mount();
        const staleTrick = { seat: 'north', rank: 'A', suit: 'S' };
        const bidderState = four.view('host');
        const bidding = { ...bidderState, match: { ...bidderState.match, phase: 'bid', canBid: true, trick: [], lastTrick: [staleTrick] } };
        client.handlers.onState({ state: bidding, canOpen: true, partners: false });
        expect(view.find('[data-spades-trick]').hidden).toBe(true);

        const watcherState = four.view('watcher');
        const watcherBidding = { ...watcherState, match: { ...watcherState.match, phase: 'bid', canBid: false, trick: [], lastTrick: [staleTrick] } };
        client.handlers.onState({ state: watcherBidding, canOpen: false, partners: false });
        expect(view.find('[data-spades-trick]').hidden).toBe(true);
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
        client.handlers.onStatus('connecting');
        expect(view.find('[data-spades-seat]').textContent).toBe('Watching · hands are private');
        expect(view.find('[data-spades-hand]').children).toHaveLength(0);
        expect(view.find('[data-spades-bid]').hidden).toBe(true);
    });

    it('keeps the full-table up-next sentence', () => {
        const table = partnersTable();
        const state = { ...table.view('watcher'), upNext: true };
        mount();
        client.handlers.onState({ state, canOpen: false, partners: true });
        expect(document.querySelector('[data-next-game]').textContent).toBe("Table full, you're up next game");
        expect(document.querySelector('[data-next-game]').hidden).toBe(false);
    });

    it('shows Game over after a result in any phase and keeps the last trick winner', () => {
        const four = new GameNightTurdSpades('spades-four-summary', 'host');
        for (const [subject, position] of [['west-player', 'west'], ['north-player', 'north'], ['east-player', 'east']]) {
            expect(four.join(subject, 'spades-four-summary', 0, position)).toBe(true);
        }
        const view = mount();
        for (const table of [partnersTable(), four]) {
            const state = table.view('host');
            const roundEnd = { ...state, match: {
                ...state.match, phase: 'round-end', lastWinner: 'north',
                tricks: { south: 2, west: 1, north: 1, east: 0 }, result: null
            } };
            client.handlers.onState({ state: roundEnd, canOpen: true, partners: state.mode === 'partners' });
            expect(view.find('[data-spades-trick-summary]').textContent).toBe('Hand over · Last won by North' + (state.mode === 'partners' ? ' (CPU)' : ''));

            const completed = { ...roundEnd, match: { ...roundEnd.match, tricks: { south: 13, west: 0, north: 0, east: 0 } } };
            client.handlers.onState({ state: completed, canOpen: true, partners: state.mode === 'partners' });
            expect(view.find('[data-spades-trick-summary]').textContent).toBe('13 tricks complete · Last won by North' + (state.mode === 'partners' ? ' (CPU)' : ''));

            const finished = { ...completed, match: { ...completed.match, result: { winner: 0, reason: 'score' } } };
            client.handlers.onState({ state: finished, canOpen: true, partners: state.mode === 'partners' });
            expect(view.find('[data-spades-trick-summary]').textContent).toBe('Game over · Last won by North' + (state.mode === 'partners' ? ' (CPU)' : ''));

            const bidResign = { ...state, match: { ...state.match, phase: 'bid', result: { winner: 1, reason: 'resign' } } };
            client.handlers.onState({ state: bidResign, canOpen: true, partners: state.mode === 'partners' });
            expect(view.find('[data-spades-trick-summary]').textContent).toBe('Game over');

            const midHandResign = { ...roundEnd, match: { ...roundEnd.match, phase: 'play', result: { winner: 1, reason: 'resign' } } };
            client.handlers.onState({ state: midHandResign, canOpen: true, partners: state.mode === 'partners' });
            expect(view.find('[data-spades-trick-summary]').textContent).toBe('Game over · Last won by North' + (state.mode === 'partners' ? ' (CPU)' : ''));
        }
    });

    it('uses four phone hand columns and two trick columns with full-width controls', () => {
        const css = readFileSync(join(root, 'r/45662413410ed051/lobby/lobby.css'), 'utf8');
        const phone = css.slice(css.indexOf('@media (max-width: 600px)'), css.indexOf('@media (max-width: 900px)', css.indexOf('@media (max-width: 600px)')));
        expect(phone).toMatch(/\.arcade-spades \.arcade-card-hand\s*\{\s*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
        expect(phone).toMatch(/\.arcade-spades \.spades-trick\s*\{\s*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
        expect(phone).toMatch(/\.arcade-spades \.arcade-card-hand button\s*\{[^}]*min-height:\s*50px/);
        expect(css).toMatch(/\.game-night :is\(\.arcade-eights, \.arcade-rummy, \.arcade-spades, \.arcade-jack\) :is\(\.btn, select\)\s*\{[^}]*min-height:\s*44px/);
        // At the 390px viewport, the page and the Spades panel must be able
        // to shrink to the viewport instead of forcing horizontal scrolling.
        expect(css).toMatch(/html, body\s*\{[^}]*overflow-x:\s*hidden/);
        expect(phone).toMatch(/\.arcade-spades, \.arcade-spades \[data-spades-table\]\s*\{[^}]*min-width:\s*0[^}]*max-width:\s*100%/);
        expect(phone).toMatch(/\.arcade-spades \.arcade-card-hand button\s*\{[^}]*min-width:\s*0[^}]*min-height:\s*50px/);
        const compactControls = css.slice(css.indexOf('@media (max-width: 900px)'), css.indexOf('@media (max-width: 720px)', css.indexOf('@media (max-width: 900px)')));
        expect(compactControls).toMatch(/\.arcade-spades summary\s*\{\s*min-height:\s*44px/);
        expect(compactControls).toMatch(/\.game-night :is\(\.arcade-eights, \.arcade-rummy, \.arcade-spades, \.arcade-jack\) :is\(\.btn, select\)\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/);
        expect(phone).toMatch(/\.arcade-spades \[data-spades-bid\]\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/);
    });

    it.each(['partners', 'four'])('measures bid, play, rematch and reconnect at 390×844 in %s mode', mode => {
        installPhoneStyles();
        const gameNight = document.createElement('div');
        gameNight.className = 'game-night jam';
        document.body.append(gameNight);
        const mounted = mountArcadeTurdSpades(gameNight, () => {});
        const view = { panel: mounted.panel, find: selector => mounted.panel.querySelector(selector) };
        view.panel.hidden = false;
        view.panel.open = true;
        const pill = document.createElement('span');
        pill.className = 'arcade-reconnect';
        pill.textContent = 'Reconnecting…';
        view.find('summary').append(pill);
        const table = mode === 'partners' ? partnersTable() : new GameNightTurdSpades('spades-four-layout', 'host');
        if (mode === 'four') for (const [subject, position] of [['west-player', 'west'], ['north-player', 'north'], ['east-player', 'east']]) {
            expect(table.join(subject, 'spades-four-layout', 0, position)).toBe(true);
        }
        const state = table.view('host');
        const show = (match, extras = {}) => client.handlers.onState({ state: { ...state, match, ...extras }, canOpen: true, partners: mode === 'partners' });
        show({ ...state.match, phase: 'bid', canBid: true });
        assertPhoneLayout(view, 'bid');
        const playable = state.match.hand.map(card => ({ ...card, playable: true }));
        show({ ...state.match, phase: 'play', canBid: false, turn: 'south', hand: playable });
        assertPhoneLayout(view, 'play');
        show({ ...state.match, phase: 'round-end', result: { winner: 0, reason: 'score' }, canBid: false }, { canStartRematch: true, rematchVotes: [] });
        expect(view.find('[data-spades-main]').hidden).toBe(false);
        expect(view.find('[data-spades-start-rematch]').hidden).toBe(false);
        assertPhoneLayout(view, 'rematch');
        client.handlers.onStatus('connecting');
        expect(view.find('[data-spades-start-rematch]').hidden).toBe(true);
        assertPhoneLayout(view, 'reconnect');
    });
});
