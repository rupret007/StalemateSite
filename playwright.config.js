const path = require('node:path');
const { defineConfig, devices } = require('@playwright/test');
const { testBaseURL } = require('./scripts/lib/e2e-test-server.cjs');

const baseURL = testBaseURL(process.env);

const phoneProject = (name, use) => ({
    name,
    testMatch: /phones\.spec\.js/,
    use
});

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
    projects: [
        {
            name: 'chromium',
            testIgnore: /phones\.spec\.js/,
            use: { browserName: 'chromium' }
        },
        phoneProject('webkit-iphone-se', {
            ...devices['iPhone SE (3rd gen)'],
            browserName: 'webkit',
            viewport: { width: 375, height: 667 }
        }),
        phoneProject('webkit-iphone-15', {
            ...devices['iPhone 15'],
            browserName: 'webkit',
            viewport: { width: 393, height: 852 }
        }),
        phoneProject('webkit-iphone-15-pro-max', {
            ...devices['iPhone 15 Pro Max'],
            browserName: 'webkit',
            viewport: { width: 430, height: 932 }
        }),
        phoneProject('chromium-android', {
            ...devices['Pixel 5'],
            browserName: 'chromium',
            viewport: { width: 360, height: 800 }
        })
    ],
    webServer: {
        command: 'node scripts/serve-test.cjs',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 30000
    }
});
