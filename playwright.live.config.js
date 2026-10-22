const path = require('node:path');
const { defineConfig, devices } = require('@playwright/test');
const { normalizeBase } = require('./scripts/lib/live-release.cjs');

const baseURL = normalizeBase(process.env.STALEMATE_LIVE_BASE, process.env.STALEMATE_ALLOW_LOCAL_LIVE === '1');
const out = path.resolve(process.env.STALEMATE_LIVE_OUT || 'live-results');

module.exports = defineConfig({
    testDir: './tests/live', timeout: 30000, expect: { timeout: 5000 },
    workers: 1, fullyParallel: false, retries: 0,
    outputDir: path.join(out, 'test-results'),
    reporter: [['list'], ['json', { outputFile: path.join(out, 'browser-results.json') }],
        ['html', { open: 'never', outputFolder: path.join(out, 'report') }]],
    use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure', video: 'retain-on-failure',
        serviceWorkers: 'block' },
    projects: [
        { name: 'live-chromium', use: { browserName: 'chromium', viewport: { width: 1280, height: 900 } } },
        { name: 'live-webkit-phone', use: { ...devices['iPhone SE (3rd gen)'], browserName: 'webkit' } }
    ]
});
