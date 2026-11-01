'use strict';

const { existsSync } = require('node:fs');
const EXPECTED_VERSION = '1.64.1';

async function verifyBrowsers(playwright, versions, exists = existsSync) {
    if (versions.test !== EXPECTED_VERSION || versions.core !== EXPECTED_VERSION) {
        throw new Error(`Playwright packages must match the pinned CI image ${EXPECTED_VERSION}`);
    }
    for (const name of ['chromium', 'webkit']) {
        const engine = playwright[name];
        if (!engine || !exists(engine.executablePath())) {
            throw new Error(`Pinned ${name} executable is missing`);
        }
        const browser = await engine.launch({ headless: true });
        try {
            const page = await browser.newPage();
            await page.setContent('<!doctype html><title>CI browser probe</title>');
            if (await page.title() !== 'CI browser probe') {
                throw new Error(`${name} did not render the CI probe`);
            }
        } finally {
            await browser.close();
        }
    }
}

module.exports = { EXPECTED_VERSION, verifyBrowsers };
if (require.main === module) {
    verifyBrowsers(require('@playwright/test'), {
        test: require('@playwright/test/package.json').version,
        core: require('playwright-core/package.json').version,
    }).then(() => console.log(`Chromium and WebKit ready: Playwright ${EXPECTED_VERSION}`))
        .catch(error => { console.error(error.message); process.exitCode = 1; });
}
