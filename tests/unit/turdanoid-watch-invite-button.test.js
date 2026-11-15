import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { TurdanoidBrickRace } from '../../play/games/turdanoid-race.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const client = vi.hoisted(() => ({ sent: [], handlers: null }));

vi.mock('../../r/45662413410ed051/lobby/game-night-match-client.mjs', () => ({
    matchConnectionErrors: {},
    createGameNightMatchClient: options => {
        client.handlers = options;
        return {
            start() {},
            stop() {},
            send(frame) { client.sent.push(JSON.parse(JSON.stringify(frame))); return true; }
        };
    }
}));

const { mountArcadeTurdanoid } = await import('../../r/45662413410ed051/lobby/arcade-turdanoid.mjs');

const watchingStatus = 'Watching · waiting for players';
const race = new TurdanoidBrickRace('race-12345', 50_000, null, 1);
const waiting = { version: 1, game: 'turdanoid', id: 'race-12345', seat: 'a', waiting: true, match: null };

function canvasStub() {
    let proxy;
    const node = function stub() { return proxy; };
    proxy = new Proxy(node, {
        get: (_target, prop) => prop === 'a' ? 1 : proxy,
        set: () => true,
        apply: () => proxy
    });
    return proxy;
}

function pointer(target, type, x, y) {
    target.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 1, button: 0, isPrimary: true, clientX: x, clientY: y
    }));
}

function shown(button) {
    if (button.hidden || button.closest('[hidden]')) return false;
    const dialog = button.closest('dialog');
    return !dialog || dialog.open;
}

describe('Turdanoid watch invite while the table is waiting', () => {
    it('shows a watching state with no Join button and no input controls', () => {
        const view = mount();
        view.publish({ ...waiting, seat: null, watchOnly: true });
        expect(view.status.textContent).toBe(watchingStatus);
        expect(view.main.hidden).toBe(true);
        expect(view.main.dataset.command).not.toBe('join');
        expect(view.main.textContent).not.toMatch(/Join/);
        expect(view.launch.hidden).toBe(true);
        expect(view.leave.hidden).toBe(true);
        expect(view.table.hidden).toBe(true);
        expect(view.board.tabIndex).toBe(-1);
        expect(shown(view.launch)).toBe(false);
        expect(view.panel.querySelector('[data-start-rematch]').hidden).toBe(true);
        view.main.click();
        pointer(view.board, 'pointerdown', 40, 80);
        view.board.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        view.board.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
        expect(client.sent.filter(frame => frame.action === 'join' || frame.action === 'input')).toEqual([]);
        expect([...view.panel.querySelectorAll('button')].filter(shown).map(button => button.textContent)).toEqual([]);
    });

    it('keeps Join for an unseated guest who is not watch-only', () => {
        const view = mount();
        view.publish({ ...waiting, seat: null });
        expect(view.status.textContent).toBe('An opponent is ready.');
        expect(view.main.hidden).toBe(false);
        expect(view.main.textContent).toBe('Join Turdanoid race');
        expect(view.main.dataset.command).toBe('join');
        view.main.click();
        expect(client.sent).toContainEqual({ action: 'join', id: 'race-12345' });

        const explicit = mount();
        explicit.publish({ ...waiting, seat: null, watchOnly: false });
        expect(explicit.main.hidden).toBe(false);
        expect(explicit.main.textContent).toBe('Join Turdanoid race');
        expect(explicit.status.textContent).toBe('An opponent is ready.');
    });

    it('keeps the seated waiting line and does not offer Join', () => {
        const view = mount();
        view.publish(waiting);
        expect(view.status.textContent).toBe('Waiting for a second player.');
        expect(view.main.hidden).toBe(true);
        expect(view.main.dataset.command).not.toBe('join');
        expect(view.leave.hidden).toBe(false);
        view.main.click();
        expect(client.sent.filter(frame => frame.action === 'join')).toEqual([]);
    });

    it('still withholds play controls when a watch-only guest can see the race', () => {
        const view = mount();
        view.publish({
            version: 1, game: 'turdanoid', id: 'race-12345', seat: null, watchOnly: true, waiting: false,
            match: { ...race.view('a', 54_000), result: null }
        });
        view.pump();
        expect(view.main.hidden).toBe(true);
        expect(view.main.dataset.command).not.toBe('join');
        expect(view.launch.hidden).toBe(true);
        expect(view.leave.hidden).toBe(true);
        expect(view.help.hidden).toBe(true);
        expect(view.board.tabIndex).toBe(-1);
        expect(view.status.textContent).not.toMatch(/Join/);
        pointer(view.board, 'pointerdown', 40, 80);
        pointer(view.board, 'pointerup', 40, 80);
        view.launch.click();
        view.board.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        view.pump();
        expect(client.sent.filter(frame => frame.action === 'join' || frame.action === 'input')).toEqual([]);
        expect(view.table.dataset.paddle).toBeUndefined();
        expect(view.table.dataset.stuck).toBeUndefined();
    });

    it('fits the watching line on a 390×844 phone without horizontal scroll', () => {
        Object.defineProperties(window, {
            innerWidth: { configurable: true, value: 390 },
            innerHeight: { configurable: true, value: 844 }
        });
        const css = readFileSync(path.join(root, 'r/45662413410ed051/lobby/lobby.css'), 'utf8');
        document.head.insertAdjacentHTML('beforeend', `<style data-brick-watch-phone>${css}</style>`);
        const view = mount();
        const phone = document.createElement('div');
        phone.style.cssText = 'width:390px;height:844px;overflow-x:auto;box-sizing:border-box';
        phone.append(view.panel);
        document.body.append(phone);
        view.panel.style.boxSizing = 'border-box';
        view.panel.style.width = '390px';
        view.panel.style.maxWidth = '390px';
        view.publish({ ...waiting, seat: null, watchOnly: true });
        expect(view.status.textContent).toBe(watchingStatus);
        const statusStyle = getComputedStyle(view.status);
        const fontSize = Number.parseFloat(statusStyle.fontSize);
        expect(statusStyle.display).toBe('block');
        expect(statusStyle.whiteSpace).not.toBe('nowrap');
        expect(fontSize).toBe(12);
        expect(getComputedStyle(phone).width).toBe('390px');
        expect(getComputedStyle(phone).height).toBe('844px');
        const longest = Math.max(...watchingStatus.split(/\s+/).map(word => word.length));
        expect(longest * fontSize).toBeLessThan(390);
        expect(watchingStatus.length).toBeLessThan('Rematch requested. Waiting for your rival.'.length);
        expect([...view.panel.querySelectorAll('button')].filter(shown).map(button => button.textContent)).not.toContain('Join Turdanoid race');
        document.querySelector('[data-brick-watch-phone]').remove();
    });
});

