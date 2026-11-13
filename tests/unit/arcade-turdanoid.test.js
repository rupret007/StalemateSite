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

const launchWaitText = 'Launch is not active yet. The countdown is still running.';
const race = new TurdanoidBrickRace('race-12345', 50_000, null, 1);

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

function pointer(target, type, x, y, pointerId = 1) {
    target.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId, button: 0, isPrimary: true, clientX: x, clientY: y
    }));
}

function inputs() {
    return client.sent.flatMap(frame => frame.action === 'input' ? frame.inputs : []);
}

describe('Turdanoid brick race phone friction', () => {
    it('keeps a full-width board in the short landscape brick rules', () => {
        const css = readFileSync(path.join(root, 'r/45662413410ed051/lobby/lobby.css'), 'utf8');
        const start = css.indexOf('@media (max-height: 450px) and (max-width: 900px) and (orientation: landscape)');
        const landscape = css.slice(start, css.indexOf('@media (prefers-reduced-motion: reduce)', start));
        const brickRules = [...landscape.matchAll(/([^{}]+)\{([^{}]+)\}/g)]
            .filter(([, selector]) => selector.includes('brick'));
        expect(brickRules.length).toBeGreaterThan(0);
        for (const [, selector] of brickRules) expect(selector).toContain('.arcade-brick-race');
        const board = brickRules.find(([, selector]) => selector.includes('.brick-race-board'));
        const layout = brickRules.find(([, selector]) => selector.includes('.brick-race-layout'));
        expect(board[2]).toMatch(/width:\s*100%/);
        expect(board[2]).toMatch(/max-width:\s*none/);
        expect(layout[2]).toMatch(/minmax\(0,\s*1fr\)\s+4\.75rem/);
        expect(landscape).not.toMatch(/\.brick-race-layout,\s*\.brick-race-rail/);
    });

    it('explains a disabled Launch during the countdown and hides that hint in play', () => {
        const view = mount();
        view.publish(50_000);
        view.pump();
        expect(view.hint.hidden).toBe(false);
        expect(view.hint.textContent).toBe(launchWaitText);
        expect(view.launch.disabled).toBe(true);
        expect(view.launch.getAttribute('aria-describedby')).toBe('brick-race-launch-wait');
        view.publish(54_000);
        view.pump();
        expect(view.hint.hidden).toBe(true);
        expect(view.hint.textContent).toBe('');
        expect(view.launch.hasAttribute('aria-describedby')).toBe(false);
        expect(view.launch.disabled).toBe(false);
        expect(view.table.dataset.phase).toBe('play');
    });

    it('launches from a tap on the stuck ball and lets a drag only aim', () => {
        const source = readFileSync(path.join(root, 'r/45662413410ed051/lobby/arcade-turdanoid.mjs'), 'utf8');
        expect(source.match(/queue\('serve'\)/g)).toEqual(["queue('serve')"]);
        const view = mount();
        view.publish(54_000);
        view.pump();
        const ball = view.ballPoint();
        pointer(view.board, 'pointerdown', ball.x, ball.y);
        pointer(view.board, 'pointerup', ball.x + 2, ball.y + 1);
        pointer(view.board, 'pointerdown', ball.x, ball.y);
        pointer(view.board, 'pointerup', ball.x, ball.y);
        view.launch.click();
        view.pump();
        expect(inputs().filter(([, action]) => action === 'serve')).toHaveLength(1);

        client.sent.length = 0;
        pointer(view.board, 'pointerdown', ball.x, ball.y);
        pointer(view.board, 'pointermove', ball.x + 24, ball.y);
        pointer(view.board, 'pointerup', ball.x + 36, ball.y);
        view.pump();
        expect(inputs().some(([, action]) => action === 'serve')).toBe(false);
        expect(inputs().some(([, action]) => action === 'aim')).toBe(true);
        expect(view.table.dataset.stuck).toBe('false');
    });

    it('does not launch from a tap away from the stuck ball', () => {
        const view = mount();
        view.publish(54_000);
        view.pump();
        client.sent.length = 0;
        pointer(view.board, 'pointerdown', 8, 8);
        pointer(view.board, 'pointerup', 9, 8);
        view.pump();
        expect(inputs().some(([, action]) => action === 'serve')).toBe(false);
        expect(inputs().some(([, action]) => action === 'aim')).toBe(true);
        expect(view.table.dataset.stuck).toBe('true');
    });

    it('hides the countdown hint for a spectator', () => {
        const view = mount();
        view.publish(50_000, null);
        view.pump();
        expect(view.hint.hidden).toBe(true);
        expect(view.launch.hidden).toBe(true);
    });

    // Finding 2: nobody queues for a seat and a rematch keeps the same two players.
    it('tells a watcher what they are watching and how it ended without promising a turn', () => {
        const view = mount();
        view.publish(54_000, null);
        expect(view.status.textContent).toBe('Watching · ' + race.view('a', 54_000).wall.name);
        expect(view.status.textContent).not.toMatch(/up next|You’re up/);
        expect(view.main.hidden).toBe(true);
        const finished = race.view('a', 80_000);
        finished.result = { winner: 'a', reason: 'time' };
        client.handlers.onState({
            state: { version: 1, game: 'turdanoid', id: 'race-12345', seat: null, waiting: false, rematch: null, match: finished },
            canOpen: false
        });
        expect(view.status.textContent).toBe('Watching · Player 1 wins · time limit');
        expect(view.main.hidden).toBe(true);
    });

    // Finding 1: a race also closes when the guest leaves, a player is removed or it times out.
    it('says the race ended, not that the host left, when the table disappears', () => {
        const view = mount();
        view.publish(54_000, 'b');
        client.handlers.onState({ state: null, canOpen: false });
        expect(view.status.textContent).toBe('This race ended. Waiting for the host to open a table.');
        expect(view.main.hidden).toBe(true);
        const host = mount();
        host.publish(54_000, 'a');
        client.handlers.onState({ state: null, canOpen: true });
        expect(host.status.textContent).toBe('This race ended. Same wall and three balls. Clear it first or break the most bricks in 75 seconds.');
        expect(host.status.textContent).not.toMatch(/host left/i);
        expect(host.main.textContent).toBe('Open');
    });

    // Finding 6: after three failed tries nothing reconnects until Retry is tapped.
    it('does not say Reconnecting once the client has stopped trying', () => {
        const view = mount();
        view.publish(54_000, 'b');
        client.handlers.onStatus('unavailable');
        expect(view.status.textContent).toBe('Couldn’t reconnect. The race clock keeps running. Tap Retry.');
        expect(view.status.textContent).not.toMatch(/Reconnecting/);
        expect(view.main.hidden).toBe(false);
        expect(view.main.textContent).toBe('Retry');
        expect(view.main.dataset.command).toBe('retry');
        const never = mount();
        client.handlers.onStatus('unavailable');
        expect(never.status.textContent).toBe('Couldn’t reconnect. Tap Retry.');
        expect(never.main.textContent).toBe('Retry');
    });

    it('tells a touch player to drag and tap instead of using arrow keys and Space', () => {
        const touch = mount({ coarse: true });
        expect(touch.help.textContent).toBe('Drag to move. Tap the stuck ball or press Launch.');
        expect(touch.help.textContent).not.toMatch(/arrow keys|Space/);
        const keys = mount({ coarse: false });
        expect(keys.help.textContent).toBe('Drag or use the arrow keys to move. Tap the stuck ball, press Launch, or press Space.');
    });
});

