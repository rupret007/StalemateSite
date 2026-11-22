const site = require('../../../playwright.config.js');
const { repoRoot } = require('../../support/product-room.cjs');

// The inventory supplies a disposable TURN service for this configuration.
module.exports = {
    ...site,
    testDir: __dirname,
    projects: site.projects.filter(project => project.name === 'chromium'),
    // TURN responses and generated invite URLs must stay out of traces.
    use: { ...site.use, trace: 'off' },
    webServer: { ...site.webServer, cwd: repoRoot }
};
