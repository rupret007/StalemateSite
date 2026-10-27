'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { EXPECTED_VERSION, verifyBrowsers } = require('../../scripts/verify-ci-browsers.cjs');
const version = { test: EXPECTED_VERSION, core: EXPECTED_VERSION };

function fixture(fault) {
    const events = [];
    const engines = Object.fromEntries(['chromium', 'webkit'].map(name => [name, {
        executablePath: () => `/ms-playwright/${name}/browser`,
        async launch(options) {
            events.push(`${name}:launch`);
            assert.equal(options.headless, true);
            if (fault === `${name}:launch`) throw new Error('launch refused');
            return {
                async newPage() {
                    return {
                        async setContent(content) {
                            assert.match(content, /CI browser probe/);
                            if (fault === `${name}:render`) throw new Error('render refused');
                            events.push(`${name}:render`);
                        },
                        async title() { return fault === `${name}:title` ? 'wrong' : 'CI browser probe'; },
                    };
                },
                async close() { events.push(`${name}:close`); },
            };
        },
    }]));
    return { engines, events };
}

test('both required engines must launch, render and close', async () => {
    const f = fixture();
    await verifyBrowsers(f.engines, version, () => true);
    assert.deepEqual(f.events, ['chromium:launch', 'chromium:render', 'chromium:close',
        'webkit:launch', 'webkit:render', 'webkit:close']);
});

for (const name of ['test', 'core']) {
    test(`mismatched ${name} version refuses before launching`, async () => {
        const f = fixture();
        await assert.rejects(verifyBrowsers(f.engines, { ...version, [name]: '0.0.0' }, () => true), /must match/);
        assert.deepEqual(f.events, []);
    });
}

for (const name of ['chromium', 'webkit']) {
    test(`missing ${name} executable refuses instead of downloading`, async () => {
        const f = fixture();
        await assert.rejects(verifyBrowsers(f.engines, version, path => !path.includes(name)), /is missing/);
        assert.ok(!f.events.includes(`${name}:launch`));
    });
    for (const fault of ['launch', 'render', 'title']) {
        test(`${name} ${fault} failure cannot qualify the runtime`, async () => {
            const f = fixture(`${name}:${fault}`);
            await assert.rejects(verifyBrowsers(f.engines, version, () => true));
            if (fault !== 'launch') assert.ok(f.events.includes(`${name}:close`));
            if (name === 'chromium') assert.ok(!f.events.includes('webkit:launch'));
        });
    }
}

test('workflow binds lockfile, image and preflight without changing test or deployment limits', () => {
    const root = join(__dirname, '../..');
    const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
    const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
    assert.equal(lock.packages['node_modules/@playwright/test'].version, EXPECTED_VERSION);
    assert.equal(lock.packages['node_modules/playwright-core'].version, EXPECTED_VERSION);
    assert.match(workflow, /mcr\.microsoft\.com\/playwright:v1\.64\.1-noble@sha256:47b510dd9230bf0b9bfc9b20102241e577ea7a99334ab4c3ca19f19770e9b8ea/);
    assert.match(workflow, /PLAYWRIGHT_BROWSERS_PATH: \/ms-playwright/);
    assert.match(workflow, /options: --user 1001/);
    assert.match(workflow, /timeout-minutes: 35/);
    assert.match(workflow, /Verify Chromium and WebKit\n        timeout-minutes: 10/);
    assert.match(workflow, /run: npm test/);
    assert.match(workflow, /needs: test/);
    assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
    assert.doesNotMatch(workflow, /continue-on-error:\s*true|playwright install/);
});
