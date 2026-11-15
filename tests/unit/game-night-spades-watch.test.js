import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const match = vi.hoisted(() => ({ options: null, send: null }));
vi.mock('../../r/45662413410ed051/lobby/game-night-match-client.mjs', async original => ({
    ...await original(),
    createGameNightMatchClient: options => {
        match.options = options;
        return { start() {}, stop() {}, matchOpen: () => false, matchUnavailable: () => false, send: frame => match.send(frame) };
    }
}));
vi.mock('../../r/45662413410ed051/lobby/game-night-audio.mjs', () => ({ gameNightCue: () => {} }));
vi.mock('/play/games/turdspades-engine.js', () => ({ suggestSpadesBid: () => 3 }));

import { WATCH_SYNC_INTERVAL, mountArcadeTurdSpades } from '../../r/45662413410ed051/lobby/arcade-turdspades.mjs';
import { WATCH_ACTIVITY_INTERVAL } from '../../hangout-worker/src/arcade-transport.mjs';
import { GAME_NIGHT_IDLE } from '../../hangout-worker/src/game-night-lifetime.mjs';

describe('TurdSpades watcher view', () => {
    let container, status, hidden;
    const waiting = (occupied, fields = {}) => ({ state: { version: 1, game: 'turdspades', id: 'c8eb7f10-e113-418f-9900-000000000002',
        tableId: 'c8eb7f10-e113-418f-9900-000000000001', seat: null, waiting: true, match: null, occupied, ...fields }, canOpen: false });
    const show = frame => match.options.onState(frame);

    beforeEach(() => {
        vi.useFakeTimers();
        hidden = false;
        vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
        match.send = vi.fn(() => true);
        container = document.createElement('div');
        document.body.append(container);
        const view = mountArcadeTurdSpades(container, () => {});
        view.setRoom({ room: '#game-2ca9e1x1be34a', ref: '0'.repeat(32), actor: 'c' + '1'.repeat(32) });
        status = container.querySelector('[data-spades-status]');
    });

    afterEach(() => {
        match.options.onStatus('reconnecting');
        container.remove();
        vi.useRealTimers();
    });

    it('tells a watcher that a seat opened and what happens next, without offering a seat or a hand', () => {
        show(waiting(['south', 'north', 'east'], { watchOnly: true }));
        expect(status.textContent).toBe('3/4 seated · South + North vs West + East · A seat opened. '
            + 'The host can invite you in. Stay here to watch when the next hand starts.');
        expect(container.querySelector('[data-spades-seats]').hidden).toBe(true);
        expect(container.querySelector('[data-spades-main]').hidden).toBe(true);
        expect(container.querySelector('[data-spades-table]').hidden).toBe(true);
        expect(container.querySelectorAll('[data-spades-card]')).toHaveLength(0);

        show(waiting(['south', 'west', 'north', 'east'], { watchOnly: true }));
        expect(status.textContent).toBe('4/4 seated · South + North vs West + East · Stay here to watch when the next hand starts.');
        // Someone who can take the seat gets the seat buttons, not the watcher line.
        show(waiting(['south', 'north', 'east']));
        expect(status.textContent).toBe('3/4 seated · South + North vs West + East');
        expect(container.querySelector('[data-spades-seats]').hidden).toBe(false);
    });

    it('syncs for a watcher while the page is on screen so watching counts as activity', () => {
        expect(WATCH_SYNC_INTERVAL).toBeGreaterThanOrEqual(WATCH_ACTIVITY_INTERVAL);
        expect(WATCH_SYNC_INTERVAL).toBeLessThan(GAME_NIGHT_IDLE / 2);
        show(waiting(['south', 'north', 'east'], { watchOnly: true }));
        vi.advanceTimersByTime(WATCH_SYNC_INTERVAL - 1);
        expect(match.send).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(match.send).toHaveBeenCalledExactlyOnceWith({ action: 'sync' });
        show(waiting(['south', 'north', 'east'], { watchOnly: true }));
        vi.advanceTimersByTime(WATCH_SYNC_INTERVAL / 2);
        // Table updates during the interval must not push the heartbeat later.
        show(waiting(['south', 'west', 'north', 'east'], { watchOnly: true }));
        vi.advanceTimersByTime(WATCH_SYNC_INTERVAL / 2);
        expect(match.send).toHaveBeenCalledTimes(2);

        // A page in the background is not watching. It resumes once it is back.
        show(waiting(['south', 'north', 'east'], { watchOnly: true }));
        hidden = true;
        vi.advanceTimersByTime(WATCH_SYNC_INTERVAL * 3);
        expect(match.send).toHaveBeenCalledTimes(2);
        hidden = false;
        vi.advanceTimersByTime(WATCH_SYNC_INTERVAL);
        expect(match.send).toHaveBeenCalledTimes(3);

        // A dropped connection or a seat at the table ends the watcher sync.
        show(waiting(['south', 'north', 'east'], { watchOnly: true }));
        match.options.onStatus('reconnecting');
        vi.advanceTimersByTime(WATCH_SYNC_INTERVAL * 2);
        show(waiting(['south', 'west', 'north', 'east'], { seat: 'west' }));
        vi.advanceTimersByTime(WATCH_SYNC_INTERVAL * 2);
        expect(match.send).toHaveBeenCalledTimes(3);
    });
});