function mount() {
    client.sent.length = 0;
    document.body.replaceChildren();
    const media = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
    window.matchMedia = media;
    globalThis.matchMedia = media;
    HTMLCanvasElement.prototype.getContext = () => canvasStub();
    const frames = [];
    let clock = 0;
    globalThis.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
    globalThis.cancelAnimationFrame = () => { frames.length = 0; };
    const container = document.createElement('div');
    document.body.append(container);
    const api = mountArcadeTurdanoid(container, () => {});
    const confirmation = container.querySelector('[data-brick-confirm]');
    confirmation.showModal = () => { confirmation.open = true; };
    confirmation.close = () => { confirmation.open = false; };
    const board = container.querySelector('[data-brick-board]');
    board.getBoundingClientRect = () => ({
        x: 0, y: 0, left: 0, top: 0, right: 240, bottom: 200, width: 240, height: 200, toJSON() { return {}; }
    });
    api.setRoom({ room: 'room', ref: 'ref', actor: 'actor' });
    api.open();
    return {
        panel: api.panel,
        board,
        main: container.querySelector('[data-brick-main]'),
        status: container.querySelector('[data-brick-status]'),
        help: container.querySelector('.brick-race-help'),
        launch: container.querySelector('[data-brick-serve]'),
        leave: container.querySelector('[data-brick-leave]'),
        table: container.querySelector('[data-brick-match]'),
        publish(state) { client.handlers.onState({ state, canOpen: false }); },
        pump(ms = 100) {
            clock = (clock || performance.now()) + ms;
            for (const callback of frames.splice(0)) callback(clock);
        }
    };
}
