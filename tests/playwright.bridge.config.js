const { randomBytes } = require('node:crypto');
const { join } = require('node:path');
const { defineConfig } = require('@playwright/test');

const shotsDir = join(__dirname, '..', '..', 'grade-bridge-on-388-20261113.job', 'shots');
process.env.BRIDGE_SHOTS_DIR = shotsDir;

// Reuse a value already handed to this process so a second config load cannot
// mint a different invitation than the one the preview was started with.
if (!process.env.BRIDGE_PREVIEW_INVITATION) process.env.BRIDGE_PREVIEW_INVITATION = randomBytes(24).toString('hex');

const invitation = process.env.BRIDGE_PREVIEW_INVITATION;

module.exports = defineConfig({
    testDir: './e2e',
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
        cwd: require('node:path').join(__dirname, '..'),
        url: 'http://localhost:8792/ready',
        timeout: 240000,
        reuseExistingServer: false,
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
            ...process.env,
            ARCADE_PREVIEW_INVITATION: invitation,
            BRIDGE_READY_PORT: '8792',
            BRIDGE_SHOTS_DIR: shotsDir
        }
    }
});
