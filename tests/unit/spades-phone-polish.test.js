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
    const panelWidth = phoneWidth - 20;
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
    expect(style('summary').width).toBe('fit-content');
    expect(style('[data-spades-hand]').gridTemplateColumns).toContain('repeat(7, minmax(0, 1fr))');
    expect(style('[data-spades-trick]').gridTemplateColumns).toContain('repeat(4, minmax(0, 1fr))');
    expect(style('[data-spades-table]').maxWidth).toBe('420px');
    const reconnect = view.find('.arcade-reconnect');
    if (reconnect) expect(reconnect.parentElement).toBe(view.find('summary'));
    const control = selector => {
        const node = view.find(selector);
        if (!node || node.hidden) return;
        const computed = getComputedStyle(node);
        expect(parseFloat(computed.minHeight)).toBeGreaterThanOrEqual(34);
        boxes.push({ left: 10, right: 10 + panelWidth, width: panelWidth, height: parseFloat(computed.minHeight) || 44 });
    };
    control('summary');
    control('[data-spades-main]');
    control('[data-spades-start-rematch]');
    control('[data-spades-action="resign"]');
    if (phase === 'bid') {
        control('#spades-bid');
        control('[data-spades-action="bid"]');
        addGrid(2, 8, 2, 44);
    }
    if (phase === 'play') {
        const cards = view.find('[data-spades-hand]').children;
        expect(cards.length).toBe(13);
        expect([...cards].some(card => !card.disabled)).toBe(true);
        expect(parseFloat(style('[data-spades-hand] button').minHeight)).toBeGreaterThanOrEqual(44);
        addGrid(7, 4, cards.length, 44);
    }
    const scrollWidth = Math.ceil(Math.max(...boxes.map(box => box.right), panelWidth));
    expect(boxes.every(box => box.left >= 0 && box.width >= 0 && box.height >= 34)).toBe(true);
    expect(scrollWidth).toBeLessThanOrEqual(phoneWidth + 1);
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

function watcherLabel(view) {
    return view.find('[data-spades-hand-label]');
}

beforeEach(() => { document.body.replaceChildren(); client.handlers = null; client.sent = []; });

