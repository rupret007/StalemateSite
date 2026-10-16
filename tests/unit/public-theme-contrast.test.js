// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(fileURLToPath(new URL('../..', import.meta.url)));
const PUBLIC_HTML = [
    'index.html',
    '404.html'
];
const TEXT_ON_DARK = ['cream', 'muted', 'blue', 'blue-bright', 'lime', 'amber'];
const BUTTON_ON_ACCENT = ['blue', 'blue-bright', 'lime'];
const DARK_SURFACES = ['ink', 'ink-soft', 'surface', 'surface-raised'];

function hexToRgb(hex) {
    const value = hex.replace('#', '');
    return [
        parseInt(value.slice(0, 2), 16),
        parseInt(value.slice(2, 4), 16),
        parseInt(value.slice(4, 6), 16)
    ];
}

function channel(component) {
    const value = component / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
    const [red, green, blue] = hexToRgb(hex);
    return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

function contrast(first, second) {
    const lighter = Math.max(luminance(first), luminance(second));
    const darker = Math.min(luminance(first), luminance(second));
    return (lighter + 0.05) / (darker + 0.05);
}

function mixHex(foreground, background, alpha) {
    const [fr, fg, fb] = hexToRgb(foreground);
    const [br, bg, bb] = hexToRgb(background);
    return `#${[fr, fg, fb]
        .map((value, index) => Math.round(value * alpha + [br, bg, bb][index] * (1 - alpha))
            .toString(16)
            .padStart(2, '0'))
        .join('')}`;
}

function readRootTokens(css) {
    const block = css.match(/:root\s*\{([^}]+)\}/);
    expect(block, 'styles.css exposes a :root token block').not.toBeNull();
    return Object.fromEntries([...block[1].matchAll(/--([a-z-]+):\s*([^;]+);/g)]
        .map(([, name, value]) => [name, value.trim()]));
}

function readLineAlpha(value) {
    const match = value.match(/^rgba\(\s*244,\s*240,\s*230,\s*([0-9.]+)\s*\)$/);
    expect(match, `expected cream-on-ink line token, got ${value}`).not.toBeNull();
    return Number(match[1]);
}

describe('public dark theme contrast', () => {
    it('keeps the exact Rad Dad palette and WCAG AA text, button, and focus tokens', async () => {
        const css = await readFile(join(repoRoot, 'styles.css'), 'utf8');
        const tokens = readRootTokens(css);

        expect(css).toMatch(/color-scheme:\s*dark/);
        expect(tokens.ink).toBe('#171410');
        expect(tokens.cream).toBe('#f4f0e6');
        expect(tokens.blue).toBe('#009ee8');
        expect(tokens.lime).toBe('#b5dc08');
        expect(tokens.pink).toBe('#ed2765');
        expect(tokens['ska-dark']).toBe('#171410');
        expect(tokens['ska-light']).toBe('#f4f0e6');
        expect(contrast(tokens.ink, '#000000')).toBeGreaterThanOrEqual(1.12);
        expect(contrast(tokens.cream, tokens.ink)).toBeGreaterThan(contrast(tokens.ink, '#000000'));

        for (const surface of DARK_SURFACES) {
            for (const name of TEXT_ON_DARK) {
                expect(contrast(tokens[name], tokens[surface]), `${name} on ${surface}`).toBeGreaterThanOrEqual(4.5);
            }
            expect(contrast(tokens.pink, tokens[surface]), `pink on ${surface}`).toBeGreaterThanOrEqual(3);
        }

        for (const accent of BUTTON_ON_ACCENT) {
            expect(contrast(tokens.ink, tokens[accent]), `ink on ${accent}`).toBeGreaterThanOrEqual(4.5);
        }

        expect(contrast(tokens.lime, tokens.ink), 'focus ring').toBeGreaterThanOrEqual(3);
        expect(contrast(
            mixHex('#f4f0e6', tokens.ink, readLineAlpha(tokens['line-strong'])),
            tokens.ink
        ), 'interactive border').toBeGreaterThanOrEqual(3);
        expect(css).toMatch(/outline:\s*3px\s+solid\s+var\(--lime\)/);
    });

    it('keeps public pages on the same dark theme-color and a readable ska checkerboard', async () => {
        const css = await readFile(join(repoRoot, 'styles.css'), 'utf8');
        expect(css).toMatch(/repeating-conic-gradient/);
        expect(css).toMatch(/\.ska-belt/);
        expect(css).toMatch(/\.hero-grid/);

        for (const relativePath of PUBLIC_HTML) {
            const html = await readFile(join(repoRoot, relativePath), 'utf8');
            expect(html, relativePath).toContain('<meta name="theme-color" content="#171410">');
            expect(html, relativePath).toMatch(/ska-belt|ska-rule|hero-board/);
        }
    });

    it('keeps checkerboard restrained and honors reduced motion', async () => {
        const css = await readFile(join(repoRoot, 'styles.css'), 'utf8');
        const panelBlock = css.match(/\.panel\s*\{[^}]+\}/);
        expect(panelBlock, 'panel token block').not.toBeNull();
        expect(panelBlock[0]).toMatch(/border:\s*1px\s+solid/);
        expect(panelBlock[0]).not.toMatch(/repeating-conic-gradient/);
        expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
        expect(css).toMatch(/prefers-reduced-motion:\s*no-preference/);
        expect(css).toContain('safe-area-inset-top');
        expect(css).toContain('safe-area-inset-bottom');
        expect(css).toContain('safe-area-inset-left');
        expect(css).toContain('safe-area-inset-right');
    });
});
