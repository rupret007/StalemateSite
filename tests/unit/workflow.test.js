// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(fileURLToPath(new URL('../..', import.meta.url)));

describe('CI and Pages workflow', () => {
    it('runs checks on every push and only deploys Pages from main after they pass', async () => {
        const yaml = await readFile(join(repoRoot, '.github/workflows/ci.yml'), 'utf8');

        expect(yaml).toContain('node-version: 24');
        expect(yaml).toContain('npm test');
        expect(yaml).toContain('mcr.microsoft.com/playwright:v1.64.1-noble@sha256:47b510dd9230bf0b9bfc9b20102241e577ea7a99334ab4c3ca19f19770e9b8ea');
        expect(yaml).toContain('node scripts/verify-ci-browsers.cjs');
        expect(yaml).toContain('node --test tests/ci/browser-runtime.test.cjs');

        const playwright = await readFile(join(repoRoot, 'playwright.config.js'), 'utf8');
        expect(playwright).toContain('webkit-iphone-se');
        expect(playwright).toContain('webkit-iphone-15');
        expect(playwright).toContain('webkit-iphone-15-pro-max');
        expect(playwright).toContain('chromium-android');
        expect(playwright).toMatch(/phones\\.spec\\.js/);
        expect(playwright).toContain('width: 375, height: 667');
        expect(playwright).toContain('width: 393, height: 852');
        expect(playwright).toContain('width: 430, height: 932');
        expect(playwright).toContain('width: 360, height: 800');
        expect(yaml).toMatch(/needs:\s*test/);
        expect(yaml).toContain("github.event_name == 'push'");
        expect(yaml).toContain("github.ref == 'refs/heads/main'");
        expect(yaml).toContain('actions/deploy-pages@');
        expect(yaml).toContain('actions/upload-pages-artifact@');
        expect(yaml).toContain('npm run package:pages');
        expect(yaml).not.toMatch(/continue-on-error:\s*true/);
    });
});