describe('Spades phone table', () => {
    it('shows the seat, bid turn, scores and a legal hand for a partner', () => {
        const table = partnersTable();
        const view = mount();
        client.handlers.onState({ state: table.view('friend'), canOpen: false, partners: true });
        expect(view.find('[data-spades-status]').textContent).toBe(
            'You and a computer partner vs the host and a computer · tap Bid for me');
        expect(view.find('[data-spades-score="0"]').textContent).toContain('South + North CPU');
        expect(view.find('[data-spades-score="1"]').textContent).toContain('West + East CPU');
        expect(view.find('[data-spades-trick]').hidden).toBe(true);
        expect(view.find('[data-spades-hand]').children).toHaveLength(13);
        expect(view.find('[data-spades-bid]').hidden).toBe(false);
        expect(view.find('[data-spades-hand-label]').textContent).toContain('13 cards');
        const select = view.find('#spades-bid');
        select.value = '4';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        expect(view.find('[data-spades-action="bid"]').textContent).toBe('Bid for me');
    });

    it('shows a distinct partner and private 13-card hand at a four-player seat', () => {
        const table = new GameNightTurdSpades('spades-four-phone-fixture', 'host');
        for (const [subject, position] of [['west-player', 'west'], ['north-player', 'north'], ['east-player', 'east']]) {
            expect(table.join(subject, 'spades-four-phone-fixture', 0, position)).toBe(true);
        }
        const view = mount();
        client.handlers.onState({ state: table.view('host'), canOpen: true, partners: false });
        expect(view.find('[data-spades-hand]').children).toHaveLength(13);
        expect(view.find('[data-spades-trick]').children).toHaveLength(4);
        expect(view.find('[data-spades-status]').textContent).toContain('to bid');
        expect(view.find('[data-spades-score="0"]').textContent).toContain('South + North');
    });

    it('hides the trick grid while bidding in partners mode and shows trick cards during play', () => {
        const four = new GameNightTurdSpades('spades-four-trick-fixture', 'host');
        for (const [subject, position] of [['west-player', 'west'], ['north-player', 'north'], ['east-player', 'east']]) {
            expect(four.join(subject, 'spades-four-trick-fixture', 0, position)).toBe(true);
        }
        const view = mount();
        const trick = view.find('[data-spades-trick]');
        const previousCard = { seat: 'north', rank: 'A', suit: 'S' };
        const currentCard = { seat: 'south', rank: 'K', suit: 'H' };
        for (const [table, partners] of [[partnersTable(), true], [four, false]]) {
            const state = table.view('host');
            const bidding = { ...state, match: { ...state.match, phase: 'bid', canBid: true, trick: [], lastTrick: [previousCard] } };
            client.handlers.onState({ state: bidding, canOpen: true, partners });
            expect(trick.hidden).toBe(partners);

            const showingLast = { ...bidding, match: { ...bidding.match, phase: 'play' } };
            client.handlers.onState({ state: showingLast, canOpen: true, partners });
            expect(trick.hidden).toBe(false);
            expect(trick.children[2].querySelector('b').textContent).toBe('A♠');

            const showingCurrent = { ...showingLast, match: { ...showingLast.match, trick: [currentCard] } };
            client.handlers.onState({ state: showingCurrent, canOpen: true, partners });
            expect(trick.hidden).toBe(false);
            expect(trick.children[0].querySelector('b').textContent).toBe('K♥');
        }
    });

    it.each(['partners', 'four'])('shows no last trick while bidding round 2, on reconnect or after a rematch in %s mode', mode => {
        installPhoneStyles();
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
        const partners = mode === 'partners';
        const show = state => client.handlers.onState({ state, canOpen: state.seat === 'south', partners });
        const trick = view.find('[data-spades-trick]');
        const cards = () => [...trick.querySelectorAll('b')];
        const expectCleanBid = () => {
            expect(view.find('[data-spades-table]').dataset.phase).toBe('bid');
            expect(trick.hidden).toBe(partners);
            if (!partners) {
                for (const card of cards()) expect(getComputedStyle(card).display).toBe('none');
            }
        };

        for (let turn = 0; turn < 60 && table.view('watcher').match.phase !== 'round-end'; turn++) act();
        const scored = table.view('host');
        expect(scored.match.lastTrick).toHaveLength(4);
        show(scored);
        expect(trick.hidden).toBe(false);
        expect(cards().map(card => card.textContent)).not.toContain('—');

        expect(table.command('host', { ...frame(scored.match), action: 'next-round' })).toEqual({ ok: true });
        for (const viewer of ['host', 'watcher']) {
            show(table.view(viewer));
            expectCleanBid();
        }
        const watcherState = table.view('watcher');
        expect(watcherState.match.hand).toEqual([]);
        expect(watcherLabel(view).textContent).toBe('Watching · hands are private');
        expect(view.find('[data-spades-hand]').children).toHaveLength(0);
        expect(view.panel.querySelectorAll('[data-spades-card]')).toHaveLength(0);

        const stale = { lastTrick: scored.match.lastTrick, lastWinner: scored.match.lastWinner };
        for (const viewer of ['host', 'watcher']) {
            const carried = { ...table.view(viewer), match: { ...table.view(viewer).match, ...stale } };
            show(carried);
            expectCleanBid();
            client.handlers.onStatus('reconnecting');
            expectCleanBid();
            if (viewer === 'watcher') {
                expect(table.view('watcher').match.hand).toEqual([]);
                expect(view.find('[data-spades-hand]').children).toHaveLength(0);
                expect(view.panel.querySelectorAll('[data-spades-card]')).toHaveLength(0);
            }
        }

        while (table.view('watcher').match.phase === 'bid') act();
        for (let turn = 0; turn < 6; turn++) act();
        expect(table.command('host', { ...frame(table.view('host').match), action: 'resign' }).ok).toBe(true);
        for (const subject of Object.values(subjects)) expect(table.requestRematch(subject, id, nextId, 1)).toBe(true);
        const rematch = table.view('host');
        expect(rematch).toMatchObject({ id: nextId, seat: 'south', match: { round: 1, phase: 'bid' } });
        show({ ...rematch, match: { ...rematch.match, ...stale } });
        expectCleanBid();
        show(table.view('watcher'));
        expect(table.view('watcher').match.hand).toEqual([]);
        expect(view.find('[data-spades-hand]').children).toHaveLength(0);
    });

    it('gives watchers the exact privacy sentence and no private card controls', () => {
        const table = partnersTable();
        const view = mount();
        const watcherState = table.view('watcher');
        expect(watcherState.match.hand).toEqual([]);
        client.handlers.onState({ state: watcherState, canOpen: false, partners: true });
        expect(watcherLabel(view).textContent).toBe('Watching · hands are private');
        expect(view.find('[data-spades-hand]').children).toHaveLength(0);
        expect(view.panel.querySelectorAll('[data-spades-card]')).toHaveLength(0);
        expect(view.find('[data-spades-bid]').hidden).toBe(true);
        expect(view.panel.querySelectorAll('[data-spades-action]:not([hidden])')).toHaveLength(0);
        client.handlers.onStatus('connecting');
        expect(watcherLabel(view).textContent).toBe('Watching · hands are private');
        expect(view.find('[data-spades-hand]').children).toHaveLength(0);
    });

    it('keeps the full-table up-next sentence', () => {
        const table = partnersTable();
        const state = { ...table.view('watcher'), upNext: true };
        mount();
        client.handlers.onState({ state, canOpen: false, partners: true });
        expect(document.querySelector('[data-next-game]').textContent).toBe("Table full, you're up next game");
        expect(document.querySelector('[data-next-game]').hidden).toBe(false);
    });

    it('uses phone-friendly Spades layout rules from lobby.css', () => {
        const css = readFileSync(join(root, 'r/45662413410ed051/lobby/lobby.css'), 'utf8');
        expect(css).toMatch(/\.arcade-card-hand\s*\{[^}]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
        expect(css).toMatch(/\.arcade-spades \.arcade-card-hand\s*\{[^}]*grid-template-columns:\s*repeat\(7, minmax\(0, 1fr\)\)/);
        expect(css).toMatch(/\.spades-trick\s*\{[^}]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
        expect(css).toMatch(/html, body\s*\{[^}]*overflow-x:\s*hidden/);
        const compact = css.slice(css.indexOf('@media (max-width: 900px)'), css.indexOf('@media (max-width: 355px)', css.indexOf('@media (max-width: 900px)')));
        expect(compact).toMatch(/\.game-night :is\(\.arcade-eights, \.arcade-rummy, \.arcade-spades, \.arcade-jack\) :is\(\.btn, select\)\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/);
    });

    it.each(['partners', 'four'])('renders the live Spades table inside a 390×844 phone viewport (%s)', mode => {
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
        if (mode === 'four') {
            for (const [subject, position] of [['west-player', 'west'], ['north-player', 'north'], ['east-player', 'east']]) {
                expect(table.join(subject, 'spades-four-layout', 0, position)).toBe(true);
            }
        }
        const state = table.view('host');
        const show = (match, extras = {}) => client.handlers.onState({
            state: { ...state, match, ...extras }, canOpen: true, partners: mode === 'partners'
        });
        show({ ...state.match, phase: 'bid', canBid: true });
        assertPhoneLayout(view, 'bid');
        const playable = state.match.hand.map(card => ({ ...card, playable: true }));
        show({ ...state.match, phase: 'play', canBid: false, turn: 'south', hand: playable });
        assertPhoneLayout(view, 'play');
    }, 20000);

    it.each(['partners', 'four'])('keeps %s rematch on the finished phone table and preserves watcher privacy', mode => {
        const table = mode === 'partners' ? partnersTable() : new GameNightTurdSpades('spades-four-rematch', 'host');
        if (mode === 'four') {
            for (const [subject, seat] of [['west-player', 'west'], ['north-player', 'north'], ['east-player', 'east']]) {
                expect(table.join(subject, 'spades-four-rematch', 0, seat)).toBe(true);
            }
        }
        const view = mount();
        client.handlers.onState({ state: table.view('host'), canOpen: true, partners: mode === 'partners' });
        view.container.scrollTop = 300;
        finishMatch(table, 'host');
        const finished = { ...table.view('host'), canStartRematch: true };
        client.handlers.onState({ state: finished, canOpen: true, partners: mode === 'partners' });
        expect(view.container.scrollTop).toBe(300);
        expect(view.find('[data-spades-status]').textContent).toMatch(/win|resignation/i);
        expect(view.find('[data-spades-main]').hidden).toBe(false);
        expect(view.find('[data-spades-start-rematch]').hidden).toBe(false);

        const watcherAtGameOver = table.view('watcher');
        expect(watcherAtGameOver.seat).toBeNull();
        expect(watcherAtGameOver.match.hand).toEqual([]);
        client.handlers.onState({ state: watcherAtGameOver, canOpen: false, partners: mode === 'partners' });
        expect(watcherLabel(view).textContent).toBe('Watching · hands are private');
        expect(view.find('[data-spades-hand]').children).toHaveLength(0);
        expect(view.panel.querySelectorAll('[data-spades-card]')).toHaveLength(0);

        const voters = mode === 'partners' ? ['host', 'friend'] : ['host', 'west-player', 'north-player', 'east-player'];
        const finishedId = finished.id;
        for (const subject of voters.slice(0, -1)) {
            expect(table.requestRematch(subject, finishedId, 'spades-next-phone', 1)).toBe(true);
        }
        expect(table.requestRematch(voters.at(-1), finishedId, 'spades-next-phone', 1)).toBe(true);
        const rematch = table.view('host');
        client.handlers.onState({ state: rematch, canOpen: true, partners: mode === 'partners' });
        expect(view.container.scrollTop).toBe(0);
        expect(view.find('[data-spades-hand]').children).toHaveLength(13);

        client.handlers.onState({ state: table.view('watcher'), canOpen: false, partners: mode === 'partners' });
        expect(table.view('watcher').match.hand).toEqual([]);
        expect(view.find('[data-spades-hand]').children).toHaveLength(0);
        expect(view.panel.querySelectorAll('[data-spades-card]')).toHaveLength(0);
    });

    it('renders a seated phone’s play line as `Round N · Your play · tap a card`, which the playthrough harness detects', () => {
        const { table, active, idle } = playingPartnersTable();
        const activeState = table.view(active), idleState = table.view(idle);
        const lines = [activeState, idleState, table.view('watcher')].map(statusFor);
        expect(lines[0]).toBe('Round 1 · Your play · tap a card');
        expect(lines[1]).toMatch(/^Round 1 · (South|West) to play$/);
        expect(lines[2]).toBe(lines[1]);

        for (const round of [2, 7]) {
            const later = state => ({ ...state, match: { ...state.match, round, lastWinner: 'north', trick: [] } });
            const laterLines = [later(activeState), later(idleState)].map(statusFor);
            expect(laterLines[0]).toBe(`Round ${round} · Your play · tap a card · North (CPU) won the last trick`);
        }
    });

    it('keeps the playthrough harness waiting only on elements the Game Night Spades page renders', () => {
        const { table, active } = playingPartnersTable();
        mount();
        client.handlers.onState({ state: table.view(active), canOpen: false, partners: true });
        expect(document.querySelector('[data-spades-status]')).not.toBeNull();
        expect(document.querySelector('#tableCaption')).toBeNull();
        expect(harnessSource.includes('tableCaption'), 'harness must not wait on #tableCaption').toBe(false);
        expect(harnessSource.includes('[data-spades-status]')).toBe(true);
        const playTurn = harnessSource.split('\n').filter(line => line.includes('Round 1 · Your play'));
        expect(playTurn.length).toBeGreaterThanOrEqual(2);
        expect(harnessSource.match(/startsWith\('Round 1 · Your play'\)/g)?.length).toBeGreaterThanOrEqual(2);
    });
});