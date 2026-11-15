import { afterEach, describe, expect, it, vi } from 'vitest';
import { TurdanoidBrickRace } from '../../play/games/turdanoid-race.js';

const client = vi.hoisted(() => ({ sent: [], handlers: null }));
vi.mock('../../r/45662413410ed051/lobby/game-night-match-client.mjs', () => ({
    matchConnectionErrors: {},
    createGameNightMatchClient: handlers => {
        client.handlers = handlers;
        return { start() {}, stop() {}, send(frame) { client.sent.push(frame); return true; } };
    }
}));

const { mountArcadeTurdanoid } = await import('../../r/45662413410ed051/lobby/arcade-turdanoid.mjs');

const layoutTypes = ['resize', 'orientationchange'];

function trackLayoutListeners() {
    const live = new Map(layoutTypes.map(type => [type, new Set()]));
    const calls = { resize: 0, orientationchange: 0 };
    const add = window.addEventListener.bind(window);
    const remove = window.removeEventListener.bind(window);
    vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
        if (!layoutTypes.includes(type)) return add(type, listener, options);
        const wrapped = function (event) {
            calls[type] += 1;
            return listener.call(this, event);
        };
        live.get(type).add(wrapped);
        if (options?.signal && !options.signal.aborted) {
            options.signal.addEventListener('abort', () => live.get(type).delete(wrapped), { once: true });
        }
        return add(type, wrapped, options);
    });
    vi.spyOn(window, 'removeEventListener').mockImplementation((type, listener, options) => {
        live.get(type)?.delete(listener);
        return remove(type, listener, options);
    });
    return {
        live: type => live.get(type).size,
        calls,
        resetCalls() { calls.resize = calls.orientationchange = 0; }
    };
}

function settleToggle() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

function mountRace() {
    client.sent.length = 0;
    document.body.replaceChildren();
    globalThis.matchMedia = () => ({ matches: true });
    HTMLCanvasElement.prototype.getContext = () => new Proxy(() => {}, { get: () => () => {}, set: () => true });
    globalThis.requestAnimationFrame = () => 1;
    globalThis.cancelAnimationFrame = () => {};
    const container = document.createElement('div');
    document.body.append(container);
    const api = mountArcadeTurdanoid(container, () => {});
    const dialog = api.panel.querySelector('[data-brick-confirm]');
    dialog.showModal = () => { dialog.open = true; };
    dialog.close = () => { dialog.open = false; };
    api.setRoom({ room: 'room', ref: 'ref', actor: 'actor' });
    api.open();
    const race = new TurdanoidBrickRace('race-12345', 50_000, null, 1);
    return {
        api,
        status: api.panel.querySelector('[data-brick-status]'),
        publish(state) { client.handlers.onState({ state, canOpen: true }); },
        active: {
            version: 1, game: 'turdanoid', id: 'race-12345', seat: 'a', waiting: false,
            match: { ...race.view('a', 54_000), result: null }
        }
    };
}

afterEach(async () => {
    for (const panel of document.querySelectorAll('.arcade-brick-race')) panel.open = false;
    await settleToggle();
});

describe('Turdanoid listener lifecycle', () => {
    it('two mount/reset cycles leave exactly one live listener of each type', async () => {
        const layout = trackLayoutListeners();

        const first = mountRace();
        expect(layout.live('resize')).toBe(1);
        expect(layout.live('orientationchange')).toBe(1);
        first.api.panel.open = false;
        await settleToggle();
        expect(layout.live('resize')).toBe(0);
        expect(layout.live('orientationchange')).toBe(0);

        const second = mountRace();
        second.api.panel.open = false;
        await settleToggle();
        second.api.open();
        expect(layout.live('resize')).toBe(1);
        expect(layout.live('orientationchange')).toBe(1);
        layout.resetCalls();
        window.dispatchEvent(new Event('resize'));
        window.dispatchEvent(new Event('orientationchange'));
        expect(layout.calls.resize).toBe(1);
        expect(layout.calls.orientationchange).toBe(1);
    });
});

describe('Turdanoid reconnect status', () => {
    it('replaces the reconnect line once the connection is back and match state is applied', () => {
        const view = mountRace();
        view.publish(view.active);
        const playing = view.active.match.wall.name;
        expect(view.status.textContent).toBe(playing);

        client.handlers.onStatus('reconnecting');
        expect(view.status.textContent).toBe('Reconnecting · race clock keeps running');
        view.publish(view.active);
        expect(view.status.textContent).toBe(playing);

        const finished = {
            ...view.active,
            match: { ...view.active.match, result: { winner: 'a', reason: 'time' } }
        };
        view.publish(finished);
        expect(view.status.textContent).toBe('You win · time limit');
        client.handlers.onStatus('connecting');
        expect(view.status.textContent).toBe('Reconnecting to the race…');
        view.publish(finished);
        expect(view.status.textContent).toBe('You win · time limit');
    });
});
