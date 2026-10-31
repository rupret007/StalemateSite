const { test, expect } = require('./fixtures');

const SAMPLE_SELECTORS = [
    'h1',
    'h2',
    '.hero__lede',
    '.board-square',
    '.next-show-block .board-square',
    '.button--hot',
    '.button--listen',
    '.site-nav a',
    '.hero__tag',
    '.hero-video__label',
    '.hero-video__teaser',
    '.hero-show .button--ghost',
    '.footer-layout a'
];

const contrastScript = `(() => {
    function parseColor(value) {
        const match = String(value || '').match(/rgba?\\(([^)]+)\\)/i);
        if (!match) return [0, 0, 0, 0];
        const parts = match[1].split(',').map((part) => parseFloat(part.trim()));
        return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
    }
    function channel(component) {
        const value = component / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    }
    function luminance(rgb) {
        return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
    }
    function contrast(first, second) {
        const lighter = Math.max(luminance(first), luminance(second));
        const darker = Math.min(luminance(first), luminance(second));
        return (lighter + 0.05) / (darker + 0.05);
    }
    function blend(foreground, background) {
        const alpha = foreground[3];
        if (alpha >= 1) return [foreground[0], foreground[1], foreground[2], 1];
        if (alpha <= 0) return background;
        return [
            foreground[0] * alpha + background[0] * (1 - alpha),
            foreground[1] * alpha + background[1] * (1 - alpha),
            foreground[2] * alpha + background[2] * (1 - alpha),
            1
        ];
    }
    function effectiveBackground(element) {
        const stack = [];
        let node = element;
        while (node && node.nodeType === 1) {
            stack.push(parseColor(getComputedStyle(node).backgroundColor));
            node = node.parentElement;
        }
        let background = [23, 20, 16, 1];
        for (let index = stack.length - 1; index >= 0; index -= 1) {
            background = blend(stack[index], background);
        }
        return background;
    }
    function isLarge(style) {
        const size = parseFloat(style.fontSize);
        const weight = parseInt(style.fontWeight, 10) || 400;
        return size >= 24 || (size >= 18.66 && weight >= 700);
    }
    function hasOwnText(element) {
        return [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim());
    }
    function isVisible(element) {
        const style = getComputedStyle(element);
        if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) {
            return false;
        }
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
    }
    const failures = [];
    for (const selector of ${JSON.stringify(SAMPLE_SELECTORS)}) {
        const element = document.querySelector(selector);
        if (!element || !isVisible(element) || !hasOwnText(element)) continue;
        const style = getComputedStyle(element);
        const color = parseColor(style.color);
        const background = effectiveBackground(element);
        const ratio = contrast(blend(color, background), background);
        const minimum = isLarge(style) ? 3 : 4.5;
        if (ratio + 0.02 < minimum) {
            failures.push(selector + ' ' + ratio.toFixed(2) + ' < ' + minimum);
        }
    }
    return failures;
})()`;

test('sampled homepage text meets AA against the dark canvas', async ({ page }) => {
    await page.goto('/');
    expect(await page.evaluate(contrastScript)).toEqual([]);
});

test('next-up sticker uses dark text on lime with AA contrast', async ({ page }) => {
    await page.goto('/');
    const ratio = await page.locator('.next-show-block .board-square').evaluate((el) => {
        const parse = (v) => (v.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
        const lum = ([r, g, b]) => [r, g, b].map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; })
            .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
        const style = getComputedStyle(el);
        const a = lum(parse(style.color));
        const b = lum(parse(style.backgroundColor));
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
    expect(ratio).toBeGreaterThanOrEqual(4.5);
});

test('desktop video copy and show actions have opaque backing over the checkerboard', async ({ page }) => {
    for (const width of [1024, 1280]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.goto('/');
        for (const selector of ['.hero-video__label', '.hero-video__teaser', '.hero-show .button--ghost']) {
            const surface = await page.locator(selector).first().evaluate(el => {
                // Stop before the hero: its painted checkerboard is a separate layer,
                // so the hero's base backgroundColor alone cannot establish contrast.
                for (let node = el; node && !node.matches('.hero'); node = node.parentElement) {
                    const style = getComputedStyle(node);
                    if (style.backgroundColor === 'rgb(23, 20, 16)' && style.backgroundImage === 'none') return true;
                }
                return false;
            });
            expect(surface, selector + ' must have an opaque dark surface below its text').toBe(true);
        }
        expect(await page.evaluate(contrastScript)).toEqual([]);
    }
});
