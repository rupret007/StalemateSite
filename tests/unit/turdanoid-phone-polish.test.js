import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const css = readFileSync(path.join(root, 'r/45662413410ed051/lobby/lobby.css'), 'utf8');
const mobileStart = css.indexOf('@media (max-width: 900px) and (pointer: coarse)');
const mobile = css.slice(mobileStart, css.indexOf('@media (prefers-reduced-motion: reduce)', mobileStart));

describe('Turdanoid phone layout contract', () => {
    it('uses a viewport bounded play surface with visible return and launch controls', () => {
        expect(mobile).toMatch(/\.arcade-brick-race\[open\]:has\(\[data-brick-match\]:not\(\[hidden\]\)\)[\s\S]*?position: fixed;[\s\S]*?inset: 0;[\s\S]*?height: 100dvh;/);
        expect(css).toMatch(/\.brick-race-actions:has\(\[data-brick-back\]:not\(\[hidden\]\)\)\s*\{[^}]*display: flex/);
        expect(mobile).toMatch(/\.brick-race-actions \.btn\s*\{[^}]*min-height: 44px/);
        expect(mobile).toMatch(/\.brick-race-rail \[data-brick-serve\]\s*\{[^}]*grid-column: 1 \/ -1/);
        expect(mobile).toMatch(/\.brick-race-help\s*\{[^}]*position: static/);
    });

    it('computes visible Back, Leave, Launch and a scrollable panel at 390×844', () => {
        const viewport = { width: 390, height: 844 };
        Object.defineProperties(window, {
            innerWidth: { configurable: true, value: viewport.width },
            innerHeight: { configurable: true, value: viewport.height }
        });
        const phoneRules = mobile.slice(mobile.indexOf('{') + 1, mobile.indexOf('\n}\n@media (max-height: 450px)'));
        document.head.insertAdjacentHTML('beforeend', `<style data-brick-phone-test>
            [hidden] { display: none !important; }
            .brick-race-actions { display: flex; }
            ${phoneRules}
        </style>`);
        document.body.innerHTML = `<details class="arcade-brick-race" open>
            <summary>Turdanoid Brick Race</summary>
            <p data-brick-status>Reconnecting · race clock keeps running</p>
            <div class="brick-race-actions">
                <button class="btn" data-brick-back>Back to lobby</button>
                <button class="btn" data-brick-leave>Leave race</button>
            </div>
            <div data-brick-match><div class="brick-race-layout">
                <div class="brick-race-board"></div>
                <div class="brick-race-rail"><button data-brick-serve>Launch ball</button></div>
            </div></div>
        </details>`;
        const panel = document.querySelector('.arcade-brick-race');
        const style = node => window.getComputedStyle(panel.querySelector(node));
        expect(window.getComputedStyle(panel).height).toBe('100dvh');
        expect(window.getComputedStyle(panel).overflowY).toBe('auto');
        expect(style('.brick-race-actions').display).toBe('flex');
        expect(style('.brick-race-rail').display).toBe('grid');
        for (const control of ['[data-brick-back]', '[data-brick-leave]', '[data-brick-serve]']) {
            expect(panel.querySelector(control).hidden).toBe(false);
            expect(style(control).display).not.toBe('none');
        }
        expect(style('[data-brick-back]').minHeight).toBe('44px');
        expect(style('[data-brick-leave]').minHeight).toBe('44px');
        expect(style('[data-brick-back]').minWidth).toBe('44px');
        expect(style('[data-brick-leave]').minWidth).toBe('44px');
        expect(style('[data-brick-leave]').position).toBe('static');
        expect(style('[data-brick-status]').position).toBe('static');
        expect(panel.querySelector('[data-brick-status]').compareDocumentPosition(panel.querySelector('.brick-race-actions')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(panel.querySelector('.brick-race-actions').compareDocumentPosition(panel.querySelector('[data-brick-match]')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(mobile).toContain('width: min(100%, calc(clamp(170px, 100dvh - 560px, 320px) * 1.2))');
        const boardWidth = Math.min(viewport.width - 20, Math.min(320, Math.max(170, viewport.height - 560)) * 1.2);
        expect(boardWidth / 1.2).toBeLessThan(300);
        document.querySelector('[data-brick-phone-test]').remove();
    });

    it('bounds the landscape board by viewport height and keeps a score rail beside it', () => {
        const landscape = mobile.slice(mobile.indexOf('@media (max-height: 450px)'));
        expect(landscape).toMatch(/\.brick-race-layout\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\) 10rem/);
        expect(landscape).toMatch(/\.brick-race-board\s*\{[^}]*width: min\(calc\(\(100dvh - 180px\) \* 1\.2\), calc\(100dvw - 190px\)\)/);
        const width = Math.min((390 - 180) * 1.2, 844 - 190);
        expect(width / 1.2).toBeLessThanOrEqual(210);
        expect(mobile).toMatch(/\.brick-race-actions \.btn\s*\{[^}]*min-height: 44px;[^}]*min-width: 44px/);
        expect(mobile).toMatch(/\[data-brick-leave\]\s*\{ position: static; \}/);
    });
});

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
        api, dialog,
        back: api.panel.querySelector('[data-brick-back]'),
        leave: api.panel.querySelector('[data-brick-leave]'),
        publish(state) { client.handlers.onState({ state, canOpen: true }); },
        waiting: { version: 1, game: 'turdanoid', id: 'race-12345', seat: 'a', waiting: true, match: null },
        active: { version: 1, game: 'turdanoid', id: 'race-12345', seat: 'a', waiting: false,
            match: { ...race.view('a', 54_000), result: null } }
    };
}

