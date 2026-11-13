const { randomBytes } = require('node:crypto');
const { defineConfig } = require('@playwright/test');

// Reuse a value already handed to this process so a second config load cannot
// mint a different invitation than the one the preview was started with.
if (!process.env.BRIDGE_PREVIEW_INVITATION) process.env.BRIDGE_PREVIEW_INVITATION = randomBytes(24).toString('hex');

const invitation = process.env.BRIDGE_PREVIEW_INVITATION;

module.exports = defineConfig({
    testDir: './tests/e2e',
    testMatch: 'bridge-slice1*.spec.js',
    timeout: 240000,
    expect: { timeout: 20000 },
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: [['list']],
    use: {
        ignoreHTTPSErrors: true,
        headless: true,
        screenshot: 'off',
        trace: 'off',
        video: 'off'
    },
    webServer: {
        command: 'node tests/e2e/support/bridge-preview-launch.mjs',
        url: 'http://localhost:8792/ready',
        timeout: 240000,
        reuseExistingServer: false,
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
            ...process.env,
            ARCADE_PREVIEW_INVITATION: invitation,
            BRIDGE_READY_PORT: '8792'
        }
    }
});