function mount({ coarse = true } = {}) {
    client.sent.length = 0;
    document.body.replaceChildren();
    const media = query => ({
        matches: query === '(pointer: coarse)' ? coarse : true,
        addEventListener() {},
        removeEventListener() {}
    });
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
    const board = container.querySelector('[data-brick-board]');
    board.getBoundingClientRect = () => ({
        x: 0, y: 0, left: 0, top: 0, right: 240, bottom: 200, width: 240, height: 200, toJSON() { return {}; }
    });
    api.setRoom({ room: '#game-2ca9e1x1be34a', ref: 'ref-1', actor: 'actor-1' });
    api.open();
    return {
        board,
        hint: container.querySelector('[data-brick-launch-wait]'),
        help: container.querySelector('.brick-race-help'),
        launch: container.querySelector('[data-brick-serve]'),
        table: container.querySelector('[data-brick-match]'),
        status: container.querySelector('[data-brick-status]'),
        main: container.querySelector('[data-brick-main]'),
        publish(now, seat = 'b') {
            client.handlers.onState({
                state: {
                    version: 1, game: 'turdanoid', id: 'race-12345', seat, waiting: false, rematch: null,
                    match: race.view(seat || 'a', now)
                },
                canOpen: false
            });
        },
        pump(ms = 100) {
            clock = (clock || performance.now()) + ms;
            for (const callback of frames.splice(0)) callback(clock);
        },
        ballPoint() {
            const ball = race.view('b', 54_000).runner.run.ball;
            return { x: ball.x / 480 * 240, y: ball.y / 400 * 200 };
        }
    };
}