describe('Turdanoid phone exit flow', () => {
    it.each(['back', 'leave'])('%s closes an open seat in one tap and returns to the lobby', control => {
        const view = mountRace();
        view.publish(view.waiting);
        expect(view.back.hidden).toBe(false);
        view[control].click();
        expect(view.dialog.open).toBe(false);
        expect(client.sent).toContainEqual({ action: 'leave', id: 'race-12345' });
        view.publish(null);
        expect(view.api.panel.open).toBe(false);
    });

    it.each(['back', 'leave'])('%s asks once during a race, defaults to stay, then returns to the lobby', control => {
        const view = mountRace();
        view.publish(view.active);
        view[control].click();
        expect(view.dialog.open).toBe(true);
        expect(view.dialog.querySelector('[data-brick-confirm-text]').textContent).toBe('Leaving forfeits this race.');
        expect(view.dialog.querySelector('[autofocus]')).toBe(view.dialog.querySelector('[data-brick-confirm-no]'));
        expect(client.sent).toEqual([]);
        view.dialog.querySelector('[data-brick-confirm-no]').click();
        expect(view.api.panel.open).toBe(true);
        expect(client.sent).toEqual([]);
        view[control].click();
        view.dialog.querySelector('[data-brick-confirm-yes]').click();
        expect(client.sent).toContainEqual({ action: 'resign', id: 'race-12345' });
        view.publish({ ...view.active, match: { ...view.active.match, result: { winner: 'b', reason: 'resign' } } });
        expect(view.api.panel.open).toBe(false);
        expect(view.api.panel.querySelector('[data-brick-main]').textContent).toMatch(/rematch/i);
    });

    it('lets Back reach the lobby while reconnecting', () => {
        const view = mountRace();
        view.publish(view.active);
        client.handlers.onStatus('connecting');
        view.back.click();
        expect(view.api.panel.open).toBe(false);
        expect(view.dialog.open).toBe(false);
    });

    it('returns from a finished race in one tap with the rematch path available', () => {
        const view = mountRace();
        view.publish({ ...view.active, match: { ...view.active.match, result: { winner: 'a', reason: 'time' } } });
        expect(view.api.panel.querySelector('[data-brick-main]').textContent).toMatch(/rematch/i);
        view.back.click();
        expect(view.dialog.open).toBe(false);
        expect(view.api.panel.open).toBe(false);
    });
});
