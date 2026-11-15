import { afterEach, describe, expect, it, vi } from 'vitest';

const clients = vi.hoisted(() => []);
vi.mock('../../r/45662413410ed051/lobby/game-night-match-client.mjs', async importOriginal => {
    const actual = await importOriginal();
    return {
        ...actual,
        createGameNightMatchClient(options) {
            clients.push(options);
            return { start() {}, stop() {}, send: () => true, matchOpen: () => false, matchUnavailable: () => false };
        }
    };
});
vi.mock('../../r/45662413410ed051/lobby/game-night-audio.mjs', () => ({ gameNightCue() {} }));
vi.mock('/play/games/turdspades-engine.js', () => ({ suggestSpadesBid: () => 3 }));

import { mountArcadeTurdSpades } from '../../r/45662413410ed051/lobby/arcade-turdspades.mjs';
import { mountArcadeTurdanoid } from '../../r/45662413410ed051/lobby/arcade-turdanoid.mjs';
import { TurdanoidBrickRace } from '../../play/games/turdanoid-race.js';

afterEach(() => {
    document.body.replaceChildren();
    clients.length = 0;
    vi.restoreAllMocks();
});

function room() { return { room: '#game-fixture', ref: 'fixture', actor: 'actor' }; }

describe('terminal match close clears real private game views', () => {
    it.each(['partners', 'four'])('clears a seated %s Spades hand through its terminal status handler', mode => {
        const container = document.createElement('div');
        document.body.append(container);
        const view = mountArcadeTurdSpades(container, () => {});
        view.setRoom(room());
        const handlers = clients.at(-1);
        handlers.onState({ state: {
            version: 1, game: 'turdspades', id: 'match-fixture', seat: 'south', mode,
            waiting: false, occupied: ['south'], match: {
                phase: 'bid', hand: [{ id: 17, suit: 'S', rank: 'A', playable: false }],
                scores: [0, 0], target: 500, bags: [0, 0], trick: [], lastTrick: [],
                bids: { south: null, west: null, north: null, east: null },
                tricks: { south: 0, west: 0, north: 0, east: 0 }, round: 1, turn: 'west', canBid: false
            }
        }, canOpen: false });
        expect(container.querySelectorAll('[data-spades-card]')).toHaveLength(1);

        // Calling the destructuring callback with undefined would throw, as K26 did.
        expect(() => handlers.onStatus('unavailable', 'banned')).not.toThrow();
        expect(container.querySelectorAll('[data-spades-card]')).toHaveLength(0);
        expect(container.querySelector('[data-spades-table]').hidden).toBe(true);
    });

    it('clears a seated Turdanoid board through its terminal status handler', () => {
        const raf = vi.fn(() => 1);
        vi.stubGlobal('requestAnimationFrame', raf);
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        HTMLCanvasElement.prototype.getContext = () => new Proxy(() => {}, {
            get: (_target, key) => key === 'measureText' ? () => ({ width: 1 }) : () => {},
            apply: () => undefined
        });
        window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
        const container = document.createElement('div');
        document.body.append(container);
        const view = mountArcadeTurdanoid(container, () => {});
        view.setRoom(room());
        const handlers = clients.at(-1);
        const race = new TurdanoidBrickRace('race-fixture', 50_000, null, 1);
        handlers.onState({ state: {
            version: 1, game: 'turdanoid', id: 'race-fixture', seat: 'a', waiting: false,
            match: race.view('a', 50_000)
        }, canOpen: false });
        expect(container.querySelector('[data-brick-match]').hidden).toBe(false);

        expect(() => handlers.onStatus('unavailable', 'kicked')).not.toThrow();
        expect(container.querySelector('[data-brick-match]').hidden).toBe(true);
    });
});
