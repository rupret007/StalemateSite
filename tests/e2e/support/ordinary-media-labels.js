const { expect } = require('@playwright/test');

// These journeys exercise the ordinary Hang Out room, not shared Watch/Paint mode.
async function expectOrdinaryMediaLabel(page, kind, enabled) {
    if (!['video', 'audio'].includes(kind)) throw new Error(`Unknown media kind: ${kind}`);
    await expect(page.locator('body')).not.toHaveClass(/\b(?:shared-layout|bob-mode)\b/);
    const control = page.locator(kind === 'video' ? '[data-cam]' : '[data-mic]');
    const label = kind === 'video'
        ? (enabled ? 'Turn off my camera' : 'Turn on my camera')
        : (enabled ? 'Mute my mic' : 'Turn on my mic');
    await expect(control).toHaveText(label);
    await expect(control).toHaveAttribute('aria-pressed', String(enabled));
}

module.exports = { expectOrdinaryMediaLabel };
