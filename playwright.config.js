const path = require('node:path');
const { defineConfig } = require('@playwright/test');
const { testBaseURL } = require('./scripts/lib/e2e-test-server.cjs');

const baseURL = testBaseURL(process.env);

module.exports = defineConfig({
    testDir: './tests/e2e',
    timeout: 30000,
    expect: {
        timeout: 5000
    },
    fullyParallel: false,
    retries: process.env.CI ? 1 : 0,
    reporter: [
        ['list'],
        ['html', { open: 'never' }]
    ],
    globalSetup: path.join(__dirname, 'tests/e2e/assert-test-origin.setup.js'),
    use: {
        baseURL,
        browserName: 'chromium',
        headless: true,
        screenshot: 'only-on-failure',
        trace: 'on-first-retry',
        video: 'retain-on-failure'
    },
    webServer: {
        command: 'node scripts/serve-test.cjs',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 30000
    }
});
