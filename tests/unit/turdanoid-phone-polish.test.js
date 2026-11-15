import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const css = readFileSync(path.join(root, 'r/45662413410ed051/lobby/lobby.css'), 'utf8');
const mobileStart = css.indexOf('@media (max-width: 900px) and (pointer: coarse)');
const mobile = css.slice(mobileStart, css.indexOf('@media (prefers-reduced-motion: reduce)', mobileStart));

function phoneStyleSheet() {
    const opening = css.indexOf('{', mobileStart);
    let depth = 1;
    let end = opening + 1;
    while (depth && end < css.length) {
        if (css[end] === '{') depth++;
        if (css[end] === '}') depth--;
        end++;
    }
    // jsdom does not evaluate viewport media queries; unwrap the phone rule in place.
    return css.slice(0, mobileStart) + css.slice(opening + 1, end - 1) + css.slice(end);
}

describe('Turdanoid phone layout contract', () => {
    it('uses a viewport bounded play surface with visible return and launch controls', () => {
        expect(mobile).toMatch(/\.arcade-brick-race\[open\]:has\(\[data-brick-match\]:not\(\[hidden\]\)\)[\s\S]*?position: fixed;[\s\S]*?inset: 0;[\s\S]*?height: 100dvh;/);
        expect(mobile).toMatch(/\.brick-race-actions \.btn\s*\{[^}]*min-height: 44px/);
        expect(mobile).toMatch(/\.brick-race-rail \[data-brick-serve\]\s*\{[^}]*grid-column: 1 \/ -1/);
        expect(mobile).toMatch(/\.brick-race-help\s*\{[^}]*position: static/);
    });

    it('keeps the back-only control displayed and bounded at 390×844', () => {
        const dom = new JSDOM(`<!doctype html><style>${phoneStyleSheet()}</style>
            <details class="arcade-card-table arcade-brick-race" open>
                <summary>Turdanoid Brick Race</summary>
                <div class="arcade-card-actions brick-race-actions">
                    <button data-brick-main hidden>Launch</button>
                    <button class="btn btn--small btn--ghost" data-brick-back>Back to lobby</button>
                </div>
                <div data-brick-match></div>
            </details>`);
        const { document, getComputedStyle } = dom.window;
        const panel = document.querySelector('.arcade-brick-race');
        const actions = document.querySelector('.brick-race-actions');
        const back = document.querySelector('[data-brick-back]');
        const panelStyle = getComputedStyle(panel);
        const actionsStyle = getComputedStyle(actions);
        const backStyle = getComputedStyle(back);
        expect(actionsStyle.display).toBe('flex');
        expect(actionsStyle.position).toBe('static');
        expect(backStyle.display).not.toBe('none');
        expect(backStyle.position).toBe('static');
        expect(backStyle.transform).toBe('none');
        expect(panelStyle.position).toBe('fixed');
        expect(panelStyle.inset).toBe('0px');
        expect(panelStyle.width).toBe('100dvw');
        expect(panelStyle.height).toBe('100dvh');
        expect(panelStyle.boxSizing).toBe('border-box');
        expect(backStyle.width).toBe('100%');
        expect(backStyle.minWidth).toBe('0px');
        const viewport = { width: 390, height: 844 };
        const summaryHeight = Number.parseFloat(getComputedStyle(panel.querySelector('summary')).minHeight);
        const buttonHeight = Number.parseFloat(backStyle.minHeight);
        const bounds = {
            left: Number.parseFloat(panelStyle.paddingLeft),
            right: viewport.width - Number.parseFloat(panelStyle.paddingRight),
            top: Number.parseFloat(panelStyle.paddingTop) + summaryHeight + Number.parseFloat(actionsStyle.marginTop),
            bottom: Number.parseFloat(panelStyle.paddingTop) + summaryHeight + Number.parseFloat(actionsStyle.marginTop) + buttonHeight
        };
        expect(buttonHeight).toBeGreaterThanOrEqual(44);
        expect(bounds.left).toBeGreaterThanOrEqual(0);
        expect(bounds.right).toBeLessThanOrEqual(viewport.width);
        expect(bounds.right).toBeGreaterThan(bounds.left);
        expect(bounds.top).toBeGreaterThanOrEqual(0);
        expect(bounds.bottom).toBeLessThanOrEqual(viewport.height - Number.parseFloat(panelStyle.paddingBottom));
    });

    it('bounds the landscape board by viewport height and keeps a score rail beside it', () => {
        const landscape = mobile.slice(mobile.indexOf('@media (max-height: 450px)'));
        expect(landscape).toMatch(/\.brick-race-layout\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\) 10rem/);
        expect(landscape).toMatch(/\.brick-race-board\s*\{[^}]*width: min\(calc\(\(100dvh - 180px\) \* 1\.2\), calc\(100dvw - 190px\)\)/);
        const width = Math.min((390 - 180) * 1.2, 844 - 190);
        expect(width / 1.2).toBeLessThanOrEqual(210);
    });
});
