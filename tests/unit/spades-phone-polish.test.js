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
const harnessSource = readFileSync(join(root, 'tests/runtime/arcade-browser.mjs'), 'utf8');

function harnessTurnHelpers() {
    const prompt = harnessSource.match(/^export const spadesTurnPrompt = .*;$/m)?.[0];
    const seats = harnessSource.match(/^export function spadesTurnSeats\([\s\S]*?^}$/m)?.[0];
    expect(prompt, 'harness exports spadesTurnPrompt').toBeTruthy();
    expect(seats, 'harness exports spadesTurnSeats').toBeTruthy();
    return new Function(`${prompt.replace('export ', '')}\n${seats.replace('export ', '')}\nreturn { spadesTurnPrompt, spadesTurnSeats };`)();
}

const request = (match, fields) => ({ version: match.version, id: match.id, revision: match.revision, ...fields });
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
function finishMatch(table, subject) {
    const match = table.view(subject).match;
    expect(table.command(subject, { version: match.version, id: match.id, revision: match.revision, action: 'resign' }).ok).toBe(true);
}

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

    it('locks the bid label refresh so an edited amount shows Lock bid before the next deal', () => {
        const source = readFileSync(join(root, 'r/45662413410ed051/lobby/arcade-turdspades.mjs'), 'utf8');
        expect(source).toContain("bid.addEventListener('change', () => { if (!applyingBid) { bidEdited = true; draw(); } });");
        expect(source).toContain("$('[data-spades-action=\"bid\"]').textContent = bidEdited ? 'Lock bid' : 'Bid for me';");
        const table = partnersTable();
        const view = mount();
        const state = table.view('friend');
        client.handlers.onState({ state, canOpen: false, partners: true });
        const button = view.find('[data-spades-action="bid"]');
        const select = view.find('#spades-bid');
        expect(button.textContent).toBe('Bid for me');
        expect(view.find('[data-spades-status]').textContent).toContain('tap Bid for me');
        const edited = select.value === '0' ? '1' : '0';
        select.value = edited;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        expect(select.value).toBe(edited);
        expect(button.textContent).toBe('Lock bid');
        expect(view.find('[data-spades-status]').textContent).toContain('tap Lock bid');
        client.handlers.onState({
            state: { ...state, match: { ...state.match, revision: state.match.revision + 1 } },
            canOpen: false, partners: true
        });
        expect(button.textContent).toBe('Bid for me');
        expect(view.find('[data-spades-status]').textContent).toContain('tap Bid for me');
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
            expect(trick.hidden).toBe(false);
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
            expect(trick.hidden).toBe(false);
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
        expect(view.find('[data-spades-trick]').hidden).toBe(false);

        const watcherState = four.view('watcher');
        const watcherBidding = { ...watcherState, match: { ...watcherState.match, phase: 'bid', canBid: false, trick: [], lastTrick: [staleTrick] } };
        client.handlers.onState({ state: watcherBidding, canOpen: false, partners: false });
        expect(view.find('[data-spades-trick]').hidden).toBe(false);
    });

    it.each(['partners', 'four'])('shows no last trick or last winner while bidding round 2, on reconnect or after a rematch in %s mode', mode => {
        const id = `spades-${mode}-stale-winner`, nextId = `spades-${mode}-stale-next`;
        const subjects = mode === 'partners' ? { south: 'host', west: 'friend' }
            : { south: 'host', west: 'west-player', north: 'north-player', east: 'east-player' };
        const table = mode === 'partners' ? new GameNightSpadesPartners(id, 'host') : new GameNightTurdSpades(id, 'host');
        for (const [position, subject] of Object.entries(subjects)) {
            if (subject !== 'host') expect(table.join(subject, id, 0, mode === 'partners' ? 'next' : position)).toBe(true);
        }
        const frame = match => ({ version: match.version, id: match.id, revision: match.revision });
        const act = () => {
            const subject = subjects[table.view('watcher').match.turn];
            const match = table.view(subject).match;
            const action = match.phase === 'bid' ? { action: 'bid', bid: 3 }
                : { action: 'play', card: match.hand.find(card => card.playable).id };
            expect(table.command(subject, { ...frame(match), ...action })).toEqual({ ok: true });
        };
        const view = mount();
        const show = state => client.handlers.onState({ state, canOpen: state.seat === 'south', partners: mode === 'partners' });
        const trick = view.find('[data-spades-trick]');
        const cards = () => [...trick.querySelectorAll('b')];
        const expectCleanBid = () => {
            expect(view.find('[data-spades-table]').dataset.phase).toBe('bid');
            expect(trick.hidden).toBe(false);
            expect(view.find('[data-spades-trick-summary]').textContent).toBe('Bids · no cards played yet');
            expect(view.find('[data-spades-status]').textContent).not.toMatch(/won the last trick|Last won by|showing last trick/);
            expect(cards().map(card => card.textContent)).toEqual(['—', '—', '—', '—']);
            expect(cards().map(card => card.getAttribute('aria-label'))).toEqual(Array(4).fill('No card played'));
            expect([...trick.children].map(row => row.dataset.red)).toEqual(Array(4).fill('false'));
        };

        // Play the first hand from the real table so the last trick is on screen.
        for (let turn = 0; turn < 60 && table.view('watcher').match.phase !== 'round-end'; turn++) act();
        const scored = table.view('host');
        expect(scored.match.lastTrick).toHaveLength(4);
        show(scored);
        expect(trick.hidden).toBe(false);
        expect(cards().map(card => card.textContent)).not.toContain('—');
        expect(view.find('[data-spades-trick-summary]').textContent).toContain('Last won by');

        // Round 2 bidding, as the table projects it for a bidder and a watcher.
        expect(table.command('host', { ...frame(scored.match), action: 'next-round' })).toEqual({ ok: true });
        for (const viewer of ['host', 'watcher']) {
            show(scored);
            show(table.view(viewer));
            expectCleanBid();
        }
        expect(view.find('[data-spades-seat]').textContent).toBe('Watching · hands are private');
        expect(view.find('[data-spades-hand]').children).toHaveLength(0);

        // A bid-phase payload that still carries the previous hand's trick must
        // not put it back: not live, not through a mid-bid reconnect.
        const stale = { lastTrick: scored.match.lastTrick, lastWinner: scored.match.lastWinner };
        for (const viewer of ['host', 'watcher']) {
            const bidding = table.view(viewer);
            const carried = { ...bidding, match: { ...bidding.match, ...stale } };
            show(scored);
            show(carried);
            expectCleanBid();
            client.handlers.onStatus('reconnecting');
            expectCleanBid();
            show(carried);
            expectCleanBid();
            if (viewer === 'watcher') {
                expect(view.find('[data-spades-seat]').textContent).toBe('Watching · hands are private');
                expect(view.find('[data-spades-hand]').children).toHaveLength(0);
                expect(view.find('[data-spades-bid]').hidden).toBe(true);
            }
        }

        // Resign with cards on the table, then rematch into a fresh bid.
        while (table.view('watcher').match.phase === 'bid') act();
        for (let turn = 0; turn < 6; turn++) act();
        const playing = table.view('host');
        show(playing);
        expect(cards().map(card => card.textContent).some(text => text !== '—')).toBe(true);
        expect(table.command('host', { ...frame(playing.match), action: 'resign' }).ok).toBe(true);
        const finished = table.view('host');
        show(finished);
        for (const subject of Object.values(subjects)) expect(table.requestRematch(subject, id, nextId, 1)).toBe(true);
        const rematch = table.view('host');
        expect(rematch).toMatchObject({ id: nextId, seat: 'south', match: { round: 1, phase: 'bid' } });
        show(rematch);
        expectCleanBid();
        show(finished);
        show({ ...rematch, match: { ...rematch.match, ...stale } });
        expectCleanBid();
        show(table.view('watcher'));
        expectCleanBid();
        expect(view.find('[data-spades-hand]').children).toHaveLength(0);
    });

    it('gives watchers the exact privacy sentence and no private card controls', () => {
        const table = partnersTable();
        const view = mount();
        client.handlers.onState({ state: table.view('watcher'), canOpen: false, partners: true });
        expect(view.find('[data-spades-seat]').textContent).toBe('Watching · hands are private');
        expect(view.find('[data-spades-hand]').children).toHaveLength(0);
        expect(view.find('[data-spades-hand-label]').hidden).toBe(false);
        expect(view.find('[data-spades-hand-label]').textContent).toBe('Watching · hands are private');
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

            const cleared = { ...roundEnd, match: { ...roundEnd.match, tricks: { south: 0, west: 0, north: 0, east: 0 } } };
            client.handlers.onState({ state: cleared, canOpen: true, partners: state.mode === 'partners' });
            expect(view.find('[data-spades-trick-summary]').textContent).toBe('Hand over · Last won by North' + (state.mode === 'partners' ? ' (CPU)' : ''));

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
        expect(view.find('[data-spades-main]').hidden).toBe(true);
        expect(view.find('[data-spades-rematch-vote]').hidden).toBe(false);
        expect(view.find('[data-spades-start-rematch]').hidden).toBe(false);
        assertPhoneLayout(view, 'rematch');
        client.handlers.onStatus('connecting');
        expect(view.find('[data-spades-start-rematch]').hidden).toBe(true);
        assertPhoneLayout(view, 'reconnect');
    }, 20000);

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
        view.container.scrollTop = 300;
        client.handlers.onState({ state: finished, canOpen: true, partners: true });
        expect(view.container.scrollTop).toBe(300);
        expect(view.find('[data-spades-status]').textContent).toContain('Game over');
        expect(view.find('[data-spades-rematch-actions]').hidden).toBe(false);
        expect(view.find('[data-spades-rematch-vote]').hidden).toBe(false);
        expect(view.find('[data-spades-start-rematch]').hidden).toBe(false);
        expect(view.find('[data-spades-rematch-actions]').previousElementSibling).toBe(view.find('[data-spades-seat]'));
        expect(view.find('[data-spades-rematch-actions]').nextElementSibling).toBe(view.find('[data-spades-score="0"]').parentElement);
        expect(view.find('[data-spades-hand]').hidden).toBe(true);
        expect(view.find('[data-spades-hand]').children).toHaveLength(0);
        for (const selector of ['[data-spades-rematch-vote]', '[data-spades-start-rematch]']) {
            const button = view.find(selector);
            expect(button.style.minWidth).toBe('44px');
            expect(button.style.minHeight).toBe('44px');
            expect(button.style.maxWidth).toBe('100%');
            expect(button.disabled).toBe(false);
            button.focus();
            expect(document.activeElement).toBe(button);
        }
        view.find('[data-spades-rematch-vote]').click();
        expect(client.sent.at(-1)).toMatchObject({ action: 'rematch', id: finished.id });
        client.handlers.onState({ state: finished, canOpen: true, partners: true });
        view.find('[data-spades-start-rematch]').click();
        expect(client.sent.at(-1)).toMatchObject({ action: 'start-rematch', id: finished.id });

        const watcherAtGameOver = table.view('late-watcher');
        expect(watcherAtGameOver.seat).toBeNull();
        expect(watcherAtGameOver.match.hand).toEqual([]);
        client.handlers.onState({ state: watcherAtGameOver, canOpen: false, partners: true });
        expect(view.find('[data-spades-seat]').textContent).toBe('Watching · hands are private');
        expect(view.find('[data-spades-hand-label]').textContent).toBe('Watching · hands are private');
        expect(view.find('[data-spades-hand]').children).toHaveLength(0);
        expect(view.find('[data-spades-rematch-actions]').hidden).toBe(true);

        const voters = mode === 'partners' ? ['host', 'friend'] : ['host', 'west-player', 'north-player', 'east-player'];
        for (const subject of voters.slice(0, -1)) {
            expect(table.requestRematch(subject, finished.id, 'spades-next-phone', 1)).toBe(true);
            expect(table.view('host').id).toBe(finished.id);
            expect(table.view('host').match.result).toBeTruthy();
        }
        expect(table.requestRematch(voters.at(-1), finished.id, 'spades-next-phone', 1)).toBe(true);
        for (const subject of voters) {
            const player = table.view(subject);
            expect(player).toMatchObject({ id: 'spades-next-phone', match: { round: 1, phase: 'bid', scores: [0, 0] } });
            expect(player.match.hand).toHaveLength(13);
        }
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

    it('renders a seated phone’s play line as `Round N · Your turn · tap a card`, which the playthrough harness detects', () => {
        const { table, active, idle } = playingPartnersTable();
        const activeState = table.view(active), idleState = table.view(idle);
        const lines = [activeState, idleState, table.view('watcher')].map(statusFor);
        expect(lines[0]).toBe('Round 1 · Your turn · tap a card');
        expect(lines[1]).toMatch(/^Round 1 · (South|West) to play$/);
        expect(lines[2]).toBe(lines[1]);

        const { spadesTurnPrompt, spadesTurnSeats } = harnessTurnHelpers();
        expect(spadesTurnPrompt(1)).toBe(lines[0]);
        expect(spadesTurnSeats([lines[0], lines[1]], 1)).toEqual([0]);
        expect(spadesTurnSeats([lines[1], lines[0]], 1)).toEqual([1]);
        expect(spadesTurnSeats([lines[1], lines[2]], 1)).toEqual([]);
        expect(spadesTurnSeats([lines[0], 'Reconnecting to the table… Your hand is paused.'], 1)).toEqual([]);
        expect(spadesTurnSeats([lines[0], lines[1]], 2)).toEqual([]);

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
        const literal = harnessSource.split('\n').filter(line => line.includes('Your turn · tap a card'));
        expect(literal).toHaveLength(1);
        expect(literal[0]).toMatch(/^export const spadesTurnPrompt = /);
        expect(harnessSource.match(/spadesTurnSeats\(messages, \d+\)/g)).toHaveLength(2);
    });
});
